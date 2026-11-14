// The world of the bridge (clip bridge, treatment v6 "Plate 5"): the mountain with the tunnel portal, the unfinished ramp,
// the terrain and clouds, the four flower walls (Rapier, one bake each) and their petals, the wind lines, the sleeping flock
// (boids, baked in `_bridgeboids.ts`), the sardine river, the moon that is the game disc (`_bridgeMoon.ts`), and the shared geometry
// of the small game map of the corner window.
// Everything is a pure function of t: `BridgeWorld.pose(t)` writes the instances for time t.
import * as THREE from 'three';
import { hashSin, mulberry32, smooth, stepT } from '@pve/engine/util';
import { Builder, ambient, allFaces, at, col, icosphere, instanced, litMesh, point, sun, v3, type Face, type LitAtlas } from '@pve/engine/lit';
import type { Sky } from '@pve/engine/litview';
import { Train } from './_train';
import { SPB } from './_time';
import { Fish } from './_fish';
import { TunaSchool } from './_tuna';
import { buildTrack, trackFaces } from '@pve/engine/track';
import {
  RAMP_END, T_DROP, T_END, T_FILL, T_MOON, T_PULL, T_SWING, T_WIND, rampSlope, rampY, type TrainPath,
} from './_bridgepath';
import { Flock } from './_bridgeboids';
import { FlowerWalls } from './_bridgeflowers';
import { AirLines, IceCoat } from './_bridgeair';
import { BridgeMoon } from './_bridgeMoon';
import { lookAt } from './_bridgeLooks';
import { fbm } from './_bridgePaint';

// ---------------------------------------------------------------- terrain

/** The floor under the corridor: the plateau of the map, the drop past the ramp, the hills, the basin of clouds. */
const FLOOR: [number, number][] = [[-400, -0.55], [34, -0.55], [72, -14], [120, -18], [165, 6], [205, 13], [300, 13], [314, -140], [1200, -140]];
function floorY(x: number): number {
  if (x <= FLOOR[0]![0]) return FLOOR[0]![1];
  for (let i = 1; i < FLOOR.length; i++) {
    const [x1, y1] = FLOOR[i]!, [x0, y0] = FLOOR[i - 1]!;
    if (x <= x1) return y0 + (y1 - y0) * smooth((x - x0) / (x1 - x0));
  }
  return FLOOR[FLOOR.length - 1]![1];
}

/** The height of the ground at x, z. */
export function groundY(x: number, z: number): number {
  const az = Math.abs(z);
  const rise = smooth((az - 34) / (90 + 80 * smooth((x - 120) / 80)));
  const amp = 150 - 120 * smooth((x - 60) / 60) - 5 * smooth((x - 330) / 100);
  const peaks = (0.3 + 1.1 * fbm(x * 0.011 + 3, z * 0.011)) * rise;
  return floorY(x) + amp * peaks * peaks + 2.5 * fbm(x * 0.06, z * 0.06) * (1 - rise);
}

export class BridgeWorld {
  readonly scene = new THREE.Scene();
  readonly train: Train;
  readonly fish: Fish;
  private readonly hemi = ambient('#3a4c96', '#141a30', 1);
  private readonly key = sun('#9db4ff', 1.7, 40, 256);
  private readonly moon = new BridgeMoon();
  private readonly warm = point('#ffb868', 0, 80);
  private headKey = -1;

  /** The flower walls of line 13 and what flies off them. */
  readonly flowers: FlowerWalls;
  private readonly air: AirLines;
  private ice!: IceCoat;
  private shadow = new THREE.Mesh(new THREE.PlaneGeometry(24, 5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000008, transparent: true, opacity: 0.4, depthWrite: false, fog: false }));
  private readonly tmp = new THREE.Matrix4();
  /** The peaks of the far ridges (layer 0 near to 2 far) and of the cloud deck (layer 3): the lights draw their rims. */
  readonly peaks: { x: number; z: number; base: number; r: number; h: number; layer: number }[] = [];
  /** The ground mesh and the cloud deck: the bass rumble (`_bassheave.ts`) gives them its material. */
  terrain!: THREE.Mesh;
  clouds!: THREE.Mesh;
  /** The frame of the moon that does not turn (x right, y up, z to the train): what is printed on the disc stands in it. */
  get moonFrame(): THREE.Group { return this.moon.root; }
  /** The angle of the impact point of the ram in the moon frame. */
  get impactAt(): number { return this.moon.impactAngle; }
  private birds!: THREE.InstancedMesh;
  private flock!: Flock;
  private birdData: { s: number }[] = [];
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();
  private river!: TunaSchool;
  private riverData: { lag: number; dy: number; dz: number; ph: number; size: number }[] = [];
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  /** Shared geometry for the map window (the same rails, ramp and portal). */
  readonly shared = { track: new THREE.BufferGeometry(), rails: new THREE.BufferGeometry(), ramp: new THREE.BufferGeometry() };

  private readonly o = new THREE.Object3D();
  private readonly e = new THREE.Euler(0, 0, 0, 'YZX');

  constructor(private A: LitAtlas, private mat: THREE.Material, private path: TrainPath) {
    this.train = new Train(A, mat);
    this.train.setInterior(0.9);
    this.train.root.matrixAutoUpdate = false;
    this.fish = new Fish(A, mat);
    this.fish.root.position.set(2.8, 2.3, 0.5);
    this.train.root.add(this.fish.root);
    this.train.root.add(this.warm);
    this.warm.position.set(0, 14, 8);
    this.scene.add(this.train.root, this.hemi, this.key, this.key.target);
    this.key.castShadow = false;
    this.scene.fog = new THREE.FogExp2(0x101c46, 0.0013);
    this.flowers = new FlowerWalls(A, path);
    this.air = new AirLines(path);
    this.shadow.frustumCulled = false;
    this.scene.add(this.flowers.root, this.air.mesh, this.shadow);
  }

  /** `fill`: the times of the hits of the drum fill of bar 40 (the frost goes on over the car on each). */
  async init(fill: readonly number[]) {
    this.ice = new IceCoat(fill, this.path);
    this.train.root.add(this.ice.root);
    this.scene.add(this.ice.shards);
    this.buildMountain();
    this.buildRamp();
    this.buildTerrain();
    this.buildClouds();
    this.buildBirds();
    this.buildRiver();
    this.moon.build(this.A, this.mat, this.path.moon);
    this.scene.add(this.moon.root);
  }

  // ---------------------------------------------------------------- mountain and tunnel

  private buildMountain() {
    const A = this.A;
    const rock: Face = { cell: A.paint(16, 16, (p) => { p.fill('#2e3446'); p.speckle('#242a3a', 0.3, 5); p.speckle('#3a4258', 0.2, 6); }) };
    const rockLo: Face = { cell: A.paint(16, 16, (p) => { p.fill('#262c3c'); p.speckle('#1c2130', 0.3, 7); }) };
    const dark: Face = { cell: A.paint(8, 8, (p) => { p.fill('#07070c'); p.speckle('#0e0e16', 0.25, 4); }) };
    const concrete: Face = { cell: A.paint(16, 16, (p) => { p.fill('#8a8c96'); p.speckle('#74767f', 0.3, 9); p.speckle('#9ea0aa', 0.2, 10); }) };
    const lamp: Face = { cell: A.solid('#ffb050', 3.2) };
    const b = new Builder(0.8);
    const HW = 12, HH = 10;
    // the mesa with the portal in its front face (x = 0): wall slabs, the roof over the bore, a floor, the dark end
    b.box(80, HH + 40, 70, allFaces(rock), at(-40, -1, -HW - 35));
    b.box(80, HH + 40, 70, allFaces(rock), at(-40, -1, HW + 35));
    b.box(80, 40, 2 * HW, allFaces(rock), at(-40, HH, 0));
    b.box(80, 1, 2 * HW, allFaces(dark), at(-40, -1.5, 0));
    b.box(1, HH + 1, 2 * HW, { px: dark }, at(-79.5, -0.5, 0));
    // the dark walls of the bore are the inner faces: a second skin of near-black inside
    b.box(78, HH, 0.2, { pz: dark, nz: dark }, at(-40, 0, -HW + 0.1));
    b.box(78, HH, 0.2, { pz: dark, nz: dark }, at(-40, 0, HW - 0.1));
    b.box(78, 0.2, 2 * HW, { ny: dark }, at(-40, HH - 0.2, 0));
    // the concrete frame of the portal and a lintel
    b.box(1.4, HH + 2.2, 1.6, allFaces(concrete), at(0.3, -0.5, -HW - 0.8));
    b.box(1.4, HH + 2.2, 1.6, allFaces(concrete), at(0.3, -0.5, HW + 0.8));
    b.box(1.4, 1.8, 2 * HW + 3.2, allFaces(concrete), at(0.3, HH, 0));
    // lamps along both walls: they stream past as the train speeds up
    for (let x = -74; x < -1; x += 8) for (const s of [-1, 1]) b.box(0.4, 0.5, 0.25, allFaces(lamp), at(x, HH - 2.4, s * (HW - 0.4)));
    // the mountain above and behind the face: a stack of cones
    const cone = new Builder(0.4);
    const mr = mulberry32(0x5a1);
    cone.cylinder(170, 0, 135, 7, rock, null, at(-165, 4, 0, 0.3));
    for (let k = 0; k < 7; k++) {
      const a = -0.9 + k * 0.3;
      cone.cylinder(70 + mr() * 50, 0, 70 + mr() * 50, 6, k % 2 ? rock : rockLo, null, at(-70 - mr() * 160, 10, Math.sin(a) * 160, mr() * 3));
    }
    this.scene.add(litMesh(b, this.mat, { cast: false }), litMesh(cone, this.mat, { cast: false }));
  }

  // ---------------------------------------------------------------- the line and the unfinished ramp

  private buildRamp() {
    const A = this.A;
    const faces = trackFaces(A);
    const plateau = buildTrack(A, new THREE.LineCurve3(v3(-85, 0, 0), v3(6, 0, 0)), { faces });
    const pts: THREE.Vector3[] = [];
    for (let x = 6; x <= RAMP_END + 0.01; x += 2) pts.push(v3(x, rampY(x), 0));
    const ramp = buildTrack(A, new THREE.CatmullRomCurve3(pts, false, 'centripetal'), { faces, ballast: false });
    this.shared.track = plateau.geometry();
    // the wooden trestle: planks, stringers, posts and braces; the last planks are broken
    const wood: Face = { cell: A.paint(8, 8, (p) => { p.fill('#7a5632'); p.speckle('#5e4125', 0.3, 3); p.speckle('#8e6a40', 0.2, 4); p.rect(0, 3, 8, 1, '#4a321c'); }) };
    const woodDk: Face = { cell: A.paint(8, 8, (p) => { p.fill('#4e371f'); p.speckle('#3a2815', 0.3, 5); }) };
    const w = new Builder(2);
    const rnd = mulberry32(0x7a11);
    const tilt = (x: number, y: number, a: number, ex = 0) => {
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(ex, 0, a, 'XYZ'));
      return m.setPosition(x, y, 0);
    };
    for (let x = 6.3; x < RAMP_END - 0.3; x += 0.9) {
      const a = Math.atan(rampSlope(x));
      const broken = x > RAMP_END - 3.2;
      const jitter = broken ? (rnd() - 0.5) * 0.35 : 0;
      if (broken && rnd() < 0.3) continue;
      w.box(0.75, 0.18, 3.5, allFaces(wood), tilt(x, rampY(x) - 0.48, a + jitter, broken ? (rnd() - 0.5) * 0.3 : 0));
    }
    for (const z of [-1.5, 1.5]) {
      for (let x0 = 6; x0 < RAMP_END - 0.1; x0 += 4) {
        const x1 = Math.min(RAMP_END, x0 + 4);
        const y0 = rampY(x0) - 0.6, y1 = rampY(x1) - 0.6;
        const len = Math.hypot(x1 - x0, y1 - y0);
        const m = tilt((x0 + x1) / 2, (y0 + y1) / 2 - 0.25, Math.atan2(y1 - y0, x1 - x0));
        m.setPosition((x0 + x1) / 2, (y0 + y1) / 2 - 0.25, z);
        w.box(len + 0.05, 0.5, 0.35, allFaces(woodDk), m);
      }
    }
    const posts = [8, 14, 20, 26, 32];
    for (const x of posts) for (const z of [-1.6, 1.6]) {
      const top = rampY(x) - 0.95;
      w.box(0.5, top + 0.6, 0.5, allFaces(woodDk), at(x, -0.6, z));
    }
    for (let i = 0; i + 1 < posts.length; i++) for (const z of [-1.6, 1.6]) {
      const xa = posts[i]!, xb = posts[i + 1]!;
      const ya = rampY(xa) - 1.0, yb = rampY(xb) - 1.0;
      const lo = -0.4;
      for (const [ay, by] of [[lo, yb], [ya, lo]] as const) {
        const len = Math.hypot(xb - xa, by - ay);
        const m = new THREE.Matrix4().makeRotationZ(Math.atan2(by - ay, xb - xa)).setPosition((xa + xb) / 2, (ay + by) / 2, z);
        w.box(len, 0.22, 0.22, allFaces(wood), m);
      }
    }
    this.shared.ramp = w.geometry();
    this.shared.rails = ramp.geometry();
    this.scene.add(litMesh(this.shared.track, this.mat, { cast: false }), litMesh(this.shared.rails, this.mat, { cast: false }), litMesh(this.shared.ramp, this.mat, { cast: false }));
  }

  // ---------------------------------------------------------------- terrain

  private buildTerrain() {
    const A = this.A;
    const grassA: Face = { cell: A.paint(16, 16, (p) => { p.fill('#2a4422'); p.speckle('#213818', 0.3, 11); p.speckle('#35552b', 0.2, 12); }) };
    const grassB: Face = { cell: A.paint(16, 16, (p) => { p.fill('#34502a'); p.speckle('#294020', 0.3, 13); }) };
    const rockA: Face = { cell: A.paint(16, 16, (p) => { p.fill('#4a4c5e'); p.speckle('#3a3c4c', 0.3, 14); p.speckle('#5a5c70', 0.2, 15); }) };
    const rockB: Face = { cell: A.paint(16, 16, (p) => { p.fill('#383a4c'); p.speckle('#2c2e3c', 0.3, 16); }) };
    const b = new Builder(0.5);
    const X0 = -300, X1 = 1100, Z0 = -520, Z1 = 520, C = 20;
    const nx = Math.round((X1 - X0) / C), nz = Math.round((Z1 - Z0) / C);
    const heights: number[] = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = X0 + i * C, z = Z0 + j * C;
      // behind the portal the mountain is built from boxes and cones: the ground there stays low
      heights.push(x < 4 && Math.abs(z) < 90 ? -3 : groundY(x, z));
    }
    const hAt = (i: number, j: number) => heights[j * (nx + 1) + i]!;
    const pick = (a: THREE.Vector3, bb: THREE.Vector3, c: THREE.Vector3, i: number, j: number): Face => {
      const n = bb.clone().sub(a).cross(c.clone().sub(a)).normalize();
      const high = (a.y + bb.y + c.y) / 3 > 40;
      if (n.y < 0.72) return hashSin(i, j) < 0.5 ? rockA : rockB;
      if (high) return rockB;
      return hashSin(i * 3, j * 7) < 0.5 ? grassA : grassB;
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x0 = X0 + i * C, z0 = Z0 + j * C, x1 = x0 + C, z1 = z0 + C;
      const a = v3(x0, hAt(i, j), z0), bb = v3(x0, hAt(i, j + 1), z1), c = v3(x1, hAt(i + 1, j), z0), d = v3(x1, hAt(i + 1, j + 1), z1);
      b.tri(a, bb, c, pick(a, bb, c, i, j));
      b.tri(bb, d, c, pick(bb, d, c, i + 1, j + 1));
    }
    this.terrain = litMesh(b, this.mat, { cast: false });
    this.scene.add(this.terrain);
    // far ranges ringing the horizon: layered silhouettes that fade into the fog
    const far = new Builder(0.2);
    const fr = mulberry32(0xfa2);
    for (let k = 0; k < 70; k++) {
      const ang = (k / 70) * Math.PI * 2 + fr() * 0.05;
      const dist = 1300 + fr() * 700;
      const cx = 450 + Math.cos(ang) * dist * 1.5, cz = Math.sin(ang) * dist;
      far.cylinder(160 + fr() * 220, 0, 110 + fr() * 190, 6 + (k % 2), k % 3 ? rockB : rockA, null, at(cx, -50, cz, fr() * 3));
    }
    // layered ridges behind the line (the far side from the cameras): three depths that the fog turns into silhouettes
    const ridge = new Builder(0.2);
    ([[330, 480, 70], [560, 760, 100], [850, 1150, 150]] as const).forEach(([d0, d1, h], layer) => {
      for (let k = 0; k < 20; k++) {
        const cx = -150 + (k / 19) * 1300 + fr() * 40, cz = -(d0 + fr() * (d1 - d0));
        const r = 70 + fr() * 90, hh = h * (0.5 + fr() * 0.7);
        ridge.cylinder(r, 0, hh, 6 + (k % 2), k % 2 ? rockB : rockA, null, at(cx, -60, cz, fr() * 3));
        this.peaks.push({ x: cx, z: cz, base: -60, r, h: hh, layer });
      }
    });
    this.scene.add(litMesh(ridge, this.mat, { cast: false }));
    this.scene.add(litMesh(far, this.mat, { cast: false }));
  }

  // ---------------------------------------------------------------- clouds

  private buildClouds() {
    const A = this.A;
    const hi: Face = { cell: A.paint(4, 4, (p) => { p.fill('#5c6fb4'); p.speckle('#6a7cc2', 0.3, 21); }) };
    const lo: Face = { cell: A.paint(4, 4, (p) => { p.fill('#34447c'); p.speckle('#3e4e88', 0.3, 22); }) };
    const b = new Builder();
    const rnd = mulberry32(0xc10d);
    // the deck: many small flat puffs behind the line and on the cameras' side, never between a camera and the train
    for (let k = 0; k < 900; k++) {
      const x = 300 + rnd() * 760, r = 8 + rnd() * 12;
      const z = rnd() < 0.5 ? -(r + 10 + rnd() * 420) : 26 + r + 12 + rnd() * 380;
      const f = rnd() < 0.5 ? hi : lo, y = -40 + rnd() * 30, rot = rnd() * 6, sy = 0.2 + rnd() * 0.12;
      icosphere(b, r, f, at(x, y, z, rot), sy);
    }
    // a few small puffs just behind the line, where the train falls through
    for (const [x, y, z, r] of [[322, -6, -9, 6], [330, -14, -9, 7], [326, -26, -10, 7], [338, 4, -10, 6], [334, 10, -9, 5], [344, -18, -9, 7], [318, -2, -11, 6]] as const) {
      icosphere(b, r, hi, at(x, y, z, x), 0.45);
    }
    // the cloud sea under the fall: a low deck the train drops towards, behind the line and well below the cameras
    for (let k = 0; k < 260; k++) {
      const x = 300 + rnd() * 190, r = 12 + rnd() * 14;
      const z = rnd() < 0.7 ? -(r + 10 + rnd() * 200) : 26 + r + 12 + rnd() * 140;
      icosphere(b, r, rnd() < 0.6 ? hi : lo, at(x, -62 + rnd() * 24, z, rnd() * 6), 0.22 + rnd() * 0.12);
    }
    // peaks and a closer deck along the climb (x 380-700): ground reference under the train, on both sides of the line
    const rockP: Face = { cell: A.paint(8, 8, (p) => { p.fill('#34447e'); p.speckle('#3f5090', 0.3, 23); p.speckle('#2a386c', 0.2, 24); }) };
    const snow: Face = { cell: A.paint(4, 4, (p) => { p.fill('#c4d6ff'); p.speckle('#e4eeff', 0.3, 25); }) };
    for (let k = 0; k < 22; k++) {
      const x = 380 + rnd() * 330, h = 55 + rnd() * 45, r0 = 28 + rnd() * 18;
      const z = (rnd() < 0.5 ? -1 : 1) * (45 + r0 * 0.5 + rnd() * 90), rot = rnd() * 3;
      b.cylinder(r0, 0, h, 6, rockP, null, at(x, -70, z, rot));
      this.peaks.push({ x, z, base: -70, r: r0, h, layer: 3 });
      // the snow cap is a cone 1.2 m outside the rock cone: one of the same slope on the same faces fights it for the depth (z-fighting)
      b.cylinder(r0 * 0.3 + 1.2, 0, h * 0.3 + 1.2, 6, snow, null, at(x, -70 + h * 0.7, z, rot));
    }
    for (let k = 0; k < 230; k++) {
      const x = 380 + rnd() * 330, r = 14 + rnd() * 14;
      const z = (rnd() < 0.5 ? -1 : 1) * (24 + r + rnd() * 120);
      const y = -62 + rnd() * 26, rot = rnd() * 6, sy = 0.25 + rnd() * 0.12, f = rnd() < 0.6 ? hi : lo;
      icosphere(b, r, f, at(x, y, z, rot), sy);
    }
    // banks of towers that stand up out of the deck, with gaps between the banks: stacks of blobs, bright on top (the aurora lights them
    // from above). They stand on the far side of the line and behind the cameras, never between a camera and the train
    const top: Face = { cell: A.paint(4, 4, (p) => { p.fill('#a9b8ee'); p.speckle('#c8d4ff', 0.3, 26); }) };
    for (let bank = 0; bank < 13; bank++) {
      const bx = 300 + rnd() * 430, side = rnd() < 0.72 ? -1 : 1, bz = side * (side < 0 ? 46 : 70) + side * rnd() * 150;
      for (let k = 0; k < 5; k++) {
        const x = bx + (rnd() - 0.5) * 70, z = bz + side * rnd() * 50, r = 13 + rnd() * 12, levels = 2 + Math.floor(rnd() * 5);
        for (let l = 0; l < levels; l++) {
          const rr = r * (1 - 0.13 * l);
          icosphere(b, rr, l === levels - 1 ? top : l ? hi : lo, at(x + (rnd() - 0.5) * 0.5 * r, -56 + l * r * 0.62, z + (rnd() - 0.5) * 0.5 * r, rnd() * 6), 0.5 + rnd() * 0.15);
        }
      }
    }
    this.clouds = litMesh(b, this.mat, { cast: false });
    this.scene.add(this.clouds);
  }

  // ---------------------------------------------------------------- the sleeping flock

  private buildBirds() {
    const b = new Builder();
    const body: Face = { cell: this.A.solid('#dfe8f4', 0.55) };
    const belly: Face = { cell: this.A.solid('#fff4e2', 0.6) };
    const wing: Face = { cell: this.A.solid('#5f86b8', 0.35) };
    const tip: Face = { cell: this.A.solid('#3d5f92', 0.3) };
    const beak: Face = { cell: this.A.solid('#ffb23a', 1.2) };
    const eye: Face = { cell: this.A.solid('#1c2433', 0.1) };
    const cheek: Face = { cell: this.A.solid('#ff9aa8', 0.8) };
    /** An ellipse round (cx, cy), counter-clockwise, as a profile for `extrude`. */
    const oval = (cx: number, cy: number, rx: number, ry: number, n = 12): [number, number][] =>
      Array.from({ length: n }, (_, k) => [cx + rx * Math.cos((k / n) * 2 * Math.PI), cy + ry * Math.sin((k / n) * 2 * Math.PI)] as [number, number]);
    const side = (z: number) => new THREE.Matrix4().makeTranslation(0, 0, z);
    // a small round bird seen from the side, asleep in the air (+x forward, +y up): a puffed body in two layers so it reads round
    // from every side, a big head with the eyes shut and a pink cheek, the wings folded along both flanks, a fanned tail
    b.extrude(oval(-0.06, 0, 0.4, 0.25), 0.34, body, body);
    b.extrude(oval(-0.06, -0.02, 0.32, 0.19), 0.46, body, body);
    b.extrude(oval(0.02, -0.1, 0.24, 0.12), 0.4, belly, belly);
    b.extrude(oval(0.32, 0.17, 0.18, 0.17), 0.32, body, body);
    // the shut eyes: a short dark line on each side of the head, a little curved down (asleep)
    b.extrude([[0.35, 0.2], [0.39, 0.18], [0.45, 0.18], [0.49, 0.2], [0.49, 0.22], [0.35, 0.22]], 0.34, eye, eye);
    b.extrude(oval(0.42, 0.11, 0.05, 0.035, 8), 0.335, cheek, cheek);
    b.extrude([[0.64, 0.14], [0.49, 0.2], [0.49, 0.09]], 0.09, beak, beak);
    // the folded wings: one on each flank, a dark tip at the back
    for (const z of [-0.21, 0.21]) {
      b.extrude([[0.16, 0.12], [-0.1, 0.19], [-0.38, 0.12], [-0.32, -0.06], [0.04, -0.09]], 0.06, wing, wing, side(z));
      b.extrude([[-0.32, 0.13], [-0.56, 0.06], [-0.5, -0.02], [-0.33, -0.04]], 0.05, tip, tip, side(z));
    }
    b.extrude([[-0.38, 0.06], [-0.74, 0.17], [-0.79, 0.07], [-0.74, -0.03], [-0.4, -0.04]], 0.18, wing, wing);
    const N = 460;
    this.birds = instanced(b.geometry(), this.mat, N);
    const rnd = mulberry32(0xb17d);
    for (let i = 0; i < N; i++) this.birdData.push({ s: 1.6 + rnd() * 0.7 });
    // the flock is baked once: it drifts forward in streams, and the train parts it (see _bridgeboids.ts)
    this.flock = new Flock({ t0: T_SWING - 1.0, t1: T_WIND, count: N, train: (t) => ({ p: this.path.at(t).p }), spread: [20, 200], drift: 4, seed: 0xb17d });
    this.scene.add(this.birds);
  }

  // ---------------------------------------------------------------- the river of tuna round the carried train

  private buildRiver() {
    // the same tuna as the ones that carry the train (`_bridgelights.ts`), a little smaller
    const N = 300;
    this.river = new TunaSchool(this.A, this.mat, N, false, 1);
    const rnd = mulberry32(0x5a7d);
    // `lag` < 0: ahead of the train. The school swims in a wide river behind it and alongside, never inside the car
    for (let i = 0; i < N; i++) {
      const lag = -0.8 + Math.pow(rnd(), 0.9) * 7.3;
      let dz = -10 + rnd() * 13, dy = -5 + rnd() * 13;
      // not in the car, and not between the car and the chase camera (it stands behind and to the +z side)
      if (lag > 0.1 && lag < 1.5 && dz > -4) dz -= 6;
      if (lag < 0.9 && Math.abs(dz) < 3.6) dz = dz < 0 ? -3.6 - rnd() : 3.6 + rnd();
      this.riverData.push({ lag, dy, dz, ph: rnd() * 6.28, size: 0.5 + 0.25 * rnd() });
    }
    this.scene.add(this.river.root);
  }

  // ---------------------------------------------------------------- pose

  /** Sets the lights and the sky of time t. Returns the sky for the view. */
  look(t: number, trainPos: THREE.Vector3): Sky {
    const L = lookAt(t);
    this.hemi.color.copy(col(L.hemiSky));
    this.hemi.groundColor.copy(col(L.hemiGround));
    this.hemi.intensity = L.hemi;
    this.key.color.copy(col(L.sun));
    this.key.intensity = L.sunI;
    // the key light: from the left and above in the night and dusk, from the moon once the disc rules the sky. It turns over the two
    // beats before the moon line, as the sky does (`lookAt`), not on one frame
    const toMoon = this.path.moon.centre.clone().sub(trainPos).normalize();
    const dir = v3(-0.45, 0.8, 0.4).normalize().lerp(toMoon, smooth((t - (T_MOON - 2 * SPB)) / (2 * SPB))).normalize();
    this.key.position.copy(trainPos).addScaledVector(dir, 80);
    this.key.target.position.copy(trainPos);
    this.key.target.updateMatrixWorld();
    (this.scene.fog as THREE.FogExp2).color.copy(col(L.fog));
    (this.scene.fog as THREE.FogExp2).density = L.fogD;
    return { zenith: L.zenith, horizon: L.horizon, ground: L.ground, stars: L.stars };
  }

  /** The train, the headlights and every layer at time t. */
  pose(t: number) {
    const a = this.path.at(t);
    this.train.root.matrix.copy(this.path.matrix(t));
    this.train.root.matrixWorldNeedsUpdate = true;
    // the headlights come up out of the dark; the lights repaint the atlas, so only when the level changes
    const hk = Math.round(smooth((t - 56.05) / 0.3) * 24);
    if (hk !== this.headKey) { this.headKey = hk; this.train.setHeadlights(hk / 24); }
    this.fish.pose(Math.floor(t * 12) / 12, v3(...this.fishLocal(t)), v3(0.8, 0, 0), 0);
    // a warm light from the cabin once the tuna carry the train: the car stays the subject against the moon
    this.warm.intensity = 45 * smooth((t - 73.4) / 0.6) + 140 * smooth((t - (T_MOON - 2 * SPB)) / (2 * SPB));

    // each wall is a soft hit: the car rocks
    const rock = this.flowers.rock(t);
    if (rock !== 0) this.train.root.matrix.multiply(this.tmp.makeRotationFromEuler(this.e.set(0.02 * rock, 0, -0.035 * rock, 'YZX')));
    this.flowers.pose(t);
    this.air.pose(t);
    this.ice.pose(t);
    this.poseShadow(t, a.p);
    this.poseBirds(t);
    this.poseRiver(t);
    this.moon.pose(t);
  }

  /** The sardine in the car frame at t: it floats (weightless) over the bar 40 fill, then it is thrown to the floor. */
  fishLocal(t: number): [number, number, number] {
    // before the wind stops it swims forward to the cab, and it is at the front glass from then on. It floats in the cab: the fish cam
    // behind it must stay in front of the partition (x 8.35) and under the ceiling (y 3.3)
    const cab = smooth((t - 67.3) / 1.0);
    const float = smooth((t - T_FILL) / 1.2) * (1 - smooth((t - T_DROP) / 0.25));
    return [2.8 + 6.4 * cab - 0.15 * float, 2.3 + 0.15 * cab + 0.35 * float, 0.5 - 0.2 * cab];
  }

  /** The shadow of the train on the cloud deck: it lies where the light of the sky puts it, on the tops of the banks. */
  private poseShadow(t: number, p: THREE.Vector3) {
    const DECK = -41;
    const h = p.y - DECK;
    const on = t > T_DROP && t < T_MOON + 1 && h > 0 && h < 45;
    this.shadow.visible = on;
    if (!on) return;
    this.shadow.position.set(p.x + 0.56 * h, DECK, p.z - 0.5 * h);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - h / 45);
  }

  private poseBirds(t: number) {
    const on = t >= T_SWING - 0.5 && t < T_DROP + 1.4;
    this.birds.visible = on;
    if (!on) return;
    const o = this.o, e = this.e, p = this.tmpP, v = this.tmpV;
    // the flock sleeps at 12 fps; the wind tool stops it: the baked step is held from T_WIND on
    const k = this.flock.step(stepT(Math.min(t, T_WIND), 12));
    const fade = smooth((t - (T_SWING - 0.5)) / 0.3) * (1 - smooth((t - T_DROP) / 1.0));
    for (let i = 0; i < this.birdData.length; i++) {
      this.flock.read(k, i, p, v);
      e.set(0, Math.atan2(-v.z, v.x), Math.atan2(v.y, Math.hypot(v.x, v.z)), 'YZX');
      o.position.copy(p);
      o.quaternion.setFromEuler(e);
      o.scale.setScalar(this.birdData[i]!.s * fade);
      o.updateMatrix();
      this.birds.setMatrixAt(i, o.matrix);
    }
    this.birds.instanceMatrix.needsUpdate = true;
  }

  private poseRiver(t: number) {
    if (t < T_PULL - 0.6 || t >= T_END + 0.1) { this.river.pose(t, [], []); return; }
    const grow = smooth((t - (T_PULL - 0.6)) / 0.8);
    const pos: THREE.Vector3[] = [], vel: THREE.Vector3[] = [], size: number[] = [];
    for (const d of this.riverData) {
      const a = this.path.at(Math.max(t - d.lag, T_PULL - 0.5));
      const p = a.p.clone();
      // the weave reads t itself: the school moves at the frame rate, as the tuna that carry the train
      p.y += d.dy * (0.6 + 0.4 * Math.sin(t * 0.7 + d.ph));
      p.z += d.dz + 1.5 * Math.sin(t * 0.9 + d.ph * 2);
      // the heading weaves a little round the heading of the path
      pos.push(p);
      vel.push(a.v.clone().applyAxisAngle(this.yAxis, 0.14 * Math.sin(t * 11 + d.ph)));
      size.push(d.size * grow);
    }
    this.river.pose(t, pos, vel, undefined, size);
  }

  dispose() {
    this.flowers.dispose();
    this.air.dispose();
    this.ice.dispose();
    this.birds.dispose();
  }
}


