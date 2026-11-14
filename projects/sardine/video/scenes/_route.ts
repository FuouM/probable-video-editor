// The route of the one game world of sardine (`_gameWorld.ts`): the stem, the loop, the stations on them, the poses of the cars, and the
// twisted route of the interlude, verse 2 and chorus 2. Pure functions of constants: no scene, no time.
//
//   イワシ ───────────── C ──┐                 x: along the stem (the train runs toward +x)
//          (the stem)        │   the loop      z: the platforms and the town street lie on +z, the loop on -z
//                      もと  │   R = 100 m     C = (0, 0): the end of the stem, where the scissors cut and the loop joins
//
// The route coordinate `s` is in metres: s <= 0 is the stem (x = s), s > 0 is the loop (the arc from C, round and round).
// Before the loop exists the track ahead of C is straight (x = s).
import * as THREE from 'three';
import { DEG, smooth } from '@pve/engine/util';
import { v3 } from '@pve/engine/lit';
import type { TrackFrame } from '@pve/engine/track';
import { CAR_GAP, CAR_LENGTH } from './_train';

/** The radius of the loop and its length (m). */
export const LOOP_R = 100;
export const LOOP_LEN = 2 * Math.PI * LOOP_R;
/** The centre of the loop (x, z). */
export const LOOP_C = { x: 0, z: -LOOP_R } as const;
/** The far end of the stem (x), and the length of rail that the scissors take out before C. */
export const STEM_X0 = -420;
export const BITE = 3;
/** The steps of the wind (the bend of verse 1), and the length of one step (m). */
export const WIND_STEPS = 48;
export const SEG = LOOP_LEN / WIND_STEPS;

const arc = (deg: number) => (deg / 360) * LOOP_LEN;

export type StationId = 'iwashi' | 'home' | 'q' | 'sunoko' | 'moto';
/** The stations in travel order: the name on the board and the route position of the middle of the platform. */
export const STATIONS: Record<StationId, { name: string; s: number }> = {
  iwashi: { name: 'イワシ', s: -105 },
  home: { name: 'ホーム', s: arc(17) },
  q: { name: '？', s: arc(135) },
  sunoko: { name: 'すのこ', s: arc(235) },
  moto: { name: 'もと', s: arc(300) },
};
export const STATION_IDS = Object.keys(STATIONS) as StationId[];
/** The tunnel: the route positions of its two portals. */
export const TUNNEL = { s0: arc(173), s1: arc(187) } as const;

/** A point of the route: ground x and z, and the yaw of the direction of travel (a `rotation.y`: +x at 0, toward -z as it grows). */
export interface RoutePoint { x: number; z: number; yaw: number }

/** The point of the loop at the angle `a` (rad) from C. */
export function loopAt(a: number): RoutePoint {
  return { x: LOOP_C.x + LOOP_R * Math.sin(a), z: LOOP_C.z + LOOP_R * Math.cos(a), yaw: a };
}

/** The route at `s`. `looped` false: the track ahead of C is still straight. */
export function routePoint(s: number, looped = true): RoutePoint {
  if (s <= 0 || !looped) return { x: s, z: 0, yaw: 0 };
  return loopAt((s % LOOP_LEN) / LOOP_R);
}

/** The pose of a car whose middle is at `s`: it stands on its two bogies (7 m each way), so it follows a curve as a chord. */
export function carPose(s: number, looped = true): RoutePoint {
  const a = routePoint(s + 7, looped), b = routePoint(s - 7, looped);
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, yaw: Math.atan2(-(a.z - b.z), a.x - b.x) };
}

/** The distance between the middles of the two cars. */
export const CAR_PITCH = CAR_LENGTH + CAR_GAP;

/** The world matrix of the front car when its middle is at `s`. */
export function carMatrix(s: number, looped = true): THREE.Matrix4 {
  const c = carPose(s, looped);
  return new THREE.Matrix4().makeRotationY(c.yaw).setPosition(c.x, 0, c.z);
}

/** An arc of the loop about its centre, from the angle `a0` to `a1` (rad), as a curve for `buildTrack`. */
export class ArcCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private a0: number, private a1: number) { super(); }
  override getPoint(u: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = this.a0 + (this.a1 - this.a0) * u;
    return target.set(LOOP_R * Math.sin(a), 0, LOOP_R * Math.cos(a));
  }
}

// ---------------------------------------------------------------- the twist (interlude, verse 2)
//
// The reread of the interlude puts the stem back wrong: it lies across the loop on pillars, from the loop at `CROSS.a` to the loop at
// `CROSS.b`, and it turns over on the way. A train that takes it rides its top, turns with it, hangs under it over the middle of the
// loop, turns on and comes down upright on the far side. The loop and the crossing make a figure of eight.
// The ride of verse 2 is one route: the loop from `RIDE_A0` to the crossing, the crossing, the loop on past Station もと.

/** The crossing: where it leaves the loop and where it joins it again (angles of the loop, degrees), and its height on the pillars (m). */
export const CROSS = { a: 40, b: 205, h: 14 } as const;
const RIDE_A0 = 320, RIDE_A1 = 350;

/** The route of the ride of verse 2, in metres from its start. `at(d)` is the frame of the track there (the up turns with the crossing). */
export interface TwistRoute {
  len: number;
  /** Where the crossing starts and ends. */
  cross: readonly [number, number];
  /** The middle of the platform of each station that the route passes. */
  stations: { home: number; sunoko: number; moto: number };
  at(d: number): TrackFrame;
  /** The world matrix of a car whose middle is at `d`: it stands on its two bogies, 7 m each way. */
  car(d: number): THREE.Matrix4;
}

/** The world matrix of a car whose middle is at `d` on the route `at`: it stands on its two bogies, 7 m each way. */
function carOn(at: (d: number) => TrackFrame, d: number): THREE.Matrix4 {
  const a = at(d + 7), b = at(d - 7), m = at(d);
  const tangent = a.pos.clone().sub(b.pos).normalize();
  const side = tangent.clone().cross(m.up).normalize(), up = side.clone().cross(tangent);
  return new THREE.Matrix4().makeBasis(tangent, up, side).setPosition(a.pos.clone().add(b.pos).multiplyScalar(0.5));
}

/** The points of the ride of verse 2 (about every 0.5 m) with the roll of the track, and the index of the last point of the crossing. */
function twistPoints(): { raw: { p: THREE.Vector3; roll: number }[]; crossRaw: number } {
  const raw: { p: THREE.Vector3; roll: number }[] = [];
  const arc = (a0: number, a1: number, roll: number) => {
    const n = Math.ceil(((a1 - a0) * DEG * LOOP_R) / 0.5);
    for (let k = raw.length ? 1 : 0; k <= n; k++) { const p = loopAt((a0 + ((a1 - a0) * k) / n) * DEG); raw.push({ p: v3(p.x, 0, p.z), roll }); }
  };
  arc(RIDE_A0, 360 + CROSS.a, 0);
  // the crossing: a curve that leaves the loop along its tangent and joins it along its tangent; it rises, turns over, hangs, turns on and comes down
  const A = loopAt(CROSS.a * DEG), B = loopAt(CROSS.b * DEG), K = 34;
  const bez = new THREE.CubicBezierCurve3(
    v3(A.x, 0, A.z), v3(A.x + K * Math.cos(A.yaw), 0, A.z - K * Math.sin(A.yaw)),
    v3(B.x - K * Math.cos(B.yaw), 0, B.z + K * Math.sin(B.yaw)), v3(B.x, 0, B.z),
  );
  const n = Math.ceil(bez.getLength() / 0.5);
  for (let k = 1; k <= n; k++) {
    const u = k / n, p = bez.getPointAt(u);
    p.y = CROSS.h * smooth(u / 0.22) * (1 - smooth((u - 0.78) / 0.22));
    raw.push({ p, roll: Math.PI * (smooth((u - 0.12) / 0.26) + smooth((u - 0.62) / 0.26)) });
  }
  const crossRaw = raw.length - 1;
  arc(CROSS.b, RIDE_A1, 2 * Math.PI);
  return { raw, crossRaw };
}

function buildTwistRoute(): TwistRoute {
  const { raw, crossRaw } = twistPoints();
  // resample at 1 m
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1]! + raw[i]!.p.distanceTo(raw[i - 1]!.p));
  const len = Math.floor(cum[cum.length - 1]!);
  const P: THREE.Vector3[] = [], R: number[] = [];
  for (let d = 0, i = 0; d <= len; d++) {
    while (i + 2 < raw.length && cum[i + 1]! < d) i++;
    const f = Math.min(1, Math.max(0, (d - cum[i]!) / (cum[i + 1]! - cum[i]!)));
    P.push(raw[i]!.p.clone().lerp(raw[i + 1]!.p, f));
    R.push(raw[i]!.roll + (raw[i + 1]!.roll - raw[i]!.roll) * f);
  }
  const frame = (i: number): TrackFrame => {
    const tangent = P[Math.min(len, i + 1)]!.clone().sub(P[Math.max(0, i - 1)]!).normalize();
    const s0 = tangent.clone().cross(v3(0, 1, 0)).normalize(), u0 = s0.clone().cross(tangent);
    const c = Math.cos(R[i]!), s = Math.sin(R[i]!);
    return { pos: P[i]!, tangent, side: s0.clone().multiplyScalar(c).addScaledVector(u0, -s), up: u0.clone().multiplyScalar(c).addScaledVector(s0, s) };
  };
  const F = P.map((_, i) => frame(i));
  const at = (d: number): TrackFrame => {
    const x = Math.min(len - 1e-6, Math.max(0, d)), i = Math.floor(x), f = x - i, a = F[i]!, b = F[i + 1]!;
    return { pos: a.pos.clone().lerp(b.pos, f), tangent: a.tangent.clone().lerp(b.tangent, f).normalize(), side: a.side.clone().lerp(b.side, f).normalize(), up: a.up.clone().lerp(b.up, f).normalize() };
  };
  const c0 = (360 + CROSS.a - RIDE_A0) * DEG * LOOP_R, c1 = cum[crossRaw]!;
  const after = (deg: number) => c1 + (deg - CROSS.b) * DEG * LOOP_R;
  return {
    len, cross: [c0, c1], at,
    stations: { home: STATIONS.home.s + (360 - RIDE_A0) * DEG * LOOP_R, sunoko: after(235), moto: after(300) },
    car: (d: number) => carOn(at, d),
  };
}

let twistRoute: TwistRoute | null = null;
/** The route of the ride of verse 2 (built once). */
export function twist(): TwistRoute {
  if (!twistRoute) twistRoute = buildTwistRoute();
  return twistRoute;
}

/**
 * The lap of the twisted world (chorus 2): the crossing, then the loop from the end of the crossing round to its start. `l` is in metres
 * from the start of the crossing and wraps at `len`.
 */
export interface TwistLap {
  len: number;
  /** The length of the crossing: the lap is on the crossing for l in [0, cross). */
  cross: number;
  /** The middle of the platform of each station that the lap passes. */
  stations: { sunoko: number; moto: number; home: number };
  at(l: number): TrackFrame;
  /** The world matrix of a car whose middle is at `l`: it stands on its two bogies, 7 m each way. */
  car(l: number): THREE.Matrix4;
  /** The angle of the loop (degrees from C) of the point of the loop nearest to the lap at `l`: on the crossing it goes from `CROSS.a` to `CROSS.b` evenly. */
  angle(l: number): number;
}

function buildTwistLap(): TwistLap {
  const r = twist(), [c0, c1] = r.cross;
  const cross = c1 - c0, arcLen = (360 + CROSS.a - CROSS.b) * DEG * LOOP_R, len = cross + arcLen;
  const wrap = (l: number) => ((l % len) + len) % len;
  // the route of verse 2 has the loop in two parts: from `CROSS.b` to `RIDE_A1` after the crossing, and from `RIDE_A0` to `CROSS.a` before it
  const SWITCH = RIDE_A1 - 5;
  const at = (l: number): TrackFrame => {
    const x = wrap(l);
    if (x < cross) return r.at(c0 + x);
    const deg = CROSS.b + (x - cross) / (DEG * LOOP_R);
    return r.at(deg <= SWITCH ? c1 + (x - cross) : (deg - RIDE_A0) * DEG * LOOP_R);
  };
  const after = (deg: number) => cross + (deg - CROSS.b) * DEG * LOOP_R;
  return {
    len, cross, at,
    stations: { sunoko: after(235), moto: after(300), home: after(360 + 17) },
    car: (l: number) => carOn(at, l),
    angle: (l: number) => {
      const x = wrap(l);
      return x < cross ? CROSS.a + ((CROSS.b - CROSS.a) * x) / cross : CROSS.b + (x - cross) / (DEG * LOOP_R);
    },
  };
}

let twistLapOnce: TwistLap | null = null;
/** The lap of the twisted world (built once). */
export function twistLap(): TwistLap {
  if (!twistLapOnce) twistLapOnce = buildTwistLap();
  return twistLapOnce;
}

/** The straight of chorus 3 leaves the loop at this angle (degrees from C): past Station ホーム, before the crossing. */
export const EXIT_DEG = 33;
/** Where the straight of chorus 3 leaves the loop: its place on one lap of `twistLap` (m), its point and its heading. */
export function c3Exit(): { on: number; pos: THREE.Vector3; tangent: THREE.Vector3 } {
  const lap = twistLap(), on = lap.cross + ((EXIT_DEG + 360 - CROSS.b) % 360) * DEG * LOOP_R, f = lap.at(on);
  return { on, pos: f.pos, tangent: f.tangent };
}

/** A part of the route of verse 2 as a curve, for `buildTrack`. */
export class RouteCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private r: TwistRoute, private d0: number, private d1: number) {
    super();
    this.arcLengthDivisions = Math.ceil(d1 - d0);
  }

  override getPoint(u: number, target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.r.at(this.d0 + u * (this.d1 - this.d0)).pos);
  }
}
