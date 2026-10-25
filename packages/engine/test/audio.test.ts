import { describe, expect, it } from 'bun:test';
import { AudioData } from '../src/audio.ts';

describe('AudioData onset helpers', () => {
  const audio = new AudioData({
    duration: 10,
    bpm: 120,
    beats: [0, 0.5, 1.0, 1.5, 2.0],
    downbeats: [0, 2.0],
    sections: [{ name: 'intro', start: 0, end: 10 }],
    fps: 100,
    envelopes: {},
    onsets: {
      kick: [
        [0.0, 0.9],
        [1.0, 0.8],
        [1.5, 0.1], // weak kick
        [2.0, 0.95],
        [3.0, 0.7],
      ],
    },
  });

  describe('lastHit', () => {
    it('returns null before first hit', () => {
      expect(audio.lastHit('kick', -0.1)).toBeNull();
    });

    it('returns exact hit at hit time', () => {
      expect(audio.lastHit('kick', 1.0)).toEqual([1.0, 0.8]);
    });

    it('returns preceding hit in gap', () => {
      expect(audio.lastHit('kick', 1.4)).toEqual([1.0, 0.8]);
    });

    it('skips hits below min strength threshold', () => {
      // at 1.8, the last hit is at 1.5 with strength 0.1 (< 0.15 default), so it should return 1.0
      expect(audio.lastHit('kick', 1.8)).toEqual([1.0, 0.8]);
      // but with min = 0.05, it returns the weak hit
      expect(audio.lastHit('kick', 1.8, 0.05)).toEqual([1.5, 0.1]);
    });

    it('returns null for nonexistent kind', () => {
      expect(audio.lastHit('snare', 1.0)).toBeNull();
    });
  });

  describe('nextHit', () => {
    it('returns first hit when querying before it', () => {
      expect(audio.nextHit('kick', -0.5)).toEqual([0.0, 0.9]);
    });

    it('returns next hit strictly after t', () => {
      expect(audio.nextHit('kick', 0.0)).toEqual([1.0, 0.8]);
    });

    it('skips hits below min strength threshold', () => {
      // next hit after 1.2 is 1.5 (strength 0.1), which is < 0.15, so nextHit returns 2.0
      expect(audio.nextHit('kick', 1.2)).toEqual([2.0, 0.95]);
      expect(audio.nextHit('kick', 1.2, 0.05)).toEqual([1.5, 0.1]);
    });

    it('returns null after last hit', () => {
      expect(audio.nextHit('kick', 3.5)).toBeNull();
    });
  });

  describe('hitCount', () => {
    it('counts hits in half-open interval [t0, t1) exceeding min', () => {
      // kicks in [0.0, 2.5): 0.0 (0.9), 1.0 (0.8), 1.5 (0.1, weak), 2.0 (0.95)
      // with min = 0.15, weak 1.5 is excluded -> 3 hits
      expect(audio.hitCount('kick', 0.0, 2.5)).toBe(3);
      expect(audio.hitCount('kick', 0.0, 2.5, 0.05)).toBe(4);
    });

    it('excludes hits exactly at t1', () => {
      expect(audio.hitCount('kick', 0.0, 1.0)).toBe(1); // includes 0.0, excludes 1.0
    });
  });
});
