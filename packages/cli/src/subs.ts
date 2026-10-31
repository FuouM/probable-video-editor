// pve subs: the subtitle tracks of a project (projects/<id>/site/subtitles.json, made by app/scripts/subtitles.ts)
// as files for YouTube, with the highlight of the player: the token that is sung now is yellow, the tokens
// before it are white and the tokens after it are grey. A subtitle file has no running highlight, so every change
// of state is its own cue: the whole line again, with another token lit.
// A song with a lyric map gets a Japanese file of two rows, the romaji on top of the Japanese, and an English file.
import { LEAD, TAIL, type SubLine, type SubTrack, type Subtitles } from '../../../app/src/subtitles';

export type State = 'pending' | 'sung' | 'done';
export type Format = 'ttml' | 'srt';

/** A stretch of a row that has one state. */
export interface Run {
  text: string;
  state: State;
}

/** The text on screen from `start` to `end` (s): one or two rows of runs. */
export interface Cue {
  start: number;
  end: number;
  rows: Run[][];
}

export const COLORS: Record<State, string> = { sung: '#FFD84A', done: '#FFFFFF', pending: '#A0A0A0' };

/** Two state changes closer than this (s) are one: a cue this short is not read. */
const MIN_CUE = 0.03;

interface Row {
  /** The id of the track the line is from. */
  track: string;
  line: SubLine;
  joiner: string;
}

/** The rows of a language: English is the English track, Japanese is the romaji row and the Japanese row. */
const ROWS: Record<string, string[]> = { en: ['en'], ja: ['romaji', 'ja'] };

/** The languages that `subs` has tracks for: `en`, and `ja` when the song has a lyric map. */
export function languages(subs: Subtitles): string[] {
  const ids = new Set<string>(subs.tracks.map((t) => t.id));
  return Object.entries(ROWS).filter(([, rows]) => rows.every((r) => ids.has(r))).map(([lang]) => lang);
}

const t3 = (x: number) => Math.round(x * 1000) / 1000;

/** The state of the token [from, to) over the interval [a, b). */
function stateOf(from: number, to: number, a: number, b: number): State {
  const m = (a + b) / 2;
  if (to <= m) return 'done';
  return from <= m ? 'sung' : 'pending';
}

function rowRuns(r: Row, a: number, b: number): Run[] {
  const runs: Run[] = [];
  const push = (text: string, state: State) => {
    const last = runs[runs.length - 1];
    if (last && last.state === state) last.text += text;
    else runs.push({ text, state });
  };
  let before: State = 'pending';
  r.line.tokens.forEach(([text, from, to], i) => {
    const state = stateOf(from, to, a, b);
    // the space between two tokens takes the state of the token before it, so a lit token has no lit space after it
    if (i > 0 && r.joiner) push(r.joiner, before);
    push(text, state);
    before = state;
  });
  return runs;
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
      const row: Row = { track: t.id, line, joiner: t.joiner };
      if (g) g.rows.push(row);
      else out.push({ start: line.start, rows: [row] });
    }
  }
  return out.sort((a, b) => a.start - b.start).map((g) => g.rows.sort((x, y) => wanted.indexOf(x.track) - wanted.indexOf(y.track)));
}

/** The cues of `lang`: each line from LEAD before its first token to TAIL after its last, as the player shows it. Nothing runs past `limit` (s), the end of the film. */
export function cues(subs: Subtitles, lang: string, limit = Infinity): Cue[] {
  const gs = groups(subs, lang);
  const out: Cue[] = [];
  let prevEnd = 0;
  gs.forEach((rows, gi) => {
    const first = Math.min(...rows.map((r) => r.line.start));
    const last = Math.max(...rows.map((r) => r.line.end));
    const next = gs[gi + 1] ? Math.min(...gs[gi + 1]!.map((r) => r.line.start)) : Infinity;
    const start = Math.max(first - LEAD, prevEnd);
    const end = t3(Math.max(last, Math.min(last + TAIL, next - LEAD)));
    // every start and end of a token inside the line is a change of state
    const marks = new Set<number>([t3(start), end]);
    for (const r of rows) for (const [, from, to] of r.line.tokens) for (const x of [from, to]) if (x > start && x < end) marks.add(t3(x));
    const cuts: number[] = [];
    for (const x of [...marks].sort((a, b) => a - b)) {
      if (!cuts.length || x - cuts[cuts.length - 1]! >= MIN_CUE || x === end) cuts.push(x);
    }
    const pieces: Cue[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i]!, b = cuts[i + 1]!;
      if (b <= a) continue;
      const rowsHere = rows.map((r) => rowRuns(r, a, b));
      const prev = pieces[pieces.length - 1];
      if (prev && JSON.stringify(prev.rows) === JSON.stringify(rowsHere)) prev.end = b;
      else pieces.push({ start: a, end: b, rows: rowsHere });
    }
    out.push(...pieces);
    prevEnd = end;
  });
  return out.filter((c) => c.start < limit).map((c) => (c.end > limit ? { ...c, end: limit } : c));
}

function stamp(s: number, sep: '.' | ','): string {
  const ms = Math.round(s * 1000);
  const p = (n: number, w: number) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3_600_000), 2)}:${p(Math.floor(ms / 60_000) % 60, 2)}:${p(Math.floor(ms / 1000) % 60, 2)}${sep}${p(ms % 1000, 3)}`;
}

const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const html = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** SubRip: `<font color>` runs. */
export function toSrt(cs: Cue[]): string {
  return cs
    .map((c, i) => {
      const body = c.rows.map((row) => row.map((r) => `<font color="${COLORS[r.state]}">${html(r.text)}</font>`).join('')).join('\n');
      return `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${body}\n`;
    })
    .join('\n');
}

/** TTML: one `p` per cue, a coloured `span` per run, a `br` between rows. */
export function toTtml(cs: Cue[], lang: string): string {
  const ps = cs.map((c) => {
    const body = c.rows.map((row) => row.map((r) => `<span tts:color="${COLORS[r.state]}">${xml(r.text)}</span>`).join('')).join('<br/>');
    return `      <p begin="${stamp(c.start, '.')}" end="${stamp(c.end, '.')}" xml:space="preserve">${body}</p>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:lang="${lang}">`,
    '  <body>',
    '    <div>',
    ...ps,
    '    </div>',
    '  </body>',
    '</tt>',
    '',
  ].join('\n');
}

export function render(cs: Cue[], format: Format, lang: string): string {
  return format === 'srt' ? toSrt(cs) : toTtml(cs, lang);
}
