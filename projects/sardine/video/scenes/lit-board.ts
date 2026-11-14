// Lookdev board of the lit renderer (`pve board video/scenes/lit-board.ts -p sardine`): a night platform with a
// lit car, a lamp over a bench, the moon and stars. It checks light pools, bloom, the dither and shadows.
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { NO_FILM_POST } from '@pve/engine/post';
import { Builder, LitAtlas, allFaces, ambient, at, camera, enableShadows, litMaterial, litMesh, point, spot, sun } from '@pve/engine/lit';
import { LitView } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';

export default class LitBoard extends Scene {
  private atlas = new LitAtlas();
  private scene = new THREE.Scene();
  private view = new LitView();
  private cam = camera(42);
  private text = new TextLayer();

  override init() {
    enableShadows(this.ctx.renderer);
    const A = this.atlas;
    const mat = litMaterial(A);
    const grass = { cell: A.paint(16, 16, (p) => { p.fill('#2f5a2a'); p.speckle('#3d6e33', 0.25, 7); p.speckle('#244a22', 0.2, 9); }) };
    const conc = { cell: A.paint(16, 16, (p) => { p.fill('#8a8a86'); p.speckle('#7a7a76', 0.3, 3); p.rect(0, 0, 16, 1, '#6c6c68'); }) };
    const yellow = { cell: A.solid('#e0b020') };
    const cream = { cell: A.solid('#e8e0c8') };
    const red = { cell: A.solid('#9a2a24') };
    const glass = { cell: A.paint(1, 1, (p) => p.fill('#ffd890', 3)) };
    const wood = { cell: A.paint(8, 8, (p) => { p.fill('#7a5232'); p.rect(0, 3, 8, 1, '#5e3e24'); }) };
    const dark = { cell: A.solid('#3a3a40') };
    const g = new Builder();
    g.box(80, 0.1, 80, { py: grass }, at(0, -0.1, 0));
    // the platform along x, its edge line, the car on the track beside it
    g.box(30, 0.9, 4, { py: conc, pz: conc, nz: conc, px: conc, nx: conc }, at(0, 0, 3));
    g.box(30, 0.02, 0.25, { py: yellow }, at(0, 0.9, 1.3));
    const car = new Builder();
    car.box(16, 2.6, 2.8, { px: cream, nx: cream, py: dark, nz: cream, pz: cream }, at(0, 0.6, -1.0));
    car.box(16.02, 0.5, 2.82, { pz: red, nz: red }, at(0, 1.1, -1.0));
    for (let k = 0; k < 6; k++) car.box(1.6, 0.8, 0.02, { pz: glass }, at(-6.5 + k * 2.4, 2.0, 0.41));
    // the shelter: posts, a roof, a bench under the lamp
    const sh = new Builder();
    for (const x of [3, 7]) for (const z of [3.8, 4.6]) sh.box(0.15, 2.6, 0.15, allFaces(wood), at(x, 0.9, z));
    sh.box(5, 0.12, 1.6, allFaces(dark), at(5, 3.5, 4.2));
    sh.box(2.4, 0.08, 0.5, allFaces(wood), at(5, 1.35, 4.1));
    for (const x of [4, 6]) sh.box(0.08, 0.45, 0.4, allFaces(wood), at(x, 0.9, 4.1));
    this.scene.add(litMesh(g, mat), litMesh(car, mat), litMesh(sh, mat));
    // lights: the moon, the night sky, the lamp, the car's windows
    const moon = sun('#9fb4ff', 0.35, 30);
    moon.position.set(-20, 30, 25);
    this.scene.add(moon, moon.target, ambient('#26305a', '#141a14', 0.6));
    const lamp = spot('#ffcf8a', 40, 14, 0.9, 0.5);
    lamp.position.set(5, 3.35, 4.2);
    lamp.target.position.set(5, 0.9, 4.2);
    this.scene.add(lamp, lamp.target);
    for (let k = 0; k < 3; k++) {
      const l = point('#ffc070', 6, 8);
      l.position.set(-5 + k * 5, 2.1, 1.2);
      this.scene.add(l);
    }
    this.scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.02, 0.025, 0.05), 0.02);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    this.cam.position.set(-9, 2.2, 5.2);
    this.cam.lookAt(6, 1.6, 0.5);
    this.view.render(r, this.scene, this.cam, {
      zenith: '#0b1030', horizon: '#2a3466', ground: '#101410', stars: 1,
      body: { dir: new THREE.Vector3(0.5, 0.45, -0.7).normalize(), r: 0.025, colour: '#e8eeff', strength: 3, glow: 2 },
    });
    this.text.clear();
    this.text.commit();
    this.view.present(r, out, { crt: f.t > 0.7 ? 1 : 0 }, this.text);
    return NO_FILM_POST;
  }

  override dispose() {
    this.view.dispose();
    this.text.dispose();
  }
}
