// The flight of the train in the bridge (clip bridge, 56.0-85.333 s, treatment v6 "Plate 5"). Pure maths: every function is a
// pure function of song time, so a frame depends only on t.
//
// World frame: x along the line, y up, z to the camera's side. The cameras all stand on the +z side and look toward -z.
//  1. 56.000-56.889  Rails. The train comes out of the tunnel mouth at x = 0 at 40 m/s and climbs the wooden ramp (20 degrees).
//  2. 56.889-68.900  The ramp ends at x = 34. The train flies: the speed eases from 40 to 22 m/s, the pitch from 20 degrees to 0.
//  3. 68.900-71.111  The wind stops. The train stalls in the air and hangs (weightless over the bar 40 fill).
//  4. 71.111-74.650  The drums are gravity: the nose drops, the train falls hard through the cloud layer and pulls out.
//  5. 74.650-85.100  The climb to the moon. The nose touches the impact point S on the disc at T_DIVE; the train keeps its heading and goes in until the hard cut.
import * as THREE from 'three';
import { clamp01, lerp, smooth } from '@pve/engine/util';
import { v3 } from '@pve/engine/lit';
import { BAR } from './_time';

export const T_START = 56.0;
export const T_LAUNCH = 32 * BAR;
export const T_WIND = 68.9;
export const T_FILL = 39 * BAR;
export const T_DROP = 40 * BAR;
export const T_PULL = 73.65;
export const T_CLIMB = 74.65;
export const T_MOON = 76.0;
export const T_DIVE = 85.1;
export const T_END = 48 * BAR;
/** 56.000: the tunnel mouth and the first frame of the bridge; the corner map window opens here. */
export const T_PORTAL = 56.0;
/** 61.780: the ride cam has reached the flat side view. The arm swings from the chase over the beat before, between line 13 and line 14. */
export const T_SWING = 61.78;
/** 81.500: the hip view starts its push to the close-up of the nose. */
export const T_NOSE = 81.5;
/** The six flower walls: the six syllables of line 13 (は な は か れ ず). The nose of the train reaches each wall on its syllable. The first one stands on the ramp. */
export const T_WALLS = [56.444, 56.889, 57.78, 58.66, 59.54, 60.44] as const;


// ---------------------------------------------------------------- the ramp

const K20 = Math.tan(THREE.MathUtils.degToRad(20));
export const RAMP_X0 = 6;
export const RAMP_X1 = 16;
/** The end of the unfinished ramp: the train leaves the rails here at T_LAUNCH. */
export const RAMP_END = 34;
const RAMP_A = K20 / (2 * (RAMP_X1 - RAMP_X0));

/** The rail height over the ground plane at x: flat, a vertical curve, then the 20 degree slope. */
export function rampY(x: number): number {
  if (x <= RAMP_X0) return 0;
  if (x <= RAMP_X1) return RAMP_A * (x - RAMP_X0) ** 2;
  return RAMP_A * (RAMP_X1 - RAMP_X0) ** 2 + K20 * (x - RAMP_X1);
}

/** The slope (dy/dx) of the rail at x. */
export function rampSlope(x: number): number {
  if (x <= RAMP_X0) return 0;
  if (x <= RAMP_X1) return (K20 * (x - RAMP_X0)) / (RAMP_X1 - RAMP_X0);
  return K20;
}

// ---------------------------------------------------------------- the pose

export interface TrainPose {
  p: THREE.Vector3;
  /** The velocity in m/s. */
  v: THREE.Vector3;
  /** Rotation about y, about z (nose up) and about x (roll), radians. Order YZX. */
  yaw: number;
  pitch: number;
  roll: number;
  /** True while the wheels are on the rails. */
  rails: boolean;
}

const V_RAILS = 40;
/** Speed of the flight: a constant and a part that decays; the pitch decays the same way. */
const A1 = 22, A2 = 18, T1 = 1.5, T2 = 1.6;
const T_STALL = 0.28;

const euler = new THREE.Euler(0, 0, 0, 'YZX');

/** The moon of the bridge: the disc, the impact point S of the ram and the fixed camera that looks across the peaks. */
export interface MoonPlan {
  /** The impact point of the ram at T_DIVE, on the face of the disc. */
  scratch: THREE.Vector3;
  centre: THREE.Vector3;
  /** The unit normal of the disc face (towards the camera). */
  normal: THREE.Vector3;
  radius: number;
}

/** The radius of the moon disc, m. From the hip view at 76.0 it fills two thirds of the height of the frame, and it grows from there. */
const MOON_R = 60;

interface HKey { t: number; p: THREE.Vector3; v: THREE.Vector3 }

export class TrainPath {
  private readonly xl: number;
  private readonly yl: number;
  private keys: HKey[] = [];
  private end: HKey;
  readonly moon: MoonPlan;
  /** Where the stall starts and ends (for the scene to place the cloud layer). */
  readonly stall: { from: THREE.Vector3; to: THREE.Vector3 };

  constructor() {
    this.xl = 24.6;
    this.yl = rampY(this.xl);
    const d = this.hover(T_DROP);
    const P = (dx: number, dy: number) => v3(d.p.x + dx, d.p.y + dy, 0);
    const V = (x: number, y: number) => v3(x, y, 0);
    this.keys = [
      { t: T_DROP, p: d.p.clone(), v: v3(d.v.x, d.v.y, 0) },
      { t: 71.65, p: P(0.3, -3.2), v: V(0.5, -13) },
      { t: 72.35, p: P(1.2, -18.0), v: V(1.0, -29.8) },
      { t: 72.9, p: P(3.0, -37.6), v: V(6, -43) },
      { t: T_PULL, p: P(15, -61.5), v: V(34, 0) },
      { t: T_CLIMB, p: P(52, -53.5), v: V(38, 13) },
    ];
    const p5 = this.keys[5]!.p;
    const S = p5.clone().add(v3(215, 100, 5));
    const dir = S.clone().sub(p5).normalize();
    // at T_DIVE the nose (10 m ahead of the middle of the car) touches the impact point S on the disc
    this.end = { t: T_DIVE, p: S.clone().addScaledVector(dir, -10), v: dir.clone().multiplyScalar(S.distanceTo(p5) / (T_DIVE - T_CLIMB)) };
    this.keys.push(this.end);
    this.stall = { from: this.flight(T_WIND).p.clone(), to: d.p.clone() };

    // the moon: the disc faces the approaching train head-on (its normal is the reverse of the heading) and its plane holds the
    // impact point S, half a radius from the middle of the disc.
    const normal = dir.clone().negate();
    const right = v3(0, 1, 0).cross(normal).normalize();
    const up = normal.clone().cross(right);
    const centre = S.clone().addScaledVector(right, 0.4 * MOON_R).addScaledVector(up, 0.3 * MOON_R);
    this.moon = { scratch: S, centre, normal, radius: MOON_R };
  }

  // ---- sections

  private rails(t: number): TrainPose {
    const x = this.xl + V_RAILS * (t - T_LAUNCH);
    // the car is rigid: its pitch is the mean slope under its 18.8 m
    let m = 0;
    for (let k = -4; k <= 4; k++) m += rampSlope(x + 2.35 * k);
    return {
      p: v3(x, rampY(x), 0), v: v3(V_RAILS, V_RAILS * rampSlope(x), 0),
      yaw: 0, pitch: Math.atan(m / 9), roll: 0, rails: true,
    };
  }

  private flight(t: number): TrainPose {
    const s = t - T_LAUNCH;
    const e1 = Math.exp(-s / T1), e2 = Math.exp(-s / T2);
    const k = 1 / T1 + 1 / T2;
    const x = this.xl + A1 * s + A2 * T1 * (1 - e1);
    const y = this.yl + K20 * (A1 * T2 * (1 - e2) + (A2 / k) * (1 - Math.exp(-s * k)));
    const vx = A1 + A2 * e1;
    const q = K20 * e2;
    const roll = 0.03 * Math.sin(1.1 * s) * smooth(s / 1.5) * (1 - smooth((t - 66) / 2.5));
    return { p: v3(x, y, 0), v: v3(vx, vx * q, 0), yaw: 0, pitch: Math.atan(q), roll, rails: false };
  }

  /** The stall and the weightless hang (68.9 to 71.111): the speed dies in 0.3 s, then the train floats and slowly turns. */
  private hover(t: number): TrainPose {
    const b = this.flight(T_WIND);
    const s = t - T_WIND;
    const ek = Math.exp(-s / T_STALL);
    const x = b.p.x + b.v.x * T_STALL * (1 - ek);
    const y = b.p.y + 0.25 * s;
    const f = t - T_FILL;
    const g = smooth(f / 0.4);
    const roll = 0.13 * Math.sin(1.25 * f) * g;
    const pitch = b.pitch + 0.05 * smooth(s / 0.5) + 0.04 * Math.sin(1.9 * f) * g;
    return { p: v3(x, y, 0), v: v3(b.v.x * ek, 0.25, 0), yaw: 0, pitch, roll, rails: false };
  }

  private hermite(t: number): { p: THREE.Vector3; v: THREE.Vector3 } {
    const K = this.keys;
    let i = 0;
    while (i + 2 < K.length && K[i + 1]!.t <= t) i++;
    const a = K[i]!, b = K[i + 1]!;
    const T = b.t - a.t;
    const s = clamp01((t - a.t) / T);
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    const d00 = 6 * s2 - 6 * s, d10 = 3 * s2 - 4 * s + 1, d01 = -6 * s2 + 6 * s, d11 = 3 * s2 - 2 * s;
    const p = new THREE.Vector3(), v = new THREE.Vector3();
    p.addScaledVector(a.p, h00).addScaledVector(a.v, h10 * T).addScaledVector(b.p, h01).addScaledVector(b.v, h11 * T);
    v.addScaledVector(a.p, d00 / T).addScaledVector(a.v, d10).addScaledVector(b.p, d01 / T).addScaledVector(b.v, d11);
    return { p, v };
  }

  /** The pose of the train at song time t (any t: it extends the rails before 56.0 and the heading after the dive). */
  at(t: number): TrainPose {
    if (t < T_LAUNCH) return this.rails(t);
    if (t < T_WIND) return this.flight(t);
    if (t < T_DROP) return this.hover(t);
    const stall = this.hover(T_DROP);
    let p: THREE.Vector3, v: THREE.Vector3;
    if (t <= T_DIVE) ({ p, v } = this.hermite(t));
    else { v = this.end.v.clone(); p = this.end.p.clone().addScaledVector(v, t - T_DIVE); }
    const heading = Math.atan2(v.y, Math.hypot(v.x, v.z));
    const yaw = Math.atan2(-v.z, v.x);
    // the nose drops over 0.9 s (blending the stall pitch into the heading), then it follows the velocity
    const w = smooth((t - T_DROP) / 0.9);
    const pitch = lerp(stall.pitch, heading, w);
    const fall = smooth((t - T_DROP) / 0.3) * (1 - smooth((t - T_PULL) / 0.8));
    const roll = stall.roll * (1 - smooth((t - T_DROP) / 0.5)) + 0.22 * Math.sin(2.6 * (t - T_DROP)) * fall + 0.06 * Math.sin(0.9 * (t - T_CLIMB)) * smooth((t - T_CLIMB) / 1.2);
    return { p, v, yaw: t > T_PULL ? yaw : 0, pitch, roll, rails: false };
  }

  /** The speed in m/s at t. */
  speed(t: number): number { return this.at(t).v.length(); }

  /** The matrix of the train kit's root at t. `damp` < 1 turns the body less (the camera arm keeps the horizon better than the train does). */
  matrix(t: number, damp = 1): THREE.Matrix4 {
    const a = this.at(t);
    euler.set(a.roll * damp, a.yaw, a.pitch * damp, 'YZX');
    return new THREE.Matrix4().makeRotationFromEuler(euler).setPosition(a.p);
  }

  /** How much of the body's turn the camera arm follows: all, except through the fall. */
  armDamp(t: number): number {
    return 1 - 0.5 * smooth((t - T_DROP) / 0.3) * (1 - smooth((t - T_PULL - 0.3) / 0.9));
  }

  /** The camera arm's pose at t. */
  armMatrix(t: number): THREE.Matrix4 { return this.matrix(t, this.armDamp(t)); }
}
