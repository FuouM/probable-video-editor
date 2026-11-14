// The town of the room kit (`_home.ts`) beyond the balcony: the ground and the street, rows of houses with windows in 8 light groups,
// utility poles with wires and lamps, trees, and layers of hills. One seeded RNG builds it all, in this order.
import * as THREE from 'three';
import { mulberry32 } from '@pve/engine/util';
import { Builder, allFaces, at, v3, type Face } from '@pve/engine/lit';
import type { RoomKit } from './_homeKit';

const GROUND = -5.5;
const groundAt = (z: number) => GROUND + Math.max(0, -z - 16) * 0.045;

/**
 * Builds the town into `town` (it goes into the root). The unlit part uses `townMat`; the lit windows are 8 meshes, returned in group
 * order (group 0 also has the lamps of the poles).
 */
export function buildTown(kit: RoomKit, townMat: THREE.Material, town: THREE.Group): THREE.Mesh[] {
  const c = kit.cells;
  const rnd = mulberry32(0x70a);
  const b = new Builder();
  const lit: Builder[] = Array.from({ length: 8 }, () => new Builder());
  // the ground and the street
  b.quad(v3(-400, GROUND - 0.01, -3), v3(400, GROUND - 0.01, -3), v3(400, GROUND - 0.01, -420), v3(-400, GROUND - 0.01, -420), c.ground!);
  b.quad(v3(-400, GROUND + 0.005, -8), v3(400, GROUND + 0.005, -8), v3(400, GROUND + 0.005, -12), v3(-400, GROUND + 0.005, -12), c.road!);
  houses(kit, b, lit, rnd);
  poles(kit, b, lit);
  trees(kit, b, rnd);
  hills(kit, b, rnd);
  town.add(kit.put(b, { mat: townMat, cast: false, receive: false }));
  const winGroups: THREE.Mesh[] = [];
  for (const l of lit) { const m = kit.put(l, { cast: false, receive: false }); winGroups.push(m); town.add(m); }
  kit.root.add(town);
  return winGroups;
}

/** Rows of houses with pitched roofs; each window is dark on the house and lit in one of the 8 groups. */
function houses(kit: RoomKit, town: Builder, lit: Builder[], rnd: () => number) {
  const c = kit.cells;
  const walls = [c.wallA!, c.wallB!, c.wallC!, c.wallD!], roofs = [c.roofA!, c.roofB!, c.roofC!];
  const warm: Face[] = [c.winWarm!, c.winWarm!, c.winPale!, c.winCool!];
  for (const zr of [-16, -22, -30, -40, -52, -66, -82, -100]) {
    const spread = 45 + Math.abs(zr) * 0.95;
    let x = -spread;
    while (x < spread) {
      const w = 5 + rnd() * 4, d = 5 + rnd() * 3, floors = rnd() < 0.55 ? 2 : 1 + (rnd() < 0.2 ? 1 : 0);
      const h = floors * 3.1;
      const y = groundAt(zr);
      const wf = walls[Math.floor(rnd() * 4)]!;
      town.box(w, h, d, { pz: wf, px: wf, nx: wf, nz: wf, py: wf }, at(x + w / 2, y, zr));
      town.extrude([[-w / 2 - 0.3, 0], [w / 2 + 0.3, 0], [0, 1.8 + rnd()]], d + 0.6, roofs[Math.floor(rnd() * 3)]!, roofs[Math.floor(rnd() * 3)]!, at(x + w / 2, y + h, zr));
      const nc = Math.max(1, Math.floor(w / 2.4));
      for (let f = 0; f < floors; f++) for (let i = 0; i < nc; i++) {
        const wx = x + ((i + 0.5) * w) / nc, wy = y + f * 3.1 + 1.0;
        town.quad(v3(wx - 0.5, wy, zr + d / 2 + 0.012), v3(wx + 0.5, wy, zr + d / 2 + 0.012), v3(wx + 0.5, wy + 1.1, zr + d / 2 + 0.012), v3(wx - 0.5, wy + 1.1, zr + d / 2 + 0.012), c.winDark!);
        const g = Math.floor(rnd() * 8);
        const lc = warm[Math.floor(rnd() * 4)]!;
        lit[g]!.quad(v3(wx - 0.46, wy + 0.05, zr + d / 2 + 0.03), v3(wx + 0.46, wy + 0.05, zr + d / 2 + 0.03), v3(wx + 0.46, wy + 1.05, zr + d / 2 + 0.03), v3(wx - 0.46, wy + 1.05, zr + d / 2 + 0.03), lc);
      }
      x += w + 1 + rnd() * 3;
    }
  }
}

/** Utility poles along the street with three wires between them, and a lamp on every other pole (in light group 0). */
function poles(kit: RoomKit, town: Builder, lit: Builder[]) {
  const c = kit.cells;
  const wire = c.wire!;
  const pxs: number[] = [];
  for (let x = -60; x <= 60; x += 10) pxs.push(x);
  for (let i = 0; i < pxs.length; i++) {
    const x = pxs[i]!, y = GROUND;
    town.box(0.2, 9, 0.2, allFaces(c.pole!), at(x, y, -11));
    town.box(1.6, 0.1, 0.12, allFaces(c.pole!), at(x, y + 8.3, -11));
    town.box(1.2, 0.08, 0.1, allFaces(c.pole!), at(x, y + 7.4, -11));
    if (i % 2 === 0) lit[0]!.box(0.4, 0.14, 0.4, allFaces(c.lampPost!), at(x + 0.9, y + 8.2, -10.7));
    const nx = pxs[i + 1];
    if (nx === undefined) continue;
    for (const dx of [-0.7, 0, 0.7]) {
      const n = 6;
      for (let s = 0; s < n; s++) {
        const u0 = s / n, u1 = (s + 1) / n;
        const ya = y + 8.35 - 0.7 * 4 * u0 * (1 - u0) - (dx === 0 ? 0.0 : 0.0), yb = y + 8.35 - 0.7 * 4 * u1 * (1 - u1);
        const xa = x + dx + (nx - x) * u0, xb = x + dx + (nx - x) * u1;
        const len = Math.hypot(xb - xa, yb - ya);
        const ang = Math.atan2(yb - ya, xb - xa);
        const m = new THREE.Matrix4().makeRotationZ(ang).setPosition((xa + xb) / 2, (ya + yb) / 2, -11 + dx * 0.0);
        town.box(len, 0.03, 0.03, allFaces(wire), m);
      }
    }
  }
}

/** 36 seeded trees: a trunk and a cone of leaves. */
function trees(kit: RoomKit, town: Builder, rnd: () => number) {
  const c = kit.cells;
  for (let i = 0; i < 36; i++) {
    const x = (rnd() - 0.5) * 130, z = -14 - rnd() * 70, y = groundAt(z), s = 0.8 + rnd() * 0.8;
    town.box(0.25 * s, 1.5 * s, 0.25 * s, allFaces(c.pole!), at(x, y, z));
    town.cylinder(1.2 * s, 0, 3.6 * s, 5, c.leaf!, null, at(x, y + 1.3 * s, z));
  }
}

/** Hills in layers, nearest darkest. */
function hills(kit: RoomKit, town: Builder, rnd: () => number) {
  const c = kit.cells;
  const layers: [string, number, number, number][] = [['hillA', 190, 60, 120], ['hillB', 260, 90, 150], ['hillC', 340, 120, 170]];
  for (const [cell, z, h, r] of layers) {
    for (let i = 0; i < 6; i++) {
      const x = -330 + i * 130 + (rnd() - 0.5) * 70;
      const hh = h * (0.6 + rnd() * 0.6), rr = r * (0.7 + rnd() * 0.5);
      town.cylinder(rr, 0, hh, 5 + Math.floor(rnd() * 3), c[cell]!, null, at(x, GROUND, -z - rnd() * 30, rnd() * 3));
    }
  }
}
