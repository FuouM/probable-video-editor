// pve subs: the subtitle tracks of a project (projects/<id>/site/subtitles.json, made by app/scripts/subtitles.ts)
// as files for YouTube, with the highlight of the player: the token that is sung now is yellow, the tokens
// before it are white and the tokens after it are grey. A subtitle file has no running highlight, so every change
// of state is its own cue: the whole line again, with another token lit.
// A song with a lyric map gets a Japanese file of two rows, the romaji on top of the Japanese, and an English file.
import { buildCues, renderCues, type Cue, type CueLine, type SubFormat } from 'lyricsync/formats';
import { LEAD, TAIL, type SubTrack, type Subtitles } from '../../../app/src/subtitles';

export type Format = SubFormat;

/** The lines of one row. `track` is the id of the track the line is from. */
interface Row extends CueLine {
  track: string;
}

/** The rows of a language: English is the English track, Japanese is the romaji row and the Japanese row. */
const ROWS: Record<string, string[]> = { en: ['en'], ja: ['romaji', 'ja'] };

/** The languages that `subs` has tracks for: `en`, and `ja` when the song has a lyric map. */
export function languages(subs: Subtitles): string[] {
  const ids = new Set<string>(subs.tracks.map((t) => t.id));
  return Object.entries(ROWS).filter(([, rows]) => rows.every((r) => ids.has(r))).map(([lang]) => lang);
}

/** The lines of every row of `lang`, grouped by the time at which they start (the romaji and the Japanese of one line). */
function groups(subs: Subtitles, lang: string): Row[][] {
  const wanted = ROWS[lang];
  if (!wanted) throw new Error(`no such language '${lang}' (languages: ${Object.keys(ROWS).join(', ')})`);
  const tracks = wanted.map((id) => subs.tracks.find((t) => t.id === id));
  if (tracks.some((t) => !t)) throw new Error(`the project has no ${wanted.join(' and ')} track for '${lang}' (languages: ${languages(subs).join(', ') || 'none'})`);
  const out: Array<{ start: number; rows: Row[] }> = [];
  for (const t of tracks as SubTrack[]) {
    for (const line of t.lines) {
      const g = out.find((x) => Math.abs(x.start - line.start) < 0.002);
      const row: Row = { track: t.id, start: line.start, end: line.end, tokens: line.tokens, joiner: t.joiner };
      if (g) g.rows.push(row);
      else out.push({ start: line.start, rows: [row] });
    }
  }
  return out.sort((a, b) => a.start - b.start).map((g) => g.rows.sort((x, y) => wanted.indexOf(x.track) - wanted.indexOf(y.track)));
}

/** The cues of `lang`: each line from LEAD before its first token to TAIL after its last, as the player shows it. Nothing runs past `limit` (s), the end of the film. */
export function cues(subs: Subtitles, lang: string, limit = Infinity): Cue[] {
  return buildCues(groups(subs, lang), { lead: LEAD, tail: TAIL, limit });
}

export function render(cs: Cue[], format: Format, lang: string): string {
  return renderCues(cs, format, lang);
}
