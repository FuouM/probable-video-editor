// An RGBA pixel layer as a DataTexture: text and interface over a lit view, or text painted on a 3D object.
import * as THREE from 'three';
import { LH, LW, rgb8, type Col } from './lit';
import type { Pixels } from './type';

/**
 * A w x h RGBA layer (default: the 640x360 logical frame). x right, y down. Colours are sRGB bytes. `colorSpace` is the
 * colour space of the texture: NoColorSpace for the interface layer of a LitView, SRGBColorSpace for a surface on a 3D object.
 */
export class TextLayer {
  readonly data: Uint8Array;
  /** The same texels as one word each: r, g << 8, b << 16, a << 24 (the byte order of every machine that runs WebGL). */
  readonly words: Uint32Array;
  readonly tex: THREE.DataTexture;
  constructor(readonly w = LW, readonly h = LH, colorSpace: THREE.ColorSpace = THREE.NoColorSpace) {
    this.data = new Uint8Array(w * h * 4);
    this.words = new Uint32Array(this.data.buffer);
    this.tex = new THREE.DataTexture(this.data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.colorSpace = colorSpace;
  }
  clear() { this.data.fill(0); }
  put(x: number, y: number, c: Col, a = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.words[(this.h - 1 - y) * this.w + x] = word(c, a);
  }
  rect(x: number, y: number, w: number, h: number, c: Col, a = 1) {
    const v = word(c, a), d = this.words;
    const x0 = Math.max(0, Math.round(x)), x1 = Math.min(this.w, Math.round(x + w));
    const y0 = Math.max(0, Math.round(y)), y1 = Math.min(this.h, Math.round(y + h));
    const n = x1 - x0;
    if (n <= 0) return;
    for (let j = y0; j < y1; j++) {
      const o = (this.h - 1 - j) * this.w + x0;
      // a short row is faster as a loop than as a call
      if (n < 12) for (let i = 0; i < n; i++) d[o + i] = v;
      else d.fill(v, o, o + n);
    }
  }
  /** Darkens what is under the rectangle: clear texels become black at strength `a`, drawn texels get darker. */
  shade(x: number, y: number, w: number, h: number, a: number) {
    const x0 = Math.max(0, Math.round(x)), x1 = Math.min(this.w, Math.round(x + w));
    const y0 = Math.max(0, Math.round(y)), y1 = Math.min(this.h, Math.round(y + h));
    if (x1 <= x0 || y1 <= y0) return;
    // the darker value of each byte value (the store in a byte array drops the fraction)
    const lut = SHADE_LUT, d = this.words, black = ((Math.round(a * 255) & 255) << 24) >>> 0;
    for (let v = 0; v < 256; v++) lut[v] = v * (1 - a);
    for (let j = y0; j < y1; j++) {
      const o0 = (this.h - 1 - j) * this.w + x0, o1 = o0 + x1 - x0;
      for (let o = o0; o < o1; o++) {
        const v = d[o]!;
        d[o] = v >>> 24 === 0 ? black : ((v & 0xff000000) | (lut[(v >>> 16) & 255]! << 16) | (lut[(v >>> 8) & 255]! << 8) | lut[v & 255]!) >>> 0;
      }
    }
  }
  /** A pixel sink for PixelFont: `key` maps font indices to colours. */
  sink(key: Record<number, Col>): Pixels {
    const packed = new Map<number, number>();
    for (const k of Object.keys(key)) packed.set(Number(k), word(key[Number(k)]!, 1));
    const d = this.words, W = this.w, H = this.h;
    return {
      put: (x, y, i) => {
        const c = packed.get(i);
        if (c === undefined || x < 0 || y < 0 || x >= W || y >= H) return;
        d[(H - 1 - Math.round(y)) * W + Math.round(x)] = c;
      },
    };
  }
  commit() { this.tex.needsUpdate = true; }
  dispose() { this.tex.dispose(); }
}

const SHADE_LUT = new Uint8Array(256);
const WORDS = new Map<string, number>();
/** The texel word of a colour at alpha `a` (0..1). */
function word(c: Col, a: number): number {
  let v: number;
  if (typeof c === 'number') v = ((c >> 16) & 255) | (c & 0xff00) | ((c & 255) << 16);
  else {
    const hit = WORDS.get(c);
    if (hit === undefined) {
      const [r, g, b] = rgb8(c);
      v = r | (g << 8) | (b << 16);
      WORDS.set(c, v);
    } else v = hit;
  }
  return (v | ((Math.round(a * 255) & 255) << 24)) >>> 0;
}
