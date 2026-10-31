// Plate 2 · Broadsheet: the type. A sort is one piece of movable type: it prints with the loss of its wear (kerning
// drift, tilt, starved ink, squash, nicks of bare paper). Wood type (夢, THE END) prints with its grain. Ruby is
// read from the sung syllables, not typed.
import { H, makeCanvas, SCALE, scaleContext2D, W } from '@pve/engine/gl';
import { hash } from '@pve/engine/util';
import { rubyOf, type Syl, type WrittenUnit } from '@pve/engine/lyrics';
import { vcells } from '@pve/engine/type';
import { fnt, INK, PAPER, SERIF, tone } from './_page';

/** Wear of a sort after `age` impressions: 0 new .. 1 worn. */
export const wear = (age: number) => Math.min(1, Math.max(0, age) / 36);

/** A canvas of the logical frame size, for one layer of the plate. */
export function frameCanvas() {
  const { cv: el, c } = makeCanvas();
  return { el, c };
}

/**
 * One sort: `ch` centred at (x, cy) with the loss of wear `w` (0..1). `seed` makes its own faults.
 * rot: a Latin run turned 90°. small: a small kana, high and right.
 */
export function sort(
  c: CanvasRenderingContext2D, ch: string, x: number, cy: number, size: number, family: string, weight: number,
  w: number, seed: number, rot = false, small = false,
) {
  const dx = (hash(seed, 1) - 0.5) * size * 0.08 * w;
  const dy = (hash(seed, 2) - 0.5) * size * 0.08 * w;
  const tilt = (hash(seed, 3) - 0.5) * 0.06 * w;
  const starved = w > 0 && hash(seed, 4) < 0.05 + 0.25 * w;
  c.save();
  c.translate(x + dx + (small ? size * 0.12 : 0), cy + dy - (small ? size * 0.1 : 0));
  c.rotate(tilt + (rot ? Math.PI / 2 : 0));
  c.font = fnt(family, size, weight);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = starved ? tone(0.32) : INK;
  c.fillText(ch, 0, 0);
  if (w > 0.04) {
    // ink squash: the face spreads under pressure (four offset fills: the glyph cache, not a stroked path)
    const d = size * 0.0125 * w;
    c.fillText(ch, d, 0);
    c.fillText(ch, -d, 0);
    c.fillText(ch, 0, d);
    c.fillText(ch, 0, -d);
  }
  // worn face: nicks of bare paper
  const nicks = Math.floor(w * 6 * hash(seed, 5));
  c.fillStyle = PAPER;
  for (let k = 0; k < nicks; k++) {
    const nx = (hash(seed, 10 + k) - 0.5) * size * 0.7;
    const ny = (hash(seed, 20 + k) - 0.5) * size * 0.7;
    c.fillRect(nx, ny, size * (0.03 + 0.06 * hash(seed, 30 + k)), size * (0.015 + 0.02 * hash(seed, 40 + k)));
  }
  c.restore();
}

// ---------- a vertical column of sung units ----------
export interface ColumnOpts {
  size: number; family: string; weight: number;
  /** Units to draw: visible at t when their onset has passed. */
  idx: number[];
  t: number;
  /** Wear of a unit from its onset. */
  wearOf: (start: number) => number;
  seed: number;
  syls: Syl[];
}

/** Sets the sung units `idx` of a line down a column centred on x from top y, with ruby on the right. */
export function column(c: CanvasRenderingContext2D, us: WrittenUnit[], x: number, y: number, o: ColumnOpts): number {
  c.font = fnt(o.family, o.size, o.weight);
  let top = y;
  for (const i of o.idx) {
    const u = us[i]!;
    const cells = vcells(u.glyph, (s) => c.measureText(s).width / o.size);
    const span = cells.reduce((a, k) => a + k.adv * o.size, 0);
    if (u.start <= o.t) {
      const w = o.wearOf(u.start);
      let ct = top;
      cells.forEach((cell, k) => {
        const adv = cell.adv * o.size;
        sort(c, cell.ch, x, ct + adv / 2, o.size, o.family, o.weight, w, o.seed + i * 17 + k, cell.rot, cell.small);
        ct += adv;
      });
      const r = rubyOf(u, o.syls);
      if (r) {
        const rs = o.size * 0.3;
        const ry = top + span / 2 - (r.length * rs) / 2;
        [...r].forEach((ch, k) => sort(c, ch, x + o.size * 0.66, ry + rs * (k + 0.5), rs, o.family, 500, w, o.seed + i * 31 + k + 900));
      }
    }
    top += span;
  }
  return top;
}

/** A small EN gloss, wrapped to maxW, from (x, y) down. `slip`: on a slip of paper. Returns the y below. */
export function gloss(c: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size = 17, slip = false): number {
  c.font = fnt(SERIF, size, 500);
  c.textAlign = 'left';
  c.textBaseline = 'top';
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && c.measureText(next).width > maxW) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  for (const l of lines) {
    if (slip) {
      c.fillStyle = PAPER;
      c.fillRect(x - 5, y - 3, c.measureText(l).width + 10, size * 1.25 + 2);
    }
    c.fillStyle = INK;
    c.fillText(l, x, y);
    y += size * 1.25;
  }
  return y;
}

/** A boxed stop-press column: bare paper with a double rule. */
export function box(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  c.fillStyle = PAPER;
  c.fillRect(x0, y0, x1 - x0, y1 - y0);
  c.strokeStyle = INK;
  c.lineWidth = 3;
  c.strokeRect(x0 + 1.5, y0 + 1.5, x1 - x0 - 3, y1 - y0 - 3);
  c.lineWidth = 1;
  c.strokeRect(x0 + 6.5, y0 + 6.5, x1 - x0 - 13, y1 - y0 - 13);
}

// ---------- wood type ----------
/**
 * Wood type: the face is filled on its own layer, then the grain of the block is cut into it (streaks of bare
 * paper or starved ink that follow the wood), then the layer prints onto the page.
 */
export class Wood {
  private l = frameCanvas();
  /** The box of the last block printed: all the layer holds (null: the whole frame). */
  private last: [number, number, number, number] | null = null;
  /** What the layer holds now (see `begin`). */
  private key: string | null = null;

  /**
   * Start a block that shows `key`: the layer to draw it on, or null when the layer already holds that block
   * (then only print it).
   */
  begin(key: string): CanvasRenderingContext2D | null {
    if (key === this.key) return null;
    this.key = key;
    const c = this.l.c;
    const [x0, y0, x1, y1] = this.last ?? [0, 0, W, H];
    c.save();
    c.globalCompositeOperation = 'source-over';
    c.clearRect(x0, y0, x1 - x0, y1 - y0);
    c.restore();
    return c;
  }

  /**
   * Cut the grain into what is on the layer, over the box (x0..x1, y0..y1) of the block of type size `size`.
   * `starved`: some streaks print as starved ink, not bare paper.
   */
  grain(x0: number, y0: number, x1: number, y1: number, size: number, seed: number, starved = true) {
    const c = this.l.c;
    c.save();
    c.globalCompositeOperation = 'source-atop';
    const sp = Math.max(3, size * 0.022);
    const ya = Math.max(y0, -sp * 2), yb = Math.min(y1, H + sp * 2);
    const xa = Math.max(x0, 0), xb = Math.min(x1, W);
    const k0 = Math.floor((ya - y0) / sp), k1 = Math.ceil((yb - y0) / sp);
    for (let k = k0; k <= k1; k++) {
      const h1 = hash(seed, k), h2 = hash(seed, k, 7);
      if (h1 < 0.35) continue;
      const base = y0 + k * sp;
      const amp = sp * (0.4 + 1.6 * h2);
      const fr = (0.6 + h1) / size * 9;
      c.strokeStyle = !starved || h2 < 0.55 ? PAPER : tone(0.62);
      c.lineWidth = sp * (0.12 + 0.3 * hash(seed, k, 3));
      c.beginPath();
      for (let x = xa; x <= xb + 16; x += 16) {
        const y = base + amp * Math.sin(x * fr + h1 * 40) + sp * 0.5 * Math.sin(x * fr * 3.1 + h2 * 20);
        if (x === xa) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    // a knot or two: rings of grain
    for (let n = 0; n < 2; n++) {
      const kx = x0 + (x1 - x0) * (0.2 + 0.6 * hash(seed, 50 + n)), ky = y0 + (y1 - y0) * (0.2 + 0.6 * hash(seed, 60 + n));
      c.strokeStyle = PAPER;
      c.lineWidth = sp * 0.2;
      for (let r = 1; r <= 4; r++) {
        c.beginPath();
        c.ellipse(kx, ky, sp * r * 1.6, sp * r * 0.7, 0, 0, Math.PI * 2);
        c.stroke();
      }
    }
    c.restore();
  }

  /**
   * Print the block onto the page. `op`: how the ink sits on what is printed already. `box`: where the block
   * lies (its face, ruby and grain); only that part of the layer is printed and cleared for the next block.
   */
  print(dst: CanvasRenderingContext2D, box: [number, number, number, number], op: GlobalCompositeOperation = 'source-over') {
    const x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1]));
    const x1 = Math.min(W, Math.ceil(box[2])), y1 = Math.min(H, Math.ceil(box[3]));
    this.last = [x0, y0, x1, y1];
    if (x1 <= x0 || y1 <= y0) return;
    dst.save();
    dst.globalCompositeOperation = op;
    dst.drawImage(this.l.el, x0 * SCALE, y0 * SCALE, (x1 - x0) * SCALE, (y1 - y0) * SCALE, x0, y0, x1 - x0, y1 - y0);
    dst.restore();
  }
}

/**
 * Latin wood type, drawn: a heavy condensed gothic (the poster face of the press), letters T H E N D.
 * Adds each letter as its own filled path at (x, y) top-left, cap height h. Returns the x after the run.
 */
export function latinWood(c: CanvasRenderingContext2D, text: string, x: number, y: number, h: number, fill: string): number {
  const s = h * 0.2, b = h * 0.17, gap = h * 0.07;
  c.fillStyle = fill;
  for (const ch of text) {
    let w = h * 0.6;
    c.beginPath();
    if (ch === 'T') {
      c.rect(x, y, w, b);
      c.rect(x + (w - s) / 2, y, s, h);
    } else if (ch === 'H') {
      c.rect(x, y, s, h);
      c.rect(x + w - s, y, s, h);
      c.rect(x, y + (h - b) / 2, w, b);
    } else if (ch === 'E') {
      w = h * 0.5;
      c.rect(x, y, s, h);
      c.rect(x, y, w, b);
      c.rect(x, y + (h - b) / 2, w * 0.86, b);
      c.rect(x, y + h - b, w, b);
    } else if (ch === 'N') {
      c.rect(x, y, s, h);
      c.rect(x + w - s, y, s, h);
      c.moveTo(x, y);
      c.lineTo(x + s * 1.15, y);
      c.lineTo(x + w, y + h);
      c.lineTo(x + w - s * 1.15, y + h);
      c.closePath();
    } else if (ch === 'D') {
      const r = w * 0.48, ri = Math.max(1, r - s * 0.9);
      c.moveTo(x, y);
      c.lineTo(x + w - r, y);
      c.arcTo(x + w, y, x + w, y + r, r);
      c.lineTo(x + w, y + h - r);
      c.arcTo(x + w, y + h, x + w - r, y + h, r);
      c.lineTo(x, y + h);
      c.closePath();
      // the counter
      const ix0 = x + s, iy0 = y + b, ix1 = x + w - s, iy1 = y + h - b;
      c.moveTo(ix0, iy0);
      c.lineTo(ix1 - ri, iy0);
      c.arcTo(ix1, iy0, ix1, iy0 + ri, ri);
      c.lineTo(ix1, iy1 - ri);
      c.arcTo(ix1, iy1, ix1 - ri, iy1, ri);
      c.lineTo(ix0, iy1);
      c.closePath();
    } else if (ch === ' ') {
      x += h * 0.3;
      continue;
    }
    c.fill(ch === 'D' ? 'evenodd' : 'nonzero');
    x += w + gap;
  }
  return x - gap;
}
