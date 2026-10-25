// Benchmark of the storyboard card (storyboard.ts): one card frame (text, counter, lyric line, layer upload and
// composite) at the middle of the first loaded timeline entry. Engine modules load with import() in setup
// (bun test imports this file).
import { benchFrames, defineBench, disposeFrames } from './bench/kit';
import type { EffectBench } from './bench/types';

export const bench: EffectBench[] = [
  defineBench({
    id: 'storyboard.card',
    kind: 'helper',
    async setup({ engine }) {
      const [{ makeRT }, { StoryboardCard }] = await Promise.all([import('./gl'), import('./storyboard')]);
      const f = await benchFrames(engine);
      const e = engine.timeline[0]!;
      const card = new StoryboardCard({ ...engine.ctx, id: 'bench', params: { brief: 'A bench card: a brief long enough to wrap onto a second line of the card, as a real brief does.' }, start: e.start, end: e.end });
      await card.init();
      return { f, card, rt: makeRT(), frame: engine.frameFor(e, f.t, 1 / 60, false, false, null, 1, 0) };
    },
    run(_, s) {
      s.card.render(s.frame, s.rt);
    },
    dispose(_, s) {
      s.card.dispose();
      disposeFrames(s.f);
      s.rt.dispose();
    },
  }),
];
