// The shared margin cells, pseudo-kanji atlas parameters and footer drawing of the epigone plate (epigone.ts, voice.ts).
import { H, W } from '@pve/engine/gl';
import type { Lyrics } from '@pve/engine/lyrics';
import { hash } from '@pve/engine/util';
import { INK, PAPER, rebate, statusLine } from './_page';

/** The atlas of pseudo-kanji. */
export const ATLAS_N = 120;
export const ATLAS_CELL = 96;
export const ATLAS_COLS = 12;
export const ATLAS_SEED = 8;
/** Density of the margins on the first frame of epigone, 0..1. */
export const DENS0 = 0.2;

/** A margin cell of pseudo-kanji. */
export interface Cell {
  x: number;
  y: number;
  size: number;
  /** Rank: the cell shows when the density passes it. */
  r: number;
  alpha: number;
  /** Copies between two changes of its glyph. */
  period: number;
}

/** The margins: bands of 6 columns at the sides (the inner ones only when dense), two rows top and bottom. */
export function marginCells(): Cell[] {
  const cells: Cell[] = [];
  const P = 46;
  const add = (x: number, y: number, k: number) => {
    const i = cells.length;
    cells.push({
      x: x + (hash(i, 1) - 0.5) * 5, y: y + (hash(i, 2) - 0.5) * 5,
      size: 38 + (hash(i, 3) - 0.5) * 8,
      r: hash(i, 4) * 0.75 + k * 0.05,
      alpha: hash(i, 5) < 0.2 ? 1 : 0.28 + hash(i, 6) * 0.42,
      period: 1 + Math.floor(hash(i, 7) * 3),
    });
  };
  for (let y = 70; y <= 1010; y += P) {
    for (let k = 0; k < 6; k++) { add(64 + k * P, y, k); add(W - 64 - k * P, y, k); }
  }
  for (let x = 64 + 6 * P; x <= W - 64 - 6 * P; x += P) {
    add(x, 70, 0); add(x, 116, 1); add(x, 964, 1); add(x, 1010, 0);
  }
  return cells;
}

/** Glyph g of the atlas `src`, centred on (x, y) at size s. */
export function cellGlyph(c: CanvasRenderingContext2D, src: HTMLCanvasElement, g: number, x: number, y: number, s: number) {
  c.drawImage(src, (g % ATLAS_COLS) * ATLAS_CELL, Math.floor(g / ATLAS_COLS) * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL, x - s / 2, y - s / 2, s, s);
}

/** Pseudo-kanji in the margins: denser as the plate builds (`dens` 0..1); each cell changes glyph every few copies. */
export function drawMargins(c: CanvasRenderingContext2D, src: HTMLCanvasElement, cells: Cell[], dens: number, gen: number) {
  const d = 0.1 + 0.85 * dens;
  c.save();
  cells.forEach((cell, i) => {
    if (cell.r >= d) return;
    const g = Math.floor(hash(i, Math.floor(gen / cell.period), 11) * ATLAS_N);
    c.globalAlpha = cell.alpha;
    cellGlyph(c, src, g, cell.x, cell.y, cell.size);
  });
  c.restore();
}

/** The small true marks at the foot: where they stand and the text on the right at t. */
export const FOOT = { l: 64, r: W - 64, y: H - 29 };
export const footLeft = (gen: number) => `GEN ${String(gen).padStart(2, '0')}`;
export function footRight(lyr: Lyrics, t: number): string {
  const li = lyr.lines.findLast((l) => l.start <= t + 1e-3)?.i;
  return `${li !== undefined ? `line ${li} · ` : ''}${t.toFixed(2)} s`;
}

/** The marks at the foot, each on a patch of paper. */
export function drawFoot(c: CanvasRenderingContext2D, lyr: Lyrics, t: number, gen: number) {
  const li = lyr.lines.findLast((l) => l.start <= t + 1e-3)?.i;
  statusLine(c, gen, t, '', li !== undefined ? `line ${li}` : '', INK, true);
}
