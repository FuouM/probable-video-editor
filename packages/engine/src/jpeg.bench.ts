// Benchmark of the GPU JPEG degradation pipeline (jpeg.ts).
import type * as THREE from 'three';
import type { Jpeg } from './jpeg';
import { benchFrames, defineBench, disposeFrames, type BenchFrames } from './bench/kit';
import type { EffectBench } from './bench/types';

interface JpegBenchState {
  frames: BenchFrames;
  jpeg: Jpeg;
  rt: THREE.WebGLRenderTarget;
}

export const bench: EffectBench[] = [
  defineBench<JpegBenchState>({
    id: 'jpeg.1pass',
    kind: 'pass',
    async setup({ engine }) {
      const [{ Jpeg }, { makeRT }, frames] = await Promise.all([
        import('./jpeg'),
        import('./gl'),
        benchFrames(engine),
      ]);
      return { frames, jpeg: new Jpeg(), rt: makeRT() };
    },
    run({ renderer }, s) {
      s.jpeg.render(renderer, s.frames.input.texture, s.rt, { quality: 50, passes: 1 });
    },
    dispose(_, s) {
      s.jpeg.dispose();
      s.rt.dispose();
      disposeFrames(s.frames);
    },
  }),
  defineBench<JpegBenchState>({
    id: 'jpeg.2pass',
    kind: 'pass',
    async setup({ engine }) {
      const [{ Jpeg }, { makeRT }, frames] = await Promise.all([
        import('./jpeg'),
        import('./gl'),
        benchFrames(engine),
      ]);
      return { frames, jpeg: new Jpeg(), rt: makeRT() };
    },
    run({ renderer }, s) {
      s.jpeg.render(renderer, s.frames.input.texture, s.rt, { quality: 25, passes: 2 });
    },
    dispose(_, s) {
      s.jpeg.dispose();
      s.rt.dispose();
      disposeFrames(s.frames);
    },
  }),
];
