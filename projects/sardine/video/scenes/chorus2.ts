// Chorus 2 (clip chorus_2, 106.667-135.111 s, bars 61-76); treatment v9 "Plate 8".
// The player keeps playing on the broken save. The main view is the ride on the twisted loop of the one game world (`_gameWorld.ts`),
// and the lines of chorus 1 happen to that world for real (`_c2world.ts`). The jellyfish is the desktop buddy (`_buddy.ts`).
//
//   106.667  The seam from verse 2: the dialog of line 22 with the jellyfish on its title bar, the minimap, the fish cam and the cursor
//            stand on both sides of the cut. The cursor presses OK once more, and this time the state loads: the day of the save, the
//            train at speed on the loop. The lap is 8 bars long: the loop from the end of the crossing round to its start, then the crossing.
//   lap 1    line 23 (109.779) sardines grow out of the fields. Line 24 (113.779) holes open in the platform of ホーム as the train runs it
//            through, then in the ground. 115.278 the crossing: line 25 (116.89), the sleepers go from under the wheels.
//   lap 2    line 26 (120.89) things lose their texture, line 27 (124.0) they flicker. Line 28 (128.0) the towers build down from the
//            clouds. 129.5 the crossing: line 29 (131.112), the ground opens under the train that hangs from the track, and the day goes dark.
//   The camera  On the loop: a chase view behind the train. On the crossing the arm swings out to the side and stays upright while the
//            train turns over in front of it: the pillars, the car that hangs under the track and the ground under it are in the frame.
//   The jellyfish  One act for each phrase (`_c2script.ts`). It carries the dialog off before the cursor can press it, and drops it: it
//            breaks on the status bar. It offers the next line in a balloon with two buttons (the cursor presses NO twice: nothing), and
//            knocks on the glass. It sits on the fish cam, dodges the cursor twice and laughs. It grabs the cursor and holds on for a bar.
//            It lifts a reminder and drops it. From bar 69 it multiplies along the status bar and the title bars, and a copy takes the
//            cursor for good. Between its acts it has business of its own: it turns about itself, floats over to the minimap and knocks
//            there, laughs at its copies. It speaks the `ko` lines in its balloon.
//   Reminders  Each lead line is a pop-up of the jellyfish (`_c2apps.ts`): a small dialog with the line and a button, and the `ca` voice
//            as a second copy of it 3 px off. The player clicks them away. From bar 69 a small ERR box opens on every snare.
//   131.112  Line 29 (めが): Ctrl+Alt+Del. The Close Program box lists one JELLY.EXE for each copy. The player selects the last one, but
//            the copy that holds the cursor drags it one row down: the player ends WINMGR.EXE, the window manager, and presses End
//            Task again in the box that asks. On the first hit of the drum fill the desktop tears for 4 frames, then the screen drops to
//            a blue text mode (`@pve/engine/textmode`) whose game world loses frames as it goes; the jellyfish stand still over it and
//            explode into characters on the hits; each hit is a fault of the whole screen, and the text mode breaks (bigger characters,
//            rows that slide and fall). Beat 3 of bar 76: the full blue screen (`_bsod.ts`). Beat 4 (line 30, あ): it breaks into
//            characters that fall away, and behind them the world is back in the look of chorus 3 and gets its frames back. See
//            HANDOFF TO CHORUS 3.
import * as THREE from 'three';
import { Scene, type Frame, type SceneCtx } from '@pve/engine/scene';
import type { Line } from '@pve/engine/lyrics';
import { projectToRect, smooth, hashSin } from '@pve/engine/util';
import { NO_FILM_POST } from '@pve/engine/post';
import { LH, LW, camera, col, enableShadows, v3 } from '@pve/engine/lit';
import { LitView, type Output, type Sky } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { CELL_H, CELL_W, TextMode, WHOLE, type Collapse } from '@pve/engine/textmode';
import { BAR, SPB, FR } from './_time';
import { lineAt, loadFonts, loadLanes, type Fonts } from './_fonts';
import { subtitle } from './_subtitle';
import { acquireC2, carMatrix, LAP, lapAt, releaseC2, settleC2, SIDE_ARM, SPEED, T_CROSS, upright, type C2Shared } from './_c2shared';
import type { Fish } from './_fish';
import type { GameWorld } from './_gameWorld';
import type { C2World } from './_c2world';
import { Buddy } from './_buddy';
import { crashBanners, paintBsod } from './_bsod';
import { centreOf, clickAt, type WinState } from './_playerTypes';
import { PlayerTrack } from './_playerTrack';
import { PlayerRig } from './_playerRig';
import { FishCam, MapCam, RideCam } from './_playerCams';
import { MAP_SKY, trainDot, warmFrames } from './_sceneKit';
import { C2Script } from './_c2script';
import { FILL, T0, T_COPIES, T_END, T_KILL, T_REVEAL, T_SINK } from './_c2clock';

// ---------------------------------------------------------------- the ride
// The lap, the speed and the car matrices are in `_c2shared.ts`: chorus 3 rides on from them.
/** The frame of the ride cam: the place and the heading of the front car, but upright. On the crossing the train turns over in front of a camera that does not. */
const uprightMatrix = (t: number) => upright(carMatrix(t, 0));
/** The train is on the crossing for this long (s). */
const CROSS_TIME = LAP.cross / SPEED;
const FISH_AT: [number, number, number] = [2.8, 2.3, 0.5];

/** The afternoon of the save, before a storm: a heavy yellow-grey sky. Far off there is sheet lightning on some snares. */
const SKY_DAY: Sky = { zenith: '#77754f', horizon: '#d6cc8c', ground: '#4a5a3a' };
const SKY_FLASH: Sky = { zenith: '#b9b89a', horizon: '#fff9d8', ground: '#5a6a4a' };
/** The storm takes this much of the light of the day. */
const STORM_DIM = 0.22;
/** The sky that line 29 goes to: the dark blue of the eclipse of chorus 3. */
const SKY_DARK: Sky = { zenith: '#0a1030', horizon: '#38507e', ground: '#182418' };

/** The text mode of the crash: the message on banners at the top (the baseline y in px, the text). */
const CRASH_LINES: readonly (readonly [number, string])[] = [
  [10, 'WINMGR: A fatal exception 0E has occurred at 0028:C0011E36 in VXD JELLY(01) + 00010E36.'],
  [21, 'Press any key to continue'],
];
/**
 * The text mode loses frames as it goes: frame k of `CRASH_FRAMES` shows at T_KILL + D (k / N)^1.8, so the gaps grow from under a
 * frame to about 0.14 s by the blue screen. Returns the time that the frame of t shows.
 */
const CRASH_FRAMES = 16;
function crashStep(t: number): number {
  const D = T_SINK - T_KILL, k = Math.floor(CRASH_FRAMES * Math.pow(Math.max(0, (t - T_KILL) / D), 1 / 1.8) + 1e-9);
  return T_KILL + D * Math.pow(k / CRASH_FRAMES, 1.8);
}

export default class Chorus2 extends Scene {
  private fonts!: Fonts;
  /** Lead lines 22-30: `lead[k]` pairs with `ko[k]` and `ca[k]`. */
  private lead: Line[] = [];
  private view = new LitView();
  private text = new TextLayer();
  private persp = camera(52, 0.2, 6000);
  private fishLens = camera(36, 0.03, 400);
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1);
  private rig!: PlayerRig;
  private track!: PlayerTrack;
  private miniCam!: MapCam;
  private shared!: C2Shared;
  private world!: GameWorld;
  private events!: C2World;
  private fish!: Fish;
  private ride!: RideCam;
  private fishCam!: FishCam;
  private buddy!: Buddy;
  private textMode = new TextMode(FR);
  /** From あ this clip shows chorus 3 (`render`): true when that clip is loaded. */
  private c3 = false;
  private sky: Sky = { ...SKY_DAY };
  /** The snares with sheet lightning: each third one. */
  private flashes: number[] = [];

  constructor(ctx: SceneCtx) { super(ctx); }

  override async init() {
    enableShadows(this.ctx.renderer);
    this.fonts = await loadFonts(this.ctx.assets);
    const lanes = loadLanes();
    this.lead = this.ctx.lyrics.lines.filter((l) => l.i >= 22 && l.i <= 30);
    if (this.lead.length !== 9) throw new Error(`chorus2: expected the lead lines 22-30, found ${this.lead.length}`);
    const ko = lanes.ko.lines.slice(0, 8), ca = lanes.ca.lines.slice(0, 8);
    const midi = (await (await fetch(`${this.ctx.assets}midi.json`)).json()) as { notes: { track: number; start: number }[] };
    const snares = [...new Set(midi.notes.filter((n) => n.track === 18).map((n) => Math.round(n.start * 1000)))].sort((a, b) => a - b).map((ms) => ms / 1000);
    this.flashes = snares.filter((s) => s >= T0 + 2 && s < T_SINK).filter((_, i) => i % 3 === 1);

    const shared = (this.shared = await acquireC2(this.fonts, this.lead, ko));
    this.world = shared.world;
    this.events = shared.events;
    this.fish = shared.fish;
    this.ride = new RideCam({
      pose: uprightMatrix,
      // the arm swings out before each crossing, and back behind the train after the first one
      mode: [
        // back behind the train a second after the first crossing: its end is at the foot of the mountain, and the arm would swing through it
        { at: -Infinity, mode: 'chase34' }, { at: T_CROSS - 0.5, mode: 'side', swing: 0.9 }, { at: T_CROSS + CROSS_TIME + 0.9, mode: 'chase34', swing: 0.9 },
        { at: T_CROSS + 8 * BAR - 0.5, mode: 'side', swing: 0.9 },
      ],
      // the side arm is on the west of the crossing: the pit and its towers are beyond the train, the mountain is behind the eye
      offsets: { chase34: { eye: [-17, 5.4, 4.5], look: [10, 3.4, 0], fov: 52, lag: 0.14 }, side: { eye: [...SIDE_ARM.eye], look: [...SIDE_ARM.look], fov: SIDE_ARM.fov, lag: SIDE_ARM.lag } },
    });
    this.fishCam = new FishCam({ pose: (t: number) => carMatrix(t, 0), fish: () => FISH_AT, eye: [-0.55, 0.12, -0.42], look: [0.25, 0, 0.1], fov: 34 });
    this.buildPlayer(ko, ca, snares.filter((s) => s >= T_COPIES - 1e-3 && s < T_SINK - 0.3));
    // from あ this clip shows the picture of chorus 3 under the datamosh
    if (this.ctx.end > T_REVEAL) {
      await this.ctx.ensureClip('chorus_3');
      this.c3 = true;
    }
    // the frames that show each part for the first time, so no frame of the clip compiles a program
    warmFrames(this.ctx.renderer, this.view, this.text, [T0 + 0.1, 112, 118.5, 123, 126.5, 130.5, 133.5, T_SINK + 0.2], (t) => this.drawGame(t));
  }

  /** The player and the jellyfish (`C2Script`): the buddy, then the cursor's clicks on the buttons of its offer. */
  private buildPlayer(ko: Line[], ca: Line[], snares: readonly number[]) {
    const f = this.fonts;
    const script = new C2Script(f, this.lead, ko, ca, snares), inputs = script.inputs;
    // the plan is complete: the jellyfish can say where the buttons of its offer are
    this.buddy = new Buddy(f, script.plan, (t) => { const c = this.track.cursorAt(t); return [c.x, c.y]; });
    const offer = script.offer;
    for (const p of offer.presses) inputs.push(...clickAt(p.at, centreOf(this.buddy.offerButton(offer.line, p.i, p.at)), { dur: 0.3 }));
    this.track = new PlayerTrack(inputs, { cursor: script.cursor0, speed: 'play' });
    this.rig = new PlayerRig({ track: this.track, fonts: f, bars: false, ticker: '', counter: '' });
    this.miniCam = new MapCam(new PlayerTrack([]), { center: [-4, -100], zoom: 0, notches: [0.58] });
  }

  // ---------------------------------------------------------------- the picture

  /** How far line 29 has taken the day away (0..1). */
  private dark(t: number): number { return smooth((t - this.lead[7]!.start) / (T_END - this.lead[7]!.start)); }

  /** The sky of the ride at t: the storm, its sheet lightning (pale for 2 frames, and once more a moment later), and the dark of line 29. */
  private skyAt(t: number, k: number): Sky {
    let flash = 0;
    for (const s of this.flashes) { const a = t - s; if (a >= 0 && a < 0.3) flash = a < 2 * FR || (a > 0.14 && a < 0.14 + 2 * FR) ? 1 : 0.25 * (1 - a / 0.3); }
    flash *= 1 - k;
    for (const key of ['zenith', 'horizon', 'ground'] as const) this.sky[key] = `#${col(SKY_DAY[key]).clone().lerp(col(SKY_FLASH[key]), flash).lerp(col(SKY_DARK[key]), k).getHexString()}`;
    return this.sky;
  }

  /** The 3D of window `win`. While the program hangs on that window (`Buddy.shownAt`), it shows the frame of the start of the beat. */
  private renderWin(win: WinState, v: LitView, now: number) {
    const r = this.ctx.renderer, W3 = this.world;
    const t = this.buddy.shownAt(win.id, now);
    if (t !== now) this.poseWorld(t);
    if (win.id === 'mini') {
      this.miniCam.apply(this.ortho, t, win.content[2], win.content[3]);
      W3.light('map', 'day', v3(0, 0, -100));
      W3.mapLod(true);
      v.render(r, W3.scene, this.ortho, MAP_SKY);
      W3.mapLod(false);
    } else {
      const cam = win.id === 'ride' ? this.persp : this.fishLens;
      cam.aspect = this.rig.aspect(win);
      (win.id === 'ride' ? this.ride : this.fishCam).apply(cam, t);
      cam.aspect = this.rig.aspect(win);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      const k = this.dark(t);
      W3.light('close', 'day', new THREE.Vector3().setFromMatrixPosition(carMatrix(t, 0)), STORM_DIM + (0.8 - STORM_DIM) * k);
      v.render(r, W3.scene, cam, this.skyAt(t, k));
    }
    if (t !== now) this.poseWorld(now);
  }

  private poseWorld(t: number) {
    // the world is shared with chorus 3: it stands by itself here, whole, with the light of its own cars
    settleC2(this.shared);
    this.world.cars.forEach((car, k) => {
      car.root.matrixAutoUpdate = false;
      car.root.matrix.copy(carMatrix(t, k));
      car.root.matrixWorldNeedsUpdate = true;
    });
    this.fish.pose(Math.floor(t * 12) / 12, v3(...FISH_AT), v3(0.8, 0, 0), 0);
    this.events.pose(t);
  }

  /** The train on the minimap: a dot that blinks on the beat (on for the first half of each), cyan while it hangs under the crossing. */
  private drawMini(win: WinState | undefined, t: number) {
    if (!win || win.grow < 1) return;
    const [x, y, w, h] = win.content;
    this.miniCam.apply(this.ortho, t, w, h);
    this.ortho.updateMatrixWorld(true);
    const p = new THREE.Vector3().setFromMatrixPosition(carMatrix(t, 0)).project(this.ortho);
    const at = projectToRect(p, win.content), [px, py] = at;
    if (px - 3 < x || py - 3 < y || px + 3 >= x + w || py + 3 >= y + h || t % SPB >= SPB / 2) return;
    trainDot(this.text, at, LAP.at(lapAt(t)).up.y < 0 ? '#30c8ff' : '#ffd23a');
  }

  /**
   * The whole picture of the game at time t, to あ. End Task tears the desktop for 4 frames; then the screen is in text mode, and its
   * game world loses frames as it goes (`crashStep`). Over the fill the text mode breaks (`collapse`), and every hit of the fill is a
   * fault of the whole screen (`hit`). Beat 3 of bar 76 is the full blue screen. From あ `render` shows chorus 3 (`moshInto`).
   */
  private drawGame(t: number): Output {
    const r = this.ctx.renderer, l = this.text;
    if (t >= T_SINK && t < T_REVEAL) {
      l.clear();
      paintBsod(l, this.fonts, t);
      const ln = lineAt(this.lead, t);
      if (ln) subtitle(l, this.fonts, ln, t);
      l.commit();
      return { exposure: 1.05, bloom: 0.5 };
    }
    // in the text mode the game world loses frames (`crashStep`); the rest of the frame keeps the full rate
    const crash = t >= T_KILL, tw = crash ? crashStep(t) : t;
    const st = this.rig.state(tw);
    this.buddy.apply(st, t, []);
    this.poseWorld(tw);
    this.rig.compose(r, this.view, st, (win, v) => this.renderWin(win, v, tw));
    if (crash) this.textMode.read(r, this.view.rt.texture);
    l.clear();
    if (crash) {
      const lines = CRASH_LINES.map(([y, s], i) => [y, i === 1 && Math.floor(t / (SPB / 2)) % 2 === 0 ? `${s} _` : s] as const);
      this.textMode.draw(l, this.collapse(t));
      crashBanners(l, this.fonts, lines);
      for (const b of this.buddy.blasts(t)) this.textMode.burst(l, b.x, b.y, b.r, b.tau, b.seed);
      this.hit(t);
    } else {
      // the program, its faults and the jellyfish go over the windows and under the cursor
      this.rig.draw(l, st, (l) => {
        this.drawMini(st.windows.find((w) => w.id === 'mini'), t);
        this.buddy.corrupt(l, t);
        this.buddy.draw(l, t);
      });
      if (t >= FILL[0]) this.tear(t);
    }
    const ln = lineAt(this.lead, t);
    if (ln) subtitle(l, this.fonts, ln, t);
    l.commit();
    this.buddy.render(r, this.view, t);
    return { exposure: 1.05, bloom: 0.5, top: this.rig.top };
  }

  /**
   * The text mode breaks over the fill: on the second hit its characters get twice as big, on the third three times. From the second
   * hit the rows slide to the sides, and they fall out of the frame one after the other, so that little of it is left by the blue screen.
   */
  private collapse(t: number): Collapse {
    if (t < FILL[1]) return WHOLE;
    const s = t < FILL[2] ? 2 : 3, cw = CELL_W * s, ch = CELL_H * s;
    const go = Math.min(1, (t - FILL[1]) / 0.25);
    return {
      scale: s,
      slide: (row) => Math.round(((hashSin(row, 31) - 0.5) * 2 * 48 * go) / cw) * cw,
      drop: (row) => {
        const u = t - (FILL[1] + 0.1 + 0.45 * hashSin(row, 77));
        if (u < 0) return 0;
        const y = 0.5 * 2600 * u * u;
        return y > LH ? Infinity : Math.round(y / ch) * ch;
      },
    };
  }

  /**
   * A hit of the fill in the text mode (from its second hit on) is a fault of the whole screen for 3 frames: the picture rolls down by
   * rows and comes back, and bands of it tear to the sides. The first frame turns the palette over: white characters on the blue of
   * the blue screen.
   */
  private hit(t: number) {
    let i = -1;
    for (let k = 1; k < FILL.length; k++) if (t >= FILL[k]) i = k;
    if (i < 0) return;
    const f = Math.floor((t - FILL[i]!) / FR + 1e-6);
    if (f > 2) return;
    const d = this.text.data, row = LW * 4, copy = d.slice();
    // the roll: the picture moves down by whole rows of characters (the rows of the layer data run from the bottom)
    const dy = [3, 1, 0][f]! * CELL_H * 2;
    for (let y = 0; y < LH; y++) {
      const from = (((y - dy) % LH) + LH) % LH;
      d.set(copy.subarray((LH - 1 - from) * row, (LH - from) * row), (LH - 1 - y) * row);
    }
    // the bands: on the first two frames, strips of rows move to the sides by whole characters
    if (f < 2) {
      const line = new Uint8Array(row);
      for (let y = 0, band = 0; y < LH; band++) {
        const h = CELL_H * (1 + Math.floor(hashSin(band, i * 7 + f) * 4));
        const dx = hashSin(band, i * 7 + f + 3) < 0.5 ? 0 : Math.round((hashSin(band, i * 7 + f + 5) - 0.5) * 30) * CELL_W;
        for (let j = y; j < Math.min(LH, y + h) && dx !== 0; j++) {
          const o = (LH - 1 - j) * row, s = ((dx % LW) + LW) % LW;
          line.set(d.subarray(o, o + row));
          d.set(line.subarray(s * 4), o);
          d.set(line.subarray(0, s * 4), o + (LW - s) * 4);
        }
        y += h;
      }
    }
    if (f === 0) {
      for (let o = 0; o < d.length; o += 4) {
        if (d[o + 3] === 0) continue;
        // light characters and ink turn white; the ground, the dim characters and the blue banners turn blue
        const on = d[o]! > 60;
        d[o] = on ? 255 : 0; d[o + 1] = on ? 255 : 0; d[o + 2] = on ? 255 : 170;
      }
    }
  }

  /**
   * The death of the window manager, 4 frames: the desktop tears into bands that slide further apart each frame, and on the third
   * frame its colours turn over. The next frame is the text mode.
   */
  private tear(t: number) {
    const l = this.text, d = l.data, f = Math.floor((t - FILL[0]) / FR + 1e-6) + 1;
    const row = new Uint8Array(LW * 4);
    for (let y = 0, band = 0; y < LH; band++) {
      const h = 4 + Math.floor(hashSin(band, f) * 22), dx = Math.round((hashSin(band, f + 9) - 0.5) * 120 * f);
      for (let j = y; j < Math.min(LH, y + h); j++) {
        const o = (LH - 1 - j) * LW * 4, s = ((dx % LW) + LW) % LW;
        row.set(d.subarray(o, o + LW * 4));
        d.set(row.subarray(s * 4), o);
        d.set(row.subarray(0, s * 4), o + (LW - s) * 4);
        if (f === 3) for (let i = o; i < o + LW * 4; i += 4) if (d[i + 3]! > 0) { d[i] = 255 - d[i]!; d[i + 1] = 255 - d[i + 1]!; d[i + 2] = 255 - d[i + 2]!; }
      }
      y += h;
    }
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    // from あ to the cut this clip is chorus 3: it datamoshes the blue screen away in its own picture (`chorus3.ts`)
    if (f.t >= T_REVEAL && this.c3) {
      if (!this.ctx.renderClip('chorus_3', f.t, out)) throw new Error('chorus2: the clip chorus_3 is not loaded');
    } else this.view.present(this.ctx.renderer, out, this.drawGame(f.t), this.text);
    return NO_FILM_POST;
  }

  override dispose() {
    this.view.dispose();
    this.text.dispose();
    this.rig?.dispose();
    this.buddy?.dispose();
    this.textMode.dispose();
    if (this.shared) releaseC2();
  }
}

// HANDOFF TO CHORUS 3 (clip chorus_3, `chorus3.ts`, 135.111). Chorus 3 draws the same world (`_c2shared.ts`) and rides on from this
// state. The state of this scene on its last frame (135.083):
//  - The desktop is empty: the window manager died on the fill of bar 76; the blue screen of beat 3 is datamoshed into chorus 3's own
//    picture from あ. Every jellyfish exploded. The cursor lies at the bottom of the frame (`CURSOR_REST`, `_c2apps.ts`).
//  - No dialog stands: the desktop died with the window manager.
//  - `[Train 1 - Ride Cam]` is maximized. The train is on the crossing, near its end: `twistLap()` position `SPEED * (t - 115.278)` with
//    one lap in 8 bars (about 138 km/h). It comes down upright onto the loop before Station すのこ at about 134.8.
//  - The camera: `RideCam` side, eye [-18, 3.5, -15], look [8, -2.5, 0], fov 58, on a frame that stays upright.
//  - The world: day, 80 % of its light gone (`GameWorld.light('close', 'day', focus, 0.8)`), the sky near `SKY_DARK`. The pit is open
//    under the crossing, the towers are in it. The sleepers of the crossing are gone. The sardines stand in the fields between もと and
//    ホーム. The tuna are at their nearest: a stream 15 to 40 m over the loop that leads the train by 20 to 75 degrees.
