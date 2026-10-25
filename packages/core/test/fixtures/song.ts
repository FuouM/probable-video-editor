// Synthetic song for the core tests: constant tempo, 4/4, first beat at 0.
import type { SongTiming, SongWord } from '../../src/song.ts';
import { TimingData } from '../../src/timing.ts';

function word(text: string, start: number, end: number, syl?: [string, number, number][]): SongWord {
  return {
    text,
    start,
    end,
    syl: (syl ?? [[text, start, end]]).map(([t, s, e]) => ({ text: t, start: s, end: e })),
  };
}

export function syntheticSong(bpm = 120, firstDownbeatBeat = 0): SongTiming {
  const beatPeriod = 60 / bpm;
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let i = 0; i < 100; i++) {
    beats.push(i * beatPeriod);
    if (i >= firstDownbeatBeat && (i - firstDownbeatBeat) % 4 === 0) downbeats.push(i * beatPeriod);
  }
  return {
    duration: 50,
    bpm,
    beatPeriod,
    beats,
    downbeats,
    lines: [
      {
        text: 'Post-Chinchilla',
        start: 1.95, // 50 ms before beat 4 (2.0 s at 120 bpm)
        end: 3.5,
        words: [
          word('Post-Chinchilla', 1.95, 2.8, [
            ['Post', 1.95, 2.2],
            ['Chin', 2.2, 2.4],
            ['chil', 2.4, 2.6],
            ['la', 2.6, 2.8],
          ]),
        ],
      },
      {
        text: 'There was a sudden drop',
        start: 4.0,
        end: 6.0,
        words: [
          word('There', 4.02, 4.5),
          word('was', 4.5, 4.8),
          word('a', 4.8, 5.0),
          word('sudden', 5.0, 5.5, [
            ['sud', 5.0, 5.25],
            ['den', 5.25, 5.5],
          ]),
          word('drop', 5.5, 6.0),
        ],
      },
      {
        text: 'Duplicate line',
        start: 8.0,
        end: 9.0,
        words: [
          word('Duplicate', 8.0, 8.5, [
            ['Du', 8.0, 8.15],
            ['pli', 8.15, 8.3],
            ['cate', 8.3, 8.5],
          ]),
          word('line', 8.5, 9.0),
        ],
      },
      {
        text: 'Duplicate line',
        start: 10.0,
        end: 11.0,
        words: [
          word('Duplicate', 10.0, 10.5, [
            ['Du', 10.0, 10.15],
            ['pli', 10.15, 10.3],
            ['cate', 10.3, 10.5],
          ]),
          word('line', 10.5, 11.0),
        ],
      },
    ],
    sections: [
      { name: 'intro', start: 0, end: 4.0 },
      { name: 'verse', start: 4.0, end: 12.0 },
      { name: 'outro', start: 12.0, end: 20.0 },
    ],
  };
}

export function syntheticTiming(bpm = 120, firstDownbeatBeat = 0): TimingData {
  return new TimingData(syntheticSong(bpm, firstDownbeatBeat));
}
