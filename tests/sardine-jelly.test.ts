// The jellyfish (projects/sardine/video/scenes/_jelly.ts): a pose depends on t and the arguments alone, the bell pulses, the held pose
// grips the ends of the bar, and the window pose puts the bar where the screen rectangle is.
import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { JELLY_HEIGHT, Jellyfish, pulse, screenPoint } from '../projects/sardine/video/scenes/_jelly';
import { LH, LW, LitAtlas, camera, litMaterial } from '../packages/engine/src/lit';

const make = (size = 1) => {
  const atlas = new LitAtlas(128);
  return new Jellyfish(atlas, litMaterial(atlas), { size });
};
/** The tips of the ten long tentacles, as numbers. */
const tips = (j: Jellyfish) => Array.from({ length: 10 }, (_, k) => j.tip(k).toArray()).flat();
const bar = (x: number, y: number, z: number, span = 2.6) => ({ anchor: new THREE.Vector3(x, y, z), right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), span });

describe('jellyfish pose', () => {
  test('a pose depends on t alone', () => {
    const j = make();
    const at = new THREE.Vector3(1, 5, 2), v = new THREE.Vector3(0.4, 0, 0);
    j.drift(3.1, at, { v });
    const first = tips(j);
    j.drift(7.7, at);
    expect(tips(j)).not.toEqual(first);
    j.drift(3.1, at, { v });
    expect(tips(j)).toEqual(first);
  });

  test('the bell squeezes and relaxes once in a period, and the pulse is continuous', () => {
    expect(pulse(0)).toBe(0);
    expect(pulse(2.4 * 0.22)).toBeCloseTo(1, 6);
    expect(pulse(2.4)).toBeCloseTo(0, 6);
    for (let t = 0; t < 5; t += 0.01) expect(Math.abs(pulse(t + 0.01) - pulse(t))).toBeLessThan(0.1);
  });

  test('the tentacles hang about a person height below the rim and trail behind a velocity', () => {
    const j = make();
    const at = new THREE.Vector3(0, 10, 0);
    j.drift(2, at, { yaw: 0 });
    const low = Math.min(...Array.from({ length: 10 }, (_, k) => j.tip(k).y));
    expect(10 - low).toBeGreaterThan(1.1);
    expect(10 - low).toBeLessThan(JELLY_HEIGHT);
    const still = j.tip(3).x;
    j.drift(2, at, { yaw: 0, v: new THREE.Vector3(2, 0, 0) });
    expect(j.tip(3).x).toBeLessThan(still);
  });
});

describe('holding a title bar', () => {
  test('two tentacles reach the ends of the bar, the bell sits on it', () => {
    const j = make();
    j.hold(1.3, bar(4, 2, -6));
    const size = j.root.scale.x;
    // the curl of the grip is 0.1 jellyfish metres below the end of the bar and 0.03 out of the window
    expect(j.tip(0).distanceTo(new THREE.Vector3(4 + 1.3, 2, -6))).toBeLessThan(0.15 * size);
    expect(j.tip(5).distanceTo(new THREE.Vector3(4 - 1.3, 2, -6))).toBeLessThan(0.15 * size);
    expect(j.root.position.y).toBeGreaterThan(2);
    expect(j.root.position.x).toBeCloseTo(4, 6);
    // the other tentacles hang below the bar
    expect(j.tip(2).y).toBeLessThan(1);
  });

  test('a grip of 0 lets go: the tentacles hang free', () => {
    const j = make();
    j.hold(1, bar(0, 2, 0), { grip: 0 });
    expect(j.tip(0).y).toBeLessThan(1);
  });

  test('holdWindow puts the middle of the bar at the middle of the top edge of the rectangle', () => {
    const cam = camera(50, 0.05, 100);
    cam.position.set(-3, 2, 5);
    cam.lookAt(-3, 2, -5);
    cam.updateMatrixWorld(true);
    const rect = [190, 96, 270, 160] as const;
    const j = make();
    j.holdWindow(0.7, cam, rect, 7);
    const a = screenPoint(cam, rect[0] + rect[2] / 2, rect[1], 7).project(cam), b = j.root.position.clone().project(cam);
    // the rim of the bell is just above the bar (0.03 of the jellyfish)
    expect(Math.abs((a.x - b.x) * (LW / 2))).toBeLessThan(0.5);
    expect(Math.abs((a.y - b.y) * (LH / 2))).toBeLessThan(4);
    // the jellyfish is a bar over 2.6 big
    const left = screenPoint(cam, rect[0], rect[1], 7), right = screenPoint(cam, rect[0] + rect[2], rect[1], 7);
    expect(j.root.scale.x).toBeCloseTo(left.distanceTo(right) / 2.6, 6);
  });
});
