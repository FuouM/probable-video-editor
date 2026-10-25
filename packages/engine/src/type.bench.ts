// Benchmark of type layout (type.ts): per-glyph layout of a lyric line. CPU work: the GPU time is near 0,
// wallMedianMs carries the cost. Engine modules load with import() in setup (bun test imports this file).
import { defineBench, longestLine } from './bench/kit';
import type { EffectBench } from './bench/types';

export const bench: EffectBench[] = [
  defineBench({
    id: 'type.layout',
    kind: 'helper',
    async setup({ engine }) {
      const { layout, F } = await import('./type');
      return { layout, family: F.archivo(100, 700), line: longestLine(engine) };
    },
    run: (_, s) => { s.layout(s.line, s.family, 96); },
  }),
];
