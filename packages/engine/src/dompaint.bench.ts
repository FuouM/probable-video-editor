// Benchmark of the painter of the DOM interpreter (dompaint.ts): the display list of the window of dom.bench.ts,
// painted on a canvas at 2 canvas px per CSS px. No read of the DOM and no upload.
// Engine modules load with import() in setup (bun test imports this file).
import { defineBench } from './bench/kit';
import type { EffectBench } from './bench/types';
import { BENCH_CSS, BENCH_HTML } from './dom.bench';

const list = defineBench({
  id: 'dom.paint',
  kind: 'helper',
  async setup() {
    const [{ DomUi }, { paint }] = await Promise.all([import('./dom'), import('./dompaint')]);
    const ui = await DomUi.create({ html: BENCH_HTML, css: [BENCH_CSS], width: 640, height: 480 });
    const surface = ui.surface('#w', { res: 2 });
    surface.update();
    const canvas = ui.doc.createElement('canvas');
    canvas.width = surface.canvas.width;
    canvas.height = surface.canvas.height;
    const c = canvas.getContext('2d', { willReadFrequently: true })!;
    return { ui, surface, c, paint, canvas };
  },
  run(_, s) {
    const { c } = s;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, s.canvas.width, s.canvas.height);
    c.setTransform(2, 0, 0, 2, 40, 40);
    s.paint(c, s.surface.node!, { res: 2, image: s.ui.image, unsized: s.ui.unsized });
    // the software canvas draws when it is read
    c.getImageData(0, 0, 1, 1);
  },
  dispose(_, s) { s.ui.dispose(); },
});

export const bench: EffectBench[] = [list];
