// The static site (vite.site.config.ts) plays a snapshot of the project inputs (site-data.ts) because the
// build has no Lyric-Sync. This file hashes the files the snapshot is made from, so the build can refuse a
// snapshot that is older than them. Plain node: no lyricsync import.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Files of a project folder that `projectInputs` (inputs.ts) reads, and the folders it reads whole. */
const FILES = ['video/video.json', 'generated/timing.ai.json', 'generated/features.json', 'user_input/lyrics.calibrated.json'];
const TREES = ['video/assets'];

export interface SiteManifest {
  project: string;
  /** Project-relative path -> SHA-256 of the file the snapshot was made from. */
  sources: Record<string, string>;
  /**
   * The mix, encoded as MP3. The file is not in git: it is a release asset (`release` is its tag, `file` its
   * name) that CI downloads, and `sha256` ties it to this snapshot.
   */
  audio: { file: string; duration: number; sha256: string; release: string };
}

/** The folder of the snapshot of project `dir`: inputs.json and manifest.json (and the local copy of the MP3). */
export const siteDir = (dir: string) => path.join(dir, 'site');

function walk(root: string, rel: string, out: string[]) {
  for (const e of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(root, r, out);
    else if (e.isFile()) out.push(r);
  }
}

/** SHA-256 of every source file of project `dir`, by project-relative path. */
export function sourceHashes(dir: string): Record<string, string> {
  const files = [...FILES];
  for (const t of TREES) if (existsSync(path.join(dir, t))) walk(dir, t, files);
  const out: Record<string, string> = {};
  // text files, hashed with LF line endings: a Windows checkout (autocrlf) and the CI's must give the same hash
  for (const f of files.sort()) out[f] = createHash('sha256').update(readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  return out;
}

/** The paths whose hash differs between the manifest and the files now (added, removed or changed). */
export function staleSources(dir: string, manifest: SiteManifest): string[] {
  const now = sourceHashes(dir);
  const all = new Set([...Object.keys(now), ...Object.keys(manifest.sources)]);
  return [...all].filter((f) => now[f] !== manifest.sources[f]).sort();
}
