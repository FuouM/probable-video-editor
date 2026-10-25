import { describe, expect, it } from 'bun:test';
import { resolveAnchor, resolveVideo, ResolveError, type ResolveContext } from '../src/resolve.ts';
import { TimingData, TimingError } from '../src/timing.ts';
import type { VideoJson } from '../src/types.ts';
import { syntheticSong, syntheticTiming } from './fixtures/song.ts';

function ctxFor(timing: TimingData, fps = 60): ResolveContext {
  return { timing, fps };
}

/** Runs fn and returns the ResolveError it throws. Fails the test when fn does not throw one. */
function resolveErrorOf(fn: () => unknown): ResolveError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ResolveError);
    return e as ResolveError;
  }
  throw new Error('expected a ResolveError, but nothing was thrown');
}

function video(clips: VideoJson['clips'], markers: VideoJson['markers'] = {}): VideoJson {
  return { v: 2, title: 't', fps: 60, size: [1920, 1080], markers, clips };
}

describe('TimingData', () => {
  it('rejects a beat grid with fewer than 2 beats or a non-increasing grid', () => {
    const song = syntheticSong();
    expect(() => new TimingData({ ...song, beats: [0] })).toThrow(TimingError);
    expect(() => new TimingData({ ...song, downbeats: [0, 0] })).toThrow(TimingError);
    expect(() => new TimingData({ ...song, bpm: 0 })).toThrow(TimingError);
  });
});

describe('Grammar target variants and snapping', () => {
  it('resolves NumberLiteral and end', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveAnchor('14.5', ctx)).toBe(14.5);
    expect(resolveAnchor(10, ctx)).toBe(10);
    expect(resolveAnchor('end', ctx)).toBe(50.0);
  });

  it('rejects the removed timing:duration form', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveErrorOf(() => resolveAnchor('timing:duration', ctx)).code).toBe('SYNTAX_ERROR');
  });

  it('resolves GridRef bar and beat', () => {
    const ctx = ctxFor(syntheticTiming(120));
    // 120 bpm: beat period 0.5 s. beat:4 -> 2.0 s. bar:2 -> second downbeat = beat 4 -> 2.0 s.
    expect(resolveAnchor('beat:4', ctx)).toBeCloseTo(2.0, 4);
    expect(resolveAnchor('bar:2', ctx)).toBeCloseTo(2.0, 4);
    expect(resolveAnchor('bar:3', ctx)).toBeCloseTo(4.0, 4);
  });

  it('beat:N is 0-based: beat:0 is the first beat', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveAnchor('beat:0', ctx)).toBeCloseTo(0.0, 6);
    expect(resolveAnchor('beat:1', ctx)).toBeCloseTo(0.5, 6);
    expect(resolveAnchor('beat:2.5', ctx)).toBeCloseTo(1.25, 6);
  });

  it('bar:N is 1-based on the downbeat list: bar:1 is the first downbeat', () => {
    // Pickup: the first downbeat is beat 1 (0.5 s), not beat 0.
    const ctx = ctxFor(syntheticTiming(120, 1));
    expect(resolveAnchor('bar:1', ctx)).toBeCloseTo(0.5, 6);
    expect(resolveAnchor('bar:2', ctx)).toBeCloseTo(2.5, 6);
    // Before the first downbeat, the bar grid extrapolates.
    expect(resolveAnchor('bar:0', ctx)).toBeCloseTo(-1.5, 6);
  });

  it('resolves section references', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveAnchor('section:verse', ctx)).toBe(4.0);
    expect(resolveAnchor('section:outro', ctx)).toBe(12.0);
  });

  it('resolves lyric and word queries with folding', () => {
    const ctx = ctxFor(syntheticTiming(120));
    // The line starts at its first word: 4.02.
    expect(resolveAnchor('lyric:There was a sudden drop', ctx)).toBe(4.02);
    expect(resolveAnchor('lyric:THERE WAS', ctx)).toBe(4.02);
    expect(resolveAnchor('word:sudden', ctx)).toBe(5.0);
    expect(resolveAnchor('word:Sudden!', ctx)).toBe(5.0);
  });

  it('resolves snapping directives: beat<=, downbeat~, beat~, downbeat<=', () => {
    const ctx = ctxFor(syntheticTiming(120));
    // raw 4.02, tol 0.02 -> 4.04 -> beat 8.08 -> floor 8 -> 4.0
    expect(resolveAnchor('lyric:There was a sudden drop @beat<=', ctx)).toBeCloseTo(4.0, 4);
    expect(resolveAnchor('lyric:There was a sudden drop @downbeat~', ctx)).toBeCloseTo(4.0, 4);
    expect(resolveAnchor('lyric:There was a sudden drop @beat~', ctx)).toBeCloseTo(4.0, 4);
    // raw 5.0 -> last downbeat at or before 5.02 is 4.0
    expect(resolveAnchor('word:sudden @downbeat<=', ctx)).toBeCloseTo(4.0, 4);
  });

  it('resolves custom :tol for pickup words', () => {
    const ctx = ctxFor(syntheticTiming(120));
    // Post-Chinchilla starts at 1.95. tol 0.05: 1.95 + 0.05 = 2.0 -> beat 4 -> 2.0.
    expect(resolveAnchor('lyric:Post-Chinchilla:tol=0.05 @beat<=', ctx)).toBeCloseTo(2.0, 4);
    // Default tol 0.02: 1.97 -> beat 3.94 -> floor 3 -> 1.5.
    expect(resolveAnchor('lyric:Post-Chinchilla @beat<=', ctx)).toBeCloseTo(1.5, 4);
  });

  it('resolves offsets with f, b, bar, and s units', () => {
    const ctx = ctxFor(syntheticTiming(120), 60);
    expect(resolveAnchor('beat:4 +2b', ctx)).toBeCloseTo(3.0, 4);
    expect(resolveAnchor('beat:4 -1bar', ctx)).toBeCloseTo(0.0, 4);
    expect(resolveAnchor('beat:4 +30f', ctx)).toBeCloseTo(2.5, 4);
    expect(resolveAnchor('beat:4 -0.5s', ctx)).toBeCloseTo(1.5, 4);
    expect(resolveAnchor('beat:4 +1b -6f', ctx)).toBeCloseTo(2.4, 4);
    // A number without a unit is seconds.
    expect(resolveAnchor('beat:4 +1', ctx)).toBeCloseTo(3.0, 4);
  });

  it('resolves fallbacks with ||', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveAnchor('section:nonexistent || section:verse', ctx)).toBe(4.0);
    expect(resolveAnchor('section:missing1 || section:missing2 || end', ctx)).toBe(50.0);
  });
});

describe('syl: targets', () => {
  it('resolves a unique syllable start', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveAnchor('syl:den', ctx)).toBe(5.25);
    expect(resolveAnchor('syl:Chin', ctx)).toBe(2.2);
    // Case and punctuation do not matter.
    expect(resolveAnchor('syl:CHIL', ctx)).toBe(2.4);
  });

  it('needs #n for a repeated syllable and counts #n from 0', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveErrorOf(() => resolveAnchor('syl:pli', ctx)).code).toBe('AMBIGUOUS_QUERY');
    expect(resolveAnchor('syl:pli#0', ctx)).toBe(8.15);
    expect(resolveAnchor('syl:pli#1', ctx)).toBe(10.15);
    expect(resolveErrorOf(() => resolveAnchor('syl:pli#2', ctx)).code).toBe('UNRESOLVED_ANCHOR');
  });

  it('matches whole syllables only', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveErrorOf(() => resolveAnchor('syl:de', ctx)).code).toBe('UNRESOLVED_ANCHOR');
  });

  it('falls back with || when the syllable is missing', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveAnchor('syl:zzz || syl:den', ctx)).toBe(5.25);
    expect(resolveAnchor('syl:zzz || syl:pli#1', ctx)).toBe(10.15);
  });

  it('does not hide an ambiguous syllable behind ||', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveErrorOf(() => resolveAnchor('syl:pli || 3', ctx)).code).toBe('AMBIGUOUS_QUERY');
  });

  it('snaps and offsets a syllable', () => {
    const ctx = ctxFor(syntheticTiming(120));
    // 5.25 -> beat 10.5 -> round 11 -> 5.5
    expect(resolveAnchor('syl:den @beat~', ctx)).toBeCloseTo(5.5, 6);
    expect(resolveAnchor('syl:den +1b', ctx)).toBeCloseTo(5.75, 6);
  });

  it('rejects an empty syllable text', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveErrorOf(() => resolveAnchor('syl:', ctx)).code).toBe('SYNTAX_ERROR');
    expect(resolveErrorOf(() => resolveAnchor('syl:#1', ctx)).code).toBe('SYNTAX_ERROR');
  });
});

describe('.end suffix', () => {
  it('gives the end of a lyric line (its last word)', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveAnchor('lyric:There was a sudden drop.end', ctx)).toBe(6.0);
    expect(resolveAnchor('lyric:Duplicate line#0.end', ctx)).toBe(9.0);
    expect(resolveAnchor('lyric:Duplicate line#1.end', ctx)).toBe(11.0);
  });

  it('gives the end of a word, a syllable and a section', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveAnchor('word:sudden.end', ctx)).toBe(5.5);
    expect(resolveAnchor('word:Duplicate#1.end', ctx)).toBe(10.5);
    expect(resolveAnchor('syl:sud.end', ctx)).toBe(5.25);
    expect(resolveAnchor('syl:pli#1.end', ctx)).toBe(10.3);
    expect(resolveAnchor('section:verse.end', ctx)).toBe(12.0);
  });

  it('keeps ambiguity errors for .end without #n', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveErrorOf(() => resolveAnchor('lyric:Duplicate line.end', ctx)).code).toBe('AMBIGUOUS_QUERY');
    expect(resolveErrorOf(() => resolveAnchor('syl:cate.end', ctx)).code).toBe('AMBIGUOUS_QUERY');
  });

  it('works with || fallback', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveAnchor('section:missing.end || section:outro.end', ctx)).toBe(20.0);
    expect(resolveAnchor('word:missing.end || syl:la.end', ctx)).toBe(2.8);
    expect(resolveAnchor('lyric:nothing like this.end || lyric:Duplicate line#0.end', ctx)).toBe(9.0);
  });

  it('works with snapping and offsets', () => {
    const ctx = ctxFor(syntheticTiming(120));
    // word:was ends 4.8 -> 4.82 -> beat 9.64 -> floor 9 -> 4.5
    expect(resolveAnchor('word:was.end @beat<=', ctx)).toBeCloseTo(4.5, 6);
    // line ends 6.0 -> nearest downbeat 6.0
    expect(resolveAnchor('lyric:There was a sudden drop.end @downbeat~', ctx)).toBeCloseTo(6.0, 6);
    // Post-Chinchilla ends 2.8 -> last downbeat at or before 2.82 -> 2.0
    expect(resolveAnchor('lyric:Post-Chinchilla.end @downbeat<=', ctx)).toBeCloseTo(2.0, 6);
    // syl pli#1 ends 10.3 -> beat 20.6 -> round 21 -> 10.5
    expect(resolveAnchor('syl:pli#1.end @beat~', ctx)).toBeCloseTo(10.5, 6);
    expect(resolveAnchor('word:sudden.end +1b', ctx)).toBeCloseTo(6.0, 6);
    expect(resolveAnchor('section:intro.end @beat~ -2f', ctx)).toBeCloseTo(4.0 - 2 / 60, 6);
  });

  it('accepts :tol before .end and uses it for the snap', () => {
    const ctx = ctxFor(syntheticTiming(120));
    // Post-Chinchilla ends 2.8. tol 0.2: 3.0 -> beat 6 -> 3.0, 0.2 s after the end: allowed.
    expect(resolveAnchor('lyric:Post-Chinchilla:tol=0.2.end @beat<=', ctx)).toBeCloseTo(3.0, 6);
    // Default tol: 2.82 -> beat 5 -> 2.5.
    expect(resolveAnchor('lyric:Post-Chinchilla.end @beat<=', ctx)).toBeCloseTo(2.5, 6);
  });
});

describe('Structured error contract', () => {
  it('throws SYNTAX_ERROR on empty or invalid syntax', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveErrorOf(() => resolveAnchor('', ctx)).code).toBe('SYNTAX_ERROR');
    expect(resolveErrorOf(() => resolveAnchor('lyric:Hello @unknownDirective', ctx)).code).toBe('SYNTAX_ERROR');
    expect(resolveErrorOf(() => resolveAnchor('clip:foo', ctx)).code).toBe('SYNTAX_ERROR');
    expect(resolveErrorOf(() => resolveAnchor('bar:x', ctx)).code).toBe('SYNTAX_ERROR');
    expect(resolveErrorOf(() => resolveAnchor('nonsense', ctx)).code).toBe('SYNTAX_ERROR');
  });

  it('throws AMBIGUOUS_QUERY on ambiguous matches without #N', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveErrorOf(() => resolveAnchor('lyric:Duplicate line', ctx)).code).toBe('AMBIGUOUS_QUERY');
    expect(resolveAnchor('lyric:Duplicate line#0', ctx)).toBe(8.0);
    expect(resolveAnchor('lyric:Duplicate line#1', ctx)).toBe(10.0);
  });

  it('throws UNRESOLVED_ANCHOR on missing anchors without fallback', () => {
    const ctx = ctxFor(syntheticTiming(120));
    expect(resolveErrorOf(() => resolveAnchor('section:nonexistent', ctx)).code).toBe('UNRESOLVED_ANCHOR');
    expect(resolveErrorOf(() => resolveAnchor('@missingMarker', ctx)).code).toBe('UNRESOLVED_ANCHOR');
  });
});

describe('Dynamic tempo scaling', () => {
  it('scales cut points proportionally across variable BPM (110 -> 160)', () => {
    for (const bpm of [110, 125, 140, 160]) {
      const ctx = ctxFor(syntheticTiming(bpm));
      const beatPeriod = 60 / bpm;
      expect(resolveAnchor('beat:8', ctx)).toBeCloseTo(8 * beatPeriod, 4);
      expect(resolveAnchor('beat:2 +3b', ctx)).toBeCloseTo(5 * beatPeriod, 4);
      // bar:2 = beat 4, + half a bar = beat 6
      expect(resolveAnchor('bar:2 +0.5bar', ctx)).toBeCloseTo(6 * beatPeriod, 4);
    }
  });
});

describe('resolveVideo', () => {
  it('resolves clips and markers', () => {
    const timing = syntheticTiming(120);
    const resolved = resolveVideo(
      video(
        [
          { id: 'c1', at: '@m1', to: '@m2' },
          { id: 'c2', at: 'clip:c1.end', to: 'clip:c1.end +2b' },
        ],
        { m1: { at: 'beat:4' }, m2: { at: '@m1 +2b' } },
      ),
      timing,
    );
    expect(resolved.markers).toEqual({ m1: 2.0, m2: 3.0 });
    expect(resolved.clips.length).toBe(2);
    expect(resolved.clips[0]!.start).toBeCloseTo(2.0, 4);
    expect(resolved.clips[0]!.end).toBeCloseTo(3.0, 4);
    expect(resolved.clips[0]!.dur).toBeCloseTo(1.0, 4);
    expect(resolved.clips[0]!.startBeat).toBeCloseTo(4, 6);
    expect(resolved.clips[1]!.start).toBeCloseTo(3.0, 4);
    expect(resolved.clips[1]!.end).toBeCloseTo(4.0, 4);
  });

  it('ends a clip at the next clip start and the last clip at end', () => {
    const timing = syntheticTiming(120);
    const resolved = resolveVideo(
      video([
        { id: 'a', at: 0 },
        { id: 'b', at: 'lyric:There was a sudden drop @beat<=', scene: 'loss', brief: 'drop', xfade: 0.25 },
        { id: 'c', at: 'section:outro', samples: { max: 8 }, params: { variant: 'x' } },
      ]),
      timing,
    );
    expect(resolved.clips.map((c) => [c.id, c.start, c.end])).toEqual([
      ['a', 0, 4.0],
      ['b', 4.0, 12.0],
      ['c', 12.0, 50.0],
    ]);
    expect(resolved.clips[1]).toMatchObject({ scene: 'loss', brief: 'drop', xfade: 0.25 });
    expect(resolved.clips[2]).toMatchObject({ samples: { max: 8 }, params: { variant: 'x' } });
    expect(resolved.duration).toBe(50);
    expect(resolved.bpm).toBe(120);
  });

  it('resolves forward references between markers and clips', () => {
    const timing = syntheticTiming(120);
    const resolved = resolveVideo(
      video(
        [
          { id: 'a', at: 0, to: 'clip:b.start' },
          { id: 'b', at: '@late' },
          { id: 'c', at: 'clip:b.start +1bar', to: 'end' },
        ],
        { late: { at: 'bar:3' }, cEnd: { at: 'clip:c.end -1s' } },
      ),
      timing,
    );
    expect(resolved.clips[0]!.end).toBe(4.0);
    // b has no `to`: it ends at the start of c.
    expect(resolved.clips[1]!.end).toBe(6.0);
    expect(resolved.markers.cEnd).toBe(49);
  });

  it('reports a cycle with the JSON path of the expression', () => {
    const timing = syntheticTiming(120);
    const err = resolveErrorOf(() =>
      resolveVideo(video([{ id: 'a', at: '@x' }], { x: { at: '@y' }, y: { at: '@x || 3' } }), timing),
    );
    expect(err.code).toBe('CIRCULAR_REFERENCE');
    expect(err.path).toBe('markers.x.at');
  });

  it('reports an unresolved expression with its JSON path', () => {
    const timing = syntheticTiming(120);
    const err = resolveErrorOf(() =>
      resolveVideo(video([{ id: 'a', at: 0 }, { id: 'b', at: 'section:bridge' }]), timing),
    );
    expect(err.code).toBe('UNRESOLVED_ANCHOR');
    expect(err.path).toBe('clips[1].at');
    expect(err.message).toContain('clips[1].at');
  });

  it('reports a reference to a missing clip', () => {
    const timing = syntheticTiming(120);
    const err = resolveErrorOf(() => resolveVideo(video([{ id: 'a', at: 'clip:nope.end' }]), timing));
    expect(err.code).toBe('UNRESOLVED_ANCHOR');
    expect(err.path).toBe('clips[0].at');
  });

  it('uses the video fps for frame offsets', () => {
    const timing = syntheticTiming(120);
    const v = { ...video([{ id: 'a', at: 'beat:4 +3f' }]), fps: 30 };
    expect(resolveVideo(v, timing).clips[0]!.start).toBeCloseTo(2.1, 6);
  });

  it('places a transition around its anchor and clamps it to the song', () => {
    const timing = syntheticTiming(120);
    const v: VideoJson = {
      ...video([{ id: 'a', at: 0 }, { id: 'b', at: 'bar:3' }]),
      transitions: [
        { id: 'shards', scene: 'over', at: 'clip:b.start', pre: 0.5, post: 1.25, params: { n: 3 } },
        { id: 'head', scene: 'over', at: 0.2, pre: 1, post: 0.5 },
        { id: 'tail', scene: 'over', at: 'end', post: 2 },
      ],
    };
    const r = resolveVideo(v, timing);
    expect(r.transitions.map((t) => [t.id, t.at, t.start, t.end])).toEqual([
      ['shards', 4.0, 3.5, 5.25],
      ['head', 0.2, 0, 0.7],
      ['tail', 50, 50, 50],
    ]);
    expect(r.transitions[0]!.params).toEqual({ n: 3 });
    expect(resolveVideo(video([{ id: 'a', at: 0 }]), timing).transitions).toEqual([]);
  });

  it('reports an unresolved transition anchor with its JSON path', () => {
    const timing = syntheticTiming(120);
    const v: VideoJson = { ...video([{ id: 'a', at: 0 }]), transitions: [{ id: 'x', scene: 'over', at: 'clip:nope.start', post: 1 }] };
    const err = resolveErrorOf(() => resolveVideo(v, timing));
    expect(err.code).toBe('UNRESOLVED_ANCHOR');
    expect(err.path).toBe('transitions[0].at');
  });
});
