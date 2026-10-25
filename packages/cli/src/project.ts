// The project of a command and its loaded inputs.
// A command finds its project from `--project <id|path>`, else PVE_PROJECT, else the current folder or the
// nearest folder above it that has video/video.json.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAnchor, resolveVideo, ResolveError, TimingData, validateVideo, type ResolvedClip, type ResolvedVideo, type VideoJson } from '@pve/core';
import { loadSong, type Song } from '@pve/core/load';
import { CliError, type Problem } from './out';

/** projects/ of this repository. */
export const PROJECTS = path.resolve(import.meta.dir, '../../../projects');
export const VIDEO_FILE = 'video/video.json';
export const SCENES_DIR = 'video/scenes';

export interface ProjectRef {
  /** The folder name. */
  id: string;
  dir: string;
}

/** Ids of the folders in projects/ that have video/video.json. */
export function listProjects(projectsDir = PROJECTS): string[] {
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(projectsDir, d.name, VIDEO_FILE)))
    .map((d) => d.name)
    .sort();
}

/** Finds the project folder. Throws a CliError that lists the projects when there is none. */
export function findProject(arg: string | undefined, cwd = process.cwd(), env = process.env.PVE_PROJECT): ProjectRef {
  const fix = `pass --project <id> (projects: ${listProjects().join(', ') || 'none'}), or run pve init <song folder>`;
  const given = arg ?? env;
  if (given) {
    for (const dir of [path.resolve(cwd, given), path.join(PROJECTS, given)]) {
      if (existsSync(path.join(dir, VIDEO_FILE))) return { id: path.basename(dir), dir };
    }
    throw new CliError({ rule: 'project', message: `no project '${given}': no ${VIDEO_FILE} in ${path.resolve(cwd, given)} or projects/${given}`, fix });
  }
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, VIDEO_FILE))) return { id: path.basename(dir), dir };
    if (path.dirname(dir) === dir) break;
  }
  throw new CliError({ rule: 'project', message: `no project in ${cwd}`, fix });
}

/** A project with its song loaded and its edit resolved. */
export interface Project extends ProjectRef {
  song: Song;
  timing: TimingData;
  video: VideoJson;
  resolved: ResolvedVideo;
}

/** Fix text for each resolve error code. */
const RESOLVE_FIX: Record<string, string> = {
  SYNTAX_ERROR: 'write the expression as Target[@snap][+offset...], for example lyric:foom@beat<= or bar:12+2b',
  AMBIGUOUS_QUERY: 'add #n (0-based) to pick one match. pve find <text> prints each match with its expression',
  UNRESOLVED_ANCHOR: 'pve find <text> prints the lyrics, words, sections, markers and clips that exist',
  TOLERANCE_EXCEEDED: 'use @beat~ (nearest beat) or a larger :tol=, or remove the snap',
  CIRCULAR_REFERENCE: 'make one of the values in the cycle a time that does not refer back',
};

/**
 * Loads the song and the edit. Every failure becomes problems (never an exception), so `pve check` can
 * report them. `project` is undefined when the inputs or the edit do not load.
 */
export async function loadProject(ref: ProjectRef): Promise<{ project?: Project; problems: Problem[] }> {
  let song: Song;
  try {
    song = await loadSong(ref.dir);
  } catch (e) {
    return { problems: [{ severity: 'error', rule: 'song-input', message: String(e instanceof Error ? e.message : e), fix: 'finish the song in Lyric-Sync (DESIGN 4.3), then copy it again' }] };
  }
  let timing: TimingData;
  try {
    timing = new TimingData(song.timing);
  } catch (e) {
    return { problems: [{ severity: 'error', rule: 'song-input', file: 'generated/timing.ai.json', message: String(e instanceof Error ? e.message : e), fix: 'run the beat tracking again in Lyric-Sync' }] };
  }

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path.join(ref.dir, VIDEO_FILE), 'utf8'));
  } catch (e) {
    return { problems: [{ severity: 'error', rule: 'json', file: VIDEO_FILE, message: String(e instanceof Error ? e.message : e), fix: 'make the file valid JSON' }] };
  }
  const checked = validateVideo(json);
  if (!checked.ok) {
    return {
      problems: checked.errors.map((e) => ({ severity: 'error', rule: 'schema', file: VIDEO_FILE, at: e.path, message: e.message, fix: 'see the video.json format in skills/pve/SKILL.md' })),
    };
  }
  let resolved: ResolvedVideo;
  try {
    resolved = resolveVideo(checked.video, timing);
  } catch (e) {
    if (!(e instanceof ResolveError)) throw e;
    const message = e.path ? e.message.slice(e.path.length + 2) : e.message;
    return { problems: [{ severity: 'error', rule: 'expression', file: VIDEO_FILE, at: e.path, message, fix: RESOLVE_FIX[e.code] }] };
  }
  return { project: { ...ref, song, timing, video: checked.video, resolved }, problems: [] };
}

/** Loads the project or throws a CliError with its first problem. For commands that need a valid project. */
export async function openProject(arg: string | undefined): Promise<Project> {
  const { project, problems } = await loadProject(findProject(arg));
  if (!project) throw new CliError({ ...problems[0]!, message: `${problems[0]!.message} (pve check lists every problem)` });
  return project;
}

/** Seconds of a number or a time expression of the project. Throws a CliError that says how to find one. */
export function timeOf(p: Project, expr: string): number {
  const r = p.resolved;
  try {
    return resolveAnchor(expr.trim() !== '' && !Number.isNaN(Number(expr)) ? Number(expr) : expr, {
      timing: p.timing,
      fps: r.fps,
      marker: (name) => {
        const t = r.markers[name];
        if (t === undefined) throw new ResolveError('UNRESOLVED_ANCHOR', `Marker "@${name}" not defined`);
        return t;
      },
      clipEdge: (id, edge) => {
        const c = r.clips.find((x) => x.id === id);
        if (!c) throw new ResolveError('UNRESOLVED_ANCHOR', `Clip "${id}" not found`);
        return c[edge];
      },
    });
  } catch (e) {
    if (!(e instanceof ResolveError)) throw e;
    throw new CliError({ rule: 'expression', message: `'${expr}': ${e.message}`, fix: RESOLVE_FIX[e.code] });
  }
}

/** The clip on screen at t: the last clip that starts at or before t. Undefined before the first clip. */
export function clipAt(p: Project, t: number): ResolvedClip | undefined {
  return [...p.resolved.clips].reverse().find((c) => c.start <= t + 1e-9);
}

/** The dev server serves projects/<id>/ only: commands that render need the project there. */
export function servedId(ref: ProjectRef): string {
  if (path.resolve(ref.dir) !== path.join(PROJECTS, ref.id)) {
    throw new CliError({ rule: 'project', message: `${ref.dir} is not in projects/: the renderer loads projects/<id>/ only`, fix: `copy the song folder with pve init ${ref.dir}` });
  }
  return ref.id;
}
