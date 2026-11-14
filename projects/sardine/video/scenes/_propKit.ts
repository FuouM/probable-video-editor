// Small helpers that the prop kits share (`_scissors.ts`, `_ticket.ts`, `_duckboard.ts`).
import type { PixelFont } from '@pve/engine/type';
import type { Painter } from '@pve/engine/lit';

/** A deterministic hash of up to four integers, 0..1. */
export function hash(a: number, b: number, c = 0, d = 0): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177) + Math.imul(d | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Mixes two 0xRRGGBB colours, t = 0 gives a. */
export function mixc(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** A painter with y down from the top of the cell (the way pixel fonts and layouts think). */
export class Top {
  constructor(readonly p: Painter, readonly w: number, readonly h: number) {}
  px(x: number, y: number, c: number) { this.p.px(x, this.h - 1 - y, c); }
  clear(x: number, y: number) { this.p.clear(x, this.h - 1 - y); }
  rect(x: number, y: number, w: number, h: number, c: number) { this.p.rect(x, this.h - y - h, w, h, c); }
  fill(c: number) { this.p.fill(c); }
  /** Text with its pen at x and baseline at y; each font pixel is an n x n block. */
  text(f: PixelFont, s: string, x: number, base: number, c: number, n = 1) {
    f.draw({ put: (px, py) => { for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) this.px(x + px * n + i, base + py * n + j, c); } }, s, 0, 0, 1);
  }
}
