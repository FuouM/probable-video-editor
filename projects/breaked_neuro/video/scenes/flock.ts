// flock (Verse 4): a blueprint. Paper linework on the blue: a bordered sheet with zones, a dot grid, a
// parts list, a detail view, a plan of the frame and a title block. The sung lines stand as extruded bricks
// in axonometric, one row each, inside the 2.39:1 box, and stay: "disfigured beyond recognition" (the
// pencil that the record of dust became writes it in as it is sung; every syllable knocks its bricks out
// of true), "it is my admission" and "deconstruction".
// "de": a section cut A-A through the word and the letters part a little. "con": the parts tremble.
// "struc": they shake harder and the sheet kicks. "tion": the exploded view, wide, with leader lines and
// part numbers, and the parts take off as a flock of birds, each leaving a fine Game of Life trail.
// "and let everything stop in motion": the Droste window opens at the centre (`_droste.ts`), every word
// from "and" on a level of its own, and we start to fall in. The birds never stop: from "stop" they turn
// into warhead glyphs and dive into the window a group an eighth, on dashed ballistic arcs; a few of them
// become the arrows that fly down the tunnel with us (build_up carries on with the same fall).
// The flock is a fixed-step simulation (30 Hz) cached forward and recomputed after a seek back, so every
// frame is a function of t. Rates: sheet and birds at 24 fps, the trail steps at 15.
import type { Frame } from '@pve/engine/scene';
import { H, W } from '@pve/engine/gl';
import { clamp, ease, prog } from '@pve/engine/util';
import {
  BAR, BEAT, BOX_H, INK, Life, PAPER, PrintScene, drawBars, hashI, lastBefore, readout, rebate, stepT, sylAt, sylLine, sylOfChar,
  type PrintOpts, type SylLine,
} from './_kit';
import { CardFold, drawDimension } from './_cardfold';
import { DIVE, DrosteFall, drawWarhead } from './_droste';
import { mark } from '@pve/engine/marks';

const CELL = 15;
const COS = Math.cos(Math.PI / 6), SIN = Math.sin(Math.PI / 6);
const TRAIL = 4; // px per trail cell
const DT = 1 / 30;
const LINE = (a: number) => `rgba(243,240,234,${a})`; // paper linework; partial alpha screens over the blue
const COLX = 1420; // the schematics column

/** A bird: flocking from its launch out of the word, then (from `dive`) a warhead on its arc into the window. */
interface Bird { launch: number; x: number; y: number; vx: number; vy: number; on: boolean; dive: number; dx: number; dy: number; escort: number }
const ESCORT_BIRDS = 7; // birds that become the arrows flying down the tunnel (escorts of `DrosteFall`)
/** A row of the sheet: a line as extruded bricks, its origin and scale. */
interface Row { sl: SylLine; ox: number; oy: number; sc: number }

export default class Flock extends PrintScene {
  protected override plane = { rate: 15 };
  private rows: Row[] = [];
  private decon!: SylLine;
  private birds: Bird[] = [];
  private life = new Life(Math.ceil(W / TRAIL), Math.ceil(BOX_H / TRAIL));
  private step = -1;
  private gen = 0;
  private tDe = 0;
  private tCon = 0;
  private tStruc = 0;
  private tTion = 0;
  private fall!: DrosteFall;
  private fold!: CardFold;
  private trailCanvas = document.createElement('canvas');
  private trailCtx!: CanvasRenderingContext2D;
  private trailImg!: ImageData;

  override init() {
    const ly = this.ctx.lyrics;
    const fit = (sl: SylLine, w: number) => Math.min(0.8, w / (sl.bt.cols * CELL * COS));
    const dis = sylLine(ly, 'disfigured beyond recognition');
    const adm = sylLine(ly, 'it is my admission');
    this.fold = new CardFold(sylLine(ly, 'i am losing my existence'), dis, CELL);
    this.decon = sylLine(ly, 'deconstruction');
    this.rows = [
      { sl: dis, ox: 110, oy: 360, sc: fit(dis, 1250) },
      { sl: adm, ox: 110, oy: 560, sc: fit(adm, 1000) },
      { sl: this.decon, ox: 160, oy: 780, sc: fit(this.decon, 1100) },
    ];
    const [de, con, struc, tion] = this.decon.syls;
    this.tDe = de!.start;
    this.tCon = con!.start;
    this.tStruc = struc!.start;
    this.tTion = tion!.start;
    this.fall = new DrosteFall(ly);
    // The birds launch on "tion" (103.52 s), turn into arrows on "and let", and fly completely out of bounds
    // BEFORE "everything stop in" (this.fall.tStop = 105.18 s)!
    const n = this.decon.bt.bricks.length;
    this.birds = Array.from({ length: n }, (_, i) => {
      const launch = this.tTion + 0.12 + hashI(i, 21) * 0.28;
      const dive = this.tTion + 0.55 + hashI(i, 25) * 0.45;
      return { launch, x: 0, y: 0, vx: 0, vy: 0, on: false, dive, dx: 0, dy: 0, escort: -1 };
    });
    this.trailCanvas.width = this.life.w;
    this.trailCanvas.height = this.life.h;
    this.trailCtx = this.trailCanvas.getContext('2d')!;
    this.trailImg = this.trailCtx.createImageData(this.life.w, this.life.h);
    const d = this.trailImg.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = 11; d[i + 1] = 12; d[i + 2] = 13; }
  }

  /** Screen position of an axonometric point (x right-down, z left-down, y up) on a row. */
  private iso(r: Row, x: number, y: number, z: number): [number, number] {
    return [r.ox + (x - z) * COS * r.sc, r.oy + ((x + z) * SIN * 0.55 - y) * r.sc];
  }

  /** The exploded view: 0.15 after "de" (the letters part), 1 after "tion" (the parts thrown wide). */
  private explode(t: number) {
    return 0.15 * prog(t, this.tDe, this.tDe + 0.2, ease.outCubic) + 0.85 * prog(t, this.tTion, this.tTion + 0.25, ease.outBack);
  }

  /** Where part i of "deconstruction" is at t: home, parted by letter, thrown along one axis, trembling. */
  private partPos(i: number, t: number): [number, number, number] {
    const br = this.decon.bt.bricks[i]!;
    const e = this.explode(t);
    const ax = Math.floor(hashI(i, 4) * 3);
    const thrown = Math.max(0, (e - 0.15) / 0.85) * (60 + 220 * hashI(i, 6)) * (hashI(i, 8) < 0.5 ? -1 : 1);
    const amp = t >= this.tStruc && t < this.tTion ? 16 : t >= this.tCon && t < this.tTion ? 8 : 0;
    const shake = amp ? (hashI(i, Math.floor(t * 24), 9) - 0.5) * amp : 0;
    const hx = br.cx * CELL + br.ci * Math.min(e, 0.15) * 40, hy = (9 - br.cy) * CELL;
    return [hx + (ax === 0 ? thrown : 0) + shake, hy + (ax === 1 ? Math.abs(thrown) * 1.2 : 0), (ax === 2 ? thrown : 0) + shake];
  }

  /** Advance the flock and its trail to the simulation step for t (cached; a seek back starts over). */
  private simulate(t: number) {
    const target = Math.floor((t - this.tTion) / DT);
    if (target < this.step || this.step < 0) {
      this.step = 0;
      this.gen = 0;
      for (const b of this.birds) b.on = false;
      this.life.seed.fill(0);
      this.life.reseed();
    }
    let board = this.life.at(this.gen);
    const r = this.rows[2]!;
    while (this.step < target) {
      const ts = this.tTion + this.step * DT;
      // launch: a part becomes a bird where it stands
      this.birds.forEach((b, i) => {
        if (b.on || ts < b.launch) return;
        const [x, y, z] = this.partPos(i, b.launch);
        [b.x, b.y] = this.iso(r, x, y, z);
        b.vx = 120 + hashI(i, 30) * 160;
        b.vy = -220 - hashI(i, 31) * 200;
        b.on = true;
      });
      // boids: cohesion, alignment, separation, and a goal that sweeps round the sheet and then curves organically out of bounds
      const a = ts - this.tTion;
      const exit = Math.max(0, a - 0.65);
      const gx = W / 2 + Math.cos(a * 1.8) * 560 + exit * exit * 2600;
      const gy = BAR + BOX_H / 2 - Math.sin(a * 1.8) * 240 - exit * exit * 1500;
      for (const b of this.birds) {
        if (!b.on) continue;
        let cx = 0, cy = 0, ax = 0, ay = 0, sx = 0, sy = 0, n = 0;
        for (const o of this.birds) {
          if (o === b || !o.on) continue;
          const dx = o.x - b.x, dy = o.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 > 160 * 160) continue;
          cx += o.x; cy += o.y; ax += o.vx; ay += o.vy; n++;
          if (d2 < 28 * 28) { sx -= dx / (d2 + 1) * 420; sy -= dy / (d2 + 1) * 420; }
        }
        const pull = ts >= b.dive ? 2.4 : 0.9;
        let fx = (gx - b.x) * pull, fy = (gy - b.y) * pull;
        if (n) { fx += (cx / n - b.x) * 1.5 + (ax / n - b.vx) * 1.1; fy += (cy / n - b.y) * 1.5 + (ay / n - b.vy) * 1.1; }
        fx += sx * 30; fy += sy * 30;
        b.vx += fx * DT; b.vy += fy * DT;
        const maxSp = ts >= b.dive ? 1650 : 580;
        const sp = Math.hypot(b.vx, b.vy) || 1, lim = Math.min(Math.max(sp, 260), maxSp);
        b.vx *= lim / sp; b.vy *= lim / sp;
      }
      for (const b of this.birds) {
        if (!b.on) continue;
        b.x += b.vx * DT; b.y += b.vy * DT;
      }
      this.step++;
      // the trail: every other step (15 Hz) the board steps and each bird drops a live cell where it is
      if (this.step % 2 === 0) {
        this.gen++;
        board = this.life.at(this.gen);
        for (const b of this.birds) {
          if (!b.on) continue;
          const x = Math.floor(b.x / TRAIL), y = Math.floor((b.y - BAR) / TRAIL);
          if (x >= 0 && y >= 0 && x < this.life.w - 1 && y < this.life.h - 1) {
            board[y * this.life.w + x] = 1; board[y * this.life.w + x + 1] = 1; board[(y + 1) * this.life.w + x] = 1;
          }
        }
      }
    }
    return board;
  }

  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    const t = f.t;
    const tb = stepT(t, 24);
    // "struc" kicks the sheet
    const kick = tb >= this.tStruc && tb < this.tStruc + 0.15 ? (1 - (tb - this.tStruc) / 0.15) * 16 : 0;
    c.save();
    c.translate((hashI(Math.round(tb * 24), 1) - 0.5) * 2 * kick, (hashI(Math.round(tb * 24), 2) - 0.5) * 2 * kick);
    // blueprint comes in as a halftone fade from the clip start, schematics half a beat later
    c.globalAlpha = this.bpFade(t, 0);
    this.sheet(c, tb);
    c.globalAlpha = this.bpFade(t, 0.15);
    this.schematics(c, tb);
    c.globalAlpha = 1;

    // the trail
    if (tb >= this.tTion) {
      const board = this.simulate(tb);
      const d = this.trailImg.data;
      for (let i = 0; i < board.length; i++) d[i * 4 + 3] = board[i] ? 255 : 0;
      this.trailCtx.putImageData(this.trailImg, 0, 0);
      c.imageSmoothingEnabled = false;
      c.drawImage(this.trailCanvas, 0, BAR, W, BOX_H);
    }

    // Rows 0 and 1 inside the sheet (under the bars)
    this.rows.forEach((r, ri) => {
      if (tb < r.sl.line.start - 0.1 && ri > 0) return;
      if (ri === 2) this.aux(c, r, ri, tb); // its bricks come after the bars
      else this.row(c, r, ri, tb);
    });
    c.restore();

    // "and let everything stop in motion": the Droste window opens at the centre and we start to fall in
    if (tb >= this.fall.tOpen) {
      this.fall.draw(c, tb);
      this.fall.drawEscorts(c, tb);
    }
    drawBars(c);
    // readouts: the rows drawn and the birds in the frame; the generation of their trail
    const flying = tb >= this.tTion ? this.birds.filter((b) => b.on && b.x >= -80 && b.x <= W + 80 && b.y >= -80 && b.y <= H + 80).length : 0;
    readout(c, `VERSE 4 · ROWS ${this.rows.filter((r) => tb >= r.sl.line.start).length}/${this.rows.length} · BIRDS ${String(flying).padStart(2, '0')}`, 'left');
    readout(c, `TRAIL GEN ${String(tb >= this.tTion ? this.gen : 0).padStart(4, '0')}`, 'right');
    if (tb >= this.fall.tOpen) this.fall.draw(c, tb, true); // its white words run on over the bars

    // Row 2 ("DECONSTRUCTION") drawn AFTER drawBars so it sits cleanly over the bottom black bar
    c.save();
    c.translate((hashI(Math.round(tb * 24), 1) - 0.5) * 2 * kick, (hashI(Math.round(tb * 24), 2) - 0.5) * 2 * kick);
    const r2 = this.rows[2]!;
    if (tb >= r2.sl.line.start - 0.1) this.row(c, r2, 2, tb);
    c.restore();

    // The flock, over the bars: birds, and from "stop" they become arrows and fly off out of bounds
    if (tb >= this.tTion) this.flock(c, tb);
    const fadeIn = this.bpFade(t, 0);
    const plane = 0.6 * fadeIn * (1 - prog(tb, this.fall.tOpen, this.fall.tCut));
    // the sideway clumps come in one by one with the sheet (the kill run backwards)
    return { plane, clumpKill: 1 - fadeIn, view: { x: 0, y: 0, cell: this.fall.planeCell(tb) } };
  }

  /** Blueprint fade-in from the clip start (+ d s): a quarter on the first frame, full in 4 steps over one beat. */
  private bpFade(t: number, d: number) {
    const u = t - this.ctx.start - d;
    return u < 0 ? 0 : Math.min(1, (1 + Math.floor((u / BEAT) * 3)) / 4);
  }

  /** The sheet: dot grid, border with zones, title block. */
  private sheet(c: CanvasRenderingContext2D, tb: number) {
    c.fillStyle = LINE(0.4);
    for (let y = BAR + 40; y < H - BAR; y += 40) for (let x = 40; x < W; x += 40) c.fillRect(x, y, 2, 2);
    const x0 = 36, y0 = BAR + 24, x1 = W - 36, y1 = H - BAR - 24;
    c.strokeStyle = PAPER;
    c.lineWidth = 3;
    c.strokeRect(x0, y0, x1 - x0, y1 - y0);
    c.lineWidth = 1;
    c.strokeRect(x0 + 10, y0 + 10, x1 - x0 - 20, y1 - y0 - 20);
    for (let k = 0; k <= 8; k++) {
      const x = x0 + ((x1 - x0) * k) / 8;
      c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y0 + 10); c.moveTo(x, y1 - 10); c.lineTo(x, y1); c.stroke();
      if (k < 8) rebate(c, String(k + 1), x + (x1 - x0) / 16, y0 + 5, 'center', 1);
    }
    for (let k = 0; k <= 4; k++) {
      const y = y0 + ((y1 - y0) * k) / 4;
      c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + 10, y); c.moveTo(x1 - 10, y); c.lineTo(x1, y); c.stroke();
      if (k < 4) rebate(c, 'ABCD'[k]!, x0 + 5, y + (y1 - y0) / 8, 'center', 1);
    }
    // title block
    const bw = 470, bh = 110, bx = x1 - 10 - bw, by = y1 - 10 - bh;
    c.lineWidth = 1.5;
    c.strokeRect(bx, by, bw, bh);
    c.beginPath();
    c.moveTo(bx, by + 40); c.lineTo(bx + bw, by + 40);
    c.moveTo(bx, by + 75); c.lineTo(bx + bw, by + 75);
    c.moveTo(bx + 240, by + 40); c.lineTo(bx + 240, by + bh);
    c.stroke();
    rebate(c, 'BREAKED · (I) · DECONSTRUCTION ASSEMBLY', bx + 12, by + 20, 'left', 1);
    rebate(c, `PARTS ${this.decon.bt.bricks.length}   SCALE 1:${(1 / this.rows[2]!.sc).toFixed(2)}`, bx + 12, by + 58, 'left', 1);
    rebate(c, `SHEET 23 / 41   REV ${String.fromCharCode(65 + Math.max(0, sylAt(this.decon, tb)))}`, bx + 252, by + 58, 'left', 1);
    rebate(c, 'DRAWN: B3/S23', bx + 12, by + 93, 'left', 1);
    rebate(c, `T ${tb.toFixed(2)} S`, bx + 252, by + 93, 'left', 1);
  }

  /** The right column: a parts list that fills as parts are numbered, a detail view, a plan of the frame. */
  private schematics(c: CanvasRenderingContext2D, tb: number) {
    const x0 = COLX, w = W - 60 - COLX;
    c.strokeStyle = PAPER;
    c.lineWidth = 1;
    // parts list: a row per letter of "deconstruction", ticked as each is sung
    const y0 = BAR + 60, rh = 17;
    c.strokeRect(x0, y0, w, rh * 16);
    rebate(c, 'ITEM  PART             QTY', x0 + 8, y0 + rh / 2, 'left', 1);
    const letters = 'deconstruction';
    const k = sylAt(this.decon, tb);
    for (let i = 0; i < letters.length; i++) {
      const y = y0 + rh * (i + 1);
      c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + w, y); c.stroke();
      const qty = this.decon.bt.bricks.filter((b) => b.ci === i).length;
      const done = sylOfChar(this.decon, i) <= k && k >= 0;
      rebate(c, `${String(i + 1).padStart(3, '0')}   BRICK "${letters[i]!.toUpperCase()}"${' '.repeat(9)}${String(qty).padStart(2, '0')}${done ? '  ✓' : ''}`, x0 + 8, y + rh / 2, 'left', 1);
    }
    // detail B: one brick magnified in a circle, with its section hatch
    const dcx = x0 + 90, dcy = y0 + rh * 16 + 120, dr = 80;
    c.beginPath(); c.arc(dcx, dcy, dr, 0, Math.PI * 2); c.stroke();
    c.strokeRect(dcx - 50, dcy - 22, 100, 44);
    c.save();
    c.beginPath(); c.rect(dcx - 50, dcy - 22, 100, 44); c.clip();
    c.beginPath();
    for (let d = -60; d < 120; d += 9) { c.moveTo(dcx - 50 + d, dcy + 22); c.lineTo(dcx - 50 + d + 44, dcy - 22); }
    c.stroke();
    c.restore();
    rebate(c, 'DETAIL B · 4:1', dcx, dcy + dr + 14, 'center', 1);
    // plan of the frame: a square of parts with dimension lines, the frame they will build
    const px = x0 + 200, py = dcy - 70, ps = 140;
    c.setLineDash([12, 4, 3, 4]);
    c.beginPath(); c.moveTo(px - 10, py + ps / 2); c.lineTo(px + ps + 10, py + ps / 2); c.moveTo(px + ps / 2, py - 10); c.lineTo(px + ps / 2, py + ps + 10); c.stroke();
    c.setLineDash([]);
    c.strokeRect(px, py, ps, ps);
    for (let i = 0; i < 28; i++) {
      const d = (i / 28) * 4, side = Math.floor(d), f = d - side;
      const [x, y] = side === 0 ? [px + f * ps, py] : side === 1 ? [px + ps, py + f * ps] : side === 2 ? [px + ps - f * ps, py + ps] : [px, py + ps - f * ps];
      c.fillStyle = PAPER;
      c.fillRect(x - 3, y - 3, 6, 6);
    }
    rebate(c, 'PLAN · FRAME 0', px + ps / 2, py + ps + 22, 'center', 1);
  }

  /** The drawing aids of a row: its dimension line, and on "deconstruction" the section cut A-A, which ends when the parts take off. */
  private aux(c: CanvasRenderingContext2D, r: Row, ri: number, tb: number) {
    const sl = r.sl, isDecon = ri === 2;
    if (isDecon && tb >= this.tTion) return;
    // Dimension line over the row, drawn in over a third of a second, at the earliest with the sheet
    const d0 = Math.max(sl.line.start - 0.1, this.ctx.start);
    drawDimension(c, (x, y, z) => this.iso(r, x, y, z), sl.bt.cols, CELL, sl.line.text, prog(tb, d0, d0 + 0.35, ease.outCubic));
    // section cut A-A through "deconstruction" from "de"
    if (isDecon && tb >= this.tDe) {
      c.save();
      c.globalAlpha *= (1 + Math.floor(prog(tb, this.tDe, this.tDe + BEAT) * 3)) / 4; // halftone fade in 4 steps over a beat
      const [sx0, sy0] = this.iso(r, sl.bt.cols * CELL * 0.43, -30, 0), [sx1, sy1] = this.iso(r, sl.bt.cols * CELL * 0.43, 10 * CELL + 10, 0);
      c.setLineDash([18, 6, 4, 6]);
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(sx0, sy0); c.lineTo(sx1, sy1); c.stroke();
      c.setLineDash([]);
      rebate(c, 'A', sx0 + 10, sy0 + 10, 'left', 1);
      rebate(c, 'A', sx1 + 10, sy1 - 10, 'left', 1);
      c.restore();
    }
  }

  /** One row: its extruded bricks; "deconstruction" explodes and flies. */
  private row(c: CanvasRenderingContext2D, r: Row, ri: number, tb: number) {
    const sl = r.sl, isDecon = ri === 2;
    const k = sylAt(sl, tb);
    if (!isDecon) this.aux(c, r, ri, tb); // row 2's aids are drawn in the sheet pass, under the Droste and the bars

    const e = isDecon ? this.explode(tb) : 0;
    if (ri === 0) this.fold.draw(c, tb, (x, y, z) => this.iso(r, x, y, z));
    const parts: { d: number; i: number; pos: [number, number, number]; len: number; lit: boolean }[] = [];
    sl.bt.bricks.forEach((br, i) => {
      if (isDecon && tb >= this.birds[i]!.launch) return; // it flies now
      const si = sylOfChar(sl, br.ci);
      if (si > k && !(tb > sl.line.end)) return; // not sung yet: only the slab is there
      let pos: [number, number, number];
      if (isDecon) pos = this.partPos(i, tb);
      else {
        const s = sl.syls[Math.max(0, si)]!;
        const hit = ri === 0 ? prog(tb, s.start + 0.06, s.end + 0.06, ease.outBack) : 0;
        pos = [br.cx * CELL + hit * (hashI(i, 40) - 0.5) * 22, (9 - br.cy) * CELL + hit * (hashI(i, 41) - 0.5) * 18, hit * (hashI(i, 42) - 0.5) * 36];
      }
      parts.push({ d: pos[0] + pos[2], i, pos, len: br.len, lit: true });
    });
    // what is sung, on screen: each syllable's bricks
    const boxes = new Map<number, [number, number, number, number]>();
    for (const p of parts) {
      const si = sylOfChar(sl, sl.bt.bricks[p.i]!.ci);
      const [x0, y0] = this.iso(r, p.pos[0], p.pos[1] + CELL, p.pos[2]), [x1, y1] = this.iso(r, p.pos[0] + p.len * CELL, p.pos[1], p.pos[2] + CELL);
      const b = boxes.get(si);
      boxes.set(si, b ? [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)] : [x0, y0, x1, y1]);
    }
    for (const [si, [x0, y0, x1, y1]] of boxes) mark(`syl:${sl.syls[si]!.text}`, x0, y0, x1 - x0, y1 - y0, c);
    parts.sort((a, b) => a.d - b.d).forEach((p) => {
      const sy = sl.syls[Math.max(0, sylOfChar(sl, sl.bt.bricks[p.i]!.ci))]!;
      const L = p.len * CELL, D = ri === 0 ? CELL * prog(tb, sy.start, sy.start + 0.12, ease.outCubic) : CELL;
      const P = (x: number, y: number, z: number) => this.iso(r, p.pos[0] + x, p.pos[1] + y, p.pos[2] + z);
      if (e > 0.3) {
        const br = sl.bt.bricks[p.i]!;
        const [a0, a1] = this.iso(r, br.cx * CELL, (9 - br.cy) * CELL, 0), [b0, b1] = P(0, 0, 0);
        c.strokeStyle = LINE(0.7);
        c.setLineDash([3, 4]);
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(a0, a1); c.lineTo(b0, b1); c.stroke();
        c.setLineDash([]);
      }
      const poly = (pts: [number, number][], fill: string) => {
        c.fillStyle = fill;
        c.beginPath(); pts.forEach((q, j) => (j ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.closePath(); c.fill();
        c.strokeStyle = PAPER; c.lineWidth = 1; c.stroke();
      };
      // faces: the front solid paper, the sides in screens of paper over the blue
      poly([P(0, 0, 0), P(L, 0, 0), P(L, CELL, 0), P(0, CELL, 0)], PAPER);
      poly([P(0, CELL, 0), P(L, CELL, 0), P(L, CELL, D), P(0, CELL, D)], LINE(0.6));
      poly([P(0, 0, 0), P(0, CELL, 0), P(0, CELL, D), P(0, 0, D)], INK);
      if (e > 0.6 && p.i % 4 === 0) {
        const [lx, ly] = P(L, CELL, 0);
        c.strokeStyle = PAPER; c.lineWidth = 1;
        c.beginPath(); c.moveTo(lx, ly); c.lineTo(lx + 22, ly - 22); c.lineTo(lx + 52, ly - 22); c.stroke();
        rebate(c, String(p.i + 1).padStart(3, '0'), lx + 26, ly - 30, 'left', 1);
      }
    });
  }

  /**
   * The birds, flocking; from its dive time ("stop") each bird turns into an arrow and flies off out of bounds.
   */
  private flock(c: CanvasRenderingContext2D, tb: number) {
    this.birds.forEach((b, i) => {
      if (!b.on) return;
      if (b.x < -80 || b.x > W + 80 || b.y < -80 || b.y > H + 80) return;
      const a = Math.atan2(b.vy, b.vx);
      if (tb < b.dive) {
        const flap = Math.sin(tb * 22 + hashI(i, 50) * 6.28) * 0.7;
        const s = 10, back = a + Math.PI;
        c.strokeStyle = PAPER;
        c.lineWidth = 2.6;
        c.beginPath();
        c.moveTo(b.x + Math.cos(back - 0.9 - flap) * s, b.y + Math.sin(back - 0.9 - flap) * s);
        c.lineTo(b.x, b.y);
        c.lineTo(b.x + Math.cos(back + 0.9 + flap) * s, b.y + Math.sin(back + 0.9 + flap) * s);
        c.stroke();
        return;
      }
      // Cohesive organic boids arrow with dashed wake along its velocity vector
      const trail = 48;
      c.strokeStyle = PAPER;
      c.lineWidth = 2;
      c.setLineDash([7, 6]);
      c.beginPath();
      c.moveTo(b.x - Math.cos(a) * trail, b.y - Math.sin(a) * trail);
      c.lineTo(b.x, b.y);
      c.stroke();
      c.setLineDash([]);
      drawWarhead(c, b.x, b.y, a, 14);
    });
  }
}
