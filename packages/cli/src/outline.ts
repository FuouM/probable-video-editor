// pve outline and pve find (DESIGN 8.2): the resolved edit and the song, as text or JSON.
import { foldText, resolveAnchor, type TimingData } from '@pve/core';
import { fmtBarBeat, fmtBeatOffset, fmtTime, table } from './out';
import type { Project } from './project';

export interface Outline {
  title: string;
  duration: number;
  bpm: number;
  /** Median count of beats between two downbeats. */
  beatsPerBar: number;
  bars: number;
  fps: number;
  size: [number, number];
  overlay?: string;
  markers: { name: string; expr: string | number; t: number; barBeat: string }[];
  sections: { name: string; start: number; end: number; barBeat: string }[];
  clips: { id: string; at: string | number; start: number; end: number; dur: number; barBeat: string; scene?: string; brief?: string; xfade?: number }[];
  transitions: { id: string; at: string | number; t: number; start: number; end: number; barBeat: string; scene: string; brief?: string }[];
  lines: { n: number; start: number; end: number; barBeat: string; text: string }[];
}

function beatsPerBar(timing: TimingData): number {
  const d = timing.downbeats;
  const counts: number[] = [];
  for (let i = 1; i < d.length; i++) counts.push(Math.round(timing.beatAt(d[i]!) - timing.beatAt(d[i - 1]!)));
  counts.sort((a, b) => a - b);
  return counts[counts.length >> 1] ?? 4;
}

export function outline(p: Project): Outline {
  const { timing, video, resolved: r } = p;
  const bb = (t: number) => fmtBarBeat(timing, t);
  return {
    title: r.title,
    duration: r.duration,
    bpm: r.bpm,
    beatsPerBar: beatsPerBar(timing),
    bars: timing.downbeats.length,
    fps: r.fps,
    size: r.size,
    ...(r.overlay ? { overlay: r.overlay } : {}),
    markers: Object.entries(r.markers).map(([name, t]) => ({ name, expr: video.markers[name]!.at, t, barBeat: bb(t) })),
    sections: timing.sections.map((s) => ({ name: s.name, start: s.start, end: s.end, barBeat: bb(s.start) })),
    clips: r.clips.map((c, i) => ({
      id: c.id, at: video.clips[i]!.at, start: c.start, end: c.end, dur: c.dur, barBeat: bb(c.start),
      ...(c.scene ? { scene: c.scene } : {}), ...(c.brief ? { brief: c.brief } : {}), ...(c.xfade ? { xfade: c.xfade } : {}),
    })),
    transitions: r.transitions.map((tr, i) => ({
      id: tr.id, at: video.transitions![i]!.at, t: tr.at, start: tr.start, end: tr.end, barBeat: bb(tr.at), scene: tr.scene,
      ...(tr.brief ? { brief: tr.brief } : {}),
    })),
    lines: timing.lines.map((l, n) => {
      const start = l.words[0]?.start ?? l.start;
      return { n, start, end: l.words[l.words.length - 1]?.end ?? l.end, barBeat: bb(start), text: l.text };
    }),
  };
}

/**
 * The outline of some clips only: those clips, and the markers, sections and lyric lines inside their
 * windows. Throws an Error that lists the clip ids when an id is unknown.
 */
export function focusOutline(o: Outline, ids: string[]): Outline {
  const unknown = ids.filter((id) => !o.clips.some((c) => c.id === id));
  if (unknown.length) throw new Error(`no clip ${unknown.join(', ')}. Clips: ${o.clips.map((c) => c.id).join(', ')}`);
  const clips = o.clips.filter((c) => ids.includes(c.id));
  const inside = (a: number, b: number) => clips.some((c) => a < c.end && b > c.start);
  return {
    ...o,
    clips,
    transitions: o.transitions.filter((tr) => inside(tr.start, tr.end)),
    markers: o.markers.filter((m) => inside(m.t, m.t + 1e-9)),
    sections: o.sections.filter((s) => inside(s.start, s.end)),
    lines: o.lines.filter((l) => inside(l.start, l.end)),
  };
}

export function formatOutline(o: Outline): string {
  const out: string[] = [];
  out.push(`${o.title}  ${fmtTime(o.duration)}  ${o.bpm.toFixed(2)} bpm  ${o.beatsPerBar}/4  ${o.bars} bars  ${o.fps} fps  ${o.size[0]}x${o.size[1]}${o.overlay ? `  overlay ${o.overlay}` : ''}`);
  out.push('', `clips (${o.clips.length})`);
  out.push(table(o.clips.map((c) => [c.id, fmtTime(c.start), fmtTime(c.end), c.dur.toFixed(3), c.barBeat, String(c.at), c.scene ?? '(card)', c.brief ?? '']), ['id', 'start', 'end', 'dur', 'bar', 'at', 'scene', 'brief']));
  if (o.transitions.length) {
    out.push('', `transitions (${o.transitions.length})`);
    out.push(table(o.transitions.map((tr) => [tr.id, fmtTime(tr.start), fmtTime(tr.end), fmtTime(tr.t), tr.barBeat, String(tr.at), tr.scene, tr.brief ?? '']), ['id', 'start', 'end', 'at', 'bar', 'expression', 'scene', 'brief']));
  }
  if (o.markers.length) {
    out.push('', `markers (${o.markers.length})`);
    out.push(table(o.markers.map((m) => [`@${m.name}`, fmtTime(m.t), m.barBeat, String(m.expr)]), ['name', 'time', 'bar', 'expression']));
  }
  out.push('', `sections (${o.sections.length})`);
  out.push(table(o.sections.map((s) => [s.name, fmtTime(s.start), fmtTime(s.end), s.barBeat]), ['name', 'start', 'end', 'bar']));
  out.push('', `lyric lines (${o.lines.length})`);
  out.push(table(o.lines.map((l) => [String(l.n), fmtTime(l.start), fmtTime(l.end), l.barBeat, l.text]), ['#', 'start', 'end', 'bar', 'text']));
  return out.join('\n');
}

export type FindKind = 'line' | 'word' | 'syl' | 'section' | 'marker' | 'clip';

export interface FindHit {
  kind: FindKind;
  /** The matched text: the lyric line, word, syllable, name or clip id (with its brief). */
  text: string;
  t: number;
  barBeat: string;
  /** `on beat`, `+31ms` or `-12ms`: distance from the nearest beat. */
  beat: string;
  /** A time expression that resolves to `t` in this project. */
  expr: string;
}

/**
 * Every lyric line, word, syllable, section, marker and clip that matches `text`, each with an expression
 * that resolves to its start. A query that matches more than once gets `#n` (0-based), as the resolver needs.
 */
export function find(p: Project, text: string): FindHit[] {
  const { timing, resolved: r } = p;
  const q = text.trim();
  const hits: FindHit[] = [];
  const add = (kind: FindKind, hitText: string, t: number, expr: string) =>
    hits.push({ kind, text: hitText, t, barBeat: fmtBarBeat(timing, t), beat: fmtBeatOffset(timing, t), expr });

  // lyric, word and syl queries: the resolver's own matching, so each printed expression resolves
  const each = <T>(get: (n: number) => T, visit: (m: T, suffix: string, count: number) => void) => {
    const all: T[] = [];
    for (let n = 0; ; n++) {
      try { all.push(get(n)); } catch { break; }
    }
    all.forEach((m, n) => visit(m, all.length > 1 ? `#${n}` : '', all.length));
  };
  if (q) {
    each((n) => timing.getLyric(q, n), (l, s) => add('line', l.text, l.words[0]?.start ?? l.start, `lyric:${q}${s}`));
    each((n) => timing.getWord(q, n), (w, s) => add('word', w.text, w.start, `word:${q}${s}`));
    each((n) => timing.getSyllable(q, n), (y, s) => add('syl', y.text, y.start, `syl:${q}${s}`));
  }
  const fq = foldText(q);
  for (const s of timing.sections) if (foldText(s.name).includes(fq)) add('section', s.name, s.start, `section:${s.name}`);
  for (const [name, t] of Object.entries(r.markers)) if (foldText(name).includes(fq)) add('marker', name, t, `@${name}`);
  for (const c of r.clips) {
    if (foldText(c.id).includes(fq) || foldText(c.brief ?? '').includes(fq)) add('clip', c.brief ? `${c.id}: ${c.brief}` : c.id, c.start, `clip:${c.id}.start`);
  }

  // keep only expressions that resolve to the hit (a repeated section name resolves to its first match)
  const ctx = {
    timing, fps: r.fps,
    marker: (name: string) => r.markers[name] ?? NaN,
    clipEdge: (id: string, edge: 'start' | 'end') => { const c = r.clips.find((x) => x.id === id); return c ? c[edge] : NaN; },
  };
  for (const h of hits) {
    let t = NaN;
    try { t = resolveAnchor(h.expr, ctx); } catch { /* not a valid expression for this text */ }
    if (!(Math.abs(t - h.t) < 1e-9)) h.expr = String(Number(h.t.toFixed(6)));
  }
  return hits;
}

export function formatFind(hits: FindHit[]): string {
  if (!hits.length) return 'no match';
  return table(
    hits.map((h) => [h.kind, fmtTime(h.t), h.barBeat, h.beat, h.expr, h.text]),
    ['kind', 'time', 'bar', 'beat', 'expression', 'text'],
  );
}
