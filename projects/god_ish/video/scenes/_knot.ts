// The knotwork initial and the marginalia (vine, bird) that plate 0 (original-illuminated.ts) and the reborn plate 10
// (new-looks.ts) share. Each plate gives its own geometry: the initial's centre and size, the plait's corner radius,
// the vine's shape.
import { INK, PAPER, RED, tone } from './_page';

type P = [number, number];

export interface Band {
  pts: P[];
  fill: string;
}
export interface Crossing {
  /** The band on top and the sample where it crosses. */
  band: number;
  at: number;
}
export interface Knot {
  bands: Band[];
  over: Crossing[];
}

/** Evenly spaced points (step h) around a rounded square of half side r and corner radius q, with outward normals. */
export function roundSquare(cx: number, cy: number, r: number, q: number, h: number): { p: P; n: P }[] {
  const flat = 2 * (r - q), arc = (Math.PI / 2) * q, side = flat + arc, L = 4 * side;
  const out: { p: P; n: P }[] = [];
  const m = Math.round(L / h);
  for (let i = 0; i < m; i++) {
    const s = (i / m) * L, k = Math.floor(s / side), u = s - k * side;
    // side k runs along the top, right, bottom, left (turning clockwise on screen)
    let lx: number, ly: number, nx: number, ny: number;
    if (u < flat) { lx = -r + q + u; ly = -r; nx = 0; ny = -1; }
    else {
      const a = -Math.PI / 2 + (u - flat) / q;
      lx = r - q + Math.cos(a) * q; ly = -r + q + Math.sin(a) * q; nx = Math.cos(a); ny = Math.sin(a);
    }
    // rotate the local frame by k quarter turns
    for (let j = 0; j < k; j++) { [lx, ly] = [-ly, lx]; [nx, ny] = [-ny, nx]; }
    out.push({ p: [cx + lx, cy + ly], n: [nx, ny] });
  }
  return out;
}

function segX(a: P, b: P, c: P, d: P): boolean {
  const d1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
  const d3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]);
  const d4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * The initial's bands: a two-strand plait round the square (centre `ini.x, ini.y`, half side `ini.r`, plait corner
 * radius `q`) and a trefoil knot on each corner.
 */
export function buildKnot(ini: { x: number; y: number; r: number }, q: number): Knot {
  const ring = roundSquare(ini.x, ini.y, ini.r - 22, q, 2);
  const N = 16, A = 11;
  const strand = (sg: number): P[] =>
    ring.map(({ p, n }, i) => {
      const o = sg * A * Math.sin((2 * Math.PI * N * i) / ring.length);
      return [p[0] + n[0] * o, p[1] + n[1] * o];
    });
  const bands: Band[] = [{ pts: strand(1), fill: RED }, { pts: strand(-1), fill: INK }];
  for (let k = 0; k < 4; k++) {
    const ang = Math.PI / 4 + (k * Math.PI) / 2;
    const cx = ini.x + Math.cos(ang) * (ini.r - 22) * 1.2, cy = ini.y + Math.sin(ang) * (ini.r - 22) * 1.2;
    const rot = ang + Math.PI / 2, pts: P[] = [];
    for (let i = 0; i < 110; i++) {
      const t = (2 * Math.PI * i) / 110;
      const x = (Math.sin(t) + 2 * Math.sin(2 * t)) * 12, y = (Math.cos(t) - 2 * Math.cos(2 * t)) * 12;
      pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    bands.push({ pts, fill: RED });
  }
  // every crossing, with where it falls on each band
  const hits: { a: number; i: number; b: number; j: number }[] = [];
  for (let a = 0; a < bands.length; a++) {
    for (let b = a; b < bands.length; b++) {
      const pa = bands[a]!.pts, pb = bands[b]!.pts;
      for (let i = 0; i < pa.length; i++) {
        for (let j = a === b ? i + 4 : 0; j < pb.length; j++) {
          if (a === b && j - i > pa.length - 4) continue;
          if (segX(pa[i]!, pa[(i + 1) % pa.length]!, pb[j]!, pb[(j + 1) % pb.length]!)) hits.push({ a, i, b, j });
        }
      }
    }
  }
  // over and under alternate along each band: each crossing is visited twice (v 0 on band a, v 1 on band b)
  const visits = hits.flatMap((h, k) => [{ k, v: 0, band: h.a, at: h.i }, { k, v: 1, band: h.b, at: h.j }]);
  const top = hits.map(() => -1);
  for (let band = 0; band < bands.length; band++) {
    let up = true;
    for (const x of visits.filter((x) => x.band === band).sort((p, q) => p.at - q.at)) {
      if (top[x.k]! < 0) top[x.k] = up ? x.v : 1 - x.v;
      up = top[x.k] !== x.v;
    }
  }
  const over = hits.map((h, k) => (top[k] === 0 ? { band: h.a, at: h.i } : { band: h.b, at: h.j }));
  return { bands, over };
}

export function polyline(c: CanvasRenderingContext2D, pts: P[], from: number, to: number, closed: boolean) {
  const n = pts.length;
  c.beginPath();
  for (let i = from; i <= to; i++) {
    const p = pts[closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))]!;
    if (i === from) c.moveTo(p[0], p[1]);
    else c.lineTo(p[0], p[1]);
  }
  if (closed && from === 0 && to === n - 1) c.closePath();
}

const BW = 7; // band width
export function drawKnot(c: CanvasRenderingContext2D, k: Knot) {
  c.lineJoin = 'round';
  for (const b of k.bands) {
    polyline(c, b.pts, 0, b.pts.length - 1, true);
    c.strokeStyle = INK;
    c.lineWidth = BW + 3;
    c.stroke();
    c.strokeStyle = b.fill;
    c.lineWidth = BW;
    c.stroke();
  }
  // the over strand at each crossing, with a paper gap either side that cuts the under strand
  c.lineCap = 'butt';
  for (const o of k.over) {
    const b = k.bands[o.band]!;
    polyline(c, b.pts, o.at - 7, o.at + 8, true);
    c.strokeStyle = PAPER;
    c.lineWidth = BW + 9;
    c.stroke();
    c.strokeStyle = INK;
    c.lineWidth = BW + 3;
    c.stroke();
    c.strokeStyle = b.fill;
    c.lineWidth = BW;
    c.stroke();
  }
}

// ---------- marginalia ----------
export interface Sprig {
  /** Where on the stem it starts (px from the root). */
  at: number;
  pts: P[];
  leaf: P[] | null;
  berries: P[];
}

/** The vine's shape: its stem meanders `amp` px either side of `x` (one radian per `wave` px) from `bottom` up to `top`. */
export interface VineShape {
  x: number;
  top: number;
  bottom: number;
  amp: number;
  wave: number;
  /** The first sprig and the space between sprigs, px along the stem. */
  first: number;
  step: number;
  /** The angle of a tendril off the vertical at its root (radians). */
  splay: number;
}

/** The vine: a meandering stem up the margin and, every `step` px, a curling tendril with a leaf or red berries. */
export function buildVine(v: VineShape): { stem: P[]; sprigs: Sprig[] } {
  const stem: P[] = [];
  for (let y = v.bottom + 20; y >= v.top - 20; y -= 3) stem.push([v.x + v.amp * Math.sin((v.bottom - y) / v.wave), y]);
  const sprigs: Sprig[] = [];
  for (let k = 0, at = v.first; at < (stem.length - 6) * 3; k++, at += v.step) {
    const i = Math.round(at / 3), [sx, sy] = stem[i]!;
    const side = k % 2 ? 1 : -1;
    // a tendril: out and up, curling inward (the curvature grows along it)
    const pts: P[] = [[sx, sy]];
    let a = -Math.PI / 2 + side * v.splay, x = sx, y = sy;
    const L = 46 + 14 * Math.sin(k * 2.3);
    for (let s = 0; s < L; s += 2) {
      a -= side * (0.02 + 0.2 * (s / L) ** 2.2);
      x += Math.cos(a) * 2;
      y += Math.sin(a) * 2;
      pts.push([x, y]);
    }
    const mid = pts[Math.floor(pts.length * 0.45)]!;
    let leaf: P[] | null = null;
    const berries: P[] = [];
    if (k % 3 === 2) for (let b = 0; b < 3; b++) berries.push([mid[0] + side * (8 + 6 * b), mid[1] - 6 + (b % 2) * 9]);
    else {
      // a pointed leaf off the tendril, outlined
      const la = -Math.PI / 2 + side * 1.6, lx = Math.cos(la), ly = Math.sin(la);
      leaf = [];
      for (let s = 0; s <= 1.0001; s += 0.1) leaf.push([mid[0] + lx * s * 24 - ly * 7 * Math.sin(Math.PI * s), mid[1] + ly * s * 24 + lx * 7 * Math.sin(Math.PI * s)]);
      for (let s = 1; s >= -0.0001; s -= 0.1) leaf.push([mid[0] + lx * s * 24 + ly * 7 * Math.sin(Math.PI * s), mid[1] + ly * s * 24 - lx * 7 * Math.sin(Math.PI * s)]);
    }
    sprigs.push({ at, pts, leaf, berries });
  }
  return { stem, sprigs };
}

export function strokePts(c: CanvasRenderingContext2D, pts: P[], w: number) {
  c.lineWidth = w;
  polyline(c, pts, 0, pts.length - 1, false);
  c.stroke();
}

/** A perched marginalia bird on the top of the vine, filled and outlined with red plumage accents. */
export function drawBird(c: CanvasRenderingContext2D, x: number, y: number) {
  c.save();
  c.translate(x - 10, y - 6);
  c.scale(1.38, 1.38);
  c.translate(-(x - 10), -(y - 6));
  // Paper fill inside the body so the bird reads cleanly against nearby rules
  const body: P[] = [];
  for (let a = Math.PI * 0.95; a < Math.PI * 2.15; a += 0.08) body.push([x + Math.cos(a) * 18, y + Math.sin(a) * 10 * (a < Math.PI * 1.5 ? 1.2 : 0.9)]);
  c.fillStyle = tone(0.92);
  c.beginPath();
  body.forEach(([px, py], i) => (i === 0 ? c.moveTo(px, py) : c.lineTo(px, py)));
  c.lineTo(x + 17, y + 1);
  c.quadraticCurveTo(x + 4, y + 10, x - 17, y + 2);
  c.closePath();
  c.fill();
  c.strokeStyle = INK;
  strokePts(c, body, 2.0);
  strokePts(c, [[x - 17, y + 2], [x + 4, y + 9], [x + 17, y + 1]], 2.0); // belly
  strokePts(c, [[x + 16, y - 4], [x + 26, y - 16], [x + 31, y - 25]], 1.8); // tail
  // Red rubric beak & wing accent
  c.fillStyle = RED;
  c.beginPath();
  c.moveTo(x - 18, y - 3);
  c.lineTo(x - 28, y - 1);
  c.lineTo(x - 18, y + 2);
  c.closePath();
  c.fill();
  strokePts(c, [[x - 18, y - 3], [x - 28, y - 1], [x - 18, y + 2]], 1.5); // beak
  c.strokeStyle = RED;
  strokePts(c, [[x - 6, y - 4], [x + 8, y - 6], [x + 14, y - 2]], 1.6); // wing
  c.strokeStyle = INK;
  strokePts(c, [[x - 3, y + 8], [x - 5, y + 18]], 1.5);
  strokePts(c, [[x + 4, y + 8], [x + 3, y + 18]], 1.5);
  c.fillStyle = RED;
  c.beginPath();
  c.arc(x - 11, y - 3, 2.2, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
