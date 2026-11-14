// Benchmarks of the chunked unloading world (chunks.ts): the cut of a lit geometry into chunks, and a draw of the cut world with the
// unload material while half of it drops. Engine modules load with import() in setup (bun test imports this file).
import { defineBench } from './bench/kit';
import type { EffectBench } from './bench/types';

const GRID = { x: 6, z: 12, x0: -120, nix: 40, niz: 20, iz0: 10, pivotY: 2, check: 0.55 };

async function world() {
  const [THREE, lit, chunks] = await Promise.all([import('three'), import('./lit'), import('./chunks')]);
  const a = new lit.LitAtlas(64);
  const face = lit.allFaces({ cell: a.solid('#90a080') });
  const b = new lit.Builder();
  b.box(200, 1, 100, face, lit.at(0, -0.5, 0));
  for (let i = 0; i < 24; i++) b.box(6, 4 + (i % 5), 6, face, lit.at((i % 6) * 18 - 50, 0, Math.floor(i / 6) * 18 - 30));
  const src = b.geometry();
  const grid = new chunks.ChunkGrid(GRID);
  return { THREE, lit, chunks, a, src, grid };
}

const cut = defineBench({
  id: 'chunks.cut',
  kind: 'helper',
  async setup() {
    const w = await world();
    return { ...w, m: new w.THREE.Matrix4() };
  },
  run(_, s) {
    s.chunks.chunkArrays(s.grid, s.src, s.m, 0, null);
  },
  dispose(_, s) {
    s.src.dispose();
    s.a.dispose();
  },
});

const draw = defineBench({
  id: 'chunks.unload',
  kind: 'stage',
  async setup() {
    const w = await world();
    const { THREE, lit, chunks } = w;
    const { makeRT } = await import('./gl');
    const un = new chunks.Unload(w.grid, (x) => (x < 0 ? 0 : chunks.NEVER), () => chunks.NEVER, (x) => (x < 0 ? 0 : chunks.NEVER));
    un.uT.value = 1.2;
    const mat = chunks.unloadMaterial(w.a, un, new THREE.Vector3(0, 0, 0));
    const mesh = new THREE.Mesh(chunks.chunkGeometry(w.grid, w.src, new THREE.Matrix4(), 0, null), mat);
    mesh.frustumCulled = false;
    const sc = new THREE.Scene();
    sc.add(mesh, lit.ambient('#c0d0f0', '#403020', 1));
    const cam = lit.camera(52, 0.2, 1000);
    cam.position.set(0, 40, 90);
    cam.lookAt(0, 0, 0);
    const out = makeRT();
    return { ...w, un, mat, mesh, sc, cam, out };
  },
  run({ renderer }, s) {
    renderer.setRenderTarget(s.out);
    renderer.render(s.sc, s.cam);
  },
  dispose({ renderer }, s) {
    s.out.dispose();
    s.mesh.geometry.dispose();
    s.mat.dispose();
    s.un.tex.dispose();
    s.src.dispose();
    s.a.dispose();
    renderer.setRenderTarget(null);
  },
});

export const bench: EffectBench[] = [cut, draw];
