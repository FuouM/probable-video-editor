// The furniture of the room kit (`_home.ts`): the kotatsu with the things on it, the futon, and the mug that the copy room shares.
import * as THREE from 'three';
import { mulberry32 } from '@pve/engine/util';
import { Builder, allFaces, at, icosphere, v3, type Face, type LitAtlas } from '@pve/engine/lit';
import { FL, KX, KZ, SEAT_X, type RoomKit } from './_homeKit';

/**
 * The mug on the kotatsu: the tell that the copy room matches the real room (treatment "The sardine"). A cream mug with a teal band,
 * a green tea top and a handle on its +x side; its paint glows a little so it reads in the dark room. `m` places its foot. The copy room builds the same mug with this function.
 */
export const MUG = { at: [KX - 0.28, 0.4, KZ + 0.22], r: 0.036, h: 0.085, body: '#eee8d8', band: '#2f9aa8', tea: '#6a8a30', handle: '#d8d0bc' } as const;
export function addMug(b: Builder, A: LitAtlas, m: THREE.Matrix4) {
  const side: Face = { cell: A.paint(8, 8, (p) => { p.fill(MUG.body, 0.7); p.rect(0, 3, 8, 2, MUG.band, 0.7); }) };
  const tea: Face = { cell: A.solid(MUG.tea) };
  const hand = allFaces({ cell: A.solid(MUG.handle) });
  b.cylinder(MUG.r, MUG.r * 0.94, MUG.h, 8, side, tea, m);
  const T = (x: number, y: number) => m.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, 0));
  b.box(0.022, 0.012, 0.014, hand, T(MUG.r + 0.008, 0.058));
  b.box(0.022, 0.012, 0.014, hand, T(MUG.r + 0.008, 0.016));
  b.box(0.012, 0.05, 0.014, hand, T(MUG.r + 0.02, 0.016));
}

/** The table things, the futon and the kotatsu, each a packing stage. Returns the mesh of the table things (it jumps on a knock). */
export function buildFurniture(kit: RoomKit): THREE.Mesh {
  const tableThings = kit.put(tableThingsOf(kit), { stage: 0.3, y: FL });

  // the futon with its duvet folded back, the pillow, the alarm clock
  const c = kit.cells;
  const f = new Builder();
  const fx = 1.32, fz = 0.1;
  f.box(0.95, 0.1, 1.95, allFaces(c.futon!), at(fx, 0, fz));
  f.box(0.97, 0.07, 1.25, allFaces(c.duvet!), at(fx, 0.1, fz - 0.33));
  f.box(0.97, 0.1, 0.18, allFaces(c.duvet!), at(fx, 0.1, fz + 0.3, 0.0));
  f.box(0.5, 0.08, 0.32, allFaces(c.pillow!), at(fx, 0.1, 0.8));
  f.box(0.45, 0.04, 0.27, allFaces(c.pillow!), at(fx, 0.18, 0.8));
  f.box(0.1, 0.07, 0.06, { px: c.alarm!, nx: c.grey!, pz: c.grey!, nz: c.grey!, py: c.grey! }, at(0.76, 0, 0.8));
  kit.put(f, { stage: 0.55, y: FL });

  // the kotatsu: blanket (top and a skirt on every side), the table top, the zabuton
  const k = new Builder();
  k.box(1.2, 0.02, 1.2, allFaces(c.blanket!), at(KX, 0.34, KZ));
  for (let i = 0; i < 4; i++) {
    const m = at(KX, 0, KZ, (i * Math.PI) / 2);
    k.quad(v3(-0.68, 0, 0.68), v3(0.68, 0, 0.68), v3(0.6, 0.36, 0.6), v3(-0.6, 0.36, 0.6), c.blanket!, m);
  }
  k.box(0.86, 0.04, 0.86, allFaces(c.wood!), at(KX, 0.36, KZ));
  k.box(0.45, 0.06, 0.45, allFaces(c.zabuton!), at(SEAT_X, 0, KZ));
  // the cord of the heater to the outlet in the wall
  k.box(0.012, 0.01, 1.0, allFaces(c.black!), at(-0.9, 0, KZ + 0.9 - 0.5, 0.95));
  kit.put(k, { stage: 0.7, y: FL });
  return tableThings;
}

/** The things on the kotatsu: a bowl of mandarins, peels, the mug, the remote, tissues, a pad of paper. */
function tableThingsOf(kit: RoomKit): Builder {
  const c = kit.cells;
  const t = new Builder();
  const top = 0.4;
  const bx = KX + 0.12, bz = KZ - 0.05;
  t.cylinder(0.07, 0.115, 0.07, 8, c.ceramic!, null, at(bx, top, bz));
  t.cylinder(0.06, 0.06, 0.01, 8, c.orangeDark!, c.orangeDark!, at(bx, top + 0.03, bz));
  for (const [dx, dy, dz] of [[-0.03, 0, 0.0], [0.035, 0, 0.01], [0.0, 0, -0.04], [0.01, 0.045, 0.0], [-0.04, 0.02, 0.04]] as const) icosphere(t, 0.037, c.orange!, at(bx + dx, top + 0.075 + dy, bz + dz), 0.85);
  const rnd = mulberry32(31);
  for (let i = 0; i < 6; i++) {
    const a = rnd() * 6.28, r = 0.12 + rnd() * 0.12;
    t.box(0.045, 0.006, 0.03, allFaces(c.orangeDark!), at(KX - 0.1 + Math.cos(a) * r * 0.9, top + (i < 2 ? 0.0 : 0.0), KZ + 0.15 + Math.sin(a) * r * 0.5, rnd() * 6));
  }
  addMug(t, kit.atlas, at(MUG.at[0], MUG.at[1], MUG.at[2], 0.4));
  // the remote lies clear of the place of the commuter pass (`day.ts`): under the pass it came up through the card on each knock
  t.box(0.05, 0.02, 0.15, allFaces(c.black!), at(KX + 0.38, top, KZ - 0.12, 0.1));
  t.box(0.14, 0.12, 0.07, { py: c.white!, px: c.white!, nx: c.white!, pz: c.white!, nz: c.white! }, at(KX + 0.22, top, KZ - 0.27, -0.2));
  t.box(0.17, 0.02, 0.12, allFaces(c.tape!), at(KX - 0.2, top, KZ - 0.25, 0.2));
  return t;
}
