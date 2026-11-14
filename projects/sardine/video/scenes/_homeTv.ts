// The CRT of the room kit (`_home.ts`) on its cabinet against the left wall, with the game console and the curved glass.
import * as THREE from 'three';
import { Builder, allFaces, at, litMesh, v3, type Face } from '@pve/engine/lit';
import { FL, KZ, X0, type RoomKit } from './_homeKit';

/**
 * Builds the cabinet, the set and the console into `tv`, and adds the glass (named `screen`, material `glass`) to it. `tv` stands
 * against the left wall, its front toward the room, and goes into the root.
 */
export function buildTv(kit: RoomKit, tv: THREE.Group, glass: THREE.Material) {
  const c = kit.cells;
  const b = new Builder();
  // cabinet: x -0.5..0.5 along the wall, z -0.45..0 (the front is +z), two drawers
  b.box(1.0, 0.41, 0.45, { pz: c.drawers!, px: c.wood!, nx: c.wood!, nz: c.wood!, py: c.wood! }, at(0, 0.04, -0.225));
  for (const x of [-0.47, 0.47]) for (const z of [-0.04, -0.41]) b.box(0.04, 0.04, 0.04, allFaces(c.woodDark!), at(x, 0, z));
  // the CRT: frame bars (the bottom one carries the buttons), a body that tapers to the back
  const Y = 0.45, zf = -0.03, bd = 0.1;
  const bezel = allFaces(c.plastic!);
  b.box(0.64, 0.06, bd, bezel, at(0, Y + 0.46, zf - bd / 2));
  b.box(0.64, 0.09, bd, { ...bezel, pz: c.bezelBottom! }, at(0, Y, zf - bd / 2));
  // the side bars end at the edge of the glass (x = +-0.255): the 16:9 picture is as wide as the glass, and a bar that reached over the
  // glass would hide a strip at each side of the picture when the push fills the frame with it
  for (const x of [-0.2875, 0.2875]) b.box(0.065, 0.37, bd, bezel, at(x, Y + 0.09, zf - bd / 2));
  const zb = zf - bd, yc = Y + 0.26;
  frustum(b, 0.62, 0.50, zb, 0.36, 0.3, zb - 0.28, yc, c.plasticDark!);
  // a game console on top of the set, with a cartridge
  b.box(0.26, 0.05, 0.17, allFaces(c.plasticDark!), at(0.1, Y + 0.52, -0.24));
  b.box(0.1, 0.035, 0.015, allFaces(c.grey!), at(0.1, Y + 0.57, -0.24));
  b.box(0.015, 0.012, 0.012, allFaces(c.led!), at(-0.02, Y + 0.545, -0.155));
  // the curved glass: a patch bulged toward the viewer, 0.51 x 0.3825 (4:3, like the tube texture)
  const g = new THREE.PlaneGeometry(0.51, 0.3825, 14, 10);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / 0.255, v = pos.getY(i) / 0.19125;
    pos.setZ(i, 0.03 * (1 - (u * u + v * v) / 2));
  }
  g.computeVertexNormals();
  const screen = new THREE.Mesh(g, glass);
  screen.name = 'screen';
  screen.position.set(0, Y + 0.09 + 0.185, zf - 0.075);
  screen.receiveShadow = true;
  tv.add(litMesh(b, kit.mat), screen);
  tv.position.set(X0 + 0.45 + 0.02, FL, KZ);
  tv.rotation.y = Math.PI / 2;
  kit.root.add(tv);
}

/** A four-sided frustum from the front rectangle (w0 x h0 at z0) to the back one (w1 x h1 at z1 < z0), centred on yc. */
function frustum(b: Builder, w0: number, h0: number, z0: number, w1: number, h1: number, z1: number, yc: number, f: Face) {
  const A = v3(-w0 / 2, yc - h0 / 2, z0), B = v3(w0 / 2, yc - h0 / 2, z0), C = v3(w0 / 2, yc + h0 / 2, z0), D = v3(-w0 / 2, yc + h0 / 2, z0);
  const a = v3(-w1 / 2, yc - h1 / 2, z1), bb = v3(w1 / 2, yc - h1 / 2, z1), cc = v3(w1 / 2, yc + h1 / 2, z1), d = v3(-w1 / 2, yc + h1 / 2, z1);
  b.quad(D, C, cc, d, f);
  b.quad(a, bb, B, A, f);
  b.quad(B, bb, cc, C, f);
  b.quad(a, A, D, d, f);
  b.quad(bb, a, d, cc, f);
}
