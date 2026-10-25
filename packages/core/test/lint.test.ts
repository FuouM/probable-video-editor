import { describe, expect, it } from 'bun:test';
import { lintVideo } from '../src/lint.ts';
import { resolveVideo } from '../src/resolve.ts';
import type { ResolvedClip, ResolvedVideo } from '../src/types.ts';
import { syntheticTiming } from './fixtures/song.ts';

function resolvedVideo(clips: ResolvedClip[]): ResolvedVideo {
  return {
    title: 'lint-test',
    fps: 60,
    size: [1920, 1080],
    duration: 8,
    bpm: 120, // 0.5 s per beat
    markers: {},
    clips,
    transitions: [],
  };
}

function clip(id: string, start: number, end: number, startBeat: number, endBeat: number): ResolvedClip {
  return { id, start, end, dur: end - start, startBeat, endBeat };
}

describe('lintVideo', () => {
  it('reports nothing on two clips that meet on beats', () => {
    const result = lintVideo(resolvedVideo([clip('clip1', 0, 4, 0, 8), clip('clip2', 4, 8, 8, 16)]));
    expect(result).toEqual({ valid: true, findings: [] });
  });

  it('detects overlaps as errors and marks the video invalid', () => {
    const result = lintVideo(resolvedVideo([clip('clip1', 0, 5.0, 0, 10), clip('clip2', 4.5, 9.0, 9, 18)]));
    expect(result.valid).toBe(false);
    const overlap = result.findings.find((f) => f.rule === 'clip-overlap');
    expect(overlap?.severity).toBe('error');
    expect(overlap?.clipId).toBe('clip2');
    expect(overlap?.t).toBe(4.5);
  });

  it('detects gaps as warnings without marking the video invalid', () => {
    const result = lintVideo(resolvedVideo([clip('clip1', 0, 4.0, 0, 8), clip('clip2', 5.5, 9.0, 11, 18)]));
    expect(result.valid).toBe(true);
    const gap = result.findings.find((f) => f.rule === 'clip-gap');
    expect(gap?.severity).toBe('warning');
    expect(gap?.t).toBe(4.0);
  });

  it('ignores edge differences up to 1 ms', () => {
    const result = lintVideo(resolvedVideo([clip('clip1', 0, 4.0005, 0, 8), clip('clip2', 4.0, 8, 8, 16)]));
    expect(result.findings.filter((f) => f.rule !== 'cut-off-beat')).toEqual([]);
  });

  it('detects cuts off beat by more than tolerance', () => {
    // 120 bpm: 0.1 beat = 50 ms > 20 ms tolerance.
    const result = lintVideo(resolvedVideo([clip('clip1', 0.05, 4.0, 0.1, 8), clip('clip2', 4.0, 8.0, 8.0, 16.0)]));
    const offBeat = result.findings.filter((f) => f.rule === 'cut-off-beat');
    expect(offBeat.length).toBe(1);
    expect(offBeat[0]!.clipId).toBe('clip1');
    expect(result.valid).toBe(true);
  });

  it('accepts cuts within the 20 ms tolerance', () => {
    // 0.03 beat = 15 ms.
    const result = lintVideo(resolvedVideo([clip('clip1', 0.015, 4.0, 0.03, 8)]));
    expect(result.findings).toEqual([]);
  });

  it('does not lint the start of a clip at 0: the song start is not a cut', () => {
    // the first beat is 216 ms into the song, as in pdoom_original
    const result = lintVideo(resolvedVideo([clip('open', 0, 4.0, -0.43, 8)]));
    expect(result.findings).toEqual([]);
  });

  it('lints the output of resolveVideo', () => {
    const timing = syntheticTiming(120);
    const resolved = resolveVideo(
      {
        v: 2,
        title: 't',
        fps: 60,
        size: [1920, 1080],
        markers: {},
        clips: [
          { id: 'a', at: 0, to: 'word:sudden' },
          { id: 'b', at: 'word:sudden -0.5s' },
          { id: 'c', at: 'lyric:There was a sudden drop' },
        ],
      },
      timing,
    );
    const result = lintVideo(resolved);
    // a ends at 5.0, b starts at 4.5: overlap. c starts at 4.02: 20 ms off beat, inside tolerance.
    // Sorted by start: a 0-5.0, c 4.02-50, b 4.5-4.02.
    expect(result.valid).toBe(false);
    expect(result.findings.some((f) => f.rule === 'clip-overlap')).toBe(true);
    expect(result.findings.some((f) => f.rule === 'cut-off-beat')).toBe(false);
  });
});
