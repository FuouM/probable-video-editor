// Copy transition plate 0 → 1 (video.json `transitions`, id feed), "glyphs become type". An Over transition: it
// draws over the clips (`f.under`: the manuscript before the cut, the typewriter after it). The typewriter page of
// plate 1 (the tray, the blank original and its carbons) already lies under the manuscript: the transition renders
// it once, as plate 1 shows it on the cut (carbons.ts), and the manuscript slides up off it.
//   失 and 敬 (line 3): the typebar strikes each in Mincho over the brush (original.ts). Each strike knocks a random
//     half of the brush glyphs loose (feed-plan.ts): they hop off the page (stepped, 24 fps), cast a shadow and
//     hang a little above it, a pale impression left where they lay.
//   After 敬 the platen comes in at the top of the frame and pulls the manuscript up into the machine, off the
//     typewriter page under it (the red rubrics and the typed 失敬 go with it). The loose glyphs stay in the air.
//   The glyphs rise at the camera, turn over (24 fps) and show their back: a bar of type metal with the glyph
//     cast in reversed Mincho. They arc to the glyph tray of plate 1 and drop into their cells in volleys, one
//     volley on each of the first three kicks of the hook. The first volley lands on the cut (the kick of the
//     downbeat). Until its slug lands, a cell of the tray is an empty slot.
//     Slugs that wait for a later kick hang over the tray (the hats jog them) and stay clear of the sheets.
// Params `look`: the look of plate 0 (as its clip), `at`: the resolved cut.
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { FSPass, H, Layer2D, makeRT, SCALE, W } from '@pve/engine/gl';
import { lineNo, units } from '@pve/engine/lyrics';
import { hash, stepN } from '@pve/engine/util';
import { fnt, SERIF, tone } from './_page';
import { manuscriptPage } from './original';
import { popTimes, strikes, type Ink } from './feed-plan';
import { Tray, TRAY_BOX, type TrayCell } from './carbons-tray';
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeIn = (x: number) => x * x;
const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
const smooth = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** px: the height of the platen band at the top of the frame. */
const PL = 118;
/** s: the fall of a slug from its hold into its cell. */
const DROP = 0.17;
/** s: the landing (squash, specks) after the kick. */
const LAND = 0.13;
/** The ink of the manuscript (as the manuscript surface prints it). */
const INKC = 'rgb(34,22,14)';
/** The iron of an empty slot of the tray (tone 0.06 as the typewriter surface prints it). */
const SLOT = 'rgb(30,29,27)';
const CX = W / 2, CY = H / 2;
/** px: the width of the strip over the tray where every slug is from the cut on (slugs, specks and slots). */
const TW = 720;

interface Fly {
  g: Ink;
  pop: number;
  /** When it leaves its hover over the page. */
  lift: number;
  /** The kick it lands on, and its volley (0..2). */
  land: number;
  v: number;
  cell: TrayCell;
  /** Hold above the tray, and its height there. */
  hx: number;
  hy: number;
  zh: number;
  /** Peak height of the arc, turn in the plane in flight, the tilt the knock gives it, hashes. */
  zpk: number;
  spin: number;
  knock: number;
  h: number;
  front: HTMLCanvasElement;
  shade: HTMLCanvasElement;
}

const FRAG = /* glsl */ `
uniform sampler2D under;
uniform sampler2D layer; // before the cut: the slugs over the whole frame at 0.6 px
uniform sampler2D strip; // the tray strip x < TW at full px: before the cut its empty slots, from the cut the slugs
uniform sampler2D below; // before the cut: the typewriter page of plate 1 under the manuscript
uniform float uEdge;   // px the old page has moved up (before the cut)
uniform float uCut;    // 1 from the cut
uniform float uPlaten; // canvas px: the platen's lower edge (0: out of the frame)
const vec2 RES = vec2(1920.0, 1080.0);
const float PL = ${PL.toFixed(1)};
const float TW = ${TW.toFixed(1)};
vec3 U(vec2 p) { return texture(under, clamp(p, vec2(0.5), RES - 0.5) / RES).rgb; }
// the black rubber platen, v 0 (top) .. 1 (its lower edge): a lit band, a dark core, the paper bail rod
vec3 platen(vec2 p, float v) {
  float shade = 0.03 + 0.10 * pow(sin(3.14159 * v), 6.0) + 0.05 * smoothstep(0.55, 0.62, v) * (1.0 - smoothstep(0.62, 0.7, v));
  vec3 c = vec3(shade + 0.01 * hash12(floor(p / 2.0)));
  c = mix(c, vec3(0.62), step(0.84, v) * (1.0 - step(0.88, v)));
  return toLinear(c);
}
void main() {
  vec2 q = FRAG_PX;
  vec3 col;
  if (uCut < 0.5) {
    // the manuscript, pulled up by uEdge; under its lower edge the typewriter page (its empty slots on the strip),
    // with a hard shadow line under the edge
    float y = q.y - uEdge;
    if (y >= 0.0) col = U(vec2(q.x, y));
    else {
      col = texture(below, q / RES).rgb;
      vec4 S = q.x < TW ? texture(strip, vec2(q.x / TW, q.y / RES.y)) : vec4(0.0);
      col = mix(col, S.rgb, S.a) * (y > -5.0 ? 0.55 : 1.0);
    }
  } else col = U(q);
  float v = (q.y - (RES.y - uPlaten)) / PL;
  if (uPlaten > 0.0 && v >= 0.0) col = platen(q, 1.0 - v);
  vec4 L = uCut < 0.5 ? texture(layer, q / RES) : q.x < TW ? texture(strip, vec2(q.x / TW, q.y / RES.y)) : vec4(0.0);
  col = mix(col, L.rgb, L.a);
  fragColor = vec4(col, 1.0);
}`;

export default class Feed extends Scene {
  override handlesTransition = true;
  private pass!: FSPass;
  /**
   * The slugs' layers. Before the cut they fly over the whole frame: a layer at 0.6 of the output px (a full one
   * and its upload miss the 33 ms budget). From the cut they are all over the tray: a strip at full px.
   */
  private layer = new Layer2D(W, H, SCALE * 0.6);
  private strip = new Layer2D(TW, H);
  /** The typewriter page of plate 1 as it shows on the cut: it lies under the manuscript. */
  private below = makeRT();
  /** The strip holds the empty slots of the time before the cut (none has landed then): drawn once. */
  private stripPre = false;
  private flies: Fly[] = [];
  private tray!: Tray;
  private back = new Map<string, HTMLCanvasElement>();
  private t1 = 0;
  private t2 = 0;
  private cut = 0;
  private kicks: number[] = [];

  override async init() {
    const pr = this.ctx.params;
    if (typeof pr.at !== 'number') throw new Error('feed: no resolved at');
    const L = this.ctx.lyrics;
    this.cut = pr.at;
    [this.t1, this.t2] = strikes(L);
    this.kicks = this.ctx.audio.events('kick', this.cut - 0.06, this.cut + 1.3).map(([t]) => t).slice(0, 3);
    if (this.kicks.length < 3) throw new Error(`feed: ${this.kicks.length} kicks after the cut, need 3`);
    if (!(this.t2 < this.cut && this.kicks[0]! >= this.cut - 0.06)) throw new Error('feed: 敬 is not before the cut');
    const { page } = await manuscriptPage(L, pr.look ?? 'illuminated', this.ctx.assets);
    this.tray = new Tray(L, TRAY_BOX);
    const s = this.tray.s;
    // the faces plate 1 strikes in its first lines: a slug must be in its cell before the selector takes it
    const struck: { cell: TrayCell; t: number }[] = [];
    for (const i of [4, 5, 6]) for (const u of units(lineNo(L, i))) struck.push({ cell: this.tray.cellOf(u.glyph), t: u.start });
    const pops = popTimes(L, page.ink);
    page.ink.forEach((g, i) => {
      const pop = pops[i]!;
      if (!Number.isFinite(pop)) return;
      const h = hash(i, 41), h2 = hash(i, 43), h3 = hash(i, 47);
      const cell = this.tray.cellOf(g.ch);
      // set A (on 失) lands on the cut, set B on one of the next two kicks
      const v = pop === this.t1 ? 0 : h < 0.55 ? 1 : 2;
      if (struck.some((st) => st.cell === cell && st.t < this.kicks[v]! + LAND)) throw new Error(`feed: plate 1 strikes ${g.ch} before its slug lands`);
      const lift = pop === this.t1 ? this.t1 + 0.2 + 0.14 * h2 : this.t2 + 0.06 + 0.06 * h2;
      const [front, shade] = this.sprites(g);
      this.flies.push({
        g, pop, lift, land: this.kicks[v]!, v, cell,
        hx: cell.x + (h2 - 0.5) * 60, hy: cell.y - 30 - 70 * h3, zh: 0.35 + 0.3 * h3,
        zpk: 0.7 + 0.5 * h, spin: (h3 - 0.5) * 1.6, knock: (hash(i, 53) - 0.5) * 0.7, h, front, shade,
      });
      if (!this.back.has(g.ch)) this.back.set(g.ch, this.slug(g.ch, s));
    });
    this.pass = new FSPass(FRAG, {
      under: { value: null }, layer: { value: this.layer.texture }, strip: { value: this.strip.texture }, below: { value: this.below.texture },
      uEdge: { value: 0 }, uCut: { value: 0 }, uPlaten: { value: 0 },
    });
    // the page under the manuscript: plate 1 itself on its first frame (nothing is struck yet), rendered once
    await this.ctx.ensureClip('carbons');
    this.ctx.renderClip('carbons', this.cut, this.below);
    const tiny = new THREE.WebGLRenderTarget(1, 1);
    this.pass.u.under!.value = this.strip.upload();
    this.layer.upload();
    for (const cut of [0, 1]) {
      this.pass.u.uCut!.value = cut;
      this.pass.render(this.ctx.renderer, tiny);
    }
    tiny.dispose();
  }

  /** The brush glyph as it lay on the page (ink), and its shadow (black), at 2 px per page px (1.2 for 愛). */
  private sprites(g: Ink): [HTMLCanvasElement, HTMLCanvasElement] {
    const r = g.em > 100 ? 1.2 : 2;
    const box = g.em * 1.3;
    const n = Math.ceil(box * r);
    const mk = (fill: string) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = n;
      const c = cv.getContext('2d', { willReadFrequently: true })!;
      c.setTransform(r, 0, 0, r, -r * (g.x - box / 2), -r * (g.y - box / 2));
      c.fillStyle = fill;
      for (const st of g.strokes) c.fill(st.full);
      return cv;
    };
    return [mk(INKC), mk('#000')];
  }

  /**
   * The slug's face from above, not yet reversed (the turn reverses it): a bar of type metal, bevelled, with the
   * glyph cast in Mincho in the proportions of the tray (bar s-4, face 0.66 s).
   */
  private slug(ch: string, s: number): HTMLCanvasElement {
    const n = 96;
    const cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.fillStyle = tone(0.6);
    c.fillRect(0, 0, n, n);
    c.fillStyle = tone(0.8);
    c.fillRect(0, 0, n, 4);
    c.fillRect(0, 0, 4, n);
    c.fillStyle = tone(0.38);
    c.fillRect(0, n - 4, n, 4);
    c.fillRect(n - 4, 0, 4, n);
    c.fillStyle = tone(0.16);
    c.font = fnt(SERIF, Math.round((n * 0.66 * s) / (s - 4)), 500);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(ch, n / 2, n / 2);
    return cv;
  }

  /**
   * Where a slug is at t: page position (before the projection), height z (0 on the page/tray, 1 near the
   * camera), the page-px size of its em box, the turn (0 brush up .. π metal up) and the turn in the plane.
   */
  private at(fl: Fly, t: number, hat: number): { x: number; y: number; z: number; size: number; flip: number; rot: number } | null {
    const s = this.tray.s;
    const { g } = fl;
    if (t < fl.pop || t >= fl.land + LAND) return null;
    if (t >= fl.land) return { x: fl.cell.x, y: fl.cell.y, z: 0, size: s, flip: Math.PI, rot: 0 };
    if (t < fl.lift) {
      // knocked loose: a hop at the camera in 24 fps steps, tilted by the knock, then it hangs above the page,
      // jittering at 12 fps
      const k = stepN(t - fl.pop, 24);
      const j = stepN(t, 12);
      const z = k < 4 ? [0.6, 0.45, 0.33, 0.27][k]! : 0.24 + 0.04 * hash(j, fl.h * 977);
      const rot = fl.knock * Math.min(1, (k + 1) / 2) + (hash(j, fl.h * 41) - 0.5) * 0.06;
      return { x: g.x + (hash(j, fl.h * 31) - 0.5) * 3, y: g.y + (hash(j, fl.h * 37) - 0.5) * 3, z, size: g.em, flip: 0, rot };
    }
    // the flight: an arc from the page to the hold over the tray, rising at the camera and turning over
    // (every slug is over the tray by the cut: from the cut on the strip layer holds them all)
    const arrive = fl.v === 0 ? fl.land - DROP : this.cut - 0.02;
    const drop = fl.land - DROP;
    if (t < arrive) {
      const u = clamp01((t - fl.lift) / (arrive - fl.lift));
      const e = smooth(u);
      const mx = (g.x + fl.hx) / 2, my = Math.max(135, Math.min(g.y, fl.hy) - 65 - 110 * fl.h);
      const x = (1 - e) * (1 - e) * g.x + 2 * (1 - e) * e * mx + e * e * fl.hx;
      const y = (1 - e) * (1 - e) * g.y + 2 * (1 - e) * e * my + e * e * fl.hy;
      const z = lerp(0.25, fl.zh, e) + fl.zpk * Math.sin(Math.PI * e) * 0.7;
      const fu = clamp01((stepN(t, 24) / 24 - fl.lift) / (arrive - fl.lift));
      const flip = Math.PI * smooth(clamp01((fu - 0.1) / 0.5));
      return { x, y, z, size: lerp(g.em, s, smooth(clamp01(u * 1.3))), flip, rot: fl.spin * Math.sin(Math.PI * e) + fl.knock * (1 - e) };
    }
    if (t < drop) {
      // hanging over the tray for its kick: a slow sway at 12 fps, the hats jog it up
      const j = stepN(t, 12);
      return { x: fl.hx + (hash(j, fl.h * 53) - 0.5) * 6, y: fl.hy + (hash(j, fl.h * 59) - 0.5) * 6, z: fl.zh + 0.18 * hat, size: s, flip: Math.PI, rot: (hash(j, fl.h * 61) - 0.5) * 0.12 };
    }
    // the drop: straight down into the cell, faster and faster
    const u = clamp01((t - drop) / DROP);
    return { x: lerp(fl.hx, fl.cell.x, smooth(u)), y: lerp(fl.hy, fl.cell.y, smooth(u)), z: fl.zh * (1 - easeIn(u)), size: s, flip: Math.PI, rot: fl.spin * 0.2 * (1 - u) };
  }

  /** The empty slots of the tray: a cell is empty until its slug is in. */
  private slots(c: CanvasRenderingContext2D, t: number) {
    const s = this.tray.s;
    c.fillStyle = SLOT;
    for (const fl of this.flies) {
      if (t >= fl.land) continue;
      c.fillRect(Math.round(fl.cell.x - s / 2 + 2), Math.round(fl.cell.y - s / 2 + 2), s - 4, s - 4);
    }
  }

  private drawLayer(c: CanvasRenderingContext2D, f: Frame) {
    const t = f.t;
    const s = this.tray.s;
    if (t >= this.cut) this.slots(c, t);
    const live: { fl: Fly; x: number; y: number; z: number; size: number; flip: number; rot: number }[] = [];
    for (const fl of this.flies) {
      const p = this.at(fl, t, f.a.hat);
      if (p) live.push({ fl, ...p });
    }
    live.sort((a, b) => a.z - b.z);
    // shadows on the page and the desk (light from the top left), hard edged; none from high up (they fall far)
    for (const p of live) {
      if (p.z < 0.01 || p.z > 0.9) continue;
      const cos = Math.cos(p.flip);
      c.save();
      c.globalAlpha = Math.max(0.1, 0.22 - 0.1 * p.z);
      c.translate(p.x + 45 * p.z, p.y + 60 * p.z);
      c.rotate(p.rot);
      c.scale(Math.max(0.08, Math.abs(cos)), 1);
      if (cos > 0) {
        const n = p.size * 1.3;
        c.drawImage(p.fl.shade, -n / 2, -n / 2, n, n);
      } else {
        c.fillStyle = '#000';
        const b = p.size * (s - 4) / s;
        c.fillRect(-b / 2, -b / 2, b, b);
      }
      c.restore();
    }
    for (const p of live) this.drawSlug(c, p, t);
  }

  private drawSlug(c: CanvasRenderingContext2D, p: { fl: Fly; x: number; y: number; z: number; size: number; flip: number; rot: number }, t: number) {
    const s = this.tray.s;
    // perspective: up at the camera is bigger and further from the centre
    const k = 1 + 1.25 * p.z;
    const sx = CX + (p.x - CX) * (1 + 0.1 * p.z), sy = CY + (p.y - CY) * (1 + 0.1 * p.z);
    let a = p.size * k;
    let since = -1;
    if (t >= p.fl.land) {
      // the landing: a squash in 30 fps steps, specks of type metal thrown out of the cell (24 fps)
      since = t - p.fl.land;
      a *= [1.3, 0.9, 1.06, 1][Math.min(3, stepN(since, 30))]!;
      const ks = stepN(since, 24) / 24;
      c.fillStyle = tone(0.3);
      for (let i = 0; i < 6; i++) {
        const ang = hash(i, p.fl.h * 71) * Math.PI * 2, d = s * 0.6 + ks * (90 + 70 * hash(i, p.fl.h * 73));
        c.fillRect(Math.round(sx + Math.cos(ang) * d), Math.round(sy + Math.sin(ang) * d), 3, 3);
      }
    }
    const cos = Math.cos(p.flip);
    c.save();
    c.translate(sx, sy);
    c.rotate(p.rot);
    if (Math.abs(cos) < 0.14) {
      // edge on: the side of the bar
      c.fillStyle = tone(0.42);
      c.fillRect(-a * 0.07, -a / 2, a * 0.14, a);
      c.restore();
      return;
    }
    if (cos > 0) {
      c.scale(cos, 1);
      const n = a * 1.3;
      c.drawImage(p.fl.front, -n / 2, -n / 2, n, n);
      c.restore();
      return;
    }
    const b = a * (s - 4) / s;
    // the body of the bar below the face, seen in perspective: toward the centre of the frame
    if (p.z > 0.04) {
      const len = Math.hypot(CX - sx, CY - sy) || 1, step = b * 0.3 * Math.min(1, p.z * 2.5);
      c.save();
      c.rotate(-p.rot);
      c.translate(((CX - sx) / len) * step, ((CY - sy) / len) * step);
      c.rotate(p.rot);
      c.scale(-cos, 1); // cos < 0 here: the width of the turned bar
      c.fillStyle = tone(0.36);
      c.fillRect(-b / 2, -b / 2, b, b);
      c.restore();
    }
    // the face, reversed by the turn
    c.scale(cos, 1);
    c.drawImage(this.back.get(p.fl.g.ch)!, -b / 2, -b / 2, b, b);
    c.restore();
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    if (!f.under) throw new Error('feed: nothing under the transition');
    const t = f.t, u = this.pass.u;
    if (t < this.cut) {
      if (!this.stripPre) {
        this.strip.clear();
        this.slots(this.strip.ctx, t);
        this.strip.upload();
        this.stripPre = true;
      }
    } else this.stripPre = false;
    const L = t < this.cut ? this.layer : this.strip;
    L.clear();
    this.drawLayer(L.ctx, f);
    L.upload();
    u.under!.value = f.under;
    // the platen comes in after 敬 and pulls the page up by the cut; it goes back up out of the frame after it
    const y0 = this.t2 + 0.06;
    u.uCut!.value = t >= this.cut ? 1 : 0;
    u.uEdge!.value = t < this.cut ? easeIn(clamp01((t - y0) / (this.cut - y0))) * (H + 10) : 0;
    u.uPlaten!.value = t < this.cut ? PL * easeOut(clamp01((t - this.t2) / 0.1)) : PL * (1 - easeIn(clamp01((t - this.cut) / 0.14)));
    this.pass.render(this.ctx.renderer, out);
  }

  override dispose() {
    this.pass.dispose();
    this.layer.dispose();
    this.strip.dispose();
    this.below.dispose();
  }
}
