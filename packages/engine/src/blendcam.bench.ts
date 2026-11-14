// Benchmarks of BlendCamera (blendcam.ts): a small lit scene drawn through a half orthographic, half perspective projection into a
// frame-sized target. Engine modules load with import() in setup (bun test imports this file).
import { defineBench } from './bench/kit';
import type { EffectBench } from './bench/types';

const blend = defineBench({
  id: 'blendcam.half',
  kind: 'helper',
  async setup() {
    const [THREE, lit, { BlendCamera }, { makeRT }] = await Promise.all([import('three'), import('./lit'), import('./blendcam'), import('./gl')]);
    const a = new lit.LitAtlas(64);
    const face = lit.allFaces({ cell: a.solid('#a0b8d0') });
    const b = new lit.Builder();
    for (let i = 0; i < 16; i++) b.box(2, 2 + (i % 4), 2, face, lit.at((i % 4) * 5 - 8, 0, -Math.floor(i / 4) * 5 - 10));
    const mat = lit.litMaterial(a);
    const mesh = lit.litMesh(b, mat, { cast: false, receive: false });
    const sc = new THREE.Scene();
    sc.add(mesh, lit.ambient('#c0d0f0', '#403020', 1));
    const cam = new BlendCamera(30, 16 / 9, 0.2, 500);
    cam.position.set(0, 20, 20);
    cam.lookAt(0, 0, -15);
    cam.mix = 0.5;
    cam.aimDist = 40;
    const out = makeRT();
    return { sc, cam, out, mesh, mat, a };
  },
  run({ renderer }, s) {
    s.cam.updateProjectionMatrix();
    renderer.setRenderTarget(s.out);
    renderer.render(s.sc, s.cam);
  },
  dispose({ renderer }, s) {
    s.out.dispose();
    s.mesh.geometry.dispose();
    s.mat.dispose();
    s.a.dispose();
    renderer.setRenderTarget(null);
  },
});

export const bench: EffectBench[] = [blend];
