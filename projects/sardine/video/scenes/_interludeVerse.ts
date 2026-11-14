// The world of verse 2 (`interlude.ts`, 92.444-106.667) over the game world: the sardine in the front car, Station もと of the wreck kit,
// the LED gantries of lines 17-20, the two voices of the duet (`_versefx.ts`), Platform 8 under the station (line 21 on its signs, the
// failed loads), and the jellyfish that takes the last LOAD ERROR dialog. A pose is a pure function of t.
import * as THREE from 'three';
import { setMissing } from '@pve/engine/gl';
import type { Line } from '@pve/engine/lyrics';
import { LitAtlas, ambient, camera, litMaterial, sun, v3, LH, LW } from '@pve/engine/lit';
import type { LitView } from '@pve/engine/litview';
import { hashSin, smooth } from '@pve/engine/util';
import { FR } from './_time';
import type { Fonts } from './_fonts';
import { Fish } from './_fish';
import { carriedPass } from './_ticket';
import { Jellyfish } from './_jelly';
import type { GameWorld } from './_gameWorld';
import { CAR_PITCH } from './_route';
import { Wreck, T0 as T_WRECK0, T_HIT, V0 } from './_wreck';
import { LedGantries, type GantryPhrase } from './_gantry';
import { P8, Platform8, type SignPhrase } from './_platform8';
import { VerseFx, type VerseNote } from './_versefx';
import type { PlayerState, Vec2 } from './_playerTypes';
import { T_CLICK, T_JELLY, T_LOADERR, T_SINK, T_SLIDE, T_VERSE, loadAt, loadFlash } from './_interludeClock';
import { ROUTE, dAt, type InterludeTrain } from './_interludeTrain';

/** The red modals stand at the top left, clear of the minimap and of the signs of the corridor. */
export const ERR_AT: Vec2 = [20, 40];
/** The plane of the jellyfish's overlay, metres in front of its camera. */
const JELLY_DEPTH = 6;
/** The sardine in the front car (the frame of the car). */
const FISH_AT: [number, number, number] = [2.8, 2.3, 0.5];
/** The platform blocks flicker while the cars clip through them. */
const T_CLIP = [T_HIT, T_HIT + 1.7] as const;
/** The phrases of line 21, one yellow sign each: how many units each phrase has. */
const SIGNS = [4, 5, 3] as const;
/** The phrases of lines 17-20, one gantry each: how many units each phrase has. */
const PHRASES = [[5, 5, 5], [5, 4, 4], [5], [3]] as const;

export class VerseWorld {
  fish!: Fish;
  private wreckA!: LitAtlas;
  private wreck!: Wreck;
  private gantries!: LedGantries;
  p8!: Platform8;
  private fx!: VerseFx;
  private jellyA!: LitAtlas;
  private jelly!: Jellyfish;
  private readonly jellyScene = new THREE.Scene();
  private readonly jellyCam = camera(30, 0.1, 100);

  /** Builds the world of verse 2 into `W3`: `lines` are lines 17-21, `voices` the notes of the duet on the ride and `voices.under` the ones under the station. */
  async build(W3: GameWorld, fonts: Fonts, lines: readonly Line[], voices: { sky: VerseNote[]; ground: VerseNote[]; under: { sky: VerseNote[]; ground: VerseNote[] } }, train: InterludeTrain) {
    // the sardine in the front car
    this.fish = new Fish(W3.atlas, W3.mat);
    this.fish.hold(carriedPass(fonts, true).root);
    W3.cars[0].root.add(this.fish.root);
    // the cabin is lit at night too
    W3.cars[0].setInterior(0.9);

    // Station もと is the station of the wreck kit, in the place of the world's own
    this.wreckA = new LitAtlas(2048);
    this.wreck = new Wreck(this.wreckA, litMaterial(this.wreckA), fonts.kana, true);
    await this.wreck.init();
    this.wreck.scene.applyMatrix4(train.station);
    W3.stations.moto.root.visible = false;
    W3.scene.add(this.wreck.scene);

    this.gantries = new LedGantries(fonts.kana, W3.atlas, W3.mat, gantryPhrases(lines));
    W3.scene.add(this.gantries.root);

    // the speed of the ride and its two voices
    this.fx = new VerseFx(W3.atlas, W3.mat, { frame: (d) => ROUTE.at(d), len: ROUTE.len, dAt, speed: V0, pitch: CAR_PITCH, t0: T_VERSE, t1: T_SLIDE, sky: voices.sky, ground: voices.ground });
    W3.scene.add(this.fx.root);

    this.buildPlatform8(W3, fonts, lines[4]!, train, voices.under);
    this.buildJelly();
  }

  /**
   * Under the station: Platform 8. A sign of line 21 hangs about 14 m ahead of the chase camera (17 m behind the middle of the front car)
   * at the last syllable of its phrase; the sign before it despawns when it lights (`Platform8.pose`).
   */
  private buildPlatform8(W3: GameWorld, fonts: Fonts, l21: Line, train: InterludeTrain, duet: { sky: VerseNote[]; ground: VerseNote[] }) {
    const noseX = (t: number) => train.under(t, 0).x + 10;
    const signs: SignPhrase[] = [];
    const u21 = l21.written!.units;
    let from = 0, lastX = -1e9;
    for (const n of SIGNS) {
      const to = Math.min(u21.length, from + n);
      const x = Math.max(train.under(u21[to - 1]!.start, 0).x - 3, lastX + 2);
      signs.push({ x, line: l21, from, to });
      lastX = x;
      from = to;
    }
    // the name sign `8番のりば` hangs after the signs of the line: the chase camera behind the cars sees the line first, never through the name
    this.p8 = new Platform8(W3.atlas, W3.mat, fonts.kana, { signs, nameX: lastX + 14, tCeil: T_SINK + 0.4, noseX, tLoad: T_LOADERR, duet });
    this.p8.root.applyMatrix4(train.station);
    W3.scene.add(this.p8.root);
  }

  /** The jellyfish that takes the last LOAD ERROR dialog: drawn over the interface (`LitView.renderOver`). */
  private buildJelly() {
    this.jellyA = new LitAtlas(512);
    this.jelly = new Jellyfish(this.jellyA, litMaterial(this.jellyA), { phase: 0.4 });
    this.jellyScene.add(this.jelly.root, ambient('#c8dcff', '#405070', 1.6));
    const s = sun('#e8f0ff', 1.4, 20);
    s.position.set(-3, 6, 8);
    this.jellyScene.add(s, s.target);
    this.jellyCam.aspect = LW / LH;
    this.jellyCam.updateProjectionMatrix();
  }

  /** The things of verse 2 at t; `eye` is the place of the ride camera at t (the gantries face it). */
  pose(t: number, eye: THREE.Vector3, train: InterludeTrain) {
    this.fish.pose(Math.floor(t * 12) / 12, v3(...FISH_AT), v3(0.8, 0, 0), 0);
    // the station is never broken: the cars only clip through it
    this.wreck.pose(T_WRECK0, 0);
    // the cars clip through the platform: its blocks flicker (two faces in one place)
    const clip = t >= T_CLIP[0] && t < T_CLIP[1];
    [...this.wreck.fronts, ...this.wreck.backs].forEach((o, i) => { o.visible = !(clip && hashSin(Math.floor(t * 18), i) < 0.4); });
    this.gantries.pose(t, (u) => ROUTE.at(dAt(u)).up, eye);
    // the gantries stay until the cars fall under the map: the last syllable of line 20 (は) lights on the hit. The boards that the
    // camera has passed are not drawn (`LedGantries.pose`), so after the slide only the last one can show
    this.gantries.root.visible = t < T_SINK + 0.8;
    this.fx.pose(t);
    // the objects of verse 2 rise out of the ground while the save loads
    const rise = Math.max(1e-3, smooth((t - T_CLICK) / (T_VERSE - T_CLICK)));
    this.gantries.root.scale.y = this.fx.root.scale.y = rise;
    this.p8.pose(t, loadAt(t));
    // every failed load takes more of the corridor away and shows the world from under: the ceiling from the second try, the far wall
    // from the fourth (it flickers into the missing texture on the third), the near wall from the fifth. On the first frames of each
    // try the whole shell is gone
    const n = loadAt(t), flash = loadFlash(t), S = this.p8.shell;
    S.floor.visible = !flash;
    S.ceil.visible = !flash && n < 1;
    S.far.visible = !flash && n < 3;
    S.near.visible = !flash && n < 4;
    setMissing(S.far, n === 2 && hashSin(Math.floor(t / (3 * FR)), 31) < 0.5, 0.7);
    setMissing(S.near, n === 3 && hashSin(Math.floor(t / (3 * FR)), 32) < 0.5, 0.7);
    // the light of the corridor is over the cars
    const u = train.under(Math.max(t, T_SINK), 0);
    this.p8.light.position.set(u.x + 9, P8.floor + P8.height - 1.4, P8.z - 3.4);
  }

  /** The jellyfish overlay, once: its target and its programs (the output consumes the overlay). */
  warmOver(r: THREE.WebGLRenderer, view: LitView) {
    this.jelly.holdWindow(T_JELLY + 0.3, this.jellyCam, [ERR_AT[0], ERR_AT[1], 200, 80], JELLY_DEPTH);
    view.renderOver(r, this.jellyScene, this.jellyCam);
  }

  /** From `T_JELLY` the jellyfish comes down onto the title bar of the last dialog and takes it (an overlay over the interface). */
  holdLast(r: THREE.WebGLRenderer, view: LitView, st: PlayerState, t: number) {
    if (t < T_JELLY) return;
    const win = st.windows.find((w) => w.id === 'load-error-22');
    if (!win) return;
    const u = (t - T_JELLY) / 0.3;
    this.jelly.holdWindow(t, this.jellyCam, win.rect, JELLY_DEPTH, { lift: 0.03 + 1.6 * (1 - smooth(u)), grip: smooth(u - 0.6) });
    view.renderOver(r, this.jellyScene, this.jellyCam);
  }

  dispose() {
    this.jellyA.tex.dispose();
    this.wreckA.tex.dispose();
    this.gantries.dispose();
    this.p8.dispose();
    this.fx.dispose();
    this.wreck.dispose();
  }
}

/** Lines 17-20: one gantry for each phrase. The train is under it half a second after the last syllable of the phrase. */
function gantryPhrases(lines: readonly Line[]): GantryPhrase[] {
  const phrases: GantryPhrase[] = [];
  let last = -Infinity;
  PHRASES.forEach((sizes, k) => {
    const line = lines[k]!, units = line.written!.units;
    let from = 0;
    for (const n of sizes) {
      const to = Math.min(units.length, from + n);
      const pass = Math.min(units[to - 1]!.start + 0.3, T_HIT - 0.12);
      const d = Math.max(dAt(pass) + 10, last + 30);
      last = d;
      phrases.push({ line, from, to, frame: ROUTE.at(d) });
      from = to;
    }
  });
  return phrases;
}
