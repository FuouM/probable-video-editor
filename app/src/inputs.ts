// The inputs of the open project (?project=<id>, else the server's PVE_PROJECT), from the dev server's
// /api/project route (vite.config.ts). The static site build (vite.site.config.ts) has no server: it sets
// VITE_PVE_INPUTS to the URL of a snapshot of the same JSON (scripts/site-data.ts). Fetched once. No engine
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

let pending: Promise<ProjectInputs> | null = null;

export function fetchInputs(): Promise<ProjectInputs> {
  pending ??= (async () => {
    const staticUrl = import.meta.env.VITE_PVE_INPUTS as string | undefined;
    const id = new URLSearchParams(location.search).get('project') ?? '';
    const r = await fetch(staticUrl ?? `/api/project/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(`project: ${await r.text()}`);
    return (await r.json()) as ProjectInputs;
  })();
  return pending;
}
