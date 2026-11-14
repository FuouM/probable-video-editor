// A text mode: the screen as a fine grid of character cells in one blue. Each cell shows the brightness of the picture under it as one
// character of a ramp, in a shade of the blue, on a blue-black ground. The picture keeps running under the grid. A blob can explode
// into characters (`burst`).
//
// `TextMode.read` takes the HDR picture of a `LitView` down to one texel per cell on the GPU and reads those texels back (160 x 60).
// `TextMode.draw` writes the cells into the 640x360 text layer, through a `Collapse`: bigger cells and rows that slide and fall.
// A frame depends only on its inputs.
import * as THREE from 'three';
import { FSPass } from './gl';
import { LH, LW } from './lit';
import type { TextLayer } from './textlayer';
import { hashSin } from './util';

/** The size of a character cell (px) and the grid. */
export const CELL_W = 4, CELL_H = 6;
export const COLS = LW / CELL_W, ROWS = LH / CELL_H;
/** Dark to light. */
const RAMP = ' .:-=+*#%@';
/** The characters of a burst. */
const GARBLE = '01AEFX7/\\|?#%@*+';
/** The glyphs: 3x5 px, rows from the top. */
const GLYPHS: Record<string, string> = {
  '.': '000000000000010', ':': '000010000010000', '-': '000000111000000', '=': '000111000111000', '+': '000010111010000',
  '*': '101010111010101', '#': '101111101111101', '%': '101001010100101', '@': '111101111100111', '0': '111101101101111',
  '1': '010110010010111', 'A': '010101111101101', 'E': '111100110100111', 'F': '111100110100100', 'X': '101101010101101',
  '7': '111001010010010', '/': '001001010100100', '\\': '100100010001001', '|': '010010010010010', '?': '111001010000010',
};
/** The pixels of each glyph, as (x, y) offsets in its cell. */
const MASKS = new Map<string, readonly (readonly [number, number])[]>(
  Object.entries(GLYPHS).map(([ch, bits]) => [ch, [...bits].flatMap((b, i) => (b === '1' ? [[i % 3, Math.floor(i / 3)] as const] : []))]),
);
/** The one blue, from the darkest shade (index 0) to the lightest, and the ground. */
const SHADES: readonly [number, number, number][] = Array.from({ length: RAMP.length }, (_, i) => {
  const k = i / (RAMP.length - 1);
  return [Math.round(20 + 190 * k * k), Math.round(50 + 180 * k), Math.round(140 + 115 * Math.sqrt(k))];
});
const GROUND = 0xff1a0602; // ABGR: rgb(2, 6, 26)

/**
 * How the grid breaks: `scale` cells of the grid make one character (the resolution drops), and each row of characters is moved
 * `slide(row)` px to the side and `drop(row)` px down (Infinity: the row has fallen out of the frame).
 */
export interface Collapse { scale: number; slide(row: number): number; drop(row: number): number }
/** The grid as it is. */
export const WHOLE: Collapse = { scale: 1, slide: () => 0, drop: () => 0 };

export class TextMode {
  private rt = new THREE.WebGLRenderTarget(COLS, ROWS, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false,
  });
  /** One texel per cell: the mean of 4 taps of the cell, through a soft shoulder, as a brightness 0..1. */
  private pass = new FSPass(/* glsl */ `
    uniform sampler2D uSrc; uniform vec2 uCell;
    void main() {
      vec3 c = vec3(0.0);
      for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) c += texture(uSrc, vUv + (vec2(i, j) - 0.5) * 0.5 * uCell).rgb;
      float l = dot(c * 0.25, vec3(0.3, 0.59, 0.11));
      l = pow(1.0 - exp(-3.5 * max(l, 0.0)), 1.0 / 2.2);
      fragColor = vec4(vec3(l), 1.0);
    }`, { uSrc: { value: null }, uCell: { value: new THREE.Vector2(1 / COLS, 1 / ROWS) } });
  private px = new Uint8Array(COLS * ROWS * 4);

  /** `frame`: the length of one video frame (s). A burst holds its blocks for 2 frames before they fly. */
  constructor(private readonly frame: number) {}

  /** Takes the picture `src` (the HDR target of the full view) down to the grid and reads it back. */
  read(renderer: THREE.WebGLRenderer, src: THREE.Texture) {
    this.pass.u.uSrc!.value = src;
    this.pass.render(renderer, this.rt);
    renderer.readRenderTargetPixels(this.rt, 0, 0, COLS, ROWS, this.px);
  }

  /** Writes the grid into `l` over the whole frame: the ground and one character per cell, broken by `o`. */
  draw(l: TextLayer, o: Collapse) {
    const d = l.data, s = o.scale;
    new Uint32Array(d.buffer, d.byteOffset, LW * LH).fill(GROUND);
    for (let r = 0; r * s < ROWS; r++) {
      const dy = o.drop(r);
      if (!Number.isFinite(dy)) continue;
      const dx = o.slide(r);
      for (let c = 0; c * s < COLS; c++) {
        // the mean of the cells under the character (the texels come bottom row first)
        let sum = 0, n = 0;
        for (let j = r * s; j < Math.min(ROWS, (r + 1) * s); j++) for (let i = c * s; i < Math.min(COLS, (c + 1) * s); i++) {
          sum += this.px[((ROWS - 1 - j) * COLS + i) * 4]!;
          n++;
        }
        const k = Math.min(RAMP.length - 1, Math.floor((sum / n / 255) * RAMP.length));
        if (k === 0) continue;
        this.put(d, RAMP[k]!, c * CELL_W * s + dx, r * CELL_H * s + dy, SHADES[Math.max(2, k)]!, s);
      }
    }
  }

  /**
   * A blob that explodes into characters: the cells of a disc (centre x, y, radius r px) fly out from it and fall, `tau` s after the
   * blast. Draw it after `draw`.
   */
  burst(l: TextLayer, x: number, y: number, r: number, tau: number, seed: number) {
    if (tau < 0 || tau > 0.6) return;
    const d = l.data, n = Math.round((r * r) / 2.5), white: [number, number, number] = [236, 246, 255];
    for (let i = 0; i < n; i++) {
      // a cell of the disc: a place in it, snapped to the grid, and its speed out from the middle
      const a = 2 * Math.PI * hashSin(seed, i), q = Math.sqrt(hashSin(seed, i + 500)) * r;
      const v = 120 + 260 * hashSin(seed, i + 900), dx = Math.cos(a), dy = Math.sin(a) * 0.8 - 0.3;
      // for 2 frames the disc stands as solid blocks, then the blocks fly
      const go = Math.max(0, tau - 2 * this.frame);
      const cx = x + dx * (q + v * go), cy = y + dy * (q + v * go) + 0.5 * 900 * go * go;
      const ch = go === 0 ? (hashSin(seed, i + 1300) < 0.5 ? '#' : '@') : GARBLE[Math.floor(hashSin(seed, i + 1300) * GARBLE.length)]!;
      const c = tau < 0.25 ? white : SHADES[Math.max(4, Math.round((RAMP.length - 1) * (1 - (tau - 0.25) / 0.35)))]!;
      this.put(d, ch, Math.round(cx / CELL_W) * CELL_W, Math.round(cy / CELL_H) * CELL_H, c);
    }
  }

  /** One glyph at the top left of a cell (px), in the colour c, each of its pixels s x s px. */
  private put(d: Uint8Array, ch: string, x0: number, y0: number, c: readonly [number, number, number], s = 1) {
    const m = MASKS.get(ch);
    if (!m) return;
    for (const [px, py] of m) for (let v = 0; v < s; v++) for (let u = 0; u < s; u++) {
      const x = x0 + px * s + u, y = y0 + py * s + v;
      if (x < 0 || y < 0 || x >= LW || y >= LH) continue;
      const o = ((LH - 1 - y) * LW + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }

  dispose() {
    this.rt.dispose();
    this.pass.dispose();
  }
}
