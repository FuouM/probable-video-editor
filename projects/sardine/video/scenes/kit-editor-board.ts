// Lookdev board of the editor kit (`pve board video/scenes/kit-editor-board.ts -p sardine --at 0.1|0.35|0.6|0.85`):
//  0.1  the clean editor by day with the palette
//  0.35 a bad read: stations rotated and scattered, rails detached, labels doubled, ERR tags, RETRY
//  0.6  the Möbius loop at night from above
//  0.85 a close view along the twisted part with a stand-in train on the underside
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { NO_FILM_POST } from '@pve/engine/post';
import { Builder, ambient, camera, enableShadows, point, sun, type Face } from '@pve/engine/lit';
import { LitView } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { loadFonts } from './_fonts';
import { Editor } from './_editor';

export default class KitEditorBoard extends Scene {
  private scene = new THREE.Scene();
  private view = new LitView();
  private text = new TextLayer();
  private persp = camera(40, 0.1, 400);
  private ed!: Editor;
  private sun = sun('#fff0d0', 2.4, 42);
  private amb = ambient('#bcd0ff', '#4a6a3a', 1.0);
  private cars: THREE.Mesh[] = [];

  override async init() {
    enableShadows(this.ctx.renderer);
    const fonts = await loadFonts(this.ctx.assets);
    this.ed = new Editor(fonts);
    const A = this.ed.atlas;
    this.scene.add(this.ed.root, this.sun, this.sun.target, this.amb);
    // stand-in train: 4 boxes with lit windows
    const body: Face = { cell: A.solid('#b8444c') };
    const roof: Face = { cell: A.solid('#6a6a7a') };
    const win: Face = { cell: A.paint(16, 8, (p) => { p.fill('#b8444c'); for (let i = 1; i < 15; i += 5) p.rect(i, 2, 3, 4, '#ffd890', 3); }) };
    const b = new Builder();
    b.box(2.6, 2.6, 4.6, { px: win, nx: win, py: roof, ny: roof, pz: body, nz: body });
    const geo = b.geometry();
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(geo, this.ed.mat);
      m.castShadow = m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.visible = false;
      for (const s of i % 2 ? [] : [-1, 1]) {
        const l = point('#ffc070', 30, 11);
        l.position.set(s * 2.2, 1.3, 0);
        m.add(l);
      }
      this.scene.add(m);
      this.cars.push(m);
    }
  }

  private placeTrain(u0: number) {
    const loop = this.ed.loop;
    this.cars.forEach((m, i) => {
      const f = loop.frameAt(u0 + i * (4.9 / loop.length), 1);
      const mx = new THREE.Matrix4().makeBasis(f.side, f.up, f.t.clone().negate());
      mx.setPosition(f.p.clone().addScaledVector(f.up, 0.34));
      m.matrix.copy(mx);
      m.matrixWorldNeedsUpdate = true;
      m.visible = true;
    });
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    const ed = this.ed;
    const shot = f.lt < 0.25 ? 0 : f.lt < 0.5 ? 1 : f.lt < 0.75 ? 2 : 3;
    const night = shot >= 2;
    ed.scramble(shot === 1 ? 1 : 0, 7);
    ed.settleMobius(night ? 1 : 0);
    ed.setNight(night ? 1 : 0);
    for (const c of this.cars) c.visible = false;
    this.text.clear();
    let cam: THREE.Camera = ed.cam;
    if (!night) {
      this.sun.color.set('#fff0d0');
      this.sun.intensity = 2.4;
      this.sun.position.set(-18, 40, 12);
      this.amb.intensity = 1.0;
      this.scene.fog = null;
      ed.view(new THREE.Vector3(-3, 0, -3), Editor.PPM);
      ed.drawUi(this.text, shot === 0
        ? { status: 'LINE 01  SEG 1  OK', tool: 'scissors', cursor: { x: 470, y: 150, kind: 'scissors', open: 0.6 } }
        : {
          status: 'REREADING SECTOR 33-48', retry: { n: 1, of: 3 },
          reread: [{ text: 'REREADING SECTOR 33-48', progress: 0.62 }, { text: 'REREADING SECTOR 25-40', progress: 0.3 }],
          errs: [
            { at: ed.stationPosition(1) }, { at: ed.stationPosition(4) }, { at: ed.stationPosition(6), text: '?' },
          ],
          cursor: { x: 330, y: 190 },
        });
    } else {
      this.sun.color.set('#a8bcff');
      this.sun.intensity = 1.1;
      this.sun.position.set(-20, 34, 24);
      this.amb.color.set('#3a4a8a');
      this.amb.groundColor.set('#1a241a');
      this.amb.intensity = 1.3;
      this.scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.03, 0.04, 0.09), 0.006);
      const P = this.persp;
      if (shot === 2) {
        P.position.set(12, 40, 44);
        P.lookAt(0, 1, -2);
        cam = P;
      } else {
        this.placeTrain(0.68);
        const c0 = ed.loop.frameAt(0.5, 1).p;
        const inward = new THREE.Vector3(-c0.x, 0, -c0.z).normalize();
        P.position.set(c0.x + inward.x * 13, 2.2, c0.z + inward.z * 13);
        P.lookAt(ed.loop.frameAt(0.68, 1).p.add(new THREE.Vector3(0, 0.3, 0)));
        cam = P;
      }
    }
    this.view.render(r, this.scene, cam, night
      ? { zenith: '#0b1030', horizon: '#2a3466', ground: '#101410', stars: 1, body: { dir: new THREE.Vector3(-0.4, 0.6, -0.7).normalize(), r: 0.03, colour: '#e8eeff', strength: 3, glow: 2 } }
      : { zenith: '#6a9ad8', horizon: '#bcd4e8', ground: '#4a6a3a' });
    this.text.commit();
    this.view.present(r, out, { exposure: night ? 1.1 : 0.95, bloom: 0.45 }, this.text);
    return NO_FILM_POST;
  }

  override dispose() {
    this.view.dispose();
    this.text.dispose();
    this.ed?.dispose();
  }
}
