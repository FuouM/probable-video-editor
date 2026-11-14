// What the chorus lines do to the one game world in chorus 2 (treatment v8 "Plate 8"): the lines of chorus 1 happen again, for real and
// larger, round the running train. This module adds the parts to a `GameWorld` in its twisted state and poses them for a time t.
//
//   line 23  sardines grow out of the fields beside the track, as large as houses, ahead of the train
//   line 24  holes open in the platform of Station ホーム as the train runs it through, then in the ground under the crossing
//   line 25  the sleepers of the crossing go from under the wheels and fall
//   line 26  things lose their texture (the magenta and black checker): a station, the far hills, the rear car, the sardines
//   line 27  they flicker between the checker and their own look
//   line 28  the towers build down from the clouds over the zoned ground (`_pit.ts`)
//   line 29  the ground under the crossing opens (`_pit.ts`): the train hangs over the pit
//   ko       the tuna circle over the loop, lower and nearer on each line
//
// Station もと has no texture from the start: the save is broken there. Everything is a pure function of t after `bake()`.
import * as THREE from 'three';
import { DEG, clamp01, smooth, hashSin } from '@pve/engine/util';
import { missingMaterial } from '@pve/engine/gl';
import { Builder, allFaces, instanced, v3, type Face } from '@pve/engine/lit';
import { Shoal } from './_fish';
import { TunaSchool } from './_tuna';
import { GROUND_Y } from './_station';
import type { GameWorld } from './_gameWorld';
import { LOOP_C, LOOP_R, twistLap } from './_route';
import { Pit } from './_pit';
import { frameMatrix } from '@pve/engine/track';

export interface C2Times {
  /** The lap position (m, `twistLap`) of the middle of the front car at time t. */
  lapAt: (t: number) => number;
  /** The speed of the train (m/s). */
  speed: number;
  /** The unit starts of lines 23 and 24. */
  sprout: readonly number[];
  holes: readonly number[];
  /** The start of line 25. */
  sleepers: number;
  /** The unit starts of line 26, and the start and the end of line 27. */
  forget: readonly number[];
  unsure: readonly [number, number];
  /** The unit starts of lines 28 and 29. */
  floors: readonly number[];
  eye: readonly number[];
  /** The starts of the eight `ko` lines. */
  closer: readonly number[];
  /** The end of the clip. */
  end: number;
}

const BLUE = 34, YELLOW = 8;
const SHOALS = 10, SHOAL_FISH = 9, SHOAL_SCALE = 14;
const SLEEPER_GAP = 0.8;
const G = 9.81;

type Swap = { mesh: THREE.Mesh; own: THREE.Material | THREE.Material[]; missing: THREE.Material };

export class C2World {
  readonly pit: Pit;
  private lap = twistLap();
  private shoals: { shoal: Shoal; at: number }[] = [];
  private holes: { root: THREE.Object3D; r: number; at: number }[] = [];
  private sleepers: THREE.InstancedMesh;
  private sleeperGone: Float32Array;
  private blue: TunaSchool;
  private yellow: TunaSchool;
  private swaps = new Map<string, Swap[]>();
  private missing = new Map<string, boolean>();
  private o = new THREE.Object3D();

  constructor(world: GameWorld, private T: C2Times) {
    const A = world.atlas, mat = world.mat, lap = this.lap;

    // ---- line 23: the shoals. Each one stands where the train is about a second after it starts to grow, on one side of the track
    const stations = Object.values(lap.stations);
    for (let k = 0; k < SHOALS; k++) {
      const at = T.sprout[Math.min(T.sprout.length - 1, Math.floor((k * T.sprout.length) / SHOALS))]! + 0.02 * k;
      let l = T.lapAt(at + 1.15) + 6 * (hashSin(k, 3) - 0.5);
      // not on a platform: a shoal near a station goes on past it
      for (const s of stations) if (Math.abs(l - s) < 26) l = s + 26 + 4 * k;
      // outside the loop the bed is near the track. Inside it stands further in: the camera of chorus 3 passes 15 m inside the track there
      const f = lap.at(l), side = k % 2 ? -1 : 1, off = side * ((side < 0 ? 28 : 14) + 6 * hashSin(k, 5));
      const shoal = new Shoal(A, mat, SHOAL_FISH, 60 + k);
      shoal.scatter(2.0, 0.8);
      shoal.root.scale.setScalar(SHOAL_SCALE * (0.8 + 0.5 * hashSin(k, 7)));
      shoal.root.position.set(f.pos.x + f.side.x * off, GROUND_Y, f.pos.z + f.side.z * off);
      shoal.root.rotation.y = Math.atan2(-f.tangent.z, f.tangent.x) + (hashSin(k, 9) - 0.5) * 0.5;
      world.scene.add(shoal.root);
      this.shoals.push({ shoal, at });
      if (k % 3 === 1) this.reg(`shoal${k}`, shoal.root, 0.07);
    }

    // ---- line 24: the holes. A flat black disc with a grey rim; it opens in 0.3 s
    const dark: Face = { cell: A.solid('#010208') }, rim: Face = { cell: A.solid('#3a3a42') };
    const hb = new Builder();
    hb.cylinder(1.18, 1.18, 0.04, 16, rim, rim);
    hb.cylinder(1, 1, 0.06, 16, dark, dark);
    const holeGeo = hb.geometry();
    const hole = (parent: THREE.Object3D, x: number, y: number, z: number, r: number, at: number) => {
      const m = new THREE.Mesh(holeGeo, mat);
      m.position.set(x, y, z);
      m.frustumCulled = false;
      parent.add(m);
      this.holes.push({ root: m, r, at });
    };
    // on the platform of ホーム (station frame: the track along x, the platform from z = 1.7 to 5.7, its top at y = 0.9)
    const home = world.stations.home.root;
    const onPlat: [number, number, number][] = [[9, 3.4, 1.15], [3.5, 4.5, 0.8], [-2.5, 3.0, 1.0], [-8, 4.3, 0.9], [-13.5, 3.3, 1.2], [14, 4.6, 0.7]];
    onPlat.forEach(([x, z, r], i) => hole(home, x, 0.93, z, r, T.holes[Math.min(i, T.holes.length - 1)]!));
    // in the ground under the first part of the crossing
    for (let i = onPlat.length, j = 0; i < T.holes.length + 2; i++, j++) {
      const f = lap.at(lap.cross * (0.07 + 0.045 * j)), off = (j % 2 ? -1 : 1) * (9 + 3.5 * j);
      hole(world.scene, f.pos.x + f.side.x * off, GROUND_Y + 0.02, f.pos.z + f.side.z * off, 3.2 + 0.9 * j, T.holes[Math.min(i, T.holes.length - 1)]! + 0.12 * Math.max(0, i - T.holes.length + 1));
    }

    // ---- line 25: the sleepers of the crossing, one instance each
    const sb = new Builder();
    sb.box(0.22, 0.3, 2.2, allFaces(world.faces.sleeper));
    const n = Math.floor((lap.cross + 2) / SLEEPER_GAP);
    this.sleepers = instanced(sb.geometry(), mat, n);
    this.sleepers.receiveShadow = true;
    this.sleeperGone = new Float32Array(n);
    const lap0 = T.lapAt(T.sleepers);
    for (let k = 0; k < n; k++) {
      const l = -1 + (k + 0.5) * SLEEPER_GAP;
      // a sleeper goes when the nose of the train is 4 m before it. Those that the train has passed by the start of the line go on its first syllables
      this.sleeperGone[k] = l - 14 > lap0 ? T.sleepers + (l - 14 - lap0) / T.speed : T.sleepers + 0.35 * hashSin(k, 11);
    }
    world.scene.add(this.sleepers);

    // ---- lines 26 and 27: what can lose its texture
    this.reg('sunoko', world.stations.sunoko.root, 0.5);
    this.reg('moto', world.stations.moto.root, 0.5);
    this.reg('far', world.far, 24);
    this.reg('rear', world.cars[1].root, 0.7);

    // ---- lines 28 and 29: the zones and the pit. A floor on each unit of line 28 and between two units
    const floors: number[] = [];
    T.floors.forEach((u, i) => { floors.push(u); if (i + 1 < T.floors.length) floors.push((u + T.floors[i + 1]!) / 2); });
    while (floors.length < 18) floors.push(floors[floors.length - 1]! + 0.11);
    // the save loads at the start of chorus 2 (bar 61): the trees and sheds of the pit ground build up then, as the rest of the world loaded in verse 2
    this.pit = new Pit(world, floors, T.eye, T.end, (60 * 4 * 60) / 135);

    // ---- the tuna
    this.blue = new TunaSchool(A, mat, BLUE, false, 0.8);
    this.yellow = new TunaSchool(A, mat, YELLOW, true, 0.8);
    world.scene.add(this.blue.root, this.yellow.root);
  }

  async bake() { await this.pit.bake(); }

  /** The world as chorus 2 left it at time t, without the tuna (chorus 3 has its own). */
  freeze(t: number) {
    this.pose(t);
    this.blue.root.visible = false;
    this.yellow.root.visible = false;
  }

  /** Lists the meshes under `root` so that `setMissing(key)` can take their texture away. `cell`: the size of a checker square in the mesh's own units. */
  private reg(key: string, root: THREE.Object3D, cell: number) {
    const list: Swap[] = [];
    const missing = missingMaterial(cell);
    root.traverse((o) => { if (o instanceof THREE.Mesh) list.push({ mesh: o, own: o.material as THREE.Material | THREE.Material[], missing }); });
    this.swaps.set(key, list);
    this.missing.set(key, false);
  }

  /** Every thing that can lose its texture has its own look again (the train, when the rest of the world is not drawn). */
  ownLook() {
    for (const [key] of this.swaps) this.setMissing(key, false);
  }

  private setMissing(key: string, on: boolean) {
    if (this.missing.get(key) === on) return;
    this.missing.set(key, on);
    for (const s of this.swaps.get(key)!) s.mesh.material = on ? s.missing : s.own;
  }

  /** How close the tuna are at time t, 0 (far specks) to 1: one step on each `ko` line. */
  closeness(t: number): number {
    let c = 0;
    for (const s of this.T.closer) c += smooth((t - s) / 0.9);
    return c / this.T.closer.length;
  }

  /** True when the thing `key` shows the checker at time t. */
  private forgotten(key: string, i: number, t: number): boolean {
    const T = this.T;
    if (key === 'moto') return t < T.unsure[0] || t >= T.unsure[1] || hashSin(Math.floor(t * 9), 40) < 0.6;
    const at = T.forget[Math.min(T.forget.length - 1, i * 2)]!;
    if (t < at || t >= T.unsure[1]) return false;
    // line 27: was it gone or not? Each thing flickers on its own clock
    return t < T.unsure[0] || hashSin(Math.floor(t * (7 + i)), 41 + i) < 0.55;
  }

  /** Poses every part for time t. */
  pose(t: number) {
    const T = this.T, lap = this.lap, o = this.o;
    this.blue.root.visible = this.yellow.root.visible = true;
    const l = T.lapAt(t), train = lap.at(l);
    const t12 = Math.floor(t * 12) / 12;

    // the shoals rise on 12s, each fish a little after its neighbour
    for (const [k, s] of this.shoals.entries()) {
      s.shoal.root.visible = t >= s.at;
      if (s.shoal.root.visible) s.shoal.pose(t, (i) => clamp01((t12 - s.at - 0.35 * hashSin(i, 20 + k)) / 0.5));
    }

    for (const h of this.holes) {
      const k = smooth((t - h.at) / 0.3);
      h.root.visible = k > 0;
      const r = h.r * k * (1 + 0.04 * Math.sin(t12 * 9 + h.r * 7));
      h.root.scale.set(r, 1, r);
    }

    // the sleepers: in place, then the wheels kick them out: they fly on with half the speed of the train, away from the rails, with a spin
    for (let k = 0; k < this.sleeperGone.length; k++) {
      const f = lap.at(-1 + (k + 0.5) * SLEEPER_GAP), tau = t - this.sleeperGone[k]!;
      o.matrix.copy(frameMatrix(f, 0, -0.45, 0));
      if (tau > 0) {
        if (tau > 2.4) o.matrix.makeScale(0, 0, 0);
        else {
          o.matrix.decompose(o.position, o.quaternion, o.scale);
          const sx = (hashSin(k, 12) - 0.5) * 9, up = 4 + 4 * hashSin(k, 13);
          o.position.addScaledVector(f.side, sx * tau).addScaledVector(f.tangent, 0.55 * T.speed * tau).addScaledVector(f.up, up * tau);
          o.position.y -= 0.5 * G * 1.5 * tau * tau;
          o.rotateX((hashSin(k, 14) - 0.5) * 9 * tau);
          o.rotateZ((hashSin(k, 15) - 0.5) * 6 * tau);
          o.updateMatrix();
        }
      }
      this.sleepers.setMatrixAt(k, o.matrix);
    }
    this.sleepers.instanceMatrix.needsUpdate = true;

    // the checker
    ['sunoko', 'far', 'rear'].forEach((key, i) => this.setMissing(key, this.forgotten(key, i, t)));
    this.setMissing('moto', this.forgotten('moto', 0, t));
    for (const [k] of this.shoals.entries()) if (this.swaps.has(`shoal${k}`)) this.setMissing(`shoal${k}`, this.forgotten('shoal', 3 + (k % 3), t));

    this.pit.pose(t, { x: train.pos.x, z: train.pos.z });
    this.poseTuna(t, l);
  }

  /**
   * The tuna circle over the loop, ahead of the train: a stream that leads it by 20 to 75 degrees. On each `ko` line the stream is lower
   * and its ring is nearer to the track. The yellowfin join on line 4.
   */
  private poseTuna(t: number, l: number) {
    const c = this.closeness(t) ** 1.1;
    const a0 = this.lap.angle(l);
    const lerp = THREE.MathUtils.lerp;
    const place = (i: number, n: number, seed: number, p: THREE.Vector3, v: THREE.Vector3) => {
      const s = (i + 0.5) / n;
      const a = (a0 + 20 + 55 * s + 6 * (hashSin(i, seed) - 0.5)) * DEG;
      const r = LOOP_R + lerp(60, 4, c) * (0.5 + hashSin(i, seed + 1)) - 22 + 44 * hashSin(i, seed + 2);
      const y = lerp(120, 15, c) * (0.75 + 0.5 * hashSin(i, seed + 3)) + 26 * s + 1.5 * Math.sin(t * 0.9 + i * 1.7);
      p.set(LOOP_C.x + r * Math.sin(a), y, LOOP_C.z + r * Math.cos(a));
      // along the loop, with a slight dive
      v.set(Math.cos(a), -0.16, -Math.sin(a)).multiplyScalar(14);
    };
    const bp: THREE.Vector3[] = [], bv: THREE.Vector3[] = [];
    for (let i = 0; i < BLUE; i++) { const p = v3(0, 0, 0), v = v3(0, 0, 0); place(i, BLUE, 10, p, v); bp.push(p); bv.push(v); }
    this.blue.pose(t, bp, bv, undefined, lerp(2.2, 1.3, c));
    const yp: THREE.Vector3[] = [], yv: THREE.Vector3[] = [];
    if (t >= this.T.closer[4]!) for (let i = 0; i < YELLOW; i++) { const p = v3(0, 0, 0), v = v3(0, 0, 0); place(i * 4 + 2, BLUE, 30, p, v); yp.push(p); yv.push(v); }
    this.yellow.pose(t, yp, yv, undefined, lerp(2.2, 1.3, c));
  }

  dispose() {
    this.pit.dispose();
    this.sleepers.geometry.dispose();
    for (const [key] of this.swaps) this.setMissing(key, false);
  }
}
