import { describe, expect, it } from 'bun:test';
import { cameraDistance, cutSpan, formatTime, pad0, project3D } from '../src/util.ts';

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

describe('formatting helpers', () => {
  it('pad0 pads numbers with zeros', () => {
    expect(pad0(5, 2)).toBe('05');
    expect(pad0(12, 2)).toBe('12');
    expect(pad0(7, 4)).toBe('0007');
  });

  it('formatTime formats seconds into song timestamp', () => {
    expect(formatTime(65.4, 1)).toBe('1:05.4');
    expect(formatTime(9.2, 1)).toBe('0:09.2');
    expect(formatTime(125, 0)).toBe('2:05');
  });

  it('cameraDistance computes distance for matching viewport height', () => {
    const d = cameraDistance(30, 1080);
    expect(d).toBeCloseTo(1080 / 2 / Math.tan((15 * Math.PI) / 180), 2);
  });
});
