// The machine voice (treatment.md, "The machine voice"): the page is cut open, red takes the frame, and the call is
// cut out of the red in Fraktur, so its letters show the page beneath. Then the page closes over the red again from
// the bottom edge in hard 12 fps steps, a quarter of the frame or less per step (no feathering, no fade, rule 11).
// Use: draw the page that should show through the letters, then drawCall over it, then the rebates.
import { H, W, scaleContext2D } from '@pve/engine/gl';
import { FRAKTUR, fnt } from './_page';

/** Where the call is set: (x, y) is the baseline anchor of `align`; size in px. */
export interface CallSet {
  x: number;
  y: number;
  size: number;
  align?: CanvasTextAlign;
}

/** Set `text` in Fraktur as large as it fits between left and right (at most maxSize), baseline y, left aligned. */
export function fitCall(c: CanvasRenderingContext2D, text: string, left: number, right: number, y: number, maxSize = 420): CallSet {
  c.font = fnt(FRAKTUR, 100);
  const w = c.measureText(text).width;
  return { x: left, y, size: Math.min(maxSize, Math.floor(((right - left) / w) * 100)) };
}

/**
 * How far the page has closed at t, in hard 12 fps steps over the last `dur` s before `end`:
 * 0 = open (only the letters), 1 = closed (the whole page) for the last step.
 */
export function closeAt(t: number, end: number, dur = 0.35): number {
  const n = Math.floor(dur * 12);
  const k = Math.floor((end - t) * 12);
  return k >= n ? 0 : 1 - Math.max(0, k) / n;
}

let mask: HTMLCanvasElement | null = null;
let mctx: CanvasRenderingContext2D | null = null;
/** What the mask holds: the call, its setting and the close step (the letters at 420 px are costly to fill). */
let maskKey = '';

/**
 * Cut the page on `c` open: everything outside the letters of `text` becomes a hole onto the red. `close` (0..1,
 * see closeAt) is how much of the page, from the bottom edge up, is whole again; at 1 nothing is cut.
 * Composites in place; the page must already be drawn.
 */
export function drawCall(c: CanvasRenderingContext2D, text: string, close: number, set: CallSet) {
  if (close >= 1) return;
  const bw = c.canvas.width;
  const bh = c.canvas.height;
  if (!mask || mask.width !== bw || mask.height !== bh) {
    mask = document.createElement('canvas');
    mask.width = bw;
    mask.height = bh;
    mctx = scaleContext2D(mask.getContext('2d', { willReadFrequently: true })!, bw / W);
    maskKey = '';
  }
  const key = `${text}|${close}|${set.x},${set.y},${set.size},${set.align ?? 'left'}`;
  if (key !== maskKey) {
    maskKey = key;
    const m = mctx!;
    m.clearRect(0, 0, W, H);
    m.fillStyle = '#000';
    m.fillRect(0, Math.round(H * (1 - close)), W, H);
    m.font = fnt(FRAKTUR, set.size);
    m.textAlign = set.align ?? 'left';
    m.textBaseline = 'alphabetic';
    m.fillText(text, set.x, set.y);
  }
  c.save();
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(mask, 0, 0, W, H);
  c.restore();
}
