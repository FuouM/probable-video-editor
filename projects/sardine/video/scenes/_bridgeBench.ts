// The benchmark of the bridge effects:
// `bun run pve bench -p sardine --board video/scenes/_bridgeBench.ts#KitBenchBridgeBase,video/scenes/_bridgeBench.ts#KitBenchBridgeLights,...`
// Each mode is one scene that plays a short span of the bridge's world through the ride camera of the bridge. The cost of an
// effect is the difference between its mode and `base` (for `lights`, `letters` and `ring`: the same span without the effect
// is `boids`, `boids` and `disc`).
//   base     the falling train over the clouds (terrain, train, nothing else shows)
//   petals   the four flower walls: Rapier poses of 63 flowers each and the petal bursts (56.7-58.2 s, chase)
//   boids    the baked flock of 460 sleeping birds and the trail (63-66 s, side view)
//   frost    the frost on the ride window: the pixel list written on the text layer at full growth (70.5-71 s)
//   disc     the moon disc with its sheen, rings, the read line and the four steps of cracks (84.6-85.3 s, close-up of the nose)
//   lights   v8: the arp pillars, the aurora, the rims of the ridges, the bursts and the tuna on top of `boids` (63-66 s)
//   letters  v8: the far row of line 14 (about 900 font pixels, one instance each) on top of `boids` (63-66 s)
//   ring     v8: line 16 on the moon disc on top of the hip view (79-81 s)
//   oob      v8: the world of the `[MAP: OUT OF BOUNDS]` window alone, full frame, as the train passes the gap (62.5-66 s)
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { NO_FILM_POST } from '@pve/engine/post';
import { LitAtlas, camera, enableShadows, litMaterial } from '@pve/engine/lit';
import { LitView } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { loadFonts } from './_fonts';
import { PlayerTrack } from './_playerTrack';
import { MapCam, type RideCam } from './_playerCams';
import { TrainPath } from './_bridgepath';
import { BridgeWorld } from './_bridgeworld';
import { BridgeLights, type BridgeMidi } from './_bridgelights';
import { FarLine, MoonRing, arcPlaces } from './_bridgeletters';
import { OobWorld } from './_oob';
import { Frost } from '@pve/engine/frost';
import { bridgeRide } from './bridge';

export type BridgeMode = 'base' | 'petals' | 'boids' | 'frost' | 'disc' | 'lights' | 'letters' | 'ring' | 'oob';

/** The span of song time that each mode plays. */
const SPAN: Record<BridgeMode, readonly [number, number]> = {
  base: [72.0, 72.6], petals: [56.7, 58.2], boids: [63, 66], frost: [70.5, 71], disc: [84.6, 85.3],
  lights: [63, 66], letters: [63, 66], ring: [79, 81], oob: [62.5, 66],
};

export abstract class BridgeBench extends Scene {
  protected abstract readonly mode: BridgeMode;
  private A = new LitAtlas(2048);
  private mat = litMaterial(this.A);
  private view = new LitView();
  private text = new TextLayer();
  private path = new TrainPath();
  private world!: BridgeWorld;
  private frost = new Frost(640, 340, 80);
  private persp = camera(44, 0.3, 4000);
  private scratch = camera(44, 0.3, 4000);
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1);
  private ride!: RideCam;
  private lights: BridgeLights | null = null;
  private row: FarLine | null = null;
  private ring: MoonRing | null = null;
  private oob: OobWorld | null = null;
  private mapCam: MapCam | null = null;

  override async init() {
    enableShadows(this.ctx.renderer);
    this.world = new BridgeWorld(this.A, this.mat, this.path);
    await this.world.init([70.222, 70.444, 70.667, 70.741, 70.815, 70.889, 70.963]);
    this.ride = bridgeRide(this.path);
    const mode = this.mode;
    if (mode !== 'lights' && mode !== 'letters' && mode !== 'ring' && mode !== 'oob') return;
    const fonts = await loadFonts(this.ctx.assets);
    const midi = (await (await fetch(`${this.ctx.assets}midi.json`)).json()) as BridgeMidi;
    const camAt = (t: number) => { this.ride.apply(this.scratch, t); this.scratch.updateMatrixWorld(true); return this.scratch; };
    const lights = new BridgeLights(this.A, this.mat, this.path, midi, camAt, this.world.peaks);
    const lines = this.ctx.lyrics.lines;
    if (mode === 'lights') {
      this.lights = lights;
      this.world.scene.add(lights.root);
    } else if (mode === 'letters') {
      this.row = new FarLine(fonts.kana, { line: lines[14]!, kind: 'bird', ndc: [0.14, 0.58], px: 1.8, dist: 1300, viewH: 330 }, camAt, lights.arpTimes, lights.kicks);
      this.world.scene.add(this.row.mesh);
    } else if (mode === 'ring') {
      const line = lines[16]!;
      const units = line.written!.units;
      this.ring = new MoonRing(fonts.kana, { line, radius: this.path.moon.radius, places: arcPlaces(units.length, 0, 0, 0.62, 170, -170, 10), starts: units.map((u) => u.start) }, lights.arpTimes);
      this.world.moonFrame.add(this.ring.mesh);
    } else {
      this.oob = new OobWorld(this.A, this.mat, this.world.shared, this.path, lights.kicks, lights.snares);
      const follow = (t: number) => { const p = this.path.at(t).p, lift = 1.2247 * (p.y + 1.9); return new THREE.Vector3(p.x + lift, 0, -lift); };
      this.mapCam = new MapCam(new PlayerTrack([{ at: 0, kind: 'follow', on: true }]), { center: [0, 0], zoom: 0, notches: [2.6], yaw: -1, lag: 0.3, follow });
    }
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    const [a, b] = SPAN[this.mode];
    const t = a + (f.lt % (b - a));
    if (this.oob && this.mapCam) {
      this.mapCam.apply(this.ortho, t);
      this.oob.pose(t, this.ortho.quaternion);
      this.view.render(r, this.oob.scene, this.ortho, { zenith: '#04050c', horizon: '#04050c', ground: '#04050c' });
    } else {
      this.world.pose(t);
      this.lights?.pose(t);
      this.row?.pose(t);
      this.ring?.pose(t);
      this.ride.apply(this.persp, t);
      this.view.render(r, this.world.scene, this.persp, this.world.look(t, this.path.at(t).p));
    }
    this.text.clear();
    if (this.mode === 'frost') this.frost.draw(this.text, 0, 10, 1);
    this.text.commit();
    this.view.present(r, out, { exposure: 1.05, bloom: 0.5 }, this.text);
    return NO_FILM_POST;
  }

  override dispose() {
    this.view.dispose();
    this.text.dispose();
    this.world.dispose();
    this.lights?.dispose();
    this.row?.dispose();
    this.ring?.dispose();
    this.oob?.dispose();
  }
}

export class KitBenchBridgeBase extends BridgeBench { protected readonly mode = 'base'; }
export class KitBenchBridgeBoids extends BridgeBench { protected readonly mode = 'boids'; }
export class KitBenchBridgeDisc extends BridgeBench { protected readonly mode = 'disc'; }
export class KitBenchBridgeFrost extends BridgeBench { protected readonly mode = 'frost'; }
export class KitBenchBridgePetals extends BridgeBench { protected readonly mode = 'petals'; }
export class KitBenchBridgeLights extends BridgeBench { protected readonly mode = 'lights'; }
export class KitBenchBridgeLetters extends BridgeBench { protected readonly mode = 'letters'; }
export class KitBenchBridgeRing extends BridgeBench { protected readonly mode = 'ring'; }
export class KitBenchBridgeOob extends BridgeBench { protected readonly mode = 'oob'; }
