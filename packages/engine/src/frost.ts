// Frost on a picture: ice grows in from the edges of a w x h rectangle and is drawn on a TextLayer (for example inside the
// picture of a window, so that windows above it stay clear).
//
// All the work is done once in the constructor: every pixel of the picture gets a key (how late the frost reaches it) and a
// colour. The pixels are sorted by key. A frame with growth `p` (0..1) writes the first n pixels, so the cost is the number of
// frost pixels and the frame depends only on `p`.
import type { TextLayer } from './textlayer';
import { hashSin } from './util';

/** Value noise on the integer lattice of `hashSin`, smoothstep blend, range 0..1. It is not util `noise2`. */
export function valueNoise(x: number, y: number): number {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hashSin(i, j), b = hashSin(i + 1, j), c = hashSin(i, j + 1), d = hashSin(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export type Rgb8 = readonly [number, number, number];

/** The ice colours as sRGB bytes: the pale grain, the mid grain, the dark grain and the rare white glint. */
export interface FrostColours { pale: Rgb8; mid: Rgb8; dark: Rgb8; glint: Rgb8 }

export const FROST_ICE: FrostColours = { pale: [232, 246, 255], mid: [205, 232, 252], dark: [176, 214, 244], glint: [255, 255, 255] };

export interface FrostOpts {
  /** The ice colours. Default FROST_ICE. */
  colours?: FrostColours;
  /** The noise (0..1) of the net of ice ridges. Default valueNoise. */
  noise?: (x: number, y: number) => number;
}

export class Frost {
  /** The place in the picture (x, y) and the texel word (as `TextLayer.words`) of sorted pixel k. */
  private readonly px: Uint16Array;
  private readonly py: Uint16Array;
  private readonly word: Uint32Array;
  private readonly w: number;
  private readonly h: number;
  /** The key of sorted pixel k (ascending). */
  private readonly keys: Float32Array;

  /** `w`, `h`: the size of the picture in px. `reach`: how deep the frost goes at full growth, px. */
  constructor(w: number, h: number, reach = 118, { colours = FROST_ICE, noise = valueNoise }: FrostOpts = {}) {
    this.w = w; this.h = h;
    const key = keysOf(w, h, reach, noise);
    const order = Array.from({ length: w * h }, (_, i) => i).filter((i) => key[i]! < 1.02);
    order.sort((a, b) => key[a]! - key[b]!);
    this.px = Uint16Array.from(order, (i) => i % w);
    this.py = Uint16Array.from(order, (i) => (i / w) | 0);
    this.keys = Float32Array.from(order, (i) => key[i]!);
    this.word = new Uint32Array(order.length);
    order.forEach((i, k) => {
      const x = i % w, y = (i / w) | 0;
      const edge = Math.min(x, w - 1 - x, y, h - 1 - y);
      const hh = hashSin(x * 1.7, y * 2.3);
      const c = hh > 0.985 ? colours.glint : hh > 0.6 ? colours.mid : hh > 0.25 ? colours.pale : colours.dark;
      // thick and nearly opaque at the rim, a thinner veil further in
      const a = edge < 7 ? 0.95 : Math.max(0.42, 0.9 - edge / 150 - 0.25 * key[i]!);
      this.word[k] = (c[0] | (c[1] << 8) | (c[2] << 16) | (Math.round(255 * a) << 24)) >>> 0;
    });
  }

  /** The number of pixels that show at growth p. */
  count(p: number): number {
    const lim = Math.max(0, Math.min(1, p)) * 1.02;
    let lo = 0, hi = this.keys.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.keys[mid]! < lim) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /** Draws the frost of growth `p` over the picture whose top left is (x0, y0) on the layer. */
  draw(l: TextLayer, x0: number, y0: number, p: number) {
    const n = this.count(p), d = l.words, px = this.px, py = this.py, word = this.word, LW = l.w, LH = l.h;
    for (let k = 0; k < n; k++) {
      const x = x0 + px[k]!, y = y0 + py[k]!;
      if (x < 0 || y < 0 || x >= LW || y >= LH) continue;
      d[(LH - 1 - y) * LW + x] = word[k]!;
    }
  }
}

/** The key of every pixel: how late the frost reaches it (0 at the rim, 1 at full growth). */
function keysOf(w: number, h: number, reach: number, noise: (x: number, y: number) => number): Float32Array {
  const key = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const edge = Math.min(x, w - 1 - x, y, h - 1 - y);
    // the ice is a net of ridges: along a ridge the frost arrives early and reaches far in, between ridges it is a thin rime
    const r1 = 1 - Math.abs(2 * noise(x * 0.055 + 3, y * 0.055) - 1);
    const r2 = 1 - Math.abs(2 * noise(x * 0.14 + 9, y * 0.14 + 4) - 1);
    const ridge = 0.6 * r1 + 0.4 * r2;
    key[y * w + x] = edge / reach + 0.55 * (1 - ridge) ** 1.6 + 0.02 * hashSin(x, y);
  }
  return key;
}
