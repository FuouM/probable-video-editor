// The lit low-poly kit. A world renders at 640x360 (the logical frame, x3 to the 1920x1080 frame) in real light:
// three.js lights (a sun or a moon with a shadow map, hemisphere ambient, point and spot lights, fog). `litview.ts`
// renders it into an HDR target and makes the output frame.
//
// - Atlas: one RGBA texture of colour cells. Alpha 255 is a lit surface, alpha 1..127 an emissive one (strength
//   0..EMIT_MAX), alpha 0 is clear (discarded).
// - Builder: low-poly shapes with flat faces. Each vertex carries its atlas cell and its texel coordinates. A "tile"
//   face repeats its cell at `tex` texels per metre, a "fit" face stretches the cell once over the face.
// - Material: MeshLambertMaterial with flat shading. Its map lookup reads the atlas cell with texelFetch.
import * as THREE from 'three';
import { W, H } from './gl';
import { mark } from './marks';
import { hashSin } from './util';
import type { Pixels } from './type';

/** The logical frame: x3 to the 1920x1080 frame. */
export const LW = W / 3;
export const LH = H / 3;
/** Default texels per metre of a "tile" face. */
const TEX = 16;

const markBox = new THREE.Box3();
const markP = new THREE.Vector3();
/**
 * Records the screen box of a 3D object as the mark `name`, for `pve probe` (`--target name` tracks it in a zoomed crop strip). The box is the world
 * bounding box of `obj` through `cam`, in frame px (1920x1080). `rect`: where the view lies on the 640x360 frame (the picture of a window), default the
 * whole frame. Nothing is recorded when the object or a parent is hidden, or when the box lies wholly outside the camera's depth range. A mark does not
 * know about occlusion: an object that a nearer one hides still has its box.
 */
export function markObject(name: string, obj: THREE.Object3D, cam: THREE.Camera, rect: readonly [number, number, number, number] = [0, 0, LW, LH]) {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (!o.visible) return;
  obj.updateWorldMatrix(true, true);
  markBox.setFromObject(obj);
  if (markBox.isEmpty()) return;
  cam.updateMatrixWorld();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < 8; k++) {
    markP.set(k & 1 ? markBox.max.x : markBox.min.x, k & 2 ? markBox.max.y : markBox.min.y, k & 4 ? markBox.max.z : markBox.min.z).project(cam);
    if (markP.z < -1 || markP.z > 1) continue;
    const x = rect[0] + ((markP.x + 1) / 2) * rect[2], y = rect[1] + ((1 - markP.y) / 2) * rect[3];
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (x1 < x0) return;
  const k = W / LW;
  mark(name, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k);
}
/** The emissive strength of atlas alpha 127. */
const EMIT_MAX = 8;

/** The copies of a mipmapped cell at lower resolution (`LitAtlas.mipmap`): 1/2, 1/4 and 1/8. */
const MIP_LEVELS = 3;
/** sRGB byte to linear light. */
const SRGB_LIN = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
/** Linear light to an sRGB byte. */
function linSrgb8(l: number): number {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

export type Col = string | number;

const RGB_CACHE = new Map<string, [number, number, number]>();
export const rgb8 = (c: Col): [number, number, number] => {
  if (typeof c === 'number') return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  let rgb = RGB_CACHE.get(c);
  if (!rgb) {
    const n = parseInt(/^#([0-9a-f]{6})$/i.exec(c)?.[1] ?? 'x', 16);
    if (!Number.isFinite(n)) throw new Error(`lit: colour "${c}" is not #rrggbb`);
    rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    RGB_CACHE.set(c, rgb);
  }
  return rgb;
};

/** A linear THREE.Color from an sRGB hex colour. */
export const col = (c: Col) => new THREE.Color().setRGB(...(rgb8(c).map((v) => v / 255) as [number, number, number]), THREE.SRGBColorSpace);

// ---------------------------------------------------------------- atlas

export interface Cell { x: number; y: number; w: number; h: number }

/** Draws colours into one atlas cell. x right, y up (y = 0 is the bottom row of the face). */
export class Painter {
  constructor(private atlas: LitAtlas, readonly cell: Cell) {}
  /** One texel. `emit` > 0 makes it emissive with that strength (0..EMIT_MAX). */
  px(x: number, y: number, c: Col, emit = 0) {
    if (x < 0 || y < 0 || x >= this.cell.w || y >= this.cell.h) return;
    this.atlas.set(this.cell.x + x, this.cell.y + y, c, emit);
  }
  /** A clear texel (discarded when drawn). */
  clear(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.cell.w || y >= this.cell.h) return;
    this.atlas.unset(this.cell.x + x, this.cell.y + y);
  }
  rect(x: number, y: number, w: number, h: number, c: Col, emit = 0) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, c, emit);
  }
  fill(c: Col, emit = 0) { this.rect(0, 0, this.cell.w, this.cell.h, c, emit); }
  /** Scatters colour b over the cell with probability k (seeded, so the cell is the same every run). */
  speckle(c: Col, k: number, seed: number, emit = 0) {
    let s = seed >>> 0 || 1;
    for (let y = 0; y < this.cell.h; y++) for (let x = 0; x < this.cell.w; x++) {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      if (s / 4294967296 < k) this.px(x, y, c, emit);
    }
  }
  /** A pixel sink for PixelFont (x right, y down from the top of the cell). `key` maps font indices to colours. */
  sink(key: Record<number, Col>, emit = 0): Pixels {
    return { put: (x, y, i) => { const c = key[i]; if (c !== undefined) this.px(x, this.cell.h - 1 - y, c, emit); } };
  }
}

export class LitAtlas {
  readonly data: Uint8Array;
  readonly tex: THREE.DataTexture;
  private x = 0;
  private y = 0;
  private rowH = 0;
  private solids = new Map<string, Cell>();
  /** The cells painted since the last `flat` (its texels are out of date there). */
  private dirty = new Set<Cell>();
  private flatTex: THREE.DataTexture | null = null;
  /** The mipmapped cells (`mipmap`), the ones of them painted since the last `mip`, and the copies at each level. */
  private mipCells = new Set<Cell>();
  private mipDirty = new Set<Cell>();
  private mipTex: THREE.DataTexture[] = [];
  /** Every cell in the order it was made, and the textures of `wrong` by seed. */
  private cells: Cell[] = [];
  private wrongTex = new Map<number, THREE.DataTexture>();

  constructor(readonly size = 1024) {
    this.data = new Uint8Array(size * size * 4);
    this.tex = new THREE.DataTexture(this.data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.colorSpace = THREE.NoColorSpace;
  }

  set(x: number, y: number, c: Col, emit = 0) {
    const [r, g, b] = rgb8(c);
    const o = (y * this.size + x) * 4;
    this.data[o] = r; this.data[o + 1] = g; this.data[o + 2] = b;
    this.data[o + 3] = emit > 0 ? 1 + Math.round(Math.min(1, emit / EMIT_MAX) * 126) : 255;
  }

  unset(x: number, y: number) { this.data[(y * this.size + x) * 4 + 3] = 0; }

  private alloc(w: number, h: number): Cell {
    if (this.x + w > this.size) {
      this.x = 0;
      this.y += this.rowH;
      this.rowH = 0;
    }
    if (w > this.size || this.y + h > this.size) throw new Error(`lit atlas: no room for a ${w}x${h} cell`);
    const c = { x: this.x, y: this.y, w, h };
    this.x += w;
    this.rowH = Math.max(this.rowH, h);
    this.tex.needsUpdate = true;
    this.dirty.add(c);
    this.cells.push(c);
    return c;
  }

  paint(w: number, h: number, fn: (p: Painter) => void): Cell {
    const c = this.alloc(w, h);
    fn(new Painter(this, c));
    return c;
  }

  /** Paints over an existing cell (a board that changes). */
  repaint(cell: Cell, fn: (p: Painter) => void) {
    fn(new Painter(this, cell));
    this.tex.needsUpdate = true;
    this.dirty.add(cell);
    if (this.mipCells.has(cell)) this.mipDirty.add(cell);
  }

  /**
   * The atlas for a far view (level of detail): each texel has the mean colour of the texels of its cell of the same kind (lit or
   * emissive), so a cell is one plain colour. Clear texels stay clear and the strength of the light stays. Made on the first call;
   * after that only the cells painted since the last call are made again.
   */
  get flat(): THREE.DataTexture {
    if (!this.flatTex) {
      this.flatTex = new THREE.DataTexture(new Uint8Array(this.data.length), this.size, this.size, THREE.RGBAFormat, THREE.UnsignedByteType);
      this.flatTex.minFilter = THREE.NearestFilter;
      this.flatTex.magFilter = THREE.NearestFilter;
      this.flatTex.generateMipmaps = false;
      this.flatTex.colorSpace = THREE.NoColorSpace;
    }
    if (this.dirty.size === 0) return this.flatTex;
    const src = this.data, dst = this.flatTex.image.data as Uint8Array, S = this.size;
    for (const c of this.dirty) {
      // the sums of the lit texels [0..3] and of the emissive ones [4..7] (r, g, b, count)
      const sum = [0, 0, 0, 0, 0, 0, 0, 0];
      for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) {
        const o = (y * S + x) * 4, a = src[o + 3]!;
        if (a === 0) continue;
        const k = a === 255 ? 0 : 4;
        sum[k]! += src[o]!; sum[k + 1]! += src[o + 1]!; sum[k + 2]! += src[o + 2]!; sum[k + 3]! += 1;
      }
      for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) {
        const o = (y * S + x) * 4, a = src[o + 3]!, k = a === 255 ? 0 : 4, n = Math.max(1, sum[k + 3]!);
        dst[o] = Math.round(sum[k]! / n); dst[o + 1] = Math.round(sum[k + 1]! / n); dst[o + 2] = Math.round(sum[k + 2]! / n); dst[o + 3] = a;
      }
    }
    this.dirty.clear();
    this.flatTex.needsUpdate = true;
    return this.flatTex;
  }

  /**
   * Gives a cell of lit texels mipmaps: a surface that shows more than one of its texels in a pixel (a ground seen from far) reads them
   * at a lower resolution, so a fine pattern does not beat into moire. Each level shrinks the cell by itself (blocks of 2^level texels,
   * wrapped round inside the cell, which repeats), so no colour of a neighbour cell comes in. Other cells are read as painted.
   */
  mipmap(cell: Cell): Cell {
    this.mipCells.add(cell);
    this.mipDirty.add(cell);
    return cell;
  }

  /**
   * The copy of the atlas at 1/2^level of its resolution (`level` 1..MIP_LEVELS), in the atlas's layout. Only the mipmapped cells are
   * in it: there each texel has the mean colour (of linear light) of its block, and alpha 255. Elsewhere alpha is 0.
   */
  mip(level: number): THREE.DataTexture {
    if (level < 1 || level > MIP_LEVELS) throw new Error(`lit atlas: no mip level ${level}`);
    if (this.mipTex.length === 0) {
      for (let l = 1; l <= MIP_LEVELS; l++) {
        const t = new THREE.DataTexture(new Uint8Array(this.data.length), this.size, this.size, THREE.RGBAFormat, THREE.UnsignedByteType);
        t.minFilter = THREE.NearestFilter;
        t.magFilter = THREE.NearestFilter;
        t.generateMipmaps = false;
        t.colorSpace = THREE.NoColorSpace;
        // uploaded even when no cell is mipmapped: a texture that was never uploaded reads (0, 0, 0, 1) on some backends (ANGLE on
        // OpenGL), and alpha 1 would mark every cell as mipmapped
        t.needsUpdate = true;
        this.mipTex.push(t);
      }
    }
    if (this.mipDirty.size > 0) {
      const src = this.data, S = this.size;
      for (const c of this.mipDirty) for (let l = 1; l <= MIP_LEVELS; l++) {
        const dst = this.mipTex[l - 1]!.image.data as Uint8Array, b = 1 << l;
        for (let by = 0; by < c.h; by += b) for (let bx = 0; bx < c.w; bx += b) {
          let r = 0, g = 0, bl = 0;
          for (let j = 0; j < b; j++) for (let i = 0; i < b; i++) {
            const o = ((c.y + ((by + j) % c.h)) * S + c.x + ((bx + i) % c.w)) * 4;
            r += SRGB_LIN[src[o]!]!; g += SRGB_LIN[src[o + 1]!]!; bl += SRGB_LIN[src[o + 2]!]!;
          }
          const n = b * b, R = linSrgb8(r / n), G = linSrgb8(g / n), B = linSrgb8(bl / n);
          for (let y = by; y < Math.min(by + b, c.h); y++) for (let x = bx; x < Math.min(bx + b, c.w); x++) {
            const o = ((c.y + y) * S + c.x + x) * 4;
            dst[o] = R; dst[o + 1] = G; dst[o + 2] = B; dst[o + 3] = 255;
          }
        }
      }
      this.mipDirty.clear();
      for (const t of this.mipTex) t.needsUpdate = true;
    }
    return this.mipTex[level - 1]!;
  }

  /**
   * The atlas with wrong textures (a game that reads the wrong place of its texture memory): every cell shows the texels of another
   * cell, picked by `seed` (a smaller cell repeats). Each texel keeps its own alpha, so cut-outs and lit parts stay where they were.
   * Made once for each seed, from the texels of that moment.
   */
  wrong(seed: number): THREE.DataTexture {
    const made = this.wrongTex.get(seed);
    if (made) return made;
    const src = this.data, dst = new Uint8Array(src.length), S = this.size, cells = this.cells;
    cells.forEach((c, i) => {
      const s = cells[Math.floor(hashSin(i, seed) * cells.length)]!;
      for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
        const o = ((c.y + y) * S + c.x + x) * 4, f = ((s.y + (y % s.h)) * S + s.x + (x % s.w)) * 4;
        dst[o] = src[f]!; dst[o + 1] = src[f + 1]!; dst[o + 2] = src[f + 2]!; dst[o + 3] = src[o + 3]!;
      }
    });
    const tex = new THREE.DataTexture(dst, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.wrongTex.set(seed, tex);
    return tex;
  }

  dispose() {
    this.tex.dispose();
    this.flatTex?.dispose();
    for (const t of this.wrongTex.values()) t.dispose();
    for (const t of this.mipTex) t.dispose();
  }

  /** The 1x1 cell of one colour (shared). */
  solid(c: Col, emit = 0): Cell {
    const key = `${typeof c === 'number' ? c.toString(16) : c}|${emit}`;
    let cell = this.solids.get(key);
    if (!cell) {
      cell = this.paint(1, 1, (p) => p.fill(c, emit));
      this.solids.set(key, cell);
    }
    return cell;
  }

  /**
   * A cell drawn with Canvas2D (top-left origin, y down). Texels with alpha under 128 are clear. `emit` makes the
   * whole cell emissive.
   */
  canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, emit = 0): Cell {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingEnabled = false;
    draw(g);
    const img = g.getImageData(0, 0, w, h).data;
    return this.paint(w, h, (p) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (img[o + 3]! < 128) p.clear(x, h - 1 - y);
        else p.px(x, h - 1 - y, (img[o]! << 16) | (img[o + 1]! << 8) | img[o + 2]!, emit);
      }
    });
  }
}

// ---------------------------------------------------------------- geometry

export interface Face { cell: Cell; map?: 'tile' | 'fit' }
type V3 = THREE.Vector3;
export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Faces of a box. A missing face is not built. */
export interface BoxFaces { px?: Face; nx?: Face; py?: Face; ny?: Face; pz?: Face; nz?: Face }
export const allFaces = (f: Face): BoxFaces => ({ px: f, nx: f, py: f, ny: f, pz: f, nz: f });

/** A matrix: translation x, y, z, then rotation ry about y (radians). */
export const at = (x: number, y: number, z: number, ry = 0) => new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);

export class Builder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private cel: number[] = [];

  /** `tex`: texels per metre of tile faces. */
  constructor(readonly tex = TEX) {}

  get empty() { return this.pos.length === 0; }
  /** How many vertices the builder holds. */
  get vertices() { return this.pos.length / 3; }

  /** One quad p0 (bottom left), p1 (bottom right), p2 (top right), p3 (top left), seen from its front. */
  quad(p0: V3, p1: V3, p2: V3, p3: V3, f: Face, m?: THREE.Matrix4) {
    const [a, b, c, d] = m ? [p0, p1, p2, p3].map((p) => p.clone().applyMatrix4(m)) as [V3, V3, V3, V3] : [p0, p1, p2, p3];
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const fit = f.map === 'fit';
    const uw = fit ? f.cell.w : p0.distanceTo(p1) * this.tex;
    const vh = fit ? f.cell.h : p0.distanceTo(p3) * this.tex;
    const corner = (p: V3, u: number, v: number) => {
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
      // a fit face keeps its texel coordinates just inside the cell so that floor() never reaches the next cell
      this.uv.push(fit ? Math.min(u, f.cell.w - 1e-3) : u, fit ? Math.min(v, f.cell.h - 1e-3) : v);
      this.cel.push(f.cell.x, f.cell.y, f.cell.w, f.cell.h);
    };
    corner(a, 0, 0); corner(b, uw, 0); corner(c, uw, vh);
    corner(a, 0, 0); corner(c, uw, vh); corner(d, 0, vh);
  }

  /** One triangle, tiled in the plane of the triangle. */
  tri(a: V3, b: V3, c: V3, f: Face, m?: THREE.Matrix4) {
    const [p, q, r] = m ? [a, b, c].map((x) => x.clone().applyMatrix4(m)) as [V3, V3, V3] : [a, b, c];
    const e1 = new THREE.Vector3().subVectors(q, p);
    const n = e1.clone().cross(new THREE.Vector3().subVectors(r, p)).normalize();
    const ax = e1.clone().normalize();
    const ay = n.clone().cross(ax);
    for (const x of [p, q, r]) {
      const d = new THREE.Vector3().subVectors(x, p);
      this.pos.push(x.x, x.y, x.z);
      this.nrm.push(n.x, n.y, n.z);
      this.uv.push(d.dot(ax) * this.tex, d.dot(ay) * this.tex);
      this.cel.push(f.cell.x, f.cell.y, f.cell.w, f.cell.h);
    }
  }

  /** A box w (x) by h (y) by d (z), centred on x and z, standing on y = 0. */
  box(w: number, h: number, d: number, f: BoxFaces, m?: THREE.Matrix4) {
    const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
    if (f.nz) this.quad(v3(x1, 0, z0), v3(x0, 0, z0), v3(x0, h, z0), v3(x1, h, z0), f.nz, m);
    if (f.pz) this.quad(v3(x0, 0, z1), v3(x1, 0, z1), v3(x1, h, z1), v3(x0, h, z1), f.pz, m);
    if (f.px) this.quad(v3(x1, 0, z1), v3(x1, 0, z0), v3(x1, h, z0), v3(x1, h, z1), f.px, m);
    if (f.nx) this.quad(v3(x0, 0, z0), v3(x0, 0, z1), v3(x0, h, z1), v3(x0, h, z0), f.nx, m);
    if (f.py) this.quad(v3(x0, h, z1), v3(x1, h, z1), v3(x1, h, z0), v3(x0, h, z0), f.py, m);
    if (f.ny) this.quad(v3(x0, 0, z0), v3(x1, 0, z0), v3(x1, 0, z1), v3(x0, 0, z1), f.ny, m);
  }

  /** A convex profile in the x-y plane (counter-clockwise seen from +z) extruded from z = -d/2 to d/2. */
  extrude(profile: [number, number][], d: number, cap: Face | null, side: Face, m?: THREE.Matrix4) {
    const n = profile.length;
    for (let k = 0; k < n; k++) {
      const [ax, ay] = profile[k]!;
      const [bx, by] = profile[(k + 1) % n]!;
      this.quad(v3(ax, ay, -d / 2), v3(bx, by, -d / 2), v3(bx, by, d / 2), v3(ax, ay, d / 2), side, m);
    }
    if (!cap) return;
    const [ox, oy] = profile[0]!;
    for (let k = 1; k + 1 < n; k++) {
      const [ax, ay] = profile[k]!;
      const [bx, by] = profile[k + 1]!;
      this.tri(v3(ox, oy, d / 2), v3(ax, ay, d / 2), v3(bx, by, d / 2), cap, m);
      this.tri(v3(ox, oy, -d / 2), v3(bx, by, -d / 2), v3(ax, ay, -d / 2), cap, m);
    }
  }

  /** A cylinder (or a cone with r1 = 0) along y from 0 to h, with `seg` flat sides. */
  cylinder(r0: number, r1: number, h: number, seg: number, side: Face, cap: Face | null, m?: THREE.Matrix4) {
    const ring = (r: number, y: number, k: number) => v3(Math.cos((k / seg) * Math.PI * 2) * r, y, -Math.sin((k / seg) * Math.PI * 2) * r);
    for (let k = 0; k < seg; k++) {
      if (r1 > 0) this.quad(ring(r0, 0, k), ring(r0, 0, k + 1), ring(r1, h, k + 1), ring(r1, h, k), side, m);
      else this.tri(ring(r0, 0, k), ring(r0, 0, k + 1), v3(0, h, 0), side, m);
      if (cap) {
        this.tri(v3(0, 0, 0), ring(r0, 0, k + 1), ring(r0, 0, k), cap, m);
        if (r1 > 0) this.tri(v3(0, h, 0), ring(r1, h, k), ring(r1, h, k + 1), cap, m);
      }
    }
  }

  /**
   * A profile swept along a path of points with unit side and up vectors (the profile's x and y axes). The
   * profile is a list of [across, up] points from left to right over the top. `closed` joins the last path point
   * to the first. Free up vectors let a sweep twist (a Möbius strip).
   */
  sweep(path: { p: V3; side: V3; up?: V3 }[], profile: [number, number][], f: Face, closed: boolean) {
    const Y = v3(0, 1, 0);
    const pt = (k: number, j: number) => {
      const q = path[k % path.length]!;
      const [a, u] = profile[j]!;
      return q.p.clone().addScaledVector(q.side, a).addScaledVector(q.up ?? Y, u);
    };
    const n = closed ? path.length : path.length - 1;
    for (let k = 0; k < n; k++)
      for (let j = 0; j + 1 < profile.length; j++) this.quad(pt(k, j), pt(k, j + 1), pt(k + 1, j + 1), pt(k + 1, j), f);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aCell', new THREE.Float32BufferAttribute(this.cel, 4));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------- material

/**
 * More shader code for one kind of lit material: uniforms, declarations and a body for the vertex shader (after `begin_vertex`: it can
 * move `transformed`), declarations for the fragment shader and an emission term (a vec3 expression added to the emitted light).
 * `key` names the program: one key for each kind.
 */
export interface LitExtra { key: string; uniforms: Record<string, THREE.IUniform>; vertHead: string; vertBody: string; fragHead: string; emit: string }

/**
 * The lit material of an atlas: Lambert with flat shading, the albedo and the emission from the atlas cell. The
 * material colour tints the albedo (InstancedMesh colours too). Fog applies.
 * `mips`: the material reads its cells through their mipmaps (`LitAtlas.mipmap`): every cell that it draws must be mipmapped. It has a
 * program of its own, so the other lit materials keep their shader as it is. `mipBias` (with `mips`, default 0) is added to the level:
 * at 1 a texel that covers one pixel already reads the next level. Use it for fine detail (thin letters) that shimmers at one texel a pixel.
 */
export function litMaterial(atlas: LitAtlas, opts: { side?: THREE.Side; tint?: Col; extra?: LitExtra; mips?: boolean; mipBias?: number } = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ flatShading: true, side: opts.side ?? THREE.FrontSide });
  if (opts.tint !== undefined) m.color.copy(col(opts.tint));
  const x = opts.extra, mips = opts.mips === true;
  const uAtlas = { value: atlas.tex };
  const uMipOn = { value: 1 };
  const uMipBias = { value: opts.mipBias === undefined ? 0 : opts.mipBias };
  litAtlases.set(m, { atlas, uAtlas, uMipOn });
  m.onBeforeCompile = (s) => {
    s.uniforms.uAtlas = uAtlas;
    s.uniforms.uEmitMax = { value: EMIT_MAX };
    if (mips) {
      // the lower resolutions of the mipmapped cells, made again from the ones painted since the last draw
      s.uniforms.uMip1 = { get value() { return atlas.mip(1); } };
      s.uniforms.uMip2 = { get value() { return atlas.mip(2); } };
      s.uniforms.uMip3 = { get value() { return atlas.mip(3); } };
      s.uniforms.uMipOn = uMipOn;
      s.uniforms.uMipBias = uMipBias;
    }
    if (x) Object.assign(s.uniforms, x.uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec2 aUv;\nattribute vec4 aCell;\nvarying vec2 vAUv;\nflat varying vec4 vACell;\n${x ? x.vertHead : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvAUv = aUv;\nvACell = aCell;\n${x ? x.vertBody : ''}`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${x ? x.fragHead : ''}
uniform sampler2D uAtlas;
uniform float uEmitMax;
varying vec2 vAUv;
flat varying vec4 vACell;
vec3 litDecode(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }${mips ? MIP_HEAD : ''}`)
      .replace('#include <map_fragment>', mips ? MIP_FETCH + LIT_ALBEDO : PLAIN_FETCH + LIT_ALBEDO)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += litEmit${x ? ` + (${x.emit})` : ''};`);
  };
  // one program for every material of this kind (the source does not depend on the atlas)
  m.customProgramCacheKey = () => `lit${mips ? '-mip' : ''}${x ? `-${x.key}` : ''}`;
  return m;
}

const PLAIN_FETCH = `
vec4 litTx = texelFetch(uAtlas, ivec2(vACell.xy + mod(floor(vAUv), vACell.zw)), 0);`;

const MIP_HEAD = `
uniform sampler2D uMip1, uMip2, uMip3;
uniform float uMipOn, uMipBias;
// level 0 the atlas, 1..${MIP_LEVELS} the lower resolutions of the mipmapped cells
vec3 litLevel(int l, ivec2 at) {
  if (l <= 0) return texelFetch(uAtlas, at, 0).rgb;
  if (l == 1) return texelFetch(uMip1, at, 0).rgb;
  if (l == 2) return texelFetch(uMip2, at, 0).rgb;
  return texelFetch(uMip3, at, 0).rgb;
}`;

// The level is log2 of the texels in one pixel, taken before the wrap into the cell (the wrap would look like a jump). Each level is read
// with nearest sampling, and the two levels round the pixel's level blend, so a zoom moves smoothly between them.
const MIP_FETCH = `
ivec2 litAt = ivec2(vACell.xy + mod(floor(vAUv), vACell.zw));
vec4 litTx = texelFetch(uAtlas, litAt, 0);
float litLv = uMipOn * clamp(log2(max(max(length(dFdx(vAUv)), length(dFdy(vAUv))), 1e-4)) + uMipBias, 0.0, ${MIP_LEVELS}.0);
int litL0 = int(floor(litLv));
litTx.rgb = mix(litLevel(litL0, litAt), litLevel(min(litL0 + 1, ${MIP_LEVELS}), litAt), litLv - float(litL0));`;

const LIT_ALBEDO = `
if (litTx.a < 0.5 / 255.0) discard;
vec3 litAlb = litDecode(litTx.rgb);
vec3 litEmit = vec3(0.0);
if (litTx.a < 0.5) {
  litEmit = litAlb * diffuseColor.rgb * (litTx.a * 255.0 - 1.0) / 126.0 * uEmitMax;
  diffuseColor.rgb = vec3(0.0);
} else diffuseColor.rgb *= litAlb;`;

/** The atlas of each lit material, its uniform and the switch of its mipmaps (`setLitLod` and `setLitTexture` swap the texture). */
const litAtlases = new WeakMap<THREE.Material, { atlas: LitAtlas; uAtlas: { value: THREE.Texture }; uMipOn: { value: number } }>();

/** Draws a lit material with the plain cells of its atlas (`LitAtlas.flat`, `far` true) or with its own cells (`far` false). */
export function setLitLod(m: THREE.Material, far: boolean) {
  const l = litAtlases.get(m);
  if (!l) throw new Error('setLitLod: not a lit material');
  l.uAtlas.value = far ? l.atlas.flat : l.atlas.tex;
  l.uMipOn.value = far ? 0 : 1;
}

/**
 * Draws a lit material with another texture of its atlas's layout (such as `LitAtlas.wrong`), or with its own one (`null`). Another
 * texture is read at full resolution only (the mipmaps are of the atlas's own texels).
 */
export function setLitTexture(m: THREE.Material, tex: THREE.Texture | null) {
  const l = litAtlases.get(m);
  if (!l) throw new Error('setLitTexture: not a lit material');
  l.uAtlas.value = tex === null ? l.atlas.tex : tex;
  l.uMipOn.value = tex === null ? 1 : 0;
}

/** A mesh of the builder's geometry, casting and receiving shadows unless told not to. */
export function litMesh(b: Builder | THREE.BufferGeometry, mat: THREE.Material, opts: { cast?: boolean; receive?: boolean } = {}): THREE.Mesh {
  const m = new THREE.Mesh(b instanceof Builder ? b.geometry() : b, mat);
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = opts.receive ?? true;
  return m;
}

/** A screen material: shows `tex` (a LitView screen) as light, `strength` times its value. */
export function screenMaterial(tex: THREE.Texture, strength = 1.4): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  m.color.setScalar(strength);
  return m;
}

/**
 * An InstancedMesh of `n` instances that is never frustum culled (instances spread far from the mesh origin).
 * `color`: an instanceColor buffer of zeros (setColorAt alone makes one filled with ones).
 * The shadow pass draws it with depth materials for instanced meshes only: three has one depth material for all shadow casters, and
 * it finds the program of that material again at each change from a mesh to an instanced mesh.
 */
export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, opts: { color?: boolean } = {}): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.frustumCulled = false;
  if (opts.color) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const k = opts.color ? 1 : 0;
  m.customDepthMaterial = SHADOW_DEPTH[k]!;
  m.customDistanceMaterial = SHADOW_DISTANCE[k]!;
  return m;
}

/** The materials of three's shadow pass (as its own ones), for instanced meshes without and with instance colours. */
const SHADOW_DEPTH = [new THREE.MeshDepthMaterial(), new THREE.MeshDepthMaterial()];
const SHADOW_DISTANCE = [new THREE.MeshDistanceMaterial(), new THREE.MeshDistanceMaterial()];

/**
 * An unlit additive glow: no depth write, no fog, no tone mapping. Double sided unless told. It is drawn in one pass: three draws a
 * transparent two-sided material twice (the back faces, then the front faces) and finds its program again each time, and for light
 * that adds up the order of the faces makes no difference.
 */
export function glowMaterial(side: THREE.Side = THREE.DoubleSide): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side, forceSinglePass: true });
}

/** Adds a low-poly ball (an icosahedron, 20 outward faces) of radius r, squashed to `sy` in height, to `b`, placed by `m`. */
export function icosphere(b: Builder, r: number, f: Face, m: THREE.Matrix4, sy = 1) {
  const t = (1 + Math.sqrt(5)) / 2;
  const P = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map(([x, y, z]) => v3(x!, y! * sy, z!).multiplyScalar(r / Math.hypot(1, t)));
  const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (const [i, j, k] of F) b.tri(P[i!]!, P[j!]!, P[k!]!, f, m);
}

// ---------------------------------------------------------------- lights

/** A point light: colour (sRGB hex), intensity (candela), range (m, 0 = no cut-off). */
export function point(c: Col, intensity: number, range = 0, shadow = false): THREE.PointLight {
  const l = new THREE.PointLight(col(c), intensity, range, 2);
  if (shadow) setShadow(l, 512);
  return l;
}

/** A spot light aimed at `target`: cone half-angle `angle`, soft edge `penumbra` (0..1). */
export function spot(c: Col, intensity: number, range: number, angle: number, penumbra = 0.4, shadow = true): THREE.SpotLight {
  const l = new THREE.SpotLight(col(c), intensity, range, angle, penumbra, 2);
  if (shadow) setShadow(l, 1024);
  return l;
}

/** The sun or the moon: a directional light whose shadow covers a square of `half` metres round its target. */
export function sun(c: Col, intensity: number, half: number, size = 2048): THREE.DirectionalLight {
  const l = new THREE.DirectionalLight(col(c), intensity);
  setShadow(l, size);
  const cam = l.shadow.camera;
  cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
  cam.near = 0.5; cam.far = half * 6;
  return l;
}

function setShadow(l: THREE.PointLight | THREE.SpotLight | THREE.DirectionalLight, size: number) {
  l.castShadow = true;
  l.shadow.mapSize.set(size, size);
  l.shadow.bias = -0.0004;
  l.shadow.normalBias = 0.03;
}

/** Sky and ground ambient. */
export function ambient(sky: Col, ground: Col, intensity: number) { return new THREE.HemisphereLight(col(sky), col(ground), intensity); }

/** Turns on shadows (PCF) on the renderer. Call once in init(). */
export function enableShadows(renderer: THREE.WebGLRenderer) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

/** A perspective camera with the 16:9 aspect of the frame. */
export const camera = (fov: number, near = 0.05, far = 2000) => new THREE.PerspectiveCamera(fov, LW / LH, near, far);
