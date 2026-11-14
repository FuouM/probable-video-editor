// The jellyfish as the desktop buddy of 1999 (treatment v9 "The jellyfish", "Plate 8"). It lives at the bottom right of the screen, over
// the interface (`LitView.renderOver`), and it is in the way. This module holds the mechanics. The scene gives it a plan (`BuddyPlan`):
//
//   actors    the jellyfish and its copies. An actor glides from anchor to anchor in a straight line (no hops): a place on the screen,
//             the title bar of a window (it sits on the bar and grips it), or the cursor.
//   carries   it moves a window that it holds; the window hangs and swings a little
//   drops     it lets a window go: the window falls and breaks on the status bar into its parts (the title bar, the button, the bevel
//             edges, the shards of the face, the glyphs of its line). They land, lie there for a beat and drop out of the frame
//   knocks    it knocks on the glass from inside     laughs  it shakes
//   balloon   the `ko` line of the moment in a round yellow balloon above the first actor.
//   offers    a balloon with a row of buttons under its line (the assistant asks). The buttons do nothing.
//   spins     the first actor turns once about itself (idle business)
//   faults    each copy corrupts the program where it sits (`corrupt`, `shownAt`): a window hangs (NOT RESPONDING, its picture stops for
//             the beat), its rows lean, its tiles go to the wrong places, or it leaves trails. The game world stays whole
//   shell     the jellyfish lives on the shell of the desktop. At `kill` the window manager dies: the faults stop and every actor
//             stops where it is. Each actor explodes at `gone(n)` (the scene draws the blast: `blasts`). At `sink` the desktop comes
//             back at once: every window goes but those that the scene keeps, and the cursor drops to the bottom.
//
// A frame depends only on t and on the player state of t. `apply` moves the windows of that state (call it before the rig composes and
// draws them), `draw` writes the 2D parts into the text layer, `render` draws the jellyfish over the interface.
import * as THREE from 'three';
import type { Line } from '@pve/engine/lyrics';
import { smooth, hashSin } from '@pve/engine/util';
import { LH, LW, LitAtlas, ambient, camera, litMaterial, sun } from '@pve/engine/lit';
import type { LitView } from '@pve/engine/litview';
import type { TextLayer } from '@pve/engine/textlayer';
import { SPB, FR } from './_time';
import { lineAt, type Fonts } from './_fonts';
import { printKana } from './_kana';
import { layoutOnce } from './_captionCarriers';
import { Jellyfish, screenPoint } from './_jelly';
import { BORDER, STATUS_H, TITLE_H, contentRect, type PlayerState, type Rect, type Vec2, type WinState } from './_playerTypes';
import { chromeText, chromeWidth } from './_playerChrome';

/** The plane of the overlay, metres in front of its camera, and the metres of one pixel on it (a 30 degree lens). */
const DEPTH = 6;
const MPP = (2 * DEPTH * Math.tan(Math.PI / 12)) / LH;
/** The metres of one pixel on the plane of the jellyfish: a size of `px * BUDDY_MPP / 1.68` is `px` tall. */
export const BUDDY_MPP = MPP;
/** A window falls at this rate (px/s²) until its foot is on the status bar of the maximized window. */
const FALL = 1400;
const FLOOR_Y = LH - 10;
/** From `sink` the cursor drops at this rate (px/s²). */
const DROP = 2600;
/** The parts of a broken window have come to rest by here (s after the hit), lie for a beat, and are out of the frame half a second later. */
const LIE_END = 0.75 + SPB;
/** The cursor drops to this height and lies there (px): chorus 3 starts with it there. */
export const CURSOR_FLOOR = LH - 14;

/** A part that flies from (x, foot) with the speed (vx, vy) px/s, `tau` seconds on: it bounces on the status bar (`e`: how much of its speed a bounce keeps) and comes to rest. Returns its x and the y of its foot. */
function fly(x: number, foot: number, vx: number, vy: number, tau: number, e = 0.35): Vec2 {
  let t = tau, y = foot, v = vy, px = x, sx = vx;
  for (let n = 0; n < 5; n++) {
    // the time to the floor from here
    const h = FLOOR_Y - y;
    const hit = (-v + Math.sqrt(Math.max(0, v * v + 2 * FALL * h))) / FALL;
    if (t < hit) return [px + sx * t, y + v * t + 0.5 * FALL * t * t];
    px += sx * hit;
    t -= hit;
    v = -e * (v + FALL * hit);
    sx *= 0.55;
    y = FLOOR_Y;
    if (Math.abs(v) < 40) break;
  }
  // it slides to a stop
  return [px + sx * 0.25 * (1 - Math.exp(-t / 0.25)), FLOOR_Y];
}

/** Where an actor goes: a point (the rim of its bell, px), the title bar of a window (`u`: the place along the bar, 0..1; `rest`: the window's rectangle when the state does not have it), or the cursor. */
export type Target = Vec2 | { win: string; rest: Rect; u?: number } | 'cursor';

/** From `t` the actor glides to `to` in `dur` seconds. */
export interface Anchor { t: number; to: Target; dur: number; size?: number }

/**
 * A fault of the program that a copy of the jellyfish causes in the part of the interface that it sits on. Each lasts its eighth note.
 * `hang`: the chrome goes pale, (NOT RESPONDING), and the 3D picture of that window stops. `stride`: the rows lean and wrap. `tiles`:
 * 8 px blocks from anywhere on the screen cover the part. `palette`: the colours of the part are wrong. `trails`: the part is not
 * repainted and leaves copies of itself.
 */
export type ProgramFault = 'hang' | 'stride' | 'tiles' | 'palette' | 'trails';
const FAULT_KINDS: readonly ProgramFault[] = ['hang', 'stride', 'tiles', 'palette', 'trails'];

export interface Actor {
  /** The actor shows from this time: it grows out of `from` in 0.3 s. The first actor has no birth. */
  born?: number;
  from: Vec2;
  /** 1 = a person's height (188 px). */
  size: number;
  phase: number;
  anchors: Anchor[];
}

export interface BuddyPlan {
  actors: Actor[];
  /** A window moves by `by` px from `t` in `dur` seconds and stays there. */
  carries: { id: string; t: number; dur: number; by: Vec2 }[];
  /**
   * A window falls from `at`. `rect`: where it is then. It breaks at `dropHit(rect, at)`: the scene closes it then. `line`: the line that
   * it carries (its glyphs fall as bodies of their own, `n`: their pixel scale). `buttons`: how many buttons it has (default 1).
   */
  drops: { id: string; at: number; rect: Rect; line?: Line; n?: number; buttons?: number }[];
  knocks: number[];
  laughs: (readonly [number, number])[];
  /** The first actor turns once about itself from each of these times, in 0.6 s. */
  spins: number[];
  /** The balloon of the `ko` line `line` (an index of `says`) has these buttons. `presses`: the cursor presses button `i` at `at` (the button goes in for 0.15 s, and nothing happens). */
  offers: { line: number; buttons: string[]; presses: { at: number; i: number }[] }[];
  /** The `ko` lines. */
  says: Line[];
  /** The window manager dies: the faults stop and the actors stand still. */
  kill: number;
  /** The time at which actor n explodes. */
  gone: (n: number) => number;
  /** The desktop comes back at this time. */
  sink: number;
  end: number;
}

/** The time at which a window that falls from `at` hits the status bar. */
export function dropHit(rect: Rect, at: number): number {
  return at + Math.sqrt((2 * Math.max(0, FLOOR_Y - (rect[1] + rect[3]))) / FALL);
}

interface Pose { x: number; y: number; size: number; mode: 'drift' | 'hold' | 'cursor'; bar: Rect | null; grip: number; vx: number; vy: number }

export class Buddy {
  private atlas = new LitAtlas(512);
  private jellies: Jellyfish[];
  private scene = new THREE.Scene();
  private cam = camera(30, 0.1, 100);
  /** The rectangles of the windows of the frame, after `apply`. */
  private rects = new Map<string, Rect>();
  private cursor: Vec2 = [0, 0];
  constructor(private fonts: Fonts, private plan: BuddyPlan, private cursorAt: (t: number) => Vec2) {
    const mat = litMaterial(this.atlas);
    this.jellies = plan.actors.map((a) => new Jellyfish(this.atlas, mat, { phase: a.phase }));
    for (const j of this.jellies) this.scene.add(j.root);
    this.scene.add(ambient('#c8dcff', '#405070', 1.6));
    const s = sun('#e8f0ff', 1.4, 20);
    s.position.set(-3, 6, 8);
    this.scene.add(s, s.target);
    this.cam.aspect = LW / LH;
    this.cam.updateProjectionMatrix();
    for (const a of plan.actors) a.anchors.sort((p, q) => p.t - q.t);
  }

  // ---------------------------------------------------------------- the windows

  /**
   * Moves the windows of `st` for time t: the carries and the falls. At `sink` every window goes but those of `keep` (the maximized
   * view stays too), and the cursor drops.
   */
  apply(st: PlayerState, t: number, keep: readonly string[] = []) {
    const P = this.plan;
    this.rects.clear();
    this.cursor = [st.cursor.x, st.cursor.y];
    const out: WinState[] = [];
    st.windows.forEach((w, i) => {
      if (w.maximized || keep.includes(w.id)) { out.push(w); return; }
      let [x, y, wd, ht] = w.rect;
      for (const c of P.carries) {
        if (c.id !== w.id || t < c.t) continue;
        const s = smooth((t - c.t) / c.dur);
        x += c.by[0] * s;
        y += c.by[1] * s;
        // it hangs from the tentacles: when the carry stops it swings a little and comes to rest
        const tau = t - c.t - c.dur;
        if (tau > 0 && tau < 1) x += Math.round((c.by[0] > 0 ? -1 : 1) * Math.min(4, 0.15 * Math.hypot(c.by[0], c.by[1])) * Math.exp(-tau / 0.3) * Math.cos((2 * Math.PI * tau) / 0.5));
      }
      for (const d of P.drops) if (d.id === w.id && t >= d.at) y = Math.min(FLOOR_Y - ht, y + 0.5 * FALL * (t - d.at) ** 2);
      if (t >= P.sink) return;
      const rect: Rect = [Math.round(x), Math.round(y), Math.round(wd), Math.round(ht)];
      if (rect.some((v, j) => v !== w.rect[j])) {
        w.rect = rect;
        w.content = contentRect(rect, false);
      }
      this.rects.set(w.id, w.rect);
      out.push(w);
    });
    st.windows = out;
    const ts = P.sink;
    if (t >= ts) st.cursor.y = Math.min(CURSOR_FLOOR, Math.round(st.cursor.y + 0.5 * DROP * (t - ts) ** 2));
  }

  // ---------------------------------------------------------------- the actors

  private target(to: Target, t: number, sizePx: number): { p: Vec2; bar: Rect | null; cursor: boolean } {
    if (to === 'cursor') {
      const c = t === this.now ? this.cursor : this.cursorAt(t);
      // the bell floats to the right of the arrow, clear of it; a tentacle goes to its tip
      return { p: [c[0] + 0.42 * sizePx, c[1] - 0.02 * sizePx], bar: null, cursor: true };
    }
    if (Array.isArray(to)) return { p: to as Vec2, bar: null, cursor: false };
    const w = to as { win: string; rest: Rect; u?: number };
    const r = this.rects.get(w.win) ?? w.rest;
    const span = Math.min(r[2], 2.6 * sizePx);
    const mid = r[0] + r[2] * (w.u ?? 0.5);
    const x0 = Math.max(r[0], Math.min(r[0] + r[2] - span, mid - span / 2));
    return { p: [x0 + span / 2, r[1]], bar: [x0, r[1], span, r[3]], cursor: false };
  }

  private now = NaN;

  /** The place of actor `a` at time t. The window rectangles are those of the frame that `apply` saw (a window moves little in the 2 frames that the speed looks back). */
  private where(a: Actor, t: number, speed = true): Pose {
    const P = this.plan;
    let i = -1;
    for (let k = 0; k < a.anchors.length; k++) if (a.anchors[k]!.t <= t) i = k;
    // the size goes from that of the anchor before to that of this one during the move
    let size = a.size;
    for (let k = 0; k <= i; k++) {
      const q = a.anchors[k]!;
      if (q.size !== undefined) size = k === i ? size + (q.size - size) * smooth((t - q.t) / q.dur) : q.size;
    }
    if (a.born !== undefined) size *= smooth((t - a.born) / 0.3);
    let x = a.from[0], y = a.from[1], mode: Pose['mode'] = 'drift', bar: Rect | null = null, grip = 0;
    const sizePx = Math.max(1e-3, size) / MPP;
    if (i >= 0) {
      // a straight glide: no hop
      const cur = a.anchors[i]!, u = (t - cur.t) / cur.dur, s = smooth(u);
      const to = this.target(cur.to, t, sizePx);
      const from = i > 0 ? this.target(a.anchors[i - 1]!.to, t, sizePx).p : a.from;
      x = from[0] + (to.p[0] - from[0]) * s;
      y = from[1] + (to.p[1] - from[1]) * s;
      if (u >= 1 && to.bar) { mode = 'hold'; bar = to.bar; grip = smooth((t - cur.t - cur.dur) / 0.2); }
      else if (to.cursor && u > 0.7) { mode = 'cursor'; grip = smooth((u - 0.7) / 0.3); }
    }
    // it knocks: 2 frames larger (toward the glass). It laughs: two places, 3 px apart, 2 frames each
    if (a === P.actors[0]) {
      for (const k of P.knocks) if (t >= k && t < k + 2 * FR) size *= 1.25;
      for (const [l0, l1] of P.laughs) if (t >= l0 && t < l1 && Math.floor((t - l0) / (2 * FR)) % 2 === 1) y -= 3;
    }
    let vx = 0, vy = 0;
    if (speed) {
      const p0 = this.where(a, t - 2 * FR, false);
      vx = (x - p0.x) / (2 * FR); vy = (y - p0.y) / (2 * FR);
    }
    return { x, y, size, mode, bar, grip, vx, vy };
  }

  /** Draws the jellyfish over the interface. Call it after `apply` of the same frame. From `kill` the actors stand still; each is gone from `gone(n)`. */
  render(renderer: THREE.WebGLRenderer, view: LitView, t: number) {
    this.now = t;
    const tf = Math.min(t, this.plan.kill);
    this.plan.actors.forEach((a, n) => {
      const j = this.jellies[n]!;
      const p = this.where(a, tf, tf === t);
      if (t >= this.plan.gone(n)) p.size = 0;
      j.root.visible = (a.born === undefined || t >= a.born) && p.size > 0.02 && p.y < LH + 80;
      if (!j.root.visible) return;
      if (p.mode === 'hold' && p.bar) {
        j.holdWindow(tf, this.cam, p.bar as [number, number, number, number], DEPTH, { size: p.size, lift: 0.03 + 0.5 * (1 - p.grip), grip: p.grip });
        return;
      }
      const at = screenPoint(this.cam, p.x, p.y, DEPTH);
      const v = new THREE.Vector3(p.vx * MPP, -p.vy * MPP, 0);
      const reach = p.mode === 'cursor' ? { to: screenPoint(this.cam, this.cursor[0] + 3, this.cursor[1] + 4, DEPTH - 0.05), amount: p.grip } : undefined;
      let yaw = 0.25 * Math.sin(0.4 * tf + a.phase);
      if (n === 0) for (const s of this.plan.spins) yaw += 2 * Math.PI * smooth((tf - s) / 0.6);
      j.drift(tf, at, { v, yaw, size: p.size, ...(reach ? { reach } : {}) });
    });
    this.now = NaN;
    view.renderOver(renderer, this.scene, this.cam);
  }

  // ---------------------------------------------------------------- the 2D parts

  /** A disc of colour `c`. */
  private disc(l: TextLayer, cx: number, cy: number, r: number, c: string) {
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.floor(Math.sqrt(r * r - dy * dy));
      l.rect(cx - w, cy + dy, 2 * w + 1, 1, c);
    }
  }

  /**
   * The balloon at t: a round yellow box at a fixed offset up and to the right of the bell, on the bell of this frame (no lag), so it
   * follows the jellyfish 1 to 1; only the frame edges push it in. The stem aims straight at the top right of the bell's rim, in any
   * direction. Its line, its layout, its box (`bx`, `by`, `W`, `H`), the point that the stem aims at and the offer that it carries.
   * Null when no line shows.
   */
  private balloonAt(t: number) {
    const ln = lineAt(this.plan.says, t);
    const units = ln?.written?.units;
    if (!ln || !units || t >= this.plan.kill) return null;
    const rows = units.length > 9 ? [Math.ceil(units.length / 2), Math.floor(units.length / 2)] : [units.length];
    const lay = layoutOnce(this.fonts, ln, 'buddy', { x: 0, y: 0, align: 'center', n: 1, rows, maxW: 300, ink: '#101018', edge: '#fffbd0', outer: '#fffbd0' });
    if (t < lay.glyphs[0]!.start || t > lay.until) return null;
    const offer = this.plan.offers.find((o) => this.plan.says[o.line] === ln);
    const tail = 7;
    const W = Math.max(lay.box[2] + 16, offer ? offer.buttons.length * 42 + 10 : 0), H = lay.box[3] + 10 + (offer ? 17 : 0);
    const p = this.where(this.plan.actors[0]!, t, false);
    const mx = p.x, my = p.y, sizePx = p.size / MPP;
    const top = my - 0.27 * sizePx;
    const bx = Math.round(Math.max(3, Math.min(LW - 3 - W, mx + 0.3 * sizePx)));
    const by = Math.round(Math.max(14, Math.min(LH - 14 - H, top - tail - H + 0.15 * sizePx)));
    // the stem aims at the top right of the bell's rim
    const ax = Math.round(mx + 0.22 * sizePx), ay = Math.round(top + 0.1 * sizePx);
    return { lay, offer, W, H, ax, ay, bx, by };
  }

  private static button(b: { bx: number; by: number; W: number; H: number }, i: number, n: number): Rect {
    const bw = 36, bh = 12, total = n * bw + (n - 1) * 6;
    return [b.bx + Math.round((b.W - total) / 2) + i * (bw + 6), b.by + b.H - bh - 4, bw, bh];
  }

  /** The rectangle of button `i` of the offer of line `line` at time t (px). The scene aims the cursor with it. Call it when the plan is complete. */
  offerButton(line: number, i: number, t: number): Rect {
    const b = this.balloonAt(t);
    if (!b || !b.offer || b.offer.line !== line) throw new Error(`buddy: no offer of line ${line} shows at ${t.toFixed(3)} s`);
    return Buddy.button(b, i, b.offer.buttons.length);
  }

  /** The balloon of the `ko` line: the full line inside, each unit slammed in on its start, and the buttons of an offer. */
  private balloon(l: TextLayer, t: number) {
    const b = this.balloonAt(t);
    if (!b) return;
    const { lay, offer, W, H, ax, ay, bx, by } = b;
    const FILL = '#fffbd0', EDGE = '#101018';
    // a box with cut corners (the round balloon of a pixel assistant), a drop shadow, a stem
    const box = (x: number, y: number, w: number, h: number, c: string, a?: number) => {
      l.rect(x + 3, y, w - 6, h, c, a); l.rect(x + 1, y + 1, w - 2, h - 2, c, a); l.rect(x, y + 3, w, h - 6, c, a);
    };
    box(bx + 2, by + 2, W, H, '#000000', 0.4);
    box(bx, by, W, H, EDGE);
    // the stem: a straight taper from inside the box to 3 px short of the bell, in any direction. The edge pass goes first, so the
    // fill pass joins the stem to the face of the box
    const fx = Math.max(bx + 6, Math.min(bx + W - 6, ax)), fy = Math.max(by + 6, Math.min(by + H - 6, ay));
    const dx = ax - fx, dy = ay - fy, d = Math.hypot(dx, dy), len = Math.min(24, d - 3);
    const stem = (grow: number, c: string) => {
      for (let s = 0; s <= len; s++) {
        const half = Math.round(4 * (1 - s / len)), x = Math.round(fx + (dx * s) / d), y = Math.round(fy + (dy * s) / d);
        l.rect(x - half - grow, y - half - grow, 2 * (half + grow) + 1, 2 * (half + grow) + 1, c);
      }
    };
    const outside = ax < bx || ax > bx + W || ay < by || ay > by + H;
    if (outside && len > 2) stem(1, EDGE);
    box(bx + 1, by + 1, W - 2, H - 2, FILL);
    if (outside && len > 2) stem(0, FILL);
    printKana(l, lay, t, { motion: 'press', hot: '#d82828', dx: bx + Math.round(W / 2) - Math.round(lay.box[0] + lay.box[2] / 2), dy: by + 5 - lay.box[1] });
    if (!offer) return;
    offer.buttons.forEach((text, i) => {
      const r = Buddy.button(b, i, offer.buttons.length);
      const down = offer.presses.some((p) => p.i === i && t >= p.at && t < p.at + 0.15) ? 1 : 0;
      l.rect(r[0], r[1], r[2], r[3], '#40445a');
      l.rect(r[0] + down, r[1] + down, r[2] - 1, r[3] - 1, down ? '#8a8ea0' : '#f4f6fc');
      l.rect(r[0] + 1, r[1] + 1, r[2] - 2, r[3] - 2, down ? '#a8acbc' : '#c4c8d6');
      chromeText(l, this.fonts, text, r[0] + down + Math.round((r[2] - chromeWidth(this.fonts, text)) / 2), r[1] + down + 9, '#14141c', null);
    });
  }

  /**
   * The 2D parts of the frame: the pieces of the broken windows, the rings of the knocks, the laugh and the balloon. Call it after
   * the rig drew the windows.
   */
  draw(l: TextLayer, t: number) {
    const P = this.plan;
    for (const d of P.drops) this.shatter(l, d, t);
    const a0 = P.actors[0]!;
    // a knock: two square rings from the place where the tentacle hits the glass
    for (const k of P.knocks) {
      const tau = t - k;
      if (tau < 0 || tau > 0.22) continue;
      const p = this.where(a0, k, false);
      const cx = Math.round(p.x - 16), cy = Math.round(p.y + 22);
      for (const lag of [0, 0.06]) {
        const r = Math.round(4 + 110 * Math.max(0, tau - lag));
        if (tau < lag) continue;
        l.rect(cx - r, cy - r, 2 * r, 1, '#ffffff'); l.rect(cx - r, cy + r, 2 * r + 1, 1, '#ffffff');
        l.rect(cx - r, cy - r, 1, 2 * r, '#ffffff'); l.rect(cx + r, cy - r, 1, 2 * r, '#ffffff');
      }
    }
    for (const [l0, l1] of P.laughs) {
      if (t < l0 || t >= l1) continue;
      const p = this.where(a0, t, false), step = Math.floor((t - l0) * 9);
      // to the left of the bell, clear of the balloon
      for (let i = 0; i <= step % 3; i++) chromeText(l, this.fonts, 'HA', Math.round(p.x - 40 - 15 * i), Math.round(p.y - 4 - 8 * i - (step % 2)), '#101018', '#fffbd0', { n: 2 });
    }
    this.balloon(l, t);
  }

  /** The actors that explode at t: the middle of the bell and its radius (px), the time since the blast, and a seed. */
  blasts(t: number): { x: number; y: number; r: number; tau: number; seed: number }[] {
    const P = this.plan, tf = Math.min(t, P.kill), out: { x: number; y: number; r: number; tau: number; seed: number }[] = [];
    P.actors.forEach((a, n) => {
      const tau = t - P.gone(n);
      if (tau < 0 || tau > 0.6 || (a.born !== undefined && tf < a.born)) return;
      const p = this.where(a, tf, false), sizePx = p.size / MPP;
      out.push({ x: p.x, y: p.y - 0.14 * sizePx, r: 0.3 * sizePx, tau, seed: 17 + 31 * n });
    });
    return out;
  }

  /** A window that hit the status bar breaks into its parts. */
  private shatter(l: TextLayer, d: BuddyPlan['drops'][number], t: number) {
    const tau = t - dropHit(d.rect, d.at);
    if (tau < 0 || tau > LIE_END + 0.5) return;
    const [x, , w, h] = d.rect, y = FLOOR_Y - h;
    // after the beat on the floor every part drops out of the frame
    const out = 0.5 * FALL * Math.max(0, tau - LIE_END) ** 2;
    const part = (px: number, py: number, pw: number, ph: number, vx: number, vy: number, c: string, e?: number): Vec2 => {
      const [sx, foot] = fly(px, py + ph, vx, vy, tau, e);
      const X = Math.round(sx), Y = Math.round(foot - ph + out);
      l.rect(X, Y, pw, ph, c);
      return [X, Y];
    };
    const rnd = (i: number, s: number) => hashSin(i, s + 7 * d.rect[0]);
    // the shards of the face: they go out from the place of the hit
    const COLS = 7, ROWS = 4, fw = w / COLS, fh = (h - 12) / ROWS;
    for (let i = 0; i < COLS * ROWS; i++) {
      const cx = i % COLS, cy = Math.floor(i / COLS);
      const pw = Math.max(3, Math.round(fw * (0.45 + 0.55 * rnd(i, 1)))), ph = Math.max(3, Math.round(fh * (0.45 + 0.55 * rnd(i, 2))));
      const shade = rnd(i, 3);
      const [X, Y] = part(x + cx * fw, y + 12 + cy * fh, pw, ph, (cx - (COLS - 1) / 2) * 62 + (rnd(i, 4) - 0.5) * 90, -(90 + 260 * rnd(i, 5)) - 40 * (ROWS - cy), shade < 0.3 ? '#b8bcd0' : shade < 0.8 ? '#d8dcea' : '#eceef6', 0.3);
      if (ph > 4) l.rect(X, Y, pw, 1, '#f4f6fc');
    }
    // the bevel edges come off as strips
    part(x, y + 10, 2, h - 12, -230, -150, '#f4f6fc', 0.2);
    part(x + w - 2, y + 10, 2, h - 12, 230, -170, '#40445a', 0.2);
    for (let i = 0; i < 3; i++) part(x + (i * w) / 3, y + h - 2, Math.round(w / 3) - 2, 2, (i - 1) * 150, -60 - 50 * i, '#40445a', 0.25);
    // the title bar comes off in one piece and lands flat: it does not bounce
    for (let i = 0; i < 6; i++) {
      const [sx, foot] = fly(x + (i * w) / 6 - 40 * Math.min(tau, 0.6), y + 10, -30, -330, tau, 0);
      const X = Math.round(sx), Y = Math.round(foot - 10 + out);
      l.rect(X, Y, Math.ceil(w / 6), 10, '#30407a');
      l.rect(X, Y, Math.ceil(w / 6), 1, '#6a7ab8');
    }
    // the button pops out and rolls
    const nb = d.buttons ?? 1;
    for (let i = 0; i < nb; i++) {
      const [sx, foot] = fly(x + w / 2 - 18 + (i - (nb - 1) / 2) * 42, y + h - 6, 170 * (i % 2 ? -1 : 1) + 60, -300 - 40 * i, tau, 0.55);
      const X = Math.round(sx), Y = Math.round(foot - 12 + out);
      l.rect(X, Y, 36, 12, '#40445a');
      l.rect(X, Y, 35, 11, '#f4f6fc');
      l.rect(X + 1, Y + 1, 34, 10, '#c4c8d6');
      // a mark that goes round as it rolls
      l.rect(X + 2 + (Math.round(sx * 0.5) % 30 + 30) % 30, Y + 4, 4, 4, '#14141c');
    }
    // the glyphs of its line fall as bodies of their own and stay where they land
    const units = d.line?.written?.units;
    if (!units) return;
    const n = d.n ?? 1, step = Math.min(11 * n + 2, (w - 30) / units.length);
    units.forEach((u, i) => {
      const [sx, foot] = fly(x + 20 + i * step, y + 12 + (h - 12) * 0.55, (i - units.length / 2) * 22 + (rnd(i, 8) - 0.5) * 120, -(140 + 240 * rnd(i, 9)), tau, 0);
      chromeText(l, this.fonts, u.glyph, Math.round(sx), Math.round(foot - 1 + out), '#14141c', '#fffbd0', { n });
    });
  }

  /**
   * The faults of the program at t: on each eighth note, each part of the interface that copies sit on (a window, the top bar, the
   * status bar) has a fault with a chance that grows with the number of copies there. The copies there decide the kind
   * (`ProgramFault`). `f`: the frame of the eighth note.
   */
  private faultsAt(t: number): { key: string; rect: Rect; kind: ProgramFault; f: number }[] {
    const P = this.plan;
    if (t >= P.kill) return [];
    const groups = new Map<string, { rect: Rect; on: number[] }>();
    P.actors.forEach((a, n) => {
      if (a.born === undefined || t < a.born + 0.6) return;
      let cur: Anchor | null = null;
      for (const q of a.anchors) if (q.t <= t) cur = q;
      if (!cur || cur.to === 'cursor') return;
      let key: string, rect: Rect;
      if (Array.isArray(cur.to)) {
        // a copy that stands on the status bar: the whole bar
        key = 'status';
        rect = [0, LH - STATUS_H, LW, STATUS_H];
      } else {
        const w = cur.to as { win: string; rest: Rect; u?: number };
        if (w.win === 'top') {
          key = 'top';
          rect = [0, 0, LW, TITLE_H];
        } else {
          const r = this.rects.get(w.win);
          if (!r) return;
          key = w.win;
          rect = r;
        }
      }
      const g = groups.get(key);
      if (g) g.on.push(n);
      else groups.set(key, { rect, on: [n] });
    });
    // a fault on each eighth note: the chance grows with the copies there, and a second fault can stack on the first
    const E = SPB / 2, k = Math.floor(t / E), f = Math.floor((t - k * E) / FR + 1e-6), out: { key: string; rect: Rect; kind: ProgramFault; f: number }[] = [];
    for (const [key, g] of groups) {
      let seed = 0;
      for (let i = 0; i < key.length; i++) seed = seed * 31 + key.charCodeAt(i);
      seed %= 1000;
      if (hashSin(k, seed) >= Math.min(0.55, 0.2 + 0.1 * g.on.length)) continue;
      const pick = (s: number) => FAULT_KINDS[(g.on[Math.floor(hashSin(k, s) * g.on.length)]! + Math.floor(hashSin(k, s + 7) * 2)) % FAULT_KINDS.length]!;
      out.push({ key, rect: g.rect, kind: pick(seed + 1), f });
      if (hashSin(k, seed + 2) < 0.05 * g.on.length) out.push({ key, rect: g.rect, kind: pick(seed + 3), f });
    }
    return out;
  }

  /** The time that the 3D picture of window `win` shows at t: the start of the eighth note while the program hangs there, else t. */
  shownAt(win: string, t: number): number {
    const h = this.faultsAt(t).find((q) => q.key === win && q.kind === 'hang');
    return h ? Math.floor(t / (SPB / 2)) * (SPB / 2) : t;
  }

  /**
   * Corrupts the interface that the rig drew into `l` (call it after `rig.draw`, before `draw`). The faults are those of the program,
   * not of the world: the pixels of the window chrome, title bars and status bars. Each lasts its eighth note and changes every 2 frames.
   */
  corrupt(l: TextLayer, t: number) {
    const d = l.data, at = (x: number, y: number) => ((LH - 1 - y) * LW + x) * 4;
    for (const q of this.faultsAt(t)) {
      const x0 = Math.max(0, q.rect[0]), y0 = Math.max(0, q.rect[1]);
      const x1 = Math.min(LW, q.rect[0] + q.rect[2]), y1 = Math.min(LH, q.rect[1] + q.rect[3]);
      const w = x1 - x0, h = y1 - y0, k = Math.floor(t / (SPB / 2)) * 16 + Math.floor(q.f / 2);
      if (w < 8 || h < 4) continue;
      if (q.kind === 'hang') {
        // not responding: the window goes pale, its title says so, and its picture stops (`shownAt`)
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const o = at(x, y);
          if (d[o + 3] === 0) continue;
          for (let c = 0; c < 3; c++) d[o + c] = Math.round(d[o + c]! * 0.3 + 215 * 0.7);
        }
        const s = '(NOT RESPONDING)';
        if (w > chromeWidth(this.fonts, s) + 20) chromeText(l, this.fonts, s, x0 + Math.round((w - chromeWidth(this.fonts, s)) / 2), Math.min(y1 - 2, y0 + BORDER + 8), '#202434', null);
      } else if (q.kind === 'stride') {
        // a wrong row stride: each row starts further on, so the part leans and wraps round
        const row = new Uint8Array(w * 4), step = 2 + Math.floor(hashSin(k, 3) * 5);
        for (let y = y0; y < y1; y++) {
          const o = at(x0, y), s = (((y - y0) * step) % w) * 4;
          row.set(d.subarray(o, o + w * 4));
          d.set(row.subarray(s), o);
          d.set(row.subarray(0, s), o + w * 4 - s);
        }
      } else if (q.kind === 'tiles') {
        // tiles of the interface in the wrong places: 8 px blocks from anywhere on the screen over most of the part
        const B = 8, nx = Math.ceil(w / B), ny = Math.ceil(h / B), blk = new Uint8Array(B * B * 4);
        for (let i = 0; i < nx * ny; i++) {
          if (hashSin(k, 200 + i) > 0.6) continue;
          const sx = B * Math.floor(hashSin(k, 10 + i) * (LW / B - 1)), sy = B * Math.floor(hashSin(k, 40 + i) * (LH / B - 1));
          const tx = x0 + B * (i % nx), ty = y0 + B * Math.floor(i / nx), bw = Math.min(B, x1 - tx);
          for (let r = 0; r < B; r++) blk.set(d.subarray(at(sx, sy + r), at(sx, sy + r) + B * 4), r * B * 4);
          for (let r = 0; r < B && ty + r < y1; r++) d.set(blk.subarray(r * B * 4, r * B * 4 + bw * 4), at(tx, ty + r));
        }
      } else if (q.kind === 'palette') {
        // a wrong palette: every drawn pixel takes the colour of another entry
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const o = at(x, y);
          if (d[o + 3] === 0) continue;
          const r = d[o]!, g = d[o + 1]!, b = d[o + 2]!;
          d[o] = 255 - b; d[o + 1] = r; d[o + 2] = 255 - g;
        }
      } else {
        // the program does not repaint: the part leaves copies of itself behind, one more every 2 frames
        const snap = new Uint8Array(w * h * 4);
        for (let y = y0; y < y1; y++) snap.set(d.subarray(at(x0, y), at(x0, y) + w * 4), (y - y0) * w * 4);
        const dx = hashSin(k - Math.floor(q.f / 2), 5) < 0.5 ? -8 : 8, dy = hashSin(k - Math.floor(q.f / 2), 6) < 0.5 ? -5 : 5;
        for (let i = Math.min(6, Math.floor(q.f / 2) + 2); i >= 1; i--) {
          for (let y = 0; y < h; y++) {
            const Y = y0 + y + dy * i;
            if (Y < 0 || Y >= LH) continue;
            for (let x = 0; x < w; x++) {
              const X = x0 + x + dx * i, s = (y * w + x) * 4;
              if (X < 0 || X >= LW || snap[s + 3] === 0) continue;
              const o = at(X, Y);
              d[o] = snap[s]!; d[o + 1] = snap[s + 1]!; d[o + 2] = snap[s + 2]!; d[o + 3] = snap[s + 3]!;
            }
          }
        }
        for (let y = y0; y < y1; y++) d.set(snap.subarray((y - y0) * w * 4, (y - y0 + 1) * w * 4), at(x0, y));
      }
    }
  }

  dispose() {
    this.atlas.tex.dispose();
  }
}
