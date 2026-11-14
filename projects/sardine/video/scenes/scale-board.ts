// The board for the houses of the town (treatment v9, "The game world: Scale"). Three shots, picked with `--at`:
//   0.1   the map at the player's house (the houses at `MAP_HOUSE`)
//   0.45  beside the train at ホーム, looking across it at the street (the houses at `CLOSE_HOUSE`)
//   0.8   in the street, at the height of a person
// `bun run pve board video/scenes/scale-board.ts -p sardine --at 0.1 --out <png>`
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { NO_FILM_POST } from '@pve/engine/post';
import { loadFonts } from './_fonts';
import { LH, LW, camera, enableShadows, v3 } from '@pve/engine/lit';
import { LitView, type Sky } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { GameWorld, HOUSE, LOOPED, STREET } from './_gameWorld';
import { STATIONS, carPose } from './_route';
import { PlayerTrack } from './_playerTrack';
import { MapCam } from './_playerCams';

const MAP_SKY: Sky = { zenith: '#3a6a34', horizon: '#3a6a34', ground: '#3a6a34' };
const DAY: Sky = { zenith: '#3a78d8', horizon: '#a8d0f0', ground: '#6a8a5a' };

export default class ScaleBoard extends Scene {
  private view = new LitView();
  private text = new TextLayer();
  private world!: GameWorld;
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
  private persp = camera(48, 0.2, 3000);
  private mapCam = new MapCam(new PlayerTrack([]), { center: [HOUSE.x - 6, HOUSE.z - 6], zoom: 0, notches: [9] });

  override async init() {
    enableShadows(this.ctx.renderer);
    const W = new GameWorld(await loadFonts(this.ctx.assets));
    W.pose(LOOPED);
    W.setLamps(false);
    W.placeTrain(STATIONS.home.s + 6, true);
    this.world = W;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer, W = this.world;
    const car = carPose(STATIONS.home.s + 6, true);
    const at = v3(car.x, 0, car.z);
    if (f.lt < 0.3) {
      this.mapCam.apply(this.ortho, 0);
      W.light('map', 'day', at);
      this.view.render(r, W.scene, this.ortho, MAP_SKY);
    } else {
      if (f.lt < 0.65) {
        // the eye stands on the side of the track away from the street and looks across the train at the houses
        const toStreet = v3(HOUSE.x - car.x, 0, HOUSE.z - car.z).normalize();
        const along = v3(Math.cos(car.yaw), 0, -Math.sin(car.yaw));
        this.persp.position.copy(at).addScaledVector(toStreet, -13).addScaledVector(along, 16).setY(2.4);
        this.persp.lookAt(at.clone().addScaledVector(toStreet, 18).addScaledVector(along, -12).setY(3.2));
      } else {
        this.persp.position.set(HOUSE.x + 34, 1.3, STREET.z + 0.8);
        this.persp.lookAt(HOUSE.x - 30, 3.6, STREET.z - 1);
      }
      this.persp.aspect = LW / LH;
      this.persp.updateProjectionMatrix();
      W.light('close', 'day', v3(this.persp.position.x - 20, 0, this.persp.position.z));
      this.view.render(r, W.scene, this.persp, DAY);
    }
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
