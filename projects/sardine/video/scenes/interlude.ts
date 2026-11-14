// Interlude (clip interlude, 85.333-92.444 s, bars 49-52) and Verse 2 (clip verse_2, 92.444-106.667 s, bars 53-60); treatment v9
// "Plate 6 - interlude" and "Plate 7 - verse 2". One scene module for both clips: each instance builds only what its time window
// needs, and the frame is a pure function of t, so the two clips join without a seam at 92.444.
// The game picture is the one game world (`_gameWorld.ts`) in its twisted state.
//
//   85.333  Hard cut from the moon to the real room at deep night: the eye starts at the glass and the head jerks back to the
//           kotatsu. The cracks of the ram stay on the CRT glass. The CRT holds the last frame of the bridge for 0.27 s (the game
//           hangs), then shows the map: the stem is in pieces, thrown about.
//   85.556  The head looks left, at the speed of a person. A box beside the TV is there twice (a missing texture).
//   86.222  The head looks back. `RETRY 1/3` jumps on every beat on the CRT.
//   87.111  The head looks right: a sardine hangs still under the ceiling, like a model with no animation.
//   88.000  The head looks back. `RETRY 2/3`.
//   88.889  The push into the glass. On the frame the glass fills (89.249) the picture is the game's own: no cross-fade.
//   89.333  The green map, full frame. `RETRY 3/3`: the pieces of the stem settle across the loop on pillars, turned over. READ OK.
//   90.667  The modal CONTINUE / DAY 1. The game is paused: the train stands.
//   92.000  The cursor clicks CONTINUE. The train is at speed at once. The map camera goes down to it in one smooth move and is
//           the ride cam on 92.444 (one camera: a long lens far off that comes in and opens).
//   92.444  `[Train 1 - Ride Cam]` maximized and `[MAP: MÖBIUS]` (top right, the day counter in its status bar). One ride with no
//           stop at 158 km/h. Lines 17-20 are on LED gantries over the track (`_gantry.ts`). Posts whip past, the wheels raise dust,
//           and the two counter-melody voices play the world (`_versefx.ts`): lamps ahead of the train, sparks under it.
//           Line 17: through Station ホーム, up onto the crossing, over with it: the train hangs under the track and the fields are
//           overhead. Line 18: it turns upright and comes down, and runs Station すのこ through. The day counter jumps on each
//           kick and the light of the world jumps with it (day, dusk, night). Line 19: on, at night.
//   101.111 Line 20, the last gantry. The train is too fast for the bend: it slides out and goes into Station もと on 101.778.
//           The cars clip through the platform (its blocks flicker) and fall under the map. The camera goes with them.
//   102.4   Platform 8 (`_platform8.ts`): the cars come through the ceiling of a white tiled corridor and slide along it on their
//           sides. Line 21 is on the yellow signs that they slide under. The minimap has rings at もと.
//   105.111 `LOAD ERROR`; on every kick the player tries LOAD STATE: the cars are back at the start of the corridor, and one thing
//           in it is not as it was. On the hits of the fill the cars jump a step back.
//   106.224 The last dialog carries line 22, and the jellyfish comes down onto its title bar and takes it.
//
// The parts: the clock (`_interludeClock.ts`), the room (`_interludeRoom.ts`), the train and its fault (`_interludeTrain.ts`), the
// world of verse 2 (`_interludeVerse.ts`) and the maps (`_interludeMap.ts`).
// The English line is drawn last by `subtitle`. The room shots have no lyric and no game chrome.
import * as THREE from 'three';
import { Scene, type Frame, type SceneCtx } from '@pve/engine/scene';
import { hashSin, smooth } from '@pve/engine/util';
import { metric } from '@pve/engine/marks';
import type { Line } from '@pve/engine/lyrics';
import { NO_FILM_POST } from '@pve/engine/post';
import { BlendCamera } from '@pve/engine/blendcam';
import { LH, LW, camera, col, enableShadows, setLitTexture, v3, type Col } from '@pve/engine/lit';
import { LitView, type Output, type Sky } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { FR } from './_time';
import { loadFonts, type Fonts } from './_fonts';
import { T_HIT, V0 } from './_wreck';
import { centreOf, clickAt, type PlayerInput, type Rect, type WinSpec, type WinState } from './_playerTypes';
import { PlayerTrack } from './_playerTrack';
import { continueModal, loadErrorModal, modalButton } from './_playerWindows';
import { PlayerRig } from './_playerRig';
import { RideCam } from './_playerCams';
import { GameWorld, LOOPED } from './_gameWorld';
import { GROUND_Y } from './_station';
import type { VerseNote } from './_versefx';
import { MAP_SKY, RIDE_RECT, aimRide, rideWindow, warmFrames } from './_sceneKit';
import {
  LOAD_GROW, LOAD_WAVE, PEEK, T_CLICK, T_HANG, T_INSIDE, T_JELLY, T_LOADERR, T_MODAL, T_SKIP0, T_SKIP1, T_SLIDE, T_START, T_VERSE, TRIES,
  loadFlash,
} from './_interludeClock';
import { InterludeTrain } from './_interludeTrain';
import { InterludeRoom } from './_interludeRoom';
import { ERR_AT, VerseWorld } from './_interludeVerse';
import { InterludeMaps } from './_interludeMap';

/** The bridge frame that the CRT holds (the last frame of the bridge clip). */
const T_MOON = T_START - 1.5 * FR;
/** The day counter: it stands until line 18, then jumps on each kick. */
const DAYS = ['DAY 004', 'DAY 007', 'DAY 012', 'DAY 019', 'DAY 033', 'DAY 061', 'DAY 108', 'DAY 211', 'DAY 999'];
/** The light of the days that go by: the day, the dusk, the night. */
const HOURS = ['day', 0, 1] as const;
const SKIES: Record<'day' | 'dusk' | 'night', Sky> = {
  day: { zenith: '#2f6fd0', horizon: '#a9d2f2', ground: '#4a6a3a' },
  dusk: { zenith: '#2a2058', horizon: '#e07a44', ground: '#2a1c30' },
  night: { zenith: '#05081f', horizon: '#1a2a62', ground: '#0a0f1e', stars: 1 },
};
const MINI_RECT: Rect = [480, 14, 156, 100];
/** The duet of verse 2 (对唱, tracks of `midi.json`): the higher voice (it comes in first) plays the sky, the lower one the ground. */
const VOICE_SKY = 8, VOICE_GROUND = 9;

export default class Interlude extends Scene {
  /** True: the CRT holds the last frame of the bridge clip for the first 0.27 s. A bench scene without the bridge clip sets it to false before `init`. */
  freezeBridge = true;

  private fonts!: Fonts;
  private lines: Line[] = [];
  private view = new LitView();
  private text = new TextLayer();
  private persp = new BlendCamera(40, LW / LH, 0.2, 6000);
  private scratch = camera(40, 0.2, 6000);
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1);
  private train = new InterludeTrain();
  private rig!: PlayerRig;
  private maps!: InterludeMaps;
  private kicks: number[] = [];
  private skips: number[] = [];
  private voices: { sky: VerseNote[]; ground: VerseNote[]; under: { sky: VerseNote[]; ground: VerseNote[] } } = { sky: [], ground: [], under: { sky: [], ground: [] } };

  // the game world
  private world!: GameWorld;
  private ride!: RideCam;
  private exposure = 1;
  private bloom = 0.5;
  /** The room (interlude clip only). */
  private room: InterludeRoom | null = null;
  /** The world of verse 2 (verse 2 clip only). */
  private verse: VerseWorld | null = null;

  constructor(ctx: SceneCtx) { super(ctx); }

  override async init() {
    enableShadows(this.ctx.renderer);
    this.fonts = await loadFonts(this.ctx.assets);
    this.lines = this.ctx.lyrics.lines.slice(17, 22);
    const midi = (await (await fetch(`${this.ctx.assets}midi.json`)).json()) as { notes: { track: number; start: number; end: number; pitch: number }[] };
    this.kicks = [...new Set(midi.notes.filter((n) => n.track === 19).map((n) => Math.round(n.start * 1000)))].sort((a, b) => a - b).map((ms) => ms / 1000);
    this.skips = this.kicks.filter((k) => k >= T_SKIP0 - 1e-3 && k < T_SKIP1);
    // the ride plays the duet to the hit at Station もと; under the station, Platform 8 plays it (the voices go in unison there) to the first failed load
    const voice = (track: number, from: number, to: number) => midi.notes.filter((n) => n.track === track && n.start >= from - 1e-3 && n.start < to).sort((a, b) => a.start - b.start);
    this.voices = {
      sky: voice(VOICE_SKY, T_VERSE, T_HIT), ground: voice(VOICE_GROUND, T_VERSE, T_HIT),
      under: { sky: voice(VOICE_SKY, T_HIT, T_LOADERR), ground: voice(VOICE_GROUND, T_HIT, T_LOADERR) },
    };

    this.world = new GameWorld(this.fonts);
    this.world.buildTwist();
    this.world.pose(LOOPED);
    this.world.setLamps(true);
    this.ride = new RideCam({
      pose: (t: number) => this.train.camMatrix(t),
      // behind the train, the whole way: on the ride, through the fault, down through the ground and along the corridor (`camMatrix`)
      mode: 'chase34',
      offsets: { chase34: { eye: [-17, 5.4, 4.5], look: [10, 3.4, 0], fov: 52, lag: 0.14 } },
    });
    if (this.ctx.start < T_VERSE - 1e-6) {
      if (this.freezeBridge) await this.ctx.ensureClip('bridge');
      this.room = new InterludeRoom(this.fonts);
    }
    if (this.ctx.end > T_VERSE + 1e-6) {
      this.verse = new VerseWorld();
      await this.verse.build(this.world, this.fonts, this.lines, this.voices, this.train);
    }
    // the move down to the train (from the click) shows the world of verse 2, with its hoops and its station: the verse clip draws it
    else await this.ctx.ensureClip('verse_2');
    this.buildPlayer();
    this.warm();
  }

  /** The world of verse 2: only the verse clip has it. */
  private verseWorld(): VerseWorld {
    if (!this.verse) throw new Error('interlude: the world of verse 2 is not built in this clip');
    return this.verse;
  }

  // ---------------------------------------------------------------- the player

  private buildPlayer() {
    const f = this.fonts;
    const cont = continueModal(f);
    const errBase = loadErrorModal(f);
    const errModal: WinSpec = { ...errBase, rect: [ERR_AT[0], ERR_AT[1], errBase.rect[2], errBase.rect[3]], dim: 0.2 };
    const okBtn = centreOf(modalButton(f, errModal, 'OK'));
    // the last try brings a dialog that carries line 22: the jellyfish takes it
    const say = this.ctx.lyrics.lines[22]?.written?.jp;
    const lastBase = loadErrorModal(f, { id: 'load-error-22', ...(say ? { say } : {}) });
    const lastModal: WinSpec = { ...lastBase, rect: [Math.round((640 - lastBase.rect[2]) / 2), Math.round((360 - lastBase.rect[3]) / 2), lastBase.rect[2], lastBase.rect[3]], dim: 0.2 };
    const ride = rideWindow(RIDE_RECT, (t) => (t < T_HIT ? `CAR 1  ${Math.round(V0 * 3.6)} km/h` : t < T_LOADERR ? 'CAR 1  ??? km/h  DESYNC' : 'LOAD STATE (SLOT 1)'), null);
    const mini: WinSpec = {
      id: 'mini', title: '[MAP: MÖBIUS]', rect: MINI_RECT, body: { kind: 'view' },
      status: (t) => (t >= T_HIT ? 'ERR  DESYNC' : `${this.dayAt(t).day}  ${this.train.underside(t) ? 'UNDERSIDE' : 'TOPSIDE'}`),
    };
    const inputs: PlayerInput[] = [
      // the modal opens on bar 52; the cursor comes in from the corner and clicks CONTINUE
      { at: T_MODAL, kind: 'open', win: cont },
      ...clickAt(T_CLICK, centreOf(modalButton(f, cont, 'CONTINUE')), { dur: 0.5 }),
      { at: T_CLICK + 2 * FR, kind: 'close', id: 'continue' },
      // the game goes on: the ride window opens at once, maximized, and the camera comes down to the train in it. The minimap and the
      // fish cam open when the camera is on the train
      { at: T_CLICK + 2 * FR, kind: 'open', win: ride, maximized: true },
      { at: T_VERSE, kind: 'open', win: mini, origin: [558, 64] },
      // the load fails: a red modal and a try on every kick
      { at: T_LOADERR, kind: 'open', win: errModal },
      ...TRIES.slice(1).flatMap((t) => clickAt(t, okBtn, { dur: 0.16 })),
      { at: T_JELLY, kind: 'close', id: 'load-error' },
      { at: T_JELLY, kind: 'open', win: lastModal },
    ];
    const track = new PlayerTrack(inputs, { cursor: [LW + 6, LH + 6], speed: 'play' });
    this.rig = new PlayerRig({ track, fonts: f, bars: false, ticker: '', counter: '' });
    this.maps = new InterludeMaps(this.text, f, this.ortho, this.train);
  }

  /** Compiles every scene once, so the first frame of a window does not hitch. */
  private warm() {
    const r = this.ctx.renderer, draw = (t: number) => this.drawGame(t);
    // the pieces of the reread, then the settled crossing: both with their programs
    this.world.poseTwist({ k: 0.5, jitter: 0.5, seed: 1 });
    r.compile(this.world.scene, this.persp);
    this.world.poseTwist('twisted');
    r.compile(this.world.scene, this.persp);
    if (this.room) {
      this.room.compile(r);
      // the first picture of the map on the CRT, once: its shadow map and its light set
      warmFrames(r, this.view, this.text, [T_HANG + 0.05], draw);
    }
    if (this.verse) {
      // one picture of the ride with lamps that are lit (the first lamp does not hitch: a lamp mesh with no lamps draws nothing), then
      // the faults of the minimap: the wrong textures (made and uploaded once) and the wireframe (its line buffers), so no try hitches
      warmFrames(r, this.view, this.text, [97.0, 101.9, 105.6, 106.3], draw);
      this.verse.warmOver(r, this.view);
      this.view.toScreen(r);
    }
  }

  /** The day counter at t, and the hour of the world's light (the index of the skip, or -1 before the first and `null` after the last). */
  private dayAt(t: number): { day: string; skip: number | null } {
    if (t >= T_SKIP1) return { day: 'DAY ???', skip: null };
    let n = -1;
    for (const k of this.skips) { if (k > t) break; n++; }
    return { day: n < 0 ? 'DAY 001' : DAYS[Math.min(n, DAYS.length - 1)]!, skip: n };
  }

  // ---------------------------------------------------------------- the move down to the train

  /**
   * 92.000-92.444: the map camera goes down to the train and becomes the ride cam. It is one perspective camera: at the start it is a long
   * lens far off that shows what the map showed, then it comes in along its line of sight while the lens opens and the aim goes to the train.
   * `content`: the frame it draws into. The ride window is open and maximized from the click, so the move and the ride have one frame:
   * nothing jumps on 92.444.
   */
  private dolly(cam: BlendCamera, t: number, content: Rect) {
    const w = smooth((t - T_CLICK) / (T_VERSE - T_CLICK));
    // the map: where it looks at the ground (under the middle of the picture), from where, and how much of the world is in the picture.
    // The picture can be smaller than the frame (a window): the start keeps the metres per pixel of the map
    this.maps.mapCam.apply(this.ortho, t);
    this.ortho.updateMatrixWorld(true);
    const dir0 = this.ortho.getWorldDirection(new THREE.Vector3());
    const [cx, cy, cw, ch] = content;
    const mid = new THREE.Vector3(((cx + cw / 2) / LW) * 2 - 1, 1 - ((cy + ch / 2) / LH) * 2, -1).unproject(this.ortho);
    const look0 = mid.addScaledVector(dir0, -mid.y / dir0.y);
    const h0 = ((this.ortho.top - this.ortho.bottom) / this.ortho.zoom) * (ch / LH);
    // a long lens (3 degrees) far off; its projection starts as the map's orthographic one and turns into the perspective one (below)
    const fov0 = THREE.MathUtils.degToRad(3), dist0 = h0 / (2 * Math.tan(fov0 / 2));
    // the ride cam of this moment
    const rc = aimRide(this.ride, this.scratch, t, LW / (LH - 20));
    const car = new THREE.Vector3().setFromMatrixPosition(this.train.carMatrix(t, 0));
    const dir1 = rc.getWorldDirection(new THREE.Vector3());
    const dist1 = rc.position.distanceTo(car);
    const look1 = rc.position.clone().addScaledVector(dir1, dist1);
    const h1 = 2 * dist1 * Math.tan(THREE.MathUtils.degToRad(rc.fov) / 2);
    // distance and frame size go down in equal ratios for equal times: the move has one speed to the eye
    const dist = Math.exp(Math.log(dist0) + (Math.log(dist1) - Math.log(dist0)) * w);
    const h = Math.exp(Math.log(h0) + (Math.log(h1) - Math.log(h0)) * w);
    // the turn: from the map camera's to the ride cam's, yaw, pitch and roll each at an even speed (yaw the short way round). A slerp of
    // the two turns would roll the camera by 7 degrees in the middle of the move; a person who turns the head does not roll it
    const e0 = new THREE.Euler().setFromQuaternion(this.ortho.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
    const e1 = new THREE.Euler().setFromQuaternion(rc.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
    const dyaw = Math.atan2(Math.sin(e1.y - e0.y), Math.cos(e1.y - e0.y));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e0.x + (e1.x - e0.x) * w, e0.y + dyaw * w, e0.z + (e1.z - e0.z) * w, 'YXZ'));
    const look = look0.lerp(look1, w), dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    cam.position.copy(look).addScaledVector(dir, -dist);
    cam.quaternion.copy(q);
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(h / (2 * dist)));
    cam.aspect = cw / ch;
    // the planes hug the world (3 km round the aim): far off the depth buffer keeps its precision
    cam.near = Math.max(0.2, dist * 0.05, dist - 3000);
    cam.far = dist + 3000;
    // the projection: the orthographic one of the same frame (h high at the aim) blended into the perspective one (`BlendCamera`). At the
    // click the picture is the map's own, and the perspective comes in over the move
    cam.mix = w;
    cam.aimDist = dist;
    cam.updateProjectionMatrix();
  }

  /** The move down to the train (92.000-92.444) in a picture of the rectangle `content`, while the save loads (`LOAD_WAVE`). */
  private renderDolly(v: LitView, t: number, content: Rect) {
    this.dolly(this.persp, t, content);
    const u = smooth((t - T_CLICK) / (T_VERSE - T_CLICK));
    metric('load.u', u);
    const car = new THREE.Vector3().setFromMatrixPosition(this.train.carMatrix(t, 0));
    const W3 = this.world;
    W3.lightLoad(u, v3(0, 0, -100).lerp(car, u));
    const at = new THREE.Vector3().setFromMatrixPosition(this.train.carMatrix(T_CLICK, 0));
    W3.loadTown((i) => {
      const h = W3.houses[i]!;
      return (t - T_CLICK - Math.hypot(h.x - at.x, h.z - at.z) / LOAD_WAVE - 0.04 * hashSin(i, 7)) / LOAD_GROW;
    });
    const c = (a: Col, b: Col) => `#${col(a).lerp(col(b), u).getHexString()}`;
    v.render(this.ctx.renderer, W3.scene, this.persp, { zenith: c(MAP_SKY.zenith, SKIES.day.zenith), horizon: c(MAP_SKY.horizon, SKIES.day.horizon), ground: c(MAP_SKY.ground, SKIES.day.ground) });
  }

  // ---------------------------------------------------------------- the game picture

  /** The light and the sky of the ride at t, seen by a camera at height `eyeY`. In the corridor the light is that of its tubes. */
  private lightRide(t: number, eyeY: number, focus: THREE.Vector3): Sky {
    const { skip } = this.dayAt(t);
    const hour = skip === null ? 1 : skip < 0 ? 'day' : HOURS[skip % HOURS.length]!;
    this.world.light('close', hour, focus);
    const under = eyeY < GROUND_Y - 0.3;
    this.exposure = under ? 1.0 : hour === 'day' ? 1 : hour === 0 ? 1.05 : 1.25;
    this.verseWorld().p8.light.intensity = under ? 130 : 0;
    // white tiles under tubes: little bloom, or the signs wash out
    this.bloom = under ? 0.12 : 0.5;
    // no haze in the corridor: its far end is dark, not pale
    const fog = this.world.scene.fog;
    if (under && fog instanceof THREE.FogExp2) fog.density = 0;
    return hour === 'day' ? SKIES.day : hour === 0 ? SKIES.dusk : SKIES.night;
  }

  /** The minimap of verse 2: the map in plain colours, with the faults of the failed loads. */
  private renderMini(win: WinState, v: LitView, t: number) {
    if (this.verse) this.verse.p8.light.intensity = 0;
    this.maps.miniCam.apply(this.ortho, t, win.content[2], win.content[3]);
    this.maps.warpMini(t);
    const f = this.maps.miniFault(t), W3 = this.world;
    W3.light('map', 'day', v3(0, 0, -100));
    W3.mapLod(true);
    if (f.wrong) for (const m of [W3.mat, W3.groundMat]) setLitTexture(m, W3.atlas.wrong(1));
    W3.mat.wireframe = f.wire;
    W3.groundMat.wireframe = f.wire;
    v.render(this.ctx.renderer, W3.scene, this.ortho, MAP_SKY);
    this.ortho.updateProjectionMatrix();
    W3.mat.wireframe = false;
    W3.groundMat.wireframe = false;
    W3.mapLod(false);
  }

  /** The 3D of window `win` (verse 2). */
  private renderWin(win: WinState, v: LitView, t: number) {
    const car = new THREE.Vector3().setFromMatrixPosition(this.train.carMatrix(t, 0));
    if (win.id === 'mini') {
      this.renderMini(win, v, t);
      return;
    }
    if (t < T_VERSE) {
      this.renderDolly(v, t, win.content);
      return;
    }
    const cam = this.persp;
    // the move down to the train sets the planes and the projection blend of this camera for its distance: the ride has its own, in every frame
    cam.mix = 1;
    cam.near = 0.2;
    cam.far = 6000;
    cam.aspect = this.rig.aspect(win);
    this.ride.apply(cam, t);
    // on the first frames of a failed load the camera drops under the floor: the corridor and the cars seen from under the map
    if (loadFlash(t)) cam.position.y -= PEEK;
    cam.aspect = this.rig.aspect(win);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    v.render(this.ctx.renderer, this.world.scene, cam, this.lightRide(t, cam.position.y, car));
  }

  /** The world for time t: the stem, the train, the wreck, the lamps of the gantries, the line under the map. */
  private poseWorld(t: number) {
    this.world.poseTwist(t < T_CLICK ? this.maps.reread(t).st : 'twisted');
    this.train.place(this.world, t);
    if (this.verse) this.verse.pose(t, aimRide(this.ride, this.scratch, t, LW / (LH - 20)).position, this.train);
  }

  /** The whole picture of the game at time t. */
  private drawGame(t: number): Output {
    const r = this.ctx.renderer;
    this.exposure = 1;
    this.bloom = 0.5;
    const st = this.rig.state(t);
    this.maps.shakeMini(st, t);
    this.poseWorld(t);
    if (!st.maximized) {
      if (t < T_CLICK) {
        // the map of the reread
        this.maps.mapCam.apply(this.ortho, t);
        this.world.light('map', 'day', v3(0, 0, -100));
        this.view.render(r, this.world.scene, this.ortho, MAP_SKY);
      } else this.renderDolly(this.view, t, [0, 0, LW, LH]);
    }
    this.rig.compose(r, this.view, st, (win, v) => this.renderWin(win, v, t));
    this.text.clear();
    if (t < T_CLICK) this.maps.drawOverlay(t);
    this.rig.draw(this.text, st);
    if (t >= T_VERSE) {
      this.maps.drawMini(st.windows.find((w) => w.id === 'mini'), t);
    }
    this.text.commit();
    if (this.verse) this.verse.holdLast(r, this.view, st, t);
    const look = t < T_CLICK ? 1 : t < T_VERSE ? 1 + 0.05 * smooth((t - T_CLICK) / (T_VERSE - T_CLICK)) : st.maximized ? 1.05 : 1.0;
    return { exposure: this.exposure * look, bloom: this.bloom, top: this.rig.top };
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    const t = f.t;
    if (!this.verse && t >= T_CLICK) {
      if (!this.ctx.renderClip('verse_2', t, out)) throw new Error('interlude: the verse_2 clip is not loaded');
      return NO_FILM_POST;
    }
    if (!this.room || t >= T_INSIDE) {
      this.view.present(r, out, this.drawGame(t), this.text);
      return NO_FILM_POST;
    }
    // the room: the CRT shows the game picture (or, for the first frames, the last frame of the bridge: the game hangs on the cracked disc);
    // the head looks round; from bar 51 the eye goes to the glass, and when the glass fills the frame the frame is the game's own picture
    if (this.freezeBridge && t < T_HANG) {
      if (!this.ctx.renderClip('bridge', T_MOON, this.room.moonOut)) throw new Error('interlude: the bridge clip is not loaded');
      this.room.show(r, this.room.moonOut.texture, false);
    } else {
      this.room.show(r, this.view.toScreen(r, this.drawGame(t), this.text), true);
    }
    this.room.render(r, out, t);
    return NO_FILM_POST;
  }

  override dispose() {
    this.view.dispose();
    this.text.dispose();
    this.rig?.dispose();
    this.room?.dispose();
    this.verse?.dispose();
    this.world?.dispose();
  }
}
