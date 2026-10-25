// pve init <path> (DESIGN 8.2): make a project from a finished Lyric-Sync song folder.
// 1. A folder outside projects/ is copied to projects/<id>/ without its lyricsync/ cache. A folder already in
//    projects/ is used where it is.
// 2. The four input files must load (DESIGN 4.3).
// 3. video/ gets a storyboard video.json (one clip without a scene per section) and an empty treatment.md.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { foldText, resolveVideo, TimingData, validateVideo, type ResolvedVideo, type SongSection, type VideoJson } from '@pve/core';
import { loadSong } from '@pve/core/load';

/** A project id is a folder name: letters, digits, `_` and `-`, starting with a letter or digit. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface InitResult {
  id: string;
  dir: string;
  /** True when the song folder was copied into projects/. */
  copied: boolean;
  video: ResolvedVideo;
}

/**
 * Makes project `projects/<id>/` from the song folder `src` (`projectsDir` is the projects/ folder).
 * Throws with a message for the human when the folder is not a finished song or the project exists.
 */
export async function initProject(src: string, projectsDir: string): Promise<InitResult> {
  const from = path.resolve(src);
  if (!existsSync(from)) throw new Error(`no folder ${from}`);
  const id = path.basename(from);
  if (!ID_RE.test(id)) throw new Error(`the folder name '${id}' is not a project id (letters, digits, _ and -). Rename the song folder.`);
  const inside = path.resolve(path.dirname(from)) === path.resolve(projectsDir);
  const dir = inside ? from : path.join(projectsDir, id);
  const videoDir = path.join(dir, 'video');
  if (existsSync(path.join(videoDir, 'video.json'))) throw new Error(`projects/${id}/video/video.json exists: the project is already made`);

  // check the inputs in the source before copying anything
  const song = await loadSong(from);
  let copied = false;
  if (!inside) {
    if (existsSync(dir)) throw new Error(`projects/${id} exists. Remove it, or run pve init projects/${id} to use it as it is.`);
    const cache = path.join(from, 'lyricsync');
    cpSync(from, dir, { recursive: true, filter: (f) => path.resolve(f) !== cache });
    copied = true;
  }

  const video = storyboardVideo(song.prompt.songName ?? id, song.timing.sections);
  const checked = validateVideo(video);
  if (!checked.ok) throw new Error(`storyboard video.json is invalid: ${checked.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  const resolved = resolveVideo(checked.video, new TimingData(song.timing));
  mkdirSync(path.join(videoDir, 'scenes'), { recursive: true });
  mkdirSync(path.join(videoDir, 'assets'), { recursive: true });
  writeFileSync(path.join(videoDir, 'video.json'), JSON.stringify(video, null, 2) + '\n');
  writeFileSync(path.join(videoDir, 'treatment.md'), '');
  return { id, dir, copied, video: resolved };
}

/**
 * The storyboard edit: one clip without a scene per section, cut at the section start. A unique section name
 * becomes `section:<name>` (the cut follows the section when the human moves it in Lyric-Sync); a repeated
 * name cannot be told apart, so that clip starts at the section's time in seconds. The first clip starts at 0.
 */
export function storyboardVideo(title: string, sections: SongSection[]): VideoJson {
  const count = new Map<string, number>();
  for (const s of sections) count.set(foldText(s.name).trim(), (count.get(foldText(s.name).trim()) ?? 0) + 1);
  const ids = new Set<string>();
  const clips = sections.map((s, i) => {
    const unique = count.get(foldText(s.name).trim()) === 1;
    return { id: clipId(s.name, ids), at: i === 0 ? 0 : unique ? `section:${s.name}` : s.start, brief: `${s.name}.` };
  });
  if (!clips.length) clips.push({ id: 'song', at: 0, brief: 'The whole song (the song has no sections).' });
  return { v: 2, title, fps: 60, size: [1920, 1080], markers: {}, clips };
}

/** A unique clip id from a section name: `Verse 1` -> `verse_1`. */
function clipId(name: string, used: Set<string>): string {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'section';
  if (!/^[a-z_]/.test(base)) base = `s_${base}`;
  let id = base;
  for (let k = 2; used.has(id); k++) id = `${base}_${k}`;
  used.add(id);
  return id;
}
