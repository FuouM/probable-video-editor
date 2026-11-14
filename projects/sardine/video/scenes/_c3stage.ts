// The parts that chorus 3 and the outro add to the world of chorus 2 (treatment v9 "Plate 9", "Plate 10"). The world is the one
// game world as chorus 2 left it (`_c2shared.ts`). The train runs on round the loop, and a new straight track leaves the loop.
//   The route     `carOnRoute`: the lap of chorus 2 as far as `L_EXIT` (the loop at `EXIT_DEG` degrees), then the straight.
//   The stage     The frame in which this kit is written: the straight runs along x at z = 0, the train heads -x, the loop and the
//                 sky that the camera looks at are on +z. `GW_TO_STAGE` puts the game world into this frame.
//   `C3Line`      the straight: its track, a pole line with its wires beside it, and a street with a platform now and then.
//   `Wall`        at the end of the straight stands the wall with the credits: a painted sunrise with the name board of a station.
//                 The nose tears through its canvas.
//   `StarLines`   lead lines 31-37: each glyph is a constellation in the sky, its stars on the strokes, linked along them.
// `pose(t)` writes everything for time t: a pure function of t.
import * as THREE from 'three';
import type { Line } from '@pve/engine/lyrics';
import { Mask, type PixelFont } from '@pve/engine/type';
import { Builder, allFaces, at, col, glowMaterial, instanced, litMesh, v3, type Face, type LitAtlas } from '@pve/engine/lit';
import type { Sky } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import { DEG, hashSin, smooth } from '@pve/engine/util';
import { SPB, bar } from './_time';
import { buildTrack } from '@pve/engine/track';
import { GROUND_Y } from './_station';
import { c3Exit } from './_route';
import { LAP, SPEED, T_CROSS, lapAt } from './_c2shared';
import { T_CUT, T_HIT, T_OUTRO } from './_outro';

export { SPEED };
export const T0 = bar(77);

// ---------------------------------------------------------------- the route
/** The lap position of the exit (`c3Exit`), on the lap that the train is on at `T0`. */
export const L_EXIT = (() => {
  const on = c3Exit().on;
  let l = Math.floor(lapAt(T0) / LAP.len) * LAP.len + on;
  if (l < lapAt(T0)) l += LAP.len;
  return l;
})();
/** The middle of the front car is at the exit at this time. */
export const T_EXIT = T_CROSS + L_EXIT / SPEED;
const EXIT = LAP.at(L_EXIT);
/** The point of the route at the lap position `l` (game world frame). */
function routePoint(l: number): THREE.Vector3 {
  return l <= L_EXIT ? LAP.at(l).pos.clone() : EXIT.pos.clone().addScaledVector(EXIT.tangent, l - L_EXIT);
}
/** The matrix (game world frame) of a car whose middle is at `l`: on the lap, then on the straight. It stands on its two bogies, 7 m each way. */
export function carOnRoute(l: number): THREE.Matrix4 {
  if (l + 7 <= L_EXIT) return LAP.car(l);
  const a = routePoint(l + 7), b = routePoint(l - 7);
  return new THREE.Matrix4().makeRotationY(Math.atan2(-(a.z - b.z), a.x - b.x)).setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** The x of the exit in the stage frame. */
export const X_EXIT = 60;
/** The x of the middle of the front car on the straight at t. Before `T_EXIT` the train is on the loop: the value is where it would be on the line. */
export const xAt = (t: number) => X_EXIT - SPEED * (t - T_EXIT);
/** The plane of the wall: the nose (10 m ahead of the middle of the front car) is on it at `T_HIT`. */
export const X_WALL = xAt(T_HIT) - 10;
/** The game world in the stage frame: the exit is at (`X_EXIT`, 0, 0), and the straight heads -x. */
export const GW_TO_STAGE = (() => {
  const q = new THREE.Quaternion().setFromUnitVectors(v3(EXIT.tangent.x, 0, EXIT.tangent.z).normalize(), v3(-1, 0, 0));
  const turn = new THREE.Matrix4().makeRotationFromQuaternion(q);
  return new THREE.Matrix4().makeTranslation(X_EXIT, 0, 0).multiply(turn).multiply(new THREE.Matrix4().makeTranslation(-EXIT.pos.x, 0, -EXIT.pos.z));
})();

/** The eclipse stands in the sky behind the train, as the camera at the front right sees it (stage frame: the train heads -x). */
export const ECL_DIR = v3(0.93, 0.19, 0.2).normalize();
/** The sky of chorus 3, in the stage frame. */
export const ECLIPSE: Sky = {
  zenith: '#050c32', horizon: '#f08a3c', ground: '#3a2622', stars: 0.5, glowBand: 0.07,
  body: { dir: ECL_DIR, r: 0.05, colour: '#03040a', strength: 1, glow: 1, corona: { colour: '#d8e4ff', strength: 1.5 } },
};

/** The foot of the wall (y), and the size of a panel of its canvas (m). */
const Y_SKY0 = -8, PANEL = 24;
/** The platforms of the street of the straight: one each this far (m). */
const MODULE = 152;
/** The wall: from z = WALL_Z0 (its left end, seen from the train) to WALL_Z1, and its height. The name board is in the middle (z = 0). */
const WALL_Z0 = 110, WALL_Z1 = -110, WALL_H = 120;
/** The canvas round the hole breaks into squares of `SHARD` m: from z = -SHARD_Z to SHARD_Z, and from the foot of the wall up `SHARD_H` m. The nose meets the canvas at the height `HIT_Y`. */
const SHARD = 4, SHARD_Z = 16, SHARD_H = 32, HIT_Y = GROUND_Y + 2.5;
/** The four corners of the wall (stage frame): what is behind it does not show. */
export const WALL_CORNERS = [v3(X_WALL, Y_SKY0, WALL_Z0), v3(X_WALL, Y_SKY0, WALL_Z1), v3(X_WALL, Y_SKY0 + WALL_H, WALL_Z1), v3(X_WALL, Y_SKY0 + WALL_H, WALL_Z0)] as const;
/** The title of the song, on the name board of the wall. */
const TITLE = 'イワシがつちからはえてくるんだ';
/** The camera turns to the wall in the last bar of chorus 3 (the scene). The lamps of the wall come on from here, one pair on each half beat, from the middle out. The rows of the board are lit from `T_ROWS`, one on each half beat. */
const T_LAMPS = T_OUTRO - 2 * SPB, T_ROWS = T_OUTRO - SPB;
/** The glass of the CRT from inside: the bright rectangle behind the wall. */
const X_GLASS = xAt(T_CUT) - 12;

const basic = (c: string, k = 1) => new THREE.MeshBasicMaterial({ color: col(c).multiplyScalar(k), toneMapped: false, fog: false });

// ---------------------------------------------------------------- the line

export interface Target { p: THREE.Vector3; roof: boolean; what: 'house' | 'board' | 'tower' }

export class C3Line {
  /** Plain meshes of the street (the scene cuts them into chunks). */
  readonly root = new THREE.Group();
  /** The track: it unloads on its own clock. */
  readonly track: THREE.Mesh;
  readonly targets: Target[] = [];
  /** The windows on the north walls of the houses, and the lamps of the signals. */
  readonly windows: THREE.Vector3[] = [];
  readonly signals: THREE.Vector3[] = [];
  /** The tops of the poles of the line on the near side of the track. */
  readonly poles: THREE.Vector3[] = [];

  constructor(A: LitAtlas, mat: THREE.Material, kana: PixelFont) {
    const f = (c: string, e = 0): Face => ({ cell: A.solid(c, e) });
    const road: Face = { cell: A.paint(16, 16, (p) => { p.fill('#55565c'); p.speckle('#4a4b50', 0.25, 5); p.rect(0, 7, 6, 2, '#d8d4c0'); }) };
    const conc: Face = { cell: A.paint(16, 16, (p) => { p.fill('#9b988f'); p.speckle('#8c8981', 0.3, 3); p.rect(0, 0, 16, 1, '#7f7c75'); }) };
    const plaster = ['#e8dcc4', '#d8c8b0', '#c8d0d8', '#e0c8b8'].map((c) => ({ cell: A.paint(16, 16, (p) => { p.fill(c); p.rect(0, 0, 16, 2, '#6a6258'); }) }) as Face);
    const wallWin = ['#e8dcc4', '#d8c8b0', '#c8d0d8', '#e0c8b8'].map((c) => ({
      cell: A.paint(16, 16, (p) => { p.fill(c); p.rect(0, 0, 16, 2, '#6a6258'); for (const x of [2, 10]) { p.rect(x, 5, 4, 5, '#f4f0e4'); p.rect(x + 1, 6, 2, 3, '#1c2438'); } }),
      map: 'fit',
    }) as Face);
    const roofs = [['#8a3a2c', '#6e2c22'], ['#3a4a6a', '#2c3a56'], ['#4a5a4a', '#3a483a']].map(([c, d]) => ({ cell: A.paint(8, 8, (p) => { p.fill(c!); for (let y = 0; y < 8; y += 2) p.rect(0, y, 8, 1, d!); }) }) as Face);
    const wood = f('#4a3a2a'), steel = f('#6a7078'), dark = f('#14161c'), yellow = f('#e4b81c', 0.2), leaf = f('#2f6a34'), leaf2 = f('#3c7c3c'), trunk = f('#5a4030');
    const board: Face = {
      cell: A.paint(64, 24, (p) => {
        p.fill('#f4f1e6', 0.3);
        p.rect(0, 0, 64, 2, '#22242a'); p.rect(0, 22, 64, 2, '#22242a');
        const m = Mask.text(kana, 'あした', 1);
        m.draw(p.sink({ 1: '#14161c' }), Math.round((64 - m.w) / 2 - m.x0), Math.round((24 - m.h) / 2 - m.y0), 1);
      }),
      map: 'fit',
    };
    // the track starts on the loop, as a switch does, and ends at the wall
    const x0 = X_EXIT + 6, x1 = X_WALL;
    this.track = litMesh(buildTrack(A, new THREE.LineCurve3(v3(x0, 0, 0), v3(x1, 0, 0))), mat, { cast: false });

    const b = new Builder(0.5);
    const house = (x: number, z: number, w: number, d: number, h: number, rise: number, k: number) => {
      const wl = plaster[k % 4]!, rf = roofs[k % 3]!;
      b.box(w, h, d, { px: wl, nx: wl, pz: wl, nz: wallWin[k % 4]! }, at(x, GROUND_Y, z));
      const ya = GROUND_Y + h, yb = ya + rise, e = 0.4;
      b.quad(v3(x + w / 2 + e, ya, z - d / 2 - e), v3(x - w / 2 - e, ya, z - d / 2 - e), v3(x - w / 2 - e, yb, z), v3(x + w / 2 + e, yb, z), rf);
      b.quad(v3(x - w / 2 - e, ya, z + d / 2 + e), v3(x + w / 2 + e, ya, z + d / 2 + e), v3(x + w / 2 + e, yb, z), v3(x - w / 2 - e, yb, z), rf);
      b.tri(v3(x + w / 2, ya, z + d / 2), v3(x + w / 2, ya, z - d / 2), v3(x + w / 2, yb, z), wl);
      b.tri(v3(x - w / 2, ya, z - d / 2), v3(x - w / 2, ya, z + d / 2), v3(x - w / 2, yb, z), wl);
      this.targets.push({ p: v3(x, ya + rise * 0.5, z - d * 0.2), roof: true, what: 'house' });
      for (const dx of [-0.25, 0.25]) this.windows.push(v3(x + dx * w, GROUND_Y + h * 0.42, z - d / 2 - 0.06));
    };
    const tree = (x: number, z: number, s: number) => {
      b.cylinder(0.3 * s, 0.25 * s, 2 * s, 5, trunk, null, at(x, GROUND_Y, z));
      b.cylinder(2.2 * s, 0, 5 * s, 6, leaf, null, at(x, GROUND_Y + 1.6 * s, z));
      b.cylinder(1.6 * s, 0, 3.6 * s, 6, leaf2, null, at(x, GROUND_Y + 4 * s, z));
    };
    // all along the straight: the pole line on the near side with its two wires, a signal now and then
    for (let x = X_EXIT - 24, k = 0; x > X_WALL + 20; x -= 38, k++) {
      b.box(0.3, 8, 0.3, allFaces(wood), at(x, GROUND_Y, -8));
      b.box(0.2, 0.2, 2.4, allFaces(wood), at(x, GROUND_Y + 7, -8));
      this.poles.push(v3(x, GROUND_Y + 7.25, -8));
      if (k % 2 === 1) {
        b.cylinder(0.08, 0.08, 4.2, 5, steel, steel, at(x - 11, GROUND_Y, 2.9));
        b.box(0.4, 1.0, 0.5, allFaces(dark), at(x - 11, GROUND_Y + 4.2, 2.9));
        this.signals.push(v3(x - 11, GROUND_Y + 4.55, 2.6));
      }
    }
    // the wires: two from pole to pole, each in two straight halves that meet lower in the middle (the sag), 0.1 m thick as on the loop
    for (let k = 0; k + 1 < this.poles.length; k++) {
      const a = this.poles[k]!, c = this.poles[k + 1]!;
      for (const dz of [-0.9, 0.9]) for (const h of [0, 1]) {
        const p0 = v3(a.x + (c.x - a.x) * (h / 2), a.y - 0.25 - 0.5 * h, a.z + dz), p1 = v3(a.x + (c.x - a.x) * ((h + 1) / 2), a.y - 0.75 + 0.5 * h, a.z + dz);
        const mid = p0.clone().lerp(p1, 0.5);
        b.box(p0.distanceTo(p1), 0.1, 0.1, allFaces(dark), new THREE.Matrix4().makeRotationZ(Math.atan2(p1.y - p0.y, p1.x - p0.x)).setPosition(mid.x, mid.y, mid.z));
      }
    }
    for (let mx = X_EXIT - 200, n = 0; mx > X_WALL + 90; mx -= MODULE, n++) {
      // the platform with its shelter and its board, on the far side of the track
      b.box(34, 1.1, 4, { py: conc, px: conc, nx: conc, pz: conc, nz: conc }, at(mx, GROUND_Y, 6));
      b.box(34, 0.04, 0.5, { py: yellow }, at(mx, GROUND_Y + 1.1, 4.5));
      for (const dx of [-4, 4]) for (const dz of [6.4, 7.6]) b.box(0.18, 2.6, 0.18, allFaces(steel), at(mx + dx, GROUND_Y + 1.1, dz));
      b.box(9.4, 0.2, 2.2, allFaces(dark), at(mx, GROUND_Y + 3.7, 7));
      for (const dx of [-2.4, 2.4]) b.box(0.14, 2.2, 0.14, allFaces(steel), at(mx + 11 + dx, GROUND_Y + 1.1, 7.2));
      const by = GROUND_Y + 2.1;
      b.quad(v3(mx + 13.4, by, 7.2), v3(mx + 8.6, by, 7.2), v3(mx + 8.6, by + 1.8, 7.2), v3(mx + 13.4, by + 1.8, 7.2), board);
      this.targets.push({ p: v3(mx + 11, by + 1.6, 7.2), roof: false, what: 'board' });
      // the street: a road, a row of houses before it and a row behind it, and a few far off
      b.box(150, 0.06, 5, { py: road }, at(mx, GROUND_Y, 27));
      [-64, -42, -20, 26, 48, 68].forEach((dx, k) => house(mx + dx, 17.5, 8 + (k % 3), 7, 4.6 + (k % 2) * 2.4, 2.2, k + n));
      [-70, -46, -22, 4, 30, 56].forEach((dx, k) => house(mx + dx, 37, 9 + ((k + 1) % 3), 8, 5 + ((k + 1) % 2) * 2.6, 2.6, k + 2 + n));
      [-52, 0, 50].forEach((dx, k) => house(mx + dx, 64 + 9 * k, 12, 10, 6 + 2 * k, 3, k + 1));
      // a water tower
      const tx = mx - 4, tz = 52;
      for (const dx of [-1.8, 1.8]) for (const dz of [-1.8, 1.8]) b.box(0.35, 11, 0.35, allFaces(steel), at(tx + dx, GROUND_Y, tz + dz));
      b.cylinder(3.2, 3.2, 4.6, 8, steel, steel, at(tx, GROUND_Y + 11, tz));
      b.cylinder(3.5, 0, 1.6, 8, roofs[1]!, null, at(tx, GROUND_Y + 15.6, tz));
      this.targets.push({ p: v3(tx, GROUND_Y + 16, tz), roof: true, what: 'tower' });
      [[-74, 50, 1], [-30, 56, 1.3], [22, 50, 0.9], [44, 58, 1.2], [70, 46, 1], [-10, 96, 1.6], [60, 104, 1.5], [-60, 110, 1.7]].forEach(([dx, z, s]) => tree(mx + dx!, z!, s!));
    }
    this.root.add(litMesh(b, mat, { cast: false }));
  }
}

// ---------------------------------------------------------------- the wall

export interface WallSpec {
  latin: PixelFont;
  kana: PixelFont;
}

export class Wall {
  readonly root = new THREE.Group();
  private wallMat: THREE.MeshBasicMaterial;
  private strips: { mesh: THREE.Mesh; z: number }[] = [];
  private wallLamps: THREE.InstancedMesh;
  private cones: THREE.Mesh[] = [];
  private rowLights: THREE.Mesh[] = [];
  private shards: { mesh: THREE.Mesh; home: THREE.Vector3; k: number }[] = [];
  private rain: THREE.InstancedMesh;
  private glass: THREE.Mesh;
  private o = new THREE.Object3D();
  private c = new THREE.Color();

  constructor(s: WallSpec) {
    // ---- the wall: a painted sunrise, and on it the name board of a station. The board carries the credits
    const ppm = 6, TW = (WALL_Z0 - WALL_Z1) * ppm, TH = WALL_H * ppm;
    const img = new Uint8Array(TW * TH * 4);
    const gold = new THREE.Color('#ffd98a'), pink = new THREE.Color('#f4a6b4'), blue = new THREE.Color('#8ab4e4'), px = new THREE.Color();
    const cx = Math.round(((WALL_Z0 - 0) / (WALL_Z0 - WALL_Z1)) * TW);
    const put = (X: number, Y: number, c: THREE.Color) => {
      if (X < 0 || X >= TW || Y < 0 || Y >= TH) return;
      // the marks of a wide brush, and the seams of the panels
      const k = (0.94 + 0.08 * hashSin(Math.floor(X / 22), Y) + 0.04 * hashSin(X, Math.floor(Y / 6))) * (X % (PANEL * ppm) < 2 || Y % (PANEL * ppm) < 2 ? 0.82 : 1);
      img.set([Math.min(255, Math.round(c.r * k * 255)), Math.min(255, Math.round(c.g * k * 255)), Math.min(255, Math.round(c.b * k * 255)), 255], (Y * TW + X) * 4);
    };
    // the sky: gold at the foot, pink, blue at the top. The sun comes up behind the line, with the flat rays of a poster, and three bands of cloud
    const sunY = (6 - Y_SKY0) * ppm, sunR = 44 * ppm, pale = new THREE.Color('#fff3c4'), white = new THREE.Color('#fff8ee');
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      const v = y / TH, dx = x - cx, dy = y - sunY, d = Math.hypot(dx, dy);
      px.copy(gold).lerp(pink, smooth(v / 0.5)).lerp(blue, smooth((v - 0.45) / 0.5));
      if (dy > 0 && Math.floor((Math.atan2(dy, dx) / Math.PI) * 22) % 2 === 0) px.lerp(pale, 0.42 * Math.exp(-d / (150 * ppm)));
      if (d < sunR) px.set('#fff6d8'); else if (d < sunR + 3 * ppm) px.set('#ffc45a');
      for (const [by, bh, seed] of [[0.36, 0.035, 3], [0.62, 0.03, 5], [0.8, 0.045, 7]] as const) {
        const edge = bh * (0.55 + 0.45 * hashSin(Math.floor(x / (10 * ppm)), seed));
        if (Math.abs(v - by) < edge && hashSin(Math.floor(x / (70 * ppm) + seed), seed + 1) < 0.62) px.lerp(white, 0.5);
      }
      put(x, y, px);
    }
    // `width`: the width of a string (px). `text`: `align` -1 from X to the right, 0 about X, 1 up to X; `top` the top of the text
    const width = (font: PixelFont, str: string, scale: number) => [...str].reduce((acc, ch) => acc + font.glyph(ch).adv, 0) * scale;
    const text = (font: PixelFont, str: string, scale: number, align: number, X: number, top: number, c: THREE.Color) => {
      let pen = Math.round(align === 0 ? X - width(font, str, scale) / 2 : align < 0 ? X : X - width(font, str, scale));
      // the top row of ink of the string is at `top`
      const y0 = Math.min(...[...str].map((ch) => font.glyph(ch).y0));
      for (const ch of str) {
        const gl = font.glyph(ch);
        for (let yy = 0; yy < gl.h; yy++) for (let xx = 0; xx < gl.w; xx++) {
          if (!gl.bits[yy * gl.w + xx]) continue;
          for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) put(pen + (gl.x0 + xx) * scale + dx, top - (gl.y0 - y0 + yy) * scale - dy, c);
        }
        pen += gl.adv * scale;
      }
    };
    // the board: the name board of a station platform. White, a dark frame, the name large, its reading under it, a sea-green band
    // with the stations before and after (the arrows), and the credits under the band
    const B0 = cx - 100 * ppm, B1 = cx + 100 * ppm, BY0 = (14 - Y_SKY0) * ppm, BY1 = (80 - Y_SKY0) * ppm;
    const frame = new THREE.Color('#1c2030'), face = new THREE.Color('#f6f4ec'), band = new THREE.Color('#1f7a8c'), ink = new THREE.Color('#1c2030'), soft = new THREE.Color('#5a6078');
    // from the top down (px): the name, its reading, the band, the labels under the band, the credits
    const bandY1 = BY1 - 26 * ppm, bandY0 = bandY1 - 10 * ppm, bandMid = (bandY0 + bandY1) / 2;
    for (let y = BY0; y < BY1; y++) for (let x = B0; x < B1; x++) {
      const rim = x < B0 + 2 * ppm || x >= B1 - 2 * ppm || y < BY0 + 2 * ppm || y >= BY1 - 2 * ppm;
      const inBand = y >= bandY0 && y < bandY1;
      // the arrows of the band: the station before on the left, the one after on the right
      const h = (bandY1 - bandY0) * 0.32;
      const left = x > B0 + 5 * ppm && x < B0 + 5 * ppm + 2 * h && Math.abs(y - bandMid) < (x - B0 - 5 * ppm) * 0.5;
      const right = x < B1 - 5 * ppm && x > B1 - 5 * ppm - 2 * h && Math.abs(y - bandMid) < (B1 - 5 * ppm - x) * 0.5;
      put(x, y, rim ? frame : inBand ? (left || right ? face : band) : face);
    }
    const fit = (font: PixelFont, str: string, w: number, max: number) => Math.max(1, Math.min(max, Math.floor(w / width(font, str, 1))));
    const inner = B1 - B0 - 20 * ppm;
    text(s.kana, TITLE, fit(s.kana, TITLE, inner, 9), 0, cx, BY1 - 5 * ppm, ink);
    const READ = 'IWASHI GA TSUCHI KARA HAETEKURU NDA';
    text(s.latin, READ, fit(s.latin, READ, inner * 0.6, 4), 0, cx, bandY1 + 7 * ppm, soft);
    const bs = Math.max(2, Math.round(((bandY1 - bandY0) * 0.5) / 7));
    text(s.latin, 'KORONBA', bs, -1, B0 + 16 * ppm, bandMid + 3.5 * bs, face);
    text(s.latin, 'FM', bs, 1, B1 - 16 * ppm, bandMid + 3.5 * bs, face);
    text(s.latin, 'ORIGINAL MV', 3, -1, B0 + 16 * ppm, bandY0 - 3 * ppm, soft);
    text(s.latin, 'IDEA', 3, 1, B1 - 16 * ppm, bandY0 - 3 * ppm, soft);
    text(s.latin, 'VISUALS: CLAUDE FABLE 5.2 & OPUS 5.5, GEMINI 4 ARGON', 4, 0, cx, BY0 + 14 * ppm, ink);
    // the rows that the lamps light one after the other: the height of the middle of each, and how high it is (m)
    const m = (px: number) => px / ppm + Y_SKY0;
    const rows: [number, number][] = [[m(BY1) - 16, 22], [m(bandY1) + 5, 6], [m(bandMid), 10], [m(BY0) + 6, 9]];
    const wtex = new THREE.DataTexture(img, TW, TH, THREE.RGBAFormat);
    wtex.colorSpace = THREE.SRGBColorSpace;
    // seen at a slant and from far off, the text must not break up: mip maps and anisotropy; close up it stays pixels
    wtex.generateMipmaps = true;
    wtex.minFilter = THREE.LinearMipmapLinearFilter;
    wtex.magFilter = THREE.NearestFilter;
    wtex.anisotropy = 8;
    wtex.needsUpdate = true;
    this.wallMat = new THREE.MeshBasicMaterial({ map: wtex, toneMapped: false, fog: false, side: THREE.DoubleSide });
    // the canvas: strips of 4 m where the train goes through (they tear and swing in), one piece on each side of them. A strip hangs
    // from its top edge; `h`: how far down it reaches (m)
    const piece = (za: number, zb: number, h = WALL_H) => {
      const geo = new THREE.BufferGeometry();
      const ua = (WALL_Z0 - za) / (WALL_Z0 - WALL_Z1), ub = (WALL_Z0 - zb) / (WALL_Z0 - WALL_Z1), v0 = 1 - h / WALL_H;
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -h, za, 0, -h, zb, 0, 0, zb, 0, -h, za, 0, 0, zb, 0, 0, za], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([ua, v0, ub, v0, ub, 1, ua, v0, ub, 1, ua, 1], 2));
      const m = new THREE.Mesh(geo, this.wallMat);
      m.position.set(X_WALL, Y_SKY0 + WALL_H, 0);
      m.frustumCulled = false;
      this.root.add(m);
      return m;
    };
    piece(WALL_Z0, 32);
    piece(-32, WALL_Z1);
    // the strips over the hole reach down only to the shards
    for (let z = 32; z > -32; z -= 4) this.strips.push({ mesh: piece(z, z - 4, Math.abs(z - 2) < SHARD_Z ? WALL_H - SHARD_H : WALL_H), z: z - 2 });
    // the shards: the canvas round the hole in squares of `SHARD` m, each a piece of the painting. The nose breaks them out
    for (let z = SHARD_Z - SHARD / 2; z > -SHARD_Z; z -= SHARD) for (let y = Y_SKY0 + SHARD / 2; y < Y_SKY0 + SHARD_H; y += SHARD) {
      const geo = new THREE.BufferGeometry(), h = SHARD / 2;
      const u = (zz: number) => (WALL_Z0 - zz) / (WALL_Z0 - WALL_Z1), v = (yy: number) => (yy - Y_SKY0) / WALL_H;
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -h, h, 0, -h, -h, 0, h, -h, 0, -h, h, 0, h, -h, 0, h, h], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([u(z + h), v(y - h), u(z - h), v(y - h), u(z - h), v(y + h), u(z + h), v(y - h), u(z - h), v(y + h), u(z + h), v(y + h)], 2));
      const m = new THREE.Mesh(geo, this.wallMat);
      m.frustumCulled = false;
      this.root.add(m);
      this.shards.push({ mesh: m, home: v3(X_WALL, y, z), k: this.shards.length });
    }
    // the lamps of its rig along the top, their cones of light on the canvas, and the light on each row of the credits
    this.wallLamps = instanced(new THREE.CircleGeometry(2.2, 10).rotateY(Math.PI / 2), glowMaterial(), 12, { color: true });
    for (let i = 0; i < 12; i++) {
      const z = (i - 5.5) * 22;
      this.o.position.set(X_WALL + 1.2, Y_SKY0 + WALL_H + 3, z); this.o.rotation.set(0, 0, 0); this.o.scale.setScalar(1); this.o.updateMatrix();
      this.wallLamps.setMatrixAt(i, this.o.matrix);
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -WALL_H - 3, 26, 0, -WALL_H - 3, -26], 3));
      const cone = new THREE.Mesh(cg, glowMaterial());
      cone.position.set(X_WALL + 0.6, Y_SKY0 + WALL_H + 3, z);
      cone.frustumCulled = false;
      this.cones.push(cone);
      this.root.add(cone);
    }
    rows.forEach(([y, h]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2), glowMaterial());
      m.position.set(X_WALL + 0.4, y, 0);
      m.scale.set(1, h, 196);
      this.rowLights.push(m);
      this.root.add(m);
    });
    this.root.add(this.wallLamps);
    // behind the wall: a rain of lamps, and the bright glass
    this.rain = instanced(new THREE.IcosahedronGeometry(0.7, 0), basic('#ffd48a', 2.5), 50);
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2), basic('#dfeaff', 2.6));
    this.glass.position.set(X_GLASS, 5, -1);
    this.glass.scale.set(1, 13, 23);
    this.root.add(this.rain, this.glass);
  }

  pose(t: number) {
    const o = this.o;
    // ---- the wall: dark, until its lamps come on (one pair on each half beat, from the middle out), then the rows of the credits
    const lampsOn = (i: number) => smooth((t - (T_LAMPS + 0.5 * SPB * Math.floor(Math.abs(i - 5.5)))) / 0.08);
    let light = 0;
    for (let i = 0; i < 12; i++) {
      const on = lampsOn(i);
      light += on / 12;
      this.wallLamps.setColorAt(i, this.c.setRGB(1, 0.86, 0.6).multiplyScalar(0.05 + 3 * on));
      (this.cones[i]!.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.86, 0.6).multiplyScalar(0.07 * on);
    }
    this.wallLamps.instanceColor!.needsUpdate = true;
    this.wallMat.color.setRGB(0.05, 0.055, 0.11).lerp(this.c.setRGB(0.74, 0.74, 0.74), 0.6 * light + 0.4 * smooth((t - T_ROWS - 2 * SPB) / 0.3));
    this.rowLights.forEach((m, r) => (m.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.9, 0.7).multiplyScalar(0.05 * smooth((t - (T_ROWS + 0.5 * SPB * r)) / 0.06) * (1 - smooth((t - T_ROWS - 2 * SPB) / 0.3))));
    // ---- the hit: the canvas tears in strips that swing in, the frames behind it break, lamps rain down
    const tau = t - T_HIT;
    for (const st of this.strips) {
      const a = tau < 0 ? 0 : 0.2 * Math.exp(-((st.z / 9) ** 2)) * (1 - Math.exp(-7 * tau)) * (1 + 0.35 * Math.sin(9 * tau + st.z) * Math.exp(-2 * tau));
      st.mesh.rotation.z = -a;
      st.mesh.position.x = X_WALL - (tau < 0 ? 0 : 1.5 * Math.exp(-((st.z / 20) ** 2)) * (1 - Math.exp(-9 * tau)));
    }
    // the shards: each breaks out a moment after the nose reaches it (the nearer, the sooner), flies on ahead of the train, turns over and falls
    for (const s of this.shards) {
      const d = Math.hypot(s.home.y - HIT_Y, s.home.z), u = tau - 0.012 * d;
      const o2 = s.mesh;
      if (u <= 0) { o2.position.copy(s.home); o2.rotation.set(0, 0, 0); o2.visible = true; continue; }
      const k = s.k, out = 3 + 9 * hashSin(k, 3), dir = Math.atan2(s.home.y - HIT_Y, s.home.z);
      o2.position.set(s.home.x - (14 + 22 * hashSin(k, 1)) * u, s.home.y + Math.sin(dir) * out * u + 6 * u - 16 * u * u, s.home.z + Math.cos(dir) * out * u);
      o2.rotation.set((hashSin(k, 4) - 0.5) * 10 * u, (hashSin(k, 5) - 0.5) * 8 * u, (hashSin(k, 6) - 0.5) * 12 * u);
      o2.visible = o2.position.y > Y_SKY0 - 30;
    }
    const fx = tau >= 0;
    this.rain.visible = fx;
    this.glass.visible = fx;
    if (!fx) return;
    for (let i = 0; i < 50; i++) {
      const u = tau - 0.5 * hashSin(i, 11);
      o.position.set(X_WALL - 6 - 44 * hashSin(i, 12), 34 - 30 * Math.max(0, u) ** 2 * 1.4, (hashSin(i, 13) - 0.5) * 30);
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(u < 0 || o.position.y < -2 ? 0.0001 : 1);
      o.updateMatrix();
      this.rain.setMatrixAt(i, o.matrix);
    }
    this.rain.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.root.traverse((m) => { if (m instanceof THREE.Mesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  }
}

// ---------------------------------------------------------------- the lines as constellations

/** A star of a constellation: its syllable, its direction in the sky, whether it is a bright one (the end of a stroke), and a seed. */
interface Star { u: number; dir: THREE.Vector3; big: boolean; seed: number; at: number }
interface StarRow { stars: Star[]; links: [number, number][]; starts: number[]; ends: number; from: number }

/** The size of a font pixel on the screen at the anchor (px), the place of the two rows in the picture (ndc y), and the distance of the sky (m). */
const SPX = 2.6, ROW_Y = [0.74, 0.5] as const, SKY_D = 3000;
/** A star comes on over this time after the one before it on its syllable (s), and a link draws itself over `LINK` s. */
const STEP = 0.025, LINK = 0.12;
/** No star comes nearer to the eclipse than this angle (rad): the disc and its corona. */
export const ECL_CLEAR = 0.27;
/** True when the ndc point p is inside the convex quad q (ndc, in order round it). */
function inQuad(p: THREE.Vector3, q: readonly THREE.Vector3[]): boolean {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i]!, b = q[(i + 1) % q.length]!, s = Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    if (s !== 0 && sign !== 0 && s !== sign) return false;
    if (s !== 0) sign = s;
  }
  return true;
}

export class StarLines {
  private rows: StarRow[] = [];
  private p = new THREE.Vector3();

  /**
   * `lines`: the lead lines. Each line is a row of constellations, one for each glyph: stars on the strokes of the pixel font, linked
   * along the strokes. A row is fixed in the sky. `camAt` gives the camera of a time: the row stands where the camera looks while its
   * line is sung (the time of the line at which the most of the line is in the picture). `avoid`: the direction of the eclipse: a row
   * moves the least it can to keep its stars out of the corona. `shift`: for a line (by its index `Line.i`), a move of its row in the
   * picture of its anchor camera (`x` across, - is left, `y` up and down, - is down, in ndc), made before the move off the corona, and the
   * largest share of its size (`s`): a smaller row fits beside the eclipse where a full one would be pushed away from the place. `clear`:
   * the nearest its stars may come to the eclipse (rad; `ECL_CLEAR` for the other lines): the visible corona is smaller than that.
   */
  constructor(font: PixelFont, lines: readonly Line[], camAt: (t: number) => THREE.PerspectiveCamera, avoid: THREE.Vector3, shift: Readonly<Record<number, { x: number; y: number; s: number; clear: number }>> = {}) {
    lines.forEach((line, index) => {
      const sh = line.i in shift ? shift[line.i]! : { x: 0, y: 0, s: 1, clear: ECL_CLEAR };
      const units = line.written!.units;
      const split = units.length > 8 ? Math.ceil(units.length / 2) : units.length;
      // the ink of the row in font pixels: x to the right, y down, by syllable
      const ink: { u: number; x: number; y: number; row: number }[] = [];
      const widths = [0, 0];
      units.forEach((u, k) => {
        const row = k < split ? 0 : 1;
        for (const ch of u.glyph) {
          const g = font.glyph(ch);
          for (let yy = 0; yy < g.h; yy++) for (let xx = 0; xx < g.w; xx++) if (g.bits[yy * g.w + xx]) ink.push({ u: k, x: widths[row]! + g.x0 + xx, y: g.y0 + yy, row });
          widths[row]! += g.adv;
        }
        widths[row]! += 3;
      });
      // the stars: ink pixels at least 2.1 font pixels apart (a curve becomes a chain of short links), and the links: two stars close
      // together with ink all the way between them
      const on = new Set(ink.map((q) => `${q.row}:${q.x}:${q.y}`));
      const picked: typeof ink = [];
      for (const q of ink) if (!picked.some((s) => s.row === q.row && Math.hypot(s.x - q.x, s.y - q.y) < 2.1)) picked.push(q);
      const links: [number, number][] = [];
      const degree = picked.map(() => 0);
      picked.forEach((a, i) => picked.forEach((b, j) => {
        if (j <= i || a.row !== b.row || a.u !== b.u || Math.hypot(a.x - b.x, a.y - b.y) > 3.2) return;
        for (let s = 1; s < 4; s++) if (!on.has(`${a.row}:${Math.round(a.x + ((b.x - a.x) * s) / 4)}:${Math.round(a.y + ((b.y - a.y) * s) / 4)}`)) return;
        links.push([i, j]);
        degree[i]!++; degree[j]!++;
      }));
      // the anchor: of some times of the line, the one whose camera keeps the middle of the row in the picture for the most of the second
      // half of the line and the time after it (the row stays a moment after its line)
      const t0 = units[0]!.start, t1 = line.end, ta = t0 + 0.4 * (t1 - t0), tb = t1 + 0.8;
      let best = t0, bestN = -1;
      for (let k = 0; k <= 6; k++) {
        const at = t0 + ((t1 - t0) * k) / 6, cam = camAt(at);
        const mid = new THREE.Vector3(0, ROW_Y[0], 0.5).unproject(cam).sub(cam.position).normalize();
        let n = 0;
        for (let j = 0; j <= 8; j++) {
          const c = camAt(ta + ((tb - ta) * j) / 8);
          const q = c.position.clone().addScaledVector(mid, SKY_D).project(c);
          if (q.z < 1 && Math.abs(q.x) < 0.7 && Math.abs(q.y) < 0.9) n++;
        }
        if (n >= bestN) { bestN = n; best = at; }
      }
      const cam = camAt(best);
      // the direction of a star with the row moved by (dx, dy) in ndc of the camera `c` and drawn at the share s of its size: the row is
      // centred, 640 x 360 px is 2 x 2 in ndc
      const dirIn = (c: THREE.PerspectiveCamera, q: (typeof picked)[number], dx: number, dy: number, s: number) => {
        const nx = dx + ((q.x - widths[q.row]! / 2) * SPX * s * 2) / (360 * c.aspect);
        const ny = dy + ROW_Y[0] - s * (ROW_Y[0] - ROW_Y[q.row]! + (q.y * SPX) / 180);
        return new THREE.Vector3(nx, ny, 0.5).unproject(c).sub(c.position).normalize();
      };
      const dirOf = (q: (typeof picked)[number], dx: number, dy: number, s: number) => dirIn(cam, q, sh.x + dx, sh.y + dy, s);
      // the wall, as a quad of ndc points in the camera of the start, the middle and the end of the line (null: not all of it in front)
      const checks = [t0, (t0 + t1) / 2, t1].map((at) => {
        const c = camAt(at), q = WALL_CORNERS.map((w) => w.clone().project(c));
        return { c, quad: q.every((p) => p.z < 1) ? q : null };
      });
      // the nearest that a star of the row comes to the eclipse, or -1 when a star is out of the picture, under the horizon, or on the wall
      const room = (dx: number, dy: number, s: number) => {
        let min = Infinity;
        for (const q of picked) {
          const d = dirOf(q, dx, dy, s);
          const p = cam.position.clone().addScaledVector(d, SKY_D).project(cam);
          if (d.y < 0.07 || Math.abs(p.x) > 0.94 || Math.abs(p.y) > 0.92) return -1;
          for (const k of checks) {
            if (!k.quad) continue;
            const w = k.c.position.clone().addScaledVector(d, SKY_D).project(k.c);
            if (w.z < 1 && inQuad(w, k.quad)) return -1;
          }
          min = Math.min(min, d.angleTo(avoid));
        }
        return min;
      };
      // the smallest move (up, sideways or down, never under the horizon) that keeps the corona clear, at full size if it can, else
      // smaller. When none does, the place that keeps the row farthest from it
      let move: [number, number, number] = [0, 0, sh.s], most = -Infinity;
      search: for (const s of [1, 0.85, 0.7, 0.55].map((f) => f * sh.s)) for (let k = 0; k <= 40; k++) for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1], [0, -1], [1, -1], [-1, -1]] as const) {
        const m: [number, number, number] = [sx * 0.04 * k, sy * 0.03 * k, s], r = room(m[0], m[1], s);
        if (r > sh.clear) { move = m; break search; }
        if (r > most) { most = r; move = m; }
      }
      const dirs = picked.map((q) => dirOf(q, ...move));
      // the last line (line 37) is sung while the camera runs at the credit wall, which fills the middle of the picture: it splits, and
      // each of its two rows goes on its own to the place (of the cameras of the line, across, up and down, and the size) where it ends
      // best: a row may come into the picture late, but at the end of the line it shows whole, high in the sky (never down at the
      // houses), clear of the wall, the corona and the other row. A bigger row wins a tie
      if (index === lines.length - 1) {
        const end = camAt(t1), endY = 0.3;
        // how well stars show: each star from its syllable to the end of the row, at 8 times. A star shows when it is well inside the
        // picture (clear of the title bar) and clear of the wall by a margin (it may not touch the credit board or the wall's edge).
        // `late`: the share in the last three of those times, when the row should be whole
        const N_VIEW = 8, MARGIN = 0.05;
        const views = units.map((u) => Array.from({ length: N_VIEW }, (_, j) => {
          const c = camAt(u.start + ((tb - u.start) * j) / (N_VIEW - 1)), w = WALL_CORNERS.map((p) => p.clone().project(c));
          return { c, wall: w.every((p) => p.z < 1) ? w : null };
        }));
        const off = new THREE.Vector3();
        const seen = (qs: readonly (typeof picked)[number][], ds: readonly THREE.Vector3[]) => {
          const n = new Array<number>(N_VIEW).fill(0);
          qs.forEach((q, i) => views[q.u]!.forEach((v, j) => {
            const p = v.c.position.clone().addScaledVector(ds[i]!, SKY_D).project(v.c);
            if (p.z >= 1 || Math.abs(p.x) > 0.92 || Math.abs(p.y) > 0.88) return;
            if (v.wall && [[0, 0], [MARGIN, 0], [-MARGIN, 0], [0, MARGIN], [0, -MARGIN]].some(([dx, dy]) => inQuad(off.set(p.x + dx!, p.y + dy!, 0), v.wall!))) return;
            n[j]!++;
          }));
          const share = n.map((k) => k / qs.length);
          return { mean: share.reduce((a, b) => a + b, 0) / N_VIEW, late: share.slice(-3).reduce((a, b) => a + b, 0) / 3 };
        };
        const placed: { mid: THREE.Vector3; r: number }[] = [];
        for (const row of [0, 1]) {
          const ids = picked.flatMap((q, i) => (q.row === row ? [i] : [])), qs = ids.map((i) => picked[i]!);
          if (!qs.length) continue;
          let score = -Infinity, pick: THREE.Vector3[] = [];
          for (let k = 0; k <= 6; k++) {
            const c = camAt(t0 + ((t1 - t0) * k) / 6);
            for (const s of [1, 0.85, 0.7, 0.55]) for (let j = -4; j <= 4; j++) for (let i = -8; i <= 8; i++) {
              // the row at its own place: its first line of glyphs at ROW_Y[0] (the second row moves up into the place of the first)
              const ds = qs.map((q) => dirIn(c, { ...q, row: 0 }, 0.1 * i, 0.075 * j, s));
              if (ds.some((d) => d.y < 0.07 || d.angleTo(avoid) < ECL_CLEAR)) continue;
              if (ds.some((d) => end.position.clone().addScaledVector(d, SKY_D).project(end).y < endY)) continue;
              const mid = ds.reduce((a, d) => a.add(d), new THREE.Vector3()).normalize(), r = Math.max(...ds.map((d) => d.angleTo(mid)));
              if (placed.some((p) => mid.angleTo(p.mid) < p.r + r + 0.03)) continue;
              const v = seen(qs, ds), sc = v.late + 0.5 * v.mean + 0.02 * s;
              if (sc > score) { score = sc; pick = ds; }
            }
          }
          if (!pick.length) continue;
          ids.forEach((id, n) => (dirs[id] = pick[n]!));
          const mid = pick.reduce((a, d) => a.add(d), new THREE.Vector3()).normalize();
          placed.push({ mid, r: Math.max(...pick.map((d) => d.angleTo(mid))) });
        }
      }
      const stars = picked.map((q, i): Star => ({ u: q.u, dir: dirs[i]!, big: degree[i]! <= 1, seed: hashSin(i, q.u), at: 0 }));
      // on its syllable a glyph lights from the left
      units.forEach((u, k) => {
        const own = stars.flatMap((s, i) => (s.u === k ? [{ s, x: picked[i]!.x + 0.01 * i }] : [])).sort((a, b) => a.x - b.x);
        own.forEach(({ s }, i) => (s.at = u.start + i * STEP));
      });
      this.rows.push({ stars, links, starts: units.map((u) => u.start), ends: line.end, from: t0 });
    });
  }

  /**
   * Draws the rows into `l` at t. Every star is a direction of the sky dome (at infinity, as the eclipse is). `eye`: the place of the
   * camera. `place`: a world point to a pixel of the picture (null: behind the camera). `shown`: whether a star at a pixel shows (in the
   * picture, not under a window, not on the wall). A row goes out after its line: its stars fall out of the sky one after the other.
   */
  draw(l: TextLayer, t: number, eye: THREE.Vector3, place: (p: THREE.Vector3) => readonly [number, number] | null, shown: (x: number, y: number) => boolean) {
    for (const r of this.rows) {
      if (t < r.from - 0.1 || t > r.ends + 1.2) continue;
      const pos = r.stars.map((s): readonly [number, number] | null => {
        const out = r.ends + 0.25 + 0.8 * s.seed;
        if (t < s.at || t > out) return null;
        const p = place(this.p.copy(eye).addScaledVector(s.dir, SKY_D));
        return p && shown(p[0], p[1]) ? p : null;
      });
      // the links: each one draws itself from its first star
      for (const [i, j] of r.links) {
        const a = pos[i], b = pos[j];
        if (!a || !b) continue;
        const k = Math.min(1, (t - Math.max(r.stars[i]!.at, r.stars[j]!.at)) / LINK);
        if (k <= 0) continue;
        const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        for (let s = 1; s < n * k; s++) l.put(a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n, '#c4d4ff', 0.95);
      }
      // the stars: a point, a cross for the ends of the strokes. Each one flares as it comes on, and a little on its syllable
      r.stars.forEach((s, i) => {
        const p = pos[i];
        if (!p) return;
        const age = t - s.at, sung = t - r.starts[s.u]!;
        const flare = age < 2 / 36 ? 1 : Math.exp(-sung / 0.35) * 0.6;
        const c = flare > 0.5 ? '#ffffff' : '#e4ecff';
        l.put(p[0], p[1], c, 1);
        if (s.big || flare > 0.5) {
          const a = s.big ? 0.85 : 0.6;
          l.put(p[0] - 1, p[1], c, a); l.put(p[0] + 1, p[1], c, a); l.put(p[0], p[1] - 1, c, a); l.put(p[0], p[1] + 1, c, a);
        }
        if (flare > 0.5) { l.put(p[0] - 2, p[1], c, 0.5); l.put(p[0] + 2, p[1], c, 0.5); l.put(p[0], p[1] - 2, c, 0.5); l.put(p[0], p[1] + 2, c, 0.5); }
      });
    }
  }
}
