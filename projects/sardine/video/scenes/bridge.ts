// Bridge (clip bridge, 56.889-85.333 s, bars 33-48; it also renders [56.0, 56.889), which `night.ts` shows through
// `ctx.renderClip('bridge', t, rt)`; treatment v8 "Plate 5").
//
// Act 2 of the control story: the train is out of bounds and the player loses every action. The frame is `[Train 1 - Ride Cam]`,
// maximized. `[MAP: OUT OF BOUNDS]` (top left, `_oob.ts`) is open from the first frame to the last. `[FISH CAM]` (bottom right) opens
// when the sardine has something to see, each time with another view (`FISH_VIEWS`), and it is shut in the moon line.
// The camera is a spring arm on the train. It never moves on the music: the world does (`_bridgelights.ts`). The four lines stand
// far off as lights and as flocks (`_bridgeletters.ts`). The status bar shows the speed only.
// The cursor works through the whole bridge and loses each time: [x] of the map, a drag of the train, the fish cam, the console.
//   56.000  The tunnel, in the dark. The two windows open by themselves. The headlights come up.
//   56.889  The train leaves the unfinished ramp, in the 3/4 chase. The cursor stamps five flower walls, and the train goes through
//           each one on its syllable (`_bridgeflowers.ts`). Line 13 blooms in the sky ahead.
//   59.600  The cursor clicks [x] of the map window: CANNOT CLOSE. It does so again and again to the end.
//   61.336  The arm swings to the flat side view over one beat and is there on 61.780. Line 14: the flock of sleeping birds parts
//           round the train. In the map window the train passes the gap.
//   68.900  The player types `sv_wind 0` in the console (bottom right); Enter on 68.900. The wind stops. Frost grows on the window
//           one step on each kick, the birds and the petals freeze, the tiles of the map lose their data. A red STALL flashes.
//   71.111  The train falls through the clouds. The tuna catch it under the deck and carry it up.
//   75.111  The arm swings to the hip view: low and close beside the rear of the train, looking forward along the lit windows
//           to the moon. It holds. Line 16 is burnt into the disc, on a ring that turns.
//   81.500  The arm pushes in to a close-up of the nose. 85.100 the nose rams the disc and the cracks run over it.
//   85.333  Hard cut (the cracks go on in the CRT glass of the room, `interlude.ts`).
// Every frame is a pure function of t.
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import type { Line } from '@pve/engine/lyrics';
import { NO_FILM_POST } from '@pve/engine/post';
import { H, W, makeRT } from '@pve/engine/gl';
import { LW, LitAtlas, camera, enableShadows, litMaterial } from '@pve/engine/lit';
import { LitView } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { clamp, projectToRect, smooth } from '@pve/engine/util';
import { lineAt, loadFonts, type Fonts } from './_fonts';
import { subtitle } from './_subtitle';
import { carriedPass } from './_ticket';
import {
  FULL, centreOf, clickAt, contentRect, winButtons,
  type PlayerState, type Vec3,
  type PlayerInput, type Rect, type Vec2, type WinSpec, type WinState,
} from './_playerTypes';
import { PlayerTrack, consoleTimes } from './_playerTrack';
import { chromeText, chromeWidth } from './_playerChrome';
import { fishCamWindow } from './_playerWindows';
import { PlayerRig } from './_playerRig';
import { FishCam, MapCam, RideCam } from './_playerCams';
import { T_DIVE, T_DROP, T_END, T_FILL, T_LAUNCH, T_MOON, T_NOSE, T_PORTAL, T_PULL, T_START, T_SWING, T_WALLS, T_WIND, TrainPath } from './_bridgepath';
import { SPB } from './_time';
import { BridgeWorld } from './_bridgeworld';
import { BridgeLights, rayOf, type BridgeMidi } from './_bridgelights';
import { BassHeave } from './_bassheave';
import { FarLine, FlockLine, MoonRing, type FarKind } from './_bridgeletters';
import { OobWorld } from './_oob';
import { Frost } from '@pve/engine/frost';
import { aimRide, popup, rideWindow } from './_sceneKit';

/** The map window: top left, under the title bar of the maximized window. */
const MAP_RECT: Rect = [4, 14, 156, 100];
/** The `[FISH CAM]` window: bottom right, over the status bar. The sky and the moon stay clear of it in every view. The console stands left of it. */
const FISH_RECT: Rect = [464, 208, 172, 110];
/** The cursor at the end of the clip before: on the map, at the rim of the hole. */
const CURSOR0: Vec2 = [547, 67];
/** The windows open 2 frames before 56.000, so that they are whole on the first frame of the bridge. */
const T_OPEN = T_PORTAL - 2 / 36 - 0.001;
/** The refused clicks on [x] of the map window (CANNOT CLOSE). */
const T_DENY = [59.6, 60.45, 69.8, 70.3, 77.0, 79.5, 82.0] as const;
/** The console command that stops the wind: Enter falls exactly on T_WIND. The second command, in the fall, is refused. */
const CMD = 'sv_wind 0', CMD2 = 'sv_wind 1';
const T_CONSOLE = T_WIND - consoleTimes(0, CMD).enter;
const T_CONSOLE2 = 71.25;
/**
 * The views of `[FISH CAM]`: when the window is open, the side of the car that the lens looks out of, and the eye and the look point
 * as offsets from the sardine. The player always shuts it with [x]; the last view (`to` null) stays open into the hard cut.
 */
const FISH_VIEWS: readonly { id: string; from: number; to: number | null; side: 1 | -1; eye: Vec3; look: Vec3; fov: number }[] = [
  // out of the left windows, at the flower walls
  { id: 'fish-flower', from: T_PORTAL - 2 / 36 - 0.001, to: 61.1, side: 1, eye: [-0.9, 0.25, -0.75], look: [0.7, 0, 0.9], fov: 46 },
  // across the car, out of the right windows, at the flock
  { id: 'fish-bird', from: 62.3, to: 66.9, side: -1, eye: [-0.7, 0.2, -0.6], look: [0.8, 0, 2.2], fov: 44 },
  // the sardine at the front glass when the wind stops: the lens is in the cab, behind it
  { id: 'fish-wind', from: 68.35, to: 70.85, side: 1, eye: [-0.65, 0.2, 0.3], look: [1.5, -0.1, 0.3], fov: 64 },
  // down the car as it falls, from the door of the cab
  { id: 'fish-fall', from: 71.0, to: 72.7, side: 1, eye: [-0.9, 0.05, -0.3], look: [-5, -0.6, -0.3], fov: 58 },
  // a tuna at the front glass at the catch
  { id: 'fish-tuna', from: 73.3, to: 74.5, side: 1, eye: [-0.65, 0.2, 0.3], look: [1.5, -0.1, 0.3], fov: 64 },
  // the moon in the front glass
  { id: 'fish-moon', from: 74.75, to: 76.3, side: 1, eye: [-0.65, 0.2, 0.3], look: [1.5, 0.15, 0.3], fov: 64 },
  // the ram: the sardine's view out of the front glass as the nose closes on the disc, open until the hard cut
  { id: 'fish-ram', from: 83.0, to: null, side: 1, eye: [-0.65, 0.2, 0.3], look: [1.5, 0.05, 0.3], fov: 70 },
];
/** The hip view: the arm starts its swing two beats before the moon line. */
const T_HIP = T_MOON - 2 * SPB;
/** The error messages blink with the music: on for the first half of each beat, off for the second half. */
const onBeat = (t: number) => Math.floor(t / (SPB / 2)) % 2 === 0;
/** The map window shows 250 m of the void across: px for each metre. */
const MAP_PPM = 0.62;
/** The far rows of lines 13 to 15: the kind, the place in the frame, the size of a font pixel (px), and the time whose camera sets the place. */
const ROWS: { kind: FarKind; ndc: readonly [number, number]; px: number; at?: number }[] = [
  // the top of the sky, right of the map window, over the flower walls. The camera levels out through the line, so the row rises: it is at the top at the end of the line
  { kind: 'flower', ndc: [-0.06, 0.8], px: 2.2, at: 60.9 },
  { kind: 'bird', ndc: [0.14, 0.58], px: 1.9 },
  { kind: 'ice', ndc: [0.14, 0.56], px: 1.8, at: 70.0 },
];
const ROW_DIST = 1300;
/**
 * Line 16: where each glyph is in the frame when its syllable lands (-1..1 each way), and its height there in px. The first two phrases
 * are for the hip view (the disc is the right half of the frame, the train the lower left). The last five are for the close-up of the nose
 * (the train is the lower left, the disc is all of the rest).
 */
const MOON_NDC: readonly (readonly [number, number, number])[] = [
  [0.2, 0.42, 24], [0.325, 0.52, 24], [0.45, 0.58, 24], [0.575, 0.58, 24], [0.7, 0.52, 24], [0.825, 0.42, 24],
  [0.15, 0.2, 26], [0.32, 0.26, 26], [0.5, 0.2, 26],
  // る, the last: right of わ (which has moved in by then) and as big as わ is by then, above the glare of the ram
  [0.0, 0.62, 30], [0.28, 0.66, 30], [0.55, 0.6, 30], [0.75, 0.4, 30], [0.84, 0.42, 56],
];
/** The time at which る, the last glyph of line 16, is heard (s). */
const RU_HEARD = 84.9;

/** The ride camera of the bridge: the chase, the side view, the hip view and the close-up of the nose, all on one spring arm. */
export function bridgeRide(path: TrainPath, kicks: readonly number[] = []): RideCam {
  return new RideCam({
    pose: (t: number) => path.armMatrix(t),
    kicks,
    // the car takes the rail joints only where there are rails: the tunnel and the ramp
    onRails: (t: number) => t < T_LAUNCH,
    kickAmp: 0.08,
    // a wall is a soft hit; the ram is the largest one. The car and the disc take the hits: the camera moves by 2 px at most
    impacts: [...T_WALLS.map((at) => ({ at, amp: 0.08 })), { at: T_DIVE, amp: 0.06 }],
    mode: [
      { at: 0, mode: 'chase34' },
      { at: T_SWING - SPB, mode: 'side', swing: SPB },
      { at: T_HIP, mode: 'low', swing: 2 * SPB },
      { at: T_NOSE, mode: 'nose', swing: T_DIVE - 0.6 - T_NOSE },
    ],
    offsets: {
      chase34: { eye: [-15, 4.8, 10], look: [5, 3, -0.8], fov: 48, lag: 0.14 },
      side: { eye: [1.5, 3.0, 26], look: [0.5, 1.8, 0], fov: 38, lag: 0.1 },
      low: { eye: [-13, 1.0, 4.6], look: [8, 3.6, -0.6], fov: 42, lag: 0.16 },
      nose: { eye: [1.5, 4.4, 7.5], look: [13, 1.6, -2.5], fov: 50, lag: 0.1 },
    },
  });
}

/** Aims `cam` as the maximized ride window shows the bridge at t. */
function aim(ride: RideCam, cam: THREE.PerspectiveCamera, t: number): THREE.PerspectiveCamera {
  const c = contentRect(FULL, true);
  return aimRide(ride, cam, t, c[2] / c[3]);
}

/** The pixel of the frame (640x360) where the train hits the moon, on the last frame of the bridge. The crack of the CRT glass starts there. */
export function moonImpactPx(path: TrainPath): Vec2 {
  const c = contentRect(FULL, true);
  const cam = aim(bridgeRide(path), camera(44, 0.3, 4000), T_END - 1 / 36);
  const v = path.moon.scratch.clone().project(cam);
  return [Math.round(c[0] + clamp(v.x * 0.5 + 0.5, 0.1, 0.9) * c[2]), Math.round(c[1] + clamp(0.5 - v.y * 0.5, 0.1, 0.9) * c[3])];
}

export default class Bridge extends Scene {
  private A = new LitAtlas(2048);
  private mat = litMaterial(this.A);
  private view = new LitView();
  private text = new TextLayer();
  private fonts!: Fonts;
  private lines: Line[] = [];
  private path = new TrainPath();
  private world!: BridgeWorld;
  private oob!: OobWorld;
  private lights!: BridgeLights;
  private heave!: BassHeave;
  private rows: (FarLine | FlockLine)[] = [];
  private ring!: MoonRing;
  private track!: PlayerTrack;
  private rig!: PlayerRig;
  private mapCam!: MapCam;
  private frost!: Frost;
  private persp = camera(44, 0.3, 4000);
  private scratch = camera(44, 0.3, 4000);
  /** The fish cam has its own camera: it sets a short far plane, which must not reach the ride view. */
  private fishLens = camera(36, 0.03, 400);
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1);
  private ride!: RideCam;
  private fish = new Map<string, FishCam>();

  override async init() {
    enableShadows(this.ctx.renderer);
    this.fonts = await loadFonts(this.ctx.assets);
    this.lines = this.ctx.lyrics.lines.slice(13, 17);
    const midi = (await (await fetch(`${this.ctx.assets}midi.json`)).json()) as BridgeMidi;
    const kicks = [...new Set(midi.notes.filter((n) => n.track === 19).map((n) => n.start))].sort((a, b) => a - b);
    this.world = new BridgeWorld(this.A, this.mat, this.path);
    this.world.fish.hold(carriedPass(this.fonts, true).root);
    // the drum fill of bar 40: the hits of the snare from 70.2 to the fall
    const fill = [...new Set(midi.notes.filter((n) => n.track === 18 && n.start >= T_FILL + 0.8 && n.start < T_DROP - 0.01).map((n) => n.start))].sort((a, b) => a - b);
    await this.world.init(fill);
    this.frost = new Frost(FULL[2], FULL[3] - 20, 40);
    this.ride = bridgeRide(this.path, kicks);
    for (const v of FISH_VIEWS) {
      this.fish.set(v.id, new FishCam({
        pose: (t: number) => this.path.matrix(t), fish: (t: number) => this.world.fishLocal(t), kicks: kicks.filter((k) => k < T_LAUNCH),
        window: v.side, eye: v.eye, look: v.look, fov: v.fov,
      }));
    }
    const camAt = (t: number) => aim(this.ride, this.scratch, t);
    this.lights = new BridgeLights(this.A, this.mat, this.path, midi, camAt, this.world.peaks);
    this.world.scene.add(this.lights.root);
    // the bass rumbles the ground and the cloud deck: they take its material
    this.heave = new BassHeave(this.A, this.path, midi);
    this.world.terrain.material = this.heave.mat;
    this.world.clouds.material = this.heave.mat;
    const viewH = contentRect(FULL, true)[3];
    for (const [k, r] of ROWS.entries()) {
      const spec = { line: this.lines[k]!, kind: r.kind, ndc: r.ndc, px: r.px, dist: ROW_DIST, viewH, ...(r.at !== undefined ? { at: r.at } : {}) };
      let row: FarLine | FlockLine;
      if (r.kind === 'bird') {
        const flock = new FlockLine(this.fonts.kana, spec, camAt);
        flock.useBake(await this.ctx.memo(`flock${k}`, () => flock.bake()));
        row = flock;
      } else row = new FarLine(this.fonts.kana, spec, camAt, this.lights.arpTimes, this.lights.kicks);
      this.rows.push(row);
      this.world.scene.add(row.mesh);
    }
    // line 16 stands on the part of the disc that the camera sees with nothing in front of it. Each glyph has a place in the frame of
    // the camera at the time of its syllable (clear of the train, of the map window and of the English line), and it is burnt into the
    // disc where that place is. From then on it stays on the disc.
    const moonLine = this.lines[3]!;
    const M = this.path.moon;
    const mRight = new THREE.Vector3(0, 1, 0).cross(M.normal).normalize(), mUp = M.normal.clone().cross(mRight);
    // る is heard at 84.9 s; the calibration has it at 85.124 (the end of わ). The glyph lands when it is heard
    const starts = moonLine.written!.units.map((u, k, all) => (k === all.length - 1 ? RU_HEARD : u.start));
    const places = starts.map((at, k) => {
      const [nx, ny, px] = MOON_NDC[k]!;
      const c = camAt(at);
      const d = rayOf(c, nx, ny);
      const far = M.centre.clone().sub(c.position).dot(M.normal) / d.dot(M.normal);
      const rel = c.position.clone().addScaledVector(d, far).sub(M.centre);
      let x = rel.dot(mRight) / M.radius, y = rel.dot(mUp) / M.radius;
      const r = Math.hypot(x, y);
      if (r > 0.86) { x *= 0.86 / r; y *= 0.86 / r; }
      return { x, y, size: px * ((far * 2 * Math.tan(THREE.MathUtils.degToRad(c.fov) / 2)) / viewH) };
    });
    this.ring = new MoonRing(this.fonts.kana, { line: moonLine, radius: this.path.moon.radius, places, starts }, this.lights.arpTimes);
    this.world.moonFrame.add(this.ring.mesh);
    this.oob = new OobWorld(this.A, this.mat, this.world.shared, this.path, this.lights.kicks, this.lights.snares);
    this.buildPlayer();
    this.warm();
  }

  /**
   * Compiles the world with every effect shown once, then draws one frame of each part of the clip, so no frame pays for a program
   * (the GPU makes a program ready at its first draw, not when three compiles it).
   */
  private warm() {
    this.lights.root.traverse((o) => { o.visible = true; });
    for (const r of this.rows) r.mesh.visible = true;
    this.ring.mesh.visible = true;
    this.ctx.renderer.compile(this.world.scene, aim(this.ride, this.persp, T_MOON));
    this.ctx.renderer.compile(this.oob.scene, this.ortho);
    const rt = makeRT(W, H);
    for (const t of [T_START + 0.5, T_LAUNCH + 1, T_SWING + 1, T_WIND + 0.05, T_DROP + 0.5, T_PULL + 0.5, T_MOON + 1, T_NOSE + 0.5]) this.render({ t } as Frame, rt);
    rt.dispose();
  }

  /** The point `p` of the world as a pixel of the maximized window at time t. */
  private screenOf(t: number, p: THREE.Vector3): Vec2 {
    const c = contentRect(FULL, true);
    const v = p.clone().project(aim(this.ride, this.scratch, t));
    return projectToRect(v, c);
  }

  /** The status bar of the ride window: dry telemetry, the speed only. The train stands still while the wind is stopped. */
  private status(t: number): string {
    const kmh = t >= T_WIND && t < T_DROP ? 0 : Math.round(this.path.speed(t) * 3.6);
    return `CAR 1  ${kmh} km/h`;
  }

  /** The x of the train as the game stores it: a 16-bit integer of centimetres. It overflows to -32768 past 327.67 m. */
  private storedX(t: number): number {
    const cm = Math.round(this.path.at(t).p.x * 100);
    return ((((cm + 32768) % 65536) + 65536) % 65536) - 32768;
  }

  /** The one warning of the stall: a red STALL that blinks on the beat (`onBeat`), low in the picture, from the stop of the wind until the tuna have the train. */
  private drawStall(l: TextLayer, c: Rect, t: number) {
    if (t < T_WIND + 0.3 || t >= T_PULL || !onBeat(t)) return;
    const msg = 'STALL';
    const mw = chromeWidth(this.fonts, msg, 2);
    // under the train of the side view, over the console and the fish cam
    const mx = c[0] + Math.round((c[2] - mw) / 2), my = c[1] + c[3] - 96;
    l.rect(mx - 6, my - 16, mw + 12, 22, '#3a0608');
    chromeText(l, this.fonts, msg, mx, my, '#ff3a3a', null, { n: 2 });
  }

  private buildPlayer() {
    const ride = rideWindow([40, 30, 560, 300], (t) => this.status(t), (l, c, t) => {
      const p = this.lights.frost(t);
      if (p > 0) this.frost.draw(l, c[0], c[1], p);
      this.drawStall(l, c, t);
    });
    const map: WinSpec = {
      id: 'map', title: '[MAP: OUT OF BOUNDS]', rect: MAP_RECT, body: { kind: 'view' },
      status: (t) => `X ${this.storedX(t)}  Y ${Math.round(this.path.at(t).p.y * 100)}`,
    };
    const inputs: PlayerInput[] = [
      { at: -1, kind: 'open', win: ride, maximized: true },
      { at: -1, kind: 'tool', tool: 'flower' },
      // the game opens the map window by itself: the train has left the map
      { at: T_OPEN, kind: 'open', win: map, origin: [80, 64] },
      { at: 0, kind: 'follow', on: true },
    ];
    // the fish cam: the game opens it each time, and the player shuts it with [x]
    const fishClose = centreOf(winButtons(FISH_RECT, false).close);
    for (const v of FISH_VIEWS) inputs.push(...popup(fishCamWindow({ id: v.id, rect: FISH_RECT, clock: v.from }), v.from, v.to, fishClose, [550, 262]));
    // the flower tool: the cursor stamps a wall ahead of the nose, a little before the train reaches it
    this.world.flowers.stamps.forEach((at, k) => {
      const p = this.screenOf(at, this.world.flowers.centres[k]!);
      inputs.push(...clickAt(at, [clamp(p[0], 170, 450), clamp(p[1], 60, 290)], { dur: 0.14 }));
    });
    inputs.push({ at: T_WALLS[T_WALLS.length - 1]! + 0.06, kind: 'tool', tool: null });
    // the player tries to close the map: refused, every time
    const close = centreOf(winButtons(MAP_RECT, false).close);
    for (const at of T_DENY) inputs.push(...clickAt(at, close), { at, kind: 'denyClose', id: 'map' });
    // the player takes the train on the map and drags: the train does not come. The marker is in the middle of the map window
    const marker = centreOf(contentRect(MAP_RECT, false));
    inputs.push({ at: 62.6, kind: 'tool', tool: 'pickup' });
    for (const [at, by] of [[63.3, [-46, 22]], [64.5, [-58, 30]], [65.7, [-30, -34]]] as const) {
      inputs.push({ at: at - 2 / 36, kind: 'move', to: marker, dur: 0.3 }, { at, kind: 'drag', to: [marker[0] + by[0], marker[1] + by[1]], dur: 0.55 });
    }
    inputs.push({ at: 66.5, kind: 'tool', tool: null });
    // the player stops the wind in the console: Enter on T_WIND. In the fall the player asks for the wind back: refused
    inputs.push({ at: T_CONSOLE, kind: 'console', cmd: CMD, reply: 'sv_wind = 0.0' });
    inputs.push({ at: T_CONSOLE2, kind: 'console', cmd: CMD2, reply: 'ERR  sv_wind IS READ ONLY' });
    // the moon line: the player clicks on the disc to stop it, pulls at the train, and hammers on the nose
    const moonPx = (t: number) => { const p = this.screenOf(t, this.path.moon.centre); return [clamp(p[0], 200, 600), clamp(p[1], 40, 250)] as Vec2; };
    for (const at of [77.78, 78.22, 78.67]) inputs.push(...clickAt(at, moonPx(at), { dur: 0.2 }));
    const car = (t: number) => { const p = this.screenOf(t, this.path.at(t).p.clone().add(new THREE.Vector3(0, 2, 0))); return [clamp(p[0], 60, 580), clamp(p[1], 40, 300)] as Vec2; };
    inputs.push({ at: 80.3, kind: 'tool', tool: 'pickup' }, { at: 80.6, kind: 'move', to: car(80.6), dur: 0.3 }, { at: 80.66, kind: 'drag', to: [car(80.6)[0] - 90, car(80.6)[1] + 30], dur: 0.7 }, { at: 81.5, kind: 'tool', tool: null });
    for (const at of [83.11, 83.33, 83.56, 83.78]) inputs.push(...clickAt(at, car(at), { dur: 0.12 }));
    // the panic before the ram: bursts of clicks on the sixteenths, on [x] of the map (refused), on [x] of the fish cam (refused),
    // then on the nose. A burst is one dash (as fast as a hand goes: the track starts it early enough) and presses where the cursor is
    const s16 = SPB / 4;
    const burst = (at: number, to: Vec2, n: number, deny: string | null) => {
      inputs.push({ at, kind: 'move', to, dur: 0.04 });
      for (let k = 0; k < n; k++) {
        inputs.push({ at: at + k * s16, kind: 'click' });
        if (deny) inputs.push({ at: at + k * s16, kind: 'denyClose', id: deny });
      }
    };
    burst(84.0, close, 3, 'map');
    burst(84.0 + 4 * s16, fishClose, 3, 'fish-ram');
    burst(84.0 + 8 * s16, car(84.0 + 8 * s16), 2, null);
    this.track = new PlayerTrack(inputs, { cursor: CURSOR0, speed: 'play' });
    this.rig = new PlayerRig({ track: this.track, fonts: this.fonts, ticker: '', counter: '', consoleInset: LW - FISH_RECT[0] + 4 });
    // The map follows the marker. The view is dimetric (yaw -1, pitch 30 degrees): the ground point is shifted along the screen-up
    // direction by 1.2247 m for each metre of height, so that the marker (not the ground under it) is in the middle of the window.
    const follow = (t: number) => {
      const p = this.path.at(t).p, lift = 1.2247 * (p.y + 1.9);
      return new THREE.Vector3(p.x + lift, 0, -lift);
    };
    const f0 = follow(T_PORTAL);
    this.mapCam = new MapCam(this.track, { center: [f0.x, f0.z], zoom: 0, notches: [MAP_PPM], yaw: -1, lag: 0.3, follow });
  }

  // ---------------------------------------------------------------- frame

  private renderWin(win: WinState, v: LitView, t: number) {
    const r = this.ctx.renderer;
    if (win.id === 'map') {
      this.mapCam.apply(this.ortho, t, win.content[2], win.content[3]);
      this.oob.pose(t, this.ortho.quaternion);
      v.render(r, this.oob.scene, this.ortho, { zenith: '#04050c', horizon: '#04050c', ground: '#04050c' });
      return;
    }
    const fish = this.fish.get(win.id);
    const cam = fish ? this.fishLens : this.persp;
    cam.aspect = this.rig.aspect(win);
    (fish ? fish : this.ride).apply(cam, t);
    cam.aspect = this.rig.aspect(win);
    cam.updateProjectionMatrix();
    const sky = this.world.look(t, this.path.at(t).p);
    // the stars jump on the kicks
    v.render(r, this.world.scene, cam, { ...sky, stars: (sky.stars ?? 0) * this.lights.stars(t) });
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    const t = f.t;
    this.world.pose(t);
    this.lights.pose(t);
    this.heave.pose(t);
    for (const row of this.rows) row.pose(t);
    this.ring.pose(t);
    const st = this.rig.state(t);
    this.sag(st, t);
    this.rig.compose(r, this.view, st, (win, v) => this.renderWin(win, v, t));
    this.text.clear();
    this.rig.draw(this.text, st);
    this.drawMapText(st.windows.find((w) => w.id === 'map'), t);
    const ln = lineAt(this.lines, t);
    if (ln) subtitle(this.text, this.fonts, ln, t);
    this.text.commit();
    // the first frames: the dark of the tunnel, then the headlights
    const fade = 0.6 * (1 - smooth((t - T_START) / 0.3));
    this.view.present(r, out, { exposure: 1.05, bloom: 0.55, fade, top: this.rig.top }, this.text);
    return NO_FILM_POST;
  }

  /**
   * The small windows feel the stall: when the wind stops, and harder when the train falls, they jump up, sag some pixels and come
   * back slowly.
   */
  private sag(st: PlayerState, t: number) {
    let dy = 0;
    for (const [at, amp] of [[T_WIND, 0.5], [T_DROP, 1]] as const) {
      const tau = t - at;
      if (tau < 0 || tau > 2.2) continue;
      dy += amp * (tau < 2 / 36 ? -5 : 9 * smooth((tau - 2 / 36) / 0.12) * (1 - smooth((tau - 0.3) / 1.8)));
    }
    dy = Math.round(dy);
    if (dy === 0) return;
    for (const w of st.windows) {
      if (w.maximized) continue;
      w.rect = [w.rect[0], w.rect[1] + dy, w.rect[2], w.rect[3]];
      w.content = [w.content[0], w.content[1] + dy, w.content[2], w.content[3]];
      w.box = [w.box[0], w.box[1] + dy, w.box[2], w.box[3]];
    }
  }

  /** The text over the picture of the map window: the sign of the disused platform under the gap, and the red line that blinks on the beat (`OUT OF BOUNDS`, `NO DATA` once the tiles lose their texture). */
  private drawMapText(win: WinState | undefined, t: number) {
    if (!win || win.grow < 1) return;
    const [x, y, w, h] = win.content;
    const outline = (s: string, px: number, py: number, ink: string) => chromeText(this.text, this.fonts, s, px, py, ink, '#000000', { clip: win.content });
    // the sign: where the map camera of this frame shows the platform
    const g = this.oob.gapAt.clone().setY(this.oob.gapAt.y - 24).project(this.ortho);
    const [gx, gy] = projectToRect(g, win.content);
    const sign = '廃駅';
    const sw = chromeWidth(this.fonts, sign);
    if (gx > x + 4 && gx + sw < x + w - 4 && gy > y + 14 && gy < y + h - 4) {
      this.text.rect(gx - 3, gy - 11, sw + 6, 14, '#d8d4c8');
      this.text.rect(gx - 3, gy - 11, sw + 6, 1, '#5a5a62');
      this.text.rect(gx - 3, gy + 2, sw + 6, 1, '#5a5a62');
      chromeText(this.text, this.fonts, sign, gx, gy, '#26262c', null, { clip: win.content });
    }
    // the place labels of the map application: each is cut off where its tile ends
    for (const lb of this.oob.labels) {
      const p = lb.at.clone().project(this.ortho);
      const [lx, ly] = projectToRect(p, win.content);
      const x0 = Math.max(lx, x + 1), x1 = Math.min(lx + lb.cut, x + w - 1);
      if (x1 - x0 < 6 || ly < y + 9 || ly > y + h - 14) continue;
      chromeText(this.text, this.fonts, lb.text, lx, ly, '#5a564a', null, { clip: [x0, y, x1 - x0, h] });
    }
    // the scale bar: 50 m
    const bw = Math.round(50 * MAP_PPM), bx = x + w - bw - 5, by = y + 7;
    this.text.rect(bx - 1, by - 3, bw + 2, 5, '#000000');
    this.text.rect(bx, by - 1, bw, 1, '#ffffff');
    this.text.rect(bx, by - 2, 1, 3, '#ffffff');
    this.text.rect(bx + bw - 1, by - 2, 1, 3, '#ffffff');
    outline('50 M', bx - this.fonts.latin.width('50 M') - 3, by + 2, '#ffffff');
    if (t < T_LAUNCH + 0.12 || !onBeat(t)) return;
    const s = this.oob.lost(t) > 0 && t < T_MOON ? 'NO DATA' : 'OUT OF BOUNDS';
    outline(s, x + Math.floor((w - this.fonts.latin.width(s)) / 2), y + h - 5, '#ff3a3a');
  }

  override dispose() {
    this.view.dispose();
    this.text.dispose();
    this.rig.dispose();
    this.world.dispose();
    this.lights.dispose();
    this.heave.dispose();
    this.oob.dispose();
    for (const r of this.rows) r.dispose();
    this.ring.dispose();
  }
}
