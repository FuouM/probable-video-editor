// pve aup <file.aup>: reads an AviUtl project and writes video/assets/timeline.json (docs/AVIUTL.md has the schema).
// The sprite sheets are the PNG files in video/assets/. Their pixel size gives the cell size of each sheet.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AupDecodeError, AupFormatError, decodeTimeline, parseAup, type Timeline } from '@pve/aviutl';
import { TimingData } from '@pve/core';
import { loadSong } from '@pve/core/load';
import { CliError } from './out';
import type { ProjectRef } from './project';

export const TIMELINE_FILE = 'video/assets/timeline.json';

/** A section of the song on the frame grid of the aup. `start` and `end` are frames, `end` is the last frame (inclusive). `bar` is 1-based. */
export interface TimelineSection {
  name: string;
  start: number;
  end: number;
  bar: number;
}

/** The content of timeline.json. */
export interface TimelineFile extends Omit<Timeline, 'skipped'> {
  v: 1;
  /** File name of the aup. */
  source: string;
  sections: TimelineSection[];
  skipped: Timeline['skipped'];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Pixel size from the IHDR chunk of a PNG, or undefined when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return undefined;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

/**
 * The sections of the song on the frame grid of the aup. Frame `f` starts at `f / fps` seconds. A section ends one
 * frame before the next one starts.
 */
export function sectionFrames(sections: { name: string; start: number; end: number }[], fps: number, bar: (t: number) => number): TimelineSection[] {
  return sections.map((s) => ({ name: s.name, start: Math.round(s.start * fps), end: Math.round(s.end * fps) - 1, bar: bar(s.start) }));
}

/** timeline.json text: the header on a few lines, each object of a list on its own line. */
export function formatTimeline(file: TimelineFile): string {
  const lists = new Set(['sections', 'sprites', 'texts', 'groups', 'buffers', 'audio', 'skipped']);
  const rows = Object.entries(file).map(([k, v]) => {
    if (!lists.has(k)) return `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
    const items = v as unknown[];
    return items.length ? `  ${JSON.stringify(k)}: [\n${items.map((i) => `    ${JSON.stringify(i)}`).join(',\n')}\n  ]` : `  ${JSON.stringify(k)}: []`;
  });
  return `{\n${rows.join(',\n')}\n}\n`;
}

export interface AupImport {
  out: string;
  timeline: TimelineFile;
}

/** Reads `aupFile`, decodes it with the sprite sheets of video/assets/ and writes video/assets/timeline.json. */
export async function importAup(ref: ProjectRef, aupFile: string, skip: string[]): Promise<AupImport> {
  const assets = path.join(ref.dir, 'video/assets');
  if (!existsSync(aupFile)) throw new CliError({ rule: 'aup', message: `no file ${aupFile}` });
  let timeline: Timeline;
  try {
    const aup = parseAup(new Uint8Array(readFileSync(aupFile)));
    timeline = decodeTimeline(aup, {
      skip,
      imageSize: (file) => {
        const f = path.join(assets, file);
        return existsSync(f) ? pngSize(new Uint8Array(readFileSync(f))) : undefined;
      },
    });
  } catch (e) {
    if (e instanceof AupFormatError) throw new CliError({ rule: 'aup', file: path.basename(aupFile), message: e.message });
    if (e instanceof AupDecodeError) {
      throw new CliError({
        rule: 'aup', file: path.basename(aupFile), message: e.message,
        fix: 'copy the missing sprites (PNG) into video/assets/, or pass --skip <file,...> to leave out the objects of a file. A script or effect that the reader does not know needs a change in packages/aviutl',
      });
    }
    throw e;
  }

  const song = await loadSong(ref.dir);
  const grid = new TimingData(song.timing);
  const sections = sectionFrames(song.timing.sections, timeline.fps, (t) => Math.floor(grid.barAt(t + 1e-6)) + 1);
  const { skipped, ...rest } = timeline;
  const file: TimelineFile = { v: 1, source: path.basename(aupFile), ...rest, sections, skipped };
  const out = path.join(ref.dir, TIMELINE_FILE);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, formatTimeline(file));
  return { out, timeline: file };
}
