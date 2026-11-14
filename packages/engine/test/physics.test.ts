import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { bake, type BakeSpec } from '../src/physics.ts';

const spec = (): BakeSpec => ({
  t0: 0,
  t1: 1,
  hz: 64,
  bodies: [
    { shape: { kind: 'box', half: [10, 0.5, 10] }, pose: { p: [0, -0.5, 0], q: [0, 0, 0, 1] }, type: 'fixed' },
    { shape: { kind: 'box', half: [0.5, 0.5, 0.5] }, pose: { p: [0, 3, 0], q: [0, 0, 0, 1] }, spin: [1, 2, 3], vel: [1, 0, 0] },
    { shape: { kind: 'ball', r: 0.5 }, pose: { p: [3, 2, 0], q: [0, 0, 0, 1] }, wakeAt: 0.5 },
  ],
});

describe('physics bake', () => {
  it('is bitwise deterministic', async () => {
    const a = await bake(spec()), b = await bake(spec());
    expect(Buffer.from(a.data.buffer).equals(Buffer.from(b.data.buffer))).toBe(true);
    expect(a.hit(1)).toBe(b.hit(1));
  });

  it('returns stored steps exactly, interpolates between them and clamps outside', async () => {
    const a = await bake(spec());
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), p2 = new THREE.Vector3(), q2 = new THREE.Quaternion();
    const o = 7 * 10; // step 10 of body 1 (the fixed body stores one pose, so body 1 starts at 7)
    a.pose(1, 10 / 64, p, q);
    expect([p.x, p.y, p.z]).toEqual([a.data[7 + o], a.data[7 + o + 1], a.data[7 + o + 2]]);
    expect(q.w).toBe(a.data[7 + o + 6]);
    a.pose(1, 10.5 / 64, p2, q2);
    a.pose(1, 11 / 64, p, q);
    expect(p2.y).toBeCloseTo((a.data[7 + o + 1] + p.y) / 2, 6);
    expect(Math.hypot(q2.x, q2.y, q2.z, q2.w)).toBeCloseTo(1, 6);
    a.pose(1, -5, p, q);
    expect([p.x, p.y]).toEqual([0, 3]);
    a.pose(1, 99, p, q);
    a.pose(1, 1, p2, q2);
    expect(p.equals(p2)).toBe(true);
  });

  it('holds a body until wakeAt and reports the first contact', async () => {
    const a = await bake(spec());
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    a.pose(2, 0.49, p, q);
    expect(p.y).toBe(2);
    a.pose(2, 1, p, q);
    expect(p.y).toBeLessThan(2);
    expect(a.hit(1)).toBeGreaterThan(0.5);
    expect(a.hit(1)).toBeLessThan(1);
  });
});
