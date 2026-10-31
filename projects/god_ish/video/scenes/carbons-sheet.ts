// The typed sheets of plate 1: the original and its carbons. Each strike is one written unit at its onset, set
// in a vertical column (one column per line, read right to left). The same strike prints on every sheet of the
// stack: each carbon fainter, softer and further off register, and each strike lands a little apart on each.
import { SCALE, scaleContext2D } from '@pve/engine/gl';
import { lineNo, unitAt, units, type Line, type Lyrics, type WrittenPhrase } from '@pve/engine/lyrics';
import { font, vcells } from '@pve/engine/type';
import { hash } from '@pve/engine/util';
import { fnt, INK, MONO, seal, SERIF, tone } from './_page';

/** Sheet size, glyph size, column pitch, first glyph top: sheet px. */
export const SW = 440;
export const SH = 760;
export const G = 34;
export const P = 46;
export const TOP = 60;
const RIGHT = 396;
export const LINES = [4, 5, 6, 7, 8, 9, 10, 11];
const TURN = 7; // ぽいじゃん
const SEAL = 11; // 神っぽいな
/** The seal radius. */
export const SR = 40;
/** The line after the hook's last とぅとぅる stands apart (a paragraph). */
const PARA = 10;

/** Per sheet: 0 the original, then the carbons. Fixed slip of the sheet, ink tone, softness px, strike scatter px. */
export const STACK = [
  { dx: 0, dy: 0, rot: 0, tone: 0, blur: 0, scatter: 0.6 },
  { dx: 4, dy: 3, rot: 0.004, tone: 0.42, blur: 0.8, scatter: 1.6 },
  { dx: -6, dy: 8, rot: -0.007, tone: 0.6, blur: 1.6, scatter: 2.8 },
] as const;

interface Cell { ch: string; small: boolean; rot: boolean; x: number; y: number }
export interface Strike {
  line: number;
  unit: number;
  t: number;
  glyph: string;
  cells: Cell[];
  /** Ribbon pressure lost on this strike, 0..0.18 (uneven strike density). */
  light: number;
  /** Strike scatter, unit vectors per sheet (scaled by the sheet's scatter). */
  jit: [number, number][];
}
interface Col { line: Line; x: number }

/** A box on a sheet, sheet px: x0, y0, x1, y1. */
type Box = [number, number, number, number];
/** The pad of a carbon's scratch around the sheet: room for its slip and blur. */
const SPAD = 40;

interface Sheet {
  cv: HTMLCanvasElement;
  c: CanvasRenderingContext2D;
  /** Strikes set and the turn of ぽいじゃん they were set at (n -1: nothing set yet). */
  n: number;
  turn: number;
  /** A carbon's strikes, slipped and toned, before the blur (null on the original). */
  sc: CanvasRenderingContext2D | null;
}

function canvas2D(w: number, h: number): CanvasRenderingContext2D {
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * SCALE);
  cv.height = Math.round(h * SCALE);
  return scaleContext2D(cv.getContext('2d', { willReadFrequently: true })!, SCALE);
}

function newSheet(k: number): Sheet {
  const c = canvas2D(SW, SH);
  return { cv: c.canvas, c, n: -1, turn: Number.NaN, sc: k === 0 ? null : canvas2D(SW + 2 * SPAD, SH + 2 * SPAD) };
}

export class Sheets {
  readonly strikes: Strike[] = [];
  private readonly cols: Col[] = [];
  /** Each sheet as last set (see `draw`); a carbon also keeps its strikes, slipped and toned, before the blur. */
  private readonly sheets: Sheet[] = [];

  constructor(lyrics: Lyrics) {
    const m = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    m.font = fnt(SERIF, G, 400);
    LINES.forEach((i, j) => {
      const line = lineNo(lyrics, i);
      const x = RIGHT - j * P - (i === SEAL ? PARA : 0);
      let y = TOP;
      units(line).forEach((u, k) => {
        const cells: Cell[] = [];
        for (const v of vcells(u.glyph, (s) => m.measureText(s).width / G)) {
          cells.push({ ch: v.ch, small: v.small, rot: v.rot, x, y: y + (G * v.adv) / 2 });
          y += G * v.adv;
        }
        this.strikes.push({
          line: i, unit: k, t: u.start, glyph: u.glyph, cells,
          light: 0.18 * hash(i, k, 3),
          jit: STACK.map((_, s) => [hash(i, k, s, 1) * 2 - 1, hash(i, k, s, 2) * 2 - 1] as [number, number]),
        });
      });
      this.cols.push({ line, x });
    });
  }

  /** The x of the column of line i, sheet px. */
  colX(i: number): number {
    return this.cols.find((c) => c.line.i === i)!.x;
  }

  /** The strikes made by t. */
  struckBy(t: number): number {
    let n = 0;
    while (n < this.strikes.length && this.strikes[n]!.t <= t) n++;
    return n;
  }

  /**
   * Where strike i lands on sheet k at t, sheet px before the slip (see `slip`): per cell its centre, its angle
   * and the offset of the glyph in the turned cell (small kana sit high and right).
   */
  place(lyrics: Lyrics, k: number, i: number, t: number): { ch: string; x: number; y: number; a: number; ox: number; oy: number }[] {
    const sk = this.strikes[i]!;
    const st = STACK[k]!;
    const [jx, jy] = sk.jit[k]!;
    const a = sk.line === TURN ? this.turn(lyrics, t) : 0;
    return sk.cells.map((cl) => ({
      ch: cl.ch, x: cl.x + jx * st.scatter, y: cl.y + jy * st.scatter, a: a + (cl.rot ? Math.PI / 2 : 0),
      ox: cl.small ? G * 0.12 : 0, oy: cl.small ? -G * 0.1 : 0,
    }));
  }

  /** Sheet px of sheet k at (sx, sy) on the page: the transform of `c` set to its slip. */
  slip(c: CanvasRenderingContext2D, k: number, sx: number, sy: number) {
    const st = STACK[k]!;
    c.translate(sx + SW / 2 + st.dx, sy + SH / 2 + st.dy);
    c.rotate(st.rot);
    c.translate(-SW / 2, -SH / 2);
  }

  /** The cell of 神 in line 11 (sheet px) and its onset: the seal is cut there. */
  kami(): { x: number; y: number; t: number } {
    const s = this.strikes.find((x) => x.line === SEAL && x.glyph.includes('神'));
    if (!s) throw new Error(`line ${SEAL} has no 神`);
    const cl = s.cells.find((x) => x.ch === '神')!;
    return { x: cl.x, y: cl.y, t: s.t };
  }

  /** The angle of every glyph of ぽいじゃん: one step per onset, all alike, and held after. */
  private turn(lyrics: Lyrics, t: number): number {
    const us = units(lineNo(lyrics, TURN));
    const k = unitAt(us, t);
    return k < 0 ? 0 : ((k + 1) / us.length) * (Math.PI / 2);
  }

  /** Strikes i0..i1-1, set on context `s` in sheet px (no slip), in the current fill. */
  private set(s: CanvasRenderingContext2D, k: number, i0: number, i1: number, turn: number) {
    const st = STACK[k]!;
    s.font = fnt(SERIF, G, 400);
    s.textAlign = 'center';
    s.textBaseline = 'middle';
    for (const sk of this.strikes.slice(i0, i1)) {
      s.globalAlpha = 1 - sk.light;
      const a = sk.line === TURN ? turn : 0;
      const [jx, jy] = sk.jit[k]!;
      for (const cl of sk.cells) {
        s.save();
        s.translate(cl.x + jx * st.scatter, cl.y + jy * st.scatter);
        s.rotate(a + (cl.rot ? Math.PI / 2 : 0));
        s.fillText(cl.ch, cl.small ? G * 0.12 : 0, cl.small ? -G * 0.1 : 0);
        s.restore();
      }
    }
    s.globalAlpha = 1;
  }

  /**
   * Sheet k at its top left (sx, sy): paper and the strikes made by t. A sheet changes only on a strike or a
   * turn of ぽいじゃん, and only around the glyphs that change: only that box is painted again. A seek back paints
   * the whole sheet.
   */
  draw(c: CanvasRenderingContext2D, lyrics: Lyrics, k: number, sx: number, sy: number, t: number) {
    const turn = this.turn(lyrics, t);
    const n = this.struckBy(t);
    const sheet = (this.sheets[k] ??= newSheet(k));
    if (n < sheet.n || sheet.n < 0) this.paint(sheet, k, n, turn, null);
    else if (n > sheet.n || turn !== sheet.turn) {
      // the glyphs that change: the new strikes, and on a turn every struck glyph of ぽいじゃん
      const cells = this.strikes.slice(0, n)
        .filter((s, i) => i >= sheet.n || (turn !== sheet.turn && s.line === TURN))
        .flatMap((s) => s.cells);
      // wide enough for the glyph, its scatter and the slip
      const r = G + 12;
      this.paint(sheet, k, n, turn, [
        Math.min(...cells.map((cl) => cl.x)) - r, Math.min(...cells.map((cl) => cl.y)) - r,
        Math.max(...cells.map((cl) => cl.x)) + r, Math.max(...cells.map((cl) => cl.y)) + r,
      ]);
    }
    c.drawImage(sheet.cv, sx, sy, SW, SH);
  }

  /**
   * Sheet k with the first n strikes at `turn`, painted again inside `box` (sheet px; null: the whole sheet). The
   * paper under the box is laid again; a carbon's scratch is set again around the box, as far as the blur reaches
   * into it, and blurred from there. A pixel only takes the scratch within the blur reach, so this is the same as
   * painting the whole sheet.
   */
  private paint(sheet: Sheet, k: number, n: number, turn: number, box: Box | null) {
    sheet.n = n;
    sheet.turn = turn;
    const st = STACK[k]!;
    const c = sheet.c;
    const [x0, y0, x1, y1] = box ?? [0, 0, SW, SH];
    c.save();
    c.beginPath();
    c.rect(x0, y0, x1 - x0, y1 - y0);
    c.clip();
    c.fillStyle = tone(1);
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (k === 0) {
      // the original: ribbon ink, each strike as hard as it was struck
      c.fillStyle = INK;
      this.set(c, 0, 0, n, turn);
      c.restore();
      return;
    }
    // a carbon: the same strikes through the carbon paper, slipped, gray and soft. The scratch region: the box
    // plus the reach of the widest blur and the smudge offset (scratch px are sheet px + SPAD, before the slip)
    const m = Math.ceil(st.blur * 2 * 3 + 2 * k + 2);
    const ax = Math.max(0, x0 + SPAD - m), ay = Math.max(0, y0 + SPAD - m);
    const aw = Math.min(SW + 2 * SPAD, x1 + SPAD + m) - ax, ah = Math.min(SH + 2 * SPAD, y1 + SPAD + m) - ay;
    const s = sheet.sc!;
    s.save();
    s.beginPath();
    s.rect(ax, ay, aw, ah);
    s.clip();
    s.clearRect(ax, ay, aw, ah);
    s.save();
    s.translate(SPAD + SW / 2 + st.dx, SPAD + SH / 2 + st.dy);
    s.rotate(st.rot);
    s.translate(-SW / 2, -SH / 2);
    s.fillStyle = INK;
    this.set(s, k, 0, n, turn);
    s.restore();
    s.globalCompositeOperation = 'source-in';
    s.fillStyle = tone(st.tone);
    s.fillRect(ax, ay, aw, ah);
    s.restore();
    const sub = (dx: number, dy: number) =>
      c.drawImage(s.canvas, ax * SCALE, ay * SCALE, aw * SCALE, ah * SCALE, ax - SPAD + dx, ay - SPAD + dy, aw, ah);
    c.filter = `blur(${st.blur}px)`;
    sub(0, 0);
    // carbon smudge: the sheet dragged a hair under the platen, a faint second image
    c.filter = `blur(${st.blur * 2}px)`;
    c.globalAlpha = 0.22 * k;
    sub(2 * k, 1.5 * k);
    c.restore();
  }

  /**
   * The EN gloss, typed small along the left of each column as one run: a phrase joins it when it is sung, in
   * the order of the gloss (the original only).
   */
  gloss(c: CanvasRenderingContext2D, sx: number, sy: number, t: number) {
    c.save();
    c.font = font(MONO, 12);
    c.fillStyle = INK;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    for (const col of this.cols) {
      const run = (col.line.written!.phrases as WrittenPhrase[]).filter((ph) => ph.start <= t).map((ph) => ph.text).join(' ');
      if (!run) continue;
      c.save();
      c.translate(sx + col.x - G / 2 - (P - G) / 2, sy + TOP + 3 + (col.line.i === SEAL ? SR + 6 : 0));
      c.rotate(Math.PI / 2);
      c.fillText(run, 0, 0);
      c.restore();
    }
    c.restore();
  }

  /** 神っぽいな: from the onset of 神 the seal is cut through the stack, through 神 on every sheet. */
  seals(c: CanvasRenderingContext2D, at: (k: number) => [number, number], t: number) {
    const cl = this.kami();
    if (t < cl.t) return;
    STACK.forEach((st, k) => {
      const [sx, sy] = at(k);
      // the cell centre on the slipped sheet
      const ox = cl.x - SW / 2, oy = cl.y - SH / 2;
      const x = sx + SW / 2 + st.dx + ox * Math.cos(st.rot) - oy * Math.sin(st.rot);
      const y = sy + SH / 2 + st.dy + ox * Math.sin(st.rot) + oy * Math.cos(st.rot);
      seal(c, x, y, SR, 'hole');
    });
  }
}
