// The duckboard that falls through the platform, as a lit prop kit (see `_propKit.ts`). The kit is a `root` group (metres, y up) built
// once; its setters only change state that a pure function of time can set again. It owns no light.
import * as THREE from 'three';
import type { Pose, ShapeSpec } from '@pve/engine/physics';
import { mulberry32 } from '@pve/engine/util';
import type { Fonts } from './_fonts';
import type { PixelFont } from '@pve/engine/type';
import { Builder, LitAtlas, litMaterial, litMesh, at, type Cell, type Painter } from '@pve/engine/lit';
import { hash, mixc } from './_propKit';

/** One fragment of the duckboard: a mesh and the box that bakes with it. Poses are in the kit's root frame. */
export interface DuckPiece {
  kind: 'slat' | 'batten';
  /** A box shape (half sizes), ready for a BodySpec. */
  shape: ShapeSpec;
  /** Resting pose of the piece's centre. */
  pose: Pose;
  mesh: THREE.Mesh;
}

interface Crack { x: number; at: number }

type Face2 = { cell: Cell; map?: 'tile' | 'fit' };

/** The faces and the material that every fragment shares. */
interface WoodKit { mat: THREE.MeshLambertMaterial; under: Face2; side: Face2 }

const BOARD_L = 0.9;
const BOARD_W = 0.6;
const SLAT_W = 0.07;
const SLAT_T = 0.018;
const BATTEN_W = 0.045;
const BATTEN_H = 0.032;
const WOOD_TEX = 100;

/** The text bitmap of the board: BW x BZ texels (x along the slats, y from the -z edge), and the texel indexes of each glyph. */
const BW = Math.round(BOARD_L * WOOD_TEX);
const BZ = Math.round(BOARD_W * WOOD_TEX);
const DUCK_TEXT = ['すのこが', 'きえるんだ'] as const;

/**
 * Prints `rows` bold (each font pixel grows one texel to the right) and centred on the board bitmap. Returns the ink
 * bitmap and, for each glyph in reading order, the indexes of its texels.
 */
function printOnBoard(font: PixelFont, rows: readonly string[]): { ink: Uint8Array; glyphBits: number[][] } {
  const ink = new Uint8Array(BW * BZ);
  const glyphBits: number[][] = [];
  const lineH = 22, first = Math.round((BZ - lineH * (rows.length - 1)) / 2) + 6;
  rows.forEach((row, r) => {
    let x = Math.floor((BW - font.width(row)) / 2);
    for (const ch of row) {
      const bits: number[] = [];
      font.draw({ put: (px, py) => {
        for (const [dx, dy] of [[0, 0], [1, 0]] as const) {
          const tx = px + dx, ty = py + dy;
          if (tx < 0 || ty < 0 || tx >= BW || ty >= BZ) continue;
          ink[ty * BW + tx] = 1;
          bits.push(ty * BW + tx);
        }
      } }, ch, x, first + r * lineH, 1);
      glyphBits.push(bits);
      x += font.width(ch);
    }
  });
  return { ink, glyphBits };
}

/**
 * A duckboard (すのこ): 7 slats on 2 battens, 0.9 x 0.6 x 0.05 m, its underside on y = 0, slats along x. Each slat and
 * batten is cut into 1 to 3 fragments (seeded) that are separate meshes: `pieces()` lists them for a physics bake, and
 * `setPiece` poses one. At rest they fit together. `setRot` changes only the texture.
 *
 * The lyric of the line (`すのこが / きえるんだ`) is painted bold black across the slats (treatment, chorus 1): it is
 * texture of the slat fragments, so every letter breaks with the slats under it. The text reads along +x and its top is
 * toward -z: a camera above and at +z sees it upright. `glyphPieces(k)` lists the fragments that carry glyph k.
 */
export class Duckboard {
  readonly root = new THREE.Group();
  readonly lights: THREE.Light[] = [];
  private list: DuckPiece[] = [];
  private paints: { cell: Cell; fn: (p: Painter, rk: number) => void }[] = [];
  private rot = -1;
  private groups: { glyphs: number[][]; rest: number[] } = { glyphs: [], rest: [] };

  constructor(private atlas: LitAtlas, fonts: Fonts, seed = 5, rows: readonly string[] = DUCK_TEXT) {
    const { ink, glyphBits } = printOnBoard(fonts.kana, rows);
    const rng = mulberry32(seed);
    const mat = litMaterial(atlas);
    const side = atlas.paint(8, 4, () => {});
    this.paints.push({ cell: side, fn: (p, rk) => {
      p.fill(mixc(0x9a7a46, 0x3a2e24, rk));
      p.speckle(mixc(0x7a5c34, 0x1e1812, rk), 0.2, 51);
      p.rect(0, 3, 8, 1, mixc(0xb89258, 0x4a3c30, rk));
    } });
    const wood: WoodKit = { mat, under: { cell: atlas.solid(0x2a2018) }, side: { cell: side } };
    this.buildSlats(wood, rng, ink);
    this.buildBattens(wood, rng);
    this.setRot(0);
    this.group(glyphBits);
  }

  /** Adds one fragment: a box with its top face `top`, its long sides of the shared side face, and `ends` on its x faces. */
  private addPiece(wood: WoodKit, kind: 'slat' | 'batten', half: [number, number, number], p: [number, number, number], top: Cell, ends: Face2) {
    const b = new Builder(WOOD_TEX);
    const [hx, hy, hz] = half;
    b.box(hx * 2, hy * 2, hz * 2, { py: { cell: top, map: 'fit' }, ny: wood.under, pz: wood.side, nz: wood.side, px: ends, nx: ends }, at(0, -hy, 0));
    const mesh = litMesh(b, wood.mat);
    mesh.position.set(...p);
    this.root.add(mesh);
    this.list.push({ kind, shape: { kind: 'box', half }, pose: { p, q: [0, 0, 0, 1] }, mesh });
  }

  /** The 7 slats, each cut into 2 or 3 seeded fragments, with the ink of the lyric on their tops. */
  private buildSlats(wood: WoodKit, rng: () => number, ink: Uint8Array) {
    const atlas = this.atlas;
    const end = { cell: atlas.solid(0x8a6a3c) };
    const pitch = (BOARD_W - SLAT_W) / 6;
    for (let s = 0; s < 7; s++) {
      const zc = -BOARD_W / 2 + SLAT_W / 2 + s * pitch;
      const cuts = [-BOARD_L / 2];
      const b1 = -BOARD_L / 2 + BOARD_L * (0.28 + rng() * 0.12);
      const b2 = -BOARD_L / 2 + BOARD_L * (0.62 + rng() * 0.12);
      cuts.push(b1);
      if (rng() > 0.3) cuts.push(b2);
      cuts.push(BOARD_L / 2);
      const cracks: Crack[] = [];
      for (let k = 1; k < cuts.length - 1; k++) cracks.push({ x: Math.round((cuts[k]! + BOARD_L / 2) * WOOD_TEX), at: 0.45 + rng() * 0.2 });
      cracks.push({ x: Math.round(rng() * BOARD_L * WOOD_TEX), at: 0.55 + rng() * 0.3 });
      cracks.push({ x: Math.round(rng() * BOARD_L * WOOD_TEX), at: 0.75 + rng() * 0.2 });
      for (let k = 0; k + 1 < cuts.length; k++) {
        const x0 = cuts[k]!, x1 = cuts[k + 1]!;
        const X0 = Math.round((x0 + BOARD_L / 2) * WOOD_TEX);
        const w = Math.max(2, Math.round((x1 - x0) * WOOD_TEX));
        const h = Math.round(SLAT_W * WOOD_TEX);
        const cell = atlas.paint(w, h, () => {});
        const top = Math.round((zc - SLAT_W / 2 + BOARD_W / 2) * WOOD_TEX);
        this.paints.push({ cell, fn: (p, rk) => {
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            // the text is paint on the slat: it breaks with it
            p.px(x, y, ink[(top + h - 1 - y) * BW + X0 + x] ? this.paintTexel(s, X0 + x, y) : this.woodTexel(s, X0 + x, y, rk, cracks, h));
          }
        } });
        this.addPiece(wood, 'slat', [(x1 - x0) / 2, SLAT_T / 2, SLAT_W / 2], [(x0 + x1) / 2, BATTEN_H + SLAT_T / 2, zc], cell, end);
      }
    }
  }

  /** The 2 battens under the slats, each cut in two at a seeded place. */
  private buildBattens(wood: WoodKit, rng: () => number) {
    const atlas = this.atlas;
    for (let k = 0; k < 2; k++) {
      const xc = k === 0 ? -0.29 : 0.29;
      const cut = -0.09 + rng() * 0.18;
      const cracks: Crack[] = [{ x: Math.round((cut + BOARD_W / 2 - 0.02) * WOOD_TEX), at: 0.5 }, { x: Math.round(rng() * 55), at: 0.8 }];
      for (const [z0, z1] of [[-0.29, cut], [cut, 0.29]] as [number, number][]) {
        const Z0 = Math.round((z0 + 0.29) * WOOD_TEX);
        const len = Math.max(2, Math.round((z1 - z0) * WOOD_TEX));
        const wd = Math.round(BATTEN_W * WOOD_TEX);
        const cell = atlas.paint(wd, len, () => {});
        this.paints.push({ cell, fn: (p, rk) => {
          // along the batten is y of the cell (a face seen from above has v running toward -z)
          for (let v = 0; v < len; v++) for (let u = 0; u < wd; u++) p.px(u, len - 1 - v, this.woodTexel(10 + k, Z0 + v, u, rk, cracks, wd));
        } });
        const ends = { cell: atlas.solid(0x6e5230) };
        this.addPiece(wood, 'batten', [BATTEN_W / 2, BATTEN_H / 2, (z1 - z0) / 2], [xc, BATTEN_H / 2, (z0 + z1) / 2], cell, ends);
      }
    }
  }

  /** One texel of a plank top: X along the grain, Y across; `rk` 0 fresh wood to 1 dark, mossy and cracked. */
  private woodTexel(key: number, X: number, Y: number, rk: number, cracks: Crack[], across: number): number {
    let c = mixc(0xcda76a, 0xb68a50, hash(key, Y, 1) < 0.28 ? 0.7 : 0);
    if (hash(key, X >> 1, Y + 9) < 0.12) c = mixc(c, 0x8a6638, 0.5);
    const dark = rk * (0.55 + 0.45 * hash(key, X >> 2, Y, 3));
    c = mixc(c, mixc(0x4b3b2c, 0x6d6455, hash(key, X, Y, 5)), Math.min(1, dark * 1.15));
    const n = hash(key, X >> 2, Y >> 1, 7) * 0.6 + hash(key, X >> 1, Y, 8) * 0.4;
    if (rk > 0.3 && n > 1.22 - rk * 0.62) c = hash(key, X, Y, 9) < 0.5 ? 0x4d7a33 : 0x38602a;
    for (const cr of cracks) if (rk > cr.at && Math.abs(X - (cr.x + Math.round(Math.sin(Y * 1.7 + cr.x) * 0.8))) < 0.5) c = 0x140e0a;
    if (across >= 6 && (Y === 1 || Y === across - 2) && (Math.abs(X - 7) < 0.5 || Math.abs(X - 83) < 0.5)) c = mixc(0x5c6168, 0x6a3a22, rk);
    return c;
  }

  /** One texel of the black paint of the lyric: a dense black with a little wear. */
  private paintTexel(key: number, X: number, Y: number): number {
    return hash(key, X, Y, 11) < 0.07 ? 0x2c2218 : 0x0f0c09;
  }

  /** Sorts the slat fragments by the glyph they carry (the first glyph in reading order that touches them). */
  private group(glyphBits: number[][]) {
    const taken = new Set<number>();
    const glyphs = glyphBits.map((bits) => {
      const mine: number[] = [];
      this.list.forEach((d, i) => {
        if (d.kind !== 'slat' || d.shape.kind !== 'box' || taken.has(i)) return;
        const [hx, , hz] = d.shape.half;
        const x0 = Math.round((d.pose.p[0] + BOARD_L / 2 - hx) * WOOD_TEX), x1 = Math.round((d.pose.p[0] + BOARD_L / 2 + hx) * WOOD_TEX);
        const z0 = Math.round((d.pose.p[2] + BOARD_W / 2 - hz) * WOOD_TEX), z1 = Math.round((d.pose.p[2] + BOARD_W / 2 + hz) * WOOD_TEX);
        if (bits.some((b) => { const tx = b % BW, ty = Math.floor(b / BW); return tx >= x0 && tx < x1 && ty >= z0 && ty < z1; })) { mine.push(i); taken.add(i); }
      });
      return mine;
    });
    this.groups = { glyphs, rest: this.list.map((_, i) => i).filter((i) => !taken.has(i)) };
  }

  /** The fragments (indexes into `pieces()`) that carry the glyph `k` of the printed lines and that no earlier glyph claims. */
  glyphPieces(k: number): number[] { return this.groups.glyphs[k] ?? []; }

  /** The fragments that carry no text (the slat fragments between the letters, and the battens). */
  restPieces(): number[] { return this.groups.rest; }

  /** 0 fresh pale wood, 1 dark, mossy and cracked. */
  setRot(k: number) {
    k = Math.max(0, Math.min(1, k));
    if (k === this.rot) return;
    this.rot = k;
    for (const { cell, fn } of this.paints) this.atlas.repaint(cell, (p) => fn(p, k));
  }

  /** The fragments (slats first, then battens), at rest. Poses are in the kit's root frame. */
  pieces(): DuckPiece[] {
    return this.list;
  }

  /** Moves fragment i (root frame, pose of its centre). */
  setPiece(i: number, p: THREE.Vector3, q: THREE.Quaternion) {
    const m = this.list[i]!.mesh;
    m.position.copy(p);
    m.quaternion.copy(q);
  }

  /** Puts every fragment back at rest. */
  resetPieces() {
    for (const d of this.list) {
      d.mesh.position.set(...d.pose.p);
      d.mesh.quaternion.set(...d.pose.q);
    }
  }
}
