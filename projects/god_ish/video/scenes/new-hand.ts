// The new script's hand: a drawing system, not a pen. Every glyph is its KanjiVG skeleton (so it reads) redrawn with
// one kit. Straight strokes: segments on the eight compass directions, vertices on a grid. Curved strokes (kana
// loops, hooks): traced step by step on the compass, staircases merged into one diagonal run, then annealed (seeded,
// so a glyph always comes out the same) toward the fewest runs that still follow the stroke, with no hairpins and no
// loops the stroke does not have. Corners are sharp, the nib is one width, cuts are square. Parallel strokes the
// skeleton keeps a hair apart are pushed apart so they do not print as one. Each stroke starts on a disc (the
// pen-down), ends on a small disc, and sharp hooks carry a ring: the skeleton that survived every copy.
import { polylineArcLength as arcLen, resamplePolyline as resample } from '@pve/engine/stroke';
import { body, rawOf, type P, type PStroke, type Skel } from './new-script';

const BOX = 109;
const STEP = 0.8;
/** Vertex grid, box units. */
const GRID = BOX / 36;
/** How far a straight stroke may stray from its vertices, box units. */
const EPS = 3.2;
/** Nib width, em. */
const NIB = 0.05;
/** A stroke that turns more than this in all (degrees) is a curve. */
const CURVED = 100;
/** The compass step of a traced curve, in grid units; staircases of this many segments or more are merged. */
const TRACE_STEP = 2;
const STAIRS = 3;
/** Annealing steps per curve, and the price of each extra vertex in box units of error. */
const ANNEAL = 900;
const RUN_COST = 0.8;
/** Parallel strokes closer than this (nibs) are pushed apart. */
const MIN_GAP = 1.5;
/** Node diameters (nibs): pen-down, end, ring on a corner sharper than CORNER_MIN degrees; no two closer than NODE_SPACING nibs. */
const START_NODE = 2.8;
const END_NODE = 1.6;
const CORNER_NODE = 3.8;
const CORNER_MIN = 100;
const NODE_SPACING = 6.2;

const DIR: P[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

const snap = (v: number) => Math.round(v / GRID) * GRID;

const dirOf = (a: P, b: P) => {
  const sx = Math.abs(b[0] - a[0]) < 1e-6 ? 0 : Math.sign(b[0] - a[0]), sy = Math.abs(b[1] - a[1]) < 1e-6 ? 0 : Math.sign(b[1] - a[1]);
  return DIR.findIndex(([x, y]) => x === sx && y === sy);
};

const turnDeg = (a: P, b: P, c: P) =>
  Math.abs((Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])) * 180) / Math.PI);

/** Total turning of a polyline in degrees, measured over 3 unit chords. */
function turning(pts: P[]): number {
  let sum = 0;
  for (let i = 6; i < pts.length; i += 3) sum += turnDeg(pts[i - 6]!, pts[i - 3]!, pts[i]!);
  return sum;
}

function segHit(a: P, b: P, c: P, d: P): boolean {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// ---------- straight strokes ----------
function rdp(pts: P[], eps: number): P[] {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a]!, [bx, by] = pts[b]!;
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
    let worst = -1, wd = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i]![0] - ax) * dy - (pts[i]![1] - ay) * dx) / l;
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Turn a polyline into segments on the eight compass directions, every vertex on the grid. */
function octilinear(v: P[]): P[] {
  const out: P[] = [[snap(v[0]![0]), snap(v[0]![1])]];
  for (let i = 1; i < v.length; i++) {
    const [px, py] = out[out.length - 1]!;
    const dx = v[i]![0] - px, dy = v[i]![1] - py;
    const q = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
    const ux = Math.cos((q * Math.PI) / 4), uy = Math.sin((q * Math.PI) / 4);
    const unit = q % 2 !== 0 ? GRID * Math.SQRT2 : GRID;
    const n = Math.max(1, Math.round(Math.max(0, dx * ux + dy * uy) / unit));
    out.push([px + Math.round(ux) * GRID * n, py + Math.round(uy) * GRID * n]);
  }
  return out;
}

function straight(pts: P[]): P[] {
  let v = octilinear(rdp(pts, EPS));
  v = v.filter((p, i) => i === 0 || p[0] !== v[i - 1]![0] || p[1] !== v[i - 1]![1]);
  // a segment shorter than two grid steps is a stub: drop its inner vertex (never an end)
  for (let again = true; again && v.length > 2;) {
    again = false;
    for (let i = 1; i < v.length; i++) {
      if (Math.hypot(v[i]![0] - v[i - 1]![0], v[i]![1] - v[i - 1]![1]) >= 2 * GRID) continue;
      v.splice(i === v.length - 1 ? i - 1 : i, 1);
      again = true;
      break;
    }
  }
  if (v.length < 2) v = [[snap(pts[0]![0]), snap(pts[0]![1])], [snap(pts[pts.length - 1]![0]) + GRID, snap(pts[pts.length - 1]![1])]];
  return v;
}

// ---------- curves ----------
/**
 * Follow a curve with steps on the eight compass directions: from the last vertex take the step that lands nearest the
 * curve a little ahead, with a slight preference for going on the same way. The vertices are where the direction
 * changes. A loop comes out as an octagon.
 */
function trace(pts: P[], step: number): P[] {
  const last = pts.length - 1;
  let p: P = [snap(pts[0]![0]), snap(pts[0]![1])];
  const v: P[] = [p];
  let prev = -1, idx = 0;
  for (let guard = 0; guard < 400; guard++) {
    let bd = Infinity;
    for (let i = idx; i <= Math.min(last, idx + Math.round(2.5 * step) + 12); i++) {
      const d = Math.hypot(pts[i]![0] - p[0], pts[i]![1] - p[1]);
      if (d < bd) { bd = d; idx = i; }
    }
    if (last - idx < step * 0.7) break;
    const tgt = pts[Math.min(last, idx + Math.round(step * 1.2))]!;
    let bestD = 0, best = Infinity;
    DIR.forEach(([dx, dy], d) => {
      const c = Math.hypot(p[0] + dx! * step - tgt[0], p[1] + dy! * step - tgt[1]) + (prev >= 0 && d !== prev ? 0.3 * step : 0);
      if (c < best) { best = c; bestD = d; }
    });
    p = [p[0] + DIR[bestD]![0] * step, p[1] + DIR[bestD]![1] * step];
    if (bestD !== prev) v.push(p);
    else v[v.length - 1] = p;
    prev = bestD;
  }
  return v;
}

/**
 * A staircase (runs of one or two steps that alternate between two neighbouring directions) is one straight run and
 * one diagonal run between the same two points: the diagonal first or last, whichever lies nearer the steps.
 */
function unstair(v: P[], step: number): P[] {
  if (v.length < STAIRS + 1) return v;
  const dirs: number[] = [], len: number[] = [];
  for (let i = 1; i < v.length; i++) {
    dirs.push(dirOf(v[i - 1]!, v[i]!));
    len.push(Math.hypot(v[i]![0] - v[i - 1]![0], v[i]![1] - v[i - 1]![1]));
  }
  const short = (k: number) => len[k]! <= 3.2 * step * (dirs[k]! % 2 ? Math.SQRT2 : 1);
  const out: P[] = [v[0]!];
  let i = 0;
  while (i < dirs.length) {
    let j = i;
    const used = new Set([dirs[i]!]);
    while (short(i) && j + 1 < dirs.length && short(j + 1)) {
      const next = new Set([...used, dirs[j + 1]!]);
      const [a, b] = [...next];
      if (next.size > 2 || (next.size === 2 && Math.abs(a! - b!) % 8 !== 1 && Math.abs(a! - b!) % 8 !== 7)) break;
      used.add(dirs[j + 1]!);
      j++;
    }
    if (used.size === 2 && j - i + 1 >= STAIRS) {
      const [axisD, diagD] = [...used].sort((p, q) => (p % 2) - (q % 2)) as [number, number];
      const ax = DIR[axisD]!, dg = DIR[diagD]!;
      const s = v[i]!, e = v[j + 1]!;
      const tx = (e[0] - s[0]) / step, ty = (e[1] - s[1]) / step;
      const det = ax[0] * dg[1] - ax[1] * dg[0];
      const nA = Math.round((tx * dg[1] - ty * dg[0]) / det), nD = Math.round((ax[0] * ty - ax[1] * tx) / det);
      let mx = 0, my = 0;
      for (let k = i + 1; k <= j; k++) { mx += v[k]![0]; my += v[k]![1]; }
      mx /= j - i; my /= j - i;
      const m1: P = [s[0] + ax[0] * nA * step, s[1] + ax[1] * nA * step], m2: P = [s[0] + dg[0] * nD * step, s[1] + dg[1] * nD * step];
      out.push(Math.hypot(m1[0] - mx, m1[1] - my) <= Math.hypot(m2[0] - mx, m2[1] - my) ? m1 : m2, e);
      i = j + 1;
    } else {
      out.push(v[i + 1]!);
      i++;
    }
  }
  // neighbouring runs that now go the same way are one run
  return out.filter((p, k) => k === 0 || k === out.length - 1 || dirOf(out[k - 1]!, p) !== dirOf(p, out[k + 1]!));
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The vertices of a chain code of steps of `q` from `s`: where the direction changes, and the end. */
function chainVerts(chain: number[], s: P, q: number): P[] {
  const v: P[] = [s];
  let p = s;
  chain.forEach((d, i) => {
    p = [p[0] + DIR[d]![0] * q, p[1] + DIR[d]![1] * q];
    if (i === chain.length - 1 || chain[i + 1] !== d) v.push(p);
  });
  return v;
}

/** Points along a polyline every `gap` units. */
function along(v: P[], gap: number): P[] {
  const out: P[] = [v[0]!];
  let carry = 0;
  for (let i = 1; i < v.length; i++) {
    const [ax, ay] = v[i - 1]!, [bx, by] = v[i]!, l = Math.hypot(bx - ax, by - ay);
    for (let s = gap - carry; s <= l; s += gap) out.push([ax + ((bx - ax) * s) / l, ay + ((by - ay) * s) / l]);
    carry = (carry + l) % gap;
  }
  out.push(v[v.length - 1]!);
  return out;
}

function selfCrossings(v: P[]): number {
  let n = 0;
  for (let j = 3; j < v.length; j++) for (let i = 1; i < j - 1; i++) if (segHit(v[i - 1]!, v[i]!, v[j - 1]!, v[j]!)) n++;
  return n;
}

/**
 * Anneal the chain code of a traced curve. A move keeps both ends where they are: swap two neighbouring steps, turn
 * two perpendicular axis steps into one diagonal step or back, turn two diagonals into two axis steps or back.
 * Cost: how far the path is from the curve (both ways), a price per vertex, hairpins, loops the curve does not
 * have, and runs that double back alongside themselves.
 */
function anneal(orig: P[], v: P[], q: number, seed: number): P[] {
  const gap = 1.5 * NIB * BOX;
  const chain: number[] = [];
  for (let i = 1; i < v.length; i++) {
    const d = dirOf(v[i - 1]!, v[i]!);
    const n = Math.round(Math.hypot(v[i]![0] - v[i - 1]![0], v[i]![1] - v[i - 1]![1]) / (q * (d % 2 ? Math.SQRT2 : 1)));
    for (let k = 0; k < n; k++) chain.push(d);
  }
  const start = v[0]!;
  const O = along(orig, 2.5);
  const origCross = selfCrossings(O);
  const cost = (c: number[]) => {
    const pv = chainVerts(c, start, q);
    const S = along(pv, 4);
    let a = 0, b = 0;
    for (const s of S) { let m = Infinity; for (const o of O) m = Math.min(m, (s[0] - o[0]) ** 2 + (s[1] - o[1]) ** 2); a += Math.sqrt(m); }
    for (const o of O) { let m = Infinity; for (const s of S) m = Math.min(m, (s[0] - o[0]) ** 2 + (s[1] - o[1]) ** 2); b += Math.sqrt(m); }
    let e = a / S.length + b / O.length + RUN_COST * Math.max(0, pv.length - 2);
    for (let i = 1; i < pv.length - 1; i++) if (turnDeg(pv[i - 1]!, pv[i]!, pv[i + 1]!) >= 135) e += 3;
    e += 4 * Math.max(0, selfCrossings(pv) - origCross);
    for (let i = 1; i < pv.length; i++) {
      const [ax, ay] = pv[i - 1]!, [bx, by] = pv[i]!, L = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / L, uy = (by - ay) / L;
      for (let j = i + 2; j < pv.length; j++) {
        const [cx, cy] = pv[j - 1]!, [dx, dy] = pv[j]!, M = Math.hypot(dx - cx, dy - cy);
        if (Math.abs(ux * (dy - cy) - uy * (dx - cx)) / M > 0.2) continue;
        const d = Math.abs((cx - ax) * -uy + (cy - ay) * ux);
        const p0 = (cx - ax) * ux + (cy - ay) * uy, p1 = (dx - ax) * ux + (dy - ay) * uy;
        const ov = Math.min(L, Math.max(p0, p1)) - Math.max(0, Math.min(p0, p1));
        if (d < gap && ov > 3) e += (gap - d) * ov * 0.12;
      }
    }
    return e;
  };
  const rand = rng(seed);
  let cur = chain, ce = cost(cur), best = cur, be = ce;
  for (let it = 0; it < ANNEAL; it++) {
    const T = 0.6 * Math.pow(0.02 / 0.6, it / ANNEAL);
    const n = cur.length;
    if (n < 2) break;
    const i = Math.floor(rand() * (n - 1));
    const a = cur[i]!, b = cur[i + 1]!, kind = Math.floor(rand() * 4);
    let rep: number[] | null = null;
    const gapDir = (b - a + 8) % 8;
    if (kind === 0 && a !== b) rep = [b, a];
    else if (kind === 1 && a % 2 === 0 && b % 2 === 0 && (gapDir === 2 || gapDir === 6)) rep = [gapDir === 2 ? (a + 1) % 8 : (b + 1) % 8];
    else if (kind === 2 && a % 2 === 1) rep = rand() < 0.5 ? [(a + 7) % 8, (a + 1) % 8] : [(a + 1) % 8, (a + 7) % 8];
    else if (kind === 3 && a % 2 === 1 && b % 2 === 1 && (gapDir === 2 || gapDir === 6)) rep = [gapDir === 2 ? (a + 1) % 8 : (b + 1) % 8, gapDir === 2 ? (a + 1) % 8 : (b + 1) % 8];
    else if (kind === 3 && a === b && a % 2 === 0) rep = rand() < 0.5 ? [(a + 7) % 8, (a + 1) % 8] : [(a + 1) % 8, (a + 7) % 8];
    if (!rep) continue;
    const next = [...cur.slice(0, i), ...rep, ...cur.slice(i + 2)];
    const ne = cost(next);
    if (ne < ce || rand() < Math.exp((ce - ne) / T)) {
      cur = next;
      ce = ne;
      if (ce < be) { best = cur; be = ce; }
    }
  }
  return chainVerts(best, start, q);
}

// ---------- the glyphs ----------
function build(raw: P[], seed: number): Skel {
  const pts = resample(raw, 1);
  if (arcLen(pts) < 16) {
    // a dot is a short dash on the diagonal (or the vertical), a fixed length
    const [x0, y0] = pts[0]!, [x1, y1] = pts[pts.length - 1]!;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const dx = x1 - x0, dy = y1 - y0;
    const q = Math.round(Math.atan2(Math.abs(dy) < 1 && Math.abs(dx) < 1 ? 1 : dy, dx) / (Math.PI / 4));
    const ux = Math.cos((q * Math.PI) / 4), uy = Math.sin((q * Math.PI) / 4), half = 4.5;
    const a: P = [cx - ux * half, cy - uy * half], b: P = [cx + ux * half, cy + uy * half];
    return { pts: resample([a, b], STEP), joints: [a, b], end: 'flat', dot: true };
  }
  let v: P[];
  if (turning(pts) >= CURVED) {
    const q = TRACE_STEP * GRID;
    v = anneal(pts, unstair(trace(pts, q), q), q, seed);
  } else v = straight(pts);
  return { pts: resample(v, STEP), joints: v, end: 'flat', dot: false };
}

/**
 * Where a stroke runs alongside an earlier one closer than MIN_GAP nibs, move it away (at most two grid steps a
 * pass), then put its lines back on the compass. Two strokes that the skeleton keeps a hair apart no longer print
 * as one fat stroke.
 */
function spread(sk: Skel[]) {
  const gap = MIN_GAP * NIB * BOX;
  const vs = sk.map((s) => s.joints.map(([x, y]): P => [x, y]));
  const moved = new Set<number>();
  for (let pass = 0; pass < 4; pass++) {
    for (let j = 1; j < vs.length; j++) {
      if (sk[j]!.dot) continue;
      for (let i = 0; i < j; i++) {
        if (sk[i]!.dot) continue;
        const A = vs[i]!, B = vs[j]!;
        for (let a = 1; a < A.length; a++) {
          const [ax, ay] = A[a - 1]!, [bx, by] = A[a]!;
          const ux = bx - ax, uy = by - ay, L = Math.hypot(ux, uy);
          if (L < GRID) continue;
          const nx = -uy / L, ny = ux / L;
          for (let b = 1; b < B.length; b++) {
            const [cx, cy] = B[b - 1]!, [dx, dy] = B[b]!;
            const vx = dx - cx, vy = dy - cy, M = Math.hypot(vx, vy);
            if (M < GRID || Math.abs(ux * vy - uy * vx) / (L * M) > 0.3) continue;
            const sc = (cx - ax) * nx + (cy - ay) * ny, sd = (dx - ax) * nx + (dy - ay) * ny;
            const s = (sc + sd) / 2;
            if (Math.abs(s) >= gap) continue;
            const pc = ((cx - ax) * ux + (cy - ay) * uy) / L, pd = ((dx - ax) * ux + (dy - ay) * uy) / L;
            if (Math.min(L, Math.max(pc, pd)) - Math.max(0, Math.min(pc, pd)) < 4) continue;
            let side = Math.sign(s);
            if (Math.abs(s) < 0.5) {
              let rest = 0;
              for (const [qx, qy] of B) rest += (qx - ax) * nx + (qy - ay) * ny;
              side = rest >= 0 ? 1 : -1;
            }
            const push = Math.min(gap - Math.abs(s), 2 * GRID);
            B[b - 1] = [cx + nx * side * push, cy + ny * side * push];
            B[b] = [dx + nx * side * push, dy + ny * side * push];
            moved.add(j);
          }
        }
      }
    }
  }
  for (const j of moved) {
    const v = octilinear(vs[j]!);
    sk[j]!.joints = v;
    sk[j]!.pts = resample(v, STEP);
  }
}

const SK = new Map<string, Skel[]>();
/** ﹁ and ﹂: the vertical corner brackets, half a box high. */
const BRACKETS: Record<string, P[]> = { '「': [[34, 22], [82, 22], [82, 52]], '」': [[27, 2], [27, 32], [75, 32]] };

/** The constructed skeleton of a glyph (after loadScript). */
export function constructed(ch: string): Skel[] {
  let sk = SK.get(ch);
  if (!sk) {
    sk = (BRACKETS[ch] ? [BRACKETS[ch]!] : rawOf(ch)).map((r, i) => build(r, ch.codePointAt(0)! * 131 + i * 17));
    spread(sk);
    SK.set(ch, sk);
  }
  return sk;
}

/** A node: a disc or a ring that writes in one step. */
function node(cx: number, cy: number, d: number, ring: number, of: number): PStroke {
  const p = new Path2D();
  p.arc(cx, cy, d / 2, 0, Math.PI * 2);
  if (ring > 0) {
    p.moveTo(cx + d / 2 - ring, cy);
    p.arc(cx, cy, d / 2 - ring, 0, Math.PI * 2, true);
  }
  return { x: new Float32Array([cx, cx + 0.01]), y: new Float32Array([cy, cy]), w: new Float32Array([d, d]), s: new Float32Array([0, 0.01]), len: 0.01, end: 'flat', of, square: true, full: [p] };
}

/**
 * Place the constructed glyph with the box's top left at (ox, oy), the box `em` px wide. `weight` scales the nib.
 * Strokes come in writing order, each between its pen-down disc and its end and corner nodes, so the nodes appear as
 * the pen reaches them. `nodes: false` leaves them out (small text).
 */
export function placeHand(sk: Skel[], ox: number, oy: number, em: number, weight = 1, nodes = true): PStroke[] {
  const k = em / BOX;
  const nib = em * NIB * weight;
  const strokes = sk.map((st, idx): PStroke => {
    const n = st.pts.length;
    const x = new Float32Array(n), y = new Float32Array(n), w = new Float32Array(n).fill(nib), s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = ox + st.pts[i]![0] * k;
      y[i] = oy + st.pts[i]![1] * k;
      if (i) s[i] = s[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, y[i]! - y[i - 1]!);
    }
    const ps: PStroke = { x, y, w, s, len: s[n - 1]!, end: 'flat', of: idx, square: true, full: [] };
    ps.full = [body(ps, n - 1, 0, false)];
    return ps;
  });
  if (!nodes) return strokes;
  const cand: { x: number; y: number; d: number; ring: number; prio: number; of: number }[] = [];
  sk.forEach((st, idx) => {
    if (st.dot) return;
    const last = st.joints.length - 1;
    st.joints.forEach(([jx, jy], j) => {
      const x = ox + jx * k, y = oy + jy * k;
      if (j === 0) { cand.push({ x, y, d: nib * START_NODE, ring: 0, prio: 0, of: idx }); return; }
      if (j === last) { cand.push({ x, y, d: nib * END_NODE, ring: 0, prio: 1, of: idx }); return; }
      if (turnDeg(st.joints[j - 1]!, [jx, jy], st.joints[j + 1]!) >= CORNER_MIN) cand.push({ x, y, d: nib * CORNER_NODE, ring: nib * 1.05, prio: 2, of: idx });
    });
  });
  const kept: typeof cand = [];
  for (const c of cand.sort((p, q) => p.prio - q.prio)) {
    if (kept.every((o) => Math.hypot(o.x - c.x, o.y - c.y) >= NODE_SPACING * nib)) kept.push(c);
  }
  const out: PStroke[] = [];
  strokes.forEach((ps, idx) => {
    for (const c of kept) if (c.of === idx && c.prio === 0) out.push(node(c.x, c.y, c.d, c.ring, idx));
    out.push(ps);
    for (const c of kept) if (c.of === idx && c.prio > 0) out.push(node(c.x, c.y, c.d, c.ring, idx));
  });
  return out;
}
