// `/api/project/<id>/notes[/<note>]` (no id: PVE_PROJECT): the markdown notes of the studio notes panel, in
// video/notes/<note>.md. GET lists them (newest first), POST `{ id, content }` writes one, DELETE removes one.
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { NOTES_DIR, readNoteFiles } from '@pve/core/notefiles';
import { projectDir } from '@pve/core/projects';
import { errorText, json, readBody, routeProject, type ApiHandler } from './api';

const NOTES_ROUTE = /^\/api\/project(?:\/([^/?#]*))?\/notes(?:\/([^/?#]+))?(?:[?#].*)?$/;

export const notesApi: ApiHandler = async (req, res, url) => {
  const m = NOTES_ROUTE.exec(url);
  if (!m) return false;
  const id = routeProject(m[1]);
  const noteId = m[2] ? decodeURIComponent(m[2]) : null;
  if (!id) {
    json(res, { error: 'no project id' }, 400);
    return true;
  }
  const dir = projectDir(id);
  const notesDir = path.join(dir, NOTES_DIR);

  if (req.method === 'DELETE' && noteId) {
    const file = path.join(notesDir, `${noteId}.md`);
    if (existsSync(file)) unlinkSync(file);
    json(res, { ok: true, deleted: noteId });
    return true;
  }

  if (req.method === 'GET') {
    const notes = readNoteFiles(dir).sort((a, b) => b.mtime - a.mtime);
    json(res, { ok: true, notes, notesDir: `projects/${id}/${NOTES_DIR}` });
    return true;
  }

  if (req.method === 'POST') {
    try {
      const data = JSON.parse(await readBody(req)) as { id?: string; content: string };
      if (!data.id || typeof data.id !== 'string') {
        json(res, { error: 'note id required' }, 400);
        return true;
      }
      if (!existsSync(notesDir)) mkdirSync(notesDir, { recursive: true });
      writeFileSync(path.join(notesDir, `${data.id}.md`), typeof data.content === 'string' ? data.content : '', 'utf8');
      json(res, { ok: true, id: data.id, savedAt: Date.now() });
    } catch (err) {
      json(res, { error: errorText(err) }, 500);
    }
    return true;
  }
  return false;
};
