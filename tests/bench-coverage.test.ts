// Every engine module with effects has a sibling `<module>.bench.ts` with at least one benchmark.
import { expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { BENCH, NON_EFFECT_MODULES } from '../packages/engine/src/bench/registry';
import type { EffectBench } from '../packages/engine/src/bench/types';

const SRC = path.join(import.meta.dir, '../packages/engine/src');

/** Module ids under packages/engine/src: relative path without `.ts`, `/` separators; `bench/` and `*.bench.ts` skipped. */
const modules = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .map((f) => f.split(path.sep).join('/'))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.bench.ts') && !f.startsWith('bench/'))
  .map((f) => f.slice(0, -3))
  .sort();
const nonEffect: readonly string[] = NON_EFFECT_MODULES;
const effectModules = modules.filter((m) => !nonEffect.includes(m));

const REQUIRED = [
  'post.prefilter', 'post.down', 'post.up', 'post.final', 'post.chain',
  'blur.accum', 'blur.err', 'blur.max', 'blur.mask', 'blur.errTile', 'blur.gain',
  'engine.xfade', 'engine.blit',
  'read.sync', 'read.async', 'read.rgbPack', 'read.pipelined',
  'lines.10k', 'lines.200k', 'layer2d.upload', 'stroke.text', 'type.layout', 'glsl.noise', 'hud.render',
  'storyboard.card',
];

test('NON_EFFECT_MODULES entries exist', () => {
  expect(nonEffect.filter((m) => !modules.includes(m))).toEqual([]);
});

test.each(effectModules)('%s has a non-empty sibling .bench.ts', async (m) => {
  const file = path.join(SRC, `${m}.bench.ts`);
  expect(existsSync(file), `missing packages/engine/src/${m}.bench.ts`).toBe(true);
  // Runtime-selected path: the module list comes from the directory, so a new module is checked without editing this test.
  const mod: { bench?: EffectBench[] } = await import(file);
  expect(mod.bench?.length ?? 0, `${m}.bench.ts exports no benchmarks`).toBeGreaterThan(0);
});

test('benchmark ids are unique', () => {
  const ids = BENCH.map((b) => b.id);
  expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
});

test('the required benchmarks are present', () => {
  const ids = BENCH.map((b) => b.id);
  expect(REQUIRED.filter((id) => !ids.includes(id))).toEqual([]);
});
