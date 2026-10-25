// The output layer of every pve command (DESIGN 8.2): plain text tables with one line per item, times as
// `mm:ss.mmm` and `bar.beat`, `--json` for one JSON document, problems with the file, the path and the fix.
// Exit codes: 0 = success, 1 = a check or a command failed, 2 = usage error.
import type { TimingData } from '@pve/core';

export const EXIT = { ok: 0, error: 1, usage: 2 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Wrong arguments. main() prints the message and the usage of the command, then exits with 2. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/** A command failed. main() prints it as a problem and exits with 1. */
export class CliError extends Error {
  override name = 'CliError';
  constructor(readonly problem: Omit<Problem, 'severity'>) {
    super(problem.message);
  }
}

export type Severity = 'error' | 'warning';

/** One finding of a command, for the human or the agent who fixes it. */
export interface Problem {
  severity: Severity;
  /** Rule name, for example `clip-overlap`. */
  rule: string;
  /** File relative to the project folder, for example `video/video.json`. */
  file?: string;
  /** JSON path (`clips[3].at`) or `line N` in the file. */
  at?: string;
  message: string;
  /** What to do. */
  fix?: string;
}

/** `mm:ss.mmm`. Negative times get a `-`. Minutes do not wrap at 60. */
export function fmtTime(t: number): string {
  const ms = Math.round(Math.abs(t) * 1000);
  const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, r = ms % 1000;
  return `${t < 0 && ms > 0 ? '-' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

/**
 * `bar.beat` of time t, as the storyboard card shows it: bar 1 is the first downbeat, the beat counts from
 * 1 at the downbeat of its bar. Before the first downbeat (a pickup) the bar is 0 and the beat counts from
 * the first beat.
 */
export function fmtBarBeat(timing: TimingData, t: number): string {
  // 1e-6 s: a time on a beat counts as that beat, not as the end of the beat before it
  const barIdx = Math.floor(timing.barAt(t + 1e-6));
  const beat0 = barIdx < 0 ? 0 : Math.round(timing.beatAt(timing.downbeats[barIdx]!));
  const beat = Math.max(0, Math.floor(timing.beatAt(t + 1e-6))) - beat0 + 1;
  return `${Math.max(0, barIdx + 1)}.${beat}`;
}

/**
 * Signed distance of t from its nearest beat: `on beat` within 1 ms, else `+31ms` (late) or `-12ms` (early).
 */
export function fmtBeatOffset(timing: TimingData, t: number): string {
  const d = (t - timing.nearestBeat(t)) * 1000;
  if (Math.abs(d) < 1) return 'on beat';
  return `${d > 0 ? '+' : '-'}${Math.round(Math.abs(d))}ms`;
}

/** Column text. The last column is not padded, so a long brief or lyric line does not push spaces. */
export function table(rows: string[][], header?: string[], indent = '  '): string {
  const all = header ? [header, ...rows] : rows;
  const widths: number[] = [];
  for (const r of all) r.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  return all
    .map((r) => indent + r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]!))).join('  ').trimEnd())
    .join('\n');
}

/**
 * Two lines per problem:
 *   error    video/video.json clips[3].at: Section "Chorus 2" not found
 *            fix: ...
 */
export function fmtProblem(p: Problem): string {
  const where = [p.file, p.at].filter(Boolean).join(' ');
  const head = `${p.severity.padEnd(8)} ${where ? `${where}: ` : ''}${p.message}`;
  return p.fix ? `${head}\n${' '.repeat(9)}fix: ${p.fix}` : head;
}

/** `2 errors, 1 warning`. */
export function fmtCounts(problems: Problem[]): string {
  const e = problems.filter((p) => p.severity === 'error').length;
  const w = problems.length - e;
  return `${e} error${e === 1 ? '' : 's'}, ${w} warning${w === 1 ? '' : 's'}`;
}
