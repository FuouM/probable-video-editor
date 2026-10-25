// Squeezed letters on the walls of room (director note 31f2 at 46.32 s: "this part is very empty"). "walls
// surrounding me" stays bare. On "without a doubt" the four kicks have left a small window in the centre: each
// syllable squeezes letters of the wall out of the window; they shoot out to the edges of the box, tumbling,
// and pile up there like sand, a new layer on each pulse. Each later beat squeezes a few more out. Letters in
// the air and just landed are paper; the piles are halftone. They draw on the black walls only (inside the
// 2.39:1 box, outside the window) until the crumple starts.
// The pulses are the syllables of "without a doubt" (room passes them as `pulses`), then each beat after.
// Motion holds at 12 fps from each pulse. Random choices come from hashI: pure functions of time.
import { H, W } from '@pve/engine/gl';
import { clamp, ease, lerp } from '@pve/engine/util';
import { BAR, BEAT, BEAT0, GlyphAtlas, PAPER, gray, hashI } from './_kit';

/** What room gives each frame. Insets are [top, bottom, left, right] in px. */
export interface SqueezeCtx {
  /** song times of the four first pulses: letters burst at the top, bottom, left and right wall */
  pulses: readonly number[];
  /** the crumple starts: the letters are gone */
  end: number;
  /** the window the walls leave now, and after the last kick */
  win: readonly [number, number, number, number];
  fin: readonly [number, number, number, number];
  /** the kick of the frame, px */
  shake: readonly [number, number];
  /** the chorus the typewriter types */
  text: string;
}

/** s before the end: the letters dissolve in three steps */
const FADE = 0.17;
/** letters a pile may stack, per wall */
const PILE = [4, 4, 8, 8];
const SLOT = 24, LEAD = 34, SIDE_ROW = 36;
const fresh3 = new GlyphAtlas(3, PAPER);
const piled3 = new GlyphAtlas(3, gray(0.55));
interface Flyer { at: number; dur: number; x0: number; y0: number; x1: number; y1: number; rest: number; spin: number; arc: number; side: number; ch: string }

/** Draw the squeezed letters on the walls. Room calls it after the walls and before the crumple. */
export function squeezedLetters(c: CanvasRenderingContext2D, t: number, x: SqueezeCtx) {
  if (t >= x.end || t < x.pulses[0]!) return;
  const [top, bot, left, right] = x.win;
  c.save();
  c.beginPath();
  c.rect(0, BAR, W, H - 2 * BAR);
  c.rect(left, top, W - left - right, H - top - bot);
  c.clip('evenodd');
  c.globalAlpha = Math.ceil(clamp((x.end - t) / FADE) * 3) / 3;
  c.translate(x.shake[0], x.shake[1]);
  for (const f of flyers(x)) {
    if (f.at > t) continue;
    const a = Math.floor((t - f.at) * 12 + 1e-6) / 12; // held at 12 fps from its pulse
    const s = ease.outCubic(clamp(a / f.dur));
    const bow = Math.sin(Math.PI * s) * f.arc;
    const px = lerp(f.x0, f.x1, s) + (f.side < 2 ? bow : 0);
    const py = lerp(f.y0, f.y1, s) + (f.side < 2 ? 0 : bow);
    const atlas = a < f.dur + BEAT ? fresh3 : piled3;
    const g = atlas.get(f.ch);
    c.save();
    c.translate(px, py);
    c.rotate(f.rest + f.spin * (1 - s));
    atlas.draw(c, f.ch, -g.w / 2, -15);
    c.restore();
  }
  c.restore();
}

/** The letters, built once per room: each first pulse bursts out of one wall, each later beat a few out of the window. */
let cache: { key: SqueezeCtx['pulses']; end: number; out: Flyer[] } | null = null;
function flyers(x: SqueezeCtx): Flyer[] {
  if (cache && cache.key === x.pulses && cache.end === x.end) return cache.out;
  const p = [...x.pulses];
  for (let n = Math.round((p[p.length - 1]! - BEAT0) / BEAT) + 1; BEAT0 + n * BEAT < x.end - 0.05; n++) p.push(BEAT0 + n * BEAT);
  const [ft, fb, fl, fr] = x.fin;
  const sideRows = Math.floor((H - ft - fb) / SIDE_ROW);
  const slots = [W / SLOT, W / SLOT, sideRows, sideRows];
  const raw: { at: number; dur: number; side: number; slot: number; pi: number; j: number }[] = [];
  for (let pi = 0; pi < p.length; pi++) {
    const burst = pi < Math.min(4, x.pulses.length);
    const n = burst ? (pi < 2 ? 84 : 48) : 20;
    for (let j = 0; j < n; j++) {
      const h = (s: number) => hashI(pi, j, s);
      const side = burst ? pi : Math.floor(h(1) * 4);
      // heaps: three on the top and bottom walls, two on each side wall
      const heap = Math.floor(h(2) * (side < 2 ? 3 : 2));
      const centre = side < 2 ? 9 + heap * 26 + Math.floor(hashI(side, heap, 3) * 10) : 2 + heap * 6 + Math.floor(hashI(side, heap, 3) * 3);
      const half = side < 2 ? 10 : 3;
      const slot = clamp(centre + Math.round((h(4) + h(5) - 1) * half), 0, slots[side]! - 1);
      raw.push({ at: p[pi]! + 0.06 * h(6), dur: 0.16 + 0.22 * h(7), side, slot, pi, j });
    }
  }
  // stacking in landing order; a letter slides off to a neighbour two lower, like sand; a full pile crushes it
  raw.sort((a, b) => a.at + a.dur - (b.at + b.dur));
  const tall = slots.map((n) => new Uint8Array(n));
  const out: Flyer[] = [];
  for (const r of raw) {
    const hs = tall[r.side]!;
    let s = r.slot;
    for (let n = 0; n < 6; n++) {
      const lo = s > 0 ? hs[s - 1]! : 99, hi = s + 1 < hs.length ? hs[s + 1]! : 99;
      if (Math.min(lo, hi) + 2 > hs[s]!) break;
      s = lo <= hi ? s - 1 : s + 1;
    }
    if (hs[s]! >= PILE[r.side]!) continue;
    const h = hs[s]!++;
    const g = (k: number) => hashI(r.pi, r.j, k);
    let x1: number, y1: number, x0: number, y0: number;
    if (r.side < 2) {
      x1 = s * SLOT + SLOT / 2;
      y1 = r.side === 0 ? BAR + 19 + h * LEAD : H - BAR - 19 - h * LEAD;
      x0 = (r.pi < 2 ? x1 : clamp(x1, fl + 24, W - fr - 24)) + (g(8) - 0.5) * 90;
      y0 = r.side === 0 ? ft - 18 : H - fb + 18;
    } else {
      x1 = r.side === 2 ? 16 + h * 26 : W - 16 - h * 26;
      y1 = ft + SIDE_ROW / 2 + s * SIDE_ROW;
      x0 = r.side === 2 ? fl - 14 : W - fr + 14;
      y0 = y1 + (g(8) - 0.5) * 70;
    }
    const turn = g(9);
    out.push({
      at: r.at, dur: r.dur, x0, y0, x1, y1, side: r.side,
      rest: (turn < 0.85 ? 0 : Math.PI) + (g(14) - 0.5) * 0.5,
      spin: (g(10) < 0.5 ? -1 : 1) * Math.PI * (1 + 2 * g(11)),
      arc: (g(12) - 0.5) * 60, ch: letterOf(x.text, Math.floor(g(13) * 997)),
    });
  }
  cache = { key: x.pulses, end: x.end, out };
  return out;
}

/** A letter of the chorus for a seed: spaces and marks skip to the next letter. */
function letterOf(text: string, seed: number) {
  for (let n = 0; n < text.length; n++) {
    const ch = text[(seed + n) % text.length]!;
    if ((ch >= 'a' && ch <= 'z') || ch === "'") return ch;
  }
  return 'x';
}
