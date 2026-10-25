// atone ("what i have done i can't atone" to the end of Chorus 1). Paper field, ruled like a ledger. Every
// syllable is set crisp in ink while it is sung; when it ends it becomes part of a Game of Life board and
// goes on living: what is done can't be taken back. The board steps two generations a beat, constant,
// held at 15 fps. The words that weigh most are blue (cut through to the substrate), and where they
// landed their living cells stay blue. The ledger keeps account beside it: an entry number per line in
// the margin, each finished line struck through (still there underneath), and a tally of the days going
// on, one mark a beat, down the right edge. The page is room's paper ball laid flat: it opens with the
// creases still in it; they stay a beat, then fade out in the next.
import type { Frame } from '@pve/engine/scene';
import { mark } from '@pve/engine/marks';
import { W } from '@pve/engine/gl';
import { ease, prog } from '@pve/engine/util';
import {
  BAR, BEAT, BOX_H, INK, Life, PAPER, PrintScene, brickRect, drawBars, genAt, lastBefore, readout, rebate, stepT, sylAt, sylLine,
  wrapLine, type Placed, type PrintOpts, type SylLine,
} from './_kit';
import { LEDGER, ledgerRules, pageCreases } from './_motifs';

// the ledger's grid, shared with the back of room's paper ball: Life cells of CELL px, the first line at
// (X0, Y0) cells, RIGHT cells kept free for the tally, ROW_STEP sub-cells from one text row to the next
const { cell: CELL, x0: X0, y0: Y0, right: RIGHT, rowStep: ROW_STEP } = LEDGER;
const STEPS_PER_BEAT = 2;
const SEED = 7;
const BLUE: Record<string, true> = { done: true, atone: true, days: true, "destination's": true, never: true, again: true };

interface Seed { g: number; placed: Placed[]; oy: number }
interface Row { sl: SylLine; placed: Placed[]; oy: number; rows: number; widths: number[] }
/** a blue word's landed area in Life cells */
interface BlueArea { x0: number; y0: number; x1: number; y1: number; t: number }

export default class Atone extends PrintScene {
  protected override plane = { rate: 10, guns: 0.2 };
  private life = new Life(Math.ceil(W / CELL), Math.ceil(BOX_H / CELL));
  private lines: Row[] = [];
  private seeds: Seed[] = [];
  private blue: BlueArea[] = [];
  private gen = -1;

  override init() {
    const ly = this.ctx.lyrics;
    let oy = Y0;
    for (const line of ly.linesIn(this.ctx.start, this.ctx.end)) {
      const sl = sylLine(ly, line);
      const { placed, rows, widths } = wrapLine(sl, this.life.w - X0 - RIGHT, ROW_STEP);
      this.lines.push({ sl, placed, oy, rows, widths });
      sl.syls.forEach((s, si) => {
        const mine = placed.filter((p) => p.si === si);
        this.seeds.push({ g: genAt(s.end, this.ctx.start, [STEPS_PER_BEAT], SEED), placed: mine, oy });
        if (BLUE[s.word.w.toLowerCase().replace(/’/g, "'")] && mine.length) {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const p of mine) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x + p.b.len); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y + 1); }
          this.blue.push({ x0: X0 + x0 - 2, y0: oy + y0 - 2, x1: X0 + x1 + 2, y1: oy + y1 + 2, t: s.start });
        }
      });
      oy += rows * ROW_STEP;
    }
  }

  private board(t: number) {
    const life = this.life;
    const g = genAt(t, this.ctx.start, [STEPS_PER_BEAT], SEED);
    if (g < this.gen || this.gen < 0) {
      life.seed.fill(0);
      life.reseed();
      this.gen = 0;
    }
    let board = life.at(this.gen);
    for (let gg = this.gen; gg <= g; gg++) {
      board = life.at(gg);
      // a landed syllable is written into the live board (OR, so a repeated frame changes nothing)
      for (const sd of this.seeds) if (sd.g === gg) for (const p of sd.placed) for (let j = 0; j < p.b.len; j++) {
        const x = X0 + p.x + j, y = sd.oy + p.y;
        if (x >= 0 && y >= 0 && x < life.w && y < life.h) board[y * life.w + x] = 1;
      }
    }
    this.gen = g;
    return life.at(g);
  }

  private isBlue(x: number, y: number, t: number) {
    for (const a of this.blue) if (t >= a.t && x >= a.x0 && x < a.x1 && y >= a.y0 && y < a.y1) return true;
    return false;
  }

  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    const t = f.t;
    const tl = stepT(t, 15);
    c.fillStyle = PAPER;
    c.fillRect(0, BAR, W, BOX_H);
    // the ledger: ruled lines under every text row, a margin rule
    ledgerRules(c);
    // room's paper ball was this page: its creases stay a beat, then fade
    const creases = 1 - prog(t, this.ctx.start + BEAT, this.ctx.start + 2 * BEAT);
    if (creases > 0) pageCreases(c, creases);
    const board = this.board(t);
    const life = this.life;
    for (let y = 0; y < life.h; y++) for (let x = 0; x < life.w; x++) {
      if (!board[y * life.w + x]) continue;
      if (this.isBlue(x, y, tl)) c.clearRect(x * CELL + 1, BAR + y * CELL + 1, CELL - 2, CELL - 2);
      else {
        c.fillStyle = INK;
        brickRect(c, x * CELL, BAR + y * CELL, 1, CELL, 0.12);
      }
    }
    // the syllable being sung is still crisp text; it joins the board when it ends
    const cur = lastBefore(this.lines, (l) => l.sl.line.start <= t, null);
    if (cur) {
      const k = sylAt(cur.sl, t);
      if (k >= 0 && t < cur.sl.syls[k]!.end) {
        const word = cur.sl.syls[k]!.word.w.toLowerCase().replace(/’/g, "'");
        const blue = BLUE[word] === true;
        c.fillStyle = INK;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of cur.placed) {
          if (p.si !== k) continue;
          const x = (X0 + p.x) * CELL, y = BAR + (cur.oy + p.y) * CELL;
          if (blue) c.clearRect(x, y, p.b.len * CELL, CELL);
          else brickRect(c, x, y, p.b.len, CELL);
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + p.b.len * CELL); y1 = Math.max(y1, y + CELL);
        }
        if (x1 > x0) mark(`syl:${cur.sl.syls[k]!.text}`, x0, y0, x1 - x0, y1 - y0);
      }
    }
    // margin: an entry number per line; a finished line is struck through, slowly, still readable
    this.lines.forEach((l, i) => {
      if (tl < l.sl.line.start) return;
      rebate(c, String(i + 48).padStart(4, '0'), (X0 - 4) * CELL, BAR + (l.oy + 5) * CELL, 'right', 0);
      const ps = prog(tl, l.sl.line.end, l.sl.line.end + 0.5, ease.inOutCubic);
      if (ps <= 0) return;
      c.fillStyle = INK;
      l.widths.forEach((w, r) => c.fillRect(X0 * CELL, BAR + (l.oy + r * ROW_STEP + 5) * CELL - 2, w * CELL * ps, 4));
    });
    // the tally of days: one mark a beat, a gate across every fifth, down the right edge
    const beats = Math.max(0, Math.floor((tl - this.ctx.start) / BEAT));
    // three groups of five a row (56 px each, the gate reaching 46 px) inside the free strip on the right
    const tx0 = W - RIGHT * CELL + 12, rowH = 44;
    c.fillStyle = INK;
    for (let b = 0; b < beats; b++) {
      const grp = Math.floor(b / 5), inG = b % 5;
      const gx = tx0 + (grp % 3) * 56, gy = BAR + 24 + Math.floor(grp / 3) * rowH;
      if (inG < 4) c.fillRect(gx + inG * 10, gy, 3, 30);
      else {
        c.save();
        c.translate(gx - 4, gy + 26);
        c.rotate(-0.45);
        c.fillRect(0, 0, 50, 3);
        c.restore();
      }
    }
    rebate(c, `DAYS ${String(beats).padStart(3, '0')}`, tx0, BAR + BOX_H - 24, 'left', 0);
    drawBars(c);
    // readouts: the Life of the ledger, and the syllables seeded into it so far
    let pop = 0;
    for (let i = 0; i < board.length; i++) pop += board[i]!;
    readout(c, `CHORUS 1 · LEDGER GEN ${String(this.gen).padStart(3, '0')} · POP ${String(pop).padStart(4, '0')}`, 'left');
    readout(c, `SEEDS ${String(this.seeds.filter((sd) => sd.g <= this.gen).length).padStart(2, '0')}/${this.seeds.length}`, 'right');
    return { plane: 0 };
  }
}
