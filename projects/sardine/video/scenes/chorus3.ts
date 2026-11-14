// Chorus 3 and the outro (clips chorus_3, 135.111-163.556 s, bars 77-92, and outro, 163.556-170.667 s, bars 93-96); treatment v9
// "Plate 9" and "Plate 10". One scene for both clips: there is no cut at 163.556.
//
//   The world      The world of chorus 2, the same objects (`_c2shared.ts`): at 135.111 the same train runs on round the same
//                  loop, under the same camera. The sky is the eclipse from the first frame.
//   The line       A new straight track opens from the loop (`_c3stage.ts`: it comes up piece by piece, away from the train). The
//                  train takes it at 143.4 and runs it to the wall at the speed of chorus 2.
//   The camera     One camera, no cut (`_c3ride.ts`). 135.111: the side arm of chorus 2. It goes round the left side and across the
//                  nose to the front right, high, and looks back along the track: the train comes at it, and behind the train the
//                  world unloads. Then it closes in on the train. In the last bar it swings round to behind the train.
//   The unloading  Behind the train (`_c3unload.ts`, `_c3copy.ts`): first the far hills, then the town and the loop of chorus 2, then
//                  the street of the straight. The edge closes in on the rear car. The void under the world glows red.
//   The sky        The eclipse of the sky shader, behind the train.
//   The lines      Lead lines 31-37 are constellations (`StarLines`): each glyph is a figure of stars, fixed in the sky where the
//                  camera looks while the line is sung. The stars come on with the syllables and fall out of the sky after the line.
//   The tuna       A tuna dives at a thing of the world for each syllable of the `ko` lines (`_c3games.ts`). A red ring marks the
//                  thing. The place is chosen with the camera: the mark, the fish on its way down and the hit are in the picture.
//                  First half: the typing game (the syllable and its key on a plate). Typed in time: the tuna breaks up into scales of
//                  light. Too late: it hits and explodes (`_c3fall.ts`). Second half (149.333): the DIVA game. Every note hits. When the
//                  track ahead is in the picture, a tuna takes it and the train jumps the gap. The keys show as key caps (`_c3hud.ts`).
//   The windows    The fish cams and the minimap (`_c3map.ts`) open now and then; the player shuts them with [x].
//   The outro      163.556: the view swings forward along the train: the wall. The lamps of the wall come on, then the rows of the
//                  credits. A school of sardines swims with the train. 166.222: the nose goes through the canvas. 167.111: the room
//                  (`_outro.ts`, `OutroRoom`).
// Before the clip, from あ, chorus 2 shows this scene's datamosh of its blue screen (`_c3mosh.ts`).
// A frame depends only on t.
import * as THREE from 'three';
import { Scene, type Frame, type SceneCtx } from '@pve/engine/scene';
import type { Line } from '@pve/engine/lyrics';
import { hashSin, projectToRect, smooth } from '@pve/engine/util';
import { makeRT, W, H } from '@pve/engine/gl';
import { unloadMaterial, type Unload, chunkTree } from '@pve/engine/chunks';
import { NO_FILM_POST } from '@pve/engine/post';
import { LitAtlas, ambient, camera, col, enableShadows, glowMaterial, instanced, litMaterial, setLitLod, sun, v3 } from '@pve/engine/lit';
import { LitView, posedOnce, type Output, type Sky } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import type { TrackFrame } from '@pve/engine/track';
import { SPB, FR } from './_time';
import { lineAt, loadFonts, loadLanes, type Fonts } from './_fonts';
import { subtitle } from './_subtitle';
import { Jellyfish } from './_jelly';
import { Fish } from './_fish';
import { GROUND_Y } from './_station';
import { CAR_PITCH } from './_route';
import { acquireC2, releaseC2, settleC2, type C2Shared } from './_c2shared';
import { CURSOR_REST } from './_c2apps';
import { Falls } from './_c3fall';
import { C3_GRID, OPEN_SPEED, T_OPEN, UnloadMeter, c3Unload, chunkTime } from './_c3unload';
import { C, chromeText, chromeWidth } from './_playerChrome';
import { HANG, OutroRoom, T_CUT, T_HIT, T_OUTRO } from './_outro';
import { C3Line, ECLIPSE, ECL_CLEAR, ECL_DIR, GW_TO_STAGE, SPEED, StarLines, T0, T_EXIT, WALL_CORNERS, Wall, X_EXIT, X_WALL, xAt, type Target } from './_c3stage';
import { VerseFx } from './_versefx';
import { C3Lights } from './_c3lights';
import { centreOf, winButtons, type PlayerInput, type PlayerState, type Rect, type Vec2, type Vec3 } from './_playerTypes';
import { PlayerTrack } from './_playerTrack';
import { fishCamWindow } from './_playerWindows';
import { PlayerRig } from './_playerRig';
import { FishCam } from './_playerCams';
import { RIDE_RECT, popup, rideWindow, warmFrames } from './_sceneKit';
import { C3Ride, T_ANGLE } from './_c3ride';
import { RING_LEAD, T_DIVA, schedule, score, type Meta } from './_c3games';
import { C3Hud } from './_c3hud';
import { MAP_RECT, MAP_VIEWS, drawMap, mapAt } from './_c3map';
import { C3Mosh, T_MOSH } from './_c3mosh';
import { copyWorld } from './_c3copy';

/** The `[FISH CAM]` window: bottom right, over the status bar (as in the bridge and chorus 2). */
const FISH_RECT: Rect = [464, 208, 172, 110];
/** The sardine in the front car (the frame of the car), as in chorus 2. */
const FISH_AT: Vec3 = [2.8, 2.3, 0.5];
/**
 * The views of `[FISH CAM]`: when the window is open, the side of the car that the lens looks out of, and the eye and the look point as
 * offsets from the sardine. The game opens it; the player shuts it with [x].
 */
const FISH_VIEWS: readonly { id: string; from: number; to: number; side: 1 | -1; eye: Vec3; look: Vec3; fov: number }[] = [
  // the new track ahead, through the front glass
  { id: 'fish-ahead', from: 138.6, to: 141.9, side: 1, eye: [-0.65, 0.2, 0.3], look: [1.5, -0.1, 0.3], fov: 64 },
  // out of the window at the world that unloads behind
  { id: 'fish-back', from: 146.2, to: 148.9, side: -1, eye: [-0.7, 0.2, -0.6], look: [-1.2, 0, 2.2], fov: 50 },
  // the sardine itself, close, while the tuna come
  { id: 'fish-close', from: 153.6, to: 156.2, side: 1, eye: [-0.55, 0.12, -0.42], look: [0.25, 0, 0.1], fov: 34 },
];

/** How far off in the sky the jellyfish drift (m): far enough not to slide past the moving camera, in front of the far fog. */
const JELLY_D = 400;
const SCALES = 22, SCALE_LIFE = 0.9;
/** The sardines of the school of the outro. */
const SCHOOL = 18;
/** The frame of the new straight track: the train heads -x, so its left side (`side`) is +z. */
const FRAME = { tangent: v3(-1, 0, 0), up: v3(0, 1, 0), side: v3(0, 0, -1) };

export default class Chorus3 extends Scene {
  private fonts!: Fonts;
  private lead: Line[] = [];
  private ko: Line[] = [];
  private view = new LitView();
  private text = new TextLayer();
  /** The datamosh of あ (`_c3mosh.ts`). */
  private moshClip = new C3Mosh();
  /** The camera of the minimap (`mapAt`). */
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1);
  private persp = camera(52, 0.2, 6000);
  private anchorCam = camera(52, 0.2, 6000);
  /** The train and the camera. */
  private ride = new C3Ride();
  private rig!: PlayerRig;
  /** The views of `[FISH CAM]`, by window id. */
  private fishCams = new Map<string, FishCam>();

  private shared!: C2Shared;
  /** The game world stands in this group: the stage frame. */
  private mount = new THREE.Group();
  /** The plain meshes of the game world: this scene draws its own copies of them, cut into chunks. */
  private originals: THREE.Object3D[] = [];
  /** The other objects of the game world: each goes when its place unloads. */
  private loose: { obj: THREE.Object3D; at: number }[] = [];
  private A = new LitAtlas(2048);
  private mat = litMaterial(this.A);
  private scene = new THREE.Scene();
  private line!: C3Line;
  private wall!: Wall;
  private stars!: StarLines;
  private un!: Unload;
  /** The unload progress of the status bar. */
  private meter!: UnloadMeter;
  private unMat!: THREE.MeshLambertMaterial;
  private unMatWorld!: THREE.MeshLambertMaterial;
  private falls!: Falls;
  private meta: Meta[] = [];
  private hud!: C3Hud;
  private fx!: VerseFx;
  private lights!: C3Lights;
  /** The chords (track 14): the corona of the eclipse flares on each. */
  private chords: number[] = [];
  private jellies: Jellyfish[] = [];
  private scales!: THREE.InstancedMesh;
  private school: Fish[] = [];
  private hemi = ambient('#3a4c96', '#141a30', 0.9);
  private key = sun('#aebcff', 0.9, 60, 1024);
  private warm = new THREE.DirectionalLight('#ffc27a', 0);
  private skyNow: Sky = { ...ECLIPSE };
  private room: OutroRoom | null = null;
  private posedAt = NaN;
  private readonly pv = new THREE.Vector3();
  private readonly o = new THREE.Object3D();
  private readonly c = new THREE.Color();

  constructor(ctx: SceneCtx) { super(ctx); }

  override async init() {
    enableShadows(this.ctx.renderer);
    this.fonts = await loadFonts(this.ctx.assets);
    const lanes = loadLanes();
    const all = this.ctx.lyrics.lines;
    this.lead = all.filter((l) => l.i >= 30 && l.i <= 37);
    if (this.lead.length !== 8) throw new Error(`chorus3: expected the lead lines 30-37, found ${this.lead.length}`);
    this.ko = lanes.ko.lines.slice(8, 16);
    if (this.ko.length !== 8) throw new Error('chorus3: the ko lane needs lines 8-15');
    const midi = (await (await fetch(`${this.ctx.assets}midi.json`)).json()) as { notes: { track: number; start: number; pitch: number }[] };
    const inside = (n: { start: number }) => n.start >= T0 - 1e-3 && n.start < T_OUTRO - 1e-3;
    const times = (track: number) => [...new Set(midi.notes.filter((n) => n.track === track && inside(n)).map((n) => Math.round(n.start * 1000)))].sort((a, b) => a - b).map((ms) => ms / 1000);

    await this.buildWorld(lanes.ko.lines.slice(0, 8));
    this.buildLine();
    this.meter = this.buildMeter();
    // ---- the fish cams: in the front car, on the sardine
    for (const q of FISH_VIEWS) {
      this.fishCams.set(q.id, new FishCam({ pose: (t: number) => GW_TO_STAGE.clone().multiply(this.ride.carMatrix(t, 0)), fish: () => FISH_AT, window: q.side, eye: q.eye, look: q.look, fov: q.fov }));
    }

    // ---- the tuna and their games
    const town: Target[] = this.shared.world.houses.map((h) => ({ p: v3(h.x, GROUND_Y + h.h + 0.5 * h.rise, h.z).applyMatrix4(GW_TO_STAGE), roof: true, what: 'house' }));
    const games = schedule(this.ko, [...this.line.targets, ...town], this.ride);
    this.meta = games.meta;
    this.falls = new Falls(this.A, this.mat, games.falls);
    await this.falls.bake();
    this.scales = instanced(new THREE.PlaneGeometry(0.5, 0.3), glowMaterial(), 4 * SCALES, { color: true });
    this.hud = new C3Hud(this.text, this.fonts, this.ko, this.meta, this.falls);

    // ---- the wall, the stars, the jellyfish, the lights of the music, the school of the outro
    this.wall = new Wall({ latin: this.fonts.latin, kana: this.fonts.kana });
    // lines 30-37: line 30 started on the last beat of chorus 2; its stars come with the cut. Lines 35 and 36 move to the left: the camera
    // turns right while they are sung, and at their anchor they ran out of the picture on the right. Line 35 is smaller and lower and may
    // come nearer to the eclipse (0.15 rad, the edge of the corona that shows): with the full clearance the eclipse pushed it back right
    this.stars = new StarLines(this.fonts.kana, this.lead, (t) => this.ride.camAt(t), ECL_DIR, {
      35: { x: -0.7, y: -0.3, s: 0.6, clear: 0.15 }, 36: { x: -0.4, y: 0, s: 1, clear: ECL_CLEAR },
    });
    for (let i = 0; i < 5; i++) {
      const j = new Jellyfish(this.A, this.mat, { size: 14 + 4 * (i % 3), phase: 0.4 + 0.8 * i });
      this.jellies.push(j);
      this.scene.add(j.root);
    }
    this.chords = times(14);
    this.lights = new C3Lights({ notes: midi.notes.filter(inside), from: T0, camAt: (t) => this.ride.camAt(t), eclipse: ECL_DIR });
    this.scene.add(this.lights.root);
    this.buildSchool();
    this.warm.position.set(0, 60, 170);
    this.scene.add(this.falls.root, this.scales, this.wall.root, this.hemi, this.key, this.key.target, this.warm, this.warm.target);

    this.buildPlayer();
    if (this.ctx.end > T_CUT) this.room = new OutroRoom(this.fonts);
    this.warmUp();
  }

  /** The world of chorus 2 in the stage frame, and its copy that unloads (`_c3copy.ts`). `ko`: the `ko` lines of chorus 2. */
  private async buildWorld(ko: Line[]) {
    const lead2 = this.ctx.lyrics.lines.filter((l) => l.i >= 22 && l.i <= 30);
    if (lead2.length !== 9) throw new Error(`chorus3: expected the lead lines 22-30, found ${lead2.length}`);
    this.shared = await acquireC2(this.fonts, lead2, ko);
    this.mount.applyMatrix4(GW_TO_STAGE);
    this.scene.add(this.mount);
    this.scene.fog = this.shared.world.fog;
    this.un = c3Unload();
    this.unMatWorld = unloadMaterial(this.shared.world.atlas, this.un, v3(0, 0, 0));
    const copy = await copyWorld(this.shared, this.unMatWorld, (key, make) => this.ctx.memo(key, make));
    this.originals = copy.originals;
    this.loose = copy.loose;
    this.scene.add(copy.copies);
  }

  /** The new line: it comes up piece by piece, and it unloads from the left. */
  private buildLine() {
    const world = new THREE.Group();
    this.line = new C3Line(this.A, this.mat, this.fonts.kana);
    const frame = (d: number): TrackFrame => ({ ...FRAME, pos: v3(X_EXIT - d, 0, 0) });
    this.fx = new VerseFx(this.A, this.mat, { frame, len: X_EXIT - X_WALL + 20, dAt: (t) => SPEED * (t - T_EXIT), speed: SPEED, pitch: CAR_PITCH, t0: T_EXIT, t1: T_HIT, sky: [], ground: [] });
    world.add(this.line.root, this.line.track, this.fx.root);
    this.scene.add(world);
    this.unMat = unloadMaterial(this.A, this.un, v3(X_EXIT + 6, T_OPEN, OPEN_SPEED));
    chunkTree(C3_GRID, world, world, this.unMat, (m) => (m === this.line.track ? 1 : 0));
  }

  /**
   * The meter of the unload progress: every chunked triangle of the scene (the copy of the world of chorus 2 and the new line) at the time
   * of its chunk, and every loose object of the world with all its triangles at its own time.
   */
  private buildMeter(): UnloadMeter {
    const tris = new Map<string, { t: number; n: number }>();
    const add = (key: string, t: number, n: number) => { const e = tris.get(key); if (e) e.n += n; else tris.set(key, { t, n }); };
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const ch = o.geometry.getAttribute('aChunk');
      if (ch === undefined) return;
      // the vertices of a triangle share its chunk (chunkGeometry splits triangles at chunk edges)
      for (let v = 0; v + 2 < ch.count; v += 3) {
        const ix = ch.getX(v), iz = ch.getY(v), kind = ch.getZ(v);
        add(`${ix} ${iz} ${kind}`, chunkTime(ix, iz, kind), 1);
      }
    });
    this.loose.forEach((l, k) => {
      let n = 0;
      l.obj.traverse((o) => { if (o instanceof THREE.Mesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3; });
      add(`loose ${k}`, l.at, n);
    });
    return new UnloadMeter([...tris.values()]);
  }

  // ---------------------------------------------------------------- the scales and the school

  /** A tuna that the player stopped breaks up into scales: they fly out and rain down as light. */
  private poseScales(t: number) {
    const o = this.o;
    let n = 0;
    this.falls.falls.forEach((f, i) => {
      const m = this.meta[i]!;
      if (m.word !== 'HIT' || f.breakAt === undefined) return;
      const age = t - f.breakAt;
      if (age < 0 || age > SCALE_LIFE || n + SCALES > 4 * SCALES) return;
      const at = this.falls.centre(i, f.breakAt - 1e-3, this.pv);
      for (let k = 0; k < SCALES; k++) {
        const a = hashSin(i, k) * Math.PI * 2, b = hashSin(i, k + 40) * Math.PI - Math.PI / 2, sp = 5 + 9 * hashSin(i, k + 80);
        o.position.set(at.x + Math.cos(a) * Math.cos(b) * sp * age - 8 * age, at.y + Math.sin(b) * sp * age - 9 * age * age, at.z + Math.sin(a) * Math.cos(b) * sp * age);
        o.rotation.set(11 * age + k, 7 * age, k);
        o.scale.setScalar(1.6 * (1 - age / SCALE_LIFE) + 0.3);
        o.updateMatrix();
        this.scales.setMatrixAt(n, o.matrix);
        this.scales.setColorAt(n, this.c.setRGB(0.75, 0.92, 1).multiplyScalar(2.4 * (1 - age / SCALE_LIFE)));
        n++;
      }
    });
    this.scales.count = n;
    this.scales.instanceMatrix.needsUpdate = true;
    this.scales.instanceColor!.needsUpdate = true;
  }

  /** The school of sardines of the outro: the avatar sardine (`Fish`), large, many times. It comes up beside the train from the left and swims with it. */
  private buildSchool() {
    for (let i = 0; i < SCHOOL; i++) {
      const f = new Fish(this.A, this.mat, 8 + 4 * hashSin(i, 4));
      f.root.visible = false;
      this.school.push(f);
      this.scene.add(f.root);
    }
  }

  private poseSchool(t: number) {
    const from = T_OUTRO + 3 * SPB, on = t >= from - 0.1, x = xAt(t);
    this.school.forEach((f, i) => {
      f.root.visible = on;
      if (!on) return;
      const up = smooth((t - from - 0.03 * i) / 0.8), rise = (15 + 8 * hashSin(i, 2)) * up;
      const p = this.pv.set(x + 24 - 46 * hashSin(i, 1) + 1.5 * Math.sin(0.9 * t + i), -14 + rise + 0.8 * Math.sin(1.3 * t + 2 * i), 7 + 13 * hashSin(i, 3));
      // it swims the way of the train (-x), and climbs while it comes up
      f.pose(t, p, v3(-SPEED, 9 * (1 - up) + 0.8 * Math.cos(1.3 * t + 2 * i), 0.3 * Math.sin(0.7 * t + i)), 0.4 * Math.sin(0.9 * t + i));
    });
  }

  // ---------------------------------------------------------------- the player

  /** The status: the distance of the nose to the wall (it counts down to 0 m at `T_HIT`), the car, and the score. */
  private status(t: number): string {
    if (t >= T_HIT) return 'ERR';
    if (t >= T_OUTRO) return 'CLEAR?';
    const s = score(this.meta, t), car = `WALL ${Math.ceil(SPEED * (T_HIT - t))} m  CAR 1  ${Math.round(SPEED * 3.6)} km/h`;
    return t >= T_DIVA - RING_LEAD ? `${car}  COMBO ${s.combo}` : `${car}  HIT ${s.hit}  MISS ${s.miss}`;
  }

  /**
   * The unload progress in the free right part of the status bar (the overlay draws after the chrome): `UNLOAD`, a bar of red cells (the
   * colour of the void under the world) and the percent of the triangles of the world that have unloaded (`UnloadMeter`).
   */
  private drawUnload(l: TextLayer, c: Rect, t: number) {
    if (t >= T_OUTRO) return;
    const p = this.meter.share(t), sy = c[1] + c[3], x0 = 300, cells = 36, cw = 4;
    chromeText(l, this.fonts, 'UNLOAD', x0, sy + 8, '#e8e8f0', C.sunk);
    const bx = x0 + chromeWidth(this.fonts, 'UNLOAD') + 5;
    l.rect(bx, sy + 2, cells * (cw + 1) + 1, 7, C.barLo);
    const on = Math.floor(p * cells);
    for (let k = 0; k < cells; k++) l.rect(bx + 1 + k * (cw + 1), sy + 3, cw, 5, k < on ? '#ff5a4a' : C.sunk);
    chromeText(l, this.fonts, `${Math.floor(p * 100)}%`, bx + cells * (cw + 1) + 6, sy + 8, '#e8e8f0', C.sunk);
  }

  private buildPlayer() {
    const ride = rideWindow(RIDE_RECT, (t) => this.status(t), (l, c, t) => this.drawUnload(l, c, t));
    const inputs: PlayerInput[] = [{ at: T0 - 1.5, kind: 'open', win: ride, maximized: true }];
    // the fish cam: the game opens it now and then, and the player shuts it with [x]
    const close = centreOf(winButtons(FISH_RECT, false).close);
    for (const q of FISH_VIEWS) inputs.push(...popup(fishCamWindow({ id: q.id, rect: FISH_RECT, clock: q.from }), q.from, q.to, close, [550, 262]));
    // the minimap: the same, bottom left
    const mapClose = centreOf(winButtons(MAP_RECT, false).close);
    for (const q of MAP_VIEWS) {
      const win = { id: q.id, title: `[MAP: ${q.mode.toUpperCase()}]`, rect: MAP_RECT, body: { kind: 'view' as const }, status: () => 'DAY ???  UNLOADING' };
      inputs.push(...popup(win, q.from, q.to, mapClose, [86, 252]));
    }
    inputs.sort((a, b) => a.at - b.at);
    // the cursor lies where it fell in chorus 2: the hand is on the keys
    const track = new PlayerTrack(inputs, { cursor: CURSOR_REST, speed: 'play' });
    this.rig = new PlayerRig({ track, fonts: this.fonts, bars: false, ticker: '', counter: '' });
  }

  private warmUp() {
    const r = this.ctx.renderer;
    warmFrames(r, this.view, this.text, [T0, 137.5, 141, T_EXIT + 0.5, 147.3, 151, 160, T_OUTRO + 1, T_HIT + 0.3], (t) => this.drawGame(t));
    // the frames of the mosh (chorus 2 shows them), and the room
    const rt = makeRT(W, H);
    for (const t of [T_MOSH + FR, ...(this.room ? [T_CUT + 0.05, T_CUT + 1.0, T_CUT + HANG + 0.4, 170.2] : [])]) this.render({ t } as Frame, rt);
    rt.dispose();
    this.moshClip.restart();
    this.posedAt = NaN;
  }

  // ---------------------------------------------------------------- the picture

  /** The world of chorus 2 at t in the stage frame. When all of it has unloaded it is not drawn: only the train is left of it. */
  private poseC2(t: number, gone: boolean) {
    const S = this.shared, W3 = S.world;
    // it goes on as it was: the tuna circle, the sardines stand in the fields
    if (W3.scene.parent !== this.mount) this.mount.add(W3.scene);
    if (gone) {
      for (const r of S.rest) r.obj.visible = false;
      // nothing of the world is left to say how the train looks, and no fog
      S.events.ownLook();
      W3.fog.density = 0;
    } else {
      for (const r of S.rest) r.obj.visible = r.visible;
      S.events.pose(t);
    }
    W3.cars.forEach((car, k) => { car.root.matrixAutoUpdate = false; car.root.matrix.copy(this.ride.carMatrix(t, k)); car.root.matrixWorldNeedsUpdate = true; });
    S.fish.pose(Math.floor(t * 12) / 12, v3(2.8, 2.3, 0.5), v3(0.8, 0, 0), 0);
  }

  /** The light at t: the eclipse from the first frame; in the outro the lamps of the wall. */
  private light(t: number, gone: boolean) {
    const W3 = this.shared.world;
    const dawn = smooth((t - T_OUTRO + SPB) / (2 * SPB));
    const at = v3(0, 0, 0).setFromMatrixPosition(W3.cars[0].root.matrix);
    if (!gone) {
      W3.light('close', 'day', at, 0.8);
      W3.lightScale(0);
      // after `light` (it shows the town of its view): this scene draws its own copies of the plain meshes, and they unload
      for (const o of this.originals) o.visible = false;
      for (const l of this.loose) l.obj.visible = t < l.at;
    }
    const p = at.applyMatrix4(GW_TO_STAGE);
    this.hemi.intensity = 1.1 + 1.2 * dawn;
    this.hemi.color.set('#3a4c96').lerp(this.c.set('#ffd9b0'), 0.2 + 0.4 * dawn);
    this.key.intensity = 0.9 + 1.4 * dawn;
    this.key.color.set('#aebcff').lerp(this.c.set('#ffe2b0'), dawn);
    this.key.position.set(p.x - 40 * dawn - 20, 70, p.z - 50);
    this.key.target.position.set(p.x, 0, p.z);
    this.key.target.updateMatrixWorld();
    this.warm.intensity = 0.6;
    this.warm.position.set(p.x, 60, 170);
    this.warm.target.position.set(p.x, 0, 0);
    this.warm.target.updateMatrixWorld();
  }

  /** The sky: the eclipse. The void under the world glows red as the world goes; the stars and the corona pulse on the kick, the corona flares on the chords. */
  private poseSky(t: number) {
    const s = this.skyNow;
    s.zenith = ECLIPSE.zenith;
    s.horizon = ECLIPSE.horizon;
    s.ground = `#${col(ECLIPSE.ground).lerp(col('#7a0c1c'), smooth((t - T_EXIT) / (160 - T_EXIT))).getHexString()}`;
    const kick = this.lights.kick(t);
    s.stars = 0.5 * (1 + 1.4 * kick);
    s.glowBand = 0.07;
    let flare = 0;
    for (let i = this.chords.length - 1; i >= 0; i--) { const age = t - this.chords[i]!; if (age >= 0) { flare = Math.exp(-age / 0.22); break; } }
    s.body = { dir: ECL_DIR, r: 0.05, colour: '#03040a', strength: 1, glow: 1, corona: { colour: '#d8e4ff', strength: 1.3 + 1.6 * flare + 0.8 * kick } };
  }

  private poseWorld(t: number) {
    if (this.posedAt === t) return;
    this.posedAt = t;
    const gone = t > T_EXIT + 9;
    this.poseC2(t, gone);
    this.un.uT.value = t;
    this.falls.pose(t, this.un);
    this.poseScales(t);
    this.fx.pose(t);
    this.poseSchool(t);
    this.lights.pose(t);
    this.wall.pose(t);
    // the jellyfish drift far off in the sky, each in its own direction from the eye: they never slide past the camera. Before the
    // view turns to the wall they rise up and out of the sky
    const eye = this.ride.camAt(t).position, away = 260 * smooth((t - (T_ANGLE - 3)) / 2.5);
    this.jellies.forEach((j, i) => {
      j.root.visible = t >= T_EXIT && away < 250;
      const a = 2.2 + 0.55 * i;
      j.drift(t, this.pv.set(eye.x + JELLY_D * Math.cos(a), JELLY_D * (0.16 + 0.05 * (i % 3)) + 6 * Math.sin(0.6 * t + i) + away, eye.z + JELLY_D * Math.sin(a)));
    });
    this.light(t, gone);
    this.poseSky(t);
  }

  /** The front car at t in the stage frame. */
  private carAt(t: number): THREE.Vector3 {
    return new THREE.Vector3().setFromMatrixPosition(this.ride.carMatrix(t, 0)).applyMatrix4(GW_TO_STAGE);
  }

  private renderWin(win: PlayerState['windows'][number], v: LitView, t: number) {
    this.poseWorld(t);
    const map = MAP_VIEWS.find((q) => q.id === win.id);
    if (map) {
      mapAt(this.ortho, this.carAt(t), this.rig.aspect(win), map.mode);
      // the map draws plain colours, not the textures (as the minimap of verse 2): it reads at its size
      const mats = [this.mat, this.unMat, this.unMatWorld, this.shared.world.mat, this.shared.world.groundMat];
      for (const m of mats) setLitLod(m, true);
      v.render(this.ctx.renderer, this.scene, this.ortho, this.skyNow);
      for (const m of mats) setLitLod(m, false);
      return;
    }
    const view = FISH_VIEWS.find((q) => q.id === win.id);
    if (view) {
      const cam = this.persp;
      this.fishCams.get(view.id)!.apply(cam, t);
      cam.aspect = this.rig.aspect(win);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
    } else this.ride.aim(this.persp, t, this.rig.aspect(win));
    v.render(this.ctx.renderer, this.scene, this.persp, this.skyNow);
  }

  /** The projection of a world point into the picture of the ride window at t (px), or null for a point out of the picture. */
  private projector(t: number, st: PlayerState): ((p: THREE.Vector3) => Vec2 | null) | null {
    const ride = st.windows.find((w) => w.id === 'ride');
    if (!ride) return null;
    const cam = this.anchorCam;
    this.ride.aim(cam, t, this.rig.aspect(ride));
    const q = new THREE.Vector3();
    return (p) => {
      q.copy(p).project(cam);
      if (q.z > 1 || Math.abs(q.x) > 1.1 || Math.abs(q.y) > 1.1) return null;
      return projectToRect(q, ride.content);
    };
  }

  /**
   * For the stars: `place` puts a world point into the picture of the ride window (px), also out of the frame (null: behind the camera).
   * `shown` says whether a star at a pixel shows: inside the picture, not under another window (a fish cam), not on the wall. Call it
   * after `projector` (it reads the camera that `projector` aimed).
   */
  private skyView(st: PlayerState): { place: (p: THREE.Vector3) => Vec2 | null; shown: (x: number, y: number) => boolean } {
    const ride = st.windows.find((w) => w.id === 'ride')!;
    const [cx, cy, cw, ch] = ride.content;
    const over = st.windows.filter((w) => w.z > ride.z).map((w) => w.rect);
    const q = new THREE.Vector3();
    const place = (p: THREE.Vector3): Vec2 | null => {
      q.copy(p).project(this.anchorCam);
      return q.z < 1 ? projectToRect(q, ride.content) : null;
    };
    // the wall as a quad of pixels, when all of it is in front of the camera
    const wall = WALL_CORNERS.map((c) => place(c));
    const behind = (x: number, y: number) => {
      if (wall.some((c) => !c)) return false;
      let sign = 0;
      for (let i = 0; i < 4; i++) {
        const a = wall[i]!, b = wall[(i + 1) % 4]!, s = Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]));
        if (s !== 0 && sign !== 0 && s !== sign) return false;
        if (s !== 0) sign = s;
      }
      return true;
    };
    const shown = (x: number, y: number) =>
      x >= cx && x < cx + cw && y >= cy && y < cy + ch && !over.some(([ox, oy, w, h]) => x >= ox && x < ox + w && y >= oy && y < oy + h) && !behind(x, y);
    return { place, shown };
  }

  private drawGame(t: number): Output {
    const r = this.ctx.renderer;
    // the world is shared with chorus 2: it is posed again for each frame, also for a time that this scene drew before
    this.posedAt = NaN;
    this.poseWorld(t);
    const st = this.rig.state(t);
    // every window shows the one world at t: its matrices and its shadow maps are made once.
    // The minimap is a game map, not the night: it shows brighter than the world
    posedOnce(r, this.scene, () => this.rig.compose(r, this.view, st, (win, v) => this.renderWin(win, v, t), (win) => (MAP_VIEWS.some((q) => q.id === win.id) ? 2.6 : 1)));
    this.text.clear();
    this.rig.draw(this.text, st, () => drawMap(this.text, this.ortho, st, t, (at) => this.carAt(at)));
    if (this.projector(t, st)) {
      const sky = this.skyView(st);
      this.stars.draw(this.text, t, this.anchorCam.position, sky.place, sky.shown);
    }
    if (t < T_OUTRO) {
      const project = this.projector(t, st);
      if (project) this.hud.draw(t, project);
    }
    const ln = lineAt(this.lead, t);
    if (ln) subtitle(this.text, this.fonts, ln, t);
    this.text.commit();
    return { exposure: 1.05, bloom: 0.2, top: this.rig.top };
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    if (f.t < T0) {
      this.moshClip.frame(r, out, f.t, {
        view: this.view, text: this.text, fonts: this.fonts, scene: this.scene, rig: this.rig,
        drawGame: (t) => this.drawGame(t), poseWorld: (t) => this.poseWorld(t), aim: (cam, t, aspect) => this.ride.aim(cam, t, aspect),
      });
      return NO_FILM_POST;
    }
    if (f.t < T_CUT || !this.room) {
      this.view.present(r, out, this.drawGame(f.t), this.text);
      return NO_FILM_POST;
    }
    // the room: for a moment the tube holds the last frame of the game (the bright glass), then it plays the attract mode
    this.room.render(r, out, f.t, () => this.view.toScreen(r, this.drawGame(T_CUT - FR), this.text));
    return NO_FILM_POST;
  }

  override dispose() {
    this.view.dispose();
    this.text.dispose();
    this.moshClip.dispose();
    this.rig?.dispose();
    this.falls?.dispose();
    this.fx?.dispose();
    this.wall?.dispose();
    this.lights?.dispose();
    this.room?.dispose();
    this.un?.tex.dispose();
    this.unMat?.dispose();
    this.unMatWorld?.dispose();
    this.A.tex.dispose();
    if (this.shared) {
      // the world goes back to chorus 2 as it was
      settleC2(this.shared);
      releaseC2();
    }
  }
}

// HANDOFF TO THE CHIRP (clip chirp, `opening.ts`, 0.000; the loop). The last frame of this scene (170.639) is the first frame of the
// video: the room at dusk as it was (lived in, the lamp low, the boxes open), the head seated at the kotatsu (`opening.ts` at t = 0), the
// CRT off but for its horizontal white line.
