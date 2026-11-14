// The giant scissors of the map editor as a lit prop kit (see `_propKit.ts`). The kit is a `root` group (metres, y up) built once; it
// builds its own materials on the atlas it is given and owns no light.
import * as THREE from 'three';
import { Builder, LitAtlas, litMaterial, litMesh, at, v3 } from '@pve/engine/lit';

/**
 * The giant steel scissors, the map editor's scissors tool made real: two chunky blades with a bright bevel, a pivot
 * screw and red ring handles, about 31 m long. Local frame: the pivot is the origin, the blades point along +x, the
 * handles along -x, and the blades close in the x-y plane (the z axis is the screw). Meant to be seen far away, so
 * the texels are big (2.5 per metre).
 */
export class Scissors {
  readonly root = new THREE.Group();
  readonly lights: THREE.Light[] = [];
  private upper = new THREE.Group();
  private lower = new THREE.Group();

  constructor(atlas: LitAtlas) {
    const steel = { cell: atlas.paint(8, 8, (p) => {
      p.fill(0xa7b0bf);
      p.rect(0, 7, 8, 1, 0xdfe6f0);
      p.rect(0, 0, 8, 1, 0x7b8494);
      p.speckle(0xc4ccd8, 0.15, 3);
      p.speckle(0x8e97a6, 0.15, 5);
    }) };
    const bevel = { cell: atlas.paint(8, 8, (p) => { p.fill(0xe9eff8); p.speckle(0xffffff, 0.2, 11); p.speckle(0xc9d2e0, 0.12, 13); }) };
    const red = { cell: atlas.paint(8, 8, (p) => {
      p.fill(0xc8222c);
      p.rect(0, 6, 8, 2, 0xe0403f);
      p.speckle(0xe44a4a, 0.12, 21);
      p.speckle(0x9a1822, 0.16, 23);
    }) };
    const screw = { cell: atlas.paint(8, 8, (p) => { p.fill(0xc9d1de); p.speckle(0xf2f6fc, 0.2, 31); p.speckle(0x9aa3b2, 0.15, 33); }) };
    const slot = { cell: atlas.solid(0x343944) };
    const mat = litMaterial(atlas, { side: THREE.DoubleSide });

    const ccw = (pts: [number, number][]): [number, number][] => {
      let a = 0;
      pts.forEach(([x, y], k) => { const [nx, ny] = pts[(k + 1) % pts.length]!; a += x * ny - nx * y; });
      return a < 0 ? pts.slice().reverse() : pts;
    };
    /** One blade with its handle; `s` is +1 for the upper blade and -1 for the lower one (mirrored in y). */
    const blade = (s: 1 | -1, z: number): THREE.Group => {
      const flip = (pts: [number, number][]) => ccw(pts.map(([x, y]) => [x, y * s] as [number, number]));
      const b = new Builder(2.5);
      const m = at(0, 0, z);
      b.extrude(flip([[-1.5, 0], [19, 0], [3, 2.8], [-1.5, 2.1]]), 0.5, steel, steel, m);
      b.extrude(flip([[-1, 0], [19, 0], [17.2, 0.5], [-1, 0.7]]), 0.54, bevel, bevel, m);
      // the shank crosses the pivot to the handle ring on the other side
      b.extrude(flip([[-1.5, 2.1], [-1.5, 0], [-5.4, -2.0], [-5.4, -0.2]]), 0.5, steel, steel, m);
      const cx = -8.8, cy = -2.9 * s, rx = 3.6, ry = 2.4, hw = 0.62, hh = 0.5;
      const path = [];
      const N = 22;
      for (let j = 0; j < N; j++) {
        const th = (j / N) * Math.PI * 2;
        const side = v3(Math.cos(th) / rx, Math.sin(th) / ry, 0).normalize();
        path.push({ p: v3(cx + rx * Math.cos(th), cy + ry * Math.sin(th), z), side, up: v3(0, 0, 1) });
      }
      b.sweep(path, [[-hw, -hh], [-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]], red, true);
      const g = new THREE.Group();
      g.add(litMesh(b, mat, { cast: false }));
      return g;
    };
    this.upper = blade(1, 0.26);
    this.lower = blade(-1, -0.26);

    const sb = new Builder(2.5);
    const rotX = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    sb.cylinder(0.6, 0.6, 1.9, 8, screw, screw, new THREE.Matrix4().makeTranslation(0, 0, -0.95).multiply(rotX));
    sb.cylinder(1.25, 1.1, 0.34, 6, screw, screw, new THREE.Matrix4().makeTranslation(0, 0, 0.52).multiply(rotX));
    sb.cylinder(1.25, 1.1, 0.34, 6, screw, screw, new THREE.Matrix4().makeTranslation(0, 0, -0.86).multiply(rotX));
    sb.box(1.9, 0.18, 0.04, { pz: slot }, at(0, -0.09, 0.87));
    sb.box(0.18, 1.9, 0.04, { pz: slot }, at(0, -0.95, 0.87));
    this.root.add(this.upper, this.lower, litMesh(sb, mat, { cast: false }));
    this.setOpen(0.5);
  }

  /** The angle between the two blades, radians: 0 closed, about 1.2 wide open. */
  setOpen(a: number) {
    this.upper.rotation.z = a / 2;
    this.lower.rotation.z = -a / 2;
  }
}
