// intro (0 – Verse 1): the end of the previous loop. Black void, the blue through one module-sized hole.
// Part 1: the hole is the first cell of an R-pentomino; from bar 1 it blooms through the void as holes
// onto the blue at one constant rate, two generations a beat, to the last frame (the title breaking
// apart does not stop it). Rebate readouts count it.
// Part 2: BREAKED emerges as a whole, a scatter of bricks that only reads near the end; every brick
// registers in with hairlines through its edges and its index; a capline, a baseline and one stem per
// letter draw in like a construction drawing. Red herrings from later plates flash on the low hits.
// Last bar: the 256 sub-cells burst outward, hang, and fly one for one into the first sung lyric, the
// "i" high on the wall of Verse 1, where walls takes it over on its first frame.
import type { Frame } from '@pve/engine/scene';
import { mark } from '@pve/engine/marks';
import { ease, prog } from '@pve/engine/util';
import { H, W } from '@pve/engine/gl';
import { BEAT, BEAT0, INK, Life, PAPER, PrintScene, bricks, brickRect, gray, hashI, readout, rebate, stepT, type PrintOpts } from './_kit';
import { FIRST_I, I_CELLS, ceilingGrid } from './_motifs';

const barT = (b: number) => BEAT0 + b * 4 * BEAT;
const LC = 16; // px per bloom cell
const LW = Math.ceil(W / LC), LH = Math.ceil(H / LC);
const HOLE = { x: 77, y: 25 }; // the first blue cell, in bloom cells
const R_PENTOMINO = [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]];
const CELL = 32; // title sub-cell px

interface Flyer { sx: number; sy: number; ex: number; ey: number; tx: number; ty: number; t0: number }

export default class Intro extends PrintScene {
  private bloom = new Life(LW, LH);
  private flyers: Flyer[] = [];
  private x0 = 0;
  private y0 = 0;
  private title = bricks('breaked');
  private tPack = barT(15);

  override init() {
    for (const [dx, dy] of R_PENTOMINO) this.bloom.seed[(HOLE.y + dy!) * LW + HOLE.x + dx!] = 1;
    this.x0 = Math.round((W - this.title.cols * CELL) / 2);
    this.y0 = Math.round(H / 2 - (10 * CELL) / 2);
    // the sub-cells, left to right; they take the slots of him top to bottom, so B is his head
    const src: { sx: number; sy: number }[] = [];
    for (const b of this.title.bricks) for (let k = 0; k < b.len; k++) src.push({ sx: b.cx + k, sy: b.cy });
    src.sort((a, b) => a.sx - b.sx || a.sy - b.sy);
    const cx = this.x0 + (this.title.cols * CELL) / 2, cy = this.y0 + 5 * CELL;
    src.forEach((s, n) => {
      const slot = I_CELLS[n]!;
      const px = this.x0 + s.sx * CELL, py = this.y0 + s.sy * CELL;
      // the burst: outward from the word's centre, a little, with a jitter
      const a = Math.atan2(py - cy, px - cx) + (hashI(n, 3) - 0.5) * 0.9;
      const d = 30 + 120 * hashI(n, 4);
      this.flyers.push({
        sx: px, sy: py, ex: px + Math.cos(a) * d, ey: py + Math.sin(a) * d,
        tx: FIRST_I.x + slot.i * FIRST_I.m, ty: FIRST_I.y + slot.j * FIRST_I.m,
        // the i builds from the top down
        t0: this.tPack + 0.32 + (slot.j / 40) * 0.42 + hashI(n, 5) * 0.06,
      });
    });
  }

  /** Bloom generations at t: none before bar 1, then two a beat to the end. */
  private gen(t: number) {
    const b = (stepT(t, 15) - barT(1)) / BEAT;
    return b <= 0 ? 0 : Math.floor(b * 2);
  }

  /** Time a title brick of rank r appears: the share of bricks shown grows as the cube of the time. */
  private appearT(r: number) {
    return barT(5) + Math.cbrt(r) * (this.tPack - 0.15 - barT(5));
  }

  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    const t = f.t;
    c.fillStyle = INK;
    c.fillRect(0, 0, W, H);
    const bar = Math.floor((t - BEAT0) / (4 * BEAT));

    // part 1: the hole and its bloom (holes onto the blue), held at 15 fps
    const g = this.gen(t);
    const board = this.bloom.at(g);
    let pop = 0;
    if (g === 0) {
      // before the bloom the single hole blinks off on every beat
      const inBeat = (stepT(t, 12) - BEAT0) / BEAT;
      if (t < BEAT0 || inBeat - Math.floor(inBeat) > 0.25) c.clearRect(HOLE.x * LC, HOLE.y * LC, LC, LC);
      pop = 1;
    } else {
      for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
        if (!board[y * LW + x]) continue;
        c.clearRect(x * LC + 1, y * LC + 1, LC - 2, LC - 2);
        pop++;
      }
    }

    // red herrings: fragments of later plates on the low hits, held under a beat, at 12 fps
    const th = stepT(t, 12);
    const inBar = th - barT(bar);
    if ([4, 10, 14].includes(bar) && inBar < 0.25) {
      c.save();
      c.beginPath();
      c.rect(300, 250, 330, 150);
      c.clip();
      ceilingGrid(c, th, 465, 470, 0.55, 1.6);
      c.restore();
    }

    const tt = stepT(t, 12);
    if (t < this.tPack) this.drawConstruction(c, tt);
    else this.drawPack(c, stepT(t, 24));

    // readouts: what runs, and the countdown that lies (the outro ends on this frame 0)
    readout(c, `R-PENTOMINO · B3/S23 · GEN ${String(g).padStart(4, '0')} · POP ${String(pop).padStart(4, '0')}`, 'left');
    readout(c, String(Math.max(0, 16 - bar)).padStart(2, '0'), 'right');
    // the noise fades in from the loop seam: the outro's last frame has none either
    return { noise: prog(t, 0, 0.6) };
  }

  /** Part 2: the title registering in, brick by brick, with its construction lines. */
  private drawConstruction(c: CanvasRenderingContext2D, tt: number) {
    const { x0, y0, title } = this;
    const right = x0 + title.cols * CELL;
    // capline and baseline draw in from the left over two bars, then hold
    const pl = prog(tt, barT(5), barT(7), ease.outCubic);
    if (pl > 0) {
      c.fillStyle = gray(0.55);
      c.fillRect(0, y0 - 1, W * pl, 1);
      c.fillRect(0, y0 + 10 * CELL, W * pl, 1);
      rebate(c, 'CAP', 72, y0 - 12, 'left', 1);
      rebate(c, 'BASE', 72, y0 + 10 * CELL + 12, 'left', 1);
    }
    // one stem per letter, one a bar from bar 7, with its letter
    for (let k = 0; k < 7; k++) {
      if (tt < barT(7 + k)) break;
      const x = x0 + title.charX[k]! * CELL;
      c.fillStyle = gray(0.4);
      c.fillRect(x, y0 - 90, 1, 10 * CELL + 180);
      rebate(c, `${'BREAKED'[k]} · ${String(title.charX[k]).padStart(2, '0')}`, x + 6, y0 - 80, 'left', 1);
    }
    title.bricks.forEach((b, i) => {
      const ta = this.appearT(hashI(i, 5));
      const bx = x0 + b.cx * CELL, by = y0 + b.cy * CELL;
      if (tt < ta - 0.17) return;
      if (tt < ta) {
        // registration: the brick's outline, two frames before it lands
        c.strokeStyle = gray(0.7);
        c.lineWidth = 1;
        c.strokeRect(bx + 0.5, by + 0.5, b.len * CELL - 1, CELL - 1);
        return;
      }
      if (tt < ta + 0.25) {
        // hairlines through its edges for three frames, and its index
        c.fillStyle = gray(0.75);
        c.fillRect(0, by, W, 1);
        c.fillRect(bx, 0, 1, H);
        rebate(c, String(i).padStart(3, '0'), Math.min(bx + b.len * CELL + 6, right + 10), by - 8, 'left', 1);
      }
      c.fillStyle = PAPER;
      brickRect(c, bx, by, b.len, CELL);
    });
  }

  /** The pack: the bricks break into their sub-cells, burst outward, hang, and fly into the wall's first "i". */
  private drawPack(c: CanvasRenderingContext2D, tp: number) {
    c.fillStyle = PAPER;
    const pb = prog(tp, this.tPack, this.tPack + 0.3, ease.outCubic);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of this.flyers) {
      const pf = prog(tp, s.t0, s.t0 + 0.42, ease.inOutCubic);
      const bx = s.sx + (s.ex - s.sx) * pb, by = s.sy + (s.ey - s.sy) * pb;
      const sz = CELL - (CELL - 18) * pb;
      const cell = sz + (FIRST_I.m - sz) * pf, x = bx + (s.tx - bx) * pf, y = by + (s.ty - by) * pf;
      brickRect(c, x, y, 1, cell, 0.14 + 0.1 * (1 - pf));
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + cell); y1 = Math.max(y1, y + cell);
    }
    // the cells on their way: `first-i` (the same box as walls' once they have all landed)
    if (this.flyers.length) mark('first-i', x0, y0, x1 - x0, y1 - y0, c);
  }
}
