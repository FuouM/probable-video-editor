// The packing boxes of the room kit (`_home.ts`): the shut boxes that come as the room is packed, the open versions of the two boxes
// beside the CRT, and the box that gets taped shut in view.
import * as THREE from 'three';
import { lerp, smooth } from '@pve/engine/util';
import { Builder, allFaces, at, litMesh } from '@pve/engine/lit';
import { FL, type OpenBox, type PackBox, type RoomKit } from './_homeKit';

/** A box that is taped shut in view (`Home.makeTapeBox`): `shut` 0..1 folds the four flaps, `tape` 0..1 runs the strip of tape along the seam. */
export interface TapeBox { root: THREE.Group; set(shut: number, tape: number): void }

/** x, z, w, h, d, ry, label, y0, packing threshold (0 = there at the start). */
type BoxRow = [number, number, number, number, number, number, string | null, number, number];

const BOXES: BoxRow[] = [
  [-1.5, -1.07, 0.6, 0.5, 0.52, 0.05, 'ほん', 0, 0],
  [-1.5, -1.07, 0.55, 0.4, 0.46, -0.08, null, 0.5, 0],
  // `だいどころ` and the box on it stand 0.05 m clear of the cabinet (x -1.78..-1.33, z -0.5..0.5), flaps included: nothing crosses
  [-1.0, -0.6, 0.56, 0.45, 0.42, 0.04, 'だいどころ', 0, 0],
  [-1.45, 0.98, 0.56, 0.5, 0.5, -0.06, 'ふく', 0, 0],
  [-1.0, -0.6, 0.45, 0.35, 0.36, -0.2, null, 0.45, 0.15],
  [-0.1, -1.0, 0.6, 0.5, 0.5, 0.02, 'おふろ', 0, 0.2],
  [-1.45, 0.98, 0.5, 0.4, 0.46, 0.12, 'ほん', 0.5, 0.25],
  [-0.9, 1.02, 0.52, 0.45, 0.46, -0.04, null, 0, 0.3],
  [-0.1, -1.0, 0.5, 0.4, 0.44, -0.1, null, 0.5, 0.35],
  [0.35, -1.08, 0.5, 0.42, 0.42, 0.14, 'ふく', 0, 0.4],
  [-0.3, 0.1, 0.7, 0.55, 0.6, 0.05, 'だいどころ', 0, 0.75],
  [-0.3, 0.1, 0.6, 0.45, 0.5, -0.12, null, 0.55, 0.8],
  [0.38, 0.55, 0.52, 0.46, 0.46, 0.2, 'おふろ', 0, 0.7],
  [1.35, 0.3, 0.7, 0.55, 0.6, 0.0, 'ふく', 0, 0.85],
  [1.35, -0.4, 0.55, 0.5, 0.5, 0.1, 'ほん', 0, 0.9],
  [1.4, 0.95, 0.5, 0.4, 0.46, -0.1, null, 0, 0.95],
  [-0.3, 1.1, 0.5, 0.4, 0.4, 0.05, 'ふく', 0, 0.6],
];

/** The flap angles of the open boxes `だいどころ` (index 2) and `ふく` (index 3). */
interface Flaps { front: number; back: number; left: number; right: number }
const FLAPS: Record<2 | 3, Flaps> = {
  2: { front: 0.6, back: 1.2, left: -0.7, right: -0.35 },
  3: { front: -0.5, back: 1.7, left: -0.3, right: -0.9 },
};

const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

/** The shut boxes (into `packBoxes`), the open versions of the two boxes beside the CRT (into `openBoxes` and `openGroup`), and a roll of tape. */
export function buildBoxes(kit: RoomKit, packBoxes: PackBox[], openBoxes: OpenBox[], openGroup: THREE.Group) {
  const c = kit.cells;
  for (const [x, z, w, h, d, ry, text, y0, thr] of BOXES) {
    const b = new Builder();
    const front = text ? kit.label(text, w, h) : c.board!;
    b.box(w, h, d, { pz: front, px: c.board!, nx: c.board!, nz: c.board!, py: c.boardTop! }, at(x, FL + y0, z, ry));
    const m = kit.put(b);
    packBoxes.push({ thr, mesh: m });
  }
  buildOpenBoxes(kit, packBoxes, openBoxes, openGroup);
  kit.root.add(openGroup);
  // a roll of tape and a marker on the stack of the first boxes (0.5 + 0.4 m up)
  const tt = new Builder();
  tt.cylinder(0.05, 0.05, 0.04, 8, c.tape!, null, at(-1.5, FL + 0.9, -1.07));
  tt.box(0.14, 0.015, 0.015, allFaces(c.black!), at(-1.38, FL + 0.9, -1.02, 0.5));
  packBoxes.push({ thr: 0, mesh: kit.put(tt) });
}

/**
 * The open versions of the boxes `だいどころ` (index 2) and `ふく` (index 3): four thin walls, a floor, flaps that stand or hang at
 * different angles, and things that show over the rim. They share the closed box's place, so `setBoxesOpen` swaps them.
 */
function buildOpenBoxes(kit: RoomKit, packBoxes: PackBox[], openBoxes: OpenBox[], openGroup: THREE.Group) {
  const c = kit.cells;
  const wall = 0.012, flap = 0.01;
  for (const i of [2, 3] as const) {
    const flaps = FLAPS[i];
    const [x, z, w, h, d, ry, text, y0, thr] = BOXES[i]!;
    const base = at(x, FL + y0, z, ry);
    const front = text ? kit.label(text, w, h) : c.board!;
    const inn = c.boardIn!;
    const b = new Builder();
    const at3 = (px: number, py: number, pz: number) => base.clone().multiply(T(px, py, pz));
    b.box(w - 0.02, 0.01, d - 0.02, { py: inn }, at3(0, 0.01, 0));
    b.box(w, h, wall, { pz: front, nz: inn, px: c.board!, nx: c.board!, py: c.board! }, at3(0, 0, d / 2 - wall / 2));
    b.box(w, h, wall, { nz: c.board!, pz: inn, px: c.board!, nx: c.board!, py: c.board! }, at3(0, 0, -d / 2 + wall / 2));
    b.box(wall, h, d, { nx: c.board!, px: inn, pz: c.board!, nz: c.board!, py: c.board! }, at3(-w / 2 + wall / 2, 0, 0));
    b.box(wall, h, d, { px: c.board!, nx: inn, pz: c.board!, nz: c.board!, py: c.board! }, at3(w / 2 - wall / 2, 0, 0));
    const fb = allFaces(c.board!);
    const fz = d / 2, fx = w / 2 - 0.01;
    const rx = (a: number) => new THREE.Matrix4().makeRotationX(a);
    const rz = (a: number) => new THREE.Matrix4().makeRotationZ(a);
    b.box(w - 0.01, flap, fz, fb, at3(0, h, d / 2).multiply(rx(flaps.front)).multiply(T(0, 0, fz / 2)));
    b.box(w - 0.01, flap, fz, fb, at3(0, h, -d / 2).multiply(rx(flaps.back)).multiply(T(0, 0, -fz / 2)));
    b.box(fx, flap, d - 0.01, fb, at3(-w / 2, h, 0).multiply(rz(flaps.left)).multiply(T(-fx / 2, 0, 0)));
    b.box(fx, flap, d - 0.01, fb, at3(w / 2, h, 0).multiply(rz(flaps.right)).multiply(T(fx / 2, 0, 0)));
    if (text === 'だいどころ') {
      // kitchen things: a bowl, a pan with its handle, a roll of newspaper
      b.cylinder(0.12, 0.08, 0.1, 8, c.ceramic!, c.cream!, at3(-0.12, 0.01, 0.02).multiply(T(0, h - 0.07, 0)));
      b.cylinder(0.11, 0.11, 0.05, 8, c.grey!, c.metal!, at3(0.12, h - 0.03, -0.05));
      b.box(0.16, 0.02, 0.03, allFaces(c.black!), at3(0.12, h + 0.0, 0.07).multiply(rx(0.2)));
      b.box(0.07, 0.06, 0.18, allFaces(c.white!), at3(-0.02, h - 0.03, -0.12));
    } else {
      // clothes: folded stacks of three colours, one pulled out over the rim
      b.box(w * 0.7, 0.1, d * 0.42, allFaces(c.navy!), at3(0, h - 0.1, 0.08));
      b.box(w * 0.6, 0.06, d * 0.4, allFaces(c.red!), at3(0.03, h - 0.02, 0.1));
      b.box(w * 0.5, 0.07, d * 0.3, allFaces(c.cloth!), at3(-0.04, h - 0.05, -0.1));
      b.box(0.1, 0.012, 0.22, allFaces(c.navy!), at3(w / 2 - 0.1, h, d / 2 - 0.02).multiply(rx(0.5)));
    }
    const open = litMesh(b, kit.mat, { cast: true, receive: true });
    open.visible = false;
    openGroup.add(open);
    openBoxes.push({ thr, closed: packBoxes[i]!.mesh, open });
  }
}

/**
 * One of the two boxes beside the CRT (2 `だいどころ`, 3 `ふく`) as a box that gets taped shut: it stands where the box stands, with its four
 * flaps on hinges. `set(shut, tape)`: `shut` 0..1 folds the flaps from the open pose to flat (the side flaps first, the front flap last),
 * `tape` 0..1 runs a strip of packing tape along the seam from the back.
 */
export function makeTapeBox(kit: RoomKit, i: 2 | 3): TapeBox {
  const c = kit.cells;
  const [x, z, w, h, d, ry, text, y0] = BOXES[i]!;
  const flaps = FLAPS[i];
  const root = new THREE.Group();
  root.position.set(x, FL + y0, z);
  root.rotation.y = ry;
  const wall = 0.012, flap = 0.01;
  const front = text ? kit.label(text, w, h) : c.board!;
  const inn = c.boardIn!;
  const b = new Builder();
  b.box(w - 0.02, 0.01, d - 0.02, { py: inn }, T(0, 0.01, 0));
  b.box(w, h, wall, { pz: front, nz: inn, px: c.board!, nx: c.board!, py: c.board! }, T(0, 0, d / 2 - wall / 2));
  b.box(w, h, wall, { nz: c.board!, pz: inn, px: c.board!, nx: c.board!, py: c.board! }, T(0, 0, -d / 2 + wall / 2));
  b.box(wall, h, d, { nx: c.board!, px: inn, pz: c.board!, nz: c.board!, py: c.board! }, T(-w / 2 + wall / 2, 0, 0));
  b.box(wall, h, d, { px: c.board!, nx: inn, pz: c.board!, nz: c.board!, py: c.board! }, T(w / 2 - wall / 2, 0, 0));
  if (text === 'だいどころ') {
    b.cylinder(0.12, 0.08, 0.1, 8, c.ceramic!, c.cream!, T(-0.12, h - 0.06, 0.02));
    b.cylinder(0.11, 0.11, 0.05, 8, c.grey!, c.metal!, T(0.12, h - 0.03, -0.05));
    b.box(0.07, 0.06, 0.18, allFaces(c.white!), T(-0.02, h - 0.03, -0.12));
  } else {
    b.box(w * 0.7, 0.1, d * 0.42, allFaces(c.navy!), T(0, h - 0.1, 0.08));
    b.box(w * 0.6, 0.06, d * 0.4, allFaces(c.red!), T(0.03, h - 0.02, 0.1));
    b.box(w * 0.5, 0.07, d * 0.3, allFaces(c.cloth!), T(-0.04, h - 0.05, -0.1));
  }
  root.add(litMesh(b, kit.mat, { cast: true, receive: true }));
  const fb = allFaces(c.board!);
  const fz = d / 2, fx = w / 2 - 0.01;
  const hinge = (geo: Builder, px: number, py: number, pz: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(px, py, pz);
    g.add(litMesh(geo, kit.mat, { cast: true, receive: true }));
    root.add(g);
    return g;
  };
  const fr = new Builder(); fr.box(w - 0.01, flap, fz, fb, T(0, 0, fz / 2));
  const bk = new Builder(); bk.box(w - 0.01, flap, fz, fb, T(0, 0, -fz / 2));
  const lf = new Builder(); lf.box(fx, flap, d - 0.01, fb, T(-fx / 2, 0, 0));
  const rt = new Builder(); rt.box(fx, flap, d - 0.01, fb, T(fx / 2, 0, 0));
  const front_ = hinge(fr, 0, h + 0.022, d / 2);
  const back_ = hinge(bk, 0, h + 0.011, -d / 2);
  const left_ = hinge(lf, -w / 2, h, 0);
  const right_ = hinge(rt, w / 2, h, 0);
  const tp = new Builder(); tp.box(0.05, 0.004, d, allFaces(c.tape!), T(0, 0, d / 2));
  const strip = litMesh(tp, kit.mat, { cast: false, receive: true });
  strip.position.set(0, h + 0.036, -d / 2);
  root.add(strip);
  return {
    root,
    set(shut: number, tape: number) {
      const side = smooth(shut / 0.5), back = smooth((shut - 0.2) / 0.4), fro = smooth((shut - 0.5) / 0.5);
      left_.rotation.z = lerp(flaps.left, -Math.PI, side);
      right_.rotation.z = lerp(flaps.right, Math.PI, side);
      back_.rotation.x = lerp(flaps.back, Math.PI, back);
      front_.rotation.x = lerp(flaps.front, -Math.PI, fro);
      strip.visible = tape > 0;
      strip.scale.z = Math.max(1e-3, Math.min(1, tape));
    },
  };
}
