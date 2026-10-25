// Shared helpers for the `*.bench.ts` files. Imported by `bun test` through the registry: no runtime
// import of engine modules here (they touch the DOM or WebGL), only import() inside the functions.
import type * as THREE from 'three';
import type { Engine } from '../engine';
import type { EffectBench } from './types';

/** Typed bench entry: infers the state type from `setup` and checks `run`/`dispose` against it. */
export function defineBench<S>(b: EffectBench<S>): EffectBench {
  return b;
}

/** Real HDR inputs: composited scene frames of the project's timeline. */
export interface BenchFrames {
  /** Song time of `input`: the middle of the first loaded timeline entry. */
  t: number;
  /** HDR (linear) composite at `t`, and a quarter of the entry later. */
  input: THREE.WebGLRenderTarget;
  input2: THREE.WebGLRenderTarget;
}

/**
 * Render the representative frame: a full frame at `t` (so finalRT, the HUD layer and lastPost hold a
 * real frame), plus copies of the HDR composites at `t` and a quarter of the entry later. Free the
 * copies with disposeFrames.
 */
export async function benchFrames(engine: Engine): Promise<BenchFrames> {
  const { makeRT } = await import('../gl');
  const e = engine.timeline.find((x) => engine.loaded.get(x.id)?.scene);
  if (!e) throw new Error('bench: no scene loaded to render the input frames');
  const r = engine.renderer, dt = 1 / 60;
  const t = (e.start + e.end) / 2, t2 = t + (e.end - e.start) / 4;
  const input = makeRT(), input2 = makeRT();
  engine.comp.draw(r, engine.composite(t2, dt, true).outTex, input2, { mode: 'replace', premult: false });
  engine.comp.draw(r, engine.composite(t, dt, true).outTex, input, { mode: 'replace', premult: false });
  engine.render(t, dt, false, 1, 0.5);
  return { t, input, input2 };
}

export function disposeFrames(f: BenchFrames) {
  f.input.dispose();
  f.input2.dispose();
}

/** Deterministic random numbers in 0..1 (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The longest lyric line of the song: a real, lyric-length string for the text benchmarks. */
export function longestLine(engine: Engine) {
  return engine.lyrics.lines.reduce((a, b) => (b.text.length > a.length ? b.text : a), '');
}
