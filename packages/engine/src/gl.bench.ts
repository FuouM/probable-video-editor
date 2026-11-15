// Benchmark of Layer2D (gl.ts): Canvas2D drawing, upload(), and a draw that samples the texture so the
// upload happens. Engine modules load with import() in setup (bun test imports this file).
import { defineBench, longestLine } from './bench/kit';
import { mulberry32 } from './util';
import type { EffectBench } from './bench/types';

export const bench: EffectBench[] = [
  defineBench({
    id: 'layer2d.upload',
    kind: 'helper',
    async setup({ engine }) {
      const [{ Layer2D, makeRT, W, H }, { F, font }] = await Promise.all([import('./gl'), import('./type')]);
      const r = mulberry32(7);
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
  defineBench({
    id: 'gl.missing',
    kind: 'helper',
    async setup() {
      const [{ missingMaterial, makeRT }, THREE] = await Promise.all([import('./gl'), import('three')]);
      const mat = missingMaterial(0.25);
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.Mesh(geo, mat);
      const scene = new THREE.Scene();
      scene.add(mesh);
      const cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
      cam.position.set(2, 2, 2);
      cam.lookAt(0, 0, 0);
      const rt = makeRT(640, 360);
      return { scene, cam, rt, geo, mat };
    },
    run({ renderer }, s) {
      renderer.setRenderTarget(s.rt);
      renderer.render(s.scene, s.cam);
    },
    dispose(_, s) {
      s.geo.dispose();
      s.mat.dispose();
      s.rt.dispose();
    },
  }),
];
