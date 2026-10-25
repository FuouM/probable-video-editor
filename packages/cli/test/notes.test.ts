import { afterEach, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateNotes } from '@pve/core';
import { checkProject } from '../src/check';
import { noteRows, readNotes, resolveNote } from '../src/notes';
import { openProject } from '../src/project';
import { makeProject } from './fixture';

let cleanup = () => {};
afterEach(() => cleanup());

const NOTES = {
  v: 1,
  notes: [
    { id: 'n2', t: 3.1, clip: 'chorus', text: 'Louder on the hit.', created: '2026-10-21T10:00:00Z' },
    { id: 'n1', t: 1.0, at: [960, 540], clip: 'intro', text: 'The ring is off centre.', created: '2026-10-21T09:00:00Z' },
    { id: 'n0', t: 0.2, clip: 'intro', text: 'Done before.', created: '2026-10-20T09:00:00Z', resolved: '2026-10-20T12:00:00Z' },
  ],
};

function project(notes: unknown) {
  const p = makeProject();
  cleanup = p.cleanup;
  writeFileSync(path.join(p.dir, 'video/notes.json'), typeof notes === 'string' ? notes : JSON.stringify(notes));
  return p.dir;
}

test('validateNotes reports duplicate ids, bad times and positions by path', () => {
  const r = validateNotes({ v: 1, notes: [NOTES.notes[0], { ...NOTES.notes[1], id: 'n2', t: -1, at: [1] }] });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors.map((e) => e.path)).toEqual(['notes[1].id', 'notes[1].t', 'notes[1].at']);
  expect(validateNotes(NOTES).ok).toBe(true);
});

test('rows are in time order with the clip on screen now; a note made on a clip that moved names both', async () => {
  const dir = project(NOTES);
  const p = await openProject(dir);
  const rows = noteRows(p, readNotes(p).notes.filter((n) => !n.resolved));
  // the fixture edit: intro 0-0.52, verse 0.52-2.5, chorus 2.5-4.2
  expect(rows.map((r) => [r.id, r.clip, r.clipNow, r.barBeat])).toEqual([['n1', 'intro', 'verse', '1.2'], ['n2', 'chorus', 'chorus', '2.2']]);
});

test('resolve marks the note and writes the file; resolving twice or an unknown id fails', () => {
  const dir = project(NOTES);
  const ref = { id: 'song', dir };
  resolveNote(ref, 'n1', new Date('2026-10-21T11:00:00Z'));
  const doc = JSON.parse(readFileSync(path.join(dir, 'video/notes.json'), 'utf8'));
  expect(doc.notes.find((n: { id: string }) => n.id === 'n1').resolved).toBe('2026-10-21T11:00:00.000Z');
  expect(() => resolveNote(ref, 'n1')).toThrow('is resolved');
  expect(() => resolveNote(ref, 'nope')).toThrow("no note 'nope'");
});

test('pve check reports an invalid notes file', async () => {
  const dir = project({ v: 1, notes: [{ id: 'x', t: 1, clip: 'intro', text: '', created: 'now' }] });
  const r = await checkProject({ id: 'song', dir });
  expect(r.problems.map((x) => [x.rule, x.file, x.at])).toEqual([['schema', 'video/notes.json', 'notes[0].text']]);
});
