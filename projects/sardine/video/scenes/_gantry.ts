// The carrier of lines 17-20 (treatment v8 "Plate 7", "Lyric carriers"): LED boards in steel hoops round the track. The train runs
// through each one without a stop. A board carries one phrase of a line. Each syllable is a group of lamps that light on its time:
// bright for 2 frames, then steady. The hoop is fixed. The board hangs in it at the level the train will have when the phrase is whole,
// so the phrase reads upright in the ride cam then, also on the crossing where the train turns over; it does not turn while the train
// comes up to it. When the next board starts to light, the board turns on round its hoop out of the way. A board that the camera has
// reached is not drawn (the camera would pass through it), so a line that has ended is gone.
// `pose(t, upAt, eye)` writes the lamps and the boards for time t: a pure function of its arguments.
import * as THREE from 'three';
import type { Line } from '@pve/engine/lyrics';
import type { PixelFont } from '@pve/engine/type';
import { Builder, allFaces, at, col, instanced, litMesh, type Face, type LitAtlas } from '@pve/engine/lit';
import { smooth } from '@pve/engine/util';
import type { TrackFrame } from '@pve/engine/track';

export interface GantryPhrase {
  line: Line;
  /** The first unit of the phrase and one past its last. */
  from: number;
  to: number;
  /** The frame of the track where the hoop stands. */
  frame: TrackFrame;
}

/** The size of one lamp (a font pixel), m: a glyph is 2.6 m high. */
const LAMP = 0.16;
/**
 * The lit part of a lamp cell, near and far. Near, the dark gap between the lamps shows the dot display. Far, a lamp is a pixel or two
 * of the frame, and the gap breaks the strokes up in a new way on each frame as the board moves: there the lamps fill their cells.
 * The fill goes from near to far between `GAP_NEAR` and `GAP_FAR` metres from the camera.
 */
const FILL_NEAR = 0.82, GAP_NEAR = 10, GAP_FAR = 22;
/** The lower edge of the board over the rail top, and the height of the board, m. */
const CLEAR = 5.0, BOARD_H = 3.4;
const ON = col('#ffb428'), FLASH = col('#fff4c8');
/** A board turns on round its hoop a quarter turn over `TURN_T` s (two beats), from the time the first glyph of the next board lights. */
const TURN_T = 2 * (60 / 135);

/**
 * One board: its group (the plate and the lamps), the lamps in the order they light, and where it stands. `geo`: the lamp box of this
 * board (its own: the fill of the cell changes with the distance), `fill` the fill it has now.
 */
interface Board { root: THREE.Group; hoop: THREE.Mesh; lamps: THREE.InstancedMesh; geo: THREE.BoxGeometry; fill: number; starts: number[]; pos: THREE.Vector3; tangent: THREE.Vector3; /** The lamps that the last pose wrote: from, to. */ hot: [number, number] }

export class LedGantries {
  readonly root = new THREE.Group();
  private boards: Board[] = [];
  /** The corners of the unit lamp box: each board scales them by its fill. */
  private lampBase = Float32Array.from(new THREE.BoxGeometry(1, 1, 1).getAttribute('position').array);
  private lampMat = new THREE.MeshBasicMaterial({ toneMapped: false, fog: false });
  private c = new THREE.Color();
  private flash = FLASH.clone().multiplyScalar(3.4);
  private side = new THREE.Vector3();
  private upv = new THREE.Vector3();
  private xr = new THREE.Vector3();
  private zr = new THREE.Vector3();

  constructor(font: PixelFont, A: LitAtlas, mat: THREE.Material, phrases: readonly GantryPhrase[]) {
    const steel: Face = { cell: A.solid('#3a3e48') }, plate: Face = { cell: A.solid('#0c0e12') }, hood: Face = { cell: A.solid('#1c1e24') };
    const m = new THREE.Matrix4(), s = new THREE.Matrix4().makeScale(LAMP, LAMP, 0.06);
    for (const ph of phrases) {
      const units = ph.line.written!.units.slice(ph.from, ph.to);
      // the lamps of the phrase, in font px from the left end of the row and up from the baseline
      const pts: { x: number; y: number; start: number }[] = [];
      let pen = 0;
      for (const u of units) {
        for (const ch of u.glyph) {
          const g = font.glyph(ch);
          for (let yy = 0; yy < g.h; yy++) for (let xx = 0; xx < g.w; xx++) if (g.bits[yy * g.w + xx]) pts.push({ x: pen + g.x0 + xx, y: -(g.y0 + yy), start: u.start });
          pen += g.adv;
        }
        pen += 1;
      }
      pts.sort((a, b) => a.start - b.start);
      const w = Math.max(8, (pen + 8) * LAMP), half = w / 2;
      // the hoop: a ring of steel round the axis of the track, wide enough for the board at every angle
      const { pos, tangent } = ph.frame;
      const R = Math.hypot(CLEAR + BOARD_H + 0.3, half + 0.3), SEG = 36, len = (2 * Math.PI * (R + 0.4)) / SEG + 0.02;
      const f = new THREE.Matrix4().makeBasis(tangent, ph.frame.up, ph.frame.side).setPosition(pos);
      const hb = new Builder();
      for (let i = 0; i < SEG; i++) hb.box(0.5, 0.4, len, allFaces(steel), f.clone().multiply(m.makeRotationX((i / SEG) * Math.PI * 2)).multiply(at(0, R, 0)));
      const hoop = litMesh(hb, mat, { cast: false });
      this.root.add(hoop);
      // the board in its own frame (x along the track, y up, z to the side): it faces the train that comes. The text runs along +z
      // (the right of a camera that looks along the track)
      const b = new Builder();
      b.box(0.3, BOARD_H, w, { nx: plate, px: hood, py: hood, ny: hood, pz: hood, nz: hood }, at(0.2, CLEAR, 0));
      for (const sz of [-1, 1]) b.box(0.2, 0.2, R - half, allFaces(steel), at(0.2, CLEAR + BOARD_H / 2, sz * (half + (R - half) / 2)));
      const root = new THREE.Group();
      root.matrixAutoUpdate = false;
      root.add(litMesh(b, mat, { cast: false }));
      const y0 = CLEAR + (BOARD_H - font.size * LAMP) / 2 + 0.2 * font.size * LAMP;
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const lamps = instanced(geo, this.lampMat, pts.length, { color: true });
      pts.forEach((p, k) => {
        lamps.setMatrixAt(k, m.makeRotationY(-Math.PI / 2).setPosition(0, y0 + p.y * LAMP, -half + (p.x + 4) * LAMP).multiply(s));
        lamps.setColorAt(k, this.c.copy(ON).multiplyScalar(1.9));
      });
      lamps.count = 0;
      root.add(lamps);
      this.root.add(root);
      this.boards.push({ root, hoop, lamps, geo, fill: 1, starts: pts.map((p) => p.start), pos: pos.clone(), tangent: tangent.clone(), hot: [0, 0] });
    }
  }

  /** `upAt(t)`: the up of the track under the train at time t. `eye`: the camera of the ride. */
  pose(t: number, upAt: (t: number) => THREE.Vector3, eye: THREE.Vector3) {
    this.boards.forEach((bd, i) => {
      // level with the train as it will be when the phrase is whole (its last glyph lights): the up of the train then, turned about the
      // axis of the track here. The board knows it from the start and keeps it, so it does not turn while the train comes up to it
      const next = this.boards[i + 1];
      const go = next ? next.starts[0]! : Infinity;
      this.side.crossVectors(bd.tangent, upAt(bd.starts[bd.starts.length - 1]!)).normalize();
      this.upv.crossVectors(this.side, bd.tangent);
      // a board would hide the next one behind it: when the first glyph of the next one lights, it turns on round its hoop a quarter
      // turn (the way it turns to keep level) and hangs at the side, out of the way of the next phrase. It turns to -side: the ride cam
      // rides on the +side of the car (its left), and a board that came down on that side would fill the frame
      const a = next ? (-Math.PI / 2) * smooth((t - go) / TURN_T) : 0, ca = Math.cos(a), sa = Math.sin(a);
      this.xr.copy(this.upv).multiplyScalar(ca).addScaledVector(this.side, sa);
      this.zr.copy(this.side).multiplyScalar(ca).addScaledVector(this.upv, -sa);
      bd.root.matrix.makeBasis(bd.tangent, this.xr, this.zr).setPosition(bd.pos);
      bd.root.matrixWorldNeedsUpdate = true;
      // not drawn: a board that the camera has reached, and one more than 400 m off (each board is two draw calls in each view). The
      // hoop goes once the camera is 4 m past it: the gantry is behind the camera then, out of view, and gone for good
      const dx = eye.x - bd.pos.x, dy = eye.y - bd.pos.y, dz = eye.z - bd.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz, along = dx * bd.tangent.x + dy * bd.tangent.y + dz * bd.tangent.z;
      bd.root.visible = along < -1.5 && d2 < 400 * 400;
      bd.hoop.visible = along < 4 && d2 < 400 * 400;
      this.fill(bd, FILL_NEAR + (1 - FILL_NEAR) * smooth((Math.sqrt(d2) - GAP_NEAR) / (GAP_FAR - GAP_NEAR)));
      const st = bd.starts;
      let lo = 0, hi = st.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (st[mid]! <= t) lo = mid + 1; else hi = mid; }
      bd.lamps.count = lo;
      bd.lamps.visible = lo > 0;
      // the lamps of the last 4 frames go from the flash to the steady light. The lamps that the call before wrote go back to steady
      // first, so the colours depend on t alone
      const steady = this.c.copy(ON).multiplyScalar(1.9);
      let touched = bd.hot[1] > bd.hot[0];
      for (let k = bd.hot[0]; k < bd.hot[1]; k++) bd.lamps.setColorAt(k, steady);
      let from = lo;
      while (from > 0 && t - st[from - 1]! <= 0.25) from--;
      for (let k = from; k < lo; k++) if (t - st[k]! < 2 / 36) { bd.lamps.setColorAt(k, this.flash); touched = true; }
      bd.hot[0] = from;
      bd.hot[1] = lo;
      if (touched) bd.lamps.instanceColor!.needsUpdate = true;
    });
  }

  /** Scales the lamp box of `bd` to `fill` of its cell across (the depth stays). */
  private fill(bd: Board, fill: number) {
    if (fill === bd.fill) return;
    bd.fill = fill;
    const pos = bd.geo.getAttribute('position') as THREE.BufferAttribute, a = pos.array as Float32Array, b = this.lampBase;
    for (let i = 0; i < a.length; i += 3) { a[i] = b[i]! * fill; a[i + 1] = b[i + 1]! * fill; a[i + 2] = b[i + 2]!; }
    pos.needsUpdate = true;
  }

  dispose() {
    for (const bd of this.boards) bd.geo.dispose();
    this.lampMat.dispose();
  }
}
