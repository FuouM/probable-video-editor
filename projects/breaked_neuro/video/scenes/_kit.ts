// Shared kit for breaked: the brick letters, the print pass (blue ground + binarized layers),
// the letterbox walls and the syllable timeline. Every plate draws its layers with Canvas2D in
// paper / ink / grays with alpha, then runs Print over them.
import * as THREE from 'three';
import { FSPass, H, Layer2D, SCALE, W, makeRT } from '@pve/engine/gl';
import { lastBefore, stepN, stepT } from '@pve/engine/util';
export { lastBefore, stepN, stepT };
import { syllables, sylAt, type Line, type Lyrics, type Syl, type Word } from '@pve/engine/lyrics';
export { syllables, sylAt, type Syl };
import { Scene, type Frame, type PostOverrides } from '@pve/engine/scene';
import { marks, pushMarks, type Mark } from '@pve/engine/marks';
import { F, font } from '@pve/engine/type';
import { GPULife, MACHINE_H, MACHINE_W, MACHINE_WARM, planeSeed } from './_machine';
export { GPULife };

// ---------- colours (sRGB strings for Canvas2D; the print pass reads tone and coverage) ----------
export const PAPER = '#f3f0ea';
export const INK = '#000000';
export const BLUE = '#2a1fff';
export const gray = (tone: number, a = 1) => {
  const v = Math.round(243 * Math.max(0, Math.min(1, tone)));
  return `rgba(${v},${v},${v},${a})`;
};

/** Post settings for every plate: the print pass does the surface; no bloom, CA, vignette or grain on top. */
export const POST: PostOverrides = { bloom: 0, halation: 0, ca: 0, vignette: 0, grain: 0 };

// ---------- 2.39:1 letterbox ----------
export const BOX_H = Math.round(W / 2.39); // 803
export const BAR = Math.round((H - BOX_H) / 2); // 138

// ---------- tempo: 200 BPM, first downbeat at 0.296 s ----------
export const BEAT = 0.3;
export const BEAT0 = 0.296;

// ---------- brick letters ----------
// Unicase glyphs on a 5-row cell grid. '#' = a filled cell; the filled runs of a row are one brick each.
const GLYPHS: Record<string, string[]> = {
  a: ['###', '#.#', '###', '#.#', '#.#'],
  b: ['##.', '#.#', '##.', '#.#', '##.'],
  c: ['###', '#..', '#..', '#..', '###'],
  d: ['##.', '#.#', '#.#', '#.#', '##.'],
  e: ['###', '#..', '##.', '#..', '###'],
  f: ['###', '#..', '##.', '#..', '#..'],
  g: ['###', '#..', '#.#', '#.#', '###'],
  h: ['#.#', '#.#', '###', '#.#', '#.#'],
  i: ['#', '#', '#', '#', '#'],
  j: ['..#', '..#', '..#', '#.#', '###'],
  k: ['#.#', '#.#', '##.', '#.#', '#.#'],
  l: ['#..', '#..', '#..', '#..', '###'],
  m: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  n: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  o: ['###', '#.#', '#.#', '#.#', '###'],
  p: ['###', '#.#', '###', '#..', '#..'],
  q: ['###', '#.#', '#.#', '###', '..#'],
  r: ['###', '#.#', '##.', '#.#', '#.#'],
  s: ['###', '#..', '###', '..#', '###'],
  t: ['###', '.#.', '.#.', '.#.', '.#.'],
  u: ['#.#', '#.#', '#.#', '#.#', '###'],
  v: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  w: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  x: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  y: ['#.#', '#.#', '###', '.#.', '.#.'],
  z: ['###', '..#', '.#.', '#..', '###'],
  "'": ['#', '#', '.', '.', '.'],
  '’': ['#', '#', '.', '.', '.'],
  '(': ['.#', '#.', '#.', '#.', '.#'],
  ')': ['#.', '.#', '.#', '.#', '#.'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['##', '.#', '.#', '.#', '.#'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  ':': ['.', '#', '.', '#', '.'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '.': ['.', '.', '.', '.', '#'],
};
/**
 * The face is drawn at 2x: every glyph cell is 2x2 sub-cells, and the outer top-right and bottom-right
 * corner sub-cells of a cell are cut when nothing touches that corner. That rule gives the letters their
 * forward lean and makes "breaked" exactly 256 sub-cells, a 16x16 square.
 */
export const ROWS = 10;
const SPACE = 6; // sub-cells
const TRACK = 2; // sub-cells between letters

/** One brick of laid-out text, in sub-cells from the text origin (top-left). `ci`: index of its character. */
export interface Brick { cx: number; cy: number; len: number; ci: number }
export interface BrickText { text: string; cols: number; bricks: Brick[]; charX: number[]; charW: number[]; cells: number }

function subGlyph(g: string[], ch?: string): boolean[][] {
  const w = g[0]!.length;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < 5 && g[y]![x] === '#';
  const s = Array.from({ length: 10 }, () => new Array<boolean>(w * 2).fill(false));
  for (let y = 0; y < 5; y++) for (let x = 0; x < w; x++) {
    if (!on(x, y)) continue;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const cut = ch !== '+' && dx === 1 && !on(x + 1, y) && !on(x, y + dy) && !on(x + 1, y + dy);
      if (!cut) s[2 * y + (dy > 0 ? 1 : 0)]![2 * x + (dx > 0 ? 1 : 0)] = true;
    }
  }
  return s;
}

const cache = new Map<string, BrickText>();
/** Lay out a string in brick sub-cells (lowercased). Cached. */
export function bricks(text: string): BrickText {
  const hit = cache.get(text);
  if (hit) return hit;
  const out: Brick[] = [];
  const charX: number[] = [];
  const charW: number[] = [];
  let x = 0, cells = 0;
  const s = text.toLowerCase();
  for (let ci = 0; ci < s.length; ci++) {
    const g = GLYPHS[s[ci]!];
    if (!g) {
      charX.push(x);
      charW.push(SPACE);
      x += SPACE;
      continue;
    }
    const sub = subGlyph(g, s[ci]);
    const gw = sub[0]!.length;
    charX.push(x);
    charW.push(gw);
    for (let r = 0; r < ROWS; r++) {
      const row = sub[r]!;
      let c = 0;
      while (c < gw) {
        if (!row[c]) { c++; continue; }
        let e = c;
        while (e < gw && row[e]) e++;
        out.push({ cx: x + c, cy: r, len: e - c, ci });
        cells += e - c;
        c = e;
      }
    }
    x += gw + TRACK;
  }
  const bt = { text, cols: Math.max(0, x - TRACK), bricks: out, charX, charW, cells };
  cache.set(text, bt);
  return bt;
}

/** Draw one brick at px position with cell size; the mortar is a gap that shows what is under it. */
export function brickRect(c: CanvasRenderingContext2D, x: number, y: number, len: number, cell: number, mortar = 0.14) {
  const m = cell * mortar;
  c.fillRect(x + m * 0.5, y + m * 0.5, len * cell - m, cell - m);
}

/**
 * A brick with procedural damage: `amount` 0..1 decides how many bricks of a wall are hit (by `id`).
 * Damage kinds: missing, a chipped corner, a crack through it (a hole line onto what is under it).
 * Returns false when the brick is gone.
 */
export function damagedBrick(c: CanvasRenderingContext2D, x: number, y: number, len: number, cell: number, id: number, amount: number, mortar = 0.14) {
  const h = hashI(id, 913);
  if (h < amount * 0.08) return false;
  const m = cell * mortar;
  const x0 = x + m * 0.5, y0 = y + m * 0.5, w = len * cell - m, hh = cell - m;
  if (h < amount * 0.65) {
    // chipped: one corner cut on a diagonal (zero array allocations)
    const ci = Math.floor(hashI(id, 7) * 4);
    const cw = Math.min(w, hh) * (0.35 + 0.5 * hashI(id, 8));
    c.beginPath();
    if (ci === 0) {
      c.moveTo(x0 + cw, y0); c.lineTo(x0 + w, y0); c.lineTo(x0 + w, y0 + hh); c.lineTo(x0, y0 + hh); c.lineTo(x0, y0 + cw);
    } else if (ci === 1) {
      c.moveTo(x0, y0); c.lineTo(x0 + w - cw, y0); c.lineTo(x0 + w, y0 + cw); c.lineTo(x0 + w, y0 + hh); c.lineTo(x0, y0 + hh);
    } else if (ci === 2) {
      c.moveTo(x0, y0); c.lineTo(x0 + w, y0); c.lineTo(x0 + w, y0 + hh - cw); c.lineTo(x0 + w - cw, y0 + hh); c.lineTo(x0, y0 + hh);
    } else {
      c.moveTo(x0, y0); c.lineTo(x0 + w, y0); c.lineTo(x0 + w, y0 + hh); c.lineTo(x0 + cw, y0 + hh); c.lineTo(x0, y0 + hh - cw);
    }
    c.closePath();
    c.fill();
  } else {
    c.fillRect(x0, y0, w, hh);
  }
  return true;
}

/** Draw laid-out bricks at (x, y) top-left with cell size. `pick(b)` may skip (false) or recolour a brick. */
export function drawBricks(
  c: CanvasRenderingContext2D, bt: BrickText, x: number, y: number, cell: number,
  pick?: (b: Brick, i: number) => boolean | string, mortar = 0.14,
) {
  const base = c.fillStyle;
  bt.bricks.forEach((b, i) => {
    const p = pick ? pick(b, i) : true;
    if (p === false) return;
    c.fillStyle = typeof p === 'string' ? p : base;
    brickRect(c, x + b.cx * cell, y + b.cy * cell, b.len, cell, mortar);
  });
  c.fillStyle = base;
}

/** A line laid out as brick text with the character range of every syllable. */
export interface SylLine { line: Line; syls: Syl[]; bt: BrickText; ranges: [number, number][] }
/** Lay out a line: give the Line itself, or a query (and match index) to find it in the lyrics. */
export function sylLine(lyrics: Lyrics, query: string | Line, nth = 0): SylLine {
  const line = typeof query === 'string' ? lyrics.get(query, nth) : query;
  const syls = syllables(line);
  let text = '';
  const ranges: [number, number][] = [];
  syls.forEach((s, k) => {
    if (k > 0 && s.wi !== syls[k - 1]!.wi) text += ' ';
    ranges.push([text.length, text.length + s.text.length]);
    text += s.text;
  });
  return { line, syls, bt: bricks(text), ranges };
}
/** Index of the syllable a character belongs to. */
export function sylOfChar(sl: SylLine, ci: number): number {
  for (let i = 0; i < sl.ranges.length; i++) if (ci >= sl.ranges[i]![0] && ci < sl.ranges[i]![1]) return i;
  return -1;
}

/** A brick placed by a layout, in sub-cells from the layout origin; `si` is its syllable. */
export interface Placed { b: Brick; si: number; x: number; y: number }
/**
 * A line wrapped at word boundaries into rows of at most `maxCols` sub-cells, `rowStep` sub-cells apart
 * (10 is touching rows; 14 leaves air). Bricks keep their syllable so a plate can time each one.
 */
export function wrapLine(sl: SylLine, maxCols: number, rowStep = 14): { placed: Placed[]; rows: number; widths: number[] } {
  const text = sl.bt.text;
  const words: [number, number][] = [];
  let s = 0;
  for (let i = 0; i <= text.length; i++) if (i === text.length || text[i] === ' ') { if (i > s) words.push([s, i]); s = i + 1; }
  const { charX, charW } = sl.bt;
  const placed: Placed[] = [];
  const widths: number[] = [];
  let row = 0, x = 0;
  for (const [a, b] of words) {
    const w = charX[b - 1]! + charW[b - 1]! - charX[a]!;
    if (x > 0 && x + w > maxCols) { widths.push(x - SPACE); row++; x = 0; }
    const dx = x - charX[a]!;
    for (const br of sl.bt.bricks) if (br.ci >= a && br.ci < b) placed.push({ b: br, si: sylOfChar(sl, br.ci), x: br.cx + dx, y: br.cy + row * rowStep });
    x += w + SPACE;
  }
  widths.push(Math.max(0, x - SPACE));
  return { placed, rows: row + 1, widths };
}

/**
 * Brick glyphs pre-drawn once per character at one sub-cell size and colour, for walls of thousands of
 * small letters (one drawImage per letter instead of a fillRect per brick).
 */
export class GlyphAtlas {
  private glyphs = new Map<string, { canvas: HTMLCanvasElement; w: number }>();
  constructor(readonly cell: number, readonly color: string, readonly mortar = 0.14) {}
  get(ch: string) {
    let g = this.glyphs.get(ch);
    if (!g) {
      const bt = bricks(ch);
      const w = Math.max(1, bt.cols) * this.cell, h = ROWS * this.cell;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(w * SCALE);
      canvas.height = Math.ceil(h * SCALE);
      const c = canvas.getContext('2d')!;
      c.scale(SCALE, SCALE);
      c.fillStyle = this.color;
      drawBricks(c, bt, 0, 0, this.cell, undefined, this.mortar);
      g = { canvas, w };
      this.glyphs.set(ch, g);
    }
    return g;
  }
  /** Draw one character with its top-left at (x, y); returns its advance in px (with tracking). */
  draw(c: CanvasRenderingContext2D, ch: string, x: number, y: number) {
    if (ch === ' ') return SPACE * this.cell;
    const g = this.get(ch);
    c.drawImage(g.canvas, x, y, g.w, ROWS * this.cell);
    return g.w + TRACK * this.cell;
  }
}

/**
 * Generations of a Life layer at time t, counted from t0. The stepping rate changes per bar: each bar
 * picks steps-per-beat from `rates` (1 = one generation a beat, 0.5 = every other beat, 4 = sixteenths),
 * and the layer is held at `fps`.
 */
export function genAt(t: number, t0: number, rates: number[], seed: number, fps = 15) {
  const tq = stepT(t, fps);
  if (tq <= t0) return 0;
  const barLen = 1.2, beat = 0.3;
  let g = 0, b = 0, at = t0;
  while (at + barLen <= tq) { g += 4 * rates[Math.floor(hashI(b, seed) * rates.length)]!; at += barLen; b++; }
  g += ((tq - at) / beat) * rates[Math.floor(hashI(b, seed) * rates.length)]!;
  return Math.floor(g + 1e-6);
}

/**
 * What the print pass does on top of the drawn layer. The overlays (director's words: grain, plane
 * conway, sideway conways, vertical streaks, clumps) each have an amount 0..1, all scaled by `noise`.
 */
export interface PrintOpts {
  coarse?: number;
  bleed?: number;
  /** master amount of every overlay (0 = none) */
  noise?: number;
  grain?: number;
  plane?: number;
  ships?: number;
  scratches?: number;
  clumps?: number;
  /** 0..1: clumps fade out one by one (each at its own random moment); 1 = none left */
  clumpKill?: number;
  /** Over layers only: grain, plane, scratches and clumps on the pixels the layer covers (default: none) */
  overlays?: boolean;
  /** the plane moves with the camera: its offset in px and its cell size (default 3 px), scaled about the frame centre */
  view?: { x: number; y: number; cell?: number };
  /** plane, grain and clumps over the whole frame (only the full-frame final chorus); default: in the 2.39:1 box */
  full?: boolean;
  /** optional hardware scissor bounding box in target px to cull fragment shading */
  scissor?: { x: number; y: number; w: number; h: number };
}

/**
 * The plane of a plate: the board seed (default: from the clip id), its parts, its constant rate. `of` and
 * `t0` continue another plate's board across a cut: its clip id and its first frame's song time.
 */
export interface PlaneDef { seed?: number; guns?: number; osc?: number; rate?: number; of?: string; t0?: number }

export function idSeed(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * A plate of this video: draw binarizable layers into `c` (paper / ink / grays, alpha; transparent shows
 * the blue), the print pass does the rest. `draw` may return print options. Each plate owns its plane
 * board (`plane`, stepped at a constant rate from the plate's first frame, never reset inside it).
 */
export abstract class PrintScene extends Scene {
  protected layer = new Layer2D();
  protected print = new Print();
  protected plane: PlaneDef = {};
  private planeBoard: GPULife | null = null;
  private lastDrawKey: string | number | null = null;
  private lastPrintOpts: PrintOpts = {};
  private cachedMarks: Mark[] = [];

  abstract draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts | void;
  drawKey(f: Frame): string | number | null {
    return `${stepT(f.t, 10)}:${stepT(f.t, 12)}:${stepT(f.t, 15)}:${stepT(f.t, 24)}:${stepT(f.t, 30)}`;
  }
  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const key = this.drawKey(f);
    if (key !== null && key === this.lastDrawKey) {
      if (this.cachedMarks.length) pushMarks(this.cachedMarks);
      this.printOut(this.layer.texture, out, f, this.lastPrintOpts);
      return POST;
    }
    this.lastDrawKey = key;
    const markStart = marks().length;
    this.layer.clear();
    const o = this.draw(this.layer.ctx, f) ?? {};
    this.lastPrintOpts = o;
    this.cachedMarks = marks().slice(markStart);
    this.printOut(this.layer.upload(), out, f, o);
    return POST;
  }
  /** Print `src` into `out` with this plate's plane. */
  protected printOut(src: THREE.Texture, out: THREE.WebGLRenderTarget, f: Frame, o: PrintOpts) {
    const r = this.ctx.renderer;
    const p = this.plane;
    const id = p.of ?? this.ctx.id;
    this.planeBoard ??= new GPULife(MACHINE_W, MACHINE_H, planeSeed(p.seed ?? idSeed(id), { guns: p.guns, osc: p.osc }));
    const lt = Math.max(0, f.t - (p.t0 ?? this.ctx.start));
    const life = this.planeBoard.at(r, MACHINE_WARM + Math.max(0, stepN(lt, p.rate ?? 12)));
    this.print.render(r, src, out, f.t, o, { life });
  }
  override dispose() {
    this.layer.texture.dispose();
    this.planeBoard?.dispose();
  }
}


// ---------- rebate print (tiny true marks) ----------
// One system for the small labels of this video (12 px mono):
// - Readouts are the edge print of the film. They are on the letterbox bars, on the centre line of the
//   bottom bar, at x 72 (left) and W - 72 (right). A clip whose things fall through the bottom bar
//   (ceiling) uses the top bar. The left readout gives the section and the main counter of the clip. The
//   right readout gives a second value. Draw them with `readout`, after `drawBars` and before the things
//   that go out over the bars: these things go in front of them.
// - Diegetic labels are parts of a drawn thing: a title block, a layer name, an entry number, a dialog.
//   They stay on their thing in the frame and do not touch the lyric.
// - A label shows true data of the scene. It stays for all of its clip (or of its thing), or it comes on
//   and goes off on a beat.
// - A label is solid: PAPER (tone 1) on a dark ground, INK (tone 0) on paper. The print pass changes a
//   gray into dots, and 12 px text in dots is not legible.
export const REBATE = F.mono(400);
export function rebate(c: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign = 'left', tone = 1) {
  c.font = font(REBATE, 12);
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.fillStyle = gray(tone);
  c.fillText(text, x, y);
}

/** x of the readouts from the left and the right frame edge: 6 ASCII cells. */
export const READOUT_X = 72;
/**
 * A readout on a bar (see above). `top`: the top bar. `dy`: px that the bar moved (when a bar goes, its
 * readout goes with it). A black plate under the text keeps it legible on a laid wall.
 */
export function readout(c: CanvasRenderingContext2D, text: string, side: 'left' | 'right', top = false, dy = 0) {
  const x = side === 'left' ? READOUT_X : W - READOUT_X;
  const y = (top ? BAR / 2 : H - BAR / 2) + dy;
  c.font = font(REBATE, 12);
  const w = c.measureText(text).width;
  c.fillStyle = INK;
  c.fillRect(side === 'left' ? x - 6 : x - w - 6, y - 10, w + 12, 20);
  rebate(c, text, x, y, side, 1);
}

/**
 * The letterbox walls: solid black. Blue never shows in them; objects may be drawn over them after
 * (things poking out of the frame). `inset` [top, bottom, left, right] in px (top/bottom default BAR).
 */
export function drawBars(c: CanvasRenderingContext2D, inset: [number, number, number, number] = [BAR, BAR, 0, 0]) {
  const [top, bot, left, right] = inset;
  c.fillStyle = INK;
  c.fillRect(0, 0, W, top);
  c.fillRect(0, H - bot, W, bot);
  c.fillRect(0, top, left, H - top - bot);
  c.fillRect(W - right, top, right, H - top - bot);
}

// ---------- Game of Life (the computational growth of what he said) ----------

/** A Life board on the CPU with unrolled toroidal wrapping; `at(gens)` steps it deterministically. */
export class Life {
  readonly seed: Uint8Array;
  private cur: Uint8Array;
  private nxt: Uint8Array;
  /** generations stepped since the seed; -1 = the seed changed, copy it on the next `at` */
  private gens = -1;
  constructor(readonly w: number, readonly h: number) {
    this.seed = new Uint8Array(w * h);
    this.cur = new Uint8Array(w * h);
    this.nxt = new Uint8Array(w * h);
  }
  /** Set the seed cells of brick text at cell (ox, oy) of the board. */
  seedText(bt: BrickText, ox: number, oy: number) {
    for (const b of bt.bricks) for (let k = 0; k < b.len; k++) {
      const x = (ox + b.cx + k) % this.w, y = (oy + b.cy) % this.h;
      if (x >= 0 && y >= 0) this.seed[y * this.w + x] = 1;
    }
    this.gens = -1;
  }
  /** The seed was rewritten in place: the next `at` starts over from it. */
  reseed() {
    this.gens = -1;
  }
  /** Step one generation with unrolled toroidal boundary wrapping. */
  step() {
    const a = this.cur, n = this.nxt, w = this.w, h = this.h;
    for (let y = 0; y < h; y++) {
      const ym = (y > 0 ? y - 1 : h - 1) * w;
      const y0 = y * w;
      const yp = (y + 1 < h ? y + 1 : 0) * w;

      // left wrap edge (x = 0)
      {
        const xm = w - 1, xp = 1;
        const s = a[ym + xm] + a[ym] + a[ym + xp] +
                  a[y0 + xm]        + a[y0 + xp] +
                  a[yp + xm] + a[yp] + a[yp + xp];
        const alive = a[y0]!;
        n[y0] = (s === 3 || (alive === 1 && s === 2)) ? 1 : 0;
      }

      // unrolled interior (x = 1 .. w - 2)
      for (let x = 1; x < w - 1; x++) {
        const s = a[ym + x - 1] + a[ym + x] + a[ym + x + 1] +
                  a[y0 + x - 1]             + a[y0 + x + 1] +
                  a[yp + x - 1] + a[yp + x] + a[yp + x + 1];
        const alive = a[y0 + x]!;
        n[y0 + x] = (s === 3 || (alive === 1 && s === 2)) ? 1 : 0;
      }

      // right wrap edge (x = w - 1)
      {
        const x = w - 1, xm = w - 2, xp = 0;
        const s = a[ym + xm] + a[ym + x] + a[ym + xp] +
                  a[y0 + xm]             + a[y0 + xp] +
                  a[yp + xm] + a[yp + x] + a[yp + xp];
        const alive = a[y0 + x]!;
        n[y0 + x] = (s === 3 || (alive === 1 && s === 2)) ? 1 : 0;
      }
    }
    this.cur = n;
    this.nxt = a;
    this.gens++;
  }

  /** The board after `gens` generations. */
  at(gens: number): Uint8Array {
    const g = Math.max(0, Math.floor(gens));
    if (g < this.gens || this.gens < 0) { this.cur.set(this.seed); this.gens = 0; }
    while (this.gens < g) this.step();
    return this.cur;
  }
}
export function hashI(a: number, b: number, s = 0) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------- the print pass ----------
const PRINT = /* glsl */ `
uniform sampler2D src;
uniform sampler2D uLife;  // the plate's plane board (640x360 cells, row 0 at the top)
uniform sampler2D uUnder; // Over mode: what is under this layer
uniform float uOver;      // 1: Over mode (no blue ground, no overlays)
uniform vec3 uView;       // plane offset px (x, y down) and cell size px
uniform float uFull;      // 1: plane, grain and clumps over the whole frame
uniform float uSeed;     // boil seed (stepped)
uniform float uNoise;    // noise frame (17 fps), wrapped for hashing
uniform float uGrainF;   // grain frame (8 fps), wrapped
uniform float uDrift;    // noise frame (17 fps), unwrapped, for motion
uniform float uCoarse;   // 0..1 halftone cell growth
uniform float uBleed;    // px of ink-edge wander
uniform vec4 uAmt;       // grain, plane, ships, scratches (each times the master amount)
uniform float uClumpAmt;
uniform float uClumpKill; // 0..1: how far the clumps' fade-out has come
float screenAt(vec2 p, float cell, float ang) {
  vec2 q = rot2(ang) * p / cell;
  return 0.5 + 0.25 * (cos(6.2831853 * q.x) + cos(6.2831853 * q.y));
}
void main() {
  vec2 px = FRAG_PX;
  vec2 sp = vec2(px.x, 1080.0 - px.y); // y down, as the canvas layers are drawn
  float s = uSeed;
  vec2 w = vec2(fbm(px * 0.028 + vec2(s * 1.7, 3.1), 3), fbm(px * 0.028 + vec2(31.0, s * 1.3), 3));
  vec2 w2 = vec2(snoise(px * 0.21 + s * 3.0), snoise(px * 0.21 + 9.0 - s * 3.0));
  vec2 off = w * uBleed + w2 * 0.7;
  vec4 c = texture(src, vUv + off / vec2(1920.0, 1080.0));
  float cell = mix(4.0, 13.0, uCoarse);
  float soft = 0.06;
  // coverage: halftone screen on partial alpha, solid at full alpha
  float a = remap(c.a, 0.06, 0.94, -0.08, 1.08);
  float cov = smoothstep(-soft, soft, a - screenAt(px, cell, 0.785));
  // tone: perceptual luma through a second screen
  vec3 rgb = c.a > 0.0 ? c.rgb : vec3(0.0);
  float lum = sat(luma(rgb));
  // only true black (INK #000) is clean: dark grays screen as paper dots again, they must not vanish on black
  float isDark = step(lum, 0.005);
  float L = remap(pow(lum, 1.0 / 2.2), 0.12, 0.9, -0.08, 1.08);
  float paper = (1.0 - isDark) * smoothstep(-soft, soft, L - screenAt(px, cell, 0.26));
  vec3 paperCol = C_BONE * (0.93 + 0.07 * fbm(px * 0.013 + 4.0, 2));
  vec3 inkCol = vec3(0.0);
  vec3 blue = C_SIGNAL * (0.88 + 0.12 * fbm(px * 0.006 + 2.0, 3));
  float isBlue = step(0.35, rgb.b - max(rgb.r, rgb.g));
  vec3 fgCol = mix(mix(inkCol, paperCol, paper), blue, isBlue);
  vec3 col = mix(uOver > 0.5 ? texture(uUnder, vUv).rgb : blue, fgCol, cov);
  // Over mode without overlays (tiles, laser): the layer only covers what is under it
  if (uOver > 0.5 && uAmt.x + uAmt.y + uAmt.w + uClumpAmt <= 0.0) { fragColor = vec4(col, 1.0); return; }
  // overlays: several kinds at once, all small: no windows, no blocks, no feathered patches
  float inBox = max(uFull, step(138.0, sp.y) * step(sp.y, 942.0));
  float ns = uNoise;
  // 1 · grain: sparse 2 px specks, a new field 8 times a second
  float grain = step(0.9995, hash12(floor(px / 2.0) + uGrainF * 7.31)) * inBox;
  // 2 · plane: the plate's Life board, moving with its camera (a cell size other than 3 scales it about the
  // frame centre, offset by the view: a camera zooming about a point keeps the board anchored there)
  vec2 lc = mod(floor((sp - vec2(960.0, 540.0) + uView.xy) / uView.z), vec2(640.0, 360.0));
  float life = texelFetch(uLife, ivec2(lc.x, 359.0 - lc.y), 0).r * inBox;
  // 4 · scratches: rare short vertical hairlines that live a few frames (they may cross the bars)
  float colB = floor(px.x / 2.0);
  float scr = step(0.9994, hash12(vec2(colB, floor(ns / 3.0)))) * step(0.8, hash12(vec2(colB, floor(px.y / 140.0) + ns)));
  // 5 · clumps: small groups of 6 px blocks (30 px across) riding right, each 30 px row at its own speed
  float row = floor(px.y / 30.0);
  float spd = 8.0 + 10.0 * hash12(vec2(row, 3.0));
  vec2 q = vec2(px.x - uDrift * spd, px.y);
  vec2 grp = floor(q / 30.0), blk = floor(mod(q, 30.0) / 6.0);
  // each clump has its own moment to fade: its fade takes half of the kill range, starting at its own hash;
  // at kill 1 every clump is at 0
  float alive = clamp(1.0 - (uClumpKill * 1.5 - hash12(grp + 53.0)) / 0.5, 0.0, 1.0);
  float clumpInBox = step(138.0, sp.y) * step(sp.y, 942.0);
  float clump = step(0.992, hash12(grp + 19.0)) * step(0.5, hash13(vec3(grp, blk.x * 5.0 + blk.y))) * clumpInBox * alive;
  // the plane and the clumps lie behind the drawing: only on the bare ground and on pure black fills, never on an item
  float ground = (1.0 - cov) + cov * isDark * (1.0 - isBlue);
  float n = max(max(grain * uAmt.x, life * uAmt.y * ground), max(scr * uAmt.w, clump * uClumpAmt * ground));
  // Over mode: the overlays are only on the pixels this layer covers, the rest keeps what is under it
  if (uOver > 0.5) n *= cov;
  vec3 flip = cov < 0.5 ? inkCol : (paper > 0.5 ? inkCol : paperCol);
  col = mix(col, flip, n * 0.9);
  fragColor = vec4(col, 1.0);
}`;

/** Noise layers (scratches, clumps) step at 17 fps; the grain at 8. */
export const NOISE_FPS = 17;
export const GRAIN_FPS = 8;

export class Print {
  private pass = new FSPass(PRINT, {
    src: { value: null }, uLife: { value: null }, uUnder: { value: null }, uOver: { value: 0 },
    uView: { value: new THREE.Vector3(0, 0, 3) }, uFull: { value: 0 },
    uSeed: { value: 0 }, uNoise: { value: 0 }, uGrainF: { value: 0 }, uDrift: { value: 0 },
    uCoarse: { value: 0 }, uBleed: { value: 2.2 }, uAmt: { value: new THREE.Vector4(1, 1, 1, 1) }, uClumpAmt: { value: 1 }, uClumpKill: { value: 0 },
  });
  /**
   * Binarize `src` into `out`: over the blue ground with the plate's overlays (`layers.life`),
   * or, with `layers.under`, over that texture with no overlays (Over transitions). The ink boils at 12 fps.
   */
  render(
    renderer: THREE.WebGLRenderer, src: THREE.Texture, out: THREE.WebGLRenderTarget, t: number, o: PrintOpts,
    layers: { life: THREE.Texture } | { under: THREE.Texture } | { life: THREE.Texture; under: THREE.Texture },
  ) {
    const u = this.pass.u;
    const g = Math.max(0, stepN(t, NOISE_FPS));
    u.src!.value = src;
    u.uSeed!.value = stepN(t, 12) % 997;
    u.uCoarse!.value = o.coarse ?? 0;
    u.uBleed!.value = o.bleed ?? 2.2;
    if ('under' in layers) {
      u.uOver!.value = 1;
      u.uUnder!.value = layers.under;
      u.uLife!.value = 'life' in layers ? layers.life : layers.under;
    } else {
      u.uOver!.value = 0;
      u.uUnder!.value = src;
      u.uLife!.value = layers.life;
    }
    const m = o.noise ?? 1;
    u.uNoise!.value = g % 997;
    u.uGrainF!.value = stepN(t, GRAIN_FPS) % 997;
    u.uDrift!.value = g;
    u.uClumpKill!.value = o.clumpKill ?? 0;
    (u.uView!.value as THREE.Vector3).set(o.view?.x ?? 0, o.view?.y ?? 0, o.view?.cell ?? 3);
    u.uFull!.value = o.full ? 1 : 0;
    // an Over layer (no blue ground) takes the overlays only when it asks for them
    const ov = 'under' in layers && !o.overlays ? 0 : 1;
    (u.uAmt!.value as THREE.Vector4).set((o.grain ?? 1) * m * ov, (o.plane ?? m) * ov, 0.0, (o.scratches ?? 1) * m * ov);
    u.uClumpAmt!.value = (o.clumps ?? 1) * m * ov;
    this.pass.render(renderer, out, false, o.scissor);
  }
}

/**
 * An Over transition of this video (video.json `transitions`): it draws its own layer and prints it over
 * the clips under it (no blue ground, no second set of overlays). `f.p` runs 0..1 over its span.
 */
export abstract class OverScene extends Scene {
  override handlesTransition = true;
  protected layer = new Layer2D();
  protected print = new Print();
  protected plane: PlaneDef = {};
  private planeBoard: GPULife | null = null;
  private lastDrawKey: string | number | null = null;
  private lastPrintOpts: PrintOpts = {};
  private cachedMarks: Mark[] = [];

  abstract draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts | void;
  drawKey(f: Frame): string | number | null {
    return `${stepT(f.t, 10)}:${stepT(f.t, 12)}:${stepT(f.t, 15)}:${stepT(f.t, 24)}:${stepT(f.t, 30)}`;
  }
  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    if (!f.under) throw new Error(`Over transition ${this.ctx.id} has nothing under it`);
    const key = this.drawKey(f);
    if (key !== null && key === this.lastDrawKey) {
      if (this.cachedMarks.length) pushMarks(this.cachedMarks);
      this.printOut(this.layer.texture, out, f, this.lastPrintOpts);
      return POST;
    }
    this.lastDrawKey = key;
    const markStart = marks().length;
    this.layer.clear();
    const o = this.draw(this.layer.ctx, f) ?? {};
    this.lastPrintOpts = o;
    this.cachedMarks = marks().slice(markStart);
    this.printOut(this.layer.upload(), out, f, o);
    return POST;
  }
  protected printOut(src: THREE.Texture, out: THREE.WebGLRenderTarget, f: Frame, o: PrintOpts) {
    const r = this.ctx.renderer;
    const p = this.plane;
    const id = p.of ?? this.ctx.id;
    this.planeBoard ??= new GPULife(MACHINE_W, MACHINE_H, planeSeed(p.seed ?? idSeed(id), { guns: p.guns, osc: p.osc }));
    const lt = Math.max(0, f.t - (p.t0 ?? this.ctx.start));
    const life = this.planeBoard.at(r, MACHINE_WARM + Math.max(0, stepN(lt, p.rate ?? 12)));
    this.print.render(r, src, out, f.t, o, { life, under: f.under! });
  }
  override dispose() {
    this.layer.texture.dispose();
    this.planeBoard?.dispose();
  }
}
