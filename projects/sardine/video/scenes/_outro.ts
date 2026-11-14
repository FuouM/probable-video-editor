// The outro (clip outro, 163.556-170.667 s, bars 93-96; treatment v9 "Plate 10"). `chorus3.ts` draws it: chorus 3 and the outro are
// one scene, with no cut at 163.556. This module holds the clock of the outro and the room.
//
//   OutroRoom    167.111 (bar 95): the head jerks back from the glass into the real room at dawn: packed and empty, bare walls with
//                pale rectangles, the bare kotatsu, the boxes all taped. The train of the game, as small as it is on the screen, bursts
//                out through the middle of the glass and flies out into the room, down and to the right, with shards. The glass round
//                the hole is cracked. A second later nothing is there, and the glass is whole: one more thing that leaked. The punched
//                pass lies on the kotatsu. The tube plays the attract mode by itself: the title screen of the opening over a map of the
//                ring line with the train going round, PRESS START on the beats, DAY 1. The head looks at the pass, then at the set. 169.333: the push into the CRT, the tube
//                switches off (the picture collapses to the white line). With the glass filling the frame, the room goes back to its
//                state at the start of the video, and the head leans back to the pose of `opening.ts` at t = 0: the last frame
//                (170.639) is the first frame of the chirp.
//
// A frame depends only on t.
import * as THREE from 'three';
import { clamp01, hashSin, lerp, smooth } from '@pve/engine/util';
import { bigText, type Mask } from '@pve/engine/type';
import { LitAtlas, camera, instanced, litMaterial, v3 } from '@pve/engine/lit';
import { LitView } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { FR, bar, SPB } from './_time';
import type { Fonts } from './_fonts';
import { Home } from './_home';
import { HeadCam } from './_playerCams';
import { CrtTube, TUBE_PLAIN } from '@pve/engine/crt';
import { TITLE_INKS, TitleLogo, crtFill, pushToFill, type FillPose } from './_crt';
import { Train } from './_train';
import { Ticket } from './_ticket';
import { Fish } from './_fish';

/** Bar n of the song starts at `bar(n)` (bar 1 is at 0 s). */

// ---------------------------------------------------------------- the clock
/** The outro starts at bar 93, the end of chorus 3. */
export const T_OUTRO = bar(93);
/** The nose hits the sky wall: bar 94, beat 3. */
export const T_HIT = bar(94) + 2 * SPB;
/** The cut to the room: bar 95. */
export const T_CUT = bar(95);
/** The tube holds the last frame of the crash this long after the cut, then the attract mode plays. */
export const HANG = 0.27;
/** The head jerks back from the glass (the fill pose) to its place in this time after the cut. */
const RECOIL = 0.22;
/** The head looks at the pass on the kotatsu, then at the set. */
const T_PASS = T_CUT + 1.15, T_GLANCE = T_CUT + 1.8;
/** The train of the game is in the room for this long after the cut. Its size in the room: the car is a quarter as wide as the glass. */
const NOSE_TIME = 0.95, NOSE_SCALE = 0.05;
/** The push into the CRT, the tube switching off, the swap of the room back to the start, the lean back. */
const T_PUSH = bar(97) - 3 * SPB;
const T_FILL = T_PUSH + 0.667;
const T_OFF0 = 169.8, T_OFF1 = 170.1;
const T_SWAP = 170.1;
const T_BACK = bar(97) - SPB;
/** The last frame of the video: the loop seam. */
const T_LAST = bar(97) - FR;

/** The shake of the game UI after the hit (px, whole numbers, from the frame number only). */
export function shake(t: number): [number, number] {
  if (t < T_HIT) return [0, 0];
  const f = Math.round((t - T_HIT) * 36), a = 4 * Math.exp(-(t - T_HIT) * 6);
  return [Math.round(Math.sin(f * 12.9898) * a), Math.round(Math.sin(f * 78.233 + 1) * a)];
}

// ---------------------------------------------------------------- the room
/** The room at the start of the video (`opening.ts` at t = 0). */
const CHIRP = { hour: 20.2, lamp: 0.06, screenLight: ['#9fb4ff', 2.4] as const, exposure: 0.55, bloom: 0.55 };

interface Big { ink: Mask; edge: Mask; outer: Mask | null }

export class OutroRoom {
  private A = new LitAtlas(2048);
  private mat = litMaterial(this.A);
  private scene = new THREE.Scene();
  private home: Home;
  private tube = new CrtTube();
  /** The picture of the tube after the crash: the attract mode (the title screen over the map), and the cracks round the hole. */
  private demo = new TextLayer();
  private demoKey = '';
  private logo: TitleLogo;
  private dayMask: Big;
  private fill: FillPose;
  private headDawn: HeadCam;
  private headChirp: HeadCam;
  private cam = camera(42, 0.02, 200);
  private view = new LitView();
  /** The nose of the train that comes out of the glass, and the shards of the glass. */
  private nose = new THREE.Group();
  private shards: THREE.InstancedMesh;
  private normal = new THREE.Vector3();
  private pass: THREE.Object3D;
  private o = new THREE.Object3D();

  constructor(fonts: Fonts) {
    const home = this.home = new Home(this.A, this.mat, fonts.kana, fonts.latin);
    this.scene.add(home.root);
    this.scene.fog = home.fog;
    home.setScreen(this.tube.screen.texture, 1.0);
    this.fill = crtFill(home, 42);
    const c = this.fill.look;
    // the punched pass lies flat on the kotatsu top (the place and the turn of chorus 1, `day.ts`)
    const table = v3(-0.02, 0.459, 0.3);
    const ticket = new Ticket(fonts, Fish.PASS_SCALE);
    ticket.setHoles(ticket.holeCount);
    ticket.root.rotation.x = -Math.PI / 2;
    this.pass = new THREE.Group();
    this.pass.position.copy(table);
    this.pass.rotation.y = 0.93;
    this.pass.add(ticket.root);
    this.scene.add(this.pass);
    // the head at dawn: standing, high. It faces the set while the train comes out of it. Then it looks at the pass, then at the set
    this.headDawn = new HeadCam({
      eye: [home.anchors.kotatsu.pos.x, home.anchors.kotatsu.pos.y, home.anchors.kotatsu.pos.z], look: [c.x + 0.12, c.y - 0.16, c.z], fov: 54,
      turns: [{ at: T_PASS, look: [table.x, table.y, table.z] }, { at: T_GLANCE, look: [c.x + 0.1, c.y - 0.1, c.z] }],
    });
    // the head of the chirp at t = 0: seated at the kotatsu, a little beside the set (`opening.ts`)
    const seat = home.anchors.kotatsu.pos;
    this.headChirp = new HeadCam({ eye: [seat.x, seat.y, seat.z], look: [c.x, c.y - 0.03, c.z], fov: 21 });
    this.logo = new TitleLogo(fonts);
    this.dayMask = bigText(fonts.latin, 'DAY 1', 2, 1, 1);
    // the nose: the front car of the game, small, with its front toward the room
    this.normal.copy(this.fill.pos).sub(c).normalize();
    const car = new Train(this.A, this.mat);
    car.setHeadlights(0.2);
    car.setInterior(0.35);
    car.root.scale.setScalar(NOSE_SCALE);
    this.nose.add(car.root);
    this.nose.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), this.normal);
    this.nose.visible = false;
    this.shards = instanced(new THREE.TetrahedronGeometry(0.03), new THREE.MeshBasicMaterial({ color: 0xcfe4ff, toneMapped: false }), 40);
    this.shards.visible = false;
    this.scene.add(this.nose, this.shards);
  }

  /** The train bursts out through the middle of the glass as the head pulls back: it flies out, down and to the right, and the shards fly. After `NOSE_TIME` nothing is there. */
  private poseNose(t: number) {
    const tau = t - T_CUT;
    const on = tau >= 0 && tau < NOSE_TIME;
    this.nose.visible = this.shards.visible = on;
    if (!on) return;
    // the middle of the car: it starts behind the glass and comes straight out, then its path bends down and to the right of the viewer
    const n = this.normal, right = new THREE.Vector3(n.z, 0, -n.x), o = this.o;
    const out = -0.45 + 2.6 * tau, fall = 1.5 * tau * tau;
    this.nose.position.copy(this.fill.look).addScaledVector(n, out).addScaledVector(right, 0.55 * tau + 0.5 * tau * tau);
    this.nose.position.y -= 1.9 * NOSE_SCALE + fall;
    // the nose leads: it points along the path
    const dir = n.clone().multiplyScalar(2.6).addScaledVector(right, 0.55 + tau).setY(-3 * tau).normalize();
    this.nose.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    for (let i = 0; i < 40; i++) {
      const a = i * 2.399, r = 0.5 + 1.6 * ((i * 37) % 17) / 17, sp = 0.6 + ((i * 13) % 7) / 7;
      o.position.copy(this.fill.look).addScaledVector(n, sp * 1.3 * tau);
      o.position.x += -n.z * Math.cos(a) * r * tau * 0.9;
      o.position.z += n.x * Math.cos(a) * r * tau * 0.9;
      o.position.y += Math.sin(a) * r * tau * 0.7 - 2.2 * tau * tau;
      o.rotation.set(9 * tau + i, 7 * tau, i);
      o.scale.setScalar(0.6 + ((i * 7) % 5) / 4);
      o.updateMatrix();
      this.shards.setMatrixAt(i, o.matrix);
    }
    this.shards.instanceMatrix.needsUpdate = true;
  }


  /**
   * The picture of the tube: in attract mode the title screen of the opening over a map of the ring line (dawn sky, the eight stations,
   * the train going round), PRESS START on the beats and DAY 1. While the train of the game is in the room: the hole in the middle of the
   * glass with the cracks round it.
   */
  private drawDemo(t: number) {
    const attract = t >= T_CUT + HANG;
    const on = attract && Math.floor((t - T_CUT) / SPB * 2) % 2 === 0 ? 1 : 0;
    const broken = t >= T_CUT && t < T_CUT + NOSE_TIME;
    // the train goes round the ring once in two bars, a step of the map for each frame
    const lap = attract ? Math.round(((t - T_CUT) / (8 * SPB)) * 360) : 0;
    const key = `${attract ? 1 : 0}${on}${broken ? 1 : 0}${lap}`;
    if (key === this.demoKey) return;
    this.demoKey = key;
    const l = this.demo;
    l.clear();
    if (attract) {
      this.drawMap(l, (lap / 360) * Math.PI * 2);
      const sink = l.sink(TITLE_INKS);
      this.logo.card(l, sink);
      if (on) this.logo.text(sink, 'PRESS START', 292, 4);
      const m = this.dayMask;
      m.outer?.draw(sink, 16, 18, 3);
      m.edge.draw(sink, 16, 18, 2);
      m.ink.draw(sink, 16, 18, 4);
    }
    if (broken) {
      // the hole: a black patch with a ragged edge. The cracks: jagged rays from its edge, each with a dark side (the glass is thick)
      const cx = 320, cy = 180, h = hashSin;
      for (let y = -26; y <= 26; y += 2) for (let x = -34; x <= 34; x += 2) if ((x / 34) ** 2 + (y / 26) ** 2 < 0.55 + 0.45 * h(x, y)) l.rect(cx + x, cy + y, 2, 2, '#000000');
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2 + 0.5 * (h(i, 1) - 0.5), len = 70 + 130 * h(i, 2);
        let x = cx + Math.cos(a) * 26, y = cy + Math.sin(a) * 20, dir = a;
        for (let s = 0; s < len; s += 3) {
          if (s % 18 === 0) dir = a + 1.1 * (h(i, 3 + s) - 0.5);
          x += Math.cos(dir) * 3; y += Math.sin(dir) * 3;
          l.rect(Math.round(x), Math.round(y), 3, 3, '#0a0c14');
          l.rect(Math.round(x) - 1, Math.round(y) - 1, 2, 2, s < len * 0.6 ? '#f4f8ff' : '#aebcdc');
          // a side crack now and then
          if (s % 36 === 18) for (let q = 1; q < 7; q++) l.rect(Math.round(x + Math.cos(dir + 1.2) * 3 * q), Math.round(y + Math.sin(dir + 1.2) * 3 * q), 2, 2, '#0a0c14');
        }
      }
    }
    l.commit();
  }

  /** The map of the attract mode: a dawn sky, the fields, the ring line with its eight stations, and the train at angle `a` on the ring. */
  private drawMap(l: TextLayer, a: number) {
    // the sky in bands of 8 px, from blue at the top to the warm light at the horizon
    const top = [0x2c, 0x5f, 0x9e], low = [0xf2, 0xc8, 0x8a];
    for (let y = 0; y < 150; y += 8) {
      const k = y / 142, c = top.map((v, i) => Math.round(v + (low[i]! - v) * k));
      l.rect(0, y, 640, 8, (c[0]! << 16) | (c[1]! << 8) | c[2]!);
    }
    // the fields: stripes of two greens
    for (let y = 150; y < 360; y += 6) l.rect(0, y, 640, 6, (y / 6) % 2 === 0 ? '#4f8a3c' : '#47803a');
    // the ring: sleepers and a rail, on an ellipse
    const cx = 320, cy = 236, rx = 280, ry = 80;
    const ring = (u: number) => [Math.round(cx + Math.cos(u) * rx), Math.round(cy + Math.sin(u) * ry)] as const;
    for (let i = 0; i < 360; i++) {
      const [x, y] = ring((i / 360) * Math.PI * 2);
      if (i % 3 === 0) l.rect(x - 1, y - 1, 3, 3, '#6b5038');
      l.rect(x, y, 1, 1, '#2a2a30');
    }
    // the eight stations: a platform and a blue roof
    for (let k = 0; k < 8; k++) {
      const [x, y] = ring((k / 8) * Math.PI * 2 + Math.PI / 8);
      l.rect(x - 7, y - 9, 14, 5, '#2f5f8f');
      l.rect(x - 6, y - 4, 12, 3, '#e8e2d0');
    }
    // the train: three cars, red with a cream band, the front car first
    for (let c = 0; c < 3; c++) {
      const [x, y] = ring(a - c * 0.045);
      l.rect(x - 3, y - 3, 7, 5, '#0a0c14');
      l.rect(x - 2, y - 2, 5, 3, c === 0 ? '#e0443a' : '#b8302a');
      l.rect(x - 2, y - 1, 5, 1, '#f6efdc');
    }
    // the bars of the game window are black, as on the title screen of the opening
    l.rect(0, 0, 640, 10, '#000000');
    l.rect(0, 350, 640, 10, '#000000');
  }

  /**
   * The room at t (from the cut on). `crash`: the last frame of the game before the cut (linear, from `LitView.toScreen`), shown while
   * the tube hangs.
   */
  render(r: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, t: number, crash: () => THREE.Texture) {
    const h = this.home;
    const swapped = t >= T_SWAP;
    // the state of the room: dawn and empty, or (from the swap) the room of the first frame
    h.setPacked(swapped ? 0 : 1);
    h.setBare(!swapped);
    h.setBoxesOpen(swapped);
    h.setHour(swapped ? CHIRP.hour : 6.0);
    h.setLamp(swapped ? CHIRP.lamp : 0);
    h.setScreenLight(swapped ? CHIRP.screenLight[0] : '#b8c6ff', swapped ? CHIRP.screenLight[1] : 4);
    this.drawDemo(t);
    this.poseNose(t);
    // the pass is in the room of the morning after only
    this.pass.visible = !swapped;
    const power = 1 - smooth((t - T_OFF0) / (T_OFF1 - T_OFF0));
    if (t < T_CUT + HANG) {
      // the game hangs on the crash
      this.tube.draw(r, crash(), { ...TUBE_PLAIN, linear: true, title: this.demo.tex });
    } else {
      // the game plays by itself: the attract mode (the layer is the whole picture), until the tube goes off; the white line shows nothing
      this.tube.draw(r, this.demo.tex, { ...TUBE_PLAIN, title: power > 0 ? this.demo.tex : null, power, show: 0 });
    }
    // the camera: the cut lands with the eye at the glass; the head jerks back, a little past its place, and settles; then the push,
    // and (swapped) the lean back to the head of the chirp
    if (t < T_BACK) {
      this.headDawn.apply(this.cam, t);
      const u = (t - T_CUT) / RECOIL;
      const recoil = u < 1 ? (1 - Math.max(0, u)) ** 3 : 0;
      pushToFill(this.cam, this.fill, Math.max(recoil, smooth((t - T_PUSH) / (T_FILL - T_PUSH))));
      const past = 0.05 * Math.sin(Math.PI * clamp01((t - T_CUT - 0.6 * RECOIL) / 0.3));
      if (past > 0) this.cam.position.addScaledVector(this.cam.getWorldDirection(new THREE.Vector3()), -past);
    } else {
      this.headChirp.apply(this.cam, 0);
      pushToFill(this.cam, this.fill, 1 - smooth((t - T_BACK) / (T_LAST - T_BACK)));
    }
    this.view.render(r, this.scene, this.cam, h.sky);
    const d = smooth((t - 169.9) / 0.2);
    // while the train of the game is in the room the glow of the tube is low: the train and the cracks show
    const glare = 0.1 + 0.35 * smooth((t - T_CUT - NOSE_TIME + 0.1) / 0.5);
    this.view.present(r, out, { exposure: lerp(1.1, CHIRP.exposure, d), bloom: lerp(glare, CHIRP.bloom, d) });
  }

  dispose() {
    this.view.dispose();
    this.demo.dispose();
    this.tube.dispose();
    this.home.dispose();
    this.A.tex.dispose();
  }
}
