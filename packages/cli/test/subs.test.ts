import { expect, test } from 'bun:test';
import { cues, languages, toSrt, toTtml, type Cue } from '../src/subs';
import type { Subtitles } from '../../../app/src/subtitles';

// one line, "ko nichi" over "今日": the Japanese units are sung inside the romaji words
const subs: Subtitles = {
  tracks: [
    { id: 'en', label: 'English', joiner: ' ', lines: [{ start: 10, end: 12, tokens: [['Today', 10, 12]] }] },
    { id: 'romaji', label: 'Romaji', joiner: ' ', lines: [{ start: 10, end: 12, tokens: [['ko', 10, 11], ['nichi', 11, 12]] }, { start: 20, end: 21, tokens: [['hey', 20, 21]] }] },
    { id: 'ja', label: '日本語', joiner: '', lines: [{ start: 10, end: 12, tokens: [['今', 10, 11], ['日', 11, 12]] }] },
  ],
};

const text = (rows: Cue['rows']) => rows.map((r) => r.map((x) => (x.state === 'gap' ? x.text : `${x.state[0]}:${x.text}`)).join('|'));

test('a song with a lyric map has an English and a Japanese language', () => {
  expect(languages(subs)).toEqual(['en', 'ja']);
  expect(languages({ tracks: [subs.tracks[0]!] })).toEqual(['en']);
});

test('the Japanese cues have the romaji row above the Japanese row, lit by the same time', () => {
  const cs = cues(subs, 'ja');
  const at = (t: number) => cs.find((c) => c.start <= t && t < c.end)!;
  expect(text(at(10.2).rows)).toEqual(['s:ko| |p:nichi', 's:今|p:日']);
  expect(text(at(11.5).rows)).toEqual(['d:ko| |s:nichi', 'd:今|s:日']);
  // after the last token the line stays white for the tail, then the cue ends
  expect(text(at(12.3).rows)).toEqual(['d:ko nichi', 'd:今日']);
});

test('no coloured run starts or ends with a space: the space between two runs is a gap of its own', () => {
  for (const lang of ['en', 'ja']) {
    for (const c of cues(subs, lang)) {
      for (const row of c.rows) {
        for (const run of row) if (run.state !== 'gap') expect(run.text).toBe(run.text.trim());
        expect(row[0]!.state).not.toBe('gap');
        expect(row[row.length - 1]!.state).not.toBe('gap');
      }
    }
  }
});

test('a line shows before its first token and a line with no Japanese is one row', () => {
  const cs = cues(subs, 'ja');
  expect(cs[0]!.start).toBeCloseTo(9.75);
  expect(text(cs[0]!.rows)).toEqual(['p:ko nichi', 'p:今日']);
  const hey = cs.filter((c) => c.start >= 19);
  expect(text(hey[0]!.rows)).toEqual(['p:hey']);
  expect(hey.every((c) => c.rows.length === 1)).toBe(true);
});

test('cues do not overlap and none runs past the end of the film', () => {
  const cs = cues(subs, 'ja', 20.5);
  for (let i = 1; i < cs.length; i++) expect(cs[i]!.start).toBeGreaterThanOrEqual(cs[i - 1]!.end - 1e-9);
  for (const c of cs) {
    expect(Math.abs(c.start * 100 - Math.round(c.start * 100))).toBeLessThan(1e-6);
    expect(Math.abs(c.end * 100 - Math.round(c.end * 100))).toBeLessThan(1e-6);
  }
  expect(cs[cs.length - 1]!.end).toBe(20.5);
  expect(cues(subs, 'ja', 9).length).toBe(0);
});

test('the files carry the state as colour and escape the text', () => {
  const cs: Cue[] = [{ start: 3661.5, end: 3662, rows: [[{ text: 'a & b', state: 'sung' }, { text: ' ', state: 'gap' }, { text: '<c>', state: 'pending' }]] }];
  expect(toSrt(cs)).toBe('1\n01:01:01,500 --> 01:01:02,000\n<font color="#FFD84A">a &amp; b</font> <font color="#A0A0A0">&lt;c&gt;</font>\n');
  const ttml = toTtml(cs, 'ja');
  expect(ttml).toContain('xml:lang="ja"');
  expect(ttml).toContain('<p begin="01:01:01.500" end="01:01:02.000" xml:space="preserve"><span tts:color="#FFD84A">a &amp; b</span> <span tts:color="#A0A0A0">&lt;c&gt;</span></p>');
});

test('a language that the project has no tracks for is an error that lists the languages', () => {
  expect(() => cues({ tracks: [subs.tracks[0]!] }, 'ja')).toThrow('languages: en');
});
