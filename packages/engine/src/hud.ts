// Global HUD layer, composited by the post chain over the graded frame: the crop-mark frame and the
// project overlay (video.json "overlay"). The frame only appears when a scene asks for it (post `frame`).
import * as THREE from 'three';
import { Layer2D, W, H } from './gl';
import { rgba } from './palette';
import type { Overlay } from './scene';
import { clamp, ease, lerp } from './util';

export interface HudState {
  /** HUD opacity from the active scene (post `hud`). */
  opacity: number;
  /** 0..1 the crop-mark frame: 1 in place, 0 flown out past the edges (see PostParams.frame). */
  frame: number;
  /** 0..1: the plate is light (bone paper): crop marks in ink. */
  paper: number;
  /** Values for the project overlay from the active scene (post `overlay`). */
  overlay: Record<string, unknown>;
}

export class Hud {
  layer = new Layer2D();
  private emptyTex = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
  constructor(public overlay: Overlay | null = null) {
    this.emptyTex.minFilter = THREE.NearestFilter;
    this.emptyTex.magFilter = THREE.NearestFilter;
    this.emptyTex.needsUpdate = true;
  }
  draw(t: number, st: HudState) {
    if (st.opacity <= 0.001 || (!this.overlay && st.frame <= 0.001)) {
      return this.emptyTex;
    }
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    c.globalAlpha = st.opacity;
    if (st.frame > 0.001) this.cropMarks(c, st.frame, st.paper > 0.5);
    this.overlay?.draw(c, t, { paper: st.paper, params: st.overlay });
    return L.upload();
  }

  /** Corner marks; as `k` drops they fly out along the diagonals and past the edges. */
  private cropMarks(c: CanvasRenderingContext2D, k: number, ink: boolean) {
    const e = ease.inOutCubic(clamp(k));
    c.save();
    c.globalAlpha *= clamp(k * 3);
    c.strokeStyle = ink ? rgba('ink', 0.45) : rgba('bone', 0.34);
    c.lineWidth = 1.25;
    const m = lerp(-40, 36, e), l = 22;
    c.beginPath();
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
      c.moveTo(x + sx * l, y + 0.5 * sy); c.lineTo(x, y + 0.5 * sy); c.lineTo(x, y + sy * l);
    }
    c.stroke();
    c.restore();
  }

  dispose() {
    this.emptyTex.dispose();
    this.layer.dispose();
  }
}
