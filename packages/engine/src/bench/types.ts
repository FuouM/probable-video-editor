// Benchmark contract (docs/DESIGN.md section 12), shared by the effect bench files
// (`packages/engine/src/<module>.bench.ts`), the in-page runner (`bench/runner.ts`), the app hook
// (`window.__pve.bench`) and the CLI (`pve bench`, `pve render`).
import type * as THREE from 'three';
import type { Engine } from '../engine';

/** `timer-query`: GPU time from EXT_disjoint_timer_query_webgl2. `fence`: no extension, wall time after a GPU fence. */
export type BenchMethod = 'timer-query' | 'fence';

/** `render`: the summary of a `pve render` (frames.jsonl), not an in-page benchmark. */
export type BenchKind = 'pass' | 'stage' | 'helper' | 'scene' | 'render';

export interface BenchCtx {
  engine: Engine;
  renderer: THREE.WebGLRenderer;
}

/**
 * One effect benchmark. A module `<m>.ts` with effects has a sibling `<m>.bench.ts` that exports
 * `bench: EffectBench[]`. Bench files must import engine runtime code only with dynamic `import()`
 * inside `setup`, so that `bun test` can import them without a DOM.
 */
export interface EffectBench<S = unknown> {
  /** Stable id `<area>.<effect>[.<variant>]`, e.g. `post.down`, `lines.10k`. */
  id: string;
  kind: Exclude<BenchKind, 'scene'>;
  /** Allocate targets and fill inputs once. */
  setup(ctx: BenchCtx): S | Promise<S>;
  /** The GPU work of one iteration. */
  run(ctx: BenchCtx, state: S): void | Promise<void>;
  /** Free what `setup` allocated and restore engine state. */
  dispose?(ctx: BenchCtx, state: S): void;
}

export interface BenchOptions {
  /** Run only benchmarks whose id contains one of these texts. Empty or absent: all. */
  filter?: string[];
  /** Warm-up iterations. Default 5. */
  warmup?: number;
  /** Measured iterations. Default 30. Scene benchmarks always use 8 times with 1 sample each. */
  n?: number;
  /** Include the `scene.<clip id>` benchmarks. Default true. */
  scenes?: boolean;
}

/** One measured benchmark, as the page returns it. Times in milliseconds. */
export interface BenchResult {
  id: string;
  kind: BenchKind;
  method: BenchMethod;
  n: number;
  /** GPU time (timer query) or fenced wall time (fence). */
  medianMs: number;
  p90Ms: number;
  /** First iteration: shader compile and link, texture upload, plus the run, fenced wall time. */
  compileMs: number;
  /** Fenced wall time per iteration (CPU work + GPU wait). Shows CPU-side cost, e.g. readback and layout. */
  wallMedianMs: number;
}

/** What `window.__pve.bench` returns. */
export interface BenchPageResult {
  gpu: string;
  method: BenchMethod;
  scale: number;
  results: BenchResult[];
}

/** One line of bench/results.jsonl: one line per benchmark (DESIGN 12.3). */
export interface BenchRecord extends BenchResult {
  ts: string;
  commit: string;
  dirty: boolean;
  machine: { gpu: string; angle: string; chrome: string; os: string; cpu: string };
  project: string;
  scale: number;
}
