// The bluefin tuna of sardine v3 (treatment: the tuna front of chorus 2 and 3, the sky of the outro). About 2.5 m
// long, low-poly: a fat torpedo, dark blue back, silver flank, white belly, two dorsal fins, a row of yellow finlets
// to a crescent tail. Local frame: +x forward (nose at +1.25), y up, z right. The tail is its own part, hinged at
// x = -0.95, so a pose can wag it.
//
//  - `Tuna`: one fish. `pose(t, p, v)` puts it at p heading along v (m/s); it wags with its speed.
//  - `TunaSchool`: many fish in two InstancedMeshes (body, tail). `pose(t, pos, vel, wag?)` writes the first
//    `pos.length` instances; the rest are hidden. `wag[i]` (0..1, default 1) scales the tail beat of fish i, so a
//    fish stuck in a roof (wag small) wobbles while one in flight beats hard.
// A frame depends only on t and the arguments: nothing is kept between frames.
import * as THREE from 'three';
import { Builder, allFaces, at, instanced, v3, type Face, type LitAtlas } from '@pve/engine/lit';

/** Length of a tuna (m) and the x of the tail hinge. */
export const TUNA_LENGTH = 2.5;
const HINGE = -0.95;

/** Body stations [x, up, down, half width] (m). */
const SHAPE: [number, number, number, number][] = [
  [1.25, 0.0, 0.0, 0.0], [1.18, 0.07, 0.07, 0.06], [1.0, 0.15, 0.15, 0.13], [0.6, 0.26, 0.25, 0.22], [0.15, 0.31, 0.29, 0.26],
  [-0.3, 0.27, 0.23, 0.21], [-0.7, 0.14, 0.11, 0.1], [-0.95, 0.06, 0.05, 0.05],
];

function ring(s: [number, number, number, number], dx: number): THREE.Vector3[] {
  const [x, up, dn, hw] = s;
  const zy: [number, number][] = [
    [0, up], [0.6 * hw, 0.75 * up], [hw, 0.1 * up], [0.8 * hw, -0.55 * dn],
    [0, -dn], [-0.8 * hw, -0.55 * dn], [-hw, 0.1 * up], [-0.6 * hw, 0.75 * up],
  ];
  return zy.map(([z, y]) => v3(x - dx, y, z));
}

interface TunaGeo { body: THREE.BufferGeometry; tail: THREE.BufferGeometry }
const cache = new WeakMap<LitAtlas, Record<string, TunaGeo>>();

/**
 * A flat fin seen from both sides. The two faces stand 6 mm apart: at the same depth the face that is turned away casts its shadow on the
 * face that is seen, and the fin flickers.
 */
function plate(b: Builder, pts: THREE.Vector3[], f: Face) {
  const n = pts[1]!.clone().sub(pts[0]!).cross(pts[2]!.clone().sub(pts[0]!)).normalize().multiplyScalar(0.003);
  const a = pts.map((p) => p.clone().add(n)), c = pts.map((p) => p.clone().sub(n));
  for (let k = 1; k + 1 < pts.length; k++) {
    b.tri(a[0]!, a[k]!, a[k + 1]!, f);
    b.tri(c[0]!, c[k + 1]!, c[k]!, f);
  }
}

function geometry(A: LitAtlas, yellowfin = false, glow = 0): TunaGeo {
  const key = `${yellowfin ? 'yellowfin' : 'bluefin'}|${glow}`;
  const hit = cache.get(A)?.[key];
  if (hit) return hit;
  const f = (c: string, emit = 0): Face => ({ cell: A.solid(c, emit) });
  // bluefin: dark blue back, silver flank, dark fins, yellow finlets; yellowfin: a greener back, a gold stripe and bright yellow fins
  const back = f(yellowfin ? '#12303a' : '#10284a'), blue = f(yellowfin ? '#2a6a70' : '#1d4670', glow * 0.4), silver = f('#9fb4c2', glow), belly = f('#e6edf0', glow);
  const sides = [back, blue, silver, belly, belly, silver, blue, back];
  // the fins and finlets (the spines) shine only on a school with glow >= 1 (the eclipse); the yellowfin's are bright yellow either way
  const shine = glow >= 1 ? 3 : 0;
  const fin = f(yellowfin ? '#f0c020' : '#18365a', yellowfin ? shine : 0), yellow = f('#f2c81c', shine), eye = f('#e8e2c0'), pupil = f('#0a0e14'), keel = f('#c8d2d8');
  const b = new Builder(32);
  for (let i = 0; i + 1 < SHAPE.length; i++) {
    const lo = ring(SHAPE[i + 1]!, 0), hi = ring(SHAPE[i]!, 0);
    for (let j = 0; j < 8; j++) b.quad(lo[j]!, lo[(j + 1) % 8]!, hi[(j + 1) % 8]!, hi[j]!, sides[j]!);
  }
  // the tail end of the body is closed by the tail part; close the stalk
  const last = ring(SHAPE[SHAPE.length - 1]!, 0), c = v3(HINGE, 0, 0);
  for (let j = 0; j < 8; j++) b.tri(c, last[(j + 1) % 8]!, last[j]!, back);
  // eyes
  for (const s of [1, -1]) {
    b.box(0.06, 0.06, 0.02, allFaces(eye), at(1.0, 0.035, s * 0.115));
    b.box(0.035, 0.035, 0.022, allFaces(pupil), at(1.01, 0.042, s * 0.117));
  }
  // first dorsal, second dorsal, pectorals, anal fin and finlets
  plate(b, [v3(0.35, 0.3, 0), v3(0.2, 0.52, 0), v3(-0.05, 0.3, 0)], fin);
  plate(b, [v3(-0.35, 0.24, 0), v3(-0.5, 0.4, 0), v3(-0.62, 0.15, 0)], fin);
  for (const s of [1, -1]) plate(b, [v3(0.75, -0.14, s * 0.15), v3(0.5, -0.17, s * 0.18), v3(0.62, -0.42, s * 0.3)], fin);
  plate(b, [v3(-0.35, -0.22, 0), v3(-0.55, -0.34, 0), v3(-0.62, -0.1, 0)], fin);
  for (let k = 0; k < 8; k++) {
    const x = -0.62 - k * 0.04, h = 0.13 - k * 0.007, y0 = 0.1 - k * 0.008;
    plate(b, [v3(x, y0, 0), v3(x - 0.05, y0, 0), v3(x - 0.04, y0 + h * 0.35, 0)], yellow);
    plate(b, [v3(x, -y0 + 0.02, 0), v3(x - 0.05, -y0 + 0.02, 0), v3(x - 0.04, -y0 + 0.02 - h * 0.35, 0)], yellow);
  }
  plate(b, [v3(0.5, -0.27, 0), v3(0.2, -0.3, 0), v3(0.0, -0.27, 0)], keel);
  const t = new Builder(32);
  // the tail: a stalk and a crescent of two lobes, local to the hinge
  plate(t, [v3(0, 0.05, 0), v3(0, -0.05, 0), v3(-0.14, -0.05, 0), v3(-0.14, 0.05, 0)], fin);
  plate(t, [v3(-0.12, 0.05, 0), v3(-0.14, 0, 0), v3(-0.38, 0.42, 0), v3(-0.3, 0.12, 0)], fin);
  plate(t, [v3(-0.12, -0.05, 0), v3(-0.3, -0.12, 0), v3(-0.38, -0.42, 0), v3(-0.14, 0, 0)], fin);
  const out = { body: b.geometry(), tail: t.geometry() };
  const mine = cache.get(A) ?? {};
  mine[key] = out;
  cache.set(A, mine);
  return out;
}

const mk = (g: THREE.BufferGeometry, mat: THREE.Material) => {
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
};

const UP = new THREE.Vector3(0, 1, 0);

/** The rotation that turns +x to the direction v, rolled so that the back keeps toward +y as far as it can. */
function orient(v: THREE.Vector3, q: THREE.Quaternion) {
  const f = v.clone().normalize();
  if (f.lengthSq() < 0.5) { q.identity(); return; }
  const z = new THREE.Vector3().crossVectors(f, UP);
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1); // straight up or down
  z.normalize();
  const y = new THREE.Vector3().crossVectors(z, f);
  q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, y, z));
}

/** One bluefin tuna. */
export class Tuna {
  readonly root = new THREE.Group();
  private tail = new THREE.Group();

  constructor(atlas: LitAtlas, mat: THREE.Material, size = 1) {
    const g = geometry(atlas);
    this.root.add(mk(g.body, mat));
    this.tail.position.x = HINGE;
    this.tail.add(mk(g.tail, mat));
    this.root.add(this.tail);
    this.root.scale.setScalar(size);
  }

  /** Puts the tuna at p heading along v (m/s); the tail beats harder the faster it goes (wag 0..1 scales it). */
  pose(t: number, p: THREE.Vector3, v: THREE.Vector3, wag = 1) {
    this.root.position.copy(p);
    orient(v, this.root.quaternion);
    this.tail.rotation.y = tailAngle(t, v.length(), 0) * wag;
  }
}

function tailAngle(t: number, speed: number, phase: number): number {
  const fast = Math.min(1, speed / 12);
  return (0.12 + 0.3 * fast) * Math.sin(t * (4 + 5 * fast) + phase);
}

/** Many tuna: two InstancedMeshes (body and tail) with `count` instances. */
export class TunaSchool {
  readonly root = new THREE.Group();
  private body: THREE.InstancedMesh;
  private tail: THREE.InstancedMesh;
  private o = new THREE.Object3D();
  private q = new THREE.Quaternion();
  private hinge = new THREE.Matrix4();
  private m = new THREE.Matrix4();

  /** `glow`: the emissive strength of the silver flank (0..8). A swarm far off in a night sky needs it to read at all. */
  constructor(atlas: LitAtlas, mat: THREE.Material, readonly count: number, yellowfin = false, glow = 0) {
    const g = geometry(atlas, yellowfin, glow);
    this.body = instanced(g.body, mat, count);
    this.tail = instanced(g.tail, mat, count);
    for (const m of [this.body, this.tail]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.count = 0;
      this.root.add(m);
    }
  }

  /** Writes fish i = 0..pos.length-1 at pos[i] heading along vel[i]; later instances are hidden. `size`: the scale of every fish, or of fish i (default 1). */
  pose(t: number, pos: THREE.Vector3[], vel: THREE.Vector3[], wag?: number[], size: number | number[] = 1) {
    const n = Math.min(pos.length, this.count);
    for (let i = 0; i < n; i++) {
      orient(vel[i]!, this.q);
      this.o.position.copy(pos[i]!);
      this.o.quaternion.copy(this.q);
      this.o.scale.setScalar(typeof size === 'number' ? size : size[i] ?? 1);
      this.o.updateMatrix();
      this.body.setMatrixAt(i, this.o.matrix);
      // the tail: the body matrix, then the hinge turning about y at x = HINGE
      this.hinge.makeRotationY(tailAngle(t, vel[i]!.length(), i * 1.7) * (wag?.[i] ?? 1)).setPosition(HINGE, 0, 0);
      this.m.multiplyMatrices(this.o.matrix, this.hinge);
      this.tail.setMatrixAt(i, this.m);
    }
    this.body.count = n;
    this.tail.count = n;
    this.body.instanceMatrix.needsUpdate = true;
    this.tail.instanceMatrix.needsUpdate = true;
  }
}
