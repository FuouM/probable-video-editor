// Benchmarks of the packed RGB readback (readback.ts): the pack pass and one frame through the pipelined path.
// Engine modules load with import() in setup (bun test imports this file).
import { benchFrames, defineBench, disposeFrames, type BenchFrames } from './bench/kit';
import type { BenchCtx, EffectBench } from './bench/types';

export const bench: EffectBench[] = [
  defineBench({
    id: 'read.rgbPack',
    kind: 'stage',
    setup: ({ engine }) => benchFrames(engine),
    run({ engine, renderer }) {
      const rb = engine.readback;
      rb.rgbPass.u.src!.value = engine.finalRT.texture;
      rb.rgbPass.render(renderer, rb.rgbRT);
    },
    dispose: (_: BenchCtx, f: BenchFrames) => disposeFrames(f),
  }),
  defineBench({
    id: 'read.pipelined',
    kind: 'stage',
    async setup({ engine }) {
      const { PackedReadback } = await import('./readback');
      return { f: await benchFrames(engine), buf: new Uint8Array(PackedReadback.BYTES) };
    },
    // one frame through the pipelined path: pack, queue the copy, wait for the fence, copy out
    async run({ engine }, s) {
      engine.readStart(0);
      await engine.readFinish(0, s.buf);
    },
    dispose: (_, s) => disposeFrames(s.f),
  }),
];
