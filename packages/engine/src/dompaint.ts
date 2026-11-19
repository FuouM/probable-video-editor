// The painter of the DOM interpreter (dom.ts): replays a display list of domread.ts on a Canvas2D context.
// It draws what CSS paints, in the CSS order: outer shadows, background colour, background images, inset
// shadows, borders, outline, then the children. Lengths are CSS px. The context has a scale of `res` canvas px
// per CSS px, so the result is sharp at any size.
import { placeStops, resolve, type BgImage, type Shadow } from './domcss';
import type { BoxNode, ImgItem, Item, Rect, TextItem } from './domread';

export interface PaintEnv {
  /** Canvas px per CSS px. */
  res: number;
  /** The loaded image of a `url()`. */
  image(url: string): HTMLImageElement;
  /** True for an image with a ratio and no size of its own (an SVG with only a viewBox). */
  unsized(img: HTMLImageElement): boolean;
  /** Only the items that reach into this rectangle (px from the surface origin) paint, or all for null. */
  cull?: Rect | null;
}

type C = CanvasRenderingContext2D;
type Radii = [number, number][];

/** Far outside every surface: a shape drawn there shows only its shadow. */
const OFF = 20000;
const CLEAR = /^rgba\(0, 0, 0, 0\)$|^transparent$/;
const meets = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function rrect(c: C, x: number, y: number, w: number, h: number, r: Radii) {
  c.roundRect(x, y, Math.max(0, w), Math.max(0, h), r.map(([rx, ry]) => ({ x: Math.max(0, rx), y: Math.max(0, ry) })));
}

/** The radii of a box that lies `t, r, b, l` px inside (or, negative, outside) the box of radii `rad`. */
function inset(rad: Radii, t: number, r: number, b: number, l: number): Radii {
  const g = (v: number, d: number) => (v > 0 ? v - d : 0);
  return [[g(rad[0]![0], l), g(rad[0]![1], t)], [g(rad[1]![0], r), g(rad[1]![1], t)], [g(rad[2]![0], r), g(rad[2]![1], b)], [g(rad[3]![0], l), g(rad[3]![1], b)]];
}

/**
 * Sets shadow `s` (offsets and blur in the units of the context) for a shape that is drawn `OFF` units to the
 * left of its place. Shadow offsets and blurs are canvas px, so they go through the transform of the context.
 */
function shadowOn(c: C, s: Shadow) {
  const t = c.getTransform();
  c.shadowColor = s.color;
  c.shadowBlur = s.blur * Math.sqrt(Math.abs(t.a * t.d - t.b * t.c));
  c.shadowOffsetX = t.a * (OFF + s.x) + t.c * s.y;
  c.shadowOffsetY = t.b * (OFF + s.x) + t.d * s.y;
  c.fillStyle = '#000';
}

function outerShadow(c: C, n: BoxNode, s: Shadow) {
  const m = s.blur * 2 + s.spread + Math.abs(s.x) + Math.abs(s.y) + 4;
  c.save();
  c.beginPath();
  c.rect(n.x - m, n.y - m, n.w + 2 * m, n.h + 2 * m);
  rrect(c, n.x, n.y, n.w, n.h, n.radii);
  c.clip('evenodd');
  const rad = inset(n.radii, -s.spread, -s.spread, -s.spread, -s.spread);
  c.beginPath();
  if (s.blur === 0) {
    // a hard shadow is the shape itself, moved: no blur pass
    c.fillStyle = s.color;
    rrect(c, n.x + s.x - s.spread, n.y + s.y - s.spread, n.w + 2 * s.spread, n.h + 2 * s.spread, rad);
  } else {
    shadowOn(c, s);
    rrect(c, n.x - OFF - s.spread, n.y - s.spread, n.w + 2 * s.spread, n.h + 2 * s.spread, rad);
  }
  c.fill();
  c.restore();
}

function insetShadow(c: C, n: BoxNode, s: Shadow) {
  const [t, r, b, l] = n.look.bw;
  const x = n.x + l, y = n.y + t, w = n.w - l - r, h = n.h - t - b;
  const rad = inset(n.radii, t, r, b, l);
  c.save();
  c.beginPath();
  rrect(c, x, y, w, h, rad);
  c.clip();
  if (s.blur === 0 && n.radii.every(([rx, ry]) => rx <= 0 && ry <= 0) && s.spread >= 0) {
    // a hard inset shadow of a square box is two bands along two sides: no blur pass
    c.fillStyle = s.color;
    c.beginPath();
    c.rect(x, y, w, h);
    c.rect(x + s.x + s.spread, y + s.y + s.spread, w - 2 * s.spread, h - 2 * s.spread);
    c.fill('evenodd');
    c.restore();
    return;
  }
  const m = s.blur * 2 + Math.abs(s.x) + Math.abs(s.y) + 8;
  shadowOn(c, s);
  c.beginPath();
  c.rect(x - OFF - m, y - m, w + 2 * m, h + 2 * m);
  rrect(c, x - OFF + s.spread, y + s.spread, w - 2 * s.spread, h - 2 * s.spread, inset(rad, s.spread, s.spread, s.spread, s.spread));
  c.fill('evenodd');
  c.restore();
}

/** Draws one tile of a background image at the origin, `tw` x `th` px. */
function drawTile(c: C, g: BgImage, tw: number, th: number, env: PaintEnv) {
  if (g.kind === 'url') {
    c.drawImage(env.image(g.url), 0, 0, tw, th);
    return;
  }
  if (g.repeating) throw new Error('dom: a repeating gradient is not supported');
  if (g.kind === 'linear') {
    let dx: number, dy: number;
    if (g.to) {
      const k = Math.hypot(th, tw) || 1;
      dx = (g.to[0] * th) / k;
      dy = (g.to[1] * tw) / k;
    } else {
      dx = Math.sin(g.angle!);
      dy = -Math.cos(g.angle!);
    }
    const len = Math.abs(tw * dx) + Math.abs(th * dy);
    const stops = placeStops(g.stops, len);
    // stops outside 0..1 make the line longer
    const lo = Math.min(0, stops[0]!.at), hi = Math.max(1, stops[stops.length - 1]!.at);
    const a = lo - 0.5, b = hi - 0.5;
    const grad = c.createLinearGradient(tw / 2 + dx * len * a, th / 2 + dy * len * a, tw / 2 + dx * len * b, th / 2 + dy * len * b);
    for (const s of stops) grad.addColorStop((s.at - lo) / (hi - lo), s.color);
    c.fillStyle = grad;
    c.fillRect(0, 0, tw, th);
    return;
  }
  const cx = resolve(g.at[0], tw), cy = resolve(g.at[1], th);
  const far = g.size.startsWith('farthest'), corner = g.size.endsWith('corner');
  const pick = far ? Math.max : Math.min;
  const sx = pick(cx, tw - cx), sy = pick(cy, th - cy);
  let rx: number, ry: number;
  if (g.circle) rx = ry = corner ? Math.hypot(sx, sy) : pick(sx, sy);
  else { rx = sx * (corner ? Math.SQRT2 : 1); ry = sy * (corner ? Math.SQRT2 : 1); }
  if (rx <= 0 || ry <= 0) return;
  const stops = placeStops(g.stops, rx);
  const hi = Math.max(1, stops[stops.length - 1]!.at);
  const grad = c.createRadialGradient(0, 0, 0, 0, 0, hi);
  for (const s of stops) grad.addColorStop(Math.max(0, s.at) / hi, s.color);
  c.save();
  c.translate(cx, cy);
  c.scale(rx, ry);
  c.fillStyle = grad;
  c.fillRect(-cx / rx, -cy / ry, tw / rx, th / ry);
  c.restore();
}

function position(v: string, free: [number, number]): [number, number] {
  const p = v.split(/\s+/);
  if (p.length === 2) return [resolve(p[0]!, free[0]), resolve(p[1]!, free[1])];
  if (p.length === 4) {
    const one = (edge: string, off: string, f: number) => (edge === 'right' || edge === 'bottom' ? f - resolve(off, f) : resolve(off, f));
    return [one(p[0]!, p[1]!, free[0]), one(p[2]!, p[3]!, free[1])];
  }
  throw new Error(`dom: background-position ${v} is not supported`);
}

/** The edges of a box `t, r, b, l` px in from the border box for `border-box`, `padding-box` and `content-box`. */
function edges(n: BoxNode, box: string): [number, number, number, number] {
  const [t, r, b, l] = n.look.bw, [pt, pr, pb, pl] = n.pad;
  return box === 'border-box' ? [0, 0, 0, 0] : box === 'content-box' ? [t + pt, r + pr, b + pb, l + pl] : [t, r, b, l];
}

function background(c: C, n: BoxNode, i: number, env: PaintEnv) {
  const L = n.look;
  const g = L.images[i];
  if (!g) return;
  const o = edges(n, L.bgOrigin[i]!);
  const ax = n.x + o[3], ay = n.y + o[0], aw = n.w - o[1] - o[3], ah = n.h - o[0] - o[2];
  let nw = aw, nh = ah;
  if (g.kind === 'url') {
    const img = env.image(g.url);
    nw = img.naturalWidth || aw;
    nh = img.naturalHeight || ah;
  }
  // an image with no size of its own fits into the area, as `contain` does
  const size = g.kind === 'url' && L.bgSize[i] === 'auto' && env.unsized(env.image(g.url)) ? 'contain' : L.bgSize[i]!;
  let tw = nw, th = nh;
  if (size === 'cover' || size === 'contain') {
    const k = (size === 'cover' ? Math.max : Math.min)(aw / nw, ah / nh);
    tw = nw * k;
    th = nh * k;
  } else if (size !== 'auto') {
    const [sw, sh = 'auto'] = size.split(/\s+/);
    if (sw !== 'auto') tw = resolve(sw!, aw);
    if (sh !== 'auto') th = resolve(sh, ah);
    if (sw === 'auto') tw = (th * nw) / nh;
    if (sh === 'auto') th = (tw * nh) / nw;
  }
  if (tw < 0.01 || th < 0.01) return;
  const [px0, py0] = position(L.bgPos[i]!, [aw - tw, ah - th]);
  const rep = L.bgRepeat[i]!;
  const repX = rep === 'repeat' || rep === 'repeat-x', repY = rep === 'repeat' || rep === 'repeat-y';
  if (!repX && !repY && rep !== 'no-repeat') throw new Error(`dom: background-repeat ${rep} is not supported`);
  const x0 = repX ? ax + px0 - Math.ceil((ax + px0 - n.x) / tw) * tw : ax + px0;
  const y0 = repY ? ay + py0 - Math.ceil((ay + py0 - n.y) / th) * th : ay + py0;
  const nx = repX ? Math.ceil((n.x + n.w - x0) / tw) : 1, ny = repY ? Math.ceil((n.y + n.h - y0) / th) : 1;
  if (nx * ny > 4096) throw new Error(`dom: a background of ${nx * ny} tiles is not supported`);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      c.save();
      c.translate(x0 + ix * tw, y0 + iy * th);
      c.beginPath();
      c.rect(0, 0, tw, th);
      c.clip();
      drawTile(c, g, tw, th, env);
      c.restore();
    }
  }
}

/**
 * The dashes of a `dashed` or `dotted` side of length `len` and width `w`, as Chrome spaces them: a dash (or
 * dot) at each end, the gaps stretched to fit. Returns the start of each dash and its length.
 */
function dashes(len: number, w: number, style: string): { at: number[]; d: number } {
  const [d, g] = style === 'dotted' ? [w, w] : w >= 3 ? [2 * w, w] : [3 * w, 2 * w];
  const n = Math.max(1, Math.round((len + g) / (d + g)));
  const gap = n > 1 ? (len - n * d) / (n - 1) : 0;
  return { at: Array.from({ length: n }, (_, i) => (n > 1 ? i * (d + gap) : (len - d) / 2)), d };
}

function borders(c: C, n: BoxNode) {
  const L = n.look;
  const [t, r, b, l] = L.bw;
  if (t + r + b + l === 0) return;
  const { x, y, w, h } = n;
  if (n.gap) {
    c.save();
    c.beginPath();
    c.rect(x - 1, y - 1, w + 2, h + 2);
    c.rect(n.gap[0], y - 1, n.gap[1] - n.gap[0], t + 2);
    c.clip('evenodd');
    borders(c, { ...n, gap: null });
    c.restore();
    return;
  }
  const ring = () => {
    c.beginPath();
    rrect(c, x, y, w, h, n.radii);
    rrect(c, x + l, y + t, w - l - r, h - t - b, inset(n.radii, t, r, b, l));
  };
  const sides = [0, 1, 2, 3].filter((k) => L.bw[k]! > 0 && !CLEAR.test(L.bc[k]!));
  if (!sides.length) return;
  const solid = sides.every((k) => L.bs[k] === 'solid');
  if (solid && sides.every((k) => L.bc[k] === L.bc[sides[0]!]) && sides.length === [t, r, b, l].filter((v) => v > 0).length) {
    ring();
    c.fillStyle = L.bc[sides[0]!]!;
    c.fill('evenodd');
    return;
  }
  if (!solid && n.radii.some(([rx, ry]) => rx > 0 || ry > 0)) throw new Error(`dom: a dashed or dotted border with round corners is not supported (${L.bs.join(' ')})`);
  // Sides of different colours meet on the diagonal of each corner. The diagonal goes on into the box as far as
  // the largest corner radius: the ring of a round corner is wider than the border.
  const reach = Math.max(...n.radii.flat(), t, r, b, l) + 1;
  const far = (px0: number, py0: number, dx: number, dy: number): [number, number] => {
    const s = reach / Math.max(Math.abs(dx), Math.abs(dy), 1e-6);
    return [px0 + dx * s, py0 + dy * s];
  };
  const tl = far(x, y, l, t), tr = far(x + w, y, -r, t), br = far(x + w, y + h, -r, -b), bl = far(x, y + h, l, -b);
  const quad: [number, number][][] = [
    [[x, y], [x + w, y], tr, tl],
    [[x + w, y], [x + w, y + h], br, tr],
    [[x + w, y + h], [x, y + h], bl, br],
    [[x, y + h], [x, y], tl, bl],
  ];
  c.save();
  ring();
  c.clip('evenodd');
  for (const k of sides) {
    c.save();
    c.beginPath();
    quad[k]!.forEach(([qx, qy], i) => (i ? c.lineTo(qx, qy) : c.moveTo(qx, qy)));
    c.closePath();
    c.fillStyle = L.bc[k]!;
    if (L.bs[k] === 'solid') {
      c.fill();
      c.restore();
      continue;
    }
    c.clip();
    // the side runs along x (top, bottom) or y (left, right), from corner to corner
    const bw = L.bw[k]!, along = k % 2 === 0, len = along ? w : h;
    const { at, d } = dashes(len, bw, L.bs[k]!);
    // Chrome draws the dots of a border up to 3 px wide as squares, wider ones as circles
    const round = L.bs[k] === 'dotted' && bw > 3;
    c.beginPath();
    for (const a of at) {
      const [sx, sy] = along ? [x + a, k === 0 ? y : y + h - bw] : [k === 3 ? x : x + w - bw, y + a];
      if (round) c.ellipse(sx + bw / 2, sy + bw / 2, bw / 2, bw / 2, 0, 0, Math.PI * 2);
      else c.rect(sx, sy, along ? d : bw, along ? bw : d);
    }
    c.fill();
    c.restore();
  }
  c.restore();
}

/** Alpha (of 255) that a stroke split over a row of faint px must have in sum to keep 1 px: 0.63 px of cover. */
const STROKE = 160;

/**
 * Turns the anti-aliased alpha of the RGBA pixels `a` (`w` x `h` px) into whole px, on or off. A px with half
 * cover or more is on. An upright stroke of about 1 px or less that is not on the px grid (the stem of an "i",
 * "l", "n", the arm of an "h") spreads its cover over 2 or 3 px of a row that each stay below half: a plain
 * threshold drops it. So a faint px is on too where it is the peak of such a stroke: it has the most cover of its
 * row neighbours, at least half of `STROKE`, and with the faint ones of them it sums to `STROKE` or more. A faint
 * px next to an on px is the edge of that stroke: it is never a peak and does not count as a rival, so a stem
 * keeps its gap to the next glyph and the edges of two strokes do not fill the gap between them.
 */
function binarize(a: Uint8ClampedArray, w: number, h: number) {
  const on = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const at = (x: number) => (x < 0 || x >= w ? 0 : a[(row + x) * 4 + 3]!);
    /** The alpha of a faint px, 0 for an on px. */
    const faint = (x: number) => (at(x) < 128 ? at(x) : 0);
    /** The alpha of a faint px that can be a peak: 0 for an on px and for the edge of one. */
    const free = (x: number) => (at(x) < 128 && at(x - 1) < 128 && at(x + 1) < 128 ? at(x) : 0);
    for (let x = 0; x < w; x++) {
      const q = at(x);
      if (q >= 128) on[row + x] = 255;
      else if (free(x) * 2 >= STROKE && q >= free(x - 1) && q > free(x + 1) && faint(x - 1) + q + faint(x + 1) >= STROKE) on[row + x] = 255;
    }
  }
  for (let i = 0; i < on.length; i++) a[i * 4 + 3] = on[i]!;
}

/** The mask of a crisp text: the glyphs drawn at 1 canvas px per CSS px, each px on or off. */
function crispMask(c: C, it: TextItem): HTMLCanvasElement {
  const L = it.look;
  const m = Math.ceil(L.size * 0.5) + 2;
  const cv = c.canvas.ownerDocument.createElement('canvas');
  cv.width = Math.ceil(it.b[2] - it.b[0]) + 2 * m;
  cv.height = Math.ceil(it.b[3] - it.b[1]) + 2 * m;
  const k = cv.getContext('2d', { willReadFrequently: true })!;
  k.font = L.font;
  k.letterSpacing = `${L.spacing}px`;
  k.fillStyle = '#000';
  k.fillText(it.str, Math.round(it.x) - Math.floor(it.b[0]) + m, Math.round(it.y) - Math.floor(it.b[1]) + m);
  const img = k.getImageData(0, 0, cv.width, cv.height);
  const a = img.data;
  binarize(a, cv.width, cv.height);
  k.putImageData(img, 0, 0);
  return cv;
}

/** Draws the mask of a crisp text in colour `color`, `dx, dy` px from its place, with no filter. */
function crispDraw(c: C, it: TextItem, color: string, dx: number, dy: number) {
  const mask = it.mask!;
  const m = Math.ceil(it.look.size * 0.5) + 2;
  const tint = c.canvas.ownerDocument.createElement('canvas');
  tint.width = mask.width;
  tint.height = mask.height;
  const k = tint.getContext('2d')!;
  k.drawImage(mask, 0, 0);
  k.globalCompositeOperation = 'source-in';
  k.fillStyle = color;
  k.fillRect(0, 0, tint.width, tint.height);
  c.save();
  c.imageSmoothingEnabled = false;
  c.drawImage(tint, Math.floor(it.b[0]) - m + dx, Math.floor(it.b[1]) - m + dy);
  c.restore();
}

function text(c: C, it: TextItem, res: number) {
  const L = it.look;
  if (L.crisp) {
    it.mask ??= crispMask(c, it);
    for (let i = L.shadows.length - 1; i >= 0; i--) {
      const s = L.shadows[i]!;
      if (s.blur > 0) throw new Error(`dom: a text-shadow with a blur on crisp text (-webkit-font-smoothing: none) is not supported: "${it.str}"`);
      crispDraw(c, it, s.color, s.x, s.y);
    }
    crispDraw(c, it, L.color, 0, 0);
    return;
  }
  c.save();
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  c.font = L.font;
  c.letterSpacing = `${L.spacing}px`;
  // the browser puts a baseline on a whole device px. (Canvas text under a scale is the text of the larger font
  // size: the same pixels as a font of `size * res` px with no scale.)
  const y = Math.round(it.y * res) / res;
  for (let i = L.shadows.length - 1; i >= 0; i--) {
    c.save();
    shadowOn(c, L.shadows[i]!);
    c.fillText(it.str, it.x - OFF, y);
    c.restore();
  }
  c.fillStyle = L.color;
  c.fillText(it.str, it.x, y);
  if (L.underline) c.fillRect(it.x, y + Math.max(1, L.size * 0.1), it.w, Math.max(1, Math.round(L.size / 16)));
  c.restore();
}

function image(c: C, it: ImgItem) {
  c.save();
  c.imageSmoothingEnabled = it.smooth;
  c.drawImage(it.img, it.x, it.y, it.w, it.h);
  c.restore();
}

function box(c: C, n: BoxNode, env: PaintEnv) {
  const L = n.look;
  c.save();
  const cull = env.cull;
  if (n.m) {
    c.transform(...n.m);
    // the cull rectangle is in the space of the surface: a transformed subtree paints whole
    env.cull = null;
  }
  if (L.opacity < 1) c.globalAlpha *= L.opacity;
  if (L.paint) {
    for (let i = L.shadows.length - 1; i >= 0; i--) if (!L.shadows[i]!.inset) outerShadow(c, n, L.shadows[i]!);
    const [ct, cr, cb, cl] = edges(n, L.bgClip);
    c.save();
    c.beginPath();
    rrect(c, n.x + cl, n.y + ct, n.w - cl - cr, n.h - ct - cb, inset(n.radii, ct, cr, cb, cl));
    c.clip();
    if (L.images.some((g) => g?.kind === 'url')) c.imageSmoothingEnabled = L.smooth;
    if (!CLEAR.test(L.bg)) {
      c.fillStyle = L.bg;
      c.fillRect(n.x, n.y, n.w, n.h);
    }
    for (let i = L.images.length - 1; i >= 0; i--) background(c, n, i, env);
    c.restore();
    for (let i = L.shadows.length - 1; i >= 0; i--) if (L.shadows[i]!.inset) insetShadow(c, n, L.shadows[i]!);
    borders(c, n);
    if (L.outline) {
      const o = L.outline, d = o.off + o.w / 2;
      c.strokeStyle = o.color;
      c.lineWidth = o.w;
      c.setLineDash(o.dotted ? [o.w, o.w] : []);
      c.strokeRect(n.x - d, n.y - d, n.w + 2 * d, n.h + 2 * d);
      c.setLineDash([]);
    }
  }
  if (n.clip) {
    const [t, r, b, l] = L.bw;
    c.beginPath();
    rrect(c, n.x + l, n.y + t, n.w - l - r, n.h - t - b, inset(n.radii, t, r, b, l));
    c.clip();
  }
  for (const k of n.kids) paint(c, k, env);
  env.cull = cull;
  c.restore();
}

/** Paints `item` and its subtree. */
export function paint(c: C, item: Item, env: PaintEnv) {
  if (env.cull && !meets(item.kind === 'box' ? item.sb : item.b, env.cull)) return;
  if (item.kind === 'box') box(c, item, env);
  else if (item.kind === 'text') text(c, item, env.res);
  else image(c, item);
}
