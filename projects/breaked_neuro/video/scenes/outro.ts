// outro (to the end, no voice): the rebuild, and back to frame 0 of the intro so the video loops.
// A hard cut from the apex into black. Right from the cut (173.08 s) the intro's bloom is on the blue at
// the generation the intro left it, and runs backwards (a forward run from the R-pentomino, played in
// reverse) all the way down to the single blue cell. Meanwhile the letterbox walls are laid like masonry,
// course by course from the frame's edges inwards, alternately top and bottom, brick by brick along each
// course, their blue mortar always showing so the walls never disappear into the black; in the last bar
// the bricks dissolve one by one into the black of frame 0. At the centre the tesseract draws itself in,
// turns at 10 fps, and goes into the single cell as the bloom collapses. A plain box holds the credits,
// with the overlays turned off while it is on screen so it reads cleanly.
import type { Frame } from '@pve/engine/scene';
import { H, W } from '@pve/engine/gl';
import { clamp, ease, prog } from '@pve/engine/util';
import { F, font } from '@pve/engine/type';
import { BAR, BEAT, BEAT0, BLUE, INK, Life, PAPER, PrintScene, brickRect, bricks, gray, hashI, readout, stepT, type PrintOpts } from './_kit';
import { tesseract } from './_motifs';

const COURSES = 12; // courses in each wall, continuing to build taller until bar 157
const COURSE = BAR / 6; // brick height remains constant
const BRICK = 96; // brick length px
const LC = 16; // bloom cell px, as in the intro
const LW = Math.ceil(W / LC), LH = Math.ceil(H / LC);
const HOLE = { x: 77, y: 25 }; // the intro's first blue cell, in bloom cells
const R_PENTOMINO = [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]];
const INTRO_GEN = 120; // the generation the intro's bloom reached at its last frame (two a beat for 60 beats)
const CREDITS = [
  'original: fm',
  'remix: suno',
  'visuals: claude opus 5.5 + gemini 4 argon',
  'idea guy: fm',
];

export default class Outro extends PrintScene {
  private bloom = new Life(LW, LH);
  private bar = (b: number) => this.ctx.start + b * 4 * BEAT;
  private bricksPerCourse = Math.ceil(W / BRICK) + 1;
  private boxCanvas: HTMLCanvasElement | null = null;
  private boxW = 0;
  private boxH = 0;

  private initBox() {
    if (this.boxCanvas) return;
    const m = 3, rh = 10 * m + 16, pad = 24;
    const bts = CREDITS.map((s) => bricks(s));
    this.boxW = Math.max(...bts.map((b) => b.cols)) * m + pad * 2;
    this.boxH = pad * 2 + rh * bts.length - 16;
    const cv = document.createElement('canvas');
    cv.width = this.boxW;
    cv.height = this.boxH;
    const bc = cv.getContext('2d')!;
    bc.fillStyle = INK;
    bc.fillRect(0, 0, this.boxW, this.boxH);
    bc.strokeStyle = PAPER;
    bc.lineWidth = 2.5;
    bc.strokeRect(0, 0, this.boxW, this.boxH);
    bc.fillStyle = PAPER;
    bts.forEach((bt, i) => {
      const y0 = pad + i * rh;
      for (const b of bt.bricks) brickRect(bc, pad + b.cx * m, y0 + b.cy * m, b.len, m, 0.08);
    });
    this.boxCanvas = cv;
  }

  override init() {
    for (const [dx, dy] of R_PENTOMINO) this.bloom.seed[(HOLE.y + dy!) * LW + HOLE.x + dx!] = 1;
    // the plane runs on from the final chorus (broken, the 16 bars before): the same board, no new one at the cut
    this.plane = { of: 'broken', t0: this.ctx.start - 16 * 4 * BEAT, guns: 0.2, osc: 0.2, rate: 15 };
  }

  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    const t = f.t;
    const tq = stepT(t, 24);
    c.fillStyle = INK;
    c.fillRect(0, 0, W, H);
    const t0 = this.ctx.start, last = this.ctx.end - 4 * BEAT;

    // the bloom of the intro, running backwards from the very start of the outro (173.08 s) to the single cell
    let gen = 0, pop = 1;
    if (tq < last) {
      const p = prog(stepT(t, 12), t0, last - 0.2);
      const g = Math.round(INTRO_GEN * (1 - p));
      const board = this.bloom.at(g);
      const on = prog(tq, t0, t0 + 2 * BEAT, ease.outCubic);
      gen = g;
      pop = 0;
      for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
        if (!board[y * LW + x] || hashI(x, y, 5) > on) continue;
        c.clearRect(x * LC + 1, y * LC + 1, LC - 2, LC - 2);
        pop++;
      }
    } else {
      // the void: the one hole blinks off on every beat, as the intro's first bar does
      const inBeat = (((stepT(t, 12) - BEAT0) / BEAT) % 1 + 1) % 1;
      if (inBeat > 0.25) c.clearRect(HOLE.x * LC, HOLE.y * LC, LC, LC);
    }

    // the protagonist: revealed by drawing its edges in (not a wipe), turning at 10 fps, then going into the single cell
    if (tq < last) {
      const tt = stepT(t, 10);
      const draw = prog(tt, t0 + 0.4, this.bar(4), ease.inOutCubic);
      const into = prog(tt, last - 3 * 4 * BEAT, last - 0.2, ease.inCubic);
      const hx = HOLE.x * LC + LC / 2, hy = HOLE.y * LC + LC / 2;
      const cx = W / 2 + (hx - W / 2) * into, cy = H / 2 + (hy - H / 2) * into;
      if (draw > 0) {
        tesseract(c, cx, cy, 1300 * (1 - into * 0.98), tt, 0.25 * (1 - draw) + 0.15, 3, draw);
      }
    }

    const laid = this.walls(c, tq);
    const cred = this.credits(c, tq);

    // readouts on the laid walls: the bloom counting down and the bricks of the walls; in the last bar the
    // intro's frame 0 (gen 0, the single hole, 17 bars to go)
    readout(c, `R-PENTOMINO · B3/S23 · GEN ${String(gen).padStart(4, '0')} · POP ${String(pop).padStart(4, '0')}`, 'left');
    readout(c, tq >= last ? '17' : `BRICKS ${String(laid).padStart(4, '0')}`, 'right');
    // Low-fps (6 fps) gradual fade of overlays so there is no abrupt drop when the credits box enters at 181.48 s
    const tf = stepT(t, 6);
    const fade = (1 - prog(tf, t0 + 1.2, this.ctx.end - 0.8, ease.inOutQuad)) * (1 - 0.55 * prog(tf, this.bar(5), this.bar(9), ease.inOutQuad));
    // the sideway clumps (none in broken) come in one by one over the first two bars
    const clumpKill = 1 - prog(tf, this.ctx.start, this.bar(2));
    return { noise: fade, plane: 0.4 * fade, ships: 0.5 * fade, grain: 0.5 * fade, clumpKill, bleed: 2.2 * (1 - 0.4 * cred) };
  }

  /**
   * The letterbox walls laid like masonry: each course (row of bricks) takes 1 bar (4 beats) to fill,
   * course by course from the frame's edges inwards, alternately top and bottom, completing at bar 157;
   * from 192 s the bricks dissolve away into frame 0. Returns the bricks on screen (the right readout).
   */
  private walls(c: CanvasRenderingContext2D, tq: number) {
    const n = this.bricksPerCourse, total = 2 * COURSES * n;
    const tDissolve = 192.0;
    const diss = prog(tq, tDissolve, this.ctx.end - 0.3, ease.inQuad);
    let laid = 0;
    if (diss >= 1) return laid;
    for (let k = 0; k < total; k++) {
      if (hashI(k, 91) < diss) continue;
      const course = Math.floor(k / n), b = k % n;
      // Each row (course) takes 2 beats (half a bar) to fill, continuing until Bar 157 (24 courses * 2 beats = 12 bars)
      const at = this.ctx.start + (course + b / n) * (2 * BEAT);
      const p = prog(tq, at, at + 0.12, ease.outCubic);
      if (p <= 0) break;
      const top = course % 2 === 0, row = Math.floor(course / 2);
      // a course runs left to right on top and right to left at the bottom, running bond
      const i = top ? b : n - 1 - b;
      const x = i * BRICK - (row % 2) * (BRICK / 2);
      const y = top ? row * COURSE : H - (row + 1) * COURSE;
      const from = top ? -COURSE * 2 : COURSE * 2;
      const yy = y + from * (1 - p);
      c.clearRect(x, yy, BRICK, COURSE);
      c.fillStyle = INK;
      c.fillRect(x + 2, yy + 2, BRICK - 4, COURSE - 4);
      if (p < 1) {
        c.fillStyle = PAPER;
        c.fillRect(x + 2, yy + 2, BRICK - 4, 2);
      }
      laid++;
    }
    return laid;
  }

  /** The credits in a plain readable box with an ASCII transition in and out; returns 0..1 of how much they are up. */
  private credits(c: CanvasRenderingContext2D, tq: number): number {
    this.initBox();
    const tIn = this.bar(6), tOut = 191.5;
    const durIn = 0.85, durOut = 0.85;
    const uIn = clamp((tq - tIn) / durIn, 0, 1);
    const uOut = clamp((tq - (tOut - durOut)) / durOut, 0, 1);
    if (uIn <= 0 || uOut >= 1) return 0;

    const bw = this.boxW, bh = this.boxH;
    const bx = W - 64 - bw, by = H - BAR - 32 - bh;

    // Fully up and steady between transitions
    if (uIn >= 1 && uOut <= 0) {
      c.drawImage(this.boxCanvas!, bx, by);
      return 1;
    }

    // ASCII matrix / terminal transition in and out
    const cw = 14, ch = 18;
    const cols = Math.ceil(bw / cw), rows = Math.ceil(bh / ch);
    const stepSeed = Math.floor(tq * 24);
    const GLYPHS_ASCII = '0123456789abcdefghijklmnopqrstuvwxyz.:-=+*#%@/\\_!?';

    c.save();
    c.font = font(F.mono(700), 13);
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const cx = bx + gx * cw, cy = by + gy * ch;
        const sw = Math.min(cw, bw - gx * cw), sh = Math.min(ch, bh - gy * ch);
        const normX = gx / cols;
        const normY = gy / rows;
        const isBorder = gx === 0 || gx === cols - 1 || gy === 0 || gy === rows - 1;

        // On entry: diagonal-horizontal sweep from left to right with noise
        const inThreshold = normX * 0.65 + normY * 0.15 + hashI(gx, gy, 17) * 0.20;
        const hasArrived = uIn >= inThreshold;
        if (!hasArrived) continue;

        // On exit: disintegration from edges/random
        const outThreshold = (1 - normX) * 0.55 + hashI(gx, gy, 29) * 0.45;
        const hasDeparted = uOut >= outThreshold + 0.18;
        if (hasDeparted) continue;

        const isDecodingIn = uIn < inThreshold + 0.16;
        const isGlitchingOut = uOut > 0 && uOut >= outThreshold;

        if (isDecodingIn || isGlitchingOut) {
          c.fillStyle = INK;
          c.fillRect(cx, cy, sw, sh);

          const h = hashI(gx, gy, stepSeed);
          let chStr = '';
          if (isBorder) {
            const isCorner = (gx === 0 || gx === cols - 1) && (gy === 0 || gy === rows - 1);
            chStr = isCorner ? '+' : (gy === 0 || gy === rows - 1) ? '-' : '|';
            if (h < 0.25) chStr = '#';
          } else {
            chStr = GLYPHS_ASCII[Math.floor(h * GLYPHS_ASCII.length)]!;
          }

          c.fillStyle = isBorder ? (h < 0.35 ? BLUE : PAPER) : (h < 0.22 ? BLUE : (h < 0.65 ? PAPER : gray(0.5)));
          c.fillText(chStr, cx + sw / 2, cy + sh / 2);
        } else {
          c.drawImage(this.boxCanvas!, gx * cw, gy * ch, sw, sh, cx, cy, sw, sh);
        }
      }
    }
    c.restore();
    return uIn * (1 - uOut);
  }
}
