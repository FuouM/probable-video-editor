// Station もと and its wreck (treatment plate 7, lines 20-21 and the failed loads). The scene stands on its own ground: the
// station (platform of 12 blocks, shelter, bench, board, lamps, bins, fence, vending machine), the track with its sleepers,
// five utility poles with wires, and the car that comes in from the left at 30 m/s and hits the station on the beat
// `T_HIT` (the `は` of ここは). Local frame as in the station kit: the track runs along x, the platform lies on the +z side,
// the rail top is y = 0 and the ground top is y = -0.5.
//
// What moves, and how:
//  - Rapier (baked once in `init`, 60 Hz, 4 s): the platform blocks, the shelter posts, roof panels, walls and bench, the
//    board posts, the lamps, the fittings and the 34 sleepers. A kinematic box the size of the car pushes them. Every body
//    is held in its unbroken pose until the car is about to reach it.
//  - Authored (pure functions of t, no physics): the car itself (it leaves the rails: yaw, roll, a climb onto the platform
//    edge, a skid), the twisted rails (one rail stands up into the sky), the three poles that bend with their wires, and the
//    board that falls diagonally and ends stuck through the roof of the car.
// `pose(t, back)` places everything. `back` (0..1) is how far every part jumps toward its unbroken pose: the failed loads of
// 105.111-106.667 use 0.5 for two frames. A frame depends only on t.
import * as THREE from 'three';
import { bake, type Baked, type BodySpec, type ShapeSpec } from '@pve/engine/physics';
import { clamp01, mulberry32, smooth, hashSin } from '@pve/engine/util';
import { Builder, LitAtlas, allFaces, at, col, instanced, litMesh, point, sun, ambient, v3, type BoxFaces, type Cell, type Face } from '@pve/engine/lit';
import type { Sky } from '@pve/engine/litview';
import { Mask, type PixelFont } from '@pve/engine/type';
import { Train } from './_train';
import { buildTrack, trackFaces } from '@pve/engine/track';

type V3 = THREE.Vector3;
type Q = THREE.Quaternion;
type Vec3 = [number, number, number];

/** The beat on which the car hits the station (the は of ここは; a kick and a snare). */
export const T_HIT = 101.778;
/** The bake runs from `T0` to `T_END`; after it every body rests. */
export const T0 = 101.0;
const T_END = 105.2;
/** The car's speed on the way in (m/s) and where its middle is at the hit (its nose is 10 m ahead of it). The ride of verse 2 runs at this speed from its start. */
export const V0 = 44;
export const X_HIT = -13;
/** The x of the board. */
const BOARD_X = -3;
/** The board falls from the moment the nose is on it and lands, stuck through the roof, 0.75 s later. */
const T_FALL = T_HIT + 0.2;
const T_LAND = T_HIT + 0.95;
/** The poles: x, static (never bends), the time after the hit when it starts to bend, the final lean (rad). */
const POLES: { x: number; bend: number; lean: number }[] = [
  { x: -36, bend: -1, lean: 0 }, { x: -4, bend: 0.55, lean: 0.62 }, { x: 12, bend: 0.85, lean: 0.74 }, { x: 28, bend: 1.25, lean: 0.5 }, { x: 52, bend: -1, lean: 0 },
];
const POLE_H = [2.9, 2.8, 2.8];
const WIRE_SEGS = 6;
const WIRE_COUNT = (POLES.length - 1) * 4 * WIRE_SEGS;

/** 0..1 -> 0..1 that overshoots a little and settles (easeOutBack). */
const settle = (u: number) => { const x = clamp01(u) - 1; return 1 + 2.70158 * x * x * x + 1.70158 * x * x; };

/** The night light of the wreck: the sky, the moonlight (colour, direction), the hemisphere ambient and the fog. */
const NIGHT = {
  sky: { zenith: '#05081f', horizon: '#1a2a62', ground: '#0a0f1e', stars: 1, body: { dir: v3(-0.3, 0.55, -0.7).normalize(), r: 0.035, colour: '#e8eeff', strength: 3, glow: 2 } } satisfies Sky,
  sun: '#9db4ff', dir: v3(-0.3, 0.8, -0.5).normalize(),
  hemiSky: '#3a4c96', hemiGnd: '#3a5a58', hemiI: 1.0, fog: '#101c46', fogD: 0.0016,
};

const AX = v3(1, 0, 0), AY = v3(0, 1, 0), AZ = v3(0, 0, 1);
const qAxis = (axis: V3, a: number) => new THREE.Quaternion().setFromAxisAngle(axis, a);

/** The car: where its middle is (rail top at y = 0) and how it lies at time t. It leaves the rails at the hit, skids onto the platform edge and rolls. */
export function carPose(t: number, p: V3, q: Q) {
  const tau = t - T_HIT;
  if (tau < 0) { p.set(X_HIT + V0 * tau, 0, 0); q.identity(); return; }
  p.set(X_HIT + V0 * 0.45 * (1 - Math.exp(-tau / 0.45)), 0.55 * smooth(tau / 0.9), 2.2 * smooth(tau / 1.1));
  q.copy(qAxis(AY, -0.36 * smooth(tau / 0.9))).multiply(qAxis(AX, 0.28 * smooth((tau - 0.1) / 0.9)));
}

/** How the board lies in the car's frame when it has come down through the roof: the plate stands across the roof, turned 34 degrees in its plane, its lower half inside the car. */
const BOARD_IN_CAR = { p: v3(1.0, 4.6, -0.5), q: qAxis(AY, 0.9).multiply(qAxis(AZ, 0.7)).multiply(qAxis(AX, -0.2)) };

/** A part of the wreck: a mesh and the way it is placed at time t. `from`: the part is not drawn before this time. */
interface Part { mesh: THREE.Object3D; at: (t: number, p: V3, q: Q) => void; from?: number }

/** A pole's top for the wires: where a wire at height `ay` and lateral offset `d` is fixed at time t, and with how much of the lean (0..1). */
interface PoleTop { attach: (t: number, lean: number, ay: number, d: number, out: V3) => V3 }

export class Wreck {
  readonly scene = new THREE.Scene();
  /** The car of the standalone wreck. A bare wreck has none: the scene poses the world's train. */
  readonly train: Train | null = null;
  readonly sky: Sky = NIGHT.sky;
  readonly exposure = 1.25;
  private readonly parts: Part[] = [];
  private readonly lamps: { light: THREE.PointLight; part: Part; off: V3 }[] = [];
  private readonly key = sun('#9db4ff', 2.4, 48, 2048);
  private readonly bodies: BodySpec[] = [];
  private readonly face: Record<string, Face> = {};
  private readonly poleTops: PoleTop[] = [];
  private readonly wires: THREE.InstancedMesh;
  private baked!: Baked;
  private readonly p = v3(0, 0, 0);
  private readonly q = new THREE.Quaternion();
  private readonly p0 = v3(0, 0, 0);
  private readonly q0 = new THREE.Quaternion();
  private readonly boardPart: Part;
  /** The three back panels of the shelter (1.6 x 1.0 m) and the six front blocks of the platform (5 x 1.4 m, the face toward the track at local z -1): the banners of lines 20 and 21. Their meshes are centred on their bodies; a child follows the wreck. */
  readonly backs: THREE.Object3D[] = [];
  readonly fronts: THREE.Object3D[] = [];

  /**
   * `bare`: only the station, the poles and the wires, with no land, no train, no light and no rails on the ground. A scene puts `scene` into
   * the one game world at Station もと and poses the world's own train with `carPose`. The rails are those of the world (they bend there, and
   * straight ones would lie across them). Only the rail that stands up shows, from the moment it tears loose.
   */
  constructor(private readonly A: LitAtlas, private readonly mat: THREE.MeshLambertMaterial, private readonly kana: PixelFont, private readonly bare = false) {
    this.paint();
    if (!bare) {
      this.buildLand();
      this.train = new Train(A, mat);
      this.train.setInterior(0.7);
      this.train.setHeadlights(1);
      this.scene.add(this.train.root);
    }
    this.buildStation();
    this.buildTrack();
    this.buildPoles();
    this.boardPart = this.buildBoard();
    const wb = new Builder();
    wb.box(1, 0.05, 0.05, allFaces(this.face.wire!), at(0, -0.025, 0));
    this.wires = instanced(litMesh(wb, mat).geometry, mat, WIRE_COUNT);
    this.scene.add(this.wires);
    if (bare) return;
    const L = NIGHT;
    this.key.position.set(-30, 70, -50);
    this.key.target.position.set(0, 0, 3);
    this.key.color.copy(col(L.sun));
    this.scene.add(this.key, this.key.target, ambient(L.hemiSky, L.hemiGnd, L.hemiI * 1.5));
    this.scene.fog = new THREE.FogExp2(col(L.fog), L.fogD);
  }

  /** Bakes the bodies. Call once, before the first frame. */
  async init() {
    this.baked = await bake({ t0: T0, t1: T_END, hz: 60, bodies: this.bodies });
  }

  // ---------------------------------------------------------------- cells

  private paint() {
    const A = this.A;
    const f = (cell: Cell, map?: 'tile' | 'fit'): Face => ({ cell, map });
    const F = this.face;
    F.conc = f(A.paint(16, 16, (p) => { p.fill('#9b988f'); p.speckle('#8c8981', 0.3, 3); p.speckle('#aaa79d', 0.1, 9); p.rect(0, 0, 16, 1, '#7f7c75'); p.rect(0, 0, 1, 16, '#85827b'); }));
    F.wall = f(A.paint(16, 16, (p) => { p.fill('#76746d'); p.speckle('#686661', 0.3, 5); p.speckle('#85837b', 0.1, 13); p.rect(0, 0, 1, 16, '#5e5c57'); }));
    F.tact = f(A.paint(16, 16, (p) => { p.fill('#e4b81c'); for (let gx = 1; gx < 16; gx += 4) for (let gy = 1; gy < 16; gy += 4) { p.px(gx, gy, '#f7da5c'); p.px(gx + 1, gy - 1, '#a8800c'); } }));
    F.wood = f(A.paint(8, 8, (p) => { p.fill('#7c5433'); p.speckle('#6b4529', 0.2, 2); for (const x of [1, 4, 6]) p.rect(x, 0, 1, 8, '#68442a'); }));
    F.slats = f(A.paint(8, 8, (p) => { p.fill('#8a6038'); p.rect(0, 0, 8, 1, '#5a3c22'); p.rect(0, 4, 8, 1, '#5a3c22'); p.speckle('#7a5230', 0.2, 4); }));
    F.roof = f(A.paint(8, 8, (p) => { p.fill('#363a48'); p.rect(0, 0, 1, 8, '#4a4f61'); p.rect(4, 0, 1, 8, '#4a4f61'); p.speckle('#2c303c', 0.2, 6); }));
    F.steel = f(A.solid('#2d3036'));
    F.lampHead = f(A.paint(1, 1, (p) => p.fill('#ffd890', 4.5)));
    F.bin = f(A.paint(8, 8, (p) => { p.fill('#2f5a3c'); p.rect(0, 0, 1, 8, '#244630'); p.speckle('#386848', 0.2, 12); }));
    F.card = f(A.paint(8, 8, (p) => { p.fill('#b98c55'); p.speckle('#a67c48', 0.25, 7); p.rect(0, 6, 8, 1, '#d7bd8a'); }));
    F.vend = f(A.paint(8, 8, (p) => { p.fill('#d0d4d8'); p.rect(0, 5, 8, 2, '#2a62b0'); p.rect(1, 1, 5, 3, '#7fc0ff', 2.5); }));
    F.planter = f(A.paint(8, 8, (p) => { p.fill('#3a5a2a'); p.speckle('#4c7a36', 0.4, 4); p.speckle('#e8607a', 0.08, 7); p.rect(0, 0, 8, 2, '#7c5433'); }));
    F.wire = f(A.solid('#1b1c22'));
    F.rail = trackFaces(A).rail;
    F.ground = f(A.paint(16, 16, (p) => { p.fill('#2a3a24'); p.speckle('#33452b', 0.3, 11); p.speckle('#1f2c1b', 0.2, 12); }));
    F.hillNear = f(A.paint(16, 16, (p) => { p.fill('#30483a'); p.speckle('#28403a', 0.3, 13); p.speckle('#3c5848', 0.2, 14); }));
    F.hillFar = f(A.paint(16, 16, (p) => { p.fill('#3a4e66'); p.speckle('#344860', 0.3, 15); p.speckle('#46607a', 0.2, 16); }));
    F.tree = f(A.paint(8, 8, (p) => { p.fill('#1f3a28'); p.speckle('#18301f', 0.3, 11); p.speckle('#294832', 0.2, 12); }));
    F.bark = f(A.solid('#3a2c20'));
    F.plaster = f(A.paint(8, 8, (p) => { p.fill('#c8c1ac'); p.speckle('#b8b19c', 0.3, 3); }));
    F.tiles = f(A.paint(8, 8, (p) => { p.fill('#3d4654'); p.rect(0, 0, 8, 1, '#2b323e'); p.rect(0, 4, 8, 1, '#2b323e'); p.speckle('#4a5464', 0.2, 7); }));
    F.win = f(A.paint(6, 7, (p) => { p.fill('#2e2826'); p.rect(1, 1, 4, 5, '#ffc870', 3.5); p.rect(1, 3, 4, 1, '#2e2826'); p.rect(3, 1, 1, 5, '#2e2826'); }), 'fit');
    F.winOff = f(A.paint(6, 7, (p) => { p.fill('#2e2826'); p.rect(1, 1, 4, 5, '#161c2a'); p.rect(1, 3, 4, 1, '#2e2826'); }), 'fit');
    F.boardBack = f(A.solid('#d8d6cc'));
    // the board: a white plate with a thick black frame and もと in big black type
    F.board = f(A.paint(192, 72, (p) => {
      p.fill('#eae7dc');
      p.rect(0, 0, 192, 4, '#22242a'); p.rect(0, 68, 192, 4, '#22242a'); p.rect(0, 0, 4, 72, '#22242a'); p.rect(188, 0, 4, 72, '#22242a');
      const m = Mask.text(this.kana, 'もと', 4);
      m.draw(p.sink({ 1: '#14161c' }), Math.round((192 - m.w) / 2 - m.x0), Math.round((72 - m.h) / 2 - m.y0), 1);
    }), 'fit');
  }

  // ---------------------------------------------------------------- the land

  private buildLand() {
    const F = this.face;
    const rnd = mulberry32(0x6d07);
    const g = new Builder();
    g.box(2400, 0.1, 1400, { py: F.ground! }, at(0, -0.6, 0));
    // a loose row of trees near the line, a dense treeline far off, and two layers of hills on each side
    for (const sgn of [-1, 1]) {
      for (let x = -240; x < 240; x += 6 + rnd() * 8) {
        const z = sgn * (14 + rnd() * 28);
        if ((Math.abs(x) < 30 && sgn > 0) || (Math.abs(x) < 70 && sgn < 0)) continue;
        const sz = 0.8 + rnd() * 0.8;
        g.cylinder(0.14 * sz, 0.1 * sz, 1.6 * sz, 5, F.bark!, null, at(x, -0.5, z));
        g.cylinder(1.3 * sz, 0, 6.2 * sz, 6, F.tree!, null, at(x, 0.7 * sz - 0.5, z));
      }
      for (let x = -260; x < 260; x += 2.6 + rnd() * 1.4) g.cylinder(1.7 + rnd() * 0.8, 0, 7 + rnd() * 5, 5, F.tree!, null, at(x, -0.5, sgn * (70 + rnd() * 26)));
      for (const [layer, off, base, amp, face] of [[0, 165, 16, 14, F.hillNear!], [1, 270, 34, 20, F.hillFar!]] as const) {
        const ph1 = rnd() * 6.28, ph2 = rnd() * 6.28;
        const n = 60;
        const top = (k: number) => {
          const s = (k / n) * 560 - 280;
          const h = Math.max(5, base + amp * 0.6 * Math.sin(s * 0.019 + ph1 + layer) + amp * 0.4 * Math.sin(s * 0.051 + ph2 + sgn));
          return [v3(s, -0.5, sgn * off), v3(s, -0.5 + h, sgn * off)] as const;
        };
        let prev = top(0);
        for (let k = 1; k <= n; k++) {
          const cur = top(k);
          // a wall seen from both sides: a double quad
          g.quad(prev[0], cur[0], cur[1], prev[1], face);
          g.quad(prev[1], cur[1], cur[0], prev[0], face);
          prev = cur;
        }
      }
    }
    // a few houses behind the platform with lit windows
    const houses: [number, number, number, number, number][] = [[-70, 38, 7, 5.4, 6], [-38, 46, 7, 3.1, 6], [34, 40, 8, 3.1, 6], [74, 50, 7, 5.4, 6], [112, 36, 7, 3.1, 6]];
    houses.forEach(([x, z, w, h, d], k) => {
      g.box(w, h, d, allFaces(F.plaster!), at(x, -0.5, z));
      g.extrude([[-w / 2 - 0.45, 0], [w / 2 + 0.45, 0], [0, 1.7 + w * 0.12]], d + 0.9, F.plaster!, F.tiles!, at(x, -0.5 + h, z));
      for (const y0 of h > 4 ? [1.0, 3.5] : [1.0]) for (let i = 0; i < 2; i++) {
        const cx = x + (i - 0.5) * (w / 2.2);
        const win = (k + i + Math.round(y0)) % 3 === 0 ? F.winOff! : F.win!;
        const zf = z - d / 2 - 0.03, ya = -0.5 + y0;
        g.quad(v3(cx + 0.5, ya, zf), v3(cx - 0.5, ya, zf), v3(cx - 0.5, ya + 1.2, zf), v3(cx + 0.5, ya + 1.2, zf), win);
      }
    });
    this.scene.add(litMesh(g, this.mat, { cast: false }));
    // the track away from the station, and the bed under the part between
    const line = (x0: number, x1: number) => litMesh(buildTrack(this.A, new THREE.LineCurve3(v3(x0, 0, 0), v3(x1, 0, 0)), { faces: { rail: F.rail!, sleeper: F.wood!, ballast: F.conc! } }), this.mat, { cast: false });
    this.scene.add(line(-300, -20), line(20, 300));
    const bed = new Builder();
    bed.extrude([[-2.1, -0.5], [2.1, -0.5], [1.35, -0.18], [-1.35, -0.18]], 40, F.conc!, F.conc!, at(0, 0, 0, -Math.PI / 2));
    this.scene.add(litMesh(bed, this.mat, { cast: false }));
  }

  // ---------------------------------------------------------------- bodies

  /** A box centred on the origin (a part's mesh is centred on its body). */
  private cbox(b: Builder, w: number, h: number, d: number, f: BoxFaces, ox = 0, oy = 0, oz = 0) {
    b.box(w, h, d, f, at(ox, oy - h / 2, oz));
  }

  /** A dynamic body and its mesh. `wake`: the song time it is released from its unbroken pose. `kick`: the velocity and spin it is released with. */
  private body(shape: ShapeSpec | ShapeSpec[], pos: Vec3, build: (b: Builder) => void, o: { wake: number; density?: number; kick?: { v: Vec3; w: Vec3 } }): Part {
    const b = new Builder();
    build(b);
    const mesh = litMesh(b, this.mat);
    this.scene.add(mesh);
    const i = this.bodies.length;
    const part: Part = { mesh, at: (t, p, q) => this.baked.pose(i, t, p, q) };
    this.bodies.push({
      shape, pose: { p: pos, q: [0, 0, 0, 1] }, type: 'dynamic', wakeAt: o.wake, density: o.density ?? 1.8, friction: 0.7, restitution: 0.12, damping: [0.15, 0.3],
      ...(o.kick ? { vel: o.kick.v, spin: o.kick.w } : {}),
    });
    this.parts.push(part);
    return part;
  }

  /** The time the nose of the car gets to 3 m before x: the bodies ahead of it wake up just before it arrives. */
  private wakeAt(x: number): number {
    return Math.max(T0 + 0.1, T_HIT + (x - 3 - (X_HIT + 10)) / V0);
  }

  private box(pos: Vec3, half: Vec3, f: BoxFaces, o: { wake?: number; density?: number; kick?: { v: Vec3; w: Vec3 } } = {}): Part {
    return this.body({ kind: 'box', half }, pos, (b) => this.cbox(b, half[0] * 2, half[1] * 2, half[2] * 2, f), { wake: o.wake ?? this.wakeAt(pos[0]), density: o.density, kick: o.kick });
  }

  private buildStation() {
    const F = this.face;
    const wood = allFaces(F.wood!), slats = allFaces(F.slats!), roof = allFaces(F.roof!), steel = allFaces(F.steel!);
    // the platform: 6 blocks along x, two rows across; the front row carries the yellow tactile strip
    for (const x of [-12.5, -7.5, -2.5, 2.5, 7.5, 12.5]) {
      for (const [z, front] of [[2.7, true], [4.7, false]] as const) {
        const part = this.body({ kind: 'box', half: [2.5, 0.7, 1.0] }, [x, 0.2, z], (b) => {
          this.cbox(b, 5, 1.4, 2, { py: F.conc!, ny: F.conc!, px: F.wall!, nx: F.wall!, pz: F.wall!, nz: F.wall! });
          if (front) b.box(5, 0.015, 0.42, { py: F.tact! }, at(0, 0.7, -0.6));
        }, { wake: this.wakeAt(x), density: 2.6 });
        if (front) this.fronts.push(part.mesh);
      }
    }
    // the shelter: four posts in two pieces each, four roof panels, three back panels, the bench
    const sx = 7;
    for (const dx of [-2.4, 2.4]) for (const z of [3.1, 4.8]) {
      this.box([sx + dx, 1.5, z], [0.075, 0.6, 0.075], wood);
      this.box([sx + dx, 2.7, z], [0.075, 0.6, 0.075], wood, { kick: { v: [1.5, 0.5, z > 4 ? -1.2 : 1.2], w: [0.4, 0, 0.6] } });
    }
    for (const dx of [-1.45, 1.45]) for (const z of [3.25, 4.65]) {
      this.box([sx + dx, 3.2, z], [1.45, 0.09, 0.7], roof, { density: 0.9, kick: { v: [2 * Math.sign(dx), 1.2, z > 4 ? 0.8 : -0.8], w: [0.3 * Math.sign(dx), 0.2, 0.5] } });
    }
    // the back panels carry line 20 (ここは), one syllable each, seen from the track side (-z)
    for (const dx of [-1.6, 0, 1.6]) this.backs.push(this.box([sx + dx, 1.4, 4.9], [0.8, 0.5, 0.035], slats, { density: 0.8 }).mesh);
    this.box([sx, 1.3, 4.5], [1.3, 0.03, 0.21], slats, { density: 0.8 });
    for (const dx of [-1.15, 1.15]) this.box([sx + dx, 1.1, 4.5], [0.035, 0.2, 0.2], wood);
    // the board posts (the board is authored: see buildBoard)
    for (const dx of [-3.0, 3.0]) this.box([BOARD_X + dx, 2.5, 2.5], [0.07, 1.6, 0.07], wood, { kick: { v: [3, 1, -1], w: [0.5, 0.3, 0.8] } });
    // the lamps: a post and a head in one compound body; the two on the far side carry a light
    for (const x of [-12, 1.5, 13.5]) {
      const lamp = this.body(
        [{ kind: 'box', half: [0.07, 1.85, 0.07] }, { kind: 'box', half: [0.35, 0.05, 0.16], local: { p: [0, 1.85, -0.8], q: [0, 0, 0, 1] } }],
        [x, 2.75, 3.0],
        (b) => {
          this.cbox(b, 0.14, 3.7, 0.14, steel);
          this.cbox(b, 0.08, 0.08, 0.8, steel, 0, 1.8, -0.4);
          this.cbox(b, 0.7, 0.1, 0.32, { ny: F.lampHead!, py: F.steel!, px: F.steel!, nx: F.steel!, pz: F.steel!, nz: F.steel! }, 0, 1.85, -0.8);
        },
        { wake: this.wakeAt(x), density: 1.2 },
      );
      if (x > 0) {
        const light = point('#ffcf8a', 70, 18);
        this.scene.add(light);
        this.lamps.push({ light, part: lamp, off: v3(0, 1.7, -0.8) });
      }
    }
    // fittings: the vending machine, bins, planters, crates, and the fence in twelve panels
    this.box([-13.6, 1.825, 5.1], [0.475, 0.925, 0.375], allFaces(F.vend!), { density: 1.4 });
    for (const x of [3.4, -2.6, 11.6]) this.box([x, 1.29, 5.15], [0.23, 0.39, 0.23], allFaces(F.bin!), { density: 0.6 });
    for (const x of [-11.2, 0.4, 13.6]) this.box([x, 1.09, 5.2], [0.45, 0.19, 0.17], allFaces(F.planter!), { density: 0.8 });
    for (const [x, z, y] of [[-6.3, 5.15, 1.175], [-5.55, 5.2, 1.15], [-6.2, 5.15, 1.725], [-4.8, 5.1, 1.15]] as const) this.box([x, y, z], [0.4, 0.26, 0.28], allFaces(F.card!), { density: 0.5 });
    for (let k = 0; k < 12; k++) this.box([-13.75 + k * 2.5, 1.4, 5.65], [1.25, 0.5, 0.03], steel, { density: 0.3 });
    // the sleepers: 34 of them; each is thrown up as the car goes over
    const rnd = mulberry32(0x5c1e);
    for (let k = 0; k < 34; k++) {
      const x = -19.8 + k * 1.2;
      const s = hashSin(k, 3) < 0.5 ? -1 : 1;
      this.box([x, -0.3, 0], [0.11, 0.15, 1.1], allFaces(F.wood!), {
        wake: Math.max(T0 + 0.1, T_HIT + (x - (X_HIT + 10)) / V0), density: 1.2,
        kick: { v: [(rnd() - 0.3) * 4, 2.5 + rnd() * 4, s * (1.5 + rnd() * 3)], w: [(rnd() - 0.5) * 8, (rnd() - 0.5) * 6, (rnd() - 0.5) * 8] },
      });
    }
    // the car as a kinematic body: the box of its body, 0.7 m over the rails
    const cp = v3(0, 0, 0), cq = new THREE.Quaternion();
    this.bodies.push({
      shape: { kind: 'box', half: [10, 1.45, 1.4], local: { p: [0, 2.15, 0], q: [0, 0, 0, 1] } },
      pose: { p: [X_HIT + V0 * (T0 - T_HIT), 0, 0], q: [0, 0, 0, 1] },
      type: 'kinematic',
      drive: (t) => {
        carPose(t, cp, cq);
        return { p: [cp.x, cp.y, cp.z], q: [cq.x, cq.y, cq.z, cq.w] };
      },
    });
    // the ground under all of it
    this.bodies.push({ shape: { kind: 'box', half: [80, 1, 80] }, pose: { p: [0, -1.5, 0], q: [0, 0, 0, 1] }, type: 'fixed', friction: 0.8, restitution: 0.1 });
  }

  // ---------------------------------------------------------------- the rails

  /**
   * Two rails in pieces of 4 m from x = -20 to 20. Each piece twists a little when the car goes over it; on the platform side one rail stands up
   * into the sky (8 m from x = 8). A bare wreck has only the rail that stands up.
   */
  private buildTrack() {
    const rail = allFaces(this.face.rail!);
    for (const z of [-0.5335, 0.5335]) {
      const standing = z > 0;
      const piece = (x0: number, len: number, k: number) => {
        const b = new Builder();
        this.cbox(b, len, 0.15, 0.1, rail);
        const mesh = litMesh(b, this.mat);
        this.scene.add(mesh);
        const xm = x0 + len / 2;
        const amp = Math.exp(-(((xm - 4) / 14) ** 2));
        const tPass = T_HIT + (xm + 3 - (X_HIT + 10)) / V0;
        this.parts.push({
          mesh,
          at: (t, p, q) => {
            const w = smooth((t - tPass) / 0.35);
            p.set(xm + (hashSin(k, 1) - 0.5) * 0.8 * amp * w, -0.075 + hashSin(k, 2) * 0.45 * amp * w, z + (hashSin(k, 3) - 0.5) * 1.5 * amp * w);
            q.copy(qAxis(AY, (hashSin(k, 4) - 0.5) * 0.9 * amp * w)).multiply(qAxis(AX, (hashSin(k, 5) - 0.5) * 1.0 * amp * w)).multiply(qAxis(AZ, (hashSin(k, 6) - 0.5) * 0.5 * amp * w));
          },
        });
      };
      for (let k = 0; k < 10; k++) {
        if (this.bare || (standing && (k === 7 || k === 8))) continue;
        piece(-20 + k * 4, 4, k + (standing ? 20 : 0));
      }
      if (standing) {
        const b = new Builder();
        this.cbox(b, 8, 0.15, 0.1, rail);
        const mesh = litMesh(b, this.mat);
        this.scene.add(mesh);
        this.parts.push({
          mesh,
          ...(this.bare ? { from: T_HIT + 0.55 } : {}),
          at: (t, p, q) => {
            const th = 1.28 * settle((t - (T_HIT + 0.55)) / 0.9);
            p.set(8 + 4 * Math.cos(th), -0.075 + 4 * Math.sin(th), z);
            q.copy(qAxis(AZ, th)).multiply(qAxis(AX, 0.18 * smooth((t - T_HIT - 0.55) / 0.6)));
          },
        });
      }
    }
  }

  // ---------------------------------------------------------------- the poles and their wires

  /** Five poles on the far side of the track: the ends stand, the three between bend toward -z in turn (three pieces each, the top leans most). */
  private buildPoles() {
    const F = this.face;
    const wood = allFaces(F.wood!);
    const radii = [0.17, 0.147, 0.133, 0.12];
    const statics = new Builder();
    for (const d of POLES) {
      if (d.bend < 0) {
        statics.cylinder(0.17, 0.12, 8.5, 6, F.wood!, F.wood!, at(d.x, -0.5, -3.6));
        for (const ay of [7.4, 6.45]) statics.box(0.14, 0.14, 2.6, wood, at(d.x, ay - 0.07, -3.6));
        this.poleTops.push({ attach: (_t, _lean, ay, dd, out) => out.set(d.x, ay + 0.3, -3.6 + dd) });
        continue;
      }
      const tPole = T_HIT + d.bend;
      const base = v3(d.x, -0.5, -3.6);
      // the base and the lean of piece i at time t (`scale` 0..1 takes back part of the lean)
      const chain = (t: number, scale: number, bases: V3[], qs: Q[]) => {
        const beta = d.lean * settle((t - tPole) / 0.8) * scale;
        const p = base.clone();
        for (let i = 0; i < 3; i++) {
          const qi = qAxis(AX, -beta * ((i + 1) / 3)).multiply(qAxis(AY, 0.25 * beta * i));
          bases[i]!.copy(p);
          qs[i]!.copy(qi);
          p.addScaledVector(AY.clone().applyQuaternion(qi), POLE_H[i]!);
        }
      };
      const bases = [v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 0)];
      const qs = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
      let y0 = 0;
      for (let i = 0; i < 3; i++) {
        const b = new Builder();
        b.cylinder(radii[i]!, radii[i + 1]!, POLE_H[i]!, 6, F.wood!, F.wood!);
        if (i === 2) for (const ay of [7.4, 6.45]) b.box(0.14, 0.14, 2.6, wood, at(0, ay - 0.07 - y0, 0));
        const mesh = litMesh(b, this.mat);
        this.scene.add(mesh);
        this.parts.push({ mesh, at: (t, p, q) => { chain(t, 1, bases, qs); p.copy(bases[i]!); q.copy(qs[i]!); } });
        y0 += POLE_H[i]!;
      }
      this.poleTops.push({
        attach: (t, lean, ay, dd, out) => {
          chain(t, lean, bases, qs);
          return out.set(0, ay + 0.3 - (POLE_H[0]! + POLE_H[1]!), dd).applyQuaternion(qs[2]!).add(bases[2]!);
        },
      });
    }
    this.scene.add(litMesh(statics, this.mat));
  }

  // ---------------------------------------------------------------- the board

  /** The board `もと`: a plate of 5 m by 1.9 m on two posts. When the car reaches it, it falls diagonally and ends stuck through the roof. */
  private buildBoard(): Part {
    const F = this.face;
    const b = new Builder();
    this.cbox(b, 7, 2.6, 0.12, { pz: F.board!, nz: F.board!, px: F.boardBack!, nx: F.boardBack!, py: F.boardBack!, ny: F.boardBack! });
    const mesh = litMesh(b, this.mat);
    this.scene.add(mesh);
    const rest = v3(BOARD_X, 4.0, 2.5);
    const cp = v3(0, 0, 0), cq = new THREE.Quaternion();
    const land = v3(0, 0, 0), landQ = new THREE.Quaternion();
    carPose(T_LAND, cp, cq);
    land.copy(BOARD_IN_CAR.p).applyQuaternion(cq).add(cp);
    landQ.copy(cq).multiply(BOARD_IN_CAR.q);
    const part: Part = {
      mesh,
      at: (t, p, q) => {
        if (t < T_FALL) { p.copy(rest); q.identity(); return; }
        if (t < T_LAND) {
          // the fall: gravity in y, an ease in the plan, the turn into the diagonal
          const u = (t - T_FALL) / (T_LAND - T_FALL);
          p.set(rest.x + (land.x - rest.x) * smooth(u), rest.y + (land.y - rest.y) * u * u, rest.z + (land.z - rest.z) * smooth(u));
          q.identity().slerp(landQ, smooth(u) ** 1.5);
          return;
        }
        // stuck in the roof: it moves with the car and shivers for a few frames
        carPose(t, cp, cq);
        p.copy(BOARD_IN_CAR.p).applyQuaternion(cq).add(cp);
        const tau = t - T_LAND;
        q.copy(cq).multiply(BOARD_IN_CAR.q).multiply(qAxis(AX, 0.06 * Math.exp(-tau * 10) * Math.sin(tau * 42)));
      },
    };
    this.parts.push(part);
    return part;
  }

  // ---------------------------------------------------------------- the frame

  /**
   * Places every part at time t. `back` (0..1) takes every part that far toward its unbroken pose (the failed load: 0.5 for
   * two frames). The sun follows `focus` (the shadow map is small).
   */
  pose(t: number, back = 0) {
    const { p, q, p0, q0 } = this;
    for (const part of this.parts) {
      part.at(t, p, q);
      if (back > 0) { part.at(T0, p0, q0); p.lerp(p0, back); q.slerp(q0, back); }
      if (part.from !== undefined) part.mesh.visible = t >= part.from;
      part.mesh.position.copy(p);
      part.mesh.quaternion.copy(q);
    }
    if (this.train) {
      carPose(t, p, q);
      if (back > 0) { carPose(T0, p0, q0); p.lerp(p0, back); q.slerp(q0, back); }
      this.train.root.position.copy(p);
      this.train.root.quaternion.copy(q);
    }
    for (const l of this.lamps) {
      l.light.position.copy(l.part.mesh.position).addScaledVector(l.off.clone().applyQuaternion(l.part.mesh.quaternion), 1);
    }
    this.poseWires(t, 1 - back);
  }

  /** The wires of the four spans between the poles: sagging runs of six bars from pole top to pole top. */
  private poseWires(t: number, lean: number) {
    const a = v3(0, 0, 0), c = v3(0, 0, 0), prev = v3(0, 0, 0), cur = v3(0, 0, 0), dir = v3(0, 0, 0);
    const m = new THREE.Matrix4(), s = v3(1, 1, 1), qq = new THREE.Quaternion(), mid = v3(0, 0, 0);
    let n = 0;
    for (let k = 0; k + 1 < this.poleTops.length; k++) {
      for (const ay of [7.4, 6.45]) for (const d of [-0.95, 0.95]) {
        this.poleTops[k]!.attach(t, lean, ay, d, a);
        this.poleTops[k + 1]!.attach(t, lean, ay, d, c);
        const sag = 0.25 + 0.016 * a.distanceTo(c);
        prev.copy(a);
        for (let i = 1; i <= WIRE_SEGS; i++) {
          const u = i / WIRE_SEGS;
          cur.copy(a).lerp(c, u);
          cur.y -= sag * 4 * u * (1 - u);
          dir.copy(cur).sub(prev);
          const len = dir.length();
          qq.setFromUnitVectors(AX, dir.divideScalar(len));
          mid.copy(prev).add(cur).multiplyScalar(0.5);
          m.compose(mid, qq, s.set(len, 1, 1));
          this.wires.setMatrixAt(n++, m);
          prev.copy(cur);
        }
      }
    }
    this.wires.instanceMatrix.needsUpdate = true;
  }

  /** Moves the moon's light and its shadow to `focus`. */
  light(focus: V3) {
    this.key.target.position.copy(focus);
    this.key.position.copy(focus).addScaledVector(NIGHT.dir, 80);
    this.key.target.updateMatrixWorld();
  }

  dispose() {
    this.scene.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
}
