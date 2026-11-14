// The real room of the interlude (`interlude.ts`, 85.333-89.249): deep night, the eye starts at the glass and the head jerks back to the
// kotatsu. The cracks of the ram stay on the CRT glass. The head looks left (a box is there twice), back, right (a sardine hangs still
// under the ceiling) and back; from bar 51 the eye goes into the glass. A frame depends only on t.
import * as THREE from 'three';
import { makeRT, missingMaterial, H, W } from '@pve/engine/gl';
import { LitAtlas, camera, litMaterial, point, v3 } from '@pve/engine/lit';
import { LitView } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { CrtTube, TUBE_PLAIN, plotGlassCrack } from '@pve/engine/crt';
import { clamp01, smooth } from '@pve/engine/util';
import type { Fonts } from './_fonts';
import { Home } from './_home';
import { crtFill, pushToFill, type FillPose } from './_crt';
import { Fish } from './_fish';
import { HeadCam } from './_playerCams';
import { moonImpactPx } from './bridge';
import { TrainPath } from './_bridgepath';
import { PUSH_MOVE, T_LEFT, T_LEFT_BACK, T_PUSH0, T_RIGHT, T_RIGHT_BACK, T_START } from './_interludeClock';

/** The head jerks back from the glass (the fill pose of the moon frame) to the seat in this time after the cut. */
const RECOIL = 0.22;

export class InterludeRoom {
  private readonly roomA = new LitAtlas(2048);
  private readonly fishA = new LitAtlas(512);
  private readonly room = new LitView();
  private readonly tube = new CrtTube();
  /** The last frame of the bridge, which the CRT holds while the game hangs. */
  readonly moonOut = makeRT(W, H);
  private readonly scene = new THREE.Scene();
  private readonly cam = camera(36, 0.02, 200);
  /** The cracks of the ram on the CRT glass: they run on from the impact point of the moon. */
  private readonly crack = new TextLayer();
  private readonly home: Home;
  private readonly fill: FillPose;
  private readonly dupe: THREE.Mesh;
  private readonly head: HeadCam;

  constructor(fonts: Fonts) {
    this.crack.clear();
    plotGlassCrack(this.crack, moonImpactPx(new TrainPath()));
    this.crack.commit();
    const home = new Home(this.roomA, litMaterial(this.roomA), fonts.kana, fonts.latin);
    this.home = home;
    // the player has not packed: the boxes beside the CRT stand open
    home.setBoxesOpen(true);
    this.scene.add(home.root);
    this.scene.fog = home.fog;
    // deep night: the same purple-blue room as the chirp (the walls are lit by the sky and the lamp, the tube adds a little green)
    home.setHour(21.5);
    home.setLamp(0.05);
    home.setScreen(this.tube.screen.texture, 1.0);
    home.setScreenLight('#9ccce0', 1.5);
    for (const l of home.lights) if (l instanceof THREE.HemisphereLight) l.intensity *= 1.8;
    this.fill = crtFill(home, 42);

    // the box that is there twice: a copy of the `ふく` box beside the CRT, half inside the wall, with the face of a missing texture
    this.dupe = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.5), missingMaterial(0.55 / 8));
    this.dupe.position.set(-1.8, 0.4, 0.66);
    this.dupe.rotation.set(0.1, 0.7, 0.08);
    this.dupe.visible = false;
    this.scene.add(this.dupe);

    // the sardine under the ceiling by the balcony door: it hangs still, in one pose, with no animation
    const hang = new Fish(this.fishA, litMaterial(this.fishA));
    hang.pose(0.3, v3(0.95, 2.0, -0.7), v3(0, 0, 0));
    hang.root.rotation.set(0, 2.5, 0.12);
    this.scene.add(hang.root);
    const glow = point('#c8dcff', 0.5, 2.2);
    glow.position.set(0.9, 1.8, -0.3);
    this.scene.add(glow);
    this.head = this.buildHead();
  }

  /** The head at the kotatsu: a person who looks round, 0.4 s for a look, not the 0.25 s of a start. */
  private buildHead(): HeadCam {
    const seat = this.home.anchors.kotatsu;
    const seatLook: [number, number, number] = [seat.look.x, seat.look.y - 0.04, seat.look.z];
    return new HeadCam({
      eye: [seat.pos.x, seat.pos.y, seat.pos.z], look: seatLook, fov: 32,
      slow: 1.6,
      turns: [
        { at: T_LEFT, look: [-1.7, 0.5, 0.85] },
        { at: T_LEFT_BACK, look: seatLook },
        { at: T_RIGHT, look: [0.95, 1.95, -0.75] },
        { at: T_RIGHT_BACK, look: seatLook },
      ],
    });
  }

  /** Compiles the room with the box that is there twice (it shows for the first time at 85.556). */
  compile(r: THREE.WebGLRenderer) {
    this.dupe.visible = true;
    r.compile(this.scene, this.cam);
    this.dupe.visible = false;
  }

  /** Puts the picture `game` on the CRT glass, under the cracks. `linear`: the picture comes from `LitView.toScreen`. */
  show(r: THREE.WebGLRenderer, game: THREE.Texture, linear: boolean) {
    this.tube.draw(r, game, { ...TUBE_PLAIN, linear, title: this.crack.tex });
  }

  /**
   * The room at t into `out`. The cut lands with the eye at the glass (the fill pose of the moon frame); the head jerks back to the seat
   * in 0.22 s, a little past it, and settles. From bar 51 the eye goes to the glass.
   */
  render(r: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, t: number) {
    this.head.apply(this.cam, t);
    this.dupe.visible = t >= T_LEFT && t < T_LEFT_BACK + 0.4;
    const u = (t - T_START) / RECOIL;
    const recoil = u < 1 ? (1 - Math.max(0, u)) ** 3 : 0;
    pushToFill(this.cam, this.fill, Math.max(recoil, smooth((t - T_PUSH0) / PUSH_MOVE)));
    const past = 0.05 * Math.sin(Math.PI * clamp01((t - T_START - 0.6 * RECOIL) / 0.3));
    if (past > 0) this.cam.position.addScaledVector(this.cam.getWorldDirection(new THREE.Vector3()), -past);
    this.room.render(r, this.scene, this.cam, this.home.sky);
    this.room.present(r, out, { exposure: 0.7, bloom: 0.55 });
  }

  dispose() {
    this.room.dispose();
    this.tube.dispose();
    this.moonOut.dispose();
    this.crack.dispose();
    this.roomA.tex.dispose();
    this.fishA.tex.dispose();
    this.dupe.geometry.dispose();
    this.home.dispose();
  }
}
