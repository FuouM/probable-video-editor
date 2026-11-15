// Benchmarks of the engine's own stages (engine.ts): the sub-frame sum, the crossfade and screen blit, and
// the frame readbacks (the tile passes are in tiles.bench.ts, the packed readback in readback.bench.ts).
// Engine modules load with import() in setup (bun test imports this file).
import { benchFrames, defineBench, disposeFrames, type BenchFrames } from './bench/kit';
import type { BenchCtx, EffectBench } from './bench/types';

const dispose = (_: BenchCtx, f: BenchFrames) => disposeFrames(f);

export const bench: EffectBench[] = [
  defineBench({
    id: 'blur.accum',
    kind: 'stage',
    async setup({ engine, renderer }) {
      const { clearRT } = await import('./gl');
      const f = await benchFrames(engine);
      clearRT(renderer, engine.sumRT, [0, 0, 0], 0);
      return f;
    },
    run({ engine, renderer }, f) {
      engine.accum.u.src!.value = f.input.texture;
      engine.accum.render(renderer, engine.sumRT);
    },
    dispose,
  }),
  defineBench({
    id: 'engine.xfade',
    kind: 'pass',
    setup: ({ engine }) => benchFrames(engine),
    run({ engine, renderer }, f) {
      const u = engine.xfade.u;
      u.a!.value = f.input.texture;
      u.b!.value = f.input2.texture;
      u.k!.value = 0.5;
      engine.xfade.render(renderer, engine.mixRT);
    },
    dispose,
  }),
  defineBench({
    id: 'engine.blit',
    kind: 'pass',
    setup: ({ engine }) => benchFrames(engine),
    run({ engine, renderer }) {
      engine.blit.u.src!.value = engine.finalRT.texture;
      engine.blit.render(renderer, null);
    },
    dispose,
  }),
  defineBench({
    id: 'read.sync',
    kind: 'stage',
    async setup({ engine }) {
      const { PW, PH } = await import('./gl');
      return { f: await benchFrames(engine), buf: new Uint8Array(PW * PH * 4) };
    },
    run: ({ engine }, s) => { engine.readPixels(s.buf); },
    dispose: (_, s) => disposeFrames(s.f),
  }),
  defineBench({
    id: 'read.async',
    kind: 'stage',
    async setup({ engine }) {
      const { PW, PH } = await import('./gl');
      return { f: await benchFrames(engine), buf: new Uint8Array(PW * PH * 4) };
    },
    async run({ engine }, s) { await engine.readPixelsAsync(s.buf); },
    dispose: (_, s) => disposeFrames(s.f),
  }),
];
