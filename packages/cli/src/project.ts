// The project of a command and its loaded inputs.
// A command finds its project from `--project <id|path>`, else PVE_PROJECT, else the current folder or the
// nearest folder above it that has video/video.json.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { checkLyricMap, LyricMap, resolveAnchor, resolveVideo, ResolveError, TimingData, validateVideo, type ResolvedClip, type ResolvedVideo, type VideoJson } from '@pve/core';
import { LYRIC_MAP_FILE, loadSong, type Song } from '@pve/core/load';
import { CliError, type Problem } from './out';

/** projects/ of this repository. */
export const PROJECTS = path.resolve(import.meta.dir, '../../../projects');
export const VIDEO_FILE = 'video/video.json';
/** A song folder that Lyric-Sync finished has this file. The locator commands work on it without an edit. */
export const SONG_FILE = 'user_input/lyrics.calibrated.json';
export const SCENES_DIR = 'video/scenes';

export interface ProjectRef {
  /** The folder name. */
  id: string;
  dir: string;
}

/** Ids of the folders in projects/ that have the file `needs` (the edit by default). */
export function listProjects(projectsDir = PROJECTS, needs = VIDEO_FILE): string[] {
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(projectsDir, d.name, needs)))
    .map((d) => d.name)
    .sort();
}

/** Finds the project folder: the one with the file `needs`. Throws a CliError that lists the projects when there is none. */
export function findProject(arg: string | undefined, cwd = process.cwd(), env = process.env.PVE_PROJECT, needs = VIDEO_FILE): ProjectRef {
  const fix = `pass --project <id> (projects: ${listProjects(PROJECTS, needs).join(', ') || 'none'}), or run pve init <song folder>`;
  const given = arg ?? env;
  if (given) {
    for (const dir of [path.resolve(cwd, given), path.join(PROJECTS, given)]) {
      if (existsSync(path.join(dir, needs))) return { id: path.basename(dir), dir };
    }
    throw new CliError({ rule: 'project', message: `no project '${given}': no ${needs} in ${path.resolve(cwd, given)} or projects/${given}`, fix });
  }
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, needs))) return { id: path.basename(dir), dir };
    if (path.dirname(dir) === dir) break;
  }
  throw new CliError({ rule: 'project', message: `no project in ${cwd}`, fix });
}

/** A song with its beat grid and lyrics, and the edit when the project has one. What the locator commands need. */
export interface View extends ProjectRef {
  song: Song;
  timing: TimingData;
  /** The lyric map joined with the calibrated lyrics. Undefined when the song has no lyrics.map.json. */
  lyrics?: LyricMap;
  /** The resolved edit. A song folder without video/video.json has no markers and no clips. */
  resolved: Pick<ResolvedVideo, 'fps' | 'markers' | 'clips'>;
}

/** A project with its song loaded and its edit resolved. */
export interface Project extends View {
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

interface Inputs { song: Song; timing: TimingData; lyrics?: LyricMap }

/** Loads the song, its beat grid and its lyric map. Every failure becomes problems. */
async function loadInputs(ref: ProjectRef): Promise<{ inputs?: Inputs; problems: Problem[] }> {
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
  let lyrics: LyricMap | undefined;
  if (song.lyricMap) {
    const bad = checkLyricMap(song.lyricMap.doc, song.timing, song.lyricMap.raw);
    if (bad.length) {
      return { problems: bad.map((p) => ({ severity: 'error' as const, rule: 'lyric-map', file: `user_input/${LYRIC_MAP_FILE}`, at: p.at, message: p.message, fix: 'edit the map by hand to fit the calibrated lyrics and the raw files (docs/LYRICMAP.md)' })) };
    }
    lyrics = new LyricMap(song.lyricMap.doc, song.timing);
  }
  return { inputs: { song, timing, lyrics }, problems: [] };
}

/**
 * Loads the song and the edit. Every failure becomes problems (never an exception), so `pve check` can
 * report them. `project` is undefined when the inputs or the edit do not load.
 */
export async function loadProject(ref: ProjectRef): Promise<{ project?: Project; problems: Problem[] }> {
  const { inputs, problems: inputProblems } = await loadInputs(ref);
  if (!inputs) return { problems: inputProblems };
  const { song, timing, lyrics } = inputs;

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
  return { project: { ...ref, song, timing, lyrics, video: checked.video, resolved }, problems: [] };
}

/** Loads the project or throws a CliError with its first problem. For commands that need a valid project. */
export async function openProject(arg: string | undefined): Promise<Project> {
  const { project, problems } = await loadProject(findProject(arg));
  if (!project) throw new CliError({ ...problems[0]!, message: `${problems[0]!.message} (pve check lists every problem)` });
  return project;
}

/**
 * The song of a project, with its edit when video/video.json exists. A song folder that Lyric-Sync finished
 * works without an edit. Throws a CliError with the first problem.
 */
export async function openView(arg: string | undefined): Promise<View> {
  const ref = findProject(arg, process.cwd(), process.env.PVE_PROJECT, SONG_FILE);
  if (existsSync(path.join(ref.dir, VIDEO_FILE))) return openProject(ref.dir);
  const { inputs, problems } = await loadInputs(ref);
  if (!inputs) throw new CliError({ ...problems[0]!, message: `${problems[0]!.message} (pve check lists every problem)` });
  const fps = inputs.song.lyrics.fps;
  if (typeof fps !== 'number') throw new CliError({ rule: 'song-input', file: SONG_FILE, message: 'the calibrated lyrics have no "fps"', fix: 'save the song again in Lyric-Sync' });
  return { ...ref, ...inputs, resolved: { fps, markers: {}, clips: [] } };
}

/** Seconds of a number or a time expression of the project. Throws a CliError that says how to find one. */
export function timeOf(p: View, expr: string): number {
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
export function clipAt(p: View, t: number): ResolvedClip | undefined {
  return [...p.resolved.clips].reverse().find((c) => c.start <= t + 1e-9);
}

/**
 * The times of `specs`. A time or expression gives one time. `a..b` gives a, a+step, a+2 step, up to b
 * (both ends can be expressions), or `{ n }` times spread evenly from a to b, both ends included. Throws a
 * CliError when there are more than `max` times.
 */
export function expandTimes(p: View, specs: string[], spread: number | { n: number }, max = Infinity): number[] {
  const times = specs.flatMap((x) => {
    const i = x.indexOf('..');
    if (i < 0) return [timeOf(p, x)];
    const t0 = timeOf(p, x.slice(0, i)), t1 = timeOf(p, x.slice(i + 2));
    if (t1 < t0) throw new CliError({ rule: 'range', message: `'${x}' ends before it starts (${t1} < ${t0})`, fix: 'write the range as from..to with from <= to' });
    if (typeof spread === 'object') return spread.n <= 1 ? [t0] : Array.from({ length: spread.n }, (_, k) => t0 + ((t1 - t0) * k) / (spread.n - 1));
    return Array.from({ length: Math.floor((t1 - t0) / spread + 1e-6) + 1 }, (_, k) => t0 + k * spread);
  });
  if (times.length > max) throw new CliError({ rule: 'range', message: `${times.length} times: more than ${max}`, fix: 'give a larger --step or a shorter range' });
  return times;
}

/** `count` times from the start to the end of the Over transition `id`, both ends included. */
export function transitionTimes(p: Project, id: string, count: number): number[] {
  const tr = p.resolved.transitions.find((x) => x.id === id);
  if (!tr) {
    const ids = p.resolved.transitions.map((x) => x.id);
    throw new CliError({ rule: 'transition', message: `no transition '${id}'`, fix: ids.length ? `use one of: ${ids.join(', ')}` : 'video.json has no "transitions"' });
  }
  if (!Number.isInteger(count) || count < 2) throw new CliError({ rule: 'transition', message: '--count takes a whole number of at least 2', fix: 'for example --count 6' });
  // the last frame of the transition is the one before its end (a transition is drawn for t < end)
  const last = tr.end - 1 / p.resolved.fps;
  return Array.from({ length: count }, (_, k) => tr.start + ((last - tr.start) * k) / (count - 1));
}

/** The dev server serves projects/<id>/ only: commands that render need the project there. */
export function servedId(ref: ProjectRef): string {
  if (path.resolve(ref.dir) !== path.join(PROJECTS, ref.id)) {
    throw new CliError({ rule: 'project', message: `${ref.dir} is not in projects/: the renderer loads projects/<id>/ only`, fix: `copy the song folder with pve init ${ref.dir}` });
  }
  return ref.id;
}
