// The identity record of "dust" folding into the blueprint row of "flock", one picture across the clip cut.
// After the status is struck VOID the record is cut into a grid: 10 strips (one per brick row) by one column per
// syllable of "disfigured beyond recognition". Each tile pops out of the card and folds - a plain affine blend of
// its own place on the card into its place on the axonometric wall the row stands on - landing on the beat of its
// syllable. A landed tile turns to ink, the bricks of its syllable rise from it. The wave eats the card left to
// right, so the line is made of the record. dust and flock both call CardFold.draw with the same time: the frame
// is a pure function of t, so the cut shows no jump.
import { H, W } from '@pve/engine/gl';
import { ease, lerp, prog } from '@pve/engine/util';
import { BAR, BLUE, BOX_H, INK, PAPER, brickRect, bricks, gray, hashI, rebate, sylAt, type SylLine } from './_kit';

export type Iso = (x: number, y: number, z: number) => [number, number];

/** The record, in screen px. */
export const CARD = { x: 440, y: BAR + 70, w: W - 880, h: BOX_H - 140 };

const FIELDS = ['NAME', 'BORN', 'ADDRESS', 'HEIGHT', 'EYES', 'NEXT OF KIN', 'OCCUPATION', 'SIGNATURE'];
const VALUES = ['— — —', '03 · 05 · ——', 'NOWHERE IN PARTICULAR', '1 BRICK', 'CLOSED', 'NONE', 'ATONING', '(i)'];

/** The record at time tr, drawn with its top-left corner at (x, y). The status stamp, the redactions and the typed line follow the sung line. */
export function drawCard(c: CanvasRenderingContext2D, tr: number, ex: SylLine, x = CARD.x, y = CARD.y) {
  const k = sylAt(ex, tr);
  const cx = CARD.x, cy = CARD.y, cw = CARD.w, ch = CARD.h;
  c.save();
  c.translate(x - cx, y - cy);
  c.fillStyle = PAPER;
  c.fillRect(cx, cy, cw, ch);
  // the header band is inset so a paper rim keeps its edge on the black ground
  c.fillStyle = INK;
  c.fillRect(cx + 8, cy + 8, cw - 16, 56);
  rebate(c, 'RECORD OF EXISTENCE · FORM 0/1', cx + 24, cy + 32, 'left', 1);
  // the photo: a dithered square that loses its dots as the record goes
  const px = cx + 40, py = cy + 100, ps = 240;
  for (let yy = 0; yy < ps; yy += 6) for (let xx = 0; xx < ps; xx += 6) {
    const d = Math.hypot(xx - ps / 2, (yy - ps * 0.42) * 1.2) / (ps / 2);
    const face = d < 0.55 || (yy > ps * 0.72 && Math.abs(xx - ps / 2) < ps * 0.42);
    if (face && hashI(xx, yy, 33) > (k + 1) / ex.syls.length) {
      c.fillStyle = INK;
      c.fillRect(px + xx, py + yy, 5, 5);
    }
  }
  c.strokeStyle = INK;
  c.lineWidth = 2;
  c.strokeRect(px, py, ps, ps);
  // the fields, one redacted (in blue) per sung syllable
  FIELDS.forEach((name, i) => {
    const fy = cy + 100 + i * 60;
    const fx = px + ps + 50;
    rebate(c, name, fx, fy + 10, 'left', 0);
    c.fillStyle = gray(0.6);
    c.fillRect(fx, fy + 44, cw - (fx - cx) - 40, 1);
    const b = bricks(VALUES[i]!.toLowerCase());
    const cell = Math.min(3.5, 470 / b.cols);
    const textW = b.cols * cell;
    const barMaxW = Math.max(textW + 20, cw - (fx - cx) - 200);
    c.fillStyle = INK;
    for (const br of b.bricks) brickRect(c, fx + 160 + br.cx * cell, fy + 6 + br.cy * cell, br.len, cell);
    if (i <= k) {
      const s = ex.syls[i]!;
      const w = barMaxW * prog(tr, s.start, s.start + 0.12, ease.outCubic);
      c.fillStyle = BLUE;
      c.fillRect(fx + 160, fy + 4, w, 34);
    }
  });
  // the line itself, typed along the foot of the record as it is sung, sized to fit inside the card
  c.fillStyle = INK;
  const lc = Math.min(7, (cw - 80) / ex.bt.cols);
  for (const b of ex.bt.bricks) {
    const si = ex.ranges.findIndex(([a, e]) => b.ci >= a && b.ci < e);
    if (si > k) continue;
    brickRect(c, cx + 40 + b.cx * lc, cy + ch - 40 - 10 * lc + b.cy * lc, b.len, lc);
  }
  // "existence": the status is struck
  const last = ex.syls[ex.syls.length - 1]!;
  if (tr >= last.start) {
    c.save();
    c.translate(cx + cw - 300, cy + ch - 250);
    c.rotate(-0.18);
    c.strokeStyle = INK;
    c.lineWidth = 6;
    c.strokeRect(0, 0, 250, 110);
    c.fillStyle = INK;
    for (const b of bricks('void').bricks) brickRect(c, 22 + b.cx * 9, 10 + b.cy * 9, b.len, 9);
    c.restore();
  }
  c.restore();
}

/** Screen rectangle of the typed line on the record (for the lyric mark of "i am losing my existence"). */
export function cardLineRect(ex: SylLine, k: number): [number, number, number, number] {
  const lc = Math.min(7, (CARD.w - 80) / ex.bt.cols);
  const [a, e] = ex.ranges[k]!;
  return [CARD.x + 40 + ex.bt.charX[a]! * lc, CARD.y + CARD.h - 40 - 10 * lc, (ex.bt.charX[e - 1]! + ex.bt.charW[e - 1]! - ex.bt.charX[a]!) * lc, 10 * lc];
}

/** The dimension line over a row, drawn in over a third of a second (pd 0..1); its end tick and label fade in as halftone. */
export function drawDimension(c: CanvasRenderingContext2D, iso: Iso, cols: number, cell: number, text: string, pd: number) {
  const [ax0, ay0] = iso(0, 10 * cell + 30, 0), [ax1] = iso(cols * cell, 10 * cell + 30, 0);
  const xe = ax0 + (ax1 - ax0) * pd;
  c.strokeStyle = PAPER;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(ax0, ay0 - 12); c.lineTo(ax0, ay0 + 12); c.moveTo(ax0, ay0); c.lineTo(xe, ay0);
  c.stroke();
  const fa = Math.max(0, Math.min(1, (pd - 0.3) / 0.7));
  if (fa <= 0) return;
  c.save();
  c.globalAlpha *= fa;
  c.beginPath(); c.moveTo(ax1, ay0 - 12); c.lineTo(ax1, ay0 + 12); c.stroke();
  rebate(c, `L ${cols * cell}  ·  ${text.toUpperCase()}`, (ax0 + ax1) / 2, ay0 - 12, 'center', 1);
  c.restore();
}

const ROWS = 10;
const KICK = 0.12;   // s a tile pops out before it folds
const FOLD = 0.34;   // s a tile takes to fold into place
const FLIP = 0.82;   // fold progress where a tile turns to ink
type Mat = [number, number, number, number, number, number];

export class CardFold {
  /** The moment the record starts to come apart: just after the status is struck. */
  readonly t0: number;
  private cv = document.createElement('canvas');
  private drawn = false;
  /** column boundaries on the record, px from its left edge, and on the row, in cells */
  private xs: number[] = [];
  private ys: number[] = [];

  constructor(private ex: SylLine, private dl: SylLine, private cell: number) {
    this.t0 = Math.min(ex.syls[ex.syls.length - 1]!.start + 0.12, dl.syls[0]!.start - 0.12);
    this.cv.width = CARD.w;
    this.cv.height = CARD.h;
    const n = dl.syls.length, cols = dl.bt.cols;
    const x0 = (s: number) => dl.bt.charX[dl.ranges[s]![0]]!;
    const x1 = (s: number) => dl.bt.charX[dl.ranges[s]![1] - 1]! + dl.bt.charW[dl.ranges[s]![1] - 1]!;
    this.xs = [0];
    for (let s = 1; s < n; s++) this.xs.push(Math.round(((x1(s - 1) + x0(s)) / 2 / cols) * CARD.w));
    this.xs.push(CARD.w);
    this.ys = Array.from({ length: ROWS + 1 }, (_, j) => Math.round((j * CARD.h) / ROWS));
  }

  /** When the column of syllable s has landed on the slab: a wave left to right, never later than the syllable itself. */
  landT(s: number): number {
    return Math.min(this.dl.syls[s]!.start + 0.02, this.dl.syls[0]!.start + 0.02 + s * 0.08);
  }

  /** Extend the 8 redaction bars across the screen into the solid blue background of the next scene. */
  reveal(c: CanvasRenderingContext2D, tr: number, tEnd: number) {
    const p = prog(tr, this.t0, Math.min(tEnd, this.t0 + 0.45), ease.inOutCubic);
    if (p <= 0) return;
    const cx = CARD.x, cy = CARD.y, cw = CARD.w;
    const px = cx + 40, ps = 240, fx = px + ps + 50;
    const barStart = fx + 160;
    const barW = cw - (fx - cx) - 200;
    const x0 = lerp(barStart, 0, p);
    const x1 = lerp(barStart + barW, W, p);
    const w = x1 - x0;

    c.fillStyle = BLUE;
    for (let i = 0; i < 8; i++) {
      const fy = cy + 100 + i * 60 + 4;
      let y = fy - p * 13;
      let h = 34 + p * 26;
      if (i === 0) {
        y = lerp(fy, BAR, p);
        h = (fy + 34 + p * 13) - y;
      } else if (i === 7) {
        const yBot = lerp(fy + 34, H - BAR, p);
        h = yBot - y;
      }
      c.fillRect(x0, y, w, h);
    }
  }

  /** The torn tiles and the slab. Draw it under the bricks. */
  draw(c: CanvasRenderingContext2D, tr: number, iso: Iso) {
    if (tr < this.t0 - KICK) return;
    if (!this.drawn) {
      const cc = this.cv.getContext('2d')!;
      drawCard(cc, this.ex.syls[this.ex.syls.length - 1]!.start + 1, this.ex, 0, 0);
      this.drawn = true;
    }
    const { dl, cell } = this;
    const n = dl.syls.length, W3 = dl.bt.cols * cell, H3 = ROWS * cell;
    // card px -> row wall (z = 0) px, an affine map T
    const p00 = iso(0, H3, 0), p10 = iso(W3, H3, 0), p01 = iso(0, 0, 0);
    const Ta = (p10[0] - p00[0]) / CARD.w, Tb = (p10[1] - p00[1]) / CARD.w;
    const Tc = (p01[0] - p00[0]) / CARD.h, Td = (p01[1] - p00[1]) / CARD.h;
    const T: Mat = [Ta, Tb, Tc, Td, p00[0] - Ta * CARD.x - Tc * CARD.y, p00[1] - Tb * CARD.x - Td * CARD.y];
    const mcx = CARD.x + CARD.w / 2, mcy = CARD.y + CARD.h / 2;

    interface Tile { j: number; s: number; e: number; m: Mat; x: number; y: number; w: number; h: number }
    const tiles: Tile[] = [];
    for (let s = 0; s < n; s++) {
      const tl0 = this.landT(s);
      for (let j = 0; j < ROWS; j++) {
        const tl = tl0 + j * 0.01;
        const tf = Math.max(this.t0, tl - FOLD);
        const e = prog(tr, tf, tl, ease.inOutCubic);
        const kick = prog(tr, tf - KICK, tf, ease.outCubic);
        const x = CARD.x + this.xs[s]!, y = CARD.y + this.ys[j]!;
        const w = this.xs[s + 1]! - this.xs[s]!, h = this.ys[j + 1]! - this.ys[j]!;
        const mx = x + w / 2, my = y + h / 2;
        // launched toward its slot on the slab, fanned a little either side
        const tx = T[0] * mx + T[2] * my + T[4], ty = T[1] * mx + T[3] * my + T[5];
        const ang = Math.atan2(ty - my, tx - mx) + (hashI(j * 17 + s, 5) - 0.5) * 1.4;
        const mag = (40 + 80 * hashI(j * 17 + s, 6)) * kick;
        const th = (hashI(j * 17 + s, 7) - 0.5) * 0.6 * kick;
        const cs = Math.cos(th), sn = Math.sin(th);
        const ox = Math.cos(ang) * mag, oy = Math.sin(ang) * mag;
        const B: Mat = [cs, sn, -sn, cs, mx + ox - (cs * mx - sn * my), my + oy - (sn * mx + cs * my)];
        const m = B.map((v, i) => v * (1 - e) + T[i]! * e) as Mat;
        tiles.push({ j, s, e, m, x, y, w, h });
      }
    }
    const pt = (m: Mat, px: number, py: number): [number, number] => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]];
    const corners = (t: Tile) => [pt(t.m, t.x, t.y), pt(t.m, t.x + t.w, t.y), pt(t.m, t.x + t.w, t.y + t.h), pt(t.m, t.x, t.y + t.h)];
    const flat = new Map<number, Tile>();
    for (const t of tiles) if (t.e >= FLIP) flat.set(t.s * ROWS + t.j, t);

    // the slab: landed tiles in ink, the rim in paper
    c.fillStyle = INK;
    for (const t of flat.values()) {
      const q = corners(t);
      c.beginPath(); q.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fill();
      c.strokeStyle = INK; c.lineWidth = 1; c.stroke(); // closes the seams between neighbours
    }
    c.strokeStyle = PAPER;
    c.lineWidth = 1;
    c.beginPath();
    for (const t of flat.values()) {
      const q = corners(t);
      const edge = (a: number, b: number) => { c.moveTo(q[a]![0], q[a]![1]); c.lineTo(q[b]![0], q[b]![1]); };
      if (t.j === 0) edge(0, 1);
      if (t.j === ROWS - 1) edge(3, 2);
      if (t.s === 0) edge(0, 3);
      if (!flat.has((t.s + 1) * ROWS + t.j)) edge(1, 2);
    }
    c.stroke();

    // the tiles still on their way, the quiet ones first
    const moving = tiles.filter((t) => t.e < FLIP).sort((a, b) => a.e - b.e);
    c.imageSmoothingEnabled = false;
    for (const t of moving) {
      c.save();
      c.transform(t.m[0], t.m[1], t.m[2], t.m[3], t.m[4], t.m[5]);
      c.drawImage(this.cv, t.x - CARD.x, t.y - CARD.y, t.w, t.h, t.x, t.y, t.w, t.h);
      c.restore();
    }
  }
}
