// In-page GPU benchmark (docs/DESIGN.md section 12): runs the registry and one `scene.<clip id>` benchmark
// per loaded timeline entry against the live engine. With EXT_disjoint_timer_query_webgl2 each iteration
// is one TIME_ELAPSED query (method `timer-query`); without it the time is the wall time up to the GPU
// sync (method `fence`). Every iteration ends with a GPU sync: a 1-pixel readback, which blocks until
// every command queued before it has run (WebGL caps clientWaitSync timeouts at 0, so a real fence wait
// would need event-loop polls that add timer delay to the wall time).
import * as THREE from 'three';
import type { Engine } from '../engine';
import { clearRT, SCALE } from '../gl';
import { BENCH } from './registry';
import type { BenchCtx, BenchKind, BenchMethod, BenchOptions, BenchPageResult, BenchResult } from './types';

/** The constants of EXT_disjoint_timer_query_webgl2 that the runner uses. */
interface TimerQueryExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

/** Batches measured again when the GPU reports a disjoint event (clock change, context switch). */
const DISJOINT_RETRIES = 3;
/** Longest wait for a batch's query results. */
const RESULT_TIMEOUT_MS = 10_000;
/** Scene benchmarks: times per timeline entry, one sample each. */
const SCENE_TIMES = 8;
const DT = 1 / 60;

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2;
}

/** Nearest-rank 90th percentile. */
function p90(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.9 * s.length) - 1)]!;
}

export async function runBench(engine: Engine, opts: BenchOptions = {}): Promise<BenchPageResult> {
  const renderer = engine.renderer, gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
  const method: BenchMethod = ext ? 'timer-query' : 'fence';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  const warmup = opts.warmup ?? 5, n = opts.n ?? 30;
  const wanted = (id: string) => !opts.filter?.length || opts.filter.some((f) => id.includes(f));

  const syncRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false });
  clearRT(renderer, syncRT);
  const px = new Uint8Array(4);
  const sync = () => renderer.readRenderTargetPixels(syncRT, 0, 0, 1, 1, px);

  /** Wall time of one call plus the GPU sync. */
  const timed = async (run: () => void | Promise<void>) => {
    const t0 = performance.now();
    await run();
    sync();
    return performance.now() - t0;
  };

  /** Query results arrive only after control returns to the event loop: yield between polls. */
  const collect = async (qs: WebGLQuery[]) => {
    const deadline = performance.now() + RESULT_TIMEOUT_MS;
    for (const q of qs)
      while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
        if (performance.now() > deadline) throw new Error('bench: timer query results did not arrive');
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 0);
        await promise;
      }
    return qs.map((q) => (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6);
  };

  /**
   * `count` measured iterations of `run(i)`, each in its own TIME_ELAPSED query (no nesting) and followed
   * by a GPU sync. `pre(i)` runs before iteration i, outside the measurement. A batch with a disjoint
   * event is measured again.
   */
  const measure = async (id: string, kind: BenchKind, compileMs: number, count: number, run: (i: number) => void | Promise<void>, pre?: (i: number) => void): Promise<BenchResult> => {
    for (let attempt = 0; attempt <= DISJOINT_RETRIES; attempt++) {
      if (ext) gl.getParameter(ext.GPU_DISJOINT_EXT); // (reading the flag clears it)
      const qs: WebGLQuery[] = [], wall: number[] = [];
      try {
        for (let i = 0; i < count; i++) {
          if (pre) { pre(i); sync(); }
          const q = ext ? gl.createQuery() : null;
          if (ext && q) { gl.beginQuery(ext.TIME_ELAPSED_EXT, q); qs.push(q); }
          const t0 = performance.now();
          await run(i);
          if (ext && q) gl.endQuery(ext.TIME_ELAPSED_EXT);
          sync();
          wall.push(performance.now() - t0);
        }
        const times = ext ? await collect(qs) : wall;
        if (ext && gl.getParameter(ext.GPU_DISJOINT_EXT)) continue;
        return { id, kind, method, n: count, medianMs: median(times), p90Ms: p90(times), compileMs, wallMedianMs: median(wall) };
      } finally {
        for (const q of qs) gl.deleteQuery(q);
      }
    }
    throw new Error(`bench: ${id}: GPU disjoint event in every one of ${DISJOINT_RETRIES + 1} batches`);
  };

  const ctx: BenchCtx = { engine, renderer };
  const results: BenchResult[] = [];
  try {
    for (const b of BENCH) {
      if (!wanted(b.id)) continue;
      const state = await b.setup(ctx);
      try {
        // the first iteration: shader compile and link, texture upload, plus the run
        const compileMs = await timed(() => b.run(ctx, state));
        for (let i = 0; i < warmup; i++) await timed(() => b.run(ctx, state));
        results.push(await measure(b.id, b.kind, compileMs, n, () => b.run(ctx, state)));
      } finally {
        b.dispose?.(ctx, state);
      }
    }

    if (opts.scenes !== false)
      for (const e of engine.timeline) {
        const id = `scene.${e.id}`;
        if (!engine.loaded.get(e.id)?.scene || !wanted(id)) continue;
        // evenly inside the entry, off its edges. Each measured frame follows an unmeasured frame one step
        // before it, so it is a sequential frame (no seek, no preroll of stateful scenes).
        const times = Array.from({ length: SCENE_TIMES }, (_, i) => e.start + ((e.end - e.start) * (i + 0.5)) / SCENE_TIMES);
        const compileMs = await timed(() => { engine.render(times[0]!, DT, false, 1, 0.5); });
        results.push(await measure(id, 'scene', compileMs, SCENE_TIMES,
          (i) => { engine.render(times[i]!, DT, false, 1, 0.5); },
          (i) => { engine.render(times[i]! - DT, DT, false, 1, 0.5); }));
      }
  } finally {
    syncRT.dispose();
  }

  return { gpu, method, scale: SCALE, results };
}
