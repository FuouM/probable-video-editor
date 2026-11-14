// Chorus 1, second half (clip chorus_1b, 42.667-56.889 s, bars 25-32; treatment v8 "Plate 4"). The scene stands in the one game world
// (`_gameWorld.ts`), at Station ？ and on the ground that the game zones (`_pit.ts`).
//
//   41.6    the fall        `day.ts` shows this scene from the moment the sardine drops through the duckboard: a camera goes down with it
//                           out of the day sky over Station ？. The whole loop lies below. The slat chunks fall round it.
//   42.667  [STATION: ？]   The fixed platform camera, on the downbeat: the sardine lands on the near part of the platform with a splash,
//                           large in the frame. The flap row under the station board carries line 9; the flaps turn blank when the line
//                           has ended. The train comes in past the camera and stops. The sardine boards.
//   45.778  Line 10         The props near the train go missing by themselves, one for each syllable: each swaps to the checkerboard. The
//                           player did not do it. The cursor jumps back at the first one, then it runs from one to the next and clicks each
//                           twice to put it back: nothing comes back (`ERR  ASSET GONE`). One tooltip follows the cursor and fills through the
//                           whole line. The board becomes `？？？`. `[FISH CAM]` shows the sardine in the car, at the window.
//   49.778  Line 11         The window closes. The map goes out in one smooth move to the zone ground and the train. The game zones by itself:
//                           towers build down from the clouds, one floor for each onset. The news ticker carries the line. The train runs
//                           round the zones. The cursor pokes at a tower: it has no owner.
//   52.889  Line 12         The player takes the clear tool and clicks the ground. A sinkhole opens and grows on each syllable. The ground
//                           tiles, the towers, the trees and the clouds go in. The tooltip follows the cursor; its letters fall into the hole,
//                           and each tears its piece of the tooltip out with it. The day goes dark. From 54.5 the map goes in on the train,
//                           which runs for the tunnel. The pieces of the track that the train has passed break off right behind it, one on
//                           each hit of the drum fill.
//   56.000  Bridge seam     The train reaches the tunnel. Control flips here: `bridge.ts` renders [56.0, 56.889) via `ctx.renderClip('bridge')`.
//
// Carriers (treatment "Lyric carriers"): line 9 the flap board, line 10 one tooltip at the cursor, line 11 the news ticker, line 12 the
// tooltip of the clear tool, whose letters fall into the hole. English via `subtitle`, called last. Every frame is a pure function of t.
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import type { Line } from '@pve/engine/lyrics';
import { clamp01, lerp, mulberry32, projectToRect, smooth, hashSin } from '@pve/engine/util';
import { setMissing } from '@pve/engine/gl';
import { NO_FILM_POST } from '@pve/engine/post';
import { FALL_CUT } from './day';
import { Builder, allFaces, at, camera, enableShadows, instanced, litMesh, v3 } from '@pve/engine/lit';
import { LitView, type Sky } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { BAR, FR } from './_time';
import { lineAt, loadFonts, type Fonts } from './_fonts';
import { PaintedText, drawNewsTicker } from './_captionCarriers';
import { subtitle } from './_subtitle';
import { Fish, SwimPath } from './_fish';
import { carriedPass, type Ticket } from './_ticket';
import { centreOf, clickAt, toolButton, winButtons, type PlayerInput, type PlayerState, type Rect, type Vec2, type WinSpec, type WinState } from './_playerTypes';
import { PlayerTrack } from './_playerTrack';
import { chromeText, chromeWidth } from './_playerChrome';
import { fishCamWindow } from './_playerWindows';
import { PlayerRig } from './_playerRig';
import { FishCam, FixedCam, MAP_PPM, MapCam } from './_playerCams';
import { GameWorld, LOOPED } from './_gameWorld';
import { STATIONS, TUNNEL, carMatrix, carPose } from './_route';
import { HOLE, Pit, ZONES } from './_pit';
import { speckled } from './_paint';

const T_START = 24 * BAR;
/** The sardine lands on the downbeat. The fixed platform camera takes over 4 frames before. */
const T_LAND = T_START, T_FIXED = T_LAND - 4 * FR;
const T_BRIDGE = 56.0;
/** The train: it comes in from 60 m back and stops (T_STOP); the doors; it leaves (T_DEP) and reaches the tunnel on T_BRIDGE. */
const T_IN0 = 42.2, T_STOP = 44.3, T_DEP = 49.2;
/** The middle of the front car when the train stands at the platform (m along the platform from its middle), and the run-in. */
const CAR_X = -12, RUN_IN = 60;
const S_STOP = STATIONS.q.s + CAR_X;
/** The sardine goes in through the front door (car x 5.4) at T_DOOR. */
const T_DOOR = 45.3;
/** The fall from the sky: its strength (m/s^2). */
const G_FALL = 60;
/** Where the sardine lands, in the frame of the station (x along the platform, z across it). */
const LAND = v3(-11.6, 1.25, 3.5);

const CONTENT: Rect = [0, 10, 640, 340];
const TICKER_RECT: Rect = [0, 24, 640, 22];
/** The zoom notches of the map of this scene: the whole loop, the zone ground, the station. */
const NOTCHES = [MAP_PPM / 6, 3.3, MAP_PPM] as const;
const ZONE_VIEW: Vec2 = [34, -146];

const DAY: Sky = { zenith: '#2f6fd0', horizon: '#a8cbee', ground: '#7a9a50' };
const MAP_DAY = { zenith: '#547844', horizon: '#6e9258', ground: '#4a6a3a' };
const MAP_DARK = { zenith: '#06060e', horizon: '#121024', ground: '#06060c' };

/** The route position of the middle of the front car at song time t. */
function trainS(t: number): number {
  if (t < T_DEP) {
    const u = clamp01((t - T_IN0) / (T_STOP - T_IN0));
    return S_STOP - RUN_IN * (1 - u) * (1 - u);
  }
  // it leaves and gains speed all the way: the front of the car is in the tunnel mouth on T_BRIDGE
  const a = (2 * (TUNNEL.s0 - 6 - S_STOP)) / (T_BRIDGE - T_DEP) ** 2;
  return S_STOP + 0.5 * a * (t - T_DEP) ** 2;
}

/** A note of the MIDI file: its track and its start (s). */
interface MidiNote { track: number; start: number }

/** The times of the 18 floors of the towers: one floor for each onset of line 11 (lead, bass and arp). */
function towerFloors(notes: readonly MidiNote[]): number[] {
  const onsets = new Set<number>();
  for (const n of notes) if ((n.track === 6 || n.track === 14 || n.track === 5) && n.start >= 49.77 && n.start <= 52.68) onsets.add(Math.round(n.start * 1000) / 1000);
  const sorted = [...onsets].sort((a, b) => a - b);
  const FLOORS = 18;
  return Array.from({ length: FLOORS }, (_, i) => sorted[Math.min(sorted.length - 1, Math.floor((i * sorted.length) / FLOORS))] ?? 49.8 + i * 0.16);
}

export default class Night extends Scene {
  private world!: GameWorld;
  private pit!: Pit;
  private view = new LitView();
  private text = new TextLayer();
  private fonts!: Fonts;
  private lines: Line[] = [];
  private rig!: PlayerRig;
  private units10: number[] = [];
  private units11: number[] = [];
  private units12: number[] = [];
  /** The time from which `day.ts` shows this scene (the sardine has dropped through the duckboard). */
  private tFall = 41.6;

  // ---- Station ？
  /** The frame of the station: x along the platform in the direction of travel, z across it (the platform side). */
  private st = new THREE.Matrix4();
  private stInv = new THREE.Matrix4();
  private fish!: Fish;
  private pass!: Ticket;
  private platPath!: SwimPath;
  private carPath!: SwimPath;
  private slatChunks: { mesh: THREE.Mesh; dx: number; dz: number; dy: number; vx: number; vz: number; delay: number; rx: number; rz: number }[] = [];
  private splashDrops!: THREE.InstancedMesh;
  private wearTargets: THREE.Object3D[] = [];
  private swapAt: number[] = [];
  private boardName = '？';
  private flap!: PaintedText;
  private stCam = camera(40, 0.1, 3000);
  private stFixed!: FixedCam;
  private fishCam!: FishCam;
  private clickAt10: Vec2[] = [];
  private clickTimes10: number[] = [];

  // ---- the map
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1);
  private mapCam!: MapCam;
  private sky: Sky = { ...MAP_DAY };
  private o = new THREE.Object3D();
  /** The pieces of the loop track that the hole takes: the time at which each breaks off (a time that never comes for the others), and how deep each is now. */
  private railBreak: number[] = [];
  private railDepth: number[] = [];

  override async init() {
    enableShadows(this.ctx.renderer);
    this.fonts = await loadFonts(this.ctx.assets);
    await this.ctx.ensureClip('bridge');
    const warmRt = new THREE.WebGLRenderTarget(64, 36);
    this.ctx.renderClip('bridge', 56.0, warmRt);
    warmRt.dispose();
    const all = this.ctx.lyrics.lines;
    this.lines = all.slice(9, 13);
    const u8 = all[8]!.written!.units;
    this.tFall = u8[u8.length - 1]!.start + FALL_CUT;
    [this.units10, this.units11, this.units12] = this.lines.slice(1).map((l) => l.written!.units.map((u) => u.start)) as [number[], number[], number[]];

    const midi = (await (await fetch(`${this.ctx.assets}midi.json`)).json()) as { notes: MidiNote[] };
    this.world = new GameWorld(this.fonts);
    this.world.setLamps(false);
    this.world.pose(LOOPED);
    for (const c of this.world.cars) c.setInterior(0.2);
    // the train has one car until the bridge: the interlude reads the second one in as a bad copy
    this.world.cars[1].root.visible = false;
    this.pit = new Pit(this.world, towerFloors(midi.notes), this.units12);
    await this.pit.bake();
    this.railBreak = this.railBreaks(midi.notes);
    this.railDepth = this.railBreak.map(() => 0);
    this.buildStation();
    this.buildPlayer();
    const r = this.ctx.renderer;
    r.compile(this.world.scene, this.stCam);
    r.compile(this.world.scene, this.ortho);
    this.mapCam.apply(this.ortho, 51);
    this.world.light('map', 'day', v3(ZONE_VIEW[0], 0, ZONE_VIEW[1]));
    this.view.render(r, this.world.scene, this.ortho, this.sky);
  }

  /**
   * The track breaks behind the train: a piece goes when the ground 22 m ahead of the rim has reached it and the car is 44 m past it. In the drum
   * fill of bar 32 (the bongo, the woodblock and the snare) a piece goes on the next hit: the track breaks off in steps. The time for each piece of
   * the loop (1e9: it does not break).
   */
  private railBreaks(notes: readonly MidiNote[]): number[] {
    const T12 = this.units12[0]!;
    const hits = [...new Set(notes.filter((n) => (n.track === 15 || n.track === 16 || n.track === 18) && n.start >= 54.4 && n.start <= T_BRIDGE).map((n) => Math.round(n.start * 1000) / 1000))].sort((a, b) => a - b);
    return this.world.loopPieces().map((p) => {
      const r = Math.hypot(p.x - HOLE.x, p.z - HOLE.z);
      for (let t = T12; t < T_BRIDGE; t += FR / 2) {
        if (this.pit.radius(t) + 22 < r || trainS(t) - 44 < p.s) continue;
        const hit = hits.find((h) => h >= t - 1e-3);
        return hit === undefined || t < hits[0]! - 0.2 ? t : hit;
      }
      return 1e9;
    });
  }

  /** A point of the station's frame in the world. */
  private toWorld(x: number, y: number, z: number): THREE.Vector3 {
    return v3(x, y, z).applyMatrix4(this.st);
  }

  // ---------------------------------------------------------------- Station ？ (the fall, lines 9-10)

  private buildStation() {
    const W = this.world;
    const station = W.stations.q;
    station.root.updateMatrixWorld(true);
    this.st.copy(station.root.matrixWorld);
    this.stInv.copy(this.st).invert();
    // the fixed camera of the platform: at its near end, looking along it. The board across the platform and its flap row stand in its foreground.
    const pos = this.toWorld(-15.5, 2.0, 2.6), target = this.toWorld(6, 1.6, 2.8);
    this.stFixed = new FixedCam({ pos: [pos.x, pos.y, pos.z], target: [target.x, target.y, target.z], fov: 46, near: 0.1, far: 3000 });
    this.buildFlaps(station.root, station.boardAcrossX);
    // 10 station props + 7 trees = 17 things that swap to the checkerboard on the 17 syllables of line 10
    this.wearTargets = [...station.props, ...this.buildWearTrees(station.root)];
    if (this.wearTargets.length !== this.units10.length) throw new Error(`night: ${this.wearTargets.length} wear targets for ${this.units10.length} syllables of line 10`);
    this.buildFish();
    this.buildChunks(station.root);
    // white drops when the sardine lands
    const dropB = new Builder();
    dropB.box(0.14, 0.14, 0.14, allFaces({ cell: W.atlas.solid('#e8f8ff', 2.2) }));
    this.splashDrops = instanced(dropB.geometry(), W.mat, 24);
    this.splashDrops.castShadow = false;
    station.root.add(this.splashDrops);
  }

  /**
   * Line 9: a row of split flaps hangs under the board across the platform (at `boardX`), one flap for each unit; each turns to its kana on its
   * start. When the line has ended the flaps turn blank.
   */
  private buildFlaps(local: THREE.Object3D, boardX: number) {
    const W = this.world;
    const FW = 3.3, BODY = 0.42, X = boardX - 0.06, Z = 3.75, Y = 2.8 - 0.04 - BODY / 2;
    const hb = new Builder();
    hb.box(0.08, BODY + 0.06, FW + 0.06, allFaces({ cell: W.atlas.solid('#06070a') }), at(X + 0.05, Y - BODY / 2 - 0.03, Z));
    local.add(litMesh(hb, W.mat));
    this.flap = new PaintedText(this.fonts, this.lines[0]!, {
      px: [236, 24], size: [FW - 0.08, BODY - 0.04], layout: { n: 1, gap: 1 }, motion: 'flip',
      ground: '#2a2d3a', ink: '#f6efdc', edge: '#2a2d3a', outer: '#2a2d3a', emit: 1.15, hold: 0.25,
    });
    this.flap.mesh.position.set(X - 0.005, Y, Z);
    this.flap.mesh.rotation.y = -Math.PI / 2;
    local.add(this.flap.mesh);
  }

  /** The 7 trees round Station ？ that go missing with its props. */
  private buildWearTrees(local: THREE.Object3D): THREE.Mesh[] {
    const A = this.world.atlas;
    const rnd = mulberry32(0x7e);
    const bark = { cell: A.solid('#4a3626') };
    const fol = { cell: speckled(A, 8, 8, '#3a6a30', [['#2c5626', 0.3, 7], ['#4f8240', 0.2, 8]]) };
    const trees: THREE.Mesh[] = [];
    for (const [x, z] of [[-6, 9.5], [6, 10], [18, 9.5], [27, 9], [-4, -9], [8, -10], [22, -9]] as const) {
      const tb = new Builder();
      const sz = 0.9 + rnd() * 0.4;
      tb.cylinder(0.16 * sz, 0.12 * sz, 1.8 * sz, 5, bark, null);
      tb.cylinder(1.3 * sz, 0, 6 * sz, 6, fol, null, at(0, 1.3 * sz, 0));
      const tree = litMesh(tb, this.world.mat);
      tree.position.set(x, -0.5, z);
      local.add(tree);
      trees.push(tree);
    }
    return trees;
  }

  /** The sardine with its punched commuter pass, its paths and its cam. It is posed in the world: on the platform in the station's frame, in the car in the car's frame. */
  private buildFish() {
    const W = this.world;
    this.fish = new Fish(W.atlas, W.mat, 1.45);
    this.pass = carriedPass(this.fonts, true, 1);
    this.fish.hold(this.pass.root);
    W.scene.add(this.fish.root);
    const k = (t: number, x: number, y: number, z: number, o: { stop?: boolean; face?: number } = {}) => ({ t, p: [x, y, z] as [number, number, number], ...o });
    // on the platform: up from the landing with its flank to the camera (it looks at the track), a slow drift along the platform while the train comes in, the door
    this.platPath = new SwimPath([
      k(T_LAND, LAND.x, LAND.y, LAND.z), k(43.2, LAND.x + 0.2, 1.7, LAND.z, { stop: true, face: Math.PI / 2 }),
      k(T_STOP, -9.6, 1.8, 3.0, { stop: true, face: Math.PI / 2 }), k(T_DOOR, CAR_X + 5.4, 2.05, 1.25),
    ]);
    // in the car (the car's frame): in through the door, down the aisle a little, to the window on the platform side
    this.carPath = new SwimPath([
      k(T_DOOR, 5.4, 2.05, 1.25), k(45.6, 5.25, 2.05, 0.35), k(46.25, 3.7, 2.35, 0.8, { stop: true, face: -0.9 }),
    ]);
    this.fishCam = new FishCam({ pose: (t) => carMatrix(trainS(t)), fish: (t) => { const p = this.fishInCar(t); return [p.x, p.y, p.z]; }, window: 1, fov: 44 });
  }

  /** The chunks of the duckboard: they fall round the sardine and bounce on the platform. */
  private buildChunks(local: THREE.Object3D) {
    const A = this.world.atlas;
    const wood = { cell: speckled(A, 8, 8, '#7a5834', [['#4a3620', 0.3, 9]], (p) => p.rect(0, 2, 8, 2, '#181410')) };
    const sr = mulberry32(0x426);
    for (let i = 0; i < 11; i++) {
      const cb = new Builder();
      cb.box(0.42 + sr() * 0.35, 0.06, 0.18 + sr() * 0.1, allFaces(wood), at(0, -0.03, 0));
      const mesh = litMesh(cb, this.world.mat);
      this.slatChunks.push({ mesh, dx: (sr() - 0.5) * 3.2, dz: (sr() - 0.5) * 1.8, dy: (sr() - 0.3) * 3.5, vx: (sr() - 0.5) * 2.2, vz: (sr() - 0.5) * 1.6, delay: i * 0.022, rx: (sr() - 0.5) * 9, rz: (sr() - 0.5) * 9 });
      local.add(mesh);
    }
  }

  /** The sardine in the frame of the station at time t (before it goes into the car). */
  private fishOnPlatform(t: number): { p: THREE.Vector3; v: THREE.Vector3; turn: number } {
    if (t >= T_LAND) return this.platPath.at(t);
    const dt = T_LAND - t;
    return { p: v3(LAND.x, LAND.y + 0.5 * G_FALL * dt * dt, LAND.z), v: v3(0.2, -G_FALL * dt - 0.5, 0), turn: 0 };
  }

  /** The sardine in the frame of the front car at time t. */
  private fishInCar(t: number): THREE.Vector3 {
    if (t >= T_DOOR) return this.carPath.at(t).p;
    return this.fishOnPlatform(t).p.applyMatrix4(this.st).applyMatrix4(carMatrix(trainS(t)).invert());
  }

  private poseStation(t: number) {
    const W = this.world;
    W.placeTrain(trainS(t), true);
    const doorOpen = smooth((t - T_STOP) / 0.45) * (1 - smooth((t - (T_DEP - 0.5)) / 0.3));
    for (const c of W.cars) c.setDoors('left', doorOpen);
    this.poseFish(t);
    this.poseChunks(t);
    this.poseSplash(t);
    // the missing texture on the 17 syllables of line 10: a hard swap in one frame. The game does it by itself
    this.wearTargets.forEach((obj, i) => setMissing(obj, t >= this.swapAt[i]!));
    const name = t >= this.units10[15]! ? '？？？' : '？';
    if (name !== this.boardName) { this.boardName = name; W.stations.q.setName(name); }
    this.flap.update(t);
  }

  /** The sardine: the fall, the landing with a bounce, the wait, the door; then it rides in the car. */
  private poseFish(t: number) {
    const inCar = t >= T_DOOR;
    const frame = inCar ? carMatrix(trainS(t)) : this.st;
    const { p, v, turn } = inCar ? this.carPath.at(t) : this.fishOnPlatform(t);
    const pw = p.clone().applyMatrix4(frame), vw = v.clone().transformDirection(frame).multiplyScalar(v.length());
    this.fish.pose(t, pw, vw, turn);
    if (t < T_LAND) this.fish.root.rotation.z = -1.15;
    else if (t < T_LAND + 0.28) {
      const b = 1 - (t - T_LAND) / 0.28;
      this.fish.root.position.y += 0.35 * Math.sin((1 - b) * Math.PI) * b;
      this.fish.root.rotation.x += 0.5 * Math.sin(t * 32) * b;
    }
  }

  /**
   * The chunks: in the air they keep their places round the sardine and fall with it; each lands `delay` after it. Its height over the platform
   * goes to 0 on its own landing (the spread `dy` closes in the last 0.4 s), and the bounce starts from the spin it had in the air: no jump.
   */
  private poseChunks(t: number) {
    const wrap = (a: number) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
    for (const c of this.slatChunks) {
      const tau = t - T_LAND - c.delay;
      c.mesh.visible = tau < 2.2;
      if (!c.mesh.visible) continue;
      const spin = (at: number): [number, number, number] => [at * c.rx * 0.6, at * 3, at * c.rz * 0.6];
      if (tau < 0) {
        const s = -tau;
        c.mesh.position.set(LAND.x + c.dx, 0.94 + 0.5 * G_FALL * s * s + Math.max(0, c.dy) * Math.min(1, s / 0.4), LAND.z + c.dz);
        c.mesh.rotation.set(...spin(t));
      } else {
        const bounce = Math.max(0, 1 - tau / 0.55);
        const slide = Math.min(0.65, tau);
        c.mesh.position.set(LAND.x + c.dx + c.vx * slide, 0.94 + Math.abs(Math.sin(tau * 14)) * 0.48 * bounce * bounce, LAND.z + c.dz + c.vz * slide);
        // from the spin at the landing to lying flat with its own heading
        const [ax, ay, az] = spin(T_LAND + c.delay), flatY = c.rx * 0.4;
        c.mesh.rotation.set(wrap(ax) * bounce, flatY + wrap(ay - flatY) * bounce, wrap(az) * bounce);
      }
    }
  }

  /** The splash of the landing: 24 white drops. */
  private poseSplash(t: number) {
    const o = this.o, dt = t - T_LAND, live = dt >= 0 && dt < 0.42;
    for (let i = 0; i < 24; i++) {
      if (!live) o.scale.setScalar(0);
      else {
        const a = (i / 24) * Math.PI * 2 + hashSin(i, 3) * 0.3, sp = 1.6 + hashSin(i, 7) * 2.8, vy = 3.2 + hashSin(i, 11) * 2.6;
        const y = 0.95 + vy * dt - 9.8 * dt * dt;
        o.position.set(LAND.x + Math.cos(a) * sp * dt, Math.max(0.92, y), LAND.z + Math.sin(a) * sp * dt);
        o.rotation.set(dt * 8, i, dt * 6);
        o.scale.setScalar(y > 0.92 ? (1 - dt / 0.42) * 1.1 : 0);
      }
      o.updateMatrix();
      this.splashDrops.setMatrixAt(i, o.matrix);
    }
    this.splashDrops.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- the player

  /** A world point on the screen of the maximized station window. */
  private projSt(p: THREE.Vector3): Vec2 {
    this.stFixed.apply(this.stCam, 0);
    this.stCam.aspect = CONTENT[2] / CONTENT[3];
    this.stCam.updateProjectionMatrix();
    this.stCam.updateMatrixWorld();
    const q = p.clone().project(this.stCam);
    return projectToRect(q, [0, CONTENT[1], CONTENT[2], CONTENT[3]]);
  }

  private buildPlayer() {
    const T10 = this.units10[0]!, T11 = this.units11[0]!, T12 = this.units12[0]!;
    this.planLine10();
    const inputs = this.stationInputs();
    const mapOpts = { center: [70, -168] as Vec2, zoom: 2, notches: NOTCHES, follow: (t: number) => { const c = carPose(trainS(t)); return v3(c.x, 0, c.z); }, lag: 0.25 };
    // the map inputs aim at places on the map: they are found on the map camera of the inputs before them
    this.mapCam = new MapCam(new PlayerTrack(inputs, { cursor: [320, 120], speed: 'play' }), mapOpts);
    inputs.push(...this.mapInputs());
    const track = new PlayerTrack(inputs, { cursor: [320, 120], speed: 'play' });
    this.mapCam = new MapCam(track, mapOpts);
    this.rig = new PlayerRig({
      track, fonts: this.fonts, tools: true,
      ticker: (t) => (t < T10 ? 'STN ？  OK' : t < T11 ? 'ERR  ASSET GONE' : t < T12 - 0.5 ? 'AUTO-ZONE  ON' : `TOOL: CLEAR  R=${Math.round(this.pit.radius(t))}m`),
      counter: (t) => `MISSING ${this.units10.filter((s) => s <= t).length}`,
    });
  }

  /**
   * Line 10: four props that the camera has near and in the frame go missing on the first unit of each quarter of the line. The cursor runs to
   * each, from the left to the right, and clicks it twice a third of a second after it has gone. It sets `swapAt`, `clickTimes10` and `clickAt10`.
   */
  private planLine10() {
    const parts = [0, 5, 9, 13];
    this.world.stations.q.root.updateMatrixWorld(true);
    const onScreen = this.wearTargets.map((obj, i) => {
      const c = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
      return { i, at: this.projSt(c), d: c.distanceTo(this.toWorld(-15.5, 2, 2.6)) };
    }).filter(({ at: [x, y] }) => x > 200 && x < 616 && y > 40 && y < 300);
    const picks = onScreen.sort((a, b) => a.d - b.d).slice(0, parts.length).sort((a, b) => a.at[0] - b.at[0]);
    if (picks.length < parts.length) throw new Error(`night: ${picks.length} props on screen for the ${parts.length} clicks of line 10`);
    this.swapAt = this.units10.slice();
    parts.forEach((k, n) => {
      const j = picks[n]!.i, at = this.units10[k]!;
      // the prop of the cursor takes the time of its quarter; the prop that had that time takes the other's time
      [this.swapAt[k], this.swapAt[j]] = [this.swapAt[j]!, at];
      this.clickTimes10.push(at + (n === 0 ? 0.5 : 0.36));
      this.clickAt10.push(picks[n]!.at);
    });
  }

  /** Lines 9 and 10 in the station window and the fish cam, then the close of the windows and the move of the map to the zone ground (line 11). */
  private stationInputs(): PlayerInput[] {
    const T10 = this.units10[0]!, T11 = this.units11[0]!, T12 = this.units12[0]!;
    const stWin: WinSpec = {
      id: 'st', title: '[STATION: ？]', rect: [60, 40, 520, 280], body: { kind: 'view' },
      status: (t) => (t >= T10 ? `ERR  ASSET GONE  ${this.units10.filter((s) => s <= t).length}` : `STN ？  ${t < T_STOP ? 'ARRIVING' : 'DWELL'}`),
    };
    const fishWin = fishCamWindow({ rect: [8, 24, 176, 112], clock: 23 * 3600 });
    const units10 = this.lines[1]!.written!.units;
    const tip10 = { text: units10.map((u) => u.glyph).join(''), times: units10.flatMap((u) => [...u.glyph].map(() => u.start)) };
    const land = this.projSt(this.toWorld(LAND.x, LAND.y + 0.4, LAND.z)), door = this.projSt(this.toWorld(CAR_X + 5.4, 2.0, 1.3));
    return [
      { at: -1, kind: 'open', win: stWin, maximized: true },
      // line 9: the cursor finds the sardine where it landed, then it goes to the door of the train with it
      { at: 43.15, kind: 'move', to: land, dur: 0.45 },
      { at: 43.15, kind: 'tip', text: 'OBJ 001  SARDINE' },
      { at: 44.1, kind: 'tip', text: null },
      { at: 45.0, kind: 'move', to: door, dur: 0.7 },
      // line 10: the game loses its props. The cursor jumps back, then it goes after them. One tooltip for the whole line, at the cursor.
      // [FISH CAM]: the sardine at the car window.
      { at: T10 - 0.12, kind: 'open', win: fishWin, origin: [320, 180] },
      { at: T10, kind: 'tip', text: tip10.text, times: tip10.times },
      { at: T10 + 0.2, kind: 'move', to: [door[0] - 16, door[1] + 12], dur: 0.07 },
      ...this.clickTimes10.flatMap((at, n): PlayerInput[] => [...clickAt(at, this.clickAt10[n]!, { dur: 0.26 }), { at: at + 0.14, kind: 'click' }]),
      { at: this.lines[1]!.end + 0.05, kind: 'tip', text: null },
      // line 11: the windows close, and the map goes out in one move to the zone ground. The game zones by itself
      ...clickAt(T11 - 0.04, centreOf(winButtons([0, 0, 640, 360], true).close), { dur: 0.3 }),
      { at: T11, kind: 'close', id: 'st' },
      { at: T11, kind: 'close', id: 'fishcam' },
      { at: T11, kind: 'zoom', notch: 1, dur: 0.7 },
      { at: T11, kind: 'look', to: ZONE_VIEW, dur: 0.7 },
      { at: T11 + 0.9, kind: 'move', to: [470, 250], dur: 0.5 },
      // line 12: the clear tool, a click on the ground between the towers
      ...clickAt(T12 - 0.5, centreOf(toolButton('disaster')), { dur: 0.4 }),
      { at: T12 - 0.5, kind: 'tool', tool: 'disaster' },
    ];
  }

  /** The cursor on the map (lines 11 and 12): it pokes a tower, clicks the hole, backs off; then the map follows the train into the tunnel. */
  private mapInputs(): PlayerInput[] {
    const T11 = this.units11[0]!, T12 = this.units12[0]!;
    const hole = (): Vec2 => { const p = this.mapCam.project(v3(HOLE.x, 0, HOLE.z), T12); return [Math.round(p[0]), Math.round(p[1])]; };
    const tower = (k: number, t: number): Vec2 => { const z = ZONES[k]!, p = this.mapCam.project(v3(z.x, 14, z.z), t); return [Math.round(p[0]), Math.round(p[1])]; };
    return [
      // line 11: the cursor pokes at the towers that build by themselves: they have no owner
      { at: T11 + 1.45, kind: 'move', to: tower(0, T11 + 1.45), dur: 0.45 },
      { at: T11 + 1.45, kind: 'tip', text: 'ZONE 01  AUTO  NO OWNER' },
      { at: T11 + 1.78, kind: 'click' },
      { at: T11 + 2.3, kind: 'tip', text: null },
      ...clickAt(T12, hole(), { dur: 0.35 }),
      // the hand backs off as the ground goes
      { at: this.units12[3]!, kind: 'move', to: [hole()[0] + 120, hole()[1] + 70], dur: 0.6 },
      // the train runs for the tunnel: the map locks to it and goes in on it, into the mouth of the tunnel
      { at: 54.2, kind: 'follow', on: true },
      { at: 54.5, kind: 'zoom', notch: 2, dur: 1.4 },
    ];
  }

  // ---------------------------------------------------------------- frame

  private renderWin(win: WinState, v: LitView, t: number) {
    const r = this.ctx.renderer, W = this.world, cam = this.stCam;
    this.poseStation(t);
    // the fish cam and the station views share this camera: the fish cam leaves its own planes on it
    cam.near = 0.1;
    cam.far = 3000;
    if (win.id === 'fishcam') this.fishCam.apply(cam, t);
    else if (t < T_FIXED) {
      // the fall: the camera goes down with the sardine. On the cut from `day.ts` it has the place of CAM 02 seen from the fish (behind it,
      // high, a little to its left, a long lens: at the cut CAM 02 is 1.56 m back, 3.13 m up and 0.37 m left of it and looks at a point
      // 0.93 m over it, scaled to this larger fish), so the sardine does not change on the cut. In 0.9 s it swings to the view behind and
      // above it that looks past it at the station below.
      const p = this.fishOnPlatform(t).p, k = smooth((t - this.tFall) / 0.9), S = 1.45;
      cam.fov = lerp(34, 58, k);
      cam.position.copy(this.toWorld(p.x + lerp(-1.56 * S, -2.0, k), p.y + lerp(3.13 * S, 1.5, k), p.z + lerp(-0.37 * S, 1.5, k)));
      cam.lookAt(this.toWorld(p.x + lerp(-0.16 * S, 0.9, k), p.y + lerp(0.93 * S, -2.0, k), p.z + lerp(0, -0.25, k)));
    } else {
      this.stFixed.apply(cam, t);
      // the camera shakes when the sardine lands
      const dt = t - T_LAND;
      if (dt >= 0 && dt < 0.35) cam.position.y += 0.18 * Math.exp(-12 * dt) * Math.sin(55 * dt);
    }
    cam.aspect = this.rig.aspect(win);
    cam.updateProjectionMatrix();
    // the station views stand close to the platform: a shadow map of 56 m, not 180 m, so that the shadow of the train has a clean edge
    W.light('close', 'day', this.fish.root.position, 0, win.id === 'fishcam' ? 90 : 28);
    v.render(r, W.scene, cam, DAY);
  }

  /**
   * Line 12: the tooltip of the clear tool, at the cursor. Each unit prints on its start. Two syllables later the hole takes it: the letter tears its
   * piece of the tooltip out, as from a sheet of paper, and the piece goes down to the hole on the map in a spiral, smaller as it goes. The box
   * that is left has a torn edge, and it is gone when the last letter has gone.
   */
  private drawClearTip(l: TextLayer, s: PlayerState, t: number) {
    const u = this.lines[3]!.written!.units, n = u.length, T12 = this.units12[0]!;
    if (t < T12) return;
    const pullAt = (i: number) => (i + 2 < n ? this.units12[i + 2]! + 0.05 : this.units12[n - 1]! + 0.25 * (i + 3 - n));
    const FLY = 0.6, PAPER = '#f8ecb0';
    const hole = this.mapCam.project(v3(HOLE.x, -this.pit.radius(t) * 0.5, HOLE.z), t);
    const x0 = Math.round(s.cursor.x) + 12, y0 = Math.round(s.cursor.y) + 20;
    const xs: number[] = [], ws: number[] = [];
    let x = x0 + 5;
    for (const g of u) { const w = chromeWidth(this.fonts, g.glyph, 1, this.fonts.kana); xs.push(x); ws.push(w); x += w; }
    const first = u.findIndex((_, i) => t < pullAt(i));
    if (first >= 0) {
      const bx = xs[first]! - (first > 0 ? 0 : 5), bw = x + 5 - bx;
      l.rect(bx - 1, y0 - 1, bw + 2, 26, '#14141a');
      l.rect(bx, y0, bw, 24, PAPER);
      // the torn edge where the letters before have gone: teeth of paper, two rows each
      if (first > 0) for (let row = 0; row < 24; row += 2) { const d = Math.round(4 * hashSin(first, row)); l.rect(bx - d - 1, y0 + row, d + 1, 2, row % 4 ? PAPER : '#e4d696'); }
    }
    u.forEach((g, i) => {
      if (t < this.units12[i]!) return;
      const k = (t - pullAt(i)) / FLY;
      if (k >= 1) return;
      if (k <= 0) { chromeText(l, this.fonts, g.glyph, xs[i]!, y0 + 17, '#14141a', null, { wide: this.fonts.kana }); return; }
      // the piece: it leaves its place slowly and falls faster, on a spiral that closes on the hole
      const e = k * k, w = ws[i]!, turn = 22 * k * (1 - k);
      const cx = Math.round(lerp(xs[i]! + w / 2, hole[0], e) + turn * Math.sin(9 * k + 2.1 * i));
      const cy = Math.round(lerp(y0 + 12, hole[1], e) + 0.5 * turn * Math.cos(9 * k + 2.1 * i));
      const sc = 1 - 0.6 * e, pw = Math.max(3, Math.round((w + 2) * sc)), ph = Math.max(4, 2 * Math.round(12 * sc));
      for (let row = 0; row < ph; row += 2) {
        const a = Math.round(3 * hashSin(i, row)), b = Math.round(3 * hashSin(i + 40, row));
        l.rect(cx - (pw >> 1) - a, cy - (ph >> 1) + row, pw + a + b, 2, row % 4 ? PAPER : '#e4d696');
      }
      if (k < 0.55) chromeText(l, this.fonts, g.glyph, cx - (w >> 1), cy + 6, '#ff8a2a', '#14141a', { wide: this.fonts.kana });
    });
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    const t = f.t;
    if (t >= T_BRIDGE) {
      // From 56.000 the bridge scene draws everything: the dark of the tunnel, then the headlights.
      if (!this.ctx.renderClip('bridge', t, out)) throw new Error('night: the bridge clip is not loaded');
      return NO_FILM_POST;
    }
    const st = this.rig.state(t);
    const T12 = this.units12[0]!;
    const train = carPose(trainS(t));
    this.pit.pose(t, train);
    for (let k = 0; k < this.railBreak.length; k++) { const a = t - this.railBreak[k]!; this.railDepth[k] = a > 0 ? 0.6 * a + 11 * a * a : 0; }
    this.world.sinkLoop(this.railDepth);
    if (!st.maximized) {
      const W = this.world;
      this.poseStation(t);
      this.mapCam.apply(this.ortho, t);
      // the day goes dark as the hole grows
      const dark = smooth((t - T12) / 2.4);
      const mix = (a: string, b: string) => `#${new THREE.Color(a).lerp(new THREE.Color(b), dark).getHexString()}`;
      this.sky.zenith = mix(MAP_DAY.zenith, MAP_DARK.zenith);
      this.sky.horizon = mix(MAP_DAY.horizon, MAP_DARK.horizon);
      this.sky.ground = mix(MAP_DAY.ground, MAP_DARK.ground);
      W.light('map', 'day', this.mapCam.view(t).center, 0.6 * dark);
      this.view.render(r, W.scene, this.ortho, this.sky);
    }
    this.rig.compose(r, this.view, st, (win, v) => this.renderWin(win, v, t));

    this.text.clear();
    const line = t < this.tFall ? null : lineAt(this.lines, t);
    this.rig.draw(this.text, st, (l, s) => {
      if (s.maximized) return;
      const l11 = this.lines[2]!;
      if (t >= l11.written!.units[0]!.start && t < T12 - 0.5) drawNewsTicker(l, this.fonts, l11, t, { rect: TICKER_RECT });
      this.drawClearTip(l, s, t);
    });
    if (line) subtitle(this.text, this.fonts, line, t);
    this.text.commit();
    this.view.present(r, out, { exposure: 1.05, bloom: 0.35, top: this.rig.top }, this.text);
    return NO_FILM_POST;
  }

  override dispose() {
    this.view.dispose();
    this.text.dispose();
    this.rig.dispose();
    this.flap.dispose();
    this.pit.dispose();
    this.world.dispose();
  }
}
