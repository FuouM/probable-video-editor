// Benchmark of the stroke fonts (stroke.ts): lay out a lyric line, write it into a Layer2D, upload and
// sample it. Engine modules load with import() in setup (bun test imports this file).
import { defineBench, longestLine } from './bench/kit';
import type { EffectBench } from './bench/types';

export const bench: EffectBench[] = [
  defineBench({
    id: 'stroke.text',
    kind: 'helper',
    async setup({ engine }) {
      const [{ Layer2D, makeRT, H }, stroke] = await Promise.all([import('./gl'), import('./stroke')]);
      return { layer: new Layer2D(), rt: makeRT(), line: longestLine(engine), y: H / 2, stroke };
    },
    run({ engine, renderer }, s) {
      const st = s.stroke.strokeText(s.line, 'script', 72);
      const L = s.layer, c = L.ctx;
      L.clear();
      c.save();
      c.translate(80, s.y);
      c.strokeStyle = '#e8e2d4';
      c.lineWidth = 2;
      c.lineCap = c.lineJoin = 'round';
      s.stroke.drawStrokeText(c, st, st.total);
      c.restore();
      engine.comp.draw(renderer, L.upload(), s.rt);
    },
    dispose(_, s) {
      s.layer.texture.dispose();
      s.rt.dispose();
    },
  }),
];
