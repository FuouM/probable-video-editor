// The mirror of Verse 1 and its glass, shared by the mirror plate and the Over transition that carries
// its shards into the chorus: the zoom (a linear pull-back, then a jump at the camera per syllable of
// "coming right at"), the frame position that keeps the typed text in view, the cracks, and the shards.
import { H, SCALE, W } from '@pve/engine/gl';
import type { Lyrics } from '@pve/engine/lyrics';
import { ease, keys } from '@pve/engine/util';
import { BAR, BLUE, BOX_H, INK, PAPER, brickRect, gray, hashI, stepT, sylLine, wrapLine, type Placed, type SylLine } from './_kit';
import { ALLEY_SPAN, MID_SPEED, NEAR_SPEED, WALL_SPEED, WallWorld } from './_wall';

/** px of the inner text block's left edge and top inside the mirror (letterbox content size) */
export const TEXT_X = 140, TEXT_Y = 120;
/** px the typed lines may run to */
const TEXT_W = 1240;
const MAX_CELL = 14;

export interface Typed { sl: SylLine; placed: Placed[]; charT: Map<number, number>; cell: number; w: number; h: number }

/** Where the mirror is on screen at one time: its rect and scale; `focus` is the text centre on screen. */
export interface MirrorAt { mx: number; my: number; mw: number; mh: number; s: number }

export class MirrorGeom {
  readonly typed: Typed[] = [];
  readonly tMir: number;
  readonly tMyself: number;
  readonly tComing: number;
  /** onsets of co, ming, right, at */
  readonly hits: number[];
  /** the cracks: rays from the impact point in mirror units (0..1 across the glass), sorted by angle */
  readonly impact: [number, number] = [0.56, 0.24];
  readonly angles: number[];
  readonly rays: [number, number][][];
  /** the centre of "at" inside the mirror (letterbox content px): what its kick zooms onto */
  atFocus: [number, number] = [W / 2, BOX_H / 2];

  constructor(ly: Lyrics, start: number, end: number) {
    // the lines that start in the clip (the walls line still ending at the cut is written on the wall already)
    for (const line of ly.linesIn(start, end).filter((l) => l.start >= start - 1e-3)) {
      const sl = sylLine(ly, line);
      // "coming right / at": the last word gets a row of its own, left aligned, so it stays in the frame
      // when the mirror jumps at the camera
      const coming = /^coming right at/.test(sl.bt.text);
      let cell = MAX_CELL, lay = wrapLine(sl, 1);
      for (; cell >= 8; cell--) {
        // a block about two thirds of the wall wide: the painted-over patch leaves the walls' words around it
        const maxCols = coming ? sl.bt.charX[sl.ranges[sl.ranges.length - 1]![0]]! - 1 : Math.floor(TEXT_W / cell);
        lay = wrapLine(sl, maxCols, 14);
        if (TEXT_Y + (lay.rows * 14 - 4) * cell <= BOX_H - 90) break;
      }
      if (coming) {
        // "at" alone on its row, centred under the line: on its kick the camera centres on it
        const last = lay.rows - 1, blockW = Math.max(...lay.widths), dx = Math.round((blockW - lay.widths[last]!) / 2);
        for (const p of lay.placed) if (p.y >= last * 14) p.x += dx;
        this.atFocus = [TEXT_X + (dx + lay.widths[last]! / 2) * cell, TEXT_Y + (last * 14 + 5) * cell];
      }
      const charT = new Map<number, number>();
      // typewriter: the characters of a syllable are struck one by one over its first 60%
      sl.ranges.forEach(([a, b], si) => {
        const s = sl.syls[si]!;
        // on "coming right at", the final word "at" stamps both letters at its onset so "t" is never cut off by the shatter
        const span = coming && si === sl.ranges.length - 1 ? 0 : (s.end - s.start) * 0.6;
        for (let ch = a; ch < b; ch++) charT.set(ch, s.start + ((ch - a) / Math.max(1, b - a)) * span);
      });
      this.typed.push({ sl, placed: lay.placed, charT, cell, w: Math.max(...lay.widths) * cell, h: (lay.rows * 14 - 4) * cell });
    }
    const mir = ly.get('mirror');
    this.tMir = mir.words.find((w) => w.w === 'mirror')!.start;
    const see = ly.get("can't see myself");
    this.tMyself = see.words.find((w) => w.w === 'myself')!.start;
    const coming = sylLine(ly, 'coming right at');
    this.tComing = coming.line.start;
    this.hits = coming.syls.map((s) => s.start);
    // 14 jagged rays out of the impact point; keep the lower-left sector around "at" wide so "at" rides on one unbroken shard
    const n = 14;
    this.angles = Array.from({ length: n }, (_, k) => {
      let a = ((k + 0.2 + 0.6 * hashI(k, 21)) / n) * Math.PI * 2;
      // nudge rays away from the angle (~2.45 rad) pointing straight through "at"
      if (Math.abs(a - 2.45) < 0.22) a = a < 2.45 ? 2.2 : 2.7;
      return a;
    }).sort((a, b) => a - b);
    this.rays = this.angles.map((a, k) => {
      const pts: [number, number][] = [];
      for (let q = 1; q <= 7; q++) {
        const r = (q / 7) * 1.4, wob = (hashI(k, q, 22) - 0.5) * 0.1;
        pts.push([this.impact[0] + Math.cos(a + wob) * r, this.impact[1] + Math.sin(a + wob) * r * 2.39]);
      }
      return pts;
    });
  }

  /** The line being typed (the last started line). */
  current(t: number): Typed {
    let cur = this.typed[0]!;
    for (const x of this.typed) if (x.sl.line.start <= t) cur = x;
    return cur;
  }

  /** Mirror scale: 1 at "mirror", a linear pull-back to 0.5 by "coming", then a jump at the camera per syllable. */
  zoom(tz: number) {
    const [h0, h1, h2, h3] = this.hits as [number, number, number, number];
    return keys(tz, [
      [this.tMir, 1], [this.tComing, 0.5],
      [h0, 0.5], [h0 + 0.06, 0.64, ease.outBack], [h1, 0.66], [h1 + 0.06, 0.84, ease.outBack], [h2, 0.86],
      [h2 + 0.06, 1.08, ease.outBack], [h3, 1.1], [h3 + 0.06, 1.4, ease.outBack], [h3 + 1.6, 1.9],
    ]);
  }

  /**
   * The mirror rect at tz. Until "coming" its centre drifts right as it pulls back; from "coming" the
   * jumps scale about the centre of the typed text, so the text stays in the frame.
   */
  at(tz: number): MirrorAt {
    const s = this.zoom(tz);
    const back = keys(tz, [[this.tMir, 0], [this.tComing, 1]]);
    const cx0 = W / 2 + 140 * back, cy0 = H / 2;
    let cx = cx0, cy = cy0;
    if (tz >= this.tComing) {
      const ty = this.current(tz);
      // the focus: the text centre, moving onto "at" with its kick
      const k = ease.outCubic(Math.min(1, Math.max(0, (tz - this.hits[3]!) / 0.06)));
      const fx = TEXT_X + ty.w / 2 + (this.atFocus[0] - TEXT_X - ty.w / 2) * k;
      const fy = TEXT_Y + ty.h / 2 + (this.atFocus[1] - TEXT_Y - ty.h / 2) * k;
      const s0 = 0.5;
      // the text centre's screen position at "coming", held there; with "at" it is drawn to the frame centre
      const sx0 = cx0 + (TEXT_X + ty.w / 2 - W / 2) * s0, sy0 = cy0 + (TEXT_Y + ty.h / 2 - BOX_H / 2) * s0;
      const sx = sx0 + (W / 2 - sx0) * k, sy = sy0 + (H / 2 - sy0) * k;
      cx = sx - (fx - W / 2) * s;
      cy = sy - (fy - BOX_H / 2) * s;
    }
    const mw = W * s, mh = BOX_H * s;
    return { mx: cx - mw / 2, my: cy - mh / 2, mw, mh, s };
  }

  /** Trace shard k (between rays k and k+1) of the mirror at m: from the impact point out past the glass. */
  wedge(c: CanvasRenderingContext2D, k: number, m: MirrorAt) {
    const n = this.rays.length;
    const r0 = this.rays[k]!, r1 = this.rays[(k + 1) % n]!;
    const a0 = this.angles[k]!, a1 = this.angles[(k + 1) % n]! + (k + 1 === n ? Math.PI * 2 : 0);
    const px = m.mx + this.impact[0] * m.mw, py = m.my + this.impact[1] * m.mh;
    const R = Math.max(m.mw, m.mh) * 0.8;
    c.beginPath();
    c.moveTo(px, py);
    for (const [u, v] of r0) c.lineTo(m.mx + u * m.mw, m.my + v * m.mh);
    c.lineTo(px + Math.cos(a0) * R, py + Math.sin(a0) * R);
    c.lineTo(px + Math.cos((a0 + a1) / 2) * R, py + Math.sin((a0 + a1) / 2) * R);
    c.lineTo(px + Math.cos(a1) * R, py + Math.sin(a1) * R);
    for (let q = r1.length - 1; q >= 0; q--) c.lineTo(m.mx + r1[q]![0] * m.mw, m.my + r1[q]![1] * m.mh);
    c.closePath();
  }

  /**
   * Shard k's flight `a` seconds after "at": a translation away from the impact, a turn about it, and a
   * scale towards the camera (the shards fly at us).
   */
  flight(k: number, a: number) {
    const mid = (this.angles[k]! + this.angles[(k + 1) % this.angles.length]! + (k + 1 === this.angles.length ? Math.PI * 2 : 0)) / 2;
    const isAtShard = mid > 2.15 && mid < 2.75;
    const postCut = Math.max(0, a - 0.3);
    const d = a * (isAtShard ? 95 : 160) + a * a * (isAtShard ? 320 : 500 + 700 * hashI(k, 31)) + postCut * postCut * (isAtShard ? 1400 : 300);
    const rot = isAtShard ? (hashI(k, 32) - 0.5) * a * 0.35 : (hashI(k, 32) - 0.5) * a * 0.9;
    return { dx: Math.cos(mid) * d, dy: Math.sin(mid) * d, rot, grow: 1 + a * (0.3 + 0.5 * hashI(k, 33)) };
  }

  /** The screen point shards turn and grow about. */
  impactAt(m: MirrorAt): [number, number] {
    return [m.mx + this.impact[0] * m.mw, m.my + this.impact[1] * m.mh];
  }
}

/** Seconds the wall takes to slow from walls' speed to a stop. */
const STOP = 1.2;
/** Seconds the roller takes to paint the patch the line types onto. */
const ROLL = 0.5;

/**
 * The glass and the world inside it, shared by the mirror plate and the Over transition `shards` (which
 * carries the same wedges, with the same picture on them, across the cut). Inside: walls' wall slides on from
 * walls, slows to a stop and gets a painted-over patch the lines type onto.
 */
export class MirrorGlass {
  readonly g: MirrorGeom;
  /** song time walls started (its shifts are measured from there) */
  readonly t0Walls: number;
  private inner = document.createElement('canvas');
  private ic: CanvasRenderingContext2D;
  private world: WallWorld;
  /** the black patch under the typed lines, inner px */
  private patch: [number, number, number, number];

  /** `start`, `end`: the mirror clip. */
  constructor(ly: Lyrics, private start: number, end: number) {
    this.inner.width = Math.round(W * SCALE);
    this.inner.height = Math.round(BOX_H * SCALE);
    this.ic = this.inner.getContext('2d')!;
    this.g = new MirrorGeom(ly, start, end);
    this.t0Walls = ly.get('looking at the walls').start;
    this.world = new WallWorld(ly, this.t0Walls, start);
    const w = Math.max(...this.g.typed.map((x) => x.w)), h = Math.max(...this.g.typed.map((x) => x.h));
    this.patch = [TEXT_X - 40, TEXT_Y - 36, w + 80, h + 72];
  }

  /** Travel of a layer moving at `v` px/s at the cut that slows to a stop over STOP seconds. */
  slow(v: number, tau: number) {
    const u = Math.min(Math.max(tau, 0), STOP);
    return v * (u - (u * u) / (2 * STOP));
  }
  /** The inner wall's travel at t (walls' shift, run on). */
  wallShift(t: number) {
    return (this.start - this.t0Walls) * WALL_SPEED + this.slow(WALL_SPEED, t - this.start);
  }
  /** How far the stuck-on patch and text still have to travel at t. */
  stuckDx(t: number) {
    return this.slow(WALL_SPEED, STOP) - this.slow(WALL_SPEED, t - this.start);
  }

  /** The world inside the mirror at t, drawn into the inner canvas (letterbox content size). */
  drawInner(t: number) {
    const c = this.ic;
    c.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    c.clearRect(0, 0, W, BOX_H);
    const t0 = this.start, tau = t - t0;
    // walls' wall, sliding on and slowing to a stop (frame coordinates: up by the top bar)
    c.save();
    c.translate(0, -BAR);
    this.world.drawWall(c, this.wallShift(t), t, false);
    this.world.midLayer(c, (t0 - this.t0Walls) * MID_SPEED + this.slow(MID_SPEED, tau));
    c.restore();
    // stuck to the wall: the patch and the typed line come to rest at their place
    c.save();
    c.translate(this.stuckDx(t), 0);
    const [px, py, pw, ph] = this.patch;
    const roll = Math.min(1, tau / ROLL);
    c.fillStyle = INK;
    c.fillRect(px, py, pw * roll, ph);
    if (roll < 1) { c.fillStyle = gray(0.5); c.fillRect(px + pw * roll - 6, py - 10, 12, ph + 20); } // the roller
    const cur = this.g.current(t);
    c.fillStyle = PAPER;
    for (const p of cur.placed) {
      const at = cur.charT.get(p.b.ci) ?? Infinity;
      if (t < at) continue;
      brickRect(c, TEXT_X + p.x * cur.cell, TEXT_Y + p.y * cur.cell, p.b.len, cur.cell);
    }
    c.restore();
    // the alley in front lets its last props go by (no new ones after the cut)
    const near0 = (t0 - this.t0Walls) * NEAR_SPEED;
    c.save();
    c.translate(0, -BAR);
    // (drawInner is called with a held time or a constant, never f.t: no skew)
    this.world.alley(c, near0 + stepT(tau, 12, 0) * NEAR_SPEED, Math.floor((near0 + W + 800) / ALLEY_SPAN) + 1);
    c.restore();
  }

  /** The mirror: the glass with the inner world (as last drawn), its cracks, its frame. */
  drawMirror(c: CanvasRenderingContext2D, m: MirrorAt, cracks: number) {
    const { mx, my, mw, mh, s } = m;
    c.clearRect(mx, my, mw, mh);
    c.drawImage(this.inner, mx, my, mw, mh);
    // cracks: holes through the glass onto the blue, each with a paper edge
    if (cracks > 0) {
      const [ix, iy] = this.g.impact;
      const path = (ray: [number, number][], d: number) => {
        c.beginPath();
        c.moveTo(mx + ix * mw + d, my + iy * mh + d);
        for (const [u, v] of ray) c.lineTo(mx + u * mw + d, my + v * mh + d);
      };
      c.save();
      c.beginPath();
      c.rect(mx, my, mw, mh);
      c.clip();
      for (let k = 0; k < cracks; k++) {
        path(this.g.rays[k]!, 0);
        c.globalCompositeOperation = 'destination-out';
        c.lineWidth = Math.max(2, 5 * s);
        c.stroke();
        c.globalCompositeOperation = 'source-over';
        path(this.g.rays[k]!, 2);
        c.strokeStyle = PAPER;
        c.lineWidth = 1.2;
        c.stroke();
      }
      c.restore();
    }
    c.strokeStyle = PAPER;
    c.lineWidth = 10 * Math.max(0.6, s);
    c.strokeRect(mx - 14 * s, my - 14 * s, mw + 28 * s, mh + 28 * s);
    c.lineWidth = 2;
    c.strokeRect(mx - 28 * s, my - 28 * s, mw + 56 * s, mh + 56 * s);
  }

  /** The shattered glass at tz (after "at"): every wedge in flight, carrying its piece of the mirror. */
  drawShards(c: CanvasRenderingContext2D, m: MirrorAt, tz: number) {
    const g = this.g;
    const a = tz - g.hits[3]!;
    const [px, py] = g.impactAt(m);
    for (let k = 0; k < g.rays.length; k++) {
      const fl = g.flight(k, a);
      c.save();
      c.translate(px + fl.dx, py + fl.dy);
      c.rotate(fl.rot);
      c.scale(fl.grow, fl.grow);
      c.translate(-px, -py);
      g.wedge(c, k, m);
      c.save();
      c.clip();
      this.drawMirror(c, m, 9);
      c.restore();
      c.beginPath();
      c.rect(m.mx, m.my, m.mw, m.mh);
      c.clip();
      g.wedge(c, k, m);
      c.strokeStyle = BLUE;
      c.lineWidth = Math.max(4, 6 * m.s);
      c.stroke();
      c.strokeStyle = PAPER;
      c.lineWidth = 2;
      c.stroke();
      c.restore();
    }
  }
}
