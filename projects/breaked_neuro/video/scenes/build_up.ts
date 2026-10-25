// build_up ("emotion" to Chorus 2): inside the Droste fall that opened in flock (`_droste.ts`, the same
// function of song time, so the cut does not show). The levels fill the frame and beyond; we fall faster and
// faster; every word has its level and goes out past the frame with it; a few arrows fly down the tunnel
// with us round its spiral; from "inner demon" Maxwell's two sealed chambers ride in the levels. In the last
// half second Chorus 2's 4x2 grid of cells closes over the fall, its gutters opening onto the blue.
// Rates: fall 24 fps.
import type { Frame } from '@pve/engine/scene';
import { W } from '@pve/engine/gl';
import { clamp, ease, prog } from '@pve/engine/util';
import { BAR, BEAT, BLUE, BOX_H, INK, PAPER, PrintScene, drawBars, readout, stepT, type PrintOpts } from './_kit';
import { DrosteFall } from './_droste';

const OPEN = 0.45; // seconds the cells of Chorus 2 take to close over the fall

export default class BuildUp extends PrintScene {
  private fall!: DrosteFall;

  override init() {
    this.fall = new DrosteFall(this.ctx.lyrics);
    // no Life plane in the Droste: flock fades its own out while the window opens
  }

  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    const t = f.t;
    const tz = stepT(t, 24);
    c.fillStyle = INK;
    c.fillRect(0, BAR, W, BOX_H);
    this.fall.draw(c, tz);
    this.fall.drawEscorts(c, tz);
    // From the last beat in build_up, overlay the 4x2 grid cells as solid blue from left to right, top and bottom rows
    const pBlue = prog(t, this.ctx.end - BEAT, this.ctx.end);
    if (pBlue > 0) {
      this.blueGridOverlay(c, pBlue);
      this.fall.drawWords(c, tz); // "run from it" over the transition so they stay visible
    }
    drawBars(c);
    // readouts: the level we fall through and its scale, and the words sung so far (one word a level)
    const z = this.fall.z(tz);
    let words = 0;
    for (const w of this.fall.words.values()) if (w.t <= tz) words++;
    readout(c, `BUILD UP · LEVEL ${String(Math.floor(z)).padStart(2, '0')} · ${Math.pow(1 / 0.44, z).toExponential(1).toUpperCase()}×`, 'left');
    readout(c, `WORDS ${String(words).padStart(2, '0')}/${this.fall.words.size}`, 'right');
    this.fall.draw(c, tz, true); // its white words run on over the bars
    if (pBlue > 0) this.fall.drawWords(c, tz, true);
    return { plane: 0, view: { x: 0, y: 0, cell: this.fall.planeCell(tz) } };
  }

  /** Overlay the 4x2 grid cells as solid blue from left to right (top row and bottom row) over the last beat of build_up. */
  private blueGridOverlay(c: CanvasRenderingContext2D, p: number) {
    const cols = 4, rows = 2, gap = 10;
    const cw = (W - gap * (cols + 1)) / cols, ch = (BOX_H - gap * (rows + 1)) / rows;
    for (let i = 0; i < cols; i++) {
      const colP = clamp((p - i * 0.2) / 0.35, 0, 1);
      if (colP <= 0) continue;
      const ep = ease.outCubic(colP);
      const x = gap + i * (cw + gap);
      c.clearRect(x - gap, BAR, (cw + gap * 2) * ep, BOX_H);
      for (let j = 0; j < rows; j++) {
        const y = BAR + gap + j * (ch + gap);
        c.fillStyle = BLUE;
        c.fillRect(x, y, cw * ep, ch);
        c.strokeStyle = PAPER;
        c.lineWidth = 2;
        c.strokeRect(x, y, cw * ep, ch);
      }
    }
  }
}
