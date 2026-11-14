// projects/sardine/video/lanes.json holds the ko and ca lyric lanes as the song folder builds them now.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildLanes, LANES_FILE, laneText } from '../projects/sardine/video/make-lanes';

test('sardine lanes.json is up to date: run bun projects/sardine/video/make-lanes.ts', async () => {
  const now = laneText(await buildLanes());
  expect(readFileSync(LANES_FILE, 'utf8').replace(/\r\n/g, '\n')).toBe(now);
});

test('sardine lanes: ko sings the tuna lines in chorus 2 and 3, and every line has its written form', async () => {
  const lanes = await buildLanes();
  expect(lanes.ko.length).toBe(16);
  expect(lanes.ko[0]!.start).toBeCloseTo(106.667, 2);
  expect(lanes.ko[8]!.start).toBeGreaterThan(135);
  for (const l of [...lanes.ko, ...lanes.ca]) expect(l.written?.units.length).toBeGreaterThan(0);
});
