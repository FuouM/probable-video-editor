// without (Chorus 2): every line is exactly two bars, and the frame is a 4x2 grid with one cell per line, in
// order; the gutters are holes onto the blue. Each cell has its own image of its line and keeps living after
// it: "myself" keeps trading letters; the despair papers its cell and on every beat a few of its words turn
// blue; an arcade crane game grabs at prizes (bricks and letters of the song) that pile up from the bottom
// and keep raining from the top, and drops what it grabs, as cranes do; the light goes out on "light" and
// never brings the words back; a wall of eyes shuts on "sight"; on "signal" a fractal develops a level a
// beat; "falling": the whole line stands, then whole letters fall into a blue hole; Narcissus is a finger
// pointing sideways, lowered nearer and nearer to the water. "is there something to save": every cell
// closes with its own wipe (a battle transition), the line runs across the frame and a save dialog stops at
// 99 %; the echo "(save)" is not written: it flips the scene, the text turns blue.
// Rates: images 15 fps, type 24 fps, the crane 24 fps.
import type { Frame } from '@pve/engine/scene';
import { W } from '@pve/engine/gl';
import { clamp, ease, prog } from '@pve/engine/util';
import {
  BAR, BEAT, BEAT0, BLUE, BOX_H, GlyphAtlas, INK, PAPER, PrintScene, brickRect, bricks, drawBars, gray, hashI, lastBefore, readout, rebate, stepT,
  sylAt, sylLine, wrapLine, type Placed, type PrintOpts, type SylLine,
} from './_kit';
import { BAR_RECT, DIALOG, STUCK } from './_dialog';
import { mark } from '@pve/engine/marks';
import { DrosteFall } from './_droste';
import { simCrane, drawCraneGame, type CraneStep } from './_crane';
import { FRACTALS, LEVELS, drawFalling, drawNarcissus, drawEye, wipeGrid, HAND_FILL, HAND_SVG } from './_without_cells';

const COLS = 4, ROWS = 2, GAP = 10;
const CW = (W - GAP * (COLS + 1)) / COLS, CH = (BOX_H - GAP * (ROWS + 1)) / ROWS;
const CELL = 4; // px per letter sub-cell
const PAD = 24;
const CRANE = 2; // the cell with the crane game
const SAVE_CELL = 13, SAVE_X = 120; // "is there something to save": sub-cell px and left margin
const G = 1600; // px/s² for falling prizes and letters

interface Cell { sl: SylLine; placed: Placed[]; rows: number; x: number; y: number }

export default class Without extends PrintScene {
  private cells: Cell[] = [];
  private save: SylLine | null = null;
  /** each brick of the save line, and whether it belongs to the word "save" */
  private savePlaced: (Placed & { isSave: boolean })[] = [];
  private despair = new GlyphAtlas(1.5, gray(0.5)); // mid-gray: on the black cell it still prints as clear dots
  private despairBlue = new GlyphAtlas(1.6, BLUE);
  private fractalCache = new Map<string, Path2D>();
  private craneSteps: CraneStep[] = [];
  private handFill: Path2D | null = null;
  private handLine: Path2D | null = null;
  private pond = document.createElement('canvas');
  private pc!: CanvasRenderingContext2D;
  private fall!: DrosteFall;

  override init() {
    const ly = this.ctx.lyrics;
    const lines = ly.linesIn(this.ctx.start, this.ctx.end);
    lines.slice(0, COLS * ROWS).forEach((line, i) => {
      const sl = sylLine(ly, line);
      const { placed, rows } = wrapLine(sl, Math.floor((CW - 2 * PAD) / CELL), 14);
      this.cells.push({ sl, placed, rows, x: GAP + (i % COLS) * (CW + GAP), y: BAR + GAP + Math.floor(i / COLS) * (CH + GAP) });
    });
    const last = lines[COLS * ROWS];
    if (last) {
      this.save = sylLine(ly, last);
      // the echo "(save)" is not written; the first "save" is syllable echo - 1
      const echo = this.save.syls.length - 1;
      this.savePlaced = wrapLine(this.save, Math.floor((W - 2 * SAVE_X) / SAVE_CELL), 14).placed
        .filter((p) => p.si < echo)
        .map((p) => ({ ...p, isSave: p.si === echo - 1 }));
    }
    const cc = this.cells[CRANE];
    if (cc) this.craneSteps = simCrane(cc.sl.line.start, this.ctx.end, CW, CH);
    this.pond.width = Math.ceil(CW);
    this.pond.height = Math.ceil(CH);
    this.pc = this.pond.getContext('2d')!;
    this.fall = new DrosteFall(ly);
  }

  /**
   * "is there something to save": the cells close over two beats (0 open .. 1 closed), in snaps on the 16th-note grid so each
   * step of the battle wipe lands with the drums: the first on the line's downbeat, every second on an eighth, and the last,
   * which finishes it, on the beat 0.6 s later. Each snap is bigger than the one before.
   */
  private closeT(t: number) {
    if (!this.save) return 0;
    const e = t - this.save.line.start;
    if (e < 0) return 0;
    const n = Math.min(9, Math.floor(e / (BEAT / 4) + 1e-4) + 1);
    return Math.pow(n / 9, 1.5);
  }

  /** The line's words; `style(p)` may move a brick (dx in sub-cells), recolour it, or cut it as a hole. */
  private text(c: CanvasRenderingContext2D, cell: Cell, t: number, x: number, y: number, style?: (p: Placed) => { dx?: number; color?: string; hole?: boolean } | void) {
    const k = sylAt(cell.sl, t);
    for (const p of cell.placed) {
      if (p.si > k) continue;
      const s = style?.(p) ?? {};
      const bx = x + (p.x + (s.dx ?? 0)) * CELL, by = y + p.y * CELL;
      if (s.hole) {
        c.save();
        c.globalCompositeOperation = 'destination-out';
        c.fillRect(bx, by, p.b.len * CELL, CELL);
        c.restore();
      } else {
        c.fillStyle = s.color ?? PAPER;
        brickRect(c, bx, by, p.b.len, CELL);
      }
    }
    if (k >= 0) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of cell.placed) if (p.si === k) {
        const bx = x + p.x * CELL, by = y + p.y * CELL;
        x0 = Math.min(x0, bx); y0 = Math.min(y0, by); x1 = Math.max(x1, bx + p.b.len * CELL); y1 = Math.max(y1, by + CELL);
      }
      if (x1 > x0) mark(`syl:${cell.sl.syls[k]!.text}`, x0, y0, x1 - x0, y1 - y0, c);
    }
  }

  private image(c: CanvasRenderingContext2D, i: number, cell: Cell, t: number) {
    const { x, y, sl } = cell;
    const tx = x + PAD, ty = y + PAD;
    const ti = stepT(t, 15, 0); // (image gets a time held at 24 fps already: no skew)
    const k = sylAt(sl, t);
    const lastSyl = sl.syls[sl.syls.length - 1]!;
    const textH = cell.rows * 14 * CELL;
    const beat = Math.floor((ti - BEAT0) / BEAT);
    switch (i) {
      case 0: {
        // "i can't even lie to myself": the letters of "myself" trade places every beat (as holes onto the
        // blue while they are out of place) and fall back on the bar
        const word = cell.sl.bt.text.lastIndexOf('myself');
        const onBar = beat % 4 === 0;
        const perm = [0, 1, 2, 3, 4, 5].sort((a, b) => hashI(a, beat, 3) - hashI(b, beat, 3));
        this.text(c, cell, t, tx, ty, (p) => {
          if (word < 0 || onBar || p.b.ci < word || p.b.ci >= word + 6) return;
          const j = p.b.ci - word, dx = sl.bt.charX[word + perm[j]!]! - sl.bt.charX[word + j]!;
          return { dx, hole: dx !== 0 };
        });
        break;
      }
      case 1: {
        // "my despair is all that i have": the colored despairs (blue text, not solid blocks) switch rapidly on every drum transient from the drums stem
        const dtStep = 0.03;
        const nSteps = Math.max(0, Math.floor((t - sl.line.start) / dtStep));
        let drumHits = 0;
        for (let s = 1; s <= nSteps; s++) {
          const ts = sl.line.start + s * dtStep;
          const dDrums = this.ctx.audio.env('drums', ts) - this.ctx.audio.env('drums', ts - dtStep);
          if (dDrums > 0.025) drumHits++;
        }
        for (let r = 0; r < CH / 20; r++) {
          const off = (ti * 30 + r * 37) % 120;
          let px = x - off;
          for (let n = 0; px < x + CW; n++) {
            const id = r * 40 + n;
            const blue = hashI(id, drumHits, 7) < 0.24;
            const atlas = blue ? this.despairBlue : this.despair;
            for (const ch of 'despair ') px += atlas.draw(c, ch, px, y + r * 20 + 2);
          }
        }
        c.clearRect(x, ty - 10, CW, textH + 10);
        this.text(c, cell, t, tx, ty);
        break;
      }
      case 2: drawCraneGame(c, cell, t, this.craneSteps, CW, CH, CELL, PAD, (c, cell, t, x, y) => this.text(c, cell as Cell, t, x, y)); break;
      case 3: {
        // "me stay alive without a light": the light closes on "light" and NEVER reappears after the cell is finished
        const p = cell.placed.filter((q) => q.si === Math.max(0, k)).at(-1);
        const lx = p ? tx + p.x * CELL : tx, ly = p ? ty + p.y * CELL + 20 : ty;
        const out = t > lastSyl.end;
        const r = out ? 0 : 190 * (1 - prog(t, lastSyl.start, lastSyl.end, ease.inCubic));
        if (r < 0.5) break;
        c.save();
        c.beginPath(); c.arc(lx, ly, r, 0, Math.PI * 2); c.clip();
        c.clearRect(x, y, CW, CH);
        this.text(c, cell, t, tx, ty);
        c.restore();
        break;
      }
      case 4: {
        // "without a sight": the words are holes onto the blue; under them a wall of eyes looks around,
        // blinks, shuts on "sight", and after that one twitches open now and then
        this.text(c, cell, t, tx, ty, () => ({ hole: true }));
        const shut = prog(t, lastSyl.start, lastSyl.end + 0.2, ease.inOutCubic);
        for (let e = 0; e < 6; e++) {
          const ex = x + CW * (0.2 + 0.3 * (e % 3)), ey = ty + textH + 70 + Math.floor(e / 3) * 120;
          const blink = hashI(e, beat, 41) < 0.15 && ti - (BEAT0 + beat * BEAT) < 0.1;
          const twitch = t > lastSyl.end + 0.2 && hashI(e, beat, 42) < 0.12 ? 0.75 : 1;
          const open = blink ? 0.05 : Math.max(0.03, 1 - shut * twitch);
          drawEye(c, ex, ey, 62, open, hashI(e, Math.floor(ti * 2), 43), hashI(e, Math.floor(ti * 2), 44));
        }
        break;
      }
      case 5: {
        // "without a signal": halved evolution rate (one step per eighth-note, 2 beats per fractal) across 8 fractal types
        this.text(c, cell, t, tx, ty);
        const tf = stepT(t, 24, 0);
        const step = Math.max(0, Math.floor((tf - sl.line.start) / ((2 * BEAT) / LEVELS)));
        const fr = FRACTALS[Math.floor(step / LEVELS) % FRACTALS.length]!, d = step % LEVELS;
        const key = `${fr.name}${d}`;
        let path = this.fractalCache.get(key);
        if (!path) { path = fr.at(d); this.fractalCache.set(key, path); }
        const s = Math.min(CW - 2 * PAD, CH - textH - 2 * PAD - 10);
        const fx = x + (CW - s) / 2, fy = ty + textH + 10;
        c.save();
        c.translate(fx, fy);
        c.scale(s, s);
        c.globalCompositeOperation = 'destination-out';
        if (fr.fill) c.fill(path);
        else { c.lineWidth = 2.6 / s; c.stroke(path); }
        c.restore();
        rebate(c, `${fr.name} · STEP ${d + 1}/${LEVELS}`, x + PAD, y + CH - 14, 'left', 1);
        break;
      }
      case 6: drawFalling(c, cell, t, ti, CW, CH, PAD, CELL); break;
      case 7: drawNarcissus(c, cell, t, ti, CW, CH, PAD, CELL, this.pond, this.pc, (this.handFill ??= new Path2D(HAND_FILL)), (this.handLine ??= new Path2D(HAND_SVG)), (c, cell, t, x, y) => this.text(c, cell as Cell, t, x, y)); break;
    }
  }



  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    const t = f.t;
    const close = this.closeT(t);
    const flipped = this.save ? t >= this.save.syls[this.save.syls.length - 1]!.start : false;
    // Continuation of the left-to-right solid blue grid overlay from build_up until after the first beat in without
    const introOpen = prog(t, this.ctx.start, this.ctx.start + BEAT * 1.4);
    if (close < 1) {
      this.cells.forEach((cell, i) => {
        // Static cell geometry — white outlines do NOT react to the music
        const x = cell.x, y = cell.y, w = CW, h = CH;
        const col = i % COLS;
        const cellReveal = clamp((introOpen - col * 0.2) / 0.35, 0, 1);
        if (cellReveal <= 0) {
          c.fillStyle = BLUE;
          c.fillRect(x, y, w, h);
          c.strokeStyle = PAPER;
          c.lineWidth = 2;
          c.strokeRect(x, y, w, h);
          return;
        }
        c.fillStyle = INK;
        c.fillRect(x, y, w, h);
        if (t >= cell.sl.line.start) {
          c.save();
          c.beginPath(); c.rect(x, y, w, h); c.clip();
          this.image(c, i, cell, stepT(t, 24));
          c.restore();
          rebate(c, String(cell.sl.line.i).padStart(2, '0'), cell.x + CW - 16, cell.y + CH - 14, 'right', 1);
        }
        if (cellReveal < 1) {
          const bw = w * (1 - ease.inOutCubic(cellReveal));
          c.fillStyle = BLUE;
          c.fillRect(x + w - bw, y, bw, h);
        }
        c.strokeStyle = PAPER;
        c.lineWidth = 2;
        c.strokeRect(x, y, w, h);
      });
      wipeGrid(c, close);
    } else {
      if (flipped) { c.fillStyle = PAPER; c.fillRect(0, BAR, W, BOX_H); }
      else c.clearRect(0, BAR, W, BOX_H);
    }
    if (this.save && t >= this.save.line.start) this.saveLine(c, t, flipped);
    const tz = stepT(t, 24), runOn = t < this.ctx.start + 1.5; // "run from it" keeps falling at the camera through the cut
    if (runOn) this.fall.drawWords(c, tz);
    drawBars(c);
    // readouts: the cells open, and the number of the line on screen (the number in the corner of its cell)
    const line = this.save && t >= this.save.line.start ? this.save.line : lastBefore(this.cells, (cl) => cl.sl.line.start <= t).sl.line;
    readout(c, `CHORUS 2 · CELLS ${close < 1 ? this.cells.filter((cl) => t >= cl.sl.line.start).length : 0}/${this.cells.length}`, 'left');
    readout(c, `LINE ${String(line.i).padStart(2, '0')}`, 'right');
    if (runOn) this.fall.drawWords(c, tz, true);
    return { plane: 0 }; // no Life plane here: the Droste before it has none either
  }

  /**
   * "is there something to save": the line across the frame with a solid textbox background behind "IS"
   * (and active words during the wipe) so it reads clearly over the grid transition; save dialog at 99 %.
   */
  private saveLine(c: CanvasRenderingContext2D, t: number, flipped: boolean) {
    const sl = this.save!;
    const tl = stepT(t, 24), k = sylAt(sl, tl);
    const cell = SAVE_CELL, x0 = SAVE_X, y0 = BAR + 110;
    if (!flipped && k >= 0) {
      // Textbox background per started word (especially behind "IS" when the transition starts at 132.62 s)
      const bySyl = new Map<number, [number, number, number, number]>();
      for (const p of this.savePlaced) {
        if (p.si > k) continue;
        const bx = x0 + p.x * cell, by = y0 + p.y * cell;
        const r = bySyl.get(p.si);
        bySyl.set(p.si, r ? [Math.min(r[0], bx), Math.min(r[1], by), Math.max(r[2], bx + p.b.len * cell), Math.max(r[3], by + cell)] : [bx, by, bx + p.b.len * cell, by + cell]);
      }
      for (const [, [bx0, by0, bx1, by1]] of bySyl) {
        const pad = 16;
        c.fillStyle = INK;
        c.fillRect(bx0 - pad, by0 - pad, bx1 - bx0 + pad * 2, by1 - by0 + pad * 2);
        c.strokeStyle = PAPER;
        c.lineWidth = 2.5;
        c.strokeRect(bx0 - pad, by0 - pad, bx1 - bx0 + pad * 2, by1 - by0 + pad * 2);
      }
    }
    for (const p of this.savePlaced) {
      if (p.si > k || (flipped && !p.isSave)) continue;
      const bx = x0 + p.x * cell, by = y0 + p.y * cell;
      if (flipped) { c.clearRect(bx, by, p.b.len * cell - 1, cell - 1); continue; }
      c.fillStyle = INK;
      c.fillRect(bx + cell * 0.5, by + cell * 0.5, p.b.len * cell, cell);
      c.fillStyle = PAPER;
      brickRect(c, bx, by, p.b.len, cell);
    }
    if (k >= 0) {
      const si = Math.min(k, sl.syls.length - 2);
      let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
      for (const p of this.savePlaced) if (p.si === si) {
        const bx = x0 + p.x * cell, by = y0 + p.y * cell;
        sx0 = Math.min(sx0, bx); sy0 = Math.min(sy0, by); sx1 = Math.max(sx1, bx + p.b.len * cell); sy1 = Math.max(sy1, by + cell);
      }
      if (sx1 > sx0) mark(`syl:${sl.syls[k]!.text}`, sx0, sy0, sx1 - sx0, sy1 - sy0);
    }
    const first = sl.syls[sl.syls.length - 2]!;
    if (tl < first.start) return;
    const p = prog(tl, first.start, first.start + 0.5, ease.outCubic) * STUCK;
    if (!flipped) {
      const { x: bx, y: by, w: bw, h: bh } = DIALOG;
      c.fillStyle = PAPER;
      c.fillRect(bx, by, bw, bh);
      c.fillStyle = INK;
      c.fillRect(bx, by, bw, 40);
      rebate(c, 'SAVE', bx + 16, by + 20, 'left', 1);
      rebate(c, `SAVING ${Math.floor(p * 100)} %`, bx + 36, by + 176, 'left', 0);
      rebate(c, '(I).SAV', bx + bw - 36, by + 176, 'right', 0);
    }
    c.fillStyle = PAPER;
    if (!flipped) c.fillRect(BAR_RECT.x, BAR_RECT.y, BAR_RECT.w, BAR_RECT.h);
    c.strokeStyle = INK;
    c.lineWidth = 4;
    c.strokeRect(BAR_RECT.x, BAR_RECT.y, BAR_RECT.w, BAR_RECT.h);
    c.clearRect(BAR_RECT.x + 5, BAR_RECT.y + 5, (BAR_RECT.w - 10) * p, BAR_RECT.h - 10);
  }
}
