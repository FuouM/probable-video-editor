// Benchmark of Frost (frost.ts): the sorted pixel list of a 640x340 picture written on the text layer at full growth, and
// the texture upload of the commit. Engine modules load with import() in setup (bun test imports this file).
import { defineBench } from './bench/kit';
import type { EffectBench } from './bench/types';

const full = defineBench({
  id: 'frost.full',
  kind: 'helper',
  async setup() {
    const { Frost } = await import('./frost');
    const { TextLayer } = await import('./textlayer');
    return { frost: new Frost(640, 340, 80), l: new TextLayer() };
  },
  run({ renderer }, s) {
    s.l.clear();
    s.frost.draw(s.l, 0, 10, 1);
    s.l.commit();
    renderer.initTexture(s.l.tex);
  },
  dispose(_, s) { s.l.dispose(); },
});

export const bench: EffectBench[] = [full];
