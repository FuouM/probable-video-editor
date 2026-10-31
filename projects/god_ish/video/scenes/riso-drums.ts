// The four drums of the riso plate: fluorescent pink, yellow, medium blue and black, packed into the page in
// the code of _era_riso.ts: on an opaque black ground the pink drum adds red, yellow adds green, blue adds blue
// (alpha is coverage, so a translucent ink is a tint the shader screens into dots), and the black drum lowers
// alpha by a quarter (alpha 1 - 0.25 k). Holes (alpha 0, cut after `end`) stay holes onto the red substrate.
// The three colour drums draw straight into the page with `lighter`: each adds to its own channel only. The
// black drum has its own canvas, because it knocks shapes out of itself (っぽいな out of the slab). Where pink
// and yellow must not overprint, the shader knocks the pink out of the yellow (see _era_riso.ts). A colour drum
// knocks a shape out of itself with `knock` ('difference' with its own full ink removes only its channel).
import { H, SCALE, scaleContext2D, W } from '@pve/engine/gl';

export type Drum = 'pink' | 'yellow' | 'blue';
const CODE: Record<Drum, string> = { pink: '255,0,0', yellow: '0,255,0', blue: '0,0,255' };

/** The fill of drum `d` at coverage `a` (1: solid, below 1: a tint). */
export const ink = (d: Drum, a = 1) => `rgba(${CODE[d]},${a})`;

/**
 * Knock the shapes that `draw` fills out of colour drum `d` on page `c` (inside a print): 'difference' with the
 * drum's full ink clears its own channel where it was solid and leaves the other drums.
 */
export function knock(c: CanvasRenderingContext2D, d: Drum, draw: () => void) {
  c.save();
  c.globalCompositeOperation = 'difference';
  c.fillStyle = ink(d);
  draw();
  c.restore();
}

export class Drums {
  /** The black drum: draw in any opaque colour, alpha is coverage. */
  readonly black: CanvasRenderingContext2D;
  private blackEl: HTMLCanvasElement;

  constructor() {
    this.blackEl = document.createElement('canvas');
    this.blackEl.width = Math.round(W * SCALE);
    this.blackEl.height = Math.round(H * SCALE);
    // a CPU canvas like the page (Layer2D): drawing it into the page needs no GPU readback
    this.black = scaleContext2D(this.blackEl.getContext('2d', { willReadFrequently: true })!, SCALE);
  }

  /** Start a print on page `c`: the black ground, then the colour drums add with `lighter` until `end`. */
  begin(c: CanvasRenderingContext2D) {
    this.black.clearRect(0, 0, W, H);
    c.save();
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = '#000000';
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'lighter';
  }

  /** End the print: the black drum lowers the page alpha. */
  end(c: CanvasRenderingContext2D) {
    c.restore();
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.globalAlpha = 0.25;
    c.drawImage(this.blackEl, 0, 0, W, H);
    c.restore();
  }
}
