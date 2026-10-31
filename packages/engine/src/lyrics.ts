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
/** One written Japanese glyph (kanji, one kana mora, latin word, with the punctuation that sticks to it) and the syllables it is sung on. */
export interface WrittenUnit {
  glyph: string;
  /** First syllable and one past the last, as indexes into `syllables(line)`. */
  from: number;
  to: number;
  start: number;
  end: number;
}
/** One English phrase and the syllables it translates. `loose`: the split is a best guess. */
export interface WrittenPhrase {
  text: string;
  from: number;
  to: number;
  loose: boolean;
  start: number;
  end: number;
}
/** The line as written, from user_input/lyrics.map.json (docs/LYRICMAP.md). */
export interface LineWritten {
  /** The Japanese line without ghosts. */
  jp: string;
  units: WrittenUnit[];
  /** The English line, and its phrases in English reading order. */
  en: string;
  phrases: WrittenPhrase[];
  /** Indexes of the ghost syllables: sync only, never draw them. */
  ghosts: number[];
}
export interface Line {
  i: number;
  text: string;
  start: number;
  end: number;
  words: Word[];
  /** Only when the song has a lyric map. */
  written?: LineWritten;
}

/** One lyric line as input: `syl` only on words with two or more syllables. */
export interface LyricsInputLine {
  i: number;
  text: string;
  start: number;
  end: number;
  words: Omit<Word, 'line' | 'index' | 'gi'>[];
  written?: LineWritten;
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

/** The units (glyphs) of a line with their times. Throws when the song has no lyric map. */
export function units(line: Line): WrittenUnit[] {
  if (!line.written) throw new Error(`line ${line.i} has no written form: the song needs user_input/lyrics.map.json`);
  return line.written.units;
}

/** Index of the last unit whose onset is at or before t, -1 before the first. */
export function unitAt(us: WrittenUnit[], t: number): number {
  let k = -1;
  for (let i = 0; i < us.length; i++) if (us[i]!.start <= t) k = i;
  return k;
}

/** The line by index in the calibrated lyrics. */
export function lineNo(lyrics: Lyrics, i: number): Line {
  const l = lyrics.lines[i];
  if (!l) throw new Error(`no lyric line ${i}`);
  return l;
}

// ---------- Japanese kana / phonetics ----------
const VOWELS = 'aiueo';

/**
 * Standard Gojuon (五十音) grid: 5 vowel columns across consonant rows.
 * Underscores mark historical morae merged in modern orthography (yi/ye, wi/wu/we).
 * Generates both Kunrei-shiki (si, ti, tu, hu) and base Hepburn syllables.
 */
const KANA_ROWS: Record<string, string> = {
  '': 'あいうえお', k: 'かきくけこ', s: 'さしすせそ', t: 'たちつてと', n: 'なにぬねの', h: 'はひふへほ',
  m: 'まみむめも', y: 'や_ゆ_よ', r: 'らりるれろ', w: 'わ___を', g: 'がぎぐげご', z: 'ざじずぜぞ',
  d: 'だぢづでど', b: 'ばびぶべぼ', p: 'ぱぴぷぺぽ',
};

const ROMA_MAP = new Map<string, string>();
// 1. Populate basic Gojuon grid
for (const [prefix, row] of Object.entries(KANA_ROWS)) {
  [...row].forEach((k, i) => { if (k !== '_') ROMA_MAP.set(prefix + VOWELS[i]!, k); });
}
// 2. Hepburn phonetic overrides
for (const [r, k] of [['shi', 'し'], ['chi', 'ち'], ['tsu', 'つ'], ['fu', 'ふ'], ['ji', 'じ']]) ROMA_MAP.set(r!, k!);
// 3. Contracted sounds (Yoon digraphs with small ya/yu/yo)
for (const [prefix, i] of [['k', 'き'], ['g', 'ぎ'], ['n', 'に'], ['h', 'ひ'], ['m', 'み'], ['r', 'り'], ['b', 'び'], ['p', 'ぴ']]) {
  ROMA_MAP.set(`${prefix}ya`, `${i}ゃ`);
  ROMA_MAP.set(`${prefix}yu`, `${i}ゅ`);
  ROMA_MAP.set(`${prefix}yo`, `${i}ょ`);
}
for (const [prefix, i] of [['sh', 'し'], ['ch', 'ち'], ['j', 'じ']]) {
  ROMA_MAP.set(`${prefix}a`, `${i}ゃ`);
  ROMA_MAP.set(`${prefix}u`, `${i}ゅ`);
  ROMA_MAP.set(`${prefix}o`, `${i}ょ`);
}
// 4. Modern loanword syllables
ROMA_MAP.set('fa', 'ふぁ'); ROMA_MAP.set('fi', 'ふぃ'); ROMA_MAP.set('fe', 'ふぇ'); ROMA_MAP.set('fo', 'ふぉ');

/**
 * Convert Hepburn romaji syllables to Hiragana.
 * Supports standard Japanese phonology and Lyric-Sync calibration conventions:
 * - Standard doubled consonants (e.g. "tte", "ppo") -> sokuon (っ)
 * - Lone/trailing plosives from Lyric-Sync vocal stem slices (e.g. "p" in "p-po-i", "k" in "shik-kei") -> sokuon (っ)
 * - Syllabic n before consonants or word boundaries -> hatson (ん)
 * - Yoon digraphs ("kya", "sha", "cha", "ja") and foreign loanword syllables ("fa")
 */
export function romajiToKana(romaji: string): string {
  const s = romaji.toLowerCase().replace(/[^a-z]/g, '');
  let out = '';
  for (let i = 0; i < s.length;) {
    const ch = s[i]!;
    if (ch === 'n' && (i + 1 >= s.length || (!VOWELS.includes(s[i + 1]!) && s[i + 1] !== 'y'))) {
      out += 'ん';
      i++;
      continue;
    }
    if (!VOWELS.includes(ch)) {
      if (ch === s[i + 1]) {
        out += 'っ';
        i++;
        continue;
      }
      const rest = s.slice(i);
      if (!/[aiueo]/.test(rest)) {
        out += 'っ'.repeat(rest.length);
        break;
      }
    }
    let hit = 0;
    for (const len of [3, 2, 1]) {
      const sub = s.slice(i, i + len);
      if (ROMA_MAP.has(sub)) {
        out += ROMA_MAP.get(sub)!;
        hit = len;
        break;
      }
    }
    if (hit > 0) {
      i += hit;
    } else {
      if (/[a-z]/.test(ch) && !VOWELS.includes(ch)) {
        out += 'っ';
        i++;
      } else {
        i++;
      }
    }
  }
  return out;
}

/** Katakana to hiragana. */
export const kataToHira = (s: string) => s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** Hiragana to katakana. */
export const hiraToKata = (s: string) => s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

const KANJI_RE = /[\u4e00-\u9fff]/;

/**
 * The ruby (furigana reading in hiragana) of a unit from its sung syllables.
 * Returns null if the unit contains no kanji or has no syllables.
 */
export function rubyOf(u: WrittenUnit, syls: Syl[]): string | null {
  if (!KANJI_RE.test(u.glyph)) return null;
  const romaji = syls.slice(u.from, u.to).map((s) => s.text).join('');
  return romaji ? romajiToKana(romaji) : null;
}
