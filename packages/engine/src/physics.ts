// Baked rigid-body physics (Rapier, deterministic build). A scene calls `bake` once in init(): the world
// steps at a fixed rate, every pose goes into one Float32Array, and the world is freed. After that a
// frame is a pure function of song time: `pose(i, t)` samples the stored steps. No wall clock, no
// Math.random, fixed insertion order, so a bake gives the same bytes every run.
import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import * as THREE from 'three';
import { digest, memo } from './memo';

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

export type ShapeSpec = (
  | { kind: 'box'; half: Vec3 }
  | { kind: 'ball'; r: number }
  | { kind: 'capsule'; halfHeight: number; r: number }
  | { kind: 'hull'; points: Float32Array }
) & {
  /** Offset of the shape in the body frame (compound bodies). */
  local?: Pose;
};

/** Position and rotation. `q` is x, y, z, w. */
export interface Pose {
  p: Vec3;
  q: Quat;
}

export interface BodySpec {
  /** One shape, or several for a compound body. */
  shape: ShapeSpec | ShapeSpec[];
  /** Pose at `t0`. */
  pose: Pose;
  /** Default `dynamic`. */
  type?: 'dynamic' | 'fixed' | 'kinematic';
  /** Kinematic bodies: the pose at song time t. Must be a pure function. */
  drive?: (t: number) => Pose;
  vel?: Vec3;
  spin?: Vec3;
  density?: number;
  friction?: number;
  restitution?: number;
  /** Linear, angular. */
  damping?: [number, number];
  gravityScale?: number;
  /**
   * A dynamic body stays kinematic (at `pose`, or on `drive`) until this song time. Then it is released
   * with the velocity of `drive` (finite difference) or `vel` and `spin`.
   */
  wakeAt?: number;
}

export interface BakeSpec {
  t0: number;
  t1: number;
  /** Simulation and storage rate. Default 120. */
  hz?: number;
  /** Default [0, -9.81, 0]. */
  gravity?: Vec3;
  bodies: BodySpec[];
}

let ready: Promise<void> | null = null;

/** Axis-angle velocity that turns q0 into q1 in dt seconds. */
function spinBetween(q0: Quat, q1: Quat, dt: number): Vec3 {
  const a = new THREE.Quaternion(q0[0], q0[1], q0[2], q0[3]);
  const d = new THREE.Quaternion(q1[0], q1[1], q1[2], q1[3]).multiply(a.invert());
  if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w);
  const s = Math.hypot(d.x, d.y, d.z);
  if (s < 1e-12) return [0, 0, 0];
  const k = (2 * Math.atan2(s, d.w)) / (s * dt);
  return [d.x * k, d.y * k, d.z * k];
}

function colliderDesc(s: ShapeSpec): RAPIER.ColliderDesc {
  let d: RAPIER.ColliderDesc | null;
  switch (s.kind) {
    case 'box': d = RAPIER.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2]); break;
    case 'ball': d = RAPIER.ColliderDesc.ball(s.r); break;
    case 'capsule': d = RAPIER.ColliderDesc.capsule(s.halfHeight, s.r); break;
    case 'hull': d = RAPIER.ColliderDesc.convexHull(s.points); break;
  }
  if (!d) throw new Error('physics: convex hull of the given points failed');
  if (s.local) {
    d.setTranslation(s.local.p[0], s.local.p[1], s.local.p[2]);
    d.setRotation({ x: s.local.q[0], y: s.local.q[1], z: s.local.q[2], w: s.local.q[3] });
  }
  return d;
}

/** What `simulate` stores: the fields of a Baked (structured-clonable, for the memo). */
interface BakedData { data: Float32Array; base: Uint32Array; fixed: Uint8Array; hits: Float64Array; count: number; t0: number; t1: number; hz: number; steps: number }

/**
 * Simulate `spec` once and return the stored poses. Frees the Rapier world before it returns. With a memo store (the
 * studio) a spec seen before is not simulated again: the key is the whole input (every number of the spec, every pose
 * its drives give at the times the simulation asks for, the code of this module and the Rapier version).
 */
export async function bake(spec: BakeSpec): Promise<Baked> {
  const hz = spec.hz ?? 120;
  const { t0, t1 } = spec;
  if (!(t1 > t0)) throw new Error(`physics: t1 (${t1}) must be after t0 (${t0})`);
  const steps = Math.ceil((t1 - t0) * hz - 1e-9);
  await (ready ??= RAPIER.init());
  const key = await digest([RAPIER.version(), simulate.toString(), colliderDesc.toString(), spinBetween.toString(), specNumbers(spec, hz, steps)]);
  const d = await memo(`physics|${t0}|${t1}|${hz}|${spec.bodies.length}`, key, () => simulate(spec, hz, steps));
  return new Baked(d.data, d.base, d.fixed, d.hits, d.count, d.t0, d.t1, d.hz, d.steps);
}

/** Every number `simulate(spec)` reads, in a fixed order (with a presence flag for each optional field). */
function specNumbers(spec: BakeSpec, hz: number, steps: number): Float64Array {
  const out: number[] = [spec.t0, spec.t1, hz, steps];
  const opt = (x: number | undefined) => { if (x === undefined) out.push(0); else out.push(1, x); };
  const vec = (v: readonly number[] | undefined) => { if (v === undefined) out.push(0); else out.push(1, v.length, ...v); };
  const pose = (p: Pose) => out.push(...p.p, ...p.q);
  const KIND = { box: 1, ball: 2, capsule: 3, hull: 4 } as const;
  const TYPE = { dynamic: 1, fixed: 2, kinematic: 3 } as const;
  vec(spec.gravity);
  const dt = 1 / hz;
  for (const b of spec.bodies) {
    const shapes = Array.isArray(b.shape) ? b.shape : [b.shape];
    out.push(TYPE[b.type ?? 'dynamic'], shapes.length);
    for (const s of shapes) {
      out.push(KIND[s.kind]);
      if (s.kind === 'box') out.push(...s.half);
      else if (s.kind === 'ball') out.push(s.r);
      else if (s.kind === 'capsule') out.push(s.halfHeight, s.r);
      else out.push(s.points.length, ...s.points);
      if (s.local) { out.push(1); pose(s.local); } else out.push(0);
    }
    pose(b.pose);
    vec(b.vel); vec(b.spin); vec(b.damping);
    opt(b.density); opt(b.friction); opt(b.restitution); opt(b.gravityScale); opt(b.wakeAt);
    // the drive at every time simulate can call it, written as simulate writes them: t0 + k * dt, and that minus dt
    if (b.drive && b.type !== 'fixed') {
      out.push(1);
      for (let k = 0; k <= steps; k++) {
        const tk = spec.t0 + k * dt;
        pose(b.drive(tk));
        pose(b.drive(tk - dt));
      }
    } else out.push(0);
  }
  return new Float64Array(out);
}

async function simulate(spec: BakeSpec, hz: number, steps: number): Promise<BakedData> {
  const dt = 1 / hz;
  const { t0 } = spec;
  const g = spec.gravity ?? [0, -9.81, 0];
  const world = new RAPIER.World({ x: g[0], y: g[1], z: g[2] });
  world.integrationParameters.dt = dt;
  const events = new RAPIER.EventQueue(true);
  const n = spec.bodies.length;
  const bodies: RAPIER.RigidBody[] = [];
  const owner = new Map<number, number>(); // collider handle -> body index
  const held = new Uint8Array(n); // body is kinematic now, becomes dynamic at wakeAt
  const fixed = new Uint8Array(n);
  const hit = new Float64Array(n).fill(Infinity);

  for (let i = 0; i < n; i++) {
    const b = spec.bodies[i];
    const type = b.type ?? 'dynamic';
    const start = b.drive && type !== 'fixed' ? b.drive(t0) : b.pose;
    let desc: RAPIER.RigidBodyDesc;
    if (type === 'fixed') { desc = RAPIER.RigidBodyDesc.fixed(); fixed[i] = 1; }
    else if (type === 'kinematic') desc = RAPIER.RigidBodyDesc.kinematicPositionBased();
    else if (b.wakeAt !== undefined) { desc = RAPIER.RigidBodyDesc.kinematicPositionBased(); held[i] = 1; }
    else desc = RAPIER.RigidBodyDesc.dynamic();
    desc.setTranslation(start.p[0], start.p[1], start.p[2]);
    desc.setRotation({ x: start.q[0], y: start.q[1], z: start.q[2], w: start.q[3] });
    if (type === 'dynamic') {
      if (b.vel && b.wakeAt === undefined) desc.setLinvel(b.vel[0], b.vel[1], b.vel[2]);
      if (b.spin && b.wakeAt === undefined) desc.setAngvel({ x: b.spin[0], y: b.spin[1], z: b.spin[2] });
      if (b.damping) desc.setLinearDamping(b.damping[0]).setAngularDamping(b.damping[1]);
      if (b.gravityScale !== undefined) desc.setGravityScale(b.gravityScale);
    }
    const body = world.createRigidBody(desc);
    bodies.push(body);
    for (const s of Array.isArray(b.shape) ? b.shape : [b.shape]) {
      const cd = colliderDesc(s).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      if (b.density !== undefined) cd.setDensity(b.density);
      if (b.friction !== undefined) cd.setFriction(b.friction);
      if (b.restitution !== undefined) cd.setRestitution(b.restitution);
      owner.set(world.createCollider(cd, body).handle, i);
    }
  }

  // Storage: a fixed body keeps one sample, every other body one per step (steps + 1 samples).
  const samples = steps + 1;
  const base = new Uint32Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) { base[i] = total; total += fixed[i] ? 7 : 7 * samples; }
  const data = new Float32Array(total);
  const store = (i: number, k: number) => {
    const body = bodies[i];
    const p = body.translation(), q = body.rotation();
    const o = base[i] + (fixed[i] ? 0 : 7 * k);
    data[o] = p.x; data[o + 1] = p.y; data[o + 2] = p.z;
    data[o + 3] = q.x; data[o + 4] = q.y; data[o + 5] = q.z; data[o + 6] = q.w;
  };

  try {
    for (let i = 0; i < n; i++) store(i, 0);
    for (let k = 0; k < steps; k++) {
      const tk = t0 + k * dt, tn = t0 + (k + 1) * dt;
      for (let i = 0; i < n; i++) {
        const b = spec.bodies[i], body = bodies[i];
        if (held[i] && tk >= b.wakeAt!) {
          // Release with the velocity the body has now: drive's backward difference, or vel and spin.
          let v: Vec3 = b.vel ?? [0, 0, 0], w: Vec3 = b.spin ?? [0, 0, 0];
          if (b.drive) {
            const a = b.drive(tk - dt), c = b.drive(tk);
            v = [(c.p[0] - a.p[0]) / dt, (c.p[1] - a.p[1]) / dt, (c.p[2] - a.p[2]) / dt];
            w = spinBetween(a.q, c.q, dt);
          }
          held[i] = 0;
          body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
          if (b.damping) { body.setLinearDamping(b.damping[0]); body.setAngularDamping(b.damping[1]); }
          if (b.gravityScale !== undefined) body.setGravityScale(b.gravityScale, true);
          body.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
          body.setAngvel({ x: w[0], y: w[1], z: w[2] }, true);
        } else if (held[i] || b.type === 'kinematic') {
          const pz = b.drive ? b.drive(tn) : b.pose;
          body.setNextKinematicTranslation({ x: pz.p[0], y: pz.p[1], z: pz.p[2] });
          body.setNextKinematicRotation({ x: pz.q[0], y: pz.q[1], z: pz.q[2], w: pz.q[3] });
        }
      }
      world.step(events);
      events.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        for (const h of [h1, h2]) {
          const i = owner.get(h);
          if (i !== undefined && !held[i] && tn < hit[i]) hit[i] = tn;
        }
      });
      for (let i = 0; i < n; i++) if (!fixed[i]) store(i, k + 1);
    }
  } finally {
    events.free();
    world.free();
  }
  return { data, base, fixed, hits: hit, count: n, t0, t1: spec.t1, hz, steps };
}

/** Stored result of `bake`. Sampling is a pure function of song time. */
export class Baked {
  readonly count: number;
  readonly t0: number;
  readonly t1: number;
  /** Stored rate in Hz. */
  readonly hz: number;
  /** Steps stored after the first sample. Each moving body has `steps + 1` poses of 7 floats. */
  readonly steps: number;
  /** x, y, z, qx, qy, qz, qw for each stored pose. Fixed bodies keep one pose. */
  readonly data: Float32Array;
  private readonly base: Uint32Array;
  private readonly fixed: Uint8Array;
  private readonly hits: Float64Array;

  /** @internal Use `bake`. */
  constructor(data: Float32Array, base: Uint32Array, fixed: Uint8Array, hits: Float64Array, count: number, t0: number, t1: number, hz: number, steps: number) {
    this.data = data; this.base = base; this.fixed = fixed; this.hits = hits;
    this.count = count; this.t0 = t0; this.t1 = t1; this.hz = hz; this.steps = steps;
  }

  /** Pose of body i at song time t: linear in position, normalised linear in rotation. Clamps outside the baked range. */
  pose(i: number, t: number, p: THREE.Vector3, q: THREE.Quaternion): void {
    const d = this.data, o = this.base[i];
    if (this.fixed[i]) {
      p.set(d[o], d[o + 1], d[o + 2]);
      q.set(d[o + 3], d[o + 4], d[o + 5], d[o + 6]);
      return;
    }
    let s = (t - this.t0) * this.hz;
    if (!(s > 0)) s = 0; else if (s > this.steps) s = this.steps;
    let k = Math.floor(s);
    if (k >= this.steps) k = this.steps - 1;
    const f = s - k;
    const a = o + 7 * k;
    if (f === 0) {
      p.set(d[a], d[a + 1], d[a + 2]);
      q.set(d[a + 3], d[a + 4], d[a + 5], d[a + 6]);
      return;
    }
    const b = a + 7;
    p.set(d[a] + (d[b] - d[a]) * f, d[a + 1] + (d[b + 1] - d[a + 1]) * f, d[a + 2] + (d[b + 2] - d[a + 2]) * f);
    const dot = d[a + 3] * d[b + 3] + d[a + 4] * d[b + 4] + d[a + 5] * d[b + 5] + d[a + 6] * d[b + 6];
    const sg = dot < 0 ? -1 : 1;
    const x = d[a + 3] + (sg * d[b + 3] - d[a + 3]) * f;
    const y = d[a + 4] + (sg * d[b + 4] - d[a + 4]) * f;
    const z = d[a + 5] + (sg * d[b + 5] - d[a + 5]) * f;
    const w = d[a + 6] + (sg * d[b + 6] - d[a + 6]) * f;
    const l = 1 / Math.hypot(x, y, z, w);
    q.set(x * l, y * l, z * l, w * l);
  }

  matrix(i: number, t: number, m: THREE.Matrix4, scale: THREE.Vector3 = ONE): THREE.Matrix4 {
    this.pose(i, t, P, Q);
    return m.compose(P, Q, scale);
  }

  /** Write bodies `first` to `first + mesh.count - 1` into the instance matrices and flag the upload. */
  instances(mesh: THREE.InstancedMesh, t: number, first = 0): void {
    const n = mesh.count;
    if (first < 0 || first + n > this.count) throw new Error(`physics: instances ${first}..${first + n} outside ${this.count} bodies`);
    for (let j = 0; j < n; j++) mesh.setMatrixAt(j, this.matrix(first + j, t, M));
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Song time of the first contact of body i with another collider. Infinity if none. */
  hit(i: number): number {
    return this.hits[i];
  }
}

const ONE = new THREE.Vector3(1, 1, 1);
const P = new THREE.Vector3();
const Q = new THREE.Quaternion();
const M = new THREE.Matrix4();
