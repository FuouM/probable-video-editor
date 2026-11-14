// The unloading of the world in chorus 3 (treatment v9 plate 9, "The world gets unloaded"), on the engine's chunks
// (`@pve/engine/chunks`). The world loses its materials from the left, behind the train: first the far hills, then the town and the
// loop of chorus 2, then the street of the straight. The edge closes in on the rear car. This module says when each place unloads.
import { ChunkGrid, Unload } from '@pve/engine/chunks';
import { smooth } from '@pve/engine/util';
import { T_CUT } from './_outro';
import { T0, T_EXIT, xAt } from './_c3stage';

/**
 * The chunks: 6 m (x) by 12 m (z). The grid: 266 chunks in x from x = -1200 (to x = 396: the whole stem of chorus 3), 48 in z (to
 * +-288 m). A chunk shows the checker for 0.55 s before it drops.
 */
export const C3_GRID = new ChunkGrid({ x: 6, z: 12, x0: -1200, nix: 266, niz: 48, iz0: 24, pivotY: 2, check: 0.55 });

/** The new track comes up from the exit on: the wave starts at this time and runs away from the train at this speed (m/s). */
export const T_OPEN = T_EXIT - 3.6, OPEN_SPEED = 170;
/** How far behind the middle of the front car the edge of the unloading is at t (m): far off at first, then it closes in on the rear car. */
const lagAt = (t: number) => 210 - 158 * smooth((t - T0) / (T_EXIT + 1.5 - T0)) - 26 * Math.min(1, Math.max(0, (t - 146) / (160.9 - 146)));
/** The time at which the edge is at x. */
export function edgeTime(x: number): number {
  let a = T0 - 30, b = T_CUT + 5;
  for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (xAt(m) + lagAt(m) > x) a = m; else b = m; }
  return (a + b) / 2;
}
/** The time at which the place (x, z) unloads: what is far from the line goes a little later. */
export const unloadAt = (x: number, z: number) => edgeTime(x - 0.12 * Math.abs(z));
/** The far hills go first, in a wave from the east to the west. */
export const farAt = (x: number) => T0 + 1.2 + 2.6 * Math.min(1, Math.max(0, (400 - x) / 1500));

/** The clocks of chorus 3: the world by `unloadAt`, the track by the edge, the far hills by their wave. */
export function c3Unload(): Unload {
  return new Unload(C3_GRID, unloadAt, (x) => edgeTime(x), (x) => farAt(x));
}

/** The time at which a chunk of kind `kind` (0 world, 1 track, 2 far hills) at grid cell (ix, iz) unloads: the clock of `c3Unload`. */
export function chunkTime(ix: number, iz: number, kind: number): number {
  const x = C3_GRID.cxOf(ix), z = C3_GRID.czOf(iz);
  return kind === 0 ? unloadAt(x, z) : kind === 1 ? edgeTime(x) : farAt(x);
}

/**
 * The progress of the unloading as the game would count it: the share of the triangles of the world (and of its loose objects) whose
 * time has come. It is built from what the scene really draws, so it does not reach 1 when a part of the world is still there.
 */
export class UnloadMeter {
  private times: Float64Array;
  private sums: Float64Array;
  private total: number;

  /** `items`: a time and the triangles that unload at it. */
  constructor(items: readonly { t: number; n: number }[]) {
    const s = [...items].sort((a, b) => a.t - b.t);
    this.times = Float64Array.from(s.map((i) => i.t));
    this.sums = new Float64Array(s.length);
    let acc = 0;
    s.forEach((i, k) => { acc += i.n; this.sums[k] = acc; });
    this.total = acc;
  }

  /** The share (0..1) at t. */
  share(t: number): number {
    let a = 0, b = this.times.length;
    while (a < b) { const m = (a + b) >> 1; if (this.times[m]! <= t) a = m + 1; else b = m; }
    return a === 0 ? 0 : this.sums[a - 1]! / this.total;
  }
}
