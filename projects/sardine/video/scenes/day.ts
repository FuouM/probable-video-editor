// Chorus 1, first half (clip chorus_1, 28.444-42.667 s, bars 17-24; treatment v8 "Plate 3").
//
// The game's copy of the player's room at dusk, through two security cams. `[HOUSE]` is maximized, and the player switches its feed with the
// `[CAM 01][CAM 02]` buttons. CAM 01 is a high corner of the room: fixed and wide (the kotatsu, the boxes, the calendar, the clock and the
// sardine are always in it). It only pans and zooms from its place, as a real one does. CAM 02 hangs over the balcony door (the planter, the
// duckboard, the street). CAM 01 never goes: while CAM 02 is the feed, CAM 01 stays on screen in a corner window. The cursor is in the feed
// and acts on the room.
//   28.444  map -> CAM 01   The `[HOUSE]` box grew in `ride.ts` from 28.389. The sardine that the hand let go of comes in through the balcony
//                           door, in the frame. Line 5: it glides to the box `ふく` and tapes it shut, steadily, through the whole line (the
//                           real room has these boxes open). The calendar tears off a page on each beat by itself; the clock jumps on each kick.
//   31.556  CAM 01 -> 02    Line 6: sardines grow tail first from the planter soil, each one on its syllable. The sardine is out on the
//                           balcony and watches. The road markings light with the windows of the houses. The jellyfish floats in front of them.
//   35.556  CAM 02 -> 01    The cursor maximizes the corner window of CAM 01. Line 7: CAM 01 zooms to the kotatsu. The sardine sits in the
//                           player's seat and lays the commuter pass on the table. The punch (its tooltip follows the cursor) makes one hole
//                           for each syllable; the bits of paper fly. The sardine takes the punched pass anyway.
//   38.667  CAM 01 -> 02    Line 8: the delete tool breaks one glyph of the duckboard for each syllable (Rapier chunks). A pair of sandals
//                           and a flower pot stand on the board: each goes down with the slats under it. On the last glyph the sardine is
//                           over the gap and falls with the chunks.
//   T_FALL + 0.38           The sardine has gone down through the hole: from here this scene shows the picture of `night.ts` (the sardine
//                           falls out of the sky over Station ？), through `ctx.renderClip('chorus_1b')`.
// Carriers (treatment "Lyric carriers"): line 5 the calendar header, line 6 the road markings, line 7 the tooltip of the punch, line 8 one
// syllable on each slat. No kana go over the picture.
// The street that the cams see is the street of the one game world (`_gameWorld.ts`): the room kit stands in the place of the player's
// house, and each view draws the world first and the room in front of it (`LitView.renderInFront`). The town of the room kit is off.
// Every frame is a pure function of t.
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import type { Line } from '@pve/engine/lyrics';
import { clamp01, lerp, mulberry32, projectToRect, smooth } from '@pve/engine/util';
import { bake, type Baked, type BodySpec } from '@pve/engine/physics';
import { NO_FILM_POST } from '@pve/engine/post';
import { Builder, LitAtlas, allFaces, at, camera, enableShadows, instanced, litMaterial, litMesh, point, spot, v3 } from '@pve/engine/lit';
import { LitView } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { BAR, SPB, FR } from './_time';
import { lineAt, loadFonts, type Fonts } from './_fonts';
import { PaintedText } from './_captionCarriers';
import { subtitle } from './_subtitle';
import { Jellyfish } from './_jelly';
import { Home } from './_home';
import type { TapeBox } from './_homeBoxes';
import { PadSheets } from './_padSheets';
import { CLOSE_HOUSE, GameWorld, HOUSE, HOUSE_DOOR_Z, HOUSE_FLOOR, LOOPED, STREET } from './_gameWorld';
import { GROUND_Y } from './_station';
import { Fish, Shoal, SwimPath } from './_fish';
import { Duckboard } from './_duckboard';
import { Ticket, carriedPass } from './_ticket';
import { dropPlan } from './ride';
import { FULL, camButtons, centreOf, clickAt, winButtons, type PlayerInput, type Rect, type Vec2, type WinSpec, type WinState } from './_playerTypes';
import { PlayerTrack } from './_playerTrack';
import { PlayerRig } from './_playerRig';
import { FixedCam } from './_playerCams';

/** A sprout starts to come up this long before its syllable, so it is fully out on the syllable. */
const SPROUT_LEAD = 4 * FR;

/** The first downbeat of the chorus. */
const T0 = 16 * BAR;
/** The maximized content rectangle (the picture of a maximized window). */
const CONTENT: Rect = [0, 10, 640, 340];
/** The small windows: the platform (top right) and the feed of CAM 01 while CAM 02 is on (top left). */
const SMALL: Rect = [404, 26, 232, 150];
const CORNER: Rect = [6, 26, 172, 114];

// ---- the sardine in the copy room
/** The sardine sits in the player's seat (the player's eye at the kotatsu was (0.62, 0.95, 0.1)), head up, through line 7. It sits and lays
 * the pass down before line 7 starts, so the pass lies on the kotatsu before the punch comes. */
const SEAT = v3(0.76, 0.54, 0.1);
const T_SIT = 35.45;
/** The taping of the box `ふく`: the flaps fold from T_SHUT, the tape runs from T_TAPE to T_TAPED. */
const T_SHUT = 29.35, T_TAPE = 29.95, T_TAPED = 31.2;
/** CAM 01: bolted in the high corner of the room. It never leaves this place. */
const CAM1_POS: [number, number, number] = [1.72, 2.3, 1.28];
/** CAM 02: bolted to the outside wall over the balcony door. */
const CAM2_POS: [number, number, number] = [0.9, 2.25, -1.45];
/**
 * The song time from which this scene shows the picture of `night.ts` (the fall), counted from the last syllable of line 8: the sardine is
 * seen to drop through the hole in the board and down under the balcony first.
 */
export const FALL_CUT = 0.65;
/** The pass lies flat on the kotatsu top (y 0.45), over the peels; the sardine lays it there at T_SIT and takes it at T_TAKE. It has the size that it has on the fish. */
const PASS_AT = v3(-0.02, 0.459, 0.3);
const PASS_SCALE = Fish.PASS_SCALE;
/** After the last punch of line 7 (く at 38.222): the sardine takes the pass only when every hole is in. */
const T_TAKE = 38.3;

export default class Day extends Scene {
  private A = new LitAtlas(2048);
  private mat = litMaterial(this.A);
  private view = new LitView();
  private text = new TextLayer();
  private fonts!: Fonts;
  private lines: Line[] = [];
  private rig!: PlayerRig;
  private u: number[][] = [];

  // the copy room
  private roomScene = new THREE.Scene();
  private home!: Home;
  /** The game world behind the room, its camera (the camera of the room, put into the world), and the panes that the bass lights in the houses across the street. */
  private world!: GameWorld;
  private worldCam = camera(60, 0.3, 3000);
  private panes!: THREE.InstancedMesh;
  private paneAt: THREE.Matrix4[] = [];
  /** Room to world: the room kit looks out along -z, the house of the world along +z. */
  private readonly toWorld = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(HOUSE.x - 0.75, HOUSE_FLOOR - 0.05, HOUSE_DOOR_Z - 1.35);
  private pads!: PadSheets;
  private tapeBox!: TapeBox;
  private fish!: Fish;
  private fishPath!: SwimPath;
  private shoal!: Shoal;
  private clods!: THREE.InstancedMesh;
  private ticket!: Ticket;
  private carried!: Ticket;
  private punch = new THREE.Group();
  private holes: THREE.Vector3[] = [];
  private punchTimes: number[] = [];
  private breakTimes: number[] = [];
  private cam1!: FixedCam;
  private cam2!: FixedCam;
  private tmpCam = camera(60, 0.05, 400);

  // the carriers of lines 5 and 6, the clock, the town windows, the jellyfish far off
  private header!: PaintedText;
  private road!: PaintedText;
  private clockHand = new THREE.Group();
  private kicks: number[] = [];
  private jelly!: Jellyfish;

  // the duckboard and its chunks
  private duck!: Duckboard;
  private baked!: Baked;
  /** What stands on the duckboard (the sandals, the flower pot): bodies of the same bake, after the pieces of the board. */
  private duckProps: THREE.Mesh[] = [];
  private pP = new THREE.Vector3();
  private pQ = new THREE.Quaternion();

  /** The bits of paper that the punch knocks out of the pass: three for each hole. */
  private chads!: THREE.InstancedMesh;

  override async init() {
    enableShadows(this.ctx.renderer);
    this.fonts = await loadFonts(this.ctx.assets);
    await this.ctx.ensureClip('chorus_1b');
    this.lines = this.ctx.lyrics.lines.slice(5, 9);
    this.u = this.lines.map((l) => l.written!.units.map((x) => x.start));
    const wide = { pos: CAM1_POS, target: [-0.5, 0.75, -0.4] as [number, number, number], fov: 70 };
    // CAM 01: a wide lens in the high corner. For line 7 it pans and zooms to the kotatsu (the seat and the pass); for line 8 it goes wide again.
    this.cam1 = new FixedCam({
      ...wide, near: 0.05, far: 400,
      notches: [
        { at: this.u[2]![0]! + 0.05, pos: CAM1_POS, target: [0.42, 0.5, 0.2], fov: 23 },
        { at: this.u[3]![0]! + 0.1, ...wide },
      ],
    });
    // CAM 02 hangs on the outside wall over the balcony door and looks out and down (a wide security lens): the planter and the sardine in the
    // lower part, clear of the English line, the street below with the road markings of line 6, the houses across it. For line 8 it pans and
    // zooms to the duckboard (the notch is set while CAM 01 is the feed).
    this.cam2 = new FixedCam({
      pos: CAM2_POS, target: [0.9, -6.65, -9.45], fov: 78, near: 0.05, far: 400,
      notches: [{ at: this.u[2]![0]! + 0.6, pos: CAM2_POS, target: [-0.5, 0.05, -1.825], fov: 34 }],
    });
    const midi = (await (await fetch(`${this.ctx.assets}midi.json`)).json()) as { notes: { track: number; start: number; pitch: number }[] };
    const inClip = (n: { start: number }) => n.start >= T0 - 1 && n.start < 42.7;
    this.kicks = midi.notes.filter((n) => n.track === 19 && inClip(n)).map((n) => n.start).sort((a, b) => a - b);
    this.buildRoom();
    this.buildPass();
    await this.buildBalcony();
    this.buildPlayer();
    const r = this.ctx.renderer;
    r.compile(this.roomScene, this.tmpCam);
    r.compile(this.world.scene, this.worldCam);
  }

  // ---------------------------------------------------------------- the copy room

  private buildRoom() {
    this.buildHome();
    this.buildWorld();
    this.addRoomLights();
    this.tapeBox = this.home.makeTapeBox(3);
    this.roomScene.add(this.tapeBox.root);
    this.pads = new PadSheets(this.fonts, this.roomScene, T0);
    this.buildCarriers();
    this.buildPlanterBed();
    this.buildFish();
  }

  /** The room kit at dusk, packed for the move but lived in. */
  private buildHome() {
    this.home = new Home(this.A, this.mat, this.fonts.kana, this.fonts.latin);
    this.home.setHour(18.7);
    // the ceiling lamp is on, dimmed: the shade reads as a lamp and does not bloom into a white blob. The header of line 5 hangs over the
    // balcony door, away from it
    this.home.setLamp(0.35);
    this.home.setLampGlow(1.3);
    this.home.setPacked(0);
    this.home.setCurtains(false);
    this.home.setLaundry(false);
    // the copy room has its boxes taped; the one the sardine tapes starts open
    this.home.setBoxesOpen(false);
    this.home.setBoxMode(1, 'hidden');
    this.home.setPages(24);
    this.home.setTown(false);
    this.roomScene.add(this.home.root);
    this.roomScene.fog = this.home.fog;
  }

  /** The world outside: the loop is joined, the lamps are on, the room kit stands where the house of the world stood. */
  private buildWorld() {
    const W = (this.world = new GameWorld(this.fonts));
    W.pose(LOOPED);
    W.setLamps(true);
    W.playerHouse.visible = false;
    // the train has one car until the bridge: the interlude reads the second one in as a bad copy
    W.cars[1].root.visible = false;
    const pane = new Builder();
    pane.box(1.2 * CLOSE_HOUSE, 1.0 * CLOSE_HOUSE, 0.08, allFaces({ cell: W.atlas.solid('#ffe2a8', 2.2) }));
    // the windows that face the street from its far side, near the house
    const near = W.windows.filter((w) => w.face < 0 && w.z > STREET.z && Math.abs(w.x - HOUSE.x) < 70);
    this.paneAt = near.map((w) => new THREE.Matrix4().makeTranslation(w.x, w.y - 0.5 * CLOSE_HOUSE, w.z - 0.03));
    this.panes = instanced(pane.geometry(), W.mat, Math.max(1, near.length));
    this.panes.count = 0;
    W.scene.add(this.panes);
  }

  /** The low sun through the balcony door, a cool fill over the planter, and a warm balcony soffit light over the duckboard. */
  private addRoomLights() {
    const glow = point('#ff9a5a', 5, 6);
    glow.position.set(0.9, 1.5, -0.9);
    const fill = point('#a8c0ff', 3, 3);
    fill.position.set(0.9, 2.0, -1.9);
    const soffit = point('#ffd8a8', 2.6, 3.4);
    soffit.position.set(-0.5, 1.45, -2.02);
    const below = point('#8aa8e8', 4.5, 5.0);
    below.position.set(-0.6, -0.7, -1.9);
    this.roomScene.add(glow, fill, soffit, below);
  }

  /** The planter bed: one small sardine for each syllable of line 6, and the clods of soil that they throw. */
  private buildPlanterBed() {
    const A = this.A;
    const top = this.home.planter.top;
    this.shoal = new Shoal(A, this.mat, this.u[1]!.length, 3);
    this.shoal.scatter(1.28, 0.1);
    this.shoal.root.position.set(top.x, top.y + 0.01, top.z);
    const soil = { cell: A.solid('#4a2c1c') }, soil2 = { cell: A.solid('#5c3824') };
    const clod = new Builder();
    clod.box(0.03, 0.03, 0.03, { px: soil, nx: soil2, py: soil2, ny: soil, pz: soil, nz: soil2 });
    this.clods = instanced(clod.geometry(), this.mat, this.u[1]!.length * 3);
    this.clods.castShadow = false;
    this.roomScene.add(this.shoal.root, this.clods);
  }

  /**
   * The avatar and its path. The hand let go of it over the balcony: it comes in through the door, glides to the box `ふく` and tapes it (it moves
   * along the seam with the tape). It goes out onto the balcony and watches the planter. It comes back and sits in the player's seat by the pass.
   * It takes the punched pass and swims out over the duckboard. After the last glyph it falls (see `poseFish`). Every leg is a glide at a fish's pace.
   */
  private buildFish() {
    this.fish = new Fish(this.A, this.mat, 1.0);
    this.roomScene.add(this.fish.root);
    const k = (t: number, x: number, y: number, z: number, o: { stop?: boolean; face?: number } = {}) => ({ t, p: [x, y, z] as [number, number, number], ...o });
    this.fishPath = new SwimPath([
      k(28.25, 0.55, 1.6, -1.25), k(28.7, 0.45, 0.95, -0.5),
      k(29.3, -1.0, 0.95, 0.9, { stop: true }), k(T_TAPE, -1.05, 0.95, 0.95, { stop: true }), k(T_TAPED, -1.42, 0.92, 0.62, { stop: true }),
      k(31.75, -0.3, 0.95, -0.2), k(32.3, 0.5, 0.95, -1.1), k(32.6, 0.42, 0.95, -1.55),
      k(33.0, -0.05, 0.95, -1.78, { stop: true, face: 0 }), k(34.5, -0.05, 0.95, -1.78, { stop: true, face: 0 }),
      k(34.85, 0.45, 0.93, -1.55), k(35.15, 0.5, 0.9, -0.9),
      // line 7: it sits in the player's seat, beside the pass
      k(T_SIT, SEAT.x, SEAT.y, SEAT.z, { stop: true }), k(T_TAKE - 0.25, SEAT.x, SEAT.y, SEAT.z, { stop: true }),
      k(T_TAKE + 0.05, 0.1, 0.58, 0.26),
      k(38.7, 0.35, 0.8, -0.5), k(39.1, 0.5, 0.95, -1.2), k(39.5, 0.45, 0.9, -1.58),
      k(40.0, 0.25, 0.86, -1.65), k(40.5, 0.0, 0.82, -1.68), k(40.95, -0.25, 0.81, -1.74),
      k(this.u[3]![8]!, -0.5, 0.8, -1.82),
    ]);
  }

  /**
   * The carriers of lines 5 and 6 and the things that move to the music by themselves:
   * - line 5: the header over the balcony door (the cream sign of the room) lights its syllables one by one, red on cream, the rest dim;
   * - the wall clock: its red second hand jumps a twelfth of a turn on each kick;
   * - line 6: white road markings on the street below the balcony, one stretched glyph per syllable, painted as it is sung. On each beat one
   *   half of the windows of the houses across the street switches on (the halves take turns), and the paint takes their light;
   * - the jellyfish floats in front of those houses, over the road markings.
   */
  private buildCarriers() {
    const Z0 = -1.35, X0 = -1.8;
    // the sign is 1.16 x 0.35 m on a 124 x 40 texel cell: the header paints over it with the same paper
    this.header = new PaintedText(this.fonts, this.lines[0]!, {
      px: [124, 40], size: [1.16, 0.35], layout: { n: 1, rows: [7, 5], y: 17, gap: 2 },
      ground: '#e6dfc8', ghost: '#c4bca4', ink: '#8a1212', edge: '#241010', outer: '#241010', lit: true, hold: 14,
    });
    // over the middle of the balcony door (x 0.1-1.6, top 1.9 m), under the ceiling (2.4 m): the sign of the room kit moves there with it
    this.home.sign.position.x = 0.85;
    this.header.mesh.position.set(0.85, 2.125, Z0 + 0.012);
    this.roomScene.add(this.header.mesh);
    // the second hand: from the middle of the clock face on the left wall
    const hand = new Builder();
    hand.box(0.006, 0.11, 0.008, allFaces({ cell: this.A.solid('#c02020') }), at(0, 0.035, 0));
    this.clockHand.add(litMesh(hand, this.mat, { cast: false }));
    this.clockHand.position.set(X0 + 0.012, 1.78, 0.16);
    this.roomScene.add(this.clockHand);
    // the road markings: a strip on the street of the world below the balcony, 1 m a glyph, stretched 2x across the street as road paint is.
    // It reads from the balcony: left to right toward -x, its top toward +z
    this.road = new PaintedText(this.fonts, this.lines[1]!, {
      px: [256, 22], size: [16, 2.2], layout: { n: 1 }, ink: '#f2f2ea', edge: '#3a3a40', outer: '#3a3a40', emit: 0.85, hold: 12,
    });
    this.road.mesh.rotation.set(-Math.PI / 2, 0, Math.PI);
    this.road.mesh.position.set(HOUSE.x - 0.75 - 2.4, GROUND_Y + 0.09, STREET.z);
    this.world.scene.add(this.road.mesh);
    // the jellyfish floats over the street of the world: the street lamps light it, and its shadow lies on the street and on the markings
    this.jelly = new Jellyfish(this.world.atlas, this.world.mat, { size: 1.7, phase: 0.7 });
    this.world.scene.add(this.jelly.root);
    this.buildStreetLamps();
  }

  /**
   * The lamps of the street below the balcony: three posts on the far kerb. Each lights a pool of the street. The middle one stands behind
   * the place of the jellyfish and casts shadows: the shadow of the jellyfish falls toward the house, on the street and on the road markings.
   */
  private buildStreetLamps() {
    const W = this.world, A = W.atlas;
    const post = allFaces({ cell: A.solid('#2e323a') }), head = allFaces({ cell: A.solid('#ffe2a8', 4) });
    const b = new Builder();
    const zk = STREET.z + STREET.w / 2 + 0.7;
    [-15, -1.4, 13].forEach((dx, k) => {
      const x = HOUSE.x + dx;
      b.box(0.14, 6.2, 0.14, post, at(x, GROUND_Y, zk));
      b.box(0.1, 0.1, 0.7, post, at(x, GROUND_Y + 6.1, zk - 0.35));
      b.box(0.3, 0.1, 0.4, head, at(x, GROUND_Y + 6.0, zk - 0.6));
      const l = spot('#ffc880', k === 1 ? 170 : 90, 20, 0.95, 0.6, k === 1);
      l.position.set(x, GROUND_Y + 5.95, zk - 0.6);
      l.target.position.set(x, GROUND_Y, STREET.z - 1.5);
      // the jellyfish is a glass bell that glows: it lets most of the light through, so its shadow is faint and soft
      if (k === 1) { l.shadow.mapSize.set(512, 512); l.shadow.camera.near = 0.4; l.shadow.camera.far = 14; l.shadow.intensity = 0.3; l.shadow.radius = 4; }
      W.scene.add(l, l.target);
    });
    W.scene.add(litMesh(b, W.mat));
  }

  private poseCarriers(t: number) {
    this.header.update(t);
    // G6: the road paint belongs to line 6 only
    this.road.mesh.visible = t < this.lines[2]!.written!.units[0]!.start;
    this.road.update(t);
    // the hand jumps on each kick and kicks back a little over 4 frames
    let n = 0;
    while (n < this.kicks.length && this.kicks[n]! <= t + 1e-6) n++;
    const age = n > 0 ? t - this.kicks[n - 1]! : 1;
    const recoil = 0.18 * Math.max(0, 1 - age / (4 * FR));
    this.clockHand.rotation.x = -(n * Math.PI) / 6 - recoil;
    // the windows across the street switch on the beat: each beat one half of the panes is on, and the halves take turns. The paint of the
    // road takes the light of the windows: bright on the beat, then it dies down
    const on = t >= this.u[1]![0]! - 0.05, beat = Math.floor(t / SPB + 1e-6);
    let np = 0;
    if (on) this.paneAt.forEach((m, i) => { if (i % 2 === beat % 2) this.panes.setMatrixAt(np++, m); });
    this.panes.count = np;
    this.panes.instanceMatrix.needsUpdate = true;
    const glow = on ? Math.exp(-5 * (t - beat * SPB)) : 0;
    (this.road.mesh.material as THREE.MeshBasicMaterial).color.setScalar(0.55 + 0.9 * glow);
    // the jellyfish drifts along over the far lane of the street, under the middle lamp
    const k = (t - T0) / 14.2;
    this.jelly.drift(t, v3(HOUSE.x + 0.4 - 3.6 * k, GROUND_Y + 3.9 + 0.25 * Math.sin(t * 0.9), STREET.z + 1.4), { v: v3(-0.25, 0, 0), yaw: 0.3 + Math.PI });
  }

  /** Lights, set once: the room under the dusk sun. */
  private poseRoom(t: number) {
    this.pads.pose(t);
    // the box is taped by the sardine: the flaps fold, then the strip of tape runs along the seam
    this.tapeBox.set(smooth((t - T_SHUT) / 0.55), clamp01((t - T_TAPE) / (T_TAPED - T_TAPE)));
    this.poseFish(t);
    this.poseSprouts(t);
    this.posePass(t);
    this.poseCarriers(t);
  }

  private poseFish(t: number) {
    const f = this.fish, T_FALL = this.u[3]![8]!;
    if (t < T_FALL) {
      const { p, v, turn } = this.fishPath.at(t);
      f.pose(t, p, v, turn);
      // in the seat it stands head up, as the player sits: the head comes up over a third of a second, and goes down again when it leaves
      const s = smooth((t - T_SIT) / 0.35) * (1 - smooth((t - (T_TAKE - 0.25)) / 0.25));
      if (s > 0) f.root.rotation.z = lerp(f.root.rotation.z, 1.17, s);
    } else {
      // the fall: a hop off the board, then gravity. The nose goes down in 0.15 s to the dive of `night.ts` (pitch -1.15, no roll), so the
      // sardine has the same pose on both sides of the cut to the sky
      const tau = t - T_FALL, p0 = this.fishPath.at(T_FALL - 1e-3).p;
      // a small hop, nearly straight up: the sardine drops through the middle of the gap (x -0.8 to -0.2), not under the landing beside it
      const v0 = v3(-0.25, 0.6, 0);
      const p = v3(p0.x + v0.x * tau, p0.y + v0.y * tau - 4.905 * tau * tau, p0.z);
      const v = v3(v0.x, v0.y - 9.81 * tau, 0);
      f.pose(t, p, v, 0);
      f.root.rotation.z = lerp(f.root.rotation.z, -1.15, smooth(tau / 0.15));
    }
  }

  /** The soil that each sprout throws and the bed: a pure function of t. */
  private poseSprouts(t: number) {
    const rise = this.u[1]!;
    // a sprout is fully out on its syllable: it starts up 4 frames before it, with a little overshoot after (the eye takes the peak as the hit)
    this.shoal.pose(t, (i) => { const e = (t - rise[i]! + SPROUT_LEAD) / (4 * FR); return e <= 0 ? 0 : e < 1 ? 0.95 * e : 0.85 + 0.1 * Math.exp(-6 * (e - 1) * 4 * FR); });
    const top = this.home.planter.top;
    const o = new THREE.Object3D();
    let n = 0;
    for (let i = 0; i < rise.length; i++) {
      const s = this.shoal.place(i);
      const rnd = mulberry32(0x5011 + i);
      for (let c = 0; c < 3; c++) {
        const u = t - rise[i]! + SPROUT_LEAD;
        const a = rnd() * Math.PI * 2, sp = 0.2 + rnd() * 0.4, vy = 0.7 + rnd() * 0.9;
        const live = u >= 0 && u < 0.7;
        o.position.set(top.x + s.x + Math.cos(a) * sp * 0.3 * u, top.y + 0.04 + vy * u - 4.9 * u * u, top.z + s.z + Math.sin(a) * sp * 0.12 * u);
        o.rotation.set(rnd() * 6 + u * 5, rnd() * 6, u * 3);
        o.scale.setScalar(live ? 0.6 + rnd() * 0.6 : 0);
        o.updateMatrix();
        this.clods.setMatrixAt(n++, o.matrix);
      }
    }
    this.clods.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- the pass and the punch

  private buildPass() {
    const A = this.A, mat = this.mat;
    // the pass lies on the kotatsu by the mandarins, its text along the screen's right at the zoomed cam
    this.ticket = new Ticket(this.fonts, PASS_SCALE);
    this.ticket.root.rotation.x = -Math.PI / 2;
    const table = new THREE.Group();
    table.position.copy(PASS_AT);
    table.rotation.y = 0.93;
    table.add(this.ticket.root);
    this.roomScene.add(table);
    this.tablePass = table;
    this.ticket.root.updateWorldMatrix(true, false);
    for (let i = 0; i < this.ticket.holeCount; i++) this.holes.push(this.ticket.holeWorld(i));
    this.punchTimes = this.clickTimes();

    // the carried pass, under the pectoral fin: the plain card until the sardine lays it on the kotatsu (T_SIT), the punched card from T_TAKE
    this.plain = carriedPass(this.fonts, false);
    this.fish.hold(this.plain.root);
    this.carried = carriedPass(this.fonts, true);
    this.carried.root.visible = false;
    this.fish.hold(this.carried.root);

    // the hole punch: a pin, a block and a long steel arm that leaves the frame to the upper right (scaled with the pass)
    const steel = { cell: A.solid('#5a626c') }, dark = { cell: A.solid('#30343c') }, red = { cell: A.solid('#8a2020') };
    const pb = new Builder(1600);
    pb.cylinder(0.0016, 0.0016, 0.012, 8, steel, steel, at(0, 0.0, 0));
    pb.box(0.005, 0.003, 0.005, allFaces(dark), at(0, 0.012, 0));
    pb.box(0.003, 0.003, 0.03, allFaces(steel), at(0, 0.0145, -0.016));
    pb.box(0.003, 0.03, 0.003, allFaces(steel), at(0, 0.02, -0.03));
    pb.box(0.01, 0.01, 0.04, allFaces(red), at(0, 0.05, -0.05));
    const arm = litMesh(pb, mat);
    arm.scale.setScalar(PASS_SCALE);
    this.punch.add(arm);
    this.roomScene.add(this.punch);
    const cb = new Builder(1600);
    cb.box(0.014, 0.002, 0.014, allFaces({ cell: A.solid('#f4f0e0') }));
    this.chads = instanced(cb.geometry(), mat, this.punchTimes.length * 3);
    this.roomScene.add(this.chads);
  }

  private tablePass!: THREE.Group;
  private plain!: Ticket;

  /**
   * The cursor clicks one hole for each syllable of line 7. The click is the syllable start, a little late for the first (the cursor comes
   * from the CAM 01 button): the type is tool output, so it follows the hand.
   */
  private clickTimes(): number[] {
    const u = this.u[2]!;
    return u.map((s, i) => (i === 0 ? s + 0.225 : s));
  }

  private posePass(t: number) {
    const carried = t >= T_TAKE;
    // each punch knocks on the table: the things on it jump 1 cm and rattle down
    let jolt = 0;
    for (const s of this.punchTimes) { const d = t - s; if (d >= 0 && d < 0.3) jolt += 0.011 * Math.exp(-d / 0.06) * Math.abs(Math.cos(34 * d)); }
    this.home.setTableJolt(jolt);
    // the bits of paper: each punch knocks three out of the pass; they fly, come down on the table and lie there
    const o = new THREE.Object3D();
    this.punchTimes.forEach((s, k) => {
      const h = this.holes[k]!, rnd = mulberry32(0xc4ad + k), d = t - s;
      for (let c = 0; c < 3; c++) {
        const a = rnd() * 6.28, sp = 0.25 + rnd() * 0.35, vy = 0.9 + rnd() * 0.7, rx = rnd() - 0.5, yaw = rnd() * 6, rz = rnd() - 0.5;
        const land = (vy + Math.sqrt(vy * vy + 0.2)) / 9.81, air = Math.min(Math.max(d, 0), land), down = d >= land;
        o.position.set(h.x + Math.cos(a) * sp * air, (down ? 0.452 : PASS_AT.y + 0.006 + vy * air - 4.905 * air * air) + jolt, h.z + Math.sin(a) * sp * air);
        o.rotation.set(down ? 0 : air * 28 * rx, yaw, down ? 0 : air * 22 * rz);
        o.scale.setScalar(d >= 0 ? 1 : 0);
        o.updateMatrix();
        this.chads.setMatrixAt(k * 3 + c, o.matrix);
      }
    });
    this.chads.instanceMatrix.needsUpdate = true;
    this.tablePass.visible = t >= T_SIT && !carried;
    this.tablePass.position.y = PASS_AT.y + jolt;
    this.plain.root.visible = t < T_SIT;
    this.carried.root.visible = carried;
    this.punch.visible = !carried && t >= this.u[2]![0]!;
    if (carried) return;
    const times = this.punchTimes;
    this.ticket.setHoles(Ticket.holesAt(t, times));
    // the punch hovers over the next hole, comes down on the click and goes up; between two holes it hops across
    const press = 3 * FR;
    let k = times.findIndex((s) => s + press > t);
    if (k < 0) k = times.length - 1;
    const here = this.holes[k]!;
    const prev = k > 0 ? this.holes[k - 1]! : here;
    const gap0 = k > 0 ? times[k - 1]! + press : times[k]! - 0.4, gap1 = times[k]! - press;
    const hop = smooth((t - gap0) / Math.max(2 * FR, gap1 - gap0));
    const d = Math.abs(t - times[k]!);
    const lift = (d >= press ? 0.014 : 0.014 * (d / press)) * PASS_SCALE;
    this.punch.position.set(lerp(prev.x, here.x, hop), PASS_AT.y + 0.0036 * PASS_SCALE + lift, lerp(prev.z, here.z, hop));
    this.punch.rotation.y = 0.93;
  }

  // ---------------------------------------------------------------- the balcony, the duckboard, the chunks

  private async buildBalcony() {
    const g = this.home.gap;
    const T_END = 42.667;
    this.breakTimes = this.clickTimesDelete();
    this.duck = new Duckboard(this.A, this.fonts);
    this.duck.setRot(0.7);
    // the long axis of the board across the balcony (z), its slats across the gap, the text reading toward -z
    this.duck.root.position.set((g.x0 + g.x1) / 2, g.y, g.z);
    this.duck.root.rotation.y = Math.PI / 2;
    this.roomScene.add(this.duck.root);
    this.duck.root.updateMatrixWorld(true);
    const rng = mulberry32(19);
    const bodies = this.duckBodies(rng);
    this.addDuckProps(bodies, rng);
    this.baked = await bake({ t0: 38.5, t1: T_END, hz: 60, gravity: [0, -9.81, 0], bodies });
  }

  /** A body for each fragment of the duckboard, in the room frame. The fragments of a glyph wake when the cursor deletes it. */
  private duckBodies(rng: () => number): BodySpec[] {
    const glyphOf = new Map<number, number>();
    for (let k = 0; k < this.breakTimes.length; k++) for (const i of this.duck.glyphPieces(k)) glyphOf.set(i, k);
    const q0 = new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), Math.PI / 2);
    return this.duck.pieces().map((pc, i) => {
      const p = v3(...pc.pose.p).applyQuaternion(q0).add(this.duck.root.position);
      const q = q0.clone().multiply(new THREE.Quaternion(...pc.pose.q));
      const k = glyphOf.get(i);
      // the glyph under the click breaks at once; the fragments with no letter (and the battens) go when the last letter does
      const wake = k !== undefined ? this.breakTimes[k]! + 0.03 + 0.02 * (i % 4) : this.breakTimes[this.breakTimes.length - 1]! + 0.25 + rng() * 0.35;
      return {
        shape: pc.shape, pose: { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] }, wakeAt: wake,
        vel: [(rng() - 0.5) * 0.5, -0.4 - rng() * 0.4, (rng() - 0.5) * 0.5], spin: [(rng() - 0.5) * 7, (rng() - 0.5) * 4, (rng() - 0.5) * 7],
        density: 400, friction: 0.5, restitution: 0.15,
      } satisfies BodySpec;
    });
  }

  /**
   * What stands on the board: a pair of sandals and a flower pot. Each is let go when the glyph under it is deleted: it lies on the slats that
   * are left and goes down with them. Their bodies go after the fragments in `bodies`.
   */
  private addDuckProps(bodies: BodySpec[], rng: () => number) {
    const A = this.A;
    const pieces = this.duck.pieces();
    const rubber = allFaces({ cell: A.solid('#3a5a8a') }), strap = allFaces({ cell: A.solid('#e8e4d8') });
    const clay = { cell: A.solid('#a8502c') }, soil = { cell: A.solid('#3a2c20') }, leaf = allFaces({ cell: A.solid('#4a8a3a') });
    const prop = (k: number, dx: number, dz: number, half: [number, number, number], yaw: number, build: (b: Builder) => void) => {
      const i = this.duck.glyphPieces(k)[0];
      if (i === undefined) throw new Error(`day: the duckboard has no fragment for glyph ${k}`);
      const pc = pieces[i]!, on = bodies[i]!.pose!.p;
      if (pc.shape.kind !== 'box') throw new Error('day: a fragment of the duckboard is not a box');
      const b = new Builder();
      build(b);
      const mesh = litMesh(b, this.mat);
      const p: [number, number, number] = [on[0] + dx, on[1] + pc.shape.half[1] + half[1] + 0.002, on[2] + dz];
      const q = new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), yaw);
      mesh.position.set(...p);
      mesh.quaternion.copy(q);
      this.roomScene.add(mesh);
      this.duckProps.push(mesh);
      bodies.push({ shape: { kind: 'box', half }, pose: { p, q: [q.x, q.y, q.z, q.w] }, wakeAt: this.breakTimes[k]! + 0.03, spin: [(rng() - 0.5) * 3, 0, (rng() - 0.5) * 3], density: 300, friction: 0.6, restitution: 0.1 });
    };
    const sandal = (b: Builder) => { b.box(0.09, 0.02, 0.22, rubber, at(0, -0.02, 0)); b.box(0.09, 0.02, 0.03, strap, at(0, 0, -0.04)); };
    prop(1, -0.03, 0, [0.045, 0.02, 0.11], 0.2, sandal);
    prop(1, 0.09, 0.02, [0.045, 0.02, 0.11], -0.1, sandal);
    prop(5, 0, 0, [0.06, 0.07, 0.06], 0.5, (b) => {
      b.box(0.12, 0.11, 0.12, { px: clay, nx: clay, pz: clay, nz: clay, py: soil, ny: clay }, at(0, -0.07, 0));
      b.box(0.05, 0.03, 0.05, leaf, at(0, 0.04, 0));
    });
  }

  /** The cursor deletes one glyph of the board for each syllable of line 8 (the first click comes late: the hand comes down from the CAM 02 button). */
  private clickTimesDelete(): number[] {
    return this.u[3]!.map((s, i) => (i === 0 ? s + 0.26 : i === 1 ? s + 0.13 : s));
  }

  /** The board and what stands on it, from the bake. Before the bake starts they are at rest: the bake holds each body until its `wakeAt`. */
  private poseBalcony(t: number) {
    const q0 = new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), Math.PI / 2).invert();
    const D = this.duck.root.position;
    const tb = Math.max(this.baked.t0, Math.min(t, this.baked.t1));
    const n = this.duck.pieces().length;
    for (let i = 0; i < n; i++) {
      this.baked.pose(i, tb, this.pP, this.pQ);
      this.duck.setPiece(i, this.pP.clone().sub(D).applyQuaternion(q0), q0.clone().multiply(this.pQ));
    }
    this.duckProps.forEach((m, j) => {
      this.baked.pose(n + j, tb, this.pP, this.pQ);
      m.position.copy(this.pP);
      m.quaternion.copy(this.pQ);
    });
  }

  // ---------------------------------------------------------------- the player

  /** A world point on the screen (px of the 640x360 frame) of a maximized window at time t. */
  private proj(cam: FixedCam, t: number, p: THREE.Vector3): Vec2 {
    cam.apply(this.tmpCam, t);
    this.tmpCam.aspect = CONTENT[2] / CONTENT[3];
    this.tmpCam.updateProjectionMatrix();
    this.tmpCam.updateMatrixWorld();
    const q = p.clone().project(this.tmpCam);
    return projectToRect(q, [0, CONTENT[1], CONTENT[2], CONTENT[3]]);
  }

  private buildPlayer() {
    const inputs = this.playerInputs(this.toolClicks());
    this.rig = new PlayerRig({ track: new PlayerTrack(inputs, { cursor: dropPlan().grab, tool: 'pickup', speed: 'play' }), fonts: this.fonts, ticker: '', counter: '' });
  }

  /**
   * The clicks of the tools: one hole for each syllable of line 7 (the cursor aims at the glyph's hole on the screen at the click), then one slat
   * glyph for each syllable of line 8 (the cursor aims at the middle of the pieces of the glyph, on the board).
   */
  private toolClicks(): PlayerInput[] {
    const clicks: PlayerInput[] = [];
    this.punchTimes.forEach((tk, k) => {
      const to = this.proj(this.cam1, tk, this.holes[k]!);
      clicks.push(...clickAt(tk, to, k === 0 ? { dur: 0.2 } : { dur: 0.15 }));
    });
    const D = this.duck.root;
    const glyphWorld = (k: number): THREE.Vector3 => {
      const c = v3(0, 0, 0);
      const ps = this.duck.glyphPieces(k);
      for (const i of ps) c.add(v3(...this.duck.pieces()[i]!.pose.p));
      if (ps.length) c.multiplyScalar(1 / ps.length);
      return D.localToWorld(c);
    };
    this.breakTimes.forEach((tk, k) => {
      clicks.push(...clickAt(tk, this.proj(this.cam2, tk, glyphWorld(k)), { dur: k === 0 ? 0.17 : 0.16 }));
    });
    return clicks;
  }

  /** The input track of the scene, with the tool `clicks` of lines 7 and 8 in their places. */
  private playerInputs(clicks: PlayerInput[]): PlayerInput[] {
    const u6 = this.u[1]!, u7 = this.u[2]!, u8 = this.u[3]!;
    const T6 = u6[0]!, T7 = u7[0]!, T8 = u8[0]!;
    const camSpec = { labels: ['CAM 01', 'CAM 02'] };
    const house: WinSpec = { id: 'house', title: '[HOUSE - CAM 01]', rect: [60, 40, 520, 280], status: 'OBJ 007  HOUSE', body: { kind: 'view', views: 2 }, cam: camSpec };
    const prev1 = (id: string): WinSpec => ({ id, title: '[CAM 01]', rect: CORNER, status: 'CAM 01  FEED OK', body: { kind: 'view' } });
    const camB = camButtons(FULL, true, 2);
    const tip = (k: number) => this.lines[k]!.written!.units.map((x) => x.glyph).join('');
    // where the cursor goes between its actions: the box that the sardine tapes, the pad of the calendar, the sprouts of the planter
    const top = this.home.planter.top;
    const sprout = (i: number): Vec2 => { const k = Math.min(i, u6.length - 1), s = this.shoal.place(k); return this.proj(this.cam2, u6[k]!, v3(top.x + s.x, top.y + 0.12, top.z + s.z)); };
    return [
      { at: -1, kind: 'open', win: house, maximized: true },
      // the pick-up hand of the seam (`ride.ts`): the same carry input, so the cursor matches across the cut
      dropPlan().input,
      // the hand is empty again
      { at: 28.8, kind: 'tool', tool: null },
      // line 5: the cursor goes after the sardine to the box and reads it, then it pokes the pad of the calendar, which tears by itself
      { at: 29.55, kind: 'move', to: this.proj(this.cam1, 29.55, v3(-1.15, 0.8, 0.85)), dur: 0.55 },
      { at: 29.55, kind: 'tip', text: 'OBJ 012  BOX  OPEN' },
      { at: 30.25, kind: 'tip', text: null },
      ...clickAt(30.667, this.proj(this.cam1, 30.667, v3(-0.62, 1.17, -1.3)), { dur: 0.4 }),
      // line 6: CAM 02. CAM 01 does not go: its feed stays in a corner window through the whole line
      ...clickAt(T6, centreOf(camB[1]!), { dur: 0.35 }),
      { at: T6, kind: 'cam', id: 'house', cam: 1 },
      { at: T6, kind: 'open', win: prev1('prev1'), origin: centreOf(camB[0]!) },
      // the cursor goes down to the planter and pokes at the sardines as they come up
      ...clickAt(u6[4]!, sprout(3), { dur: 0.6 }),
      { at: u6[8]!, kind: 'move', to: sprout(8), dur: 0.45 },
      ...clickAt(u6[Math.min(13, u6.length - 1)]!, sprout(12), { dur: 0.4 }),
      // line 7: the cursor goes to the corner window of CAM 01 and maximizes it, as a person does: CAM 01 is the feed again and zooms to the kotatsu
      ...clickAt(T7, centreOf(winButtons(CORNER, false).max), { dur: 0.32 }),
      { at: T7, kind: 'cam', id: 'house', cam: 0 },
      { at: T7, kind: 'close', id: 'prev1' },
      { at: T7 + 0.1, kind: 'tool', tool: 'punch' },
      { at: this.punchTimes[0]!, kind: 'tip', text: tip(2), times: this.punchTimes },
      ...clicks.filter((c) => c.at < T8 - 0.3),
      { at: u7[u7.length - 1]! + 0.6, kind: 'tip', text: null },
      // the cursor switches to CAM 02
      { at: 38.45, kind: 'tool', tool: 'delete' },
      ...clickAt(T8 - 0.05, centreOf(camB[1]!), { dur: 0.22 }),
      { at: T8, kind: 'cam', id: 'house', cam: 1 },
      { at: T8, kind: 'open', win: prev1('prev1b'), origin: centreOf(camB[0]!) },
      // line 8: the slat under the cursor carries the syllable; the small tooltip at the cursor names what the click deletes
      ...this.breakTimes.map((tk, k): PlayerInput => ({ at: tk, kind: 'tip', text: `[DEL: ${this.lines[3]!.written!.units[k]!.glyph}]` })),
      ...clicks.filter((c) => c.at >= T8 - 0.3),
      { at: u8[u8.length - 1]! + 0.15, kind: 'tip', text: null },
    ];
  }

  // ---------------------------------------------------------------- frame

  private renderWin(win: WinState, v: LitView, t: number) {
    const r = this.ctx.renderer;
    const asp = this.rig.aspect(win);
    // the room: the world through the same camera first (the dusk light of the room kit on it), then the room in front of it
    const room = (cam: THREE.PerspectiveCamera) => {
      cam.aspect = asp;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      const wc = this.worldCam, W = this.world;
      wc.matrix.multiplyMatrices(this.toWorld, cam.matrixWorld).decompose(wc.position, wc.quaternion, wc.scale);
      wc.fov = cam.fov;
      wc.aspect = asp;
      wc.updateProjectionMatrix();
      // the dusk of the room kit on the world: the day's light with most of it gone, a low orange sun in the west
      W.light('close', 'day', HOUSE, 0.62);
      W.sun.color.set('#ff9a5a');
      W.sun.position.set(HOUSE.x - 120, 34, STREET.z - 20);
      const fog = W.scene.fog as THREE.FogExp2;
      fog.color.copy(this.home.fog.color);
      fog.density = this.home.fog.density;
      v.render(r, W.scene, wc, this.home.sky);
      v.renderInFront(r, this.roomScene, cam);
    };
    switch (win.id) {
      case 'house': {
        this.poseRoom(t);
        this.poseBalcony(t);
        (win.view === 0 ? this.cam1 : this.cam2).apply(this.tmpCam, t);
        room(this.tmpCam);
        break;
      }
      case 'prev1':
      case 'prev1b': {
        this.poseRoom(t);
        this.poseBalcony(t);
        this.cam1.apply(this.tmpCam, t);
        room(this.tmpCam);
        break;
      }
      default: throw new Error(`day: no world for window "${win.id}"`);
    }
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    const t = f.t;
    // the fall: the view goes with the sardine at once. `night.ts` draws it from here (the sky over Station ？, the landing on 42.667)
    if (t >= this.u[3]![8]! + FALL_CUT) {
      if (!this.ctx.renderClip('chorus_1b', t, out)) throw new Error('day: the chorus_1b clip is not loaded');
      return NO_FILM_POST;
    }
    const st = this.rig.state(t);
    this.rig.compose(r, this.view, st, (win, v) => this.renderWin(win, v, t));
    this.text.clear();
    const line = lineAt(this.lines, t);
    this.rig.draw(this.text, st);
    if (line) subtitle(this.text, this.fonts, line, t);
    this.text.commit();
    this.view.present(r, out, { exposure: 1.1, bloom: 0.4, top: this.rig.top }, this.text);
    return NO_FILM_POST;
  }

  override dispose() {
    this.home.dispose();
    this.world.dispose();
    this.header.dispose();
    this.road.dispose();
    this.view.dispose();
    this.text.dispose();
    this.rig.dispose();
  }
}
