// Lookdev board of the train kit (`pve board video/scenes/kit-train-board.ts -p sardine --at 0.1|0.35|0.6|0.85`):
// 0.10 night exterior with an open door beside a platform, 0.35 inside from the seat anchor, 0.60 inside from the
// aisle anchor, 0.85 the day side view.
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { NO_FILM_POST } from '@pve/engine/post';
import { Builder, LitAtlas, allFaces, ambient, at, camera, enableShadows, litMaterial, litMesh, point, sun } from '@pve/engine/lit';
import { LitView } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { Train } from './_train';

export default class KitTrainBoard extends Scene {
  private atlas = new LitAtlas();
  private scene = new THREE.Scene();
  private view = new LitView();
  private cam = camera(50);
  private text = new TextLayer();
  private train!: Train;
  private moon!: THREE.DirectionalLight;
  private daySun!: THREE.DirectionalLight;
  private amb!: THREE.HemisphereLight;
  private lamps: THREE.PointLight[] = [];

  override init() {
    enableShadows(this.ctx.renderer);
    const A = this.atlas;
    const mat = litMaterial(A);
    const grass = { cell: A.paint(16, 16, (p) => { p.fill('#2f5a2a'); p.speckle('#3d6e33', 0.25, 7); p.speckle('#244a22', 0.2, 9); }) };
    const conc = { cell: A.paint(16, 16, (p) => { p.fill('#8a8a86'); p.speckle('#7a7a76', 0.3, 3); p.rect(0, 0, 16, 1, '#6c6c68'); }) };
    const ballast = { cell: A.paint(8, 8, (p) => { p.fill('#4a4844'); p.speckle('#5c5a54', 0.3, 5); p.speckle('#34322e', 0.3, 9); }) };
    const yellow = { cell: A.solid('#e0b020') };
    const rail = { cell: A.solid('#6a5a50') };
    const sleeper = { cell: A.solid('#4a382a') };
    const wood = { cell: A.paint(8, 8, (p) => { p.fill('#7a5232'); p.rect(0, 3, 8, 1, '#5e3e24'); }) };
    const dark = { cell: A.solid('#3a3a40') };
    const hill = { cell: A.solid('#1d2a24') };
    const lampGlow = { cell: A.solid('#ffe0a0', 6) };
    const g = new Builder();
    g.box(300, 0.1, 300, { py: grass }, at(0, -0.5, 0));
    g.box(300, 0.35, 3.0, { py: ballast, pz: ballast, nz: ballast }, at(0, -0.4, 0));
    for (const z of [-0.5335 - 0.035, 0.5335 + 0.035]) g.box(300, 0.15, 0.07, allFaces(rail), at(0, -0.15, z));
    for (let x = -40; x < 40; x += 0.7) g.box(0.2, 0.1, 2.2, allFaces(sleeper), at(x, -0.25, 0));
    // the platform on the left (+z) side, with its edge line
    g.box(36, 0.95, 5, { py: conc, pz: conc, nz: conc, px: conc, nx: conc }, at(0, 0, 4.2));
    g.box(36, 0.02, 0.22, { py: yellow }, at(0, 0.95, 1.85));
    // a bench and a small shelter with a lamp
    const sh = new Builder();
    for (const x of [8, 12]) for (const z of [4.6, 5.4]) sh.box(0.15, 2.6, 0.15, allFaces(wood), at(x, 0.95, z));
    sh.box(5, 0.12, 1.6, allFaces(dark), at(10, 3.55, 5));
    sh.box(2.4, 0.08, 0.5, allFaces(wood), at(10, 1.4, 5.2));
    for (const x of [9, 11]) sh.box(0.08, 0.45, 0.4, allFaces(wood), at(x, 0.95, 5.2));
    sh.box(0.3, 0.1, 0.3, allFaces(lampGlow), at(10, 3.45, 5));
    // far hills and a lamp on the right side of the track
    const far = new Builder();
    for (let k = 0; k < 9; k++) far.box(26 + (k % 3) * 8, 5 + (k % 4) * 3, 12, allFaces(hill), at(-90 + k * 24, -0.5, -80 - (k % 2) * 10));
    const post = new Builder();
    post.box(0.15, 4, 0.15, allFaces(wood), at(-3, -0.5, -4));
    post.box(0.4, 0.15, 0.4, allFaces(lampGlow), at(-3, 3.45, -4));
    this.scene.add(litMesh(g, mat), litMesh(sh, mat), litMesh(far, mat, { cast: false }), litMesh(post, mat));

    this.train = new Train(A, mat, { cars: 2 });
    this.scene.add(this.train.root);

    this.moon = sun('#9fb4ff', 0.35, 30);
    this.moon.position.set(-20, 30, 25);
    this.daySun = sun('#fff0d0', 3.2, 30);
    this.daySun.position.set(-12, 28, 22);
    this.amb = ambient('#26305a', '#141a14', 0.6);
    this.scene.add(this.moon, this.moon.target, this.daySun, this.daySun.target, this.amb);
    for (const [x, y, z, c] of [[10, 3.3, 5, '#ffcf8a'], [-3, 3.3, -4, '#ffcf8a'], [-10, 3.3, 4, '#ffcf8a']] as [number, number, number, string][]) {
      const l = point(c, 30, 16);
      l.position.set(x, y, z);
      this.scene.add(l);
      this.lamps.push(l);
    }
    this.scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.02, 0.025, 0.05), 0.02);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    const shot = f.lt > 0.97 ? 4 : Math.min(3, Math.floor(f.lt * 4));
    const night = shot < 3;
    this.moon.intensity = night ? 0.35 : 0;
    this.daySun.intensity = night ? 0 : 3.2;
    this.amb.color.set(night ? '#26305a' : '#9fc4ff');
    this.amb.groundColor.set(night ? '#141a14' : '#6a7a58');
    this.amb.intensity = night ? 0.6 : 1.1;
    for (const l of this.lamps) l.intensity = night ? 30 : 0;
    (this.scene.fog as THREE.FogExp2).color.setRGB(night ? 0.02 : 0.55, night ? 0.025 : 0.7, night ? 0.05 : 0.9);
    (this.scene.fog as THREE.FogExp2).density = night ? 0.02 : 0.004;
    this.train.setInterior(night ? 1 : 0.3);
    this.train.setHeadlights(night ? 1 : 0);
    this.train.setDoors('left', shot === 0 ? 1 : 0);
    const cam = this.cam;
    if (shot === 0) {
      cam.fov = 52;
      cam.position.set(-0.5, 2.1, 3.6);
      cam.lookAt(6.5, 2.0, 0.2);
    } else if (shot === 1 || shot === 2) {
      const a = shot === 1 ? this.train.anchors.seat : this.train.anchors.aisle;
      cam.fov = shot === 1 ? 62 : 70;
      cam.position.copy(a.position);
      cam.rotation.set(0, a.rotation.y, 0);
    } else if (shot === 3) {
      cam.fov = 24;
      cam.position.set(0, 1.9, -24);
      cam.lookAt(0, 1.9, 0);
    } else {
      cam.fov = 36;
      cam.position.set(24, 2.4, -9);
      cam.lookAt(2, 1.8, 0);
    }
    cam.updateProjectionMatrix();
    this.view.render(r, this.scene, cam, night
      ? {
        zenith: '#0b1030', horizon: '#2a3466', ground: '#101410', stars: 1,
        body: { dir: new THREE.Vector3(0.5, 0.45, -0.7).normalize(), r: 0.025, colour: '#e8eeff', strength: 3, glow: 2 },
      }
      : {
        zenith: '#5a90d8', horizon: '#c0dcf4', ground: '#6a7a58', stars: 0,
        body: { dir: new THREE.Vector3(-0.4, 0.7, 0.6).normalize(), r: 0.04, colour: '#fff4d0', strength: 6, glow: 2 },
      });
    this.text.clear();
    this.text.commit();
    this.view.present(r, out, { exposure: night ? undefined : 0.9 }, this.text);
    return NO_FILM_POST;
  }

  override dispose() {
    this.view.dispose();
    this.text.dispose();
  }
}
