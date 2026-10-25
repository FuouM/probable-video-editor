// The wall of Verse 1, shared by walls (it slides by) and mirror (it slides on, slows to a stop and turns out
// to be the world inside the mirror). A long damaged brick wall; its mortar and cracks show the blue. The
// lyric of Verse 1 is written ON it, in wall coordinates: the first "i" is the one the intro's title packed
// into, every later word lands where it can be read, each syllable forming its own way (sprayed, laid
// brick by brick, pasted and unrolled, chiselled, grown from Life cells, plotted, painted with drips). A
// couple of air-conditioning units are bolted to the wall between the words, fans turning.
// Mid: drainpipes and a few lamp posts in halftone. In front: the alley, black stacks of boxes and
// crates, a dumpster, pipes, a fence, rimmed in paper where they poke over the bars.
// Every layer is drawn at a shift (px of travel): the scenes decide how the shifts move.
import type { Lyrics } from '@pve/engine/lyrics';
import { H, W } from '@pve/engine/gl';
import { ease, prog } from '@pve/engine/util';
import {
  BAR, INK, PAPER, brickRect, bricks, damagedBrick, gray, hashI, syllables,
  type BrickText, type Syl,
} from './_kit';
import { FIRST_I, drawFirstI } from './_motifs';
import { mark } from '@pve/engine/marks';

export const WALL_SPEED = 70, MID_SPEED = 260, NEAR_SPEED = 900;
/** Ground line of the alley: props stand on it and poke down into the bottom bar. */
const GROUND = H - BAR + 40;
/** px between alley prop slots */
export const ALLEY_SPAN = 760;
/** Rows of the wall where words are written (top px). */
const ROWS = [200, 340, 480, 620];
const FORM = 0.36; // seconds a syllable takes to form
const STYLES = 7;

/** A word written on the wall: its bricks in wall coordinates, and its syllables' character ranges. */
interface WallWord { bt: BrickText; x: number; y: number; cell: number; syls: { s: Syl; a: number; b: number; style: number }[] }

/** The wall's layout (built once from the lyrics of [start, end)) and its layers. */
export class WallWorld {
  private words: WallWord[] = [];
  /** air-conditioning units on the wall, wall coordinates (top-left, scale) */
  private acs: { x: number; y: number; s: number }[] = [];

  constructor(ly: Lyrics, start: number, end: number) {
    const t0 = start;
    const rowEnd = ROWS.map(() => -Infinity);
    let row = 0;
    let first = true;
    for (const line of ly.linesIn(start, end)) {
      // syllables grouped by word
      const byWord = new Map<number, Syl[]>();
      for (const s of syllables(line)) {
        if (s.start >= end) continue;
        (byWord.get(s.wi) ?? byWord.set(s.wi, []).get(s.wi)!).push(s);
      }
      for (const syls of byWord.values()) {
        // the first "i" is the intro's title: it is drawn by itself
        if (first) { first = false; continue; }
        const text = syls.map((s) => s.text).join('');
        const bt = bricks(text);
        const emph = /^(walls|real|fake)$/.test(text);
        const cell = emph ? 13 : 10 + Math.floor(hashI(syls[0]!.start * 100, 3) * 3);
        const w = bt.cols * cell;
        const shift = (syls[0]!.start - t0) * WALL_SPEED;
        // written in reading order: on along the current row while the word fits on screen, else the next
        // row from its left; clear of the first "i" (rows 0-2 cross it)
        const ix = FIRST_I.x - shift;
        const at = (r: number) => {
          let x = Math.max(rowEnd[r]! - shift + 6 * cell, 160);
          if (r < 3 && x < ix + 90 && x + w > ix - 20) x = ix + 110;
          return x;
        };
        let bx = at(row);
        if (bx + w > W - 100) {
          row = (row + 1) % ROWS.length;
          bx = at(row);
        }
        const wx = bx + shift;
        rowEnd[row] = wx + w;
        const best = row;
        let ci = 0;
        this.words.push({
          bt, x: wx, y: ROWS[best]! + (130 - 10 * cell) / 2, cell,
          syls: syls.map((s, k) => {
            const a = ci;
            ci += s.text.length;
            return { s, a, b: ci, style: Math.floor(hashI(Math.round(s.start * 1000), k, 9) * STYLES) };
          }),
        });
      }
    }
    // a few AC units on free stretches of wall (clear of every word, doorways, and the first "i")
    const wallEnd = (end - t0) * WALL_SPEED + W;
    const doors: number[][] = [];
    const dSpan = 700;
    for (let n = -1; n <= Math.floor(wallEnd / dSpan) + 2; n++) {
      if (hashI(n, 41) < 0.55) continue;
      const dx = n * dSpan + 120 + hashI(n, 42) * 300;
      const dw = 130 + hashI(n, 43) * 60, dh = 230 + hashI(n, 44) * 60;
      doors.push([dx - 24, H - BAR - dh - 30, dw + 48, dh + 40]);
    }
    const boxes = [
      ...this.words.map((w) => [w.x, w.y, w.bt.cols * w.cell, 10 * w.cell]),
      ...doors,
      [FIRST_I.x, FIRST_I.y, 80, 370],
    ];
    const free = (x: number, y: number, w: number, h: number) => boxes.every(([bx, by, bw, bh]) => x + w + 30 < bx! || x > bx! + bw! + 30 || y + h + 30 < by! || y > by! + bh! + 30);
    for (let x = 160; x < wallEnd && this.acs.length < 3; x += 300) {
      if (hashI(x, 17) < 0.3) continue;
      const s = 0.5 + hashI(x, 18) * 0.12;
      for (const y of [470, 330, H - BAR - 20 - 270 * s]) {
        if (free(x, y, 300 * s, 270 * s)) { this.acs.push({ x, y, s }); x += 520; break; }
      }
    }
  }

  /**
   * The wall at `shift` px of travel, `tw` the song time of its lyric: bricks, AC units, the first "i", the
   * words. `marks` false when it is drawn somewhere that is not the frame (inside the mirror).
   */
  drawWall(c: CanvasRenderingContext2D, shift: number, tw: number, marks = true) {
    this.marks = marks;
    this.backWall(c, shift);
    for (const a of this.acs) if (a.x - shift < W && a.x - shift + 300 > 0) this.acUnit(c, a.x - shift, a.y, a.s, tw);
    drawFirstI(c, FIRST_I.x - shift, FIRST_I.y, FIRST_I.m, undefined, marks);
    if (marks) mark('syl:i', FIRST_I.x - shift, FIRST_I.y, 72, 360, c);
    for (const w of this.words) this.drawWord(c, w, tw, shift);
  }
  private marks = true;

  /** A word on the wall: each syllable forms in its own way from its sung start, then stays. */
  private drawWord(c: CanvasRenderingContext2D, w: WallWord, tw: number, shift: number) {
    const x0 = w.x - shift;
    if (x0 > W || x0 + w.bt.cols * w.cell < 0) return;
    const cell = w.cell;
    for (const sy of w.syls) {
      if (tw < sy.s.start) continue;
      const p = prog(tw, sy.s.start, sy.s.start + FORM);
      const bricksOf = w.bt.bricks.filter((b) => b.ci >= sy.a && b.ci < sy.b);
      if (!bricksOf.length) continue;
      let minX = Infinity, maxX = -Infinity;
      for (const b of bricksOf) { minX = Math.min(minX, b.cx); maxX = Math.max(maxX, b.cx + b.len); }
      const sx = x0 + minX * cell, sw = (maxX - minX) * cell, top = w.y, hh = 10 * cell;
      const seed = Math.round(sy.s.start * 1000);
      if (this.marks) mark(`syl:${sy.s.text}`, sx, top, sw, hh, c);
      c.fillStyle = PAPER;
      switch (sy.style) {
        case 0: // sprayed: the paint builds up as a halftone, then goes solid
          c.fillStyle = gray(1, Math.min(1, p * 1.15));
          for (const b of bricksOf) brickRect(c, x0 + b.cx * cell, top + b.cy * cell, b.len, cell);
          break;
        case 1: // laid brick by brick, left to right, each dropping into place
          bricksOf.forEach((b, i) => {
            const ta = ((b.cx - minX) / Math.max(1, maxX - minX)) * 0.7 + (b.cy / 10) * 0.2;
            const q = prog(p, ta, ta + 0.12, ease.outCubic);
            if (q <= 0) return;
            brickRect(c, x0 + b.cx * cell, top + b.cy * cell - (1 - q) * cell * 2, b.len, cell);
          });
          break;
        case 2: { // a poster pasted and unrolled from the top, its curl a paper band
          const ry = top + hh * ease.outCubic(p);
          c.save();
          c.beginPath();
          c.rect(sx - cell, top - cell, sw + 2 * cell, ry - top + cell);
          c.clip();
          c.fillStyle = gray(0.12);
          c.fillRect(sx - cell, top - cell, sw + 2 * cell, hh + 2 * cell);
          c.fillStyle = PAPER;
          for (const b of bricksOf) brickRect(c, x0 + b.cx * cell, top + b.cy * cell, b.len, cell);
          c.restore();
          if (p < 1) { c.fillStyle = PAPER; c.fillRect(sx - cell, ry, sw + 2 * cell, Math.max(2, cell * 0.6)); }
          break;
        }
        case 3: // chiselled: cut outlines first, then the faces knocked out to paper
          c.strokeStyle = PAPER;
          c.lineWidth = 1.5;
          for (const b of bricksOf) {
            const bx = x0 + b.cx * cell, by = top + b.cy * cell;
            if (p < 0.55) c.strokeRect(bx + 1, by + 1, b.len * cell - 2, cell - 2);
            else if (hashI(seed, b.cx * 16 + b.cy, 5) < (p - 0.5) * 2.2) brickRect(c, bx, by, b.len, cell);
            else c.strokeRect(bx + 1, by + 1, b.len * cell - 2, cell - 2);
          }
          break;
        case 4: // grown from Life cells: quarter cells switch on in a random order
          for (const b of bricksOf) for (let k = 0; k < b.len * 2; k++) for (let j = 0; j < 2; j++) {
            if (hashI(seed + b.cx * 7 + k, b.cy * 2 + j, 6) > p * 1.1) continue;
            const q = cell / 2;
            c.fillRect(x0 + b.cx * cell + k * q + 0.5, top + b.cy * cell + j * q + 0.5, q - 1, q - 1);
          }
          break;
        case 5: { // plotted: a hairline pen sweeps across, filling what it has passed
          const px = sx + (sw + cell) * p;
          c.save();
          c.beginPath();
          c.rect(sx - 2, top - 2, px - sx + 2, hh + 4);
          c.clip();
          for (const b of bricksOf) brickRect(c, x0 + b.cx * cell, top + b.cy * cell, b.len, cell);
          c.restore();
          if (p < 1) { c.fillRect(px, top - cell, 1, hh + 2 * cell); c.fillRect(px - 4, top - cell, 9, 3); }
          break;
        }
        default: // painted, with drips running down from the lowest bricks and staying
          c.fillStyle = gray(1, Math.min(1, p * 2));
          for (const b of bricksOf) brickRect(c, x0 + b.cx * cell, top + b.cy * cell, b.len, cell);
          c.fillStyle = PAPER;
          for (const b of bricksOf) {
            if (b.cy < 8 || hashI(seed, b.cx, 8) < 0.45) continue;
            const len = cell * (1 + hashI(seed, b.cx, 11) * 4) * prog(p, 0.3, 1, ease.outCubic);
            c.fillRect(x0 + b.cx * cell + cell * (0.2 + 0.5 * hashI(seed, b.cx, 12)), top + (b.cy + 1) * cell - 1, 2, len);
          }
      }
    }
  }

  /** Running courses of damaged black brick, doorways with lintels. */
  private backWall(c: CanvasRenderingContext2D, shift: number) {
    const cell = 26, bw = 3;
    c.fillStyle = INK;
    for (let r = Math.floor(BAR / cell); r * cell < H - BAR; r++) {
      const n0 = Math.floor((shift - ((r & 1) * bw * cell) / 2) / (bw * cell)) - 1;
      for (let n = n0; n < n0 + W / (bw * cell) + 3; n++) {
        damagedBrick(c, n * bw * cell + ((r & 1) * bw * cell) / 2 - shift, r * cell, bw, cell, n * 131 + r, 0.32, 0.1);
      }
    }
    // doorways every few hundred px of wall: dark openings with a lintel
    const span = 700;
    for (let n = Math.floor(shift / span) - 1; n <= Math.floor((shift + W) / span) + 1; n++) {
      if (hashI(n, 41) < 0.55) continue;
      const x = n * span + 120 + hashI(n, 42) * 300 - shift;
      const dw = 130 + hashI(n, 43) * 60, dh = 230 + hashI(n, 44) * 60;
      c.fillStyle = INK;
      c.fillRect(x, H - BAR - dh, dw, dh);
      c.fillStyle = gray(0.45);
      c.fillRect(x - 12, H - BAR - dh - 18, dw + 24, 10);
    }
  }

  /** Drainpipes and now and then a lamp post at mid distance, in halftone gray (no light cones). */
  midLayer(c: CanvasRenderingContext2D, shift: number) {
    const span = 1300;
    for (let n = Math.floor(shift / span) - 1; n <= Math.floor((shift + W) / span) + 1; n++) {
      const x0 = n * span + hashI(n, 51) * 500;
      // none in front of the first "i" at the cut: it arrives on a clear wall
      if (x0 > FIRST_I.x - 60 && x0 < FIRST_I.x + 110) continue;
      const x = x0 - shift;
      if (hashI(n, 52) < 0.3) {
        // lamp post: pole, arm and a solid head
        c.fillStyle = gray(0.22);
        c.fillRect(x, BAR + 90, 14, H - 2 * BAR - 90);
        c.fillRect(x, BAR + 90, 110, 10);
        c.fillRect(x + 90, BAR + 100, 40, 18);
      } else {
        // drainpipe with brackets
        c.fillStyle = gray(0.28);
        c.fillRect(x, BAR, 22, H - 2 * BAR);
        for (let k = 0; k < 5; k++) c.fillRect(x - 6, BAR + 80 + k * 150, 34, 8);
      }
    }
  }

  /**
   * The alley going by in front at `shift` px: black props rimmed in paper, mostly stacks of boxes. Only
   * props up to number `last` exist (a scene that stops spawning lets the last ones pass and leave).
   */
  alley(c: CanvasRenderingContext2D, shift: number, last = Infinity) {
    const span = ALLEY_SPAN;
    for (let n = Math.floor(shift / span) - 1; n <= Math.min(last, Math.floor((shift + W + 800) / span) + 1); n++) {
      if (hashI(n, 61) < 0.3) continue;
      const x = n * span + hashI(n, 62) * 260 - shift - 400;
      if (x > W + 50 || x < -900) continue;
      this.prop(c, ALLEY_KINDS[Math.floor(hashI(n, 63) * ALLEY_KINDS.length)]!, x, n);
    }
  }

  private prop(c: CanvasRenderingContext2D, kind: number, x: number, n: number) {
    c.fillStyle = INK;
    switch (kind) {
      case 0: {
        // a stack of boxes: one to three columns of crates (an X brace cut onto the blue) and cardboard
        // boxes (a tape seam and a hand slot), each column a different height, leaning a little
        const cols = 1 + Math.floor(hashI(n, 64) * 3);
        let cx = x;
        for (let col = 0; col < cols; col++) {
          let y = GROUND;
          const count = 1 + Math.floor(hashI(n, 80 + col) * 3);
          let wCol = 0;
          for (let k = 0; k < count; k++) {
            const id = col * 8 + k;
            const crate = hashI(n, 90 + id) < 0.4;
            const s = (crate ? 120 : 95) + hashI(n, 65 + id) * 80;
            const bh = crate ? s : s * (0.62 + hashI(n, 100 + id) * 0.25);
            y -= bh;
            const px = cx + (hashI(n, 70 + id) - 0.5) * 28;
            wCol = Math.max(wCol, s);
            c.fillStyle = INK;
            c.fillRect(px, y, s, bh);
            hole(c, () => {
              if (crate) {
                c.lineWidth = 4;
                c.beginPath();
                c.moveTo(px + 14, y + 14); c.lineTo(px + s - 14, y + bh - 14);
                c.moveTo(px + s - 14, y + 14); c.lineTo(px + 14, y + bh - 14);
                c.stroke();
              } else {
                c.fillRect(px + s / 2 - 1.5, y, 3, bh * 0.32); // tape seam over the lid
                c.fillRect(px + s * 0.38, y + bh * 0.55, s * 0.24, 7); // hand slot
                c.fillRect(px + 10, y + bh - 22, s * 0.3, 2); // a label line
              }
            });
            rim(c, px, y, s, bh);
          }
          cx += wCol + 6 + hashI(n, 110 + col) * 20;
        }
        break;
      }
      case 1: {
        // dumpster: tapered body, slanted lid, wheels, a handle slot onto the blue
        const w = 420 + hashI(n, 66) * 80, h = 230;
        c.beginPath();
        c.moveTo(x, GROUND - 30 - h);
        c.lineTo(x + w, GROUND - 30 - h);
        c.lineTo(x + w - 24, GROUND - 30);
        c.lineTo(x + 24, GROUND - 30);
        c.closePath();
        c.fill();
        c.beginPath();
        c.moveTo(x - 10, GROUND - 30 - h);
        c.lineTo(x + w + 10, GROUND - 30 - h - 40);
        c.lineTo(x + w + 10, GROUND - 30 - h - 28);
        c.lineTo(x - 10, GROUND - 30 - h + 12);
        c.closePath();
        c.fill();
        c.fillRect(x + 40, GROUND - 34, 36, 34);
        c.fillRect(x + w - 76, GROUND - 34, 36, 34);
        hole(c, () => c.fillRect(x + w / 2 - 60, GROUND - 30 - h + 50, 120, 12));
        rim(c, x - 10, GROUND - 30 - h + 12, w + 20, h - 12);
        break;
      }
      case 2: {
        // pipe run from the top bar: down, flanges, an elbow, and off
        const px = x + 80, drop = 420 + hashI(n, 69) * 200;
        c.fillRect(px, 0, 56, drop);
        c.fillRect(px - 10, BAR + 60, 76, 18);
        c.fillRect(px - 10, drop - 120, 76, 18);
        c.fillRect(px, drop - 56, 300, 56);
        c.fillRect(px + 280, drop - 66, 18, 76);
        rim(c, px, 0, 56, drop);
        break;
      }
      case 3: {
        // chain-link fence panel: posts, a frame, and a lattice the alley shows through
        const w = 520, h = 440, top = GROUND - h;
        c.fillRect(x, top - 30, 16, h + 30);
        c.fillRect(x + w, top - 30, 16, h + 30);
        c.fillRect(x, top, w + 16, 10);
        c.strokeStyle = INK;
        c.lineWidth = 2;
        c.save();
        c.beginPath();
        c.rect(x, top, w + 16, h);
        c.clip();
        c.beginPath();
        for (let d = -h; d < w; d += 22) {
          c.moveTo(x + d, top + h); c.lineTo(x + d + h, top);
          c.moveTo(x + d, top); c.lineTo(x + d + h, top + h);
        }
        c.stroke();
        c.restore();
        rim(c, x, top - 30, 16, h + 30);
        break;
      }
    }
  }

  /** An air-conditioning unit bolted to the wall at (x, y), scale s: a box with a fan guard, blades turning. */
  private acUnit(c: CanvasRenderingContext2D, x: number, y: number, s: number, ta: number) {
    const w = 300 * s, h = 220 * s;
    c.fillStyle = INK;
    // two angle brackets under it, bolted to the wall
    c.fillRect(x + 30 * s, y + h, 12 * s, 50 * s);
    c.fillRect(x + w - 42 * s, y + h, 12 * s, 50 * s);
    c.beginPath();
    c.moveTo(x + 42 * s, y + h); c.lineTo(x + 42 * s, y + h + 10 * s); c.lineTo(x + 30 * s, y + h + 50 * s); c.lineTo(x + 30 * s, y + h + 40 * s);
    c.closePath();
    c.fill();
    c.fillRect(x, y, w, h);
    const fx = x + 110 * s, fy = y + h / 2, r = 82 * s;
    hole(c, () => { c.beginPath(); c.arc(fx, fy, r, 0, Math.PI * 2); c.fill(); });
    c.fillStyle = INK;
    const a0 = ta * 9;
    for (let k = 0; k < 3; k++) {
      const a = a0 + (k * Math.PI * 2) / 3;
      c.beginPath();
      c.moveTo(fx, fy);
      c.arc(fx, fy, r - 10 * s, a, a + 0.75);
      c.closePath();
      c.fill();
    }
    c.beginPath();
    c.arc(fx, fy, 14 * s, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 3 * s;
    for (let rr = 26 * s; rr < r; rr += 18 * s) { c.beginPath(); c.arc(fx, fy, rr, 0, Math.PI * 2); c.stroke(); }
    // the vent slats on the right half, and a drip line of condensation down the wall below
    hole(c, () => { for (let k = 0; k < 8; k++) c.fillRect(x + 214 * s, y + (30 + k * 21) * s, 62 * s, 8 * s); });
    c.fillStyle = gray(0.35);
    c.fillRect(x + w - 20 * s, y + h, 3, 120 * s);
    rim(c, x, y, w, h);
    if (this.marks) mark('ac-unit', x, y, w, h + 50 * s, c);
  }
}

/** Alley props by weight: stacks of boxes (0) most of the time, then a dumpster, a pipe run, a fence. */
const ALLEY_KINDS = [0, 0, 0, 0, 1, 2, 3];

/** A paper rim on the lit edges (top and left) of a black prop. */
function rim(c: CanvasRenderingContext2D, px: number, py: number, w: number, h: number) {
  c.fillStyle = PAPER;
  c.fillRect(px, py, w, 2);
  c.fillRect(px, py, 2, h);
}
/** Cut what `fn` fills out of the layer (onto the blue). */
function hole(c: CanvasRenderingContext2D, fn: () => void) {
  c.save();
  c.globalCompositeOperation = 'destination-out';
  fn();
  c.restore();
}
