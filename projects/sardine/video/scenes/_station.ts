// The halt and the line-side scenery of sardine v3 (lit renderer). Two kits, no scene logic:
//  - Station: a small platform with a wooden shelter, lamps, two name boards, a vending machine, a fence and bits
//    of clutter. Local frame: the track runs along x, the platform lies on the +z side, the rail top is y = 0 and
//    the platform top y = 0.9.
//  - LineSide: what stands along a track path: utility poles with sagging wires, treelines, far hills, paddy
//    fields, houses with lit windows, and a road with a level crossing whose lights blink with `setTime(t)`.
// Every shape is a pure function of its seed. Time-driven parts (crossing) are pure functions of the time given.
import * as THREE from 'three';
import { mulberry32 } from '@pve/engine/util';
import { Builder, type Cell, type Face, type LitAtlas, type Painter, allFaces, at, litMesh, point, spot, v3 } from '@pve/engine/lit';
import { Mask, type PixelFont } from '@pve/engine/type';
import { frameAt, frameMatrix, type TrackFrame } from '@pve/engine/track';
import { speckled } from './_paint';

type V3 = THREE.Vector3;

/** The ground level under the track (m). The bed of the ballast ends here. */
export const GROUND_Y = -0.5;
const PLAT_TOP = 0.9;
/** The platform edge (z of the track side) and the platform depth. */
const EDGE_Z = 1.7;
const PLAT_W = 4.0;
const BACK_Z = EDGE_Z + PLAT_W;
const BOARD_W = 192;
const BOARD_H = 72;

const WORLD_Y = new THREE.Vector3(0, 1, 0);
const rotZ = (a: number) => new THREE.Matrix4().makeRotationZ(a);
const rotY = (a: number) => new THREE.Matrix4().makeRotationY(a);

/** A quad drawn from both sides (the winding does not matter). */
function quad2(b: Builder, p0: V3, p1: V3, p2: V3, p3: V3, f: Face, m?: THREE.Matrix4) {
  b.quad(p0, p1, p2, p3, f, m);
  b.quad(p3, p2, p1, p0, f, m);
}

/** A thin square bar between two points. */
function bar(b: Builder, a: V3, c: V3, thick: number, f: Face) {
  const dir = new THREE.Vector3().subVectors(c, a);
  const len = dir.length();
  if (len < 1e-4) return;
  dir.divideScalar(len);
  const z = new THREE.Vector3().crossVectors(dir, WORLD_Y);
  if (z.lengthSq() < 1e-6) z.set(0, 0, 1);
  z.normalize();
  const y = new THREE.Vector3().crossVectors(z, dir);
  const m = new THREE.Matrix4().makeBasis(dir, y, z);
  m.setPosition(a.x * 0.5 + c.x * 0.5 - (y.x * thick) / 2, a.y * 0.5 + c.y * 0.5 - (y.y * thick) / 2, a.z * 0.5 + c.z * 0.5 - (y.z * thick) / 2);
  b.box(len, thick, thick, { py: f, ny: f, pz: f, nz: f }, m);
}

// ---------------------------------------------------------------- the name board

/**
 * Paints a Japanese station name board: white plate, the name big in the middle, a line with an arrow at each end
 * under it, the previous station under the left arrow and the next under the right one.
 */
function paintBoard(p: Painter, font: PixelFont, name: string, prev: string, next: string) {
  const W = BOARD_W, H = BOARD_H;
  const frame = '#262830';
  const yUp = (yd: number) => H - 1 - yd;
  p.fill('#ece9dd');
  p.rect(0, 0, W, 3, frame);
  p.rect(0, H - 3, W, 3, frame);
  p.rect(0, 0, 3, H, frame);
  p.rect(W - 3, 0, 3, H, frame);
  const ink = '#1b1d25';
  const out = p.sink({ 1: ink });
  const big = Mask.text(font, name, 2);
  if (big.w) big.draw(out, Math.round((W - big.w) / 2 - big.x0), 34, 1);
  // the line and its two arrow heads
  p.rect(5, yUp(43), W - 10, 2, ink);
  for (let k = 0; k < 6; k++) {
    p.rect(5 + k, yUp(43 + k), 1, 2 + 2 * k, ink);
    p.rect(W - 6 - k, yUp(43 + k), 1, 2 + 2 * k, ink);
  }
  font.draw(out, prev, 9, 65, 1);
  font.draw(out, next, W - 9 - font.width(next), 65, 1);
}

// ---------------------------------------------------------------- the station

export interface StationOpts {
  /** The name on the boards. */
  name: string;
  /** Platform length along x (m). Default 30. */
  length?: number;
  /** The names left and right on the boards. Default きのう and あした. */
  prev?: string;
  next?: string;
  /** x of each platform lamp post. Default -12, 1.5 and 13.5. A fixed camera low at the end of the platform can leave out the near one. */
  lamps?: readonly number[];
}

const face = (cell: Cell, map?: 'tile' | 'fit'): Face => ({ cell, map });

/** The painted faces of a station. The cells of the lamp heads, the tube, the validator screen, the vending machine and the boards are repainted. */
interface StationFaces {
  concrete: Face; wall: Face; tactile: Face; wood: Face; slats: Face; roof: Face; steel: Face; steelLight: Face; bodyGrey: Face;
  lampFace: Face; tubeFace: Face; screenFace: Face; vendFace: Face; boardFace: Face; frame: Face;
  cardboard: Face; binGreen: Face; leaf: Face; flowers: Face; soil: Face; mesh: Face; glassDark: Face;
}

function stationFaces(A: LitAtlas): StationFaces {
  const concrete = face(speckled(A, 16, 16, '#9b988f', [['#8c8981', 0.3, 3], ['#aaa79d', 0.1, 9]], (p) => { p.rect(0, 0, 16, 1, '#7f7c75'); p.rect(0, 0, 1, 16, '#85827b'); }));
  const wall = face(speckled(A, 16, 16, '#76746d', [['#686661', 0.3, 5], ['#85837b', 0.1, 13]], (p) => { p.rect(0, 0, 1, 16, '#5e5c57'); p.rect(0, 15, 16, 1, '#8a8880'); }));
  const tactile = face(A.paint(16, 16, (p) => {
    p.fill('#e4b81c');
    for (let gx = 1; gx < 16; gx += 4) for (let gy = 1; gy < 16; gy += 4) { p.px(gx, gy, '#f7da5c'); p.px(gx + 1, gy - 1, '#a8800c'); }
  }));
  const wood = face(speckled(A, 8, 8, '#7c5433', [['#6b4529', 0.2, 2]], (p) => { for (const x of [1, 4, 6]) p.rect(x, 0, 1, 8, '#68442a'); }));
  const slats = face(A.paint(8, 8, (p) => { p.fill('#8a6038'); p.rect(0, 0, 8, 1, '#5a3c22'); p.rect(0, 4, 8, 1, '#5a3c22'); p.speckle('#7a5230', 0.2, 4); }));
  const roof = face(A.paint(8, 8, (p) => { p.fill('#363a48'); p.rect(0, 0, 1, 8, '#4a4f61'); p.rect(4, 0, 1, 8, '#4a4f61'); p.speckle('#2c303c', 0.2, 6); }));
  const steel = face(A.solid('#2d3036'));
  const steelLight = face(A.solid('#5a5f68'));
  const bodyGrey = face(A.solid('#c9ccd0'));
  const lampFace = face(A.paint(1, 1, (p) => p.fill('#b8b8b0')), 'fit');
  const tubeFace = face(A.paint(1, 1, (p) => p.fill('#c8c8c0')), 'fit');
  const screenFace = face(A.paint(8, 6, (p) => p.fill('#223038')), 'fit');
  const vendFace = face(A.paint(36, 72, (p) => p.fill('#d0d4d8')), 'fit');
  const boardFace = face(A.paint(BOARD_W, BOARD_H, () => {}), 'fit');
  const frame = face(A.solid('#262830'));
  const cardboard = face(speckled(A, 8, 8, '#b98c55', [['#a67c48', 0.25, 7]], (p) => p.rect(0, 6, 8, 1, '#d7bd8a')));
  const binGreen = face(A.paint(8, 8, (p) => { p.fill('#2f5a3c'); p.rect(0, 0, 1, 8, '#244630'); p.speckle('#386848', 0.2, 12); }));
  const leaf = face(speckled(A, 4, 4, '#3f7a35', [['#2f6028', 0.3, 5], ['#58a048', 0.2, 6]]));
  const flowers = face(speckled(A, 16, 16, '#3a5a2a', [['#4c7a36', 0.4, 4]], (p) => {
    const cols = ['#e8607a', '#f2d040', '#f4f0e8', '#d84038', '#a070d8'];
    const rnd = mulberry32(77);
    for (let k = 0; k < 34; k++) p.px(Math.floor(rnd() * 16), Math.floor(rnd() * 16), cols[k % cols.length]!);
  }));
  const soil = face(A.solid('#4a3626'));
  const mesh = face(A.paint(16, 16, (p) => { for (let i = 0; i < 16; i++) { p.px(i, i, '#8a9098'); p.px(i, 15 - i, '#8a9098'); } }));
  const glassDark = face(A.solid('#1a2028'));
  return {
    concrete, wall, tactile, wood, slats, roof, steel, steelLight, bodyGrey, lampFace, tubeFace, screenFace, vendFace, boardFace, frame,
    cardboard, binGreen, leaf, flowers, soil, mesh, glassDark,
  };
}

/**
 * A halt: platform, shelter, lamps, two name boards, vending machine, fence and clutter. `setName` repaints the
 * boards, `setNight` switches the lamps, the lit machine and the lights.
 */
export class Station {
  readonly root = new THREE.Group();
  readonly lights: THREE.Light[] = [];
  /** x of the centre of the shelter and of the two boards, for placing a train or a camera. */
  readonly shelterX = 7;
  readonly boardAlongX = -3;
  readonly boardAcrossX = -10;
  readonly length: number;
  /**
   * The things that can lose their material (chorus 1b): separate meshes, so a scene can swap them one by one. In order: the shelter bench,
   * the vending machine, three bins, five planters (10 in all). They stand where they always stood.
   */
  readonly props: THREE.Mesh[] = [];
  private readonly boardCell: Cell;
  private readonly lampCell: Cell;
  private readonly tubeCell: Cell;
  private readonly vendCell: Cell;
  private readonly screenCell: Cell;
  private readonly lamps: { light: THREE.Light; cd: number }[] = [];
  private nameText: string;
  private prevText: string;
  private nextText: string;

  constructor(private readonly atlas: LitAtlas, mat: THREE.Material, private readonly kana: PixelFont, opts: StationOpts) {
    this.length = opts.length ?? 30;
    this.nameText = opts.name;
    this.prevText = opts.prev ?? 'きのう';
    this.nextText = opts.next ?? 'あした';
    const F = stationFaces(atlas);
    this.lampCell = F.lampFace.cell;
    this.tubeCell = F.tubeFace.cell;
    this.screenCell = F.screenFace.cell;
    this.vendCell = F.vendFace.cell;
    this.boardCell = F.boardFace.cell;
    atlas.repaint(this.boardCell, (p) => paintBoard(p, kana, this.nameText, this.prevText, this.nextText));
    const b = new Builder();
    const net = new Builder();
    this.buildPlatform(b, net, F);
    this.buildShelter(b, F, mat);
    this.buildLamps(b, F, opts.lamps ?? [-12, 1.5, 13.5]);
    this.buildBoards(b, F);
    this.buildClutter(b, F, mat);
    this.root.add(litMesh(b, mat), litMesh(net, mat, { cast: false }), ...this.props);
    for (const { light } of this.lamps) {
      this.root.add(light);
      if (light instanceof THREE.SpotLight) this.root.add(light.target);
      this.lights.push(light);
    }
    this.setNight(false);
  }

  /** The platform (slab, tactile edge line, two ramps) and the fence along the back (posts, a top rail, chain-link mesh on both sides). */
  private buildPlatform(b: Builder, net: Builder, F: StationFaces) {
    const { concrete, wall, tactile, steel, mesh } = F;
    const L = this.length;
    const zc = EDGE_Z + PLAT_W / 2;
    b.box(L, PLAT_TOP - GROUND_Y, PLAT_W, { py: concrete, nz: wall, pz: wall, px: wall, nx: wall }, at(0, GROUND_Y, zc));
    b.box(L, 0.015, 0.42, { py: tactile }, at(0, PLAT_TOP, EDGE_Z + 0.3));
    for (const sgn of [-1, 1]) {
      const prof: [number, number][] = sgn > 0 ? [[0, GROUND_Y], [4, GROUND_Y], [0, PLAT_TOP]] : [[0, GROUND_Y], [0, PLAT_TOP], [-4, GROUND_Y]];
      b.extrude(prof, PLAT_W, wall, concrete, at(sgn * (L / 2), 0, zc));
    }
    const fenceTop = PLAT_TOP + 0.95;
    for (let x = -L / 2; x <= L / 2 + 0.01; x += 2.5) b.box(0.06, fenceTop - PLAT_TOP, 0.06, allFaces(steel), at(x, PLAT_TOP, BACK_Z - 0.05));
    b.box(L, 0.05, 0.06, allFaces(steel), at(0, fenceTop - 0.05, BACK_Z - 0.05));
    const fz = BACK_Z - 0.05;
    net.quad(v3(-L / 2, PLAT_TOP + 0.05, fz), v3(L / 2, PLAT_TOP + 0.05, fz), v3(L / 2, fenceTop - 0.05, fz), v3(-L / 2, fenceTop - 0.05, fz), mesh);
    net.quad(v3(L / 2, PLAT_TOP + 0.05, fz), v3(-L / 2, PLAT_TOP + 0.05, fz), v3(-L / 2, fenceTop - 0.05, fz), v3(L / 2, fenceTop - 0.05, fz), mesh);
  }

  /** The shelter: four posts, a pitched roof, a low back wall, a bench (a prop), a tube light with its spot, a timetable. */
  private buildShelter(b: Builder, F: StationFaces, mat: THREE.Material) {
    const { wood, slats, roof, steel, tubeFace, boardFace } = F;
    const sx = this.shelterX;
    const postZ = [3.1, 4.8];
    for (const dx of [-2.4, 2.4]) for (const z of postZ) b.box(0.15, 2.4, 0.15, allFaces(wood), at(sx + dx, PLAT_TOP, z));
    b.box(5.6, 0.18, 0.12, allFaces(wood), at(sx, 3.07, 3.1));
    b.box(5.6, 0.18, 0.12, allFaces(wood), at(sx, 3.07, 4.8));
    b.extrude([[-1.3, 0], [1.3, 0], [1.3, 0.12], [-1.3, 0.3]], 6.0, roof, roof, at(sx, 3.25, 3.95, Math.PI / 2));
    b.box(4.8, 1.0, 0.07, { pz: slats, nz: slats, py: wood, px: wood, nx: wood }, at(sx, PLAT_TOP, 4.9));
    const bz = 4.5;
    const bench = new Builder();
    bench.box(2.6, 0.06, 0.42, allFaces(slats), at(sx, PLAT_TOP + 0.4, bz));
    bench.box(2.6, 0.3, 0.05, allFaces(slats), at(sx, PLAT_TOP + 0.62, bz + 0.2));
    for (const dx of [-1.15, 1.15]) {
      bench.box(0.07, 0.4, 0.4, allFaces(wood), at(sx + dx, PLAT_TOP, bz));
      bench.box(0.06, 0.34, 0.06, allFaces(wood), at(sx + dx, PLAT_TOP + 0.42, bz + 0.2));
    }
    this.props.push(litMesh(bench, mat));
    b.box(1.2, 0.05, 0.2, { ny: tubeFace, px: steel, nx: steel, pz: steel, nz: steel, py: steel }, at(sx, 3.2, 3.9));
    // a timetable on the left post
    b.box(0.5, 0.7, 0.03, { pz: boardFace, nz: boardFace }, at(sx - 2.4, PLAT_TOP + 0.9, 4.92));
    const shelterLamp = spot('#ffc678', 110, 9, 1.05, 0.6, true);
    shelterLamp.position.set(sx, 3.15, 3.9);
    shelterLamp.target.position.set(sx, PLAT_TOP, 3.9);
    this.lamps.push({ light: shelterLamp, cd: 110 });
  }

  /** The platform lamps at the x of `xs`: steel posts, an arm over the platform, a lamp head, a spot light. */
  private buildLamps(b: Builder, F: StationFaces, xs: readonly number[]) {
    const { steel, lampFace } = F;
    for (const x of xs) {
      const z = 3.0;
      b.cylinder(0.07, 0.05, 3.7, 6, steel, steel, at(x, PLAT_TOP, z));
      b.box(0.08, 0.08, 0.8, allFaces(steel), at(x, 4.5, z - 0.4));
      b.box(0.7, 0.1, 0.32, { ny: lampFace, py: steel, px: steel, nx: steel, pz: steel, nz: steel }, at(x, 4.42, z - 0.8));
      const l = spot('#ffcf8a', 140, 16, 0.95, 0.6, false);
      l.position.set(x, 4.38, z - 0.8);
      l.target.position.set(x, PLAT_TOP, z - 0.8);
      this.lamps.push({ light: l, cd: 140 });
    }
  }

  /** The name boards: one along the platform (both sides read), one across (both ends read). */
  private buildBoards(b: Builder, F: StationFaces) {
    const { boardFace, frame, wood } = F;
    const board = (x: number, z: number, ry: number, half: number, w: number, h: number, y0: number, postTop: number) => {
      const m = at(x, y0, z, ry);
      b.box(w, h, 0.1, { pz: boardFace, nz: boardFace, py: frame, ny: frame, px: frame, nx: frame }, m);
      const c = Math.cos(ry), s = Math.sin(ry);
      for (const d of [-half, half]) b.box(0.13, postTop - PLAT_TOP, 0.13, allFaces(wood), at(x + d * c, PLAT_TOP, z - d * s));
    };
    board(this.boardAlongX, 2.5, 0, 2.1, 4.0, 1.5, 2.8, 4.4);
    board(this.boardAcrossX, 3.75, Math.PI / 2, 1.8, 3.4, 1.275, 2.8, 4.2);
  }

  /** The vending machine (a prop) and its glow, the ticket validator, the bins (props), the crates and the planters (props). */
  private buildClutter(b: Builder, F: StationFaces, mat: THREE.Material) {
    const { bodyGrey, steelLight, steel, binGreen, glassDark, cardboard, wood, flowers, soil, leaf } = F;
    this.paintVending(false);
    const vend = new Builder();
    vend.box(0.95, 1.85, 0.75, { nz: F.vendFace, pz: bodyGrey, px: bodyGrey, nx: bodyGrey, py: bodyGrey }, at(-13.6, PLAT_TOP, 5.1));
    this.props.push(litMesh(vend, mat));
    b.box(0.42, 1.2, 0.32, { nz: F.screenFace, pz: steelLight, px: steelLight, nx: steelLight, py: steelLight }, at(-9.0, PLAT_TOP, 5.2));
    b.box(0.5, 0.06, 0.4, { py: steel, px: steel, nx: steel, pz: steel, nz: steel }, at(-9.0, PLAT_TOP + 1.18, 5.2));
    for (const x of [3.4, -2.6, 11.6]) {
      const bin = new Builder();
      bin.box(0.46, 0.78, 0.46, { px: binGreen, nx: binGreen, pz: binGreen, nz: binGreen, py: glassDark }, at(x, PLAT_TOP, 5.15));
      bin.box(0.5, 0.05, 0.5, allFaces(steel), at(x, PLAT_TOP + 0.78, 5.15));
      this.props.push(litMesh(bin, mat));
    }
    b.box(0.9, 0.55, 0.6, allFaces(cardboard), at(-6.3, PLAT_TOP, 5.15));
    b.box(0.7, 0.5, 0.55, allFaces(cardboard), at(-5.55, PLAT_TOP, 5.2, 0.3));
    b.box(0.6, 0.45, 0.5, allFaces(cardboard), at(-6.2, PLAT_TOP + 0.55, 5.15, -0.2));
    b.box(0.8, 0.5, 0.6, allFaces(cardboard), at(-4.8, PLAT_TOP, 5.1, 0.1));
    for (const x of [-11.2, -4.0, 0.4, 11.4, 13.6]) {
      const planter = new Builder();
      planter.box(0.9, 0.38, 0.34, { px: wood, nx: wood, pz: wood, nz: wood, py: flowers }, at(x, PLAT_TOP, 5.2));
      planter.box(0.84, 0.01, 0.28, { py: soil }, at(x, PLAT_TOP + 0.375, 5.2));
      for (const dx of [-0.28, 0, 0.28]) planter.cylinder(0.14, 0, 0.34, 5, leaf, null, at(x + dx, PLAT_TOP + 0.38, 5.2));
      this.props.push(litMesh(planter, mat));
    }
    // a light in front of the vending machine so that it throws a glow on the platform
    const vendGlow = point('#cfe4ff', 3, 5);
    vendGlow.position.set(-13.6, 1.9, 4.2);
    this.lamps.push({ light: vendGlow, cd: 3 });
  }

  /** The vending machine front: drink rows (emissive: lit at night, dim by day). */
  private paintVending(night: boolean) {
    const e = night ? 3.2 : 0.7;
    this.atlas.repaint(this.vendCell, (p) => {
      p.fill('#d4d8dc');
      p.rect(0, 62, 36, 10, '#2a62b0');
      p.rect(2, 64, 32, 6, night ? '#7fc0ff' : '#5a8ed0', night ? 2.5 : 0);
      p.rect(2, 20, 25, 40, '#0d1218');
      const cols = ['#e04040', '#f0c030', '#40a0e0', '#40b060', '#e08030', '#e8e8f0'];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
        const col = cols[(r * 3 + c * 2) % cols.length]!;
        p.rect(3 + c * 5, 22 + r * 9, 4, 7, col, e);
        p.rect(3 + c * 5, 28 + r * 9, 4, 1, '#ffffff', e);
      }
      p.rect(29, 34, 5, 24, '#a8acb2');
      p.rect(30, 52, 3, 3, '#ff3030', night ? 4 : 0.5);
      p.rect(30, 44, 3, 5, '#202428');
      p.rect(3, 4, 22, 11, '#101418');
      p.rect(28, 6, 6, 4, '#58606a');
    });
  }

  /** Repaints the boards. Defaults to きのう and あした. */
  setName(name: string, prev = 'きのう', next = 'あした') {
    this.nameText = name;
    this.prevText = prev;
    this.nextText = next;
    this.atlas.repaint(this.boardCell, (p) => paintBoard(p, this.kana, name, prev, next));
  }

  /** Night: the lamps, the tube and the machine glow and the lights shine. Day: they are dull and the lights are off. */
  setNight(on: boolean) {
    this.atlas.repaint(this.lampCell, (p) => p.fill(on ? '#ffd890' : '#b8b8b0', on ? 4.5 : 0));
    this.atlas.repaint(this.tubeCell, (p) => p.fill(on ? '#fff0c0' : '#c8c8c0', on ? 5 : 0));
    this.atlas.repaint(this.screenCell, (p) => {
      p.fill(on ? '#2c4a52' : '#223038');
      p.rect(1, 2, 6, 3, on ? '#7affc8' : '#3a5a58', on ? 3 : 0);
    });
    this.paintVending(on);
    for (const l of this.lamps) l.light.intensity = on ? l.cd : 0;
  }
}

// ---------------------------------------------------------------- the line side

export interface LineSideOpts {
  /** Where the road crosses the track, 0..1 along the path. Default 0.62. */
  crossingAt?: number;
  /** The loose row of trees near the line (11 to 33 m off it). Default true. A scene whose camera stands in that row leaves it out. */
  nearTrees?: boolean;
}

const POLE_GAP = 30;
const POLE_OFFSET = 3.6;
const ROAD_W = 5.2;

/** A house beside the line: the side (the sign of the offset), the place along the path, the offset from the track, the size and the wall height. */
interface House { sgn: number; s: number; o: number; w: number; d: number; h: number }

/** A track path read by length: its length, the length at the crossing, the frame at `s` metres, and a point `o` metres to the side of a frame. */
interface LinePath { len: number; sc: number; F: (s: number) => TrackFrame; at3: (f: TrackFrame, o: number) => THREE.Vector3 }

/** The painted faces of the line side. `windows`: the three window cells that `LineSide.setNight` repaints. */
interface LineSideFaces {
  grass: Face; paddy: Face[]; ridge: Face; wood: Face; steel: Face; wire: Face; insulator: Face; bark: Face;
  foliage: Face[]; farTree: Face; hillNear: Face; hillFar: Face; plaster: Face[]; tiles: Face[]; windows: Cell[];
  asphalt: Face; dash: Face; deck: Face; white: Face; sigRed: Face; lampRed: Face; stripes: Face;
}

function lineSideFaces(A: LitAtlas): LineSideFaces {
  const grass = face(speckled(A, 16, 16, '#3b6a2e', [['#4a7c38', 0.25, 7], ['#2f5a26', 0.2, 9], ['#5d8a42', 0.05, 15]]));
  const paddy = [
    face(A.paint(16, 16, (p) => { p.fill('#5fa83c'); for (let y = 0; y < 16; y += 4) p.rect(0, y, 16, 2, '#4c8f30'); p.speckle('#74bd4a', 0.1, 3); })),
    face(speckled(A, 16, 16, '#5e8f8a', [['#86b5ae', 0.15, 5]], (p) => { for (let y = 0; y < 16; y += 4) p.rect(0, y, 16, 1, '#4c7c76'); })),
    face(A.paint(16, 16, (p) => { p.fill('#a8b45a'); for (let y = 0; y < 16; y += 4) p.rect(0, y, 16, 2, '#92a048'); p.speckle('#c0c870', 0.1, 4); })),
  ];
  const ridge = face(speckled(A, 8, 8, '#6f7f3c', [['#5c6c30', 0.3, 2], ['#86964a', 0.2, 3]]));
  const wood = face(A.paint(8, 8, (p) => { p.fill('#7a5232'); for (const x of [1, 4, 6]) p.rect(x, 0, 1, 8, '#66432a'); p.speckle('#8a6040', 0.2, 2); }));
  const steel = face(A.solid('#2f3238'));
  const wire = face(A.solid('#1b1c22'));
  const insulator = face(A.solid('#9aa4a0'));
  const bark = face(A.solid('#4a3626'));
  const foliage = [
    face(speckled(A, 8, 8, '#2f5a2c', [['#244a24', 0.3, 5], ['#3f7236', 0.2, 6]])),
    face(speckled(A, 8, 8, '#3a6a30', [['#2c5626', 0.3, 7], ['#4f8240', 0.2, 8]])),
    face(speckled(A, 8, 8, '#5a6a2c', [['#485826', 0.3, 9], ['#74822f', 0.2, 10]])),
  ];
  const farTree = face(speckled(A, 8, 8, '#22402a', [['#1a3422', 0.3, 11], ['#2c4c32', 0.2, 12]]));
  const hillNear = face(speckled(A, 16, 16, '#40604c', [['#36544a', 0.3, 13], ['#4c7058', 0.2, 14]]));
  const hillFar = face(speckled(A, 16, 16, '#5a7684', [['#506c7a', 0.3, 15], ['#66828f', 0.2, 16]]));
  const plaster = [
    face(speckled(A, 8, 8, '#d8d1bc', [['#c8c1ac', 0.3, 3]])),
    face(speckled(A, 8, 8, '#a9a9a4', [['#999994', 0.3, 4]])),
    face(A.paint(8, 8, (p) => { p.fill('#7a5a40'); p.rect(0, 0, 8, 1, '#5e4430'); p.rect(0, 4, 8, 1, '#5e4430'); p.speckle('#6c5036', 0.3, 5); })),
  ];
  const tiles = [
    face(A.paint(8, 8, (p) => { p.fill('#3d4654'); p.rect(0, 0, 8, 1, '#2b323e'); p.rect(0, 4, 8, 1, '#2b323e'); p.speckle('#4a5464', 0.2, 7); })),
    face(A.paint(8, 8, (p) => { p.fill('#7a4636'); p.rect(0, 0, 8, 1, '#5e3428'); p.rect(0, 4, 8, 1, '#5e3428'); p.speckle('#8a5242', 0.2, 8); })),
  ];
  const windows = [0, 1, 2].map(() => A.paint(6, 7, () => {}));
  const asphalt = face(speckled(A, 16, 16, '#4a4c52', [['#3e4046', 0.3, 17], ['#5a5c62', 0.2, 18]]));
  const dash = face(A.paint(2, 40, (p) => { p.rect(0, 0, 2, 16, '#d8b838'); }));
  const deck = face(A.paint(8, 8, (p) => { p.fill('#6a6a66'); p.rect(0, 0, 8, 1, '#4a4a48'); p.rect(0, 4, 8, 1, '#56564f'); p.speckle('#7a7a74', 0.2, 19); }));
  const white = face(A.solid('#eeeeea'));
  const sigRed = face(A.solid('#4e1410'));
  const lampRed = face(A.solid('#ff2a1c', 7));
  const stripes = face(A.paint(16, 2, (p) => { p.rect(0, 0, 8, 2, '#d8281e'); p.rect(8, 0, 8, 2, '#f0f0ec'); }));
  return {
    grass, paddy, ridge, wood, steel, wire, insulator, bark, foliage, farTree, hillNear, hillFar, plaster, tiles, windows,
    asphalt, dash, deck, white, sigRed, lampRed, stripes,
  };
}

/** The houses beside the line (they claim ground first). None stands within 25 m of the crossing. */
function placeHouses(P: LinePath, rnd: () => number): House[] {
  const { len, sc } = P;
  const houses: House[] = [];
  const nHouse = Math.max(2, Math.round(len / 55));
  for (let k = 0; k < nHouse; k++) {
    const sgn = rnd() < 0.5 ? -1 : 1;
    const s = 12 + rnd() * (len - 24);
    if (Math.abs(s - sc) < 25) continue;
    houses.push({ sgn, s, o: 34 + rnd() * 50, w: 6 + rnd() * 3, d: 5 + rnd() * 2, h: rnd() < 0.4 ? 5.4 : 3.1 });
  }
  return houses;
}

/** The grass under the line: a strip 440 m wide in pieces of about 8 m. */
function lineGround(ground: Builder, P: LinePath, grass: Face) {
  const { len, F, at3 } = P;
  const n = Math.max(2, Math.ceil(len / 8));
  for (let k = 0; k < n; k++) {
    const a = F((k / n) * len), c = F(((k + 1) / n) * len);
    const q = (fr: TrackFrame, o: number) => at3(fr, o).setY(fr.pos.y + GROUND_Y);
    quad2(ground, q(a, -220), q(a, 220), q(c, 220), q(c, -220), grass);
  }
}

/** The paddy fields on both sides, in bands from the track out to 95 m, with their ridges. They keep clear of the crossing and the houses. */
function lineFields(fields: Builder, P: LinePath, rnd: () => number, houses: House[], paddy: Face[], ridge: Face) {
  const { len, sc, F, at3 } = P;
  for (const sgn of [-1, 1]) {
    let o = sgn < 0 ? 8 : 9;
    while (o < 95) {
      const ow = 12 + rnd() * 10;
      for (let s = 6 + rnd() * 6; s < len - 14; ) {
        const sl = 14 + rnd() * 12;
        const s0 = s, s1 = s + sl;
        s += sl + 0.3;
        if (Math.abs((s0 + s1) / 2 - sc) < sl / 2 + 7) continue;
        if (houses.some((h) => h.sgn === sgn && Math.abs(h.s - (s0 + s1) / 2) < sl / 2 + h.w + 2 && o + ow > h.o - h.d - 2 && o < h.o + h.d + 2)) continue;
        const fa = F(s0), fb = F(s1), fm = F((s0 + s1) / 2);
        const top = GROUND_Y + 0.06;
        const pt = (fr: TrackFrame, oo: number) => at3(fr, sgn * oo).setY(fr.pos.y + top);
        const pick = rnd();
        quad2(fields, pt(fa, o + 0.2), pt(fa, o + ow - 0.2), pt(fb, o + ow - 0.2), pt(fb, o + 0.2), paddy[pick < 0.55 ? 0 : pick < 0.78 ? 1 : 2]!);
        fields.box(sl, 0.22, 0.4, allFaces(ridge), frameMatrix(fm, 0, GROUND_Y, sgn * (o + ow)));
        fields.box(0.4, 0.22, ow, allFaces(ridge), frameMatrix(fa, 0, GROUND_Y, sgn * (o + ow / 2)));
      }
      o += ow;
    }
  }
}

/** On each side: the loose row of near trees (11 to 33 m off the line, unless `nearTrees` is false), then the far treeline (70 to 96 m). */
function lineTrees(trees: Builder, P: LinePath, rnd: () => number, houses: House[], nearTrees: boolean, f: LineSideFaces) {
  const { len, sc, F, at3 } = P;
  const treeAt = (fr: TrackFrame, o: number) => at3(fr, o).setY(fr.pos.y + GROUND_Y);
  for (const sgn of [-1, 1]) {
    for (let s = 4 + rnd() * 4; s < len; s += 5 + rnd() * 7) {
      if (!nearTrees || Math.abs(s - sc) < 9) continue;
      const o = (sgn < 0 ? 11 : 15) + rnd() * 18;
      if (houses.some((h) => h.sgn === sgn && Math.abs(h.s - s) < h.w + 4 && Math.abs(h.o - o) < h.d + 4)) continue;
      const p = treeAt(F(s), sgn * o);
      const fol = f.foliage[Math.floor(rnd() * 3)]!;
      const sz = 0.8 + rnd() * 0.7;
      trees.cylinder(0.14 * sz, 0.1 * sz, 1.6 * sz, 5, f.bark, null, at(p.x, p.y, p.z));
      if (rnd() < 0.55) trees.cylinder(1.25 * sz, 0, 6.2 * sz, 6, fol, null, at(p.x, p.y + 1.2 * sz, p.z));
      else {
        trees.cylinder(1.9 * sz, 1.0 * sz, 1.8 * sz, 6, fol, fol, at(p.x, p.y + 1.3 * sz, p.z));
        trees.cylinder(1.3 * sz, 0.0, 2.4 * sz, 6, fol, null, at(p.x, p.y + 3.0 * sz, p.z));
      }
    }
    for (let s = 0; s < len; s += 2.4 + rnd() * 1.4) {
      if (Math.abs(s - sc) < 8) continue;
      const o = 70 + rnd() * 26;
      const p = treeAt(F(s), sgn * o);
      const h = 7 + rnd() * 5;
      trees.cylinder(1.7 + rnd() * 0.8, 0, h, 5, f.farTree, null, at(p.x, p.y, p.z));
    }
  }
}

/** Two layers of hills on each side (165 m and 270 m off the line): a wall of quads with a wavy top. */
function lineHills(hills: Builder, P: LinePath, rnd: () => number, hillNear: Face, hillFar: Face) {
  const { len, F, at3 } = P;
  for (const [layer, off, base, amp, cell] of [[0, 165, 16, 14, hillNear], [1, 270, 34, 20, hillFar]] as const) {
    const ph1 = rnd() * 6.28, ph2 = rnd() * 6.28;
    for (const sgn of [-1, 1]) {
      const nHills = Math.max(2, Math.ceil(len / 14));
      const top = (k: number) => {
        const s = (k / nHills) * len;
        const fr = F(s);
        const h = Math.max(5, base + amp * 0.6 * Math.sin(s * 0.019 + ph1 + layer) + amp * 0.4 * Math.sin(s * 0.051 + ph2 + sgn) + (Math.sin(s * 0.9 + k) * 0.5 + 0.5) * amp * 0.25);
        const p = at3(fr, sgn * off);
        return [new THREE.Vector3(p.x, fr.pos.y + GROUND_Y, p.z), new THREE.Vector3(p.x, fr.pos.y + GROUND_Y + h, p.z)] as const;
      };
      let prev = top(0);
      for (let k = 1; k <= nHills; k++) {
        const cur = top(k);
        quad2(hills, prev[0], cur[0], cur[1], prev[1], cell);
        prev = cur;
      }
    }
  }
}

/** The houses beside the line: walls, a gable roof, and the windows of each floor (each of one of the three window cells, at random). */
function lineHouses(houseB: Builder, winB: Builder, houses: House[], P: LinePath, rnd: () => number, f: LineSideFaces) {
  for (const h of houses) {
    const fr = P.F(h.s);
    const wf = f.plaster[Math.floor(rnd() * 3)]!;
    const rf = f.tiles[rnd() < 0.7 ? 0 : 1]!;
    const m = frameMatrix(fr, 0, GROUND_Y, h.sgn * h.o);
    houseB.box(h.w, h.h, h.d, { px: wf, nx: wf, pz: wf, nz: wf, py: wf }, m);
    houseB.extrude([[-h.w / 2 - 0.45, 0], [h.w / 2 + 0.45, 0], [0, 1.7 + h.w * 0.12]], h.d + 0.9, wf, rf, frameMatrix(fr, 0, GROUND_Y + h.h, h.sgn * h.o));
    const zf = h.sgn > 0 ? -h.d / 2 - 0.03 : h.d / 2 + 0.03;
    const nx = Math.floor(h.w / 2.4);
    const floors = h.h > 4 ? [1.0, 3.5] : [1.0];
    for (const y0 of floors) for (let i = 0; i < nx; i++) {
      const cx = (i - (nx - 1) / 2) * (h.w / nx);
      const x0 = cx - 0.5, x1 = cx + 0.5, ya = y0, yb = y0 + 1.2;
      const win = face(f.windows[Math.floor(rnd() * 3)]!, 'fit');
      if (h.sgn > 0) winB.quad(v3(x1, ya, zf), v3(x0, ya, zf), v3(x0, yb, zf), v3(x1, yb, zf), win, m);
      else winB.quad(v3(x0, ya, zf), v3(x1, ya, zf), v3(x1, yb, zf), v3(x0, yb, zf), win, m);
    }
  }
}

/** The road across the line at the crossing: the asphalt with its centre line, the deck over the track and the ramps up to it. */
function crossingRoad(fc: TrackFrame, f: LineSideFaces): Builder {
  const road = new Builder();
  road.box(ROAD_W, 0.04, 260, { py: f.asphalt }, frameMatrix(fc, 0, GROUND_Y, 0));
  road.box(0.16, 0.012, 260, { py: f.dash }, frameMatrix(fc, 0, GROUND_Y + 0.04, 0));
  road.box(ROAD_W, 0.48, 3.4, { py: f.deck, px: f.deck, nx: f.deck }, frameMatrix(fc, 0, GROUND_Y, 0));
  for (const sg of [-1, 1]) {
    const hw = ROAD_W / 2;
    quad2(road, v3(-hw, -0.02, 1.7 * sg), v3(hw, -0.02, 1.7 * sg), v3(hw, GROUND_Y + 0.04, 3.9 * sg), v3(-hw, GROUND_Y + 0.04, 3.9 * sg), f.asphalt, frameMatrix(fc));
  }
  return road;
}

/**
 * The scenery along a track path (flat ground assumed under it, GROUND_Y). The line is read as a sequence of track
 * frames, so any curve works. Poles stand on the left of the track (the side without the platform).
 */
export class LineSide {
  readonly root = new THREE.Group();
  readonly lights: THREE.Light[] = [];
  /** The crossing: where it lies (0..1) and its frame. */
  readonly crossingU: number;
  readonly crossingFrame: TrackFrame;
  /** The path length at each pole (m). */
  readonly poleS: number[] = [];
  private readonly windows: Cell[];
  private armA!: THREE.Mesh;
  private armB!: THREE.Mesh;
  private litL!: THREE.Mesh;
  private litR!: THREE.Mesh;
  private readonly redLights: THREE.PointLight[] = [];
  private armMatA!: THREE.Matrix4;
  private armMatB!: THREE.Matrix4;
  constructor(private readonly atlas: LitAtlas, mat: THREE.Material, path: THREE.Curve<THREE.Vector3>, seed: number, opts: LineSideOpts = {}) {
    const rnd = mulberry32(seed);
    const len = path.getLength();
    const F = (s: number) => frameAt(path, undefined, s / len);
    const at3 = (f: TrackFrame, o: number) => f.pos.clone().addScaledVector(f.side, o);
    const faces = lineSideFaces(atlas);
    this.windows = faces.windows;
    // the crossing frame and the zones the layout keeps clear
    this.crossingU = opts.crossingAt ?? 0.62;
    const P: LinePath = { len, sc: this.crossingU * len, F, at3 };
    this.crossingFrame = F(P.sc);
    const houses = placeHouses(P, rnd);

    const ground = new Builder(), fields = new Builder(), trees = new Builder(), hills = new Builder();
    lineGround(ground, P, faces.grass);
    lineFields(fields, P, rnd, houses, faces.paddy, faces.ridge);
    lineTrees(trees, P, rnd, houses, opts.nearTrees !== false, faces);
    lineHills(hills, P, rnd, faces.hillNear, faces.hillFar);

    const poles = new Builder(), wires = new Builder();
    this.buildPolesAndWires(poles, wires, P, faces);

    const houseB = new Builder(), winB = new Builder();
    lineHouses(houseB, winB, houses, P, rnd, faces);
    this.setNight(false);

    const road = crossingRoad(this.crossingFrame, faces);
    const mast = this.buildCrossing(this.crossingFrame, mat, faces, at3);

    const castless = { cast: false };
    this.root.add(
      litMesh(ground, mat, castless), litMesh(fields, mat, castless), litMesh(trees, mat), litMesh(hills, mat, { cast: false, receive: false }),
      litMesh(poles, mat), litMesh(wires, mat, castless), litMesh(houseB, mat), litMesh(winB, mat, { cast: false }),
      litMesh(road, mat, castless), litMesh(mast, mat), this.armA, this.armB, this.litL, this.litR, ...this.redLights,
    );
    this.setTime(0);
  }

  /** The poles (every `POLE_GAP` m, not at the crossing) with two cross arms and their insulators, and the sagging wires between them. */
  private buildPolesAndWires(poles: Builder, wires: Builder, P: LinePath, f: LineSideFaces) {
    const { len, sc, F, at3 } = P, { wood, insulator, wire } = f;
    const poleFrames: TrackFrame[] = [];
    for (let s = 15; s <= len - 10; s += POLE_GAP) {
      if (Math.abs(s - sc) < 6) continue;
      const fr = F(s);
      poleFrames.push(fr);
      this.poleS.push(s);
      const base = at3(fr, -POLE_OFFSET);
      poles.cylinder(0.17, 0.12, 8.5, 6, wood, wood, at(base.x, fr.pos.y + GROUND_Y, base.z));
      for (const ay of [7.4, 6.45]) {
        poles.box(0.14, 0.14, 2.6, allFaces(wood), frameMatrix(fr, 0, ay - 0.07, -POLE_OFFSET));
        for (const d of [-0.95, 0.95]) poles.cylinder(0.055, 0.04, 0.2, 5, insulator, insulator, frameMatrix(fr, 0, ay + 0.07, -POLE_OFFSET + d));
      }
      poles.box(0.1, 0.1, 1.1, allFaces(wood), frameMatrix(fr, 0, 6.0, -POLE_OFFSET));
    }
    const attach = (fr: TrackFrame, ay: number, d: number) => at3(fr, -POLE_OFFSET + d).addScaledVector(fr.up, ay + 0.3);
    for (let k = 0; k + 1 < poleFrames.length; k++) {
      const a = poleFrames[k]!, c = poleFrames[k + 1]!;
      for (const ay of [7.4, 6.45]) for (const d of [-0.95, 0.95]) {
        const p0 = attach(a, ay, d), p1 = attach(c, ay, d);
        const sag = 0.25 + 0.016 * p0.distanceTo(p1);
        const N = 7;
        let last = p0;
        for (let i = 1; i <= N; i++) {
          const t = i / N;
          const p = p0.clone().lerp(p1, t);
          p.y -= sag * 4 * t * (1 - t);
          bar(wires, last, p, 0.05, wire);
          last = p;
        }
      }
    }
  }

  /** The two masts of the crossing with their signs and red lamps (`litL`, `litR`, `redLights`), and the two barrier arms (`armA`, `armB`). */
  private buildCrossing(fc: TrackFrame, mat: THREE.Material, f: LineSideFaces, at3: (f: TrackFrame, o: number) => THREE.Vector3): Builder {
    const { white, sigRed, lampRed, stripes, steel } = f;
    const mast = new Builder();
    const litL = new Builder();
    const litR = new Builder();
    const arms = new Builder();
    arms.box(3.0, 0.1, 0.08, { py: stripes, ny: stripes, pz: stripes, nz: stripes }, at(1.5, -0.05, 0));
    const masts = [{ t: -3.0, s: 2.4, dir: 1 }, { t: 3.0, s: -2.4, dir: -1 }];
    for (const ms of masts) {
      mast.cylinder(0.07, 0.06, 3.4, 6, steel, steel, frameMatrix(fc, ms.t, GROUND_Y, ms.s));
      for (const a of [0.7, -0.7]) {
        const rm = frameMatrix(fc, ms.t, 2.45, ms.s).multiply(rotZ(a));
        mast.box(1.15, 0.12, 0.03, { pz: white, nz: white, py: white, ny: white }, rm.clone().multiply(at(0, -0.06, 0)));
      }
      mast.box(0.95, 0.08, 0.08, allFaces(steel), frameMatrix(fc, ms.t, 1.95, ms.s));
      for (const side of [-1, 1]) {
        const zl = ms.s + side * 0.055;
        for (const dt of [-0.34, 0.34]) {
          mast.box(0.22, 0.22, 0.05, allFaces(sigRed), frameMatrix(fc, ms.t + dt, 1.85, ms.s + side * 0.065));
          const lit = dt < 0 ? litL : litR;
          const sm = frameMatrix(fc, ms.t + dt, 1.87, zl + side * 0.05);
          lit.box(0.16, 0.16, 0.02, side > 0 ? { pz: lampRed } : { nz: lampRed }, sm);
        }
      }
      const rl = point('#ff3a28', 0, 7);
      rl.position.copy(at3(fc, ms.s)).addScaledVector(fc.tangent, ms.t).addScaledVector(fc.up, 1.9);
      this.redLights.push(rl);
      this.lights.push(rl);
    }
    this.armMatA = frameMatrix(fc, masts[0]!.t + 0.15, 1.05, masts[0]!.s);
    this.armMatB = frameMatrix(fc, masts[1]!.t - 0.15, 1.05, masts[1]!.s).multiply(rotY(Math.PI));
    this.armA = litMesh(arms, mat);
    this.armB = litMesh(arms, mat);
    this.armA.matrixAutoUpdate = false;
    this.armB.matrixAutoUpdate = false;
    this.litL = litMesh(litL, mat, { cast: false, receive: false });
    this.litR = litMesh(litR, mat, { cast: false, receive: false });
    return mast;
  }

  /** Day or night: the house windows (lit or off at night, plain glass by day). */
  setNight(on: boolean) {
    this.windows.forEach((cell, kind) => {
      this.paintWindow(cell, kind, on);
    });
  }

  private paintWindow(cell: Cell, kind: number, night: boolean) {
    // the cell index is the variant: 0 warm, 1 pale, 2 off at night
    const lit = night && kind < 2;
    const glass = lit ? (kind === 0 ? '#ffc870' : '#ffe6a8') : night ? '#161c2a' : '#86a6ba';
    const emit = lit ? 3.5 : 0;
    this.atlas.repaint(cell, (p) => {
      p.fill('#2e2826');
      p.rect(1, 1, 4, 5, glass, emit);
      p.rect(1, 3, 4, 1, '#2e2826');
      p.rect(3, 1, 1, 5, '#2e2826');
    });
  }

  /**
   * The level crossing at time t (s): a 50 s cycle in which the barriers come down at 28 s and go up at 44 s and the
   * lights blink while they are down. `down` (0..1) overrides the arm position and the blinking: pass it to drive
   * the crossing from a scene's own train timing.
   */
  setTime(t: number, down?: number) {
    const ph = ((t % 50) + 50) % 50;
    const ramp = (a: number, b: number) => Math.min(1, Math.max(0, (ph - a) / (b - a)));
    const d = down ?? Math.min(ramp(26, 31), 1 - ramp(41, 46));
    const blinkA = Math.floor(t * 2.4) % 2 === 0;
    const on = d > 0.05;
    const theta = (1 - d) * 1.4;
    this.armA.matrix.copy(this.armMatA).multiply(rotZ(theta));
    this.armB.matrix.copy(this.armMatB).multiply(rotZ(theta));
    this.armA.matrixWorldNeedsUpdate = true;
    this.armB.matrixWorldNeedsUpdate = true;
    this.litL.visible = on && blinkA;
    this.litR.visible = on && !blinkA;
    this.redLights[0]!.intensity = on ? (blinkA ? 5 : 1) : 0;
    this.redLights[1]!.intensity = on ? (blinkA ? 1 : 5) : 0;
  }
}
