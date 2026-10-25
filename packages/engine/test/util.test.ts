import { describe, expect, it } from 'bun:test';
import { cutSpan, project3D } from '../src/util.ts';

describe('project3D', () => {
  it('projects target point to screen center', () => {
    const res = project3D([0, 0, 0], [0, 0, 5], [0, 0, 0], Math.PI / 3);
    expect(res.x).toBeCloseTo(960, 2);
    expect(res.y).toBeCloseTo(540, 2);
    expect(res.z).toBeCloseTo(5, 2);
  });

  it('projects points to the right with x > 960', () => {
    const res = project3D([1, 0, 0], [0, 0, 5], [0, 0, 0], Math.PI / 3);
    expect(res.x).toBeGreaterThan(960);
    expect(res.y).toBeCloseTo(540, 2);
  });

  it('projects points above with y < 540 (y down in screen pixels)', () => {
    const res = project3D([0, 1, 0], [0, 0, 5], [0, 0, 0], Math.PI / 3);
    expect(res.x).toBeCloseTo(960, 2);
    expect(res.y).toBeLessThan(540);
  });

  it('supports object-style vector inputs', () => {
    const res = project3D({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }, Math.PI / 3);
    expect(res.x).toBeCloseTo(960, 2);
    expect(res.y).toBeCloseTo(540, 2);
  });
});

describe('cutSpan', () => {
  const clips = [{ start: 0, end: 10 }, { start: 10, end: 20 }, { start: 18, end: 19 }];
  it('is bounded by the nearest boundaries either side of t', () => {
    expect(cutSpan(clips, 5)).toEqual([0, 10]);
    expect(cutSpan(clips, 14)).toEqual([10, 18]);
  });
  it('puts a frame exactly on a cut after it, as the compositor does', () => {
    expect(cutSpan(clips, 10)).toEqual([10, 18]);
  });
  it('is open beyond the first start and the last end', () => {
    expect(cutSpan(clips, 25)).toEqual([20, Infinity]);
  });
});
