// Transition plate 5 → 6 (parrot → bored; video.json `transitions`, id divider). The plate hands over here: the
// call "Do you know?" and everything after it, up to the cut onto bored, are drawn by this scene.
//
// The call cuts the sermon page open onto red (109.26 s) and punches the title in; the last prediction fan and its
// candidate window open under it, after the last glyph of the sermon. The red is a room. From the end of the call
// (109.97) its walls close like the plates of a hydraulic press, in hard 24 fps steps, and the room lays itself out
// again at every step: the walls push each thing that is in their way (the title, each glyph of the fan, the
// window), then squeeze it flat; when it cannot be squeezed any more it pops out of the room and falls. The last
// step leaves a red line, the NEW divider of line 41 in bored, on the cut. Around the walls bored plays live: the
// sermon as the history of the channel above, the reply 何 below. Whatever fell out of the room falls over it.
//
// Nothing here is stored from one frame to the next: the position of every body is a function of the step, so the
// frame at any time can be rendered alone.
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { FSPass, H, makeRT, W } from '@pve/engine/gl';
import { font } from '@pve/engine/type';
import { lineNo, units } from '@pve/engine/lyrics';
import { clamp, hash, lerp, stepN } from '@pve/engine/util';
import {
  copyTimes, FRAKTUR, fnt, genAt, INK, MONO, PageScene, PAPER, POST, SERIF, VOICE,
  type SurfaceOpts,
} from './_page';
import { PARROT } from './_era_parrot';
import { Bigram, clean } from './parrot-ngram';
import { WINDOW } from './parrot-ime';
import {
  drawWindow, FAN, fanSet, FPS, lastAt, placeSermon, RH, ROW, SIZE, READ_SIZE, W_GAP, windowTop, type FanItem,
  type FanSet, type Win,
} from './parrot-ui';
/** The call: it cuts the page open at its start and it ends where the walls start to close. */
const CALL = VOICE.find((c) => c.id === 'doyouknow')!;
/** The red line of the NEW divider in bored on its line 41: the rows the room is pressed to. */
const LINE = { y0: 620, y1: 624 };
/** The thickness of the walls (px) when the press starts: they thin out to nothing at the line. */
const WALL = 16;
/** A body is squeezed to this much of its height at most; then it pops. */
const SPOP = 0.9;
/** The fall of what pops out of the room, px/s². */
const GRAVITY = 7000;
/** The rows of the sermon page that end with the cursor the fan opens from. */
const FIRST = 37;
const LAST = 40;

interface Rows { y0: number; y1: number; e: number }

/**
 * The 8 hits of the snare / rhythm_FX roll across bar 62.3..62.4 (user_input/stems/..._rhythm_FX.wav)
 * that step the hydraulic press shut onto the cut (110.757 s).
 */
const ROLL_HITS = [110.17, 110.255, 110.325, 110.39, 110.46, 110.54, 110.61, 110.69] as const;
const ROLL_STEPS = ROLL_HITS.map((t) => Math.floor(t * FPS + 1e-4));

/** Where the walls stand at step ts: the press steps down on each hit of the snare roll and shuts on s1. */
function press(ts: number, _s0: number, s1: number): Rows {
  if (ts >= s1) return { y0: LINE.y0, y1: LINE.y1, e: 1 };
  let hits = 0;
  for (const hs of ROLL_STEPS) if (ts >= hs) hits++;
  const u = hits / (ROLL_STEPS.length + 1);
  const e = 1 - (1 - u) * (1 - u);
  return { y0: lerp(0, LINE.y0, e), y1: lerp(H, LINE.y1, e), e };
}

/** One thing in the room. It is drawn at its own place (x, y) and moved by the walls. */
interface Body {
  x: number;
  /** Centre and half height. */
  y: number;
  hh: number;
  /** The first step it is there. */
  from: number;
  /** The step at which the walls cannot squeeze it any more (Infinity: never), and its kick. */
  pop: number;
  vx: number;
  vy: number;
  w: number;
  /** Its ray to the origin of the fan, if it is a glyph of the fan. */
  ray: FanItem | null;
  /** Draws it at (x, y); `ts` is the step. */
  draw: (c: CanvasRenderingContext2D, ts: number) => void;
}

class Room extends PageScene {
  /** The call, the cut, and the walls' first and last step: set by the transition before init. */
  t0 = 0;
  s0 = 0;
  s1 = 0;
  private bodies: Body[] = [];
  private fan!: FanSet;
  private copies: number[] = [];
  private hats: number[] = [];
  override async init() {
    await super.init();
    this.warm([PARROT]);
    const L = this.ctx.lyrics;
    this.copies = copyTimes(L);
    this.hats = this.ctx.audio.events('hat', this.t0 - 1, this.ctx.end + 1).map(([t]) => t);

    // the glyph after the sermon, which the parrot expects, and the cursor it opens from
    const model = new Bigram(L.lines.map((l) => {
      if (!l.written) throw new Error(`line ${l.i} has no written form`);
      return l.written.jp;
    }));
    const lay = placeSermon(L, FIRST, LAST);
    const tail = lay[lay.length - 1]!.cells.at(-1)!;
    const tailU = units(lineNo(L, LAST)).at(-1)!;
    const tailCh = [...clean(tailU.glyph)].pop()!;
    const after = model.next(tailCh);
    const cx = tail.x;
    const cy = tail.y + tail.rows * ROW;
    this.fan = fanSet(cx - SIZE / 2 - 6, cy + SIZE / 2, after.slice(0, FAN), tailCh);
    const cands = after.slice(0, WINDOW).map(({ ch, p }, k) => ({ s: ch, p, rank: k + 1, i: k }));
    const win: Win = { cands, row: 0, table: cands.map((_, k) => k) };

    const call = stepN(this.t0, FPS);
    const pop = (hh: number, from: number) => {
      for (let ts = Math.max(this.s0, from); ts <= this.s1; ts++) {
        const r = press(ts, this.s0, this.s1);
        if (r.y1 - r.y0 < 2 * hh * SPOP) return ts;
      }
      return Infinity;
    };
    let seed = 0;
    const body = (
      x: number, y: number, hh: number, from: number, draw: Body['draw'], ray: FanItem | null = null, mortal = true,
    ): Body => {
      const k = seed++;
      return {
        x, y, hh, from, pop: mortal ? pop(hh, from) : Infinity,
        vx: (hash(k, 11) - 0.5) * 900, vy: -(350 + 500 * hash(k, 12)), w: (hash(k, 13) - 0.5) * 6, ray, draw,
      };
    };

    // the title, in three words
    const m = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    m.font = fnt(FRAKTUR, 200);
    const words = ['Do', 'you', 'know?'];
    const space = m.measureText(' ').width;
    const widths = words.map((s) => m.measureText(s).width);
    let wx = W / 2 - (widths.reduce((a, b) => a + b, 0) + space * 2) / 2;
    words.forEach((s, i) => {
      const x = wx + widths[i]! / 2;
      wx += widths[i]! + space;
      this.bodies.push(body(x, 290, 95, call, (c, ts) => {
        const a = ts - call;
        const k = a < 2 ? 1.24 : a < 4 ? 1.08 : 1;
        c.save();
        c.translate(W / 2, 290);
        c.scale(k, k);
        c.translate(-W / 2, -290);
        c.fillStyle = PAPER;
        c.font = fnt(FRAKTUR, 200);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(s, x, 290);
        c.restore();
      }));
    });

    // the window of candidates after the last glyph
    const right = cx - SIZE / 2 - W_GAP;
    const wh = cands.length * RH + 12;
    const wy = windowTop(cands.length, cy);
    this.bodies.push(body(right - 140, wy + wh / 2, wh / 2, call, (c, ts) => {
      drawWindow(c, win, 0, right, cy, 'cut', ts - call, 1, 0);
    }));

    // the glyphs of the fan
    this.fan.items.forEach((it, k) => {
      this.bodies.push(body(it.x, it.y, it.size * 0.7, call, (c, ts) => {
        const a = ts - call;
        if (a === 0) return;
        const sc = a === 1 ? 1.3 : 1;
        c.font = fnt(SERIF, it.size, 500);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        if (a <= 2) {
          const h = it.size * 1.12 * sc;
          c.fillStyle = PAPER;
          c.fillRect(it.x - h / 2, it.y - h / 2, h, h);
          c.save();
          c.globalCompositeOperation = 'destination-out';
          c.fillStyle = INK;
          c.translate(it.x, it.y);
          c.scale(sc, sc);
          c.fillText(it.ch, 0, 0);
          c.restore();
        } else {
          c.fillStyle = PAPER;
          c.fillText(it.ch, it.x, it.y);
        }
        c.fillStyle = PAPER;
        c.font = font(MONO, 11);
        c.textBaseline = 'top';
        c.fillText(`${k + 1}  ${it.p.toFixed(3)}`, it.x, it.y + it.size * 0.62 + 4);
        if (k === 0) {
          c.font = font(MONO, 12);
          c.textBaseline = 'bottom';
          c.fillText(`next | ${tailCh}`, it.x, it.y - it.size * 0.62 - 6);
        }
      }, it));
    });

    // the cursor, which rests at the end of the sermon
    this.bodies.push(body(cx - READ_SIZE / 2 - 6, cy + 4 + READ_SIZE / 2, READ_SIZE / 2, call, (c) => {
      if (lastAt(this.hats, this.hatT) % 2 !== 0) return;
      c.fillStyle = PAPER;
      c.fillRect(cx - READ_SIZE / 2 - 8, cy + 4, 4, READ_SIZE);
    }, null, false));
  }

  /** The time of the frame being drawn (the cursor blinks on the hats). */
  private hatT = 0;

  /** Where a body stands at step ts, between the walls: pushed, squeezed, or out of the room and falling. */
  private place(b: Body, ts: number, r: Rows): { x: number; y: number; rot: number; sy: number; popped: boolean } {
    if (ts >= b.pop) {
      const d = press(b.pop, this.s0, this.s1);
      const dt = (ts - b.pop) / FPS;
      return {
        x: b.x + b.vx * dt, y: (d.y0 + d.y1) / 2 + b.vy * dt + 0.5 * GRAVITY * dt * dt, rot: b.w * dt,
        sy: lerp(SPOP, 1, clamp((ts - b.pop) / 2)), popped: true,
      };
    }
    const h = r.y1 - r.y0;
    if (h >= 2 * b.hh) return { x: b.x, y: clamp(b.y, r.y0 + b.hh, r.y1 - b.hh), rot: 0, sy: 1, popped: false };
    return { x: b.x, y: (r.y0 + r.y1) / 2, rot: 0, sy: h / (2 * b.hh), popped: false };
  }

  draw(c: CanvasRenderingContext2D, f: Frame): SurfaceOpts {
    c.clearRect(0, 0, W, H);
    const ts = stepN(f.t, FPS);
    this.hatT = f.t;
    const r = press(ts, this.s0, this.s1);
    const placed = this.bodies.map((b) => (ts >= b.from ? this.place(b, ts, r) : null));

    // the rays of the fan, from its origin (pushed by the walls) to each glyph that is still in the room
    const h = r.y1 - r.y0;
    const oy = h >= 16 ? clamp(this.fan.oy, r.y0 + 8, r.y1 - 8) : (r.y0 + r.y1) / 2;
    const ox = this.fan.ox;
    const reach = ts === stepN(this.t0, FPS) ? 0.55 : 1;
    c.strokeStyle = PAPER;
    this.bodies.forEach((b, i) => {
      const p = placed[i];
      if (!b.ray || !p || p.popped) return;
      const dx = p.x - ox, dy = p.y - oy;
      const len = Math.hypot(dx, dy);
      if (len < 1) return;
      const ux = dx / len, uy = dy / len;
      const r1 = len * reach - b.ray.size * 0.7;
      c.lineWidth = 1 + 7 * b.ray.p;
      c.beginPath();
      c.moveTo(ox + ux * 70, oy + uy * 70);
      c.lineTo(ox + ux * Math.max(80, r1), oy + uy * Math.max(80, r1));
      c.stroke();
    });

    // the bodies: what is in the room first, then what has fallen out of it
    for (const popped of [false, true]) {
      this.bodies.forEach((b, i) => {
        const p = placed[i];
        if (!p || p.popped !== popped || p.y - b.hh > H + 200) return;
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.scale(1, p.sy);
        c.translate(-b.x, -b.y);
        b.draw(c, ts);
        c.restore();
      });
    }
    return { era: PARROT, gen: genAt(this.copies, this.ctx.lyrics, f.t) };
  }

  /** The step at which the room starts to close and the step at which it is shut. */
  rows(ts: number): Rows {
    return press(ts, this.s0, this.s1);
  }
}
const FRAG = /* glsl */ `
uniform sampler2D room;    // the red room, with what is in it and what has fallen out of it
uniform sampler2D next;    // bored, live
uniform sampler2D under;   // bored itself, after the cut
uniform vec2 uRows;        // frame px from the top: the room is between these two rows
uniform float uWall;       // wall thickness, px
uniform float uAfter;      // 1 after the cut
const float H = ${H.toFixed(1)};
void main() {
  vec3 r = texture(room, vUv).rgb;
  float a = clamp((r.g - 0.05) / 0.65, 0.0, 1.0);
  vec3 redSub = vec3(0.74, 0.015, 0.015);
  vec3 itemCol = clamp((r - (1.0 - a) * redSub) / max(a, 0.02), 0.0, 1.0);
  if (uAfter > 0.5) {
    fragColor = vec4(mix(texture(under, vUv).rgb, itemCol, a), 1.0);
    return;
  }
  float y = (1.0 - vUv.y) * H;
  float inTop = smoothstep(uRows.x - 0.75, uRows.x + 0.75, y);
  float inBot = 1.0 - smoothstep(uRows.y - 0.75, uRows.y + 0.75, y);
  float inside = inTop * inBot;
  float d = max(uRows.x - y, y - uRows.y);
  float onWall = 1.0 - smoothstep(uWall - 0.75, uWall + 0.75, d);
  float onEdge = 1.0 - smoothstep(1.5, 2.5, d);
  vec3 wallCol = mix(vec3(0.05), vec3(0.80, 0.76, 0.68), onEdge);
  vec3 outside = mix(texture(next, vUv).rgb, wallCol, onWall);
  vec3 outWithItem = mix(outside, itemCol, a);
  fragColor = vec4(mix(outWithItem, r, inside), 1.0);
}
`;

export default class Divider extends Scene {
  override handlesTransition = true;
  private pass!: FSPass;
  private next = makeRT();
  private roomRT = makeRT();
  private room!: Room;
  private cut = 0;
  private lastBoredStep = -1;
  override async init() {
    const pr = this.ctx.params;
    if (typeof pr.at !== 'number') throw new Error('divider: no resolved at');
    this.cut = pr.at;
    this.room = new Room({ ...this.ctx, id: 'divider-room', params: {} });
    this.room.t0 = this.ctx.start;
    this.room.s0 = stepN(CALL.end, FPS);
    this.room.s1 = stepN(this.cut - 1e-6, FPS) - 1;
    this.pass = new FSPass(FRAG, {
      room: { value: this.roomRT.texture }, next: { value: this.next.texture }, under: { value: null },
      uRows: { value: new THREE.Vector2(0, H) }, uWall: { value: 0 }, uAfter: { value: 0 },
    });
    await Promise.all([this.room.init(), this.ctx.ensureClip('bored')]);
    this.ctx.renderClip('bored', CALL.end, this.next);
    this.lastBoredStep = stepN(CALL.end, FPS);
    // compile the pass now: on the first frame of the transition it would stall it
    const tiny = new THREE.WebGLRenderTarget(1, 1);
    this.pass.render(this.ctx.renderer, tiny);
    tiny.dispose();
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    if (!f.under) throw new Error('divider: nothing under the transition');
    const u = this.pass.u;
    u.under!.value = f.under;
    this.room.render(f, this.roomRT);
    if (f.t >= this.cut) {
      u.uAfter!.value = 1;
    } else {
      u.uAfter!.value = 0;
      const ts = stepN(f.t, FPS);
      const r = this.room.rows(ts);
      // bored plays live outside the walls once they have started closing (24 fps stepped)
      if (r.e > 0 && ts !== this.lastBoredStep) {
        this.lastBoredStep = ts;
        this.ctx.renderClip('bored', f.t, this.next, f.dt);
      }
      (u.uRows!.value as THREE.Vector2).set(r.y0, r.y1);
      u.uWall!.value = WALL * (1 - r.e);
    }
    this.pass.render(this.ctx.renderer, out);
    return POST;
  }

  override dispose() {
    this.pass.dispose();
    this.next.dispose();
    this.roomRT.dispose();
    this.room.dispose();
  }
}
