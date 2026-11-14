// A board for the joint between the two cars (`carJoint` in `_train.ts`). Four shots, picked with `--at`:
//   0.1 side, close   0.35 three quarters, from above   0.6 on the loop, the inside of the bend   0.85 the cab front of the first car
// `bun run pve board video/scenes/joint-board.ts -p sardine --at 0.1 --out <png>`
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { NO_FILM_POST } from '@pve/engine/post';
import { loadFonts } from './_fonts';
import { LH, LW, camera, enableShadows, v3 } from '@pve/engine/lit';
import { LitView, type Sky } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { GameWorld, LOOPED } from './_gameWorld';
import { CAR_PITCH, STATIONS, carPose } from './_route';

const DAY: Sky = { zenith: '#3a78d8', horizon: '#a8d0f0', ground: '#6a8a5a' };

export default class JointBoard extends Scene {
  private view = new LitView();
  private text = new TextLayer();
  private world!: GameWorld;
  private persp = camera(40, 0.1, 3000);

  override async init() {
    enableShadows(this.ctx.renderer);
    this.world = new GameWorld(await loadFonts(this.ctx.assets));
    this.world.pose(LOOPED);
    this.world.setLamps(false);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer, W = this.world;
    const shot = Math.min(3, Math.floor(f.lt * 4));
    const s = shot === 2 ? STATIONS.home.s + 150 : STATIONS.home.s + 40;
    W.placeTrain(s, true);
    const j = shot === 3 ? carPose(s + CAR_PITCH / 2 + 1, true) : carPose(s - CAR_PITCH / 2, true);
    const at = v3(j.x, 0, j.z), along = v3(Math.cos(j.yaw), 0, -Math.sin(j.yaw)), left = v3(-along.z, 0, along.x);
    const eye = [[left, 7, 2.2, 0.6], [left, 9, 7, 4], [left, -10, 4, 3], [left, 2.5, 2.4, 7]][shot]! as [THREE.Vector3, number, number, number];
    this.persp.position.copy(at).addScaledVector(eye[0], eye[1]).addScaledVector(along, eye[3]).setY(eye[2]);
    this.persp.lookAt(at.clone().setY(2));
    this.persp.aspect = LW / LH;
    this.persp.updateProjectionMatrix();
    W.light('close', 'day', at);
    this.view.render(r, W.scene, this.persp, DAY);
    this.text.clear();
    this.text.commit();
    this.view.present(r, out, { exposure: 1.05 }, this.text);
    return NO_FILM_POST;
  }

  override dispose() {
    this.view.dispose();
    this.text.dispose();
    this.world.dispose();
  }
}
