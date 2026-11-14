// The zones and the sinkhole of chorus 1b (treatment v8 "Plate 4", lines 11 and 12), on the ground `PIT` of the one game world.
//
// Line 11: the game zones by itself. A cloud stands over each zone, and a tower builds down from it, one floor on each onset, as on a
// building site of a city builder (`_construction.ts`): a steel frame slides into place, the walls close from the top down, netting, dust,
// a crane on the lot, a sparkle when the tower is done.
// Line 12: the ground opens. The hole is a pit that grows on each syllable: the ground tiles inside it tip toward the middle and drop,
// and the towers and the trees go in as rigid bodies (Rapier, baked once: they hit each other on the way). The pit has the form of an
// eye without being drawn as one: a round rim, stepped walls, and at the bottom a pale ring round a black middle that turns toward the
// train. Seen from the map camera the far wall is a lid over it.
//
// Everything is a pure function of t (`pose`), after `bake()`.
import * as THREE from 'three';
import { mulberry32, smooth } from '@pve/engine/util';
import { easeOut3 } from './_ease';
import { bake, type Baked, type BodySpec } from '@pve/engine/physics';
import { Builder, allFaces, at, instanced, litMesh, v3, type Face } from '@pve/engine/lit';
import { FR, SPB } from './_time';
import { ConstructionSite, FRAME_IN, WALLS } from './_construction';
import { GROUND_Y } from './_station';
import { PIT, type GameWorld } from './_gameWorld';

/** The middle of the hole (x, z). */
export const HOLE = { x: 22, z: -150 } as const;
/** The zones: the middle of the footprint, its size, the floors, and a delay in onsets. They stand clear of the track. */
export const ZONES = [
  { x: 40, z: -136, w: 24, d: 18, floors: 16, lag: 0 },
  { x: 4, z: -128, w: 12, d: 10, floors: 10, lag: 2 },
  { x: 52, z: -166, w: 11, d: 10, floors: 12, lag: 1 },
] as const;
export const FLOOR_H = 2.2;
/** The height of the cloud deck over the ground. */
export const DECK_Y = 16 * FLOOR_H + 2;
const YAW = Math.PI / 6;
/** The ground tiles of the pit: `TILES` x `TILES` squares. */
const TILES = 20, TILE = (PIT.half * 2) / TILES, TILE_H = 5;
/** The fall of the bodies and the tiles is faster than life (a game at speed). */
const G = 40;
/** The depth of the pit for a radius of 1: shallow enough that the map camera (30 degrees down) sees the bottom past the near rim. */
const DEPTH = 0.5;
/** The time (s) that a tree or a shed takes to build up. */
const BUILD = 0.3;
const easeOutBack = (u: number) => 1 + 2.2 * (u - 1) ** 3 + 1.2 * (u - 1) ** 2;

interface Body { mesh: THREE.Object3D; half: [number, number, number]; p: THREE.Vector3; q: THREE.Quaternion; d: number; reach: number }

export class Pit {
  readonly root = new THREE.Group();
  private tiles: THREE.InstancedMesh;
  private tileFall: Float32Array;
  private funnel = new THREE.Group();
  private eye = new THREE.Group();
  /** The terraces of the pit: each is a ring that turns by itself. */
  private terraces: THREE.Group[] = [];
  /** The small eyes in the walls of the terraces: `a` its place round its terrace (rad), `at` the time at which it opens. */
  private wallEyes: { root: THREE.Group; pupil: THREE.Mesh; a: number; terrace: number; at: number }[] = [];
  private towers: { floors: { solid: THREE.Mesh; wire: THREE.Mesh; y: number; start: number }[]; site: ConstructionSite }[] = [];
  /** The pieces of the clouds over the zones: the place of each (its middle), and the time at which it lets go (the rim of the hole is under its zone). */
  private clouds: { mesh: THREE.Mesh; x: number; y: number; z: number; tr: number; spin: number }[] = [];
  private bodies: Body[] = [];
  private baked: Baked | null = null;
  private steps: number[];
  private o = new THREE.Object3D();
  private bp = new THREE.Vector3();
  private bq = new THREE.Quaternion();

  /**
   * `floorTimes`: the onsets of line 11 (one floor each). `units`: the syllable starts of line 12 (the hole opens on the first and grows on each). `end`: the fall is baked up to this time (the end of the clip).
   * `riseAt`: the trees and the sheds build up out of the ground from this time, one after the other on the eighth notes (a world that loads in).
   */
  constructor(world: GameWorld, private floorTimes: readonly number[], units: readonly number[], private end = 56.9, private riseAt = -1e9) {
    const A = world.atlas, mat = world.mat;
    this.steps = [...units];
    world.pitGround.visible = false;
    world.scene.add(this.root);

    // ---- the ground tiles: on the ground material of the world, mipmapped as the rest of the ground (else the pit square looks other than the grass round it)
    const grass: Face = { cell: A.mipmap(A.paint(16, 16, (p) => { p.fill('#3f7d34'); p.speckle('#4a8c3c', 0.22, 7); p.speckle('#356b2d', 0.2, 9); })) };
    const earth: Face = { cell: A.mipmap(A.paint(16, 16, (p) => { p.fill('#5a4230'); p.speckle('#4a3626', 0.3, 3); p.speckle('#6c5440', 0.2, 8); p.rect(0, 12, 16, 1, '#3a2a1e'); })) };
    const tb = new Builder();
    tb.box(TILE, TILE_H, TILE, { py: grass, px: earth, nx: earth, pz: earth, nz: earth }, at(0, -TILE_H, 0));
    this.tiles = instanced(tb.geometry(), world.groundMat, TILES * TILES);
    this.tiles.receiveShadow = true;
    this.root.add(this.tiles);
    // the time at which the rim of the hole reaches each tile
    this.tileFall = new Float32Array(TILES * TILES);
    for (let j = 0; j < TILES; j++) for (let i = 0; i < TILES; i++) {
      const [x, z] = this.tileAt(i, j);
      this.tileFall[j * TILES + i] = this.reachTime(Math.hypot(x - HOLE.x, z - HOLE.z));
    }

    // ---- the pit: stepped walls that face the middle, darker with depth, and the bottom. A unit shape: it is scaled by the radius.
    const strata = ['#b89060', '#8e6c46', '#644a30', '#3a2a1e'].map((c): Face => ({ cell: A.paint(8, 8, (p) => { p.fill(c, 0.25); p.speckle('#2a1e14', 0.2, 5); }) }));
    const rings: [number, number][] = [[1.0, 0], [0.84, -0.2], [0.66, -0.42], [0.48, -0.64], [0.34, -0.82]];
    const N = 28;
    const pt = (r: number, y: number, k: number) => v3(r * Math.cos((k / N) * Math.PI * 2), y, r * Math.sin((k / N) * Math.PI * 2));
    const tooth = allFaces({ cell: A.solid('#1c140e') });
    for (let s = 0; s + 1 < rings.length; s++) {
      const [r0, y0] = rings[s]!, [r1, y1] = rings[s + 1]!;
      const fb = new Builder();
      for (let k = 0; k < N; k++) {
        // the wall of the step (it faces the middle) and its ledge (it faces up)
        fb.quad(pt(r0, y1, k), pt(r0, y1, k + 1), pt(r0, y0, k + 1), pt(r0, y0, k), strata[s]!);
        fb.quad(pt(r1, y1, k + 1), pt(r0, y1, k + 1), pt(r0, y1, k), pt(r1, y1, k), strata[Math.min(3, s + 1)]!);
      }
      // dark blocks on the ledge: the eye sees that the terrace turns
      for (let k = 0; k < 5; k++) {
        const a = ((k + 0.3 * s) / 5) * Math.PI * 2, rm = (r0 + r1) / 2;
        fb.box(0.06, 0.03, 0.05, tooth, at(rm * Math.cos(a), y1, rm * Math.sin(a), -a));
      }
      const g = new THREE.Group();
      g.add(litMesh(fb, mat, { cast: false }));
      this.terraces.push(g);
      this.funnel.add(g);
    }
    // the small eyes in the walls: a pale ring round a dark middle, flat on the wall of a terrace, facing the middle of the pit. One opens
    // on each syllable of line 12. They go round with their terraces.
    const paleRing: Face = { cell: A.solid('#a8b4a4', 0.6) }, dark: Face = { cell: A.solid('#020203') };
    const wb = new Builder(), pb = new Builder();
    const EN = 10, e2 = (r: number, k: number) => v3(r * Math.cos((k / EN) * Math.PI * 2), r * Math.sin((k / EN) * Math.PI * 2), 0);
    for (let k = 0; k < EN; k++) {
      wb.quad(e2(0.02, k), e2(0.05, k), e2(0.05, k + 1), e2(0.02, k + 1), paleRing);
      pb.tri(v3(0, 0, 0.001), e2(0.024, k), e2(0.024, k + 1), dark);
    }
    const wallGeo = wb.geometry(), pupilGeo = pb.geometry();
    this.steps.forEach((at0, j) => {
      const terrace = j % (rings.length - 1), [r0, y0] = rings[terrace]!, y1 = rings[terrace + 1]![1];
      const a = 2.4 * j + 0.7;
      const root = new THREE.Group();
      root.position.set((r0 - 0.004) * Math.cos(a), (y0 + y1) / 2, (r0 - 0.004) * Math.sin(a));
      root.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
      const pupil = litMesh(pupilGeo, mat, { cast: false, receive: false });
      root.add(litMesh(wallGeo, mat, { cast: false, receive: false }), pupil);
      root.visible = false;
      this.terraces[terrace]!.add(root);
      this.wallEyes.push({ root, pupil, a, terrace, at: at0 + 0.12 });
    });
    // the bottom: a pale ring with dark spokes round a black middle, and one small glint. It turns toward the train.
    const iris: Face = { cell: A.paint(16, 4, (p) => { p.fill('#8a9a8c', 0.5); for (let x = 0; x < 16; x += 3) p.rect(x, 0, 1, 4, '#3a463e', 0.2); p.rect(0, 3, 16, 1, '#2a322c', 0.15); }) };
    const black: Face = { cell: A.solid('#020203') };
    const eb = new Builder();
    const yb = rings[rings.length - 1]![1] - 0.02;
    for (let k = 0; k < N; k++) {
      eb.quad(pt(0.15, yb, k + 1), pt(0.34, yb, k + 1), pt(0.34, yb, k), pt(0.15, yb, k), iris);
      eb.tri(v3(0, yb, 0), pt(0.15, yb, k + 1), pt(0.15, yb, k), black);
    }
    eb.box(0.035, 0.004, 0.035, allFaces({ cell: A.solid('#ffffff', 5) }), at(-0.06, yb + 0.002, 0.07));
    this.eye.add(litMesh(eb, mat, { cast: false, receive: false }));
    this.funnel.add(this.eye);
    this.funnel.position.set(HOLE.x, GROUND_Y - 0.1, HOLE.z);
    this.funnel.visible = false;
    this.root.add(this.funnel);

    // ---- the towers and their clouds
    const wallFace: Face = {
      cell: A.paint(24, 8, (p) => {
        p.fill('#363e54'); p.rect(0, 7, 24, 1, '#4a5470');
        for (let x = 1; x < 24; x += 3) p.rect(x, 2, 2, 3, x % 2 ? '#ffd878' : '#232a3c', x % 2 ? 2.6 : 0);
      }),
      map: 'fit',
    };
    const roofFace: Face = { cell: A.solid('#4e5874') };
    const wireFace: Face = { cell: A.solid('#d8862a', 0.5) };
    const cloudFace: Face = { cell: A.paint(8, 8, (p) => { p.fill('#f2f4fa'); p.speckle('#dfe4f0', 0.3, 5); }) };
    const cr = mulberry32(0xc10);
    const q0 = new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), YAW);
    for (const z of ZONES) {
      const h = FLOOR_H - 0.1;
      const sg = new Builder();
      sg.box(z.w, h, z.d, { px: wallFace, nx: wallFace, pz: wallFace, nz: wallFace, py: roofFace, ny: roofFace }, at(0, -h / 2, 0));
      const solidGeo = sg.geometry();
      // the steel frame of a floor: a column at each corner and in the middle of each long side, and a ring of beams at the top and the bottom
      const wg = new Builder();
      const T = 0.35;
      for (const y of [-h, -T]) {
        wg.box(z.w, T, T, allFaces(wireFace), at(0, y, -z.d / 2));
        wg.box(z.w, T, T, allFaces(wireFace), at(0, y, z.d / 2));
        wg.box(T, T, z.d, allFaces(wireFace), at(-z.w / 2, y, 0));
        wg.box(T, T, z.d, allFaces(wireFace), at(z.w / 2, y, 0));
      }
      for (const x of [-z.w / 2, 0, z.w / 2]) for (const zz of [-z.d / 2, z.d / 2]) wg.box(T, h, T, allFaces(wireFace), at(x, -h, zz));
      const wireGeo = wg.geometry();
      const floors: { solid: THREE.Mesh; wire: THREE.Mesh; y: number; start: number }[] = [];
      const d = Math.hypot(z.x - HOLE.x, z.z - HOLE.z), reach = Math.max(2, d - Math.min(z.w, z.d) / 2 - 3);
      for (let f = 0; f < z.floors; f++) {
        const solid = litMesh(solidGeo, mat), wire = litMesh(wireGeo, mat, { cast: false, receive: false });
        const y = GROUND_Y + f * FLOOR_H + FLOOR_H / 2;
        for (const m of [solid, wire]) { m.position.set(z.x, y, z.z); m.quaternion.copy(q0); this.root.add(m); }
        // the top floor is built first: floor f takes onset n - 1 - f (after the zone's lag)
        const k = z.floors - 1 - f + z.lag;
        floors.push({ solid, wire, y, start: floorTimes[Math.min(floorTimes.length - 1, k)]! + 0.05 * z.lag });
        this.bodies.push({ mesh: solid, half: [z.w / 2, h / 2, z.d / 2], p: v3(z.x, y, z.z), q: q0.clone(), d, reach });
      }
      const site = new ConstructionSite(A, mat, { x: z.x, z: z.z, ground: GROUND_Y, w: z.w, d: z.d, yaw: YAW, floorH: FLOOR_H, deckY: DECK_Y, starts: floors.map((fl) => fl.start) });
      this.root.add(site.root);
      this.towers.push({ floors, site });
      // the cloud of the zone: four slabs. Each is a piece of its own: they let go one after the other
      const tr = this.reachTime(reach);
      for (let i = 0; i < 4; i++) {
        const w = z.w * (0.8 + cr() * 0.7), dd = z.d * (0.8 + cr() * 0.7), hh = 1.6 + cr() * 1.4;
        const ox = (cr() - 0.5) * z.w, oy = cr() * 1.5, oz = (cr() - 0.5) * z.d;
        const cb = new Builder();
        cb.box(w, hh, dd, allFaces(cloudFace), at(0, -hh / 2, 0));
        const piece = litMesh(cb, mat, { cast: false });
        this.root.add(piece);
        this.clouds.push({ mesh: piece, x: z.x + ox, y: GROUND_Y + DECK_Y + oy + hh / 2, z: z.z + oz, tr: tr + 0.14 * i, spin: cr() - 0.5 });
      }
    }

    // ---- trees and sheds on the pit ground: they go in too
    const rnd = mulberry32(0x917);
    const bark: Face = { cell: A.solid('#4a3626') };
    const leaf: Face = { cell: A.paint(8, 8, (p) => { p.fill('#346830'); p.speckle('#447c3c', 0.3, 4); }) };
    const shedWall: Face = { cell: A.paint(8, 8, (p) => { p.fill('#d8cdb0'); p.rect(0, 7, 8, 1, '#a89c84'); }) }, shedRoof: Face = { cell: A.solid('#8a3a34') };
    // none in another: each keeps the round of its footprint (a shed with its eaves 3.3 m, a tree its crown) and 0.5 m of air
    const taken: { x: number; z: number; r: number }[] = [];
    for (let n = 0, placed = 0; n < 600 && placed < 34; n++) {
      const x = PIT.x + (rnd() - 0.5) * 2 * (PIT.half - 4), z = PIT.z + (rnd() - 0.5) * 2 * (PIT.half - 4);
      const s = 0.9 + rnd() * 0.6, shed = rnd() < 0.22, turn = rnd() * 6;
      if (Math.abs(Math.hypot(x, z + 100) - 100) < 9) continue;
      if (ZONES.some((q) => Math.abs(x - q.x) < q.w / 2 + 5 && Math.abs(z - q.z) < q.d / 2 + 5)) continue;
      const d = Math.hypot(x - HOLE.x, z - HOLE.z);
      if (d > 40) continue;
      const r = shed ? 3.3 : 1.5 * s;
      if (taken.some((p) => Math.hypot(x - p.x, z - p.z) < r + p.r + 0.5)) continue;
      taken.push({ x, z, r });
      placed++;
      const b = new Builder();
      const hh = shed ? 1.9 : 2.6 * s, hw = shed ? 2.2 : 0.9 * s;
      if (shed) {
        b.box(4.4, 3, 3.6, { px: shedWall, nx: shedWall, pz: shedWall, nz: shedWall }, at(0, -hh, 0));
        b.extrude([[-2.5, 3 - hh], [2.5, 3 - hh], [0, 4.4 - hh]], 4, shedRoof, shedRoof);
      } else {
        b.cylinder(0.2 * s, 0.16 * s, 1.6 * s, 5, bark, null, at(0, -hh, 0));
        b.cylinder(1.5 * s, 0, 4.2 * s, 6, leaf, null, at(0, -hh + 1.0 * s, 0));
      }
      const mesh = litMesh(b, mat);
      const q = new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), turn);
      mesh.position.set(x, GROUND_Y + hh, z);
      mesh.quaternion.copy(q);
      this.root.add(mesh);
      this.bodies.push({ mesh, half: [hw, hh, shed ? 1.8 : hw], p: mesh.position.clone(), q, d, reach: Math.max(1, d - 1) });
    }
  }

  private tileAt(i: number, j: number): [number, number] {
    return [PIT.x - PIT.half + (i + 0.5) * TILE, PIT.z - PIT.half + (j + 0.5) * TILE];
  }

  /** The radius of the hole at time t: it opens on the first syllable of line 12 and grows a step on each one, then once more as the train runs for the tunnel. */
  radius(t: number): number {
    const s = this.steps;
    if (t < s[0]!) return 0;
    let r = 10 * easeOut3((t - s[0]!) / 0.25);
    for (let k = 1; k < s.length; k++) r += 2.3 * easeOut3((t - s[k]!) / 0.22);
    return r + 7 * smooth((t - (s[s.length - 1]! + 0.3)) / 1.2);
  }

  /** The time at which the rim reaches the distance `d` from the middle (or a time that never comes). */
  private reachTime(d: number): number {
    const t0 = this.steps[0]!;
    for (let t = t0; t < this.end - 0.4; t += FR / 2) if (this.radius(t) >= d) return t;
    return 1e9;
  }

  /** Bakes the fall of the towers, the trees and the sheds. A body stands until the rim reaches it; then it tips toward the middle and falls, and the bodies hit each other. */
  async bake() {
    const t0 = this.steps[0]!;
    const specs: BodySpec[] = this.bodies.map((b, i) => {
      const wake = this.reachTime(b.reach) + 0.02 * (i % 5);
      const dx = HOLE.x - b.p.x, dz = HOLE.z - b.p.z, n = Math.hypot(dx, dz) || 1;
      return {
        shape: { kind: 'box', half: b.half }, pose: { p: [b.p.x, b.p.y, b.p.z], q: [b.q.x, b.q.y, b.q.z, b.q.w] }, wakeAt: wake,
        // toward the middle, and a spin that tips the top that way
        vel: [(dx / n) * 5, -1, (dz / n) * 5], spin: [(dz / n) * 0.9, 0, (-dx / n) * 0.9],
        density: 300, friction: 0.6, restitution: 0.1, gravityScale: G / 9.81,
      } satisfies BodySpec;
    });
    this.baked = await bake({ t0, t1: this.end, hz: 60, gravity: [0, -9.81, 0], bodies: specs });
  }

  /** Poses the zones and the hole at time t. `look`: the ground point (x, z) that the bottom of the pit turns to (the train). */
  pose(t: number, look: { x: number; z: number }) {
    const T12 = this.steps[0]!, R = this.radius(t);
    // before the hole opens every body stands at rest (a frame depends only on t: an earlier frame can have left a body in its fall)
    if (t < T12) this.bodies.forEach((b, i) => {
      // the build: the body comes up out of the ground and grows to its full height, with a little overshoot
      const u = (t - this.riseAt - (i % 8) * (SPB / 2) - Math.floor(i / 8) * (SPB / 8)) / BUILD;
      const grow = u >= 1 ? 1 : Math.max(0, easeOutBack(u));
      b.mesh.position.copy(b.p);
      b.mesh.position.y -= b.half[1] * (1 - Math.min(1, grow));
      b.mesh.quaternion.copy(b.q);
      b.mesh.scale.set(0.6 + 0.4 * Math.min(1, grow), Math.max(1e-3, grow), 0.6 + 0.4 * Math.min(1, grow));
      b.mesh.visible = u > 0;
    });
    // the towers build down from the clouds, the top floor first: the steel frame slides into place, then the walls close from the top down
    for (const tw of this.towers) {
      tw.site.pose(t, T12);
      for (const fl of tw.floors) {
        const age = t - fl.start;
        const built = age >= 0;
        fl.wire.visible = built && age < WALLS[1] && t < T12;
        fl.solid.visible = t >= T12 || age >= WALLS[0];
        if (t < T12) {
          fl.wire.position.y = fl.y + (1 - easeOut3(age / FRAME_IN)) * FLOOR_H;
          fl.solid.scale.y = Math.max(1e-3, easeOut3((age - WALLS[0]) / (WALLS[1] - WALLS[0])));
        } else fl.solid.scale.y = 1;
      }
    }
    // from the first syllable of line 12 the bodies follow the bake
    if (t >= T12 && this.baked) {
      this.bodies.forEach((b, i) => {
        this.baked!.pose(i, Math.min(t, this.baked!.t1), this.bp, this.bq);
        b.mesh.position.copy(this.bp);
        b.mesh.quaternion.copy(this.bq);
        b.mesh.scale.setScalar(1);
        // below the bottom of the pit it is gone
        b.mesh.visible = this.bp.y > GROUND_Y - DEPTH * R - 2;
      });
    }
    // a cloud stands from a little before the first floor of its zone. When the rim is under it, its pieces let go one after the other: each falls
    // as a thing with weight (slowly at first, then fast), turns over, gets thin and goes toward the middle of the hole
    const first = this.floorTimes[0]!;
    for (const c of this.clouds) {
      const tau = Math.max(0, t - c.tr), pull = 1 - Math.exp(-1.4 * tau);
      c.mesh.position.set(c.x + (HOLE.x - c.x) * 0.8 * pull, c.y - 0.5 * G * tau * tau, c.z + (HOLE.z - c.z) * 0.8 * pull);
      c.mesh.rotation.set(2.2 * c.spin * tau, 0, 1.6 * pull * (c.spin > 0 ? 1 : -1));
      c.mesh.visible = t >= first - 0.45 && c.mesh.position.y > GROUND_Y - DEPTH * R - 6;
      c.mesh.scale.setScalar(t < first ? Math.max(0.01, easeOut3((t - (first - 0.45)) / 0.3)) : 1 - 0.65 * smooth(tau / 0.9));
    }
    // the tiles: one that the rim has reached tips toward the middle and drops
    const o = this.o;
    for (let j = 0; j < TILES; j++) for (let i = 0; i < TILES; i++) {
      const [x, z] = this.tileAt(i, j), tau = t - this.tileFall[j * TILES + i]!;
      if (tau <= 0) {
        o.position.set(x, GROUND_Y, z);
        o.rotation.set(0, 0, 0);
        o.scale.setScalar(1);
      } else {
        const dx = HOLE.x - x, dz = HOLE.z - z, n = Math.hypot(dx, dz) || 1;
        const tip = Math.min(1.3, 2.4 * tau);
        o.position.set(x + (dx / n) * 6 * tau * tau, GROUND_Y - 0.5 * G * tau * tau, z + (dz / n) * 6 * tau * tau);
        o.rotation.set((dz / n) * tip, 0, (-dx / n) * tip);
        o.scale.setScalar(o.position.y < GROUND_Y - DEPTH * R - 1 ? 0 : 1);
      }
      o.updateMatrix();
      this.tiles.setMatrixAt(j * TILES + i, o.matrix);
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    // the pit
    this.funnel.visible = R > 0.5;
    if (R > 0.5) {
      this.funnel.scale.set(R + TILE * 0.7, R * DEPTH / 0.82, R + TILE * 0.7);
      const dx = look.x - HOLE.x, dz = look.z - HOLE.z, n = Math.hypot(dx, dz) || 1;
      // the middle looks at the train: it goes a little off centre toward it, on 12s (it does not glide)
      const tq = Math.floor(t * 12) / 12;
      const k = 0.1 * smooth((tq - T12) / 0.8);
      this.eye.position.set((dx / n) * k, 0, (dz / n) * k);
      // the lid: the bottom closes to a slit once, and opens again
      const tb = this.steps[Math.min(5, this.steps.length - 1)]! + 0.14;
      this.eye.scale.z = 1 - 0.94 * Math.max(0, 1 - Math.abs(t - tb) / 0.14);
      // the terraces turn against each other, slowly, on 12s
      this.terraces.forEach((g, s) => { g.rotation.y = (s % 2 ? 1 : -1) * (0.12 + 0.05 * s) * (tq - T12); });
      // the eyes in the walls: each opens on its syllable, as a lid does, and its middle goes to the side on which the train is
      const toTrain = Math.atan2(dz, dx);
      for (const e of this.wallEyes) {
        const open = easeOut3((t - e.at) / (3 * FR));
        e.root.visible = open > 0;
        e.root.scale.set(1, Math.max(0.01, open), 1);
        e.pupil.position.x = 0.02 * Math.sin(toTrain - (e.a - this.terraces[e.terrace]!.rotation.y));
      }
    }
  }

  dispose() {
    this.tiles.geometry.dispose();
  }
}
