// The datamosh of あ (chorus 2 end, line 30), from a beat before chorus 3 to its first frame (`chorus3.ts`; chorus 2 shows these frames
// through `renderClip`). The key frame is the last blue screen of chorus 2 (`_bsod.ts`); each frame since moves it along the motion of
// the camera (`@pve/engine/mosh`), and the clean picture of chorus 3 comes in only at the edges. Over the beat the blue screen
// dissolves pixel by pixel into the picture; the cut at T0 is the next key frame.
import * as THREE from 'three';
import { H, W, makeRT } from '@pve/engine/gl';
import { camera } from '@pve/engine/lit';
import type { LitView, Output } from '@pve/engine/litview';
import { Mosh } from '@pve/engine/mosh';
import type { TextLayer } from '@pve/engine/textlayer';
import { FR, SPB } from './_time';
import type { Fonts } from './_fonts';
import { paintBsod } from './_bsod';
import type { PlayerRig } from './_playerRig';
import { T0 } from './_c3stage';

/** あ, a beat before the clip. */
export const T_MOSH = T0 - SPB;

/** What the mosh needs of the scene: its picture, its world posed for a time, and its ride camera. */
export interface MoshHost {
  view: LitView;
  text: TextLayer;
  fonts: Fonts;
  scene: THREE.Scene;
  rig: PlayerRig;
  /** The game picture at t: draws the windows and the text layer and returns the look of the output pass. */
  drawGame(t: number): Output;
  /** Poses the world for t. */
  poseWorld(t: number): void;
  /** Aims `cam` as the ride window with the picture aspect `aspect` shows the world at t. */
  aim(cam: THREE.PerspectiveCamera, t: number, aspect: number): void;
}

export class C3Mosh {
  /** The chain, the clean picture under it, and the cameras of a frame and of the frame before. */
  private readonly mosh = new Mosh();
  private readonly picRT = makeRT(W, H);
  private readonly cam = camera(52, 0.2, 6000);
  private readonly prev = camera(52, 0.2, 6000);
  /** The frame of the mosh chain that `mosh` holds (-1: none). */
  private n = -1;

  /**
   * The frame at t into `out`. The chain of frame n is the chain of frame n - 1 and one step. From a frame before n the chain goes on
   * (playback: one step, or more when the player dropped frames); from a later frame it starts again at the key frame. Both give the
   * same picture.
   */
  /** Drops the chain: the next frame starts it again at the key frame. */
  restart() { this.n = -1; }

  frame(r: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, t: number, h: MoshHost) {
    h.view.present(r, this.picRT, h.drawGame(t), h.text);
    const n = Math.round((t - T_MOSH) / FR);
    if (this.n < 0 || n < this.n) {
      h.text.clear();
      paintBsod(h.text, h.fonts, T_MOSH - FR);
      h.text.commit();
      this.mosh.start(r, h.text.tex);
      this.n = 0;
    }
    for (let k = this.n + 1; k <= n; k++) {
      const tk = T_MOSH + k * FR;
      const ride = h.rig.state(tk).windows.find((w) => w.id === 'ride');
      if (!ride) throw new Error(`chorus3: no ride window at ${tk}`);
      const aspect = h.rig.aspect(ride);
      h.poseWorld(tk);
      for (const [c, at] of [[this.cam, tk], [this.prev, tk - FR]] as const) {
        h.aim(c, at, aspect);
        c.updateProjectionMatrix();
        c.updateMatrixWorld(true);
      }
      this.mosh.step(r, h.scene, this.cam, this.prev, ride.content);
    }
    this.n = n;
    // the blue screen dissolves over the beat: on the last frame before the cut it is gone
    this.mosh.present(r, out, this.picRT.texture, Math.min(1, (t - T_MOSH) / (T0 - FR - T_MOSH)));
  }

  dispose() {
    this.mosh.dispose();
    this.picRT.dispose();
  }
}
