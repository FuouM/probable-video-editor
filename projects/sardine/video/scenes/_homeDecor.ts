// The wall decor of the room kit (`_home.ts`): the calendar, the sign, the tear-off pad, the clock, the jacket; the pile of torn pages;
// and the bare room of the morning after.
import * as THREE from 'three';
import { mulberry32 } from '@pve/engine/util';
import { Builder, allFaces, at, litMesh, v3 } from '@pve/engine/lit';
import { FL, KX, KZ, SEAT_X, X0, Z0, type RoomKit } from './_homeKit';

/** The calendar, the sign, the tear-off pad, the clock and the jacket. Returns the sign (a scene can move it along the back wall). */
export function buildWallDecor(kit: RoomKit): THREE.Mesh {
  const c = kit.cells;
  const b = new Builder();
  const z = Z0 + 0.004;
  const cx = -1.2;
  // the wall calendar: backing board, picture, month page
  b.box(0.5, 0.84, 0.01, allFaces(c.cream!), at(cx, 1.03, Z0 + 0.005));
  b.quad(v3(cx - 0.23, 1.55, z + 0.008), v3(cx + 0.23, 1.55, z + 0.008), v3(cx + 0.23, 1.85, z + 0.008), v3(cx - 0.23, 1.85, z + 0.008), c.paddy!);
  b.quad(v3(cx - 0.23, 1.07, z + 0.008), v3(cx + 0.23, 1.07, z + 0.008), v3(cx + 0.23, 1.55, z + 0.008), v3(cx - 0.23, 1.55, z + 0.008), c.month!);
  b.box(0.02, 0.02, 0.012, allFaces(c.grey!), at(cx, 1.86, Z0 + 0.006));
  // the sign over it: its own mesh, so a scene can hang it elsewhere on the back wall (`sign.position.x`)
  const sb = new Builder();
  sb.quad(v3(-0.58, 1.95, z), v3(0.58, 1.95, z), v3(0.58, 2.3, z), v3(-0.58, 2.3, z), c.sign!);
  const sign = kit.put(sb, { stage: 0.85, cast: false });
  sign.position.x = cx;
  // the tear-off pad
  const px = -0.62;
  b.box(0.22, 0.30, 0.02, allFaces(c.cream!), at(px, 1.02, Z0 + 0.01));
  b.quad(v3(px - 0.1, 1.04, Z0 + 0.0205), v3(px + 0.1, 1.04, Z0 + 0.0205), v3(px + 0.1, 1.3, Z0 + 0.0205), v3(px - 0.1, 1.3, Z0 + 0.0205), c.pad!);
  b.box(0.2, 0.012, 0.03, allFaces(c.red!), at(px, 1.31, Z0 + 0.015));
  // the wall clock on the left wall
  b.quad(v3(X0 + 0.004, 1.65, 0.32), v3(X0 + 0.004, 1.65, -0.0), v3(X0 + 0.004, 1.91, -0.0), v3(X0 + 0.004, 1.91, 0.32), c.clock!);
  // a jacket on a hook
  b.box(0.015, 0.05, 0.05, allFaces(c.woodDark!), at(X0 + 0.01, 1.6, -1.0));
  const denim = allFaces(kit.solid('#6a7898'));
  b.box(0.1, 0.62, 0.38, denim, at(X0 + 0.07, 0.98, -1.0));
  b.box(0.06, 0.2, 0.1, denim, at(X0 + 0.1, 0.78, -1.0 + 0.24, 0.2));
  kit.put(b, { stage: 0.85, cast: false });
  return sign;
}

/**
 * The room the morning after (the outro): the walls are bare, with a paler rectangle where the calendar, the sign, the tear-off pad,
 * the clock and the jacket hung (and a scrap of tape at each corner), the same kotatsu with its quilt and the zabuton (the last things
 * to pack), a roll of packing tape and a marker on it, and a few sealed boxes (だいどころ, おふろ, ほん, ふく). Returns the mesh, hidden;
 * `Home.setBare(true)` shows it.
 */
export function buildBare(kit: RoomKit): THREE.Mesh {
  const c = kit.cells;
  const b = new Builder();
  const pale = allFaces(kit.solid('#c6c0bc'));
  const tapeBit = allFaces(c.tape!);
  const z = Z0 + 0.003;
  // back wall: (x0, x1, y0, y1)
  for (const [x0, x1, y0, y1] of [[-1.45, -0.95, 1.03, 1.87], [-1.78, -0.62, 1.95, 2.3], [-0.73, -0.51, 1.02, 1.32]] as const) {
    b.quad(v3(x0, y0, z), v3(x1, y0, z), v3(x1, y1, z), v3(x0, y1, z), pale.pz!);
    for (const [tx, ty] of [[x0, y1], [x1, y1]] as const) b.box(0.035, 0.03, 0.004, tapeBit, at(tx + (tx === x0 ? 0.02 : -0.02), ty - 0.03, z + 0.003));
  }
  // left wall: the clock (z 0..0.32) and the jacket (z -1.19..-0.81), the hook stays
  const xw = X0 + 0.003;
  for (const [z0, z1, y0, y1] of [[0, 0.32, 1.65, 1.91], [-1.19, -0.81, 0.67, 1.29]] as const) {
    b.quad(v3(xw, y0, z1), v3(xw, y0, z0), v3(xw, y1, z0), v3(xw, y1, z1), pale.px!);
  }
  b.box(0.015, 0.05, 0.05, allFaces(c.woodDark!), at(X0 + 0.01, 1.6, -1.0));
  // the kotatsu as in the first frame (`buildFurniture`): the quilt, the table top, the zabuton. The packing tape and the marker on it
  const wood = allFaces(c.wood!);
  b.box(1.2, 0.02, 1.2, allFaces(c.blanket!), at(KX, FL + 0.34, KZ));
  for (let i = 0; i < 4; i++) {
    const m = at(KX, FL, KZ, (i * Math.PI) / 2);
    b.quad(v3(-0.68, 0, 0.68), v3(0.68, 0, 0.68), v3(0.6, 0.36, 0.6), v3(-0.6, 0.36, 0.6), c.blanket!, m);
  }
  b.box(0.86, 0.04, 0.86, wood, at(KX, FL + 0.36, KZ));
  b.box(0.45, 0.06, 0.45, allFaces(c.zabuton!), at(SEAT_X, FL, KZ));
  b.cylinder(0.055, 0.055, 0.05, 10, c.tape!, c.board!, at(KX + 0.2, FL + 0.4, KZ + 0.12));
  b.box(0.15, 0.016, 0.016, allFaces(c.black!), at(KX - 0.12, FL + 0.4, KZ - 0.05, 0.5));
  b.box(0.035, 0.018, 0.018, allFaces(c.red!), at(KX - 0.12 + 0.065 * Math.cos(0.5), FL + 0.4, KZ - 0.05 - 0.065 * Math.sin(0.5), 0.5));
  // the sealed boxes
  const boxes: [number, number, number, number, number, number, string | null, number][] = [
    [-0.95, 0.72, 0.62, 0.5, 0.52, 0.12, 'だいどころ', 0],
    [0.78, 0.74, 0.6, 0.48, 0.5, -0.1, 'おふろ', 0],
    [0.78, 0.74, 0.5, 0.38, 0.42, 0.2, null, 0.48],
    [-0.65, -1.04, 0.58, 0.5, 0.5, 0.04, 'ほん', 0],
    [-1.45, 0.98, 0.56, 0.5, 0.5, -0.06, 'ふく', 0],
  ];
  for (const [x, zz, w, h, d, ry, text, y0] of boxes) {
    const front = text ? kit.label(text, w, h) : c.board!;
    b.box(w, h, d, { pz: front, px: c.board!, nx: c.board!, nz: c.board!, py: c.boardTop! }, at(x, FL + y0, zz, ry));
  }
  const bare = litMesh(b, kit.mat, { cast: true, receive: true });
  bare.visible = false;
  kit.root.add(bare);
  return bare;
}

/** The pile of torn pages under the pad: one quad each, seeded, stacked in order. Returns its mesh (`Home.setPages` sets its draw range). */
export function buildPages(kit: RoomKit): THREE.Mesh {
  const b = new Builder();
  const rnd = mulberry32(77);
  const hw = 0.1, hh = 0.13;
  const q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  for (let i = 0; i < 31; i++) {
    p.set(-0.62 + (rnd() - 0.5) * 0.3, FL + 0.003 + i * 0.0017, Z0 + 0.22 + rnd() * 0.3);
    e.set((rnd() - 0.5) * 0.12, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.12);
    q.setFromEuler(e);
    const m = new THREE.Matrix4().compose(p, q, s);
    b.quad(v3(-hw, 0, hh), v3(hw, 0, hh), v3(hw, 0, -hh), v3(-hw, 0, -hh), kit.cells[`page${i % 4}`]!, m);
  }
  return kit.put(b, { cast: false });
}
