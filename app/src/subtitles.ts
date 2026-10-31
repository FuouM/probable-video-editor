// The subtitles of a song as the player reads them (data/<id>/subtitles.json, written by scripts/subtitles.ts).
// A track is one language: lines of timed tokens. The token that is sung now is highlighted. No engine imports here.

/** One word, phrase or glyph group: its text and the song time (s) at which it is sung, from and to. */
export type SubToken = [text: string, start: number, end: number];

export interface SubLine {
  start: number;
  end: number;
  tokens: SubToken[];
}

export interface SubTrack {
  id: 'en' | 'romaji' | 'ja';
  label: string;
  /** Text between two tokens: a space for words, nothing for Japanese. */
  joiner: ' ' | '';
  lines: SubLine[];
}

export interface Subtitles {
  tracks: SubTrack[];
}

/** A line shows this long before its first token is sung, and this long after its last. */
export const LEAD = 0.25;
export const TAIL = 0.7;

/** The line of `track` that shows at song time `t`: the last that has begun, unless it ended long ago. Null: none. */
export function lineAt(track: SubTrack, t: number): SubLine | null {
  let lo = 0, hi = track.lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track.lines[mid]!.start - LEAD <= t) lo = mid + 1;
    else hi = mid;
  }
  const l = track.lines[lo - 1];
  return l && t < l.end + TAIL ? l : null;
}
