// Parser and resolver for time expressions (DESIGN section 5.1) and for video.json v2.
//
// Grammar:
//   Expression  ::= Clause ('||' Clause)*            B when A does not resolve
//   Clause      ::= Target ('@' Snap)? Offset*
//   Target      ::= Number | '@' Marker | 'clip:' Id '.' ('start'|'end')
//                 | 'bar:' N | 'beat:' N | 'end'
//                 | 'section:' Name Edge? | 'lyric:' Text ('#' n)? (':tol=' s)? Edge?
//                 | 'word:' Text ('#' n)? Edge? | 'syl:' Text ('#' n)? Edge?
//   Edge        ::= '.end'                            end time instead of start time
//   Snap        ::= 'beat<=' | 'beat~' | 'downbeat<=' | 'downbeat~'
//   Offset      ::= ('+'|'-') Number ('f'|'b'|'bar'|'s')?
// beat:N is 0-based (beat:0 = first beat). bar:N is 1-based (bar:1 = first downbeat).
// #n is 0-based. Without #n, a lyric, word or syl query must match exactly once.

import { TimingData, TimingError } from './timing.ts';
import type { ResolvedClip, ResolvedTransition, ResolvedVideo, TimeValue, VideoJson } from './types.ts';

export type ErrorCode = 'SYNTAX_ERROR' | 'AMBIGUOUS_QUERY' | 'TOLERANCE_EXCEEDED' | 'UNRESOLVED_ANCHOR' | 'CIRCULAR_REFERENCE';

export class ResolveError extends Error {
  readonly code: ErrorCode;
  /** JSON path in video.json, for example `clips[3].at`, when the error comes from resolveVideo. */
  readonly path?: string;
  constructor(code: ErrorCode, message: string, path?: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'ResolveError';
    this.code = code;
    this.path = path;
  }
}

export type SnapDirectiveKind = 'beat<=' | 'downbeat~' | 'beat~' | 'downbeat<=';

export type OffsetUnit = 'f' | 'b' | 'bar' | 's';

export interface OffsetNode {
  sign: 1 | -1;
  amount: number;
  unit: OffsetUnit;
}

export type Edge = 'start' | 'end';

export type TargetNode =
  | { kind: 'marker'; name: string }
  | { kind: 'clipEdge'; clipId: string; edge: Edge }
  | { kind: 'lyric'; text: string; nth?: number; tol?: number; edge: Edge }
  | { kind: 'word'; text: string; nth?: number; edge: Edge }
  | { kind: 'syl'; text: string; nth?: number; edge: Edge }
  | { kind: 'section'; name: string; edge: Edge }
  | { kind: 'bar'; n: number }
  | { kind: 'beat'; n: number }
  | { kind: 'end' }
  | { kind: 'number'; value: number };

export interface AnchorClauseNode {
  target: TargetNode;
  snap?: SnapDirectiveKind;
  offsets: OffsetNode[];
}

export interface ExpressionNode {
  clauses: AnchorClauseNode[];
}

export interface ResolveContext {
  timing: TimingData;
  /** Frames per second for `f` offsets. */
  fps: number;
  /** Time of marker `@name`. Throws a ResolveError when the marker does not resolve. */
  marker?: (name: string) => number;
  /** Time of `clip:id.start` or `clip:id.end`. Throws a ResolveError when the clip does not resolve. */
  clipEdge?: (clipId: string, edge: Edge) => number;
}

const DEFAULT_SNAP_TOL_SEC = 0.02;

export function parseExpression(input: string): ExpressionNode {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new ResolveError('SYNTAX_ERROR', 'Empty anchor expression');
  }
  const clauses = trimmed.split('||').map((part) => parseAnchorClause(part.trim()));
  return { clauses };
}

function parseAnchorClause(clauseStr: string): AnchorClauseNode {
  if (clauseStr.length === 0) {
    throw new ResolveError('SYNTAX_ERROR', 'Empty anchor clause');
  }

  // Offsets are at the end of the clause. Read them from right to left.
  let remaining = clauseStr;
  const offsets: OffsetNode[] = [];
  const offsetRegex = /[+-]\s*\d+(?:\.\d+)?(?:f|bar|b|s)?$/;
  while (true) {
    remaining = remaining.trim();
    const match = remaining.match(offsetRegex);
    if (!match || match.index === undefined) break;
    offsets.unshift(parseOffset(match[0].replace(/\s+/g, '')));
    remaining = remaining.slice(0, match.index).trim();
  }

  // A snap directive is an '@' after the target. A marker target starts with '@'.
  let snap: SnapDirectiveKind | undefined;
  const snapMatch = remaining.match(/@\s*(beat<=|downbeat~|beat~|downbeat<=)$/);
  if (snapMatch && snapMatch.index !== undefined && snapMatch.index > 0) {
    snap = snapMatch[1] as SnapDirectiveKind;
    remaining = remaining.slice(0, snapMatch.index).trim();
  } else if (remaining.lastIndexOf('@') > 0) {
    const cand = remaining.slice(remaining.lastIndexOf('@') + 1).trim();
    throw new ResolveError('SYNTAX_ERROR', `Invalid snap directive "@${cand}" in "${clauseStr}"`);
  }

  return { target: parseTarget(remaining.trim()), snap, offsets };
}

function parseOffset(s: string): OffsetNode {
  const sign: 1 | -1 = s[0] === '-' ? -1 : 1;
  const match = s.slice(1).match(/^(\d+(?:\.\d+)?)(f|bar|b|s)?$/);
  if (!match) {
    throw new ResolveError('SYNTAX_ERROR', `Invalid offset syntax: "${s}"`);
  }
  return { sign, amount: Number(match[1]), unit: (match[2] ?? 's') as OffsetUnit };
}

/** Splits a trailing `.end` from a lyric, word, syl or section reference. */
function splitEdge(inner: string): { body: string; edge: Edge } {
  const trimmed = inner.trimEnd();
  if (trimmed.endsWith('.end')) {
    return { body: trimmed.slice(0, -'.end'.length), edge: 'end' };
  }
  return { body: trimmed, edge: 'start' };
}

/** Splits a trailing `#n` and returns the trimmed text. */
function splitNth(prefix: string, inner: string): { text: string; nth?: number } {
  const hashMatch = inner.match(/#\s*(\d+)\s*$/);
  const text = (hashMatch && hashMatch.index !== undefined ? inner.slice(0, hashMatch.index) : inner).trim();
  if (text.length === 0) {
    throw new ResolveError('SYNTAX_ERROR', `Empty text in target: "${prefix}${inner}"`);
  }
  return { text, nth: hashMatch ? Number(hashMatch[1]) : undefined };
}

function parseGridNumber(prefix: string, s: string): number {
  const numStr = s.slice(prefix.length).trim();
  const n = Number(numStr);
  if (numStr.length === 0 || Number.isNaN(n)) {
    throw new ResolveError('SYNTAX_ERROR', `Invalid number "${numStr}" in "${s}"`);
  }
  return n;
}

function parseTarget(s: string): TargetNode {
  if (s.length === 0) {
    throw new ResolveError('SYNTAX_ERROR', 'Empty target');
  }

  if (s.startsWith('@')) {
    const name = s.slice(1).trim();
    if (name.length === 0) {
      throw new ResolveError('SYNTAX_ERROR', `Invalid marker reference: "${s}"`);
    }
    return { kind: 'marker', name };
  }

  if (s.startsWith('clip:')) {
    const inner = s.slice('clip:'.length);
    const dotIdx = inner.lastIndexOf('.');
    if (dotIdx === -1) {
      throw new ResolveError('SYNTAX_ERROR', `Invalid clip edge syntax (missing .start or .end): "${s}"`);
    }
    const clipId = inner.slice(0, dotIdx).trim();
    const edge = inner.slice(dotIdx + 1).trim();
    if (edge !== 'start' && edge !== 'end') {
      throw new ResolveError('SYNTAX_ERROR', `Invalid clip edge "${edge}" in "${s}" (expected .start or .end)`);
    }
    return { kind: 'clipEdge', clipId, edge };
  }

  if (s.startsWith('lyric:')) {
    const { body, edge } = splitEdge(s.slice('lyric:'.length));
    let textAndNth = body;
    let tol: number | undefined;
    const tolIdx = body.indexOf(':tol=');
    if (tolIdx !== -1) {
      const tolStr = body.slice(tolIdx + ':tol='.length).trim();
      tol = Number(tolStr);
      if (tolStr.length === 0 || Number.isNaN(tol)) {
        throw new ResolveError('SYNTAX_ERROR', `Invalid tolerance value in lyric target: "${s}"`);
      }
      textAndNth = body.slice(0, tolIdx);
    }
    return { kind: 'lyric', ...splitNth('lyric:', textAndNth), tol, edge };
  }

  if (s.startsWith('word:')) {
    const { body, edge } = splitEdge(s.slice('word:'.length));
    return { kind: 'word', ...splitNth('word:', body), edge };
  }

  if (s.startsWith('syl:')) {
    const { body, edge } = splitEdge(s.slice('syl:'.length));
    return { kind: 'syl', ...splitNth('syl:', body), edge };
  }

  if (s.startsWith('section:')) {
    const { body, edge } = splitEdge(s.slice('section:'.length));
    const name = body.trim();
    if (name.length === 0) {
      throw new ResolveError('SYNTAX_ERROR', `Invalid section reference: "${s}"`);
    }
    return { kind: 'section', name, edge };
  }

  if (s.startsWith('bar:')) {
    return { kind: 'bar', n: parseGridNumber('bar:', s) };
  }
  if (s.startsWith('beat:')) {
    return { kind: 'beat', n: parseGridNumber('beat:', s) };
  }

  if (s === 'end') {
    return { kind: 'end' };
  }

  const num = Number(s);
  if (!Number.isNaN(num)) {
    return { kind: 'number', value: num };
  }

  throw new ResolveError('SYNTAX_ERROR', `Unrecognized anchor target syntax: "${s}"`);
}

export function resolveAnchor(expr: TimeValue, context: ResolveContext): number {
  if (typeof expr === 'number') {
    return expr;
  }

  const ast = parseExpression(expr);
  let lastError: unknown;
  for (const clause of ast.clauses) {
    try {
      return resolveClause(clause, context);
    } catch (err) {
      // Ambiguity, syntax errors and cycles are never hidden by a `||` alternative.
      if (
        err instanceof ResolveError &&
        (err.code === 'AMBIGUOUS_QUERY' || err.code === 'SYNTAX_ERROR' || err.code === 'CIRCULAR_REFERENCE')
      ) {
        throw err;
      }
      lastError = err;
    }
  }

  if (lastError instanceof ResolveError) {
    throw lastError;
  }
  throw new ResolveError('UNRESOLVED_ANCHOR', lastError instanceof Error ? lastError.message : `Failed to resolve anchor: "${expr}"`);
}

function resolveClause(clause: AnchorClauseNode, context: ResolveContext): number {
  const { timing, fps } = context;
  let rawTime = resolveTarget(clause.target, context);
  const tol = clause.target.kind === 'lyric' && clause.target.tol !== undefined ? clause.target.tol : DEFAULT_SNAP_TOL_SEC;

  switch (clause.snap) {
    case undefined:
      break;
    case 'beat<=': {
      // Beat at or before target + tol.
      const snappedTime = timing.timeOfBeat(Math.floor(timing.beatAt(rawTime + tol)));
      if (snappedTime - rawTime > tol + 1e-4) {
        throw new ResolveError('TOLERANCE_EXCEEDED', `Snap to beat at ${snappedTime} exceeds tolerance ${tol} from target ${rawTime}`);
      }
      rawTime = snappedTime;
      break;
    }
    case 'downbeat~':
      rawTime = timing.nearestDownbeat(rawTime);
      break;
    case 'beat~':
      rawTime = timing.nearestBeat(rawTime);
      break;
    case 'downbeat<=': {
      // Downbeat at or before target + tol.
      const snappedTime = timing.downbeatAtOrBefore(rawTime + tol);
      if (snappedTime - rawTime > tol + 1e-4) {
        throw new ResolveError('TOLERANCE_EXCEEDED', `Snap to downbeat at ${snappedTime} exceeds tolerance ${tol} from target ${rawTime}`);
      }
      rawTime = snappedTime;
      break;
    }
  }

  const secPerBeat = 60 / timing.bpm;
  for (const offset of clause.offsets) {
    const unitSec = { f: 1 / fps, b: secPerBeat, bar: 4 * secPerBeat, s: 1 }[offset.unit];
    rawTime += offset.sign * offset.amount * unitSec;
  }

  return rawTime;
}

/** Runs a TimingData query and turns its errors into ResolveErrors. */
function query<T>(run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (err instanceof TimingError && err.code === 'AMBIGUOUS_QUERY') {
      throw new ResolveError('AMBIGUOUS_QUERY', err.message);
    }
    throw new ResolveError('UNRESOLVED_ANCHOR', err instanceof Error ? err.message : String(err));
  }
}

function resolveTarget(target: TargetNode, context: ResolveContext): number {
  const { timing } = context;

  switch (target.kind) {
    case 'number':
      return target.value;

    case 'end':
      return timing.duration;

    case 'bar':
      return timing.timeOfBar(target.n - 1);

    case 'beat':
      return timing.timeOfBeat(target.n);

    case 'section': {
      const sec = timing.findSection(target.name);
      if (!sec) {
        throw new ResolveError('UNRESOLVED_ANCHOR', `Section "${target.name}" not found`);
      }
      return target.edge === 'start' ? sec.start : sec.end;
    }

    case 'lyric': {
      // A line starts at its first word and ends at its last word.
      const line = query(() => timing.getLyric(target.text, target.nth));
      if (target.edge === 'start') return line.words[0]?.start ?? line.start;
      return line.words[line.words.length - 1]?.end ?? line.end;
    }

    case 'word': {
      const word = query(() => timing.getWord(target.text, target.nth));
      return target.edge === 'start' ? word.start : word.end;
    }

    case 'syl': {
      const syl = query(() => timing.getSyllable(target.text, target.nth));
      return target.edge === 'start' ? syl.start : syl.end;
    }

    case 'marker':
      if (!context.marker) {
        throw new ResolveError('UNRESOLVED_ANCHOR', `Marker "@${target.name}" not defined`);
      }
      return context.marker(target.name);

    case 'clipEdge':
      if (!context.clipEdge) {
        throw new ResolveError('UNRESOLVED_ANCHOR', `Clip "${target.clipId}" not found`);
      }
      return context.clipEdge(target.clipId, target.edge);
  }
}

/**
 * Resolves every marker and clip of a validated video.json against the song.
 * A clip without `to` ends at the `at` of the next clip. The last clip ends at `end`.
 * Markers and clips can refer to each other in any order. A cycle is a CIRCULAR_REFERENCE error.
 */
export function resolveVideo(video: VideoJson, timing: TimingData): ResolvedVideo {
  const clipIndex = new Map(video.clips.map((c, i) => [c.id, i]));
  const cache = new Map<string, number>();
  const active = new Set<string>();

  // Resolves one value once. `key` names the value for the cache and for cycle detection.
  const memo = (key: string, path: string, run: () => number): number => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    if (active.has(key)) {
      throw new ResolveError('CIRCULAR_REFERENCE', `Circular reference through ${key}`, path);
    }
    active.add(key);
    try {
      const value = run();
      cache.set(key, value);
      return value;
    } catch (err) {
      if (err instanceof ResolveError && err.path === undefined) {
        throw new ResolveError(err.code, err.message, path);
      }
      throw err;
    } finally {
      active.delete(key);
    }
  };

  const markerTime = (name: string): number => {
    const def = video.markers[name];
    if (!def) {
      throw new ResolveError('UNRESOLVED_ANCHOR', `Marker "@${name}" not defined`);
    }
    return memo(`@${name}`, `markers.${name}.at`, () => resolveAnchor(def.at, context));
  };

  const clipStart = (i: number): number =>
    memo(`clip:${video.clips[i]!.id}.start`, `clips[${i}].at`, () => resolveAnchor(video.clips[i]!.at, context));

  const clipEnd = (i: number): number => {
    const clip = video.clips[i]!;
    if (clip.to !== undefined) {
      return memo(`clip:${clip.id}.end`, `clips[${i}].to`, () => resolveAnchor(clip.to!, context));
    }
    return i + 1 < video.clips.length ? clipStart(i + 1) : timing.duration;
  };

  const context: ResolveContext = {
    timing,
    fps: video.fps,
    marker: markerTime,
    clipEdge: (clipId, edge) => {
      const i = clipIndex.get(clipId);
      if (i === undefined) {
        throw new ResolveError('UNRESOLVED_ANCHOR', `Clip "${clipId}" not found`);
      }
      return edge === 'start' ? clipStart(i) : clipEnd(i);
    },
  };

  const markers: Record<string, number> = {};
  for (const name of Object.keys(video.markers)) {
    markers[name] = markerTime(name);
  }

  const clips: ResolvedClip[] = video.clips.map((clip, i) => {
    const start = clipStart(i);
    const end = clipEnd(i);
    const resolved: ResolvedClip = {
      id: clip.id,
      start,
      end,
      dur: end - start,
      startBeat: timing.beatAt(start),
      endBeat: timing.beatAt(end),
    };
    if (clip.scene !== undefined) resolved.scene = clip.scene;
    if (clip.params !== undefined) resolved.params = clip.params;
    if (clip.samples !== undefined) resolved.samples = clip.samples;
    if (clip.xfade !== undefined) resolved.xfade = clip.xfade;
    if (clip.brief !== undefined) resolved.brief = clip.brief;
    return resolved;
  });

  const transitions: ResolvedTransition[] = (video.transitions ?? []).map((tr, i) => {
    const at = memo(`transition:${tr.id}.at`, `transitions[${i}].at`, () => resolveAnchor(tr.at, context));
    const resolved: ResolvedTransition = {
      id: tr.id,
      scene: tr.scene,
      at,
      start: Math.max(0, at - (tr.pre ?? 0)),
      end: Math.min(timing.duration, at + tr.post),
    };
    if (tr.params !== undefined) resolved.params = tr.params;
    if (tr.brief !== undefined) resolved.brief = tr.brief;
    return resolved;
  });

  const out: ResolvedVideo = {
    title: video.title,
    fps: video.fps,
    size: video.size,
    duration: timing.duration,
    bpm: timing.bpm,
    markers,
    clips,
    transitions,
  };
  if (video.overlay !== undefined) out.overlay = video.overlay;
  if (video.post !== undefined) out.post = video.post;
  return out;
}
