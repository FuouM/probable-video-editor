// The copy of the world of chorus 2 that unloads in chorus 3 (`chorus3.ts`). Every plain mesh of the world, as it stands at the first
// frame, gets a copy that is cut into chunks (`@pve/engine/chunks`) in the stage frame. The scene hides the mesh and draws the copy.
// The other objects (instanced ones, those with a material of their own) stay as they are, and go when their place unloads.
import * as THREE from 'three';
import { chunkArrays, chunkedGeometry, type ChunkArrays, type ChunkKeep } from '@pve/engine/chunks';
import { v3 } from '@pve/engine/lit';
import { settleC2, type C2Shared } from './_c2shared';
import { C3_GRID, unloadAt } from './_c3unload';
import { GW_TO_STAGE, T0, X_EXIT, X_WALL } from './_c3stage';

/** The copies, the meshes that they stand for, and the other objects of the world with the time at which each goes. */
export interface WorldCopy { copies: THREE.Group; originals: THREE.Object3D[]; loose: { obj: THREE.Object3D; at: number }[] }

/** The cut is slow: the scene memoizes it (`SceneCtx.memo`, in the order of the walk). */
export type Memo = (key: string, make: () => ChunkArrays[]) => Promise<ChunkArrays[]>;

/** A mesh to cut: its world matrix in the stage frame, its kind (0 the world, 2 the far hills) and the filter of its pieces. */
interface Job { o: THREE.Mesh; matrix: THREE.Matrix4; kind: number; keep: ChunkKeep | null }

/** The middle of an object in the stage frame: an instanced mesh by the mean of its instances. */
function middle(o: THREE.Mesh, mid: THREE.Vector3, m4: THREE.Matrix4): THREE.Vector3 {
  if (o instanceof THREE.InstancedMesh && o.count > 0) {
    mid.set(0, 0, 0);
    for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m4); mid.x += m4.elements[12]!; mid.y += m4.elements[13]!; mid.z += m4.elements[14]!; }
    mid.divideScalar(o.count).applyMatrix4(o.matrixWorld);
  } else o.getWorldPosition(mid);
  return mid.applyMatrix4(GW_TO_STAGE);
}

/**
 * The world is cleared between the new line and the side view. A piece of a house goes by the middle of its house, so that a house at
 * the edge of that space stays whole or goes whole (a cut by pieces left houses with holes in their roofs and walls).
 */
function keepTown(S: C2Shared): ChunkKeep {
  const cleared = (x: number, z: number) => z < 3.6 && z > -56 && x < X_EXIT - 26;
  const homes = S.world.houses.map((h) => {
    const c = v3(h.x, 0, h.z).applyMatrix4(GW_TO_STAGE);
    return { x: c.x, z: c.z, r2: (Math.hypot(h.w, h.d) / 2 + 1) ** 2 };
  });
  return (x, z) => {
    const home = homes.find((q) => (x - q.x) ** 2 + (z - q.z) ** 2 < q.r2);
    return home ? !cleared(home.x, home.z) : !cleared(x, z);
  };
}

/** Walks the visible world: the plain meshes to cut, and the other objects with the time at which their place unloads. */
function walk(S: C2Shared, loose: WorldCopy['loose']): Job[] {
  const W3 = S.world;
  const train = new Set<THREE.Object3D>();
  for (const c of W3.cars) c.root.traverse((o) => train.add(o));
  const far = new Set<THREE.Object3D>();
  W3.far.traverse((o) => far.add(o));
  const mid = new THREE.Vector3(), m4 = new THREE.Matrix4(), town = keepTown(S);
  const jobs: Job[] = [];
  W3.scene.traverseVisible((o) => {
    if (!(o instanceof THREE.Mesh) || train.has(o)) return;
    const plain = !(o instanceof THREE.InstancedMesh) && (o.material === W3.mat || o.material === W3.groundMat) && !o.geometry.index && o.geometry.getAttribute('aCell') !== undefined;
    if (!plain) {
      const p = middle(o, mid, m4);
      loose.push({ obj: o, at: unloadAt(p.x, p.z) + C3_GRID.check });
      return;
    }
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox!;
    const isFar = far.has(o), flat = bb.max.y - bb.min.y < 1.2;
    // the far hills: none near the wall, and a gap where the new line goes through them. The things of the world: none on the new line, and
    // none between it and the side view (the ground stays)
    const keep: ChunkKeep | null = isFar ? (x, z) => x > X_WALL + 170 && !(Math.abs(z) < 18 && x < X_EXIT) : flat ? null : town;
    jobs.push({ o, matrix: GW_TO_STAGE.clone().multiply(o.matrixWorld), kind: isFar ? 2 : 0, keep });
  });
  return jobs;
}

/**
 * Makes the copies of the world of chorus 2 with the material `mat`. The first scene that copies the world fills the lists of the shared
 * state (`hidden`: what the copies stand for; `rest`: all of the scene of the world but the train, which goes out of the picture when the
 * world has unloaded).
 */
export async function copyWorld(S: C2Shared, mat: THREE.Material, memo: Memo): Promise<WorldCopy> {
  const W3 = S.world;
  settleC2(S);
  S.events.pose(T0);
  W3.light('close', 'day', v3(0, 0, -100), 0.8);
  W3.scene.updateMatrixWorld(true);
  const out: WorldCopy = { copies: new THREE.Group(), originals: [], loose: [] };
  const fill = S.hidden.length === 0;
  const jobs = walk(S, out.loose);
  const arrays = await memo('copies', () => jobs.map((j) => chunkArrays(C3_GRID, j.o.geometry, j.matrix, j.kind, j.keep)));
  if (arrays.length !== jobs.length) throw new Error(`chorus3: ${arrays.length} memoized world copies for ${jobs.length} meshes`);
  jobs.forEach(({ o }, k) => {
    const copy = new THREE.Mesh(chunkedGeometry(arrays[k]!), mat);
    copy.castShadow = o.castShadow;
    copy.receiveShadow = o.receiveShadow;
    copy.frustumCulled = false;
    out.copies.add(copy);
    out.originals.push(o);
    if (fill) S.hidden.push(o);
  });
  if (fill) {
    for (const l of out.loose) S.hidden.push(l.obj);
    const train = new Set<THREE.Object3D>([W3.cars[0].root, W3.cars[1].root, W3.joint]);
    for (const c of W3.scene.children) if (!train.has(c)) S.rest.push({ obj: c, visible: c.visible });
  }
  return out;
}
