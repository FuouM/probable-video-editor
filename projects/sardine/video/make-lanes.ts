#!/usr/bin/env bun
// Writes video/lanes.json: the lyric lines of the other singers of the song (user_input/singers.json), `ko` (the
// tuna voice) and `ca` (the double of the lead), in the engine's input shape (LyricsInputLine) with their written
// form, as the page builds the lead lane (app/scripts/inputs.ts engineLines). The scenes import the file, because
// the engine context holds the lead lane only. Run it again after a change to a lane's calibration or map:
//   bun projects/sardine/video/make-lanes.ts
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadSinger } from '../../../packages/core/src/load';
import type { LyricsInputLine } from '../../../packages/engine/src/lyrics';
import { engineLines } from '../../../app/scripts/inputs';

export const LANES = ['ko', 'ca'] as const;
export type LaneId = (typeof LANES)[number];
export type LaneFile = Record<LaneId, LyricsInputLine[]>;

const dir = path.resolve(import.meta.dir, '..');
export const LANES_FILE = path.join(import.meta.dir, 'lanes.json');

/** The lanes as the song folder holds them now. */
export async function buildLanes(): Promise<LaneFile> {
  const out = {} as LaneFile;
  for (const id of LANES) out[id] = engineLines(await loadSinger(dir, id));
  return out;
}

/** The text of lanes.json: one line of JSON per lyric line, so a change shows in a diff. */
export function laneText(lanes: LaneFile): string {
  const body = LANES.map((id) => `  ${JSON.stringify(id)}: [\n${lanes[id].map((l) => `    ${JSON.stringify(l)}`).join(',\n')}\n  ]`);
  return `{\n${body.join(',\n')}\n}\n`;
}

if (import.meta.main) {
  const lanes = await buildLanes();
  writeFileSync(LANES_FILE, laneText(lanes));
  console.log(`wrote ${path.relative(process.cwd(), LANES_FILE)}: ${LANES.map((id) => `${id} ${lanes[id].length} lines`).join(', ')}`);
}
