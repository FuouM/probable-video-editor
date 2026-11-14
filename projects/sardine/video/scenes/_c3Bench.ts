// The benchmark of the chorus 3 effects (`bun run pve bench -p sardine --board video/scenes/_c3Bench.ts#<Export>,...`).
// Each mode is one scene that plays a short span of `chorus3.ts` itself (the real scene, with a context whose window is that span).
//   seam     the eclipse, the eye that comes down to the train, the dialog of line 30, the first typed tuna (135.12-137.9 s)
//   typing   the typing game: the plates on the tuna, the explosions, the sky dome, the arp on the town (138.3-146.0 s)
//   diva     the DIVA game: the notes with their kana and trails, the rings, the judgements, the explosions (150.5-156.0 s)
//   unload   the world unloads round the train: the checker, the chunks that drop (156.0-163.5 s)
//   outro    the flight off the loop, the school, the sky wall with the credits, the hit, the cracks (163.6-167.0 s)
import * as THREE from 'three';
import { Scene, type Frame, type SceneCtx } from '@pve/engine/scene';
import Chorus3 from './chorus3';

export type C3Mode = 'seam' | 'typing' | 'diva' | 'unload' | 'outro';

/** The window of the scene that each mode builds, and the span of song time it plays. */
const SPAN: Record<C3Mode, { window: readonly [number, number]; play: readonly [number, number] }> = {
  seam: { window: [135.1, 138.5], play: [135.12, 137.9] },
  typing: { window: [138.0, 147.0], play: [138.3, 146.0] },
  diva: { window: [149.0, 156.5], play: [150.5, 156.0] },
  unload: { window: [155.5, 163.6], play: [156.0, 163.5] },
  outro: { window: [163.5, 167.05], play: [163.6, 167.0] },
};

export abstract class C3Bench extends Scene {
  protected abstract readonly mode: C3Mode;
  private inner!: Chorus3;

  override async init() {
    const [start, end] = SPAN[this.mode].window;
    const ctx: SceneCtx = Object.create(this.ctx, { start: { value: start }, end: { value: end } });
    this.inner = new Chorus3(ctx);
    await this.inner.init();
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const [a, b] = SPAN[this.mode].play;
    return this.inner.render({ ...f, t: a + (f.lt % (b - a)) }, out);
  }

  override dispose() {
    this.inner?.dispose();
  }
}

export class KitBenchC3Diva extends C3Bench { protected readonly mode = 'diva'; }
export class KitBenchC3Outro extends C3Bench { protected readonly mode = 'outro'; }
export class KitBenchC3Seam extends C3Bench { protected readonly mode = 'seam'; }
export class KitBenchC3Typing extends C3Bench { protected readonly mode = 'typing'; }
export class KitBenchC3Unload extends C3Bench { protected readonly mode = 'unload'; }
