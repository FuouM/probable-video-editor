// Proof board of the room kit (`pve board video/scenes/kit-room-board.ts -p sardine --at 0.1`): four shots by time.
//   0.1  night, the CRT on a test picture, the room lit only by the CRT
//   0.35 dusk from the kotatsu, the calendar and the balcony door
//   0.6  packed and empty, grey dawn
//   0.85 from the bed at night
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { NO_FILM_POST } from '@pve/engine/post';
import { LitAtlas, camera, enableShadows, litMaterial } from '@pve/engine/lit';
import { LitView } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { PixelFont } from '@pve/engine/type';
import { Home, type Anchor } from './_home';

/** A test picture for the CRT: noise, the title in kana and a yellow prompt (shaped like the title screen). */
function testPicture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 320;
  cv.height = 240;
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#1c2024';
  g.fillRect(0, 0, 320, 240);
  let s = 7;
  for (let i = 0; i < 2600; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const x = s % 320, y = (s >>> 12) % 240;
    g.fillStyle = (s >>> 24) & 1 ? '#2c3238' : '#101418';
    g.fillRect(x, y, 2, 2);
  }
  g.textAlign = 'center';
  g.fillStyle = '#f4f4ff';
  g.font = '28px "DotGothic16"';
  ['イワシが', 'つちから', 'はえてくるんだ'].forEach((t, i) => g.fillText(t, 160, 70 + i * 34));
  g.fillStyle = '#f0d040';
  g.font = '16px "Silkscreen"';
  g.fillText('PRESS START', 160, 200);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

export default class KitRoomBoard extends Scene {
  private atlas = new LitAtlas();
  private scene = new THREE.Scene();
  private view = new LitView();
  private cam = camera(50);
  private text = new TextLayer();
  private home!: Home;
  private pic!: THREE.CanvasTexture;

  override async init() {
    enableShadows(this.ctx.renderer);
    const kana = await PixelFont.load('DotGothic16', `${this.ctx.assets}DotGothic16-Regular.ttf`, 16, 'あイワシAbg');
    const latin = await PixelFont.load('Silkscreen', `${this.ctx.assets}Silkscreen-Regular.ttf`, 8, 'ABGabg');
    this.home = new Home(this.atlas, litMaterial(this.atlas), kana, latin);
    this.scene.add(this.home.root);
    this.scene.fog = this.home.fog;
    this.pic = testPicture();
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    const h = this.home;
    const t = f.lt;
    let a: Anchor;
    let exposure = 1.3;
    if (t < 0.2) {
      // night, only the CRT
      h.setHour(23); h.setLamp(0); h.setPacked(0); h.setPages(0);
      h.setScreen(this.pic, 1.4); h.setScreenLight('#d4daff', 2.5);
      a = h.anchors.tv;
      exposure = 1.2;
    } else if (t < 0.5) {
      // dusk from the kotatsu, the calendar and the door
      h.setHour(18.7); h.setLamp(0); h.setPacked(0); h.setPages(3);
      h.setScreen(null); h.setScreenLight('#c8d0ff', 0);
      a = { pos: h.anchors.kotatsu.pos, look: new THREE.Vector3(-0.2, 0.8, -1.35), fov: 66 };
    } else if (t < 0.8) {
      // packed and empty, grey dawn, the CRT still on
      h.setHour(6.0); h.setLamp(0.5); h.setPacked(1); h.setPages(5);
      h.setScreen(this.pic, 1.4); h.setScreenLight('#d4daff', 5);
      a = { pos: new THREE.Vector3(1.6, 1.5, -0.9), look: new THREE.Vector3(-1.4, 0.5, 0.3), fov: 70 };
    } else {
      // from the bed at night
      h.setHour(2.0); h.setLamp(0); h.setPacked(0); h.setPages(0);
      h.setScreen(this.pic, 0.7); h.setScreenLight('#b8c4ff', 3);
      a = h.anchors.bed;
    }
    this.cam.fov = a.fov;
    this.cam.position.copy(a.pos);
    this.cam.lookAt(a.look);
    this.view.render(r, this.scene, this.cam, h.sky);
    this.text.clear();
    this.text.commit();
    this.view.present(r, out, { exposure }, this.text);
    return NO_FILM_POST;
  }

  override dispose() {
    this.home.dispose();
    this.view.dispose();
    this.text.dispose();
    this.pic.dispose();
  }
}
