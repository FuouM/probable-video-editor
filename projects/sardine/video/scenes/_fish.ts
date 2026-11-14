// The avatar sardine in the lit renderer (treatment "The sardine"): the player's character. About 0.7 m long, a fusiform
// body (deeper than wide), a dark blue-green back, silver flanks, a pale belly, a row of black spots, an eye, two
// pectoral fins, a pelvic and an anal fin, a dorsal fin and a forked tail. It does not glow: a light stripe on the flank
// is a glint that only shows where light falls on it. Under the left pectoral fin it holds a small commuter pass
// (`passMount`, `PASS_SCALE`).
//
// Use: `new Fish(atlas, mat, size)`, then put `fish.root` into the scene. `fish.swim(path, t)` poses it on a
// `SwimPath`; `fish.pose(t, p, v, turn)` poses it by hand; `fish.dangle(...)` poses it in the pick-up hand. A frame
// depends only on t: nothing is kept between frames.
//
// `Shoal` is a bed of small sardines that grow tail first out of soil (one InstancedMesh). `setGrowth(k)` buries
// them (0) or stands them half out (1). `pose(t)` writes the instances. Put `shoal.root` on the soil surface.
import * as THREE from 'three';
import { mulberry32 } from '@pve/engine/util';
import { Builder, allFaces, at, instanced, v3, type Face, type LitAtlas } from '@pve/engine/lit';

// ---------------------------------------------------------------- shape

/** Body stations [x, up, down, half width] (m), x forward. The nose is at 0.16, the tail stalk ends at -0.41. */
const SHAPE: [number, number, number, number][] = [
  [-0.41, 0.022, 0.02, 0.014],
  [-0.32, 0.036, 0.032, 0.022],
  [-0.22, 0.064, 0.058, 0.036],
  [-0.11, 0.082, 0.075, 0.046],
  [0.0, 0.083, 0.075, 0.046],
  [0.08, 0.07, 0.062, 0.04],
  [0.13, 0.04, 0.035, 0.028],
  [0.16, 0.012, 0.012, 0.008],
];

/** Joint x (m) of the six segments: head, four body segments, tail. Each segment reaches back to the next joint. */
const JOINT_X = [0, 0, -0.11, -0.22, -0.32, -0.41];

function shape(x: number): [number, number, number] {
  if (x <= SHAPE[0]![0]) return [SHAPE[0]![1], SHAPE[0]![2], SHAPE[0]![3]];
  for (let k = 1; k < SHAPE.length; k++) {
    const a = SHAPE[k - 1]!, b = SHAPE[k]!;
    if (x <= b[0]) {
      const u = (x - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
    }
  }
  const e = SHAPE[SHAPE.length - 1]!;
  return [e[1], e[2], e[3]];
}

/** The eight corners of the body section at x (local to a joint at x = dx): top, upper right, ... going round. */
function ring(x: number, dx: number): THREE.Vector3[] {
  const [up, dn, hw] = shape(x);
  const zy: [number, number][] = [
    [0, up], [0.6 * hw, 0.75 * up], [hw, 0.1 * up], [0.8 * hw, -0.55 * dn],
    [0, -dn], [-0.8 * hw, -0.55 * dn], [-hw, 0.1 * up], [-0.6 * hw, 0.75 * up],
  ];
  return zy.map(([z, y]) => v3(x - dx, y, z));
}

/** Sides of the body ring: 0 back right, 1 upper right, 2 flank right, 3 belly right, then the left side mirrored. */
interface Cells { sides: Face[]; eye: Face; pupil: Face; fin: Face; dark: Face; dorsal: Face }

const cache = new WeakMap<LitAtlas, Cells>();

function cells(A: LitAtlas): Cells {
  const hit = cache.get(A);
  if (hit) return hit;
  const UPPER = ['#27505c', '#2f6270', '#6f95a0', '#a9bcc6', '#bccad2', '#c4d1d8'];
  const FLANK = ['#b4c3cc', '#bccad2', '#b0bfc8', '#c2d0d7', '#cfdbe0', '#d8e3e7'];
  // a body cell is 6 texels around the side and 12 along it; `spots` adds the black spot, `flip` mirrors the side
  const upper = (spots: boolean, flip: boolean): Face => ({
    map: 'fit',
    cell: A.paint(6, 12, (p) => {
      for (let u = 0; u < 6; u++) p.rect(flip ? 5 - u : u, 0, 1, 12, UPPER[u]!);
      if (spots) for (const u of [3, 4]) p.rect(flip ? 5 - u : u, 5, 1, 2, '#10181c');
    }),
  });
  const flank = (flip: boolean): Face => ({
    map: 'fit',
    cell: A.paint(6, 12, (p) => {
      for (let u = 0; u < 6; u++) p.rect(flip ? 5 - u : u, 0, 1, 12, FLANK[u]!);
      p.rect(flip ? 4 : 1, 0, 1, 12, '#e6f4ff');
    }),
  });
  const back = { cell: A.solid('#22414f') };
  const belly = { cell: A.solid('#dfe8ec') };
  const out: Cells = {
    sides: [back, upper(true, false), flank(false), belly, belly, flank(true), upper(true, true), back],
    eye: { cell: A.solid('#e2cf8a') },
    pupil: { cell: A.solid('#0c1014') },
    fin: { cell: A.solid('#9db0ba') },
    dark: { cell: A.solid('#2f5d6a') },
    dorsal: { cell: A.solid('#4a7480') },
  };
  cache.set(A, out);
  return out;
}

/** The body cells of a head or simple fish: one flat colour per side, no spots. */
function plainSides(A: LitAtlas): Face[] {
  const back = { cell: A.solid('#22414f') }, mid = { cell: A.solid('#6f95a0') };
  const silver = { cell: A.solid('#b8c6ce') }, belly = { cell: A.solid('#dfe8ec') };
  return [back, mid, silver, belly, belly, silver, mid, back];
}

/** A loft of body rings at the x stations `xs` (ascending), local to a joint at `dx`. */
function loft(b: Builder, xs: number[], dx: number, sides: Face[], capLo = false, capHi = false) {
  for (let i = 0; i + 1 < xs.length; i++) {
    const lo = ring(xs[i]!, dx), hi = ring(xs[i + 1]!, dx);
    for (let j = 0; j < 8; j++) b.quad(lo[j]!, lo[(j + 1) % 8]!, hi[(j + 1) % 8]!, hi[j]!, sides[j]!);
  }
  const cap = (x: number, up: boolean) => {
    const r = ring(x, dx), c = v3(x - dx, 0, 0);
    for (let j = 0; j < 8; j++) up ? b.tri(c, r[j]!, r[(j + 1) % 8]!, sides[2]!) : b.tri(c, r[(j + 1) % 8]!, r[j]!, sides[2]!);
  };
  if (capHi) cap(xs[xs.length - 1]!, true);
  if (capLo) cap(xs[0]!, false);
}

/** A flat convex plate seen from both sides (a fin). The two faces stand 2 mm apart: at the same depth the face that is turned away casts its shadow on the face that is seen. */
function plate(b: Builder, pts: THREE.Vector3[], f: Face) {
  const n = pts[1]!.clone().sub(pts[0]!).cross(pts[2]!.clone().sub(pts[0]!)).normalize().multiplyScalar(0.001);
  const a = pts.map((p) => p.clone().add(n)), c = pts.map((p) => p.clone().sub(n));
  for (let k = 1; k + 1 < pts.length; k++) {
    b.tri(a[0]!, a[k]!, a[k + 1]!, f);
    b.tri(c[0]!, c[k + 1]!, c[k]!, f);
  }
}

const mesh = (b: Builder, mat: THREE.Material, cast = true) => {
  const m = new THREE.Mesh(b.geometry(), mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
};

// ---------------------------------------------------------------- the avatar

const X_AXIS = new THREE.Vector3(1, 0, 0);

export class Fish {
  readonly root = new THREE.Group();
  /** Joints from head to tail: 0 head (on the root), 1..4 body, 5 tail. */
  private joints: THREE.Group[] = [];
  private pecs: THREE.Group[] = [];
  /**
   * Where the commuter pass hangs: on the left flank (-z, the side the platform camera and the cabin camera see), its top edge under the
   * pectoral fin, its face turned out. `hold` puts a card there. It swings a little with t (`pose`).
   */
  readonly passMount = new THREE.Group();
  /** The scale of a `Ticket` on the fish, in every scene: 0.26 x 0.16 m on a fish of 0.7 m, so that the pass reads at the size of a window. */
  static readonly PASS_SCALE = 3;

  /** Hangs a card (a `Ticket` root of scale `PASS_SCALE`) under the fin: one place and one size in every scene. */
  hold(card: THREE.Object3D) {
    card.position.set(0, -0.09, -0.004);
    card.rotation.set(0, Math.PI, 0);
    this.passMount.add(card);
  }

  /** Builds the fish with cells of `atlas` and meshes of `mat`. `size` scales it (1 = 0.7 m). */
  constructor(atlas: LitAtlas, mat: THREE.Material, size = 1) {
    const C = cells(atlas);
    const plain = plainSides(atlas);
    const parts: Builder[] = [0, 1, 2, 3, 4, 5].map(() => new Builder(32));
    // head: nose cap, then three spans
    loft(parts[0]!, [0, 0.08, 0.13, 0.16], 0, plain, false, true);
    // the eye, a gold ring and a black pupil on each side, and the gill edge
    for (const s of [1, -1]) {
      const hw = shape(0.105)[2];
      parts[0]!.box(0.03, 0.03, 0.01, allFaces(C.eye), at(0.105, 0.014 - 0.015, s * (hw - 0.002)));
      parts[0]!.box(0.018, 0.018, 0.012, allFaces(C.pupil), at(0.108, 0.014 - 0.009, s * (hw - 0.001)));
      parts[0]!.box(0.01, 0.1, 0.004, allFaces(C.dark), at(0.045, -0.05, s * (shape(0.045)[2] + 0.0005)));
    }
    // the mouth line: a dark sliver under the nose
    parts[0]!.box(0.05, 0.005, 0.02, allFaces(C.pupil), at(0.135, -0.008, 0));
    // body: one span each, so the 6x12 side cells show once per segment (the spots)
    loft(parts[1]!, [-0.11, 0], 0, C.sides);
    loft(parts[2]!, [-0.22, -0.11], -0.11, C.sides);
    loft(parts[3]!, [-0.32, -0.22], -0.22, C.sides);
    loft(parts[4]!, [-0.41, -0.32], -0.32, plain, true, false);
    // dorsal fin on the first body segment, pelvic fins under it, anal fin under the third
    plate(parts[1]!, [v3(-0.012, 0.08, 0), v3(-0.04, 0.135, 0), v3(-0.08, 0.12, 0), v3(-0.1, 0.075, 0)], C.dorsal);
    for (const s of [1, -1]) plate(parts[1]!, [v3(-0.05, -0.075, s * 0.018), v3(-0.085, -0.075, s * 0.018), v3(-0.1, -0.125, s * 0.04)], C.fin);
    plate(parts[3]!, [v3(0.0, -0.056, 0), v3(-0.04, -0.056, 0), v3(-0.05, -0.088, 0)], C.fin);
    // forked tail on the last joint: a base and two long lobes
    plate(parts[5]!, [v3(0, 0.022, 0), v3(0, -0.022, 0), v3(-0.085, 0, 0)], C.dorsal);
    plate(parts[5]!, [v3(0, 0.022, 0), v3(-0.085, 0, 0), v3(-0.15, 0.105, 0)], C.dorsal);
    plate(parts[5]!, [v3(0, -0.022, 0), v3(-0.15, -0.105, 0), v3(-0.085, 0, 0)], C.dorsal);
    let parent: THREE.Object3D = this.root;
    parts.forEach((b, k) => {
      const j = new THREE.Group();
      j.position.x = JOINT_X[k]! - (k > 0 ? JOINT_X[k - 1]! : 0);
      j.add(mesh(b, mat));
      parent.add(j);
      this.joints.push(j);
      parent = j;
    });
    // pectoral fins: a hinge on each side of the head, behind the gill
    for (const s of [1, -1]) {
      const g = new THREE.Group();
      g.position.set(0.055, -0.03, s * shape(0.055)[2]);
      const b = new Builder(32);
      plate(b, [v3(0.005, 0.012, 0), v3(-0.025, -0.004, 0), v3(-0.045, -0.034, s * 0.05), v3(-0.09, -0.03, s * 0.065), v3(0.0, -0.002, s * 0.035)], C.fin);
      g.add(mesh(b, mat, false));
      this.joints[0]!.add(g);
      this.pecs.push(g);
    }
    this.passMount.position.set(0.03, -0.08, -(shape(0.03)[2] + 0.004));
    this.joints[0]!.add(this.passMount);
    this.root.scale.setScalar(size);
    this.root.rotation.order = 'YZX';
  }

  /**
   * Poses the fish at p, heading along v (m/s), banking with `turn` (rad/s of heading change). The tail beat
   * grows with the speed: fast swimming beats harder, a hover keeps a slow fin wave.
   */
  pose(t: number, p: THREE.Vector3, v: THREE.Vector3, turn = 0) {
    const speed = v.length();
    const fast = Math.min(1, speed / 2);
    this.root.position.copy(p);
    // a fish with no speed faces +x, level: the pose never depends on an earlier call
    const dir = speed > 1e-3 ? v : X_AXIS;
    this.root.rotation.y = Math.atan2(-dir.z, dir.x);
    this.root.rotation.z = Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) * 0.8;
    this.root.rotation.x = speed > 1e-3 ? THREE.MathUtils.clamp(-turn * 0.25, -0.6, 0.6) : 0;
    const phase = t * (7 + fast * 4);
    const amp = 0.08 + fast * 0.22;
    // the wave travels from head to tail and grows toward the tail; the body bends into the turn
    const bend = THREE.MathUtils.clamp(turn * 0.12, -0.35, 0.35);
    const W = [0.07, 0.17, 0.35, 0.52, 0.67, 0.77];
    W.forEach((w, k) => {
      this.joints[k]!.rotation.y = (k === 0 ? 0 : bend * 0.4) + amp * w * Math.sin(phase - k * 0.8);
    });
    // the pectoral fins sculls: a slow beat that quickens with speed
    this.pecs.forEach((g, i) => {
      const s = i === 0 ? 1 : -1;
      g.rotation.x = s * (0.3 + 0.25 * Math.sin(t * (4 + fast * 6) + i));
    });
    this.passMount.rotation.z = 0.18 * Math.sin(t * 3.2);
  }

  /** Poses the fish on `path` at time t. */
  swim(path: SwimPath, t: number) {
    const { p, v, turn } = path.at(t);
    this.pose(t, p, v, turn);
  }

  /**
   * Poses the fish held by the pick-up hand (treatment "The hand"): it hangs from its tail stalk, head down. `anchor`: the grip in the world.
   * `swing`: the angle off the vertical (rad, positive toward `side`, `CarryState.swing`). `wriggle`: the phase of the tail beat (rad,
   * `CarryState.wriggle`). `amp`: 0..1, how hard it wriggles (`CarryState.amp`): a wave that runs from the head to the grip, and the
   * pectoral fins flutter. `o.side`: the horizontal unit vector the swing goes toward (default +x). `o.lift`: 0..1 (`CarryState.lift`):
   * at 0 the fish lies on the ground at `o.restY` pointing along `side` (the grab), at 1 it hangs from the grip.
   */
  dangle(anchor: THREE.Vector3, swing: number, wriggle: number, amp: number, o: { side?: THREE.Vector3; lift?: number; restY?: number } = {}) {
    const side = o.side ?? X_AXIS, lift = o.lift ?? 1;
    const a = THREE.MathUtils.lerp(Math.PI / 2, swing, lift);
    const d = v3(0, -Math.cos(a), 0).addScaledVector(side, Math.sin(a));
    const size = this.root.scale.x;
    this.root.quaternion.setFromUnitVectors(X_AXIS, d);
    // the tail stalk (local x = -0.41) is at the grip: the head joint, which is the origin of the fish, hangs 0.41 below it
    this.root.position.copy(anchor);
    this.root.position.y = THREE.MathUtils.lerp(o.restY ?? anchor.y, anchor.y, lift);
    this.root.position.addScaledVector(d, 0.41 * size);
    const W = [0.15, 0.35, 0.5, 0.6, 0.5, 0.3];
    W.forEach((w, k) => { this.joints[k]!.rotation.y = amp * 0.6 * w * Math.sin(wriggle - k * 0.9); });
    this.pecs.forEach((g, i) => { g.rotation.x = (i === 0 ? 1 : -1) * (0.6 + 0.5 * amp * Math.sin(wriggle * 1.3 + i)); });
    this.passMount.rotation.z = 0;
  }
}

// ---------------------------------------------------------------- the shoal

/** Length scale of a shoal fish against the avatar. */
const SHOAL_SCALE = 0.9;

/**
 * Small sardines that grow tail first out of the soil: one InstancedMesh of one simple fish. `scatter` sets the
 * bed they cover (x by z, metres, centred on the root). Growth 0 hides them all below the soil; 1 stands each about
 * half out, tail up, rocking a little. Each fish starts a little later or earlier than its neighbours.
 */
export class Shoal {
  readonly root = new THREE.Group();
  private inst: THREE.InstancedMesh;
  private k = 0;
  private w = 1.2;
  private d = 0.3;
  private seedOf: number;
  private rx: number[] = [];
  private rz: number[] = [];
  private yaw: number[] = [];
  private delay: number[] = [];
  private phase: number[] = [];
  private size: number[] = [];
  private tmp = new THREE.Object3D();

  constructor(atlas: LitAtlas, mat: THREE.Material, private count: number, seed: number) {
    this.seedOf = seed;
    const C = cells(atlas);
    const b = new Builder(32);
    // silver flanks that glow a little in dusk light, a dark blue back, as the avatar
    const sb = { cell: atlas.solid('#1f4766') }, su = { cell: atlas.solid('#4f86a8') }, sf = { cell: atlas.solid('#dce8ee', 0.7) }, sv = { cell: atlas.solid('#f2f6f8', 0.4) };
    loft(b, [-0.41, -0.32, -0.22, -0.11, 0, 0.08, 0.13, 0.16], 0, [sb, su, sf, sv, sv, sf, su, sb], true, true);
    plate(b, [v3(-0.012, 0.08, 0), v3(-0.04, 0.135, 0), v3(-0.08, 0.12, 0), v3(-0.1, 0.075, 0)], C.dorsal);
    plate(b, [v3(-0.41, 0.022, 0), v3(-0.41, -0.022, 0), v3(-0.5, 0, 0)], C.dorsal);
    plate(b, [v3(-0.41, 0.022, 0), v3(-0.5, 0, 0), v3(-0.56, 0.105, 0)], C.dorsal);
    plate(b, [v3(-0.41, -0.022, 0), v3(-0.56, -0.105, 0), v3(-0.5, 0, 0)], C.dorsal);
    for (const s of [1, -1]) b.box(0.03, 0.03, 0.01, allFaces(C.eye), at(0.105, -0.001, s * (shape(0.105)[2] - 0.002)));
    this.inst = instanced(b.geometry(), mat, count);
    this.inst.castShadow = true;
    this.inst.receiveShadow = true;
    this.root.add(this.inst);
    this.scatter(this.w, this.d);
  }

  /** Spreads the fish over a bed of `w` (x) by `d` (z) metres, the same every time for one seed. */
  scatter(w: number, d: number) {
    this.w = w;
    this.d = d;
    const rnd = mulberry32(this.seedOf);
    for (let i = 0; i < this.count; i++) {
      this.rx[i] = ((i + 0.5) / this.count + (rnd() - 0.5) * 0.6 / this.count - 0.5) * w;
      this.rz[i] = (rnd() - 0.5) * d;
      this.yaw[i] = (rnd() - 0.5) * Math.PI * 0.9;
      this.delay[i] = rnd();
      this.phase[i] = rnd() * Math.PI * 2;
      this.size[i] = 0.8 + rnd() * 0.3;
    }
  }

  /** 0: all buried. 1: all standing half out. In between, each fish rises on its own schedule. */
  setGrowth(k: number) { this.k = THREE.MathUtils.clamp(k, 0, 1); }

  /** The place of fish i on the bed (root frame x and z) and its size factor. */
  place(i: number): { x: number; z: number; size: number } { return { x: this.rx[i]!, z: this.rz[i]!, size: SHOAL_SCALE * this.size[i]! }; }

  /** Writes the instances for time t (rise by growth, then the rocking). `rise(i)` (0..1) sets the rise of fish i directly (the growth is then not used); a negative value hides the fish. */
  pose(t: number, rise?: (i: number) => number) {
    const o = this.tmp;
    for (let i = 0; i < this.count; i++) {
      const raw = rise ? rise(i) : undefined;
      const hidden = raw !== undefined && raw < 0;
      const g = raw !== undefined ? THREE.MathUtils.clamp(raw, 0, 1) : THREE.MathUtils.clamp(this.k * 1.5 - this.delay[i]! * 0.5, 0, 1);
      const e = g * g * (3 - 2 * g);
      const s = SHOAL_SCALE * this.size[i]!;
      // tail up: +x forward turned to point down; the origin sits 0.3 m below the soil when buried
      const wig = Math.sin(t * 2.6 + this.phase[i]!) * 0.07 * e;
      const wig2 = Math.sin(t * 1.9 + this.phase[i]! * 1.7) * 0.05 * e;
      o.position.set(this.rx[i]!, (-0.65 + 0.72 * e) * s, this.rz[i]!);
      o.rotation.order = 'YXZ';
      o.rotation.set(wig2, this.yaw[i]!, -Math.PI / 2 + wig);
      o.scale.setScalar(hidden ? 0 : s);
      o.updateMatrix();
      this.inst.setMatrixAt(i, o.matrix);
    }
    this.inst.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- swim path

/**
 * A key of a swim path: a time (s, song time) and a place. `stop`: the fish glides in and comes to rest here (zero speed on the key):
 * a seat, a wait. The first and the last key always stop. `face`: the heading (rad about y, `atan2(-z, x)`: 0 is +x, π/2 is -z) that it
 * turns to and holds while it rests here.
 */
export interface SwimKey { t: number; p: [number, number, number]; stop?: boolean; face?: number }

/** The heading follower: steps of the baked track, the speed under which the fish rests, its fastest turn (rad/s), its gain (1/s) and how far ahead of the path it looks (s): the nose turns before the fish sets off, as an animal's does. */
const HEAD_STEP = 1 / 72, HEAD_MIN_SPEED = 0.25, HEAD_RATE = 7, HEAD_GAIN = 14, HEAD_LEAD = 0.2;

/**
 * A smooth path through timed keys (cubic Hermite in time). Before the first key and after the last the fish holds there, hovering with
 * a slow bob. The speed comes from the curve; the first and last key, and the keys marked `stop`, have zero speed, so the fish glides in
 * and stops, it does not drift. The heading is baked once, from the tangent of the path: the nose follows the direction of travel, it
 * turns at most 400 degrees a second (so a turn takes time and the body banks into it), and it never slides sideways. At rest it holds
 * its last heading, or turns to the `face` of the key it rests on.
 */
export class SwimPath {
  private keys: { t: number; p: THREE.Vector3; stop: boolean; face: number | undefined }[];
  private t0: number;
  private yaw: Float32Array;
  private pitch: Float32Array;
  private rate: Float32Array;

  constructor(keys: SwimKey[]) {
    if (keys.length < 2) throw new Error('swim path: at least two keys');
    this.keys = keys.map((k) => ({ t: k.t, p: v3(...k.p), stop: k.stop ?? false, face: k.face })).sort((a, b) => a.t - b.t);
    this.keys[0]!.stop = true;
    this.keys[this.keys.length - 1]!.stop = true;
    this.t0 = this.keys[0]!.t;
    const n = Math.ceil((this.keys[this.keys.length - 1]!.t - this.t0) / HEAD_STEP) + 2;
    this.yaw = new Float32Array(n);
    this.pitch = new Float32Array(n);
    this.rate = new Float32Array(n);
    this.bake();
  }

  private point(t: number): THREE.Vector3 {
    const K = this.keys;
    if (t <= K[0]!.t) return K[0]!.p.clone();
    if (t >= K[K.length - 1]!.t) return K[K.length - 1]!.p.clone();
    let i = 0;
    while (K[i + 1]!.t < t) i++;
    const a = K[Math.max(0, i - 1)]!, b = K[i]!, c = K[i + 1]!, d = K[Math.min(K.length - 1, i + 2)]!;
    const u = (t - b.t) / (c.t - b.t);
    // tangents scaled to the time of each span, so speed is continuous across keys; a key that stops has none
    const m1 = b.stop ? v3(0, 0, 0) : c.p.clone().sub(a.p).multiplyScalar((c.t - b.t) / Math.max(1e-6, c.t - a.t));
    const m2 = c.stop ? v3(0, 0, 0) : d.p.clone().sub(b.p).multiplyScalar((c.t - b.t) / Math.max(1e-6, d.t - b.t));
    const u2 = u * u, u3 = u2 * u;
    return b.p.clone().multiplyScalar(2 * u3 - 3 * u2 + 1)
      .add(m1.multiplyScalar(u3 - 2 * u2 + u))
      .add(c.p.clone().multiplyScalar(-2 * u3 + 3 * u2))
      .add(m2.multiplyScalar(u3 - u2));
  }

  private velocity(t: number): THREE.Vector3 {
    const h = HEAD_STEP;
    return this.point(t + h).sub(this.point(t - h)).multiplyScalar(1 / (2 * h));
  }

  /** Bakes the heading: yaw and pitch follow the direction of travel with a limited turn rate, and hold when the fish rests. */
  private bake() {
    const K = this.keys, n = this.yaw.length;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const along = (v: THREE.Vector3) => Math.atan2(-v.z, v.x);
    // the heading of the first travel: the fish at rest before it already looks that way
    let first = 0;
    for (let i = 0; i < n; i++) {
      const v = this.velocity(this.t0 + i * HEAD_STEP);
      if (v.length() > HEAD_MIN_SPEED) { first = along(v); break; }
    }
    let target = K[0]!.face ?? first;
    let yaw = target, pitch = 0;
    for (let i = 0; i < n; i++) {
      const t = this.t0 + i * HEAD_STEP;
      const v = this.velocity(t + HEAD_LEAD);
      let climb = 0;
      if (v.length() > HEAD_MIN_SPEED) {
        target = along(v);
        climb = THREE.MathUtils.clamp(Math.atan2(v.y, Math.hypot(v.x, v.z)), -0.6, 0.6);
      } else {
        // at rest: turn to the face of the key it rests on, else hold
        const p = this.point(t);
        for (const k of K) if (k.face !== undefined && k.t <= t + 1e-6 && k.p.distanceTo(p) < 0.1) target = k.face;
      }
      const rate = THREE.MathUtils.clamp(wrap(target - yaw) * HEAD_GAIN, -HEAD_RATE, HEAD_RATE);
      yaw += rate * HEAD_STEP;
      pitch += (climb - pitch) * Math.min(1, 12 * HEAD_STEP);
      this.yaw[i] = yaw;
      this.pitch[i] = pitch;
      this.rate[i] = rate;
    }
  }

  /**
   * Position, velocity (m/s) and turn rate (rad/s) at t. The velocity points along the baked heading (the nose), with the speed of the
   * curve, at least 0.05 m/s so that a resting fish keeps its heading and a slow tail beat. A held fish bobs gently.
   */
  at(t: number): { p: THREE.Vector3; v: THREE.Vector3; turn: number } {
    const p = this.point(t);
    p.y += 0.03 * Math.sin(t * 2.1);
    const speed = Math.max(this.velocity(t).length(), 0.05);
    const x = THREE.MathUtils.clamp((t - this.t0) / HEAD_STEP, 0, this.yaw.length - 1), i0 = Math.floor(x), i1 = Math.min(this.yaw.length - 1, i0 + 1), f = x - i0;
    const mix = (a: Float32Array) => a[i0]! + (a[i1]! - a[i0]!) * f;
    const yaw = mix(this.yaw), pitch = mix(this.pitch);
    const v = v3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.sin(yaw)).multiplyScalar(speed);
    return { p, v, turn: mix(this.rate) };
  }
}
