// Benchmarks of LitView (litview.ts): the sky, a small lit scene, the bloom chain and the output pass into a
// frame-sized HDR target, with an interface layer and a top layer (a cursor). Engine modules load with import() in setup
// (bun test imports this file).
import { defineBench, rng } from './bench/kit';
import type { EffectBench } from './bench/types';

const view = defineBench({
  id: 'litview.present',
  kind: 'stage',
  async setup({ renderer }) {
    const [THREE, lit, { LitView }, { TextLayer }, { makeRT }] = await Promise.all([
      import('three'), import('./lit'), import('./litview'), import('./textlayer'), import('./gl'),
    ]);
    const a = new lit.LitAtlas(128);
    const r = rng(5);
    const faces = Array.from({ length: 4 }, () => lit.allFaces({ cell: a.paint(8, 8, (p) => { p.fill(Math.floor(r() * 0xffffff)); p.rect(1, 4, 2, 2, '#ffe0a0', 4); }) }));
    const b = new lit.Builder();
    for (let i = 0; i < 12; i++) b.box(2, 2 + r() * 8, 2, faces[i % 4]!, lit.at(i * 4 - 24, 0, -20 - r() * 20));
    const mat = lit.litMaterial(a);
    const mesh = lit.litMesh(b, mat, { cast: false, receive: false });
    const sc = new THREE.Scene();
    sc.add(mesh, lit.ambient('#8ab0e0', '#403020', 0.8), lit.point('#ffd080', 200, 40));
    const cam = lit.camera(55);
    cam.position.set(0, 3, 10);
    const sky = { zenith: '#203a78', horizon: '#e08a50', ground: '#101010', stars: 0.5, body: { dir: new THREE.Vector3(0.3, 0.2, -1), r: 0.04, colour: '#fff4d0', strength: 6 } };
    const v = new LitView();
    const text = new TextLayer();
    text.rect(20, 300, 600, 40, '#102040', 0.8);
    text.commit();
    // the top layer: a cursor-sized mark, uploaded each frame as a game player does
    const top = new TextLayer();
    const out = makeRT();
    return { v, sc, cam, sky, text, top, out, mesh, mat, a };
  },
  run({ renderer }, s) {
    s.v.render(renderer, s.sc, s.cam, s.sky);
    s.top.clear();
    s.top.rect(300, 160, 8, 12, '#ffffff');
    s.top.commit();
    s.v.present(renderer, s.out, { bloom: 0.4, crt: 0.5, top: s.top }, s.text);
  },
  dispose({ renderer }, s) {
    s.v.dispose();
    s.text.dispose();
    s.top.dispose();
    s.out.dispose();
    s.mesh.geometry.dispose();
    s.mat.dispose();
    s.a.dispose();
    renderer.setRenderTarget(null);
  },
});

export const bench: EffectBench[] = [view];
