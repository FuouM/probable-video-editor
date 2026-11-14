// Intro and verse 1 (clips intro, verse_1; treatment v8 "Plate 1" and "Plate 2"). Both clips use this scene and draw the
// same frames: every frame is a pure function of t.
//
// The scene stands in the one game world (`_gameWorld.ts`): the platform, the car and the map are views of the same
// geometry. From bar 5 the ride window `[キハ40 - CAR 1]` is maximized: a fixed camera on the night platform イワシ (the
// sardine waits under the board with its commuter pass, then swims through the open door), then a view cycle to the
// cabin as the doors close. In verse 1 the LED route board over the door runs line 0, and the view stays in the car
// until the line has ended. Then the car view shrinks into `[Car 1 - Interior]` and the map shows. The player takes the
// scissors: they are in the cursor's hand, and they cut the rail at the end of the stem when the player clicks. The
// player takes the bend tool and drags the rail end round: the track ahead of the cut winds onto the loop (a ghost
// until it joins), and the stem does not move. In `[Car 1 - Interior]` the sardine sees the track bend ahead. The ends
// join with a flash at the node. The map goes to the player's house, the pick-up hand lifts the sardine off the train
// and drops it through the balcony door, and `[HOUSE - CAM 01]` opens on the downbeat of chorus 1.
//
// Lyric carriers (treatment "Lyric carriers"): line 0 on the LED route board, lines 1-2 in the tooltip of the scissors,
// lines 3-4 in the tooltip of the bend tool. A tooltip follows the cursor.
//
// Before bar 5 the scene draws the same picture (the attract picture behind the title screen of the chirp:
// `opening.ts` renders this clip at t < 7.111). The `DAY 1` card of the game stays on the picture from the chirp's bar 4
// and slides up out of the frame after the cut.
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import type { Line } from '@pve/engine/lyrics';
import { clamp01, smooth, hashSin } from '@pve/engine/util';
import { NO_FILM_POST } from '@pve/engine/post';
import { Builder, LH, LW, allFaces, at, camera, enableShadows, instanced, litMesh, markObject, point, spot, v3 } from '@pve/engine/lit';
import { LitView, type Sky } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { SPB, bar, FR } from './_time';
import { loadFonts, type Fonts } from './_fonts';
import { PaintedText } from './_captionCarriers';
import { Fish, SwimPath, type SwimKey } from './_fish';
import { HoverArrow } from './_editor';
import { Scissors } from './_scissors';
import { carriedPass, type Ticket } from './_ticket';
import { bigText, type Mask } from '@pve/engine/type';
import {
  FULL, TOOLBAR, centreOf, clickAt, toolButton, viewButton, winButtons,
  type CarryState, type PlayerInput, type PlayerState, type Rect, type Vec2, type WinSpec, type WinState,
} from './_playerTypes';
import { PlayerTrack } from './_playerTrack';
import { chromeText, chromeWidth, drawHandle } from './_playerChrome';
import { PlayerRig } from './_playerRig';
import { FixedCam, MAP_PPM, MapCam, RideCam } from './_playerCams';
import { kickBounce } from './_rideMusic';
import { GameWorld, HOUSE, HOUSE_DOOR_Z, type WorldState } from './_gameWorld';
import { BITE, LOOP_R, STATIONS, STATION_IDS, carMatrix, carPose, loopAt, routePoint } from './_route';
import { gripAt, poseCarriedFish } from './_carry';

/** The intro starts at bar 5. Before it this scene is the picture behind the title of the chirp. */
const T_START = bar(5);
/** The `DAY 1` card of the game: on the picture from the chirp's bar 4, up and out after the cut. */
const T_DAY0 = 12 * SPB;
/** The sardine waits broadside until here, then turns down the platform. */
const T_WAIT = 8.4;
/** The doors close (from, to), the view cycle to the cabin, the train leaves. */
const T_DOOR0 = 10.45, T_DOOR1 = 11.05, T_CABIN = bar(7), T_DEPART = 25 * SPB;
/**
 * The verse: the LED board view (bar 9), the click on [o] that shrinks the car window (line 0 has ended). The player takes the scissors with a
 * key, at once: the cursor is free to go from the window down to the rail, and its tooltip goes with it.
 */
const T_STRIP = bar(9), T_MAP = 17.45, T_TOOL = T_MAP + 3 / 36;
/** The sardine leaves its seat when the car view has shrunk into its window, and is at the front glass before the cut. */
const T_LEAVE = T_MAP + 0.1, T_GLASS = 21.0;
/** The rail parts this long after the blades start to close (2 frames). */
const CUT_LAG = 2 / 36;
/** The bend tool (on `そして`), the zoom out to the whole loop, the grab of the rail end (line 4). */
const T_BEND = 51.5 * SPB, T_OUT = 23.0, OUT_DUR = 0.7, T_DRAG = 54 * SPB;
/** The night comes on `そして`. */
const T_NIGHT = 22.889;
/**
 * The pick-up seam, on the hits of the fill of bar 16: the car window closes and the map goes to the house (26.444), the pick-up tool (27.000),
 * the grab (27.556), the let-go, the [HOUSE] box. The map is at the house a second before the grab: the lift and the carry are large and long.
 */
const T_CLOSE = 26.444, T_IN = T_CLOSE + 0.04, IN_DUR = 0.5, T_PICK = 27.0, T_GRAB = 27.556, T_DROP = 28.35, T_HOUSE = bar(17) - 2 / 36;
/** The train: the route position of the middle of the front car on the platform, its acceleration and top speed (m/s^2, m/s). */
export const S_TRAIN0 = STATIONS.iwashi.s - 9;
const ACC = 0.75, VMAX = 17.5;
const SX = STATIONS.iwashi.s;

/** Distance the train has covered at song time t. */
export function dist(t: number): number {
  const a = Math.max(0, t - T_DEPART);
  const tv = VMAX / ACC;
  return a < tv ? 0.5 * ACC * a * a : 0.5 * ACC * tv * tv + VMAX * (a - tv);
}
const speedAt = (t: number) => Math.min(VMAX, ACC * Math.max(0, t - T_DEPART));

const key = (t: number, x: number, y: number, z: number, o: { stop?: boolean; face?: number } = {}): SwimKey => ({ t, p: [x, y, z], ...o });
/** The heading toward the train (-z): where the sardine looks while it waits on the platform. */
const TOWARD_TRAIN = Math.PI / 2;

const NIGHT: Sky = {
  zenith: '#070b24', horizon: '#26305e', ground: '#0a0d10', stars: 1,
  body: { dir: v3(0.35, 0.42, -0.84).normalize(), r: 0.022, colour: '#eef2ff', strength: 3, glow: 2.2 },
};
const MAP_SKY: Sky = { zenith: '#1a1a30', horizon: '#3a3050', ground: '#24361f' };

/** The car window: its place at the top right and the views of its camera button. */
const CAR_RECT: Rect = [404, 26, 232, 150];
const VIEW_BTN: Rect = viewButton(FULL, true);
const VIEW = { platform: 0, aisle: 1, strip: 2, sardine: 3 } as const;

/** The LED route strip: its size in its texture, its place in the car (the left wall over the front door), its size (m). */
const STRIP_W = 256, STRIP_H = 38;
const STRIP_AT = v3(5.4, 3.14, 1.255), STRIP_SIZE: Vec2 = [1.6, 0.24];

/** The sardine's place at the front glass in the car frame (x forward, y up, z to the left). */
const GLASS = v3(9.58, 2.45, 0.3);
/** The hand straps: the height of their rails and the distance of the rails from the middle of the car. */
const STRAP_Y = 3.12, STRAP_Z = 0.8;
/**
 * The swing of the straps (`swingStraps`): the sample rate of the table (Hz), the integration steps in each sample, the distance between rail
 * joints (m) and the distance of the two bogies from the middle of the car (m).
 */
const STRAP_HZ = 144, STRAP_SUB = 6, RAIL_JOINT = 25, BOGIE = 5.5;

/** The zoom notches of the world map (px per metre): the whole loop, the line, the default, near. */
export const WORLD_NOTCHES = [MAP_PPM / 6, MAP_PPM / 2, MAP_PPM, MAP_PPM * 2] as const;

/** The position of the point at height `y` under screen position (sx, sy) (the map camera looks down at 30 degrees). */
function groundUnder(cam: THREE.OrthographicCamera, sx: number, sy: number, y = 0): THREE.Vector3 {
  const ndc = new THREE.Vector3((sx / LW) * 2 - 1, 1 - (sy / LH) * 2, 0);
  const near = ndc.clone().setZ(-1).unproject(cam), far = ndc.clone().setZ(1).unproject(cam);
  const dir = far.sub(near);
  return near.addScaledVector(dir, (y - near.y) / dir.y);
}

// ---------------------------------------------------------------- the plan of the map camera and the pick-up seam (pure functions of constants)

/**
 * The map: first the line from the train to the end of the stem (the cut). On `そして` it goes out in one smooth move to the whole loop. After the join it goes in,
 * in one smooth move, to the player's house and the train that passes it.
 */
const MAP_OPTS = { center: [-46, -6] as Vec2, zoom: 1, notches: WORLD_NOTCHES };
const MAP_INPUTS: PlayerInput[] = [
  { at: T_OUT, kind: 'zoom', notch: 0, dur: OUT_DUR },
  { at: T_OUT, kind: 'look', to: [-18, -118], dur: OUT_DUR },
  // close: the hand, the sardine in it and the balcony door are large. The house sits right of the middle and a little low: the centre is
  // 5 m left (-r) and 6 m up the screen (+f) of the old centre (at yaw 45 degrees r = (0.71, -0.71), f = (-0.71, -0.71))
  { at: T_IN, kind: 'zoom', notch: 3, dur: IN_DUR },
  { at: T_IN, kind: 'look', to: [HOUSE.x - 0.5 - 7.8, 7.5 - 0.7], dur: IN_DUR, straight: true },
];
const MAP_CAM = new MapCam(new PlayerTrack(MAP_INPUTS), MAP_OPTS);

/** The screen position (whole px) of the world point (x, y, z) on the map at time t. */
function mapPx(x: number, z: number, t: number, y = 0): Vec2 {
  const p = MAP_CAM.project(v3(x, y, z), t);
  return [Math.round(p[0]), Math.round(p[1])];
}

/**
 * The pick-up seam: the grip plane of the hand over the house (the fish hangs below it, so its head is level with the balcony door), the plane of the
 * train roof, and the size of the map fish (a 0.7 m fish would be 8 px on the map).
 */
const HOLD_Y = 7.4, REST_Y = 3.4;
export const MAP_FISH_SIZE = 5;

/**
 * The pick-up hand of the seam 27.1-28.444: where it grabs (the roof of the train at T_GRAB), where it lets go (over the balcony of the player's house
 * at T_DROP), the carry input, the world point of the grip at the release (`high`) and the screen's right as a ground vector (`side`). `day.ts` replays
 * `input` on a track that starts with the cursor at `grab`, so the hand and the falling fish match across the cut.
 */
export interface DropPlan { grab: Vec2; to: Vec2; high: THREE.Vector3; side: THREE.Vector3; input: PlayerInput }

let dropOnce: DropPlan | null = null;
/** The pick-up hand of the seam (`DropPlan`), built on the first call. */
export function dropPlan(): DropPlan {
  if (dropOnce) return dropOnce;
  const tp = carPose(S_TRAIN0 + dist(T_GRAB), false);
  const grab = mapPx(tp.x, tp.z, T_GRAB, REST_Y);
  const to = mapPx(HOUSE.x - 1.4, HOUSE_DOOR_Z + 1.4, T_DROP, HOLD_Y);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1);
  MAP_CAM.apply(cam, T_DROP);
  const high = groundUnder(cam, to[0], to[1], HOLD_Y);
  const side = v3(Math.cos(Math.PI / 4), 0, -Math.sin(Math.PI / 4));
  const input: PlayerInput = { at: T_GRAB, kind: 'carry', to, dur: T_DROP - T_GRAB, scale: 100 };
  dropOnce = { grab, to, high, side, input };
  return dropOnce;
}

/** The world matrix of the front car at song time t (the train is on the stem through the whole scene). */
const trainMatrix = (t: number): THREE.Matrix4 => carMatrix(S_TRAIN0 + dist(t), false);

/** The window of the train (the live 3D view of the ride cameras). */
const carWindow = (id: string, title: string, status: (t: number) => string): WinSpec => ({ id, title, rect: CAR_RECT, status, body: { kind: 'view', views: 4 } });

/** A ring of 3x3 px dots round (cx, cy) of radius `r`, flattened to 0.75 high (a ring on the ground of the map). */
function dotRing(l: TextLayer, cx: number, cy: number, r: number, c: string) {
  const n = Math.max(24, Math.round(r * 5));
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; l.rect(Math.round(cx + Math.cos(a) * r) - 1, Math.round(cy + Math.sin(a) * r * 0.75) - 1, 3, 3, c); }
}

export default class Ride extends Scene {
  private world!: GameWorld;
  private view = new LitView();
  private text = new TextLayer();
  private fonts!: Fonts;
  private lines: Line[] = [];
  private fish!: Fish;
  private pass!: Ticket;
  private fishPath!: SwimPath;
  private route!: { tex: THREE.DataTexture; data: Uint8Array };
  private led!: PaintedText;
  private arrow = new HoverArrow(5);
  private scissors!: Scissors;
  private scTilt = new THREE.Group();
  private flash!: THREE.Mesh;
  /** The piece of rail that the scissors cut out: it springs up, rolls over once and lies beside the track until the join. */
  private sprung!: THREE.Mesh;
  private flashLight = point('#fff2c0', 0, 60);
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1);
  private persp = camera(50, 0.05, 3000);
  private cams!: { platform: FixedCam; aisle: RideCam; strip: RideCam; sardine: RideCam };
  private mapCam!: MapCam;
  private rig!: PlayerRig;
  private day!: { ink: Mask; edge: Mask; outer: Mask | null };
  private times = { snip: 0, tsu: 0, jolt: 0 };
  /** The loop on the screen at the time of the drag: the path of the rail end from C once round and back to C. */
  private ring: Vec2[] = [];
  private nodeC: Vec2 = [0, 0];
  private mapFish!: Fish;
  /** The glow behind the sardine in the pick-up hand (`poseHalo`). */
  private halo = new THREE.Group();
  private doorsKey = -1;
  private track!: PlayerTrack;
  private kicks: number[] = [];
  /** The hand straps under the two ceiling rails of the front car: their places (x, z) in the car. */
  private straps!: THREE.InstancedMesh;
  private strapAt: [number, number][] = [];
  /** The two swing angles (fore, side) of each strap at each sample of `STRAP_HZ` from `t0`. */
  private strapSwing!: { t0: number; n: number; a: Float32Array };
  private o = new THREE.Object3D();

  override async init() {
    enableShadows(this.ctx.renderer);
    this.fonts = await loadFonts(this.ctx.assets);
    this.lines = this.ctx.lyrics.lines.slice(0, 6);
    const unit = (i: number, g: string) => {
      const x = this.lines[i]!.written!.units.find((w) => w.glyph.startsWith(g));
      if (!x) throw new Error(`ride: line ${i} has no unit "${g}"`);
      return x.start;
    };
    // the sardine and the train take the join on the join (`つ`), not a beat later
    this.times = { snip: unit(2, 'ち'), tsu: unit(4, 'つ'), jolt: unit(4, 'つ') };
    this.day = bigText(this.fonts.latin, 'DAY 1', 3, 1, 1);
    const midi = (await (await fetch(`${this.ctx.assets}midi.json`)).json()) as { notes: { track: number; start: number }[] };
    const kicks = midi.notes.filter((n) => n.track === 19).map((n) => n.start).sort((a, b) => a - b);
    this.kicks = kicks;
    this.world = new GameWorld(this.fonts, { lit: ['iwashi'] });
    this.world.setLamps(true);
    // the train has one car until the bridge: the interlude reads the second one in as a bad copy
    this.world.cars[1].root.visible = false;
    this.buildCar();
    this.buildMapProps();
    this.buildCams(kicks);
    this.buildPlayer();
    const r = this.ctx.renderer;
    r.compile(this.world.scene, this.persp);
    r.compile(this.world.scene, this.ortho);
    this.mapCam.apply(this.ortho, T_DRAG);
    this.world.light('map', 1, v3(0, 0, 0));
    this.view.render(r, this.world.scene, this.ortho, MAP_SKY);
  }

  // ---------------------------------------------------------------- the car and the platform

  private buildCar() {
    const W = this.world, A = W.atlas, car = W.cars[0];
    for (const c of W.cars) c.setInterior(0.55);
    // the map shows the cab front a few pixels wide: steady headlight glow, dim destination box
    car.setSteadyGlow(true);
    // a warm spot on the name boards, so they read at night
    const boardLight = spot('#ffe2b0', 22, 9, 0.6, 0.5, false);
    boardLight.position.set(SX - 6, 3.6, 5.6);
    boardLight.target.position.set(SX - 7, 3.5, 3.2);
    W.scene.add(boardLight, boardLight.target);
    this.fish = new Fish(A, W.mat);
    car.root.add(this.fish.root);
    // the paper is nearly white: under the ceiling strips it would bloom into a blob, so the card takes 60 % of the light
    this.pass = carriedPass(this.fonts, false, 0.6);
    this.fish.hold(this.pass.root);
    // more ceiling lights over the front half of the car, where the sardine sits
    for (const [x, y, z, cd, range, c] of [[3.5, 2.8, 0.2, 2.4, 4.5, '#ffd9a0'], [9.1, 2.9, -0.2, 0.9, 3, '#ffd9a0']] as const) {
      const l = point(c, cd, range);
      l.position.set(x, y, z);
      car.root.add(l);
    }
    // the platform where the sardine waits: a warm light that stands on the platform (it stays when the train leaves)
    const platformLight = point('#ffcf8a', 9, 6);
    platformLight.position.set(3.3, 2.4, 3.8).applyMatrix4(trainMatrix(T_START));
    W.scene.add(platformLight);
    this.routeDisplay();
    // the hand straps: a rail under the ceiling on each side of the aisle, and a strap each 0.6 m (`poseStraps`)
    const belt = allFaces({ cell: A.solid('#cfcabb') }), ring = allFaces({ cell: A.solid('#f4f1e6') }), steel = allFaces({ cell: A.solid('#9aa0a8') });
    const sb = new Builder();
    sb.box(0.03, 0.22, 0.012, belt, at(0, -0.22, 0));
    sb.box(0.13, 0.018, 0.03, ring, at(0, -0.24, 0));
    sb.box(0.13, 0.018, 0.03, ring, at(0, -0.36, 0));
    for (const s of [-1, 1]) sb.box(0.018, 0.12, 0.03, ring, at(s * 0.056, -0.36, 0));
    const rails = new Builder();
    for (const z of [-STRAP_Z, STRAP_Z]) {
      rails.box(7.8, 0.03, 0.03, steel, at(4.8, STRAP_Y, z));
      // no strap hangs between the lens of the board view and the LED board over the front door
      for (let x = 1.2; x <= 8.41; x += 0.6) if (z < 0 || x < 4.1 || x > 6.7) this.strapAt.push([x, z]);
    }
    this.straps = instanced(sb.geometry(), W.mat, this.strapAt.length);
    car.root.add(litMesh(rails, W.mat, { cast: false }), this.straps);
    this.strapSwing = this.swingStraps();
    // the sardine: waits under the board looking at the train, swims head first along the platform and into the open door, glides down the car and
    // comes to rest over the green seat exactly on the cut to verse 1. It keeps its seat while the board runs line 0. When the car view has shrunk
    // into its window it swims forward down the car to the front glass, in view all the way. When the player drags the rail end round, it backs
    // off the glass and turns its head after the hand (`lookTo`). The nose follows the tangent of the path: it turns by banking and never slides sideways.
    const D = 5.4;
    this.fishPath = new SwimPath([
      key(T_START, 3.2, 1.75, 3.3, { face: TOWARD_TRAIN }), key(T_WAIT, 3.2, 1.8, 3.3, { stop: true, face: TOWARD_TRAIN }),
      key(8.95, 3.95, 1.88, 3.12), key(9.5, 4.95, 1.95, 2.75), key(9.9, D - 0.05, 2.0, 2.1), key(10.2, D, 2.05, 1.0), key(10.45, D - 0.25, 2.05, 0.35),
      // down the aisle nose first, a bank at the end, a short glide to a stop over the seat, facing forward
      key(10.9, 4.5, 2.05, 0.2), key(11.5, 4.0, 2.04, 0.15), key(12.1, 3.5, 2.03, 0.2), key(12.7, 3.0, 2.06, 0.35), key(13.25, 2.65, 2.15, 0.55),
      key(13.6, 2.5, 2.3, 0.9), key(13.92, 2.8, 2.38, 1.02), key(T_STRIP, 3.4, 2.4, 1.0, { stop: true, face: 0 }),
      key(T_LEAVE, 3.4, 2.4, 1.0, { stop: true, face: 0 }),
      // forward down the car, at a glide, to the front glass
      key(18.4, 5.0, 2.35, 0.6), key(19.3, 7.2, 2.3, 0.35), key(20.0, 8.7, 2.4, 0.3), key(T_GLASS, GLASS.x, GLASS.y, GLASS.z, { stop: true, face: 0 }),
      key(T_DRAG + 0.15, GLASS.x, GLASS.y, GLASS.z, { stop: true, face: 0 }),
      // the track ahead bends: back off the glass, and come back for the join
      key(T_DRAG + 0.75, 9.0, 2.5, 0.25, { stop: true, face: 0 }), key(25.3, 9.05, 2.48, 0.35, { stop: true, face: 0 }), key(this.times.tsu - 0.05, 9.42, 2.45, 0.32, { stop: true, face: 0 }),
    ]);
  }

  /** The LED route strip over the front door: our own small texture in front of the kit's panel. It shows `→ あした`, and line 0 runs on it. */
  private routeDisplay() {
    const car = this.world.cars[0];
    const data = new Uint8Array(STRIP_W * STRIP_H * 4);
    const tex = new THREE.DataTexture(data, STRIP_W, STRIP_H, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshBasicMaterial({ map: tex });
    m.color.setScalar(2.4);
    const q = new THREE.Mesh(new THREE.PlaneGeometry(...STRIP_SIZE), m);
    q.position.copy(STRIP_AT);
    q.rotation.y = Math.PI;
    car.root.add(q);
    this.route = { tex, data };
    const put = (x: number, y: number, r: number, g: number, b: number) => {
      if (x < 0 || y < 0 || x >= STRIP_W || y >= STRIP_H) return;
      const o = ((STRIP_H - 1 - y) * STRIP_W + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    };
    for (let y = 0; y < STRIP_H; y++) for (let x = 0; x < STRIP_W; x++) put(x, y, 14, 10, 8);
    const text = '→ あした';
    const f = this.fonts.kana;
    f.draw({ put: (x, y) => put(x, y, 255, 172, 40) }, text, Math.round((STRIP_W - f.width(text)) / 2), 25, 1);
    tex.needsUpdate = true;
    // line 0 on the board: the full line dim on the dark panel, each syllable lights amber on its start (the dot panel of a route board)
    this.led = new PaintedText(this.fonts, this.lines[0]!, {
      px: [STRIP_W, STRIP_H], size: STRIP_SIZE, layout: { n: 1 }, ground: '#0e0a08', ink: '#ffb42a', edge: '#b86a10', outer: '#0e0a08', ghost: '#4a2c0c', hot: '#fff0b0', emit: 2.4, hold: 0.4,
    });
    this.led.mesh.position.copy(STRIP_AT);
    this.led.mesh.rotation.y = Math.PI;
    car.root.add(this.led.mesh);
  }

  /** The things that only the map shows: the scissors in the cursor's hand, the flash of the join, the arrow over the house and the fish in the pick-up hand. */
  private buildMapProps() {
    const W = this.world, A = W.atlas;
    this.scissors = new Scissors(A);
    this.scTilt.add(this.scissors.root);
    this.scTilt.rotation.y = Math.PI / 2;
    this.scTilt.visible = false;
    const fl = new Builder();
    fl.box(1, 1, 1, allFaces({ cell: A.solid('#fff6d0', 2.5) }));
    this.flash = litMesh(fl, W.mat, { cast: false });
    this.flash.visible = false;
    this.flash.position.set(-BITE / 2, 0.6, 0);
    this.flashLight.position.set(-BITE / 2, 5, 0);
    this.mapFish = new Fish(A, W.mat, MAP_FISH_SIZE);
    this.mapFish.hold(carriedPass(this.fonts, false).root);
    this.mapFish.root.visible = false;
    // the halo behind the carried sardine: three flat discs that face the map camera, a yellow glow in steps (pixel art, no smooth gradient)
    for (const [r, a] of [[1, 0.22], [0.78, 0.3], [0.56, 0.42]] as const) {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd23a').multiplyScalar(1.6), transparent: true, opacity: a, depthWrite: false });
      this.halo.add(new THREE.Mesh(new THREE.CircleGeometry(r, 24), m));
    }
    this.halo.visible = false;
    // the cut piece: two rails of `BITE` metres on four sleepers, about its own middle
    const sp = new Builder();
    for (const z of [-0.5335, 0.5335]) sp.box(BITE, 0.15, 0.1, allFaces(W.faces.rail), at(0, -0.15, z));
    for (const x of [-1.1, -0.37, 0.37, 1.1]) sp.box(0.22, 0.14, 2.2, allFaces(W.faces.sleeper), at(x, -0.29, 0));
    this.sprung = litMesh(sp, W.mat);
    this.sprung.visible = false;
    W.scene.add(this.scTilt, this.flash, this.flashLight, this.arrow, this.mapFish.root, this.halo, this.sprung);
  }

  private buildCams(kicks: number[]) {
    const base = { pose: trainMatrix, kicks, onRails: (t: number) => t >= T_CABIN };
    this.cams = {
      // the platform: bolted to the fence, looking across the platform at the train. The name board along the platform faces it, whole; the sardine
      // waits in front of the board; the open door is beside it. The camera never moves.
      platform: new FixedCam({ pos: [SX - 3.6, 2.6, 7.0], target: [SX - 3.8, 2.75, 2.0], fov: 52 }),
      // the aisle: from the wall opposite the seat, looking across the car: the fish shows its flank all the way
      aisle: new RideCam({ ...base, mode: 'cabin', offsets: { cabin: { eye: [3.1, 2.3, -1.25], look: [3.1, 2.05, 1.0], fov: 64 } } }),
      strip: new RideCam({ ...base, mode: 'cabin', offsets: { cabin: { eye: [4.9, 2.6, -0.3], look: [5.4, 3.1, 1.255], fov: 44 } } }),
      // the window of the verse: it follows the sardine forward down the car (17.55-20.7), then it stands in the cab behind the sardine and looks out
      // through the front glass at the track ahead: the cut, the bend and the join
      sardine: new RideCam({
        ...base, impacts: [{ at: this.times.snip + CUT_LAG, amp: 0.04 }, { at: this.times.tsu, amp: 0.1 }], mode: 'cabin',
        pose: (t: number) => trainMatrix(t).multiply(new THREE.Matrix4().makeTranslation(-7.3 * (1 - smooth((t - T_LEAVE) / (T_GLASS - 0.3 - T_LEAVE))), 0, 0)),
        // the eye travels through the doorway of the cab partition (x 8.25-8.35, door z -0.45..0.45, lintel from 2.775 m) and stops in the cab
        offsets: { cabin: { eye: [8.45, 2.7, -0.35], look: [10.7, 2.2, 0.4], fov: 62 } },
      }),
    };
  }

  // ---------------------------------------------------------------- the player

  private buildPlayer() {
    // the bend: the player grabs the rail end at C and drags it once round the loop. The cursor follows the true path of the loop on the screen.
    const loop: Vec2[] = [];
    for (let k = 0; k <= 40; k++) { const p = loopAt((k / 40) * Math.PI * 2); loop.push(mapPx(p.x, p.z, T_DRAG)); }
    this.ring = loop;
    this.nodeC = mapPx(-BITE / 2, 0, T_DRAG);
    const inputs: PlayerInput[] = [...MAP_INPUTS, ...this.carInputs(), ...this.toolInputs(loop), ...this.pickInputs()];
    const track = new PlayerTrack(inputs, { cursor: [612, 330], speed: 'play' });
    this.track = track;
    this.mapCam = new MapCam(track, MAP_OPTS);
    this.rig = new PlayerRig({ track, fonts: this.fonts, tools: true, ticker: (t) => `${this.ticker(t)}  ZOOM ${(this.mapCam.view(t).ppm / MAP_PPM).toFixed(1)}x`, counter: (t) => this.counter(t) });
  }

  /** The car window: maximized from the start, the cursor with the sardine, the view cycles, and the click on [o] that shrinks it when line 0 has ended. */
  private carInputs(): PlayerInput[] {
    const status = (t: number) => `CAR 1  ${Math.round(speedAt(t) * 3.6)} km/h`;
    const car1b = carWindow('car1b', '[Car 1 - Interior]', status);
    const car1 = carWindow('car1', '[キハ40 - CAR 1]', (t) => (t < T_DOOR0 ? 'CAR 1  0 km/h  DOOR OPEN' : t < T_DOOR1 ? 'CAR 1  0 km/h  DOOR CLOSING' : t < T_DEPART ? 'CAR 1  0 km/h  DOOR CLOSED' : status(t)));
    const carCentre: Vec2 = [CAR_RECT[0] + CAR_RECT[2] / 2, CAR_RECT[1] + CAR_RECT[3] / 2];
    return [
      { at: -1, kind: 'open', win: car1, maximized: true },
      // the player is there from the start: the cursor reads the board, finds the sardine and goes with it to the door
      { at: 7.95, kind: 'move', to: [300, 118], dur: 0.5 },
      { at: 8.75, kind: 'move', to: [298, 262], dur: 0.45 },
      { at: 8.75, kind: 'tip', text: 'OBJ 001  SARDINE' },
      { at: 9.7, kind: 'move', to: [336, 250], dur: 0.6 },
      { at: 9.95, kind: 'tip', text: null },
      // each view cycle is a click on the window's view button: the doors close, then the LED board
      ...clickAt(T_CABIN, centreOf(VIEW_BTN)),
      { at: T_CABIN, kind: 'view', id: 'car1', view: VIEW.aisle },
      // in the car the cursor goes after the sardine down the aisle
      { at: 12.2, kind: 'move', to: [352, 196], dur: 0.6 },
      { at: 13.4, kind: 'move', to: [300, 176], dur: 0.5 },
      ...clickAt(T_STRIP, centreOf(VIEW_BTN)),
      { at: T_STRIP, kind: 'view', id: 'car1', view: VIEW.strip },
      // the cursor goes along under the board as the line runs, as a finger under a line of print
      { at: 15.0, kind: 'move', to: [236, 214], dur: 0.45 },
      { at: 16.8, kind: 'move', to: [420, 214], dur: 1.6 },
      // line 0 has ended on the board: the click on [o] shrinks the car view into its window, and the map shows behind it
      ...clickAt(T_MAP, centreOf(winButtons(FULL, true).max), { dur: 0.4 }),
      { at: T_MAP, kind: 'close', id: 'car1' },
      { at: T_MAP, kind: 'open', win: car1b, origin: carCentre },
      { at: T_MAP, kind: 'view', id: 'car1b', view: VIEW.sardine },
    ];
  }

  /** The scissors (lines 1 and 2 in their tooltip) and the cut, then the bend tool (lines 3 and 4) and the drag of the rail end along `loop`. */
  private toolInputs(loop: Vec2[]): PlayerInput[] {
    const { snip, tsu } = this.times;
    const beat = (b: number) => b * SPB;
    const onRail = (x: number, t: number) => mapPx(x, 0, t);
    // a tooltip shows one code point for each time: a unit of two kana (`ちょ`) lands whole on its start
    const tipOf = (i: number) => {
      const units = this.lines[i]!.written!.units;
      return { text: units.map((u) => u.glyph).join(''), times: units.flatMap((u) => [...u.glyph].map(() => u.start)) };
    };
    const tip1 = tipOf(1), tip2 = tipOf(2), tip3 = tipOf(3), tip4 = tipOf(4);
    return [
      // the scissors: the player takes them with a key, so they are in the cursor's hand at once. Their tooltip carries lines 1 and 2. The cursor
      // goes from the car window down to the rail ahead of the train in the middle of the map, at a hand's pace, and the tooltip takes the eye there
      { at: T_TOOL, kind: 'tool', tool: 'scissors' },
      { at: T_MAP, kind: 'tip', text: tip1.text, times: tip1.times.map((x) => Math.max(x, T_MAP)) },
      { at: 18.72, kind: 'move', to: onRail(-62, 18.72), dur: 1.05 },
      { at: tip2.times[0]!, kind: 'tip', text: tip2.text, times: tip2.times },
      // up the line to the end of the stem, with a hold before the cut
      { at: beat(45.5), kind: 'move', to: onRail(-28, beat(45.5)), dur: 0.7 },
      { at: beat(47), kind: 'move', to: onRail(-BITE / 2, beat(47)), dur: 0.5 },
      { at: snip, kind: 'click' },
      { at: this.lines[2]!.end + 0.3, kind: 'tip', text: null },
      // `そして`: the bend tool. The map goes out to the whole loop in one move.
      ...clickAt(T_BEND, centreOf(toolButton('bend')), { dur: 0.45 }),
      { at: T_BEND, kind: 'tool', tool: 'bend' },
      { at: T_BEND, kind: 'tip', text: tip3.text, times: tip3.times.map((x) => Math.max(x, T_BEND)) },
      // line 4: the cursor grabs the rail end at C and drags it round. It lets go on つな: the end stands on the end of the stem again and joins it.
      { at: T_DRAG, kind: 'move', to: loop[0]!, dur: 0.45 },
      { at: T_DRAG, kind: 'tip', text: tip4.text, times: tip4.times },
      { at: T_DRAG, kind: 'handle', id: 'bend', to: loop[loop.length - 1]!, via: loop.slice(1, -1), dur: tsu - T_DRAG, snap: this.nodeC },
      { at: tsu + 0.4, kind: 'tool', tool: null },
    ];
  }

  /**
   * The car window closes (its [x]) when the sardine has taken the join; the map goes in to the house at once; the pick-up tool; the hand takes the
   * sardine off the train and carries it to the balcony, in view for most of a second.
   *
   * HANDOFF TO CHORUS 1 (clip chorus_1, 28.444). The state of this scene on the last frame before the cut:
   *  - The pick-up hand (`dropPlan`) lifted the sardine off the roof of the train at 28.000, carried it over the player's house (`HOUSE` in `_gameWorld.ts`)
   *    and let go at 28.350 above the balcony. The cursor stands at its `to` and holds the pick-up tool. The sardine falls in through the door.
   *  - Window `[HOUSE - CAM 01]` (id 'house') opens at 28.389 from the door (a 2-frame box) and is MAXIMIZED from 28.444 on.
   *  - The map is the looped world at night (notch 2, centred near the house); the green hover arrow stands over the house.
   */
  private pickInputs(): PlayerInput[] {
    const house: WinSpec = { id: 'house', title: '[HOUSE - CAM 01]', rect: [60, 40, 520, 280], status: 'OBJ 007  HOUSE', body: { kind: 'draw', draw: (l, c) => l.rect(c[0], c[1], c[2], c[3], '#000000') } };
    const lead5 = this.lines[5]!.written!.units[0]!.start;
    const closeBtn = centreOf(winButtons(CAR_RECT, false).close);
    const drop = dropPlan();
    return [
      ...clickAt(T_CLOSE, closeBtn, { dur: 0.3 }),
      { at: T_CLOSE, kind: 'close', id: 'car1b' },
      { at: T_PICK - 0.32, kind: 'tip', text: null },
      ...clickAt(T_PICK, centreOf(toolButton('pickup')), { dur: 0.3 }),
      { at: T_PICK, kind: 'tool', tool: 'pickup' },
      { at: T_GRAB, kind: 'move', to: drop.grab, dur: 0.35 },
      drop.input,
      // the first syllable of line 5 is held over two notes: it is in the tooltip of the hand, `あ` and then `あー`
      { at: lead5, kind: 'tip', text: 'あー', times: [lead5, lead5 + SPB / 2] },
      // [HOUSE - CAM 01] opens from the door and maximizes on the downbeat
      { at: T_HOUSE, kind: 'open', win: house, origin: drop.to, maximized: true },
    ];
  }

  private ticker(t: number): string {
    const { snip, tsu } = this.times;
    if (t < T_TOOL) return 'LINE 01  SEG 1  OK';
    if (t < T_BEND) return t < snip + CUT_LAG ? 'TOOL: SCISSORS' : 'LINE 01  SEG 2  OPEN END';
    if (t < tsu) return `TOOL: BEND  R=${LOOP_R}m`;
    if (t < T_PICK) return 'LINE 01  LOOP  86400 s';
    return 'TOOL: PICKUP';
  }

  /** `YEAR ????  NOV 03`: the year never settles. */
  private counter(t: number): string {
    const slot = Math.floor(t * 8);
    let y = '';
    for (let j = 0; j < 4; j++) y += hashSin(slot, j + 1) < 0.5 ? '?' : String(Math.floor(hashSin(slot, j + 9) * 10));
    return `YEAR ${y}  NOV 03`;
  }

  // ---------------------------------------------------------------- frame

  /** The state of the track at time t. `wind`: the progress of the drag while the rail end is in the player's hand. */
  private worldState(t: number, st: PlayerState): WorldState {
    const { snip, tsu } = this.times;
    const h = st.handles.find((x) => x.id === 'bend');
    const joined = t >= tsu;
    return { cut: t >= snip + CUT_LAG && !joined, wind: joined ? 1 : h ? h.u : 0, ghost: !!h && !joined, joined };
  }

  /** Poses the world at time t: the track, the train, the doors, the sardine, the straps, the flash and the cut rail. */
  private poseWorld(t: number, st: PlayerState) {
    const W = this.world;
    W.pose(this.worldState(t, st));
    W.placeTrain(S_TRAIN0 + dist(t), false);
    // at the platform the train rocks on its springs on the kicks, as the cabin view does on the rail joints
    const rock = t < T_CABIN ? kickBounce(t, this.kicks, 0.04) : 0;
    for (const c of W.cars) { c.root.position.y = rock; c.root.rotation.x = 0.35 * rock; }
    const doors = 1 - smooth((t - T_DOOR0) / (T_DOOR1 - T_DOOR0));
    const dk = Math.round(doors * 60);
    if (dk !== this.doorsKey) { for (const c of W.cars) { c.setDoors('left', doors); c.setDoors('right', doors); } this.doorsKey = dk; }
    this.poseFish(t, st);
    this.poseStraps(t);
    this.poseCut(t);
  }

  /** The sardine in the car: on its path, pushing at the glass, turning after the rail end in the hand, thrown back on the join. */
  private poseFish(t: number, st: PlayerState) {
    const { p, v, turn } = this.fishPath.at(t);
    const tail = Math.floor(t * 12) / 12;
    const j = t - this.times.jolt;
    const jolting = j > 0 && j < 1.2;
    const look = this.lookTo(t, st);
    if (jolting) {
      // on the join it is thrown back from the glass, rolls and flicks its tail, then it drifts forward again
      const kick = (1 - Math.exp(-30 * j)) * Math.exp(-1.7 * j);
      this.fish.pose(tail, p.clone().add(v3(-0.85 * kick, 0.25 * kick, 0.1 * kick)), v3(1.44, 0.32, 0), 0);
      this.fish.root.rotation.z += 0.7 * Math.sin(Math.PI * clamp01(j / 0.6)) * Math.exp(-1.5 * j);
      this.fish.root.rotation.x += 0.5 * Math.sin(Math.PI * clamp01(j / 0.7));
      return;
    }
    // at the glass it pushes: the nose stays on the pane and the tail beats hard
    const pushing = t >= T_GLASS && t < T_DRAG;
    this.fish.pose(tail, p, pushing ? v.clone().setLength(Math.max(v.length(), 1.6)) : v, turn);
    // the hand drags the rail end round: the sardine turns after it, and banks as it turns
    if (look.k > 0) {
      this.fish.root.rotation.y = THREE.MathUtils.lerp(this.fish.root.rotation.y, look.yaw, look.k);
      this.fish.root.rotation.x = THREE.MathUtils.clamp(-0.3 * look.rate, -0.6, 0.6) * look.k;
    }
  }

  /** The weld of the join and the spark of the cut, and the cut rail that springs. */
  private poseCut(t: number) {
    const wj = t < this.times.tsu ? 0 : Math.max(0, 1 - (t - this.times.tsu) / 0.3);
    const cs = t - (this.times.snip + CUT_LAG);
    const w = Math.max(wj, cs >= 0 && cs < 0.12 ? 0.35 * (1 - cs / 0.12) : 0);
    this.flash.visible = w > 0;
    this.flash.scale.setScalar(0.5 + 3 * w);
    this.flashLight.intensity = w * 900;
    // the cut rail springs: up 0.7 m with one roll about the line of the track, a small bounce, then it lies beside the track
    const c = t - (this.times.snip + CUT_LAG);
    this.sprung.visible = c >= 0 && t < this.times.tsu;
    if (this.sprung.visible) {
      const T1 = 10 / 18, T2 = 4 / 18, c2 = c - T1;
      const y = c < T1 ? 5 * c - 9 * c * c : c2 < T2 ? 2 * c2 - 9 * c2 * c2 : 0;
      const k = smooth(c / (T1 + T2));
      this.sprung.position.set(-BITE / 2 - 0.5 * k, 0.05 * (1 - k) + y - 0.1 * k, 2.6 * k);
      this.sprung.rotation.set(2 * Math.PI * smooth(c / T1), 0.45 * k, 0.3 * Math.sin(Math.PI * Math.min(1, c / T1)));
    }
  }

  /**
   * The scissors on the map: in the cursor's hand from the click on the tool until the bend tool is taken. The rail crosses the blades at the ground point
   * under the cursor. The blades open over four fifths of each beat and close on it. On ちょん the player clicks: they snap shut and stay shut.
   */
  private poseScissors(t: number, st: PlayerState) {
    const { snip } = this.times;
    const show = t >= T_TOOL + 2 / 36 && t < T_BEND;
    this.scTilt.visible = show;
    if (!show) return;
    const k = t / SPB;
    const chomp = 0.14 + 0.96 * smooth((k - Math.floor(k + 1e-6)) / 0.8);
    const open = t < snip ? chomp : 0.14 * (1 - smooth((t - snip) / 0.12));
    const g = groundUnder(this.ortho, st.cursor.x, st.cursor.y, 0.6);
    const S = 1.25;
    this.scissors.root.scale.setScalar(S);
    this.scissors.setOpen(open);
    // the lower blade lies on the ground, the upper one comes down on it; the rail crosses the blades 10 m from the pivot
    this.scissors.root.rotation.z = open / 2;
    this.scTilt.position.set(g.x, 0.6, g.z + 10 * S);
  }

  /**
   * Where the sardine looks while the player drags the rail end round: the heading (rad, in the car frame) from the sardine to the rail end in the
   * player's hand, how fast it changes (rad/s), and how far the sardine has turned to it (0..1). The rail end starts and ends ahead of the train.
   */
  private lookTo(t: number, st: PlayerState): { yaw: number; rate: number; k: number } {
    const h = st.handles.find((x) => x.id === 'bend');
    if (!h || t >= this.times.tsu) return { yaw: 0, rate: 0, k: 0 };
    const yawOf = (u: number, time: number) => {
      const e = loopAt(u * Math.PI * 2);
      const d = v3(e.x, 0, e.z).applyMatrix4(trainMatrix(time).invert());
      return Math.atan2(-(d.z - 0.3), d.x - 9);
    };
    const yaw = yawOf(h.u, t);
    const before = this.track.handlesAt(t - FR).find((x) => x.id === 'bend');
    return { yaw, rate: before ? (yaw - yawOf(before.u, t - FR)) / FR : 0, k: smooth((t - T_DRAG) / 0.35) };
  }

  /**
   * The hand straps swing as real ones do: each is a pendulum (a belt and a ring, 0.27-0.33 m to the centre of mass) that hangs from its rail and
   * feels the acceleration of the car. It leans back while the train pulls away and swings past and back when the pull starts and stops. The
   * snip and the join throw it forward. The rail joints and the sway of the body at speed jiggle it a little. The lengths differ a little, so
   * the straps go out of step after a few swings. The table is integrated once at init: a frame only reads it.
   */
  private swingStraps(): { t0: number; n: number; a: Float32Array } {
    const t0 = T_DEPART - 0.5, t1 = bar(17) + 0.5, n = Math.ceil((t1 - t0) * STRAP_HZ) + 1, m = this.strapAt.length;
    const h = 1 / STRAP_HZ, G = 9.81;
    // the effective gravity in the frame of the car (gravity minus the acceleration of the car), at each sample
    const drive = new Float32Array(n * 3);
    const inv = new THREE.Matrix4(), p = [v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 0)], g = v3(0, 0, 0);
    const jolts = [{ at: this.times.snip + CUT_LAG, a: 2.5, dur: 0.06 }, { at: this.times.tsu, a: 12, dur: 0.08 }];
    for (let k = 0; k < n; k++) {
      const t = t0 + k * h;
      [-h, 0, h].forEach((d, i) => p[i]!.setFromMatrixPosition(trainMatrix(t + d)));
      // the world acceleration of the car, then g_eff = g - a in the car frame
      g.set(0, -G, 0).sub(p[0]!.clone().add(p[2]!).addScaledVector(p[1]!, -2).divideScalar(h * h));
      const len = g.length();
      g.transformDirection(inv.copy(trainMatrix(t)).invert()).multiplyScalar(len);
      for (const j of jolts) if (t >= j.at && t < j.at + j.dur) g.x += j.a;
      // at speed: the body sways from side to side, and each bogie gives a small knock on each rail joint
      const v = speedAt(t) / VMAX, s = dist(t);
      g.z += 0.15 * v * (Math.sin(3.1 * t + 0.7) + 0.6 * Math.sin(7.7 * t + 2.1) + 0.3 * Math.sin(12.9 * t + 4.4));
      for (const b of [BOGIE, -BOGIE]) {
        const q = (s + b) / RAIL_JOINT, since = (q - Math.floor(q)) * RAIL_JOINT / Math.max(speedAt(t), 1e-3);
        if (v > 0 && since < 0.03) g.z += (hashSin(Math.floor(q), b > 0 ? 11 : 13) - 0.5) * 2.4 * v;
      }
      drive.set([g.x, g.y, g.z], k * 3);
    }
    const a = new Float32Array(n * m * 2);
    const dt = h / STRAP_SUB;
    for (let i = 0; i < m; i++) {
      const L = 0.27 + 0.06 * hashSin(i, 7), zeta = 0.06 + 0.03 * hashSin(i, 5);
      // the belt bends to swing fore and aft, but it turns freely round the rail: the fore swing has a little spring of its own
      const ws = Math.sqrt(G / L), wf = 1.15 * ws, belt = wf * wf - ws * ws;
      let f = 0, fv = 0, sd = 0, sv = 0;
      for (let k = 0; k < n; k++) {
        const gx = drive[k * 3]!, gy = drive[k * 3 + 1]!, gz = drive[k * 3 + 2]!;
        for (let u = 0; u < STRAP_SUB; u++) {
          // a planar pendulum in each plane: rotation about z moves the ring to +x, rotation about x moves it to -z
          fv += ((gx * Math.cos(f) + gy * Math.sin(f)) / L - belt * f - 2 * zeta * wf * fv) * dt;
          sv += ((-gz * Math.cos(sd) + gy * Math.sin(sd)) / L - 2 * zeta * ws * sv) * dt;
          f += fv * dt;
          sd += sv * dt;
        }
        a[(k * m + i) * 2] = f;
        a[(k * m + i) * 2 + 1] = sd;
      }
    }
    return { t0, n, a };
  }

  /** Poses the straps from the table of `swingStraps`. */
  private poseStraps(t: number) {
    const { t0, n, a } = this.strapSwing, m = this.strapAt.length;
    const q = Math.min(n - 1, Math.max(0, (t - t0) * STRAP_HZ)), k = Math.min(n - 2, Math.floor(q)), w = q - k;
    const o = this.o;
    this.strapAt.forEach(([x, z], i) => {
      const at0 = (k * m + i) * 2, at1 = ((k + 1) * m + i) * 2;
      o.position.set(x, STRAP_Y, z);
      o.rotation.set(a[at0 + 1]! + w * (a[at1 + 1]! - a[at0 + 1]!), 0, a[at0]! + w * (a[at1]! - a[at0]!));
      o.updateMatrix();
      this.straps.setMatrixAt(i, o.matrix);
    });
    this.straps.instanceMatrix.needsUpdate = true;
  }

  /**
   * The world takes the hit of the cut and of the join: the map picture jumps by whole pixels (x, y) and settles in 4 frames. The windows, the
   * toolbars and the cursor do not move: it is the ground that shakes, not the screen.
   */
  private quake(t: number): Vec2 {
    let x = 0, y = 0;
    for (const [at0, amp] of [[this.times.snip + CUT_LAG, 2], [this.times.tsu, 3]] as const) {
      const d = t - at0;
      if (d < 0 || d > 0.3) continue;
      const a = amp * Math.exp(-d / 0.06);
      x += a * Math.sin(95 * d + 1);
      y += a * Math.cos(70 * d);
    }
    return [Math.round(x), Math.round(y)];
  }

  private renderCar(win: WinState, v: LitView, t: number) {
    this.renderCarView(win.view, this.rig.aspect(win), v, t);
  }

  /** Renders the world through the camera of view `w` of the car window into `v`. */
  private renderCarView(w: number, aspect: number, v: LitView, t: number) {
    const W = this.world, cam = this.persp;
    cam.aspect = aspect;
    const c = this.cams;
    (w === VIEW.platform ? c.platform : w === VIEW.aisle ? c.aisle : w === VIEW.strip ? c.strip : c.sardine).apply(cam, t);
    // the things of the map do not stand in the world of a close view
    this.scTilt.visible = false;
    this.arrow.visible = false;
    this.mapFish.root.visible = false;
    W.light('close', 1, W.cars[0].root.position);
    v.render(this.ctx.renderer, W.scene, cam, NIGHT);
  }

  /**
   * The picture of the car window at t over the whole frame, with no part of the program (no window, no bar, no cursor, no subtitle):
   * the cover of the video (`thumbnail.ts`). The car window must be maximized at t. `dress` makes the picture a cover: it gets the
   * world, the camera in its place and the sardine (which it can pose: the next frame of the clip poses it again), and it gives the
   * things that only the cover has (a light, guests). They are in the scene for this picture only.
   */
  cover(t: number, out: THREE.WebGLRenderTarget, dress: (world: GameWorld, eye: THREE.PerspectiveCamera, sardine: Fish) => THREE.Object3D[]) {
    const st = this.rig.state(t);
    if (!st.maximized) throw new Error(`ride: the car window is not maximized at ${t} s`);
    this.poseWorld(t, st);
    this.led.update(t);
    // the first render puts the camera of the view in its place: `dress` needs it
    this.renderCarView(st.maximized.view, LW / LH, this.view, t);
    const extra = dress(this.world, this.persp, this.fish);
    this.world.scene.add(...extra);
    this.renderCarView(st.maximized.view, LW / LH, this.view, t);
    for (const o of extra) o.removeFromParent();
    this.text.clear();
    this.text.commit();
    this.view.present(this.ctx.renderer, out, { exposure: 1.05, bloom: 0.45 }, this.text);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    const t = f.t;
    const st = this.rig.state(t);
    this.poseWorld(t, st);
    this.led.update(t);
    if (!st.maximized) {
      const mc = this.mapCam;
      mc.apply(this.ortho, t);
      this.poseScissors(t, st);
      const carried = st.carry;
      this.mapFish.root.visible = !!carried;
      // in the hand the fish hangs at the cursor tip in front of the whole map, as RollerCoaster Tycoon draws a lifted guest; after the let-go it falls in the world
      if (carried) {
        const drop = dropPlan();
        poseCarriedFish(this.mapFish, carried, carried.phase !== 'drop' ? gripAt(this.ortho, carried.pos[0], carried.pos[1]) : drop.high, drop.side);
        markObject('fish:carried', this.mapFish.root, this.ortho);
      }
      this.poseHalo(t, carried);
      // the green arrow over the player's house: from the move to the house on
      this.arrow.visible = t >= T_IN;
      if (this.arrow.visible) this.arrow.pose(t, v3(HOUSE.x, 0, HOUSE.z), 12);
      this.world.light('map', smooth((t - T_NIGHT) / 0.7), mc.view(t).center);
      const [qx, qy] = this.quake(t);
      if (qx || qy) { const ppm = mc.view(t).ppm; this.ortho.translateX(qx / ppm); this.ortho.translateY(qy / ppm); }
      this.view.render(r, this.world.scene, this.ortho, MAP_SKY);
    }
    this.rig.compose(r, this.view, st, (win, v) => this.renderCar(win, v, t));
    this.text.clear();
    this.rig.draw(this.text, st, (l, s) => this.over(l, s, t));
    this.drawDay(t);
    this.text.commit();
    this.view.present(r, out, { exposure: 1.05, bloom: 0.45, top: this.rig.top }, this.text);
    return NO_FILM_POST;
  }

  /** The `DAY 1` card: on the picture from the game's start, and up and out of the frame (9 steps at 18 fps) after the cut. */
  private drawDay(t: number) {
    if (t < T_DAY0 || t >= T_START + 0.6) return;
    const up = Math.min(1, Math.floor(Math.max(0, t - T_START) * 18) / 10.8);
    const y = Math.round(28 - 56 * up);
    const m = this.day;
    const sink = this.text.sink({ 1: '#f6efdc', 2: '#1d4a6e', 3: '#0a0c14' });
    const x = Math.round(320 - (m.ink.x0 + m.ink.w / 2));
    // the card slides under the title bar and the status bar: only the rows of the picture show
    const keep = (_px: number, py: number) => py >= 10 && py < LH - 10;
    m.outer?.draw(sink, x, y, 3, keep);
    m.edge.draw(sink, x, y, 2, keep);
    m.ink.draw(sink, x, y, 1, keep);
  }

  /**
   * What the editor draws on the map (after the windows, before the tooltip and the cursor): the name tags of the stations, the yellow end nodes of the
   * cut, the dotted ring of the armed bend tool, the rail end in the player's hand, and the flash of the join at the node.
   */
  private over(l: TextLayer, s: PlayerState, t: number) {
    if (s.maximized) return;
    const { snip, tsu } = this.times;
    const mc = this.mapCam;
    const px = (x: number, z: number, y = 0): Vec2 => { const p = mc.project(v3(x, y, z), t); return [Math.round(p[0]), Math.round(p[1])]; };
    this.stationTags(l, t, px);
    const h = s.handles.find((x) => x.id === 'bend');
    if (t >= snip + CUT_LAG && t < tsu) {
      drawHandle(l, { pos: px(-BITE, 0), phase: 'released', since: 99 });
      if (!h) drawHandle(l, { pos: px(0, 0), phase: 'released', since: 99 });
    }
    // the bend tool is armed: the loop it will make shows as a faint dotted ring
    if (t >= T_OUT + OUT_DUR && t < tsu) this.ring.forEach(([x, y], i) => { if (!h || i / this.ring.length > h.u) for (let k = 0; k < 3; k++) l.rect(x - 1 + k * 3 - 3, y - 1, 2, 2, '#7fe0ff', 0.5); });
    // the cut: one ring runs out over the ground from the blades
    const ca = t - (snip + CUT_LAG);
    if (ca >= 0 && ca < 0.22) { const [cx, cy] = px(-BITE / 2, 0); dotRing(l, cx, cy, 4 + ca * 160, ca < 2 / 36 ? '#ffffff' : '#ffe6a0'); }
    this.grabFx(l, s, t);
    if (!h) return;
    if (h.phase !== 'snapped' || h.since < 0.3) drawHandle(l, h);
    if (h.phase === 'snapped' && h.since < 0.3) {
      const [cx, cy] = this.nodeC, age = h.since;
      dotRing(l, cx, cy, 5 + age * 170, age < 2 / 36 ? '#ffffff' : '#9af0ff');
      if (age > 0.05) dotRing(l, cx, cy, 3 + (age - 0.05) * 260, '#ffffff');
    }
  }

  /** The name tags on the map: the station of the stem always, the stations of the loop once it stands. `px`: a world point (x, z, height) on the screen. */
  private stationTags(l: TextLayer, t: number, px: (x: number, z: number, y?: number) => Vec2) {
    for (const id of STATION_IDS) {
      if (id !== 'iwashi' && t < this.times.tsu) continue;
      const p = routePoint(STATIONS[id].s);
      const [x, y] = px(p.x, p.z, 9);
      const name = STATIONS[id].name, w = chromeWidth(this.fonts, name, 1, this.fonts.kanaS) + 6;
      if (x < 4 || x > LW - 4 || y < 28 || y > LH - 30) continue;
      l.rect(x - (w >> 1), y - 6, w, 12, '#101018', 0.8);
      chromeText(l, this.fonts, name, x - (w >> 1) + 3, y + 4, '#fff8c0', null, { wide: this.fonts.kanaS });
    }
  }

  /** The pick-up reads at a glance: on the grab a white flash, a yellow ring and eight sparks burst from the hand. The halo (`poseHalo`) does the rest. */
  private grabFx(l: TextLayer, s: PlayerState, t: number) {
    const g = t - T_GRAB;
    if (g < 0 || g >= 0.3) return;
    const [cx, cy] = s.carry ? [Math.round(s.carry.pos[0]), Math.round(s.carry.pos[1])] : dropPlan().grab;
    if (g < 2 / 36) l.rect(cx - 5, cy - 4, 11, 9, '#ffffff');
    dotRing(l, cx, cy, 4 + g * 120, g < 2 / 36 ? '#ffffff' : '#ffd23a');
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2, r0 = 8 + g * 70, r1 = 13 + g * 110;
      for (let r = r0; r <= r1; r += 2) l.rect(Math.round(cx + Math.cos(a) * r) - 1, Math.round(cy + Math.sin(a) * r * 0.75) - 1, 2, 2, '#fff2a0');
    }
  }

  /**
   * The halo behind the sardine for the whole pick and carry: a stepped yellow glow that faces the map camera, 2 m behind the fish (the fish
   * hides its middle). It pops up on the grab, breathes on each beat and shrinks away in 0.15 s at the let-go.
   */
  private poseHalo(t: number, c: CarryState | null) {
    const out = c?.phase === 'drop' ? c.since / 0.15 : 0;
    this.halo.visible = !!c && out < 1;
    if (!this.halo.visible) return;
    const box = new THREE.Box3().setFromObject(this.mapFish.root);
    const size = box.getSize(v3(0, 0, 0)), mid = box.getCenter(v3(0, 0, 0));
    const back = v3(0, 0, -1).applyQuaternion(this.ortho.quaternion);
    this.halo.position.copy(mid).addScaledVector(back, 2);
    this.halo.quaternion.copy(this.ortho.quaternion);
    const g = t - T_GRAB;
    const pop = g < 0.12 ? 1.25 * smooth(g / 0.12) : 1.25 - 0.25 * smooth((g - 0.12) / 0.2);
    const beat = 0.07 * Math.exp(-((t / SPB) % 1) * 6);
    this.halo.scale.setScalar(0.55 * Math.max(size.x, size.y, size.z) * (pop + beat) * (1 - out));
  }

  override dispose() {
    this.view.dispose();
    this.text.dispose();
    this.route.tex.dispose();
    this.led.dispose();
    this.rig.dispose();
    this.world.dispose();
  }
}
