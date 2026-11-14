// The maps of the interlude and verse 2 (`interlude.ts`): the green map of the reread (85.6-92.0: RETRY n/3, the bar of the reread,
// READ OK) and the minimap of verse 2 (the train dot, the shake of the hit, and the faults of the failed loads: the trail of saved
// places, wrong textures, wireframe and a warped projection). A frame depends only on t.
import * as THREE from 'three';
import { Ui } from '@pve/engine/ui';
import { LH, LW } from '@pve/engine/lit';
import type { TextLayer } from '@pve/engine/textlayer';
import { clamp01, hashSin, projectToRect, smooth } from '@pve/engine/util';
import { SPB } from './_time';
import type { Fonts } from './_fonts';
import type { Reread } from './_gameWorld';
import { MAP_PPM, MapCam } from './_playerCams';
import { PlayerTrack } from './_playerTrack';
import type { PlayerState, WinState } from './_playerTypes';
import { T_HIT } from './_wreck';
import { trainDot } from './_sceneKit';
import {
  PUSH_MOVE, T_HANG, T_LEFT_BACK, T_PUSH0, T_RIGHT_BACK, T_SNAP0, T_SNAP1, T_START, T_VERSE, loadAt,
} from './_interludeClock';
import type { InterludeTrain } from './_interludeTrain';

/** The faults of the minimap on the failed loads. */
export interface MiniFault { wrong: boolean; wire: boolean; warp: boolean }

export class InterludeMaps {
  /** The map of the reread: the whole loop, and the end of the stem at its left. */
  readonly mapCam = new MapCam(new PlayerTrack([]), { center: [-42, -92], zoom: 0, notches: [MAP_PPM / 6] });
  readonly miniCam = new MapCam(new PlayerTrack([]), { center: [-4, -100], zoom: 0, notches: [0.58] });

  constructor(private readonly text: TextLayer, private readonly fonts: Fonts, private readonly ortho: THREE.OrthographicCamera, private readonly train: InterludeTrain) {}

  /**
   * The state of the reread at time t. Each retry beat lets the pieces fall toward where they were saved for 0.2 s and throws them about
   * again, with a new seed. The third retry puts them on the crossing.
   */
  reread(t: number): { st: Reread | 'twisted'; retry: number; progress: number; readOk: boolean } {
    const dip = (u: number, a: number, b: number): { seed: number; k: number } => (u < 0.2 ? { seed: a, k: 1 - 0.55 * smooth(u / 0.2) } : { seed: b, k: 0.45 + 0.55 * smooth((u - 0.2) / 0.4) });
    let seed = 48, k = 1, retry = 1, progress = 0.06 + 0.24 * clamp01((t - T_HANG) / (T_RIGHT_BACK - T_HANG));
    if (t >= T_PUSH0) {
      retry = 3;
      const d = dip(t - T_PUSH0, 50, 51);
      seed = d.seed; k = d.k * 0.9;
      progress = 0.62 + 0.38 * smooth((t - T_PUSH0) / (T_SNAP1 - T_PUSH0));
    } else if (t >= T_RIGHT_BACK) {
      retry = 2;
      const d = dip(t - T_RIGHT_BACK, 49, 50);
      seed = d.seed; k = d.k;
      progress = 0.3 + 0.32 * clamp01((t - T_RIGHT_BACK) / (T_PUSH0 - T_RIGHT_BACK));
    } else if (t >= T_LEFT_BACK) {
      const d = dip(t - T_LEFT_BACK, 48, 49);
      seed = d.seed; k = d.k;
    }
    const snap = smooth((t - T_SNAP0) / (T_SNAP1 - T_SNAP0));
    const readOk = t >= T_SNAP1;
    return { st: readOk ? 'twisted' : { k: snap, jitter: 0.75 * k * (1 - snap), seed }, retry, progress, readOk };
  }

  /** The text over the map: `RETRY n/3` (it jumps on every beat), the bar of the reread, READ OK. In the room the CRT is small, so the counter is 6x; during the push it shrinks to 2x. */
  drawOverlay(t: number) {
    const s = this.reread(t);
    const ui = new Ui(this.text, this.fonts.latin);
    const scale = t < T_PUSH0 ? 6 : Math.max(2, Math.round(6 - 4 * smooth((t - T_PUSH0) / PUSH_MOVE)));
    const age = (t - T_START) % SPB;
    const jump = t < T_SNAP0 ? Math.round((scale * 3) * Math.exp(-age * 14)) : 0;
    ui.text(`RETRY ${s.retry}/3`, 8, 34 - jump, '#ffd23a', '#201800', scale);
    if (s.readOk) {
      ui.text('READ OK', 8, 54, '#c8ffc0', '#0a3a14', 2);
      ui.text('3 ERRORS', 8, 74, '#ff5a48', '#300a08', 2);
    }
    // the bar of the reread, at the bottom
    const bw = 300, bx = Math.round((LW - bw) / 2), by = LH - 30;
    this.text.rect(bx - 2, by - 2, bw + 4, 12, '#101418');
    this.text.rect(bx, by, Math.round(bw * s.progress), 8, s.readOk ? '#7ae08a' : '#ffd23a');
    ui.text('REREADING SECTOR 33-48', bx, by - 6, '#e8eefc', '#101418', 1);
  }

  /** The minimap takes the hit at Station もと: the window shakes for half a second. */
  shakeMini(st: PlayerState, t: number) {
    const tau = t - T_HIT;
    if (tau < 0 || tau > 0.6) return;
    const dx = Math.round(5 * Math.exp(-6 * tau) * Math.sin(58 * tau)), dy = Math.round(4 * Math.exp(-6 * tau) * Math.sin(47 * tau + 1));
    const w = st.windows.find((v) => v.id === 'mini');
    if (!w || (dx === 0 && dy === 0)) return;
    w.rect = [w.rect[0] + dx, w.rect[1] + dy, w.rect[2], w.rect[3]];
    w.content = [w.content[0] + dx, w.content[1] + dy, w.content[2], w.content[3]];
  }

  /** The minimap's own marks: the train (a dot that blinks, cyan while it hangs under the crossing), and after the wreck a red dot and rings at Station もと. */
  drawMini(win: WinState | undefined, t: number) {
    if (!win || win.grow < 1) return;
    const [x, y, w, h] = win.content;
    this.miniCam.apply(this.ortho, t, w, h);
    this.ortho.updateMatrixWorld(true);
    this.warpMini(t);
    const p = new THREE.Vector3().setFromMatrixPosition(this.train.carMatrix(Math.min(t, T_HIT), 0)).project(this.ortho);
    const at = projectToRect(p, win.content), [px, py] = at;
    const inside = (ax: number, ay: number) => ax >= x && ay >= y && ax < x + w && ay < y + h;
    const dot = (c: string) => { if (inside(px - 3, py - 3) && inside(px + 3, py + 3)) trainDot(this.text, at, c); };
    // the dot is on for the first half of each beat
    if (t < T_HIT) { if (t % SPB < SPB / 2) dot(this.train.underside(t) ? '#30c8ff' : '#ffd23a'); return; }
    const f = this.miniFault(t);
    this.drawTrail(x, y, w, h, t);
    this.ortho.updateProjectionMatrix();
    if (f.warp) return;
    dot('#ff3030');
    // rings: one on each beat, each grows for two beats
    for (let k = 0; k < 2; k++) {
      const age = ((t / SPB - k) % 2 + 2) % 2;
      const rr = Math.round(4 + 16 * (age / 2));
      for (let a = 0; a < 28; a++) {
        const ax = Math.round(px + rr * Math.cos((a / 28) * Math.PI * 2)), ay = Math.round(py + 0.5 * rr * Math.sin((a / 28) * Math.PI * 2));
        if (inside(ax, ay)) this.text.rect(ax, ay, 1, 1, '#ff3030');
      }
    }
  }

  /**
   * On the last try the map's view matrix reads wrong: the projection gets a shear, a squash and a twist, new on each eighth note.
   * It costs no extra draw. The caller restores the camera with `updateProjectionMatrix` after the draw.
   */
  warpMini(t: number) {
    if (!this.miniFault(t).warp) return;
    const s = Math.floor(t / (SPB / 2)), a = hashSin(s, 1), b = hashSin(s, 2), c = hashSin(s, 3);
    const shx = (a - 0.5) * 1.6, sy = 0.45 + 1.1 * b, rot = (c - 0.5) * 0.9, co = Math.cos(rot), si = Math.sin(rot);
    const m = new THREE.Matrix4().set(
      co, -si + shx, 0, 0,
      si * sy, co * sy, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    this.ortho.projectionMatrix.premultiply(m);
    this.ortho.projectionMatrixInverse.copy(this.ortho.projectionMatrix).invert();
  }

  /**
   * The minimap's fault on the failed loads. From the first try it shows every place the train was saved at (`drawTrail`). The second
   * try reads wrong textures, the third draws the map as wireframe, the fourth does both, and the last one warps the map
   * (`warpMini`) with wrong textures.
   */
  miniFault(t: number): MiniFault {
    const n = loadAt(t);
    return { wrong: n === 1 || n >= 3, wire: n === 2 || n === 3, warp: n >= 4 };
  }

  /**
   * The saved places: from the first failed load a small red dot at every beat of the ride where the train was (verse 2 up to the fault),
   * and the red dot of Station もと.
   */
  private drawTrail(x: number, y: number, w: number, h: number, t: number) {
    if (loadAt(t) < 0) return;
    const p = new THREE.Vector3();
    const put = (at: number, size: number, c: string) => {
      p.setFromMatrixPosition(this.train.carMatrix(at, 0)).project(this.ortho);
      const [ax, ay] = projectToRect(p, [x, y, w, h]);
      if (ax < x || ay < y || ax + size > x + w || ay + size > y + h) return;
      this.text.rect(ax - (size >> 1), ay - (size >> 1), size, size, c);
    };
    for (let at = T_VERSE; at < T_HIT; at += SPB) put(at, 3, '#ff6060');
    put(T_HIT, 5, '#ff3030');
  }
}
