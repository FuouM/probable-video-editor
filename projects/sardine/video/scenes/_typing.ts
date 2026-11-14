// The typing prompt of chorus 3: `drawTypingPrompt` shows a lead or `ko` line with its romaji (`unitRomaji`) in a box at a
// screen point, and fills the units red as the player types them.
import { syllables, type Line } from '@pve/engine/lyrics';
import { LW } from '@pve/engine/lit';
import type { TextLayer } from '@pve/engine/textlayer';
import type { Rect, Vec2 } from './_playerTypes';
import { chromeText, chromeWidth } from './_playerChrome';
import { FPS } from './_time';
import { HOLD, writtenOf, type Fonts } from './_fonts';
import { drawGlyph } from './_kana';

/**
 * The romaji of each written unit of a lead or `ko` line, from the syllables of the lane (`sylText`, or the word when it has
 * one syllable). `space` is true on the first unit of a word that is not the first of the line. The lanes carry the romaji
 * (`lanes.json`: `kuromaguro ga tondekuru`), so no conversion from kana is needed.
 */
export function unitRomaji(line: Line): { text: string; space: boolean }[] {
  const w = writtenOf(line);
  const syl = syllables(line);
  return w.units.map((u, k) => {
    const part = syl.slice(u.from, u.to);
    if (!part.length) throw new Error(`sardine: unit ${k} of line ${line.i} has no syllable`);
    const prev = k > 0 ? syl[w.units[k - 1]!.from] : undefined;
    return { text: part.map((s) => s.text).join(''), space: prev !== undefined && prev.wi !== part[0]!.wi };
  });
}

export interface TypingStyle {
  /** The screen point the box points at. The scene projects a tuna into it. */
  anchor: Vec2;
  /** The box sits above the anchor (default) or below it. */
  side?: 'above' | 'below';
  /** Seconds that the red fill lags behind the sung time of a unit: `base + grow * (seconds since the first unit)`. Default 0.12 and 0.3. */
  lag?: { base: number; grow: number };
  /** The song time of the miss. From it the box flashes MISS, and the units that were not typed by then never fill. */
  missAt?: number;
  /** The pixel scale of the kana. Default 1. */
  n?: number;
  /** Show from this time. Default the first unit. */
  from?: number;
  /** Show until this time. Default the end of the line plus `HOLD`. */
  until?: number;
}

const TYPING = { ink: '#f4efe2', typed: '#ff3a3a', box: '#0a0c14', dark: '#0a0c14', typedEdge: '#380808', rim: '#f4efe2', miss: '#ff3a3a' };

/**
 * A Typing-of-the-Dead prompt: a box with the kana line and its romaji, anchored at a screen point. Typed units fill red.
 * The fill lags behind the sung times by a lag that grows, so the player falls behind the song. At `missAt` the box flashes
 * `MISS` for 0.75 s. Returns the box, or null when it does not show.
 */
export function drawTypingPrompt(l: TextLayer, fonts: Fonts, line: Line, t: number, s: TypingStyle): Rect | null {
  const units = writtenOf(line).units;
  const first = units[0]!.start;
  if (t < (s.from ?? first) || t > (s.until ?? line.end + HOLD)) return null;
  const n = s.n ?? 1;
  const lag = s.lag ?? { base: 0.12, grow: 0.3 };
  const rom = unitRomaji(line).map((r) => ({ text: r.text.toUpperCase(), space: r.space }));
  const latin = fonts.latin;
  const spaceW = latin.width(' ') || 4;
  const kanaW = units.reduce((a, u) => a + fonts.kana.width(u.glyph) * n, 0);
  const romW = rom.reduce((a, r) => a + latin.width(r.text) + (r.space ? spaceW : 0), 0);
  const pad = 6;
  const bw = Math.max(kanaW, romW) + 2 * pad, bh = pad + 20 * n + 10 + pad;
  const side = s.side ?? 'above';
  const bx = Math.max(3, Math.min(LW - bw - 3, Math.round(s.anchor[0] - bw / 2)));
  const by = Math.round(side === 'above' ? s.anchor[1] - 8 - bh : s.anchor[1] + 8);
  const flash = s.missAt !== undefined && t >= s.missAt && t < s.missAt + 0.75 && Math.floor(((t - s.missAt) * FPS) / 3) % 2 === 0;
  const rim = flash ? TYPING.miss : TYPING.rim;
  // the tail points at the anchor
  const tx = Math.max(bx + 8, Math.min(bx + bw - 8, Math.round(s.anchor[0])));
  for (let j = 0; j < 6; j++) {
    const ty = side === 'above' ? by + bh + j : by - 1 - j;
    l.rect(tx - 5 + j, ty, 11 - 2 * j, 1, rim);
    if (j < 5) l.rect(tx - 4 + j, ty, 9 - 2 * j, 1, TYPING.box);
  }
  l.rect(bx - 1, by - 1, bw + 2, bh + 2, '#000000');
  l.rect(bx, by, bw, bh, rim);
  l.rect(bx + 2, by + 2, bw - 4, bh - 4, TYPING.box);
  // which units are typed
  const typedAt = units.map((u) => u.start + lag.base + lag.grow * (u.start - first));
  const typed = units.map((_, k) => t >= typedAt[k]! && (s.missAt === undefined || typedAt[k]! <= s.missAt));
  const lay = { face: fonts.kana, n, r1: 1, r2: 0 };
  let x = bx + Math.round((bw - kanaW) / 2);
  const ky = by + pad + 16 * n;
  units.forEach((u, k) => {
    drawGlyph(l, lay, u.glyph, x, ky, typed[k] ? { ink: TYPING.typed, edge: TYPING.typedEdge } : { ink: TYPING.ink, edge: TYPING.dark });
    x += fonts.kana.width(u.glyph) * n;
  });
  const ry = ky + 4 * n + 2 + 8;
  x = bx + Math.round((bw - romW) / 2);
  rom.forEach((r, k) => {
    if (r.space) x += spaceW;
    latin.draw(l.sink({ 1: typed[k] ? TYPING.typed : TYPING.ink }), r.text, x, ry, 1);
    x += latin.width(r.text);
  });
  if (flash) {
    // a red tag on the side of the box away from the tail, so the line stays readable
    const text = 'MISS';
    const tw = chromeWidth(fonts, text, 2) + 12;
    const tx0 = bx + Math.round((bw - tw) / 2), ty0 = side === 'above' ? by - 20 : by + bh + 2;
    l.rect(tx0 - 1, ty0 - 1, tw + 2, 20, '#000000');
    l.rect(tx0, ty0, tw, 18, TYPING.miss);
    chromeText(l, fonts, text, tx0 + 6, ty0 + 15, '#ffffff', null, { n: 2 });
  }
  return [bx, by, bw, bh];
}
