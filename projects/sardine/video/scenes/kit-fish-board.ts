// Lookdev board of the fish kit (`pve board video/scenes/kit-fish-board.ts -p sardine --at 0.25`).
// t < 0.5: night, the avatar in profile and in 3/4 view under a warm lamp, the moon behind.
// t >= 0.5: dusk, a planter with the shoal half grown and one sardine lifting off.
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { mulberry32 } from '@pve/engine/util';
import { NO_FILM_POST } from '@pve/engine/post';
import { Builder, LitAtlas, allFaces, ambient, at, camera, enableShadows, litMaterial, litMesh, point, spot, sun } from '@pve/engine/lit';
import { LitView } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { Fish, Shoal } from './_fish';

export default class KitFishBoard extends Scene {
  private atlas = new LitAtlas();
  private view = new LitView();
  private cam = camera(34);
  private text = new TextLayer();
  private night = new THREE.Scene();
  private dusk = new THREE.Scene();
  private fishA!: Fish;
  private fishB!: Fish;
  private fishUp!: Fish;
  private shoal!: Shoal;

  override init() {
    enableShadows(this.ctx.renderer);
    const A = this.atlas;
    const mat = litMaterial(A);
    const grass = { cell: A.paint(16, 16, (p) => { p.fill('#2f5a2a'); p.speckle('#3d6e33', 0.25, 7); p.speckle('#244a22', 0.2, 9); }) };
    const wood = { cell: A.paint(8, 8, (p) => { p.fill('#7a5232'); p.rect(0, 3, 8, 1, '#5e3e24'); }) };
    const dark = { cell: A.solid('#3a3a40') };
    const soil = { cell: A.paint(16, 16, (p) => { p.fill('#4a2c1c'); p.speckle('#5c3824', 0.3, 5); p.speckle('#2e1a10', 0.25, 11); }) };
    const planterWood = { cell: A.paint(8, 8, (p) => { p.fill('#5a3320'); p.rect(0, 2, 8, 1, '#44251a'); p.rect(0, 6, 8, 1, '#44251a'); }) };
    const lamp = { cell: A.solid('#fff0c0', 5) };

    // ---- night: ground, a lamp post, a bench, a fence, two fish
    const n = new THREE.Scene();
    const g = new Builder();
    g.box(60, 0.1, 60, { py: grass }, at(0, -0.1, 0));
    g.box(0.12, 3.4, 0.12, allFaces(wood), at(2.6, 0, 1.0));
    g.box(1.4, 0.1, 0.18, allFaces(dark), at(1.95, 3.3, 1.0));
    g.box(0.36, 0.06, 0.2, { ny: lamp }, at(1.3, 3.25, 1.0));
    g.box(2.2, 0.08, 0.5, allFaces(wood), at(-0.6, 0.5, -1.4));
    for (const x of [-1.5, -0.3]) g.box(0.08, 0.5, 0.4, allFaces(wood), at(x, 0, -1.4));
    for (let k = 0; k < 9; k++) g.box(0.08, 1.2, 0.08, allFaces(wood), at(-5 + k * 1.4, 0, -3.5));
    g.box(12, 0.06, 0.06, allFaces(wood), at(0, 1.0, -3.5));
    n.add(litMesh(g, mat));
    const moon = sun('#9fb4ff', 0.9, 12);
    moon.position.set(-3, 5, -10);
    n.add(moon, moon.target, ambient('#26305a', '#141a14', 1.1));
    const lampL = spot('#ffcf8a', 70, 12, 0.6, 0.6);
    lampL.position.set(1.3, 3.2, 1.0);
    lampL.target.position.set(0, 1.2, 0);
    const lampP = point('#ffc070', 5, 6);
    lampP.position.set(1.3, 3.0, 0.9);
    n.add(lampL, lampL.target, lampP);
    n.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.02, 0.025, 0.05), 0.04);
    this.fishA = new Fish(A, mat);
    this.fishB = new Fish(A, mat);
    n.add(this.fishA.root, this.fishB.root);
    this.night = n;

    // ---- dusk: a planter on a balcony rail, the shoal, one fish leaving
    const d = new THREE.Scene();
    const b = new Builder();
    b.box(60, 0.1, 60, { py: grass }, at(0, -0.1, 0));
    b.box(3.0, 0.5, 0.7, allFaces(planterWood), at(0, 0.5, 0));
    b.box(2.9, 0.02, 0.6, { py: soil }, at(0, 1.0, 0));
    const stand = new Builder();
    for (const x of [-1.3, 1.3]) stand.box(0.1, 0.5, 0.6, allFaces(planterWood), at(x, 0, 0));
    for (let k = 0; k < 8; k++) b.box(0.05, 0.9, 0.05, allFaces(wood), at(-1.4 + k * 0.4, 0, -0.9));
    b.box(3.2, 0.05, 0.07, allFaces(wood), at(0, 0.9, -0.9));
    // crumbs of soil in the air, a fixed scatter
    const rnd = mulberry32(5);
    for (let k = 0; k < 14; k++) {
      const s = 0.012 + rnd() * 0.016;
      b.box(s, s, s, allFaces({ cell: A.solid(k % 2 ? '#4a2c1c' : '#5c3824') }), at(0.85 + rnd() * 0.3, 1.12 + rnd() * 0.4, (rnd() - 0.5) * 0.15));
    }
    d.add(litMesh(b, mat), litMesh(stand, mat));
    const sunL = sun('#ff9a5a', 2.2, 8);
    sunL.position.set(-4, 4, 6);
    d.add(sunL, sunL.target, ambient('#8a6a9a', '#4a3a3a', 1.6));
    d.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.28, 0.14, 0.17), 0.02);
    this.shoal = new Shoal(A, mat, 16, 3);
    this.shoal.scatter(2.6, 0.45);
    this.shoal.root.position.set(0, 1.0, 0);
    this.fishUp = new Fish(A, mat);
    d.add(this.shoal.root, this.fishUp.root);
    this.dusk = d;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    const t = f.lt;
    const isNight = t < 0.5;
    const p = new THREE.Vector3();
    if (isNight) {
      this.cam.position.set(0.3, 1.35, 2.6);
      this.cam.lookAt(0, 1.3, 0);
      this.fishA.pose(t, p.set(-0.55, 1.35, 0), new THREE.Vector3(0.6, 0, 0));
      this.fishB.pose(t, p.set(0.5, 1.2, 0.3), new THREE.Vector3(0.6, 0.12, 0.7));
      this.view.render(r, this.night, this.cam, {
        zenith: '#0b1030', horizon: '#2a3466', ground: '#101410', stars: 1,
        body: { dir: new THREE.Vector3(-0.3, 0.5, -0.8).normalize(), r: 0.04, colour: '#e8eeff', strength: 3, glow: 2 },
      });
    } else {
      this.cam.position.set(-0.2, 1.8, 2.5);
      this.cam.lookAt(0.2, 1.25, 0);
      this.shoal.setGrowth(0.55);
      this.shoal.pose(t);
      this.fishUp.pose(t, p.set(0.9, 1.7, 0), new THREE.Vector3(0.5, 1.2, 0.1));
      this.view.render(r, this.dusk, this.cam, {
        zenith: '#2a1a4a', horizon: '#e0804a', ground: '#201418', stars: 0.1,
        body: { dir: new THREE.Vector3(-0.8, 0.12, -0.5).normalize(), r: 0.05, colour: '#ffc08a', strength: 3, glow: 3 },
      });
    }
    this.text.clear();
    this.text.commit();
    this.view.present(r, out, {}, this.text);
    return NO_FILM_POST;
  }

  override dispose() {
    this.view.dispose();
    this.text.dispose();
  }
}
