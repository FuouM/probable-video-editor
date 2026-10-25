// Benchmark of the engine's Hud (hud.ts): one frame of the crop marks and the project overlay (with no
// overlay values) and a draw that samples the layer so the upload happens. Engine modules load with
// import() in setup (bun test imports this file).
import { benchFrames, defineBench, disposeFrames } from './bench/kit';
import type { EffectBench } from './bench/types';

export const bench: EffectBench[] = [
  defineBench({
    id: 'hud.render',
    kind: 'stage',
    async setup({ engine }) {
      const { makeRT } = await import('./gl');
      return { f: await benchFrames(engine), rt: makeRT() };
    },
    run({ engine, renderer }, s) {
      const tex = engine.hud.draw(s.f.t, { opacity: 1, frame: 1, paper: 0, overlay: {} });
      engine.comp.draw(renderer, tex, s.rt);
    },
    dispose(_, s) {
      disposeFrames(s.f);
      s.rt.dispose();
    },
  }),
];
