// Project folders: projects/<id>/ (a Lyric-Sync song folder plus video/). Reads the file system (node:fs) and imports
// nothing else: the CI scripts (app/scripts/site-assets.ts) use it without Lyric-Sync.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** The root of this repository. */
export const REPO = path.resolve(import.meta.dirname, '../../..');
/** projects/ of this repository. */
export const PROJECTS = path.join(REPO, 'projects');
export const VIDEO_FILE = 'video/video.json';
/** A project id is a folder name: letters, digits, `_` and `-`. */
export const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Ids of the folders in projects/ that have the file `needs` (the edit by default), sorted. */
export function listProjects(needs = VIDEO_FILE): string[] {
  if (!existsSync(PROJECTS)) return [];
  return readdirSync(PROJECTS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(PROJECTS, d.name, needs)))
    .map((d) => d.name)
    .sort();
}

/** The folder of project `id`. Throws on a bad id or a missing project, with the list of projects. */
export function projectDir(id: string): string {
  if (!PROJECT_ID_RE.test(id)) throw new Error(`bad project id '${id}'`);
  const dir = path.join(PROJECTS, id);
  if (!existsSync(path.join(dir, VIDEO_FILE))) {
    throw new Error(`no project '${id}' (projects/${id}/${VIDEO_FILE}). Projects: ${listProjects().join(', ') || 'none'}`);
  }
  return dir;
}
