// 3D Crane Game: simulated physical prize bodies, 3D primitive meshes, cabinet box, and claw motion.
import { clamp, ease, prog } from '@pve/engine/util';
import { sylAt } from '@pve/engine/lyrics';
import { BEAT, BEAT0, BLUE, INK, PAPER, gray, hashI, rebate, stepT, type Placed, type SylLine } from './_kit';

export type V3 = [number, number, number];

export interface CellLike {
  sl: SylLine;
  placed: Placed[];
  rows: number;
  x: number;
  y: number;
}

export interface Mesh {
  v: V3[];
  f: [number, number, number][];
}

export const MESHES: Mesh[] = (() => {
  // 0 cube
  const cv: V3[] = [[-0.7, -0.7, -0.7], [0.7, -0.7, -0.7], [0.7, 0.7, -0.7], [-0.7, 0.7, -0.7], [-0.7, -0.7, 0.7], [0.7, -0.7, 0.7], [0.7, 0.7, 0.7], [-0.7, 0.7, 0.7]];
  const cf: [number, number, number][] = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [0, 7, 3], [0, 4, 7]];
  // 1 octahedron
  const ov: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const of: [number, number, number][] = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  // 2 icosahedron
  const p = (1 + Math.sqrt(5)) / 2, n = Math.hypot(1, p);
  const a = 1 / n, b = p / n;
  const iv: V3[] = [[-a, b, 0], [a, b, 0], [-a, -b, 0], [a, -b, 0], [0, -a, b], [0, a, b], [0, -a, -b], [0, a, -b], [b, 0, -a], [b, 0, a], [-b, 0, -a], [-b, 0, a]];
  const iff: [number, number, number][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  // 3 cylinder (10 sides)
  const N = 10, cyv: V3[] = [[0, -0.8, 0], [0, 0.8, 0]], cyf: [number, number, number][] = [];
  for (let k = 0; k < N; k++) {
    const th = (k / N) * Math.PI * 2, c = Math.cos(th) * 0.78, s = Math.sin(th) * 0.78;
    cyv.push([c, -0.8, s], [c, 0.8, s]);
    const i0 = 2 + k * 2, i1 = 2 + ((k + 1) % N) * 2;
    cyf.push([0, i0, i1], [1, i1 + 1, i0 + 1], [i0, i0 + 1, i1 + 1], [i0, i1 + 1, i1]);
  }
  // 4 cone (10 sides)
  const cov: V3[] = [[0, -0.85, 0], [0, 0.95, 0]], cof: [number, number, number][] = [];
  for (let k = 0; k < N; k++) {
    const th = (k / N) * Math.PI * 2;
    cov.push([Math.cos(th) * 0.85, -0.85, Math.sin(th) * 0.85]);
    const i0 = 2 + k, i1 = 2 + ((k + 1) % N);
    cof.push([0, i0, i1], [1, i1, i0]);
  }
  return [{ v: cv, f: cf }, { v: ov, f: of }, { v: iv, f: iff }, { v: cyv, f: cyf }, { v: cov, f: cof }];
})();

export const GLASS = { l: 20, r: 20, top: 148, floor: 16 };
export const DT_CRANE = 1 / 30;
const G = 1600;

export interface PrizeBody { kind: number; r: number; x: number; y: number; vx: number; vy: number; a: number; b: number; va: number; vb: number; held: boolean }
export interface CraneStep { x: number; y: number; shut: number; prizes: { kind: number; r: number; x: number; y: number; a: number; b: number; held: boolean }[] }

/** Pre-simulate the crane case from `start` to `end`: prizes rain in on the beat, collide, and are grabbed. */
export function simCrane(start: number, end: number, CW: number, CH: number): CraneStep[] {
  const left = GLASS.l, right = CW - GLASS.r, top = GLASS.top, floor = CH - GLASS.floor;
  const bodies: PrizeBody[] = [];
  const spawn = (x: number, y: number, salt: number) => {
    const r = 18 + hashI(salt, 1) * 8;
    bodies.push({
      kind: Math.floor(hashI(salt, 2) * MESHES.length), r,
      x: clamp(x, left + r, right - r), y, vx: (hashI(salt, 3) - 0.5) * 80, vy: 0,
      a: hashI(salt, 4) * 6.28, b: hashI(salt, 5) * 6.28, va: (hashI(salt, 6) - 0.5) * 0.6, vb: (hashI(salt, 7) - 0.5) * 0.6, held: false,
    });
  };
  for (let i = 0; i < 16; i++) spawn(left + 30 + (i % 6) * 62 + hashI(i, 10) * 16, floor - 24 - Math.floor(i / 6) * 42, i + 100);
  const relax = () => {
    for (let it = 0; it < 4; it++) {
      for (let i = 0; i < bodies.length; i++) {
        const p = bodies[i]!;
        if (p.held) continue;
        if (p.x < left + p.r) { p.x = left + p.r; p.vx = Math.abs(p.vx) * 0.3; }
        if (p.x > right - p.r) { p.x = right - p.r; p.vx = -Math.abs(p.vx) * 0.3; }
        if (p.y > floor - p.r) { p.y = floor - p.r; p.vy = -Math.abs(p.vy) * 0.2; p.vx *= 0.85; p.va *= 0.45; p.vb *= 0.45; }
        for (let j = i + 1; j < bodies.length; j++) {
          const q = bodies[j]!;
          if (q.held) continue;
          const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy), min = p.r + q.r;
          if (d >= min || d < 1e-4) continue;
          const nx = dx / d, ny = dy / d, ov = (min - d) * 0.5;
          p.x -= nx * ov; p.y -= ny * ov; q.x += nx * ov; q.y += ny * ov;
          const vn = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
          if (vn < 0) {
            const jn = -vn * 0.6;
            p.vx -= nx * jn; p.vy -= ny * jn; q.vx += nx * jn; q.vy += ny * jn;
            p.va += ((ny * jn) / p.r) * 0.12; q.va -= ((ny * jn) / q.r) * 0.12;
          }
        }
      }
    }
  };
  for (let s = 0; s < 40; s++) { for (const p of bodies) { p.vy += G * DT_CRANE; p.x += p.vx * DT_CRANE; p.y += p.vy * DT_CRANE; } relax(); }
  for (const p of bodies) { p.vx = 0; p.vy = 0; p.va = 0; p.vb = 0; }

  const steps: CraneStep[] = [];
  const total = Math.ceil((end - start) / DT_CRANE) + 2;
  let lastBeat = Math.floor((start - BEAT0) / BEAT);
  let grab = -1, startX = left + 70, gx = left + 160, gy = floor - 40, g0 = -Infinity;
  let curX = startX;
  const cyc = 4 * BEAT;
  for (let s = 0; s < total; s++) {
    const t = start + s * DT_CRANE;
    const b = Math.floor((t - BEAT0) / BEAT);
    if (b > lastBeat) {
      lastBeat = b;
      if (bodies.length < 30) spawn(left + 40 + hashI(b, 20) * (right - left - 80), top + 10, b * 17);
      if (b % 4 === 0) {
        g0 = t;
        startX = curX;
        const want = left + 50 + hashI(b, 21) * (right - left - 100);
        let best = -1, score = Infinity;
        bodies.forEach((p, i) => { const sc = Math.abs(p.x - want) + (p.y - top) * 0.6; if (sc < score) { score = sc; best = i; } });
        if (best >= 0) { gx = bodies[best]!.x; gy = Math.max(top + 60, bodies[best]!.y); }
      }
    }
    const u = (t - g0) / cyc;
    let cy = top + 22, shut = 0;
    if (u >= 0 && u < 1) {
      curX = startX + (gx - startX) * ease.inOutCubic(prog(u, 0, 0.28));
      cy = u < 0.28 ? top + 22 : u < 0.54 ? top + 22 + (gy - top - 34) * ease.inCubic(prog(u, 0.28, 0.54)) : u < 0.64 ? gy - 12 : gy - 12 + (top + 28 - (gy - 12)) * ease.outCubic(prog(u, 0.64, 0.9));
      shut = u < 0.88 ? prog(u, 0.52, 0.62) : 1 - prog(u, 0.88, 0.96);
      if (u >= 0.58 && u < 0.88 && grab < 0) {
        let best = -1, bd = 46;
        bodies.forEach((p, i) => { const d = Math.hypot(p.x - curX, p.y - (cy + 30)); if (d < bd) { bd = d; best = i; } });
        if (best >= 0) { grab = best; bodies[grab]!.held = true; }
      }
      if (u >= 0.88 && grab >= 0) { bodies[grab]!.held = false; bodies[grab]!.vx = (hashI(s, 30) - 0.5) * 75; bodies[grab]!.vy = 15; grab = -1; }
    } else if (grab >= 0) { bodies[grab]!.held = false; grab = -1; }
    if (grab >= 0) { const p = bodies[grab]!; p.x = curX; p.y = cy + 28; p.vx = 0; p.vy = 0; p.a += 0.008; }

    for (const p of bodies) {
      if (p.held) continue;
      p.vy += G * DT_CRANE;
      p.x += p.vx * DT_CRANE; p.y += p.vy * DT_CRANE;
      p.a += p.va * DT_CRANE; p.b += p.vb * DT_CRANE;
    }
    relax();
    steps.push({ x: curX, y: cy, shut, prizes: bodies.map((p) => ({ kind: p.kind, r: p.r, x: p.x, y: p.y, a: p.a, b: p.b, held: p.held })) });
  }
  return steps;
}

/** Render a unit mesh at (cx, cy), radius r, Euler angles (a, b), flat-shaded. */
export function drawMesh(c: CanvasRenderingContext2D, m: Mesh, cx: number, cy: number, r: number, a: number, b: number) {
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const rot = ([x, y, z]: V3): V3 => {
    const x1 = x * ca - z * sa, z1 = x * sa + z * ca;
    return [x1, y * cb - z1 * sb, y * sb + z1 * cb];
  };
  const vs = m.v.map(rot);
  const faces = m.f
    .map(([i, j, k]) => {
      const A = vs[i]!, B = vs[j]!, C = vs[k]!;
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
      const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      return { A, B, C, nz, z: A[2] + B[2] + C[2], n: [nx, ny, nz] as V3 };
    })
    .filter((f) => f.nz > 0)
    .sort((p, q) => p.z - q.z);
  for (const f of faces) {
    const [nx, ny, nz] = f.n, ln = Math.hypot(nx, ny, nz) || 1;
    const d = Math.max(0, (-0.45 * nx - 0.55 * ny + 0.7 * nz) / ln);
    c.fillStyle = gray(0.18 + 0.76 * d);
    c.strokeStyle = INK;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(cx + f.A[0] * r, cy + f.A[1] * r);
    c.lineTo(cx + f.B[0] * r, cy + f.B[1] * r);
    c.lineTo(cx + f.C[0] * r, cy + f.C[1] * r);
    c.closePath();
    c.fill();
    c.stroke();
  }
}

/** The crane game: real 3D cabinet box with perspective depth, gantry rails, 3D chute, and continuous claw. */
export function drawCraneGame(
  c: CanvasRenderingContext2D,
  cell: CellLike,
  t: number,
  craneSteps: CraneStep[],
  CW: number,
  CH: number,
  CELL: number,
  PAD: number,
  drawText: (c: CanvasRenderingContext2D, cell: CellLike, t: number, x: number, y: number) => void,
) {
  const { x: ox, y: oy, sl } = cell;
  const at = (fps: number) => craneSteps[clamp(Math.floor((stepT(t, fps, 0) - sl.line.start) / DT_CRANE), 0, craneSteps.length - 1)];
  const st = at(24), lo = at(8);
  const left = ox + GLASS.l, top = oy + GLASS.top, w = CW - GLASS.l - GLASS.r, h = CH - GLASS.top - GLASS.floor;
  const dx = 34, dy = 22;
  const bLeft = left + dx, bTop = top + dy, bW = w - 2 * dx, bH = h - 2 * dy;
  c.fillStyle = gray(0.05);
  c.fillRect(left, top, w, h);
  c.fillStyle = gray(0.14);
  c.beginPath();
  c.moveTo(left, top + h); c.lineTo(bLeft, bTop + bH); c.lineTo(bLeft + bW, bTop + bH); c.lineTo(left + w, top + h);
  c.closePath(); c.fill();
  c.fillStyle = gray(0.10);
  c.beginPath();
  c.moveTo(left, top); c.lineTo(bLeft, bTop); c.lineTo(bLeft + bW, bTop); c.lineTo(left + w, top);
  c.closePath(); c.fill();
  c.strokeStyle = gray(0.48);
  c.lineWidth = 1.5;
  c.strokeRect(bLeft, bTop, bW, bH);
  c.beginPath();
  c.moveTo(left, top); c.lineTo(bLeft, bTop);
  c.moveTo(left + w, top); c.lineTo(bLeft + bW, bTop);
  c.moveTo(left, top + h); c.lineTo(bLeft + bW, bTop + bH);
  c.moveTo(left + w, top + h); c.lineTo(bLeft + bW, bTop + bH);
  c.stroke();
  const chW = 54, chH = 48, chDx = 16, chDy = 12;
  c.fillStyle = INK;
  c.fillRect(left + 6, top + h - chH, chW, chH);
  c.strokeStyle = PAPER;
  c.lineWidth = 1.8;
  c.strokeRect(left + 6, top + h - chH, chW, chH);
  c.beginPath();
  c.moveTo(left + 6, top + h - chH); c.lineTo(left + 6 + chDx, top + h - chH - chDy);
  c.lineTo(left + 6 + chW + chDx, top + h - chH - chDy); c.lineTo(left + 6 + chW, top + h - chH);
  c.closePath();
  c.fillStyle = gray(0.22); c.fill(); c.stroke();
  c.beginPath();
  c.moveTo(left + 6 + chW, top + h - chH); c.lineTo(left + 6 + chW + chDx, top + h - chH - chDy);
  c.lineTo(left + 6 + chW + chDx, top + h - chDy); c.lineTo(left + 6 + chW, top + h);
  c.stroke();

  if (st) {
    c.save();
    c.beginPath(); c.rect(left + 1, top + 2, w - 2, h - 3); c.clip();
    st.prizes.forEach((p, i) => {
      const q = p.held ? p : lo!.prizes[i] ?? p;
      drawMesh(c, MESHES[p.kind]!, ox + q.x, oy + q.y, q.r, q.a, q.b);
    });
    const cx = ox + st.x, cy = oy + st.y;
    const railY = top + dy * 0.5;
    c.strokeStyle = gray(0.6);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(left + dx * 0.5, railY); c.lineTo(left + w - dx * 0.5, railY);
    c.stroke();
    c.fillStyle = PAPER;
    c.fillRect(cx - 16, railY - 4, 32, 10);
    c.strokeStyle = INK;
    c.lineWidth = 1;
    c.strokeRect(cx - 16, railY - 4, 32, 10);
    c.strokeStyle = PAPER;
    c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(cx, railY + 6); c.lineTo(cx, cy); c.stroke();
    c.fillRect(cx - 14, cy, 28, 10);
    for (const s of [-1, 0, 1]) {
      const sp = (1 - st.shut) * 20;
      c.beginPath();
      c.moveTo(cx + s * 9, cy + 10);
      c.lineTo(cx + s * (10 + sp), cy + 32);
      c.lineTo(cx + s * (3 + sp * 0.4), cy + 44);
      c.lineWidth = 3.5;
      c.stroke();
    }
    c.restore();
  }
  c.strokeStyle = PAPER;
  c.lineWidth = 2.2;
  c.strokeRect(left, top, w, h);
  c.fillStyle = PAPER;
  c.fillRect(left, top, w, 5);
  const hi = sl.syls.findIndex((s) => s.text.toLowerCase() === 'help');
  if (hi >= 0 && sylAt(sl, t) >= hi) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of cell.placed) if (p.si === hi) {
      const bx = ox + PAD + p.x * CELL, by = oy + 14 + p.y * CELL;
      x0 = Math.min(x0, bx); y0 = Math.min(y0, by); x1 = Math.max(x1, bx + p.b.len * CELL); y1 = Math.max(y1, by + CELL);
    }
    if (x1 > x0) { c.fillStyle = BLUE; c.fillRect(x0 - 8, y0 - 6, x1 - x0 + 16, y1 - y0 + 12); }
  }
  drawText(c, cell, t, ox + PAD, oy + 14);
  rebate(c, 'INSERT COIN · 1 TRY', ox + CW - 16, oy + CH - 8, 'right', 0.7);
}
