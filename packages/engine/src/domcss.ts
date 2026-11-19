// Parsers for the computed CSS values that the DOM interpreter paints (dom.ts): shadows, gradients, images,
// lengths. The input is the text that getComputedStyle returns: colours are rgb()/rgba()/color(), lengths are px.

/** Splits `s` at each `sep` that is not inside brackets. */
export function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === sep && depth === 0) {
      out.push(s.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(s.slice(from).trim());
  return out.filter((x) => x !== '');
}

const LEN = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(px|%)?$/i;

export const px = (v: string) => parseFloat(v) || 0;

export interface Shadow { inset: boolean; x: number; y: number; blur: number; spread: number; color: string }

/** `box-shadow` or `text-shadow`: a list of `colour x y blur spread inset`, in any order of colour and lengths. */
export function parseShadows(v: string): Shadow[] {
  if (!v || v === 'none') return [];
  return splitTop(v, ',').map((one) => {
    const n: number[] = [];
    let color = 'rgb(0, 0, 0)', inset = false;
    for (const tok of splitTop(one, ' ')) {
      if (tok === 'inset') inset = true;
      else if (LEN.test(tok)) n.push(parseFloat(tok));
      else color = tok;
    }
    return { inset, x: n[0] ?? 0, y: n[1] ?? 0, blur: n[2] ?? 0, spread: n[3] ?? 0, color };
  });
}

/** A colour stop: `pos` is a number of `unit`, or null for a stop that takes its place from its neighbours. */
export interface Stop { color: string; pos: number | null; unit: '%' | 'px' }

export interface LinearGradient {
  kind: 'linear';
  /** Radians, CSS sense (0 is up, clockwise), or null when `to` gives a corner. */
  angle: number | null;
  /** A corner or side: x and y in -1, 0, 1. */
  to: [number, number] | null;
  stops: Stop[];
  repeating: boolean;
}
export interface RadialGradient {
  kind: 'radial';
  circle: boolean;
  size: string;
  /** The centre: two values, each `%` or `px`. */
  at: [string, string];
  stops: Stop[];
  repeating: boolean;
}
export interface UrlImage { kind: 'url'; url: string }
export type BgImage = LinearGradient | RadialGradient | UrlImage;

function parseStops(args: string[]): Stop[] {
  const stops: Stop[] = [];
  for (const a of args) {
    const toks = splitTop(a, ' ');
    const pos: string[] = [];
    while (toks.length > 1 && LEN.test(toks[toks.length - 1]!)) pos.unshift(toks.pop()!);
    const color = toks.join(' ');
    if (!pos.length) stops.push({ color, pos: null, unit: '%' });
    for (const p of pos) stops.push({ color, pos: parseFloat(p), unit: p.endsWith('%') ? '%' : 'px' });
  }
  return stops;
}

const ANGLE = /^(-?(?:\d+\.?\d*|\.\d+))(deg|rad|turn|grad)$/;
const TURN: Record<string, number> = { deg: Math.PI / 180, rad: 1, turn: Math.PI * 2, grad: Math.PI / 200 };
const KEY: Record<string, string> = { left: '0%', top: '0%', center: '50%', right: '100%', bottom: '100%' };

/** `background-image`: the layers, the first one on top. Throws on an image kind that the painter does not have. */
export function parseImages(v: string): (BgImage | null)[] {
  if (!v || v === 'none') return [];
  return splitTop(v, ',').map((one): BgImage | null => {
    if (one === 'none') return null;
    const url = /^url\((.*)\)$/s.exec(one);
    if (url) return { kind: 'url', url: url[1]!.replace(/^["']|["']$/g, '').replace(/\\(["'])/g, '$1') };
    const g = /^(repeating-)?(linear|radial)-gradient\((.*)\)$/s.exec(one);
    if (!g) throw new Error(`background-image: ${one.slice(0, 60)} is not supported`);
    const args = splitTop(g[3]!, ',');
    const repeating = !!g[1];
    if (g[2] === 'linear') {
      let angle: number | null = Math.PI, to: [number, number] | null = null;
      const a = ANGLE.exec(args[0]!);
      if (a) {
        angle = parseFloat(a[1]!) * TURN[a[2]!]!;
        args.shift();
      } else if (args[0]!.startsWith('to ')) {
        const w = args.shift()!.split(/\s+/).slice(1);
        const tx = w.includes('left') ? -1 : w.includes('right') ? 1 : 0;
        const ty = w.includes('top') ? -1 : w.includes('bottom') ? 1 : 0;
        if (tx && ty) { angle = null; to = [tx, ty]; }
        else angle = tx ? (tx > 0 ? Math.PI / 2 : -Math.PI / 2) : ty < 0 ? 0 : Math.PI;
      }
      return { kind: 'linear', angle, to, stops: parseStops(args), repeating };
    }
    let circle = false, size = 'farthest-corner';
    const at: [string, string] = ['50%', '50%'];
    if (/^(circle|ellipse|closest|farthest|at\b)/.test(args[0]!)) {
      const [shape, pos] = args.shift()!.split(/\s*\bat\s+/);
      for (const w of (shape ?? '').split(/\s+/).filter(Boolean)) {
        if (w === 'circle') circle = true;
        else if (w !== 'ellipse') size = w;
      }
      if (pos) {
        const p = pos.split(/\s+/).map((k) => KEY[k] ?? k);
        at[0] = p[0]!;
        at[1] = p[1] ?? '50%';
      }
    }
    if (!/^(closest|farthest)-(side|corner)$/.test(size)) throw new Error(`radial-gradient size ${size} is not supported`);
    return { kind: 'radial', circle, size, at, stops: parseStops(args), repeating };
  });
}

/** A `%` or `px` value against the length `of`. Throws on another unit (calc, keywords). */
export function resolve(v: string, of: number): number {
  if (!LEN.test(v)) throw new Error(`length ${v} is not supported`);
  return v.endsWith('%') ? (parseFloat(v) / 100) * of : parseFloat(v);
}

/** The stops as offsets 0..1 along a gradient line of `len` px: missing places are spread evenly, none goes back. */
export function placeStops(stops: Stop[], len: number): { color: string; at: number }[] {
  const at = stops.map((s) => (s.pos === null ? null : s.unit === '%' ? s.pos / 100 : len > 0 ? s.pos / len : 0));
  if (at[0] === null) at[0] = 0;
  if (at[at.length - 1] === null) at[at.length - 1] = 1;
  let last = -Infinity;
  for (let i = 0; i < at.length; i++) {
    if (at[i] === null) continue;
    at[i] = Math.max(at[i]!, last);
    last = at[i]!;
  }
  for (let i = 1; i < at.length; i++) {
    if (at[i] !== null) continue;
    let j = i;
    while (at[j] === null) j++;
    const a = at[i - 1]!, b = at[j]!;
    for (let k = i; k < j; k++) at[k] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
    i = j;
  }
  return stops.map((s, i) => ({ color: s.color, at: at[i]! }));
}
