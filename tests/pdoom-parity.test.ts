// P1.6: the resolved clips of projects/pdoom_original/video/video.json match the cuts of the original timeline.ts
// (tests/fixtures/pdoom-cuts.json, captured from the running app at upstream/main fa164b7).
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveVideo, TimingData, validateVideo } from '../packages/core/src/index.ts';
import { loadSong } from '../packages/core/src/load.ts';

const ROOT = path.join(import.meta.dir, '..');
const PROJECT = path.join(ROOT, 'projects/pdoom_original');
const TOL_SEC = 1e-4;

test('every pdoom_original clip starts and ends within 0.1 ms of the original timeline', async () => {
  const checked = validateVideo(JSON.parse(readFileSync(path.join(PROJECT, 'video/video.json'), 'utf8')));
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  const resolved = resolveVideo(checked.video, new TimingData((await loadSong(PROJECT)).timing));
  const fixture: { entries: { id: string; start: number; end: number }[] } = JSON.parse(
    readFileSync(path.join(ROOT, 'tests/fixtures/pdoom-cuts.json'), 'utf8'),
  );

  expect(resolved.clips.map((c) => c.id)).toEqual(fixture.entries.map((e) => e.id));
  expect(resolved.clips).toHaveLength(22);

  let maxDiff = 0;
  let worst = '';
  resolved.clips.forEach((clip, k) => {
    const want = fixture.entries[k]!;
    for (const [edge, got, ref] of [['start', clip.start, want.start], ['end', clip.end, want.end]] as const) {
      const diff = Math.abs(got - ref);
      if (diff > maxDiff) {
        maxDiff = diff;
        worst = `${clip.id}.${edge}`;
      }
      expect(diff, `${clip.id}.${edge}: ${got} vs ${ref}`).toBeLessThanOrEqual(TOL_SEC);
    }
  });
  console.log(`pdoom_original parity: max cut difference ${(maxDiff * 1000).toFixed(6)} ms${worst ? ` (${worst})` : ''}`);
});
