// The map editor of the interlude and the Möbius loop of verse 2 and chorus 2 (treatment "Interlude").
//
// Three parts:
//  - Loop: a closed track about 120 m round (an oval with two straights; a tunnel through a ridge at u = 0) with
//    frames (position, tangent, side, up) along it. With `twist` = 1 the up vector turns half a turn over one lap
//    and the track rises on trestles, so a strip swept along it closes on itself with one side: a Möbius strip.
//    The strip carries track on both faces. The seam of the strip lies inside the tunnel.
//  - Editor: the loop as a RollerCoaster-Tycoon-like map seen through an orthographic 2:1 camera (grass, trees,
//    fields, paths, 8 copies of one small station), the 2D tool palette on a TextLayer, a bad read (`scramble`) and
//    the settling of the rails into the Möbius strip (`settleMobius`).
//  - drawUi: the palette, status text, RETRY counter, REREADING bars, ERR tags on world positions and the cursor.
//
// Every state is a pure function of the arguments of the setters: no state carries from frame to frame.
import * as THREE from 'three';
import { clamp01, mulberry32, smoothstep } from '@pve/engine/util';
import { Builder, LH, LW, LitAtlas, allFaces, at, litMaterial, litMesh, point, v3, type Col, type Face } from '@pve/engine/lit';
import type { TextLayer } from '@pve/engine/textlayer';
import type { Fonts } from './_fonts';
import type { PixelFont } from '@pve/engine/type';
import { Ui } from '@pve/engine/ui';
import { gameIcons } from './_toolIcons';

type V3 = THREE.Vector3;
const Y = new THREE.Vector3(0, 1, 0);
const wrap = (u: number) => ((u % 1) + 1) % 1;

// ================================================================ loop

/**
 * The flat track: a stadium with elliptic ends (two straights of 22 m, two half ellipses 11 m by 13 m), about
 * 120 m round. t = 0 is the middle of the far straight (0, -13) running towards +x. Use getPointAt / getLength for
 * arc length parameters.
 */
export class LoopCurve extends THREE.Curve<V3> {
  /** Half length of a straight, half axes of the ends. */
  static readonly S = 11;
  static readonly RX = 11;
  static readonly RZ = 13;
  private readonly cuts: number[] = [];

  constructor() {
    super();
    this.arcLengthDivisions = 1200;
    const { S, RX, RZ } = LoopCurve;
    const arc = Math.PI * Math.sqrt((RX * RX + RZ * RZ) / 2);
    const parts = [S, arc, 2 * S, arc, S];
    const sum = parts.reduce((a, b) => a + b, 0);
    let c = 0;
    for (const p of parts) { c += p / sum; this.cuts.push(c); }
  }

  override getPoint(t: number, target = new THREE.Vector3()): V3 {
    const { S, RX, RZ } = LoopCurve;
    t = wrap(t);
    let k = 0;
    while (k < 4 && t > this.cuts[k]!) k++;
    const a = k === 0 ? 0 : this.cuts[k - 1]!;
    const f = (t - a) / (this.cuts[k]! - a);
    switch (k) {
      case 0: return target.set(S * f, 0, -RZ);
      case 1: { const p = -Math.PI / 2 + Math.PI * f; return target.set(S + RX * Math.cos(p), 0, RZ * Math.sin(p)); }
      case 2: return target.set(S - 2 * S * f, 0, RZ);
      case 3: { const p = Math.PI / 2 + Math.PI * f; return target.set(-S + RX * Math.cos(p), 0, RZ * Math.sin(p)); }
      default: return target.set(-S + S * f, 0, -RZ);
    }
  }
}

/** A point, the unit tangent, and the side and up vectors (side = tangent x up) of a strip at a place on the loop. */
export interface LoopFrame { p: V3; t: V3; side: V3; up: V3 }

/** The atlas faces of a track. */
interface TrackCells { ballast: Face; rail: Face; sleeper: Face }

/** Colour cells of a track in `atlas`. */
function trackCells(atlas: LitAtlas): TrackCells {
  return {
    ballast: { cell: atlas.paint(16, 16, (p) => { p.fill('#7c776e'); p.speckle('#8c877d', 0.3, 5); p.speckle('#625e57', 0.25, 11); }) },
    rail: { cell: atlas.solid('#aeb4bc') },
    sleeper: { cell: atlas.paint(8, 8, (p) => { p.fill('#5a3d28'); p.rect(0, 3, 8, 1, '#4a3120'); p.speckle('#6a4a30', 0.2, 3); }) },
  };
}

/** The closed loop with its Möbius frames. `u` is the arc length fraction (0..1), `twist` 0 (flat ring) to 1 (Möbius). */
export class Loop {
  readonly curve = new LoopCurve();
  /** Length of the loop in metres. */
  readonly length: number;
  /** The most the track rises on its trestles when twist = 1 (m). */
  static readonly LIFT = 3.4;
  /** Half width of the strip (m). */
  static readonly HALF_W = 1.8;
  /** Half thickness of the strip bed (m). */
  static readonly HALF_T = 0.15;

  constructor() {
    this.length = this.curve.getLength();
  }

  /** Height of the track over the ground at u when twist = 1: 0 in the tunnel, rising on both sides of it. */
  lift(u: number): number {
    const d = Math.min(wrap(u), 1 - wrap(u));
    return Loop.LIFT * smoothstep(0.07, 0.15, d);
  }

  /** The roll of the strip about its tangent at u when twist = 1: half a turn over one lap. */
  roll(u: number): number {
    return Math.PI * u;
  }

  /** The centre of the strip. */
  pointAt(u: number, twist = 0, target = new THREE.Vector3()): V3 {
    this.curve.getPointAt(wrap(u), target);
    target.y = twist === 0 ? 0 : this.lift(u) * twist;
    return target;
  }

  /**
   * The up vector of the strip: the ground normal (tilted with the slope) at twist 0, turned about the tangent by
   * half a turn over one lap times `twist`. `u` goes 0..1 (not wrapped: u = 1 is the far end of the seam).
   */
  upAt(u: number, twist = 0): V3 { return this.frameAt(u, twist).up; }

  frameAt(u: number, twist = 0): LoopFrame {
    const p = this.pointAt(u, twist);
    const d = 1 / 4000;
    const t = this.pointAt(u + d, twist).sub(this.pointAt(u - d, twist)).normalize();
    const s0 = new THREE.Vector3().crossVectors(t, Y).normalize();
    const u0 = new THREE.Vector3().crossVectors(s0, t);
    const th = this.roll(u) * twist;
    const c = Math.cos(th), s = Math.sin(th);
    return {
      p, t,
      side: s0.clone().multiplyScalar(c).addScaledVector(u0, -s),
      up: u0.clone().multiplyScalar(c).addScaledVector(s0, s),
    };
  }

  /**
   * Builds the piece of track between u0 and u1 (bed, 4 rails, sleepers) into `b`, relative to `origin`. Rails and
   * sleepers sit on both faces of the strip, so a twisted strip shows track whichever way it faces.
   */
  strip(b: Builder, c: TrackCells, u0: number, u1: number, twist: number, origin: V3) {
    const n = Math.max(2, Math.ceil(((u1 - u0) * this.length) / 0.6));
    const path: { p: V3; side: V3; up: V3 }[] = [];
    for (let i = 0; i <= n; i++) {
      const f = this.frameAt(u0 + ((u1 - u0) * i) / n, twist);
      path.push({ p: f.p.sub(origin), side: f.side, up: f.up });
    }
    const W = Loop.HALF_W, T = Loop.HALF_T;
    b.sweep(path, [[-W, -T], [-W, T], [W, T], [W, -T], [-W, -T]], c.ballast, false);
    for (const x of [-0.9, 0.9]) {
      b.sweep(path, [[x - 0.07, T], [x - 0.07, T + 0.16], [x + 0.07, T + 0.16], [x + 0.07, T]], c.rail, false);
      b.sweep(path, [[x + 0.07, -T], [x + 0.07, -T - 0.16], [x - 0.07, -T - 0.16], [x - 0.07, -T]], c.rail, false);
    }
    const m = Math.max(1, Math.round(((u1 - u0) * this.length) / 0.75));
    for (let j = 0; j < m; j++) {
      const f = this.frameAt(u0 + ((u1 - u0) * (j + 0.5)) / m, twist);
      const mx = new THREE.Matrix4().makeBasis(f.side, f.up, f.t.clone().negate());
      mx.setPosition(f.p.sub(origin).addScaledVector(f.up, -(T + 0.06)));
      b.box(2.7, 2 * (T + 0.06), 0.2, allFaces(c.sleeper), mx);
    }
  }
}

/** The Möbius centre line as a THREE.Curve (t = arc length fraction), for cameras and trains that follow it. */
export class MobiusCurve extends THREE.Curve<V3> {
  constructor(private loop: Loop, readonly twist = 1) { super(); }
  override getPoint(t: number, target = new THREE.Vector3()): V3 { return this.loop.pointAt(t, this.twist, target); }
}

// ================================================================ motion

/**
 * 0..1 -> 0..1 with weight: a smooth start and stop, a hair of anticipation at the start and a small settle at
 * the end. It is its own mirror, so a piece coming back (k going 1 -> 0) settles the same way.
 */
function settle(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const t = clamp01((x - 0.15) / 0.7);
  const b = t * t * t * (t * (t * 6 - 15) + 10);
  const bump = (v: number) => (v > 0 && v < 1 ? Math.sin(Math.PI * v) ** 2 : 0);
  return b + 0.035 * bump((x - 0.85) / 0.15) - 0.03 * bump(x / 0.15);
}

// ================================================================ editor

/** What the palette shows. A plain object; every field is optional. */
export interface EditorUi {
  /** Draw the top and bottom bars (default true). */
  palette?: boolean;
  /** The text slot in the bottom bar, dry telemetry, for example LINE 01  SEG 1  OK or REREADING SECTOR 33-48. */
  status?: string;
  /** The pressed tool button. */
  tool?: 'shovel' | 'rail' | 'eraser' | 'scissors' | null;
  /** RETRY n/of in yellow at the top left. */
  retry?: { n: number; of: number } | null;
  /** REREADING lines with a progress bar (0..1), drawn at the bottom left over the map. */
  reread?: { text: string; progress: number }[];
  /** Red tags attached to world positions. */
  errs?: { at: V3; text?: string }[];
  /** The cursor at a screen position (logical pixels). `open` 0..1 is the scissors opening. */
  cursor?: { x: number; y: number; kind?: 'arrow' | 'scissors'; open?: number } | null;
}

/** One station of the map: the name on its board (null: no board) and the second board it shows in a bad read (`alt`). */
export interface StationSpec { name: string | null; alt?: string }

export interface EditorOpts {
  /** The stations round the loop. Default: eight with a board each. */
  stations?: StationSpec[];
  /** The three greens of the ground (base, light speckle, dark speckle). */
  grass?: readonly [string, string, string];
}

const DEFAULT_STATIONS: StationSpec[] = ['イワシ', 'ホーム', 'すのこ', 'もと', 'ひなた', 'まち', 'はし', 'つち'].map((name) => ({ name }));
const N_RAIL = 36;
const SPARE_RAIL = 6;

interface Pose { dx: number; dy: number; dz: number; rot: number; tilt: number; delay: number }

interface RailPiece {
  group: THREE.Group; flat: THREE.Mesh; mob: THREE.Mesh | null;
  u0: number; u1: number; um: number; src: number;
  pivotFlat: V3; pivotMob: V3;
}

interface StationObj {
  group: THREE.Group; legs: THREE.Mesh; board: THREE.Group; dupe: THREE.Object3D;
  lamp: THREE.PointLight | null; name: string | null; u: number; baseYaw: number; base: V3; boardLocal: V3;
}

/** The map editor: the loop, 8 stations, the scenery, the bad read and the Möbius strip. */
export class Editor {
  readonly root = new THREE.Group();
  /** The 8 station lamps; their intensity follows `setNight`. */
  readonly lights: THREE.Light[] = [];
  readonly atlas = new LitAtlas();
  readonly mat = litMaterial(this.atlas);
  readonly loop: Loop;
  /** The 2:1 dimetric camera of the map. Perspective cameras of the scene are free to look at `root` as well. */
  readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -300, 600);
  readonly mobiusCurve: MobiusCurve;
  /** Screen pixels per metre of the map camera: 8 sqrt 2. */
  static readonly PPM = 8 * Math.SQRT2;

  private rails: RailPiece[] = [];
  private spareRails: RailPiece[] = [];
  private stations: StationObj[] = [];
  private spareStations: StationObj[] = [];
  private posts: THREE.Group[] = [];
  private postU: number[] = [];
  private poseRail: Pose[] = [];
  private poseSpareRail: Pose[] = [];
  private poseStation: Pose[] = [];
  private poseSpareStation: Pose[] = [];
  private dupeOff: { show: boolean; off: V3 }[] = [];
  private mobDelay: number[] = [];
  private kScr = 0;
  private seed = 0;
  private planned = -1;
  private kMob = 0;
  private night = 0;

  private readonly specs: StationSpec[];
  /** The loop positions of the stations (the stadium keeps the span round u = 0 free for its tunnel). */
  private readonly stationU: number[];

  constructor(private fonts: Fonts, private o: EditorOpts = {}) {
    this.loop = new Loop();
    this.specs = o.stations ?? DEFAULT_STATIONS;
    const n = this.specs.length;
    this.stationU = Array.from({ length: n }, (_, k) => 0.125 + k * 0.107);
    this.mobiusCurve = new MobiusCurve(this.loop);
    this.buildWorld();
    this.buildTrack();
    this.buildStations();
    this.view(new THREE.Vector3(-3, 0, -3), Editor.PPM);
    this.pose();
  }

  // ---------------------------------------------------------------- camera

  /** Aims the isometric camera at `target` with `ppm` screen pixels per metre. The default PPM (8 sqrt 2) makes 1 m along a world axis exactly 8 px across and 4 px down, so 2:1 lines land on whole pixels. */
  view(target: V3, ppm: number) {
    const hw = LW / ppm / 2, hh = LH / ppm / 2;
    this.cam.left = -hw; this.cam.right = hw; this.cam.top = hh; this.cam.bottom = -hh;
    const dir = new THREE.Vector3(Math.cos(Math.PI / 6) * Math.SQRT1_2, Math.sin(Math.PI / 6), Math.cos(Math.PI / 6) * Math.SQRT1_2);
    this.cam.position.copy(target).addScaledVector(dir, 150);
    this.cam.lookAt(target);
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
  }

  /** The screen position (logical pixels, y down) of a world point seen by `cam` (default the map camera). */
  project(world: V3, cam: THREE.Camera = this.cam): { x: number; y: number } {
    cam.updateMatrixWorld();
    const p = world.clone().project(cam);
    return { x: ((p.x + 1) / 2) * LW, y: ((1 - p.y) / 2) * LH };
  }

  /** The world position of the board of station k as it stands now (for ERR tags). */
  stationPosition(k: number, target = new THREE.Vector3()): V3 {
    this.root.updateMatrixWorld(true);
    return this.stations[k]!.group.getWorldPosition(target);
  }

  // ---------------------------------------------------------------- the world

  private addMesh(b: Builder, opts: { cast?: boolean; receive?: boolean } = {}) {
    const m = litMesh(b, this.mat, opts);
    this.root.add(m);
    return m;
  }

  private buildWorld() {
    const A = this.atlas;
    const rnd = mulberry32(4242);
    const [g0, g1, g2] = this.o.grass ?? ['#3f7d34', '#4a8c3c', '#356b2d'];
    const grass: Face = { cell: A.paint(16, 16, (p) => { p.fill(g0); p.speckle(g1, 0.22, 7); p.speckle(g2, 0.2, 9); }) };
    const fieldA: Face = { cell: A.paint(16, 16, (p) => { p.fill('#7da644'); for (let x = 0; x < 16; x += 4) p.rect(x, 0, 1, 16, '#6b9438'); }) };
    const fieldB: Face = { cell: A.paint(16, 16, (p) => { p.fill('#6d9a3a'); for (let x = 0; x < 16; x += 4) p.rect(x, 0, 1, 16, '#5c8630'); }) };
    const dirt: Face = { cell: A.paint(16, 16, (p) => { p.fill('#8a6a44'); p.speckle('#7a5c3a', 0.3, 5); p.speckle('#9a7a52', 0.2, 8); }) };
    const rock: Face = { cell: A.paint(16, 16, (p) => { p.fill('#6c726a'); p.speckle('#7c8278', 0.3, 3); p.speckle('#585e58', 0.25, 12); }) };
    const moss: Face = { cell: A.paint(16, 16, (p) => { p.fill('#4c7440'); p.speckle('#5a8450', 0.3, 4); p.speckle('#3e6234', 0.2, 6); }) };
    const trunk: Face = { cell: A.solid('#5a3e28') };
    const leafA: Face = { cell: A.paint(8, 8, (p) => { p.fill('#2f6a34'); p.speckle('#3b7c3e', 0.3, 2); }) };
    const leafB: Face = { cell: A.paint(8, 8, (p) => { p.fill('#285c2e'); p.speckle('#347040', 0.3, 6); }) };

    const g = new Builder();
    g.box(500, 0.4, 500, { py: grass }, at(0, -0.4, 0));
    // fields inside the loop: 3 x 2 plots (the inner side of the ring is clear of them)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++)
      g.box(6, 0.05, 6, { py: (i + j) % 2 ? fieldA : fieldB }, at(-6.6 + i * 6.6, 0, -1.7 + j * 6.4));
    // dirt paths from three stations to the world
    const path = (pts: [number, number][], w: number) => {
      for (let k = 0; k + 1 < pts.length; k++) {
        const [ax, az] = pts[k]!, [bx, bz] = pts[k + 1]!;
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
        g.box(w, 0.04, L, { py: dirt }, at((ax + bx) / 2, 0.01, (az + bz) / 2, Math.atan2(dx, dz)));
      }
    };
    path([[-16, 16.5], [-20, 21], [-27, 22], [-34, 27]], 1.5);
    path([[16, 17], [20, 22], [27, 22], [32, 30]], 1.5);
    path([[25, -6], [31, -9], [38, -8]], 1.5);
    this.addMesh(g, { cast: false });

    // the ridge with the tunnel along x at z = -13
    const r = new Builder();
    const m = at(0, 0, -LoopCurve.RZ, Math.PI / 2);
    const L = 15;
    const mirror = (pts: [number, number][]) => pts.map(([x, y]) => [-x, y] as [number, number]).reverse();
    const left: [number, number][] = [[-6, 0], [-2.4, 0], [-2.4, 4.6], [-3, 5.6], [-4.8, 6.0], [-6.4, 3.2]];
    r.extrude(left, L, rock, moss, m);
    r.extrude(mirror(left), L, rock, moss, m);
    r.box(6.4, 1, L, { py: moss, ny: rock, px: rock, nx: rock, pz: rock, nz: rock }, at(0, 4.6, -LoopCurve.RZ, Math.PI / 2));
    r.extrude([[-4.8, 6.0], [-3, 5.6], [3, 5.6], [4.8, 6.0], [2, 7.6], [-2.5, 7.9]], L - 5, moss, moss, m);
    r.cylinder(2.2, 0, 3, 5, rock, null, at(-6.5, 0, -LoopCurve.RZ - 3));
    r.cylinder(1.7, 0, 2.2, 5, rock, null, at(6.2, 0, -LoopCurve.RZ + 3.6));
    this.addMesh(r);

    // trees: not on the track, near a station or on the plots or the ridge
    const pts: V3[] = [];
    for (let i = 0; i < 240; i++) pts.push(this.loop.pointAt(i / 240));
    const stationPts = this.stationU.map((u) => this.loop.pointAt(u));
    const tb = new Builder();
    let placed = 0;
    for (let tries = 0; tries < 900 && placed < 52; tries++) {
      const x = (rnd() * 2 - 1) * 46, z = (rnd() * 2 - 1) * 34;
      if (pts.some((p) => Math.hypot(p.x - x, p.z - z) < 6.5)) continue;
      if (stationPts.some((p) => Math.hypot(p.x - x, p.z - z) < 10)) continue;
      if (Math.abs(x) < 11 && z > -6 && z < 9) continue;
      if (Math.abs(x) < 9 && z < -6 && z > -21) continue;
      const s = 0.85 + rnd() * 0.7;
      const mm = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(Y, rnd() * 6), new THREE.Vector3(s, s, s));
      const leaf = rnd() < 0.5 ? leafA : leafB;
      tb.cylinder(0.18, 0.18, 0.9, 5, trunk, null, mm);
      tb.cylinder(1.35, 0, 2.4, 6, leaf, null, mm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.6, 0)));
      tb.cylinder(0.98, 0, 2.0, 6, leaf, null, mm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1.9, 0)));
      placed++;
    }
    this.addMesh(tb);
  }

  private buildTrack() {
    const tc = trackCells(this.atlas);
    for (let i = 0; i < N_RAIL; i++) {
      const u0 = i / N_RAIL, u1 = (i + 1) / N_RAIL, um = (u0 + u1) / 2;
      const pivotFlat = this.loop.pointAt(um, 0);
      const pivotMob = this.loop.pointAt(um, 1);
      const bf = new Builder();
      this.loop.strip(bf, tc, u0, u1, 0, pivotFlat);
      const bm = new Builder();
      this.loop.strip(bm, tc, u0, u1, 1, pivotMob);
      const group = new THREE.Group();
      const flat = litMesh(bf, this.mat);
      const mob = litMesh(bm, this.mat);
      mob.visible = false;
      group.add(flat, mob);
      this.root.add(group);
      this.rails.push({ group, flat, mob, u0, u1, um, src: i, pivotFlat, pivotMob });
      this.mobDelay.push((i * 0.381966) % 1);
      // a post every second piece along the lifted part, beside the strip
    }
    const postGeo = new Builder();
    postGeo.box(0.3, 1, 0.3, allFaces({ cell: this.atlas.solid('#4a4a50') }));
    const armGeo = new Builder();
    armGeo.box(0.4, 0.3, 2.0, allFaces({ cell: this.atlas.solid('#3c3c42') }), at(0, -0.3, 1.0));
    const pg = postGeo.geometry(), ag = armGeo.geometry();
    for (let i = 0; i < N_RAIL; i += 2) {
      const um = this.rails[i]!.um;
      if (this.loop.lift(um) < 1.2) continue;
      if (this.stationU.some((u) => Math.abs(u - um) < 0.035)) continue;
      const group = new THREE.Group();
      const post = new THREE.Mesh(pg, this.mat);
      const arm = new THREE.Mesh(ag, this.mat);
      post.castShadow = post.receiveShadow = arm.castShadow = arm.receiveShadow = true;
      group.add(post, arm);
      group.visible = false;
      this.root.add(group);
      this.posts.push(group);
      this.postU.push(um);
    }
    // spare pieces share the geometry of a piece: the copies of a bad read
    for (let k = 0; k < SPARE_RAIL; k++) {
      const src = this.rails[(k * 7 + 3) % N_RAIL]!;
      const group = new THREE.Group();
      const flat = new THREE.Mesh(src.flat.geometry, this.mat);
      flat.castShadow = flat.receiveShadow = true;
      group.add(flat);
      group.visible = false;
      this.root.add(group);
      this.spareRails.push({ ...src, group, flat, mob: null, src: src.src });
    }
  }

  private makeLabel(name: string): Face {
    const kana = this.fonts.kana;
    return {
      cell: this.atlas.paint(72, 22, (p) => {
        p.fill('#eeeee6', 0.9);
        p.rect(0, 0, 72, 2, '#2c4a8a');
        p.rect(0, 20, 72, 2, '#2c4a8a');
        const w = kana.width(name);
        kana.draw(p.sink({ 1: '#15151c' }), name, Math.round((72 - w) / 2), 17, 1);
      }),
      map: 'fit',
    };
  }

  private buildStations() {
    const A = this.atlas;
    const conc: Face = { cell: A.paint(16, 16, (p) => { p.fill('#9a9a94'); p.speckle('#8a8a84', 0.3, 3); p.rect(0, 0, 16, 1, '#7c7c76'); }) };
    const edge: Face = { cell: A.solid('#e0b020') };
    const navy: Face = { cell: A.solid('#2c3a68') };
    const brick: Face = { cell: A.paint(8, 8, (p) => { p.fill('#8a5a3a'); p.rect(0, 3, 8, 1, '#6e4630'); p.rect(4, 7, 1, 1, '#6e4630'); }) };
    const roof: Face = { cell: A.solid('#6a6e7c') };
    const post: Face = { cell: A.solid('#3a3a42') };
    const win: Face = { cell: A.paint(1, 1, (p) => p.fill('#ffd890', 2.5)) };
    const lampHead: Face = { cell: A.paint(1, 1, (p) => p.fill('#ffdca0', 4)) };
    const boardBack: Face = { cell: A.solid('#d8d8d0') };

    // one halt, copied: the platform on the outer side (local -z), the shelter, the hut, the lamp
    const b = new Builder();
    b.box(9, 0.7, 3, { py: conc, px: conc, nx: conc, pz: conc, nz: conc }, at(0, 0, -3.1));
    b.box(9, 0.02, 0.2, { py: edge }, at(0, 0.7, -1.75));
    for (const x of [-2.7, -0.7]) for (const z of [-3.9, -2.7]) b.box(0.14, 2.3, 0.14, allFaces(post), at(x, 0.7, z));
    b.box(3.2, 0.14, 1.9, allFaces(navy), at(-1.7, 3.0, -3.3));
    b.box(1.8, 0.1, 0.5, allFaces(post), at(-1.7, 1.15, -3.9));
    b.box(2.6, 1.9, 2.0, { px: brick, nx: brick, pz: brick, nz: brick, ny: brick }, at(2.6, 0.7, -4.0));
    b.box(2.9, 0.16, 2.3, allFaces(roof), at(2.6, 2.6, -4.0));
    b.box(0.8, 0.7, 0.04, { pz: win }, at(2.6, 1.3, -2.98));
    b.box(0.1, 2.5, 0.1, allFaces(post), at(4.1, 0.7, -2.3));
    b.box(0.34, 0.22, 0.34, allFaces(lampHead), at(4.1, 3.2, -2.3));
    const bodyGeo = b.geometry();
    const legs = new Builder();
    for (const x of [-3.6, 3.6]) legs.box(0.5, 1, 0.5, allFaces(post), at(x, -1, -3.1));
    const legsGeo = legs.geometry();

    const make = (spec: StationSpec, u: number, real: boolean): StationObj => {
      const f = this.loop.frameAt(u, 0);
      const baseYaw = Math.atan2(-f.t.z, f.t.x);
      const group = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, this.mat);
      body.castShadow = body.receiveShadow = true;
      const legsMesh = new THREE.Mesh(legsGeo, this.mat);
      legsMesh.castShadow = legsMesh.receiveShadow = true;
      legsMesh.visible = false;
      const boardG = new THREE.Group();
      // the board: a white plate on a post; a station with `alt` has a second plate of that name for a bad read
      const plate = (name: string) => {
        const bb = new Builder();
        const label = this.makeLabel(name);
        bb.box(4.5, 1.4, 0.08, { pz: label, nz: label, px: boardBack, nx: boardBack, py: boardBack, ny: boardBack }, at(0, 2.0, 0));
        const m = new THREE.Mesh(bb.geometry(), this.mat);
        m.castShadow = m.receiveShadow = true;
        return m;
      };
      let dupe: THREE.Object3D = new THREE.Object3D();
      if (spec.name !== null) {
        const lb = new Builder();
        lb.box(0.12, 2.0, 0.12, allFaces(post), at(0, 0, 0));
        const stand = new THREE.Mesh(lb.geometry(), this.mat);
        stand.castShadow = true;
        const main = plate(spec.name);
        dupe = spec.alt !== undefined ? plate(spec.alt) : new THREE.Mesh(main.geometry, this.mat);
        dupe.castShadow = dupe.receiveShadow = true;
        dupe.visible = false;
        boardG.add(stand, main, dupe);
      }
      const boardLocal = new THREE.Vector3(-4.6, 0.7, -3.4);
      boardG.position.copy(boardLocal);
      boardG.rotation.y = Math.PI / 4 - baseYaw;
      group.add(body, legsMesh, boardG);
      let lamp: THREE.PointLight | null = null;
      if (real) {
        lamp = point('#ffc070', 0, 14);
        lamp.position.set(4.1, 3.4, -2.6);
        group.add(lamp);
        this.lights.push(lamp);
      }
      const base = f.p.clone();
      group.position.copy(base);
      group.rotation.order = 'YXZ';
      group.rotation.y = baseYaw;
      this.root.add(group);
      return { group, legs: legsMesh, board: boardG, dupe, lamp, name: spec.name, u, baseYaw, base, boardLocal };
    };
    this.specs.forEach((s, k) => this.stations.push(make(s, this.stationU[k]!, true)));
    // two spare stations that peel out of stations 2 and 5 in a bad read
    for (const k of [2, 5]) {
      const s = make({ name: this.specs[k]!.name }, this.stationU[k]!, false);
      s.group.visible = false;
      this.spareStations.push(s);
    }
  }

  // ---------------------------------------------------------------- states

  /** Lamps on (1) or off (0). */
  setNight(n: number) {
    this.night = n;
    for (const l of this.lights) l.intensity = 9 * n;
  }

  /**
   * 0 = the map as it was saved; 1 = a bad read: every station and rail piece displaced, rotated, some doubled or
   * stacked, labels duplicated, a few pieces sunk into the ground or floating. Deterministic per `seed`. The pieces
   * move with weight (a staggered start, a small settle) and come back the same way when k falls.
   */
  scramble(k: number, seed: number) {
    this.kScr = clamp01(k);
    this.seed = seed;
    this.pose();
  }

  /** 0 = flat ring on the ground; 1 = the rail pieces joined into the twisted strip on its trestles. */
  settleMobius(k: number) {
    this.kMob = clamp01(k);
    this.pose();
  }

  private plan() {
    if (this.planned === this.seed) return;
    this.planned = this.seed;
    const rnd = mulberry32(this.seed * 7919 + 13);
    const R = (a: number, b: number) => a + (b - a) * rnd();
    const disc = (r0: number, r1: number): [number, number] => { const a = R(0, Math.PI * 2), r = R(r0, r1); return [Math.cos(a) * r, Math.sin(a) * r]; };
    this.poseRail = []; this.poseSpareRail = []; this.poseStation = []; this.poseSpareStation = []; this.dupeOff = [];
    for (let i = 0; i < N_RAIL; i++) {
      const roll = rnd();
      let p: Pose;
      if (roll < 0.28) p = { dx: 0, dy: 0, dz: 0, rot: R(-0.05, 0.05), tilt: 0, delay: rnd() };
      else {
        const big = roll > 0.8;
        const [dx, dz] = disc(big ? 3 : 0.6, big ? 7 : 3.2);
        p = { dx, dy: 0, dz, rot: big ? R(-1.5, 1.5) : R(-0.6, 0.6), tilt: 0, delay: rnd() };
        const y = rnd();
        if (y < 0.12) { p.dy = -R(0.5, 1.1); p.tilt = R(-0.25, 0.25); }
        else if (y > 0.9) { p.dy = R(0.7, 1.7); p.tilt = R(-0.2, 0.2); }
      }
      this.poseRail.push(p);
    }
    for (let k = 0; k < SPARE_RAIL; k++) {
      const [dx, dz] = disc(0.3, 1.4);
      this.poseSpareRail.push({ dx, dy: R(0.05, 0.3), dz, rot: R(-0.5, 0.5), tilt: 0, delay: rnd() });
    }
    const nSt = this.specs.length;
    for (let i = 0; i < nSt; i++) {
      const [dx, dz] = disc(3, 8.5);
      const p: Pose = { dx, dy: 0, dz, rot: (rnd() < 0.5 ? -1 : 1) * R(0.5, 2.8), tilt: 0, delay: rnd() };
      if (i === (this.seed + 1) % nSt) { p.dy = -0.9; p.tilt = 0.22; }
      if (i === (this.seed + 4) % nSt) { p.dy = 1.5; p.tilt = -0.18; }
      this.poseStation.push(p);
      this.dupeOff.push({ show: this.specs[i]!.alt !== undefined || rnd() < 0.65, off: v3(R(-1.8, 1.8), R(-0.2, 0.9), R(-1.2, 1.2)) });
    }
    for (let k = 0; k < 2; k++) {
      const [dx, dz] = disc(1.2, 3);
      this.poseSpareStation.push({ dx, dy: 0.03, dz, rot: R(-0.8, 0.8), tilt: 0, delay: rnd() });
    }
  }

  private pose() {
    this.plan();
    const ks = this.kScr, km = this.kMob;
    const step = (k: number, d: number) => settle(clamp01((k - d * 0.4) / 0.6));
    const qYaw = new THREE.Quaternion(), qTilt = new THREE.Quaternion(), qRigid = new THREE.Quaternion();
    const mf = new THREE.Matrix4();
    const basisQ = (f: { side: V3; up: V3; t: V3 }, out: THREE.Quaternion) =>
      out.setFromRotationMatrix(mf.makeBasis(f.side, f.up, f.t.clone().negate()));
    const qF = new THREE.Quaternion(), qM = new THREE.Quaternion();

    const place = (r: RailPiece, p: Pose, e: number, gs: number, showMob: boolean) => {
      const pos = new THREE.Vector3();
      qRigid.identity();
      if (showMob) {
        pos.copy(r.pivotMob);
      } else if (e > 0) {
        const f = this.loop.frameAt(r.um, e);
        pos.copy(f.p);
        basisQ(this.loop.frameAt(r.um, 0), qF);
        basisQ(f, qM);
        qRigid.copy(qM).multiply(qF.invert());
      } else pos.copy(r.pivotFlat);
      qYaw.setFromAxisAngle(Y, p.rot * gs);
      qTilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), p.tilt * gs);
      r.group.quaternion.copy(qYaw).multiply(qTilt).multiply(qRigid);
      r.group.position.set(pos.x + p.dx * gs, pos.y + p.dy * gs, pos.z + p.dz * gs);
    };

    for (let i = 0; i < N_RAIL; i++) {
      const r = this.rails[i]!;
      const e = step(km, this.mobDelay[i]!);
      const gs = step(ks, this.poseRail[i]!.delay);
      const showMob = e >= 1;
      r.flat.visible = !showMob;
      r.mob!.visible = showMob;
      place(r, this.poseRail[i]!, e, gs, showMob);
    }
    for (let k = 0; k < SPARE_RAIL; k++) {
      const r = this.spareRails[k]!;
      const gs = step(ks, this.poseSpareRail[k]!.delay);
      r.group.visible = gs > 0.001;
      const srcE = step(km, this.mobDelay[r.src]!);
      place(r, this.poseSpareRail[k]!, srcE, gs, false);
    }
    const poseStation = (s: StationObj, p: Pose, gs: number, e: number, dupeShow: boolean, dupeOff: V3, gd: number) => {
      const lift = this.loop.lift(s.u) * e;
      s.group.position.set(s.base.x + p.dx * gs, s.base.y + lift + p.dy * gs, s.base.z + p.dz * gs);
      s.group.rotation.set(p.tilt * gs, s.baseYaw + p.rot * gs, 0);
      s.board.rotation.y = Math.PI / 4 - s.baseYaw;
      s.legs.visible = lift > 0.05;
      s.legs.scale.set(1, Math.max(lift, 0.001), 1);
      s.dupe.visible = s.name !== null && dupeShow && gd > 0.001;
      s.dupe.position.copy(dupeOff).multiplyScalar(gd).add(v3(0, 0, 0.12));
    };
    for (let i = 0; i < this.specs.length; i++) {
      const gs = step(ks, this.poseStation[i]!.delay);
      const e = step(km, this.mobDelay[(i * 4 + 2) % N_RAIL]!);
      const d = this.dupeOff[i]!;
      poseStation(this.stations[i]!, this.poseStation[i]!, gs, e, d.show, d.off, gs);
    }
    for (let k = 0; k < 2; k++) {
      const s = this.spareStations[k]!;
      const src = k === 0 ? 2 : 5;
      const gs = step(ks, this.poseSpareStation[k]!.delay);
      s.group.visible = gs > 0.001;
      const e = step(km, this.mobDelay[(src * 4 + 2) % N_RAIL]!);
      poseStation(s, this.poseSpareStation[k]!, gs, e, false, v3(0, 0, 0), 0);
    }
    // trestle posts rise with the strip; the arm at the top reaches in over the strip's edge
    for (let i = 0; i < this.posts.length; i++) {
      const um = this.postU[i]!;
      const idx = Math.min(N_RAIL - 1, Math.floor(um * N_RAIL));
      const e = step(km, this.mobDelay[idx]!);
      const f = this.loop.frameAt(um, e);
      const h = this.loop.lift(um) * e - 0.45;
      const g = this.posts[i]!;
      g.visible = h > 0.3;
      g.children[0]!.scale.set(1, Math.max(h, 0.01), 1);
      g.children[1]!.position.y = h;
      const sl = Math.hypot(f.t.x, f.t.z) || 1;
      g.position.set(f.p.x - (-f.t.z / sl) * 3.6, 0, f.p.z - (f.t.x / sl) * 3.6);
      g.rotation.y = Math.atan2(-f.t.z, f.t.x);
    }
    for (const l of this.lights) l.intensity = 9 * this.night;
  }

  // ---------------------------------------------------------------- interface

  /** Draws the palette, texts, tags and the cursor into `layer` (cleared by the caller). */
  drawUi(layer: TextLayer, s: EditorUi) {
    const ui = new Ui(layer, this.fonts.latin);
    if (s.reread) s.reread.forEach((r, k) => rereadBar(ui, r.text, r.progress, 8, LH - 38 - (s.reread!.length - 1 - k) * 16));
    if (s.retry) ui.text(`RETRY ${s.retry.n}/${s.retry.of}`, 8, 34, '#ffd23a', '#201800', 2);
    for (const e of s.errs ?? []) {
      const q = this.project(e.at);
      errTag(ui, Math.round(q.x), Math.round(q.y), e.text ?? 'ERR');
    }
    if (s.palette !== false) editorBars(ui, s.status ?? '', s.tool ?? null);
    if (s.cursor) {
      if (s.cursor.kind === 'scissors') scissorsCursor(ui, s.cursor.x, s.cursor.y, s.cursor.open ?? 0.5);
      else ui.arrow(s.cursor.x, s.cursor.y);
    }
  }

  dispose() {
    this.atlas.tex.dispose();
    this.mat.dispose();
    this.root.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
  }
}

// ================================================================ the 2D palette

/** The top and bottom bars of the editor: toolbar icons, the v5 tools (`tool` pressed) and the status slot. */
function editorBars(ui: Ui, status: string, tool: 'shovel' | 'rail' | 'eraser' | 'scissors' | null) {
  const I = gameIcons(ui);
  ui.rect(0, 0, LW, 22, '#5d5a78');
  ui.rect(0, 21, LW, 1, '#2e2c40');
  ui.rect(0, 0, LW, 1, '#9896b6');
  [I.film, I.grid, I.home, I.disc, I.window, I.plus, I.map].forEach((ic, k) => ui.button(4 + k * 22, 2, 'up', ic));
  ui.key(LW - 24, 2, 20, 18);
  ui.rect(LW - 23, 3, 18, 16, '#c0342c');
  I.close(LW - 14, 11);
  const y = LH - 22;
  ui.rect(0, y, LW, 22, '#5d5a78');
  ui.rect(0, y, LW, 1, '#9896b6');
  ui.rect(0, LH - 1, LW, 1, '#2e2c40');
  ui.button(4, y + 2, 'up', I.menu);
  ui.button(26, y + 2, tool === 'shovel' ? 'on' : 'up', I.shovel);
  ui.button(48, y + 2, tool === 'rail' ? 'on' : 'up', I.rail);
  ui.button(70, y + 2, tool === 'eraser' ? 'on' : 'up', I.eraser);
  ui.button(92, y + 2, tool === 'scissors' ? 'on' : 'up', I.scissors);
  ui.rect(120, y + 3, 330, 16, '#4e4c68');
  ui.rect(120, y + 3, 330, 1, '#2e2c40');
  ui.text(status, 126, y + 8, '#ffffff', '#201e2e', 1);
  ui.button(LW - 74, y + 2, 'up', I.rail);
  ui.button(LW - 52, y + 2, 'up', I.grid);
  ui.button(LW - 30, y + 2, 'up', I.record);
}

/** A red ERR tag with its text, centred above (x, y). */
function errTag(ui: Ui, x: number, y: number, s: string) {
  const w = ui.textWidth(s) + 6;
  const x0 = x - Math.floor(w / 2), y0 = y - 14;
  ui.rect(x0 - 1, y0 - 1, w + 2, 12, '#300808');
  ui.rect(x0, y0, w, 10, '#d82828');
  ui.rect(x0, y0, w, 1, '#f06858');
  ui.text(s, x0 + 3, y0 + 1, '#ffffff', '#d82828', 1);
}

/** A REREADING line with its progress bar (0..1) under it. */
function rereadBar(ui: Ui, s: string, progress: number, x: number, y: number) {
  ui.text(s, x, y, '#f4f4f0', '#101010', 1);
  ui.rect(x, y + 10, 150, 5, '#101010');
  ui.rect(x + 1, y + 11, Math.round(148 * clamp01(progress)), 3, '#3cd070');
}

/** The scissors tool as a cursor: red rings at the hand, two blades opened by `open` (0..1), the pivot at (x, y + 14). */
function scissorsCursor(ui: Ui, x: number, y: number, open: number) {
  const px = x, py = y + 14;
  const a = 0.12 + open * 0.42;
  const blade = (sgn: number) => {
    const tx = px + Math.sin(sgn * a) * -22, ty = py - Math.cos(a) * 22;
    const hx = px + Math.sin(sgn * a) * 9, hy = py + Math.cos(a) * 9;
    ui.line(px, py, Math.round(tx), Math.round(ty), '#d8dce4');
    ui.line(px + 1, py, Math.round(tx) + 1, Math.round(ty), '#9aa0aa');
    ui.line(px, py, Math.round(hx), Math.round(hy), '#d8dce4');
    ui.ring(Math.round(hx + Math.sin(sgn * a) * 4), Math.round(hy + Math.cos(a) * 4), 4, '#e03030');
    ui.ring(Math.round(hx + Math.sin(sgn * a) * 4), Math.round(hy + Math.cos(a) * 4), 3, '#b02424');
  };
  blade(1);
  blade(-1);
  ui.l.put(px, py, '#202020');
}

// ================================================================ map markers

/**
 * The train on the map: a small RollerCoaster-Tycoon train icon (an orange body with a roof stripe and windows, a darker
 * nose). Its long axis is local X. `placeTrainMarker` lays that axis along the track tangent.
 */
export function trainMarker(): THREE.Group {
  const g = new THREE.Group();
  const part = (l: number, h: number, d: number, x: number, y: number, c: number, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(l, h, d), new THREE.MeshBasicMaterial({ color: c }));
    m.position.set(x, y, z);
    g.add(m);
  };
  part(4.4, 1.6, 3, -0.8, 0, 0xffa020);
  part(1.6, 1.2, 2.4, 2.2, -0.2, 0x8a3c0c);
  part(3.6, 0.3, 2.2, -0.8, 0.95, 0xffd890);
  for (const z of [-1.53, 1.53]) for (const x of [-2.4, -0.8, 0.8]) part(0.9, 0.5, 0.1, x, 0.2, 0x2a3a5a, z);
  return g;
}

/** Puts a train marker on the loop frame `f`: `lift` m above the track, long axis along the tangent. */
export function placeTrainMarker(m: THREE.Object3D, f: LoopFrame, lift = 0.9) {
  m.position.copy(f.p).addScaledVector(f.up, lift);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.t, f.up, f.side));
}

/**
 * The Sims-style marker over a map object: a green diamond that bobs and spins. Emissive (HDR vertex colours over 1), so it
 * blooms and reads at map zoom. A pure function of t through `pose`.
 */
export class HoverArrow extends THREE.Group {
  /** `height`: the size of the diamond in m. */
  constructor(height = 3) {
    super();
    const geo = new THREE.OctahedronGeometry(1, 0);
    geo.scale(0.5 * height * 0.62, 0.5 * height, 0.5 * height * 0.62);
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k += 3) {
      const top = geo.getAttribute('position').getY(k) + geo.getAttribute('position').getY(k + 1) + geo.getAttribute('position').getY(k + 2) > 0;
      const lit = (k / 3) % 2 === 0 ? 1 : 0.6;
      const v = (top ? 1.7 : 1.0) * lit;
      for (let j = 0; j < 3; j++) colors.set([0.1 * v, 1.0 * v, 0.22 * v], (k + j) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
  }

  /** Puts the arrow `lift` m above `base`, bobbing by 0.35 m at 0.9 Hz and turning 2.4 rad/s at time t. */
  pose(t: number, base: V3, lift = 3) {
    this.position.set(base.x, base.y + lift + 0.35 * Math.sin(t * Math.PI * 2 * 0.9), base.z);
    this.rotation.set(0, t * 2.4, 0);
  }
}

