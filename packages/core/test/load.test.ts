import { afterAll, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadSong } from '../src/load.ts';

const FIXTURE = path.join(import.meta.dir, 'fixtures', 'song');

describe('loadSong', () => {
  it('reads the beat grid', async () => {
    const { timing } = await loadSong(FIXTURE);
    expect(timing.beats).toHaveLength(8);
    expect(timing.downbeats).toEqual([0.5, 2.5]);
    expect(timing.bpm).toBe(120);
    expect(timing.beatPeriod).toBe(0.5);
    expect(timing.duration).toBe(4.2);
  });

  it('reads lines, words and syllables with their text', async () => {
    const { timing } = await loadSong(FIXTURE);
    expect(timing.lines).toHaveLength(2);
    const again = timing.lines[1].words[1];
    expect(again.text).toBe('again');
    expect(again.syl[1]).toEqual({ text: 'gain', start: 3.25, end: 3.9 });
    expect(timing.lines[0].words[0].syl.map((s) => s.text)).toEqual(['hel', 'lo']);
  });

  it('reads the sections', async () => {
    const { timing } = await loadSong(FIXTURE);
    expect(timing.sections).toEqual([
      { name: 'Verse 1', start: 0.5, end: 2.5 },
      { name: 'Chorus', start: 2.5, end: 4.2 },
    ]);
  });

  it('reads the features; missing stems and onset keys stay absent', async () => {
    const { features } = await loadSong(FIXTURE);
    expect(features.fps).toBe(100);
    expect(features.envelopes.rms).toHaveLength(6);
    expect(features.envelopes.vocal?.[3]).toBe(1);
    expect('bass' in features.envelopes).toBe(false);
    expect(features.onsets.vocal).toEqual([
      [0.52, 0.9],
      [2.51, 1],
    ]);
    expect(features.onsets.kick).toBeUndefined();
  });

  it('resolves the mix and stems from prompt.yaml', async () => {
    const { prompt, lyrics } = await loadSong(FIXTURE);
    expect(prompt.mixPath).toBe(path.join(FIXTURE, 'user_input', 'mix.wav'));
    expect(prompt.stems.mainVocal).toBe(path.join(FIXTURE, 'user_input', 'stems', 'vocal.wav'));
    expect(prompt.stems.drums).toEqual([path.join(FIXTURE, 'user_input', 'stems', 'drums.wav')]);
    expect(lyrics.lines[0].calibrated).toBe(true);
  });
});

describe('loadSong with a missing file', () => {
  const temps: string[] = [];
  afterAll(() => {
    for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A temp copy of the fixture without `rel`. */
  function copyWithout(rel: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pve-load-'));
    temps.push(dir);
    fs.cpSync(FIXTURE, dir, { recursive: true });
    fs.rmSync(path.join(dir, rel));
    return dir;
  }

  const cases: Array<[string, string]> = [
    ['user_input/prompt.yaml', 'prompt.yaml'],
    ['generated/timing.ai.json', 'timing.ai.json'],
    ['generated/features.json', 'features.json'],
    ['user_input/lyrics.calibrated.json', 'lyrics.calibrated.json'],
  ];
  for (const [rel, name] of cases) {
    it(`names ${name}`, async () => {
      await expect(loadSong(copyWithout(rel))).rejects.toThrow(name);
    });
  }

  it('tells the human to finish the song in Lyric-Sync when the calibration is missing', async () => {
    await expect(loadSong(copyWithout('user_input/lyrics.calibrated.json'))).rejects.toThrow('Finish the song in Lyric-Sync');
  });
});
