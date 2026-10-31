import { describe, expect, it } from 'bun:test';
import { checkLyricMap, LyricMap, LyricMapError, parseLyricMap, type LyricMapDoc } from '../src/lyricmap.ts';
import type { SongTiming } from '../src/song.ts';
import { syntheticSong } from './fixtures/song.ts';

/** The synthetic song with the last syllable of line 0 turned into a ghost syllable. */
function song(): SongTiming {
  const s = syntheticSong();
  s.lines[0]!.words[0]!.syl[3]!.text = '(la)';
  return s;
}

/** A map that fits song(): line 0 has 4 syllables (the last is a ghost), line 1 has 6, lines 2 and 3 have 4. */
function doc(): LyricMapDoc {
  return {
    v: 1, song: 'synthetic', calibrated: 'lyrics.calibrated.json', raw: { jp: 'jp.txt', en: 'en.txt' }, note: '', skip: [1],
    lines: [
      { i: 0, r: 2, t: 'Post-Chinchilla', n: 4, jp: '後 ~ 鼠 _', en: [[0, 3, 'Post Chinchilla', '~']] },
      { i: 1, r: 3, t: 'There was a sudden drop', n: 6, jp: '「そ れ は 突 ~ 落', en: [[0, 2, 'There was'], [3, 6, 'sudden "drop"'], [2, 3, 'a', '~']] },
      { i: 2, r: 4, t: 'Duplicate line', n: 4, jp: '重 ~ 線 ~', en: [[0, 4, 'Duplicate line']], ig: ['(x)'] },
      { i: 3, r: 5, t: 'Duplicate line', n: 4, jp: '重 ~ 線 ~', en: [[0, 4, 'Duplicate line']] },
    ],
  };
}

const problems = (d: LyricMapDoc, raw?: { jp: string[]; en: string[] }, s = song()) => checkLyricMap(d, s, raw).map((p) => p.at);

describe('LyricMap', () => {
  it('joins glyphs to syllable times; a ghost syllable has no glyph and no unit', () => {
    const l0 = new LyricMap(doc(), song()).lines[0]!;
    expect(l0.syl.map((s) => s.ghost)).toEqual([false, false, false, true]);
    expect(l0.syl[3]).toMatchObject({ unit: -1, text: '(la)' });
    expect(l0.jp).toBe('後鼠');
    // `後 ~` is one glyph over two syllables
    expect(l0.jpUnits[0]).toMatchObject({ glyph: '後', from: 0, to: 2, start: 1.95, end: 2.4 });
    expect(l0.jpUnits[1]).toMatchObject({ glyph: '鼠', from: 2, to: 3, start: 2.4, end: 2.6 });
  });

  it('keeps English phrases in the order written, with times, loose flags and the syllables they cover', () => {
    const l1 = new LyricMap(doc(), song()).lines[1]!;
    expect(l1.en.map((e) => [e.text, e.start, e.end, e.loose])).toEqual([
      ['There was', 4.02, 4.8, false],
      ['sudden "drop"', 5.0, 6.0, false],
      ['a', 4.8, 5.0, true],
    ]);
    expect(l1.enText).toBe('There was sudden "drop" a');
    expect(l1.syl.map((s) => s.en)).toEqual([[0], [0], [2], [1], [1], [1]]);
  });

  it('keeps a syllable without a phrase: the translation need not cover the line', () => {
    const d = doc();
    d.lines[3]!.en = [[0, 2, 'Duplicate']];
    expect(new LyricMap(d, song()).lines[3]!.syl.map((s) => s.en)).toEqual([[0], [0], [], []]);
  });

  it('refuses a map that does not fit the calibrated lyrics', () => {
    const d = doc();
    d.lines[1]!.jp = 'そ れ は 突 落';
    expect(() => new LyricMap(d, song())).toThrow(LyricMapError);
  });
});

describe('checkLyricMap against the calibrated lyrics', () => {
  it('passes a fitting map', () => {
    expect(problems(doc())).toEqual([]);
  });

  it('finds a stale map: line text, syllable count, slot count', () => {
    const d = doc();
    d.lines[0]!.t = 'Post Chinchilla';
    d.lines[2]!.n = 3;
    d.lines[3]!.jp = '重 ~ 線';
    expect(problems(d)).toEqual(['lines[0].t', 'lines[2].n', 'lines[3].jp']);
  });

  it('keeps ghost syllables and ghost slots in step', () => {
    const noSlot = doc();
    noSlot.lines[0]!.jp = '後 ~ 鼠 ~';
    const noGhost = doc();
    noGhost.lines[3]!.jp = '重 _ 線 ~';
    expect(problems(noSlot)).toEqual(['lines[0].jp[3]']);
    expect(problems(noGhost)).toEqual(['lines[3].jp[1]']);
  });

  it('does not let a continuation start a line or follow a ghost', () => {
    const first = doc();
    first.lines[3]!.jp = '~ 重 線 ~';
    expect(problems(first)).toEqual(['lines[3].jp[0]']);
    const s = song();
    s.lines[2]!.words[0]!.syl[1]!.text = '(pli)';
    const afterGhost = doc();
    afterGhost.lines[2]!.jp = '重 _ ~ 線';
    expect(problems(afterGhost, undefined, s)).toEqual(['lines[2].jp[2]']);
  });

  it('keeps phrase spans inside the line and not empty', () => {
    const d = doc();
    d.lines[2]!.en = [[0, 5, 'Duplicate line']];
    d.lines[3]!.en = [[2, 2, 'Duplicate line']];
    expect(problems(d)).toEqual(['lines[2].en[0]', 'lines[3].en[0]']);
  });
});

describe('checkLyricMap against the raw files', () => {
  // raw line 1 is not main vocal (skip); "(x)" in line 4 is not in the calibration (ig)
  const jp = ['背景', '後鼠', '「それは突落', '重線(x)', '重線'];
  const en = ['Title', 'Post Chinchilla', 'There was sudden “drop” a', 'Duplicate  line (x)', 'Duplicate line'];

  it('rebuilds each raw line from the glyphs and the phrases: curly quotes, spaces and ig text do not count', () => {
    expect(problems(doc(), { jp, en })).toEqual([]);
  });

  it('finds a raw line that changed, and a raw line that nobody maps or skips', () => {
    expect(problems(doc(), { jp: [jp[0]!, '後猫', ...jp.slice(2)], en })).toEqual(['lines[0].jp']);
    expect(problems(doc(), { jp: [...jp, '新しい行'], en })).toEqual(['raw.jp']);
  });

  it('finds ig text that is in neither raw line', () => {
    const d = doc();
    d.lines[2]!.ig = ['(zzz)'];
    expect(problems(d, { jp, en })).toContain('lines[2].ig');
  });
});

describe('parseLyricMap', () => {
  it('lists every shape problem', () => {
    const bad = { ...doc(), v: 2, skip: 'x', lines: [{ i: 0, r: 1, t: 't', n: 1, jp: 'a', en: [[0, 1]] }] };
    expect(() => parseLyricMap(bad)).toThrow(LyricMapError);
    try {
      parseLyricMap(bad);
    } catch (e) {
      expect((e as LyricMapError).problems.map((p) => p.at)).toEqual(['v', 'skip', 'lines[0].en[0]']);
    }
  });
});
