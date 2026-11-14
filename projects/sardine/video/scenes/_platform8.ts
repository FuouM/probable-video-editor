// Platform 8 (treatment v9 "Plate 7", lines 20-21 and the failed loads): what is under Station もと. A white tiled corridor of an
// underground station, far too long: cold tubes of light, posters, and yellow signs that hang from the ceiling. The first
// sign reads `8番のりば`. The others carry line 21, a phrase on each: a glyph shows when its syllable is sung.
// The cars come down through the ceiling and slide along the corridor: the tubes go out as the cars pass.
// The duet of verse 2 goes on here in unison (`duet`): on each note of the sky voice a bar of light runs along the ceiling from
// ahead of the cars toward the camera, and on each note of the ground voice a band of light runs along the yellow strip of the floor.
// Each failed load shows the corridor whole again, with one thing that is not as it was (`variant`): the number on the sign, the
// eyes of the fish on the posters, a tube that is out. The scene takes the shell away piece by piece (`shell`).
//
// Local frame: the frame of the station (x along the track, the platform on the +z side, the rail top at y = 0). The corridor
// runs along x. `pose(t, variant)` writes everything for time t: a pure function of its arguments.
import * as THREE from 'three';
import type { Line } from '@pve/engine/lyrics';
import { Mask, type PixelFont } from '@pve/engine/type';
import { Builder, allFaces, at, col, instanced, litMesh, point, v3, type Face, type LitAtlas } from '@pve/engine/lit';
import { smooth } from '@pve/engine/util';
import type { VerseNote } from './_versefx';

/** The corridor: the floor (y), the height, the middle (z), half the width, and its ends (x). */
export const P8 = { floor: -15, height: 5.2, z: 2.2, half: 4.6, x0: -40, x1: 150 } as const;
/** The hole in the ceiling that the cars come through (x from, to). */
const HOLE: readonly [number, number] = [-8, 20];
const TUBE_STEP = 7;
/** A lamp of a sign glyph (a font pixel), m. */
const LAMP = 0.12;
/**
 * The duet: a light starts this far ahead of the nose of the front car on its note and runs toward the camera at this speed (m/s), so
 * it passes over the cars and the camera (about 27 m behind the nose) before it goes. It is as long as its note has been held, at most
 * `DUET_LEN` m; it goes in `DUET_RELEASE` s after the note. At most `DUET_LIGHTS` of each voice.
 */
const DUET_AHEAD = 30, DUET_RUN = 150, DUET_LEN = 22, DUET_RELEASE = 0.35, DUET_LIGHTS = 6;
const SKY_COL = { lo: col('#7fd6ff'), hi: col('#e8f6ff') }, GROUND_COL = { lo: col('#ff9a3c'), hi: col('#ffe08a') };

export interface SignPhrase { x: number; line: Line; from: number; to: number }

export interface Platform8Spec {
  /** The signs of the line, in order along the corridor. */
  signs: readonly SignPhrase[];
  /** The x of the sign `8番のりば`. */
  nameX: number;
  /** The time at which the nose of the front car passes the ceiling. */
  tCeil: number;
  /** The x of the nose of the front car at a time of the first slide, and the time of the first failed load (the slide ends there). */
  noseX: (t: number) => number;
  tLoad: number;
  /** The two voices of the duet in the first slide: the sky voice runs along the ceiling, the ground voice along the floor. */
  duet: { sky: readonly VerseNote[]; ground: readonly VerseNote[] };
}

interface Sign { plate: THREE.Mesh; lamps: THREE.InstancedMesh; starts: number[] }

export class Platform8 {
  readonly root = new THREE.Group();
  /** The light of the corridor: it goes with the cars. The scene puts it where the camera looks. */
  readonly light = point('#dcecff', 0, 70);
  private tubesOn: THREE.InstancedMesh;
  private tubeX: number[] = [];
  private tubeOut: number[] = [];
  private signs: Sign[] = [];
  /** The lights of the duet (ceiling and floor), and the lowest and the highest pitch of the duet. */
  private duet: THREE.InstancedMesh;
  private pitch: [number, number];
  private names: THREE.Object3D[] = [];
  private posters: THREE.Object3D[][] = [];
  /** The shell of the corridor: the floor, the far wall (with the dark ends), the near wall, and the ceiling with its tubes. */
  readonly shell: { floor: THREE.Mesh; far: THREE.Mesh; near: THREE.Mesh; ceil: THREE.Group };
  private lampMat = new THREE.MeshBasicMaterial({ toneMapped: false, fog: false });
  private lampGeo = new THREE.BoxGeometry(1, 1, 1);
  private o = new THREE.Object3D();
  private c = new THREE.Color();

  constructor(A: LitAtlas, mat: THREE.Material, font: PixelFont, private spec: Platform8Spec) {
    const { floor, height, z: zc, half, x0, x1 } = P8;
    const top = floor + height, far = zc - half, near = zc + half, len = x1 - x0, mx = (x0 + x1) / 2;
    // ---- the shell: white tiles, two to a metre, with a blue band along the walls
    const tile: Face = { cell: A.paint(16, 16, (p) => { p.fill('#e9ece6', 0.3); p.rect(0, 0, 16, 1, '#b4b9b2'); p.rect(0, 8, 16, 1, '#b4b9b2'); p.rect(0, 0, 1, 16, '#b4b9b2'); p.rect(8, 0, 1, 16, '#b4b9b2'); p.speckle('#dfe3dc', 0.08, 3); }) };
    const floorF: Face = { cell: A.paint(16, 16, (p) => { p.fill('#c9cdc6', 0.12); p.rect(0, 0, 16, 1, '#9a9f98'); p.rect(0, 0, 1, 16, '#9a9f98'); p.speckle('#babfb7', 0.15, 5); }) };
    const band: Face = { cell: A.solid('#2a5aa8', 0.25) }, yellow: Face = { cell: A.solid('#e8c21a', 0.3) }, dark: Face = { cell: A.solid('#101216') };
    const ceil: Face = { cell: A.paint(16, 16, (p) => { p.fill('#d4d7d2', 0.1); p.rect(0, 0, 16, 1, '#a9ada6'); p.rect(0, 0, 1, 16, '#a9ada6'); }) };
    // the shell in four parts that a failed load can take away one by one (`shell`)
    const fl = new Builder(1), fw = new Builder(1), nw = new Builder(1), cl = new Builder(1);
    fl.box(len, 0.4, 2 * half, { py: floorF }, at(mx, floor - 0.4, zc));
    fw.box(len, height, 0.4, { pz: tile }, at(mx, floor, far - 0.2));
    nw.box(len, height, 0.4, { nz: tile }, at(mx, floor, near + 0.2));
    fw.box(len, 0.3, 0.04, allFaces(band), at(mx, floor + 1.25, far + 0.02));
    nw.box(len, 0.3, 0.04, allFaces(band), at(mx, floor + 1.25, near - 0.02));
    // the tactile strip of the platform edge, along the near wall
    fl.box(len, 0.03, 0.5, { py: yellow }, at(mx, floor, near - 1.4));
    // the ceiling: panels of 2 m, with a hole where the cars come through
    for (let x = x0; x < x1; x += 2) {
      if (x + 2 > HOLE[0] && x < HOLE[1]) {
        // the edges of the hole: the panels beside the path of the cars stay
        cl.box(2, 0.3, 1.6, { ny: ceil, pz: dark, nz: dark }, at(x + 1, top, far + 0.8));
        cl.box(2, 0.3, 1.2, { ny: ceil, pz: dark, nz: dark }, at(x + 1, top, near - 0.6));
      } else cl.box(2, 0.3, 2 * half, { ny: ceil, px: dark, nx: dark }, at(x + 1, top, zc));
    }
    // the ends are dark: the corridor has no end to see
    fw.box(0.4, height, 2 * half, { nx: dark }, at(x1, floor, zc));
    fw.box(0.4, height, 2 * half, { px: dark }, at(x0, floor, zc));
    this.shell = {
      floor: litMesh(fl, mat, { cast: false }), far: litMesh(fw, mat, { cast: false }), near: litMesh(nw, mat, { cast: false }), ceil: new THREE.Group(),
    };
    this.shell.ceil.add(litMesh(cl, mat, { cast: false }));
    this.root.add(this.shell.floor, this.shell.far, this.shell.near, this.shell.ceil);

    // ---- the tubes of light under the ceiling. A tube that a car has passed is out
    const tb = new Builder();
    tb.box(2.6, 0.1, 0.22, allFaces({ cell: A.paint(1, 1, (p) => p.fill('#eef6ff', 1.4)) }), at(0, -0.05, 0));
    const fx = new Builder();
    for (let x = x0 + 4; x < x1; x += TUBE_STEP) {
      if (x > HOLE[0] - 1 && x < HOLE[1] + 1) continue;
      this.tubeX.push(x);
      fx.box(2.9, 0.08, 0.4, allFaces({ cell: A.solid('#8c9096') }), at(x, top - 0.08, zc));
    }
    this.shell.ceil.add(litMesh(fx, mat, { cast: false }));
    this.tubesOn = instanced(tb.geometry(), mat, this.tubeX.length);
    this.shell.ceil.add(this.tubesOn);
    this.root.add(this.light);
    this.duet = instanced(this.lampGeo, this.lampMat, 2 * DUET_LIGHTS, { color: true });
    // its instances move along the whole corridor: a bounding sphere taken from one frame would cull them in another
    this.duet.frustumCulled = false;
    this.duet.count = 0;
    this.root.add(this.duet);
    const ps = [...spec.duet.sky, ...spec.duet.ground].map((n) => n.pitch);
    this.pitch = ps.length ? [Math.min(...ps), Math.max(...ps)] : [0, 1];

    // ---- posters on the far wall: a fish. In the other variant its eye looks at you
    const poster = (eye: boolean): Face => ({
      cell: A.paint(24, 32, (p) => {
        p.fill('#f4efe0', 0.3);
        p.rect(0, 0, 24, 1, '#3a3a40'); p.rect(0, 31, 24, 1, '#3a3a40'); p.rect(0, 0, 1, 32, '#3a3a40'); p.rect(23, 0, 1, 32, '#3a3a40');
        for (let y = 8; y < 20; y++) for (let x = 3; x < 21; x++) { const dx = (x - 11.5) / 8.5, dy = (y - 13.5) / 4.5; if (dx * dx + dy * dy < 1) p.px(x, y, y < 12 ? '#2a6a9a' : '#b8ccd8'); }
        for (let k = 0; k < 4; k++) { p.px(19 + k, 10 + k, '#2a6a9a'); p.px(19 + k, 17 - k, '#2a6a9a'); }
        if (eye) { p.rect(4, 10, 6, 6, '#ffffff'); p.rect(6, 12, 3, 3, '#c01818'); p.rect(7, 13, 1, 1, '#000000'); } else { p.rect(5, 12, 2, 2, '#ffffff'); p.px(5, 13, '#101010'); }
        p.rect(4, 24, 16, 2, '#c03a2a'); p.rect(4, 27, 11, 1, '#6a6a70');
      }),
      map: 'fit',
    });
    const faces = [poster(false), poster(true)];
    for (const x of [24.5, 33.5, 58, 66, 90]) {
      const pair = faces.map((f) => {
        const pb = new Builder();
        pb.quad(v3(x - 0.75, floor + 1.7, far + 0.03), v3(x + 0.75, floor + 1.7, far + 0.03), v3(x + 0.75, floor + 3.7, far + 0.03), v3(x - 0.75, floor + 3.7, far + 0.03), f);
        const m = litMesh(pb, mat, { cast: false });
        this.root.add(m);
        return m;
      });
      this.posters.push(pair);
    }

    const pass = this.passTimes();

    // ---- the signs: yellow plates that hang across the corridor and face the cars that come. The text runs along +z
    const plate: Face = { cell: A.solid('#f2c81c', 0.55) }, rod: Face = { cell: A.solid('#4a4e56') };
    const sb = new Builder();
    const hang = (x: number, w: number, b: Builder = sb) => {
      b.box(0.12, 2.0, w, allFaces(plate), at(x, top - 2.3, zc));
      for (const s of [-1, 1]) b.box(0.06, 0.3, 0.06, allFaces(rod), at(x, top - 0.3, zc + s * (w / 2 - 0.3)));
    };
    // the name of the platform: painted, in the two numbers
    const nameFace = (n: string): Face => ({
      cell: A.paint(176, 32, (p) => {
        p.fill('#f2c81c', 0.55);
        const m = Mask.text(font, `${n}番のりば`, 2);
        m.draw(p.sink({ 1: '#14161c' }), Math.round((176 - m.w) / 2 - m.x0), Math.round((32 - m.h) / 2 - m.y0), 1);
        p.rect(4, 4, 168, 1, '#14161c'); p.rect(4, 27, 168, 1, '#14161c');
      }),
      map: 'fit',
    });
    const NW = 8.6, nx = spec.nameX;
    hang(nx, NW + 0.3);
    for (const n of ['8', '9']) {
      const nb = new Builder();
      nb.quad(v3(nx - 0.07, top - 2.1, zc - NW / 2), v3(nx - 0.07, top - 2.1, zc + NW / 2), v3(nx - 0.07, top - 0.5, zc + NW / 2), v3(nx - 0.07, top - 0.5, zc - NW / 2), nameFace(n));
      const m = litMesh(nb, mat, { cast: false, receive: false });
      this.names.push(m);
      this.root.add(m);
    }
    // the signs of the line: each glyph is a group of dark lamps on the plate
    const m4 = new THREE.Matrix4(), sc = new THREE.Matrix4().makeScale(LAMP, LAMP, 0.03);
    for (const ph of spec.signs) {
      const units = ph.line.written!.units.slice(ph.from, ph.to);
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
      pts.sort((p, q) => p.start - q.start);
      const w = Math.max(4, (pen + 8) * LAMP);
      const pb = new Builder();
      hang(ph.x, w, pb);
      const plateMesh = litMesh(pb, mat, { cast: false });
      this.root.add(plateMesh);
      const lamps = instanced(this.lampGeo, this.lampMat, pts.length, { color: true });
      const y0 = top - 2.3 + (2.0 - font.size * LAMP) / 2 + 0.2 * font.size * LAMP;
      pts.forEach((p, k) => {
        lamps.setMatrixAt(k, m4.makeRotationY(-Math.PI / 2).setPosition(ph.x - 0.08, y0 + p.y * LAMP, zc - (pen * LAMP) / 2 + p.x * LAMP).multiply(sc));
        lamps.setColorAt(k, this.c.set('#14161c'));
      });
      lamps.count = 0;
      this.root.add(lamps);
      this.signs.push({ plate: plateMesh, lamps, starts: pts.map((p) => p.start) });
    }
    this.root.add(litMesh(sb, mat, { cast: false }));

    this.tubeOut = this.tubeX.map((x) => pass(x - 2));
  }

  /** The time at which the nose of the front car passes x in the first slide (Infinity when it does not get there). */
  private passTimes(): (x: number) => number {
    const xs: number[] = [], ts: number[] = [];
    for (let t = this.spec.tCeil; t < this.spec.tLoad; t += 1 / 72) { xs.push(this.spec.noseX(t)); ts.push(t); }
    return (x: number) => { for (let i = 0; i < xs.length; i++) if (xs[i]! >= x) return ts[i]!; return Infinity; };
  }

  /** `variant`: -1 in the first slide. From the first failed load: the index of the load. The corridor is whole again, with one thing changed. */
  pose(t: number, variant: number) {
    const o = this.o;
    const first = variant < 0;
    const all = variant >= 4;
    // the tubes: a tube flickers for 3 frames and is out. After a load they burn again, but for the one of variant 2
    this.tubeX.forEach((x, i) => {
      const age = t - this.tubeOut[i]!;
      const on = first ? age < 0 || (age < 3 / 36 && Math.floor(t * 36) % 2 === 0) : !((variant === 2 || all) && i === this.gone);
      o.position.set(x, P8.floor + P8.height - 0.16, P8.z);
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(on ? 1 : 0.0001);
      o.updateMatrix();
      this.tubesOn.setMatrixAt(i, o.matrix);
    });
    this.tubesOn.instanceMatrix.needsUpdate = true;
    // the number on the sign, the eyes of the posters
    this.names[0]!.visible = !(variant === 0 || all);
    this.names[1]!.visible = variant === 0 || all;
    for (const pair of this.posters) { pair[0]!.visible = !(variant === 1 || all); pair[1]!.visible = variant === 1 || all; }
    // the signs of the line. A sign despawns when the next one starts to light, with 3 frames of flicker: the chase camera behind the
    // cars sees each phrase in turn, never one through the other
    this.signs.forEach((s, i) => {
      const next = this.signs[i + 1];
      const gone = next ? t - next.starts[0]! : -1;
      const shown = gone < 0 || (gone < 3 / 36 && Math.floor(t * 36) % 2 === 0);
      s.plate.visible = shown;
      let lo = 0, hi = s.starts.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (s.starts[mid]! <= t) lo = mid + 1; else hi = mid; }
      s.lamps.count = lo;
      s.lamps.visible = shown && lo > 0;
      // the glyph of the last 2 frames is white hot
      let touched = false;
      // every lamp that shows gets its colour in every frame: none keeps the white of an earlier frame
      for (let k = 0; k < lo; k++) { s.lamps.setColorAt(k, this.c.set(t - s.starts[k]! < 2 / 36 ? '#ffffff' : '#14161c')); touched = true; }
      if (touched) s.lamps.instanceColor!.needsUpdate = true;
    });
    this.poseDuet(t, first);
  }

  /** The lights of the duet: in the first slide only (after a failed load the corridor is a copy, and the music has moved on). */
  private poseDuet(t: number, first: boolean) {
    const { o, c } = this, { floor, height, z: zc, half } = P8, [p0, p1] = this.pitch;
    let n = 0;
    // the sky voice: a bar 1.2 m wide under the ceiling; the ground voice: a band 0.8 m wide on the yellow strip of the floor
    const voices = [[this.spec.duet.sky, floor + height - 0.45, zc, 0.3, 1.2, SKY_COL], [this.spec.duet.ground, floor + 0.05, zc + half - 1.4, 0.06, 0.8, GROUND_COL]] as const;
    if (first) for (const [notes, y, z, thick, wide, pal] of voices) {
      let shown = 0;
      for (let k = notes.length - 1; k >= 0 && shown < DUET_LIGHTS; k--) {
        const note = notes[k]!;
        if (note.start > t) continue;
        const after = Math.max(0, t - note.end);
        if (after > DUET_RELEASE) continue;
        const held = Math.min(t, note.end) - note.start;
        const head = this.spec.noseX(note.start) + DUET_AHEAD - DUET_RUN * (held + after), len = Math.min(DUET_LEN, 1.5 + DUET_RUN * held);
        const fade = 1 - smooth(after / DUET_RELEASE), lv = p1 > p0 ? (note.pitch - p0) / (p1 - p0) : 0.5;
        o.position.set(head + len / 2, y, z);
        o.rotation.set(0, 0, 0);
        o.scale.set(len, thick, wide);
        o.updateMatrix();
        this.duet.setMatrixAt(n, o.matrix);
        this.duet.setColorAt(n, c.copy(pal.lo).lerp(pal.hi, lv).multiplyScalar(5 * fade));
        n++;
        shown++;
      }
    }
    this.duet.count = n;
    this.duet.instanceMatrix.needsUpdate = true;
    if (this.duet.instanceColor) this.duet.instanceColor.needsUpdate = true;
  }

  /** The tube of variant 2: one that the camera sees ahead of the cars. */
  private get gone(): number { return this.tubeX.findIndex((x) => x > 34); }

  dispose() {
    this.lampGeo.dispose();
    this.lampMat.dispose();
    this.tubesOn.dispose();
  }
}
