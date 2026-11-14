// Benchmark of the pixel UI (ui.ts): a toolbar of bevelled buttons, outlined text, lines, rings and the arrow cursor
// over the 640x360 TextLayer, with the texture upload. Engine modules load with import() in setup (bun test imports this file).
import { defineBench } from './bench/kit';
import type { EffectBench } from './bench/types';

const bar = defineBench({
  id: 'ui.bar',
  kind: 'helper',
  async setup() {
    const [{ Ui }, { TextLayer }, { PixelFont, F }] = await Promise.all([import('./ui'), import('./textlayer'), import('./type')]);
    const l = new TextLayer();
    const ui = new Ui(l, PixelFont.from(F.mono(400), 8));
    return { l, ui };
  },
  run({ renderer }, s) {
    const { l, ui } = s;
    l.clear();
    ui.rect(0, 0, 640, 22, '#5d5a78');
    for (let k = 0; k < 24; k++) ui.key(4 + k * 22, 2, 20, 18, k % 4 === 0 ? 'on' : k % 3 === 0 ? 'hover' : 'up', k % 2 === 0);
    for (let k = 0; k < 8; k++) ui.bevel(20 + k * 70, 60, 60, 24, k % 2 === 1);
    for (let k = 0; k < 12; k++) ui.text('STATUS LINE 12 OK', 20, 100 + k * 18, '#ffffff', '#201e2e', 1 + (k % 2));
    for (let k = 0; k < 40; k++) ui.line(320, 180, 320 + Math.round(Math.cos(k) * 150), 180 + Math.round(Math.sin(k) * 150), '#c8ccd4');
    for (let k = 0; k < 10; k++) { ui.ring(500, 260, 4 + k * 3, '#f0f0f0'); ui.circle(560, 260, 4 + k * 3, '#e03030'); }
    ui.arrow(300, 200);
    l.commit();
    renderer.initTexture(l.tex);
  },
  dispose(_, s) { s.l.dispose(); },
});

export const bench: EffectBench[] = [bar];
