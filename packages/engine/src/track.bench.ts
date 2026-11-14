// Benchmarks of the track builder (track.ts): a 300 m closed loop with rails, sleepers and ballast built into a
// lit mesh. Engine modules load with import() in setup (bun test imports this file).
import { defineBench } from './bench/kit';
import type { EffectBench } from './bench/types';

const loop = defineBench({
  id: 'track.loop',
  kind: 'helper',
  async setup() {
    const [THREE, lit, track] = await Promise.all([import('three'), import('./lit'), import('./track')]);
    const a = new lit.LitAtlas(256);
    const faces = track.trackFaces(a);
    const mat = lit.litMaterial(a);
    const pts = Array.from({ length: 24 }, (_, k) => new THREE.Vector3(Math.cos(k / 24 * Math.PI * 2) * 48, 0, Math.sin(k / 24 * Math.PI * 2) * 48));
    const path = new THREE.CatmullRomCurve3(pts, true);
    return { a, faces, mat, path, track, lit };
  },
  run({ renderer }, s) {
    const mesh = s.lit.litMesh(s.track.buildTrack(s.a, s.path, { closed: true, faces: s.faces }), s.mat);
    renderer.initTexture(s.a.tex);
    mesh.geometry.dispose();
  },
  dispose(_, s) {
    s.mat.dispose();
    s.a.dispose();
  },
});

export const bench: EffectBench[] = [loop];
