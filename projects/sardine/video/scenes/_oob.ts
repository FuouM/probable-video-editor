// The world of the `[MAP: OUT OF BOUNDS]` window of the bridge (treatment v9 "Plate 5"): what is past the edge of a map.
//   the edge      the last tiles of the game map with the tunnel hill, the line and the unfinished ramp. They end in a cliff
//                 with red and white posts.
//   the terrain   past the cliff, the ground of a map application at a far zoom: flat steps of 40 m in pale colours (land, park,
//                 water, high ground), each with a tile border. It has the heights of the real ground of the bridge, so the
//                 window shows where the train is. Far from the line the tiles are of a coarser zoom (80 m).
//   the detail    contour lines along the steps, roads and a river that stop dead at a tile border, and place labels that are cut
//                 off (`labels`, the scene draws them). Round the train the tiles of a finer zoom load in: first a grey tile
//                 (loading), then the tile with its streets and blocks; the 3D buildings and the trees of the tile rise out of it.
//   the traffic   small cars run along the roads; they stop dead when the wind stops (the game has stalled).
//   the route     the trail of the train (a blue line, as in a map application) and a pulse round the marker on each kick.
//   no data       after the wind stops, the tiles round the train lose their texture one ring on each kick (the magenta and
//                 black checkerboard of a missing asset).
//   the gaps      a slit in the void that the train passes in line 14: tapered ends tied with red ribbons, eyes inside that open,
//                 follow the train and blink on the snares, and a disused platform under it. A second, smaller one is beside the
//                 climb in line 16. The character is never shown.
//   the moon      the disc, from the catch to the ram.
// The train is a marker. `pose(t, quat)` writes everything for time t: a pure function of t.
import * as THREE from 'three';
import { mulberry32, smooth } from '@pve/engine/util';
import { Builder, allFaces, ambient, at, col, instanced, litMesh, sun, v3, type Face, type LitAtlas } from '@pve/engine/lit';
import { T_DIVE, T_DROP, T_PULL, T_WIND, type TrainPath } from './_bridgepath';
import { groundY, type BridgeWorld } from './_bridgeworld';

const CELL = 40, X0 = 38, X1 = 1118, Z0 = -240, Z1 = 240;
/** The steps of the terrain, m: the heights are rounded to it, as contour bands. */
const STEP = 12;
const SEA = -100;
/** The rings of tiles that lose their texture, 40 m each: the next one on every second kick after the wind stops. */
const RINGS = 4;
/** The train passes the gap at this time: the middle of the slit is beside the path there. The second gap is beside the climb. */
export const T_GAP = 64.2;
const T_GAP2 = 79.3;
const TUNA = 6;
/** A tile of the finer zoom loads when the train is this near (m): first the grey tile, then the tile. */
const LOAD_AT = 150, FINE_AT = 95;
/** The buildings and the trees of a loaded tile rise over this time (s). Cars: how many, their speed (m/s). The trail: one dot each this many s. */
const RISE = 0.45, CARS = 40, CAR_V = 14, TRAIL_DT = 0.08;
/** The weather layer: how many flat clouds, their drift (m/s). */
const CLOUDS = 36, CLOUD_V = 6;
/** The boats on the water: how many, their speed (m/s). */
const BOATS = 28, BOAT_V = 9;
/** The pins of a search of the map application: how many; each drops in when the train comes within PIN_AT (m). */
const PINS = 16, PIN_AT = 260;

const flatMat = (c: string, k = 1) => new THREE.MeshBasicMaterial({ color: col(c).multiplyScalar(k), toneMapped: false, fog: false });
const lens = (w: number, hh: number) => {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.quadraticCurveTo(0, hh, w / 2, 0);
  s.quadraticCurveTo(0, -hh, -w / 2, 0);
  return new THREE.ShapeGeometry(s, 10);
};

/** A gap: a flat picture that always faces the map camera. Its eyes open as the train comes, look at it, blink on the snares and close behind it. */
class Gap {
  readonly root = new THREE.Group();
  private sclera: THREE.InstancedMesh;
  private iris: THREE.InstancedMesh;
  private pupil: THREE.InstancedMesh;
  private eyes: { x: number; y: number; r: number; lag: number }[] = [];
  private o = new THREE.Object3D();
  private inv = new THREE.Matrix4();
  private tp = new THREE.Vector3();

  /** `open`: the eyes open from open[0] and close from open[1]. */
  constructor(readonly at: THREE.Vector3, w: number, h: number, count: number, private open: readonly [number, number], seed: number) {
    const lip = new THREE.Mesh(lens(w + 6, h + 6), flatMat('#c04ae0', 1.6));
    const slit = new THREE.Mesh(lens(w, h), flatMat('#1a0626'));
    slit.position.z = 0.5;
    this.root.add(lip, slit);
    // a red ribbon bow at each end: two loops and a knot
    for (const s of [-1, 1]) {
      const bow = new THREE.Group();
      for (const a of [0.55, -0.55]) {
        const loop = new THREE.Mesh(lens(0.15 * w, 0.46 * h), flatMat('#e0202e', 1.5));
        loop.rotation.z = a * s;
        loop.position.set(s * 0.05 * w * Math.cos(a), 0.05 * w * Math.sin(a) * 1.6, 1);
        bow.add(loop);
      }
      const knot = new THREE.Mesh(new THREE.CircleGeometry(0.13 * h, 8), flatMat('#ff5a5a', 1.8));
      knot.position.z = 1.5;
      bow.add(knot);
      bow.position.x = s * (w / 2 + 2);
      this.root.add(bow);
    }
    const disc = new THREE.CircleGeometry(1, 12);
    const inst = (m: THREE.Material, z: number) => {
      const im = instanced(disc, m, count);
      im.position.z = z;
      this.root.add(im);
      return im;
    };
    this.sclera = inst(flatMat('#fff4f0', 1.3), 1);
    this.iris = inst(flatMat('#e01a2a', 1.8), 1.5);
    this.pupil = inst(flatMat('#12040a'), 2);
    const er = mulberry32(seed);
    for (let k = 0; k < count; k++) {
      const u = (k + 0.5) / count - 0.5;
      // inside the lens: the room for an eye is the height of the slit at its x
      const room = h * 0.5 * (1 - 4 * u * u);
      this.eyes.push({ x: u * w * 0.86, y: (er() - 0.5) * room * 0.5, r: Math.min(0.2 * h, room * 0.42) * (0.8 + 0.3 * er()), lag: er() });
    }
    this.root.position.copy(at);
  }

  /** `train`: the matrix of the marker. `quat`: the rotation of the map camera. */
  pose(t: number, train: THREE.Matrix4, quat: THREE.Quaternion, snares: readonly number[]) {
    const near = t >= this.open[0] - 3 && t < this.open[1] + 3;
    this.root.visible = near;
    if (!near) return;
    const o = this.o;
    this.root.quaternion.copy(quat);
    this.root.updateMatrixWorld(true);
    this.tp.setFromMatrixPosition(train).applyMatrix4(this.inv.copy(this.root.matrixWorld).invert());
    let blink = 0;
    for (const s of snares) { if (s > t) break; if (t - s < 0.14) blink = 1 - Math.abs((t - s) / 0.07 - 1); }
    this.eyes.forEach((e, k) => {
      const open = smooth((t - this.open[0] - 0.5 * e.lag) / 0.18) * (1 - smooth((t - this.open[1] - 0.4 * e.lag) / 0.2)) * (1 - 0.9 * blink);
      const dx = this.tp.x - e.x, dy = this.tp.y - e.y, d = Math.hypot(dx, dy) || 1;
      const lx = (dx / d) * e.r * 0.45, ly = (dy / d) * e.r * 0.3;
      const put = (im: THREE.InstancedMesh, x: number, y: number, rx: number, ry: number) => {
        o.position.set(x, y, 0);
        o.quaternion.identity();
        o.scale.set(rx, Math.max(0.0001, ry), 1);
        o.updateMatrix();
        im.setMatrixAt(k, o.matrix);
      };
      put(this.sclera, e.x, e.y, e.r * 1.5, e.r * open);
      put(this.iris, e.x + lx, e.y + ly * open, e.r * 0.62, e.r * 0.62 * open);
      put(this.pupil, e.x + lx * 1.15, e.y + ly * 1.15 * open, e.r * 0.28, e.r * 0.5 * open);
    });
    for (const im of [this.sclera, this.iris, this.pupil]) im.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const im of [this.sclera, this.iris, this.pupil]) im.dispose();
    this.root.traverse((c) => { if (c instanceof THREE.Mesh) { c.geometry.dispose(); (c.material as THREE.Material).dispose(); } });
  }
}

export class OobWorld {
  readonly scene = new THREE.Scene();
  /** The middle of the first slit, for the sign of the window. */
  readonly gapAt = new THREE.Vector3();
  /** Place labels of the map application: a point of the map, the text, and how many px of it show before the tile border cuts it. */
  readonly labels: { at: THREE.Vector3; text: string; cut: number }[] = [];
  private train = new THREE.Group();
  private nodata: THREE.Mesh[] = [];
  private gaps: Gap[] = [];
  /** The columns of tiles of the finer zoom: the x of the column, the grey tiles that show while it loads, the loaded tiles. */
  private fine: { x: number; grey: THREE.Mesh; tiles: THREE.Mesh }[] = [];
  private moon: THREE.Mesh;
  private tuna: THREE.InstancedMesh;
  /** The 3D buildings and the trees of the fine tiles: each rises when its column loads. */
  private props: THREE.InstancedMesh;
  private propData: { x: number; y: number; z: number; w: number; h: number; d: number; yaw: number; load: number; tree: boolean }[] = [];
  private cars: THREE.InstancedMesh;
  private roads: { pts: THREE.Vector3[]; len: number }[] = [];
  private clouds: THREE.InstancedMesh;
  private cloudData: { x: number; y: number; z: number; r: number }[] = [];
  private boats: THREE.InstancedMesh;
  private boatData: { x: number; y: number; z: number; dir: number; span: number }[] = [];
  private pins: THREE.InstancedMesh;
  private pinData: { x: number; y: number; z: number; load: number }[] = [];
  private trail: THREE.InstancedMesh;
  private trailT: number[] = [];
  private pulse: THREE.Mesh;
  private o = new THREE.Object3D();

  constructor(A: LitAtlas, mat: THREE.Material, shared: BridgeWorld['shared'], private path: TrainPath, private kicks: readonly number[], private snares: readonly number[]) {
    // ---- the edge of the game map
    const tile: Face = { cell: A.paint(16, 16, (p) => { p.fill('#3f7a46'); p.speckle('#4a8a50', 0.2, 31); p.speckle('#356a3c', 0.2, 32); p.rect(0, 0, 16, 1, '#2f6238'); p.rect(0, 0, 1, 16, '#2f6238'); }) };
    const soil: Face = { cell: A.paint(8, 8, (p) => { p.fill('#4a3624'); p.speckle('#3a2a1a', 0.3, 33); p.rect(0, 0, 8, 1, '#2a1e12'); }) };
    const hill: Face = { cell: A.paint(8, 8, (p) => { p.fill('#5a6a62'); p.speckle('#4a5a52', 0.3, 34); }) };
    const portal: Face = { cell: A.solid('#08080c') };
    const edge = new Builder(0.25);
    edge.box(440, 30, 480, { py: tile, px: soil, nx: soil, pz: soil, nz: soil }, at(X0 - 220, -30.55, 0));
    const h = new Builder(1);
    h.cylinder(24, 6, 20, 6, hill, hill, at(-18, -0.55, 0, 0.5));
    h.box(3, 8, 11, allFaces(portal), at(-4.4, -0.55, 0));
    const red: Face = { cell: A.solid('#d83030', 0.6) }, white: Face = { cell: A.solid('#f0f0f0', 0.6) };
    for (let z = Z0; z <= Z1; z += 8) h.box(1.6, 5, 1.6, allFaces(Math.round(z / 8) % 2 ? red : white), at(X0 - 1, -0.55, z));
    this.scene.add(litMesh(edge, mat, { cast: false }), litMesh(h, mat, { cast: false }));
    this.scene.add(litMesh(shared.track, mat, { cast: false }), litMesh(shared.rails, mat, { cast: false }), litMesh(shared.ramp, mat, { cast: false }));

    // ---- the terrain of the map application
    const flat = (fill: string, line: string): Face => ({ cell: A.paint(16, 16, (p) => { p.fill(fill); p.rect(0, 0, 16, 1, line); p.rect(0, 0, 1, 16, line); }), map: 'fit' });
    const land = flat('#e6e2d4', '#c8c4b4'), park = flat('#c2dfb4', '#a4c896'), water = flat('#a6c6ee', '#8cb0de'), high = flat('#f4f1e6', '#d4cfbe'), snow = flat('#ffffff', '#d8dce8');
    const side: Face = { cell: A.solid('#aaa695') }, sideW: Face = { cell: A.solid('#7c9cc8') };
    const check: Face = {
      cell: A.paint(8, 8, (p) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) p.px(x, y, (x >> 2) ^ (y >> 2) ? '#ff00ff' : '#0a0a0a', (x >> 2) ^ (y >> 2) ? 0.8 : 0); }),
      map: 'fit',
    };
    const b = new Builder();
    const rings = Array.from({ length: RINGS }, () => new Builder());
    const stall = path.at(T_DROP).p;
    const rnd = mulberry32(0x00b);
    // the height and the kind of the tile at (x, z). Far from the line the tiles are of a coarser zoom: 80 m
    const tileY = (x: number, z: number) => { const g = groundY(x, z); return g < SEA ? SEA : Math.round(g / STEP) * STEP; };
    const contour: Face = { cell: A.solid('#a8845a') };
    const kinds = new Map<string, 'water' | 'snow' | 'high' | 'park' | 'land'>();
    const each = (fn: (x: number, z: number, c: number) => void) => {
      for (let x = X0 + CELL / 2; x < X1; x += CELL) for (let z = -160 + CELL / 2; z < 160; z += CELL) fn(x, z, CELL);
      for (let x = X0 + CELL; x < X1; x += 2 * CELL) for (const z of [-200, 200]) fn(x, z, 2 * CELL);
    };
    each((x, z, c) => {
      const wet = groundY(x, z) < SEA;
      const y = tileY(x, z);
      const kind = wet ? 'water' : y > 70 ? 'snow' : y > 30 ? 'high' : rnd() < 0.3 ? 'park' : 'land';
      kinds.set(`${x},${z}`, kind);
      const top = { water, snow, high, park, land }[kind];
      const s = wet ? sideW : side;
      b.box(c, y + 260, c, { py: top, px: s, nx: s, pz: s, nz: s }, at(x, -260, z));
      // a contour line along each side where the ground steps down
      if (!wet && c === CELL) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (Math.abs(z + dz * CELL) > 160 || tileY(x + dx * CELL, z + dz * CELL) >= y) continue;
          const ex = x + dx * (CELL / 2 - 2), ez = z + dz * (CELL / 2 - 2);
          b.box(dx ? 2.5 : CELL, 0.4, dz ? 2.5 : CELL, { py: contour }, at(ex, y + 0.1, ez));
        }
      }
      // the checkerboard lies just over the tile and shows when its ring has lost its data
      const ring = Math.floor(Math.hypot(x - stall.x, z) / CELL);
      if (ring < RINGS && c === CELL) rings[ring]!.quad(v3(x - c / 2, y + 3.5, z + c / 2), v3(x + c / 2, y + 3.5, z + c / 2), v3(x + c / 2, y + 3.5, z - c / 2), v3(x - c / 2, y + 3.5, z - c / 2), check);
    });
    // roads and a river: each goes from tile to tile, turns now and then, and stops dead at a tile border
    const road: Face = { cell: A.solid('#f2cf62', 0.3) }, lane: Face = { cell: A.solid('#ffffff', 0.3) }, river: Face = { cell: A.solid('#6f9fe0', 0.3) };
    const run = (x0: number, z0: number, len: number, w: number, f: Face, wet: boolean) => {
      let x = x0, z = z0, dx = 1, dz = 0;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < len; k++) {
        if (x > X1 - CELL || Math.abs(z) > 140) break;
        const kind = kinds.get(`${x},${z}`);
        // a road stops at the water
        if (!kind || (!wet && kind === 'water')) break;
        const y = tileY(x, z) + (wet ? 0.5 : 0.9);
        b.box(dx ? CELL : w, 0.3, dz ? CELL : w, { py: f }, at(x, y, z));
        pts.push(v3(x - dx * CELL / 2, y + 0.3, z - dz * CELL / 2), v3(x, y + 0.3, z));
        // a turn: the road goes on at a right angle from the middle of the tile
        if (rnd() < 0.3) { const turn = rnd() < 0.5 ? 1 : -1; [dx, dz] = dx ? [0, turn] : [1, 0]; b.box(w, 0.3, w, { py: f }, at(x, y + 0.05, z)); }
        pts.push(v3(x + dx * CELL / 2, y + 0.3, z + dz * CELL / 2));
        x += dx * CELL; z += dz * CELL;
      }
      if (!wet && pts.length > 2) {
        let len2 = 0;
        for (let k = 1; k < pts.length; k++) len2 += pts[k]!.distanceTo(pts[k - 1]!);
        this.roads.push({ pts, len: len2 });
      }
    };
    run(X0 + CELL / 2, 60, 9, 6, road, false);
    run(X0 + 4.5 * CELL, -100, 11, 6, road, false);
    run(X0 + 9.5 * CELL, 20, 8, 3.5, lane, false);
    run(X0 + 14.5 * CELL, -60, 10, 6, road, false);
    run(X0 + 2.5 * CELL, -20, 7, 3.5, lane, false);
    run(X0 + 6.5 * CELL, 100, 12, 10, river, true);
    run(X0 + 17.5 * CELL, 60, 7, 10, river, true);
    this.scene.add(litMesh(b, mat, { cast: false }));
    // the tiles of the finer zoom, by column: streets and blocks at four times the detail, over the tiles within 80 m of the line
    const fineFace = (fill: string, line: string, block: string, seed: number): Face => ({
      cell: A.paint(32, 32, (p) => {
        p.fill(fill);
        for (let k = 0; k < 32; k += 8) { p.rect(k, 0, 1, 32, line); p.rect(0, k, 32, 1, line); }
        const r = mulberry32(seed);
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (r() < 0.6) p.rect(i * 8 + 2 + Math.floor(r() * 2), j * 8 + 2 + Math.floor(r() * 2), 2 + Math.floor(r() * 3), 2 + Math.floor(r() * 3), block);
        p.rect(0, 15, 32, 2, '#fff8d8');
      }),
      map: 'fit',
    });
    const fines = { land: [fineFace('#efe9d6', '#cdc6b0', '#d8b89a', 1), fineFace('#efe9d6', '#cdc6b0', '#c9c0d6', 2)], park: [fineFace('#c8e6b8', '#a0c890', '#7fb46c', 3)], high: [fineFace('#f7f4ea', '#d6d0c0', '#c8b8a0', 4)], snow: [fineFace('#ffffff', '#d8dce8', '#c4d0e8', 5)], water: [fineFace('#a6c6ee', '#8cb0de', '#8cb0de', 6)] };
    const grey: Face = { cell: A.paint(8, 8, (p) => { p.fill('#b9b9bd'); for (let k = 0; k < 8; k++) p.px(k, k, '#a6a6ac'); p.rect(0, 0, 8, 1, '#9a9aa0'); p.rect(0, 0, 1, 8, '#9a9aa0'); }), map: 'fit' };
    // the time at which each column of fine tiles loads: the first time the train is near enough
    const loadAt = (x: number) => { for (let t = 55; t < 86; t += 1 / 36) if (path.at(t).p.x > x - FINE_AT) return t; return Infinity; };
    for (let x = X0 + CELL / 2; x < X1; x += CELL) {
      const gb = new Builder(), fb = new Builder();
      const load = loadAt(x);
      for (const z of [-60, -20, 20, 60]) {
        const y = tileY(x, z), kind = kinds.get(`${x},${z}`)!, list = fines[kind];
        const q = (bb: Builder, f: Face, lift: number) => bb.quad(v3(x - CELL / 2, y + lift, z + CELL / 2), v3(x + CELL / 2, y + lift, z + CELL / 2), v3(x + CELL / 2, y + lift, z - CELL / 2), v3(x - CELL / 2, y + lift, z - CELL / 2), f);
        q(gb, grey, 1.6);
        q(fb, list[Math.floor(rnd() * list.length)]!, 2);
        // the 3D layer of the map application: blocks of houses on land, taller blocks on high ground, trees in the parks. Not on
        // the line itself (the middle strip of the tile row)
        const n = kind === 'land' ? 7 : kind === 'high' ? 4 : kind === 'park' ? 9 : kind === 'snow' ? 6 : 0;
        for (let k = 0; k < n; k++) {
          const px = x + (rnd() - 0.5) * (CELL - 8), pz = z + (rnd() - 0.5) * (CELL - 8);
          if (Math.abs(pz) < 9) continue;
          // the high snow has pines (a tree is a green block)
          const tree = kind === 'park' || kind === 'snow';
          const w = tree ? 3 + 2 * rnd() : 5 + 7 * rnd(), d = tree ? w : 5 + 7 * rnd(), hgt = tree ? 5 + 4 * rnd() : kind === 'high' ? 12 + 22 * rnd() : 4 + 9 * rnd();
          this.propData.push({ x: px, y: y + 2, z: pz, w, h: hgt, d, yaw: tree ? 0 : Math.round(rnd()) * 0.3, load: load + 0.15 + 0.25 * rnd(), tree });
        }
      }
      const g = litMesh(gb, mat, { cast: false, receive: false }), f = litMesh(fb, mat, { cast: false, receive: false });
      this.fine.push({ x, grey: g, tiles: f });
      this.scene.add(g, f);
    }
    // one box for the houses and the trees: a house is pale with a white roof, a tree is a green block, in the flat look of a map
    // application
    const pb = new Builder();
    pb.box(1, 1, 1, { py: { cell: A.solid('#ffffff', 0.15) }, px: { cell: A.solid('#c4c0b4') }, nx: { cell: A.solid('#c4c0b4') }, pz: { cell: A.solid('#d8d4c8') }, nz: { cell: A.solid('#d8d4c8') } });
    this.props = instanced(pb.geometry(), mat, this.propData.length);
    this.propData.forEach((p, i) => {
      this.props.setColorAt(i, p.tree ? col('#5f9e60') : col(['#f2eee4', '#e8e2d6', '#dcd8e4', '#f0e2d0'][i % 4]!));
    });
    this.scene.add(this.props);
    // the weather layer of the map application over the far part of the map: flat clouds that drift across, high over the tiles
    const cloudGeo = new THREE.CircleGeometry(1, 7).rotateX(-Math.PI / 2);
    this.clouds = instanced(cloudGeo, new THREE.MeshBasicMaterial({ color: col('#ffffff'), transparent: true, opacity: 0.55, toneMapped: false, fog: false, depthWrite: false }), CLOUDS);
    for (let i = 0; i < CLOUDS; i++) this.cloudData.push({ x: 420 + rnd() * 700, y: 70 + rnd() * 70, z: -220 + rnd() * 440, r: 14 + rnd() * 26 });
    this.scene.add(this.clouds);
    // ferries on the water tiles: a white hull with a dark deck house and a red funnel, each going round its own loop
    const water0 = [...kinds.entries()].filter(([, k]) => k === 'water').map(([key]) => key.split(',').map(Number) as [number, number]);
    const bb = new Builder();
    bb.box(24, 3, 7, allFaces({ cell: A.solid('#f4f4f0', 0.4) }));
    bb.box(9, 3, 5, allFaces({ cell: A.solid('#3a4a6a') }), at(-3, 3, 0));
    bb.box(2.5, 3, 2.5, allFaces({ cell: A.solid('#d83030', 0.4) }), at(-4, 6, 0));
    this.boats = instanced(bb.geometry(), mat, BOATS);
    for (let i = 0; i < BOATS && water0.length; i++) {
      const [x, z] = water0[Math.floor(rnd() * water0.length)]!;
      this.boatData.push({ x: x + (rnd() - 0.5) * 20, y: SEA + 0.4, z: z + (rnd() - 0.5) * 24, dir: rnd() < 0.5 ? 1 : -1, span: 30 + rnd() * 50 });
    }
    this.boats.count = this.boatData.length;
    this.scene.add(this.boats);
    // the pins of a search: red heads on white sticks over the far part of the map. Each falls in and bounces when the train comes near
    const pb2 = new Builder();
    pb2.cylinder(0.8, 0.8, 14, 5, { cell: A.solid('#ffffff', 0.4) }, null);
    pb2.box(8, 8, 8, allFaces({ cell: A.solid('#ff3a3a', 1.2) }), at(0, 14, 0));
    this.pins = instanced(pb2.geometry(), mat, PINS);
    const near = (x: number, z: number) => { for (let t = 55; t < 86; t += 1 / 36) { const p = path.at(t).p; if (Math.hypot(p.x - x, p.z - z) < PIN_AT) return t; } return Infinity; };
    for (let i = 0; i < PINS; i++) {
      const x = 300 + rnd() * 780, z = (rnd() < 0.5 ? -1 : 1) * (30 + rnd() * 120);
      this.pinData.push({ x, y: tileY(x, z) + 2, z, load: near(x, z) + 0.12 * (i % 5) });
    }
    this.scene.add(this.pins);
    const ground = (x: number, z: number) => new THREE.Vector3(x, tileY(x, z) + 3, z);
    this.labels.push(
      { at: ground(X0 + 3 * CELL, 60), text: 'IWASHI-DAI', cut: 34 }, { at: ground(X0 + 7 * CELL, -100), text: 'KURAGE-CHO 2', cut: 40 },
      { at: ground(X0 + 11 * CELL, 100), text: 'ANA GAWA', cut: 22 }, { at: ground(X0 + 15 * CELL, -20), text: 'MAGURO BASHI', cut: 44 },
      { at: ground(X0 + 19 * CELL, 60), text: 'Rt.8', cut: 30 }, { at: ground(X0 + 23 * CELL, -60), text: 'TSUKI-MACHI', cut: 26 },
    );
    for (const r of rings) {
      const m = litMesh(r, mat, { cast: false, receive: false });
      m.visible = false;
      this.nodata.push(m);
      this.scene.add(m);
    }

    // ---- the train: a marker in the colours of the car, bright enough to read at 12 px
    const tb = new Builder();
    tb.box(20, 1.7, 3, allFaces({ cell: A.solid('#c02a2a', 1.2) }), at(0, 0.6, 0));
    tb.box(20, 1.6, 3, allFaces({ cell: A.solid('#f0e8d0', 1.2) }), at(0, 2.3, 0));
    tb.box(1, 1, 3.2, allFaces({ cell: A.solid('#fff0b0', 5) }), at(9.8, 1.2, 0));
    this.train.add(litMesh(tb, mat, { cast: false, receive: false }));
    this.train.matrixAutoUpdate = false;
    this.scene.add(this.train);
    const fish = new Builder();
    fish.box(7, 2, 2, allFaces({ cell: A.solid('#3a6cc8', 1.4) }), at(0, -1, 0));
    this.tuna = instanced(fish.geometry(), mat, TUNA);
    this.scene.add(this.tuna);

    // ---- the traffic: small bright cars on the roads
    const cb = new Builder();
    cb.box(4, 1.6, 2, allFaces({ cell: A.solid('#ffffff', 0.6) }));
    this.cars = instanced(cb.geometry(), mat, CARS);
    for (let i = 0; i < CARS; i++) this.cars.setColorAt(i, col(['#ff4a3a', '#3a7aff', '#ffd23a', '#ffffff', '#3ad08a'][i % 5]!));
    this.scene.add(this.cars);

    // ---- the route: the trail of the train, and the pulse round the marker
    for (let t = 55; t < T_DIVE; t += TRAIL_DT) this.trailT.push(t);
    const db = new Builder();
    db.box(3.2, 0.6, 3.2, allFaces({ cell: A.solid('#3a8aff', 1.6) }));
    this.trail = instanced(db.geometry(), mat, this.trailT.length);
    this.scene.add(this.trail);
    this.pulse = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col('#3a8aff').multiplyScalar(2), transparent: true, toneMapped: false, fog: false, depthWrite: false }));
    this.scene.add(this.pulse);

    // ---- the gaps: beside the path on its far side
    const P = path.at(T_GAP).p;
    this.gapAt.set(P.x, P.y + 6, -30);
    const P2 = path.at(T_GAP2).p;
    this.gaps.push(new Gap(this.gapAt, 120, 26, 7, [T_GAP - 2.2, T_GAP + 2.6], 0x9a9), new Gap(new THREE.Vector3(P2.x + 20, P2.y + 30, -30), 64, 15, 4, [T_GAP2 - 1.6, T_GAP2 + 2.2], 0x9b1));
    for (const g of this.gaps) this.scene.add(g.root);
    // the disused platform under the first slit
    const pf = new Builder();
    const conc: Face = { cell: A.solid('#8a8a92', 0.4) }, line: Face = { cell: A.solid('#e0c84a', 0.8) };
    pf.box(90, 3, 10, { py: conc, px: conc, nx: conc, pz: line, nz: conc }, at(P.x, P.y - 22, -30));
    for (const dx of [-36, -12, 12, 36]) pf.box(1.5, 8, 1.5, allFaces(conc), at(P.x + dx, P.y - 19, -33));
    pf.box(76, 1.5, 6, allFaces(conc), at(P.x, P.y - 11, -33));
    this.scene.add(litMesh(pf, mat, { cast: false }));

    // ---- the moon
    const M = path.moon;
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(M.radius, 24), flatMat('#ece6d2', 1.2));
    (this.moon.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
    this.moon.position.copy(M.centre);
    this.moon.lookAt(M.centre.clone().add(M.normal));
    this.scene.add(this.moon);

    this.scene.add(ambient('#ffffff', '#8090b0', 1.5));
    const s = sun('#ffffff', 1.4, 60, 256);
    s.castShadow = false;
    s.position.set(-30, 80, 40);
    this.scene.add(s, s.target);
  }

  /** How many rings of tiles have no data at t. */
  lost(t: number): number {
    if (t < T_WIND) return 0;
    let n = 0;
    for (const k of this.kicks) { if (k > t) break; if (k >= T_WIND - 1e-3) n++; }
    return Math.min(RINGS, Math.ceil(n / 2));
  }

  /** `quat`: the rotation of the map camera (the gap faces it). */
  pose(t: number, quat: THREE.Quaternion) {
    const m = this.path.matrix(t);
    this.train.matrix.copy(m);
    this.train.matrixWorldNeedsUpdate = true;
    const lost = this.lost(t);
    this.nodata.forEach((r, k) => { r.visible = k < lost; });

    // the tiles of the finer zoom load in ahead of the train and stay
    const tx = this.path.at(t).p.x;
    for (const f of this.fine) {
      f.tiles.visible = tx > f.x - FINE_AT;
      f.grey.visible = !f.tiles.visible && tx > f.x - LOAD_AT;
    }
    // the tuna come up from under the map and carry the marker
    const o = this.o;
    const u = smooth((t - 72.2) / (T_PULL - 0.2 - 72.2));
    for (let i = 0; i < TUNA; i++) {
      o.position.set(-8 + 3.4 * i, -2 - 46 * (1 - u), i % 2 ? 2.4 : -2.4).applyMatrix4(m);
      o.quaternion.setFromRotationMatrix(m);
      o.scale.setScalar(t >= 72.2 && t < T_DIVE ? 1 : 0.0001);
      o.updateMatrix();
      this.tuna.setMatrixAt(i, o.matrix);
    }
    this.tuna.instanceMatrix.needsUpdate = true;

    // the buildings and the trees rise out of their tile when it loads
    this.propData.forEach((p, i) => {
      const g = Math.max(0.0001, smooth((t - p.load) / RISE) * (1 + 0.15 * Math.exp(-Math.max(0, t - p.load - RISE) / 0.1)));
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(0, p.yaw, 0);
      o.scale.set(p.w, p.h * g, p.d);
      o.updateMatrix();
      this.props.setMatrixAt(i, o.matrix);
    });
    this.props.instanceMatrix.needsUpdate = true;

    // the cars: each runs along its road; they stop dead when the wind stops
    const tc = Math.min(t, T_WIND);
    for (let i = 0; i < CARS; i++) {
      const r = this.roads[i % this.roads.length]!, dir = i % 2 ? 1 : -1;
      const s0 = (((dir * CAR_V * tc + (i * 97.3) % r.len) % r.len) + r.len) % r.len;
      let s = s0, k = 1;
      while (k < r.pts.length - 1 && s > r.pts[k]!.distanceTo(r.pts[k - 1]!)) { s -= r.pts[k]!.distanceTo(r.pts[k - 1]!); k++; }
      const a = r.pts[k - 1]!, b = r.pts[k]!, seg = Math.max(0.001, a.distanceTo(b));
      o.position.lerpVectors(a, b, Math.min(1, s / seg));
      // the road stops dead at a tile border: a car drives off the end into nothing, and the next one comes out of the other end
      const ends = smooth(Math.min(s0, r.len - s0) / 4);
      const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
      // keep to the side of the road of its way
      o.position.x += Math.sin(yaw) * 1.4 * dir;
      o.position.z += Math.cos(yaw) * 1.4 * dir;
      o.rotation.set(0, dir > 0 ? yaw : yaw + Math.PI, 0);
      o.scale.setScalar(Math.max(0.0001, ends));
      o.updateMatrix();
      this.cars.setMatrixAt(i, o.matrix);
    }
    this.cars.instanceMatrix.needsUpdate = true;

    // the clouds drift across the map and come round again; they too stop when the wind stops
    const tw = Math.min(t, T_WIND);
    this.cloudData.forEach((c, i) => {
      const z = ((((c.z + 220 + CLOUD_V * tw) % 440) + 440) % 440) - 220;
      o.position.set(c.x, c.y, z);
      o.rotation.set(0, 0, 0);
      // a cloud thins out at the edges of the layer, where it comes round
      o.scale.set(c.r * 1.6, 1, c.r).multiplyScalar(Math.max(0.0001, smooth((220 - Math.abs(z)) / 40)));
      o.updateMatrix();
      this.clouds.setMatrixAt(i, o.matrix);
    });
    this.clouds.instanceMatrix.needsUpdate = true;

    // the boats go round their own long loops on the water; they stop when the wind stops
    this.boatData.forEach((b, i) => {
      const a = b.span / 2, w = BOAT_V / a, ph = b.dir * w * tw + i;
      o.position.set(b.x + a * Math.cos(ph), b.y, b.z + 6 * Math.sin(ph));
      // the heading is the tangent of the loop
      o.rotation.set(0, Math.atan2(-6 * Math.cos(ph) * b.dir, -a * Math.sin(ph) * b.dir), 0);
      o.scale.setScalar(1);
      o.updateMatrix();
      this.boats.setMatrixAt(i, o.matrix);
    });
    this.boats.instanceMatrix.needsUpdate = true;

    // the pins fall in from high over the map and bounce twice
    this.pinData.forEach((p, i) => {
      const d = t - p.load;
      const fall = d < 0.35 ? 120 * (1 - (d / 0.35) ** 2) : 6 * Math.abs(Math.sin(9 * (d - 0.35))) * Math.exp(-(d - 0.35) / 0.2);
      o.position.set(p.x, p.y + Math.max(0, fall), p.z);
      o.rotation.set(0, 0.6, 0);
      o.scale.setScalar(d >= 0 ? 1 : 0.0001);
      o.updateMatrix();
      this.pins.setMatrixAt(i, o.matrix);
    });
    this.pins.instanceMatrix.needsUpdate = true;

    // the trail: a dot where the train was, every TRAIL_DT, up to now
    let n = 0;
    for (const tt of this.trailT) {
      if (tt > t - 0.3) break;
      o.position.copy(this.path.at(tt).p);
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(1);
      o.updateMatrix();
      this.trail.setMatrixAt(n++, o.matrix);
    }
    this.trail.count = n;
    this.trail.instanceMatrix.needsUpdate = true;
    // the pulse: a ring that spreads from the marker on each kick
    let since = Infinity;
    for (const k of this.kicks) { if (k > t) break; since = t - k; }
    const pu = Math.min(1, since / 0.5);
    this.pulse.visible = since < 0.5;
    this.pulse.position.copy(this.path.at(t).p);
    this.pulse.scale.setScalar(6 + 30 * pu);
    (this.pulse.material as THREE.MeshBasicMaterial).opacity = 1 - pu;

    for (const g of this.gaps) g.pose(t, m, quat, this.snares);

    // the moon: there from the catch. When the train rams it, it flashes and stays red
    this.moon.visible = t >= T_PULL;
    const hit = t - T_DIVE;
    const mm = (this.moon.material as THREE.MeshBasicMaterial).color;
    if (hit < 0) mm.copy(col('#ece6d2')).multiplyScalar(1.2);
    else mm.copy(col('#ff3040')).multiplyScalar(1.4 + 1.6 * Math.exp(-hit / 0.1));
  }

  dispose() {
    this.tuna.dispose();
    this.props.dispose();
    this.cars.dispose();
    this.trail.dispose();
    this.clouds.dispose();
    (this.clouds.material as THREE.Material).dispose();
    this.boats.dispose();
    this.pins.dispose();
    this.pulse.geometry.dispose();
    (this.pulse.material as THREE.Material).dispose();
    for (const g of this.gaps) g.dispose();
    this.moon.geometry.dispose();
    (this.moon.material as THREE.Material).dispose();
  }
}
