// Benchmarks of Mosh (mosh.ts): one step of the chain (the position pass of a small lit scene and the warp) and the output pass.
// Engine modules load with import() in setup (bun test imports this file).
import { defineBench } from './bench/kit';
import type { EffectBench } from './bench/types';

const step = defineBench({
  id: 'mosh.step',
  kind: 'stage',
  async setup({ renderer }) {
    const [THREE, lit, { Mosh }, { TextLayer }, { makeRT }] = await Promise.all([
      import('three'), import('./lit'), import('./mosh'), import('./textlayer'), import('./gl'),
    ]);
    const a = new lit.LitAtlas(64);
    const face = lit.allFaces({ cell: a.solid('#8090a0') });
    const b = new lit.Builder();
    for (let i = 0; i < 12; i++) b.box(2, 3 + (i % 3), 2, face, lit.at(i * 4 - 24, 0, -20));
    const mat = lit.litMaterial(a);
    const mesh = lit.litMesh(b, mat, { cast: false, receive: false });
    const sc = new THREE.Scene();
    sc.add(mesh, lit.ambient('#c0d0f0', '#403020', 1));
    const cam = lit.camera(52, 0.2, 500), prev = lit.camera(52, 0.2, 500);
    cam.position.set(0.3, 3, 10);
    prev.position.set(0, 3, 10);
    cam.updateMatrixWorld(true);
    prev.updateMatrixWorld(true);
    const key = new TextLayer();
    key.rect(0, 0, lit.LW, lit.LH, '#0000aa');
    key.commit();
    const m = new Mosh();
    m.start(renderer, key.tex);
    const pic = makeRT(), out = makeRT();
    return { m, sc, cam, prev, key, pic, out, mesh, mat, a };
  },
  run({ renderer }, s) {
    s.m.step(renderer, s.sc, s.cam, s.prev, [0, 10, 640, 340]);
    s.m.present(renderer, s.out, s.pic.texture, 0.5);
  },
  dispose({ renderer }, s) {
    s.m.dispose();
    s.key.dispose();
    s.pic.dispose();
    s.out.dispose();
    s.mesh.geometry.dispose();
    s.mat.dispose();
    s.a.dispose();
    renderer.setRenderTarget(null);
  },
});

export const bench: EffectBench[] = [step];
