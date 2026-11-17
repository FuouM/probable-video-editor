// The engine: owns the renderer, loads scenes for the timeline, renders any song time
// deterministically (with preroll for stateful scenes), composites transitions, HUD, post.
import * as THREE from 'three';
import { AudioData } from './audio';
import { Lyrics } from './lyrics';
import { Compositor, FSPass, W, H, PW, PH, SS_TAP, FRAME_SKEW, COPY_FRAG, makeRT, clearRT } from './gl';
import { DEFAULT_POST, Post, type PostParams } from './post';
import { Hud } from './hud';
import type { Frame, Overlay, OverlayClass, Scene, SceneClass, SceneCtx, PostOverrides } from './scene';
import { loadFonts } from './type';
import { loadStrokeFonts } from './stroke';
import { clearMarks, markScope } from './marks';
import { cutSpan } from './util';
import { memo } from './memo';
import { TileRefiner } from './tiles';
import { PackedReadback } from './readback';

export interface TimelineEntry {
  id: string;
  /** Scene file name (e.g. 'loss' for 'video/scenes/loss.ts'), used for hot-swapping. */
  scene?: string;
  /** Lazy module loader; the module's default export is the Scene class. */
  load: () => Promise<{ default: SceneClass }>;
  start: number;
  end: number;
  /** Default post overrides for this entry (the scene's own overrides win). */
  post?: PostOverrides;
  /** Free-form params handed to the scene as ctx.params. */
  params?: Record<string, any>;
  /** Cap on adaptive motion-blur sub-frames while this entry is on screen (for noise that converges slowly). */
  maxSamples?: number;
  /**
   * An Over transition (video.json `transitions`): drawn after the clips, on top of them. Its scene gets
   * the composited clips as `f.under` and composites itself (it must draw `under` where it is empty).
   */
  over?: boolean;
  /** Code version of the scene (a hash, see SceneCtx.memo). Without one, ctx.memo always computes. */
  version?: string;
}

/** What the engine plays: the song analysis, the lyrics and the resolved edit. */
export interface EngineProject {
  audio: AudioData;
  lyrics: Lyrics;
  timeline: TimelineEntry[];
  /** Loader of the project overlay (video.json `overlay`), drawn over every clip. */
  /** Scene file name of the overlay (e.g. 'hud'). */
  overlayScene?: string;
  overlay?: () => Promise<{ default: OverlayClass }>;
  /** URL of the project's video/assets/ folder, with a trailing slash (SceneCtx.assets). */
  assets: string;
  /** Font files the project replaces: path under fonts/ (e.g. `stroke/EMSAllure.svg`) -> URL. */
  fonts?: Record<string, string>;
}

interface Loaded { entry: TimelineEntry; scene: Scene | null; error?: string; lastT: number }

/** What Engine.init reports: count of total is the percent. `ids` (once, as the scenes start) lists every entry that loads; `scene` names one that has finished. */
export interface InitProgress { phase: string; count: number; total: number; detail: string; ids?: string[]; scene?: string }

/**
 * Per-frame adaptive motion-blur sampling (see Engine.render): the sub-frame count steps through
 * 4, 12, 36, 108, 324 … from `min` up to at most `max` (both rounded to that series) until the
 * estimated remaining sampling error is below `tol` 8-bit levels (worst 2x2-logical-px block).
 * `refine: 'tiles'` (the default) decides that per 32x32-logical-px tile, `'frame'` for the whole frame.
 */
export interface AdaptiveSampling { min: number; max: number; tol: number; refine?: 'tiles' | 'frame' }

/**
 * Shutter offsets (-0.5..0.5) of an adaptive run's sub-frames in rendering order: 4 evenly spread, then
 * each step splits every interval in three, adding a sub-frame either side of each old one. Every
 * prefix of 4·3^l is then evenly spread and centred on the frame's time, and so is each step's new set:
 * comparing the new set's average with the old one's measures sampling error, not a shift in time
 * (with doublings the new half sits half a step later, and any motion at all would read as error).
 */
function ternaryOffsets(steps: number) {
  const u = [0, 1, 2, 3].map((i) => (i + 0.5) / 4 - 0.5);
  for (let l = 0, n = 4; l < steps; l++, n *= 3)
    for (let m = 0; m < n; m++) u.push((3 * m + 0.5) / (3 * n) - 0.5, (3 * m + 2.5) / (3 * n) - 0.5);
  return u;
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  ctx!: SceneCtx;
  audio!: AudioData;
  lyrics!: Lyrics;
  hud!: Hud;
  post!: Post;
  comp = new Compositor();
  loaded = new Map<string, Loaded>();
  // (the scene targets and the motion-blur sums have a depth buffer: it carries the tile mask of per-tile refinement)
  private rts = [makeRT(), makeRT(), makeRT()];
  // Over transitions ping-pong between these, each reading the one before as `under`
  private overRTs = [makeRT(), makeRT()];
  readonly mixRT = makeRT();
  // motion-blur sub-frame sums (float: up to hundreds of sub-frames) and their average
  readonly sumRT = makeRT(W, H, { type: THREE.FloatType });
  readonly newRT = makeRT(W, H, { type: THREE.FloatType });
  readonly avgRT = makeRT(W, H, { depthBuffer: false });
  /** Per-tile refinement of the adaptive sampling: the error estimate, the tile mask and the per-tile gain. */
  readonly tiles: TileRefiner;
  /** Sub-frames used for the last rendered frame, and its estimated sampling error after each step. */
  lastSamples = 1;
  lastErrors: number[] = [];
  /** Share of the last frame's extra sub-frames (beyond the first set) actually shaded (1 = every tile). */
  lastShaded = 1;
  readonly finalRT = new THREE.WebGLRenderTarget(PW, PH, { type: THREE.UnsignedByteType, depthBuffer: false });
  /** Packed RGB readback of the finished frame (readStart / readFinish). */
  readonly readback: PackedReadback;
  readonly blit: FSPass;
  readonly xfade: FSPass;
  readonly accum: FSPass;
  private lastT = -1;
  lastPost: PostParams = { ...DEFAULT_POST };
  errors: string[] = [];
  /** Suppress the HUD (crop marks, project overlay) — used when rendering plate thumbnails. */
  hudOff = false;

  overlayLoader?: () => Promise<{ default: OverlayClass }>;
  overlayScene?: string;
  timeline: TimelineEntry[] = [];
  /**
   * Load pacing (the studio reloads an edited scene while it plays). A scene load waits at each ctx.slice() (and the
   * engine's own points in loadEntry) until paceLoads gives it time. Infinity (the default: exports, the loading
   * screen): never waits.
   */
  private sliceUntil = Infinity;
  private sliceWaiters: (() => void)[] = [];

  constructor(public canvas: HTMLCanvasElement, private loadProject: () => Promise<EngineProject>) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(PW, PH, false);
    this.renderer.autoClear = false;
    this.blit = new FSPass(COPY_FRAG, { src: { value: null } });
    this.xfade = new FSPass(`uniform sampler2D a; uniform sampler2D b; uniform float k;
      void main(){ fragColor = mix(texture(a, vUv), texture(b, vUv), k); }`, { a: { value: null }, b: { value: null }, k: { value: 0 } });
    // adds a sub-frame to a sum; a non-finite pixel (a stray NaN from some shader in one sub-frame out of
    // hundreds) is dropped, or it would poison the average and bloom into a disc
    this.accum = new FSPass(`uniform sampler2D src;
      void main() {
        vec4 c = texture(src, vUv);
        bool ok = abs(c.r) <= 6e4 && abs(c.g) <= 6e4 && abs(c.b) <= 6e4 && abs(c.a) <= 6e4;
        fragColor = ok ? c : vec4(0.0);
      }`, { src: { value: null } }, { blending: THREE.CustomBlending, transparent: true });
    const am = this.accum.mat;
    am.blendEquation = THREE.AddEquation;
    am.blendSrc = THREE.OneFactor; am.blendDst = THREE.OneFactor;
    am.blendSrcAlpha = THREE.ZeroFactor; am.blendDstAlpha = THREE.OneFactor;
    this.tiles = new TileRefiner(this.renderer, this);
    for (const rt of [...this.rts, ...this.overRTs, this.mixRT, this.newRT, this.sumRT]) this.tiles.maskedRTs.set(rt, { margin: 0 });
    this.readback = new PackedReadback(this.renderer, this.finalRT);
  }

  async init(
    only?: (e: TimelineEntry) => boolean,
    onProgress?: (p: InitProgress) => void,
    warm = false,
  ) {
    onProgress?.({ phase: 'manifest', count: 5, total: 100, detail: 'Loading manifest & project inputs...' });
    const project = await this.loadProject();
    onProgress?.({ phase: 'fonts', count: 15, total: 100, detail: 'Loading typographic font faces...' });
    await Promise.all([loadFonts(project.fonts), loadStrokeFonts(project.fonts)]);
    this.audio = project.audio;
    this.lyrics = project.lyrics;
    this.timeline = project.timeline;
    this.ctx = {
      renderer: this.renderer, audio: this.audio, lyrics: this.lyrics, comp: this.comp, W, H, id: '', params: {}, start: 0, end: 0, assets: project.assets,
      mapTileMask: (rt, map) => this.tiles.mapTileMask(rt, map),
      ensureClip: (id) => this.ensureClip(id),
      renderClip: (id, t, target, dt) => this.renderClip(id, t, target, dt),
      slice: () => this.slice(),
      // (the overlay has no code version: it always computes)
      memo: async (_name, compute) => compute(),
    };
    this.post = new Post();
    let overlay: Overlay | null = null;
    if (project.overlay) {
      this.overlayLoader = project.overlay;
      this.overlayScene = project.overlayScene;
      try {
        const mod = await project.overlay();
        overlay = new mod.default({ ...this.ctx, id: 'overlay', params: {}, start: 0, end: this.audio.duration });
        await overlay.init();
      } catch (err) {
        this.errors.push(`[overlay] ${String((err as Error)?.stack ?? err)}`);
        console.error('overlay failed', err);
      }
    }
    this.hud = new Hud(overlay);
    // (with a filter, the Over transitions that overlap a chosen clip load too: they are part of its frames)
    const picked = only ? this.timeline.filter((e) => !e.over && only(e)) : null;
    const entries = picked
      ? [...picked, ...this.timeline.filter((o) => o.over && (only!(o) || picked.some((e) => o.start < e.end && o.end > e.start)))]
      : this.timeline;
    const total = entries.length;
    let done = 0;
    onProgress?.({ phase: 'scenes', count: 15, total: 100, detail: `Warming ${total} scenes...`, ids: entries.map((e) => e.id) });
    await Promise.all(
      entries.map(async (e) => {
        await this.loadEntry(e);
        done++;
        onProgress?.({
          phase: 'scenes',
          count: 15 + Math.round((done / Math.max(1, total)) * 85),
          total: 100,
          detail: `Warming ${e.id} (${done}/${total})...`,
          scene: e.id,
        });
      }),
    );
    if (warm) await this.warmClips(entries, onProgress);
    onProgress?.({ phase: 'ready', count: 100, total: 100, detail: 'Ready.' });
  }

  /**
   * Renders the first frame of each clip once, off screen. `renderer.compile` only starts the programs: the link, the shadow programs and
   * the texture uploads wait for the first draw, which then stalls playback at the clip boundary (50-250 ms). After the warm frames every
   * clip seeks again on its next frame, so the warm frames change no picture.
   */
  private async warmClips(entries: TimelineEntry[], onProgress?: (p: InitProgress) => void) {
    const clips = entries.filter((e) => !e.over && this.loaded.get(e.id)?.scene);
    for (const [i, e] of clips.entries()) {
      onProgress?.({ phase: 'scenes', count: 100, total: 100, detail: `Warming the first frame of ${e.id} (${i + 1}/${clips.length})...` });
      this.warmClip(e.id);
      // (the loader paints between the clips)
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    }
  }

  /** Renders the first frame of loaded clip `id` once, off screen (see warmClips). Every clip then seeks on its next frame. */
  private warmClip(id: string) {
    const e = this.timeline.find((x) => x.id === id);
    if (!e || e.over || !this.loaded.get(id)?.scene) return;
    this.render(e.start, 1 / 60, false);
    this.lastT = -1;
    for (const rec of this.loaded.values()) rec.lastT = -1;
  }

  /** SceneCtx.slice: nothing while the load has time, else a promise that paceLoads resolves. */
  private slice(): Promise<void> | void {
    if (performance.now() < this.sliceUntil) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.sliceWaiters.push(resolve);
    return promise;
  }

  /** Scene loads may run until performance.now() reaches `until` (ms; Infinity: no limit). */
  paceLoads(until: number) {
    this.sliceUntil = until;
    if (performance.now() >= until) return;
    for (const w of this.sliceWaiters.splice(0)) w();
  }

  private loading = new Map<string, Promise<void>>();

  /** `replace`: a loaded scene is drawn until the new one is ready, then swapped (see reload). */
  private loadEntry(e: TimelineEntry, replace = false): Promise<void> {
    const existing = this.loading.get(e.id);
    if (existing) return existing;
    const p = (async () => {
      const prev = replace ? this.loaded.get(e.id) : undefined;
      const rec: Loaded = { entry: e, scene: null, lastT: -1 };
      if (!prev?.scene) this.loaded.set(e.id, rec);
      try {
        const mod = await e.load();
        await this.slice();
        const params = e.params ?? {}, version = e.version;
        const ctx: SceneCtx = { ...this.ctx, id: e.id, params, start: e.start, end: e.end };
        if (version !== undefined) {
          const key = `${version}|${e.start}|${e.end}|${JSON.stringify(params)}`;
          ctx.memo = (name, compute) => memo(`${this.ctx.assets}|${e.id}|${name}`, key, compute);
        }
        const s = new mod.default(ctx);
        await this.slice();
        await s.init();
        rec.scene = s;
        if (prev?.scene) {
          this.loaded.set(e.id, rec);
          for (const m of prev.scene.tileMasked) this.tiles.maskedRTs.delete(m.rt);
          prev.scene.dispose();
        }
        for (const m of s.tileMasked) this.tiles.maskedRTs.set(m.rt, { margin: m.margin, moving: m.moving });
      } catch (err) {
        // a V8 stack starts with the message, a Firefox or Safari stack holds only the frames
        const stack = (err as Error)?.stack;
        rec.error = stack ? (stack.startsWith(String(err)) ? stack : `${err}\n${stack}`) : String(err);
        this.errors.push(`[${e.id}] ${rec.error}`);
        console.error(`scene ${e.id} failed`, err);
      }
    })();
    this.loading.set(e.id, p);
    return p;
  }

  /** Ensure timeline entry `id` is loaded and initialized. */
  async ensureClip(id: string): Promise<void> {
    const e = this.timeline.find((x) => x.id === id);
    if (!e) throw new Error(`ensureClip: unknown timeline entry "${id}"`);
    await this.loadEntry(e);
  }

  /** Render already-loaded timeline entry `id` at song time `t` into `target`. */
  renderClip(id: string, t: number, target: THREE.WebGLRenderTarget, dt = 1 / 60): THREE.Texture | null {
    const rec = this.loaded.get(id);
    if (!rec?.scene) return null;
    const prev = markScope(id, true);
    try {
      this.renderEntry(rec.entry, target, t, dt, false, null, 1, 0, t);
    } finally {
      markScope(prev[0], prev[1]);
    }
    return target.texture;
  }

  /** Hot-swap a scene module (Vite HMR in preview, a changed player option): the old scene draws until the new one is ready. */
  async reload(id: string) {
    const e = this.timeline.find((x) => x.id === id);
    if (!e) return;
    this.loading.delete(id);
    await this.loadEntry(e, true);
    this.lastT = -1;
  }
  /** Hot-swap the project overlay scene. */
  async reloadOverlay(loader?: () => Promise<{ default: OverlayClass }>) {
    if (loader) this.overlayLoader = loader;
    if (!this.overlayLoader) return;
    try {
      const mod = await this.overlayLoader();
      const overlay = new mod.default({ ...this.ctx, id: 'overlay', params: {}, start: 0, end: this.audio.duration });
      await overlay.init();
      this.hud = new Hud(overlay);
      this.lastT = -1;
    } catch (err) {
      this.errors.push(`[overlay] ${String((err as Error)?.stack ?? err)}`);
      console.error('overlay reload failed', err);
    }
  }


  get duration() { return this.audio.duration; }

  /** The Frame that entry `e` gets at song time t (also used by benchmarks). */
  frameFor(e: TimelineEntry, t: number, dt: number, seeked: boolean, preroll: boolean, under: THREE.Texture | null, tin: number, tout: number, ft = t): Frame {
    const beat = this.audio.beatAt(t), bar = this.audio.barAt(t);
    return {
      t, ft, dt, lt: t - e.start, p: (t - e.start) / (e.end - e.start), start: e.start, end: e.end, seeked, preroll,
      beat, bar, beatPhase: beat - Math.floor(beat), barPhase: bar - Math.floor(bar),
      a: this.audio.sample(t), under, tin, tout,
    };
  }

  /**
   * Cap of the adaptive sample count at time t (shutter width w). While an over transition is on,
   * only the transitions give a cap (a clip under a sharp plate stays blurred where its transition
   * says so). Otherwise the clips on screen give it. The lowest cap wins. A cap under 4 means one
   * sample: no motion blur.
   */
  private sampleCap(t: number, w: number, max: number): number {
    const on = this.timeline.filter((e) => t + w / 2 >= e.start && t - w / 2 < e.end);
    const over = on.filter((e) => e.over);
    let cap = max;
    for (const e of over.length ? over : on) if (e.maxSamples) cap = Math.min(cap, e.maxSamples);
    return cap;
  }

  /**
   * Render song time t. `dt` is the nominal frame step (1/fps). A non-sequential t counts as a
   * seek: stateful scenes are reset and fast-forwarded.
   *
   * Motion blur (offline export; the preview uses 1 sample): `samples` > 1 renders that many sub-frames
   * spread evenly over `shutter` x dt around t and averages them before post-processing, which gives real
   * motion blur plus temporal anti-aliasing. With an AdaptiveSampling the count is chosen per frame:
   * sub-frames are added in nested steps (4, 12, 36 … each set evenly spread over the shutter, see
   * ternaryOffsets) until the estimated remaining error is below `tol` levels. Stepped copies of a moving
   * edge shrink as 1/count, so when a step changes the frame by e, what is left is about e/2
   * (e·(1/3 + 1/9 + …)). A still frame stops at 3 x min; a whip pan goes on until its streaks are
   * continuous instead of stepped copies.
   * Returns the number of sub-frames used.
   */
  render(t: number, dt = 1 / 60, toScreen = true, samples: number | AdaptiveSampling = 1, shutter = 0.5): number {
    const r = this.renderer;
    const seeked = this.lastT < 0 || t < this.lastT - 1e-6 || t - this.lastT > Math.max(0.25, dt * 4);
    this.lastT = t;
    let outTex: THREE.Texture;
    let post: PostParams = { ...DEFAULT_POST };
    let n = 1;
    const sharp = typeof samples !== 'number' && this.sampleCap(t, dt * shutter, samples.max) < 4;
    if (samples === 1 || sharp) {
      SS_TAP.value = -1;
      FRAME_SKEW.value = 0;
      ({ outTex, post } = this.composite(t, dt, seeked));
    } else {
      const adaptive = typeof samples !== 'number';
      let maxAdaptive = adaptive ? this.sampleCap(t, dt * shutter, samples.max) : 0;
      if (adaptive) {
        // sub-frames are rendered out of time order: fine for pure functions of t, not for scenes that integrate state
        const w = dt * shutter;
        const on = this.timeline.filter((e) => t + w / 2 >= e.start && t - w / 2 < e.end);
        const st = on.find((e) => this.loaded.get(e.id)?.scene?.stateful);
        if (st) throw new Error(`adaptive sampling needs stateless scenes; '${st.id}' is stateful (use a fixed --samples)`);
        // (the sample cap comes from sampleCap)
      }
      // shaders that supersample share their 4 taps across the sub-frames when every set holds a multiple
      // of 4 (rotated by k/4 so a tap doesn't always land in the same part of the shutter)
      const cycle = adaptive || samples % 4 === 0;
      // post parameters (shake, flash, zoom, fades, the HUD's paper mode) are read at one point of the shutter,
      // 1/8 of it after t: where the video was tuned (4 sub-frames, the third) and a point every adaptive set
      // includes. (A flash that starts between t and there shows at its peak on this frame, not one frame on.)
      const POST_U = 0.125;
      let nearest = Infinity;
      // a hard cut inside the shutter would put both scenes into the frame (ghosting): the frame belongs to the
      // scene on screen at t, so sub-frames are clamped to the span of t between two cuts
      const [cutLo, cutHi] = cutSpan(this.timeline, t);
      // sub-frame k at shutter offset u (-0.5..0.5), summed into `into`; `step` = the sub-frame spacing
      const sub = (k: number, u: number, into: THREE.WebGLRenderTarget, step: number) => {
        SS_TAP.value = cycle ? (k + (k >> 2)) % 4 : -1;
        // (clamped at 0: before the song no scene is active, and frame 0 would come out half black)
        const ts = Math.min(Math.max(0, cutLo, t + dt * shutter * u), cutHi - 1e-6);
        FRAME_SKEW.value = t - ts;
        let res: ReturnType<Engine['composite']>;
        const tiles = this.tiles;
        if (!tiles.masking) res = this.composite(ts, step, seeked && k === 0, t);
        else {
          // a scene that depth-tests its own 3D can't draw over the mask: its sub-frames are drawn unmasked
          // (and the mask written again after, since it has cleared and drawn into the scene target's depth)
          const ids = this.timeline.filter((e) => ts >= e.start && ts < e.end).map((e) => e.id);
          let own = ids.some((id) => tiles.depthEntries.has(id));
          if (!own) {
            tiles.depthSeen = false;
            res = this.composite(ts, step, seeked && k === 0, t);
            if (tiles.depthSeen) { own = true; for (const id of ids) tiles.depthEntries.add(id); }
          }
          if (own) {
            tiles.setMasking(false);
            res = this.composite(ts, step, seeked && k === 0, t);
            tiles.writeTileMask();
            tiles.setMasking(true);
          }
        }
        this.accum.u.src!.value = res!.outTex;
        this.accum.render(r, into);
        const d = Math.abs(u - POST_U);
        if (d < nearest - 1e-9 || (d < nearest + 1e-9 && u > POST_U)) { nearest = d; post = res!.post; }
      };
      clearRT(r, this.sumRT, [0, 0, 0], 0);
      let perTile = false;
      if (!adaptive) {
        n = samples;
        for (let k = 0; k < n; k++) sub(k, (k + 0.5) / n - 0.5, this.sumRT, dt / n);
      } else {
        const lg3 = (x: number) => Math.log(x / 4) / Math.log(3);
        const lo = Math.max(0, Math.round(lg3(samples.min))), hi = Math.max(lo, Math.floor(lg3(maxAdaptive) + 1e-9));
        const u = ternaryOffsets(hi);
        n = 4 * 3 ** lo;
        this.lastErrors = [];
        this.lastShaded = 1;
        for (let k = 0; k < n; k++) sub(k, u[k]!, this.sumRT, dt / n);
        if ((samples.refine ?? 'tiles') === 'frame') {
          for (let l = lo; l < hi; l++) {
            clearRT(r, this.newRT, [0, 0, 0], 0);
            for (let k = n; k < 3 * n; k++) sub(k, u[k]!, this.newRT, dt / (3 * n));
            const err = this.tiles.sampleError(n) / 2;
            this.lastErrors.push(err);
            this.comp.draw(r, this.newRT.texture, this.sumRT, { mode: 'add', opacity: 1, premult: false });
            n *= 3;
            if (err < samples.tol) break;
          }
        } else {
          // per-tile refinement (TileRefiner.refine): converged tiles are masked out of later sets
          const res = this.tiles.refine(
            n, hi - lo, samples.tol,
            (m) => { for (let k = m; k < 3 * m; k++) sub(k, u[k]!, this.newRT, dt / (3 * m)); },
            () => this.comp.draw(r, this.newRT.texture, this.sumRT, { mode: 'add', opacity: 1, premult: false }),
          );
          n = res.n;
          perTile = res.perTile;
          this.lastErrors = res.errors;
          if (res.shaded !== undefined) this.lastShaded = res.shaded;
        }
      }
      SS_TAP.value = -1;
      FRAME_SKEW.value = 0;
      if (perTile) this.tiles.average(this.sumRT.texture, this.avgRT);
      else this.comp.draw(r, this.sumRT.texture, this.avgRT, { mode: 'replace', opacity: 1 / n, premult: false });
      outTex = this.avgRT.texture;
    }
    this.lastSamples = n;
    const hudTex = this.hud.draw(t, { opacity: this.hudOff ? 0 : post.hud, frame: post.frame, paper: post.paper, overlay: post.overlay ?? {} });
    this.post.render(r, outTex, hudTex, this.finalRT, post, t);
    this.lastPost = post;
    if (toScreen) {
      this.blit.u.src!.value = this.finalRT.texture;
      this.blit.render(r, null);
    }
    return n;
  }

  /**
   * Render and composite all scenes active at t into an HDR texture (no post). `dt` is the step handed to
   * scenes (the frame step, or the sub-frame spacing); `seeked` says time jumped before this call.
   */
  composite(t: number, dt: number, seeked: boolean, ft = t): { outTex: THREE.Texture; post: PostParams } {
    const r = this.renderer;
    clearMarks();

    const live = this.timeline.filter((e) => t >= e.start && t < e.end).sort((a, b) => a.start - b.start);
    const active = live.filter((e) => !e.over);
    let post: PostParams = { ...DEFAULT_POST };
    let under: THREE.Texture | null = null;
    let outTex: THREE.Texture | null = null;

    active.forEach((e, idx) => {
      const rt = this.rts[idx % this.rts.length]!;
      const prev = active[idx - 1], next = active[idx + 1];
      const tin = prev ? Math.min(1, (t - e.start) / Math.max(1e-3, prev.end - e.start)) : 1;
      const tout = next ? Math.max(0, (t - next.start) / Math.max(1e-3, e.end - next.start)) : 0;
      const res = this.renderEntry(e, rt, t, dt, seeked, idx > 0 ? under : null, tin, tout, ft);
      if (!res) { under = rt.texture; outTex = rt.texture; return; }
      post = { ...post, ...(e.post ?? {}), ...(res.ov ?? {}) };
      if (idx > 0 && !res.scene.handlesTransition && under) {
        // default: crossfade from the previous scene over the overlap
        this.xfade.u.a!.value = under;
        this.xfade.u.b!.value = rt.texture;
        this.xfade.u.k!.value = tin;
        this.xfade.render(r, this.mixRT);
        outTex = this.mixRT.texture;
      } else outTex = rt.texture;
      under = outTex;
    });

    if (!outTex) { clearRT(r, this.rts[0]!, [0, 0, 0]); outTex = this.rts[0]!.texture; }

    // Over transitions: each draws itself over what is composited so far (their post settings do not apply)
    let k = 0;
    for (const e of live) {
      if (!e.over || !this.loaded.get(e.id)?.scene) continue;
      const rt = this.overRTs[k++ % this.overRTs.length]!;
      const p = (t - e.start) / Math.max(1e-3, e.end - e.start);
      if (this.renderEntry(e, rt, t, dt, seeked, outTex, p, p, ft)) outTex = rt.texture;
    }
    return { outTex, post };
  }

  /** Render one timeline entry into rt (with preroll after a seek); null when it has no scene. */
  private renderEntry(e: TimelineEntry, rt: THREE.WebGLRenderTarget, t: number, dt: number, seeked: boolean, under: THREE.Texture | null, tin: number, tout: number, ft = t): { scene: Scene; ov: PostOverrides | void } | null {
    const r = this.renderer;
    const rec = this.loaded.get(e.id);
    if (!rec?.scene) {
      clearRT(r, rt, [0.25, 0.0, 0.0]);
      return null;
    }
    const s = rec.scene;
    // (sub-frames of one frame may step back within its shutter: not a seek)
    const sceneSeeked = seeked || rec.lastT < 0 || Math.abs(t - rec.lastT) > 0.25;
    if (s.stateful && sceneSeeked) {
      s.reset();
      const from = Math.max(e.start, t - s.prerollMax);
      const step = 1 / 60;
      let first = true;
      markScope(e.id, false);
      for (let pt = from; pt < t - step * 0.5; pt += step) {
        s.render(this.frameFor(e, pt, first ? 0 : step, first, true, null, 1, 0), rt);
        first = false;
      }
    }
    markScope(e.id, true);
    let ov: PostOverrides | void = undefined;
    try {
      ov = s.render(this.frameFor(e, t, sceneSeeked ? 0 : dt, sceneSeeked && !s.stateful, false, under, tin, tout, ft), rt);
    } catch (err) {
      console.error(`scene ${e.id} render error`, err);
      clearRT(r, rt, [0.25, 0.0, 0.0]);
    }
    rec.lastT = t;
    return { scene: s, ov };
  }

  /** RGBA8 pixels of the last rendered frame (bottom-up rows), PW x PH. */
  readPixels(buf?: Uint8Array) {
    const out = buf ?? new Uint8Array(PW * PH * 4);
    this.renderer.readRenderTargetPixels(this.finalRT, 0, 0, PW, PH, out);
    return out;
  }

  /**
   * Same pixels as readPixels(), read through a pixel-pack buffer and a fence instead of a blocking
   * readPixels: several times faster in Chrome (~15 ms instead of ~40 ms at 1080p, ~150 ms at 4K).
   */
  async readPixelsAsync(buf?: Uint8Array) {
    const out = buf ?? new Uint8Array(PW * PH * 4);
    await this.renderer.readRenderTargetPixelsAsync(this.finalRT, 0, 0, PW, PH, out);
    return out;
  }

  /** Bytes per frame of readStart/readFinish (packed RGB, bottom-up rows). */
  static readonly RGB_BYTES = PackedReadback.BYTES;
  /**
   * Pipelined readback of the last rendered frame as packed RGB (rgb24, bottom-up rows; the bytes of
   * readPixels() without alpha): queue the copy into pixel-pack buffer `slot` (it runs on the GPU after
   * the frame, so the next frame can be rendered at once), then collect it with readFinish(slot). Two
   * slots let frame n be collected while n+1 renders. (A fresh buffer each time, as three's readback does:
   * Chrome warns on every frame when a read-back buffer is reused, though it reads no faster.)
   */
  readStart(slot: number) {
    this.readback.start(slot);
  }

  /** Wait for readStart(slot)'s copy and copy it into `out` (Engine.RGB_BYTES). */
  readFinish(slot: number, out: Uint8Array) {
    return this.readback.finish(slot, out);
  }

  dispose() {
    for (const rt of this.rts) rt.dispose();
    for (const rt of this.overRTs) rt.dispose();
    this.mixRT.dispose();
    this.sumRT.dispose();
    this.newRT.dispose();
    this.avgRT.dispose();
    this.tiles.dispose();
    this.finalRT.dispose();
    this.readback.dispose();

    this.blit.dispose();
    this.xfade.dispose();
    this.accum.dispose();

    this.comp.dispose();
    this.post.dispose();
    this.hud.dispose();

    for (const rec of this.loaded.values()) {
      rec.scene?.dispose();
    }
    this.loaded.clear();

    this.renderer.dispose();
  }
}
