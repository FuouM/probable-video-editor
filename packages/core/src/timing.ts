// Beat grid and lyric queries over one song.
// The input is a SongTiming object in memory. This module reads no files.

import type { SongLine, SongSection, SongSyllable, SongTiming, SongWord } from './song.ts';

export type TimingErrorCode = 'INVALID_TIMING' | 'UNRESOLVED_ANCHOR' | 'AMBIGUOUS_QUERY';

export class TimingError extends Error {
  readonly code: TimingErrorCode;
  constructor(code: TimingErrorCode, message: string) {
    super(message);
    this.name = 'TimingError';
    this.code = code;
  }
}

/** Case-fold and fold smart quotes to plain quotes. */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B`´]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F«»]/g, '"');
}

/** Folded text without punctuation and spaces. Words and syllables match on this key. */
function tokenKey(s: string): string {
  return foldText(s).replace(/[^\p{L}\p{N}()]/gu, '');
}

function pickMatch<T>(kind: string, query: string, matches: T[], nth: number | undefined, preview: (m: T) => string): T {
  if (matches.length === 0) {
    throw new TimingError('UNRESOLVED_ANCHOR', `${kind} not found: "${query}"`);
  }
  if (nth === undefined) {
    if (matches.length > 1) {
      const list = matches.slice(0, 5).map(preview).join(', ');
      throw new TimingError(
        'AMBIGUOUS_QUERY',
        `Ambiguous ${kind} query "${query}" matched ${matches.length} times: [${list}]. Add #N (0-based), for example #0`,
      );
    }
    return matches[0]!;
  }
  if (nth < 0 || nth >= matches.length) {
    throw new TimingError('UNRESOLVED_ANCHOR', `${kind} index #${nth} out of range for "${query}" (${matches.length} matches)`);
  }
  return matches[nth]!;
}

/** Continuous index on a sorted grid: 0 at grid[0], fractional between points, extrapolated outside. */
function indexAt(grid: number[], t: number): number {
  if (t <= grid[0]!) {
    return (t - grid[0]!) / (grid[1]! - grid[0]!);
  }
  const lastIdx = grid.length - 1;
  if (t >= grid[lastIdx]!) {
    return lastIdx + (t - grid[lastIdx]!) / (grid[lastIdx]! - grid[lastIdx - 1]!);
  }
  let lo = 0;
  let hi = lastIdx;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (grid[m]! <= t) lo = m;
    else hi = m;
  }
  return lo + (t - grid[lo]!) / (grid[hi]! - grid[lo]!);
}

/** Time of a fractional grid index. Outside the grid, the mean period extrapolates. */
function timeAt(grid: number[], i: number): number {
  const n = grid.length;
  const period = (grid[n - 1]! - grid[0]!) / (n - 1);
  if (i <= 0) return grid[0]! + i * period;
  if (i >= n - 1) return grid[n - 1]! + (i - (n - 1)) * period;
  const k = Math.floor(i);
  return grid[k]! + (grid[k + 1]! - grid[k]!) * (i - k);
}

function checkGrid(name: string, grid: number[]): void {
  if (grid.length < 2) {
    throw new TimingError('INVALID_TIMING', `${name} needs at least 2 values, got ${grid.length}`);
  }
  for (let i = 1; i < grid.length; i++) {
    if (!(grid[i]! > grid[i - 1]!)) {
      throw new TimingError('INVALID_TIMING', `${name} must increase strictly (index ${i})`);
    }
  }
}

export class TimingData {
  readonly duration: number;
  readonly bpm: number;
  readonly beatPeriod: number;
  readonly beats: number[];
  readonly downbeats: number[];
  readonly lines: SongLine[];
  readonly sections: SongSection[];
  /** All words in song order. */
  readonly words: SongWord[];
  /** All syllables in song order. */
  readonly syllables: SongSyllable[];

  constructor(song: SongTiming) {
    if (!(song.bpm > 0)) {
      throw new TimingError('INVALID_TIMING', `bpm must be positive, got ${song.bpm}`);
    }
    checkGrid('beats', song.beats);
    checkGrid('downbeats', song.downbeats);
    this.duration = song.duration;
    this.bpm = song.bpm;
    this.beatPeriod = song.beatPeriod;
    this.beats = song.beats;
    this.downbeats = song.downbeats;
    this.lines = song.lines;
    this.sections = song.sections;
    this.words = song.lines.flatMap((l) => l.words);
    this.syllables = this.words.flatMap((w) => w.syl);
  }

  /** Continuous beat index: 0 at the first beat, fractional between beats, extrapolated outside. */
  beatAt(t: number): number {
    return indexAt(this.beats, t);
  }

  /** Time of a fractional beat index. */
  timeOfBeat(i: number): number {
    return timeAt(this.beats, i);
  }

  /** Continuous bar index: 0 at the first downbeat. */
  barAt(t: number): number {
    return indexAt(this.downbeats, t);
  }

  /** Time of a fractional bar index (0 = first downbeat). */
  timeOfBar(i: number): number {
    return timeAt(this.downbeats, i);
  }

  /** Nearest beat time to t. */
  nearestBeat(t: number): number {
    return this.timeOfBeat(Math.round(this.beatAt(t)));
  }

  /** Nearest downbeat to t. */
  nearestDownbeat(t: number): number {
    return this.timeOfBar(Math.round(this.barAt(t)));
  }

  /** Last downbeat at or before t. Before the first downbeat, the bar grid extrapolates. */
  downbeatAtOrBefore(t: number): number {
    return this.timeOfBar(Math.floor(this.barAt(t) + 1e-9));
  }

  /** The n-th line (0-based) whose text contains the query. Without n, the match must be unique. */
  getLyric(query: string, nth?: number): SongLine {
    const q = foldText(query);
    const matches = this.lines.filter((l) => foldText(l.text).includes(q));
    return pickMatch('lyric', query, matches, nth, (m) => `"${m.text}"`);
  }

  /** The n-th word (0-based) whose text equals the query (case and punctuation ignored). */
  getWord(query: string, nth?: number): SongWord {
    const q = tokenKey(query);
    const matches = this.words.filter((w) => tokenKey(w.text) === q);
    return pickMatch('word', query, matches, nth, (m) => `"${m.text}"@${m.start}`);
  }

  /** The n-th syllable (0-based) whose text equals the query (case and punctuation ignored). */
  getSyllable(query: string, nth?: number): SongSyllable {
    const q = tokenKey(query);
    const matches = this.syllables.filter((s) => tokenKey(s.text) === q);
    return pickMatch('syllable', query, matches, nth, (m) => `"${m.text}"@${m.start}`);
  }

  findSection(name: string): SongSection | undefined {
    const target = foldText(name).trim();
    return this.sections.find((s) => foldText(s.name).trim() === target);
  }
}
