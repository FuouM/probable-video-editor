// Transition plate 8 → 9 (epigone → last; video.json `transitions`, id peel): the dense page of epigone comes off in
// cards, across the cut, and last's page is laid bare under it while its first stamps land. An Over transition that
// starts before the cut and goes on after it. The epigone frame is cut into a grid of 24 x 12 tiles. On each of the
// last three kicks that are not on the cut a set of tiles is stamped up: it gets the ink border and the shadow of a
// stamp card of last (last-stamps.ts), swells and tilts for three steps of 24 fps, and then it falls off the frame
// under gravity, spinning. Where a tile has left, the page of last shows: before the cut rendered live under the
// transition (the clean page: the sparse margins and the marks at the foot, no seal), after it last itself.
// The sung text is never taken before it is sung (rule 3 of the treatment: every sung syllable is legible at its
// onset). The tiles that carry the text of line 61, the last line of epigone, stay in place, on top of the falling
// cards: the three stamps of ぽいなぽいなぽい go on the last beat of epigone (the last kick before the cut, 174.61 s), the
// rest of the line (憧れちゃうわ！ and its gloss) just before the cut, on the hat before it (174.92 s), so that it is
// already coming off when last begins, a step after the last syllable, わ！, has been struck in and while it is
// still sung. They go the same way as the others. Every other card is off the page long before, so the first stamps
// of last land on a clear page. A tile that has not been stamped up yet stays the page of epigone as it stood on the
// cut. The big split characters (the kick chimeras of epigone) are not part of the page here: their ink is taken
// off the tiles and they are drawn again on top of everything, so they play on as in epigone (their halves fly apart
// and fall) and the last one goes on over the cut. The camera never moves, and nothing is stored from one frame to
// the next: every position is a function of the step.
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { FSPass, H, Layer2D, makeRT, W } from '@pve/engine/gl';
import { lineNo } from '@pve/engine/lyrics';
import { clamp, hash, stepN } from '@pve/engine/util';
import { INK, POST } from './_page';
import { chimera, drawSplit, type Chimera, type HalfPose } from './epigone-ish';
/** Steps of the type layer (24 fps). */
const FPS = 24;
/** The grid of tiles. */
const COLS = 24, ROWS = 12;
const TW = W / COLS, TH = H / ROWS;
/** The kicks that lift a set of tiles: from this long before the cut to this long before it (s). */
const WAVES_FROM = 1.3, WAVES_TO = 0.2;
/** The kick chimeras of epigone (epigone.ts): seed, assembly, flight (s), one step (s). */
const KICK_SEED = 81, ASM = 0.125, FLY = 0.28, STEP = 1 / 24;
/** The boxes at most that the ink of the chimeras is taken off the page in (live and frozen). */
const MAX_BOXES = 16;
/** The paper of epigone, in linear light. */
const PAPER_LIN = '0.83, 0.83, 0.83';
/**
 * Where epigone sets the text of its line 61 (relapse() in epigone.ts), with a margin. The tiles on them stay: the
 * three stamps of ぽい (x 300-1270, row at y 380) go on the last beat, 憧れちゃうわ！ (row at y 640) and its gloss (y
 * 790) just before the cut.
 */
// the right edge of the stamps is on a column line, and the ring of epigone (from x 1280) is in the next column
const STAMPS: [number, number, number, number] = [270, 250, 1280, 500];
const REST: [number, number, number, number][] = [[270, 530, 1110, 750], [270, 750, 1000, 820]];
const hits = (ix: number, iy: number, [x0, y0, x1, y1]: [number, number, number, number]) =>
  ix * TW < x1 && (ix + 1) * TW > x0 && iy * TH < y1 && (iy + 1) * TH > y0;
/** Steps a stamped-up tile hovers before it falls. */
const HOVER = 3;
/** The fall, px/s². */
const GRAVITY = 8000;

const VERT = /* glsl */ `precision highp float;
in vec3 position; in vec2 uv; in mat4 instanceMatrix; in vec4 aRect; in float aLift;
uniform mat4 projectionMatrix; uniform mat4 viewMatrix; uniform mat4 modelMatrix;
out vec2 vQ; out vec2 vTex; out float vLift;
void main() {
  vQ = uv;
  vTex = vec2(mix(aRect.x, aRect.z, uv.x), mix(aRect.y, aRect.w, uv.y));
  vLift = aLift;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;

/**
 * Takes the ink of the chimeras off the page: inside the boxes the dark pixels turn to paper (the chimeras are drawn
 * again over the cards). Not on the text of line 61, which is always legible.
 */
const STRIP = /* glsl */ `
uniform vec4 uRect[${MAX_BOXES}];
uniform int uN;
vec3 strip(vec2 uv, vec3 c) {
  vec2 p = vec2(uv.x * ${W}.0, (1.0 - uv.y) * ${H}.0);
  float on = 0.0;
  for (int i = 0; i < ${MAX_BOXES}; i++) {
    if (i >= uN) break;
    vec4 r = uRect[i];
    on = max(on, float(p.x > r.x && p.y > r.y && p.x < r.z && p.y < r.w));
  }
  ${[STAMPS, ...REST].map(([x0, y0, x1, y1]) => `on *= 1.0 - float(p.x > ${x0}.0 && p.y > ${y0}.0 && p.x < ${x1}.0 && p.y < ${y1}.0);`).join('\n  ')}
  float dark = 1.0 - smoothstep(0.25, 0.75, dot(c, vec3(0.2126, 0.7152, 0.0722)));
  return mix(c, vec3(${PAPER_LIN}), on * dark);
}`;

const FRAG_TILE = /* glsl */ `precision highp float;
${STRIP}
uniform sampler2D src;
uniform vec2 uTile;
in vec2 vQ; in vec2 vTex; in float vLift;
out vec4 fragColor;
void main() {
  vec3 c = strip(vTex, texture(src, vTex).rgb);
  // the ink border of a card
  vec2 d = min(vQ, 1.0 - vQ) * uTile;
  float ink = (1.0 - smoothstep(3.0, 4.5, min(d.x, d.y))) * vLift;
  fragColor = vec4(mix(c, vec3(0.04), ink), 1.0);
}`;

const FRAG_SHADOW = /* glsl */ `precision highp float;
in vec2 vQ; in vec2 vTex; in float vLift;
out vec4 fragColor;
void main() {
  vec2 d = abs(vQ - 0.5);
  float a = 1.0 - smoothstep(0.34, 0.5, max(d.x, d.y));
  fragColor = vec4(0.0, 0.0, 0.0, a * 0.32 * vLift);
}`;

const FRAG_BASE = /* glsl */ `${STRIP}
uniform sampler2D src;     // the page of epigone: as it plays before the cut, as it stood on the cut after it
uniform sampler2D dst;     // the page of last: live before the cut, last itself after it
uniform sampler2D mask;    // one texel per tile: 1 where the tile has been stamped up
uniform vec2 uGrid;
void main() {
  ivec2 g = ivec2(floor(vUv.x * uGrid.x), floor((1.0 - vUv.y) * uGrid.y));
  float m = texelFetch(mask, g, 0).r;
  vec3 pg = strip(vUv, texture(src, vUv).rgb);
  fragColor = vec4(mix(pg, texture(dst, vUv).rgb, step(0.5, m)), 1.0);
}`;

const FRAG_OVER = `
uniform sampler2D ov;      // the kick chimeras of epigone, in ink on clear
void main() {
  fragColor = texture(ov, vUv);
}`;

const FRAG_KEEP = /* glsl */ `
uniform sampler2D src;     // the page of epigone
uniform sampler2D mask;    // G: 1 on the tiles of the sung text that have not been stamped up
uniform vec2 uGrid;
void main() {
  ivec2 g = ivec2(floor(vUv.x * uGrid.x), floor((1.0 - vUv.y) * uGrid.y));
  fragColor = vec4(texture(src, vUv).rgb, step(0.5, texelFetch(mask, g, 0).g));
}`;

/** A box on the frame: left, top, right, bottom (px, y down). */
type Rect = [number, number, number, number];
/** A kick chimera at one time: where it is, and its boxes. */
interface Chim { g: Chimera; x: number; y: number; s: number; w: number; pa: HalfPose; pb: HalfPose; boxes: Rect[] }

/** One tile: where it starts, when it is stamped up, and the arc it falls on. */
interface Tile {
  cx: number; cy: number;
  /** The kick that lifts it, and when it starts to fall. */
  lift: number; fall: number;
  /** It carries the sung text: it stays until the line is sung. */
  keep: boolean;
  vx: number; vy: number;
  r0: number; spin: number;
}

export default class Peel extends Scene {
  override handlesTransition = true;
  private pass!: FSPass;
  /** Draws the tiles of the sung text over the falling cards. */
  private keep!: FSPass;
  private next = makeRT();
  /** The page of epigone on the cut. */
  private shot = makeRT();
  private cut = 0;
  private tiles: Tile[] = [];
  /** The kicks of epigone near the cut: index in its list (the seed of the chimera), time, hold (s). */
  private kicked: { k: number; tk: number; hold: number }[] = [];
  private l61 = 0;
  /** The boxes of the chimeras as they stood on the cut, in the frozen page of epigone. */
  private frozen: Rect[] = [];
  /** The boxes that are taken off the page of epigone: shared by the passes and the cards. */
  private strips = {
    uRect: { value: Array.from({ length: MAX_BOXES }, () => new THREE.Vector4()) },
    uN: { value: 0 },
  };
  /** The chimeras, drawn over everything. */
  private ov = new Layer2D();
  private over!: FSPass;
  private mask!: THREE.DataTexture;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(0, W, 0, H, -1, 1);
  private cards!: THREE.InstancedMesh;
  private shadows!: THREE.InstancedMesh;
  private tileMat!: THREE.RawShaderMaterial;
  private rects!: THREE.InstancedBufferAttribute;
  private lifts!: THREE.InstancedBufferAttribute;
  private shadowLifts!: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  override async init() {
    const pr = this.ctx.params;
    if (typeof pr.at !== 'number') throw new Error('peel: no resolved at');
    if (typeof pr.epigone !== 'number') throw new Error('peel: params.epigone (the beat epigone starts on) is missing');
    this.cut = pr.at;

    // the sets: the kicks before the cut; the sung text goes when its line is over
    const waves = this.ctx.audio.events('kick', this.cut - WAVES_FROM, this.cut - WAVES_TO).map(([t]) => t);
    if (waves.length < 2) throw new Error(`peel: ${waves.length} kicks before the cut, want at least 2`);
    // the rest of the line goes just before the cut: the last hat at least 0.05 s before it, so the card of the last
    // syllable has hovered a step with its glyph on it when it starts to fall
    const lyricEnd = this.ctx.audio.events('hat', this.cut - 0.15, this.cut - 0.05).map(([t]) => t).at(-1) ?? this.cut - 0.1;
    // the last beat of epigone: the last kick before the cut (the kick on the cut is already last's)
    const beat = waves.at(-1)!;
    for (let iy = 0; iy < ROWS; iy++) {
      for (let ix = 0; ix < COLS; ix++) {
        const i = iy * COLS + ix;
        // the lower rows tend to go first
        const score = 0.6 * hash(i, 1) + 0.4 * (1 - (iy + 0.5) / ROWS);
        const late = REST.some((r) => hits(ix, iy, r));
        const keep = late || hits(ix, iy, STAMPS);
        const lift = late ? lyricEnd : keep ? beat : waves[Math.min(waves.length - 1, Math.floor(score * waves.length))]!;
        this.tiles.push({
          cx: (ix + 0.5) * TW, cy: (iy + 0.5) * TH, lift, fall: lift + HOVER / FPS, keep,
          // the cards of the sung text fall nearly straight, so they do not cross the first stamps of last
          vx: (hash(i, 3) - 0.5) * (keep ? 100 : 420), vy: -150 - 250 * hash(i, 2),
          r0: (hash(i, 4) - 0.5) * 0.08, spin: (hash(i, 5) - 0.5) * 3.6,
        });
      }
    }
    // the kick chimeras of epigone: the kicks of its list, with the hold of kickers() in epigone.ts
    const ks = this.ctx.audio.events('kick', this.ctx.audio.timeOfBeat(pr.epigone) - 1, this.cut + 1).map(([t]) => t);
    ks.forEach((tk, k) => {
      // the kicks of epigone only: the kick on the cut is already last's
      if (tk < this.cut - WAVES_FROM - 1 || tk >= this.cut) return;
      this.kicked.push({ k, tk, hold: clamp((ks[k + 1] ?? tk + 0.6) - tk - 0.12, 0.12, 0.4) });
    });
    this.l61 = lineNo(this.ctx.lyrics, 61).start;

    this.mask = new THREE.DataTexture(new Uint8Array(COLS * ROWS * 4), COLS, ROWS, THREE.RGBAFormat);
    this.mask.minFilter = this.mask.magFilter = THREE.NearestFilter;
    this.mask.needsUpdate = true;
    this.pass = new FSPass(FRAG_BASE, {
      src: { value: null }, dst: { value: null }, mask: { value: this.mask },
      uGrid: { value: new THREE.Vector2(COLS, ROWS) }, ...this.strips,
    });

    this.keep = new FSPass(FRAG_KEEP, {
      src: { value: null }, mask: { value: this.mask }, uGrid: { value: new THREE.Vector2(COLS, ROWS) },
    }, { transparent: true, blending: THREE.NormalBlending });
    this.over = new FSPass(FRAG_OVER, { ov: { value: this.ov.texture } }, { transparent: true, blending: THREE.NormalBlending });

    // the cards: shadows under, tiles over, in pixel coordinates (y down)
    const N = COLS * ROWS;
    this.tileMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG_TILE,
      uniforms: { src: { value: null }, uTile: { value: new THREE.Vector2(TW, TH) }, ...this.strips },
      // double sided: the camera is flipped in y, which mirrors the winding
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const shadowMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG_SHADOW,
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    this.rects = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    this.lifts = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    this.shadowLifts = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    for (let iy = 0; iy < ROWS; iy++) {
      for (let ix = 0; ix < COLS; ix++) {
        // texture coordinates of the tile: left, top, right, bottom (v runs up in the texture)
        this.rects.setXYZW(iy * COLS + ix, ix / COLS, 1 - iy / ROWS, (ix + 1) / COLS, 1 - (iy + 1) / ROWS);
      }
    }
    const mk = (mat: THREE.Material, lifts: THREE.InstancedBufferAttribute, order: number) => {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.setAttribute('aRect', this.rects);
      geo.setAttribute('aLift', lifts);
      const mesh = new THREE.InstancedMesh(geo, mat, N);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.scene.add(mesh);
      return mesh;
    };
    this.shadows = mk(shadowMat, this.shadowLifts, 0);
    this.cards = mk(this.tileMat, this.lifts, 1);

    // epigone on the cut and last's first page, rendered once from the engine's loaded clips
    await Promise.all([this.ctx.ensureClip('epigone'), this.ctx.ensureClip('last')]);
    this.ctx.renderClip('epigone', this.cut - 1 / 60, this.shot);
    this.frozen = this.chimeras(this.cut - 1 / 60, this.ctx.audio.sample(this.cut - 1 / 60).bass ?? 0).flatMap((c) => c.boxes);
    this.ctx.renderClip('last', this.cut, this.next);
    // compile the passes now: on the first frame of the transition they would stall it
    const tiny = new THREE.WebGLRenderTarget(1, 1);
    this.pass.render(this.ctx.renderer, tiny);
    this.keep.render(this.ctx.renderer, tiny);
    this.over.render(this.ctx.renderer, tiny);
    this.ctx.renderer.setRenderTarget(tiny);
    this.ctx.renderer.render(this.scene, this.cam);
    tiny.dispose();
  }

  /** Sets the pose of tile i at time t on the card and shadow meshes; false when it is not on the frame. */
  private pose(i: number, t: number): boolean {
    const k = this.tiles[i]!;
    const hide = () => { this.cards.setMatrixAt(i, this.zero); this.shadows.setMatrixAt(i, this.zero); this.lifts.setX(i, 0); this.shadowLifts.setX(i, 0); };
    const ts = stepN(t, FPS);
    if (ts / FPS < k.lift) { hide(); return false; }
    const a = ts - stepN(k.lift, FPS, 0);
    let x = k.cx, y = k.cy, rot = 0, sc = 1;
    if (a < HOVER) {
      // stamped up: oversize on the first step, then a size up and a tilt
      sc = a === 0 ? 1.16 : 1.1;
      rot = k.r0 * (a === 0 ? 0.5 : 1);
    } else {
      const dt = (ts - stepN(k.fall, FPS, 0)) / FPS;
      x += k.vx * dt;
      y += k.vy * dt + 0.5 * GRAVITY * dt * dt;
      rot = k.r0 + k.spin * dt;
      sc = 1.1;
      if (y - TH > H + 100) { hide(); return false; }
    }
    this.q.setFromAxisAngle(this.v.set(0, 0, 1), rot);
    this.v.set(x, y, 0);
    this.s.set(TW * sc, TH * sc, 1);
    this.cards.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
    this.v.set(x + 8, y + 14, 0);
    this.s.set(TW * sc * 1.06, TH * sc * 1.06, 1);
    this.shadows.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
    this.lifts.setX(i, 1);
    this.shadowLifts.setX(i, 1);
    return true;
  }

  /**
   * The kick chimeras of epigone as epigone draws them at t (kickers() in epigone.ts, the page without red), with the
   * boxes that cover their ink: a box for each half, on its pose.
   */
  private chimeras(t: number, bass: number): Chim[] {
    const ts = stepN(t, FPS) / FPS;
    const out: Chim[] = [];
    for (const { k, tk, hold } of this.kicked) {
      if (ts < tk - ASM || ts >= tk + hold + FLY) continue;
      const g = chimera(KICK_SEED, k);
      const size = (150 + hash(k, 2) * 80) * (1 + 0.3 * bass);
      const x = k % 2 ? W - 170 - hash(k, 3) * 50 : 170 + hash(k, 3) * 50;
      let y = 200 + hash(k, 4) * 680;
      // the row of line 61 (epigone: band) is kept free, pinned by tk
      const band: [number, number] | null = tk >= this.l61 ? [280, 740] : null;
      if (band && y > band[0] - size / 2 && y < band[1] + size / 2) {
        y = hash(k, 6) < 0.5 || band[1] + size / 2 > H - 120 ? Math.max(130, band[0] - size / 2) : band[1] + size / 2;
      }
      const [ax, ay] = g.mode === 'lr' ? [1, 0] : [0, 1];
      const w = hash(k, 5) < 0.5 ? 500 : 800;
      let pa: HalfPose = [0, 0, 0], pb: HalfPose = [0, 0, 0];
      let s = size;
      if (ts < tk) {
        const q = (ts - (tk - ASM)) / ASM;
        const off = (1 - q) * (1 - q) * size * 0.9;
        pa = [-ax * off, -ay * off, -(1 - q) * 0.35];
        pb = [ax * off, ay * off, (1 - q) * 0.35];
      } else if (ts < tk + hold) {
        if (ts - tk < STEP) s = size * 1.14;
      } else {
        const q = (ts - tk - hold) / FLY;
        const sp = size * 1.1 * q;
        pa = [-ax * sp - ay * size * 0.3 * q, q * q * size * 1.6, -q * 0.9];
        pb = [ax * sp + ay * size * 0.3 * q, q * q * size * 2, q * 1.1];
      }
      const r = 0.85 * size + 14;
      const box = (p: HalfPose): Rect => [x + p[0] - r, y + p[1] - r, x + p[0] + r, y + p[1] + r];
      out.push({ g, x, y, s, w, pa, pb, boxes: [box(pa), box(pb)] });
    }
    return out;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    if (!f.under) throw new Error('peel: nothing under the transition');
    const r = this.ctx.renderer;
    const u = this.pass.u;
    const after = f.t >= this.cut;
    const src = after ? this.shot.texture : f.under;
    u.src!.value = src;
    u.dst!.value = after ? f.under : this.next.texture;
    const data = this.mask.image.data as Uint8Array;
    data.fill(0);
    let any = false;
    const ts = stepN(f.t, FPS) / FPS;
    this.tiles.forEach((k, i) => {
      if (ts >= k.lift) { data[i * 4] = 255; any = true; }
      else if (k.keep) data[i * 4 + 1] = 255;
    });
    this.mask.needsUpdate = true;

    // the chimeras are taken off the page of epigone (where they are now and, after the cut, where they stood on it)
    // and drawn again on top of everything
    const live = this.chimeras(f.t, f.a.bass ?? 0);
    const boxes = live.flatMap((c) => c.boxes);
    if (after) boxes.push(...this.frozen);
    const n = Math.min(boxes.length, MAX_BOXES);
    this.strips.uN.value = n;
    for (let i = 0; i < n; i++) this.strips.uRect.value[i]!.set(...boxes[i]!);

    this.pass.render(r, out);
    if (any) {
      this.tileMat.uniforms.src!.value = src;
      for (let i = 0; i < this.tiles.length; i++) this.pose(i, f.t);
      this.cards.instanceMatrix.needsUpdate = true;
      this.shadows.instanceMatrix.needsUpdate = true;
      this.lifts.needsUpdate = true;
      this.shadowLifts.needsUpdate = true;
      r.setRenderTarget(out);
      r.render(this.scene, this.cam);
      // the sung text stays on top of everything that falls
      this.keep.u.src!.value = src;
      this.keep.render(r, out);
    }
    if (live.length) {
      this.ov.clear();
      this.ov.ctx.fillStyle = INK;
      for (const c of live) drawSplit(this.ov.ctx, c.g, c.x, c.y, c.s, c.w, c.pa, c.pb);
      this.ov.upload();
      this.over.render(r, out);
    }
    return POST;
  }

  override dispose() {
    this.pass.dispose();
    this.keep.dispose();
    this.over.dispose();
    this.ov.dispose();
    this.next.dispose();
    this.shot.dispose();
    this.mask.dispose();
    this.cards.geometry.dispose();
    this.shadows.geometry.dispose();
    this.tileMat.dispose();
  }
}
