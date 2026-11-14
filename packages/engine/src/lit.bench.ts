// Benchmarks of the lit kit (lit.ts): an atlas repaint with its upload, and a grid of lit boxes under a sun with a
// shadow map rendered into a 640x360 HDR target. Engine modules load with import() in setup (bun test imports this file).
import { defineBench, rng } from './bench/kit';
import type { EffectBench } from './bench/types';

const atlas = defineBench({
  id: 'lit.atlas',
  kind: 'helper',
  async setup() {
    const { LitAtlas } = await import('./lit');
    const a = new LitAtlas(1024);
    const r = rng(7);
    const cells = Array.from({ length: 64 }, () => a.paint(32, 32, (p) => p.fill(Math.floor(r() * 0xffffff))));
    return { a, cells, r };
  },
  run({ renderer }, s) {
    for (const c of s.cells) s.a.repaint(c, (p) => p.speckle(Math.floor(s.r() * 0xffffff), 0.3, Math.floor(s.r() * 1e6)));
    renderer.initTexture(s.a.tex);
  },
  dispose(_, s) { s.a.dispose(); },
});

const scene = defineBench({
  id: 'lit.scene',
  kind: 'helper',
  async setup({ renderer }) {
    const [THREE, lit] = await Promise.all([import('three'), import('./lit')]);
    const shadow = { enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type };
    lit.enableShadows(renderer);
    const a = new lit.LitAtlas(256);
    const r = rng(11);
    const faces = Array.from({ length: 8 }, () => lit.allFaces({ cell: a.paint(8, 8, (p) => { p.fill(Math.floor(r() * 0xffffff)); p.rect(2, 2, 3, 3, '#ffd9a0', 3); }) }));
    const b = new lit.Builder();
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) b.box(1.5, 1 + r() * 6, 1.5, faces[(i * 20 + j) % 8]!, lit.at(i * 3 - 30, 0, j * 3 - 30, r() * 3));
    b.box(80, 0.2, 80, faces[0]!, lit.at(0, -0.2, 0));
    const mat = lit.litMaterial(a);
    const sc = new THREE.Scene();
    const mesh = lit.litMesh(b, mat);
    sc.add(mesh, lit.ambient('#8ab0e0', '#403020', 0.6));
    const sun = lit.sun('#fff0d0', 2.5, 45);
    sun.position.set(30, 50, 20);
    sc.add(sun, sun.target);
    const cam = lit.camera(50);
    cam.position.set(0, 25, 45);
    cam.lookAt(0, 0, 0);
    const rt = new THREE.WebGLRenderTarget(lit.LW, lit.LH, { type: THREE.HalfFloatType, depthBuffer: true });
    return { sc, cam, rt, mesh, mat, a, shadow, sun };
  },
  run({ renderer }, s) {
    renderer.setRenderTarget(s.rt);
    renderer.render(s.sc, s.cam);
  },
  dispose({ renderer }, s) {
    s.mesh.geometry.dispose();
    s.sun.shadow.dispose();
    s.mat.dispose();
    s.a.dispose();
    s.rt.dispose();
    renderer.shadowMap.enabled = s.shadow.enabled;
    renderer.shadowMap.type = s.shadow.type;
    renderer.setRenderTarget(null);
  },
});

// a mipmapped ground (`mips: true`) seen from far: every pixel covers several texels, so the shader reads and blends two levels
const mip = defineBench({
  id: 'lit.mip',
  kind: 'helper',
  async setup() {
    const [THREE, lit] = await Promise.all([import('three'), import('./lit')]);
    const a = new lit.LitAtlas(256);
    const grass = a.mipmap(a.paint(16, 16, (p) => { p.fill('#3f7d34'); p.speckle('#4a8c3c', 0.22, 7); p.speckle('#356b2d', 0.2, 9); }));
    const b = new lit.Builder();
    b.box(600, 0.2, 600, { py: { cell: grass } }, lit.at(0, -0.2, 0));
    const mat = lit.litMaterial(a, { mips: true });
    const sc = new THREE.Scene();
    const mesh = lit.litMesh(b, mat, { cast: false });
    sc.add(mesh, lit.ambient('#8ab0e0', '#403020', 1.2));
    const cam = lit.camera(50, 1, 2000);
    cam.position.set(0, 160, 220);
    cam.lookAt(0, 0, 0);
    const rt = new THREE.WebGLRenderTarget(lit.LW, lit.LH, { type: THREE.HalfFloatType, depthBuffer: true });
    return { sc, cam, rt, mesh, mat, a };
  },
  run({ renderer }, s) {
    renderer.setRenderTarget(s.rt);
    renderer.render(s.sc, s.cam);
  },
  dispose({ renderer }, s) {
    s.mesh.geometry.dispose();
    s.mat.dispose();
    s.a.dispose();
    s.rt.dispose();
    renderer.setRenderTarget(null);
  },
});

export const bench: EffectBench[] = [atlas, scene, mip];
