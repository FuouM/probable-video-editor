// Plate 2 · Broadsheet: the body text. Small Mincho columns, set right to left tier by tier, then into the
// margins. The text is the song so far, reprinted (copies of earlier lines). Every column is set once at init with
// the faults of its sorts baked in; a frame prints the first n columns from that set (no state between frames).
import { H, SCALE, W } from '@pve/engine/gl';
import { hash } from '@pve/engine/util';
import { vcells } from '@pve/engine/type';
import { SERIF } from './_page';
import { frameCanvas, sort } from './broadsheet-type';

export type Rect = [x0: number, y0: number, x1: number, y1: number];
/** One column of body text: centre x, top y, glyphs n, size. */
export interface Slot { x: number; y: number; n: number; size: number }

const SIZE = 16;
const PITCH = 20;
/** The tiers (段) of the page: top y of each, height TIER. */
export const TIER = 150;
export const TIERS = [72, 228, 384, 540, 696, 852];
/** Body area between the left margin and the masthead. */
export const BODY_X: [number, number] = [160, 1640];

/** One sort of the body: its column (slot index), glyph (vertical form), centre and size, as the plate sets it. */
export interface BodyCell { col: number; ch: string; small: boolean; x: number; y: number; size: number; w: number; seed: number }

/** The columns of the body and every sort in them, in the order the press sets them (see Body). */
export function bodyLayout(text: string, reserved: Rect[], sheet: Rect): { slots: Slot[]; inTiers: number; cells: BodyCell[] } {
  const slots: Slot[] = [];
  const n = Math.floor(TIER / SIZE);
  for (const y of TIERS) {
    for (let x = BODY_X[1] - PITCH / 2; x > BODY_X[0]; x -= PITCH) {
      const r: Rect = [x - PITCH / 2, y, x + PITCH / 2, y + TIER];
      if (!reserved.some((q) => q[0] < r[2] && r[0] < q[2] && q[1] < r[3] && r[1] < q[3])) slots.push({ x, y, n, size: SIZE });
    }
  }
  const inTiers = slots.length;
  // the margins, in the order the press reaches them: right, top, left, bottom
  const [sx0, sy0, sx1, sy1] = sheet;
  for (const x of [sx1 - 12, sx1 - 30]) for (const y of TIERS) slots.push({ x, y, n, size: SIZE });
  for (let x = sx1 - 12; x > sx0; x -= PITCH) slots.push({ x, y: sy0 + 4, n: 2, size: SIZE });
  for (const x of [sx0 + 30, sx0 + 12]) for (const y of TIERS) slots.push({ x, y, n, size: SIZE });
  for (let x = sx1 - 12; x > sx0; x -= PITCH) slots.push({ x, y: sy1 - 36, n: 2, size: SIZE });

  const cells: BodyCell[] = [];
  const glyphs = [...text];
  let g = 0;
  slots.forEach((s, i) => {
    const drift = (hash(i, 77) - 0.5) * 2.5; // the whole column slips in the chase
    const w = 0.2 + 0.6 * hash(i, 78);
    let top = s.y;
    for (let k = 0; k < s.n; k++) {
      const ch = glyphs[g++ % glyphs.length]!;
      const cell = vcells(ch, () => 1)[0];
      if (!cell) { k--; continue; }
      cells.push({ col: i, ch: cell.ch, small: cell.small, x: s.x + drift, y: top + s.size / 2, size: s.size, w, seed: i * 101 + k });
      top += s.size;
    }
  });
  return { slots, inTiers, cells };
}

export class Body {
  private slots: Slot[] = [];
  private set = frameCanvas();
  /** Columns in the tiers; the rest are the margins. */
  readonly inTiers: number;

  constructor(text: string, reserved: Rect[], sheet: Rect) {
    const lay = bodyLayout(text, reserved, sheet);
    this.slots = lay.slots;
    this.inTiers = lay.inTiers;
    // set every column once
    const c = this.set.c;
    for (const s of lay.cells) sort(c, s.ch, s.x, s.y, s.size, SERIF, 500, s.w, s.seed, false, s.small);
  }

  get count() { return this.slots.length; }

  /**
   * Print the first n columns. Neighbour columns of one row go as one rectangle: the set canvas is bare where no
   * column is (the reserved boxes too), so the rectangle prints the same as its columns one by one.
   */
  print(c: CanvasRenderingContext2D, n: number) {
    const k = Math.min(n, this.slots.length);
    let run: [x0: number, x1: number, y: number, h: number] | null = null;
    const flush = () => {
      if (!run) return;
      const x0 = Math.max(0, run[0]), y0 = Math.max(0, run[2]);
      const w = Math.min(W, run[1]) - x0, h = Math.min(H - y0, run[3]);
      c.drawImage(this.set.el, x0 * SCALE, y0 * SCALE, w * SCALE, h * SCALE, x0, y0, w, h);
    };
    for (let i = 0; i < k; i++) {
      const s = this.slots[i]!;
      const x0 = s.x - PITCH / 2 - 2, x1 = s.x + PITCH / 2 + 2, y = s.y - 2, h = s.n * s.size + 4;
      // the next column to the left in the same row (columns run right to left)
      if (run && run[2] === y && run[3] === h && x1 >= run[0] && x0 <= run[0]) run[0] = x0;
      else {
        flush();
        run = [x0, x1, y, h];
      }
    }
    flush();
  }
}
