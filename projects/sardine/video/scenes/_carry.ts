// The pick-up hand on the map: the world point of its grip, and the pose of the fish that it carries and lets go (`ride.ts`).
import * as THREE from 'three';
import { smooth } from '@pve/engine/util';
import { LH, LW, v3 } from '@pve/engine/lit';
import type { Fish } from './_fish';
import type { CarryState } from './_playerTypes';

/** The height that a dropped fish falls to (m): the floor of the balcony of the player's house. */
const DROP_FLOOR = 4.6;

/**
 * The screen point (px) of the hand's grip as a world point of the orthographic view: 14 px under the cursor tip, below the arrow. The point lies near
 * the camera on the cursor's ray (NDC z -0.9): an orthographic view shows it at the same pixel at any depth, and there nothing in the map stands in front of it.
 */
export function gripAt(cam: THREE.OrthographicCamera, px: number, py: number): THREE.Vector3 {
  // `MapCam.apply` sets the pose but not the matrices; `LitView.render` updates them later, so a fresh render would unproject through a stale camera
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return new THREE.Vector3((px / LW) * 2 - 1, 1 - ((py + 14) / LH) * 2, -0.9).unproject(cam);
}

/**
 * Poses the map fish in the pick-up hand: lifted, hanging by the tail from `grip` and swinging, then (phase `drop`) falling through the balcony door into the
 * house. `grip`: the world point of the hand (`gripAt` while carried, the grip at the let-go for the fall). `side`: the screen's right as a ground vector.
 */
export function poseCarriedFish(fish: Fish, c: CarryState, grip: THREE.Vector3, side: THREE.Vector3) {
  const anchor = grip.clone();
  if (c.phase === 'drop') {
    // down onto the balcony and in through the door (the door is in the +z wall: the fish goes toward -z)
    anchor.y = Math.max(DROP_FLOOR, grip.y - 15 * c.since * c.since);
    anchor.z -= 2.4 * smooth(c.since / 0.3);
  }
  fish.dangle(anchor, c.swing * 0.5 - 0.5 * c.lift, c.wriggle, c.amp, { side, lift: c.lift, restY: anchor.y });
  // the flank faces the map camera: the fish turns about its own length axis
  const q = fish.root.quaternion;
  const d = v3(1, 0, 0).applyQuaternion(q), n = v3(0, 0, 1).applyQuaternion(q);
  const face = v3(-side.z, 0, side.x);
  face.addScaledVector(d, -face.dot(d));
  if (face.lengthSq() > 1e-4) {
    face.normalize();
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(d, c.lift * Math.atan2(d.dot(n.clone().cross(face)), n.dot(face))));
  }
}
