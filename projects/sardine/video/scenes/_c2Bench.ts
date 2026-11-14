// The benchmark of the chorus 2 effects (`bun run pve bench -p sardine --board video/scenes/_c2Bench.ts#<Export>,...`).
// Each mode is one scene that plays a short span of `chorus2.ts` itself (the real scene, with a context whose window is that span).
//   seam     the cut from verse 2: the dialog that the jellyfish carries off and drops (106.7-110.4 s)
//   fields   the sardines in the fields, the holes in the platform, the sleepers that fall (110.0-120.0 s)
//   checker  the things without a texture, the first copies of the jellyfish (121.0-128.0 s)
//   crowd    the towers and the pit, twelve copies, the ERR boxes (128.0-134.6 s)
//   sink     everything is pulled into the point (134.6-135.1 s)
import * as THREE from 'three';
import { Scene, type Frame, type SceneCtx } from '@pve/engine/scene';
import Chorus2 from './chorus2';

export type C2Mode = 'seam' | 'fields' | 'checker' | 'crowd' | 'sink';

const SPAN: Record<C2Mode, readonly [number, number]> = {
  seam: [106.7, 110.4],
  fields: [110.0, 120.0],
  checker: [121.0, 128.0],
  crowd: [128.0, 134.6],
  sink: [134.6, 135.1],
};

export abstract class C2Bench extends Scene {
  protected abstract readonly mode: C2Mode;
  private inner!: Chorus2;

  override async init() {
    const ctx: SceneCtx = Object.create(this.ctx, { start: { value: 106.667 }, end: { value: 135.111 } });
    this.inner = new Chorus2(ctx);
    await this.inner.init();
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const [a, b] = SPAN[this.mode];
    return this.inner.render({ ...f, t: a + (f.lt % (b - a)) }, out);
  }

  override dispose() {
    this.inner?.dispose();
  }
}

export class KitBenchC2Checker extends C2Bench { protected readonly mode = 'checker'; }
export class KitBenchC2Crowd extends C2Bench { protected readonly mode = 'crowd'; }
export class KitBenchC2Fields extends C2Bench { protected readonly mode = 'fields'; }
export class KitBenchC2Seam extends C2Bench { protected readonly mode = 'seam'; }
export class KitBenchC2Sink extends C2Bench { protected readonly mode = 'sink'; }
