// Project folders: projects/<id>/ (a Lyric-Sync song folder plus video/), for the Vite config (the
// /api/project route).
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const REPO = path.resolve(import.meta.dirname, '../..');
export const PROJECTS = path.join(REPO, 'projects');
/** A project id is a folder name: letters, digits, `_` and `-`. */
export const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Ids of the folders in projects/ that have video/video.json. */
export function listProjects(): string[] {
  if (!existsSync(PROJECTS)) return [];
  return readdirSync(PROJECTS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(PROJECTS, d.name, 'video/video.json')))
    .map((d) => d.name)
    .sort();
}

/** The folder of project `id`. Throws on a bad id or a missing project, with the list of projects. */
export function projectDir(id: string): string {
  if (!PROJECT_ID_RE.test(id)) throw new Error(`bad project id '${id}'`);
  const dir = path.join(PROJECTS, id);
  if (!existsSync(path.join(dir, 'video/video.json'))) {
    throw new Error(`no project '${id}' (projects/${id}/video/video.json). Projects: ${listProjects().join(', ') || 'none'}`);
  }
  return dir;
}
