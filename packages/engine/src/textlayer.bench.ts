// Benchmarks of TextLayer (textlayer.ts): rectangle, pixel and shade fills over the 640x360 layer and the texture
// upload of the commit. Engine modules load with import() in setup (bun test imports this file).
import { defineBench, rng } from './bench/kit';
import type { EffectBench } from './bench/types';

const fill = defineBench({
  id: 'textlayer.fill',
  kind: 'helper',
  async setup() {
    const { TextLayer } = await import('./textlayer');
    const l = new TextLayer();
    const r = rng(3);
    const rects = Array.from({ length: 200 }, () => [r() * 600, r() * 340, 4 + r() * 80, 2 + r() * 30] as const);
    return { l, rects };
  },
  run({ renderer }, s) {
    const l = s.l;
    l.clear();
    for (const [x, y, w, h] of s.rects) l.rect(x, y, w, h, '#e8f0ff', 0.9);
    for (let i = 0; i < 4000; i++) l.put((i * 37) % 640, (i * 13) % 360, '#ff3020');
    l.shade(100, 80, 440, 200, 0.5);
    l.commit();
    renderer.initTexture(l.tex);
  },
  dispose(_, s) { s.l.dispose(); },
});

export const bench: EffectBench[] = [fill];
