// The ceiling of Verse 2, shared by the ceiling plate and the Over transition that drops its tiles into
// dust: tiles drawn in the ceiling's perspective (a word or a 1-bit pictogram on each), and the fall
// (from "ceiling" a tile every eighth comes loose, tilts and drops at the camera).
import { H, W } from '@pve/engine/gl';
import type { Lyrics } from '@pve/engine/lyrics';
import { BEAT, INK, PAPER, brickRect, bricks, hashI, stepT, sylLine, sylOfChar, type SylLine } from './_kit';
import { ceilingProj, headOffset, type CeilProj } from './_motifs';

const GRAVITY = 7; // tile units / s², down from the ceiling

/** 1-bit pictograms, 8x8: what a tile shows when a word of the line names a thing. */
export const SYMBOLS: Record<string, string[]> = {
  eye: ['........', '..####..', '.#....#.', '#..##..#', '#..##..#', '.#....#.', '..####..', '........'],
  clock: ['..####..', '.#....#.', '#..#...#', '#..#...#', '#..###.#', '#......#', '.#....#.', '..####..'],
  house: ['...##...', '..#..#..', '.#....#.', '########', '.#....#.', '.#.##.#.', '.#.##.#.', '.####.#.'],
  drop: ['...#....', '...#....', '..###...', '..###...', '.#####..', '.##.##..', '.#####..', '..###...'],
  question: ['..####..', '.#....#.', '......#.', '....##..', '...#....', '...#....', '........', '...#....'],
  heart: ['........', '.##..##.', '########', '########', '.######.', '..####..', '...##...', '........'],
  two: ['........', '.##..##.', '.##..##.', '........', '.#....#.', '.#....#.', '.##..##.', '........'],
  feet: ['.##.....', '.##.....', '.##..##.', '.....##.', '..##.##.', '..##....', '..##..##', '......##'],
  figure: ['...##...', '...##...', '..####..', '.#.##.#.', '...##...', '..#..#..', '..#..#..', '..#..#..'],
  grid: ['########', '#..#..##', '#..#..##', '########', '#..#..##', '#..#..##', '########', '########'],
};
/** words of Verse 2 and the pictogram each one brings */
export const WORD_SYMBOL: Record<string, string> = {
  remember: 'question', moment: 'clock', met: 'two', first: 'two', looked: 'eye', confused: 'question', walked: 'feet',
  home: 'house', myself: 'figure', eyes: 'eye', tears: 'drop', stop: 'clock', stare: 'eye', ceiling: 'grid', looking: 'eye',
  reason: 'question', live: 'heart',
};

export interface Tile { tx: number; tz: number; at: number; word: string; inverse: boolean; tilt: [number, number] }

/** A quad of the tile (tx, tz), sub-rect [u0..u1] x [v0..v1], each corner `drop(u, v)` below the plane. */
export function quad(c: CanvasRenderingContext2D, proj: CeilProj, tx: number, tz: number, u0: number, v0: number, u1: number, v1: number, drop: (u: number, v: number) => number) {
  const a = proj(tx + u0, tz + v0, drop(u0, v0)), b = proj(tx + u1, tz + v0, drop(u1, v0));
  const d = proj(tx + u1, tz + v1, drop(u1, v1)), e = proj(tx + u0, tz + v1, drop(u0, v1));
  if (a[2] < 0.4 || b[2] < 0.4 || d[2] < 0.4 || e[2] < 0.4) return false;
  c.beginPath();
  c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.lineTo(e[0], e[1]);
  c.closePath();
  c.fill();
  return true;
}

const flat = () => 0;

/**
 * A word laid on the ceiling tile (tx, tz), in the tile's own perspective. `squash` 0..1 folds it about
 * its middle (a departure-board flip: 1 is edge-on).
 */
export function tileWord(c: CanvasRenderingContext2D, proj: CeilProj, tx: number, tz: number, word: string, inverse: boolean, drop: (u: number, v: number) => number = flat, squash = 0) {
  const k = 1 - squash, vq = (v: number) => 0.5 + (v - 0.5) * k;
  c.fillStyle = inverse ? PAPER : INK;
  if (!quad(c, proj, tx, tz, 0, vq(0), 1, vq(1), drop)) return;
  const bt = bricks(word);
  const s = 0.86 / Math.max(bt.cols, 10 * 1.6);
  const u0 = (1 - bt.cols * s) / 2, v0 = (1 - 10 * s) / 2;
  c.fillStyle = inverse ? INK : PAPER;
  for (const b of bt.bricks) {
    const a = u0 + b.cx * s, z0 = v0 + b.cy * s;
    quad(c, proj, tx, tz, a, vq(z0), a + b.len * s * 0.9, vq(z0 + s * 0.85), drop);
  }
}

/** A pictogram on the ceiling tile (tx, tz): paper cells on ink, folded like tileWord. */
export function tileSymbol(c: CanvasRenderingContext2D, proj: CeilProj, tx: number, tz: number, sym: string, squash = 0) {
  const k = 1 - squash, vq = (v: number) => 0.5 + (v - 0.5) * k;
  c.fillStyle = INK;
  if (!quad(c, proj, tx, tz, 0, vq(0), 1, vq(1), flat)) return;
  const rows = SYMBOLS[sym]!;
  const s = 0.8 / 8, m = 0.1;
  c.fillStyle = PAPER;
  rows.forEach((row, j) => {
    for (let i = 0; i < 8; i++) if (row[i] === '#') quad(c, proj, tx, tz, m + i * s, vq(m + j * s), m + (i + 0.9) * s, vq(m + (j + 0.9) * s), flat);
  });
}

/** The fall of the ceiling: from "ceiling" a tile every eighth, in hashed order; the last bar takes the rest. */
export class CeilingFall {
  readonly tiles: Tile[] = [];
  readonly words: string[];
  readonly lastLines: SylLine[];
  constructor(ly: Lyrics, readonly start: number, readonly end: number) {
    this.words = [...new Set(ly.words.map((w) => w.w.toLowerCase().replace(/[^a-z']/g, '')).filter((w) => w.length > 2))];
    this.lastLines = ly.linesIn(end - 6, end).map((l) => sylLine(ly, l));
    const tCeil = ly.get('stare at the ceiling').words.find((w) => w.w === 'ceiling')!.start;
    const cells: [number, number][] = [];
    for (let tz = -2; tz <= 7; tz++) for (let tx = -8; tx <= 7; tx++) cells.push([tx, tz]);
    cells.sort((a, b) => hashI(a[0], a[1], 91) - hashI(b[0], b[1], 91));
    const lastBar = end - 4 * BEAT;
    cells.forEach(([tx, tz], k) => {
      const eighth = tCeil + (k * BEAT) / 2;
      const at = eighth < lastBar ? eighth : lastBar + hashI(k, 92) * 4 * BEAT;
      this.tiles.push({
        tx, tz, at, word: this.words[Math.floor(hashI(k, 93) * this.words.length)]!, inverse: hashI(k, 94) < 0.4,
        tilt: [(hashI(k, 95) - 0.5) * 2.4, (hashI(k, 96) - 0.5) * 2.4],
      });
    });
  }

  /** The ceiling's projection at tc (also after the cut, for the tiles still falling). */
  proj(tc: number) {
    return ceilingProj(tc, 960, 540 + 140, 0.5);
  }

  gone(tx: number, tz: number, tc: number) {
    return this.tiles.some((fl) => fl.tx === tx && fl.tz === tz && tc >= fl.at);
  }

  /** The falling tiles at tc: down at the camera, tilting, fading out smoothly as they approach. */
  draw(c: CanvasRenderingContext2D, tc: number) {
    const proj = this.proj(tc);
    for (const fl of this.tiles) {
      if (tc < fl.at) continue;
      const a = tc - fl.at, d = 0.5 * GRAVITY * a * a;
      if (d > 3.2) continue;
      const [ru, rv] = fl.tilt;
      const drop = (u: number, v: number) => d + a * ((u - 0.5) * ru + (v - 0.5) * rv);

      // evaluate the nearest depth of the tile's corners to the camera
      const c0 = proj(fl.tx, fl.tz, drop(0, 0)), c1 = proj(fl.tx + 1, fl.tz, drop(1, 0));
      const c2 = proj(fl.tx + 1, fl.tz + 1, drop(1, 1)), c3 = proj(fl.tx, fl.tz + 1, drop(0, 1));
      const minZ = Math.min(c0[2], c1[2], c2[2], c3[2]);
      if (minZ < 0.42) continue;

      // smooth fade out into the camera lens (minZ: 1.8 -> 0.45) or as tile passes down (d: 2.2 -> 3.2)
      const fadeZ = Math.min(1, Math.max(0, (minZ - 0.45) / 1.35));
      const fadeD = Math.min(1, Math.max(0, (3.2 - d) / 1.0));
      const alpha = Math.min(fadeZ, fadeD);
      if (alpha <= 0.02) continue;

      c.save();
      c.globalAlpha = alpha;
      tileWord(c, proj, fl.tx, fl.tz, fl.word, fl.inverse, drop);
      c.restore();
    }
  }

  /** Carry the falling Tetris lyric bricks of the final line ("reason to live") across the cut into dust. */
  drawFallingLyrics(c: CanvasRenderingContext2D, t: number) {
    const CELL = 7, YTOP = 780, HEAD = 1180;
    const tick = stepT(t, 12);
    const drawn: { x: number; y: number; len: number; box: boolean }[] = [];
    const sl = this.lastLines[this.lastLines.length - 1];
    if (!sl) return;
    const x0 = headOffset(sl, sl.line.end, HEAD, CELL);
    const isReason = /reason to live/i.test(sl.line.text);
    sl.bt.bricks.forEach((br, i) => {
      const si = sylOfChar(sl, br.ci);
      if (si < 0) return;
      const s = sl.syls[si]!;
      const tr = s.end + 0.25 + hashI(i, 1) * 0.9;
      const n = Math.max(0, Math.floor((tick - tr) * 12));
      const y = YTOP + br.cy * CELL + Math.round((n * CELL * (1 + n * 0.15)) / CELL) * CELL;
      if (y > H) return;
      const x = x0 + br.cx * CELL;
      if (x > W || x + br.len * CELL < 0) return;
      drawn.push({ x, y, len: br.len, box: isReason });
    });
    c.fillStyle = INK;
    for (const d of drawn) if (d.box) c.fillRect(d.x - CELL, d.y - CELL, (d.len + 2) * CELL, 3 * CELL);
    for (const d of drawn) c.fillRect(d.x + CELL * 0.5, d.y + CELL * 0.5, d.len * CELL, CELL);
    c.fillStyle = PAPER;
    for (const d of drawn) brickRect(c, d.x, d.y, d.len, CELL);
  }
}
