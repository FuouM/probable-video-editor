// Benchmarks of the CRT glass (crt.ts): the tube pass of a frame-sized picture with a title layer, and the plot of the glass cracks.
// Engine modules load with import() in setup (bun test imports this file).
import { defineBench } from './bench/kit';
import type { EffectBench } from './bench/types';

const tube = defineBench({
  id: 'crt.tube',
  kind: 'pass',
  async setup({ renderer }) {
    const [{ CrtTube, TUBE_PLAIN }, { TextLayer }, { makeRT, clearRT }] = await Promise.all([import('./crt'), import('./textlayer'), import('./gl')]);
    const game = makeRT();
    clearRT(renderer, game, [0.3, 0.5, 0.8]);
    const title = new TextLayer();
    title.rect(100, 100, 440, 60, '#f6efdc');
    title.commit();
    return { t: new CrtTube(), game, title, plain: TUBE_PLAIN };
  },
  run({ renderer }, s) {
    s.t.draw(renderer, s.game.texture, { ...s.plain, title: s.title.tex, power: 0.6, fit: { weight: 0.5, exposure: 1 } });
  },
  dispose({ renderer }, s) {
    s.t.dispose();
    s.game.dispose();
    s.title.dispose();
    renderer.setRenderTarget(null);
  },
});

const crack = defineBench({
  id: 'crt.crack',
  kind: 'helper',
  async setup() {
    const [{ plotGlassCrack }, { TextLayer }] = await Promise.all([import('./crt'), import('./textlayer')]);
    return { plotGlassCrack, l: new TextLayer() };
  },
  run({ renderer }, s) {
    s.l.clear();
    s.plotGlassCrack(s.l, [400, 140]);
    s.l.commit();
    renderer.initTexture(s.l.tex);
  },
  dispose(_, s) {
    s.l.dispose();
  },
});

export const bench: EffectBench[] = [tube, crack];
