// The page of god_ish (treatment.md): every plate draws one clean page in Canvas2D, and the surface pass prints
// it in the material of its era. The canvas is a code, not a picture:
//   alpha 0          a hole in the page: the red substrate shows (rule "Red")
//   pure red #ff0000 red ink (rubric, a seal drawn in ink)
//   gray (r = g = b) tone: 0 = ink, 1 = the era's paper; between = the era's way of printing a gray
//   magenta #ff00ff  the dye of the carbon paper (typewriter era only: it prints blue-violet; other eras do not
//                    read it, do not draw it there)
// The surface pass never sees vector edges as such: the era decides how ink sits on its paper.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '@pve/engine/scene';
import { FSPass, H, Layer2D, makeCanvas, makeRT, W } from '@pve/engine/gl';
import { marks, pushMarks, type Mark } from '@pve/engine/marks';
import { F, font } from '@pve/engine/type';
import { stepN } from '@pve/engine/util';
import { lineNo, syllables, units, type Lyrics } from '@pve/engine/lyrics';
import { Jpeg } from '@pve/engine/jpeg';

// ---------- canvas codes ----------
export const INK = '#000000';
export const PAPER = '#ffffff';
export const RED = '#ff0000';
/** The carbon dye (typewriter era): prints blue-violet. */
export const DYE = '#ff00ff';
/** A gray of tone v (0 ink .. 1 paper). */
export const tone = (v: number, a = 1) => {
  const c = Math.round(255 * Math.max(0, Math.min(1, v)));
  return `rgba(${c},${c},${c},${a})`;
};

/** No engine post on top: the surface pass is the look. */
export const POST: PostOverrides = { bloom: 0, halation: 0, ca: 0, vignette: 0, grain: 0 };

// ---------- type ----------
/** Noto Serif JP (Mincho), Noto Sans JP (Gothic), UnifrakturMaguntia: all OFL, subset to the song (video/assets/type). */
export const SERIF = 'GodSerif';
export const SANS = 'GodSans';
/** The big English type: the calls and the title. Always Fraktur. */
export const FRAKTUR = 'GodFraktur';
/** The small English type: the glosses and the credit roles. Fraktur in the film; the player may switch it (video/player.ts). */
export const GLOSS = 'GodGloss';
export const MONO = F.mono(400);

/** The faces GLOSS can show, OFL: UnifrakturMaguntia, Pirata One (a plain blackletter), IM Fell English (old press type). */
export const GLOSS_FACES = {
  fraktur: { label: 'Fraktur', file: 'UnifrakturMaguntia.ttf' },
  pirata: { label: 'Pirata One', file: 'PirataOne.ttf' },
  fell: { label: 'IM Fell English', file: 'IMFellEnglish.ttf' },
} as const;
export type GlossFace = keyof typeof GLOSS_FACES;

let glossId: GlossFace = 'fraktur';
let glossFace: FontFace | null = null;
/** Makes `id` the face of GLOSS: a scene that draws after this uses it, one that measured the old face at init must load again. */
export async function setGlossFace(assets: string, id: GlossFace): Promise<void> {
  glossId = id;
  const face = new FontFace(GLOSS, `url(${assets}type/${GLOSS_FACES[id].file})`);
  document.fonts.add(await face.load());
  if (glossFace) document.fonts.delete(glossFace);
  glossFace = face;
}

let typeLoaded: Promise<void> | null = null;
export function loadType(assets: string): Promise<void> {
  typeLoaded ??= (async () => {
    const faces = [
      new FontFace(SERIF, `url(${assets}type/NotoSerifJP.woff2)`, { weight: '200 900' }),
      new FontFace(SANS, `url(${assets}type/NotoSansJP.woff2)`, { weight: '100 900' }),
      new FontFace(FRAKTUR, `url(${assets}type/UnifrakturMaguntia.ttf)`),
    ];
    for (const f of faces) document.fonts.add(await f.load());
    // the player may have chosen the face already, before the first scene
    if (!glossFace) await setGlossFace(assets, glossId);
  })();
  return typeLoaded;
}
/** CSS font string. */
export const fnt = (family: string, px: number, weight = 400) => `${weight} ${px}px "${family}"`;

/**
 * The times at which a page that sets lines `ids` can change (see PageScene.changes): the start of each line,
 * unit, syllable and phrase, and `extra` (copies, calls), sorted.
 */
export function changesOf(lyrics: Lyrics, ids: number[], extra: number[] = []): number[] {
  const ts = [...extra];
  for (const i of ids) {
    const l = lineNo(lyrics, i);
    ts.push(l.start, ...units(l).map((u) => u.start), ...syllables(l).map((s) => s.start), ...l.written!.phrases.map((p) => p.start));
  }
  return [...new Set(ts)].sort((a, b) => a - b);
}

// ---------- generations ----------
/**
 * The machine voice: the 8 calls of the yukkuri stem, which are not in the calibrated lyrics. Times are the
 * non-silent spans of user_input/stems/God-ish_vocacolle_stem_yukkuri_oh_my_god.wav (ffmpeg silencedetect,
 * -40 dB, 0.25 s), the same as the markers in video.json.
 */
export const VOICE: { id: string; text: string; start: number; end: number }[] = [
  { id: 'ohmygod', text: 'Oh my God', start: 6.76, end: 7.47 },
  { id: 'gott1', text: 'Gott ist tot', start: 49.87, end: 51.19 },
  { id: 'mygod1', text: 'My God', start: 54.28, end: 54.98 },
  { id: 'mygod2', text: 'My God', start: 61.04, end: 61.74 },
  { id: 'doyouknow', text: 'Do you know?', start: 109.26, end: 109.97 },
  { id: 'gott2', text: 'Gott ist tot', start: 146.3, end: 147.62 },
  { id: 'mygod3', text: 'My God', start: 150.72, end: 151.42 },
  { id: 'mygod4', text: 'My God', start: 157.48, end: 158.19 },
];

/** Lines whose start makes a copy: the hook to the end of post-chorus 2 (4..36) and verse to post-chorus 3 (41..69). The sermon (37..40) holds. */
const COPY_LINES = (i: number) => (i >= 4 && i <= 36) || (i >= 41 && i <= 69);

/**
 * The copy times of the whole video, in order: 失敬 (the end of line 3), the start of each copying line, and
 * each machine-voice call. The outro (from line 70) is the new original: GEN 00 again.
 */
export function copyTimes(lyrics: Lyrics): number[] {
  const l3 = lineNo(lyrics, 3);
  const us = units(l3);
  const out = [us[us.length - 2]!.start];
  for (const l of lyrics.lines) if (COPY_LINES(l.i)) out.push(syllables(l)[0]!.start);
  for (const v of VOICE) if (v.id !== 'ohmygod') out.push(v.start);
  return out.sort((a, b) => a - b);
}
/** When GEN turns to 00: just before the outro (from line 70), the new original. */
export const genReset = (lyrics: Lyrics) => lineNo(lyrics, 70).start - 0.4;
/** GEN at t: the copies made at or before t. 0 from the outro. */
export function genAt(times: number[], lyrics: Lyrics, t: number): number {
  if (t >= genReset(lyrics)) return 0;
  let n = 0;
  for (const c of times) if (c <= t) n++;
  return n;
}

// ---------- small true marks ----------
export const STATUS_Y = H - 34;
export const STATUS_LEFT_X = 64;
export const STATUS_RIGHT_X = W - 64;

/** A 12 px mono label (generation, line, bar). Solid ink on paper. */
export function rebate(c: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign = 'left', fill = INK) {
  c.font = font(MONO, 12);
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.fillStyle = fill;
  c.fillText(text, x, y);
}

/**
 * Standard status line across every scene of god_ish:
 * Left: `GEN xx [· extra]`, Right: `[extra · ]xx.xx s`.
 * Rock-solid at (64, H - 34) and (W - 64, H - 34), never jumping across cuts.
 */
export function statusLine(
  c: CanvasRenderingContext2D,
  gen: number,
  t: number,
  leftExtra = '',
  rightExtra = '',
  fill = INK,
  paperSlip = false,
) {
  const leftText = `GEN ${String(gen).padStart(2, '0')}${leftExtra ? ` · ${leftExtra}` : ''}`;
  const rightText = `${rightExtra ? `${rightExtra} · ` : ''}${t.toFixed(2)} s`;
  if (paperSlip) {
    c.font = font(MONO, 12);
    const lw = c.measureText(leftText).width;
    const rw = c.measureText(rightText).width;
    c.fillStyle = PAPER;
    c.fillRect(STATUS_LEFT_X - 8, STATUS_Y - 11, lw + 16, 22);
    c.fillRect(STATUS_RIGHT_X - rw - 8, STATUS_Y - 11, rw + 16, 22);
  }
  rebate(c, leftText, STATUS_LEFT_X, STATUS_Y, 'left', fill);
  rebate(c, rightText, STATUS_RIGHT_X, STATUS_Y, 'right', fill);
}
// ---------- the round seal ----------
/**
 * The round 神 seal: a ring and the glyph, as holes onto the red (`hole`) or in red ink. r = outer radius.
 * As holes it uses destination-out, so draw it after the page.
 */
export function seal(c: CanvasRenderingContext2D, x: number, y: number, r: number, mode: 'hole' | 'ink', family = SERIF) {
  c.save();
  if (mode === 'hole') c.globalCompositeOperation = 'destination-out';
  c.fillStyle = RED;
  c.strokeStyle = RED;
  c.lineWidth = r * 0.09;
  c.beginPath();
  c.arc(x, y, r * 0.93, 0, Math.PI * 2);
  c.stroke();
  c.font = fnt(family, r * 1.15, 700);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('神', x, y + r * 0.04);
  c.restore();
}

// ---------- the surface pass ----------
/**
 * One era's material: `glsl` defines `vec3 surface(vec2 p, vec2 warp)`, which returns the sRGB colour at logical
 * px `p` (origin bottom left). It reads the page with `tapL(p + warp)` and may use the helpers and uniforms of
 * SURFACE_HEAD. Each era is a file `_era_<name>.ts`.
 */
export interface EraDef {
  name: string;
  /** px of edge wander when the plate does not set it. */
  bleed: number;
  glsl: string;
}

const SURFACE_HEAD = /* glsl */ `
uniform sampler2D src;
uniform float uGen;    // copies since the original (adds the loss of the era)
uniform float uSeed;   // ink boil, 12 fps
uniform float uGrainF; // grain field, 8 fps
uniform float uBleed;  // px of edge wander
uniform float uReg;    // px of misregistration of the red plate
uniform vec4 uP;       // free parameters of the era
const vec2 RES = vec2(1920.0, 1080.0);
// The page texture is uploaded as the canvas holds it (premultiplied, top row first: no flip and no alpha
// division on the CPU, the cheap upload path). pageAt turns it back: flip y, divide alpha in sRGB.
vec4 pageAt(vec2 lp) {
  vec4 c = texture(src, vec2(lp.x, RES.y - lp.y) / RES);
  if (c.a <= 0.0) return vec4(0.0);
  if (c.a >= 1.0) return c;
  return vec4(toLinear(toSRGB(c.rgb) / c.a), c.a);
}
// Second impressions (SurfaceOpts.imp): the sheet prints again over itself, off register by uImpN.xy, inside
// uImpRect (logical px, origin bottom left), as canvas 'darken' does: a hole takes the copy, a hole in the copy
// keeps the page, else the darker of the two. Cut codes on the canvas: pure blue is a hole cut after the first
// impression, cyan a hole cut after the second (so the second impression closes the first cut a little).
uniform vec3 uImp0;
uniform vec3 uImp1;
uniform vec4 uImpRect;
float cutOf(vec4 c) { return c.a > 0.5 && c.r < 0.5 && c.b > 0.5 ? (c.g > 0.5 ? 2.0 : 1.0) : 0.0; }
vec4 dk(vec4 a, vec4 b) {
  if (a.a < 0.5) return b;
  if (b.a < 0.5) return a;
  return vec4(min(a.rgb, b.rgb), 1.0);
}
// the sheet before any impression: a cut is still the paper under it
vec4 imp0(vec2 x) { vec4 c = pageAt(x); return cutOf(c) > 0.0 ? vec4(1.0) : c; }
// after the first impression and its cut
vec4 imp1(vec2 x) {
  if (cutOf(pageAt(x)) == 1.0) return vec4(0.0);
  return dk(imp0(x), imp0(x - uImp0.xy));
}
vec4 tapL(vec2 lp) {
  vec4 c = pageAt(lp);
  if (uImp0.z > 0.5 && lp.x >= uImpRect.x && lp.y >= uImpRect.y && lp.x <= uImpRect.z && lp.y <= uImpRect.w) {
    float cut = cutOf(c);
    if (uImp1.z < 0.5) c = cut > 0.0 ? vec4(0.0) : dk(imp0(lp), imp0(lp - uImp0.xy));
    else c = cut == 2.0 ? vec4(0.0) : dk(imp1(lp), imp1(lp - uImp1.xy));
  }
  return c;
}
float toneOf(vec4 c) { return c.a > 0.0 ? luma(toSRGB(c.rgb)) : 1.0; }
float redOf(vec4 c) { return smoothstep(0.05, 0.55, c.r - max(c.g, c.b)) * clamp(c.a, 0.0, 1.0); }
// colours are mixed in sRGB (as ink on paper looks), then turned linear once at the end
vec3 S(float r, float g, float b) { return vec3(r, g, b) / 255.0; }
vec3 RED() { return toSRGB(C_SIGNAL); }
// the red substrate as pigment
vec3 SUB(vec2 p) { return RED() * (0.92 + 0.08 * fbm(p * 0.004 + 2.0, 3)); }
// sparse 2 px specks, a new field 8 times a second
float GRAIN(vec2 p) { return step(0.9993, hash12(floor(p / 2.0) + uGrainF * 7.31)); }
// coverage contrast around p at radius r: 0 inside a flat area, up to 1 on an edge
float edgeAt(vec2 p, float r) {
  float t0 = toneOf(tapL(p));
  float e = 0.0;
  e = max(e, abs(toneOf(tapL(p + vec2(r, 0.0))) - t0));
  e = max(e, abs(toneOf(tapL(p - vec2(r, 0.0))) - t0));
  e = max(e, abs(toneOf(tapL(p + vec2(0.0, r))) - t0));
  e = max(e, abs(toneOf(tapL(p - vec2(0.0, r))) - t0));
  return e;
}
// the darkest tone within r (darks spread when a copy is made)
float minTone(vec2 p, float r) {
  float m = toneOf(tapL(p));
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    m = min(m, toneOf(tapL(p + r * vec2(cos(a), sin(a)))));
  }
  return m;
}
// 1 where every tap within r is a hole
float holeAt(vec2 p, float r) {
  float h = step(tapL(p).a, 0.5);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    h *= step(tapL(p + r * vec2(cos(a), sin(a))).a, 0.5);
  }
  return h;
}
`;
const SURFACE_MAIN = /* glsl */ `
void main() {
  vec2 p = FRAG_PX;
  float s = uSeed;
  vec2 warp = vec2(fbm(p * 0.03 + vec2(s * 1.7, 3.1), 3), fbm(p * 0.03 + vec2(31.0, s * 1.3), 3)) * uBleed;
  fragColor = vec4(toLinear(clamp(surface(p, warp), 0.0, 1.0)), 1.0);
}`;

export interface SurfaceOpts {
  era: EraDef;
  /** Copies since the original: the era's loss grows with it. */
  gen?: number;
  /** px of edge wander (default: the era's). */
  bleed?: number;
  /** px the red plate is off register. */
  reg?: number;
  /** Free parameters of the era (see its file). */
  p?: [number, number, number, number];
  /** Screen and repost: JPEG re-saves after the surface. */
  jpeg?: { quality: number; passes: number; shift?: [number, number] };
  /**
   * Second impressions (at most 2): the sheet prints again over itself, offset by [dx, dy] canvas px, inside the
   * canvas rect `impRect` [x0, y0, x1, y1]. Holes cut after an impression are drawn in cut codes (see tapL).
   */
  imp?: [number, number][];
  impRect?: [number, number, number, number];
}

/** Canvas code of a hole cut after the first second impression (see SurfaceOpts.imp). */
export const CUT1 = '#0000ff';
/** Canvas code of a hole cut after the second one. */
export const CUT2 = '#00ffff';

/**
 * A plate of god_ish: `draw` lays out the page in canvas codes (see the top of this file) and returns how to
 * print it. The canvas is drawn again only when the 24 fps type step changes; the surface boils at 12 fps.
 * A plate whose page changes only at known times (onsets, copies) lists them in `changes` and draws the marks
 * that change on every step (the running time) in `live`: between two changes the page comes back from a copy
 * and only `live` draws, which saves the whole Canvas2D draw.
 */
export abstract class PageScene extends Scene {
  protected layer = PageScene.pageLayer();

  /** The page canvas: uploaded premultiplied and unflipped (see tapL), which takes about half the CPU time. */
  private static pageLayer(): Layer2D {
    const l = new Layer2D();
    l.texture.flipY = false;
    l.texture.premultiplyAlpha = true;
    return l;
  }
  private surfaces = new Map<string, FSPass>();
  private jpeg: Jpeg | null = null;
  private mid: THREE.WebGLRenderTarget | null = null;
  private lastKey = Number.NaN;
  private lastOpts: SurfaceOpts | null = null;
  private cachedMarks: Mark[] = [];
  /** The times at which the page of `draw` changes, sorted (null: it may change on any step). See `live`. */
  protected changes: number[] | null = null;
  /** Set true when `live()` draws scene content (not only the running time) so every frame redraws `live`. */
  protected continuousLive = false;
  private still: CanvasRenderingContext2D | null = null;
  private shown = -1;
  private hasLive = false;

  /** The marks drawn over the page on every step when `changes` is set (the running time). */
  protected live(_c: CanvasRenderingContext2D, _f: Frame) {}

  /**
   * The free parameters of the era on every frame (30 fps, not the 24 fps step of the page): motion that the
   * surface pass draws, driven by the music (f.a). Default: `p` of the page as `draw` returned it.
   */
  protected react(_f: Frame, o: SurfaceOpts): [number, number, number, number] | undefined {
    return o.p;
  }

  abstract draw(c: CanvasRenderingContext2D, f: Frame): SurfaceOpts;

  override async init() {
    this.hasLive = this.live !== PageScene.prototype.live;
    await loadType(this.ctx.assets);
  }

  /**
   * Compile the surface of each era this plate prints, and the JPEG passes (`jpeg`), at init: each program
   * compiles on its first draw, and a first draw during playback stalls the frame for a second or more. Call it
   * at the end of `init`.
   */
  protected warm(eras: EraDef[], jpeg = false) {
    const r = this.ctx.renderer;
    const tiny = new THREE.WebGLRenderTarget(1, 1);
    this.layer.upload();
    for (const e of eras) {
      const pass = this.surfaceOf(e);
      pass.u.src!.value = this.layer.texture;
      pass.render(r, tiny);
    }
    if (jpeg) {
      this.mid ??= makeRT();
      this.jpeg ??= new Jpeg();
      this.jpeg.render(r, this.mid.texture, tiny, { quality: 50, passes: 2, shift: [3, 5] });
    }
    tiny.dispose();
  }

  private surfaceOf(era: EraDef): FSPass {
    let pass = this.surfaces.get(era.name);
    if (!pass) {
      pass = new FSPass(SURFACE_HEAD + era.glsl + SURFACE_MAIN, {
        src: { value: null }, uGen: { value: 0 }, uSeed: { value: 0 }, uGrainF: { value: 0 },
        uBleed: { value: 1 }, uReg: { value: 0 }, uP: { value: new THREE.Vector4() },
        uImp0: { value: new THREE.Vector3() }, uImp1: { value: new THREE.Vector3() }, uImpRect: { value: new THREE.Vector4() },
      });
      this.surfaces.set(era.name, pass);
    }
    return pass;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const tf = f.ft ?? f.t;
    const key = this.continuousLive ? Math.round(tf * 1000) : stepN(f.t, 24);
    if (key !== this.lastKey || !this.lastOpts) {
      this.lastKey = key;
      const pf = tf === f.t ? f : { ...f, t: tf };
      const ch = this.changes;
      // the changes made by tf
      let n = 0;
      if (ch) for (let lo = 0, hi = ch.length; lo < hi;) {
        const mid = (lo + hi) >> 1;
        if (ch[mid]! <= tf) lo = n = mid + 1;
        else hi = mid;
      }
      if (ch && n === this.shown && this.lastOpts && !this.hasLive) {
        if (this.cachedMarks.length) pushMarks(this.cachedMarks);
      } else {
        const c = this.layer.ctx;
        if (!ch || n !== this.shown || !this.lastOpts) {
          this.shown = n;
          const m0 = marks().length;
          this.layer.clear();
          this.lastOpts = this.draw(c, pf);
          this.cachedMarks = marks().slice(m0);
          if (ch && this.hasLive) {
            if (!this.still) {
              const { c } = makeCanvas(this.layer.w, this.layer.h);
              this.still = c;
              this.still.globalCompositeOperation = 'copy';
            }
            this.still.drawImage(this.layer.canvas, 0, 0);
          }
        } else {
          // the page as drawn: back from the copy, in device px
          c.save();
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.globalCompositeOperation = 'copy';
          c.drawImage(this.still!.canvas, 0, 0);
          c.restore();
          if (this.cachedMarks.length) pushMarks(this.cachedMarks);
        }
        if (ch) this.live(c, pf);
        this.layer.upload();
      }
    } else if (this.cachedMarks.length) pushMarks(this.cachedMarks);
    const o = this.lastOpts;
    const pass = this.surfaceOf(o.era);
    const u = pass.u;
    u.src!.value = this.layer.texture;
    u.uGen!.value = o.gen ?? 0;
    u.uSeed!.value = stepN(f.t, 12) % 997;
    u.uGrainF!.value = stepN(f.t, 8) % 997;
    u.uBleed!.value = o.bleed ?? o.era.bleed;
    u.uReg!.value = o.reg ?? 0;
    (u.uP!.value as THREE.Vector4).fromArray(this.react(f, o) ?? [0, 0, 0, 0]);
    // impressions: canvas px (y down) to the shader's logical px (y up)
    const [i0, i1] = o.imp ?? [];
    (u.uImp0!.value as THREE.Vector3).set(i0?.[0] ?? 0, -(i0?.[1] ?? 0), i0 ? 1 : 0);
    (u.uImp1!.value as THREE.Vector3).set(i1?.[0] ?? 0, -(i1?.[1] ?? 0), i1 ? 1 : 0);
    const ir = o.impRect ?? [0, 0, W, H];
    (u.uImpRect!.value as THREE.Vector4).set(ir[0], H - ir[3], ir[2], H - ir[1]);
    const r = this.ctx.renderer;
    if (o.jpeg) {
      this.mid ??= makeRT();
      this.jpeg ??= new Jpeg();
      pass.render(r, this.mid);
      this.jpeg.render(r, this.mid.texture, out, o.jpeg);
    } else pass.render(r, out);
    return POST;
  }

  override dispose() {
    this.layer.texture.dispose();
    for (const p of this.surfaces.values()) p.dispose();
    this.jpeg?.dispose();
    this.mid?.dispose();
  }
}
