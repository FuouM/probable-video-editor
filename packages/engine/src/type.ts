// Typography: font registry (Canvas2D via FontFace + outlines via opentype.js),
// glyph layout, text outlines as Path2D, and point sampling of text for particle effects.
import * as opentype from 'opentype.js';

/**
 * Font keys. Archivo comes in static width instances (w = wdth*10) x weights so we can
 * animate width in discrete steps: 620, 750, 875, 1000, 1125, 1250 and weights 300/500/700/900.
 */
export const ARCHIVO_WIDTHS = [620, 750, 875, 1000, 1125, 1250] as const;
export const ARCHIVO_WEIGHTS = [300, 500, 700, 900] as const;

/** `features`: OpenType features switched on for the face (Canvas2D has no font-feature-settings). */
type FontDef = { family: string; file: string; features?: string };
const DEFS: FontDef[] = [];
for (const w of ARCHIVO_WIDTHS) for (const wt of ARCHIVO_WEIGHTS) DEFS.push({ family: `Archivo-${w}-${wt}`, file: `Archivo-w${w}-${wt}.ttf` });
for (const w of [750, 1000]) for (const wt of [400, 800]) DEFS.push({ family: `ArchivoItalic-${w}-${wt}`, file: `ArchivoItalic-w${w}-${wt}.ttf` });
// Cormorant defaults to old-style figures ("10" reads as "IO" at display sizes): lining figures instead
for (const wt of [400, 600]) {
  DEFS.push({ family: `Cormorant-${wt}`, file: `Cormorant-${wt}.ttf`, features: '"lnum" 1' });
  DEFS.push({ family: `CormorantItalic-${wt}`, file: `CormorantItalic-${wt}.ttf`, features: '"lnum" 1' });
}
for (const [n, f] of [['300', 'Light'], ['400', 'Regular'], ['500', 'Medium'], ['600', 'SemiBold'], ['700', 'Bold']] as const)
  DEFS.push({ family: `Plex-${n}`, file: `src/IBMPlexMono-${f}.ttf` });
DEFS.push({ family: 'PlexItalic-400', file: 'src/IBMPlexMono-Italic.ttf' });

/** Convenience family names. */
export const F = {
  /** Archivo at nearest available width/weight. width in [62..125] (percent), weight 300..900 */
  archivo(width = 100, weight = 700): string {
    const w = nearest(ARCHIVO_WIDTHS as unknown as number[], width * 10);
    const wt = nearest(ARCHIVO_WEIGHTS as unknown as number[], weight);
    return `Archivo-${w}-${wt}`;
  },
  archivoItalic(width = 100, weight = 800): string {
    return `ArchivoItalic-${width < 88 ? 750 : 1000}-${weight < 600 ? 400 : 800}`;
  },
  serif(weight = 400, italic = false): string {
    return `${italic ? 'CormorantItalic' : 'Cormorant'}-${weight < 500 ? 400 : 600}`;
  },
  mono(weight = 400, italic = false): string {
    if (italic) return 'PlexItalic-400';
    return `Plex-${nearest([300, 400, 500, 600, 700], weight)}`;
  },
};

function nearest(list: number[], v: number) {
  let best = list[0]!;
  for (const x of list) if (Math.abs(x - v) < Math.abs(best - v)) best = x;
  return best;
}

/** CSS font string for Canvas2D. */
export const font = (family: string, sizePx: number, weight?: number | string) =>
  weight !== undefined ? `${weight} ${sizePx}px "${family}"` : `${sizePx}px "${family}"`;

const otCache = new Map<string, opentype.Font>();
const bufCache = new Map<string, ArrayBuffer>();

/**
 * Load the engine fonts. `urls` maps a font file (path under fonts/, e.g. `src/IBMPlexMono-Regular.ttf`) to
 * the URL of a project's replacement (video/assets/fonts/); other files load from the engine's fonts/.
 */
export async function loadFonts(urls: Record<string, string> = {}): Promise<void> {
  await Promise.all(
    DEFS.map(async (d) => {
      const buf = await (await fetch(urls[d.file] ?? `fonts/${d.file}`)).arrayBuffer();
      bufCache.set(d.family, buf);
      const ff = new FontFace(d.family, buf, d.features ? { featureSettings: d.features } : undefined);
      await ff.load();
      document.fonts.add(ff);
    }),
  );
  await document.fonts.ready;
}

/** opentype.js Font for outline work (lazy-parsed). */
export function ot(family: string): opentype.Font {
  let f = otCache.get(family);
  if (!f) {
    const buf = bufCache.get(family);
    if (!buf) throw new Error(`font not loaded: ${family}`);
    f = opentype.parse(buf);
    otCache.set(family, f);
  }
  return f;
}

export interface Glyph {
  ch: string;
  i: number; // char index in string
  x: number; // left edge (px), relative to the text origin
  w: number; // advance width (px)
}
export interface TextLayout {
  text: string;
  family: string;
  size: number;
  width: number; // total advance width
  ascent: number;
  descent: number;
  glyphs: Glyph[];
}

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

const layoutCache = new Map<string, TextLayout>();

/**
 * Per-glyph horizontal layout with the font's kerning, for drawing glyphs one by one.
 * Glyph i sits at the width of text[0..i] minus its own advance, so the kerning between it and the
 * previous glyph moves *it* (the width of text[0..i) alone leaves that pair out: every kern would land
 * one glyph late, e.g. the Y–o kern of "Your" pushing the u into the o). `w` is the glyph's own advance.
 * `tracking` is extra letter spacing in px.
 */
export function layout(text: string, family: string, size: number, tracking = 0): TextLayout {
  const key = `${text}|${family}|${size}|${tracking}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const c = mctx();
  c.font = font(family, size);
  const glyphs: Glyph[] = [];
  const chars = Array.from(text);
  let prefix = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    prefix += ch;
    const w = c.measureText(ch).width;
    glyphs.push({ ch, i, x: c.measureText(prefix).width - w + i * tracking, w });
  }
  const m = c.measureText(text || 'M');
  const res: TextLayout = {
    text, family, size,
    width: (text ? m.width : 0) + Math.max(0, chars.length - 1) * tracking,
    ascent: m.fontBoundingBoxAscent ?? size * 0.8,
    descent: m.fontBoundingBoxDescent ?? size * 0.2,
    glyphs,
  };
  if (layoutCache.size > 2000) layoutCache.clear();
  layoutCache.set(key, res);
  return res;
}

/**
 * x (px) of glyph `index` in `text` set as one kerned run — where to start drawing text[index..] when a
 * word is split into separately drawn pieces (sung/unsung colours, a clipped wipe). Measuring
 * text[0..index) instead would drop the kern between the two pieces. Past the end: the run's width.
 */
export function glyphX(text: string, index: number, family: string, size: number, tracking = 0): number {
  const chars = Array.from(text);
  if (index <= 0) return 0;
  if (index >= chars.length) return measure(text, family, size, tracking);
  const key = `${text}|${family}|${size}|${tracking}`;
  const hit = layoutCache.get(key);
  if (hit && index < hit.glyphs.length) return hit.glyphs[index]!.x;
  const c = mctx();
  c.font = font(family, size);
  return c.measureText(chars.slice(0, index + 1).join('')).width - c.measureText(chars[index]!).width + index * tracking;
}

/**
 * Typographic punctuation for display text: curly apostrophes and quotes, the ellipsis character.
 * Leading elisions (’cause, ’til, ’em, ’90s) get an apostrophe, not an opening quote.
 */
export function smart(s: string): string {
  return s
    .replace(/\.\.\./g, '…')
    .replace(/(^|[\s([{—–-])'(?=(?:cause|cos|til|em|round|n|tis|twas|\d0s)\b)/gi, '$1’')
    .replace(/(^|[\s([{—–-])'/g, '$1‘')
    .replace(/'/g, '’')
    .replace(/(^|[\s([{—–-])"/g, '$1“')
    .replace(/"/g, '”');
}

/** Typewriter quotes back (mono UI text that shows a lyric as typed input or code). */
export const plain = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');

export function measure(text: string, family: string, size: number, tracking = 0) {
  const c = mctx();
  c.font = font(family, size);
  return c.measureText(text).width + Math.max(0, Array.from(text).length - 1) * tracking;
}

/** Largest font size (<= max) at which text fits in maxWidth. */
export function fitSize(text: string, family: string, maxWidth: number, max = 400, tracking = 0) {
  const w = measure(text, family, 100, tracking * 100 / max);
  return Math.min(max, (100 * maxWidth) / Math.max(1, w));
}

/**
 * Outline of text as opentype commands at (x, baselineY). Glyphs are placed one by one at the
 * Canvas2D-measured positions (so outlines line up with fillText) — this also sidesteps
 * opentype.js's unsupported GSUB lookups (e.g. Archivo's ccmp) that crash font.getPath().
 */
export function textPathCommands(text: string, family: string, size: number, x = 0, y = 0, tracking = 0) {
  const f = ot(family);
  const lay = layout(text, family, size, tracking);
  const cmds: opentype.PathCommand[] = [];
  for (const g of lay.glyphs) cmds.push(...f.charToGlyph(g.ch).getPath(x + g.x, y, size).commands);
  return cmds;
}

/** Outline of text as a Path2D at (x, baselineY). */
export function textPath2D(text: string, family: string, size: number, x = 0, y = 0, tracking = 0): Path2D {
  const p = new opentype.Path();
  p.commands = textPathCommands(text, family, size, x, y, tracking);
  return new Path2D(p.toPathData(3));
}

/**
 * Sample points inside the filled text (rasterized at `size`) on a jittered grid with spacing `step`.
 * Returns points relative to the text origin (left, baseline). Great for "text made of atoms".
 */
export function textPoints(text: string, family: string, size: number, step = 6, seed = 1): { x: number; y: number }[] {
  const lay = layout(text, family, size);
  const pad = Math.ceil(size * 0.3);
  const W = Math.ceil(lay.width + pad * 2), H = Math.ceil(size * 1.6);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.font = font(family, size);
  c.fillStyle = '#fff';
  c.textBaseline = 'alphabetic';
  const base = Math.round(size * 1.15);
  c.fillText(text, pad, base);
  const data = c.getImageData(0, 0, W, H).data;
  const out: { x: number; y: number }[] = [];
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const jx = x + (rnd() - 0.5) * step * 0.8, jy = y + (rnd() - 0.5) * step * 0.8;
      const ix = Math.max(0, Math.min(W - 1, Math.round(jx))), iy = Math.max(0, Math.min(H - 1, Math.round(jy)));
      if (data[(iy * W + ix) * 4 + 3]! > 128) out.push({ x: jx - pad, y: jy - base });
    }
  }
  return out;
}

// ---------- vertical setting (tategaki) ----------
// Canvas2D has no vertical text: glyphs are set one by one down a column. Punctuation takes its vertical
// presentation form, the long vowel mark and dashes turn 90°, small kana sit high and right, Latin runs turn 90°.
const VFORM: Record<string, string> = {
  '、': '︑', '。': '︒', '「': '﹁', '」': '﹂', '『': '﹃', '』': '﹄',
  '…': '︙', '（': '︵', '）': '︶', '：': '︓', '！': '！', '？': '？', '?': '？', '!': '！',
};
const ROT: Record<string, true> = { 'ー': true, '〜': true, '～': true, '—': true, '―': true, '-': true, '–': true };
const SMALL: Record<string, true> = Object.fromEntries([...'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ'].map((k) => [k, true]));
const LATIN = /[A-Za-z0-9.,'&]/;

export interface VCell {
  /** What to draw. */
  ch: string;
  /** Turn 90° clockwise (a long mark or a Latin run). */
  rot: boolean;
  small: boolean;
  /** Advance down the column, in em. */
  adv: number;
}

/**
 * The cells of `text` set vertically. Straight double quotes alternate between 〝 and 〟.
 * `measure` gives the width in em of a Latin run (it turns 90°, so its width is its advance).
 */
export function vcells(text: string, measure: (s: string) => number): VCell[] {
  const out: VCell[] = [];
  let open = true;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (LATIN.test(ch)) {
      let run = ch;
      while (i + 1 < chars.length && (LATIN.test(chars[i + 1]!) || (chars[i + 1] === ' ' && i + 2 < chars.length && LATIN.test(chars[i + 2]!)))) run += chars[++i];
      out.push({ ch: run, rot: true, small: false, adv: measure(run) + 0.15 });
      continue;
    }
    if (ch === '"') {
      out.push({ ch: open ? '〝' : '〟', rot: false, small: false, adv: 1 });
      open = !open;
      continue;
    }
    if (ch === ' ') continue;
    const small = SMALL[ch] === true;
    out.push({ ch: VFORM[ch] ?? ch, rot: ROT[ch] === true, small, adv: small ? 0.7 : 1 });
  }
  return out;
}

/**
 * Draw `text` as one vertical column centred on x, starting at y (top). Returns the y below the last cell.
 * The current fillStyle is used. `each(i, cellTop, adv)` runs before each cell (to change style or skip: return false).
 */
export function drawV(
  c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, family: string, weight: number | string = 400,
  each?: (i: number, top: number, adv: number) => boolean | void,
): number {
  c.font = font(family, size, weight);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const cells = vcells(text, (s) => c.measureText(s).width / size);
  let top = y;
  cells.forEach((cell, i) => {
    const adv = cell.adv * size;
    if (each && each(i, top, adv) === false) { top += adv; return; }
    const cy = top + adv / 2;
    if (cell.rot) {
      c.save();
      c.translate(x, cy);
      c.rotate(Math.PI / 2);
      c.fillText(cell.ch, 0, 0);
      c.restore();
    } else if (cell.small) {
      c.fillText(cell.ch, x + size * 0.12, cy - size * 0.1);
    } else {
      c.fillText(cell.ch, x, cy);
    }
    top += adv;
  });
  return top;
}

// ---------------------------------------------------------------- pixel fonts

/** A pixel sink: x right, y down. */
export interface Pixels { put(x: number, y: number, i: number): void }

export interface PixelGlyph { adv: number; x0: number; y0: number; w: number; h: number; bits: Uint8Array }

/**
 * Pixel fonts: a face is drawn once per glyph with Canvas2D at its design pixel size and cut at half
 * coverage into a 1-bit mask. Sub-pixel offsets (0 or 0.5 px) are probed to find the alignment with
 * the fewest grey anti-aliasing pixels.
 */
export class PixelFont {
  private glyphs = new Map<string, PixelGlyph>();
  private cv = document.createElement('canvas');
  private c: CanvasRenderingContext2D;
  private ox = 0;
  private oy = 0;

  /** `size`: the design pixel size (px per em) of the face. */
  constructor(readonly family: string, readonly size: number) {
    this.cv.width = this.cv.height = size * 4;
    this.c = this.cv.getContext('2d', { willReadFrequently: true })!;
  }

  /** Fit probe alignment for an already loaded font family. */
  static from(family: string, size: number, probe = 'ABGaby012'): PixelFont {
    const f = new PixelFont(family, size);
    let best = { grey: Infinity, ox: 0, oy: 0 };
    for (const ox of [0, 0.5]) {
      for (const oy of [0, 0.5]) {
        f.ox = ox;
        f.oy = oy;
        let grey = 0;
        for (const ch of probe) grey += f.raster(ch).grey;
        if (grey < best.grey) best = { grey, ox, oy };
      }
    }
    f.ox = best.ox;
    f.oy = best.oy;
    return f;
  }

  /** `probe`: characters of the face that the grid alignment measures (only glyphs the face has). */
  static async load(family: string, url: string, size: number, probe: string): Promise<PixelFont> {
    const face = new FontFace(family, `url(${url})`);
    document.fonts.add(await face.load());
    return PixelFont.from(family, size, probe);
  }

  /** Draws ch with the pen at (size, 3 size) and returns its mask and the count of grey pixels. */
  private raster(ch: string): { g: PixelGlyph; grey: number } {
    const n = this.size * 4;
    const c = this.c;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, n, n);
    c.font = `${this.size}px "${this.family}"`;
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#fff';
    c.fillText(ch, this.size + this.ox, this.size * 3 + this.oy);
    const a = c.getImageData(0, 0, n, n).data;
    let grey = 0, x0 = n, y0 = n, x1 = -1, y1 = -1;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = a[(y * n + x) * 4 + 3]!;
        if (v > 24 && v < 232) grey++;
        if (v >= 128) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
    }
    const w = Math.max(0, x1 - x0 + 1), h = Math.max(0, y1 - y0 + 1);
    const bits = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        bits[y * w + x] = a[((y0 + y) * n + x0 + x) * 4 + 3]! >= 128 ? 1 : 0;
      }
    }
    const adv = Math.round(c.measureText(ch).width);
    return { g: { adv, x0: w ? x0 - this.size : 0, y0: h ? y0 - this.size * 3 : 0, w, h, bits }, grey };
  }

  glyph(ch: string): PixelGlyph {
    let g = this.glyphs.get(ch);
    if (!g) {
      g = this.raster(ch).g;
      this.glyphs.set(ch, g);
    }
    return g;
  }

  width(text: string, tracking = 0): number {
    let w = 0;
    for (const ch of text) w += this.glyph(ch).adv + tracking;
    return text.length ? w - tracking : 0;
  }

  /** Draws text with the pen at x and the baseline at y. Returns the pen x after the text. */
  draw(out: Pixels, text: string, x: number, y: number, i: number, tracking = 0): number {
    for (const ch of text) {
      const g = this.glyph(ch);
      for (let yy = 0; yy < g.h; yy++) {
        for (let xx = 0; xx < g.w; xx++) {
          if (g.bits[yy * g.w + xx]) out.put(x + g.x0 + xx, y + g.y0 + yy, i);
        }
      }
      x += g.adv + tracking;
    }
    return x;
  }
}

/**
 * Draws text with a one-pixel outline in index `edge` (the 8 neighbours of every ink pixel that are not ink).
 * Returns the pen x after the text.
 */
export function outlined(out: Pixels, f: PixelFont, text: string, x: number, y: number, ink: number, edge: number, tracking = 0): number {
  const ink2 = new Set<number>();
  const key = (px: number, py: number) => (py + 4096) * 16384 + px + 4096;
  const end = f.draw({ put: (px, py) => ink2.add(key(px, py)) }, text, x, y, 1, tracking);
  for (const k of ink2) {
    const px = (k % 16384) - 4096, py = Math.floor(k / 16384) - 4096;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!ink2.has(key(px + dx, py + dy))) out.put(px + dx, py + dy, edge);
      }
    }
  }
  for (const k of ink2) out.put((k % 16384) - 4096, Math.floor(k / 16384) - 4096, ink);
  return end;
}

/**
 * A 1-bit pixel shape with its origin at the pen position on the baseline: text scaled up by a whole number for
 * big type, and grown by whole pixels for thick outlines. x right, y down.
 */
export class Mask {
  constructor(readonly x0: number, readonly y0: number, readonly w: number, readonly h: number, readonly bits: Uint8Array, readonly adv: number) {}

  /** `text` in face f, each pixel an n x n block. `adv`: the pen advance (scaled). */
  static text(f: PixelFont, text: string, n = 1, tracking = 0): Mask {
    const pts: number[] = [];
    const adv = f.draw({ put: (x, y) => pts.push(x, y) }, text, 0, 0, 1, tracking) * n;
    if (!pts.length) return new Mask(0, 0, 0, 0, new Uint8Array(0), adv);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < pts.length; k += 2) {
      x0 = Math.min(x0, pts[k]!); x1 = Math.max(x1, pts[k]!);
      y0 = Math.min(y0, pts[k + 1]!); y1 = Math.max(y1, pts[k + 1]!);
    }
    const w = (x1 - x0 + 1) * n, h = (y1 - y0 + 1) * n;
    const bits = new Uint8Array(w * h);
    for (let k = 0; k < pts.length; k += 2) {
      const bx = (pts[k]! - x0) * n, by = (pts[k + 1]! - y0) * n;
      for (let yy = 0; yy < n; yy++) bits.fill(1, (by + yy) * w + bx, (by + yy) * w + bx + n);
    }
    return new Mask(x0 * n, y0 * n, w, h, bits, adv);
  }

  has(x: number, y: number): boolean {
    const u = x - this.x0, v = y - this.y0;
    return u >= 0 && v >= 0 && u < this.w && v < this.h && this.bits[v * this.w + u] === 1;
  }

  /** The shape grown by r pixels in all eight directions (a square brush). */
  grow(r: number): Mask {
    if (r <= 0 || !this.w) return this;
    const w = this.w + 2 * r, h = this.h + 2 * r;
    const row = new Uint8Array(w * this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.bits[y * this.w + x]) row.fill(1, y * w + x, y * w + x + 2 * r + 1);
      }
    }
    const bits = new Uint8Array(w * h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < w; x++) {
        if (row[y * w + x]) for (let d = 0; d <= 2 * r; d++) bits[(y + d) * w + x] = 1;
      }
    }
    return new Mask(this.x0 - r, this.y0 - r, w, h, bits, this.adv);
  }

  /** Puts index i on every pixel of the shape, with the origin at x, y. `keep` can clip pixels (screen coords). */
  draw(out: Pixels, x: number, y: number, i: number, keep?: (px: number, py: number) => boolean) {
    for (let v = 0; v < this.h; v++) {
      for (let u = 0; u < this.w; u++) {
        if (!this.bits[v * this.w + u]) continue;
        const px = x + this.x0 + u, py = y + this.y0 + v;
        if (!keep || keep(px, py)) out.put(px, py, i);
      }
    }
  }
}

/** Big type: `text` scaled n times, an inner outline of r1 px in `edge` and an outer one of r2 px in `outer`. */
export function bigText(f: PixelFont, text: string, n: number, r1: number, r2 = 0): { ink: Mask; edge: Mask; outer: Mask | null } {
  const ink = Mask.text(f, text, n);
  const edge = ink.grow(r1);
  return { ink, edge, outer: r2 > 0 ? edge.grow(r2) : null };
}
