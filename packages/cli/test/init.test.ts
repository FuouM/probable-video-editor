import { afterEach, beforeEach, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initProject, storyboardVideo } from '../src/init';

const FIXTURE = path.join(import.meta.dir, '../../core/test/fixtures/song');
let tmp = '', projects = '', song = '';

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'pve-init-'));
  projects = path.join(tmp, 'projects');
  mkdirSync(projects);
  // a finished song folder outside projects/, with a Lyric-Sync cache
  song = path.join(tmp, 'songs', 'my_song');
  cpSync(FIXTURE, song, { recursive: true });
  mkdirSync(path.join(song, 'lyricsync'));
  writeFileSync(path.join(song, 'lyricsync', 'cache.bin'), 'x');
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

test('copies the song without lyricsync/ and writes one storyboard clip per section', async () => {
  const r = await initProject(song, projects);
  const dir = path.join(projects, 'my_song');
  expect(r).toMatchObject({ id: 'my_song', dir, copied: true });
  expect(existsSync(path.join(dir, 'user_input/lyrics.calibrated.json'))).toBe(true);
  expect(existsSync(path.join(dir, 'lyricsync'))).toBe(false);
  const video = JSON.parse(readFileSync(path.join(dir, 'video/video.json'), 'utf8'));
  expect(video.title).toBe('Loader fixture');
  expect(video.clips).toEqual([
    { id: 'verse_1', at: 0, brief: 'Verse 1.' },
    { id: 'chorus', at: 'section:Chorus', brief: 'Chorus.' },
  ]);
  expect(r.video.clips.map((c) => [c.id, c.start, c.end])).toEqual([['verse_1', 0, 2.5], ['chorus', 2.5, 4.2]]);
  expect(readFileSync(path.join(dir, 'video/treatment.md'), 'utf8')).toBe('');
});

test('uses a folder in projects/ where it is, and refuses to make a project twice', async () => {
  const inside = path.join(projects, 'my_song');
  cpSync(song, inside, { recursive: true });
  const r = await initProject(inside, projects);
  expect(r.copied).toBe(false);
  // the cache of a folder used in place is not touched
  expect(existsSync(path.join(inside, 'lyricsync/cache.bin'))).toBe(true);
  await expect(initProject(inside, projects)).rejects.toThrow('video/video.json exists');
});

test('refuses to copy over an existing projects/<id>', async () => {
  mkdirSync(path.join(projects, 'my_song'));
  await expect(initProject(song, projects)).rejects.toThrow('projects/my_song exists');
});

test('a song with a missing input file is not copied, and the error names the file', async () => {
  rmSync(path.join(song, 'generated/features.json'));
  await expect(initProject(song, projects)).rejects.toThrow('features.json');
  expect(existsSync(path.join(projects, 'my_song'))).toBe(false);
});

test('a repeated section name starts at its time in seconds, and clip ids stay unique', () => {
  const v = storyboardVideo('t', [
    { name: 'Intro', start: 0.2, end: 1 },
    { name: 'Chorus', start: 1, end: 2 },
    { name: '2nd verse', start: 2, end: 3 },
    { name: 'Chorus', start: 3, end: 4 },
  ]);
  expect(v.clips).toEqual([
    { id: 'intro', at: 0, brief: 'Intro.' },
    { id: 'chorus', at: 1, brief: 'Chorus.' },
    { id: 's_2nd_verse', at: 'section:2nd verse', brief: '2nd verse.' },
    { id: 'chorus_2', at: 3, brief: 'Chorus.' },
  ]);
});
