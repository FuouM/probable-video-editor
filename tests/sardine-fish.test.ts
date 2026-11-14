// The sardine's motion (projects/sardine/video/scenes/_fish.ts): the nose follows the path, it turns by banking, it never slides, it glides
// and stops, and a pose depends on the call alone.
import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { Fish, SwimPath, type SwimKey } from '../projects/sardine/video/scenes/_fish';
import { LitAtlas, litMaterial } from '../packages/engine/src/lit';

const SPB = 60 / 135;
const TOWARD_TRAIN = Math.PI / 2;
const key = (t: number, x: number, y: number, z: number, o: { stop?: boolean; face?: number } = {}): SwimKey => ({ t, p: [x, y, z], ...o });

/** The boarding of the intro (`ride.ts`, 7.111-14.222) and the first swim of verse 1: the keys of the scene. */
const T_START = 4 * 4 * SPB, T_WAIT = 8.4, T_STRIP = 8 * 4 * SPB;
const boarding = () => new SwimPath([
  key(T_START, -3.2, 1.75, 3.3, { face: TOWARD_TRAIN }), key(T_WAIT, -3.0, 1.8, 3.3, { stop: true, face: TOWARD_TRAIN }), key(9.3, 0.4, 1.95, 3.0), key(9.9, 3.6, 2.0, 2.6),
  key(10.15, 5.3, 2.0, 1.6), key(10.35, 5.0, 2.05, 0.5), key(10.9, 3.4, 1.95, 0.3), key(11.8, 0.6, 1.95, 0.6), key(12.9, -2.4, 2.05, 0.7, { stop: true, face: TOWARD_TRAIN }),
  key(T_STRIP, -2.4, 2.05, 0.7, { stop: true, face: TOWARD_TRAIN }), key(14.8, 1.6, 2.15, 0.7), key(15.1, 4.6, 2.25, 0.55), key(15.4, 7.4, 2.35, 0.3), key(15.65, 8.6, 2.4, 0.15),
]);

const yawOf = (v: THREE.Vector3) => Math.atan2(-v.z, v.x);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** The velocity of the path in the ground plane (the slow bob of a held fish is left out). */
const velocity = (path: SwimPath, t: number) => {
  const a = path.at(t + 1 / 72).p, b = path.at(t - 1 / 72).p;
  a.y = b.y = 0;
  return a.sub(b).multiplyScalar(36);
};

describe('swim path heading', () => {
  test('the nose points along the direction of travel wherever the fish swims', () => {
    const path = boarding();
    let worst = 0;
    for (let t = T_START; t <= 15.65; t += 1 / 36) {
      const vel = velocity(path, t);
      vel.y = 0;
      // the hairpin of the door (the path itself turns 130 degrees in 0.4 s, 9.9-10.4 s) is a turn at the follower's limit: left out here
      if (vel.length() < 0.8 || (t > 9.9 && t < 10.4)) continue;
      const nose = path.at(t).v.clone().setY(0);
      worst = Math.max(worst, Math.abs(wrap(yawOf(nose) - yawOf(vel))));
    }
    // the follower lags a turn by a few frames: under 20 degrees everywhere else on the boarding
    expect(worst).toBeLessThan(0.35);
  });

  test('it turns by banking: the heading changes at most 7 rad/s, never in a snap', () => {
    const path = boarding();
    let prev = yawOf(path.at(T_START).v), worstStep = 0;
    for (let t = T_START + 1 / 36; t <= 15.65; t += 1 / 36) {
      const yaw = yawOf(path.at(t).v);
      worstStep = Math.max(worstStep, Math.abs(wrap(yaw - prev)));
      prev = yaw;
    }
    expect(worstStep).toBeLessThanOrEqual((7 + 0.5) / 36);
  });

  test('it waits looking at the train, then turns to its first direction of travel', () => {
    const path = boarding();
    expect(yawOf(path.at(T_START + 0.2).v)).toBeCloseTo(TOWARD_TRAIN, 1);
    expect(yawOf(path.at(T_WAIT - 0.5).v)).toBeCloseTo(TOWARD_TRAIN, 1);
    // on the platform it swims along +x, head first
    expect(Math.abs(wrap(yawOf(path.at(9.5).v) - 0))).toBeLessThan(0.5);
  });

  test('a stop key glides to rest: no speed on the key, and the speed rises smoothly on both sides', () => {
    const path = boarding();
    // a central difference across the key sees a little of the departing side: under 0.1 m/s is at rest
    expect(velocity(path, 12.9).length()).toBeLessThan(0.1);
    expect(velocity(path, T_WAIT).length()).toBeLessThan(0.1);
    let worst = 0;
    for (let t = 12.4; t < 12.9; t += 1 / 72) worst = Math.max(worst, Math.abs(velocity(path, t + 1 / 72).length() - velocity(path, t).length()));
    // the speed never jumps (more than 0.4 m/s between two steps of 1/72 s)
    expect(worst).toBeLessThan(0.4);
  });

  test('at rest it holds its heading, and it turns to the face of the key it rests on', () => {
    const path = boarding();
    // it arrives at the seat heading -x (yaw pi), then turns to face the far window
    expect(Math.abs(wrap(yawOf(path.at(12.5).v) - Math.PI))).toBeLessThan(0.6);
    expect(yawOf(path.at(13.8).v)).toBeCloseTo(TOWARD_TRAIN, 1);
    // it keeps that heading while it rests, and turns to its new direction before it sets off (the nose looks 0.2 s ahead)
    expect(yawOf(path.at(T_STRIP - 0.5).v)).toBeCloseTo(TOWARD_TRAIN, 1);
    expect(Math.abs(wrap(yawOf(path.at(T_STRIP + 0.4).v)))).toBeLessThan(0.4);
  });

  test('a path with one place has a fixed heading: no spin in place', () => {
    const path = new SwimPath([key(0, -2.4, 2.05, 0.7), key(1, -2.4, 2.05, 0.7)]);
    const yaws = [0, 3, 9, 27].map((t) => yawOf(path.at(t).v));
    for (const y of yaws) expect(y).toBeCloseTo(yaws[0]!, 6);
  });

  test('the path is a pure function of t', () => {
    const a = boarding(), b = boarding();
    expect(a.at(11.3).v.toArray()).toEqual(b.at(11.3).v.toArray());
    expect(a.at(11.3).v.toArray()).toEqual(a.at(11.3).v.toArray());
  });
});

describe('fish pose', () => {
  const atlas = new LitAtlas(256);
  const fish = new Fish(atlas, litMaterial(atlas));

  test('a pose depends on the call alone: a fish with no speed faces +x, level, whatever it did before', () => {
    fish.pose(1, new THREE.Vector3(), new THREE.Vector3(0, 0, -3), 2);
    expect(Math.abs(fish.root.rotation.y)).toBeGreaterThan(1);
    fish.pose(1, new THREE.Vector3(), new THREE.Vector3(0, 0, 0));
    expect(fish.root.rotation.y).toBeCloseTo(0, 9);
    expect(fish.root.rotation.z).toBeCloseTo(0, 9);
    expect(fish.root.rotation.x).toBeCloseTo(0, 9);
  });

  test('the nose is along the velocity and the body banks into a left turn', () => {
    fish.pose(1, new THREE.Vector3(), new THREE.Vector3(0, 0, -2), 1.5);
    expect(fish.root.rotation.y).toBeCloseTo(Math.PI / 2, 6);
    // a left turn (the heading grows) rolls the left side down: a negative roll about the nose
    expect(fish.root.rotation.x).toBeLessThan(0);
  });

  test('the pass hangs from a mount under the left pectoral fin, at a size that reads and stays under half the fish', () => {
    expect(fish.passMount.position.z).toBeLessThan(0);
    expect(fish.passMount.position.y).toBeLessThan(0);
    // the card is 0.086 x 0.054 m before the scale
    expect(0.086 * Fish.PASS_SCALE).toBeGreaterThan(0.7 / 4);
    expect(0.086 * Fish.PASS_SCALE).toBeLessThan(0.7 / 2);
    const card = new THREE.Object3D();
    fish.hold(card);
    expect(card.parent).toBe(fish.passMount);
    // the top edge of the card is at the mount: the card hangs below it
    expect(card.position.y).toBeLessThan(-0.054 * Fish.PASS_SCALE / 2);
  });

  test('it hangs from the pick-up hand by the tail and lies on the ground at lift 0', () => {
    const anchor = new THREE.Vector3(1, 3, 2);
    fish.dangle(anchor, 0, 0, 0);
    // hanging straight down: the nose points down, the head joint is below the grip
    expect(fish.root.position.y).toBeLessThan(3);
    expect(fish.root.position.x).toBeCloseTo(1, 6);
    fish.dangle(anchor, 0, 0, 0, { lift: 0, restY: 0.5 });
    expect(fish.root.position.y).toBeCloseTo(0.5, 6);
  });
});
