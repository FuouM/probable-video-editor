// The shell of the room kit (`_home.ts`): the tatami, the walls, the ceiling and its lamp; the balcony door, the balcony with its
// planter, laundry and curtains; and the outside stairs.
import * as THREE from 'three';
import { Builder, allFaces, at, v3 } from '@pve/engine/lit';
import { CEIL, DTOP, DX0, DX1, FL, X0, X1, Z0, Z1, type RoomKit } from './_homeKit';

/** The planter on the balcony: the centre of the soil surface, its length along x, its depth along z. */
export interface Planter { top: THREE.Vector3; length: number; depth: number }
/** The gap between the balcony slab and the landing of the outside stairs. */
export interface Gap { x0: number; x1: number; z: number; y: number }

/** The glass sash on the right half of the door opening: its aluminium frame runs from x0 to x1 at z. */
const SASH = { x0: 0.86, x1: 1.58, z: Z0 + 0.04 };

/** The floor, the walls, the ceiling, the baseboards, the switches, and the ceiling lamp in its two states (lit and not). */
export function buildShell(kit: RoomKit): { lampOn: THREE.Mesh; lampOff: THREE.Mesh } {
  const c = kit.cells;
  const b = new Builder();
  // tatami: two rows of long mats, three across, each a little proud of the floor, with dark cloth borders
  for (const x of [-0.9, 0.9]) for (const z of [-0.9, 0, 0.9]) {
    b.box(1.8, FL, 0.9, { py: c.tatami!, px: c.tatamiSide!, nx: c.tatamiSide!, pz: c.tatamiSide!, nz: c.tatamiSide! }, at(x, 0, z));
    for (const dz of [-0.4, 0.4]) b.box(1.8, 0.004, 0.05, { py: c.navy!, px: c.navy! }, at(x, FL, z + dz));
  }
  // walls (0.15 thick, the inner face on the room), the ceiling and the baseboards
  const wall = allFaces(c.plaster!);
  b.box(0.15, CEIL, 2.7 + 0.3, wall, at(X0 - 0.075, 0, 0));
  b.box(0.15, CEIL, 2.7 + 0.3, wall, at(X1 + 0.075, 0, 0));
  b.box(3.6 + 0.3, CEIL, 0.15, wall, at(0, 0, Z1 + 0.075));
  b.box(DX0 - X0, CEIL, 0.15, wall, at((X0 + DX0) / 2, 0, Z0 - 0.075));
  b.box(X1 - DX1, CEIL, 0.15, wall, at((DX1 + X1) / 2, 0, Z0 - 0.075));
  b.box(DX1 - DX0, CEIL - DTOP, 0.15, wall, at((DX0 + DX1) / 2, DTOP, Z0 - 0.075));
  b.box(3.6 + 0.3, 0.12, 2.7 + 0.3, { ny: c.ceiling!, px: c.plaster!, nx: c.plaster!, pz: c.plaster!, nz: c.plaster!, py: c.plaster! }, at(0, CEIL, 0));
  const wood = allFaces(c.woodDark!);
  for (const [x0, x1] of [[X0, DX0], [DX1, X1]] as const) b.box(x1 - x0, 0.09, 0.02, wood, at((x0 + x1) / 2, FL, Z0 + 0.01));
  b.box(3.6, 0.09, 0.02, wood, at(0, FL, Z1 - 0.01));
  b.box(0.02, 0.09, 2.7, wood, at(X0 + 0.01, FL, 0));
  b.box(0.02, 0.09, 2.7, wood, at(X1 - 0.01, FL, 0));
  // ceiling lamp fixture: a plate, a short cord to a pull cord with a knob
  b.cylinder(0.12, 0.12, 0.02, 10, c.lampRim!, c.lampRim!, at(0, CEIL - 0.02, 0.1));
  // light switch and outlets
  b.box(0.08, 0.12, 0.012, allFaces(c.white!), at(-0.12, 1.05, Z0 + 0.006));
  b.box(0.025, 0.04, 0.008, allFaces(c.grey!), at(-0.12, 1.09, Z0 + 0.014));
  b.box(0.08, 0.08, 0.012, allFaces(c.white!), at(X0 + 0.006, 0.3, 0.85, Math.PI / 2));
  kit.put(b);

  // lamp: the milky shade, lit or not, and its pull cord
  const on = new Builder(), off = new Builder();
  on.cylinder(0.27, 0.25, 0.09, 12, c.lampOn!, c.lampOn!, at(0, CEIL - 0.11, 0.1));
  off.cylinder(0.27, 0.25, 0.09, 12, c.lampOff!, c.lampOff!, at(0, CEIL - 0.11, 0.1));
  const lampOn = kit.put(on, { cast: false });
  const lampOff = kit.put(off, { cast: false });
  const cord = new Builder();
  cord.box(0.008, 0.62, 0.008, allFaces(c.cream!), at(0.1, 1.68, 0.1));
  cord.box(0.03, 0.04, 0.03, allFaces(c.cream!), at(0.1, 1.65, 0.1));
  kit.put(cord, { cast: false });
  return { lampOn, lampOff };
}

/** The balcony door, the balcony, its glass, planter, laundry and curtains, then the outside stairs. */
export function buildDoorAndBalcony(kit: RoomKit, planter: Planter, gap: Gap): { laundry: THREE.Mesh; curtains: THREE.Mesh } {
  kit.put(doorAndBalcony(kit));
  // the glass pane: no shadow, the shadow pass would not see its clear texels
  const g = new Builder(32);
  const { x0: sx0, x1: sx1, z: sz } = SASH;
  g.quad(v3(sx0 + 0.03, FL + 0.1, sz + 0.001), v3(sx1 - 0.03, FL + 0.1, sz + 0.001), v3(sx1 - 0.03, DTOP - 0.1, sz + 0.001), v3(sx0 + 0.03, DTOP - 0.1, sz + 0.001), kit.cells.glass!);
  kit.put(g, { cast: false });
  buildPlanter(kit, planter);
  // laundry on the pole
  const ln = new Builder();
  ln.box(0.4, 0.5, 0.01, allFaces(kit.solid('#c8d0d8')), at(0.35, 1.78, Z0 - 0.5, 0.1));
  ln.box(0.3, 0.7, 0.01, allFaces(kit.solid('#8a3a3a')), at(1.2, 1.58, Z0 - 0.5, -0.1));
  const laundry = kit.put(ln);
  const curtains = kit.put(curtainsOnRod(kit), { stage: 0.9 });
  buildOutside(kit, gap);
  return { laundry, curtains };
}

/** The frame of the door, the glass sash, and the balcony: slab, ceiling, railing, side panel, laundry pole, a bucket and sandals. */
function doorAndBalcony(kit: RoomKit): Builder {
  const c = kit.cells;
  const b = new Builder();
  const metal = allFaces(c.metal!), wood = allFaces(c.woodDark!);
  // the frame in the opening: head, sill track and jambs
  b.box(DX1 - DX0, 0.05, 0.05, wood, at((DX0 + DX1) / 2, DTOP - 0.05, Z0 + 0.0));
  b.box(DX1 - DX0, 0.025, 0.12, wood, at((DX0 + DX1) / 2, FL, Z0 - 0.04));
  for (const x of [DX0, DX1]) b.box(0.05, DTOP - FL, 0.1, wood, at(x, FL, Z0 - 0.04));
  // the glass sash on the right half: aluminium frame and the pane
  const { x0: sx0, x1: sx1, z: sz } = SASH;
  b.box(0.05, DTOP - 0.07 - FL, 0.05, metal, at(sx0, FL + 0.02, sz));
  b.box(0.05, DTOP - 0.07 - FL, 0.05, metal, at(sx1, FL + 0.02, sz));
  b.box(sx1 - sx0, 0.04, 0.05, metal, at((sx0 + sx1) / 2, DTOP - 0.1, sz));
  b.box(sx1 - sx0, 0.09, 0.05, metal, at((sx0 + sx1) / 2, FL + 0.02, sz));
  b.box(0.03, 0.04, 0.03, metal, at(sx0 + 0.07, 1.0, sz + 0.03));
  // the balcony: slab, ceiling (the floor above), railing, side panel, laundry pole
  b.box(2.2, 0.2, 0.95, { py: c.conc!, ny: c.outer!, px: c.outer!, nx: c.outer!, pz: c.outer!, nz: c.outer! }, at(0.9, FL - 0.2, Z0 - 0.475));
  b.box(2.2, 0.15, 0.95, { ny: c.ceiling!, py: c.outer!, px: c.outer!, nx: c.outer!, pz: c.outer!, nz: c.outer! }, at(0.9, CEIL, Z0 - 0.475));
  const rail = allFaces(c.rail!);
  const rz = Z0 - 0.95 + 0.03;
  b.box(2.2, 0.04, 0.05, rail, at(0.9, 1.0, rz));
  b.box(2.2, 0.03, 0.04, rail, at(0.9, 0.55, rz));
  b.box(2.2, 0.03, 0.04, rail, at(0.9, 0.1, rz));
  for (let i = 0; i <= 21; i++) b.box(0.016, 0.9, 0.016, rail, at(-0.2 + i * 0.1 + 0.01, 0.1, rz));
  b.box(0.04, 1.0, 0.04, rail, at(-0.2, FL, rz));
  // left side: open railing; right side: a solid partition board
  b.box(0.04, 0.04, 0.12, rail, at(-0.2, 1.0, Z0 - 0.06));
  b.box(0.04, 0.04, 0.12, rail, at(-0.2, 1.0, Z0 - 0.89));
  // the gate: only the corner posts stand, the way to the outside stairs is open
  for (const i of [0, 8]) b.box(0.016, 0.9, 0.016, rail, at(-0.2, 0.1, Z0 - 0.08 - i * 0.1));
  b.box(0.03, 1.5, 0.95, { px: c.outer!, nx: c.cream!, pz: c.cream!, nz: c.cream!, py: c.cream! }, at(2.0, FL, Z0 - 0.475));
  b.box(2.2, 0.02, 0.02, metal, at(0.9, 2.3, Z0 - 0.5));
  // a bucket and a pair of sandals at the door
  b.cylinder(0.11, 0.14, 0.26, 8, kit.solid('#2e5a8a'), null, at(1.75, FL, Z0 - 0.3));
  for (const dx of [0, 0.12]) b.box(0.09, 0.025, 0.24, allFaces(c.black!), at(0.35 + dx, FL, Z0 - 0.3, 0.2));
  return b;
}

/** The planter against the railing, its soil and the clods of the rim. */
function buildPlanter(kit: RoomKit, planter: Planter) {
  const c = kit.cells;
  const pl = new Builder();
  const px = planter.top.x, pz = planter.top.z, len = planter.length, dep = planter.depth;
  const pw = allFaces(c.planter!);
  pl.box(len, 0.5, 0.025, pw, at(px, FL, pz - dep / 2 + 0.0125));
  pl.box(len, 0.5, 0.025, pw, at(px, FL, pz + dep / 2 - 0.0125));
  pl.box(0.025, 0.5, dep, pw, at(px - len / 2 + 0.0125, FL, pz));
  pl.box(0.025, 0.5, dep, pw, at(px + len / 2 - 0.0125, FL, pz));
  pl.box(len - 0.05, 0.42 - 0.02, dep - 0.05, { py: c.soil! }, at(px, FL + 0.03, pz));
  kit.put(pl);
}

/** The curtains, drawn open, on a rod. */
function curtainsOnRod(kit: RoomKit): Builder {
  const c = kit.cells;
  const cur = new Builder();
  cur.box(2.3, 0.025, 0.025, allFaces(c.woodDark!), at(0.85, 2.12, Z0 + 0.05));
  const curtain = (x0: number, x1: number) => {
    const n = Math.max(2, Math.round((x1 - x0) / 0.07));
    for (let i = 0; i < n; i++) {
      const x = x0 + ((i + 0.5) * (x1 - x0)) / n;
      cur.box(0.085, 2.07 - FL, 0.02, allFaces(c.cloth!), at(x, FL, Z0 + 0.07 + (i % 2) * 0.03, i % 2 ? 0.4 : -0.4));
    }
  };
  curtain(-0.25, 0.2);
  curtain(1.45, 1.8);
  return cur;
}

/**
 * The outside stairs, the copy room's way out of the balcony: a landing to the left of the balcony slab with the gap (`gap`) between them,
 * where the duckboard lies, and a flight of 26 steps down to the street.
 */
function buildOutside(kit: RoomKit, gap: Gap) {
  const c = kit.cells;
  const b = new Builder();
  const rail = allFaces(c.rail!);
  const slab = { py: c.conc!, ny: c.outer!, px: c.outer!, nx: c.outer!, pz: c.outer!, nz: c.outer! };
  const zc = gap.z, rz = Z0 - 0.95 + 0.03;
  const lx0 = -1.7, lx1 = gap.x0;
  b.box(lx1 - lx0, 0.2, 0.95, slab, at((lx0 + lx1) / 2, FL - 0.2, zc));
  b.box(lx1 - lx0, 0.04, 0.05, rail, at((lx0 + lx1) / 2, 1.0, rz));
  for (let x = lx0 + 0.05; x < lx1; x += 0.1) b.box(0.016, 0.9, 0.016, rail, at(x, 0.1, rz));
  // the flight: 26 steps down along -x
  const N = 26, RUN = 0.28, RISE = 0.2;
  for (let k = 0; k < N; k++) {
    const x = lx0 - RUN * (k + 0.5), top = FL - RISE * (k + 1);
    b.box(RUN, 0.05, 0.95, slab, at(x, top - 0.05, zc));
    b.box(0.02, RISE, 0.95, slab, at(x + RUN / 2 - 0.01, top - RISE, zc));
  }
  const alpha = Math.atan2(RISE, RUN), len = N * Math.hypot(RUN, RISE);
  const mx = lx0 - (N * RUN) / 2, my = FL - (N * RISE) / 2;
  for (const dz of [-0.46, 0.46]) {
    b.box(len, 0.3, 0.04, slab, new THREE.Matrix4().makeRotationZ(alpha).setPosition(mx, my - 0.3, zc + dz));
  }
  // the handrail along the open side of the flight, on posts
  b.box(len, 0.04, 0.04, rail, new THREE.Matrix4().makeRotationZ(alpha).setPosition(mx, my + 0.95, rz));
  for (let k = 0; k < N; k += 3) b.box(0.016, 0.95, 0.016, rail, at(lx0 - RUN * (k + 0.5), FL - RISE * (k + 1), rz));
  kit.put(b);
}
