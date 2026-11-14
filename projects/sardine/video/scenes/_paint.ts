import type { Cell, LitAtlas, Painter } from '@pve/engine/lit';

/** One scatter of colour over a cell: the colour, the probability of a texel and the seed (`Painter.speckle`). */
export type Speck = readonly [colour: string, k: number, seed: number];

/**
 * Paints a new `w` x `h` cell of the atlas: a fill of `base`, then each scatter of `specks` in order, then `then` (lines, marks) over them.
 */
export function speckled(A: LitAtlas, w: number, h: number, base: string, specks: readonly Speck[], then?: (p: Painter) => void): Cell {
  return A.paint(w, h, (p) => {
    p.fill(base);
    for (const [c, k, seed] of specks) p.speckle(c, k, seed);
    if (then) then(p);
  });
}
