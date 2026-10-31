// The new script (treatment.md, Fonts): the one face god_ish builds. Each glyph is a stroke skeleton from KanjiVG
// (Ulrich Apel, CC BY-SA 3.0, video/assets/kanjivg), written in its real stroke order by a procedural pen that takes
// one trait from each era: the brush entry and exit of the manuscript, the bracketed serif of the press, joints
// snapped to the modernist grid, the square block terminal of the JPEG. No era had all four.
// Skeletons live in the KanjiVG box (109 units, y down). Placed strokes are in canvas px.
import { parseSvgPathD as parseD, polylineArcLength as arcLen, resamplePolyline as resample, smoothBuffer } from '@pve/engine/stroke';

export type P = [number, number];
export type End = 'serif' | 'block' | 'taper' | 'flat';

/** One stroke of a glyph in the KanjiVG box: snapped and resampled centre line, its snapped joint indices, terminal, whether it is a dot. */
export interface Skel {
  pts: P[];
  joints: P[];
  end: End;
  dot: boolean;
}

/** One stroke placed on the page: centre line, width and arc length per sample, and the finished outline. */
export interface PStroke {
  x: Float32Array;
  y: Float32Array;
  w: Float32Array;
  s: Float32Array;
  len: number;
  end: End;
  /** The skeleton stroke it was cut from (the constructed hand splits a stroke where it passes under another). */
  of?: number;
  /** A flat perpendicular cut at the start (the constructed hand); else the slanted brush cut. */
  square?: boolean;
  /** The finished stroke: body and terminal, filled one by one (their windings differ). */
  full: Path2D[];
}

const BOX = 109;
const GRID = BOX / 12; // the modernist grid the joints snap toward
const SNAP = 0.85; // how far a joint moves toward its grid node
const STEP = 0.8; // resampling step in box units
const SMALL = new Set([...'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ']);

// ---------- KanjiVG ----------
const SKEL = new Map<string, Skel[]>();
const RAW = new Map<string, P[][]>();
const loading = new Map<string, Promise<void>>();

/** Fetch and build the skeletons of `chars` from `assets/kanjivg/<hex>.svg` (cached across scenes). */
export function loadScript(assets: string, chars: string): Promise<void[]> {
  return Promise.all(
    [...new Set(chars)].map((ch) => {
      let p = loading.get(ch);
      if (!p) {
        const hex = ch.codePointAt(0)!.toString(16).padStart(5, '0');
        p = fetch(`${assets}kanjivg/${hex}.svg`)
          .then((r) => {
            if (!r.ok) throw new Error(`kanjivg/${hex}.svg (${ch}): HTTP ${r.status}`);
            return r.text();
          })
          .then((svg) => {
            // stroke paths in document order are the stroke order (kvg:...-s1, -s2, ...)
            const ds = [...svg.matchAll(/<path\b[^>]*?\sd="([^"]+)"/g)].map((m) => m[1]!);
            if (!ds.length) throw new Error(`kanjivg/${hex}.svg (${ch}): no strokes`);
            let raw = ds.map(parseD);
            if (SMALL.has(ch)) raw = smallKana(raw);
            RAW.set(ch, raw);
            SKEL.set(ch, raw.map(build));
          });
        loading.set(ch, p);
      }
      return p;
    }),
  );
}

/** The skeleton of a glyph (after loadScript). Vertical corner brackets ﹁ ﹂ are built here, half a box high. */
export function skel(ch: string): Skel[] {
  if (ch === '「') return BRACKET_OPEN;
  if (ch === '」') return BRACKET_CLOSE;
  const s = SKEL.get(ch);
  if (!s) throw new Error(`new script: no skeleton for ${ch} (loadScript first)`);
  return s;
}
/** The raw KanjiVG strokes of a glyph (after loadScript), box units, y down. */
export function rawOf(ch: string): P[][] {
  const s = RAW.get(ch);
  if (!s) throw new Error(`new script: no strokes for ${ch} (loadScript first)`);
  return s;
}
const SMALL_KANA = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ';
/** Advance of a glyph in em: brackets take half a cell, small kana pull the next glyph up closer. */
export const advance = (ch: string) => (ch === '「' || ch === '」' ? 0.5 : SMALL_KANA.includes(ch) ? 0.68 : 1);

/** Small kana in vertical setting sit high and right, a little smaller. */
function smallKana(strokes: P[][]): P[][] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, k = 0.8;
  return strokes.map((s) => s.map(([x, y]): P => [64 + (x - mx) * k, 42 + (y - my) * k]));
}

/** Snap the joints (ends and sharp corners) toward the grid, classify the terminal, resample. */
function build(raw: P[]): Skel {
  let pts = resample(raw, STEP);
  const len = arcLen(pts);
  const n = pts.length;
  // joints: the start, the end, and corners (local maxima of turn over ±3 units)
  const k = Math.max(1, Math.round(3 / STEP));
  const keys: number[] = [0];
  let best = -1, bestA = 0;
  for (let i = k; i < n - k; i++) {
    const a = turn(pts[i - k]!, pts[i]!, pts[i + k]!);
    if (a > 0.65 && a > bestA) { best = i; bestA = a; }
    if ((a <= 0.65 || i === n - k - 1) && best >= 0) {
      if (best - keys[keys.length - 1]! > 2 * k) keys.push(best);
      best = -1; bestA = 0;
    }
  }
  if (n - 1 - keys[keys.length - 1]! > k || keys.length === 1) keys.push(n - 1);
  else keys[keys.length - 1] = n - 1;
  const short = len < 2.2 * GRID;
  const disp: P[] = keys.map((ki, j) => {
    const [x, y] = pts[ki]!;
    // a short stroke snaps its start only, so a dot never collapses onto one node
    const s = short && j > 0 ? 0 : SNAP;
    return [(Math.round(x / GRID) * GRID - x) * s, (Math.round(y / GRID) * GRID - y) * s];
  });
  const joints: P[] = keys.map((ki, j) => [pts[ki]![0] + disp[j]![0], pts[ki]![1] + disp[j]![1]]);
  // move every point by the displacement of its joints, and straighten 28% toward the chord between joints
  pts = pts.map(([x, y], i): P => {
    let j = 0;
    while (j < keys.length - 2 && keys[j + 1]! < i) j++;
    const a = keys[j]!, b = keys[j + 1] ?? a;
    const t = b > a ? Math.min(1, Math.max(0, (i - a) / (b - a))) : 0;
    const da = disp[j]!, db = disp[j + 1] ?? da;
    const sx = x + da[0] + (db[0] - da[0]) * t;
    const sy = y + da[1] + (db[1] - da[1]) * t;
    const ja = joints[j]!, jb = joints[j + 1] ?? ja;
    const cx = ja[0] + (jb[0] - ja[0]) * t;
    const cy = ja[1] + (jb[1] - ja[1]) * t;
    return [sx + (cx - sx) * 0.28, sy + (cy - sy) * 0.28];
  });
  pts = resample(pts, STEP);
  // the terminal from the last 5 units of direction
  const m = pts.length - 1, back = Math.min(m, Math.round(5 / STEP));
  const ex = pts[m]![0] - pts[m - back]![0], ey = pts[m]![1] - pts[m - back]![1], el = Math.hypot(ex, ey) || 1;
  const dx = ex / el, dy = ey / el;
  const dot = len < 16;
  const end: End = dot || dy > 0.78 ? 'block' : dx > 0.76 ? 'serif' : 'taper';
  return { pts, joints, end, dot };
}

function turn(a: P, b: P, c: P): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
  return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
}

/** ﹁ and ﹂: the vertical corner brackets, in a box 109 wide and 54.5 high. */
const BRACKET_OPEN: Skel[] = [build([[34, 22], [82, 22], [82, 52]])];
const BRACKET_CLOSE: Skel[] = [build([[27, 2], [27, 32], [75, 32]])];

// ---------- the pen ----------
const sm = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Place the strokes of a glyph with the box's top left at (ox, oy), the box `em` px wide. `weight` scales the pen.
 * Widths: the press contrast (verticals full, horizontals thin), the brush landing (a knot after a slanted cut),
 * the brush lifting (harai tapers to a point).
 */
export function place(sk: Skel[], ox: number, oy: number, em: number, weight = 1): PStroke[] {
  const k = em / BOX;
  const wv = em * 0.08 * weight, wh = wv * 0.34;
  return sk.map((st) => {
    const n = st.pts.length;
    const x = new Float32Array(n), y = new Float32Array(n), w = new Float32Array(n), s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = ox + st.pts[i]![0] * k;
      y[i] = oy + st.pts[i]![1] * k;
      if (i) s[i] = s[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, y[i]! - y[i - 1]!);
    }
    const len = s[n - 1]!;
    for (let i = 0; i < n; i++) {
      const [tx, ty] = tangent(x, y, i);
      w[i] = st.dot ? wv * (0.55 + 0.75 * (s[i]! / (len || 1))) : wh + (wv - wh) * Math.abs(ty) * (0.85 + 0.15 * Math.abs(tx));
    }
    // the brush does not jump: smooth the width along the stroke
    smoothBuffer(w, 4);
    if (!st.dot) {
      const z = Math.min(0.45 * len, 5 * wv);
      for (let i = 0; i < n; i++) {
        const si = s[i]!;
        // landing: a knot just after the cut
        w[i]! *= (0.68 + 0.32 * sm(0, 0.7 * wv, si)) * (1 + 0.42 * Math.exp(-(((si - 0.85 * wv) / (0.75 * wv)) ** 2)));
        if (st.end === 'taper' && si > len - z) w[i]! *= 0.06 + 0.94 * Math.pow((len - si) / z, 0.72);
      }
    }
    const ps: PStroke = { x, y, w, s, len, end: st.end, full: [] };
    ps.full = [body(ps, n - 1), terminal(ps)].filter((p): p is Path2D => !!p);
    return ps;
  });
}

function tangent(x: Float32Array, y: Float32Array, i: number): [number, number] {
  const n = x.length, a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
  const dx = x[b]! - x[a]!, dy = y[b]! - y[a]!, l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

/** The outline of samples i0..m: both edges, with the slanted cut of a brush landing from the upper left at i0 = 0. */
export function body(st: PStroke, m: number, i0 = 0, brush = true): Path2D {
  const { x, y, w } = st;
  const L: P[] = [], R: P[] = [];
  for (let i = i0; i <= m; i++) {
    const [tx, ty] = tangent(x, y, i);
    const nx = -ty, ny = tx, h = w[i]! / 2;
    L.push([x[i]! + nx * h, y[i]! + ny * h]);
    R.push([x[i]! - nx * h, y[i]! - ny * h]);
  }
  if (brush && i0 === 0 && m >= 1) {
    // the cut: the edge toward the lower right starts later
    const [tx, ty] = tangent(x, y, 0);
    const lowerIsL = -ty + tx > 0;
    const sh = 0.55 * w[0]!;
    const e = lowerIsL ? L[0]! : R[0]!;
    e[0] += tx * sh;
    e[1] += ty * sh;
  }
  const n = L.length;
  const p = new Path2D();
  p.moveTo(L[0]![0], L[0]![1]);
  for (let i = 1; i < n; i++) p.lineTo(L[i]![0], L[i]![1]);
  for (let i = n - 1; i >= 0; i--) p.lineTo(R[i]![0], R[i]![1]);
  p.closePath();
  return p;
}

/** The outline of the stroke body between samples i0 and i1 (a shard of it). */
export const segment = (st: PStroke, i0: number, i1: number) => body(st, i1, i0, !st.square);

/** The terminal: a bracketed serif on a horizontal (press), a square block on a vertical or a dot (JPEG). */
function terminal(st: PStroke): Path2D | null {
  const n = st.x.length - 1;
  const ex = st.x[n]!, ey = st.y[n]!, w = st.w[n]!;
  const [tx, ty] = tangent(st.x, st.y, n);
  if (st.end === 'block') {
    const side = Math.max(1.52 * w, 4);
    const cx = ex + tx * 0.32 * w, cy = ey + ty * 0.32 * w;
    const p = new Path2D();
    p.rect(Math.round(cx - side / 2), Math.round(cy - side / 2), Math.round(side), Math.round(side));
    return p;
  }
  if (st.end === 'serif') {
    // up: the normal that points up the page (uroko triangle bracket of movable Mincho type)
    let ux = -ty, uy = tx;
    if (uy > 0) { ux = -ux; uy = -uy; }
    const at = (a: number, b: number): P => [ex + tx * a * w + ux * b * w, ey + ty * a * w + uy * b * w];
    const A = at(-3.2, 0.45), C = at(-1.05, 0.52), T = at(-0.22, 1.92), B = at(0.65, -0.05), D = at(0.38, -0.52), E = at(-0.7, -0.52);
    const p = new Path2D();
    p.moveTo(A[0], A[1]);
    p.quadraticCurveTo(C[0], C[1], T[0], T[1]);
    p.lineTo(B[0], B[1]);
    p.lineTo(D[0], D[1]);
    p.lineTo(E[0], E[1]);
    p.closePath();
    return p;
  }
  return null;
}

/** Fill one stroke written up to `frac` (0..1 of its length). An unfinished stroke ends in the round brush tip. */
export function drawStroke(c: CanvasRenderingContext2D, st: PStroke, frac: number) {
  if (frac <= 0) return;
  if (frac >= 1) {
    for (const p of st.full) c.fill(p);
    return;
  }
  const target = frac * st.len;
  let m = 0;
  while (m < st.x.length - 1 && st.s[m + 1]! <= target) m++;
  if (m >= 1) c.fill(body(st, m, 0, !st.square));
  const tip = new Path2D();
  tip.arc(st.x[m]!, st.y[m]!, st.w[m]! / 2, 0, Math.PI * 2);
  c.fill(tip);
}

/** Pen-up time between strokes, in px of travel. */
const LIFT = 0.35;

/**
 * Where each stroke is written, as [start, end] fractions of the writing time. Each stroke takes time in
 * proportion to its length, with a pen lift before it. A node (a stroke shorter than half a pixel) takes no time.
 */
export function strokeSpans(strokes: PStroke[], em: number): [number, number][] {
  const lift = (st: PStroke) => (st.len < 0.5 ? 0 : LIFT * em);
  let total = 0;
  for (const st of strokes) total += st.len + lift(st);
  let at = 0;
  return strokes.map((st): [number, number] => {
    at += lift(st);
    const a = at / total;
    at += st.len;
    return [a, at / total];
  });
}

/** Write strokes in order to progress p (0..1 of the writing time). */
export function writeStrokes(c: CanvasRenderingContext2D, strokes: PStroke[], p: number, em: number) {
  if (p >= 1) {
    for (const st of strokes) for (const q of st.full) c.fill(q);
    return;
  }
  const sp = strokeSpans(strokes, em);
  strokes.forEach((st, k) => {
    const [a, b] = sp[k]!;
    if (p > a) drawStroke(c, st, (p - a) / (b - a));
  });
}
