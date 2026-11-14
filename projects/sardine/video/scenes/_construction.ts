// The building site of a zone tower, as a city builder shows one (SimCity, The Sims): the lot, the crane, the steel frame of each
// floor, the netting on the newest floors, the dust of each floor, and the sparkle when the tower is done.
//
// The tower builds down from its cloud, one floor on each onset (`_pit.ts`). A floor first stands as a steel frame (it slides into its
// place from above), then its walls close from the top down, and the green netting hangs on it for a while. The crane stands on a corner
// of the lot: its mast reaches the cloud, the jib turns to the tower, and the hook goes down to the floor that is being built.
//
// Everything is a pure function of t (`pose`).
import * as THREE from 'three';
import { hashSin } from '@pve/engine/util';
import { Builder, allFaces, at, instanced, litMesh, type Face, type LitAtlas } from '@pve/engine/lit';
import { easeOut3 } from './_ease';

/** The phases of a floor (s from its onset): the frame slides in, the walls close, the netting comes off. */
export const FRAME_IN = 0.12, WALLS = [0.1, 0.3] as const, NET_OFF = 0.9;
const DUST = 8, SPARKS = 28;

export interface SiteSpec {
  /** The middle of the footprint in the world (x, z), the ground y, the size (w along the lot's x, d along its z) and the yaw of the lot. */
  x: number; z: number; ground: number; w: number; d: number; yaw: number;
  /** The height of a floor and the y of the cloud deck over the ground. */
  floorH: number; deckY: number;
  /** The onset of each floor, bottom floor first (the top floor is built first). */
  starts: readonly number[];
}

export class ConstructionSite {
  readonly root = new THREE.Group();
  private lot: THREE.Mesh;
  private mast: THREE.Mesh;
  private jib = new THREE.Group();
  private cable: THREE.Mesh;
  private hook: THREE.Mesh;
  private nets: THREE.Mesh[] = [];
  private dust: THREE.InstancedMesh;
  private sparks: THREE.InstancedMesh;
  private o = new THREE.Object3D();
  /** The time the first floor starts and the time the last one is done. */
  readonly t0: number;
  readonly done: number;
  private mastX: number;
  private mastZ: number;
  private mastH: number;

  constructor(A: LitAtlas, mat: THREE.Material, private s: SiteSpec) {
    this.t0 = Math.min(...s.starts);
    this.done = Math.max(...s.starts) + WALLS[1];
    this.root.position.set(s.x, s.ground, s.z);
    this.root.rotation.y = s.yaw;
    const f = (c: string, e = 0): Face => ({ cell: A.solid(c, e) });
    const dirt: Face = { cell: A.paint(16, 16, (p) => { p.fill('#7a5c3c'); p.speckle('#5e4630', 0.35, 13); p.speckle('#94744e', 0.15, 29); }) };
    const fence: Face = { cell: A.paint(8, 4, (p) => { p.fill('#f2f0ea'); for (let x = 0; x < 8; x += 4) p.rect(x, 0, 2, 4, '#e8641e'); }), map: 'fit' };
    const net: Face = { cell: A.paint(8, 8, (p) => { p.fill('#2f7a4c'); for (let k = 0; k < 8; k += 2) { p.rect(k, 0, 1, 8, '#3f9a62'); p.rect(0, k, 8, 1, '#24603c'); } }) };
    const yellow = allFaces(f('#f2c230')), dark = allFaces(f('#2a2a30'));

    // ---- the lot: bare earth one metre round the footprint, a fence of striped boards, and a cone at each corner
    const W = s.w + 4, D = s.d + 4;
    const lb = new Builder();
    lb.box(W, 0.06, D, allFaces(dirt));
    for (const [w, d, x, z] of [[W, 0.08, 0, -D / 2], [W, 0.08, 0, D / 2], [0.08, D, -W / 2, 0], [0.08, D, W / 2, 0]] as const) {
      lb.box(w, 0.5, d, { px: fence, nx: fence, pz: fence, nz: fence, py: f('#e8641e'), ny: f('#e8641e') }, at(x, 0.15, z));
      const n = Math.round(Math.max(w, d) / 2);
      for (let k = 0; k <= n; k++) {
        const u = k / n - 0.5;
        lb.box(0.12, 0.7, 0.12, dark, at(x + (w > d ? u * w : 0), 0, z + (w > d ? 0 : u * d)));
      }
    }
    for (const [x, z] of [[-W / 2 - 0.6, -D / 2 - 0.6], [W / 2 + 0.6, -D / 2 - 0.6], [-W / 2 - 0.6, D / 2 + 0.6], [W / 2 + 0.6, D / 2 + 0.6]] as const) {
      lb.cylinder(0.35, 0.05, 0.9, 6, f('#ff6a1e', 0.6), f('#ff6a1e'), at(x, 0, z));
    }
    this.lot = litMesh(lb, mat);
    this.root.add(this.lot);

    // ---- the crane: a lattice mast on the far corner of the lot, a jib that turns, a cable and a hook
    this.mastX = W / 2 - 0.8;
    this.mastZ = -D / 2 + 0.8;
    this.mastH = s.deckY - 1.5;
    const mb = new Builder();
    mb.box(1.0, 1, 1.0, yellow);
    for (let y = 0; y < 1; y += 0.08) mb.box(1.04, 0.012, 1.04, dark, at(0, y, 0));
    this.mast = litMesh(mb, mat);
    this.mast.position.set(this.mastX, 0, this.mastZ);
    const reach = Math.hypot(this.mastX, this.mastZ) + 4;
    const jb = new Builder();
    jb.box(reach + 6, 0.7, 0.7, yellow, at(reach / 2 - 3, 0, 0));
    jb.box(3, 1.4, 1.2, dark, at(-4.5, -0.4, 0));
    jb.box(1.6, 1.4, 1.2, allFaces(f('#e8e4d8')), at(0.9, -1.4, 0.95));
    jb.box(0.4, 3, 0.4, yellow, at(0, 0.7, 0));
    this.jib.add(litMesh(jb, mat));
    const cb = new Builder();
    cb.box(0.08, 1, 0.08, dark, at(0, -1, 0));
    this.cable = litMesh(cb, mat, { cast: false });
    const hb = new Builder();
    hb.box(0.6, 0.5, 0.6, allFaces(f('#e8641e')));
    this.hook = litMesh(hb, mat);
    this.root.add(this.mast, this.jib, this.cable, this.hook);

    // ---- the netting: a shell of green net round each floor (no roof, no floor), a little out from the walls
    const ng = new Builder();
    const nw = s.w + 0.5, nd = s.d + 0.5, nh = s.floorH;
    ng.box(nw, nh, nd, { px: net, nx: net, pz: net, nz: net }, at(0, -nh, 0));
    const netGeo = ng.geometry();
    s.starts.forEach((_, i) => {
      const m = litMesh(netGeo, mat, { cast: false });
      m.position.y = i * s.floorH + s.floorH / 2;
      this.nets.push(m);
      this.root.add(m);
    });

    // ---- dust of each floor and the sparkle of the finished tower
    const pb = new Builder();
    pb.box(1, 1, 1, allFaces(f('#d8ccb4')));
    this.dust = instanced(pb.geometry(), mat, s.starts.length * DUST);
    const sb = new Builder();
    sb.box(1, 1, 1, allFaces(f('#ffe680', 3.5)));
    this.sparks = instanced(sb.geometry(), mat, SPARKS);
    for (const m of [this.dust, this.sparks]) { m.castShadow = false; this.root.add(m); }
  }

  /** `off`: from this time the site is gone (the hole takes the zone). */
  pose(t: number, off: number) {
    const s = this.s, live = t >= this.t0 - 0.4 && t < Math.min(off, this.done + 0.6);
    this.root.visible = t < off;
    // the lot pops up just before the first floor, and goes when the tower is done
    const pop = easeOut3((t - this.t0 + 0.4) / 0.15) * (1 - easeOut3((t - this.done - 0.45) / 0.15));
    this.lot.visible = live;
    this.lot.scale.setScalar(Math.max(1e-3, pop));
    // the crane: the mast grows up out of the lot, the jib turns to the tower and points its hook at the floor in work
    const grow = easeOut3((t - this.t0 + 0.4) / 0.3);
    for (const m of [this.mast, this.jib, this.cable, this.hook]) m.visible = live;
    this.mast.scale.set(1, Math.max(1e-3, this.mastH * grow * pop), 1);
    // the floor in work: the newest that has started (the lowest one, on a tie). Before the first, the top floor
    let work = s.starts.length - 1;
    for (let i = s.starts.length - 1; i >= 0; i--) if (s.starts[i]! <= t + 0.2 && (s.starts[work]! > t + 0.2 || s.starts[i]! >= s.starts[work]!)) work = i;
    const hookY = work * s.floorH + s.floorH / 2 + 1.2;
    const aim = Math.atan2(this.mastZ, -this.mastX) + 0.08 * Math.sin(t * 2.3);
    this.jib.position.set(this.mastX, this.mastH * grow * pop, this.mastZ);
    this.jib.rotation.y = aim;
    this.jib.scale.setScalar(Math.max(1e-3, pop));
    const tip = Math.hypot(this.mastX, this.mastZ);
    const hx = this.mastX + Math.cos(aim) * tip, hz = this.mastZ - Math.sin(aim) * tip, top = this.mastH * grow * pop;
    this.cable.position.set(hx, top, hz);
    this.cable.scale.set(1, Math.max(1e-3, top - hookY), 1);
    this.cable.visible = live && top > hookY;
    this.hook.position.set(hx, hookY - 0.25, hz);

    // the netting hangs on a floor from its walls until NET_OFF
    s.starts.forEach((st, i) => {
      const age = t - st;
      this.nets[i]!.visible = age >= WALLS[0] && age < NET_OFF && t < off;
    });

    // dust: a puff from the four corners and the sides of each floor as its frame lands
    const o = this.o;
    let n = 0;
    s.starts.forEach((st, i) => {
      const age = t - st - FRAME_IN;
      for (let k = 0; k < DUST; k++) {
        const on = age >= 0 && age < 0.5 && t < off;
        if (!on) { o.scale.setScalar(0); } else {
          const a = (k / DUST) * Math.PI * 2 + hashSin(i, k);
          const r = 0.5 * Math.max(s.w, s.d) * (0.8 + 0.5 * easeOut3(age / 0.5));
          o.position.set(Math.cos(a) * r * (s.w / Math.max(s.w, s.d)), i * s.floorH + 0.3 + 0.8 * age, Math.sin(a) * r * (s.d / Math.max(s.w, s.d)));
          o.rotation.set(age * 3 + k, k, age * 2);
          o.scale.setScalar((0.9 + 0.6 * hashSin(k, i)) * (1 - age / 0.5));
        }
        o.updateMatrix();
        this.dust.setMatrixAt(n++, o.matrix);
      }
    });
    this.dust.instanceMatrix.needsUpdate = true;

    // the sparkle: when the last floor closes, stars burst out round the tower and fall away
    const sa = t - this.done, height = s.starts.length * s.floorH;
    for (let k = 0; k < SPARKS; k++) {
      if (sa < 0 || sa > 0.6 || t >= off) o.scale.setScalar(0);
      else {
        const a = (k / SPARKS) * Math.PI * 2, r = 0.6 * Math.max(s.w, s.d) + 9 * easeOut3(sa / 0.6);
        o.position.set(Math.cos(a) * r, height * hashSin(k, 3) + 6 * sa - 6 * sa * sa, Math.sin(a) * r);
        o.rotation.set(sa * 8, k, sa * 6);
        o.scale.setScalar(0.9 * (1 - sa / 0.6));
      }
      o.updateMatrix();
      this.sparks.setMatrixAt(k, o.matrix);
    }
    this.sparks.instanceMatrix.needsUpdate = true;
  }
}
