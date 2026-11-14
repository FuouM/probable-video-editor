// Benchmarks of TextMode (textmode.ts): the read of a frame-sized picture down to the grid (GPU pass and read-back) and the draw of
// the grid and a burst into the text layer. Engine modules load with import() in setup (bun test imports this file).
import { defineBench } from './bench/kit';
import type { EffectBench } from './bench/types';

const frame = defineBench({
  id: 'textmode.frame',
  kind: 'stage',
  async setup({ renderer }) {
    const [{ TextMode, WHOLE }, { TextLayer }, { makeRT, clearRT }] = await Promise.all([import('./textmode'), import('./textlayer'), import('./gl')]);
    const src = makeRT();
    clearRT(renderer, src, [0.4, 0.5, 0.7]);
    return { tm: new TextMode(1 / 36), l: new TextLayer(), src, whole: WHOLE };
  },
  run({ renderer }, s) {
    s.tm.read(renderer, s.src.texture);
    s.tm.draw(s.l, s.whole);
    s.tm.burst(s.l, 320, 180, 30, 0.2, 7);
    s.l.commit();
    renderer.initTexture(s.l.tex);
  },
  dispose({ renderer }, s) {
    s.tm.dispose();
    s.l.dispose();
    s.src.dispose();
    renderer.setRenderTarget(null);
  },
});

export const bench: EffectBench[] = [frame];
