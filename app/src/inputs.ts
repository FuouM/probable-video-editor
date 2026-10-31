// The inputs of the open project (?project=<id>, else the server's PVE_PROJECT), from the dev server's
// /api/project route (vite.config.ts). The static site build (vite.site.config.ts) has no server: it sets
// VITE_PVE_DATA to the URL of its data folder, which holds projects.json (the list of videos) and, per project,
// the snapshot of the same JSON (scripts/site-data.ts), its subtitles, its audio and its assets. Fetched once. No engine
// imports here: boot.ts applies the project palette before the engine modules load.
import type { Features, SongTiming } from '@pve/core';
import type { LyricsInputLine } from '@pve/engine/lyrics';

export interface ProjectInputs {
  id: string;
  /** video/video.json as read. */
  video: unknown;
  timing: SongTiming;
  features: Features;
  lines: LyricsInputLine[];
  /** URL of the mix. */
  mix: string;
  /** Project replacements of engine defaults, from video/assets/. */
  assets: {
    /** video/assets/palette.json, or null. */
    palette: Record<string, unknown> | null;
    /** Font files in video/assets/fonts/: path under fonts/ -> URL. */
    fonts: Record<string, string>;
  };
}

/** URL of the data folder of the static site (with a trailing slash), or undefined on the dev server. */
export const DATA = import.meta.env.VITE_PVE_DATA as string | undefined;

/** A video of the site: data/projects.json. */
export interface SiteProject {
  id: string;
  title: string;
  /** Seconds. */
  duration: number;
  /** The cover is at data/<id>/thumbnail.jpg. */
  thumbnail: boolean;
}

/** The id of the open project: ?project=. Empty on the static site until the visitor has chosen a video (the page then loads nothing). */
export function projectId(): string {
  return new URLSearchParams(location.search).get('project') ?? '';
}

let list: Promise<SiteProject[]> | null = null;
/** The videos of the static site. */
export function siteProjects(): Promise<SiteProject[]> {
  list ??= fetch(`${DATA}projects.json`).then((r) => {
    if (!r.ok) throw new Error(`projects.json: HTTP ${r.status}`);
    return r.json() as Promise<SiteProject[]>;
  });
  return list;
}

let pending: Promise<ProjectInputs> | null = null;

export function fetchInputs(): Promise<ProjectInputs> {
  pending ??= (async () => {
    const id = projectId();
    if (!id && DATA !== undefined) throw new Error('No video is chosen.');
    const r = await fetch(DATA === undefined ? `/api/project/${encodeURIComponent(id)}` : `${DATA}${id}/inputs.json`);
    if (!r.ok) throw new Error(`project: ${await r.text()}`);
    return (await r.json()) as ProjectInputs;
  })();
  return pending;
}
