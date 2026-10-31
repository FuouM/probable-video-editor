import { afterAll, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { at, coordinate, pointAt } from '../src/locate';
import { CliError } from '../src/out';
import { openView } from '../src/project';
import { makeProject } from './fixture';

const O = { syl: false, frames: false, max: 20 };

/** The fixture project with a lyric map: line 1's syllable `a` is a ghost, and the raw files name each line. */
function mapped() {
  const p = makeProject();
  const cal = path.join(p.dir, 'user_input/lyrics.calibrated.json');
  writeFileSync(cal, readFileSync(cal, 'utf8').replace('"sylText": ["a", "gain"]', '"sylText": ["(a)", "gain"]').replace('{\n  "sections"', '{\n  "fps": 60,\n  "sections"'));
  const map = {
    v: 1, song: 'fixture', calibrated: 'lyrics.calibrated.json', raw: { jp: 'lyrics.raw.jp.txt', en: 'lyrics.raw.en.txt' }, note: '', skip: [],
    lines: [
      { i: 0, r: 1, t: 'hello world', n: 3, jp: 'ハ ロ 世', en: [[0, 2, 'hello'], [2, 3, 'world']] },
      { i: 1, r: 2, t: 'sing again', n: 3, jp: '歌 _ 再', en: [[0, 1, 'sing'], [1, 3, 'again', '~']] },
    ],
  };
  writeFileSync(path.join(p.dir, 'user_input/lyrics.map.json'), JSON.stringify(map));
  writeFileSync(path.join(p.dir, 'user_input/lyrics.raw.jp.txt'), 'ハロ世\n歌再\n');
  writeFileSync(path.join(p.dir, 'user_input/lyrics.raw.en.txt'), 'hello world\nsing again\n');
  return p;
}

const withEdit = mapped();
const noEdit = mapped();
rmSync(path.join(noEdit.dir, 'video/video.json'));
afterAll(() => {
  withEdit.cleanup();
  noEdit.cleanup();
});
const v = await openView(withEdit.dir);

test('coordinates: bar, bar.beat, beat, frame, clock time, marker; a bar the song does not have is an error', () => {
  expect(coordinate(v, 'bar 2')).toBe(2.5);
  expect(coordinate(v, 'bar 2.3')).toBe(3.5);
  expect(coordinate(v, 'beat 3')).toBe(2);
  expect(coordinate(v, 'f90')).toBe(1.5);
  expect(coordinate(v, 'frame 90')).toBe(1.5);
  expect(coordinate(v, '1:00.5')).toBe(60.5);
  expect(coordinate(v, '@chorus')).toBe(2.5);
  expect(coordinate(v, 'hello')).toBeUndefined();
  expect(() => coordinate(v, 'bar 3')).toThrow(CliError);
});

test('a point inside a syllable: the glyph and the English phrase of that syllable', () => {
  const p = pointAt(v, 0.9, O);
  expect(p).toMatchObject({ t: 0.9, f: 54, bar: '1.1', sec: 'Verse 1', clip: 'verse' });
  expect(p.line).toMatchObject({ i: 0, jp: 'ハロ世', en: 'hello world' });
  expect(p.syl).toMatchObject({ k: 1, t: 'lo', jp: 'ロ', en: 'hello' });
});

test('a ghost syllable has no glyph; a loose English phrase says so', () => {
  expect(pointAt(v, 3.1, O).syl).toMatchObject({ k: 1, t: '(a)', jp: null, ghost: 1, en: 'again', loose: 1 });
});

test('between lines, the point names the line before and the line after with their distance', () => {
  const p = pointAt(v, 2.2, O);
  expect(p.line).toBeUndefined();
  expect(p.gap).toEqual({ prev: { line: 0, end: 1.98, d: -0.22 }, next: { line: 1, start: 2.51, d: 0.31 } });
});

test('text is found in the Japanese and the English, at the glyph or phrase that holds it', () => {
  const jp = at(v, 'ロ', O);
  expect(jp.map((r) => [r.kind, r.t])).toEqual([['jp', 0.8]]);
  const en = at(v, 'again', O);
  expect(en.map((r) => [r.kind, r.t])).toEqual([['line', 2.51], ['word', 3], ['en', 3]]);
  expect(at(v, 'again#2', O).map((r) => r.kind)).toEqual(['en']);
});

test('a range gives its length in seconds, frames, bars and beats, and the lines inside it', () => {
  const [r] = at(v, 'bar 1..2', O);
  expect(r).toMatchObject({ dur: 2, frames: 120, bars: 1, beats: 4 });
  expect((r!.lines as { i: number }[]).map((l) => l.i)).toEqual([0]);
  expect(() => at(v, 'bar 2..1', O)).toThrow(CliError);
});

test('--syl lists syllables, glyph units and phrases with their times; --frames writes those times as frames', () => {
  const line = pointAt(v, 3.1, { ...O, syl: true, frames: true }).line as Record<string, unknown[]>;
  expect(line.syl).toEqual([[0, 'sing', 151, 180], [1, '(a)', 180, 195, 'ghost'], [2, 'gain', 195, 234]]);
  expect(line.jpu).toEqual([['歌', 0, 1, 151, 180], ['再', 2, 3, 195, 234]]);
  expect(line.enp).toEqual([['sing', 0, 1, 151, 180], ['again', 1, 3, 180, 234, '~']]);
});

test('a song folder without video/video.json works: no clips, the frame rate comes from the calibrated lyrics', async () => {
  const bare = await openView(noEdit.dir);
  expect(bare.resolved).toEqual({ fps: 60, markers: {}, clips: [] });
  expect(pointAt(bare, 0.9, O).clip).toBeUndefined();
});

test('a raw file that changed after the map was written is an error that names the map', async () => {
  const raw = path.join(noEdit.dir, 'user_input/lyrics.raw.jp.txt');
  writeFileSync(raw, 'ハロ世\n歌猫\n');
  await expect(openView(noEdit.dir)).rejects.toMatchObject({ problem: { rule: 'lyric-map', at: 'lines[1].jp' } });
});
