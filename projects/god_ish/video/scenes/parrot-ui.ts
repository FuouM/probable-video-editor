// What the parrot plate (parrot.ts) and the transition that ends it (divider.ts) share: the layout of the sermon
// page, the prediction fan and the candidate window.
import { H } from '@pve/engine/gl';
import { font } from '@pve/engine/type';
import { clamp, lerp, stepN } from '@pve/engine/util';
import { lineNo, units, type Lyrics } from '@pve/engine/lyrics';
import { fnt, INK, MONO, PAPER, RED, SERIF } from './_page';
import type { Cand } from './parrot-ngram';
import type { ImeCand } from './parrot-ime';

/** Type step: everything that moves on the plate moves in these steps. */
export const FPS = 24;
/** Steps (24 fps) from an onset to t. */
export const age = (t: number, at: number) => stepN(t, FPS) - stepN(at, FPS);
/** Index of the last time in sorted `ts` at or before t, -1 before the first. */
export function lastAt(ts: number[], t: number): number {
  let lo = 0, hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export const TOP = 150;
export const SIZE = 50;
export const ROW = 56;
export const MAX_ROWS = 13;
export const X0 = 1660;
export const COL_STEP = 92;
export const LINE_STEP = 112;
/** The composing reading. */
export const READ_SIZE = 38;
/** Candidate window: width, row height, gap from the cursor and between two windows, p = 1 bar. */
export const WW = 280;
export const RH = 46;
export const W_GAP = 44;
export const W_SEP = 18;
export const BAR = 64;
/** The prediction fan: glyphs shown, angle between two rays, radius. */
export const FAN = 11;
const FAN_STEP = 0.17;
const FAN_R = 560;

/** A candidate window: its rows by rank, the sung row, and each row's place in table order. */
export interface Win { cands: ImeCand[]; row: number; table: number[] }

/** A prediction fan, laid out: its origin at the cursor and each glyph at the end of its ray. */
export interface FanItem { ch: string; p: number; x: number; y: number; size: number }
export interface FanSet { ox: number; oy: number; items: FanItem[]; after: string }

export type Mode = 'ink' | 'red' | 'cut';

/**
 * A fan laid out from the cursor (ox, oy): rank 1 on the axis, then alternately below and above, each a little
 * further out. The axis points left toward the middle of the frame. Glyph size grows with p.
 */
export function fanSet(ox: number, oy: number, dist: Cand[], after: string): FanSet {
  const p0 = dist[0]!.p;
  const axis = Math.atan2(H / 2 - 20 - oy, -720);
  const items = dist.map((d, k) => {
    const o = k === 0 ? 0 : k % 2 ? (k + 1) / 2 : -k / 2;
    const th = axis + o * FAN_STEP;
    const r = FAN_R + 40 * Math.abs(o);
    const size = Math.round(26 + 62 * Math.sqrt(d.p / p0));
    return {
      ch: d.ch, p: d.p, size,
      x: ox + r * Math.cos(th), y: clamp(oy + r * Math.sin(th), 120 + size / 2, H - 170 - size / 2),
    };
  });
  // rays that run into the top or bottom limit stack their glyphs on one row: slide a glyph (with its label)
  // sideways, away from the origin's side, until it stands clear of the glyphs before it
  const LABEL_W = 78, LABEL_H = 24;
  const box = (it: FanItem) => ({ w: Math.max(it.size * 1.3, LABEL_W), h: it.size * 1.3 + LABEL_H });
  for (let k = 1; k < items.length; k++) {
    const it = items[k]!;
    const b = box(it);
    for (let pass = 0; pass < 8; pass++) {
      let moved = false;
      for (let j = 0; j < k; j++) {
        const o = items[j]!;
        const ob = box(o);
        if (Math.abs(o.x - it.x) < (ob.w + b.w) / 2 && Math.abs(o.y - it.y) < (ob.h + b.h) / 2) {
          it.x = Math.min(it.x, o.x - (ob.w + b.w) / 2);
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
  return { ox, oy, items, after };
}

/** Where a unit of the sermon stands: its column x, the top y of its cell and the cells it takes. */
export interface Cell { x: number; y: number; rows: number }

/**
 * The sermon page: lines `first`..`last` set in vertical columns from the right, a line in one column or, when
 * it is longer than MAX_ROWS, in two. `x` is the first column of the line, `cells` the units of the line.
 */
export function placeSermon(L: Lyrics, first: number, last: number): { x: number; cells: Cell[] }[] {
  const out: { x: number; cells: Cell[] }[] = [];
  let x = X0;
  for (let i = first; i <= last; i++) {
    const us = units(lineNo(L, i));
    const rows = us.map((u) => [...u.glyph].length);
    const total = rows.reduce((a, b) => a + b, 0);
    const perCol = total > MAX_ROWS ? Math.ceil(total / 2) : total;
    const line = { x, cells: [] as Cell[] };
    let row = 0;
    us.forEach((_, k) => {
      if (row > 0 && row + rows[k]! > perCol) { x -= COL_STEP; row = 0; }
      line.cells.push({ x, y: TOP + row * ROW, rows: rows[k]! });
      row += rows[k]!;
    });
    out.push(line);
    x -= LINE_STEP;
  }
  return out;
}

/**
 * A candidate window with its right edge at `right`, top near `top`: rank, glyph, p bar and p per row, the
 * highlighted row inverted (ink, red ink, or cut out of a paper bar on the red). `pop`: steps since it
 * opened (0 small, 1 a size up, then in place); `sort` 0..1 from table order to rank order; `fold` 0..1 the
 * rows close onto the highlighted one. Returns its left edge.
 */
export function drawWindow(
  c: CanvasRenderingContext2D, win: Win, hi: number, right: number, top: number, mode: Mode, pop: number,
  sort: number, fold: number,
): number {
  const n = win.cands.length;
  const x0 = right - WW;
  const y0 = windowTop(n, top);
  const fg = mode === 'cut' ? PAPER : INK;
  const sc = pop === 0 ? 0.72 : pop === 1 ? 1.06 : 1;
  const bt = y0 + hi * RH * fold;
  const bh = ((n - 1) * (1 - fold) + 1) * RH + 12;
  c.save();
  c.translate(right, y0);
  c.scale(sc, sc);
  c.translate(-right, -y0);
  if (mode !== 'cut') {
    c.fillStyle = PAPER;
    c.fillRect(x0, bt, WW, bh);
  }
  c.strokeStyle = fg;
  c.lineWidth = 1.5;
  c.strokeRect(x0 + 0.75, bt + 0.75, WW - 1.5, bh - 1.5);
  const row = (k: number) => {
    const cd = win.cands[k]!;
    const r = lerp(lerp(win.table[k]!, k, sort), hi, fold);
    const ry = y0 + 6 + r * RH;
    const cy = ry + RH / 2;
    c.save();
    if (k === hi) {
      c.fillStyle = mode === 'red' ? RED : fg;
      c.fillRect(x0 + 5, ry + 1, WW - 10, RH - 2);
      if (mode === 'cut') c.globalCompositeOperation = 'destination-out';
      c.fillStyle = mode === 'cut' ? INK : PAPER;
    } else {
      c.fillStyle = PAPER;
      if (mode !== 'cut') c.fillRect(x0 + 5, ry + 1, WW - 10, RH - 2);
      c.fillStyle = fg;
    }
    c.textBaseline = 'middle';
    c.textAlign = 'right';
    c.font = font(MONO, 15);
    c.fillText(`${cd.rank}.`, x0 + 40, cy);
    c.textAlign = 'left';
    c.font = fnt(SERIF, 32, 500);
    c.fillText(cd.s, x0 + 50, cy + 1);
    const bx = right - 58 - BAR;
    c.globalAlpha = k === hi ? 1 : 0.35;
    c.fillRect(bx, cy + 7, BAR, 1);
    c.globalAlpha = 1;
    c.fillRect(bx, cy - 4, Math.max(1, Math.min(1, cd.p) * BAR), 8);
    c.textAlign = 'right';
    c.font = font(MONO, 12);
    c.fillText(cd.p.toFixed(3), right - 10, cy);
    c.restore();
  };
  if (fold < 1) for (let k = 0; k < n; k++) if (k !== hi) row(k);
  row(hi);
  c.restore();
  return x0 - W_SEP;
}

/** The top of a window of n rows asked for at `top`: it stays on the page. */
export function windowTop(n: number, top: number): number {
  return Math.max(TOP - 20, Math.min(top, H - 150 - (n * RH + 12)));
}
