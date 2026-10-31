// The subtitles of a project, made from the inputs the page already has (inputs.ts): the calibrated words, and for a
// song with a lyric map (user_input/lyrics.map.json) its Japanese units and English phrases too. Nothing is
// translated or aligned here: every token has the time of the unit it comes from.
//   - no lyric map: the words are the lyrics, one English track.
//   - lyric map: romaji (the calibrated words), Japanese (the units of the map), English (the phrases of the map).
import type { LyricsInputLine } from '@pve/engine/lyrics';
import type { SubLine, SubToken, SubTrack, Subtitles } from '../src/subtitles';

const t3 = (x: number) => Math.round(x * 1000) / 1000;
const tok = (text: string, start: number, end: number): SubToken => [text, t3(start), t3(end)];
/** The lyrics type typed apostrophes; the screen shows curly ones (engine/type.ts smart, which this script cannot import). */
const curly = (s: string) => s.replace(/(\w)'(?=\w)/g, '$1\u2019');

function track(id: SubTrack['id'], label: string, joiner: SubTrack['joiner'], lines: LyricsInputLine[], tokens: (l: LyricsInputLine) => SubToken[]): SubTrack {
  const out: SubLine[] = [];
  for (const l of lines) {
    const ts = tokens(l);
    // English phrases come in reading order, which is not the order of the song: the line spans all of them
    if (ts.length) out.push({ start: Math.min(...ts.map((x) => x[1])), end: Math.max(...ts.map((x) => x[2])), tokens: ts });
  }
  return { id, label, joiner, lines: out.sort((a, b) => a.start - b.start) };
}

export function buildSubtitles(lines: LyricsInputLine[]): Subtitles {
  // a ghost word, such as "(o)", is a sync-only syllable: it is never drawn
  const words = (l: LyricsInputLine) => l.words.filter((w) => !/^\(.*\)$/.test(w.w)).map((w) => tok(curly(w.w), w.start, w.end));
  if (!lines.some((l) => l.written)) return { tracks: [track('en', 'English', ' ', lines, words)] };
  const written = lines.filter((l) => l.written);
  return {
    tracks: [
      track('en', 'English', ' ', written, (l) => l.written!.phrases.map((p) => tok(curly(p.text), p.start, p.end))),
      track('romaji', 'Romaji', ' ', lines, words),
      track('ja', '\u65e5\u672c\u8a9e', '', written, (l) => l.written!.units.map((u) => tok(u.glyph, u.start, u.end))),
    ],
  };
}
