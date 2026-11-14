// A Japanese rural diesel car (KiHa 40 style) for the lit renderer: about 20 m long, a cream body with a maroon band
// under the windows, a grey roof with vents, a cab at each end with two headlights and a destination box.
//
// Car frame: x along the car (front +x), y up, z to the left (the "left" side of the car is the +z side), rail top
// at y = 0, track gauge 1.067 m. The root origin is the middle of the first car. More cars are coupled behind it
// (towards -x) with a gangway.
//
// The window openings are real holes, so a camera inside sees out and a camera outside sees the lit interior.
// Two sliding doors per side per car. The leaves slide into a pocket inside the wall.
//
// The kit has no scene logic. The scene sets the doors, the interior light and the headlights each frame.
import * as THREE from 'three';
import { mulberry32 } from '@pve/engine/util';
import { Builder, type BoxFaces, type Cell, type Face, type LitAtlas, type Painter, allFaces, at, glowMaterial, litMaterial, litMesh, point, spot, v3 } from '@pve/engine/lit';

/** The body is 20 m long and 2.8 m wide, the roof peak is 3.66 m over the rail. */
export const CAR_LENGTH = 20;
/** The gap between two coupled cars (the gangway). */
export const CAR_GAP = 0.9;
export const GAUGE = 1.067;

const FL = 1.1; // floor top
const SILL = 1.975; // window sill
const HEAD = 2.975; // window top and door top
const CEIL = 3.3;
const W_IN = 1.28; // inner face of the side wall
const W_OUT = 1.4; // outer face of the side wall
const E_IN = 9.88; // inner face of the end wall
const E_OUT = 10; // outer face of the end wall
const DOORS = [-5.4, 5.4];
const HALF_DOOR = 0.65;
// The steady headlight glow (`Train.setSteadyGlow`): a disc that faces the camera, GLOW_M metres in radius. When that is less than
// GLOW_PX render pixels, the disc is drawn GLOW_PX pixels wide and dims by the area ratio: the light on the screen then follows the
// zoom, but it does not change when the lamp itself is smaller than one pixel. The centre is GLOW times the lamp colour, the rim is 0.
// The disc fades out while the lamp grows from LAMP_PX[0] to LAMP_PX[1] render pixels tall: a close view shows the lamp itself.
const GLOW_PX = 1.5;
const GLOW_M = 0.45;
const GLOW = 1.6;
const LAMP_H = 0.22, LAMP_PX = [1.5, 4] as const;
const LAMP = '#fff4d6';
const GP = new THREE.Vector3(), GF = new THREE.Vector3(), GC = new THREE.Vector3(), GS = new THREE.Vector3(), GV = new THREE.Vector4();

/** Runs of windows inside a span: `n` windows of `w` metres with even pillars between them. */
function windowsIn(a: number, b: number, w = 1): [number, number][] {
  const n = Math.max(1, Math.round((b - a) / 1.3));
  const gap = (b - a - n * w) / (n + 1);
  return Array.from({ length: n }, (_, k) => [a + gap * (k + 1) + w * k, a + gap * (k + 1) + w * (k + 1)] as [number, number]);
}

/** A box from absolute ranges. */
function bx(b: Builder, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, f: BoxFaces) {
  b.box(x1 - x0, y1 - y0, z1 - z0, f, at((x0 + x1) / 2, y0, (z0 + z1) / 2));
}

interface Cells {
  body: Face; cream: Face; maroon: Face; roof: Face; skirt: Face; wood: Face; ledge: Face;
  innerFull: Face; innerCream: Face; ceiling: Face; moquette: Face; seatBase: Face; steel: Face; dark: Face;
  strip: Face; fixture: Face; ring: Face; wheel: Face; rubber: Face; tail: Face; lamp: Face; dest: Face;
  /** The letter strokes of the destination box: x, y, w, h in its 40 x 8 cell. */
  destStrokes: [number, number, number, number][];
  gauge: Face; desk: Face; route: Face; posters: Face[]; ballast: Face;
}

/**
 * The joint between two single cars that each follow the track by themselves: a folding gangway (rubber bellows round the gangway doors of
 * the two cab ends, with a steel face frame at each end) on a steel footplate, and under it the coupler and two brake hoses that sag
 * between the cars. The mesh is one metre long along x, about its middle, with y = 0 on the rail: `poseCarJoint` stretches it between the
 * end walls of the two cars.
 */
export function carJoint(atlas: LitAtlas, mat: THREE.Material): THREE.Mesh {
  const fold = allFaces({ cell: atlas.solid('#62656e') }), crease = allFaces({ cell: atlas.solid('#2c2e34') });
  const dark = allFaces({ cell: atlas.solid('#101216') }), steel = allFaces({ cell: atlas.solid('#7a808a') }), hose = allFaces({ cell: atlas.solid('#1c1c1c') });
  const b = new Builder();
  // the bellows: folds that stand out and creases between them, round the door opening (half width GW, top GT)
  const GW = 0.5, GT = HEAD + 0.08, FOLDS = 7, LEN = 0.84;
  for (let k = 0; k < 2 * FOLDS - 1; k++) {
    const x0 = -LEN / 2 + (k * LEN) / (2 * FOLDS - 1), x1 = x0 + LEN / (2 * FOLDS - 1), out = k % 2 ? 0 : 0.05, f = k % 2 ? crease : fold;
    bx(b, x0, x1, GT - 0.08 + out, GT + out, -GW - out, GW + out, f);
    for (const s of [-1, 1]) bx(b, x0, x1, FL, GT + out, s > 0 ? GW - 0.08 : -GW - out, s > 0 ? GW + out : -GW + 0.08, f);
  }
  // the face frames where the bellows meet the cab ends
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? LEN / 2 : -0.5, x1 = s > 0 ? 0.5 : -LEN / 2;
    bx(b, x0, x1, GT - 0.1, GT + 0.06, -GW - 0.06, GW + 0.06, steel);
    for (const z of [-1, 1]) bx(b, x0, x1, FL, GT + 0.06, z > 0 ? GW - 0.1 : -GW - 0.06, z > 0 ? GW + 0.06 : -GW + 0.1, steel);
  }
  // the footplate
  bx(b, -0.5, 0.5, FL - 0.04, FL + 0.03, -GW, GW, steel);
  // the coupler: a bar, with the two heads that meet in the middle
  bx(b, -0.5, 0.5, 0.84, 0.96, -0.07, 0.07, dark);
  bx(b, -0.16, 0.16, 0.78, 1.02, -0.13, 0.13, dark);
  // the brake hoses: from each end beam down and back up, in three pieces
  for (const z of [-0.42, 0.42]) {
    bx(b, -0.5, -0.3, 0.6, 0.66, z - 0.03, z + 0.03, hose);
    bx(b, -0.3, 0.3, 0.5, 0.56, z - 0.03, z + 0.03, hose);
    bx(b, 0.3, 0.5, 0.6, 0.66, z - 0.03, z + 0.03, hose);
  }
  const m = litMesh(b, mat);
  m.matrixAutoUpdate = false;
  m.frustumCulled = false;
  return m;
}

const JA = new THREE.Vector3(), JB = new THREE.Vector3(), JX = new THREE.Vector3(), JY = new THREE.Vector3(), JZ = new THREE.Vector3();

/**
 * Puts a `carJoint` between the rear end of `front` and the front end of `rear` (the world matrices of two single cars). It bends and
 * rolls with the two cars. False when the ends are more than 2.5 m apart (the cars are not coupled): the joint is then not posed.
 */
export function poseCarJoint(joint: THREE.Object3D, front: THREE.Matrix4, rear: THREE.Matrix4): boolean {
  JA.set(-E_OUT, 0, 0).applyMatrix4(front);
  JB.set(E_OUT, 0, 0).applyMatrix4(rear);
  const len = JA.distanceTo(JB);
  if (len > 2.5 || len < 1e-3) return false;
  JX.subVectors(JA, JB).divideScalar(len);
  JY.setFromMatrixColumn(front, 1).add(JZ.setFromMatrixColumn(rear, 1)).normalize();
  JZ.crossVectors(JX, JY).normalize();
  JY.crossVectors(JZ, JX);
  joint.matrixWorld.makeBasis(JX.multiplyScalar(len + 0.06), JY, JZ).setPosition(JA.add(JB).multiplyScalar(0.5));
  return true;
}

export class Train {
  /** The whole train. */
  readonly root = new THREE.Group();
  /** Every light of the kit (already children of the root). */
  readonly lights: THREE.Light[] = [];
  /** The LED route display over the doors: its atlas cell and a repaint helper. */
  readonly route: { cell: Cell; repaint(fn: (p: Painter) => void): void };
  /** Camera and avatar anchors in the first car. A camera looks down the anchor's -z axis. */
  readonly anchors: { seat: THREE.Object3D; door: THREE.Object3D; aisle: THREE.Object3D };

  private readonly atlas: LitAtlas;
  private readonly stripCell: Cell;
  private readonly lampCell: Cell;
  private readonly destCell: Cell;
  private readonly destStrokes: [number, number, number, number][];
  private readonly leaves: { side: 'left' | 'right'; dir: number; group: THREE.Group }[] = [];
  private readonly inside: { light: THREE.PointLight; base: number }[] = [];
  private readonly heads: { light: THREE.SpotLight; base: number }[] = [];
  private readonly discs: THREE.Mesh[] = [];
  private headK = 0;
  private steady = false;
  /**
   * The material of the destination boxes: it reads the cell through its mipmaps, one level early (`mipBias` 1). The letters are strokes
   * one texel wide; at about one texel a pixel the plain read drops and brings back texels from frame to frame as the car moves (shimmer).
   */
  private readonly destMat: THREE.MeshLambertMaterial;

  constructor(atlas: LitAtlas, mat: THREE.Material, opts: { cars?: number } = {}) {
    this.atlas = atlas;
    this.destMat = litMaterial(atlas, { mips: true, mipBias: 1 });
    const cars = Math.max(1, Math.floor(opts.cars ?? 1));
    const c = this.makeCells();
    this.stripCell = c.strip.cell;
    this.lampCell = c.lamp.cell;
    this.destCell = c.dest.cell;
    this.destStrokes = c.destStrokes;
    this.route = {
      cell: c.route.cell,
      repaint: (fn) => atlas.repaint(c.route.cell, fn),
    };
    for (let k = 0; k < cars; k++) {
      const car = this.buildCar(c, mat, k, k < cars - 1, k > 0);
      car.position.x = -k * (CAR_LENGTH + CAR_GAP);
      this.root.add(car);
      if (k < cars - 1) this.root.add(this.gangway(c, mat, -k * (CAR_LENGTH + CAR_GAP) - CAR_LENGTH / 2 - CAR_GAP / 2));
    }
    this.anchors = {
      seat: this.anchor(1.1, 2.2, 0.95, 0),
      door: this.anchor(5.4, 2.65, 0.75, Math.PI),
      aisle: this.anchor(-7.9, 2.65, 0, -Math.PI / 2),
    };
    this.setInterior(0);
    this.setHeadlights(0);
    this.setDoors('left', 0);
    this.setDoors('right', 0);
  }

  /** Slides the door leaves of one side: 0 closed, 1 fully open. 'left' is the +z side. */
  setDoors(side: 'left' | 'right', open: number) {
    const o = Math.min(1, Math.max(0, open));
    for (const l of this.leaves) if (l.side === side) l.group.position.x = l.dir * 0.62 * o;
  }

  /** The interior light strength: 0 off, 1 on. Scales the light strips and the point lights. */
  setInterior(on: number) {
    const k = Math.min(1, Math.max(0, on));
    this.atlas.repaint(this.stripCell, (p) => p.fill('#ffe3a8', k * 3.5));
    for (const l of this.inside) l.light.intensity = l.base * k;
  }

  /** The headlights of the first car's front: 0 off, 1 on. Scales the lamps, their glow discs and the two spot lights. */
  setHeadlights(on: number) {
    const k = Math.min(1, Math.max(0, on));
    this.headK = k;
    // with the steady glow the lamp itself only lights up: the glow disc carries the bloom
    this.atlas.repaint(this.lampCell, (p) => p.fill(LAMP, k * (this.steady ? 2 : 8)));
    for (const h of this.heads) h.light.intensity = h.base * k;
  }

  /**
   * For a view where the cab front is a few pixels wide (the map): the lamps and the destination box are smaller than one pixel there,
   * so their bright texels blink in the bloom while the train moves. On: each headlight glows through a disc of a steady size on the
   * screen, the lamps and the letters of the destination box are dim. Off (the default): the lamps and the letters are bright.
   */
  setSteadyGlow(on: boolean) {
    this.steady = on;
    for (const d of this.discs) d.visible = on;
    this.atlas.repaint(this.destCell, (p) => paintDest(p, this.destStrokes, on ? 1 : 5));
    this.setHeadlights(this.headK);
  }

  private anchor(x: number, y: number, z: number, ry: number) {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    o.rotation.y = ry;
    this.root.add(o);
    return o;
  }

  // ------------------------------------------------------------ cells

  private makeCells(): Cells {
    const A = this.atlas;
    const rnd = mulberry32(4040);
    const f = (cell: Cell): Face => ({ cell });
    const creamHex = '#e2d8bb';
    const maroonHex = '#7b2631';
    const body = A.paint(4, 30, (p) => {
      p.fill(creamHex);
      p.rect(0, 4, 4, 10, maroonHex);
      p.rect(0, 3, 4, 1, '#c3b794');
      p.rect(0, 14, 4, 1, '#b9ab88');
    });
    const innerFull = A.paint(4, 30, (p) => {
      p.fill('#d9d2b4');
      p.rect(0, 0, 4, 12, '#56705f');
      p.rect(0, 12, 4, 1, '#8a6a44');
      p.rect(0, 13, 4, 1, '#c8c0a2');
    });
    const moquette = A.paint(8, 8, (p) => {
      p.fill('#2c6e68');
      p.speckle('#3a8379', 0.25, 5);
      p.speckle('#1f524e', 0.2, 11);
    });
    const wood = A.paint(16, 16, (p) => {
      p.fill('#745337');
      p.speckle('#80603f', 0.25, 3);
      p.speckle('#654730', 0.15, 8);
      for (const y of [0, 5, 10]) p.rect(0, y, 16, 1, '#4f3924');
    });
    const ring = A.paint(8, 16, (p) => {
      p.rect(0, 14, 8, 2, '#d8d4c4');
      p.rect(3, 12, 2, 2, '#d8d4c4');
      for (let y = 1; y < 12; y++) { p.px(0, y, '#e8e4d4'); p.px(7, y, '#e8e4d4'); }
      p.rect(1, 0, 6, 1, '#e8e4d4');
      p.px(0, 0, '#e8e4d4');
      p.px(7, 0, '#e8e4d4');
    });
    const destStrokes: [number, number, number, number][] = [];
    for (let i = 0; i < 4; i++) {
      const x0 = 3 + i * 9;
      for (let n = 0; n < 7; n++) {
        const sx = x0 + Math.floor(rnd() * 6);
        const sy = 1 + Math.floor(rnd() * 5);
        destStrokes.push(rnd() < 0.5 ? [x0, sy, 6, 1] : [sx, 1, 1, 6]);
      }
    }
    const dest = A.mipmap(A.paint(40, 8, (p) => paintDest(p, destStrokes, 5)));
    const posters: Face[] = ['#c04a3a', '#3a78b8', '#d8a838', '#4f9a6a'].map((hex) => ({
      map: 'fit' as const,
      cell: A.paint(24, 8, (p) => {
        p.fill('#e8e2cc');
        p.rect(1, 1, 22, 6, hex);
        for (let i = 0; i < 6; i++) p.rect(2 + Math.floor(rnd() * 16), 1 + Math.floor(rnd() * 5), 3 + Math.floor(rnd() * 4), 1, '#f2eddc');
        p.rect(0, 0, 24, 1, '#5a5448');
        p.rect(0, 7, 24, 1, '#5a5448');
      }),
    }));
    const gauge = A.paint(8, 4, (p) => {
      p.fill('#0e1410', 1);
      p.rect(1, 1, 3, 2, '#40ff80', 5);
      p.rect(5, 1, 2, 2, '#ff6a30', 5);
    });
    const route = A.paint(64, 10, (p) => drawRoute(p, 3));
    return {
      body: f(body), cream: f(A.solid(creamHex)), maroon: f(A.solid(maroonHex)), roof: f(A.solid('#6c7076')),
      skirt: f(A.solid('#33353a')), wood: f(wood), ledge: f(A.solid('#8a6a44')), innerFull: f(innerFull),
      innerCream: f(A.solid('#d9d2b4')), ceiling: f(A.solid('#e8e2cf')), moquette: f(moquette),
      seatBase: f(A.solid('#2a3a36')), steel: f(A.solid('#b9bfc4')), dark: f(A.solid('#2c2e33')),
      strip: f(A.paint(1, 1, (p) => p.fill('#ffe3a8', 3.5))), fixture: f(A.solid('#cfcab4')), ring: f(ring),
      wheel: f(A.solid('#2e2e32')), rubber: f(A.solid('#17171a')), tail: f(A.solid('#ff2a1a', 3)),
      lamp: f(A.paint(1, 1, (p) => p.fill('#fff4d6', 8))), dest: { cell: dest, map: 'fit' }, destStrokes,
      gauge: { cell: gauge, map: 'fit' }, desk: f(A.solid('#4a4d52')), route: { cell: route, map: 'fit' }, posters,
      ballast: f(A.solid('#3a3a3c')),
    };
  }

  // ------------------------------------------------------------ gangway

  private gangway(c: Cells, mat: THREE.Material, xc: number) {
    const b = new Builder();
    const x0 = xc - CAR_GAP / 2 - 0.02;
    const x1 = xc + CAR_GAP / 2 + 0.02;
    const r = c.rubber;
    bx(b, x0, x1, FL, FL + 0.05, -0.6, 0.6, { py: c.steel, pz: c.steel, nz: c.steel, ny: c.dark });
    bx(b, x0, x1, 3.0, 3.05, -0.62, 0.62, { py: r, pz: r, nz: r, ny: r });
    for (const s of [-1, 1]) bx(b, x0, x1, FL, 3.05, s * 0.58, s * 0.62, { pz: r, nz: r, py: r, ny: r });
    // the coupler and the draw gear under the gap
    bx(b, x0, x1, 0.85, 1.0, -0.12, 0.12, { py: c.dark, ny: c.dark, pz: c.dark, nz: c.dark });
    return litMesh(b, mat);
  }

  // ------------------------------------------------------------ one car

  private buildCar(c: Cells, mat: THREE.Material, index: number, joinRear: boolean, joinFront: boolean) {
    const group = new THREE.Group();
    const b = new Builder(), db = new Builder();
    this.shell(b, c);
    this.endWall(b, db, c, 1, joinFront, index === 0);
    this.endWall(b, db, c, -1, joinRear, false);
    this.underframe(b, c);
    this.interior(b, c);
    this.roofParts(b, c);
    group.add(litMesh(b, mat));
    if (db.vertices > 0) group.add(litMesh(db, this.destMat));
    this.doorLeaves(c, mat, group);
    // interior point lights
    for (const x of [-5.5, 0, 5.5]) {
      const l = point('#ffd9a0', 6, 9);
      l.position.set(x, 3.0, 0);
      group.add(l);
      this.lights.push(l);
      this.inside.push({ light: l, base: 6 });
    }
    if (index === 0) this.addHeadlights(group);
    return group;
  }

  /** Both side walls with the window holes, the door openings and the door pockets, the header band and the ceiling. */
  private shell(b: Builder, c: Cells) {
    const ex = (s: number, x0: number, x1: number, y0: number, y1: number, zi: number, zo: number, out: Face, inn: Face, py?: Face) => {
      const [z0, z1] = s > 0 ? [zi, zo] : [-zo, -zi];
      const e = c.cream;
      bx(b, x0, x1, y0, y1, z0, z1, { px: e, nx: e, py: py ?? e, ny: e, ...(s > 0 ? { pz: out, nz: inn } : { nz: out, pz: inn }) });
    };
    for (const s of [1, -1]) {
      for (const [a, z] of [[-E_IN, -6.7], [-4.1, 4.1], [6.7, E_IN]] as [number, number][]) {
        ex(s, a, z, FL, SILL, W_IN, W_OUT, c.body, c.innerFull, c.ledge);
        let at0 = a;
        for (const [w0, w1] of windowsIn(a, z)) {
          ex(s, at0, w0, SILL, HEAD, W_IN, W_OUT, c.cream, c.innerCream);
          at0 = w1;
        }
        ex(s, at0, z, SILL, HEAD, W_IN, W_OUT, c.cream, c.innerCream);
      }
      ex(s, -E_IN, E_IN, HEAD, CEIL, W_IN, W_OUT, c.cream, c.innerCream);
      for (const dc of DOORS) {
        // the pockets: an outer skin, an inner skin and a plug at the far end
        for (const dir of [-1, 1]) {
          const near = dc + dir * HALF_DOOR;
          const far = dc + dir * (HALF_DOOR + 0.65);
          const [lo, hi] = near < far ? [near, far] : [far, near];
          ex(s, lo, hi, FL, HEAD, 1.36, W_OUT, c.body, c.dark);
          ex(s, lo, hi, FL, HEAD, W_IN, 1.32, c.dark, c.innerFull);
          const [p0, p1] = dir > 0 ? [far - 0.04, far] : [far, far + 0.04];
          ex(s, p0, p1, FL, HEAD, 1.32, 1.36, c.dark, c.dark);
        }
        // door sill plate and the step
        const [z0, z1] = s > 0 ? [W_IN, W_OUT] : [-W_OUT, -W_IN];
        bx(b, dc - HALF_DOOR, dc + HALF_DOOR, FL - 0.08, FL, z0, z1, { py: c.steel, pz: c.steel, nz: c.steel, px: c.dark, nx: c.dark });
        const [s0, s1] = s > 0 ? [W_OUT, W_OUT + 0.35] : [-W_OUT - 0.35, -W_OUT];
        bx(b, dc - 0.55, dc + 0.55, 0.52, 0.58, s0, s1, { py: c.steel, pz: c.dark, nz: c.dark, px: c.dark, nx: c.dark });
        for (const sx of [-0.5, 0.5]) bx(b, dc + sx - 0.02, dc + sx + 0.02, 0.58, FL - 0.08, s > 0 ? W_OUT - 0.04 : -W_OUT, s > 0 ? W_OUT : -W_OUT + 0.04, allFaces(c.dark));
        // the route display over the door
        const zf = s > 0 ? W_IN - 0.012 : -W_IN + 0.012;
        const panel = (z: number, sgn: number) =>
          sgn > 0
            ? b.quad(v3(dc + 0.6, 3.05, z), v3(dc - 0.6, 3.05, z), v3(dc - 0.6, 3.23, z), v3(dc + 0.6, 3.23, z), c.route)
            : b.quad(v3(dc - 0.6, 3.05, z), v3(dc + 0.6, 3.05, z), v3(dc + 0.6, 3.23, z), v3(dc - 0.6, 3.23, z), c.route);
        panel(zf, s);
      }
      // the skirt under the body
      const skirtSpans: [number, number][] = [[-E_IN, DOORS[0]! - HALF_DOOR], [DOORS[0]! + HALF_DOOR, DOORS[1]! - HALF_DOOR], [DOORS[1]! + HALF_DOOR, E_IN]];
      for (const [a, z] of skirtSpans) {
        const [z0, z1] = s > 0 ? [1.1, W_OUT - 0.02] : [-W_OUT + 0.02, -1.1];
        bx(b, a, z, 0.72, FL, z0, z1, { pz: c.skirt, nz: c.skirt, ny: c.dark, px: c.dark, nx: c.dark });
      }
    }
    // the ceiling (a hair under the roof, to avoid fighting)
    b.quad(v3(-E_IN, CEIL - 0.01, -W_IN), v3(E_IN, CEIL - 0.01, -W_IN), v3(E_IN, CEIL - 0.01, W_IN), v3(-E_IN, CEIL - 0.01, W_IN), c.ceiling);
    // the floor
    bx(b, -E_IN, E_IN, FL - 0.1, FL, -W_IN, W_IN, { py: c.wood, ny: c.dark });
  }

  /**
   * An end wall. Not joined: a cab front with two windscreen holes and a gangway door between them, headlights and a destination box.
   * Joined: two pillars and a doorway. `db` gets the face of the destination box (it has a material of its own).
   */
  private endWall(b: Builder, db: Builder, c: Cells, sx: number, joined: boolean, isFront: boolean) {
    const [x0, x1] = sx > 0 ? [E_IN, E_OUT] : [-E_OUT, -E_IN];
    const wall = (y0: number, y1: number, z0: number, z1: number, out: Face, inn: Face) =>
      bx(b, x0, x1, y0, y1, z0, z1, { pz: c.cream, nz: c.cream, py: c.cream, ny: c.cream, ...(sx > 0 ? { px: out, nx: inn } : { nx: out, px: inn }) });
    if (joined) {
      wall(FL, HEAD, 0.45, W_OUT, c.body, c.innerFull);
      wall(FL, HEAD, -W_OUT, -0.45, c.body, c.innerFull);
      wall(HEAD, CEIL, -W_OUT, W_OUT, c.cream, c.innerCream);
      return;
    }
    wall(FL, SILL, -W_OUT, W_OUT, c.body, c.innerFull);
    for (const [z0, z1] of [[1.15, W_OUT], [-0.42, 0.42], [-W_OUT, -1.15]] as [number, number][]) wall(SILL, HEAD, z0, z1, c.cream, c.innerCream);
    // the gangway door in the middle: its rubber outline and its window
    const dx = sx * (E_OUT + 0.006);
    for (const z of [-0.36, 0.36]) b.quad(...frontQuad(sx, dx, z, (1.2 + 2.93) / 2, 0.015, (2.93 - 1.2) / 2), c.rubber);
    b.quad(...frontQuad(sx, dx, 0, 2.93, 0.375, 0.015), c.rubber);
    b.quad(...frontQuad(sx, dx, 0, 2.42, 0.22, 0.3), c.dark);
    wall(HEAD, CEIL, -W_OUT, W_OUT, c.cream, c.innerCream);
    // headlights (or tail lamps) with dark housings
    const lampFace = isFront ? c.lamp : c.tail;
    const lx = sx * (E_OUT + 0.045);
    for (const z of [-0.95, 0.95]) {
      bx(b, sx > 0 ? E_OUT : -E_OUT - 0.04, sx > 0 ? E_OUT + 0.04 : -E_OUT, 1.42, 1.72, z - 0.17, z + 0.17, allFaces(c.dark));
      b.quad(...frontQuad(sx, lx, z, 1.57, 0.12, 0.11), lampFace);
    }
    for (const z of [-1.2, 1.2]) b.quad(...frontQuad(sx, sx * (E_OUT + 0.01), z, 1.2, 0.05, 0.045), c.tail);
    // the destination box: its sides here, its face in `db`
    const [bx0, bx1] = sx > 0 ? [E_OUT, E_OUT + 0.06] : [-E_OUT - 0.06, -E_OUT];
    bx(b, bx0, bx1, 3.0, 3.28, -0.6, 0.6, { pz: c.dark, nz: c.dark, py: c.dark, ny: c.dark });
    bx(db, bx0, bx1, 3.0, 3.28, -0.6, 0.6, sx > 0 ? { px: c.dest } : { nx: c.dest });
    // the cab: a desk with a gauge panel, a driver seat and the partition with its doorway
    const span = (a: number, z: number): [number, number] => (a < z ? [a, z] : [z, a]);
    const [d0, d1] = span(sx * 9.05, sx * 9.55);
    bx(b, d0, d1, FL, 1.85, -1.2, 1.2, allFaces(c.desk));
    const gx = sx * 9.04;
    b.quad(v3(gx, 1.85, sx * -0.5), v3(gx, 1.85, sx * 0.5), v3(gx, 2.1, sx * 0.5), v3(gx, 2.1, sx * -0.5), c.gauge);
    const [s0, s1] = span(sx * 8.5, sx * 8.8);
    bx(b, s0, s1, FL, 1.55, 0.5, 1.0, allFaces(c.seatBase));
    const [k0, k1] = span(sx * 8.7, sx * 8.8);
    bx(b, k0, k1, 1.55, 2.2, 0.5, 1.0, allFaces(c.moquette));
    const [p0, p1] = span(sx * 8.25, sx * 8.35);
    for (const [z0, z1] of [[0.45, W_IN], [-W_IN, -0.45]] as [number, number][]) {
      bx(b, p0, p1, FL, 1.5, z0, z1, allFaces(c.innerFull));
      bx(b, p0, p1, 1.5, HEAD - 0.2, z0, z1, allFaces(c.innerCream));
    }
    bx(b, p0, p1, HEAD - 0.2, CEIL, -W_IN, W_IN, allFaces(c.innerCream));
  }

  private underframe(b: Builder, c: Cells) {
    bx(b, -7.5, 7.5, 0.72, 1.0, -0.9, 0.9, allFaces(c.dark));
    // fuel tanks and the radiator box
    bx(b, -2.4, 0.4, 0.38, 0.72, -0.5, 0.5, allFaces(c.skirt));
    bx(b, 1.8, 3.6, 0.45, 0.72, -0.6, 0.6, allFaces(c.skirt));
    bx(b, -5.5, -3.8, 0.5, 0.72, -0.5, 0.5, allFaces(c.skirt));
    // end beams, couplers
    for (const sx of [1, -1]) {
      bx(b, Math.min(sx * 9.9, sx * 10.05), Math.max(sx * 9.9, sx * 10.05), 0.62, 1.0, -1.1, 1.1, allFaces(c.dark));
      bx(b, Math.min(sx * 10.0, sx * 10.35), Math.max(sx * 10.0, sx * 10.35), 0.8, 0.96, -0.12, 0.12, allFaces(c.dark));
      for (const z of [-0.85, 0.85]) bx(b, Math.min(sx * 10.0, sx * 10.1), Math.max(sx * 10.0, sx * 10.1), 0.7, 0.85, z - 0.08, z + 0.08, allFaces(c.steel));
    }
    for (const xc of [-6.8, 6.8]) this.bogie(b, c, xc);
  }

  private bogie(b: Builder, c: Cells, xc: number) {
    const roll = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const cyl = (x: number, y: number, z0: number, r: number, len: number, seg: number, side: Face, cap: Face) =>
      b.cylinder(r, r, len, seg, side, cap, new THREE.Matrix4().makeTranslation(x, y, z0).multiply(roll));
    for (const s of [-1, 1]) {
      bx(b, xc - 1.4, xc + 1.4, 0.5, 0.62, s * 0.88 - 0.07, s * 0.88 + 0.07, allFaces(c.dark));
      for (const ax of [-1.05, 1.05]) {
        bx(b, xc + ax - 0.12, xc + ax + 0.12, 0.34, 0.5, s * 0.74 - 0.1, s * 0.74 + 0.1, allFaces(c.skirt));
        // wheel: a disc of radius 0.43 with a hub cap
        cyl(xc + ax, 0.43, s * 0.6 - 0.07, 0.43, 0.14, 12, c.wheel, c.wheel);
        cyl(xc + ax, 0.43, s * 0.6 + (s > 0 ? 0.07 : -0.09), 0.14, 0.02, 6, c.steel, c.steel);
      }
    }
    bx(b, xc - 0.15, xc + 0.15, 0.6, 0.8, -0.8, 0.8, allFaces(c.skirt));
    for (const ax of [-1.05, 1.05]) cyl(xc + ax, 0.43, -0.78, 0.05, 1.56, 6, c.dark, c.dark);
  }

  /** Seats, poles, straps, light strips, adverts: the lit inside. */
  private interior(b: Builder, c: Cells) {
    const benches: [number, number][] = [[-8.0, -6.8], [-4.0, 4.0], [6.8, 8.0]];
    for (const s of [1, -1]) {
      for (const [a, z] of benches) {
        const lo = s > 0 ? 0.78 : -W_IN;
        const hi = s > 0 ? W_IN : -0.78;
        bx(b, a, z, FL, 1.5, lo + (s > 0 ? 0.08 : 0), hi - (s > 0 ? 0 : 0.08), allFaces(c.seatBase));
        bx(b, a, z, 1.5, 1.58, s > 0 ? 0.76 : -W_IN + 0.05, s > 0 ? W_IN - 0.05 : -0.76, { py: c.moquette, px: c.moquette, nx: c.moquette, pz: c.moquette, nz: c.moquette });
        const bz0 = s > 0 ? 1.17 : -W_IN;
        const bz1 = s > 0 ? W_IN : -1.17;
        bx(b, a, z, 1.58, 2.02, bz0, bz1, { px: c.moquette, nx: c.moquette, py: c.moquette, pz: c.moquette, nz: c.moquette });
        // arm rests at the bench ends
        for (const x of [a, z]) bx(b, x - 0.025, x + 0.025, 1.58, 1.85, s > 0 ? 0.78 : -W_IN, s > 0 ? W_IN : -0.78, allFaces(c.seatBase));
      }
      // grab poles by each door and at the bench ends
      for (const x of [-6.35 + 0.0, -4.45, 4.45, 6.35, -4.0, 4.0]) {
        b.cylinder(0.022, 0.022, CEIL - FL, 6, c.steel, null, at(x, FL, s * 0.95));
      }
      // ceiling rails with the straps
      const rz = s * 0.62;
      bx(b, -8, 8, 3.1, 3.13, rz - 0.015, rz + 0.015, allFaces(c.steel));
      for (const x of [-8, -4, 0, 4, 8]) bx(b, x - 0.02, x + 0.02, 3.13, CEIL, rz - 0.015, rz + 0.015, allFaces(c.steel));
      for (let x = -7.4; x <= 7.5; x += 1.2) {
        if (Math.abs(Math.abs(x) - 5.4) < 1.4) continue;
        for (const ang of [0, Math.PI / 2]) {
          const m = at(x, 0, rz, ang);
          const w = 0.07;
          b.quad(v3(-w, 2.82, 0), v3(w, 2.82, 0), v3(w, 3.1, 0), v3(-w, 3.1, 0), c.ring, m);
          b.quad(v3(w, 2.82, 0), v3(-w, 2.82, 0), v3(-w, 3.1, 0), v3(w, 3.1, 0), c.ring, m);
        }
      }
      // light strips
      const zz = s * 0.45;
      for (let k = 0; k < 4; k++) {
        const x0 = -7.6 + k * 4 + 0.2;
        bx(b, x0, x0 + 3.6, CEIL - 0.07, CEIL - 0.01, zz - 0.08, zz + 0.08, { py: c.fixture, px: c.fixture, nx: c.fixture, pz: c.fixture, nz: c.fixture });
        bx(b, x0 + 0.1, x0 + 3.5, CEIL - 0.09, CEIL - 0.07, zz - 0.06, zz + 0.06, { ny: c.strip, px: c.strip, nx: c.strip, pz: c.strip, nz: c.strip });
      }
      // adverts in the header band, between the doors
      for (let k = 0; k < 6; k++) {
        const x = -3.3 + k * 1.3;
        const zf = s > 0 ? W_IN - 0.01 : -W_IN + 0.01;
        const p = c.posters[(k + (s > 0 ? 0 : 2)) % c.posters.length]!;
        if (s > 0) b.quad(v3(x + 0.4, 3.0, zf), v3(x - 0.4, 3.0, zf), v3(x - 0.4, 3.27, zf), v3(x + 0.4, 3.27, zf), p);
        else b.quad(v3(x - 0.4, 3.0, zf), v3(x + 0.4, 3.0, zf), v3(x + 0.4, 3.27, zf), v3(x - 0.4, 3.27, zf), p);
      }
    }
  }

  /** The curved roof, vents, and the antenna. */
  private roofParts(b: Builder, c: Cells) {
    const profile: [number, number][] = [[-W_OUT, CEIL], [W_OUT, CEIL], [1.25, 3.5], [0.7, 3.62], [0, 3.66], [-0.7, 3.62], [-1.25, 3.5]];
    // extrude runs along the profile's local z. A turn of -90 degrees maps local x to world z and local z to world -x.
    b.extrude(profile, 2 * E_OUT, c.roof, c.roof, new THREE.Matrix4().makeRotationY(-Math.PI / 2));
    for (let x = -7.5; x <= 7.5; x += 2.5) bx(b, x - 0.3, x + 0.3, 3.64, 3.78, -0.3, 0.3, { px: c.steel, nx: c.steel, py: c.steel, pz: c.dark, nz: c.dark });
    bx(b, 8.0, 9.6, 3.62, 3.76, -0.45, 0.45, allFaces(c.roof));
    bx(b, -9.6, -8.0, 3.62, 3.76, -0.45, 0.45, allFaces(c.roof));
    // the roof rain gutters
    for (const s of [-1, 1]) bx(b, -E_OUT, E_OUT, CEIL, CEIL + 0.04, s * 1.41 - 0.02, s * 1.41 + 0.02, allFaces(c.dark));
  }

  /** The door leaves: one mesh per side and slide direction, so one group move opens all the doors of a side. */
  private doorLeaves(c: Cells, mat: THREE.Material, car: THREE.Group) {
    for (const s of [1, -1]) {
      for (const dir of [-1, 1]) {
        const b = new Builder();
        for (const dc of DOORS) {
          const [x0, x1] = dir < 0 ? [dc - HALF_DOOR, dc] : [dc, dc + HALF_DOOR];
          const zi = 1.322, zo = 1.358;
          const [z0, z1] = s > 0 ? [zi, zo] : [-zo, -zi];
          const piece = (y0: number, y1: number, a: number, z: number, out: Face, inn: Face) =>
            bx(b, a, z, y0, y1, z0, z1, { px: c.dark, nx: c.dark, py: c.dark, ny: c.dark, ...(s > 0 ? { pz: out, nz: inn } : { nz: out, pz: inn }) });
          piece(FL, SILL, x0, x1, c.body, c.innerFull);
          piece(SILL, 2.1, x0, x1, c.cream, c.innerCream);
          piece(2.8, HEAD, x0, x1, c.cream, c.innerCream);
          piece(2.1, 2.8, x0, x0 + 0.1, c.cream, c.innerCream);
          piece(2.1, 2.8, x1 - 0.1, x1, c.cream, c.innerCream);
        }
        const g = new THREE.Group();
        g.add(litMesh(b, mat));
        car.add(g);
        this.leaves.push({ side: s > 0 ? 'left' : 'right', dir, group: g });
      }
    }
  }

  private addHeadlights(group: THREE.Group) {
    for (const z of [-0.95, 0.95]) {
      const l = spot('#fff0cc', 300, 70, 0.3, 0.5, false);
      l.position.set(E_OUT + 0.1, 1.57, z);
      l.target.position.set(E_OUT + 40, 0.5, z * 1.2);
      group.add(l, l.target);
      this.lights.push(l);
      this.heads.push({ light: l, base: 300 });
      group.add(this.glowDisc(group, v3(E_OUT + 0.06, 1.57, z)));
    }
  }

  /**
   * A glow disc for the lamp at `lamp` (car frame). Just before each draw it turns to the camera, takes its size in render pixels
   * (GLOW_PX at least) and fades out when the camera is behind the cab front.
   */
  private glowDisc(car: THREE.Group, lamp: THREE.Vector3): THREE.Mesh {
    const geo = new THREE.CircleGeometry(1, 16);
    const n = geo.getAttribute('position').count;
    // vertex 0 is the centre
    const col = new Float32Array(n * 3).fill(0);
    col.set([1, 1, 1], 0);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = glowMaterial(THREE.FrontSide);
    mat.vertexColors = true;
    const disc = new THREE.Mesh(geo, mat);
    disc.visible = false;
    disc.frustumCulled = false;
    disc.castShadow = false;
    disc.matrixAutoUpdate = false;
    this.discs.push(disc);
    disc.onBeforeRender = (renderer, _scene, camera) => {
      GP.copy(lamp).applyMatrix4(car.matrixWorld);
      GF.setFromMatrixColumn(car.matrixWorld, 0).normalize();
      const p = camera.projectionMatrix.elements;
      const ortho = p[11] === 0;
      if (ortho) GC.setFromMatrixColumn(camera.matrixWorld, 2).normalize();
      else GC.setFromMatrixPosition(camera.matrixWorld).sub(GP).normalize();
      const facing = Math.min(1, Math.max(0, GF.dot(GC) / 0.3));
      // metres per render pixel at the lamp
      const depth = ortho ? 1 : GS.copy(GP).applyMatrix4(camera.matrixWorldInverse).z * -1;
      const mpp = (2 * depth) / (p[5] * renderer.getCurrentViewport(GV).w);
      const r = Math.max(GLOW_M, GLOW_PX * mpp);
      const area = (GLOW_M / r) ** 2;
      const big = Math.min(1, Math.max(0, (LAMP_H / mpp - LAMP_PX[0]) / (LAMP_PX[1] - LAMP_PX[0])));
      const k = this.headK * facing * facing * (3 - 2 * facing) * (1 - big * big * (3 - 2 * big));
      mat.color.set(LAMP).multiplyScalar(GLOW * area * k);
      disc.matrixWorld.compose(GP.addScaledVector(GC, 0.1), camera.quaternion, GS.setScalar(r));
    };
    return disc;
  }
}

type Quad4 = [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];

/** A quad on the front of a car, facing out along x: centred on z and y, half width hw, half height hh. */
function frontQuad(sx: number, x: number, z: number, y: number, hw: number, hh: number): Quad4 {
  return sx > 0
    ? [v3(x, y - hh, z + hw), v3(x, y - hh, z - hw), v3(x, y + hh, z - hw), v3(x, y + hh, z + hw)]
    : [v3(x, y - hh, z - hw), v3(x, y - hh, z + hw), v3(x, y + hh, z + hw), v3(x, y + hh, z - hw)];
}

/** The default route display: a line with 8 station dots, the dot `lit` is bright. */
function drawRoute(p: Painter, lit: number) {
  p.fill('#0c0a08');
  p.rect(2, 4, 60, 2, '#6a4210', 1);
  for (let i = 0; i < 8; i++) {
    const x = 4 + Math.round(i * (56 / 7));
    if (i === lit) p.rect(x - 1, 3, 4, 4, '#ffb020', 8);
    else p.rect(x, 4, 2, 2, '#a86a18', 2);
  }
  p.rect(2, 4, Math.round(4 + lit * 8) - 2, 2, '#ffb020', 4);
}

/**
 * The destination box: dark glass with amber letter strokes, all of emission `level`. The glass keeps the light it had at strength 2:
 * its colour is scaled for it. One strength in the whole cell: the mipmaps mix the colour of a block, and keep the strength of each texel.
 */
function paintDest(p: Painter, strokes: [number, number, number, number][], level: number) {
  p.fill(new THREE.Color('#1c1408').multiplyScalar(2 / level).getHex(), level);
  for (const [x, y, w, h] of strokes) p.rect(x, y, w, h, '#ffbf3a', level);
}
