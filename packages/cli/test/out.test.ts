import { afterAll, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { TimingData } from '@pve/core';
import { fmtBarBeat, fmtBeatOffset, fmtProblem, fmtTime, table } from '../src/out';
import { makeProject, VIDEO } from './fixture';

describe('formatters', () => {
  test('fmtTime: mm:ss.mmm, minutes past 60 do not wrap, rounding carries', () => {
    expect(fmtTime(0)).toBe('00:00.000');
    expect(fmtTime(84.0005)).toBe('01:24.001');
    expect(fmtTime(59.9996)).toBe('01:00.000');
    expect(fmtTime(3725.5)).toBe('62:05.500');
    expect(fmtTime(-1.25)).toBe('-00:01.250');
    expect(fmtTime(-0.0001)).toBe('00:00.000');
  });

  // 120 bpm, beats 0.5..4 (0.5 s apart), downbeats at 0.5 and 2.5: 4 beats a bar
  const timing = new TimingData({
    duration: 5, bpm: 120, beatPeriod: 0.5,
    beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], downbeats: [0.5, 2.5], lines: [], sections: [],
  });

  test('fmtBarBeat: bar 1 at the first downbeat, a time on a beat is that beat, a pickup is bar 0', () => {
    expect(fmtBarBeat(timing, 0.5)).toBe('1.1');
    expect(fmtBarBeat(timing, 0.99)).toBe('1.1');
    expect(fmtBarBeat(timing, 1)).toBe('1.2');
    expect(fmtBarBeat(timing, 2.4999999)).toBe('2.1');
    expect(fmtBarBeat(timing, 3.6)).toBe('2.3');
    expect(fmtBarBeat(timing, 0.1)).toBe('0.1');
  });

  test('fmtBeatOffset: signed ms from the nearest beat', () => {
    expect(fmtBeatOffset(timing, 1.0004)).toBe('on beat');
    expect(fmtBeatOffset(timing, 1.031)).toBe('+31ms');
    expect(fmtBeatOffset(timing, 1.488)).toBe('-12ms');
  });

  test('table pads every column but the last', () => {
    expect(table([['a', 'long text'], ['bbb', 'x']], ['id', 'text'], '')).toBe('id   text\na    long text\nbbb  x');
  });

  test('a problem prints its file, path and fix', () => {
    expect(fmtProblem({ severity: 'error', rule: 'r', file: 'video/video.json', at: 'clips[1].at', message: 'bad', fix: 'do this' }))
      .toBe('error    video/video.json clips[1].at: bad\n         fix: do this');
  });
});

describe('exit codes', () => {
  const MAIN = path.join(import.meta.dir, '../src/main.ts');
  const ok = makeProject();
  const bad = makeProject({ ...VIDEO, clips: [{ id: 'x', at: 'lyric:nowhere' }] });
  afterAll(() => { ok.cleanup(); bad.cleanup(); });
  const run = (...args: string[]) => Bun.spawnSync(['bun', MAIN, ...args], { stdout: 'pipe', stderr: 'pipe' }).exitCode;

  test('0 on success, 1 on a failed check, 2 on usage errors', () => {
    expect(run('check', '-p', ok.dir)).toBe(0);
    expect(run('check', '-p', bad.dir)).toBe(1);
    expect(run('check', '-p', path.join(ok.dir, 'missing'))).toBe(1);
    expect(run('nope')).toBe(2);
    expect(run('check', '--frobnicate')).toBe(2);
    expect(run('find', '-p', ok.dir)).toBe(2);
    expect(run('scene', 'new', 'Bad Name', '-p', ok.dir)).toBe(2);
    // (seven bun processes: slow on a busy machine)
  }, 30_000);
});
