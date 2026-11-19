// The reader of the DOM interpreter (dom.ts): walks a laid-out DOM subtree and gives a display list.
// The browser did the parse, the cascade and the layout. The reader takes the computed style and the boxes.
// A property that the painter cannot draw throws with the element and the value: nothing is left out silently.
// The reader keeps what it read from the computed style of each element (a `Look`) and the words of each text
// node in a `ReadCache`, so a frame where only text or layout changed reads only the boxes again.
import { parseImages, parseShadows, px, splitTop, type BgImage, type Shadow } from './domcss';

/** x0, y0, x1, y1, px. */
export type Rect = [number, number, number, number];
/** A 2D affine matrix a, b, c, d, e, f (as DOMMatrix): x' = a x + c y + e, y' = b x + d y + f. */
export type Mat = [number, number, number, number, number, number];

/** What a text node takes from the computed style of its element. */
export interface TextLook {
  /** The CSS font. */
  font: string;
  size: number; color: string; spacing: number;
  shadows: Shadow[];
  underline: boolean;
  /** `-webkit-font-smoothing: none`: no anti-aliasing, the glyphs are whole CSS px. */
  crisp: boolean;
}

export interface TextItem {
  kind: 'text';
  str: string;
  /** Left edge and baseline, px from the surface origin. */
  x: number; y: number; w: number;
  look: TextLook;
  /** The paint bounds. */
  b: Rect;
  /** The glyphs as a mask of whole CSS px (crisp text), made by the painter on the first paint. */
  mask?: HTMLCanvasElement;
}

/** An `<img>`: `src` is the address that it shows, so a new `src` on the same element is a change. */
export interface ImgItem { kind: 'img'; img: HTMLImageElement; src: string; x: number; y: number; w: number; h: number; smooth: boolean; b: Rect }

/** What a box takes from its computed style: the same object while the style does not change. */
export interface Look {
  cs: CSSStyleDeclaration;
  /** False for `visibility: hidden`: the children can still show. */
  paint: boolean;
  z: number;
  opacity: number;
  /** Corner radii as the computed style gives them (px or %): top left, top right, bottom right, bottom left. */
  radii: string[];
  bg: string;
  images: (BgImage | null)[];
  bgSize: string[]; bgPos: string[]; bgRepeat: string[]; bgOrigin: string[];
  /** `background-clip`: the box that the colour and the images fill. */
  bgClip: 'border-box' | 'padding-box' | 'content-box';
  /** Border widths, colours and styles: top, right, bottom, left. */
  bw: [number, number, number, number];
  bc: [string, string, string, string];
  bs: [string, string, string, string];
  shadows: Shadow[];
  outline: { w: number; off: number; color: string; dotted: boolean } | null;
  /** The children are clipped to the padding box. */
  clip: boolean;
  /** The element has a `transform`. */
  transform: boolean;
  /** `text-overflow: ellipsis` on a box that clips. */
  ellipsis: boolean;
  /** `image-rendering` lets the painter filter an image. */
  smooth: boolean;
  text: TextLook | null;
  /** All of the above as text: two looks with the same `sig` paint the same. */
  sig: string;
}

export interface BoxNode {
  kind: 'box';
  el: Element;
  look: Look;
  /** The border box, px from the surface origin (before the transform of the element). */
  x: number; y: number; w: number; h: number;
  /** Corner radii [rx, ry] of the border box, px. */
  radii: [number, number][];
  pad: [number, number, number, number];
  /** The transform of the element in the space of its parent, or null. */
  m: Mat | null;
  /** The children are clipped to the padding box (`overflow`, or a text field). */
  clip: boolean;
  /** A fieldset with a legend: the x range (px from the surface origin) where the top border is left out. */
  gap: [number, number] | null;
  kids: Item[];
  /** The paint bounds of the box itself, in its own space. */
  b: Rect;
  /** The paint bounds of the box and its subtree, in the space of its parent. */
  sb: Rect;
}

export type Item = BoxNode | TextItem | ImgItem;

/** The looks and the words that the reader keeps between reads. */
export class ReadCache {
  looks = new WeakMap<Element, Look>();
  texts = new WeakMap<Text, { key: string; look: TextLook; items: TextItem[] }>();
  /** Forgets every look: the next read takes the computed style again. */
  restyle() {
    this.looks = new WeakMap();
  }
  /** Forgets the looks of `el` and its subtree. */
  restyleTree(el: Element) {
    this.looks.delete(el);
    for (const k of el.querySelectorAll('*')) this.looks.delete(k);
  }
}

export interface ReadEnv {
  /** The page position of the surface origin. */
  ox: number; oy: number;
  /** Font ascent and descent of a CSS font string, px. */
  metrics(font: string): { asc: number; desc: number };
  /** The width of a string in a CSS font, px. */
  width(font: string, s: string): number;
  cache: ReadCache;
  /** Text of a block with `text-overflow: ellipsis` that overflows: the text ends at `room` (px from the surface origin), the ellipsis after it. */
  cut?: { room: number; look: TextLook; done: boolean } | null;
}

const NO_TAGS: Record<string, true> = { SELECT: true, PROGRESS: true, METER: true, VIDEO: true, CANVAS: true, IFRAME: true, OBJECT: true, EMBED: true, svg: true };
const TEXT_INPUTS: Record<string, true> = { text: true, password: true, search: true, email: true, url: true, number: true, tel: true, '': true };
const BORDER_STYLES: Record<string, true> = { solid: true, dashed: true, dotted: true };

export function describe(el: Element): string {
  const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '';
  return `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls}>`;
}

function fail(el: Element, what: string): never {
  throw new Error(`dom: ${describe(el)} ${what} is not supported`);
}

function guard(el: Element, cs: CSSStyleDeclaration) {
  if (NO_TAGS[el.tagName]) fail(el, 'element');
  const no: [string, string][] = [
    ['filter', 'none'], ['backdrop-filter', 'none'], ['clip-path', 'none'], ['mask-image', 'none'],
    ['mix-blend-mode', 'normal'], ['border-image-source', 'none'], ['translate', 'none'], ['rotate', 'none'], ['scale', 'none'],
    ['perspective', 'none'], ['object-fit', 'fill'],
  ];
  for (const [prop, ok] of no) {
    const v = cs.getPropertyValue(prop);
    if (v && v !== ok) fail(el, `${prop}: ${v}`);
  }
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const style = cs.getPropertyValue(`border-${side}-style`);
    if (px(cs.getPropertyValue(`border-${side}-width`)) > 0 && !BORDER_STYLES[style]) fail(el, `border-${side}-style: ${style}`);
  }
  if (cs.display === 'list-item' && (cs.listStyleType !== 'none' || cs.listStyleImage !== 'none')) fail(el, `list marker (list-style: ${cs.listStyleType} ${cs.listStyleImage}), set list-style: none`);
  if (cs.backgroundClip.includes('text')) fail(el, `background-clip: ${cs.backgroundClip}`);
}

const cycle = (list: string[], n: number) => Array.from({ length: n }, (_, i) => list[i % list.length]!);

function radius(v: string, w: number, h: number): [number, number] {
  const p = v.split(/\s+/);
  const one = (s: string, of: number) => (s.endsWith('%') ? (parseFloat(s) / 100) * of : px(s));
  return [one(p[0]!, w), one(p[1] ?? p[0]!, h)];
}

function transformText(s: string, mode: string): string {
  if (mode === 'uppercase') return s.toUpperCase();
  if (mode === 'lowercase') return s.toLowerCase();
  if (mode === 'capitalize') return s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

function textLook(cs: CSSStyleDeclaration): TextLook {
  return {
    font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
    size: px(cs.fontSize),
    color: cs.color,
    spacing: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
    shadows: parseShadows(cs.textShadow),
    underline: cs.textDecorationLine.includes('underline'),
    crisp: cs.getPropertyValue('-webkit-font-smoothing') === 'none',
  };
}

function readLook(el: Element, cs: CSSStyleDeclaration): Look {
  guard(el, cs);
  const images = parseImages(cs.backgroundImage);
  const n = Math.max(1, images.length);
  const ow = px(cs.outlineWidth);
  const clipV = cs.backgroundClip.split(',')[0]!.trim();
  const look: Look = {
    cs,
    paint: cs.visibility === 'visible',
    z: cs.position !== 'static' && cs.zIndex !== 'auto' ? parseInt(cs.zIndex, 10) : 0,
    opacity: parseFloat(cs.opacity),
    radii: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius],
    bg: cs.backgroundColor,
    images,
    bgSize: cycle(splitTop(cs.backgroundSize, ','), n), bgPos: cycle(splitTop(cs.backgroundPosition, ','), n),
    bgRepeat: cycle(splitTop(cs.backgroundRepeat, ','), n), bgOrigin: cycle(splitTop(cs.backgroundOrigin, ','), n),
    bgClip: clipV === 'padding-box' || clipV === 'content-box' ? clipV : 'border-box',
    bw: [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)],
    bc: [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor],
    bs: [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle],
    shadows: parseShadows(cs.boxShadow),
    outline: cs.outlineStyle !== 'none' && ow > 0 ? { w: ow, off: px(cs.outlineOffset), color: cs.outlineColor, dotted: cs.outlineStyle === 'dotted' || cs.outlineStyle === 'dashed' } : null,
    clip: cs.overflowX !== 'visible' || cs.overflowY !== 'visible',
    transform: cs.transform !== 'none',
    ellipsis: cs.textOverflow === 'ellipsis',
    smooth: cs.imageRendering !== 'pixelated' && cs.imageRendering !== 'crisp-edges',
    text: null,
    sig: '',
  };
  const { cs: _, text: __, sig: ___, ...rest } = look;
  look.sig = JSON.stringify(rest);
  return look;
}

/** The look of `el`, from the cache when its style did not change. */
function lookOf(el: Element, env: ReadEnv): Look | null {
  let look = env.cache.looks.get(el);
  if (!look) {
    const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
    if (cs.display === 'none') return null;
    look = readLook(el, cs);
    env.cache.looks.set(el, look);
  }
  return look;
}

const textOf = (look: Look) => (look.text ??= textLook(look.cs));

const union = (a: Rect, b: Rect): Rect => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const EMPTY: Rect = [Infinity, Infinity, -Infinity, -Infinity];

/** `r` through matrix `m`: the bounds of its 4 corners. */
export function mapRect(m: Mat, r: Rect): Rect {
  if (!(r[2] >= r[0])) return r;
  let out = EMPTY;
  for (const [x, y] of [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]] as const) {
    const X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5];
    out = union(out, [X, Y, X, Y]);
  }
  return out;
}

export const mul = (p: Mat, q: Mat): Mat => [
  p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
];

/** The paint bounds of the glyphs of a text that starts at `x` with a line box `top`..`top + h`. */
function textBounds(look: TextLook, x: number, w: number, top: number, h: number): Rect {
  let m = look.size * 0.5 + 2;
  for (const s of look.shadows) m = Math.max(m, look.size * 0.5 + 2 * s.blur + Math.max(Math.abs(s.x), Math.abs(s.y)) + 2);
  return [x - m, top - m, x + w + m, top + h + m];
}

/** The words of a text node, each at the place where the browser put it. */
function readText(node: Text, look: Look, env: ReadEnv, out: Item[]) {
  const raw = node.data;
  if (!/\S/.test(raw) || look.cs.visibility !== 'visible') return;
  const st = textOf(look);
  const range = node.ownerDocument.createRange();
  // the words of a node keep their places while the line boxes of the node keep theirs
  range.selectNodeContents(node);
  let key = '';
  if (!env.cut) {
    key = `${env.ox},${env.oy},${raw}`;
    for (const r of range.getClientRects()) key += `;${r.left},${r.top},${r.width},${r.height}`;
    const hit = env.cache.texts.get(node);
    if (hit && hit.key === key && hit.look === st) {
      for (const it of hit.items) out.push(it);
      return;
    }
  }
  const { asc, desc } = env.metrics(st.font);
  const items: TextItem[] = [];
  let prev: TextItem | null = null, prevTop = NaN;
  const cut = env.cut;
  const put = (from: number, to: number) => {
    if (cut?.done) return;
    range.setStart(node, from);
    range.setEnd(node, to);
    const rects = range.getClientRects();
    if (!rects.length) return;
    if (rects.length > 1 && to - from > 1) {
      // a word that the browser broke over lines: place each character
      for (let i = from; i < to; i++) put(i, i + 1);
      return;
    }
    const r = rects[0]!;
    let str = transformText(raw.slice(from, to), look.cs.textTransform);
    const x = r.left - env.ox;
    let w = r.width;
    if (cut && x + w > cut.room) {
      // text-overflow: ellipsis. The block overflows: the first word that does not fit with the ellipsis loses
      // characters from its end until it fits, and the ellipsis follows it.
      let n = str.length;
      while (n > 0 && x + env.width(st.font, str.slice(0, n)) > cut.room) n--;
      str = str.slice(0, n);
      w = env.width(st.font, str);
      cut.done = true;
    }
    // the browser puts the line box on a whole CSS px, the baseline at the ascent below its top
    const top = Math.round(r.top) - env.oy;
    const item: TextItem = { kind: 'text', str, x, y: top + (r.height - (asc + desc)) / 2 + asc, w, look: st, b: textBounds(st, x, w, top, r.height) };
    // an underline runs through the space between two words of a line
    if (prev && st.underline && Math.abs(prevTop - r.top) < 1) {
      prev.w = item.x - prev.x;
      prev.b = textBounds(st, prev.x, prev.w, prevTop - env.oy, r.height);
    }
    prev = item;
    prevTop = r.top;
    if (str) items.push(item);
    if (cut?.done) {
      const ell = cut.look;
      const ex = x + w, ew = env.width(ell.font, '\u2026');
      items.push({ kind: 'text', str: '\u2026', x: ex, y: item.y, w: ew, look: ell, b: textBounds(ell, ex, ew, top, r.height) });
    }
  };
  for (const m of raw.matchAll(/\S+/g)) put(m.index, m.index + m[0].length);
  if (!env.cut) env.cache.texts.set(node, { key, look: st, items });
  for (const it of items) out.push(it);
}

/** The value of a text field: it is not a text node, so the reader places it in the content box. */
function readValue(el: HTMLInputElement | HTMLTextAreaElement, node: BoxNode, env: ReadEnv, out: Item[]) {
  const value = el.tagName === 'INPUT' && el.type === 'password' ? '\u2022'.repeat(el.value.length) : el.value;
  if (!value) return;
  const st = textOf(node.look);
  const { asc, desc } = env.metrics(st.font);
  const [bt, , bb, bl] = node.look.bw, [pt, , pb, pl] = node.pad;
  const x = node.x + bl + pl;
  const top = node.y + bt + pt;
  const b: Rect = [node.x, node.y, node.x + node.w, node.y + node.h];
  // as for a text node, the line box of the value sits on a whole CSS px of the page
  const line = (y: number) => Math.round(y + env.oy) - env.oy + asc;
  if (el.tagName === 'TEXTAREA') {
    const lh = node.look.cs.lineHeight === 'normal' ? (asc + desc) * 1.15 : px(node.look.cs.lineHeight);
    value.split('\n').forEach((s, i) => out.push({ kind: 'text', str: s, x, y: line(top + i * lh + (lh - (asc + desc)) / 2), w: 0, look: st, b }));
    return;
  }
  const inner = node.h - bt - bb - pt - pb;
  out.push({ kind: 'text', str: value, x, y: line(top + (inner - (asc + desc)) / 2), w: 0, look: st, b });
}

/** The own paint bounds of a box: its border box with the outer shadows and the outline. */
function ownBounds(n: BoxNode): Rect {
  let m = 0;
  // a blur of radius b is a gaussian of sigma b / 2, and the canvas draws it out to 3 sigma
  for (const s of n.look.shadows) if (!s.inset) m = Math.max(m, 2 * s.blur + s.spread + Math.max(Math.abs(s.x), Math.abs(s.y)));
  if (n.look.outline) m = Math.max(m, n.look.outline.off + n.look.outline.w);
  m += 1;
  return [n.x - m, n.y - m, n.x + n.w + m, n.y + n.h + m];
}

/**
 * The transform `tf` of `el` (origin `origin`, its border box at `x, y`) in the space of its parent. The read of
 * the subtree runs with the transform off (`untransformed`), so the boxes of the subtree are its layout boxes.
 */
function matrixOf(el: Element, tf: string, origin: string, x: number, y: number): Mat {
  const t = new (el.ownerDocument.defaultView!).DOMMatrix(tf);
  if (!t.is2D) fail(el, `transform: ${tf} (3D)`);
  const [ox, oy] = origin.split(/\s+/).map(px) as [number, number];
  const cx = x + ox, cy = y + oy;
  return mul(mul([1, 0, 0, 1, cx, cy], [t.a, t.b, t.c, t.d, t.e, t.f]), [1, 0, 0, 1, -cx, -cy]);
}

/** Runs `read` with the transform of `el` off. The style changes go round transitions and leave no mutation that counts. */
function untransformed<T>(el: HTMLElement | SVGElement, cs: CSSStyleDeclaration, read: () => T): T {
  const st = el.style;
  const tv = st.getPropertyValue('transform'), tp = st.getPropertyPriority('transform');
  const nv = st.getPropertyValue('transition'), np = st.getPropertyPriority('transition');
  st.setProperty('transition', 'none', 'important');
  st.setProperty('transform', 'none', 'important');
  try {
    return read();
  } finally {
    if (tv) st.setProperty('transform', tv, tp); else st.removeProperty('transform');
    void cs.transform;
    if (nv) st.setProperty('transition', nv, np); else st.removeProperty('transition');
  }
}

/** Reads element `el` and its subtree. Returns null for an element that draws nothing (`display: none`, opacity 0). */
export function readDom(el: Element, env: ReadEnv, root = true): BoxNode | null {
  const look = lookOf(el, env);
  if (!look || look.opacity === 0) return null;
  if (!look.transform) return readBox(el, look, env, null);
  if (root) fail(el, `transform: ${look.cs.transform} on the element of a surface (move the object of the surface instead)`);
  // the transform and its origin (px that depend on the layout) are read while the transform is on
  const tf = look.cs.transform, origin = look.cs.transformOrigin;
  return untransformed(el as HTMLElement, look.cs, () => {
    const lr = el.getBoundingClientRect();
    return readBox(el, look, env, matrixOf(el, tf, origin, lr.left - env.ox, lr.top - env.oy));
  });
}

function readBox(el: Element, look: Look, env: ReadEnv, m: Mat | null): BoxNode {
  const win = el.ownerDocument.defaultView!;
  const cs = look.cs;
  const r = el.getBoundingClientRect();
  const bw = look.bw;
  if (look.clip && el instanceof win.HTMLElement && (el.offsetWidth - el.clientWidth - bw[1] - bw[3] > 0.5 || el.offsetHeight - el.clientHeight - bw[0] - bw[2] > 0.5)) {
    fail(el, 'scrollbar (overflow with content that overflows): set scrollbar-width: none and draw the bar with elements');
  }
  const node: BoxNode = {
    kind: 'box', el, look, x: r.left - env.ox, y: r.top - env.oy, w: r.width, h: r.height,
    radii: look.radii.map((v) => radius(v, r.width, r.height)),
    pad: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
    m,
    clip: look.clip,
    gap: null,
    kids: [],
    b: EMPTY, sb: EMPTY,
  };
  if (el.tagName === 'FIELDSET') {
    // the box of a fieldset starts at the middle of its legend, and the top border stops behind the legend
    const legend = [...el.children].find((k) => k.tagName === 'LEGEND' && win.getComputedStyle(k).display !== 'none');
    if (legend) {
      const lr = legend.getBoundingClientRect();
      const top = lr.top - env.oy + (lr.height - bw[0]) / 2;
      if (top > node.y) {
        node.h -= top - node.y;
        node.y = top;
        node.gap = [lr.left - env.ox, lr.right - env.ox];
      }
    }
  }
  node.b = ownBounds(node);
  if (el instanceof win.HTMLImageElement) {
    if (!el.complete || !el.naturalWidth) fail(el, 'image that is not loaded');
    const [pt, pr, pb, pl] = node.pad;
    const ix = node.x + bw[3] + pl, iy = node.y + bw[0] + pt;
    const iw = r.width - bw[1] - bw[3] - pr - pl, ih = r.height - bw[0] - bw[2] - pt - pb;
    node.kids.push({ kind: 'img', img: el, src: el.currentSrc, x: ix, y: iy, w: iw, h: ih, smooth: look.smooth, b: [ix, iy, ix + iw, iy + ih] });
  } else if (el instanceof win.HTMLTextAreaElement || (el instanceof win.HTMLInputElement && TEXT_INPUTS[el.type])) {
    node.clip = true;
    if (look.paint) readValue(el, node, env, node.kids);
  } else {
    if (el instanceof win.HTMLInputElement && cs.appearance !== 'none') fail(el, `native input type ${el.type}`);
    const outer = env.cut;
    if (look.ellipsis && look.clip && el instanceof win.HTMLElement && el.scrollWidth > el.clientWidth + 0.5) {
      const ell = textOf(look);
      env.cut = { room: node.x + node.w - bw[1] - node.pad[1] - env.width(ell.font, '\u2026'), look: ell, done: false };
    }
    for (const child of el.childNodes) {
      if (child.nodeType === 3) readText(child as Text, look, env, node.kids);
      else if (child.nodeType === 1) {
        const k = readDom(child as Element, env, false);
        if (k) node.kids.push(k);
      }
    }
    env.cut = outer;
  }
  // stacking: children with a z-index go under or over the others, in their order
  if (node.kids.some((k) => k.kind === 'box' && k.look.z !== 0)) {
    const z = (k: Item) => (k.kind === 'box' ? k.look.z : 0);
    node.kids = node.kids.map((k, i) => ({ k, i })).sort((a, b) => z(a.k) - z(b.k) || a.i - b.i).map((e) => e.k);
  }
  let kb = EMPTY;
  for (const k of node.kids) kb = union(kb, k.kind === 'box' ? k.sb : k.b);
  // the children of a clipping box (a text field too) show only inside its padding box
  if (node.clip) kb = [Math.max(kb[0], node.x + bw[3]), Math.max(kb[1], node.y + bw[0]), Math.min(kb[2], node.x + node.w - bw[1]), Math.min(kb[3], node.y + node.h - bw[2])];
  const all = kb[2] >= kb[0] && kb[3] >= kb[1] ? union(node.b, kb) : node.b;
  node.sb = m ? mapRect(m, all) : all;
  return node;
}

const same = (a: readonly unknown[] | null, b: readonly unknown[] | null) => a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));

function sameText(a: TextItem, b: TextItem): boolean {
  if (a === b) return true;
  if (a.str !== b.str || a.x !== b.x || a.y !== b.y || a.w !== b.w) return false;
  const p = a.look, q = b.look;
  return p === q || (p.font === q.font && p.color === q.color && p.spacing === q.spacing && p.underline === q.underline && p.crisp === q.crisp && JSON.stringify(p.shadows) === JSON.stringify(q.shadows));
}

/**
 * The part of the surface (px from its origin) that paints otherwise in display list `b` than in `a`: the union
 * of the bounds of every item that changed, in the old and the new list. Null when nothing changed.
 */
export function diff(a: BoxNode, b: BoxNode): Rect | null {
  let out = EMPTY;
  const add = (r: Rect, m: Mat | null) => (out = union(out, m ? mapRect(m, r) : r));
  const item = (p: Item, q: Item, m: Mat | null) => {
    if (p.kind === 'box' && q.kind === 'box') return box(p, q, m);
    const ok = p.kind === 'text' && q.kind === 'text' ? sameText(p, q)
      : p.kind === 'img' && q.kind === 'img' ? p.img === q.img && p.src === q.src && p.x === q.x && p.y === q.y && p.w === q.w && p.h === q.h && p.smooth === q.smooth
      : false;
    if (!ok) {
      add(p.kind === 'box' ? p.sb : p.b, m);
      add(q.kind === 'box' ? q.sb : q.b, m);
    }
  };
  const box = (p: BoxNode, q: BoxNode, m: Mat | null) => {
    if (p.el !== q.el || p.look.sig !== q.look.sig || !same(p.m, q.m) || p.clip !== q.clip) {
      add(p.sb, m);
      add(q.sb, m);
      return;
    }
    const inner = p.m ? (m ? mul(m, p.m) : p.m) : m;
    if (p.x !== q.x || p.y !== q.y || p.w !== q.w || p.h !== q.h || !same(p.pad, q.pad) || !same(p.gap, q.gap) || p.radii.some((r, i) => !same(r, q.radii[i]!))) {
      add(p.b, inner);
      add(q.b, inner);
    }
    if (p.kids.length !== q.kids.length) {
      for (const k of p.kids) add(k.kind === 'box' ? k.sb : k.b, inner);
      for (const k of q.kids) add(k.kind === 'box' ? k.sb : k.b, inner);
      return;
    }
    for (let i = 0; i < p.kids.length; i++) item(p.kids[i]!, q.kids[i]!, inner);
  };
  box(a, b, null);
  return out[2] >= out[0] && out[3] >= out[1] ? out : null;
}
