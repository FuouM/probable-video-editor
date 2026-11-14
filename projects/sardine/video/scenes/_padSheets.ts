// The sheets of the tear-off pad on the wall of the room (`day.ts`, line 5 of chorus 1): one page tears off on each beat and flutters
// down to the pile under the pad.
import * as THREE from 'three';
import { clamp01, lerp, mulberry32, smooth } from '@pve/engine/util';
import { Builder, LitAtlas, at, litMaterial, litMesh, v3 } from '@pve/engine/lit';
import { Mask } from '@pve/engine/type';
import { SPB } from './_time';
import type { Fonts } from './_fonts';

/** The torn pages: one on each beat. The pad shows its date; after the seventh tear it reads 3. */
const PAD_DATES = [27, 28, 29, 30, 31, 1, 2, 3] as const;
const PAD_WEEKDAYS = '火水木金土日月火';
const TEARS = 7;

/** The sheets of the tear-off pad: one small atlas with a cell for each date, so the shared atlas is never repainted. */
export class PadSheets {
  readonly atlas = new LitAtlas(512);
  readonly mat = litMaterial(this.atlas, { side: THREE.DoubleSide });
  /** The overlay on the pad of the wall: the page that is on top. */
  readonly overlays: THREE.Mesh[] = [];
  /** The pages that fly: page k is the one that the k-th tear takes. */
  readonly flyers: THREE.Mesh[] = [];

  /** `t0`: the time of the first tear (a downbeat); the next tears come one beat apart. */
  constructor(fonts: Fonts, root: THREE.Object3D, private readonly t0: number) {
    const cells = PAD_DATES.map((day, k) => this.atlas.paint(44, 60, (p) => {
      p.fill('#ece6d4'); p.speckle('#e0d8c4', 0.1, day + 3 + k * 7);
      p.rect(0, 52, 44, 8, '#b02828');
      fonts.latin.draw(p.sink({ 1: '#f4efe2' }), k < 5 ? 'OCT' : 'NOV', 14, 7, 1);
      const num = Mask.text(fonts.latin, String(day), 5);
      num.draw(p.sink({ 1: day === 3 || day === 1 ? '#b02828' : '#26262c' }), Math.round((44 - num.w) / 2 - num.x0), 17 - num.y0, 1);
      fonts.kana.draw(p.sink({ 1: '#b02828' }), PAD_WEEKDAYS[k]!, 14, 56, 1);
      if (day === 3) fonts.kana.draw(p.sink({ 1: '#b02828' }), '引越し', 2, 44, 1);
    }));
    const z = -1.35 + 0.0225;
    cells.forEach((cell, k) => {
      const b = new Builder();
      b.quad(v3(-0.1, 1.04, z), v3(0.1, 1.04, z), v3(0.1, 1.3, z), v3(-0.1, 1.3, z), { cell, map: 'fit' }, at(-0.62, 0, 0));
      const m = litMesh(b, this.mat, { cast: false });
      this.overlays.push(m);
      root.add(m);
      if (k >= TEARS) return;
      const f = new Builder();
      f.quad(v3(-0.1, -0.13, 0), v3(0.1, -0.13, 0), v3(0.1, 0.13, 0), v3(-0.1, 0.13, 0), { cell, map: 'fit' });
      const fm = litMesh(f, this.mat, { cast: false });
      fm.rotation.order = 'YXZ';
      this.flyers.push(fm);
      root.add(fm);
    });
  }

  /** The time of the k-th tear. */
  tearAt(k: number): number { return this.t0 + k * SPB; }

  /** Poses the overlay (the page on top) and the flyers (the torn pages) at time t. */
  pose(t: number) {
    const torn = Math.min(TEARS, Math.max(0, Math.floor((t - this.t0) / SPB + 1e-6) + 1));
    this.overlays.forEach((m, k) => { m.visible = k === torn; });
    const F = 0.62;
    this.flyers.forEach((m, k) => {
      const u = t - this.tearAt(k);
      m.visible = u >= 0;
      if (u < 0) return;
      const e = clamp01(u / F);
      const rnd = mulberry32(900 + k);
      const dx = (rnd() - 0.5) * 0.4, dz = 0.25 + rnd() * 0.3, yaw = (rnd() - 0.5) * 2.4;
      const yL = 0.05 + 24 * 0.0017 + 0.012 + k * 0.0016;
      const flutter = (1 - e) * Math.sin(e * 11 + k * 1.7);
      m.position.set(-0.62 + dx * e + 0.07 * flutter, lerp(1.17, yL, e * e) , -1.35 + 0.03 + dz * smooth(e));
      m.rotation.set(-(Math.PI / 2) * smooth(e * 1.15) + 0.35 * flutter, yaw * e, 0.25 * flutter);
    });
  }
}
