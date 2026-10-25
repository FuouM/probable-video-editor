// Inputs of one song: timing and features. The loader (load.ts) fills them from the song folder.
// Times are in seconds.

export interface SongSyllable {
  text: string;
  start: number;
  end: number;
}

export interface SongWord {
  text: string;
  start: number;
  end: number;
  syl: SongSyllable[];
}

export interface SongLine {
  text: string;
  start: number;
  end: number;
  words: SongWord[];
}

export interface SongSection {
  name: string;
  start: number;
  end: number;
}

export interface SongTiming {
  duration: number;
  bpm: number;
  beatPeriod: number;
  beats: number[];
  downbeats: number[];
  lines: SongLine[];
  sections: SongSection[];
}

export type MixEnvelopeKey = 'rms' | 'low' | 'mid' | 'high';
export type StemEnvelopeKey = 'vocal' | 'drums' | 'bass' | 'other';
export type OnsetKey = 'kick' | 'snare' | 'hat' | 'vocal';

/**
 * generated/features.json v1. Envelopes are 0..1 at `fps` frames per second, all of the same length.
 * The mix envelopes are always present. A stem envelope is present only when the song has that stem.
 * `onsets` holds only the keys that a detector computed: [time s, strength 0..1].
 */
export interface Features {
  v: 1;
  fps: number;
  envelopes: Record<MixEnvelopeKey, number[]> & Partial<Record<StemEnvelopeKey, number[]>>;
  onsets: Partial<Record<OnsetKey, Array<[number, number]>>>;
}
