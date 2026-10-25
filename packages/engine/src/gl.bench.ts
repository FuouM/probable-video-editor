// Benchmark of Layer2D (gl.ts): Canvas2D drawing, upload(), and a draw that samples the texture so the
// upload happens. Engine modules load with import() in setup (bun test imports this file).
import { defineBench, longestLine, rng } from './bench/kit';
import type { EffectBench } from './bench/types';

export const bench: EffectBench[] = [
  defineBench({
    id: 'layer2d.upload',
    kind: 'helper',
    async setup({ engine }) {
      const [{ Layer2D, makeRT, W, H }, { F, font }] = await Promise.all([import('./gl'), import('./type')]);
      const r = rng(7);
      return {
        layer: new Layer2D(),
        rt: makeRT(),
        line: longestLine(engine),
        font: font(F.archivo(100, 700), 72),
        y: H / 2,
        boxes: Array.from({ length: 40 }, () => [r() * W, r() * H, 20 + r() * 300, 20 + r() * 200] as const),
      };
    },
    run({ engine, renderer }, s) {
      const L = s.layer, c = L.ctx;
      L.clear();
      c.fillStyle = 'rgba(232, 226, 212, 0.5)';
      for (const [x, y, w, h] of s.boxes) c.fillRect(x, y, w, h);
      c.font = s.font;
      c.fillStyle = '#e8e2d4';
      c.fillText(s.line, 80, s.y);
      engine.comp.draw(renderer, L.upload(), s.rt);
    },
    dispose(_, s) {
      s.layer.texture.dispose();
      s.rt.dispose();
    },
  }),
];
