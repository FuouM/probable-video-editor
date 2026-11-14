// The tuna fall of chorus 3 (treatment v8 plate 9): bluefin and yellowfin dive at 45 degrees onto the town and stay stuck. A hit is a
// game fault, not a blast: a white pop, a cube of the magenta and black missing-texture checker that blinks and goes in steps, a ring
// of light, white cartoon puffs, and a patch of the checker where the fish went in. The roof tiles break into Rapier debris, as the
// blocks of a game do. The dive and the wobble of a stuck fish are analytic; only the tiles are baked (one small bake for each impact,
// in a frame local to the impact).
// The scene places the falls (`Fall`). A fall with `breakAt` is a fish that the player typed in time: it pulls out of its dive at
// that time, flies up and away, and hits nothing.
//
// A frame depends only on t: `Falls.pose(t, un)` writes the instances. A stuck fish rides with the chunk of the world it sticks in
// (`un`, see `@pve/engine/chunks` and `_c3unload.ts`) when that chunk is unloaded. The explosions step at 18 fps (secondary motion).
import * as THREE from 'three';
import { mulberry32 } from '@pve/engine/util';
import { bake, type Baked, type BodySpec } from '@pve/engine/physics';
import { Builder, allFaces, instanced, v3, type Face, type LitAtlas } from '@pve/engine/lit';
import { TunaSchool } from './_tuna';
import type { Unload } from '@pve/engine/chunks';

/** The dive: down and toward -x, 45 degrees. */
export const DIVE = v3(-1, -1, 0).normalize();
/** A tuna is huge: 3.2 times the 2.5 m of the kit, 8 m from nose to tail. */
export const TUNA_SIZE = 3.2;
/** The nose goes this deep into what it hits (m). */
export const SINK = 0.9 * TUNA_SIZE;
const TILES = 14;
const DEBRIS_T = 3.4;

export type FallKind = 'roof' | 'platform';

export interface Fall {
  /** The time of the impact. */
  ti: number;
  kind: FallKind;
  yellow: boolean;
  /** The nose tip at rest, the surface point it entered, the slope of the surface (rad) and the depth of the ground under it (m). */
  nose: THREE.Vector3;
  hit: THREE.Vector3;
  phi: number;
  gh: number;
  /** The fish of the close-up window (`[STAT: POISON SPINE]`). */
  hero: boolean;
  /** The ko line (0..3 of the chorus) whose typing prompt is locked on this fish, or -1. */
  line: number;
  /** A note of the DIVA game: the ko line (4..7) and the unit (syllable) it carries. Null for the fish of the typing game. */
  note: { line: number; unit: number } | null;
  /** The bend of the trail (m at its middle, signed): 0 for a straight dive. */
  curve: number;
  /** How long before the impact the fish is in the world (s), and how fast it dives (m/s). */
  flight: number;
  speed: number;
  /** The player typed this fish at this time, before its impact: it pulls out of the dive and hits nothing. */
  breakAt?: number;
}

/** The side of the dive in the plane x-y (up and to the left on the screen): a curved trail bends along it. */
const SIDE = v3(-1, 1, 0).normalize();
/** The fault of a hit: the checker cube lasts `FIRE` s, the ring runs out for `RING` s, the puffs last `SMOKE` s. */
const FIRE = 0.5, RING = 0.35, SMOKE = 0.7, PUFFS = 3;
/** The size of an explosion against that of v8: the side view of chorus 3 stands further off. */
const BLAST = 1.7;
/** Secondary motion steps at 18 fps. */
const step18 = (t: number) => Math.floor(t * 18 + 1e-6) / 18;

/** A low-poly ball of radius 1 (an octahedron, outward faces). */
function ball(b: Builder, f: Face) {
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = v3(sx, 0, 0), q = v3(0, sy, 0), r = v3(0, 0, sz);
    if (sx * sy * sz > 0) b.tri(p, q, r, f); else b.tri(p, r, q, f);
  }
}

const ONE = new THREE.Vector3(1, 1, 1);
/** A hidden instance: at the origin, a ten-thousandth of its size. */
const GONE = new THREE.Vector3(1e-4, 1e-4, 1e-4);
const ORIGIN = new THREE.Vector3(0, 0, 0);

export class Falls {
  readonly root = new THREE.Group();
  private readonly blue: TunaSchool;
  private readonly yellow: TunaSchool;
  private readonly tiles: THREE.InstancedMesh;
  private readonly chips: THREE.InstancedMesh;
  private readonly holes: THREE.InstancedMesh;
  /** The fault of each impact: the white pop, the checker cube, the ring and the puffs. */
  private readonly core: THREE.InstancedMesh;
  private readonly fire: THREE.InstancedMesh;
  private readonly ring: THREE.InstancedMesh;
  private readonly smoke: THREE.InstancedMesh;
  private readonly baked: (Baked | null)[] = [];
  private readonly roofs: number[];
  private readonly platforms: number[];
  private readonly P = new THREE.Vector3();
  private readonly Q = new THREE.Quaternion();
  private readonly M = new THREE.Matrix4();
  private readonly X = new THREE.Matrix4();
  private readonly D = new THREE.Vector3();

  constructor(A: LitAtlas, mat: THREE.Material, readonly falls: readonly Fall[]) {
    const nBlue = falls.filter((f) => !f.yellow).length, nYellow = falls.length - nBlue;
    this.blue = new TunaSchool(A, mat, nBlue, false, 1);
    this.yellow = new TunaSchool(A, mat, nYellow, true, 1);
    this.roofs = falls.flatMap((f, i) => (f.kind === 'roof' && f.breakAt === undefined ? [i] : []));
    this.platforms = falls.flatMap((f, i) => (f.kind === 'platform' && f.breakAt === undefined ? [i] : []));
    const f = (c: string, emit = 0): Face => ({ cell: A.solid(c, emit) });
    const clay = f('#a8502f'), chip = f('#a9a79c');
    // the missing texture: magenta and black squares that glow a little
    const checker: Face = { cell: A.paint(4, 4, (p) => { p.fill('#000000', 0.5); p.rect(0, 0, 2, 2, '#ff00ff', 3); p.rect(2, 2, 2, 2, '#ff00ff', 3); }) };
    const tb = new Builder();
    tb.box(0.6, 0.07, 0.44, allFaces(clay));
    this.tiles = instanced(tb.geometry(), mat, Math.max(1, this.roofs.length * TILES));
    const cb = new Builder();
    cb.box(0.5, 0.2, 0.4, allFaces(chip));
    this.chips = instanced(cb.geometry(), mat, Math.max(1, this.platforms.length * TILES));
    const hb = new Builder();
    hb.quad(v3(-1.3, 0, 1), v3(1.3, 0, 1), v3(1.3, 0, -1), v3(-1.3, 0, -1), checker);
    this.holes = instanced(hb.geometry(), mat, falls.length);
    // the fault: a white pop, a cube of the checker, a flat ring of light in the plane of the surface, white puffs
    const kb = new Builder(), fb = new Builder(), sb = new Builder(), rb = new Builder();
    ball(kb, f('#ffffff', 6));
    fb.box(2, 2, 2, allFaces(checker));
    ball(sb, f('#f4f6ff', 0.6));
    const hot = f('#bff4ff', 2.4);
    const RS = 16;
    for (let k = 0; k < RS; k++) {
      const a0 = (k / RS) * Math.PI * 2, a1 = ((k + 1) / RS) * Math.PI * 2;
      const p = (a: number, r: number) => v3(Math.cos(a) * r, 0, Math.sin(a) * r);
      // seen from above and from below: the ring lies in the slope of a roof
      rb.quad(p(a0, 1), p(a1, 1), p(a1, 0.93), p(a0, 0.93), hot);
      rb.quad(p(a0, 0.93), p(a1, 0.93), p(a1, 1), p(a0, 1), hot);
    }
    this.core = instanced(kb.geometry(), mat, falls.length);
    this.fire = instanced(fb.geometry(), mat, falls.length);
    this.ring = instanced(rb.geometry(), mat, falls.length);
    this.smoke = instanced(sb.geometry(), mat, falls.length * PUFFS);
    for (const m of [this.tiles, this.chips]) { m.castShadow = true; m.receiveShadow = true; }
    for (const m of [this.holes, this.core, this.fire, this.ring, this.smoke]) { m.castShadow = false; m.receiveShadow = false; }
    this.holes.receiveShadow = true;
    this.root.add(this.blue.root, this.yellow.root, this.tiles, this.chips, this.holes, this.core, this.fire, this.ring, this.smoke);
  }

  /** The debris: one Rapier bake for each impact (the tiles of a roof, the chips of a platform), in a frame at the surface point. */
  async bake() {
    const rnd = mulberry32(0xd3b7);
    for (const fall of this.falls) {
      if (fall.breakAt !== undefined) { this.baked.push(null); continue; }
      const phi = fall.phi;
      const qs = new THREE.Quaternion().setFromAxisAngle(v3(1, 0, 0), phi);
      const n = v3(0, 1, 0).applyQuaternion(qs);
      const up = v3(0, Math.sin(phi), -Math.cos(phi));
      const roof = fall.kind === 'roof';
      const bodies: BodySpec[] = [];
      // the surface (a slab whose top face passes through the origin) and the ground far under it
      const half: [number, number, number] = roof ? [8, 0.15, 2.4] : [6, 0.4, 2.0];
      const sp = n.clone().multiplyScalar(-half[1]);
      bodies.push({ shape: { kind: 'box', half }, pose: { p: [sp.x, sp.y, sp.z], q: [qs.x, qs.y, qs.z, qs.w] }, type: 'fixed', friction: 0.8 });
      bodies.push({ shape: { kind: 'box', half: [60, 0.3, 60] }, pose: { p: [0, -fall.gh - 0.3, 0], q: [0, 0, 0, 1] }, type: 'fixed', friction: 0.9 });
      for (let k = 0; k < TILES; k++) {
        const sx = (rnd() - 0.5) * 3.4, ss = (rnd() - 0.5) * 2.4;
        const spin = new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), rnd() * Math.PI);
        const q = qs.clone().multiply(spin);
        const p = v3(sx, 0, 0).addScaledVector(up, ss).addScaledVector(n, 0.07);
        // the tiles are thrown up and out of the hole by the strike
        const out = n.clone().multiplyScalar(3.5 + rnd() * 6).addScaledVector(v3(1, 0, 0), (rnd() - 0.5) * 9 + sx * 1.2).addScaledVector(up, (rnd() - 0.5) * 6 + ss);
        bodies.push({
          shape: { kind: 'box', half: roof ? [0.3, 0.035, 0.22] : [0.25, 0.1, 0.2] },
          pose: { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] }, type: 'dynamic',
          vel: [out.x, out.y, out.z], spin: [(rnd() - 0.5) * 14, (rnd() - 0.5) * 14, (rnd() - 0.5) * 14],
          density: 1.6, friction: 0.7, restitution: 0.22, damping: [0.05, 0.2],
        });
      }
      this.baked.push(await bake({ t0: fall.ti, t1: fall.ti + DEBRIS_T, hz: 60, bodies, gravity: [0, -9.81, 0] }));
    }
  }

  /** The middle of fall i's fish at time t (m), before the world is unloaded: in the dive, stuck, or (a typed fish) on its way up and out. Only while it is in the world. */
  centre(i: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    const fall = this.falls[i]!;
    if (fall.breakAt !== undefined && t >= fall.breakAt) {
      // it keeps its speed over the ground, and its fall turns into a climb in 0.3 s
      const tau = t - fall.breakAt, s = Math.min(1, tau / 0.3);
      const turned = tau < 0.3 ? 0.3 * (s * s * s - 0.5 * s * s * s * s) : 0.15 + (tau - 0.3);
      this.centre(i, fall.breakAt - 1e-4, out);
      out.x += DIVE.x * fall.speed * tau;
      out.y += DIVE.y * fall.speed * (tau - 2 * turned);
      return out;
    }
    const d = t < fall.ti ? DIVE : this.stuckDir(i, t - fall.ti, this.D);
    out.copy(fall.nose).addScaledVector(d, -1.25 * TUNA_SIZE);
    if (t < fall.ti) {
      const s = fall.speed * (fall.ti - t), len = fall.speed * fall.flight;
      out.addScaledVector(DIVE, -s);
      // a note's trail bends out to the side and comes back onto the dive line for the hit
      if (fall.curve !== 0) out.addScaledVector(SIDE, fall.curve * Math.sin(Math.PI * Math.min(1, s / len)));
    }
    return out;
  }

  /** The direction of a stuck fish `dt` s after its impact: the dive turned by the rocking about its nose. */
  private stuckDir(i: number, dt: number, out: THREE.Vector3): THREE.Vector3 {
    const a = 0.2 * Math.exp(-2.4 * dt) * Math.sin(26 * dt + i) + 0.015 * Math.sin(5 * dt + i * 2.1);
    const c = Math.cos(a), s = Math.sin(a);
    return out.set(DIVE.x * c - DIVE.y * s, DIVE.x * s + DIVE.y * c, 0);
  }

  /** Writes every tuna, tile and hole at time t. What sticks in a chunk of the world rides with it when the chunk unloads (`un`). */
  pose(t: number, un: Unload) {
    const blueP: THREE.Vector3[] = [], blueV: THREE.Vector3[] = [], blueW: number[] = [];
    const yelP: THREE.Vector3[] = [], yelV: THREE.Vector3[] = [], yelW: number[] = [];
    const X = this.X;
    this.falls.forEach((fall, i) => {
      if (t < fall.ti - fall.flight) return;
      const p = v3(0, 0, 0), v = v3(0, 0, 0);
      let wag = 1;
      if (fall.breakAt !== undefined && t >= fall.breakAt) {
        // typed in time: it breaks up in the air (the scene draws its scales). It is not drawn from then on
        return;
      } else if (t < fall.ti) {
        this.centre(i, t, p);
        // the heading of the trail (a note's bends): the step of the last 1/60 s
        if (fall.curve === 0) v.copy(DIVE).multiplyScalar(fall.speed);
        else v.subVectors(p, this.centre(i, t - 1 / 60, this.P)).multiplyScalar(60);
      } else {
        // stuck: the fish rocks about its nose and the rocking dies away; the body goes on shivering a little
        const dt = t - fall.ti;
        this.centre(i, t, p);
        v.copy(this.D).multiplyScalar(0.8);
        wag = 0.35 * Math.exp(-dt) + 0.08;
        // the chunk it sticks in is unloaded: the fish rises with it
        un.xf(fall.hit.x, fall.hit.z, t, X);
        p.applyMatrix4(X);
        v.transformDirection(X).multiplyScalar(0.8);
      }
      (fall.yellow ? yelP : blueP).push(p);
      (fall.yellow ? yelV : blueV).push(v);
      (fall.yellow ? yelW : blueW).push(wag);
    });
    this.blue.pose(t, blueP, blueV, blueW, TUNA_SIZE);
    this.yellow.pose(t, yelP, yelV, yelW, TUNA_SIZE);

    // the tiles and chips and the holes they came from
    const spots: [THREE.InstancedMesh, number[]][] = [[this.tiles, this.roofs], [this.chips, this.platforms]];
    for (const [mesh, ids] of spots) {
      ids.forEach((id, slot) => {
        const fall = this.falls[id]!;
        un.xf(fall.hit.x, fall.hit.z, t, X);
        for (let k = 0; k < TILES; k++) {
          const b = this.baked[id];
          if (t < fall.ti || !b) this.M.compose(ORIGIN, this.Q.identity(), GONE);
          else {
            b.pose(2 + k, t, this.P, this.Q);
            this.M.compose(this.P.add(fall.hit), this.Q, ONE).premultiply(X);
          }
          mesh.setMatrixAt(slot * TILES + k, this.M);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.falls.forEach((fall, i) => {
      if (t < fall.ti || fall.breakAt !== undefined) this.M.compose(ORIGIN, this.Q.identity(), GONE);
      else {
        this.Q.setFromAxisAngle(v3(1, 0, 0), fall.phi);
        const lift = v3(0, 1, 0).applyQuaternion(this.Q).multiplyScalar(0.05);
        un.xf(fall.hit.x, fall.hit.z, t, X);
        this.M.compose(this.P.copy(fall.hit).add(lift), this.Q, ONE).premultiply(X);
      }
      this.holes.setMatrixAt(i, this.M);
    });
    this.holes.instanceMatrix.needsUpdate = true;
    this.poseBlasts(t, un);
  }

  /** The explosion of every impact at time t (stepped at 18 fps): it rides with the chunk of the world it is in. */
  private poseBlasts(t: number, un: Unload) {
    const ts = step18(t), X = this.X, M = this.M, Q = this.Q, P = this.P, S = this.D;
    const hide = (m: THREE.InstancedMesh, i: number) => m.setMatrixAt(i, M.compose(ORIGIN, Q.identity(), GONE));
    this.falls.forEach((fall, i) => {
      const dt = fall.breakAt !== undefined ? -1 : ts - fall.ti;
      un.xf(fall.hit.x, fall.hit.z, t, X);
      const live = dt >= 0;
      // the pop: a white flash that goes in 0.15 s
      const grow = 1 - Math.exp(-14 * dt);
      const lift = 1.6;
      if (live && dt < 0.15) {
        M.compose(P.copy(fall.hit).setY(fall.hit.y + lift), Q.identity(), S.setScalar(BLAST * 2.2 * grow * (1 - dt / 0.15) + 0.3)).premultiply(X);
        this.core.setMatrixAt(i, M);
      } else hide(this.core, i);
      // the checker cube: it pops up to its size, blinks on the steps of 18 fps, and goes in three steps
      if (live && dt < FIRE && Math.floor(dt * 18) % 4 !== 3) {
        const r = BLAST * 1.6 * (dt < 0.1 ? grow : 1 - Math.floor((dt / FIRE) * 3) / 3);
        Q.setFromAxisAngle(this.D.set(0, 1, 0), Math.floor(dt * 6) * (Math.PI / 4) + i);
        M.compose(P.copy(fall.hit).setY(fall.hit.y + lift), Q, S.setScalar(Math.max(0.01, r))).premultiply(X);
        this.fire.setMatrixAt(i, M);
      } else hide(this.fire, i);
      // the ring of light that runs out over the surface
      if (live && dt < RING) {
        Q.setFromAxisAngle(this.D.set(1, 0, 0), fall.phi);
        const r = 1 + BLAST * 7 * Math.sqrt(dt / RING);
        M.compose(P.copy(fall.hit), Q, S.set(r, 1, r)).premultiply(X);
        this.ring.setMatrixAt(i, M);
      } else hide(this.ring, i);
      // the puffs: three round white clouds that pop out to the sides and shrink away, as in a cartoon
      for (let k = 0; k < PUFFS; k++) {
        const ds = dt - 0.04 * k, j = i * PUFFS + k;
        if (ds < 0 || ds > SMOKE) { hide(this.smoke, j); continue; }
        const u = ds / SMOKE, out = 1 - Math.exp(-8 * ds);
        const r = BLAST * 1.1 * Math.sin(Math.PI * Math.min(1, u * 1.15));
        P.set(fall.hit.x + (k - 1) * 3.2 * out, fall.hit.y + 1.4 + 2.2 * out, fall.hit.z + (k % 2 ? 1.5 : -1.5) * out);
        Q.setFromAxisAngle(this.D.set(0, 1, 0), k);
        M.compose(P, Q, S.setScalar(Math.max(0.01, r))).premultiply(X);
        this.smoke.setMatrixAt(j, M);
      }
    });
    for (const m of [this.core, this.fire, this.ring, this.smoke]) m.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
}
