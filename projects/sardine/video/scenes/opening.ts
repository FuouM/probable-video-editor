// Chirp (bars 1-4, clip chirp; treatment v8 "Plate 0"). The real room at dusk, the head at the kotatsu (R1C1). The CRT
// shows one horizontal white line, the last frame of the outro. The raster opens to the title screen: the logo over
// the platform イワシ (the live picture of the intro clip), PRESS START in amber. On bar 3 PRESS START blinks on the
// beats and the menu confirms DAY 1. From bar 4 the player leans in (the only travelling camera move): the eye goes
// to the glass until the screen fills the frame at bar 5. The tube is a 4:3 screen that shows the 16:9 picture
// letterboxed, so the filled frame is exactly the picture, and the last frames cross-fade into the intro clip's own
// render (it takes over at 7.111 with the same picture).
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { smooth } from '@pve/engine/util';
import { H, W, makeRT } from '@pve/engine/gl';
import { NO_FILM_POST } from '@pve/engine/post';
import { LitAtlas, camera, enableShadows, litMaterial } from '@pve/engine/lit';
import { LitView } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { FPS, SPB } from './_time';
import { loadFonts, type Fonts } from './_fonts';
import { Home } from './_home';
import { MUG } from './_homeFurniture';
import { HeadCam } from './_playerCams';
import { CrtTube } from '@pve/engine/crt';
import { TITLE_INKS, TitleLogo, crtFill, pushToFill, type FillPose } from './_crt';

/** The intro clip starts here (bar 5). */
const T_END = 16 * SPB;
/** Chirp events: the tube opens, the title, START, the menu, the choice, the DAY 1 card, the game picture (all on beats from START). */
const ON = 0.15, TITLE = 0.6, START = 8 * SPB, MENU = 9 * SPB, PICK = 10 * SPB, DAY = 11 * SPB, GAME = 12 * SPB;
const PUSH0 = 12 * SPB;
/** The exposure of the room view. */
const EXPOSURE_ROOM = 0.55, BLOOM_ROOM = 0.55;
/** The exposure of the game's own output pass (the intro clip). */
const EXPOSURE_GAME = 1.05;
/** The looks of the head: the tube, down to the mug (T_MUG), across to the open boxes that are not as they should be (T_BOX), back on the tube (T_BACK, settled before START at bar 3). */
const T_MUG = 0.95, T_BOX = 1.75, T_BACK = 2.6;

export default class Opening extends Scene {
  private A = new LitAtlas(2048);
  private mat = litMaterial(this.A);
  private scene = new THREE.Scene();
  private view = new LitView();
  private cam = camera(32, 0.02, 200);
  private title = new TextLayer();
  private clear = new TextLayer();
  private fonts!: Fonts;
  private home!: Home;
  private head!: HeadCam;
  private game = makeRT(W, H);
  private tube = new CrtTube();
  /** Where the eye is when the screen fills the frame, and what it looks at. */
  private fill!: FillPose;
  private logo!: TitleLogo;
  private titleKey = '';

  override async init() {
    enableShadows(this.ctx.renderer);
    this.fonts = await loadFonts(this.ctx.assets);
    await this.ctx.ensureClip('intro');
    this.home = new Home(this.A, this.mat, this.fonts.kana, this.fonts.latin);
    this.scene.add(this.home.root);
    this.scene.fog = this.home.fog;
    this.clear.commit();
    this.home.setHour(20.2);
    this.home.setLamp(0.06);
    this.home.setScreenLight('#9fb4ff', 2.4);
    this.home.setScreen(this.tube.screen.texture, 1.0);
    this.logo = new TitleLogo(this.fonts);
    this.fill = crtFill(this.home, 42, 1, true);
    const c = this.fill.look;
    // the head: at the kotatsu, on the tube from the first frame so the logo reads. Then three looks, each with a hold: down to the mug on the
    // kotatsu, across to the open boxes beside the set, and back to the tube before PRESS START blinks. The mug and the boxes are tells that
    // chorus 1 uses: the same mug and the same boxes, taped, in the game's copy of the room.
    const eye = this.home.anchors.kotatsu.pos;
    const mug: [number, number, number] = [MUG.at[0], MUG.at[1] + 0.02, MUG.at[2]];
    const box: [number, number, number] = [-1.0, 0.45, -0.45];
    this.home.setBoxesOpen(true);
    this.head = new HeadCam({
      eye: [eye.x, eye.y, eye.z], look: [c.x, c.y - 0.03, c.z], fov: 21,
      turns: [
        { at: T_MUG, look: mug },
        { at: T_BOX, look: box },
        { at: T_BACK, look: [c.x, c.y - 0.03, c.z] },
      ],
    });
  }

  /** Draws the title screen (a pure function of t) into the title layer. */
  private drawTitle(t: number) {
    const beat = t / SPB;
    const key = t < TITLE ? 'off'
      : t < START ? `t${Math.floor(beat * 2) % 2}`
      : t < MENU ? `s${Math.floor(beat * 4) % 2}`
      : t < DAY ? `m${t >= PICK ? Math.floor(beat * 4) % 2 : 2}`
      : t < GAME ? 'day' : 'game';
    if (key === this.titleKey) return;
    this.titleKey = key;
    const l = this.title;
    l.clear();
    // the title screen is full screen: it covers the bars of the game window (title and status) until the game starts
    if (key !== 'game') { l.rect(0, 0, 640, 10, '#000000'); l.rect(0, 350, 640, 10, '#000000'); }
    if (key === 'off' || key === 'game') { l.commit(); return; }
    const sink = l.sink(TITLE_INKS);
    const logo = this.logo;
    if (key === 'day') {
      l.rect(0, 0, 640, 360, '#000000');
      logo.centre(sink, logo.day, 196);
      l.commit();
      return;
    }
    logo.card(l, sink);
    if (key.startsWith('m')) {
      // the menu: はじめから is chosen
      l.rect(226, 262, 188, 52, '#0a0c14', 0.85);
      l.rect(226, 262, 188, 1, '#9aa4b8');
      l.rect(226, 313, 188, 1, '#9aa4b8');
      const kana = this.fonts.kana;
      const on = key !== 'm0';
      if (on) kana.draw(sink, '▶', 238, 284, 4);
      kana.draw(sink, 'はじめから', 258, 284, 1);
      kana.draw(sink, 'つづきから', 258, 306, 5);
    } else if (key.endsWith('0') || key === 's0') logo.text(sink, 'PRESS START', 292, 4);
    l.commit();
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    const t = f.t;
    // the game picture: the intro clip itself at this time (the platform, the sardine waiting). Before the tube comes on the target is black:
    // it must not keep the picture of a frame that was drawn before this one
    if (t >= ON) this.ctx.renderClip('intro', t, this.game);
    else {
      const prev = r.getRenderTarget();
      r.setRenderTarget(this.game);
      r.setClearColor(0x000000, 1);
      r.clear();
      r.setRenderTarget(prev);
    }
    this.drawTitle(t);
    // the lean-in: the eye travels to the glass, easing in and out like a person leaning forward. It arrives on the last frame of the chirp, so the
    // next frame (the intro clip) shows the same picture. The glass shows the live intro picture all along: no crossfade. As the glass fills the frame
    // the room's exposure and bloom hand over to the picture's own (the picture already has its bloom): `fit` writes it through the inverse of the
    // curve, so the last frame shows it exactly.
    const k = smooth((t - PUSH0) / (T_END - 1 / FPS - PUSH0));
    this.tube.draw(r, this.game.texture, {
      linear: false, title: this.title.tex, power: smooth((t - ON) / (TITLE - ON)), show: t < DAY || t >= GAME ? 1 : 0, fit: { weight: k, exposure: EXPOSURE_GAME },
    });
    this.head.apply(this.cam, t);
    // the eye comes onto the axis of the tube first, then in: from off the axis the walls round the glass cut into the picture
    pushToFill(this.cam, this.fill, k, 1 - (1 - k) ** 3);
    this.home.setGlassCurve(1 - k);
    this.view.render(r, this.scene, this.cam, this.home.sky);
    this.view.present(r, out, { exposure: EXPOSURE_ROOM + (EXPOSURE_GAME - EXPOSURE_ROOM) * k, bloom: BLOOM_ROOM * (1 - k) }, this.clear);
    return NO_FILM_POST;
  }

  override dispose() {
    this.view.dispose();
    this.title.dispose();
    this.clear.dispose();
    this.game.dispose();
    this.tube.dispose();
  }
}
