// The four lines of the bridge (treatment v9 "Plate 5", "Typography"): far off, as large as mountains, made of points of light.
// No letter is near the train, none is an extruded block, and none is a 2D box over the picture.
//   `FarLine`   lines 13 and 15: a dot-matrix row that stands in the sky more than a kilometre away, behind the ridges' tops. Each font pixel
//               is one light. The arp notes run through the row (the row is lit by the same notes as the pillars behind it).
//               Each line takes one thing from its subject:
//                 flower  the pixels open like a bloom from the middle of the glyph, in the colours of the flower walls. They do not
//                         wither: when the line ends they leave whole, as petals on the wind.
//                 ice     the pixels come in as streaks of wind and stop dead. Then they freeze: the colour goes cold and icicles
//                         grow down from the feet of the glyphs. A kick flashes them. When the line ends they break and fall.
//   `FlockLine` line 14: each glyph is a dense flock of birds, some for each font pixel, dark against the dusk. For each syllable a flock
//               comes in from the right of the row as one swirling body and sweeps left across its glyph. As it passes over a font pixel,
//               birds drop out of it into that pixel: the flock lays the glyph down from right to left, and its last birds land on the
//               left edge on the syllable. There they sleep: folded wings, a breath, a head that turns. When the line ends they do not
//               fly off: they sink and go dark.
//   `MoonRing`  line 16: the glyphs are burnt into the face of the moon disc, each at its own place. The disc turns under them, the
//               glyphs stay upright and whole. Each one is red hot when its syllable lands, then dark on the pale disc. The arp
//               notes heat them again.
// `pose(t)` writes the instances for time t: a pure function of t.
import * as THREE from 'three';
import type { Line } from '@pve/engine/lyrics';
import type { PixelFont } from '@pve/engine/type';
import { stepT, hashSin, smooth } from '@pve/engine/util';
import { col, instanced } from '@pve/engine/lit';
import { rayOf, since, type CamAt } from './_bridgelights';
import { T_DROP, T_WIND } from './_bridgepath';
import { writtenOf } from './_fonts';

/** `debug` is the plain row of verse 2 (line 21, under the map): pale, still, each glyph bright for 2 frames when it lands. It goes at once. */
export type FarKind = 'flower' | 'bird' | 'ice' | 'debug';

export interface FarLineSpec {
  line: Line;
  kind: FarKind;
  /** The middle of the row in the frame of the ride camera (-1..1 each way) at the middle of the line. */
  ndc: readonly [number, number];
  /** The size of one font pixel on the screen at that time, in px of the 640x360 frame. */
  px: number;
  /** How far off the row stands, m. */
  dist: number;
  /** The height of the picture of the ride window, px. */
  viewH: number;
  /** The time whose camera sets the place of the row. Default: the middle of the line. */
  at?: number;
}

interface Pix { u: number; x: number; y: number; r: number; foot: boolean; h: number }

const FLOWER = ['#ff3a2a', '#ff8a1a', '#ffd23a', '#ff5aa8', '#fff0c8'].map((c) => col(c));
/** The birds are dark against the dusk, as birds on a wire are. */
const BIRD = [col('#0c1430'), col('#1c2c58')];
const FLARE: Record<FarKind, THREE.Color> = { flower: col('#fff4c0'), bird: col('#5ad8ff'), ice: col('#ffffff'), debug: col('#ffffff') };
const DEBUG = col('#c8ccd8');
const WIND = col('#fff4dc'), ICE = col('#bfe6ff');
const CLEAR = 0.45;

/** The font pixels of the units of a line: `x` right and `y` up from the pen and the baseline of the row, in font px. */
function pixelsOf(font: PixelFont, line: Line): { pix: Pix[]; width: number; mids: number[] } {
  const units = writtenOf(line).units;
  const pix: Pix[] = [], mids: number[] = [];
  let pen = 0;
  units.forEach((unit, u) => {
    const x0 = pen, first = pix.length;
    for (const ch of unit.glyph) {
      const g = font.glyph(ch);
      for (let yy = 0; yy < g.h; yy++) for (let xx = 0; xx < g.w; xx++) {
        if (!g.bits[yy * g.w + xx]) continue;
        // the foot of a column: no ink under it (an icicle grows there)
        const foot = yy === g.h - 1 || !g.bits[(yy + 1) * g.w + xx];
        pix.push({ u, x: pen + g.x0 + xx, y: -(g.y0 + yy), r: 0, foot, h: hashSin(pix.length, u + 3) });
      }
      pen += g.adv;
    }
    const mx = (x0 + pen) / 2, my = font.size * 0.4;
    for (let i = first; i < pix.length; i++) pix[i]!.r = Math.hypot(pix[i]!.x - mx, pix[i]!.y - my);
    mids.push(mx);
    pen += 1;
  });
  return { pix, width: pen - 1, mids };
}

/** The lights of a line: one instance for each light, written anew on each frame from the scratch object `o` and colour `c`. */
abstract class LightRow {
  readonly mesh: THREE.InstancedMesh;
  protected readonly o = new THREE.Object3D();
  protected readonly c = new THREE.Color();

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, n: number) {
    this.mesh = instanced(geo, mat, n, { color: true });
    this.mesh.count = 0;
  }

  /** Writes instance n from `o` and `c`. */
  protected put(n: number) {
    this.o.updateMatrix();
    this.mesh.setMatrixAt(n, this.o.matrix);
    this.mesh.setColorAt(n, this.c);
  }

  /** Shows the first n instances. */
  protected commit(n: number) {
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Where a row stands in the sky: the left end of its baseline, its right axis, its turn and the size of one font pixel (m). */
interface RowPlace { origin: THREE.Vector3; right: THREE.Vector3; rot: THREE.Quaternion; s: number }

/** The row stands upright and faces the camera of the anchor time `tm`. Returns its place and that camera (a scratch object). */
function placeRow(font: PixelFont, spec: FarLineSpec, c: THREE.PerspectiveCamera, width: number): RowPlace {
  const s = spec.px * ((2 * spec.dist * Math.tan(THREE.MathUtils.degToRad(c.fov) / 2)) / spec.viewH);
  const centre = c.position.clone().addScaledVector(rayOf(c, spec.ndc[0], spec.ndc[1]), spec.dist);
  const right = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 0).setY(0).normalize();
  const origin = centre.clone().addScaledVector(right, (-width / 2) * s).add(new THREE.Vector3(0, -font.size * 0.4 * s, 0));
  const rot = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), right.clone().cross(new THREE.Vector3(0, 1, 0))));
  return { origin, right, rot, s };
}

/** The camera that sets the place of a row: the one of `spec.at`, else the one of the middle of the line. */
function anchorCam(spec: FarLineSpec, starts: readonly number[], cam: CamAt): THREE.PerspectiveCamera {
  return cam(spec.at ?? (starts[0]! + spec.line.end) / 2);
}

/** Moves `o` to font point (x, y) of the row. */
function toRow(o: THREE.Object3D, at: RowPlace, x: number, y: number) {
  o.position.copy(at.origin).addScaledVector(at.right, x * at.s);
  o.position.y += y * at.s;
}

/** The shape of one font pixel of a far row in a frame: its offset from its pixel (font px), its size and its light. */
interface Dot { x: number; y: number; sx: number; sy: number; lum: number }
/** The frame values that the shapes share: the 12 fps time and the kick flash. */
interface FarFrame { q: number; kick: number }
/** Shapes the dot of pixel `p` at its age and the time since the line ended (`gone` > 0), and sets its colour. False: not drawn. */
type FarShape = (d: Dot, p: Pix, age: number, gone: number, f: FarFrame, c: THREE.Color) => boolean;

const SHAPES: Record<FarKind, FarShape> = {
  flower(d, p, age, gone, _, c) {
    // the bloom opens from the middle of the glyph outwards, with a small overshoot
    const a = (age - p.r * 0.012) / 0.1;
    if (a <= 0) return false;
    const k = a < 1 ? smooth(a) * 1.35 : 1 + 0.35 * Math.exp(-(a - 1) * 3);
    d.sx = d.sy = 0.9 * k;
    c.copy(FLOWER[Math.floor(p.h * FLOWER.length)]!);
    if (gone > 0) {
      // petals on the wind: whole, never smaller, they only go
      const g = gone / CLEAR, w = 0.4 + p.h;
      d.x -= 40 * g * g * w;
      d.y += 6 * Math.sin(9 * g + 6.28 * p.h) * g + 5 * g * w;
      if (g > 0.55 + 0.45 * p.h) return false;
    }
    return true;
  },
  bird(d, p, age, gone, f, c) {
    // a short swoop from the upper right, each pixel on its own path, then it sits
    const a = 1 - smooth(age / (0.16 + 0.12 * p.h));
    d.x += a * (22 + 18 * p.h);
    d.y += a * a * (10 + 14 * hashSin(p.x, p.y));
    c.copy(BIRD[0]!).lerp(BIRD[1]!, p.h);
    d.lum = 1 + 0.25 * Math.sin(1.7 * f.q + 6.28 * hashSin(p.u, 1));
    if (gone > 0) {
      const g = smooth(gone / CLEAR);
      d.y -= 2.5 * g;
      d.sy *= 1 - g;
    }
    return true;
  },
  debug(d, _, age, gone, __, c) {
    if (gone > 0) return false;
    c.copy(DEBUG);
    d.lum = age < 2 / 36 ? 3 : 1.2;
    return true;
  },
  ice(d, p, age, gone, f, c) {
    // a streak of wind that stops dead, then freezes
    const a = 1 - smooth(age / 0.12);
    d.sx = 0.9 + 7 * a;
    d.x += 9 * a;
    const cold = smooth((age - 0.25) / 0.6);
    c.copy(WIND).lerp(ICE, cold);
    d.lum = 1.4 + 1.6 * f.kick;
    if (p.foot && p.h < 0.45) {
      const len = 4.5 * p.h * 2.2 * smooth((age - 0.5) / 2.2);
      d.sy += len;
      d.y -= len / 2;
    }
    if (gone > 0) {
      // the ice breaks: every piece falls, some sooner
      const g = Math.max(0, gone - 0.1 * p.h);
      d.y -= 160 * g * g;
      d.x += 30 * (p.h - 0.5) * g;
      d.lum *= 1 - smooth(gone / CLEAR);
    }
    return true;
  },
};

export class FarLine extends LightRow {
  private pix: Pix[];
  private starts: number[];
  private end: number;
  private width: number;
  private at: RowPlace;
  private dot: Dot = { x: 0, y: 0, sx: 0, sy: 0, lum: 0 };
  private frame: FarFrame = { q: 0, kick: 0 };

  constructor(font: PixelFont, private spec: FarLineSpec, cam: CamAt, private arps: readonly number[], private kicks: readonly number[]) {
    const { pix, width } = pixelsOf(font, spec.line);
    const starts = writtenOf(spec.line).units.map((u) => u.start);
    const at = placeRow(font, spec, anchorCam(spec, starts, cam), width);
    super(new THREE.BoxGeometry(1, 1, 0.4), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }), pix.length);
    this.pix = pix;
    this.width = width;
    this.starts = starts;
    this.end = spec.line.end;
    this.at = at;
  }

  pose(t: number) {
    const on = t >= this.starts[0]! && t < this.end + CLEAR;
    this.mesh.visible = on;
    if (!on) return;
    const { o, c, dot: d, frame: f } = this;
    const kind = this.spec.kind, shape = SHAPES[kind], flareC = FLARE[kind], s = this.at.s;
    const gone = t - this.end; // > 0: the line clears
    f.q = stepT(t, 12);
    // the last arp note runs through the row: the columns near its place flare
    const na = since(this.arps, t), flare = na < 0.25 ? Math.exp(-na / 0.09) : 0;
    const noteX = flare > 0 ? hashSin(Math.round((t - na) * 1000), 5) * this.width : 0;
    f.kick = kind === 'ice' ? Math.exp(-since(this.kicks, t) / 0.07) : 0;
    let n = 0;
    for (const p of this.pix) {
      const age = t - this.starts[p.u]!;
      if (age < 0) continue;
      d.x = p.x; d.y = p.y; d.sx = 0.9; d.sy = 0.9; d.lum = 1.9;
      if (!shape(d, p, age, gone, f, c)) continue;
      const fl = 1.6 * flare * Math.exp(-Math.abs(p.x - noteX) / 5);
      c.multiplyScalar(d.lum);
      c.r += fl * flareC.r; c.g += fl * flareC.g; c.b += fl * flareC.b;
      toRow(o, this.at, d.x, d.y);
      o.quaternion.copy(this.at.rot);
      o.scale.set(d.sx * s, d.sy * s, s);
      this.put(n++);
    }
    this.commit(n);
  }
}

/**
 * Birds for each font pixel; the flight of a flock from its gathering place to its glyph (s); the time it takes to lay the glyph down,
 * from the syllable on (s); the glide of a bird from the flock into its pixel (s); the size of a bird in font pixels.
 */
const FLOCK_PER_PX = 3, FLOCK_FLY = 1.6, FLOCK_LAY = 0.25, FLOCK_DROP = 0.2, FLOCK_SIZE = 0.9;
/** The birds of a flock come in one by one from all round the frame over this time (s) before the flock sets off; and where the flock gathers, right of and over its glyph (font px). */
const FLOCK_GATHER = 0.9, GATHER_DX = 60, GATHER_DY = 14;
/** The birds that the stop of the wind holds in the air hang there until the train falls (T_DROP), then fly off for this long (s). */
const FLOCK_OFF = 2.2;
/** The rate of the boid bake (Hz). */
const BOID_HZ = 72;
/** The boids (font px, s): neighbour radius, personal space, the weights of cohesion, alignment, separation and the leader, the speeds. */
const BOID_IN = { r: 9, sep: 2.6, coh: 2, ali: 3.5, avoid: 60, lead: 4.5, vMin: 30, vMax: 230 };
const BOID_OUT = { r: 11, sep: 2.0, coh: 1.6, ali: 3, avoid: 45, lead: 0, vMin: 30, vMax: 230 };
const BOID_STREAM = { r: 8, sep: 2.2, coh: 1.2, ali: 3, avoid: 50, lead: 6, vMin: 40, vMax: 220 };
/** More birds in each glyph flock that do not land (escorts); the birds of each stream, their speed (font px/s), and the stream birds that join each glyph flock. */
const FLOCK_ESCORT = 40, STREAM_BIRDS = 200, STREAM_V = 95, STREAM_JOIN = 16;
/** The streams of birds that cross the sky through the line: the way (-1 right to left), the height over the baseline and the size of the wave (font px). */
const STREAMS = [{ dir: -1, y: 26, amp: 8 }, { dir: 1, y: -22, amp: 5 }, { dir: -1, y: 52, amp: 12 }] as const;

type BoidRules = typeof BOID_IN;
/** A goal of a boid: the place and the velocity it heads for (font px, font px/s). */
type BoidGoal = (i: number) => [number, number, number, number];
/**
 * `kind`: 0 a bird of glyph `u`; 1 an escort of the flock of glyph `u` (it does not land, then it joins stream 0); 2 a bird of stream
 * `s` (`off`: its place along the stream, 0..1); 3 a bird of stream 0 that leaves it at `join` for the flock of glyph `u`, then goes
 * back to the stream with the escorts.
 */
interface Bird { kind: 0 | 1 | 2 | 3; u: number; s: number; off: number; join: number; x: number; y: number; h: number; ph: number; drop: number; wake: number }
/** The state of the boid bake: places and velocities (x, y for each bird), the bird states, the last stream place, the drop places. */
interface BoidSim { P: Float32Array; V: Float32Array; state: Uint8Array; lastF: Float32Array; dropP: Float32Array }

/** One step of the boids of `list` (they see only each other): each keeps its space, matches its neighbours, closes on them and follows its goal. */
function boidStep(P: Float32Array, V: Float32Array, dt: number, list: number[], o: BoidRules, goal: BoidGoal) {
  for (const i of list) {
    const px = P[i * 2]!, py = P[i * 2 + 1]!, vx = V[i * 2]!, vy = V[i * 2 + 1]!;
    let cx = 0, cy = 0, ax = 0, ay = 0, sx = 0, sy = 0, n = 0;
    for (const j of list) {
      if (j === i) continue;
      const dx = P[j * 2]! - px, dy = P[j * 2 + 1]! - py, d2 = dx * dx + dy * dy;
      if (d2 > o.r * o.r) continue;
      cx += dx; cy += dy; ax += V[j * 2]!; ay += V[j * 2 + 1]!; n++;
      if (d2 < o.sep * o.sep && d2 > 1e-6) { sx -= dx / d2; sy -= dy / d2; }
    }
    const [gx, gy, gvx, gvy] = goal(i);
    let fx = o.avoid * sx + o.lead * (gx - px) + 2 * (gvx - vx), fy = o.avoid * sy + o.lead * (gy - py) + 2 * (gvy - vy);
    if (n) { fx += o.coh * (cx / n) + o.ali * (ax / n - vx); fy += o.coh * (cy / n) + o.ali * (ay / n - vy); }
    let nvx = vx + fx * dt, nvy = vy + fy * dt;
    const sp = Math.hypot(nvx, nvy), cl = Math.min(o.vMax, Math.max(o.vMin, sp)) / Math.max(sp, 1e-6);
    nvx *= cl; nvy *= cl;
    V[i * 2] = nvx; V[i * 2 + 1] = nvy;
  }
  for (const i of list) { P[i * 2] = P[i * 2]! + V[i * 2]! * dt; P[i * 2 + 1] = P[i * 2 + 1]! + V[i * 2 + 1]! * dt; }
}

/** A bird seen from behind: two wings and a body, flat, in the plane of the row. The nose is +y. */
function birdGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0.45, 0, -1, 0.15, 0, -0.3, -0.35, 0,
    0, 0.45, 0, 0.3, -0.35, 0, 1, 0.15, 0,
    0, 0.7, 0, -0.3, -0.35, 0, 0.3, -0.35, 0,
    -0.3, -0.35, 0, 0, -0.7, 0, 0.3, -0.35, 0,
  ], 3));
  return g;
}

export class FlockLine extends LightRow {
  private birds: Bird[] = [];
  private starts: number[];
  private end: number;
  /** For each unit: the left and right edge of its glyph and the middle height, in font px. */
  private glyph: { x0: number; x1: number; y: number }[] = [];
  /** Where every flock comes in: right of the whole row, in font px. */
  private enterX: number;
  /** The boid bake: x, y of each bird at each step from `b0`; and where each bird left the flock to glide to its pixel. Set by useBake. */
  private b0: number;
  private bSteps: number;
  private bData: Float32Array = new Float32Array(0);
  private dropP: Float32Array = new Float32Array(0);
  /** Where and when each bird of a glyph flock (and each escort) comes into the sky: x, y, time. */
  private spawn: Float32Array;
  private at: RowPlace;
  private q = new THREE.Quaternion();
  private zAxis = new THREE.Vector3(0, 0, 1);

  constructor(font: PixelFont, spec: FarLineSpec, cam: CamAt) {
    const { pix, width } = pixelsOf(font, spec.line);
    const starts = writtenOf(spec.line).units.map((u) => u.start);
    const c = anchorCam(spec, starts, cam);
    const at = placeRow(font, spec, c, width);
    // (the boid bake is slow: the scene memoizes `bake()` and hands it in with useBake before the first frame)
    super(birdGeometry(), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false, side: THREE.DoubleSide }), pix.length * FLOCK_PER_PX + starts.length * FLOCK_ESCORT + STREAMS.length * STREAM_BIRDS);
    this.starts = starts;
    this.end = spec.line.end;
    this.at = at;
    this.enterX = width + 40;
    this.addBirds(pix, font.size * 0.4);
    this.spawn = this.planSpawn(spec, c.aspect, width, font.size * 0.4);
    // the starts are in order: the first flock gathers first
    this.b0 = this.leaveAt(0) - FLOCK_GATHER - 0.05;
    this.bSteps = Math.ceil((T_WIND - this.b0) * BOID_HZ) + 2;
  }

  /** The birds of the glyphs (`mid`: the middle height of a glyph), the escorts, the streams and the stream birds that visit the flocks. */
  private addBirds(pix: Pix[], mid: number) {
    for (const p of pix) for (let k = 0; k < FLOCK_PER_PX; k++) {
      const n = this.birds.length;
      this.birds.push({ kind: 0, u: p.u, s: 0, off: 0, join: Infinity, x: p.x + 0.5 * (hashSin(n, 1) - 0.5), y: p.y + 0.5 * (hashSin(n, 2) - 0.5), h: hashSin(n, 3), ph: 6.28 * hashSin(n, 4), drop: 0, wake: 0 });
    }
    this.starts.forEach((_, u) => {
      const xs = pix.filter((p) => p.u === u).map((p) => p.x);
      this.glyph.push({ x0: Math.min(...xs), x1: Math.max(...xs) + 1, y: mid });
    });
    for (const b of this.birds) {
      b.drop = this.dropAt(b.u, b.x);
      // the line has ended: they wake one after another, a wave from the right
      b.wake = this.end + 0.35 * (1 - b.x / this.enterX) + 0.12 * b.h;
    }
    // the escorts: more birds in each flock that do not land. When the glyph is down they fly on and join the stream over the row
    this.starts.forEach((_, u) => {
      for (let k = 0; k < FLOCK_ESCORT; k++) {
        const n = this.birds.length;
        this.birds.push({ kind: 1, u, s: 0, off: 0, join: Infinity, x: 0, y: 0, h: hashSin(n, 3), ph: 6.28 * hashSin(n, 4), drop: Infinity, wake: this.overAt(u) + FLOCK_LAY + 0.1 * hashSin(n, 5) });
      }
    });
    // the streams: a river of birds over the row (right to left) and a thinner one under it (left to right), through the whole line.
    // Some birds of the upper one leave it for the flock of each glyph a moment before the flock reaches its glyph
    STREAMS.forEach((_, si) => {
      for (let k = 0; k < STREAM_BIRDS; k++) {
        const n = this.birds.length;
        this.birds.push({ kind: 2, u: -1, s: si, off: k / STREAM_BIRDS + (0.6 * (hashSin(n, 7) - 0.5)) / STREAM_BIRDS, join: Infinity, x: 0, y: 0, h: hashSin(n, 3), ph: 6.28 * hashSin(n, 4), drop: Infinity, wake: Infinity });
      }
    });
    const upper = this.birds.filter((b) => b.kind === 2 && b.s === 0);
    this.starts.forEach((_, u) => {
      for (let j = 0; j < STREAM_JOIN; j++) {
        const b = upper[(u * STREAM_JOIN * 7 + j * 11) % upper.length]!;
        if (b.kind !== 2) continue;
        b.kind = 3; b.u = u; b.join = this.overAt(u) - 0.55; b.wake = this.overAt(u) + FLOCK_LAY + 0.1 * b.h;
      }
    });
  }

  /**
   * The birds of the glyph flocks and the escorts come in one by one, spread out: from past the right edge of the frame, from over
   * its top and from under its bottom, at different times. They find each other at the gathering place of their flock.
   */
  private planSpawn(spec: FarLineSpec, aspect: number, width: number, mid: number): Float32Array {
    const fw = (spec.viewH * aspect) / spec.px, fh = spec.viewH / spec.px;
    const fx = width / 2 - (spec.ndc[0] * fw) / 2, fy = mid - (spec.ndc[1] * fh) / 2;
    const fr = { x0: fx - fw / 2, x1: fx + fw / 2, y0: fy - fh / 2, y1: fy + fh / 2 };
    const spawn = new Float32Array(this.birds.length * 3);
    this.birds.forEach((b, i) => {
      if (b.kind > 1) return;
      const side = hashSin(i, 21), a = hashSin(i, 22), e = hashSin(i, 23);
      const [x, y] = side < 0.55 ? [fr.x1 + 10 + 120 * e, fr.y0 + (fr.y1 - fr.y0 + 60) * a]
        : side < 0.88 ? [fx + (fr.x1 + 100 - fx) * a, fr.y1 + 10 + 60 * e]
        : [fx + (fr.x1 + 100 - fx) * a, fr.y0 - 10 - 40 * e];
      spawn[i * 3] = x; spawn[i * 3 + 1] = y; spawn[i * 3 + 2] = this.leaveAt(b.u) - FLOCK_GATHER * hashSin(i, 24);
    });
    return spawn;
  }

  /** The flock of unit u is over the right edge of its glyph here, so that the first bird lands on the syllable. */
  private overAt(u: number): number { return this.starts[u]! - FLOCK_DROP; }
  /** The flock of unit u sets off from its gathering place here. */
  private leaveAt(u: number): number { return this.overAt(u) - FLOCK_FLY; }

  /**
   * The middle of the flock of unit u at time t (font px). Before `leaveAt` it turns slowly at its gathering place, right of and over its
   * glyph, while its birds come in. Then it drifts down to the right edge of its glyph and is there at `overAt`; then it goes over the
   * glyph in FLOCK_LAY, laying it down, and on past its left edge.
   */
  private flockAt(u: number, t: number): { x: number; y: number; vx: number; vy: number } {
    const g = this.glyph[u]!, t1 = this.overAt(u), t0 = t1 - FLOCK_FLY;
    if (t < t0) {
      // a slow turn round the gathering place
      const a = 2.4 * (t - t0);
      return { x: g.x1 + GATHER_DX + 10 * Math.sin(a), y: g.y + GATHER_DY + 6 * Math.sin(2 * a), vx: 24 * Math.cos(a), vy: 28.8 * Math.cos(2 * a) };
    }
    if (t < t1) {
      const tau = (t - t0) / FLOCK_FLY, k = 1 - tau;
      const x = g.x1 + GATHER_DX * k, vx = -GATHER_DX / FLOCK_FLY;
      const w = 2 * Math.PI * 1.5 * tau;
      const y = g.y + GATHER_DY * k + 6 * Math.sin(w) * k;
      const vy = (-GATHER_DY + 6 * (2 * Math.PI * 1.5 * Math.cos(w) * k - Math.sin(w))) / FLOCK_FLY;
      return { x, y, vx, vy };
    }
    const vx = (g.x0 - 3 - g.x1) / FLOCK_LAY;
    return { x: g.x1 + vx * (t - t1), y: g.y, vx, vy: 0 };
  }

  /** The time at which the flock of unit u is over the font column x: the bird of that column drops out of it then. */
  private dropAt(u: number, x: number): number {
    const g = this.glyph[u]!;
    return this.overAt(u) + FLOCK_LAY * THREE.MathUtils.clamp((g.x1 - x) / (g.x1 - g.x0 + 3), 0, 1);
  }

  /** Stream bird b at time t (font px): its place on the stream, its velocity, and how far along the stream it is (0..1). */
  private streamAt(b: { s: number; off: number }, t: number): [number, number, number, number, number] {
    const S = STREAMS[b.s]!, L = this.enterX + 240, f = (((t - this.b0) * STREAM_V) / L + b.off) % 1;
    const x = S.dir < 0 ? this.enterX + 120 - f * L : -120 + f * L, vx = S.dir * STREAM_V;
    const a = 0.05 * x + 1.6 * t + 2 * b.s;
    return [x, S.y + S.amp * Math.sin(a), vx, S.amp * (0.05 * vx + 1.6) * Math.cos(a), f];
  }

  /**
   * Bakes the boids once. A flock is the birds of one glyph, its escorts and the birds that come over to it from the stream: they fly as
   * boids (each keeps its space, matches the heading of its neighbours and closes on them) and follow the leader path `flockAt` as a
   * body. A bird leaves its flock when the flock is over its pixel (`pose` glides it in); the escorts and the visitors fly on and join
   * the stream over the row. The birds of a stream follow it as boids, so it is a river that moves, not a line. When the line has ended
   * the birds of the glyphs take off from their pixels as boids again and scatter up and out away from the row.
   * A pure function of the row: hand the result to useBake.
   */
  bake(): { bData: Float32Array; dropP: Float32Array } {
    const B = this.birds, N = B.length, dt = 1 / BOID_HZ;
    const bData = new Float32Array(this.bSteps * N * 2);
    const sim: BoidSim = { P: new Float32Array(N * 2), V: new Float32Array(N * 2), state: new Uint8Array(N), lastF: new Float32Array(N), dropP: new Float32Array(N * 2) };
    const { P, V, state } = sim;
    const goals = this.goals(P);
    // states: 0 not yet, 1 in a glyph flock, 2 on its pixel, 3 off (after the line), 4 in a stream
    for (let k = 0; k < this.bSteps; k++) {
      const t = this.b0 + k * dt;
      bData.set(P, k * N * 2);
      const flying: number[][] = this.glyph.map(() => []), streams: number[][] = STREAMS.map(() => []), away: number[] = [];
      B.forEach((b, i) => {
        this.advance(sim, b, i, t);
        if (state[i] === 1) flying[b.u]!.push(i);
        else if (state[i] === 4) streams[b.kind === 2 ? b.s : 0]!.push(i);
        else if (state[i] === 3) away.push(i);
      });
      for (const list of flying) if (list.length) boidStep(P, V, dt, list, BOID_IN, goals.inGoal(t));
      for (const list of streams) if (list.length) boidStep(P, V, dt, list, BOID_STREAM, goals.streamGoal(t));
      if (away.length) boidStep(P, V, dt, away, BOID_OUT, goals.outGoal);
    }
    return { bData, dropP: sim.dropP };
  }

  /** The goals of the boids: in a glyph flock, in a stream, and out (after the line). */
  private goals(P: Float32Array) {
    const B = this.birds, mid = this.enterX / 2;
    const inGoal = (t: number): BoidGoal => (i) => { const f = this.flockAt(B[i]!.u, t); return [f.x, f.y, f.vx, f.vy]; };
    // in a stream: a bird of the stream follows its own place on it; a bird that comes from a glyph flock heads for the stream a little
    // ahead of it, and flies with it
    const streamGoal = (t: number): BoidGoal => (i) => {
      const b = B[i]!;
      if (b.kind === 2 || t < b.join) { const [x, y, vx, vy] = this.streamAt(b, t); return [x, y, vx, vy]; }
      const S = STREAMS[0]!, x = P[i * 2]! - 20, a = 0.05 * x + 1.6 * t;
      return [x, S.y + S.amp * Math.sin(a), S.dir * STREAM_V, S.amp * 0.05 * S.dir * STREAM_V * Math.cos(a)];
    };
    // out: up and away from the middle of the row, faster and faster
    const outGoal: BoidGoal = (i) => {
      const b = B[i]!, side = P[i * 2]! < mid ? -1 : 1;
      return [P[i * 2]!, P[i * 2 + 1]!, side * 70 * (0.4 + b.h), 120 + 60 * hashSin(b.ph, 9)];
    };
    return { inGoal, streamGoal, outGoal };
  }

  /** The state change of bird i at bake time t: into the sky, onto its pixel, off it, into or out of a stream. */
  private advance(sim: BoidSim, b: Bird, i: number, t: number) {
    const { P, V, state, lastF, dropP } = sim;
    if (b.kind >= 2 && t < b.join) {
      // a bird of a stream: it starts on its place; when it comes round the end of the stream it starts again at the other end
      const [x, y, vx, vy, f] = this.streamAt(b, t);
      if (state[i] === 0 || f < lastF[i]!) { P[i * 2] = x; P[i * 2 + 1] = y; V[i * 2] = vx; V[i * 2 + 1] = vy; }
      lastF[i] = f;
      state[i] = 4;
    }
    if (b.kind === 3 && state[i] === 4 && t >= b.join && t < b.wake) state[i] = 1;
    if (state[i] === 0 && b.kind <= 1 && t >= this.spawn[i * 3 + 2]!) {
      // a bird of a flock comes into the sky on its own, heading for the gathering place of its flock
      const sx = this.spawn[i * 3]!, sy = this.spawn[i * 3 + 1]!, f = this.flockAt(b.u, t);
      const dx = f.x - sx, dy = f.y - sy, d = Math.max(1, Math.hypot(dx, dy)), v = 90 + 70 * hashSin(i, 13), sw = 0.5 * (hashSin(i, 14) - 0.5);
      P[i * 2] = sx; P[i * 2 + 1] = sy;
      V[i * 2] = v * (dx / d - sw * dy / d); V[i * 2 + 1] = v * (dy / d + sw * dx / d);
      state[i] = 1;
    }
    if (state[i] === 1 && t >= b.drop) {
      dropP[i * 2] = P[i * 2]!; dropP[i * 2 + 1] = P[i * 2 + 1]!;
      P[i * 2] = b.x; P[i * 2 + 1] = b.y; V[i * 2] = 0; V[i * 2 + 1] = 0;
      state[i] = 2;
    }
    if (state[i] === 2 && t >= b.wake) {
      // the take-off: a jump up off the pixel
      V[i * 2] = 30 * (hashSin(i, 14) - 0.5); V[i * 2 + 1] = 40 + 30 * hashSin(i, 15);
      state[i] = 3;
    }
    // an escort or a visitor: when the glyph is down it leaves the flock for the stream over the row
    if (state[i] === 1 && (b.kind === 1 || b.kind === 3) && t >= b.wake) state[i] = 4;
  }

  useBake(b: { bData: Float32Array; dropP: Float32Array }) {
    this.bData = b.bData;
    this.dropP = b.dropP;
  }

  /** The baked boid place of bird i at time t, and its velocity (font px, font px/s). */
  private boid(i: number, t: number): [number, number, number, number] {
    const N = this.birds.length, f = (t - this.b0) * BOID_HZ;
    const k0 = Math.max(0, Math.min(this.bSteps - 2, Math.floor(f))), u = Math.max(0, Math.min(1, f - k0));
    const a = (k0 * N + i) * 2, b = ((k0 + 1) * N + i) * 2, D = this.bData;
    const vx = (D[b]! - D[a]!) * BOID_HZ, vy = (D[b + 1]! - D[a + 1]!) * BOID_HZ;
    return [D[a]! + (D[b]! - D[a]!) * u, D[a + 1]! + (D[b + 1]! - D[a + 1]!) * u, vx, vy];
  }

  pose(t: number) {
    const on = t >= this.leaveAt(0) - 0.1 && t < T_DROP + FLOCK_OFF;
    this.mesh.visible = on;
    if (!on) return;
    const { o, c } = this, s = this.at.s;
    // the flight off is held where it is when the wind stops (`sv_wind 0`). When the train falls the game runs again: each bird
    // flies off on its own line, no longer a boid
    const tf = Math.min(t, T_WIND), off = t - T_DROP;
    const q12 = stepT(t, 12);
    let n = 0;
    this.birds.forEach((b, i) => {
      const leave = b.kind >= 2 ? this.b0 : this.spawn[i * 3 + 2]!;
      if (t < leave) return;
      // a bird of a stream is not drawn at the ends of its stream, where it starts again
      if ((b.kind === 2 || (b.kind === 3 && tf < b.join)) && Math.abs(this.streamAt(b, tf)[4] - 0.5) > 0.47) return;
      let x = b.x, y = b.y, ang = 0, sx = 1, sy = 1, lum = 1;
      if (t < b.drop) {
        // a boid (an escort, a visitor or a bird of a stream is one to the end, held when the wind stops)
        const [bx, by, vx, vy] = this.boid(i, tf);
        x = bx; y = by;
        ang = Math.atan2(vy, vx) - Math.PI / 2;
        sy = 0.35 + 0.65 * Math.abs(Math.sin(16 * tf + b.ph));
        // the streams come into the picture as the first glyph flock does: the birds grow from nothing
        const grow = b.kind >= 2 ? smooth((t - this.b0) / 0.4) : 1;
        sx = 1.25 * grow;
        sy *= grow;
        lum = 1;
      } else if (t < b.drop + FLOCK_DROP) {
        // out of the flock into its pixel: a glide that ends on the pixel, the wings fold
        const k = smooth((t - b.drop) / FLOCK_DROP), dx = this.dropP[i * 2]!, dy = this.dropP[i * 2 + 1]!;
        x = dx + (b.x - dx) * k;
        y = dy + (b.y - dy) * k;
        ang = Math.atan2(b.y - dy, b.x - dx) - Math.PI / 2;
        sy = 0.35 + 0.65 * Math.abs(Math.sin(16 * t + b.ph));
        sx = 1.25 - 0.5 * k;
      } else if (tf < b.wake) {
        // asleep: the wings are folded, the body breathes, now and then a head turns
        sx = 0.75;
        sy = 0.9 + 0.08 * Math.sin(1.7 * q12 + b.ph);
        ang = hashSin(Math.floor(q12 * 1.5), n) < 0.04 ? 0.5 * (b.h - 0.5) : 0.12 * (b.h - 0.5);
      } else {
        // off: a boid again, the wings beat hard
        const [bx, by, vx, vy] = this.boid(i, tf);
        x = bx; y = by;
        ang = Math.atan2(vy, vx) - Math.PI / 2;
        sx = 1.25;
        sy = 0.35 + 0.65 * Math.abs(Math.sin(22 * tf + b.ph));
        lum = 1;
      }
      if (off > 0) {
        // along the heading it was held in (a bird that sat goes up), a little turned, faster and faster
        const h = ang + Math.PI / 2 + 0.7 * (hashSin(i, 31) - 0.5), d = (40 + 60 * b.h) * off + 150 * off * off;
        x += Math.cos(h) * d;
        y += Math.sin(h) * d;
        ang = h - Math.PI / 2;
        sx = 1.25;
        sy = 0.35 + 0.65 * Math.abs(Math.sin(22 * t + b.ph));
      }
      c.copy(BIRD[0]!).lerp(BIRD[1]!, b.h).multiplyScalar(lum);
      toRow(o, this.at, x, y);
      o.quaternion.copy(this.at.rot).multiply(this.q.setFromAxisAngle(this.zAxis, ang));
      o.scale.set(sx * FLOCK_SIZE * s, Math.max(0.0001, sy * FLOCK_SIZE * s), s);
      this.put(n++);
    });
    this.commit(n);
  }
}

export interface MoonRingSpec {
  line: Line;
  /** The radius of the disc, m. */
  radius: number;
  /** The place of each unit of the line on the disc (x right, y up, in disc radii) and the height of its glyph, m. */
  places: readonly { x: number; y: number; size: number }[];
  /** The time at which each glyph lands (s): the syllable starts, or the time it is heard where the calibration differs. */
  starts: readonly number[];
}

/** The places of `n` glyphs on an arc round (cx, cy) of radius r (disc radii), from angle `from` to angle `to` (degrees, 90 is up, 180 is left). */
export function arcPlaces(n: number, cx: number, cy: number, r: number, from: number, to: number, size: number): { x: number; y: number; size: number }[] {
  return Array.from({ length: n }, (_, k) => {
    const a = THREE.MathUtils.degToRad(n > 1 ? from + ((to - from) * k) / (n - 1) : from);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), size };
  });
}

const HOT = new THREE.Color(4.2, 0.5, 0.35), EMBER = new THREE.Color(1.5, 0.12, 0.1), INK = col('#2a0612');

/** Add `mesh` to the frame of the moon that does not turn (x right, y up, z to the train). */
export class MoonRing extends LightRow {
  private pix: Pix[];
  private mids: number[];
  private starts: number[];
  private half: number;

  constructor(private font: PixelFont, private spec: MoonRingSpec, private arps: readonly number[]) {
    const { pix, mids } = pixelsOf(font, spec.line);
    const units = writtenOf(spec.line).units.length;
    if (spec.places.length !== spec.starts.length || spec.starts.length !== units) throw new Error(`sardine: the moon line has ${units} units, ${spec.places.length} places and ${spec.starts.length} times`);
    super(new THREE.BoxGeometry(1, 1, 0.3), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }), pix.length);
    this.pix = pix;
    this.mids = mids;
    this.starts = [...spec.starts];
    this.half = font.size * 0.4;
    this.mesh.position.z = 0.62;
  }

  pose(t: number) {
    const on = t >= this.starts[0]!;
    this.mesh.visible = on;
    if (!on) return;
    const { o, c } = this;
    // the last arp note heats one glyph again
    const na = since(this.arps, t);
    const heatU = Math.floor(hashSin(Math.round((t - na) * 1000), 9) * this.starts.length), heat = na < 0.3 ? Math.exp(-na / 0.1) : 0;
    let n = 0, u = -1, cx = 0, cy = 0, age = 0, s = 1;
    for (const p of this.pix) {
      if (p.u !== u) {
        u = p.u;
        age = t - this.starts[u]!;
        const at = this.spec.places[u]!;
        cx = at.x * this.spec.radius;
        cy = at.y * this.spec.radius;
        s = at.size / this.font.size;
      }
      if (age < 0) continue;
      // the read light burns the glyph in: white-red for 3 frames, an ember for a second, then dark
      c.copy(INK).lerp(EMBER, Math.exp(-age / 0.9)).lerp(HOT, Math.max(1 - smooth(age / (3 / 36)), u === heatU ? 0.3 * heat : 0));
      o.position.set(cx + (p.x - this.mids[u]!) * s, cy + (p.y - this.half) * s, 0);
      o.scale.set(s, s, 1);
      this.put(n++);
    }
    this.commit(n);
  }
}
