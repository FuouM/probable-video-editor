// Benchmarks of the DOM interpreter (dom.ts): one window of real HTML and CSS (a title bar with a gradient,
// inset shadows, a list of 12 rows, a text field, two buttons) at 2 canvas px per CSS px.
// `dom.update` changes one line of text, then reads, paints and uploads the window: the cost of a frame where the
// interface changes. `dom.idle` is a frame where it does not change.
// Engine modules load with import() in setup (bun test imports this file).
import { defineBench } from './bench/kit';
import type { EffectBench } from './bench/types';

export const BENCH_CSS = `
body{margin:0;font:13px Arial,sans-serif}
.win{position:absolute;left:20px;top:20px;width:320px;background:#ece9d8;border-radius:8px 8px 0 0;
  box-shadow:inset -1px -1px #00138c,inset 1px 1px #0831d9,inset -2px -2px #001ea0,inset 2px 2px #166aee,2px 4px 12px rgba(0,0,0,.4);padding:0 3px 3px}
.bar{height:28px;padding:0 8px;display:flex;align-items:center;justify-content:space-between;border-radius:8px 8px 0 0;
  background:linear-gradient(180deg,#0997ff,#0053ee 8%,#0050ee 40%,#06f 88%,#06f 93%,#005bff 95%,#003dd7 96%,#003dd7);
  color:#fff;font-weight:700;text-shadow:1px 1px #0f1089}
.bar i{display:block;width:21px;height:21px;border-radius:3px;border:1px solid #fff;background:radial-gradient(circle at 90% 90%,#cc4600 0,#dc6527 55%,#cd7546 70%,#ffccb2 90%,#fff 100%)}
.body{padding:8px}
.row{display:flex;align-items:center;gap:6px;padding:2px 4px;border-bottom:1px solid #d0d0bf}
.row::before{content:"";width:9px;height:9px;border-radius:50%;background:#9c9c9c}
input{flex:1;border:1px solid #7f9db9;padding:3px 4px;font:inherit}
button{min-width:75px;min-height:23px;border:1px solid #003c74;border-radius:3px;background:linear-gradient(180deg,#fff,#ecebe5 86%,#d8d0c4);box-shadow:none;font:inherit}
.foot{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}`;

export const BENCH_HTML = `<div class="win" id="w"><div class="bar"><span>Messenger</span><i></i></div><div class="body">
${Array.from({ length: 12 }, (_, k) => `<div class="row"><span>friend ${k + 1}</span><span${k === 0 ? ' id="line"' : ''}>has signed out</span></div>`).join('')}
<div class="foot"><input type="text" value="are you there?"><button>Send</button><button>Close</button></div></div></div>`;

async function open() {
  const { DomUi } = await import('./dom');
  const ui = await DomUi.create({ html: BENCH_HTML, css: [BENCH_CSS], width: 640, height: 480 });
  const surface = ui.surface('#w', { res: 2 });
  surface.update();
  return { ui, surface, k: 0 };
}

const update = defineBench({
  id: 'dom.update',
  kind: 'helper',
  setup: open,
  run({ renderer }, s) {
    s.ui.$('#line').textContent = `is typing ${s.k++ % 10}`;
    s.surface.update();
    renderer.initTexture(s.surface.texture);
  },
  dispose(_, s) { s.ui.dispose(); },
});

const idle = defineBench({
  id: 'dom.idle',
  kind: 'helper',
  setup: open,
  run(_, s) { s.surface.update(); },
  dispose(_, s) { s.ui.dispose(); },
});

export const bench: EffectBench[] = [update, idle];
