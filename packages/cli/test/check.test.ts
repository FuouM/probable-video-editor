import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { checkProject, scanScene, stripComments } from '../src/check';
import { makeProject, SCENE, VIDEO } from './fixture';

let cleanup = () => {};
afterEach(() => cleanup());

async function check(video: unknown = VIDEO, scenes?: Record<string, string>) {
  const p = makeProject(video, scenes);
  cleanup = p.cleanup;
  const r = await checkProject({ id: 'song', dir: p.dir });
  return r.problems.map((x) => ({ severity: x.severity, rule: x.rule, file: x.file, at: x.at }));
}

const clips = (...extra: object[]) => ({ ...VIDEO, clips: [...VIDEO.clips, ...extra] });

describe('pve check findings', () => {
  test('a valid project has no problems', async () => {
    expect(await check()).toEqual([]);
  });

  test('a missing input file is an error that names the file', async () => {
    const p = makeProject();
    cleanup = p.cleanup;
    rmSync(path.join(p.dir, 'user_input/lyrics.calibrated.json'));
    const r = await checkProject({ id: 'song', dir: p.dir });
    expect(r.project).toBeUndefined();
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]!.message).toContain('lyrics.calibrated.json');
  });

  test('invalid JSON and schema errors name the file and the JSON path', async () => {
    expect(await check('{ "v": 2,')).toEqual([{ severity: 'error', rule: 'json', file: 'video/video.json', at: undefined }]);
    expect(await check({ ...VIDEO, fps: 0 })).toEqual([{ severity: 'error', rule: 'schema', file: 'video/video.json', at: 'fps' }]);
  });

  test('an expression that does not resolve names its path', async () => {
    const bad = { ...VIDEO, clips: [VIDEO.clips[0], { id: 'x', at: 'lyric:nowhere' }] };
    expect(await check(bad)).toEqual([{ severity: 'error', rule: 'expression', file: 'video/video.json', at: 'clips[1].at' }]);
  });

  test('overlap is an error, gap and cut off the beat are warnings', async () => {
    const v = {
      ...VIDEO,
      clips: [
        { id: 'a', at: 0, to: 'beat:2' }, // ends 1.5, b starts 1.0: overlap
        { id: 'b', at: 'beat:1' },
        { id: 'c', at: 'beat:3', to: 'beat:4' }, // b ends at c (2.0); c ends 2.5, d starts 3.25: gap
        { id: 'd', at: 'syl:gain' }, // 3.25: half a beat off
      ],
    };
    expect(await check(v)).toEqual([
      { severity: 'error', rule: 'clip-overlap', file: 'video/video.json', at: 'clips[1].at' },
      { severity: 'warning', rule: 'clip-gap', file: 'video/video.json', at: 'clips[3].at' },
      { severity: 'warning', rule: 'cut-off-beat', file: 'video/video.json', at: 'clips[3].at' },
    ]);
  });

  test('a scene that a clip names must exist and default-export a class', async () => {
    expect(await check(clips({ id: 'z', at: 'beat:7', scene: 'nope' }))).toEqual([
      { severity: 'error', rule: 'scene-missing', file: 'video/video.json', at: 'clips[3].scene' },
    ]);
    expect(await check(VIDEO, { verse: 'export class Verse {}\n' })).toEqual([
      { severity: 'error', rule: 'scene-export', file: 'video/scenes/verse.ts', at: undefined },
    ]);
  });

  test('a scene file that does not compile gives its line', async () => {
    expect(await check(VIDEO, { verse: SCENE, broken: 'const a = 1;\nconst b = ;\n' })).toEqual([
      { severity: 'error', rule: 'scene-syntax', file: 'video/scenes/broken.ts', at: 'line 2:11' },
    ]);
  });

  test('banned calls are errors with their line, also in helper files; comments do not count', async () => {
    const helper = '// Math.random() is banned\nexport const r = () => Math.random();\n/* Date.now() */\nexport const n = performance.now();\n';
    expect(await check(VIDEO, { verse: SCENE, _helper: helper })).toEqual([
      { severity: 'error', rule: 'banned-call', file: 'video/scenes/_helper.ts', at: 'line 2' },
      { severity: 'error', rule: 'banned-call', file: 'video/scenes/_helper.ts', at: 'line 4' },
    ]);
  });

  test('a scene that reads a feature the song lacks gets one error per feature', async () => {
    // the fixture song has the vocal and drums envelopes and vocal onsets only
    const src = SCENE.replace('{}', `{
    const k = f.a.kick + f.a.vonset + f.a.vocal + f.a.rms;
    const b = this.ctx.audio.env('bass', f.t) + this.ctx.audio.env('bass', 0);
    const { snare, drums } = f.a; const k2 = f.a.kick;
  }`);
    expect(await check(VIDEO, { verse: src })).toEqual([
      { severity: 'error', rule: 'feature-missing', file: 'video/scenes/verse.ts', at: 'lines 5, 7' },
      { severity: 'error', rule: 'feature-missing', file: 'video/scenes/verse.ts', at: 'line 6' },
      { severity: 'error', rule: 'feature-missing', file: 'video/scenes/verse.ts', at: 'line 7' },
    ]);
  });
});

describe('scene scan', () => {
  test('comments are blanked, strings and template code are kept, lines stay', () => {
    const src = "const u = 'http://x'; // c\nconst s = `a ${f(/* no */ 1)} // b`;\n/* x\ny */ z();";
    const out = stripComments(src);
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    expect(out).toContain("'http://x';");
    expect(out).toContain('`a ${f(');
    expect(out).toContain(' // b`');
    expect(out).not.toContain('no');
    expect(out).not.toContain('// c');
    expect(out.trimEnd().endsWith('z();')).toBe(true);
  });

  test('feature reads map AudioSample keys and AudioData methods to features.json entries', () => {
    const scan = scanScene("f.a.kick; au.hit('snare', t); au.events(\"hat\", 0, 1); au.envPeak('bass', t); this.a.push(1); f.a.rms;");
    expect(scan.reads.map((r) => r.feature)).toEqual(['onsets.kick', 'onsets.snare', 'onsets.hat', 'envelopes.bass']);
  });
});
