// Loads a finished Lyric-Sync song folder (DESIGN 4.3).
// Every path and file check comes from lyricsync/song-folder, so pve and Lyric-Sync agree on the layout.
// lyricsync/song-folder imports only node:fs and node:path, not the models. prompt.yaml needs the Bun runtime.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  readCalibratedLyrics,
  readFeatures,
  readSongPrompt,
  readTimingAi,
  songFolderPaths,
  type CalibrationDoc,
  type SongPrompt,
} from 'lyricsync/song-folder';
import { parseLyricMap, type LyricMapDoc, type RawLyrics } from './lyricmap.ts';
import type { Features, SongTiming } from './song.ts';

export type { CalibrationDoc, SongPrompt } from 'lyricsync/song-folder';
/** The file paths of a song folder, as Lyric-Sync defines them. */
export { songFolderPaths } from 'lyricsync/song-folder';

export type { Features, MixEnvelopeKey, OnsetKey, StemEnvelopeKey } from './song.ts';

export interface Song {
  /** The song folder. */
  dir: string;
  /** user_input/prompt.yaml: the mix (`mixPath`) and the stems, as absolute paths. Files are not checked. */
  prompt: SongPrompt;
  /** Beats from generated/timing.ai.json, lyrics and sections from user_input/lyrics.calibrated.json. */
  timing: SongTiming;
  features: Features;
  /** user_input/lyrics.calibrated.json as read, with the pin flags. */
  lyrics: CalibrationDoc;
  /** user_input/lyrics.map.json and the raw lyric files it names. Undefined when the song has no map. */
  lyricMap?: { doc: LyricMapDoc; raw: RawLyrics };
}

/** Reads the four input files of the song folder `dir`. A missing file gives an error that names it. */
export async function loadSong(dir: string): Promise<Song> {
  const prompt = readSongPrompt(dir);
  const beats = readTimingAi(dir);
  const lyrics = readCalibrated(dir);
  const features: Features = readFeatures(dir);
  const timing: SongTiming = {
    duration: beats.duration,
    bpm: beats.bpm,
    beatPeriod: beats.beat_period,
    beats: beats.beats,
    downbeats: beats.downbeats,
    lines: lyrics.lines.map((line) => ({
      text: line.text,
      start: line.start,
      end: line.end,
      words: line.words.map((word) => ({
        text: word.w,
        start: word.start,
        end: word.end,
        syl: word.syl.map(([start, end], i) => ({ text: word.sylText[i], start, end })),
      })),
    })),
    sections: lyrics.sections.map((s) => ({ name: s.name, start: s.start, end: s.end })),
  };
  return { dir, prompt, timing, features, lyrics, lyricMap: readLyricMap(dir) };
}

/** The file name of the lyric map in user_input/. */
export const LYRIC_MAP_FILE = 'lyrics.map.json';

function readLyricMap(dir: string): Song['lyricMap'] {
  const userInput = path.join(dir, 'user_input');
  const file = path.join(userInput, LYRIC_MAP_FILE);
  if (!fs.existsSync(file)) return undefined;
  let doc: LyricMapDoc;
  try {
    doc = parseLyricMap(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    throw new Error(`${file}: ${e instanceof Error ? e.message : e}`);
  }
  const lines = (name: string) => fs.readFileSync(path.join(userInput, name), 'utf8').split(/\r?\n/);
  return { doc, raw: { jp: lines(doc.raw.jp), en: lines(doc.raw.en) } };
}

function readCalibrated(dir: string): CalibrationDoc {
  const file = songFolderPaths(dir).calibratedFile;
  if (!fs.existsSync(file)) {
    throw new Error(`Calibrated lyrics not found: ${file}. Finish the song in Lyric-Sync: calibrate the lyrics, set the sections and save.`);
  }
  return readCalibratedLyrics(dir);
}
