// Lookdev board of the station kit (`pve board video/scenes/kit-station-board.ts -p sardine --at 0.25`): the halt with
// its line-side scenery and a plain box for a train. --at 0.25 is the night shot (view like the reimagined turn_15,
// the platform from behind with the name board readable), --at 0.75 the day shot (along the platform like turn_09).
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { NO_FILM_POST } from '@pve/engine/post';
import { Builder, type Cell, LitAtlas, ambient, at, camera, enableShadows, litMaterial, litMesh, sun } from '@pve/engine/lit';
import { LitView } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { PixelFont } from '@pve/engine/type';
import { Station, LineSide } from './_station';
import { buildTrack } from '@pve/engine/track';

export default class KitStationBoard extends Scene {
  private atlas = new LitAtlas();
  private scene = new THREE.Scene();
  private view = new LitView();
  private cam = camera(30);
  private text = new TextLayer();
  private station!: Station;
  private line!: LineSide;
  private moon = sun('#9fb4ff', 0.5, 36);
  private sunLight = sun('#fff1d6', 3.0, 36);
  private hemi = ambient('#26305a', '#141a14', 0.6);
  private trainWin!: Cell;
  private night: boolean | null = null;
  private train!: THREE.Mesh;

  override async init() {
    enableShadows(this.ctx.renderer);
    const A = this.atlas;
    const kana = await PixelFont.load('DotGothic16', `${this.ctx.assets}DotGothic16-Regular.ttf`, 16, 'あイワシAbg');
    const mat = litMaterial(A);
    const path = new THREE.LineCurve3(new THREE.Vector3(-250, 0, 0), new THREE.Vector3(250, 0, 0));
    this.scene.add(litMesh(buildTrack(A, path), mat, { cast: false }));
    this.station = new Station(A, mat, kana, { name: 'すのこ' });
    this.line = new LineSide(A, mat, path, 0x5a0d1);
    this.scene.add(this.station.root, this.line.root);

    // the stand-in train: one plain box with a window band
    const cream = { cell: A.solid('#e2d8bc') };
    const red = { cell: A.solid('#8f2f26') };
    const dark = { cell: A.solid('#3a3c42') };
    this.trainWin = A.paint(1, 1, () => {});
    const win = { cell: this.trainWin };
    const car = new Builder();
    car.box(18, 3.0, 2.8, { px: cream, nx: cream, py: dark, pz: cream, nz: cream }, at(0, 0.5, 0));
    car.box(18.02, 0.55, 2.82, { pz: red, nz: red, px: red, nx: red }, at(0, 0.9, 0));
    for (let k = 0; k < 7; k++) {
      car.box(1.7, 0.95, 0.02, { pz: win }, at(-7.5 + k * 2.5, 1.9, 1.41));
      car.box(1.7, 0.95, 0.02, { nz: win }, at(-7.5 + k * 2.5, 1.9, -1.41));
    }
    this.scene.add(this.train = litMesh(car, mat));

    this.scene.add(this.moon, this.moon.target, this.sunLight, this.sunLight.target, this.hemi);
    this.scene.add(...this.station.lights, ...this.line.lights);
    this.scene.fog = new THREE.FogExp2(new THREE.Color(), 0.01);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    // a board plays at song time 100000 + at, so the time into the shot is the fraction of f.t
    const u = f.t % 1;
    const night = u < 0.5;
    if (night !== this.night) {
      this.night = night;
      this.station.setNight(night);
      this.line.setNight(night);
      this.atlas.repaint(this.trainWin, (p) => p.fill(night ? '#ffb048' : '#7fa0b8', night ? 2.2 : 0));
    }
    this.line.setTime(u * 60);
    this.train.position.x = night ? 0 : 38;
    const fog = this.scene.fog as THREE.FogExp2;
    this.moon.visible = night;
    this.sunLight.visible = !night;
    if (night) {
      this.moon.position.set(-18, 30, 26);
      this.moon.target.position.set(0, 0, 3);
      this.hemi.color.set('#26305a'); this.hemi.groundColor.set('#141a14'); this.hemi.intensity = 0.7;
      fog.color.setRGB(0.012, 0.016, 0.04); fog.density = 0.012;
      this.cam.position.set(1, 4.2, 15);
      this.cam.lookAt(1.2, 3.0, 2);
      this.cam.fov = 40;
    } else {
      this.sunLight.position.set(-24, 26, -18);
      this.sunLight.target.position.set(0, 0, 3);
      this.hemi.color.set('#a8c4ff'); this.hemi.groundColor.set('#6a7a50'); this.hemi.intensity = 1.2;
      fog.color.set('#c4d6ec'); fog.density = 0.0035;
      this.cam.position.set(-23, 1.7, -0.6);
      this.cam.lookAt(10, 2.1, 1.8);
      this.cam.fov = 40;
    }
    this.cam.updateProjectionMatrix();
    this.view.render(r, this.scene, this.cam, night
      ? {
        zenith: '#0b1030', horizon: '#2a3466', ground: '#101410', stars: 1,
        body: { dir: new THREE.Vector3(-0.35, 0.55, -0.7).normalize(), r: 0.03, colour: '#e8eeff', strength: 3, glow: 2 },
      }
      : { zenith: '#6f9fe6', horizon: '#d2e2f0', ground: '#6a7a50', stars: 0 });
    this.text.clear();
    this.text.commit();
    this.view.present(r, out, { crt: 0 }, this.text);
    return NO_FILM_POST;
  }

  override dispose() {
    this.view.dispose();
    this.text.dispose();
  }
}

