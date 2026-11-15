// Benchmarks of baked physics (physics.ts): 1500 small boxes on a ground, hit by a kinematic box that sweeps
// through them for 4 s at 120 Hz. `physics.bake` is the init() cost. `physics.sample` is the per-frame cost
// of writing 1500 instance matrices. Both run on the CPU. Engine modules load with import() in setup.
import { defineBench } from './bench/kit';
import { mulberry32 } from './util';
import type * as THREE from 'three';
import type { EffectBench } from './bench/types';
import type { BakeSpec, Baked } from './physics';

function spec(): BakeSpec {
  const r = mulberry32(1500);
  const bodies: BakeSpec['bodies'] = [
    { shape: { kind: 'box', half: [40, 0.5, 40] }, pose: { p: [0, -0.5, 0], q: [0, 0, 0, 1] }, type: 'fixed' },
    {
      shape: { kind: 'box', half: [1, 1, 8] },
      pose: { p: [-30, 1, 0], q: [0, 0, 0, 1] },
      type: 'kinematic',
      drive: (t) => ({ p: [-30 + 15 * Math.min(Math.max(t, 0), 4), 1, 0], q: [0, 0, 0, 1] }),
    },
  ];
  for (let i = 0; i < 1500; i++) {
    const x = (i % 50) * 0.8 - 20, z = (Math.floor(i / 50) % 30) * 0.5 - 7.5, y = 0.2 + Math.floor(i / 1500) * 0.4;
    bodies.push({
      shape: { kind: 'box', half: [0.15 + r() * 0.05, 0.15, 0.15] },
      pose: { p: [x, y, z], q: [0, 0, 0, 1] },
      friction: 0.6,
      restitution: 0.2,
    });
  }
  return { t0: 0, t1: 4, hz: 120, bodies };
}

export const bench: EffectBench[] = [
  defineBench<BakeSpec>({
    id: 'physics.bake',
    kind: 'helper',
    // a bake takes seconds and runs once at init: 3 measured runs after the first one
    n: 3,
    warmup: 0,
    setup: () => spec(),
    async run(_, s) {
      const { bake } = await import('./physics');
      await bake(s);
    },
  }),
  defineBench<{ baked: Baked; mesh: THREE.InstancedMesh; ts: number }>({
    id: 'physics.sample',
    kind: 'helper',
    async setup() {
      const [{ bake }, three] = await Promise.all([import('./physics'), import('three')]);
      const baked = await bake(spec());
      const mesh = new three.InstancedMesh(new three.BoxGeometry(), new three.MeshBasicMaterial(), 1500);
      return { baked, mesh, ts: 0 };
    },
    run(_, s) {
      s.ts = (s.ts + 0.0173) % 4;
      s.baked.instances(s.mesh, s.ts, 2);
    },
    dispose(_, s) {
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
      s.mesh.dispose();
    },
  }),
];
