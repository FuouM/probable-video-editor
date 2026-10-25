// Rule checks on a resolved video: clip overlaps, gaps and cuts off the beat.
// Pure functions. No file access.

import type { LintFinding, LintResult, ResolvedVideo } from './types.ts';

/** A cut further than this from a beat is off beat. */
export const OFF_BEAT_TOLERANCE_SEC = 0.02;
const EDGE_EPS_SEC = 0.001;

export function lintVideo(video: ResolvedVideo): LintResult {
  const findings: LintFinding[] = [];
  const clips = [...video.clips].sort((a, b) => a.start - b.start);

  for (let i = 0; i < clips.length - 1; i++) {
    const current = clips[i]!;
    const next = clips[i + 1]!;

    if (next.start < current.end - EDGE_EPS_SEC) {
      findings.push({
        rule: 'clip-overlap',
        severity: 'error',
        message: `Clips '${current.id}' and '${next.id}' overlap by ${(current.end - next.start).toFixed(3)}s`,
        clipId: next.id,
        t: next.start,
      });
    }

    if (next.start > current.end + EDGE_EPS_SEC) {
      findings.push({
        rule: 'clip-gap',
        severity: 'warning',
        message: `Gap of ${(next.start - current.end).toFixed(3)}s between '${current.id}' and '${next.id}'`,
        clipId: next.id,
        t: current.end,
      });
    }
  }

  const secPerBeat = 60 / video.bpm;
  for (const clip of video.clips) {
    // a clip at 0 starts with the song: there is no cut to put on a beat
    if (clip.start <= EDGE_EPS_SEC) continue;
    const timeDistance = Math.abs(clip.startBeat - Math.round(clip.startBeat)) * secPerBeat;
    if (timeDistance > OFF_BEAT_TOLERANCE_SEC + EDGE_EPS_SEC) {
      findings.push({
        rule: 'cut-off-beat',
        severity: 'warning',
        message: `Clip '${clip.id}' starts ${(timeDistance * 1000).toFixed(1)}ms off beat (tolerance ${(OFF_BEAT_TOLERANCE_SEC * 1000).toFixed(0)}ms)`,
        clipId: clip.id,
        t: clip.start,
      });
    }
  }

  return {
    valid: findings.every((f) => f.severity !== 'error'),
    findings,
  };
}
