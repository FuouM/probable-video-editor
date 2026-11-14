// The jellyfish of sardine v7 (treatment "The jellyfish"): about as tall as a person, a small bell, long tentacles, pale blue and
// emissive. 3D low-poly, the same render style as `_fish.ts` and `_tuna.ts` (flat shaded facets from a `LitAtlas`, `litMaterial`).
// Local frame of the model: y up, the rim of the bell at the origin, the tentacles hang down to y = -1.43 at size 1.
//
//  - `Jellyfish.drift(t, p, { v?, yaw? })`: floats at p. The bell pulses, the tentacles trail behind a velocity.
//  - `Jellyfish.hold(t, bar, o?)`: the desktop buddy: the bell sits on a title bar, two tentacles grab its ends, the others hang in
//    front of the window. `bar` is a world rectangle edge (`JellyBar`).
//  - `Jellyfish.holdWindow(t, cam, rect, depth, o?)`: the same, with the bar from a screen rectangle of the 640 x 360 frame, at a
//    distance `depth` (m) in front of the camera.
//  - `screenPoint(cam, sx, sy, depth)`: the world point at a screen position and a depth.
// A pose depends on t and the arguments alone: the tentacles are curves of t (a wave that runs down them), written into two
// InstancedMeshes once per call; nothing is kept between frames and no geometry is rebuilt. The pale blue is the colour of this
// creature only: no other element of the video uses it.
import * as THREE from 'three';
import { Builder, LH, LW, allFaces, instanced, v3, type Face, type LitAtlas } from '@pve/engine/lit';

/** The height of the jellyfish at size 1 (m): the bell and its longest tentacle. */
export const JELLY_HEIGHT = 1.68;

const SIDES = 10;
const RIM = 0.31;
/** The bell profile [radius, y] from the crown to the rim. */
const PROFILE: [number, number][] = [[0, 0.25], [0.11, 0.235], [0.21, 0.19], [0.275, 0.115], [0.3, 0.04], [RIM, -0.03]];
const LONG = 10, LONG_SEG = 10, LONG_LEN = 1.4;
const ARMS = 4, ARM_SEG = 6, ARM_LEN = 0.62;
/** Seconds of one pulse of the bell. */
const PULSE = 2.4;
/** The angular speed of the tentacle wave (rad/s). */
const WAVE = 1.6;

const UP = new THREE.Vector3(0, 1, 0);

/** The contraction of the bell at time t, 0..1: a quick squeeze (0.22 of the period), a slow relax. */
export function pulse(t: number): number {
  const u = (((t / PULSE) % 1) + 1) % 1;
  return u < 0.22 ? Math.sin((u / 0.22) * Math.PI * 0.5) : Math.cos(((u - 0.22) / 0.78) * Math.PI * 0.5) ** 2;
}

interface JellyGeo { bell: THREE.BufferGeometry; long: THREE.BufferGeometry; arm: THREE.BufferGeometry }
const cache = new WeakMap<LitAtlas, Record<string, JellyGeo>>();

/** One face (a triangle or a quad), turned so that its normal points to `dir`. */
function face(b: Builder, f: Face, dir: THREE.Vector3, ...p: THREE.Vector3[]) {
  const n = p[1]!.clone().sub(p[0]!).cross(p[2]!.clone().sub(p[0]!));
  const q = n.dot(dir) >= 0 ? p : p.length === 4 ? [p[0]!, p[3]!, p[2]!, p[1]!] : [p[0]!, p[2]!, p[1]!];
  if (q.length === 4) b.quad(q[0]!, q[1]!, q[2]!, q[3]!, f);
  else b.tri(q[0]!, q[1]!, q[2]!, f);
}

function geometry(A: LitAtlas, glow: number): JellyGeo {
  const key = `${glow}`;
  const hit = cache.get(A)?.[key];
  if (hit) return hit;
  const f = (c: string, emit: number): Face => ({ cell: A.solid(c, emit * glow) });
  const crown = f('#9fdcff', 1.8), bandA = f('#7cc8f4', 1.4), bandB = f('#8fd2f8', 1.55), lip = f('#d6f2ff', 2.4), under = f('#4f9ad6', 0.9);
  const ring = (k: number, j: number) => {
    const a = (j / SIDES) * Math.PI * 2, [r, y] = PROFILE[k]!;
    return v3(r * Math.cos(a), y, r * Math.sin(a));
  };
  const b = new Builder(32);
  const axis = v3(0, 0.05, 0);
  for (let k = 0; k + 1 < PROFILE.length; k++) {
    for (let j = 0; j < SIDES; j++) {
      const cell = k < 2 ? crown : j % 2 ? bandA : bandB;
      const hi = ring(k, j), hi1 = ring(k, j + 1), lo = ring(k + 1, j), lo1 = ring(k + 1, j + 1);
      const mid = hi.clone().add(hi1).add(lo).add(lo1).multiplyScalar(0.25);
      const out = mid.clone().sub(axis);
      if (k === 0) face(b, cell, out, hi, lo1, lo);
      else face(b, cell, out, lo, lo1, hi1, hi);
    }
  }
  // the underside of the bell, a dome seen from below, and the lappets that hang from the rim (seen from both sides)
  const last = PROFILE.length - 1;
  for (let j = 0; j < SIDES; j++) {
    const a = ring(last, j), a1 = ring(last, j + 1);
    face(b, under, v3(0, -1, 0), v3(0, 0.08, 0), a, a1);
    const tip = a.clone().add(a1).multiplyScalar(0.5).add(v3(0, -0.06, 0));
    const out = v3(tip.x, 0, tip.z);
    face(b, lip, out, a, a1, tip);
    face(b, lip, out.clone().negate(), a, a1, tip);
  }
  // a tentacle is a unit box along +y: an instance stretches it between two points
  const seg = (cell: Face) => { const s = new Builder(32); s.box(1, 1, 1, allFaces(cell)); return s.geometry(); };
  const out: JellyGeo = { bell: b.geometry(), long: seg(f('#8fd8ff', 1.1)), arm: seg(f('#e2f6ff', 1.8)) };
  const mine = cache.get(A) ?? {};
  mine[key] = out;
  cache.set(A, mine);
  return out;
}

/** A tentacle: where it grows from the rim and how it sways. */
interface Strand { a: number; r: number; len: number; seg: number; ph: number; ax: number; ar: number; width: number; arm: boolean }

/** The title bar that the jellyfish holds (a world edge): its middle, the unit vectors along it (`right`), up from it and out of the window toward the viewer (`front` = right x up), and its width (m). */
export interface JellyBar { anchor: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3; span: number }

export interface JellyOpts {
  /** 1 = a person's height (1.68 m). Default 1. */
  size?: number;
  /** Scales the glow of every cell (the emission). Default 1. */
  glow?: number;
  /** Shifts the pulse and the wave so that copies do not move together (s). Default 0. */
  phase?: number;
}

export interface HoldOpts {
  /** The size of the jellyfish. Default: a bar is 2.6 jellyfish wide. */
  size?: number;
  /** 0..1: how far the two grip tentacles reach for the ends of the bar. Default 1. */
  grip?: number;
  /** How far the others hang in front of the window, in jellyfish metres. Default 0.12. */
  drape?: number;
  /** The rim of the bell above the bar, in jellyfish metres. Default 0.03. */
  lift?: number;
}

/** The world point at the screen position (sx, sy) of the 640 x 360 frame (y down), `depth` metres in front of the camera along its view axis. */
export function screenPoint(cam: THREE.PerspectiveCamera, sx: number, sy: number, depth: number): THREE.Vector3 {
  cam.updateMatrixWorld();
  const o = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const ray = new THREE.Vector3((sx / LW) * 2 - 1, 1 - (sy / LH) * 2, 0.5).unproject(cam).sub(o).normalize();
  const fwd = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
  return o.addScaledVector(ray, depth / ray.dot(fwd));
}

export class Jellyfish {
  readonly root = new THREE.Group();
  private bell: THREE.Mesh;
  private longs: THREE.InstancedMesh;
  private arms: THREE.InstancedMesh;
  private strands: Strand[] = [];
  private phase: number;
  private size: number;
  // scratch, reused by every call
  private pts: THREE.Vector3[] = Array.from({ length: LONG_SEG + 1 }, () => new THREE.Vector3());
  private mat4 = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private scl = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private inv = new THREE.Quaternion();

  /** Builds the jellyfish with cells of `atlas` and meshes of `mat` (a `litMaterial` of that atlas). */
  constructor(atlas: LitAtlas, mat: THREE.Material, o: JellyOpts = {}) {
    const g = geometry(atlas, o.glow ?? 1);
    this.size = o.size ?? 1;
    this.phase = o.phase ?? 0;
    this.bell = new THREE.Mesh(g.bell, mat);
    this.bell.castShadow = true;
    this.bell.frustumCulled = false;
    this.root.add(this.bell);
    for (let i = 0; i < LONG; i++) {
      const a = (i / LONG) * Math.PI * 2;
      this.strands.push({ a, r: 0.27, len: LONG_LEN * (0.9 + 0.2 * ((i * 7) % 5) / 4), seg: LONG_SEG, ph: i * 1.7, ax: 0.07 + 0.05 * (i % 3) / 2, ar: 0.05 + 0.03 * (i % 2), width: 0.04, arm: false });
    }
    for (let i = 0; i < ARMS; i++) {
      this.strands.push({ a: Math.PI / 4 + (i / ARMS) * Math.PI * 2, r: 0.07, len: ARM_LEN * (0.9 + 0.2 * (i % 2)), seg: ARM_SEG, ph: i * 2.3 + 0.9, ax: 0.05, ar: 0.04, width: 0.07, arm: true });
    }
    this.longs = this.instances(g.long, mat, LONG_SEG, LONG * LONG_SEG, 0.65, 1.0);
    this.arms = this.instances(g.arm, mat, ARM_SEG, ARMS * ARM_SEG, 0.8, 1.0);
    this.root.add(this.longs, this.arms);
    this.root.scale.setScalar(this.size);
  }

  /** An InstancedMesh whose colour fades from `a` at the root of each tentacle to `b` at its tip (the tips glow stronger). */
  private instances(geo: THREE.BufferGeometry, mat: THREE.Material, seg: number, n: number, a: number, b: number): THREE.InstancedMesh {
    const m = instanced(geo, mat, n);
    m.castShadow = false;
    m.receiveShadow = false;
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) m.setColorAt(i, c.setScalar(a + (b - a) * ((i % seg) / (seg - 1))));
    return m;
  }

  /** The tentacle `s` at the parameter u (0 at the rim, 1 at the tip) into `out`, in jellyfish metres. */
  private strandPoint(s: Strand, u: number, t: number, c: number, lean: THREE.Vector3, drape: number, out: THREE.Vector3) {
    const rs = 1 - 0.14 * c;
    const ca = Math.cos(s.a), sa = Math.sin(s.a), w = WAVE * (s.arm ? 1.6 : 1);
    const sw = Math.pow(u, 1.2);
    const tang = s.ax * Math.sin(w * t - 2.6 * u + s.ph) * sw;
    const rad = s.ar * Math.sin(0.8 * w * t - 2 * u + 1.3 * s.ph) * sw - (s.arm ? 0 : 0.1 * u * (0.6 + 0.4 * c));
    const l = Math.pow(u, 1.6) * s.len;
    out.set(
      s.r * rs * ca + -sa * tang + ca * rad + lean.x * l,
      -0.02 - s.len * u * (1 - 0.05 * c) + lean.y * l,
      s.r * rs * sa + ca * tang + sa * rad + lean.z * l + drape * u,
    );
  }

  /** Writes the instances of the tentacles. `grip`: the local targets of the two grip tentacles (strands 0 and LONG / 2) and how far they reach. */
  private shape(t: number, c: number, lean: THREE.Vector3, drape: number, grip?: { right: THREE.Vector3; left?: THREE.Vector3; amount: number }) {
    this.bell.scale.set(1 - 0.14 * c, 1 + 0.18 * c, 1 - 0.14 * c);
    const free = new THREE.Vector3(), bez = new THREE.Vector3(), ctl = new THREE.Vector3(), root = new THREE.Vector3();
    let iLong = 0, iArm = 0;
    this.strands.forEach((s, k) => {
      const target = grip && !s.arm ? (k === 0 ? grip.right : k === LONG / 2 ? grip.left ?? null : null) : null;
      if (target) this.strandPoint(s, 0, t, c, lean, drape, root);
      if (target) ctl.copy(root).add(target).multiplyScalar(0.5).add(v3(0, -0.45, 0.12));
      for (let j = 0; j <= s.seg; j++) {
        const u = j / s.seg;
        this.strandPoint(s, u, t, c, lean, s.arm ? 0 : drape, free);
        if (target) {
          // a sagging arc from the rim to the end of the bar, then a curl around it: the weight of the grip grows along the tentacle
          const m = 1 - u;
          bez.set(
            m * m * root.x + 2 * m * u * ctl.x + u * u * target.x,
            m * m * root.y + 2 * m * u * ctl.y + u * u * target.y - 0.1 * Math.max(0, (u - 0.8) / 0.2) ** 2,
            m * m * root.z + 2 * m * u * ctl.z + u * u * target.z + 0.03 * u,
          );
          const wgt = grip!.amount * (u * u * (3 - 2 * u));
          free.lerp(bez, wgt);
        }
        this.pts[j]!.copy(free);
      }
      const mesh = s.arm ? this.arms : this.longs;
      for (let j = 0; j < s.seg; j++) {
        const a = this.pts[j]!, b = this.pts[j + 1]!;
        this.dir.subVectors(b, a);
        const len = this.dir.length();
        this.quat.setFromUnitVectors(UP, this.dir.multiplyScalar(1 / Math.max(len, 1e-6)));
        const w = s.width * (1 - 0.65 * (j / s.seg));
        this.mat4.compose(a, this.quat, this.scl.set(w, len * 1.05, w));
        mesh.setMatrixAt(s.arm ? iArm++ : iLong++, this.mat4);
      }
    });
    this.longs.instanceMatrix.needsUpdate = true;
    this.arms.instanceMatrix.needsUpdate = true;
  }

  /** A world vector into the local frame of the model (rotation undone, size divided). */
  private toLocal(p: THREE.Vector3): THREE.Vector3 {
    return p.clone().sub(this.root.position).applyQuaternion(this.inv.copy(this.root.quaternion).invert()).multiplyScalar(1 / this.size);
  }

  /**
   * Drifting at p (the rim of the bell): a slow bob that follows the pulse, a slow turn about y (`o.yaw` fixes it), a little tilt. `o.v`: the
   * velocity (m/s) of the drift: the tentacles trail behind it.
   */
  drift(t: number, p: THREE.Vector3, o: { v?: THREE.Vector3; yaw?: number; /** The size from now on. */ size?: number; /** Tentacle 0 reaches for this world point (a cursor that it holds, a pane that it knocks on). */ reach?: { to: THREE.Vector3; amount: number } } = {}) {
    const tt = t + this.phase, c = pulse(tt);
    if (o.size !== undefined) this.size = o.size;
    this.root.scale.setScalar(this.size);
    this.root.position.set(p.x, p.y + this.size * (0.06 * c + 0.04 * Math.sin(0.6 * tt)), p.z);
    this.root.rotation.set(0.06 * Math.sin(0.5 * tt + 1), o.yaw ?? 0.3 * Math.sin(0.17 * tt), 0.05 * Math.sin(0.43 * tt), 'YXZ');
    this.root.updateMatrixWorld(true);
    const lean = new THREE.Vector3();
    if (o.v) {
      // the velocity in the model's axes, m/s (toLocal divides by the size)
      lean.copy(this.toLocal(o.v.clone().add(this.root.position))).multiplyScalar(-0.12 * this.size);
      lean.y = 0;
      if (lean.length() > 0.5) lean.setLength(0.5);
    }
    this.shape(tt, c, lean, 0, o.reach ? { right: this.toLocal(o.reach.to), amount: o.reach.amount } : undefined);
  }

  /**
   * The desktop buddy: the bell sits on the title bar `bar`, the rim just above its middle, turned to face the viewer (the root takes the
   * frame of the bar). Tentacle 0 grips the right end of the bar and tentacle 5 the left end (an arc that sags and curls round the end);
   * the other tentacles hang down in front of the window. Draw it over the window quad (or composite it after the windows).
   */
  hold(t: number, bar: JellyBar, o: HoldOpts = {}) {
    const size = (this.size = o.size ?? bar.span / 2.6), lift = o.lift ?? 0.03;
    const front = new THREE.Vector3().crossVectors(bar.right, bar.up);
    this.root.scale.setScalar(size);
    this.root.position.copy(bar.anchor).addScaledVector(bar.up, lift * size);
    this.root.quaternion.setFromRotationMatrix(this.mat4.makeBasis(bar.right, bar.up, front));
    this.root.updateMatrixWorld(true);
    const tt = t + this.phase, c = pulse(tt);
    const end = (s: number) => this.toLocal(bar.anchor.clone().addScaledVector(bar.right, (s * bar.span) / 2));
    this.shape(tt, c, new THREE.Vector3(), o.drape ?? 0.12, { right: end(1), left: end(-1), amount: o.grip ?? 1 });
  }

  /** `hold` for a window on the screen: `rect` [x, y, w, h] in the 640 x 360 frame, `depth` metres in front of `cam` (the plane of the window). */
  holdWindow(t: number, cam: THREE.PerspectiveCamera, rect: readonly [number, number, number, number], depth: number, o: HoldOpts = {}) {
    const [x, y, w] = rect;
    const l = screenPoint(cam, x, y, depth), r = screenPoint(cam, x + w, y, depth);
    const right = r.clone().sub(l), span = right.length();
    right.multiplyScalar(1 / span);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    this.hold(t, { anchor: l.add(r).multiplyScalar(0.5), right, up, span }, o);
  }

  /** The world position of the tip of long tentacle `k` (0..9) as last posed: where a grip, a spark or a drop can start. */
  tip(k: number): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    this.longs.getMatrixAt(k * LONG_SEG + LONG_SEG - 1, this.mat4);
    return new THREE.Vector3(0, 1, 0).applyMatrix4(this.mat4).applyMatrix4(this.root.matrixWorld);
  }
}
