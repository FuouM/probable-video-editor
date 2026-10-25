import * as THREE from 'three';
import { FSPass, makeRT } from '@pve/engine/gl';

// The Life under the plates:
// - the plane: a toroidal board per scene (its own seed) of perpetual machinery. Glider guns fire
//   streams into eaters, queen bee shuttles and oscillators tick in the gaps. Every part is periodic and
//   isolated from the others, so a board runs for a whole scene without dying into ash or exploding.
// Pure data: no DOM, testable on the CPU.

export const MACHINE_W = 640;
export const MACHINE_H = 360;
/** Generations run before the first frame of a scene, so the gun streams are already full. */
export const MACHINE_WARM = 240;

type Pat = string[];
const GUN: Pat = [
  '........................O...........',
  '......................O.O...........',
  '............OO......OO............OO',
  '...........O...O....OO............OO',
  'OO........O.....O...OO..............',
  'OO........O...O.OO....O.O...........',
  '..........O.....O.......O...........',
  '...........O...O....................',
  '............OO......................',
];
const EATER: Pat = ['OO..', 'O.O.', '..O.', '..OO'];
const LWSS: Pat = ['.O..O', 'O....', 'O...O', 'OOOO.'];
const MWSS: Pat = ['...O..', '.O...O', 'O.....', 'O....O', 'OOOOO.'];
const HWSS: Pat = ['...OO..', '.O....O', 'O......', 'O.....O', 'OOOOOO.'];
const PULSAR: Pat = [
  '..OOO...OOO..', '.............', 'O....O.O....O', 'O....O.O....O', 'O....O.O....O', '..OOO...OOO..',
  '.............', '..OOO...OOO..', 'O....O.O....O', 'O....O.O....O', 'O....O.O....O', '.............',
  '..OOO...OOO..',
];
const PENTA: Pat = ['..O....O..', 'OO.OOOO.OO', '..O....O..'];
const BLINKER: Pat = ['OOO'];
const TOAD: Pat = ['.OOO', 'OOO.'];
const BEACON: Pat = ['OO..', 'OO..', '..OO', '..OO'];
/** Queen bee shuttle held by two blocks (period 30). */
const QBS: Pat = [
  '.........O............', '.......O.O............', '......O.O.............', 'OO...O..O...........OO',
  'OO....O.O...........OO', '.......O.O............', '.........O............',
];
/** Loafer: c/7 orthogonal ship, moves left. */
const LOAFER: Pat = ['.OO..O.OO', 'O..O..OO.', '.O.O.....', '..O......', '........O', '......OOO', '.....O...', '......O..', '.......OO'];

type Cell = [number, number];
function cellsOf(p: Pat): Cell[] {
  const r: Cell[] = [];
  p.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === 'O') r.push([x, y]); });
  return r;
}
/** The 8 symmetries of the square; index 0 is identity. */
const SYM: ((c: Cell) => Cell)[] = [
  ([x, y]) => [x, y], ([x, y]) => [-x, y], ([x, y]) => [x, -y], ([x, y]) => [-x, -y],
  ([x, y]) => [y, x], ([x, y]) => [-y, x], ([x, y]) => [y, -x], ([x, y]) => [-y, -x],
];
/** Transform cells and move their bounding box to (ox, oy). */
function place(board: Uint8Array, cs: Cell[], sym: number, ox: number, oy: number) {
  const t = cs.map(SYM[sym]!);
  let mx = Infinity, my = Infinity;
  for (const [x, y] of t) { mx = Math.min(mx, x); my = Math.min(my, y); }
  for (const [x, y] of t) {
    const px = (((x - mx + ox) % MACHINE_W) + MACHINE_W) % MACHINE_W;
    const py = (((y - my + oy) % MACHINE_H) + MACHINE_H) % MACHINE_H;
    board[py * MACHINE_W + px] = 1;
  }
}
/** A Gosper gun whose stream of gliders runs `k` extra cells before an eater takes it (period 30). */
function gunUnit(k: number): Cell[] {
  return [...cellsOf(GUN), ...cellsOf(EATER).map(([x, y]): Cell => [x + 57 + k, y + 43 + k])];
}

function rnd(a: number, b: number) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Slots of the plane: 8 x 4 cells of 80 x 90, each holds one part or nothing. */
export const SLOT_W = 80;
export const SLOT_H = 90;

export interface PlaneOpts {
  /** 0..1: share of slots that hold a gun unit (the rest: oscillators or empty) */
  guns?: number;
  /** 0..1: share of the remaining slots that hold an oscillator */
  osc?: number;
}

/**
 * A scene's plane board (generation 0), deterministic in `seed`. Every slot holds at most one isolated
 * part: a gun unit (in any of the 8 orientations, its eater inside the slot) or an oscillator.
 */
export function planeSeed(seed: number, o: PlaneOpts = {}): Uint8Array {
  const b = new Uint8Array(MACHINE_W * MACHINE_H);
  const guns = o.guns ?? 0.35, osc = o.osc ?? 0.5;
  const oscs: Pat[] = [PULSAR, PENTA, QBS, BLINKER, TOAD, BEACON];
  const cols = MACHINE_W / SLOT_W, rows = MACHINE_H / SLOT_H;
  for (let sy = 0; sy < rows; sy++) for (let sx = 0; sx < cols; sx++) {
    const id = sy * cols + sx;
    const r = rnd(seed, id * 3);
    const x0 = sx * SLOT_W + 3, y0 = sy * SLOT_H + 3;
    if (r < guns) {
      const k = 2 + Math.floor(rnd(seed, id * 3 + 1) * 8); // the unit is (65 + k) square at most
      const sym = Math.floor(rnd(seed, id * 3 + 2) * 8);
      place(b, gunUnit(k), sym, x0, y0);
    } else if (rnd(seed, id * 3 + 1) < osc) {
      const p = oscs[Math.floor(rnd(seed, id * 3 + 2) * oscs.length)]!;
      const ox = x0 + Math.floor(rnd(seed, id * 7) * (SLOT_W - 30));
      const oy = y0 + Math.floor(rnd(seed, id * 11) * (SLOT_H - 20));
      place(b, cellsOf(p), Math.floor(rnd(seed, id * 13) * 4) * 2 % 8, ox, oy);
    }
  }
  return b;
}

/** One toroidal Life step on the CPU (tests and offline checks; the video steps on the GPU). */
export function stepTorus(a: Uint8Array, n: Uint8Array, w = MACHINE_W, h = MACHINE_H) {
  for (let y = 0; y < h; y++) {
    const ym = ((y + h - 1) % h) * w, y0 = y * w, yp = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xm = (x + w - 1) % w, xp = (x + 1) % w;
      const s = a[ym + xm]! + a[ym + x]! + a[ym + xp]! + a[y0 + xm]! + a[y0 + xp]! + a[yp + xm]! + a[yp + x]! + a[yp + xp]!;
      n[y0 + x] = s === 3 || (a[y0 + x] === 1 && s === 2) ? 1 : 0;
    }
  }
}

/**
 * A GPU Game of Life board with exact toroidal wrapping and integer texelFetch, started from a fixed seed.
 * `at(g)` steps forward; a seek back re-uploads the seed and replays, so the board is a function of g.
 */
export class GPULife {
  private rts: THREE.WebGLRenderTarget[] = [];
  private rtGens = new Int32Array(8).fill(-1);
  private head = 0;
  private stepPass: FSPass;
  private seedPass: FSPass;
  private seedTex: THREE.DataTexture;
  private gen = -1;

  constructor(readonly w: number, readonly h: number, seed: Uint8Array) {
    const opts: Partial<THREE.RenderTargetOptions> & { pxScale: number } = {
      pxScale: 1,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    };
    for (let i = 0; i < 8; i++) this.rts.push(makeRT(w, h, opts));
    const rgba = new Uint8Array(w * h * 4);
    // row 0 of the seed is the top of the board; GL row 0 is the bottom
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba[((h - 1 - y) * w + x) * 4] = seed[y * w + x]! * 255;
    this.seedTex = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.seedTex.minFilter = this.seedTex.magFilter = THREE.NearestFilter;
    this.seedTex.needsUpdate = true;

    this.stepPass = new FSPass(/* glsl */ `
      uniform sampler2D uPrev;
      void main() {
        ivec2 size = textureSize(uPrev, 0);
        ivec2 coord = ivec2(gl_FragCoord.xy);
        int s = 0;
        for (int dy = -1; dy <= 1; dy++) {
          int y = (coord.y + dy + size.y) % size.y;
          for (int dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) continue;
            int x = (coord.x + dx + size.x) % size.x;
            s += int(texelFetch(uPrev, ivec2(x, y), 0).r > 0.5);
          }
        }
        float alive = texelFetch(uPrev, coord, 0).r;
        float next = (s == 3 || (alive > 0.5 && s == 2)) ? 1.0 : 0.0;
        fragColor = vec4(next, next, next, 1.0);
      }
    `, { uPrev: { value: null } });

    this.seedPass = new FSPass(/* glsl */ `
      uniform sampler2D uSeedTex;
      void main() {
        float v = texelFetch(uSeedTex, ivec2(gl_FragCoord.xy), 0).r > 0.5 ? 1.0 : 0.0;
        fragColor = vec4(v, v, v, 1.0);
      }
    `, { uSeedTex: { value: this.seedTex } });
  }

  private reseed(renderer: THREE.WebGLRenderer) {
    this.seedPass.render(renderer, this.rts[0]!);
    this.rtGens.fill(-1);
    this.rtGens[0] = 0;
    this.head = 0;
    this.gen = 0;
  }

  /** The board after targetGen generations from the seed. */
  at(renderer: THREE.WebGLRenderer, targetGen: number): THREE.Texture {
    for (let i = 0; i < 8; i++) {
      if (this.rtGens[i] === targetGen) return this.rts[i]!.texture;
    }
    if (this.gen < 0 || targetGen < this.gen) this.reseed(renderer);
    while (this.gen < targetGen) {
      const src = this.rts[this.head]!;
      const nextHead = (this.head + 1) % 8;
      const dst = this.rts[nextHead]!;
      this.stepPass.u.uPrev!.value = src.texture;
      this.stepPass.render(renderer, dst);
      this.head = nextHead;
      this.gen++;
      this.rtGens[this.head] = this.gen;
    }
    return this.rts[this.head]!.texture;
  }

  dispose() {
    for (const rt of this.rts) rt.dispose();
    this.seedTex.dispose();
  }
}
