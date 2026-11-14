// The minimap of chorus 3 (`chorus3.ts`): the game opens it now and then, between the fish cams, and the player shuts it with [x].
// Each time it has another view of the train and the world that unloads behind it: straight down (the nose up), isometric (from behind
// and to the right), and from the side (as a side scroller). The train is a dot that blinks on the beat.
import * as THREE from 'three';
import type { TextLayer } from '@pve/engine/textlayer';
import { projectToRect } from '@pve/engine/util';
import { SPB } from './_time';
import type { PlayerState, Rect, Vec3 } from './_playerTypes';
import { trainDot } from './_sceneKit';

/** The `[MAP]` window: bottom left, over the key strip, out of the way of the lines in the sky. */
export const MAP_RECT: Rect = [8, 200, 156, 104];
export type MapMode = 'top' | 'iso' | 'side';
export const MAP_VIEWS: readonly { id: string; from: number; to: number; mode: MapMode }[] = [
  { id: 'map-1', from: 142.6, to: 145.6, mode: 'top' },
  { id: 'map-2', from: 149.6, to: 152.4, mode: 'iso' },
  { id: 'map-3', from: 157.0, to: 160.2, mode: 'side' },
];
/**
 * For each view: the direction from the train to the eye (stage frame: the train heads -x; the eye is 1200 m off), the up of the picture,
 * the half height of what it shows (m), and the near and far planes (m from the eye).
 */
const MAP_LOOK: Record<MapMode, { dir: Vec3; up: Vec3; half: number; near: number; far: number }> = {
  top: { dir: [0, 1, 0], up: [-1, 0, 0], half: 120, near: 1, far: 3000 },
  iso: { dir: [1, 1.15, -1], up: [0, 1, 0], half: 80, near: 1, far: 3000 },
  // a side scroller: a slab of the world from just in front of the track to 50 m behind it, a little from above, so the ground is a
  // band under the train
  side: { dir: [0, 0.3, 1], up: [0, 1, 0], half: 14, near: 1188, far: 1250 },
};

/** Aims the camera `c` of the minimap in the view `mode` (picture aspect `aspect`) on the front car at `p` (stage frame). Returns `p`. */
export function mapAt(c: THREE.OrthographicCamera, p: THREE.Vector3, aspect: number, mode: MapMode): THREE.Vector3 {
  const L = MAP_LOOK[mode];
  c.left = -L.half * aspect; c.right = L.half * aspect; c.top = L.half; c.bottom = -L.half;
  c.near = L.near; c.far = L.far;
  c.position.set(...L.dir).normalize().multiplyScalar(1200).add(p);
  c.up.set(...L.up);
  c.lookAt(p);
  c.updateProjectionMatrix();
  c.updateMatrixWorld(true);
  return p;
}

/** The train on each open minimap: a dot that blinks on the beat (on for the first half of each). `car(t)`: the front car (stage frame). */
export function drawMap(l: TextLayer, c: THREE.OrthographicCamera, st: PlayerState, t: number, car: (t: number) => THREE.Vector3) {
  for (const win of st.windows) {
    const map = MAP_VIEWS.find((q) => q.id === win.id);
    if (!map || win.grow < 1 || t % SPB >= SPB / 2) continue;
    const [, , w, h] = win.content;
    const p = mapAt(c, car(t), w / h, map.mode).project(c);
    trainDot(l, projectToRect(p, win.content), '#ffd23a');
  }
}
