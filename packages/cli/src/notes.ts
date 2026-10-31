// pve notes (DESIGN 8.1 step 7): the director notes in video/notes.json. A project without the file has no
// notes yet.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateNotes, type Note, type NotesJson } from '@pve/core';
import { CliError, fmtBarBeat, fmtTime, table } from './out';
import { clipAt, type Project, type ProjectRef } from './project';

export const NOTES_FILE = 'video/notes.json';

/** Reads and validates video/notes.json. Throws a CliError with the JSON path of the first error. */
export function readNotes(ref: ProjectRef): NotesJson {
  const file = path.join(ref.dir, NOTES_FILE);
  if (!existsSync(file)) return { v: 1, notes: [] };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new CliError({ rule: 'json', file: NOTES_FILE, message: e instanceof Error ? e.message : String(e), fix: 'make the file valid JSON' });
  }
  const r = validateNotes(json);
  if (!r.ok) throw new CliError({ rule: 'schema', file: NOTES_FILE, at: r.errors[0]!.path, message: r.errors.map((e) => `${e.path}: ${e.message}`).join('; '), fix: 'fix the note, or let the studio write the file' });
  return r.notes;
}

/** Marks note `id` resolved and writes the file. Returns the note. */
export function resolveNote(ref: ProjectRef, id: string, now = new Date()): Note {
  const doc = readNotes(ref);
  const note = doc.notes.find((n) => n.id === id);
  if (!note) throw new CliError({ rule: 'note', file: NOTES_FILE, message: `no note '${id}'`, fix: `pve notes --all lists the ids (${doc.notes.map((n) => n.id).join(', ') || 'no notes'})` });
  if (note.resolved) throw new CliError({ rule: 'note', file: NOTES_FILE, message: `note '${id}' is resolved since ${note.resolved}` });
  note.resolved = now.toISOString();
  writeFileSync(path.join(ref.dir, NOTES_FILE), JSON.stringify(doc, null, 2) + '\n');
  return note;
}


function parseTimeStr(s: string): number {
  const parts = s.split(':').map(Number);
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  return Number(s) || 0;
}

/** Reads markdown review notes from video/notes/*.md (pvemd code blocks and descriptions). */
export function readMarkdownNotes(ref: ProjectRef): Note[] {
  const notesDir = path.join(ref.dir, 'video/notes');
  if (!existsSync(notesDir)) return [];
  let files: string[] = [];
  try {
    files = readdirSync(notesDir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  const out: Note[] = [];
  for (const f of files) {
    const fileId = path.basename(f, '.md');
    let content = '';
    try {
      content = readFileSync(path.join(notesDir, f), 'utf8');
    } catch {
      continue;
    }
    const regex = /```pvemd\s*([\s\S]*?)```([\s\S]*?)(?=(?:```pvemd|$))/g;
    let match: RegExpExecArray | null;
    let idx = 1;
    while ((match = regex.exec(content)) !== null) {
      try {
        const meta = JSON.parse(match[1]!) as {
          note?: string;
          time?: string;
          seconds?: number;
          clip?: string;
          rect?: [number, number, number, number];
        };
        const text = match[2]!
          .trim()
          .replace(/^[-*]\s*/gm, '')
          .replace(/\n+/g, ' ')
          .trim() || meta.note || fileId;
        const t = meta.seconds ?? (meta.time ? parseTimeStr(meta.time) : 0);
        out.push({
          id: `${fileId}#${idx++}`,
          t,
          clip: meta.clip || 'unknown',
          at: meta.rect ? [meta.rect[0], meta.rect[1]] : undefined,
          text,
          created: new Date().toISOString(),
        });
      } catch {
        // ignore malformed code block
      }
    }
  }
  return out;
}

/** Reads all notes from video/notes.json and video/notes/*.md. */
export function readProjectNotes(ref: ProjectRef): Note[] {
  return [...readNotes(ref).notes, ...readMarkdownNotes(ref)];
}
export interface NoteRow extends Note {
  barBeat: string;
  /** The clip on screen at `t` in the edit now (the edit can move after the note was made). */
  clipNow: string;
}

export function noteRows(p: Project, notes: Note[]): NoteRow[] {
  return [...notes].sort((a, b) => a.t - b.t).map((n) => ({ ...n, barBeat: fmtBarBeat(p.timing, n.t), clipNow: clipAt(p, n.t)?.id ?? '-' }));
}

export function formatNotes(rows: NoteRow[]): string {
  if (!rows.length) return 'no notes';
  return table(
    rows.map((n) => [
      n.id,
      fmtTime(n.t),
      n.barBeat,
      n.clipNow === n.clip ? n.clip : `${n.clipNow} (made on ${n.clip})`,
      n.at ? `${Math.round(n.at[0])},${Math.round(n.at[1])}` : 'frame',
      n.resolved ? 'resolved' : 'open',
      n.text,
    ]),
    ['id', 'time', 'bar', 'clip', 'x,y', 'state', 'text'],
  );
}
