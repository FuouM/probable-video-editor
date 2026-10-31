// pve at: one call answers "what is at bar 111", "which frame is 1:23.4", "where is the lyric 'i think therefore'".
// Agent-first: every answer is one compact JSON object per line. Times are seconds with 3 decimals, `f` is the
// frame. Without the --frames flag the detail arrays hold seconds too.
import type { MapLine } from '@pve/core';
import { CliError, fmtBarBeat, fmtBeatOffset } from './out';
import { find } from './outline';
import { clipAt, timeOf, type View } from './project';

export interface AtOptions {
  /** Add the syllables, the Japanese units and the English phrases of each line, with times. */
  syl: boolean;
  /** Write the times of those arrays as frames. */
  frames: boolean;
  /** Most text hits to print. */
  max: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Per line: `bar.beat` of the start, times, text and, with a lyric map, the Japanese and English line. */
function lineRec(v: View, li: number, o: AtOptions): Record<string, unknown> {
  const { timing, resolved: { fps } } = v;
  const cal = timing.lines[li]!;
  const m: MapLine | undefined = v.lyrics?.lines[li];
  const tm = (t: number) => (o.frames ? Math.round(t * fps) : r3(t));
  const rec: Record<string, unknown> = {
    i: li, r: m?.r, s: r3(cal.start), e: r3(cal.end), f: [Math.round(cal.start * fps), Math.round(cal.end * fps)],
    bar: fmtBarBeat(timing, cal.start), t: cal.text, jp: m?.jp, en: m?.enText,
  };
  if (o.syl) {
    rec.syl = cal.words.flatMap((w) => w.syl).map((s, k) => {
      const base = [k, s.text, tm(s.start), tm(s.end)];
      return m?.syl[k]?.ghost ? [...base, 'ghost'] : base;
    });
    let from = 0;
    rec.wd = cal.words.map((w) => [w.text, from, (from += w.syl.length)]);
    if (m) {
      rec.jpu = m.jpUnits.map((u) => [u.glyph, u.from, u.to, tm(u.start), tm(u.end)]);
      rec.enp = m.en.map((e) => [e.text, e.from, e.to, tm(e.start), tm(e.end), ...(e.loose ? ['~'] : [])]);
    }
  }
  return rec;
}

/** The syllable that sounds at t in line `li`: the last one that started, or the first one before the line sings. */
function sylRec(v: View, li: number, t: number): Record<string, unknown> {
  const cal = v.timing.lines[li]!;
  const flat = cal.words.flatMap((w) => w.syl.map((s) => ({ s, w: w.text })));
  let k = flat.findLastIndex((x) => x.s.start <= t + 1e-9);
  const before = k < 0;
  if (before) k = 0;
  const { s, w } = flat[k]!;
  const ms = v.lyrics?.lines[li]?.syl[k];
  const unit = ms && ms.unit >= 0 ? v.lyrics!.lines[li]!.jpUnits[ms.unit]! : undefined;
  const phrases = ms?.en.map((p) => v.lyrics!.lines[li]!.en[p]!) ?? [];
  return {
    k, w, t: s.text, s: r3(s.start), e: r3(s.end),
    jp: ms ? (ms.ghost ? null : unit!.glyph) : undefined,
    ghost: ms?.ghost ? 1 : undefined,
    en: phrases.length ? phrases.map((p) => p.text).join(' | ') : undefined,
    loose: phrases.some((p) => p.loose) ? 1 : undefined,
    // t is not inside this syllable: before the first one, or in the pause after it
    gap: before || t >= s.end - 1e-9 ? 1 : undefined,
  };
}

/** Everything the song and the edit know at time t. */
export function pointAt(v: View, t: number, o: AtOptions): Record<string, unknown> {
  const { timing, resolved: { fps } } = v;
  const sec = timing.sections.findLast((s) => s.start <= t + 1e-9 && t < s.end);
  const p: Record<string, unknown> = {
    t: r3(t), f: Math.round(t * fps), bar: fmtBarBeat(timing, t), beat: r3(timing.beatAt(t)), off: fmtBeatOffset(timing, t),
    sec: sec?.name, clip: clipAt(v, t)?.id,
  };
  const li = timing.lines.findIndex((l) => l.start <= t + 1e-9 && t < l.end);
  if (li >= 0) {
    p.line = lineRec(v, li, o);
    p.syl = sylRec(v, li, t);
  } else {
    const prev = timing.lines.findLastIndex((l) => l.end <= t + 1e-9);
    const next = timing.lines.findIndex((l) => l.start > t);
    p.gap = {
      prev: prev < 0 ? undefined : { line: prev, end: r3(timing.lines[prev]!.end), d: r3(timing.lines[prev]!.end - t) },
      next: next < 0 ? undefined : { line: next, start: r3(timing.lines[next]!.start), d: r3(timing.lines[next]!.start - t) },
    };
  }
  return p;
}

/** The line, bar and beat grid between two times, with the lines that sound in it. */
function rangeAt(v: View, t0: number, t1: number, o: AtOptions): Record<string, unknown> {
  const { timing, resolved: { fps } } = v;
  const ends = (t: number) => ({ t: r3(t), f: Math.round(t * fps), bar: fmtBarBeat(timing, t) });
  const lines = timing.lines.flatMap((l, i) => (l.end > t0 && l.start < t1 ? [lineRec(v, i, o)] : []));
  return {
    from: ends(t0), to: ends(t1), dur: r3(t1 - t0), frames: Math.round(t1 * fps) - Math.round(t0 * fps),
    bars: r3(timing.barAt(t1) - timing.barAt(t0)), beats: r3(timing.beatAt(t1) - timing.beatAt(t0)),
    sec: timing.sections.filter((s) => s.end > t0 && s.start < t1).map((s) => s.name),
    clip: v.resolved.clips.filter((c) => c.end > t0 && c.start < t1).map((c) => c.id),
    lines,
  };
}

/**
 * Seconds of a coordinate, or undefined when the text is not one. Coordinates:
 *   bar 111, bar 111.3 (bar.beat, as every pve output prints it)   beat 250 (0-based, as `beat:250`)
 *   frame 5665 | f5665      line 38 (calibrated line)      syl 38.5 (line.syllable)
 *   94.4 | 94.4s | 1:34.4   any time expression: @marker, clip:id.start, section:Chorus, lyric:text, bar:12+2b
 */
export function coordinate(v: View, s: string): number | undefined {
  const { timing, resolved: { fps } } = v;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^bar\s*[: ]?\s*(\d+)(?:\.(\d+))?$/i))) {
    const bar = Number(m[1]), beat = m[2] === undefined ? 1 : Number(m[2]);
    if (!(bar >= 1 && bar <= timing.downbeats.length)) throw new CliError({ rule: 'locator', message: `'${s}': the song has bars 1..${timing.downbeats.length}` });
    if (beat < 1) throw new CliError({ rule: 'locator', message: `'${s}': beats count from 1 in a bar` });
    return timing.timeOfBeat(Math.round(timing.beatAt(timing.downbeats[bar - 1]!)) + beat - 1);
  }
  if ((m = s.match(/^beat\s*[: ]?\s*(\d+(?:\.\d+)?)$/i))) return timing.timeOfBeat(Number(m[1]));
  if ((m = s.match(/^f(?:rame)?\s*[: ]?\s*(\d+)$/i))) return Number(m[1]) / fps;
  if ((m = s.match(/^line\s*[: ]?\s*(\d+)$/i))) {
    const line = timing.lines[Number(m[1])];
    if (!line) throw new CliError({ rule: 'locator', message: `'${s}': the song has lines 0..${timing.lines.length - 1}` });
    return line.start;
  }
  if ((m = s.match(/^syl\s+(\d+)\.(\d+)$/i))) {
    const line = timing.lines[Number(m[1])];
    const syl = line?.words.flatMap((w) => w.syl)[Number(m[2])];
    if (!line || !syl) throw new CliError({ rule: 'locator', message: `'${s}': no syllable ${m[2]} in line ${m[1]}. pve at "line ${m[1]}" --syl lists them` });
    return syl.start;
  }
  if ((m = s.match(/^(\d+):(\d+(?:\.\d+)?)$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = s.match(/^(\d+(?:\.\d+)?)s?$/i))) return Number(m[1]);
  if (/^(@|clip:|section:|lyric:|word:|syl:|bar:|beat:|end\b)/.test(s)) return timeOf(v, s);
  return undefined;
}

/** Records for one query: a coordinate, a range `a..b` of coordinates, or text to look for. */
export function at(v: View, query: string, o: AtOptions): Record<string, unknown>[] {
  const q = query.trim();
  const dots = q.indexOf('..');
  if (dots >= 0) {
    const left = q.slice(0, dots).trim();
    // `bar 111..115`: a bare number on the right takes the unit of the left side
    const unit = left.match(/^(bar|beat|frame|f|line)(?![a-z])/i)?.[1];
    const right = q.slice(dots + 2).trim();
    const a = coordinate(v, left), b = coordinate(v, unit && /^\d+(\.\d+)?$/.test(right) ? `${unit} ${right}` : right);
    if (a === undefined || b === undefined) throw new CliError({ rule: 'locator', message: `'${q}': both sides of .. must be coordinates (bar 111, f5665, 1:34.4, @marker)` });
    if (!(b > a)) throw new CliError({ rule: 'locator', message: `'${q}': the range ends before it starts` });
    return [{ q, ...rangeAt(v, a, b, o) }];
  }
  const t = coordinate(v, q);
  if (t !== undefined) return [{ q, ...pointAt(v, t, o) }];

  // text: lyric lines, words, syllables, Japanese, English, sections, markers, clips. A trailing #n picks one hit.
  const pick = q.match(/^(.*\S)\s*#(\d+)$/);
  const text = pick ? pick[1]! : q;
  const hits = find(v, text);
  if (!hits.length) throw new CliError({ rule: 'locator', message: `'${q}': no match in lyrics, translations, sections, markers or clips`, fix: 'use a shorter text, or a coordinate: bar 12, f600, 1:23.4' });
  const chosen = pick ? hits.slice(Number(pick[2]), Number(pick[2]) + 1) : hits;
  if (!chosen.length) throw new CliError({ rule: 'locator', message: `'${q}': only ${hits.length} matches (#0..#${hits.length - 1})` });
  const shown = chosen.slice(0, o.max);
  const out: Record<string, unknown>[] = shown.map((h, n) => ({ q, n: pick ? Number(pick[2]) : n, kind: h.kind, text: h.text, x: h.expr, ...pointAt(v, h.t, o) }));
  if (chosen.length > shown.length) out.push({ q, more: chosen.length - shown.length, fix: 'add #n to the text to pick a hit, or --max N' });
  return out;
}
