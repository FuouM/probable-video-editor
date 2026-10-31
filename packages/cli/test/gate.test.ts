import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { commitMessage, commitPaths } from '../src/commit';
import { goldenNeeded, runSteps, typecheckProjects } from '../src/gate';
import { CliError } from '../src/out';
import { expandTimes, loadProject, transitionTimes } from '../src/project';
import { makeProject, VIDEO } from './fixture';

let cleanup = () => {};
afterEach(() => cleanup());

const node = (code: string) => ['bun', '-e', code];

describe('pve gate', () => {
  test('the first failure stops the steps that still run', async () => {
    const t0 = performance.now();
    const r = await runSteps([
      { name: 'slow', cmd: node('setTimeout(() => {}, 30000)') },
      { name: 'bad', cmd: node('console.error("boom"); process.exit(1)') },
    ], { failFast: true });
    expect(r.map((x) => [x.name, x.status])).toEqual([['slow', 'cancelled'], ['bad', 'FAIL']]);
    expect(r[1]!.output).toContain('boom');
    expect(performance.now() - t0).toBeLessThan(15000);
  });

  test('keep going runs every step to its end', async () => {
    const r = await runSteps([
      { name: 'bad', cmd: node('process.exit(1)') },
      { name: 'good', cmd: node('setTimeout(() => {}, 1500)') },
    ], { failFast: false });
    expect(r.map((x) => x.status)).toEqual(['FAIL', 'ok']);
  });

  test('a step with a long failure shows the head or the tail', async () => {
    const lines = node('for (let i = 1; i <= 100; i++) console.log("line " + i); process.exit(1)');
    const [head, tail] = await runSteps([{ name: 'h', cmd: lines, show: 'head' }, { name: 't', cmd: lines, show: 'tail' }], { failFast: false });
    expect(head!.output).toContain('line 1\n');
    expect(head!.output).not.toContain('line 100');
    expect(tail!.output).toContain('line 100');
    expect(tail!.output).not.toContain('line 1\n');
  });

  test('typecheck steps come from the root script', () => {
    expect(typecheckProjects('tsc -p packages/engine && tsc -p app/tsconfig.scripts.json && tsc -p .')).toEqual(['packages/engine', 'app/tsconfig.scripts.json', '.']);
  });

  test('golden is needed for the engine and pdoom_original only', () => {
    expect(goldenNeeded(' M packages/engine/src/lyrics.ts\n')).toBe(true);
    expect(goldenNeeded('?? projects/pdoom_original/video/scenes/x.ts\n')).toBe(true);
    expect(goldenNeeded(' M projects/breaked_neuro/video/video.json\n M packages/cli/src/main.ts\n')).toBe(false);
    expect(goldenNeeded('')).toBe(false);
  });
});

describe('pve commit', () => {
  const git = (cwd: string, ...a: string[]) => Bun.spawnSync(['git', ...a], { cwd, stdout: 'pipe', stderr: 'pipe' }).stdout.toString().trim();

  test('commits the named paths and leaves other changes where they are', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pve-commit-'));
    cleanup = () => rmSync(root, { recursive: true, force: true });
    git(root, 'init', '-q');
    git(root, 'config', 'user.name', 'test');
    git(root, 'config', 'user.email', 'test@example.com');
    mkdirSync(path.join(root, 'projects/a'), { recursive: true });
    mkdirSync(path.join(root, 'projects/b'), { recursive: true });
    writeFileSync(path.join(root, 'projects/a/x.txt'), '1');
    writeFileSync(path.join(root, 'projects/b/y.txt'), '1');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'base');
    writeFileSync(path.join(root, 'projects/a/x.txt'), '2');
    writeFileSync(path.join(root, 'projects/a/new.txt'), 'n');
    writeFileSync(path.join(root, 'projects/b/y.txt'), '2');
    git(root, 'add', 'projects/b/y.txt'); // staged by someone else

    const r = commitPaths(root, commitMessage('change a', [{ name: 'check', status: 'ok', ms: 1 }, { name: 'test', status: 'FAIL', ms: 1 }]), ['projects/a']);
    expect(r.files.sort()).toEqual(['projects/a/new.txt', 'projects/a/x.txt']);
    expect(git(root, 'log', '-1', '--format=%B')).toBe('change a\n\nRan:\n- check');
    // the other project is still a staged change, not part of the commit
    expect(git(root, 'status', '--porcelain')).toBe('M  projects/b/y.txt');
  });

  test('nothing to commit is an error', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pve-commit-'));
    cleanup = () => rmSync(root, { recursive: true, force: true });
    git(root, 'init', '-q');
    mkdirSync(path.join(root, 'projects/a'), { recursive: true });
    expect(() => commitPaths(root, 'm', ['projects/a'])).toThrow(CliError);
  });
});

describe('time ranges and transitions', () => {
  async function project() {
    const p = makeProject({ ...VIDEO, transitions: [{ id: 'wipe', scene: 'verse', at: 'clip:chorus.start', pre: 0.2, post: 0.5 }] });
    cleanup = p.cleanup;
    const r = await loadProject({ id: 'song', dir: p.dir });
    return r.project!;
  }

  test('a range steps from its start up to its end, a single time stays one time', async () => {
    const p = await project();
    expect(expandTimes(p, ['0..0.5', '1.25'], 0.1).map((t) => +t.toFixed(3))).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 1.25]);
  });

  test('a range spreads n times evenly, both ends included', async () => {
    const p = await project();
    expect(expandTimes(p, ['1..2'], { n: 5 })).toEqual([1, 1.25, 1.5, 1.75, 2]);
  });

  test('a backward range and too many times are errors', async () => {
    const p = await project();
    expect(() => expandTimes(p, ['2..1'], 0.1)).toThrow(CliError);
    expect(() => expandTimes(p, ['0..4'], 0.01, 100)).toThrow(/more than 100/);
  });

  test('a transition gives times from its start to its last frame', async () => {
    const p = await project();
    const tr = p.resolved.transitions[0]!;
    const times = transitionTimes(p, 'wipe', 3);
    expect(times[0]).toBeCloseTo(tr.start, 9);
    expect(times[2]).toBeCloseTo(tr.end - 1 / p.resolved.fps, 9);
    expect(times[1]).toBeCloseTo((times[0]! + times[2]!) / 2, 9);
    expect(() => transitionTimes(p, 'nope', 3)).toThrow(/no transition 'nope'/);
    expect(() => transitionTimes(p, 'wipe', 1)).toThrow(CliError);
  });
});
