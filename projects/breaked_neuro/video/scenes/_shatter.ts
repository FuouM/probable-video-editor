// The cracks and the shatter at the end of cnn, shared with broken: one spiderweb mesh of radial rays and
// cross-rings from the output cell out past the frame (bars too). In cnn's last bars the cracks grow along
// those same rays and rings (`drawCracks`); on the last beat the screen breaks along those same lines into
// its shards, which let go from the impact outward and fall down under real gravity, tumbling; broken
// carries the falling shards on after the cut.
import { H, W } from '@pve/engine/gl';
import { BLUE, PAPER, hashI } from './_kit';

/** the point the screen breaks from: the output cell of the network at its final camera */
export const IMPACT: [number, number] = [1200, 540];
const RAYS = 18;
const RINGS = [0, 75, 165, 290, 460, 680, 960, 1320, 1750];
const MAX_R = RINGS[RINGS.length - 1]!;
const GRAVITY = 2800; // px/s² downward

export interface Shard { pts: [number, number][]; cx: number; cy: number; r: number; id: number }

const ANGLES = Array.from({ length: RAYS }, (_, k) => ((k + 0.15 + 0.7 * hashI(k, 1)) / RAYS) * Math.PI * 2);

function nodeAt(k: number, r: number, cx = IMPACT[0], cy = IMPACT[1]): [number, number] {
  if (r === 0) return [cx, cy];
  const kk = ((k % RAYS) + RAYS) % RAYS;
  const a = ANGLES[kk]! + (hashI(kk, r, 2) - 0.5) * 0.11;
  const rr = RINGS[r]! * (0.86 + 0.28 * hashI(kk, r, 3));
  return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
}

function forkNode(k: number, r: number, cx = IMPACT[0], cy = IMPACT[1]): [number, number] {
  if (r === 0) return [cx, cy];
  const [n0a, n0b] = [nodeAt(k, r, cx, cy), nodeAt(k + 1, r, cx, cy)];
  const x = (n0a[0] + n0b[0]) / 2 + (hashI(k, r, 23) - 0.5) * 14;
  const y = (n0a[1] + n0b[1]) / 2 + (hashI(k, r, 24) - 0.5) * 14;
  return [x, y];
}

function clipPolygon(pts: [number, number][]): [number, number][] {
  const edges = [
    { inside: (p: [number, number]) => p[0] >= 0, intersect: (a: [number, number], b: [number, number]): [number, number] => [0, a[1] + (b[1] - a[1]) * (-a[0]) / (b[0] - a[0])] },
    { inside: (p: [number, number]) => p[0] <= W, intersect: (a: [number, number], b: [number, number]): [number, number] => [W, a[1] + (b[1] - a[1]) * (W - a[0]) / (b[0] - a[0])] },
    { inside: (p: [number, number]) => p[1] >= 0, intersect: (a: [number, number], b: [number, number]): [number, number] => [a[0] + (b[0] - a[0]) * (-a[1]) / (b[1] - a[1]), 0] },
    { inside: (p: [number, number]) => p[1] <= H, intersect: (a: [number, number], b: [number, number]): [number, number] => [a[0] + (b[0] - a[0]) * (H - a[1]) / (b[1] - a[1]), H] },
  ];
  let output = pts;
  for (const edge of edges) {
    if (output.length === 0) break;
    const input = output;
    output = [];
    let s = input[input.length - 1]!;
    for (const e of input) {
      if (edge.inside(e)) {
        if (!edge.inside(s)) output.push(edge.intersect(s, e));
        output.push(e);
      } else if (edge.inside(s)) {
        output.push(edge.intersect(s, e));
      }
      s = e;
    }
  }
  return output;
}

function polyArea(pts: [number, number][]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** The pieces between the rays, rings and fork cracks, clipped strictly to [0..W, 0..H]. */
export const SHARDS: Shard[] = (() => {
  const out: Shard[] = [];
  for (let k = 0; k < RAYS; k++) {
    const hasFork = k < 16;
    for (let r = 0; r < RINGS.length - 1; r++) {
      if (r === 0) {
        if (hasFork) {
          const m1 = forkNode(k, 1);
          const polyA = [nodeAt(k, 0), nodeAt(k, 1), m1];
          const polyB = [nodeAt(k, 0), m1, nodeAt(k + 1, 1)];
          for (const [sub, p] of [[0, polyA], [1, polyB]] as const) {
            const pts = clipPolygon(p);
            if (pts.length < 3 || polyArea(pts) < 40) continue;
            let cx = 0, cy = 0;
            for (const [x, y] of pts) { cx += x; cy += y; }
            cx /= pts.length; cy /= pts.length;
            out.push({ pts, cx, cy, r: Math.hypot(cx - IMPACT[0], cy - IMPACT[1]), id: k * 32 + r * 2 + sub });
          }
        } else {
          const p = [nodeAt(k, 0), nodeAt(k, 1), nodeAt(k + 1, 1)];
          const pts = clipPolygon(p);
          if (pts.length < 3 || polyArea(pts) < 40) continue;
          let cx = 0, cy = 0;
          for (const [x, y] of pts) { cx += x; cy += y; }
          cx /= pts.length; cy /= pts.length;
          out.push({ pts, cx, cy, r: Math.hypot(cx - IMPACT[0], cy - IMPACT[1]), id: k * 32 + r * 2 });
        }
      } else {
        const n0 = nodeAt(k, r), n1 = nodeAt(k, r + 1), n2 = nodeAt(k + 1, r + 1), n3 = nodeAt(k + 1, r);
        if (hasFork) {
          const m0 = forkNode(k, r), m1 = forkNode(k, r + 1);
          const polyLeft = [n0, n1, m1, m0];
          const polyRight = [m0, m1, n2, n3];
          for (const [sub, p] of [[0, polyLeft], [1, polyRight]] as const) {
            const pts = clipPolygon(p);
            if (pts.length < 3 || polyArea(pts) < 40) continue;
            let cx = 0, cy = 0;
            for (const [x, y] of pts) { cx += x; cy += y; }
            cx /= pts.length; cy /= pts.length;
            out.push({ pts, cx, cy, r: Math.hypot(cx - IMPACT[0], cy - IMPACT[1]), id: k * 32 + r * 2 + sub });
          }
        } else {
          const p = [n0, n1, n2, n3];
          const pts = clipPolygon(p);
          if (pts.length < 3 || polyArea(pts) < 40) continue;
          let cx = 0, cy = 0;
          for (const [x, y] of pts) { cx += x; cy += y; }
          cx /= pts.length; cy /= pts.length;
          out.push({ pts, cx, cy, r: Math.hypot(cx - IMPACT[0], cy - IMPACT[1]), id: k * 32 + r * 2 });
        }
      }
    }
  }
  return out;
})();

/**
 * Draw the cracks at progress `p` (0..1): the rays grow out from the impact, each at its own speed, and
 * each cross-ring snaps in once both its rays have passed it. Every line is a hole onto the blue with a
 * paper lip, and is an edge of `SHARDS`.
 */
export function drawCracks(c: CanvasRenderingContext2D, p: number, nCracks = 0, cx = IMPACT[0], cy = IMPACT[1]) {
  if (p <= 0 && nCracks <= 0) return;
  const reach = Array.from({ length: RAYS }, (_, k) => {
    const isAdded = k < nCracks;
    const mult = isAdded ? 1.05 : p * (1.05 + 0.35 * hashI(k, 11));
    return Math.min(MAX_R, mult * MAX_R);
  });
  const trace = (dx: number, dy: number) => {
    c.beginPath();
    // Primary rays
    for (let k = 0; k < RAYS; k++) {
      const rk = reach[k]!;
      if (rk <= 4) continue;
      c.moveTo(cx + dx, cy + dy);
      for (let r = 1; r < RINGS.length; r++) {
        const [x0, y0] = nodeAt(k, r - 1, cx, cy), [x1, y1] = nodeAt(k, r, cx, cy);
        const d0 = RINGS[r - 1]!, d1 = RINGS[r]!;
        if (rk >= d1) c.lineTo(x1 + dx, y1 + dy);
        else {
          const u = (rk - d0) / (d1 - d0);
          c.lineTo(x0 + (x1 - x0) * u + dx, y0 + (y1 - y0) * u + dy);
          break;
        }
      }
    }
    // Intermediate fork rays: each of the nCracks (4 per beat) shoots a sub-fork
    if (nCracks > 0) {
      for (let k = 0; k < Math.min(RAYS, nCracks); k++) {
        const [sx, sy] = nodeAt(k, 1, cx, cy);
        c.moveTo(sx + dx, sy + dy);
        for (let r = 2; r < RINGS.length; r++) {
          const [n0a, n0b] = [nodeAt(k, r, cx, cy), nodeAt(k + 1, r, cx, cy)];
          const x1 = (n0a[0] + n0b[0]) / 2 + (hashI(k, r, 23) - 0.5) * 14;
          const y1 = (n0a[1] + n0b[1]) / 2 + (hashI(k, r, 24) - 0.5) * 14;
          c.lineTo(x1 + dx, y1 + dy);
        }
      }
    }
    // Cross-rings
    for (let k = 0; k < RAYS; k++) for (let r = 1; r < RINGS.length - 1; r++) {
      const isAdded = k < nCracks;
      if (!isAdded && (reach[k]! < RINGS[r]! || reach[(k + 1) % RAYS]! < RINGS[r]!)) continue;
      if (!isAdded && p < 0.95 && hashI(k, r, 12) > 0.35) continue;
      const [x0, y0] = nodeAt(k, r, cx, cy), [x1, y1] = nodeAt(k + 1, r, cx, cy);
      c.moveTo(x0 + dx, y0 + dy);
      c.lineTo(x1 + dx, y1 + dy);
      // Diagonal fracture struts on added cracks
      if (isAdded && hashI(k, r, 31) < 0.65) {
        const [x2, y2] = nodeAt(k + 1, r + 1, cx, cy);
        c.moveTo(x0 + dx, y0 + dy);
        c.lineTo(x2 + dx, y2 + dy);
      }
    }
  };
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.lineWidth = 4;
  trace(0, 0);
  c.stroke();
  c.restore();
  c.strokeStyle = PAPER;
  c.lineWidth = 1.2;
  trace(2, 1.5);
  c.stroke();
}

/** A set of pieces flashes solid on 8th-note beats (2 times per beat) without fading out. */
export function flashPieces(c: CanvasRenderingContext2D, hb: number) {
  c.save();
  for (const s of SHARDS) {
    if (hashI(s.id, hb, 41) > 0.28) continue;
    const isBlue = hashI(s.id, hb, 53) < 0.45;
    c.fillStyle = isBlue ? BLUE : PAPER;
    c.beginPath();
    s.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fill();
    c.strokeStyle = PAPER;
    c.lineWidth = 1.5;
    c.stroke();
  }
  c.restore();
}

/**
 * Shard s, `a` seconds into the shatter: it lets go a moment after the break (inner pieces first), drops
 * straight down with real gravity (1/2 g t²) with a small sideways drift, and tumbles about its centre.
 */
export function shardFlight(s: Shard, a: number) {
  const t = Math.max(0, a - (s.r / MAX_R) * 0.08 - hashI(s.id, 4) * 0.04);
  const dx = s.cx - IMPACT[0], dy = s.cy - IMPACT[1];
  const dist = Math.hypot(dx, dy) || 1;
  // Shards pop forward into the camera just a bit right as they break
  const popArc = Math.sin(Math.min(Math.PI, (t / 0.85) * Math.PI));
  const popOut = popArc * (45 + 75 * hashI(s.id, 10));
  const scale = 1.0 + (0.18 + 0.22 * hashI(s.id, 9)) * popArc;
  const vx = (dx >= 0 ? 1 : -1) * (30 + 110 * hashI(s.id, 5)) + dx * 0.08;
  const vy = 60 + 140 * hashI(s.id, 8);
  return {
    x: vx * t + (dx / dist) * popOut,
    y: vy * t + 0.5 * GRAVITY * t * t + (dy / dist) * popOut * 0.4,
    rot: (hashI(s.id, 6) - 0.5) * 3.2 * t,
    scale,
  };
}

/** Trace shard s at flight `a` into c's current path (in screen px). */
export function shardPath(c: CanvasRenderingContext2D, s: Shard, a: number) {
  const f = shardFlight(s, a);
  c.translate(s.cx + f.x, s.cy + f.y);
  c.rotate(f.rot);
  if (f.scale !== 1) c.scale(f.scale, f.scale);
  c.translate(-s.cx, -s.cy);
  c.beginPath();
  s.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
}
/** Check whether a polygon segment lies on the original outer screen boundary. */
export function isBoundaryEdge(p1: [number, number], p2: [number, number]): boolean {
  const eps = 1.0;
  if (p1[0] <= eps && p2[0] <= eps) return true;
  if (p1[0] >= W - eps && p2[0] >= W - eps) return true;
  if (p1[1] <= eps && p2[1] <= eps) return true;
  if (p1[1] >= H - eps && p2[1] >= H - eps) return true;
  return false;
}

/** Trace only the internal crack edges of shard s (never the outer screen boundary). */
export function traceCrackEdges(c: CanvasRenderingContext2D, s: Shard) {
  c.beginPath();
  for (let i = 0; i < s.pts.length; i++) {
    const p1 = s.pts[i]!, p2 = s.pts[(i + 1) % s.pts.length]!;
    if (isBoundaryEdge(p1, p2)) continue;
    c.moveTo(p1[0], p1[1]);
    c.lineTo(p2[0], p2[1]);
  }
}


/** Whether shard s is still on screen `a` seconds in (until it has fallen out the bottom). */
export function shardOn(s: Shard, a: number) {
  const f = shardFlight(s, a);
  return s.cy + f.y < H + 420;
}
