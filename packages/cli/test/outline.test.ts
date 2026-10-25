import { afterAll, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAnchor } from '@pve/core';
import { find, outline } from '../src/outline';
import { openProject } from '../src/project';
import { makeProject, VIDEO } from './fixture';

const p = makeProject({ ...VIDEO, markers: { ...VIDEO.markers, hello: { at: 'word:hello' } }, clips: [...VIDEO.clips.slice(0, 2), { id: 'again', at: 'lyric:again', brief: 'Sing it again.' }] });
afterAll(() => p.cleanup());
// the second line also says "world": a line query for it matches twice
const lyricsFile = path.join(p.dir, 'user_input/lyrics.calibrated.json');
writeFileSync(lyricsFile, readFileSync(lyricsFile, 'utf8').replace('"text": "sing again"', '"text": "sing again, world"'));
const project = await openProject(p.dir);

test('outline gives resolved clips with their expressions, sections, lines and the meter', () => {
  const o = outline(project);
  expect(o.beatsPerBar).toBe(4);
  expect(o.clips.map((c) => [c.id, c.at, c.start, c.end, c.barBeat])).toEqual([
    ['intro', 0, 0, 0.52, '0.1'],
    ['verse', 'lyric:hello', 0.52, 2.51, '1.1'],
    ['again', 'lyric:again', 2.51, 4.2, '2.1'],
  ]);
  expect(o.sections.map((s) => s.name)).toEqual(['Verse 1', 'Chorus']);
  expect(o.lines.map((l) => [l.text, l.start, l.end])).toEqual([['hello world', 0.52, 1.98], ['sing again, world', 2.51, 3.9]]);
});

test('every expression find prints resolves to the time it shows', () => {
  const r = project.resolved;
  const ctx = { timing: project.timing, fps: 60, marker: (n: string) => r.markers[n]!, clipEdge: (id: string, e: 'start' | 'end') => r.clips.find((c) => c.id === id)![e] };
  const hits = ['hello', 'again', 'a', 'chorus', 'o', 'world'].flatMap((q) => find(project, q));
  expect(hits.length).toBeGreaterThan(0);
  for (const h of hits) expect(resolveAnchor(h.expr, ctx)).toBeCloseTo(h.t, 9);
});

test('find lists every kind that matches, with #n when the query matches more than once', () => {
  expect(find(project, 'again').map((h) => [h.kind, h.expr])).toEqual([
    ['line', 'lyric:again'],
    ['word', 'word:again'],
    ['clip', 'clip:again.start'],
  ]);
  // "hello" is a marker name, a word and in a line; the marker is the word
  expect(find(project, 'hello').map((h) => h.kind)).toEqual(['line', 'word', 'marker']);
  // "world" is in both lines (#0 and #1) and is one word (no #n)
  expect(find(project, 'world').map((h) => [h.kind, h.expr])).toEqual([['line', 'lyric:world#0'], ['line', 'lyric:world#1'], ['word', 'word:world'], ['syl', 'syl:world']]);
  expect(find(project, 'zzz')).toEqual([]);
});
