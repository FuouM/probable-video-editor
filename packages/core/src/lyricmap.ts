// The lyric map: the companion of lyrics.calibrated.json (docs/LYRICMAP.md).
// The calibrated file owns every time. The map holds no time. It says which Japanese glyph and which English
// phrase belongs to each calibrated syllable. A human or an agent writes it by hand, because the meaning
// of a line decides the split. This module reads no files: it checks the map against a SongTiming and
// joins the two. The loader (load.ts) reads the files.

import type { SongTiming } from './song.ts';

/** `[fromSyl, toSyl, text]` or `[fromSyl, toSyl, text, '~']`. `toSyl` is exclusive. `'~'` marks a loose split. */
export type LyricMapEn = [from: number, to: number, text: string] | [from: number, to: number, text: string, loose: '~'];

export interface LyricMapLine {
  /** Index of the line in the calibrated file. */
  i: number;
  /** Line number (1-based) of this line in both raw files. */
  r: number;
  /** The calibrated line text. Detects a stale map. */
  t: string;
  /** Count of calibrated syllables of the line, ghost syllables included. */
  n: number;
  /** One slot per syllable, separated by one space. `~`: same glyph as the slot before. `_`: ghost syllable. */
  jp: string;
  en: LyricMapEn[];
  /** Raw text that is not in the calibration (not main vocal). Removed from both raw lines before the compare. */
  ig?: string[];
}

export interface LyricMapDoc {
  v: 1;
  song: string;
  /** Names in user_input/. */
  calibrated: string;
  raw: { jp: string; en: string };
  note: string;
  /** Raw line numbers (1-based) that are not main vocal. Not in the calibration, so not in `lines`. */
  skip: number[];
  lines: LyricMapLine[];
}

/** The raw lyric files, one string per line. */
export interface RawLyrics {
  jp: string[];
  en: string[];
}

export interface LyricMapProblem {
  /** JSON path in the map, for example `lines[12].jp`. */
  at: string;
  message: string;
}

export class LyricMapError extends Error {
  override name = 'LyricMapError';
  constructor(readonly problems: LyricMapProblem[]) {
    super(problems.map((p) => `${p.at}: ${p.message}`).join('\n'));
  }
}

export const GHOST_SLOT = '_';
export const CONT_SLOT = '~';

/** A calibrated syllable that exists only to sync the timing, for example `(o)`. It is not in the lyrics. */
export const isGhostSyllable = (text: string): boolean => /^\(.*\)$/.test(text);

/** Curly quotes to plain quotes. The map uses plain quotes. The raw files may use curly ones. */
export function straighten(s: string): string {
  return s.replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E\u201F]/g, '"');
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Checks the shape of a parsed JSON value. Throws a LyricMapError that lists every problem. */
export function parseLyricMap(json: unknown): LyricMapDoc {
  const problems: LyricMapProblem[] = [];
  const bad = (at: string, message: string) => problems.push({ at, message });
  const o = json as Record<string, unknown> | null;
  if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new LyricMapError([{ at: '$', message: 'expected an object' }]);
  if (o.v !== 1) bad('v', 'must be 1');
  for (const k of ['song', 'calibrated', 'note'] as const) if (typeof o[k] !== 'string') bad(k, 'must be a string');
  const raw = o.raw as Record<string, unknown> | undefined;
  if (typeof raw !== 'object' || raw === null || typeof raw.jp !== 'string' || typeof raw.en !== 'string') bad('raw', 'must be {"jp": file, "en": file}');
  if (!Array.isArray(o.skip) || !o.skip.every(isInt)) bad('skip', 'must be an array of raw line numbers');
  if (!Array.isArray(o.lines)) {
    bad('lines', 'must be an array');
  } else {
    o.lines.forEach((l: unknown, n) => {
      const at = `lines[${n}]`;
      const r = l as Record<string, unknown>;
      if (typeof r !== 'object' || r === null) return bad(at, 'must be an object');
      for (const k of ['i', 'r', 'n'] as const) if (!isInt(r[k])) bad(`${at}.${k}`, 'must be an integer');
      for (const k of ['t', 'jp'] as const) if (typeof r[k] !== 'string') bad(`${at}.${k}`, 'must be a string');
      if (r.ig !== undefined && !(Array.isArray(r.ig) && r.ig.every((x) => typeof x === 'string'))) bad(`${at}.ig`, 'must be an array of strings');
      if (!Array.isArray(r.en)) return bad(`${at}.en`, 'must be an array');
      r.en.forEach((e: unknown, k) => {
        const ok = Array.isArray(e) && (e.length === 3 || (e.length === 4 && e[3] === '~')) && isInt(e[0]) && isInt(e[1]) && typeof e[2] === 'string';
        if (!ok) bad(`${at}.en[${k}]`, `must be [from, to, "text"] or [from, to, "text", "~"]`);
      });
    });
  }
  if (problems.length) throw new LyricMapError(problems);
  return o as unknown as LyricMapDoc;
}

/**
 * Every disagreement of the map with the calibrated lyrics. Without `raw`, only the calibrated file is
 * compared: line count and text, syllable count, ghost syllables, slot grammar, phrase spans. With `raw`,
 * the glyphs and the English phrases must also rebuild the raw lines, and every raw line must be mapped
 * or listed in `skip`.
 */
export function checkLyricMap(doc: LyricMapDoc, timing: SongTiming, raw?: RawLyrics): LyricMapProblem[] {
  const problems: LyricMapProblem[] = [];
  const bad = (at: string, message: string) => problems.push({ at, message });

  if (doc.lines.length !== timing.lines.length) bad('lines', `${doc.lines.length} lines in the map, ${timing.lines.length} in the calibrated lyrics`);
  doc.lines.forEach((l, pos) => {
    const at = `lines[${pos}]`;
    if (l.i !== pos) bad(`${at}.i`, `is ${l.i}, must be ${pos}`);
    const cal = timing.lines[l.i];
    if (!cal) return bad(`${at}.i`, `the calibrated lyrics have no line ${l.i}`);
    if (l.t !== cal.text) bad(`${at}.t`, `"${l.t}" is not the calibrated text "${cal.text}"`);
    const syl = cal.words.flatMap((w) => w.syl.map((s) => s.text));
    if (l.n !== syl.length) bad(`${at}.n`, `is ${l.n}, the calibrated line has ${syl.length} syllables`);
    const slots = l.jp.split(' ');
    if (slots.length !== syl.length) {
      bad(`${at}.jp`, `${slots.length} slots, the calibrated line has ${syl.length} syllables: ${syl.join('|')}`);
    } else {
      slots.forEach((s, k) => {
        if (s === '') return bad(`${at}.jp`, `empty slot ${k}: use one space between slots`);
        if ((s === GHOST_SLOT) !== isGhostSyllable(syl[k]!)) {
          bad(`${at}.jp[${k}]`, isGhostSyllable(syl[k]!) ? `syllable "${syl[k]}" is a ghost: its slot must be ${GHOST_SLOT}` : `slot ${GHOST_SLOT} on syllable "${syl[k]}", which is not a ghost`);
        }
        if (s === CONT_SLOT && (k === 0 || slots[k - 1] === GHOST_SLOT)) bad(`${at}.jp[${k}]`, `${CONT_SLOT} needs a glyph slot before it`);
      });
    }
    l.en.forEach(([from, to, text], k) => {
      if (!(from >= 0 && from < to && to <= syl.length)) bad(`${at}.en[${k}]`, `span ${from}..${to} is outside 0..${syl.length} syllables`);
      if (text.trim() === '') bad(`${at}.en[${k}]`, 'empty text');
    });
  });

  if (raw) checkRaw(doc, raw, bad);
  return problems;
}

function checkRaw(doc: LyricMapDoc, raw: RawLyrics, bad: (at: string, message: string) => void): void {
  const seen = new Set<number>();
  let prev = 0;
  doc.lines.forEach((l, pos) => {
    const at = `lines[${pos}]`;
    if (seen.has(l.r)) bad(`${at}.r`, `raw line ${l.r} is used twice`);
    if (l.r <= prev) bad(`${at}.r`, `raw line ${l.r} is not after raw line ${prev}`);
    seen.add(l.r);
    prev = l.r;
    let jp = raw.jp[l.r - 1], en = raw.en[l.r - 1];
    if (jp === undefined || en === undefined) return bad(`${at}.r`, `raw line ${l.r} does not exist in both raw files`);
    jp = straighten(jp);
    en = straighten(en);
    for (const g of l.ig ?? []) {
      const s = straighten(g);
      if (!jp.includes(s) && !en.includes(s)) bad(`${at}.ig`, `"${g}" is in neither raw line ${l.r}`);
      jp = jp.replace(s, '');
      en = en.replace(s, '');
    }
    const wantJp = jp.replace(/\s/g, ''), gotJp = straighten(l.jp.split(' ').filter((s) => s !== CONT_SLOT && s !== GHOST_SLOT).join('')).replace(/\s/g, '');
    if (gotJp !== wantJp) bad(`${at}.jp`, `glyphs "${gotJp}" do not rebuild raw jp line ${l.r} "${wantJp}"`);
    const wantEn = en.replace(/\s+/g, ' ').trim(), gotEn = l.en.map((e) => straighten(e[2])).join(' ').replace(/\s+/g, ' ').trim();
    if (gotEn !== wantEn) bad(`${at}.en`, `phrases "${gotEn}" do not rebuild raw en line ${l.r} "${wantEn}"`);
  });
  for (const n of doc.skip) {
    if (!(n >= 1 && n <= Math.max(raw.jp.length, raw.en.length))) bad('skip', `raw line ${n} does not exist`);
    if (seen.has(n)) bad('skip', `raw line ${n} is also mapped`);
  }
  for (const lang of ['jp', 'en'] as const) {
    raw[lang].forEach((text, k) => {
      if (text.trim() !== '' && !seen.has(k + 1) && !doc.skip.includes(k + 1)) bad(`raw.${lang}`, `line ${k + 1} "${text.trim()}" is neither mapped nor in skip`);
    });
  }
}

export interface MapSyllable {
  /** Index in the line. */
  k: number;
  /** Index in the whole song (TimingData.syllables). */
  g: number;
  /** The calibrated syllable text. */
  text: string;
  start: number;
  end: number;
  /** Sync-only syllable. It is not in the lyrics: never draw it. */
  ghost: boolean;
  /** Index in MapLine.jpUnits. -1 for a ghost. */
  unit: number;
  /** Indexes in MapLine.en of the phrases that cover this syllable. Empty when no phrase does. */
  en: number[];
}

/** One written Japanese glyph (kanji, kana run of one mora, latin word) and the syllables it is sung on. */
export interface JpUnit {
  /** The glyph with the punctuation that sticks to it, for example `「別` or `う！`. */
  glyph: string;
  /** First syllable and one past the last (index in the line). */
  from: number;
  to: number;
  start: number;
  end: number;
}

export interface EnPhrase {
  from: number;
  to: number;
  text: string;
  /** The split is a best guess: the translation does not follow the Japanese here. */
  loose: boolean;
  start: number;
  end: number;
}

export interface MapLine {
  i: number;
  /** Line number in the raw files. */
  r: number;
  /** Calibrated (romaji) text. */
  text: string;
  start: number;
  end: number;
  syl: MapSyllable[];
  jpUnits: JpUnit[];
  /** The Japanese line as written, without spaces and without ghosts. */
  jp: string;
  /** English phrases in English reading order, with their times. Gaps and overlaps are allowed. */
  en: EnPhrase[];
  /** The English line as written (the phrases joined). */
  enText: string;
}

/** The calibrated lyrics joined with the map. Build it with `new LyricMap(doc, timing)`. */
export class LyricMap {
  readonly lines: MapLine[];

  /** Throws a LyricMapError when the map does not fit `timing` (see checkLyricMap). */
  constructor(doc: LyricMapDoc, timing: SongTiming) {
    const problems = checkLyricMap(doc, timing);
    if (problems.length) throw new LyricMapError(problems);
    let g = 0;
    this.lines = doc.lines.map((l) => {
      const cal = timing.lines[l.i]!;
      const sy = cal.words.flatMap((w) => w.syl);
      const slots = l.jp.split(' ');
      const jpUnits: JpUnit[] = [];
      const syl: MapSyllable[] = sy.map((s, k) => {
        const slot = slots[k]!;
        const ghost = slot === GHOST_SLOT;
        if (!ghost && slot !== CONT_SLOT) jpUnits.push({ glyph: slot, from: k, to: k + 1, start: s.start, end: s.end });
        else if (slot === CONT_SLOT) {
          const u = jpUnits[jpUnits.length - 1]!;
          u.to = k + 1;
          u.end = s.end;
        }
        return { k, g: g++, text: s.text, start: s.start, end: s.end, ghost, unit: ghost ? -1 : jpUnits.length - 1, en: [] };
      });
      const en: EnPhrase[] = l.en.map(([from, to, text, loose], p) => {
        for (let k = from; k < to; k++) syl[k]!.en.push(p);
        return { from, to, text, loose: loose === '~', start: sy[from]!.start, end: sy[to - 1]!.end };
      });
      return { i: l.i, r: l.r, text: cal.text, start: cal.start, end: cal.end, syl, jpUnits, jp: jpUnits.map((u) => u.glyph).join(''), en, enText: en.map((e) => e.text).join(' ') };
    });
  }
}
