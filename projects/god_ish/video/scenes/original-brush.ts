// The copyist's brush (plate 0): a soft round brush on the KanjiVG skeletons of the new script (new-script.ts), in
// their real stroke order. It is not the new script's pen: no serif, no block, no grid in the widths. The brush
// presses in on landing, lifts through the middle of a long stroke, presses again to stop (tome), and runs dry into
// bristle streaks at a sweep (harai) and across the fast middle of some long strokes (kasure).
import { smoothBuffer } from '@pve/engine/stroke';
import { place, skel } from './new-script';

/** Bristles of the dry streaks: offset across the width (-0.5..0.5), arc span, width at the span ends (of w). */
interface Hair {
  o: number;
  a: number;
  b: number;
  k0: number;
  k1: number;
  /** Width k0 at both ends and k1 in the middle (kasure), else k0 to k1 (harai). */
  mid: boolean;
}

/** One brush stroke in canvas px: centre line, normal, width and arc length per sample. */
export interface BStroke {
  x: Float32Array;
  y: Float32Array;
  nx: Float32Array;
  ny: Float32Array;
  w: Float32Array;
  s: Float32Array;
  len: number;
  /** The solid parts, as arc spans. */
  body: [number, number][];
  hairs: Hair[];
  /** The finished stroke: body and hairs in one path (all ribbons wind the same way). */
  full: Path2D;
}

const HAIRS = 5;
const LIFT = 0.3; // pen-up time between strokes, in em of travel

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const sm = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Strokes of one glyph, the box's top left at (ox, oy), `em` px wide. `seed` varies the dry streaks. */
export function brushGlyph(ch: string, ox: number, oy: number, em: number, seed: number, weight = 1): BStroke[] {
  const W = em * 0.09 * weight;
  // the vertical ellipsis: three dots down the centre of the cell
  const lines: { x: number[]; y: number[]; dot: boolean; ring?: boolean; taper: boolean }[] =
    ch === '…'
      ? [0.2, 0.5, 0.8].map((v) => ({ x: [ox + em / 2, ox + em / 2], y: [oy + em * v - em * 0.04, oy + em * v + em * 0.04], dot: true, taper: false }))
      : place(skel(ch), ox, oy, em).map((p, i) => {
          const dot = skel(ch)[i]!.dot;
          // a small closed loop (the handakuten) is a thin even ring, drawn a little larger so it stays open
          const n = p.x.length;
          const ring = p.len < em * 0.6 && Math.hypot(p.x[n - 1]! - p.x[0]!, p.y[n - 1]! - p.y[0]!) < 0.35 * p.len;
          let xs = [...p.x], ys = [...p.y];
          if (ring) {
            const cx = xs.reduce((a, b) => a + b) / n, cy = ys.reduce((a, b) => a + b) / n;
            xs = xs.map((v) => cx + (v - cx) * 1.6 + em * 0.06);
            ys = ys.map((v) => cy + (v - cy) * 1.6 - em * 0.05);
          }
          return { x: xs, y: ys, dot: dot && !ring, ring, taper: p.end === 'taper' };
        });
  return lines.map((l, j) => build(l.x, l.y, l.dot, l.taper, l.ring ? W * 0.45 : W, seed * 31 + j * 7.13, l.ring));
}

function build(xs: number[], ys: number[], dot: boolean, taper: boolean, W: number, seed: number, ring = false): BStroke {
  let n = xs.length;
  if (n < 2) {
    xs = [xs[0]!, xs[0]! + 0.5];
    ys = [ys[0]!, ys[0]! + 0.5];
    n = 2;
  }
  const x = Float32Array.from(xs), y = Float32Array.from(ys);
  const nx = new Float32Array(n), ny = new Float32Array(n), w = new Float32Array(n), s = new Float32Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, y[i]! - y[i - 1]!);
  const len = s[n - 1]! || 1;
  const kw = Math.max(2, Math.round(W / (len / (n - 1))));
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
    const tx = x[b]! - x[a]!, ty = y[b]! - y[a]!, tl = Math.hypot(tx, ty) || 1;
    nx[i] = -ty / tl;
    ny[i] = tx / tl;
    const u = s[i]! / len, rem = len - s[i]!;
    // the round brush is almost even in every direction: horizontals a little thinner
    let v = W * (0.8 + 0.2 * Math.abs(ty / tl));
    if (ring) v = W;
    else if (dot) v = W * (0.5 + 0.95 * Math.sqrt(u));
    else {
      v *= 0.55 + 0.45 * sm(0, 0.9 * W, s[i]!); // landing
      v *= 1 + 0.42 * Math.exp(-(((s[i]! - 1.0 * W) / (0.8 * W)) ** 2)); // the knot after the landing
      v *= 1 - 0.2 * Math.sin(Math.PI * u) ** 2 * Math.min(1, len / (8 * W)); // the lift through the middle
      if (taper) {
        const z = Math.min(0.5 * len, 6 * W);
        if (rem < z) v *= 0.05 + 0.95 * Math.pow(rem / z, 0.6);
      } else v *= 1 + 0.28 * Math.exp(-(((rem - 0.9 * W) / (0.7 * W)) ** 2)); // tome: press to stop
    }
    // a sustained tight curl (a loop, the handakuten) lifts the brush so the counter stays open; a corner does not
    if (!dot && !ring && i >= 2 * kw && i < n - 2 * kw) {
      let turn = Infinity;
      for (const j of [i - kw, i, i + kw]) {
        const ax = x[j]! - x[j - kw]!, ay = y[j]! - y[j - kw]!, bx = x[j + kw]! - x[j]!, by = y[j + kw]! - y[j]!;
        turn = Math.min(turn, Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)));
      }
      const r = (len / (n - 1)) * kw / Math.max(1e-3, turn);
      v *= Math.max(0.55, Math.min(1, r / (1.3 * W)));
    }
    w[i] = v;
  }
  smoothBuffer(w, 3);

  const body: [number, number][] = [];
  const hairs: Hair[] = [];
  const d = 0.45 + 0.55 * hash(seed);
  const off = (k: number) => ((k + 0.5) / HAIRS - 0.5) * 0.92 + (hash(seed + k * 3.7) - 0.5) * 0.05;
  if (!dot && !ring && taper && len > 3 * W) {
    // harai: the brush runs out of ink into the sweep
    const z = Math.min(0.5 * len, 6 * W);
    const a = Math.max(0.25 * len, len - z * (1.2 + 0.6 * d));
    body.push([0, a]);
    for (let k = 0; k < HAIRS; k++) {
      const o = off(k);
      const stop = a + (len - a) * (1 - d * (0.3 + Math.abs(o) * 1.4) * hash(seed + k * 1.9));
      hairs.push({ o, a: a - 0.5 * W, b: stop, k0: 1.5 / HAIRS, k1: (0.75 - 0.3 * d) / HAIRS, mid: false });
    }
  } else if (!dot && !ring && len > 9 * W && hash(seed + 0.5) < 0.5) {
    // kasure: the fast middle of a long stroke goes dry
    const m0 = len * (0.3 + 0.15 * hash(seed + 1.1)), m1 = m0 + len * (0.18 + 0.14 * hash(seed + 2.3));
    body.push([0, m0], [m1, len]);
    for (let k = 0; k < HAIRS; k++) {
      hairs.push({ o: off(k), a: m0 - 0.4 * W, b: m1 + 0.4 * W, k0: 1.5 / HAIRS, k1: (0.65 - 0.25 * d) / HAIRS, mid: true });
    }
  } else body.push([0, len]);

  const st: BStroke = { x, y, nx, ny, w, s, len, body, hairs, full: new Path2D() };
  st.full = strokePath(st, len);
  return st;
}

/** The stroke up to arc length `to`, as one path. */
function strokePath(st: BStroke, to: number): Path2D {
  const p = new Path2D();
  for (const [a, b] of st.body) if (a < to) ribbon(p, st, a, Math.min(b, to), () => 0, (i) => st.w[i]! / 2);
  for (const h of st.hairs) {
    if (h.a >= to) continue;
    const span = h.b - h.a || 1;
    ribbon(p, st, h.a, Math.min(h.b, to), (i) => h.o * st.w[i]!, (i) => {
      const u = Math.max(0, Math.min(1, (st.s[i]! - h.a) / span));
      const k = h.mid ? h.k0 + (h.k1 - h.k0) * Math.sin(Math.PI * u) : h.k0 + (h.k1 - h.k0) * u;
      return (k * st.w[i]!) / 2;
    });
  }
  return p;
}

/** A ribbon along the centre line over the arc span a..b, offset across the normal, with round caps. */
function ribbon(p: Path2D, st: BStroke, a: number, b: number, off: (i: number) => number, half: (i: number) => number) {
  const n = st.x.length;
  let i0 = 0;
  while (i0 < n - 1 && st.s[i0]! < a) i0++;
  let i1 = i0;
  while (i1 < n - 1 && st.s[i1 + 1]! <= b) i1++;
  const cx = (i: number) => st.x[i]! + st.nx[i]! * off(i), cy = (i: number) => st.y[i]! + st.ny[i]! * off(i);
  p.moveTo(cx(i0) + st.nx[i0]! * half(i0), cy(i0) + st.ny[i0]! * half(i0));
  for (let i = i0 + 1; i <= i1; i++) p.lineTo(cx(i) + st.nx[i]! * half(i), cy(i) + st.ny[i]! * half(i));
  cap(p, cx(i1), cy(i1), st.nx[i1]!, st.ny[i1]!, half(i1), 1);
  for (let i = i1; i >= i0; i--) p.lineTo(cx(i) - st.nx[i]! * half(i), cy(i) - st.ny[i]! * half(i));
  cap(p, cx(i0), cy(i0), st.nx[i0]!, st.ny[i0]!, half(i0), -1);
  p.closePath();
}

/** A half circle from +n to -n through the forward tangent (dir 1) or from -n to +n through the back (dir -1). */
function cap(p: Path2D, x: number, y: number, nx: number, ny: number, h: number, dir: 1 | -1) {
  const tx = ny, ty = -nx; // the forward tangent (n is the tangent turned to the left)
  for (let k = 1; k < 6; k++) {
    const a = (Math.PI * k) / 6, cs = Math.cos(a) * dir, sn = Math.sin(a) * dir;
    p.lineTo(x + (nx * cs + tx * sn) * h, y + (ny * cs + ty * sn) * h);
  }
}

/** One stroke written up to `frac` of its length; an unfinished stroke ends in the wet round tip. */
function drawBrush(c: CanvasRenderingContext2D, st: BStroke, frac: number) {
  if (frac <= 0) return;
  if (frac >= 1) {
    c.fill(st.full);
    return;
  }
  const to = frac * st.len;
  c.fill(strokePath(st, to));
  let m = 0;
  while (m < st.x.length - 1 && st.s[m + 1]! <= to) m++;
  c.beginPath();
  c.arc(st.x[m]!, st.y[m]!, st.w[m]! * 0.55, 0, Math.PI * 2);
  c.fill();
}

/** Write strokes in order to progress p (0..1 of the writing time), time in proportion to length, lifts between. */
export function writeBrush(c: CanvasRenderingContext2D, strokes: BStroke[], p: number, em: number) {
  if (p >= 1) {
    for (const st of strokes) c.fill(st.full);
    return;
  }
  let total = 0;
  for (const st of strokes) total += st.len + LIFT * em;
  let at = p * total;
  for (const st of strokes) {
    at -= LIFT * em;
    if (at <= 0) return;
    drawBrush(c, st, at / st.len);
    at -= st.len;
  }
}
