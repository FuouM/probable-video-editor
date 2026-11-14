// The flower walls of the bridge (treatment v9 "Plate 5", line 13): six walls, one for each syllable (は な は か れ ず).
//   the wall     a grid of flowers across the flight path. The cursor stamps it a little before the hit. On the hit the whole wall
//                lets go: the flowers in the path of the car are thrown and carried along it, the rest go a moment later, in a wave
//                that runs out from the nose, and flow away in the air and sink behind the train. Nothing of the wall stays.
//   the nose     some flowers of each hit stick to the front of the car and pile up there over the walls. Each holds for a while,
//                then the air pushes it to the edge of the front, along the side and off the back.
//   the loose    the flowers and the petals are particles in one field of turbulence, baked once at 36 Hz: the air round the car
//                carries the ones of the path along the car sides and over the roof, so they are still in the air in line 14. None
//                goes through the car. `sv_wind 0` stops them where they are and takes their colour.
// `FlowerWalls.pose(t)` writes the instances for time t: a pure function of t.
import * as THREE from 'three';
import { mulberry32, stepT, smooth } from '@pve/engine/util';
import { Builder, instanced, litMaterial, v3, type Face, type LitAtlas } from '@pve/engine/lit';
import { T_LAUNCH, T_WALLS, T_WIND, rampY, type TrainPath } from './_bridgepath';

export const FLOWER_PALETTE = ['#ff2a1a', '#ff7a10', '#ffc21a', '#d01030', '#ff5a20'];
const ICE = new THREE.Color('#bfe4ff');

/**
 * Instances of one geometry in palette colours: one mesh for each colour, because the material tint also tints the emission
 * (an instance colour does not). `colours[i]` is the palette index of instance i.
 */
class Tinted {
  readonly meshes: THREE.InstancedMesh[] = [];
  private slot: { m: number; k: number }[] = [];
  private base: THREE.Color[] = [];

  constructor(geo: THREE.BufferGeometry, atlas: LitAtlas, colours: number[]) {
    const used = FLOWER_PALETTE.map(() => 0);
    for (const c of colours) { this.slot.push({ m: c, k: used[c]!++ }); }
    FLOWER_PALETTE.forEach((hex, m) => {
      const mat = litMaterial(atlas, { tint: hex });
      this.base.push(mat.color.clone());
      const mesh = instanced(geo, mat, Math.max(1, used[m]!));
      mesh.count = used[m]!;
      this.meshes.push(mesh);
    });
  }

  /** Blends every colour of the palette towards `to` by `u` (the frost takes the colour out of the petals). */
  freeze(to: THREE.Color, u: number) {
    this.meshes.forEach((m, k) => (m.material as THREE.MeshLambertMaterial).color.copy(this.base[k]!).lerp(to, u));
  }

  set(i: number, m: THREE.Matrix4) { const s = this.slot[i]!; this.meshes[s.m]!.setMatrixAt(s.k, m); }
  commit() { for (const m of this.meshes) m.instanceMatrix.needsUpdate = true; }
  dispose() { for (const m of this.meshes) { m.dispose(); (m.material as THREE.Material).dispose(); } }
}

/** The grid of a wall: the columns go from the far side (z -) to a little past the line, so the wall stays clear of the chase camera. */
const COLS = 12, ROWS = 13, DZ = 1.3, DY = 1.4, Z0 = -11;
/** The path of the car through a wall: half the width and half the height of the car, with a little room. */
const HOLE_Z = 2.3, HOLE_Y = 2.7;
/** A flower of the wall is this large (the quads are 1.3 m). */
const WALL_SCALE = 1.7;
/** The cursor stamps a wall this long before the hit, but never before the first frame of the bridge. */
const LEAD = 0.4, FIRST_STAMP = 56.1;
const PETALS_PER_HIT = 70;
/** The flowers of each hit that stick to the nose, and the speed (m/s) of the wave in which the rest of the wall lets go. */
const STICK = 14, WAVE = 14;
const HZ = 36;
/** The loose flowers and petals are gone by here: the train has fallen away from them. */
const T_GONE = 72.3;

/** `drift`: a flower of the wall away from the path of the car: it flows away and sinks in the air, it is not carried along the car. */
interface Loose { wall: number; flower: boolean; drift: boolean; t0: number; home: THREE.Vector3; rot: THREE.Euler; s: number; ph: number; a: number; r: number; th: number; om: number; push: THREE.Vector3 }
/** A flower on the nose: its place on the front of the car (y, z), its layer in the pile, how long it holds, the side it slides to. */
interface Stuck { wall: number; home: THREE.Vector3; rot: THREE.Euler; y: number; z: number; layer: number; hold: number; side: number; ph: number }

/** A flower: three crossed quads, both sides. */
function flowerBuilder(A: LitAtlas): Builder {
  const cell = A.paint(16, 16, (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8, dy = y + 0.5 - 8.5, r = Math.hypot(dx, dy);
      const lobe = 5.6 + 1.5 * Math.cos(5 * Math.atan2(dy, dx));
      if (r <= 2.1) p.px(x, y, '#ffe9a8', 1.4);
      else if (r <= lobe) p.px(x, y, r > lobe - 1.2 ? '#ffd6c0' : '#fff6ee', 1.1);
    }
    for (let y = 0; y < 3; y++) p.px(8, y, '#3a8a2a');
    p.px(5, 1, '#3a8a2a'); p.px(11, 1, '#2a6a20'); p.px(6, 2, '#3a8a2a');
  });
  const face: Face = { cell, map: 'fit' };
  const fb = new Builder();
  for (let k = 0; k < 3; k++) {
    const m = new THREE.Matrix4().makeRotationY((k * Math.PI) / 3);
    fb.quad(v3(-0.65, -0.65, 0), v3(0.65, -0.65, 0), v3(0.65, 0.65, 0), v3(-0.65, 0.65, 0), face, m);
    fb.quad(v3(0.65, -0.65, 0), v3(-0.65, -0.65, 0), v3(-0.65, 0.65, 0), v3(0.65, 0.65, 0), face, m);
  }
  return fb;
}

/** A petal: one quad, both sides. */
function petalBuilder(A: LitAtlas): Builder {
  const petalCell = A.paint(8, 8, (p) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const r = Math.hypot(x + 0.5 - 4, y + 0.5 - 4);
      if (r < 3.6 && !(x === 0 && y === 0)) p.px(x, y, r < 1.8 ? '#fff0c8' : '#fff4ee', 1.3);
    }
  });
  const pf: Face = { cell: petalCell, map: 'fit' };
  const pb = new Builder();
  pb.quad(v3(-0.22, -0.22, 0), v3(0.22, -0.22, 0), v3(0.22, 0.22, 0), v3(-0.22, 0.22, 0), pf);
  pb.quad(v3(0.22, -0.22, 0), v3(-0.22, -0.22, 0), v3(-0.22, 0.22, 0), v3(0.22, 0.22, 0), pf);
  return pb;
}

export class FlowerWalls {
  readonly root = new THREE.Group();
  /** The middle of the path of the car through each wall (the cursor stamps there), and the time of each stamp. */
  readonly centres: THREE.Vector3[] = [];
  readonly stamps: number[] = T_WALLS.map((hit) => Math.max(FIRST_STAMP, hit - LEAD));
  private loose: Loose[] = [];
  private stuck: Stuck[] = [];
  private stuckMesh: Tinted;
  private flowerMesh: Tinted;
  private petalMesh: Tinted;
  private nFlowers = 0;
  private t0: number;
  private steps: number;
  private data: Float32Array;
  private o = new THREE.Object3D();
  private tmpM = new THREE.Matrix4();
  private tmpM2 = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();
  /** From this time on the loose flowers move no more: their poses change with the fade only. `posedFade`: the fade of the poses that the meshes hold (NaN: poses of a time before `settled`). */
  private settled = 0;
  private posedFade = NaN;

  constructor(A: LitAtlas, private path: TrainPath) {
    const rnd = mulberry32(0xfa29);
    const fb = flowerBuilder(A);
    const pb = petalBuilder(A);
    this.buildWalls(rnd);
    const pick = () => Math.floor(rnd() * FLOWER_PALETTE.length);
    // the flowers first, then the petals: one index into the bake for both
    this.loose.sort((p, q) => Number(q.flower) - Number(p.flower));
    this.nFlowers = this.loose.filter((d) => d.flower).length;
    this.flowerMesh = new Tinted(fb.geometry(), A, this.loose.slice(0, this.nFlowers).map(pick));
    this.petalMesh = new Tinted(pb.geometry(), A, this.loose.slice(this.nFlowers).map(pick));
    this.stuckMesh = new Tinted(fb.geometry(), A, this.stuck.map(pick));
    this.root.add(...this.stuckMesh.meshes, ...this.flowerMesh.meshes, ...this.petalMesh.meshes);

    this.t0 = T_WALLS[0]! - 0.1;
    this.steps = Math.ceil((T_WIND - this.t0) * HZ) + 1;
    this.data = new Float32Array(this.steps * this.loose.length * 3);
    this.bake(rnd);
    this.settled = Math.max(T_WIND, ...this.loose.map((d) => d.t0 + 0.6), ...this.stamps.map((s) => s + 2 / 36));
  }

  /** The walls: each stands across the flight path one nose length ahead of the train at its syllable. */
  private buildWalls(rnd: () => number) {
    const path = this.path;
    const station = () => {
      const th = rnd() * Math.PI * 2;
      // on the camera's side (z +) the flowers keep to the front half of the car: none hangs in front of the lens of the chase
      const a = Math.cos(th) > 0.3 ? 2 + rnd() * 12 : -12 + rnd() * 26;
      return { a, r: 2.9 + rnd() * 4.2, th, om: (rnd() < 0.5 ? -1 : 1) * (0.35 + 0.8 * rnd()) };
    };
    // the pile on the nose grows over the walls: a flower of a later wall lies on the ones before it
    let layer = 0;
    T_WALLS.forEach((hit, w) => {
      const a = path.at(hit);
      const nose = a.p.x + 9.9 * Math.cos(a.pitch) + 0.7;
      const yc = a.p.y + 1.85 + 9.9 * Math.sin(a.pitch);
      const c = v3(nose, yc, 0);
      this.centres.push(c);
      const fwd = a.v.clone().normalize();
      const xRampEnd = path.at(T_LAUNCH).p.x;
      const inPath: { p: THREE.Vector3; rot: THREE.Euler }[] = [];
      // two layers, the second half a cell off in both directions and a little behind: the flowers of one fill the gaps of the other,
      // so the wall is a solid sheet of flowers with no sky through it
      for (let L = 0; L < 2; L++) for (let j = 0; j < ROWS - L; j++) for (let i = 0; i < COLS - L; i++) {
        const p = v3(nose + 0.35 * L + (rnd() - 0.5) * 0.5, yc + (j + 0.5 * L - (ROWS - 1) / 2) * DY + (rnd() - 0.5) * 0.3, Z0 + (i + 0.5 * L) * DZ + (rnd() - 0.5) * 0.25);
        const rot = new THREE.Euler(rnd() * 0.5 - 0.25, rnd() * 3, rnd() * 0.5 - 0.25);
        // no flower in the trestle (it ends where the train leaves the rails) or in the ground
        if (p.x < xRampEnd && p.y < rampY(p.x) + 1.2 && Math.abs(p.z) < 2.6) continue;
        if (p.y < 0.4) continue;
        const dz = p.z, dy = p.y - yc;
        if (Math.abs(dz) < HOLE_Z && Math.abs(dy) < HOLE_Y) { inPath.push({ p, rot }); continue; }
        // the rest of the wall lets go in a wave from the path of the car: it is pushed forward and out, less the further it is
        const d = Math.hypot(Math.max(0, Math.abs(dz) - HOLE_Z), Math.max(0, Math.abs(dy) - HOLE_Y));
        const out = v3(0, dy, dz).normalize(), k = Math.exp(-d / 4);
        const push = fwd.clone().multiplyScalar(a.v.length() * (0.08 + 0.3 * k) * (0.7 + 0.6 * rnd())).addScaledVector(out, 1 + 6 * k).add(v3(0, (rnd() - 0.3) * 2, (rnd() - 0.5) * 2));
        this.loose.push({ wall: w, flower: true, drift: true, t0: hit + d / WAVE + 0.04 * rnd(), home: p, rot, s: 1, ph: rnd() * 6.28, ...station(), push });
      }
      // the flowers in the path: some stick to the nose, the others are thrown and carried along the car
      inPath.forEach(({ p, rot }, k) => {
        if (k % Math.max(1, Math.floor(inPath.length / STICK)) === 0 && this.stuck.filter((s) => s.wall === w).length < STICK) {
          const dz = p.z, dy = p.y - yc;
          this.stuck.push({ wall: w, home: p, rot, y: 1.85 + THREE.MathUtils.clamp(dy * 0.5, -1.2, 1.3), z: THREE.MathUtils.clamp(dz * 0.6, -1.25, 1.25), layer: layer++, hold: 0.5 + 1.1 * rnd(), side: Math.sign(dz || rnd() - 0.5), ph: rnd() * 6.28 });
          return;
        }
        this.loose.push({ wall: w, flower: true, drift: false, t0: hit - 0.03 + 0.05 * rnd(), home: p, rot, s: 1, ph: rnd() * 6.28, ...station(), push: v3(0, 0, 0) });
      });
      for (let k = 0; k < PETALS_PER_HIT; k++) {
        const home = v3(nose + rnd(), yc + (rnd() - 0.5) * 2 * HOLE_Y, (rnd() - 0.5) * 2 * HOLE_Z);
        this.loose.push({ wall: w, flower: false, drift: false, t0: hit - 0.03 + 0.12 * rnd(), home, rot: new THREE.Euler(), s: 0.7 + rnd() * 1.1, ph: rnd() * 6.28, ...station(), push: v3(0, 0, 0) });
      }
    });
  }

  /** The turbulence of the air at a point and a time: one field for every particle, so neighbours go the same way. m/s. */
  private gust(p: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
    const x = p.x * 0.11, y = p.y * 0.23, z = p.z * 0.21;
    return out.set(
      Math.sin(y + 1.3 * t) * Math.cos(z - 0.9 * t) + 0.5 * Math.sin(2.3 * z + 2.1 * t + x),
      Math.sin(z + 1.1 * t + 2) * Math.cos(x + 0.7 * t) + 0.5 * Math.sin(2.1 * x - 1.7 * t + y),
      Math.sin(x - 1.2 * t + 4) * Math.cos(y + 0.8 * t) + 0.5 * Math.sin(2.5 * y + 1.9 * t + z),
    );
  }

  /** The place in the air round the car that particle `d` is carried to at t: it goes round the car and along it. */
  private station(d: Loose, t: number, out: THREE.Vector3): THREE.Vector3 {
    const th = d.th + d.om * t;
    return out.set(d.a + 2 * Math.sin(0.6 * t + d.ph), 1.85 + 0.8 * d.r * Math.sin(th), d.r * Math.cos(th)).applyMatrix4(this.path.matrix(t));
  }

  private bake(rnd: () => number) {
    const N = this.loose.length, dt = 1 / HZ;
    const P = this.loose.map((d) => d.home.clone()), V = this.loose.map(() => v3(0, 0, 0));
    const live = new Uint8Array(N);
    const st = v3(0, 0, 0), st1 = v3(0, 0, 0), g = v3(0, 0, 0), loc = v3(0, 0, 0);
    const inv = new THREE.Matrix4();
    for (let k = 0; k < this.steps; k++) {
      const t = this.t0 + k * dt;
      for (let i = 0; i < N; i++) this.data.set([P[i]!.x, P[i]!.y, P[i]!.z], (k * N + i) * 3);
      if (k === this.steps - 1) break;
      const a = this.path.at(t);
      const m = this.path.matrix(t + dt);
      inv.copy(m).invert();
      for (let i = 0; i < N; i++) {
        const d = this.loose[i]!, p = P[i]!, v = V[i]!;
        if (t < d.t0) continue;
        if (d.drift) {
          // a flower of the wall away from the path: pushed on the hit, then the air brakes it, the turbulence turns it and it sinks
          if (!live[i]) { live[i] = 1; v.copy(d.push); }
          this.gust(p, t, g);
          v.x += 1.6 * (2.5 * g.x - v.x) * dt;
          v.y += (1.6 * (2.5 * g.y - v.y) - 2.2) * dt;
          v.z += 1.6 * (2.5 * g.z - v.z) * dt;
          p.addScaledVector(v, dt);
          continue;
        }
        if (!live[i]) {
          // the hit: the nose throws it forward and out from the axis of the train
          live[i] = 1;
          const out = v3(0, p.y - this.centres[d.wall]!.y, p.z).normalize();
          v.copy(a.v).multiplyScalar(0.75 + 0.35 * rnd()).addScaledVector(out, 6 + 12 * rnd()).add(v3(0, (rnd() - 0.5) * 6, (rnd() - 0.5) * 6));
        }
        // the air that carries it: the place round the car moves with the car, and the turbulence is on top
        this.station(d, t, st);
        this.station(d, t + dt, st1);
        const pull = 1.6 * smooth((t - d.t0 - 0.25) / 0.9);
        this.gust(p, t, g);
        const ax = pull * (st.x - p.x) + 2.2 * ((st1.x - st.x) / dt + 4.5 * g.x - v.x);
        const ay = pull * (st.y - p.y) + 2.2 * ((st1.y - st.y) / dt + 4.5 * g.y - v.y) - 1.2;
        const az = pull * (st.z - p.z) + 2.2 * ((st1.z - st.z) / dt + 4.5 * g.z - v.z);
        v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
        p.addScaledVector(v, dt);
        // none goes through the car: one that is in the hull goes to its nearest side
        loc.copy(p).applyMatrix4(inv);
        if (Math.abs(loc.x) < 10.8 && loc.y > -0.6 && loc.y < 4.5 && Math.abs(loc.z) < 2.1) {
          const toTop = 4.5 - loc.y, toSide = 2.1 - Math.abs(loc.z);
          if (toTop < toSide) loc.y = 4.5; else loc.z = Math.sign(loc.z || 1) * 2.1;
          p.copy(loc).applyMatrix4(m);
        }
      }
    }
  }

  /** How much the car rocks at t (-1..1): each wall is a soft hit. The scene turns the car with it. */
  rock(t: number): number {
    let r = 0;
    for (const hit of T_WALLS) { const tau = t - hit; if (tau >= 0 && tau < 1) r += Math.exp(-7 * tau) * Math.sin(24 * tau); }
    return r;
  }

  pose(t: number) {
    this.poseStuck(t);
    this.poseLoose(t);
  }

  /**
   * The pile on the nose: each flower comes onto the front of the car, holds, then the air pushes it to the edge, along the side and off
   * the back (in the frame of the car).
   */
  private poseStuck(t: number) {
    const o = this.o;
    const car = this.path.matrix(t), inv = this.tmpM.copy(car).invert();
    this.stuck.forEach((s, i) => {
      const hit = T_WALLS[s.wall]!, tau = t - hit;
      const pop = smooth((t - this.stamps[s.wall]!) / (2 / 36));
      if (tau < 0) {
        o.position.copy(s.home);
        o.rotation.copy(s.rot);
        o.scale.setScalar(Math.max(0.0001, WALL_SCALE * pop));
        o.updateMatrix();
        this.stuckMesh.set(i, o.matrix);
        return;
      }
      const on = smooth(tau / 0.06), sl = tau - s.hold, off = Math.max(0, sl - 0.3);
      const lx = 10.0 + 0.07 * (s.layer % 7) - 2 * off - 14 * off * off;
      const ly = s.y + 0.03 * Math.sin(30 * t + s.ph) - (sl > 0 ? 1.2 * off * off : 0);
      const lz = sl > 0 ? THREE.MathUtils.lerp(s.z, s.side * 1.55, smooth(sl / 0.3)) + s.side * 0.6 * off : s.z;
      const home = this.tmpV.copy(s.home).applyMatrix4(inv);
      o.position.set(THREE.MathUtils.lerp(home.x, lx, on), THREE.MathUtils.lerp(home.y, ly, on), THREE.MathUtils.lerp(home.z, lz, on));
      const roll = 6 * Math.max(0, sl);
      o.rotation.set(s.rot.x + roll, s.rot.y + 0.5 * roll, s.rot.z + 0.8 * roll);
      // it lies flat on the front at a smaller size, and is gone well behind the car
      const gone = lx < -14 ? 0 : 1;
      o.scale.setScalar(Math.max(0.0001, THREE.MathUtils.lerp(WALL_SCALE, 0.6, on) * gone));
      o.updateMatrix();
      this.stuckMesh.set(i, this.tmpM2.multiplyMatrices(car, o.matrix));
    });
    this.stuckMesh.commit();
  }

  /** The loose flowers and petals: the baked flight, frozen when the wind stops. */
  private poseLoose(t: number) {
    const o = this.o;
    const cold = smooth((t - T_WIND) / 0.5);
    this.flowerMesh.freeze(ICE, cold);
    this.petalMesh.freeze(ICE, cold);
    const N = this.loose.length;
    const f = (Math.min(t, T_WIND) - this.t0) * HZ;
    const k0 = Math.max(0, Math.min(this.steps - 1, Math.floor(f))), k1 = Math.min(this.steps - 1, k0 + 1), u = Math.max(0, Math.min(1, f - k0));
    const fade = 1 - smooth((t - T_GONE) / 0.8);
    const still = t >= this.settled;
    if (still && fade === this.posedFade) return;
    this.posedFade = still ? fade : NaN;
    const spin = stepT(Math.min(t, T_WIND), 18);
    for (let i = 0; i < N; i++) {
      const d = this.loose[i]!;
      const a = (k0 * N + i) * 3, b = (k1 * N + i) * 3;
      o.position.set(this.data[a]! + (this.data[b]! - this.data[a]!) * u, this.data[a + 1]! + (this.data[b + 1]! - this.data[a + 1]!) * u, this.data[a + 2]! + (this.data[b + 2]! - this.data[a + 2]!) * u);
      const fly = t - d.t0;
      if (d.flower) {
        // in the wall until the hit, then it tumbles and is a little smaller
        const pop = smooth((t - this.stamps[d.wall]!) / (2 / 36));
        if (fly < 0) o.rotation.copy(d.rot); else o.rotation.set(d.rot.x + 5 * (spin - d.t0), d.rot.y + 3 * (spin - d.t0), d.rot.z + 4 * (spin - d.t0));
        o.scale.setScalar(Math.max(0.0001, pop * fade * (WALL_SCALE - 0.7 * smooth(fly / 0.6))));
      } else {
        o.rotation.set(d.ph + 4 * spin, 3 * spin + d.ph, 2 * spin);
        o.scale.setScalar(fly < 0 ? 0.0001 : Math.max(0.0001, d.s * fade));
      }
      o.updateMatrix();
      if (i < this.nFlowers) this.flowerMesh.set(i, o.matrix); else this.petalMesh.set(i - this.nFlowers, o.matrix);
    }
    this.flowerMesh.commit();
    this.petalMesh.commit();
  }

  dispose() {
    this.stuckMesh.dispose();
    this.flowerMesh.dispose();
    this.petalMesh.dispose();
  }
}
