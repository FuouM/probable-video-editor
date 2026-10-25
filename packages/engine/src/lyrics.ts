// Word-timed lyrics (from user_input/lyrics.calibrated.json) with queries for karaoke rendering.
import { smart } from './type';

export interface Word {
  w: string; // display token (punctuation attached, typographic quotes: don’t, ’cause)
  start: number;
  end: number;
  conf?: number;
  syl?: [number, number][];
  /** The text of each syllable, parallel to `syl` (concatenated they spell the plain word). */
  sylText?: string[];
  /** filled in by Lyrics: */
  line: number;
  index: number; // index within line
  gi: number; // global word index
}
export interface Line {
  i: number;
  text: string;
  start: number;
  end: number;
  words: Word[];
}

/** One lyric line as input: `syl` only on words with two or more syllables. */
export interface LyricsInputLine {
  i: number;
  text: string;
  start: number;
  end: number;
  words: Omit<Word, 'line' | 'index' | 'gi'>[];
}

export class Lyrics {
  lines: Line[];
  words: Word[];
  constructor(j: { lines: LyricsInputLine[] }) {
    // display text gets curly apostrophes and quotes (the data keeps the typed ones); mono UI
    // text that wants them straight uses plain()
    this.lines = j.lines.map((l, li) => ({
      ...l,
      i: li,
      text: smart(l.text),
      words: l.words.map((w, wi) => ({ ...w, w: smart(w.w), line: li, index: wi, gi: 0 })),
    }));
    this.words = this.lines.flatMap((l) => l.words);
    this.words.forEach((w, i) => (w.gi = i));
  }

  /** The line being sung at t (or null in gaps). */
  lineAt(t: number): Line | null {
    return this.lines.find((l) => t >= l.start && t < l.end) ?? null;
  }
  /** Most recent line that started at or before t. */
  lastLine(t: number): Line | null {
    let best: Line | null = null;
    for (const l of this.lines) if (l.start <= t) best = l;
    return best;
  }
  nextLine(t: number): Line | null {
    return this.lines.find((l) => l.start > t) ?? null;
  }
  linesIn(t0: number, t1: number): Line[] {
    return this.lines.filter((l) => l.end > t0 && l.start < t1);
  }
  /**
   * The line to display on screen at time t with hold and exit fade:
   * returns the line and out fade factor (0 = fully visible, 1 = fully faded out),
   * or null if no line is currently up.
   */
  lineOnScreen(t: number, hold = 0.35, fade = 0.2, leadIn = 0.12): { line: Line; out: number } | null {
    let line = this.lastLine(t);
    if (!line) {
      const next = this.nextLine(t);
      if (next) {
        const firstStart = next.words.length > 0 ? next.words[0]!.start : next.start;
        if (t >= firstStart - leadIn) line = next;
      }
    }
    if (!line) return null;
    const firstStart = line.words.length > 0 ? line.words[0]!.start : line.start;
    if (t < firstStart - leadIn) return null;
    const next = this.nextLine(t);
    const until = Math.min(line.end + hold, next && next !== line ? next.start - 0.02 : Infinity);
    if (t > until + fade) return null;
    return { line, out: Math.max(0, Math.min(1, (t - until) / Math.max(1e-4, fade))) };
  }

  /**
   * The word being sung at time t in a line, or the most recent word sung in that line.
   */
  wordNow(line: Line, t: number): { w: Word; i: number } | null {
    let r: { w: Word; i: number } | null = null;
    line.words.forEach((w, i) => { if (w.start - 0.01 <= t) r = { w, i }; });
    return r;
  }

  /** Lines whose text includes `s` (case-insensitive, straight or curly quotes). Handy for finding a lyric by content. */
  find(s: string): Line[] {
    const q = fold(s);
    return this.lines.filter((l) => fold(l.text).includes(q));
  }
  /** First line containing `s`; throws if missing (fail loudly while authoring). */
  get(s: string, nth = 0): Line {
    const l = this.find(s)[nth];
    if (!l) throw new Error(`lyric not found: ${s}`);
    return l;
  }
  wordAt(t: number): Word | null {
    return this.words.find((w) => t >= w.start && t < w.end) ?? null;
  }
  lastWord(t: number): Word | null {
    let best: Word | null = null;
    for (const w of this.words) if (w.start <= t) best = w;
    return best;
  }
  /** Words whose normalized text matches (e.g. 'p(doom)'). */
  findWords(s: string): Word[] {
    const q = norm(s);
    return this.words.filter((w) => norm(w.w) === q);
  }

  /**
   * Sung progress of a word at time t: 0 before start, 1 after end, linear inside
   * (or piecewise across syllables when available). Use for karaoke wipes.
   */
  static wordProgress(w: Word, t: number): number {
    if (t <= w.start) return 0;
    if (t >= w.end) return 1;
    if (w.syl && w.syl.length > 1) {
      const n = w.syl.length;
      for (let i = 0; i < n; i++) {
        const [a, b] = w.syl[i]!;
        if (t < a) return i / n;
        if (t < b) return (i + (t - a) / Math.max(1e-3, b - a)) / n;
      }
      return 1;
    }
    return (t - w.start) / Math.max(1e-3, w.end - w.start);
  }

  /** Progress through a whole line in characters (0..text.length), for per-glyph wipes. */
  static lineCharProgress(l: Line, t: number): number {
    let chars = 0;
    for (const w of l.words) {
      const p = Lyrics.wordProgress(w, t);
      chars += p * w.w.length;
      if (p < 1) break;
      chars += 1; // the space
    }
    return Math.min(chars, l.text.length);
  }
}

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9()]/g, '');
const fold = (s: string) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

export interface Syl {
  text: string;
  start: number;
  end: number;
  word: Word;
  wi: number;
  si: number;
}

/** The syllables of a line in sung order (words without a split are one syllable). */
export function syllables(line: Line): Syl[] {
  const out: Syl[] = [];
  line.words.forEach((w, wi) => {
    const plain = w.w.replace(/[\u2018\u2019']/g, "'");
    if (w.syl && w.sylText && w.sylText.length === w.syl.length) {
      w.syl.forEach(([s, e], si) => out.push({ text: w.sylText![si]!, start: s, end: e, word: w, wi, si }));
    } else {
      out.push({ text: plain, start: w.start, end: w.end, word: w, wi, si: 0 });
    }
  });
  return out;
}

/** Index of the syllable sung at t (the last one started), -1 before the first. */
export function sylAt(syls: Syl[] | { syls: Syl[] }, t: number): number {
  const arr = Array.isArray(syls) ? syls : syls.syls;
  let k = -1;
  for (let i = 0; i < arr.length; i++) if (arr[i]!.start <= t) k = i;
  return k;
}
