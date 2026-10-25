// The ASCII fabric of the final chorus: the frame as a grid of monospace character cells (12x18 px, 160x60).
// A scene fills a Grid (a character and a tone per cell) and draws it; glyphs come from atlases of one
// monospace face, one per tone, pre-drawn once. Text can be laid into the grid as brick letters whose every
// sub-cell is a block of cells spelling the letter it belongs to (bricks breaking into code).
import { SCALE } from '@pve/engine/gl';
import { F, font } from '@pve/engine/type';
import { INK, PAPER, bricks, gray } from './_kit';

export const AW = 12, AH = 18;
export const ACOLS = 160, AROWS = 60;
/** dark to light */
export const RAMP = ' .:-=+*#%@';
const CHARS = ' .,:;-=+*#%@0123456789abcdefghijklmnopqrstuvwxyz()[]<>/\\|_!?\'"~^';
/** Cell tones: nothing (ink), a dim glyph, a bright glyph, a hole onto the blue (with a bright glyph), a solid paper block, a solid blue cell (hole with no glyph). */
export const Tone = { None: 0, Dim: 1, Bright: 2, Hole: 3, Block: 4, Blue: 5 } as const;
export type Tone = (typeof Tone)[keyof typeof Tone];

export class Grid {
  readonly ch = new Array<string>(ACOLS * AROWS).fill(' ');
  readonly tone = new Uint8Array(ACOLS * AROWS);
  clear() {
    this.ch.fill(' ');
    this.tone.fill(0);
  }
  set(col: number, row: number, ch: string, tone: Tone) {
    if (col < 0 || row < 0 || col >= ACOLS || row >= AROWS) return;
    const i = row * ACOLS + col;
    this.ch[i] = ch;
    this.tone[i] = tone;
  }
}

export class Ascii {
  private atlases: HTMLCanvasElement[] = [];
  private idx = new Map<string, number>();
  constructor() {
    [...CHARS].forEach((ch, i) => this.idx.set(ch, i));
    this.atlases = [gray(0.42), PAPER].map((color) => {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(CHARS.length * AW * SCALE);
      cv.height = Math.ceil(AH * SCALE);
      const c = cv.getContext('2d')!;
      c.scale(SCALE, SCALE);
      c.font = font(F.mono(700), 17);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = color;
      [...CHARS].forEach((ch, i) => c.fillText(ch, i * AW + AW / 2, AH / 2 + 1));
      return cv;
    });
  }

  /** One glyph at cell (col, row): `bright` picks the paper atlas over the dim one. */
  glyph(c: CanvasRenderingContext2D, ch: string, x: number, y: number, bright: boolean) {
    const i = this.idx.get(ch);
    if (i === undefined || ch === ' ') return;
    c.drawImage(this.atlases[bright ? 1 : 0]!, i * AW * SCALE, 0, AW * SCALE, AH * SCALE, x, y, AW, AH);
  }

  /** Draw the grid at (ox, oy): ink ground, holes cleared to the blue, blocks in paper, glyphs on top. */
  draw(c: CanvasRenderingContext2D, g: Grid, ox = 0, oy = 0) {
    c.fillStyle = INK;
    c.fillRect(ox, oy, ACOLS * AW, AROWS * AH);
    c.fillStyle = PAPER;
    for (let r = 0; r < AROWS; r++) for (let q = 0; q < ACOLS; q++) {
      const i = r * ACOLS + q, t = g.tone[i]!;
      if (t === Tone.None) continue;
      const x = ox + q * AW, y = oy + r * AH;
      if (t === Tone.Blue) { c.clearRect(x, y, AW, AH); continue; }
      if (t === Tone.Hole) c.clearRect(x, y, AW, AH);
      else if (t === Tone.Block) { c.fillRect(x + 1, y + 1, AW - 2, AH - 2); continue; }
      this.glyph(c, g.ch[i]!, x, y, t !== Tone.Dim);
    }
  }
}

/** A luma 0..1 as a glyph of the ramp. */
export function rampChar(l: number) {
  return RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor(l * RAMP.length)))]!;
}

/**
 * Text laid out as brick letters in cells: each brick sub-cell is s x s cells. Calls `put(col, row, ch, ci)`
 * for every cell of every brick, with the character the brick belongs to; origin (col0, row0).
 */
export function textCells(text: string, s: number, col0: number, row0: number, put: (col: number, row: number, ch: string, ci: number) => void) {
  const bt = bricks(text);
  for (const b of bt.bricks) {
    const ch = bt.text.toLowerCase()[b.ci]!;
    for (let k = 0; k < b.len; k++) for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) put(col0 + (b.cx + k) * s + dx, row0 + b.cy * s + dy, ch, b.ci);
  }
  return bt.cols * s;
}
