// The inputs of a project as the page reads them (app/src/inputs.ts ProjectInputs): the dev server's
// /api/project route and the static site snapshot (site-data.ts) both build them here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizePath } from 'vite';
import { LyricMap } from '@pve/core';
import { loadSong, type Song } from '@pve/core/load';
import type { LineWritten, LyricsInputLine } from '@pve/engine/lyrics';

/**
 * Replacements of engine defaults in video/assets/: palette.json (colours by key) and the files in fonts/
 * (same path as in the engine's fonts/, e.g. fonts/src/IBMPlexMono-Regular.ttf).
 * `fontUrl` turns a path under fonts/ into the URL the page fetches it from.
 */
export function projectAssets(dir: string, fontUrl: (rel: string) => string) {
  const assets = path.join(dir, 'video/assets');
  const paletteFile = path.join(assets, 'palette.json');
  const palette = existsSync(paletteFile) ? (JSON.parse(readFileSync(paletteFile, 'utf8')) as Record<string, unknown>) : null;
  const fontDir = path.join(assets, 'fonts');
  const fonts: Record<string, string> = {};
  if (existsSync(fontDir)) {
    for (const e of readdirSync(fontDir, { recursive: true, withFileTypes: true })) {
      if (!e.isFile()) continue;
      const rel = normalizePath(path.relative(fontDir, path.join(e.parentPath, e.name)));
      fonts[rel] = fontUrl(rel);
    }
  }
  return { palette, fonts };
}

/**
 * Calibrated lyric lines in the engine's input shape (LyricsInputLine). A one-syllable word gets no `syl`:
 * scenes test `syl` for a real syllable split. With a lyric map, each line also gets `written` (JP glyphs, EN phrases).
 */
export function engineLines(song: Song): LyricsInputLine[] {
  const map = song.lyricMap ? new LyricMap(song.lyricMap.doc, song.timing) : undefined;
  const written = new Map<number, LineWritten>();
  for (const l of map?.lines ?? []) {
    written.set(l.i, {
      jp: l.jp,
      units: l.jpUnits.map(({ glyph, from, to, start, end }) => ({ glyph, from, to, start, end })),
      en: l.enText,
      phrases: l.en.map(({ text, from, to, loose, start, end }) => ({ text, from, to, loose, start, end })),
      ghosts: l.syl.filter((s) => s.ghost).map((s) => s.k),
    });
  }
  return song.lyrics.lines.map((l) => {
    const w = written.get(l.i);
    return {
      i: l.i,
      text: l.text,
      start: l.start,
      end: l.end,
      words: l.words.map((w) => ({
        w: w.w,
        start: w.start,
        end: w.end,
        ...(typeof w.conf === 'number' ? { conf: w.conf } : {}),
        ...(w.syl.length > 1 ? { syl: w.syl, sylText: w.sylText } : {}),
      })),
      ...(w ? { written: w } : {}),
    };
  });
}

/** How the page reaches the files of a project: `mix` is the URL of the mix, `font` the URL of a font file. */
export interface InputUrls {
  mix: (song: Song) => string;
  font: (rel: string) => string;
}

/** Reads project `id` in `dir` into the body of the page's ProjectInputs. */
export async function projectInputs(id: string, dir: string, urls: InputUrls) {
  const song = await loadSong(dir);
  return {
    id,
    video: JSON.parse(readFileSync(path.join(dir, 'video/video.json'), 'utf8')) as unknown,
    timing: song.timing,
    features: song.features,
    lines: engineLines(song),
    mix: urls.mix(song),
    assets: projectAssets(dir, urls.font),
  };
}
