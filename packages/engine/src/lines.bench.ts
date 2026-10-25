// Benchmarks of LineBatch (lines.ts): random short segments in a 1920x1080-layout HDR target, re-uploaded
// and drawn each iteration as scenes do. Engine modules load with import() in setup (bun test imports this file).
import { defineBench, rng } from './bench/kit';
import type { EffectBench } from './bench/types';

function lines(id: string, count: number) {
  return defineBench({
    id,
    kind: 'helper',
    async setup({ renderer }) {
      const [{ LineBatch }, { makeRT, clearRT, W, H }] = await Promise.all([import('./lines'), import('./gl')]);
      const rt = makeRT();
      clearRT(renderer, rt);
      const batch = new LineBatch(count);
      const r = rng(count);
      for (let i = 0; i < count; i++) {
        const x = r() * W, y = r() * H, a = r() * Math.PI * 2, l = 4 + r() * 40;
        batch.seg2(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.6 + r() * 1.8, [0.05 + r() * 0.4, 0.05 + r() * 0.3, 0.05 + r() * 0.2], 0.6);
      }
      return { rt, batch };
    },
    run: ({ renderer }, s) => s.batch.render(renderer, s.rt),
    dispose(_, s) {
      s.rt.dispose();
      s.batch.geo.dispose();
      s.batch.mat.dispose();
    },
  });
}

export const bench: EffectBench[] = [lines('lines.10k', 10_000), lines('lines.200k', 200_000)];
