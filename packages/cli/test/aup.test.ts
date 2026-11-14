import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildAup, imageExt, spriteScript, scriptExt } from '../../aviutl/test/build';
import { formatTimeline, importAup, pngSize, sectionFrames, type TimelineFile } from '../src/aup';
import { CliError } from '../src/out';
import { makeProject } from './fixture';

/** The 8-byte PNG signature and an IHDR chunk header with the given size. No pixels: pngSize reads only the header. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

let dir = '', cleanup = () => {}, tmp = '';
beforeEach(() => {
  ({ dir, cleanup } = makeProject());
  tmp = mkdtempSync(path.join(tmpdir(), 'pve-aup-test-'));
  mkdirSync(path.join(dir, 'video/assets'), { recursive: true });
});
afterEach(() => {
  cleanup();
  rmSync(tmp, { recursive: true, force: true });
});

test('pngSize reads the header and refuses other bytes', () => {
  expect(pngSize(png(320, 168))).toEqual({ width: 320, height: 168 });
  expect(pngSize(new Uint8Array(40))).toBeUndefined();
});

test('sections go to the frame grid, the last frame inclusive', () => {
  const s = sectionFrames([{ name: 'A', start: 0, end: 7.111 }, { name: 'B', start: 7.111, end: 14.222 }], 18, (t) => Math.round(t) + 1);
  expect(s).toEqual([{ name: 'A', start: 0, end: 127, bar: 1 }, { name: 'B', start: 128, end: 255, bar: 8 }]);
});

test('formatTimeline puts each list item on its own line and parses back', () => {
  const file = { v: 1, source: 'x.aup', fps: 18, size: [256, 192], frames: 10, grid: { enabled: true, tempo: 135, beat: 4, offsetFrame: 1 }, sections: [], sprites: [{ a: 1 }, { a: 2 }], texts: [], groups: [], buffers: [], audio: [], skipped: [] };
  const text = formatTimeline(file as unknown as TimelineFile);
  expect(text.split('\n').filter((l) => l.startsWith('    '))).toEqual(['    {"a":1},', '    {"a":2}']);
  expect(JSON.parse(text)).toEqual(file);
});

test('importAup writes timeline.json with the cell size from the PNG and the sections of the song', async () => {
  const aupFile = path.join(tmp, 'p.aup');
  const sheet = (file: string) => ({
    layer: 3, start: 0, end: 20, preview: file,
    effects: [
      { type: '画像ファイル', ext: imageExt(`x\\${file}`) },
      { type: 'スクリプト制御', ext: scriptExt(spriteScript(2, 4, 1)) },
      { type: '標準描画', tracks: [10, -20, 0, 10000, 0, 0], checks: [1] },
    ],
  });
  writeFileSync(aupFile, buildAup({ rate: 18, frames: 90, objects: [sheet('s.png'), sheet('gone.bmp')] }));
  writeFileSync(path.join(dir, 'video/assets/s.png'), png(80, 60));
  const ref = { id: 'song', dir };

  await expect(importAup(ref, aupFile, [])).rejects.toThrow(/image file gone.bmp is not in the image folder/);
  const r = await importAup(ref, aupFile, ['gone.bmp']);
  expect(path.basename(r.out)).toBe('timeline.json');
  const t = JSON.parse(readFileSync(r.out, 'utf8')) as TimelineFile;
  expect(t).toMatchObject({ v: 1, source: 'p.aup', fps: 18, size: [256, 192], frames: 90, skipped: [{ file: 'gone.bmp', objects: 1 }] });
  expect(t.sprites).toHaveLength(1);
  expect(t.sprites[0]).toMatchObject({
    file: 's.png', layer: 3, start: 0, end: 20, x: 1, y: -2, blend: 'add', kih: 1,
    sheet: { cols: 4, rows: 2, cellWidth: 20, cellHeight: 30 },
  });
  // fixture song: sections Verse 1 and Chorus
  expect(t.sections.map((s) => s.name)).toEqual(['Verse 1', 'Chorus']);
  expect(t.sections[0]).toMatchObject({ start: 9, end: 44, bar: 1 });
});

test('importAup stops on an unknown effect and says what to do', async () => {
  const aupFile = path.join(tmp, 'p.aup');
  writeFileSync(aupFile, buildAup({ objects: [{ layer: 1, start: 0, end: 5, effects: [{ type: '不明効果' }] }] }));
  const e = await importAup({ id: 'song', dir }, aupFile, []).catch((x) => x);
  expect(e).toBeInstanceOf(CliError);
  expect(e.problem.rule).toBe('aup');
  expect(e.message).toContain('object 0 (layer 1, frames 0-5): unknown object (effects: 不明効果)');
  expect(e.problem.fix).toContain('packages/aviutl');
});

test('importAup says when the file is not an aup', async () => {
  const aupFile = path.join(tmp, 'p.aup');
  writeFileSync(aupFile, 'hello');
  await expect(importAup({ id: 'song', dir }, aupFile, [])).rejects.toThrow(/not an AviUtl project/);
});
