// The kick bounce of the sardine ride cameras: a car on the rail joints. A pure function of t.

/**
 * The bounce of a car on the rail joints: on each kick the arm goes down by `amp` and comes back,
 * dy = -amp e^(-18 dt) cos(45 dt). Returns the height offset at t.
 */
export function kickBounce(t: number, kicks: readonly number[], amp = 0.035): number {
  let y = 0;
  // kicks are sorted: skip those more than 0.6 s ago
  let lo = 0, hi = kicks.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (kicks[m]! < t - 0.6) lo = m + 1; else hi = m; }
  for (let k = lo; k < kicks.length && kicks[k]! <= t; k++) {
    const dt = t - kicks[k]!;
    y -= amp * Math.exp(-18 * dt) * Math.cos(45 * dt);
  }
  return y;
}
