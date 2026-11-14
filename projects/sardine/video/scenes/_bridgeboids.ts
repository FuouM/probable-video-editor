// The sleeping flock of the bridge (treatment v6 "Plate 5", line 14): a boids flock baked once in `init()` at 36 Hz and sampled
// by song time. A frame depends only on t: `Flock.sample(t)` reads a baked step, it never advances a state.
//
// The rules are the three of Reynolds (separation, alignment, cohesion) plus two that make the picture:
//  - streams: every bird belongs to one of a few long rivers whose centre line swings and folds with time, so the flock
//    swirls in streams instead of sitting as a cloud;
//  - the train: a bubble round the car and a cone in front of its nose push the birds outwards, so the flock parts round the
//    nose and closes behind it. No bird touches the train: a last pass moves any bird out of the hull radius.
import * as THREE from 'three';
import { mulberry32 } from '@pve/engine/util';

export interface FlockSpec {
  /** The first and the last song time of the bake. After `t1` the flock holds its last step (frozen by the wind). */
  t0: number;
  t1: number;
  count: number;
  /** The train's centre line: position and the speed on x, by song time. */
  train: (t: number) => { p: THREE.Vector3 };
  /** Where the flock starts, in x, relative to the train at t0: [from, to] metres. */
  spread: [number, number];
  /** The flock drifts forward at this speed (m/s). */
  drift: number;
  seed: number;
}

export const FLOCK_HZ = 36;
const STREAMS = 7;
/** The hash grid of the bake: 8 m cells; the neighbours of a bird are in its 27 cells. */
const CELL = 8;
const cellKey = (x: number, y: number, z: number) => ((Math.floor(x / CELL) + 512) * 1024 + (Math.floor(y / CELL) + 512)) * 1024 + Math.floor(z / CELL) + 512;

/** The birds during the bake: places, velocities, the stream of each bird, and the phase and lane of each stream. */
interface Birds {
  px: Float32Array; py: Float32Array; pz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  stream: Uint8Array;
  phase: number[];
  lane: { y: number; z: number }[];
}

export class Flock {
  readonly count: number;
  readonly steps: number;
  /** x, y, z, vx, vy, vz of every bird at every baked step. */
  private readonly data: Float32Array;

  constructor(private s: FlockSpec) {
    this.count = s.count;
    this.steps = Math.floor((s.t1 - s.t0) * FLOCK_HZ) + 1;
    this.data = new Float32Array(this.steps * this.count * 6);
    this.bake();
  }

  /** The baked step of time t (held after the end). */
  step(t: number): number {
    return Math.max(0, Math.min(this.steps - 1, Math.floor((t - this.s.t0) * FLOCK_HZ + 1e-6)));
  }

  /** Reads bird i at step k into `p` (position) and `v` (velocity). */
  read(k: number, i: number, p: THREE.Vector3, v: THREE.Vector3) {
    const o = (k * this.count + i) * 6, d = this.data;
    p.set(d[o]!, d[o + 1]!, d[o + 2]!);
    v.set(d[o + 3]!, d[o + 4]!, d[o + 5]!);
  }

  private bake() {
    const { count: N, steps: S, s } = this;
    const dt = 1 / FLOCK_HZ;
    const b = this.seedBirds();
    const { px, py, pz, vx, vy, vz } = b;
    const grid = new Map<number, number[]>();
    const ax = new Float32Array(N), ay = new Float32Array(N), az = new Float32Array(N);
    const VMAX = 9, VMIN = 3;
    for (let k = 0; k < S; k++) {
      const t = s.t0 + k * dt;
      const o0 = k * N * 6;
      for (let i = 0; i < N; i++) {
        const o = o0 + i * 6;
        this.data[o] = px[i]!; this.data[o + 1] = py[i]!; this.data[o + 2] = pz[i]!;
        this.data[o + 3] = vx[i]!; this.data[o + 4] = vy[i]!; this.data[o + 5] = vz[i]!;
      }
      if (k === S - 1) break;
      grid.clear();
      for (let i = 0; i < N; i++) { const kk = cellKey(px[i]!, py[i]!, pz[i]!); (grid.get(kk) ?? grid.set(kk, []).get(kk)!).push(i); }
      const tr = s.train(t).p;
      for (let i = 0; i < N; i++) this.force(b, grid, i, t, tr, ax, ay, az);
      for (let i = 0; i < N; i++) {
        vx[i] = vx[i]! + ax[i]! * dt; vy[i] = vy[i]! + ay[i]! * dt; vz[i] = vz[i]! + az[i]! * dt;
        const sp = Math.hypot(vx[i]!, vy[i]!, vz[i]!);
        const c = sp > VMAX ? VMAX / sp : sp < VMIN ? VMIN / Math.max(sp, 1e-3) : 1;
        vx[i] = vx[i]! * c; vy[i] = vy[i]! * c; vz[i] = vz[i]! * c;
        px[i] = px[i]! + vx[i]! * dt; py[i] = py[i]! + vy[i]! * dt; pz[i] = pz[i]! + vz[i]! * dt;
      }
      pushOutOfHull(b, s.train(t + dt).p);
    }
  }

  /** The birds at t0: spread along x ahead of the train, each in the lane of its stream. */
  private seedBirds(): Birds {
    const { count: N, s } = this;
    const rnd = mulberry32(s.seed);
    const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
    const vx = new Float32Array(N), vy = new Float32Array(N), vz = new Float32Array(N);
    const stream = new Uint8Array(N);
    const phase = Array.from({ length: STREAMS }, () => rnd() * Math.PI * 2);
    // the rivers run beside the train and under it, and only a little over its roof: the sky over the train stays clear (the line of the song stands there)
    const lane = Array.from({ length: STREAMS }, (_, k) => ({ y: -10 + (k / (STREAMS - 1)) * 12.5 + (rnd() - 0.5) * 2, z: -11 + rnd() * 14 }));
    const tr0 = s.train(s.t0).p;
    for (let i = 0; i < N; i++) {
      stream[i] = i % STREAMS;
      const l = lane[stream[i]!]!;
      px[i] = tr0.x + s.spread[0] + rnd() * (s.spread[1] - s.spread[0]);
      py[i] = tr0.y + 1.9 + l.y + (rnd() - 0.5) * 4;
      pz[i] = l.z + (rnd() - 0.5) * 4;
      vx[i] = s.drift + (rnd() - 0.5) * 2; vy[i] = (rnd() - 0.5) * 2; vz[i] = (rnd() - 0.5) * 2;
    }
    return { px, py, pz, vx, vy, vz, stream, phase, lane };
  }

  /** The force on bird i at t (into ax, ay, az): the three rules, the pull of its stream, and the push of the train at `tr`. */
  private force(b: Birds, grid: Map<number, number[]>, i: number, t: number, tr: THREE.Vector3, ax: Float32Array, ay: Float32Array, az: Float32Array) {
    const { px, py, pz, vx, vy, vz } = b, s = this.s;
    const axisY = tr.y + 1.9;
    let sx = 0, sy = 0, sz = 0, alx = 0, aly = 0, alz = 0, cx = 0, cy = 0, cz = 0, na = 0;
    const cxi = Math.floor(px[i]! / CELL), cyi = Math.floor(py[i]! / CELL), czi = Math.floor(pz[i]! / CELL);
    for (let a = -1; a <= 1; a++) for (let bb = -1; bb <= 1; bb++) for (let c = -1; c <= 1; c++) {
      const list = grid.get(((cxi + a + 512) * 1024 + (cyi + bb + 512)) * 1024 + czi + c + 512);
      if (!list) continue;
      for (const j of list) {
        if (j === i) continue;
        const dx = px[j]! - px[i]!, dy = py[j]! - py[i]!, dz = pz[j]! - pz[i]!;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 64) continue;
        if (d2 < 2.6) { const w = 1 / (d2 + 0.2); sx -= dx * w; sy -= dy * w; sz -= dz * w; }
        alx += vx[j]!; aly += vy[j]!; alz += vz[j]!;
        cx += dx; cy += dy; cz += dz; na++;
      }
    }
    let fx = 2.4 * sx, fy = 2.4 * sy, fz = 2.4 * sz;
    if (na) {
      fx += 0.7 * (alx / na - vx[i]!) + 0.3 * (cx / na); fy += 0.7 * (aly / na - vy[i]!) + 0.3 * (cy / na); fz += 0.7 * (alz / na - vz[i]!) + 0.3 * (cz / na);
    }
    // the stream: pull to the swinging centre line of its river, and a steady drift along x
    const sid = b.stream[i]!, l = b.lane[sid]!;
    const ty = axisY + l.y + 3 * Math.sin(0.055 * px[i]! + 0.9 * (t - s.t0) + b.phase[sid]!);
    const tz = l.z + 3.5 * Math.cos(0.045 * px[i]! + 0.7 * (t - s.t0) + 2 * b.phase[sid]!);
    fy += 0.9 * (ty - py[i]!); fz += 0.9 * (tz - pz[i]!);
    fx += 1.4 * (s.drift + 1.2 * Math.sin(0.4 * (t - s.t0) + b.phase[sid]!) - vx[i]!);
    // the train: a bubble round the car and a cone ahead of the nose, pushing outwards from the axis (y, z)
    const ux = px[i]! - tr.x;
    if (ux > -13 && ux < 34) {
      const ry = py[i]! - axisY, rz = pz[i]!;
      const rad = Math.hypot(ry, rz) + 1e-3;
      const reach = ux > 11 ? 6 + 4 * Math.min(1, (ux - 11) / 23) : 6;
      const q = 1 - rad / reach;
      if (q > 0) { const w = 90 * q * q; fy += (ry / rad) * w; fz += (rz / rad) * w; }
    }
    ax[i] = fx; ay[i] = fy; az[i] = fz;
  }
}

/** No bird inside the hull of the train at `tn`: the car is 19.6 m long and about 3.7 m high, 2.9 m wide. */
function pushOutOfHull(b: Birds, tn: THREE.Vector3) {
  const { px, py, pz } = b;
  for (let i = 0; i < px.length; i++) {
    const ux = px[i]! - tn.x;
    if (ux < -11.5 || ux > 11.5) continue;
    const ry = py[i]! - (tn.y + 1.9), rz = pz[i]!;
    if (Math.abs(ry) < 2.6 && Math.abs(rz) < 2.2) {
      if (Math.abs(ry) / 2.6 > Math.abs(rz) / 2.2) py[i] = tn.y + 1.9 + Math.sign(ry || 1) * 2.6;
      else pz[i] = Math.sign(rz || 1) * 2.2;
    }
  }
}
