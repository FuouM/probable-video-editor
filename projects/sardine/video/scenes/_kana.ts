// Big kana of the lit renderer (treatment "Typography" and "Lyric carriers"). The voice moves the type. Every Japanese line
// has one carrier in the world or in the game UI. No kana layer goes over the picture.
//
// - `layoutKana`, `drawGlyph`, `drawKana`: the units of a line in the 16 px DotGothic16 scaled by a whole number, with a dark
//   outline. A carrier lays the full line out in its own space. Each unit lands on its calibrated start.
// - `diagonalLayout`: a `ko` line along the 45 degree fall of the tuna.
// - `printKana`: act 1 type that a tool prints, with one landing motion (`PrintMotion`).
//
// Everything here is a pure function of t and of the arguments. Glyph masks are cached, never drawn per frame from the font.
import type { Line } from '@pve/engine/lyrics';
import type { Col } from '@pve/engine/lit';
import { PixelFont, bigText, type Mask, type Pixels } from '@pve/engine/type';
import type { Rect } from './_playerTypes';
import { FPS } from './_time';
import { HOLD, writtenOf, type Fonts } from './_fonts';

export interface KanaColors {
  ink?: Col;
  /** The inner outline, r1 px. */
  edge?: Col;
  /** The outer outline, r2 px. */
  outer?: Col;
}

export interface KanaStyle extends KanaColors {
  /** Pen x of the row (see `align`) and baseline y of the first row, logical pixels. */
  x: number;
  y: number;
  align?: 'left' | 'center' | 'right';
  /** The pixel scale of the 16 px face: 2 is 32 px type. The layout takes a smaller scale when a row is wider than `maxW`. Default 2. */
  n?: number;
  /** Widest row, px. Default 600. */
  maxW?: number;
  /** Units per row, for example `[7, 5]`. Default one row. */
  rows?: number[];
  /** Extra px between glyphs. */
  gap?: number;
  /** Px between the baselines of two rows. Default 16 n + 4. */
  leading?: number;
  /** Outline widths in px. Default 1 and (n > 1 ? 1 : 0). */
  r1?: number;
  r2?: number;
}

export interface KanaGlyph {
  ch: string;
  /** Pen x and baseline y of the glyph. */
  x: number;
  y: number;
  row: number;
  /** Index of the unit in the line. */
  unit: number;
  /** The song time at which the glyph appears. */
  start: number;
}

export interface KanaLayout {
  glyphs: KanaGlyph[];
  n: number;
  r1: number;
  r2: number;
  /** The face the glyphs are drawn from. */
  face: PixelFont;
  /** Last second the line shows (its end plus the hold). */
  until: number;
  /** The box that holds the glyphs with their outline: x, y, w, h. */
  box: Rect;
  colors: KanaColors;
}

/** The default ink and the default outline of big kana. */
const INK: Col = '#f4efe2';
const DARK: Col = '#0c0c14';

/** The colours of `c`, else the colours of `lay`, else the default ink and outline. */
export function kanaColors(lay: KanaLayout, c: KanaColors): Required<KanaColors> {
  return { ink: c.ink ?? lay.colors.ink ?? INK, edge: c.edge ?? lay.colors.edge ?? DARK, outer: c.outer ?? lay.colors.outer ?? DARK };
}

export interface Big { ink: Mask; edge: Mask; outer: Mask | null }
const bigCache = new Map<string, Big>();
export function big(f: PixelFont, ch: string, n: number, r1: number, r2: number): Big {
  const key = `${f.family}|${f.size}|${ch}|${n}|${r1}|${r2}`;
  let b = bigCache.get(key);
  if (!b) bigCache.set(key, (b = bigText(f, ch, n, r1, r2)));
  return b;
}

function splitRows(count: number, rows?: number[]): number[] {
  if (!rows) return [count];
  if (rows.reduce((a, b) => a + b, 0) !== count) throw new Error(`caption: rows ${JSON.stringify(rows)} do not add up to the ${count} units of the line`);
  return rows;
}

/** Places every unit of `line` (the full line, never a crop) by `s`. */
export function layoutKana(fonts: Fonts, line: Line, s: KanaStyle): KanaLayout {
  const w = writtenOf(line);
  const f = fonts.kana;
  const rows = splitRows(w.units.length, s.rows);
  const gap = s.gap ?? 0, maxW = s.maxW ?? 600;
  const rowWidth = (n: number, a: number, b: number) => {
    let sum = 0;
    for (let k = a; k < b; k++) sum += f.width(w.units[k]!.glyph) * n + gap;
    return sum - gap;
  };
  let n = s.n ?? 2;
  for (; n > 1; n--) {
    let a = 0, widest = 0;
    for (const c of rows) { widest = Math.max(widest, rowWidth(n, a, a + c)); a += c; }
    if (widest <= maxW) break;
  }
  const r1 = s.r1 ?? 1, r2 = s.r2 ?? (n > 1 ? 1 : 0);
  const leading = s.leading ?? 16 * n + 4;
  const glyphs: KanaGlyph[] = [];
  let a = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  rows.forEach((c, row) => {
    const width = rowWidth(n, a, a + c);
    let x = s.x - (s.align === 'left' ? 0 : s.align === 'right' ? width : width / 2);
    const y = s.y + row * leading;
    for (let k = a; k < a + c; k++) {
      const u = w.units[k]!;
      glyphs.push({ ch: u.glyph, x: Math.round(x), y, row, unit: k, start: u.start });
      x += f.width(u.glyph) * n + gap;
    }
    x0 = Math.min(x0, Math.round(s.x - (s.align === 'left' ? 0 : s.align === 'right' ? width : width / 2)));
    x1 = Math.max(x1, x0 + width);
    y0 = Math.min(y0, y - 16 * n);
    y1 = Math.max(y1, y + 4 * n);
    a += c;
  });
  const pad = r1 + r2;
  return {
    glyphs, n, r1, r2, face: f, until: line.end + HOLD,
    box: [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad],
    colors: { ink: s.ink, edge: s.edge, outer: s.outer },
  };
}

export interface KanaDraw extends KanaColors {
  /** Offset of the copy, px (the `ca` voice is the lead offset by 1 to 2 px). */
  dx?: number;
  dy?: number;
  /** Draws these units only (indexes into the glyph list). Default all that have started. */
  only?: (g: KanaGlyph) => boolean;
  /** Ink only, no outlines: a copy drawn over the line (the ca voice) keeps the outline of the line under it. */
  plain?: boolean;
}

/** Anything that kana can be inked into: a `TextLayer` (the 640x360 frame or a small surface on a 3D object). */
export interface Ink {
  sink(key: Record<number, Col>): Pixels;
  rect(x: number, y: number, w: number, h: number, c: Col, a?: number): void;
}

/** Draws one glyph with its outlines: outer, edge, ink. */
export function drawGlyph(l: Ink, lay: Pick<KanaLayout, 'face' | 'n' | 'r1' | 'r2'>, ch: string, x: number, y: number, c: KanaColors = {}) {
  const sink = l.sink({ 1: c.ink ?? INK, 2: c.edge ?? DARK, 3: c.outer ?? DARK });
  const b = big(lay.face, ch, lay.n, lay.r1, lay.r2);
  b.outer?.draw(sink, x, y, 3);
  b.edge.draw(sink, x, y, 2);
  b.ink.draw(sink, x, y, 1);
}

/** Draws the units of `lay` that have started at time t, until the line ends. */
export function drawKana(l: Ink, lay: KanaLayout, t: number, o: KanaDraw = {}) {
  if (t > lay.until) return;
  const c = kanaColors(lay, o);
  // all the outlines first, so a neighbour's outline never cuts into a glyph
  const sink = l.sink({ 1: c.ink, 2: c.edge, 3: c.outer });
  const shown = lay.glyphs.filter((g) => g.start <= t && (!o.only || o.only(g)));
  const at = (g: KanaGlyph) => big(lay.face, g.ch, lay.n, lay.r1, lay.r2);
  if (!o.plain) {
    for (const g of shown) at(g).outer?.draw(sink, g.x + (o.dx ?? 0), g.y + (o.dy ?? 0), 3);
    for (const g of shown) at(g).edge.draw(sink, g.x + (o.dx ?? 0), g.y + (o.dy ?? 0), 2);
  }
  for (const g of shown) at(g).ink.draw(sink, g.x + (o.dx ?? 0), g.y + (o.dy ?? 0), 1);
}

// ---------------------------------------------------------------- the 45 degree fall of the ko voice

export interface DiagonalStyle extends KanaColors {
  /** Where the first glyph is at `t0`, px. */
  from: readonly [number, number];
  /** The time the line starts to fall. Before it the line is at `from`. */
  t0: number;
  /** Speed along the fall, px/s. */
  speed: number;
  /** The fall direction (screen, y down). Default (-1, 1): down and to the left, 45 degrees. */
  fall?: readonly [number, number];
  n?: number;
  /** Px between glyph centres along the line. Default 18 n. */
  pitch?: number;
}

/**
 * A line laid along the 45 degree fall of the tuna: the first glyph leads, the others trail up and to the right
 * (so it reads left to right along a rising diagonal), and the whole line moves down and to the left at `speed`.
 */
export function diagonalLayout(fonts: Fonts, line: Line, t: number, s: DiagonalStyle): KanaLayout {
  const w = writtenOf(line, 'lyrics.map.ko.json');
  const n = s.n ?? 2;
  const fall = s.fall ?? [-1, 1];
  const len = Math.hypot(fall[0], fall[1]);
  const dir: [number, number] = [fall[0] / len, fall[1] / len];
  const pitch = s.pitch ?? 18 * n;
  const d = Math.max(0, t - s.t0) * s.speed;
  const f = fonts.kana;
  const glyphs: KanaGlyph[] = w.units.map((u, k) => {
    // the k-th glyph trails the head by k pitches against the fall direction, kept on a 45 degree step
    const x = s.from[0] + dir[0] * d - dir[0] * pitch * k;
    const y = s.from[1] + dir[1] * d - dir[1] * pitch * k;
    return { ch: u.glyph, x: Math.round(x - (f.width(u.glyph) * n) / 2), y: Math.round(y + 8 * n), row: 0, unit: k, start: u.start };
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of glyphs) { x0 = Math.min(x0, g.x); y0 = Math.min(y0, g.y - 16 * n); x1 = Math.max(x1, g.x + 16 * n); y1 = Math.max(y1, g.y + 4 * n); }
  return { glyphs, n, r1: 1, r2: 1, face: f, until: line.end + HOLD, box: [x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4], colors: { ink: s.ink, edge: s.edge, outer: s.outer } };
}

// ---------------------------------------------------------------- the act type kit (treatment "Typography")

/** Draws a mask scaled in x by `sx` (< 1 squashes it about its middle). */
function putMask(sink: Pixels, m: Mask, x: number, y: number, idx: number, sx = 1) {
  if (sx >= 1) { m.draw(sink, x, y, idx); return; }
  const ws = Math.max(1, Math.round(m.w * sx));
  const left = Math.round(x + m.x0 + (m.w - ws) / 2);
  for (let v = 0; v < m.h; v++) {
    for (let du = 0; du < ws; du++) {
      const u = Math.min(m.w - 1, Math.floor(((du + 0.5) / ws) * m.w));
      if (m.bits[v * m.w + u]) sink.put(left + du, y + m.y0 + v, idx);
    }
  }
}

/** How a tool prints a unit of act 1: `press` (2 frames), `slam` (3 frames, big), `flip` (4 frames, a turn), `invert` (3 frames, a block). */
export type PrintMotion = 'press' | 'slam' | 'flip' | 'invert';

export interface PrintStyle extends KanaDraw {
  motion: PrintMotion | ((g: KanaGlyph) => PrintMotion);
  /** The time each unit prints (a click or a stamp), by unit index. Default: the unit's start. */
  times?: readonly number[];
  /** The ink of the press frames. Default yellow. */
  hot?: Col;
}

/**
 * Act 1 type: kana that a tool prints, one unit per click or stamp. A unit shows from its print time, never fades in, and
 * plays its motion for the first frames:
 * `press` a 1 px push in the hot ink for 2 frames. `slam` 3x then 2x then 1x the size on 3 frames, and a 2 px dip.
 * `flip` the glyph turns to face you: 20, 50, 80 and 95 % of its width on 4 frames. It shows from the first frame.
 * `invert` the dark glyph on a light block for 3 frames.
 */
export function printKana(l: Ink, lay: KanaLayout, t: number, s: PrintStyle) {
  if (t > lay.until) return;
  const c = kanaColors(lay, s);
  const sink = l.sink({ 1: c.ink, 2: c.edge, 3: c.outer, 4: s.hot ?? '#ffd23a' });
  const dx = s.dx ?? 0, dy = s.dy ?? 0;
  interface Draw { ch: string; x: number; y: number; mul: number; sx: number; ink: number; outline: boolean }
  const draws: Draw[] = [];
  const blocks: { r: Rect; c: Col }[] = [];
  for (const g of lay.glyphs) {
    if (s.only && !s.only(g)) continue;
    const T = s.times?.[g.unit] ?? g.start;
    if (T > t) continue;
    const motion = typeof s.motion === 'function' ? s.motion(g) : s.motion;
    const f = Math.floor((t - T) * FPS + 1e-6);
    const b1 = big(lay.face, g.ch, lay.n, lay.r1, lay.r2);
    const d: Draw = { ch: g.ch, x: g.x + dx, y: g.y + dy, mul: 1, sx: 1, ink: 1, outline: true };
    const cx = g.x + dx + b1.ink.x0 + b1.ink.w / 2, cy = g.y + dy + b1.ink.y0 + b1.ink.h / 2;
    if (motion === 'press' && f < 2) { d.x += 1; d.y += 1; d.ink = 4; }
    else if (motion === 'slam' && f < 3) {
      if (f < 2) {
        d.mul = f === 0 ? 3 : 2;
        const bm = big(lay.face, g.ch, lay.n * d.mul, lay.r1, lay.r2);
        d.x = Math.round(cx - bm.ink.x0 - bm.ink.w / 2);
        d.y = Math.round(cy - bm.ink.y0 - bm.ink.h / 2);
      } else d.y += 2;
    } else if (motion === 'flip' && f < 4) {
      d.sx = [0.2, 0.5, 0.8, 0.95][f]!;
    } else if (motion === 'invert' && f < 3) {
      blocks.push({ r: [g.x + dx + b1.edge.x0 - 1, g.y + dy + b1.edge.y0 - 1, b1.edge.w + 2, b1.edge.h + 2], c: c.ink });
      d.ink = 2;
      d.outline = false;
    }
    draws.push(d);
  }
  for (const b of blocks) l.rect(b.r[0], b.r[1], b.r[2], b.r[3], b.c);
  const mask = (d: Draw) => big(lay.face, d.ch, lay.n * d.mul, lay.r1, lay.r2);
  for (const d of draws) if (d.outline) { const m = mask(d); if (m.outer) putMask(sink, m.outer, d.x, d.y, 3, d.sx); }
  for (const d of draws) if (d.outline) putMask(sink, mask(d).edge, d.x, d.y, 2, d.sx);
  for (const d of draws) putMask(sink, mask(d).ink, d.x, d.y, d.ink, d.sx);
}
