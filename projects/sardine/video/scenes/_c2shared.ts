// The world of chorus 2 and chorus 3 (treatment v9 "Plate 8", "Plate 9"): one `GameWorld` in its twisted state with the parts of
// `C2World`, the train and the sardine. The scenes of chorus 2, chorus 3 and the outro all draw this one world: chorus 3 is the
// same place as chorus 2, not a copy of it. `acquireC2` builds it once, `releaseC2` frees it when the last scene lets go.
//
// A scene that draws the world sets all that it reads on each frame (the cars, the light, `C2World.pose`, the parent of
// `world.scene`): another scene can have drawn it at another time just before.
import * as THREE from 'three';
import type { Line } from '@pve/engine/lyrics';
import { BAR, bar } from './_time';
import type { Fonts } from './_fonts';
import { Fish } from './_fish';
import { carriedPass } from './_ticket';
import { GameWorld, LOOPED } from './_gameWorld';
import { CAR_PITCH, twistLap } from './_route';
import { C2World, type C2Times } from './_c2world';

// ---------------------------------------------------------------- the ride of chorus 2
export const LAP = twistLap();
/** One lap is 8 bars. */
export const SPEED = LAP.len / (8 * BAR);
/** The train is at the start of the crossing at this time, and 8 bars later. */
export const T_CROSS = 115.278;
/** The lap position (m) of the middle of the front car at t. It goes on past one lap. */
export const lapAt = (t: number) => SPEED * (t - T_CROSS);
/** The world matrix of car `k` (0 front, 1 rear) on the lap at t. */
export const carMatrix = (t: number, k: number) => LAP.car(lapAt(t) - k * CAR_PITCH);

const UP = new THREE.Vector3(0, 1, 0);
/** The matrix `m` of a car, but upright: its place and its heading. A camera on this frame does not roll with the train. */
export function upright(m: THREE.Matrix4): THREE.Matrix4 {
  const x = new THREE.Vector3().setFromMatrixColumn(m, 0), z = new THREE.Vector3().crossVectors(x, UP).normalize();
  return new THREE.Matrix4().makeBasis(x, new THREE.Vector3().crossVectors(z, x), z).setPosition(new THREE.Vector3().setFromMatrixPosition(m));
}

/** The side arm of the ride cam at the end of chorus 2, in the frame of the front car: chorus 3 starts on it. */
export const SIDE_ARM = { eye: [-18, 3.5, -15], look: [8, -2.5, 0], fov: 58, lag: 0.14 } as const;

/** The times of `C2World` from the lead lines 22-30 and the eight `ko` lines of chorus 2. */
export function c2Times(lead: readonly Line[], ko: readonly Line[]): C2Times {
  const units = (k: number) => lead[k]!.written!.units.map((u) => u.start);
  return {
    lapAt, speed: SPEED, sprout: units(1), holes: units(2), sleepers: lead[3]!.start, forget: units(4),
    unsure: [lead[5]!.start, lead[6]!.start], floors: units(6), eye: units(7), closer: ko.map((l) => l.start), end: bar(77),
  };
}

// ---------------------------------------------------------------- the one world
export interface C2Shared {
  world: GameWorld;
  events: C2World;
  /** The sardine in the front car. */
  fish: Fish;
  /** The objects of the world that chorus 3 hides (it draws its own copies of them, which unload): `settleC2` shows them again. */
  hidden: THREE.Object3D[];
  /** The children of the scene of the world but the train, and whether each shows at the first frame of chorus 3. Chorus 3 hides them all when the world has unloaded. */
  rest: { obj: THREE.Object3D; visible: boolean }[];
}

/**
 * Puts the world back as it stands at the first frame of chorus 3, by itself: every object that chorus 3 hides shows again. The scene
 * that draws it then poses it for its own time (`C2World.pose`, `GameWorld.light`).
 */
export function settleC2(s: C2Shared) {
  s.world.scene.removeFromParent();
  for (const r of s.rest) r.obj.visible = r.visible;
  for (const o of s.hidden) o.visible = true;
}

let slot: { made: Promise<C2Shared>; users: number } | null = null;

/** The world of chorus 2. `lead`: lead lines 22-30. `ko`: the `ko` lines 0-7. */
export function acquireC2(fonts: Fonts, lead: readonly Line[], ko: readonly Line[]): Promise<C2Shared> {
  if (!slot) {
    slot = {
      users: 0,
      made: (async () => {
        const world = new GameWorld(fonts);
        world.buildTwist({ sleepers: false });
        world.pose(LOOPED);
        world.poseTwist('twisted');
        const events = new C2World(world, c2Times(lead, ko));
        await events.bake();
        const fish = new Fish(world.atlas, world.mat);
        fish.hold(carriedPass(fonts, true).root);
        world.cars[0].root.add(fish.root);
        world.cars[0].setInterior(0.5);
        return { world, events, fish, hidden: [], rest: [] };
      })(),
    };
  }
  slot.users++;
  return slot.made;
}

export function releaseC2() {
  if (!slot) return;
  slot.users--;
  if (slot.users > 0) return;
  const made = slot.made;
  slot = null;
  void made.then((s) => { s.events.dispose(); s.world.dispose(); });
}
