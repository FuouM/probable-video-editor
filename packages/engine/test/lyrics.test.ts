import { describe, expect, it } from 'bun:test';
import { Lyrics } from '../src/lyrics.ts';

describe('Lyrics helpers', () => {
  const lyrics = new Lyrics({
    lines: [
      {
        i: 0,
        text: 'hello world',
        start: 1.0,
        end: 3.0,
        words: [
          { w: 'hello', start: 1.0, end: 1.8 },
          { w: 'world', start: 2.0, end: 3.0 },
        ],
      },
      {
        i: 1,
        text: 'next line',
        start: 4.0,
        end: 6.0,
        words: [
          { w: 'next', start: 4.0, end: 4.8 },
          { w: 'line', start: 5.0, end: 6.0 },
        ],
      },
    ],
  });

  describe('lineOnScreen', () => {
    it('returns null before the line appears', () => {
      expect(lyrics.lineOnScreen(0.5)).toBeNull();
    });

    it('returns line just before words start (lead-in window)', () => {
      const res = lyrics.lineOnScreen(0.95);
      expect(res).not.toBeNull();
      expect(res!.line.i).toBe(0);
      expect(res!.out).toBe(0);
    });

    it('returns line during singing with out = 0', () => {
      const res = lyrics.lineOnScreen(2.5);
      expect(res).not.toBeNull();
      expect(res!.line.i).toBe(0);
      expect(res!.out).toBe(0);
    });

    it('fades out during hold/fade window', () => {
      // line ends at 3.0, hold is 0.35 -> until 3.35, fade 0.2 -> fully faded at 3.55
      const held = lyrics.lineOnScreen(3.2);
      expect(held).not.toBeNull();
      expect(held!.out).toBe(0);

      const fading = lyrics.lineOnScreen(3.45);
      expect(fading).not.toBeNull();
      expect(fading!.out).toBeCloseTo(0.5, 1);

      const past = lyrics.lineOnScreen(3.6);
      expect(past).toBeNull();
    });

    it('clamps hold to next line start - 0.02', () => {
      // next line starts at 4.0; if line 0 was at 3.9 it would be capped before 3.98
      const res = lyrics.lineOnScreen(3.99);
      expect(res).toBeNull();
    });
  });

  describe('wordNow', () => {
    const line = lyrics.lines[0]!;

    it('returns null before first word', () => {
      expect(lyrics.wordNow(line, 0.5)).toBeNull();
    });

    it('returns current active word', () => {
      const w1 = lyrics.wordNow(line, 1.2);
      expect(w1?.w.w).toBe('hello');
      expect(w1?.i).toBe(0);

      const w2 = lyrics.wordNow(line, 2.5);
      expect(w2?.w.w).toBe('world');
      expect(w2?.i).toBe(1);
    });

    it('returns last sung word during inter-word gap', () => {
      const gap = lyrics.wordNow(line, 1.9); // between 1.8 and 2.0
      expect(gap?.w.w).toBe('hello');
    });
  });
});
