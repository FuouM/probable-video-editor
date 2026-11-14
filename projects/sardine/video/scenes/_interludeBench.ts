// The benchmark of the interlude and verse 2 effects:
// `bun run pve bench -p sardine --board video/scenes/_interludeBench.ts#KitBenchInterludeRoom,video/scenes/_interludeBench.ts#KitBenchInterludeTwist,video/scenes/_interludeBench.ts#KitBenchInterludeRide,video/scenes/_interludeBench.ts#KitBenchInterludeWreck`
// Each mode is one scene that plays a short span of `interlude.ts` itself (the real scene, with a context whose window is that span).
//   room    the real room with the open boxes, the checker box, the hanging sardine and the CRT with the map on it (85.5-87.9 s)
//   twist   the one game world as the green map, full frame: the pieces of the stem thrown about, the crossing settled, the modal,
//           the camera that goes down to the train (89.4-92.4 s)
//   ride    the ride on the twisted world: the crossing, the LED gantries, the minimap and the fish cam, the light of the days (93-100.8 s)
//   wreck   Station もと and its Rapier wreck in the world, the cars under the map, the grid, line 21, the failed loads (101.2-105.1 s)
// The bridge clip is not loaded in a board, so the CRT of `room` does not hold the last frame of the bridge.
import * as THREE from 'three';
import { Scene, type Frame, type SceneCtx } from '@pve/engine/scene';
import Interlude from './interlude';

export type InterludeMode = 'room' | 'twist' | 'ride' | 'wreck';

/** The window of the scene that each mode builds, and the span of song time it plays. */
const SPAN: Record<InterludeMode, { window: readonly [number, number]; play: readonly [number, number] }> = {
  room: { window: [85.4, 88.6], play: [85.5, 87.9] },
  twist: { window: [89.0, 92.4], play: [89.4, 92.4] },
  ride: { window: [93.0, 101.0], play: [93.0, 100.8] },
  wreck: { window: [101.0, 106.0], play: [101.2, 105.1] },
};

export abstract class InterludeBench extends Scene {
  protected abstract readonly mode: InterludeMode;
  private inner!: Interlude;

  override async init() {
    const [start, end] = SPAN[this.mode].window;
    const ctx: SceneCtx = Object.create(this.ctx, { start: { value: start }, end: { value: end } });
    this.inner = new Interlude(ctx);
    this.inner.freezeBridge = false;
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

export class KitBenchInterludeRoom extends InterludeBench { protected readonly mode = 'room'; }
export class KitBenchInterludeTwist extends InterludeBench { protected readonly mode = 'twist'; }
export class KitBenchInterludeRide extends InterludeBench { protected readonly mode = 'ride'; }
export class KitBenchInterludeWreck extends InterludeBench { protected readonly mode = 'wreck'; }
