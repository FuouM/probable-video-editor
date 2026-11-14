// A world that unloads in chunks (see `lit.ts`): a piece turns to the magenta and black missing-texture checker, stays that way for a
// moment, and then drops down into the void, tumbling a little. Nothing rises. The caller says when each place unloads.
//
// How it works. The world meshes are cut into chunks on a grid in x and z (`chunkGeometry`: triangles that cross a chunk edge are
// split, the others go to the chunk of their centre). Each vertex knows its chunk (`aChunk`). A float texture holds, for every chunk,
// three song times at which it unloads (one for each kind of mesh) and a seed for its motion. The vertex shader of `unloadMaterial`
// reads them and moves the chunk as a rigid piece about its centre; the fragment shader paints the checker. The grid sizes are
// templated into the shader. The motion is a closed form in the age of the chunk, so a frame depends only on t. `Unload.xf` is the
// same motion in JS: objects that are drawn as instances can ride on the chunk with it.
import * as THREE from 'three';
import { litMaterial, type LitAtlas } from './lit';
import { clampMinMax } from './util';

// ---------------------------------------------------------------- the chunk grid
/** The grid of the chunks. Chunks outside it share the edge row. */
export interface ChunkGridOpts {
  /** The size of a chunk in x and in z (m). */
  x: number; z: number;
  /** The west edge of the grid (m): chunk ix spans x0 + ix * x .. x0 + (ix + 1) * x. */
  x0: number;
  /** The number of chunks in x and in z. */
  nix: number; niz: number;
  /** The row of z = 0: rows iz = -iz0 .. niz - iz0 - 1, each centred on iz * z. */
  iz0: number;
  /** The height of the pivot of a chunk (m). */
  pivotY: number;
  /** A chunk shows the checker for this long (s) before it drops. */
  check: number;
}

export class ChunkGrid implements ChunkGridOpts {
  readonly x: number; readonly z: number; readonly x0: number; readonly nix: number; readonly niz: number; readonly iz0: number;
  readonly pivotY: number; readonly check: number;
  /** The program cache key of the grid: the shader text depends on every option. */
  readonly key: string;

  constructor(o: ChunkGridOpts) {
    this.x = o.x; this.z = o.z; this.x0 = o.x0; this.nix = o.nix; this.niz = o.niz; this.iz0 = o.iz0; this.pivotY = o.pivotY; this.check = o.check;
    this.key = [o.x, o.z, o.x0, o.nix, o.niz, o.iz0, o.pivotY, o.check].join('|');
  }

  ixOf(x: number): number { return clampMinMax(Math.floor((x - this.x0) / this.x), 0, this.nix - 1); }
  izOf(z: number): number { return clampMinMax(Math.floor(z / this.z + 0.5), -this.iz0, this.niz - this.iz0 - 1); }
  cxOf(ix: number): number { return this.x0 + (ix + 0.5) * this.x; }
  czOf(iz: number): number { return iz * this.z; }
}

/** The unload time of a place that never unloads. */
export const NEVER = 1e6;

// ---------------------------------------------------------------- the motion of a lifted chunk
// Rand numbers from the seed of a chunk: the same fract(s * k) in the shader and here.
const K1 = [17.13, 31.71, 53.97], K2 = [71.29, 89.57, 113.11], K3 = 137.47;
const fract = (v: number) => v - Math.floor(v);

const _rx = new THREE.Matrix4(), _ry = new THREE.Matrix4(), _rz = new THREE.Matrix4();

/** A function of a place (x, z): the song time at which the chunk with its centre there unloads. */
export type UnloadTime = (x: number, z: number) => number;

export class Unload {
  readonly tex: THREE.DataTexture;
  /** The clock of the shaders. */
  readonly uT = { value: 0 };
  private readonly data: Float32Array;

  /** The unload times of the meshes of kind 0 (`worldTime`), kind 1 (`trackTime`) and kind 2 (`farTime`). */
  constructor(readonly grid: ChunkGrid, worldTime: UnloadTime, trackTime: UnloadTime, farTime: UnloadTime) {
    const { nix, niz, iz0 } = grid;
    this.data = new Float32Array(nix * niz * 4);
    for (let iz = -iz0; iz < niz - iz0; iz++) {
      for (let ix = 0; ix < nix; ix++) {
        const o = ((iz + iz0) * nix + ix) * 4, cx = grid.cxOf(ix), cz = grid.czOf(iz);
        this.data[o] = worldTime(cx, cz);
        this.data[o + 1] = trackTime(cx, cz);
        this.data[o + 2] = Math.fround(fract(Math.sin(ix * 12.9898 + iz * 78.233) * 43758.5453));
        this.data[o + 3] = farTime(cx, cz);
      }
    }
    this.tex = new THREE.DataTexture(this.data, nix, niz, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
  }

  private at(x: number, z: number): number { return ((this.grid.izOf(z) + this.grid.iz0) * this.grid.nix + this.grid.ixOf(x)) * 4; }

  /** The age (s) of the chunk that holds (x, z): negative while it is still loaded. `track` picks the clock of kind 1. */
  age(x: number, z: number, t: number, track = false): number {
    return t - this.data[this.at(x, z) + (track ? 1 : 0)]!;
  }

  /**
   * The rigid motion of the chunk that holds (x, z) at time t, into `out`. Returns the age of the chunk (negative: still
   * loaded; `out` is the identity until the checker has shown for `grid.check` s).
   */
  xf(x: number, z: number, t: number, out: THREE.Matrix4, track = false): number {
    const g = this.grid;
    const age = this.age(x, z, t, track);
    out.identity();
    if (age <= g.check) return age;
    const a = age - g.check;
    const o = this.at(x, z);
    const s = this.data[o + 2]!;
    const r1 = K1.map((k) => fract(s * k)), r2 = K2.map((k) => fract(s * k));
    const up = 1.0 + 3.0 * r1[0]!, acc = 16.0 + 10.0 * r1[1]!;
    const ix = g.ixOf(x), iz = g.izOf(z);
    const px = g.cxOf(ix), pz = g.czOf(iz);
    // a chunk of the edge rows holds all that lies outside the grid: it drops without a turn (a turn would swing its far end into the sky)
    const k = ix > 0 && ix < g.nix - 1 && iz > -g.iz0 && iz < g.niz - g.iz0 - 1 ? a : 0;
    const rx = (r1[2]! - 0.5) * 1.0 * k, ry = (r2[0]! - 0.5) * 1.4 * k, rz = (r2[1]! - 0.5) * 0.9 * k;
    const dx = (r2[2]! - 0.5) * 3 * k, dz = (fract(s * K3) - 0.5) * 3 * k;
    // x = pivot + R (x - pivot) + drop + drift
    out.makeTranslation(px + dx, g.pivotY - up * a - 0.5 * acc * a * a, pz + dz);
    out.multiply(_rz.makeRotationZ(rz)).multiply(_ry.makeRotationY(ry)).multiply(_rx.makeRotationX(rx));
    out.multiply(_rx.makeTranslation(-px, -g.pivotY, -pz));
    return age;
  }
}

// ---------------------------------------------------------------- the shader
const GLSL_VERT_DECL = `
attribute vec3 aChunk;
uniform sampler2D uUn;
uniform float uUnT;
uniform vec3 uLoad;
flat varying float vUn;
varying vec3 vLoc;
varying vec3 vNrm;
vec3 unRotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
vec3 unRotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
vec3 unRotZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z); }`;

function vertBody(g: ChunkGrid): string {
  return `
vec4 unTex = texelFetch(uUn, ivec2(int(aChunk.x), int(aChunk.y) + ${g.iz0}), 0);
float unAge = uUnT - (aChunk.z < 0.5 ? unTex.r : (aChunk.z < 1.5 ? unTex.g : unTex.a));
vUn = unAge >= 0.0 ? 1.0 : 0.0;
vLoc = position;
vNrm = normal;
if (unAge > ${g.check.toFixed(3)}) {
  float a = unAge - ${g.check.toFixed(3)};
  float s = unTex.b;
  vec3 r1 = fract(s * vec3(${K1.join(', ')}));
  vec3 r2 = fract(s * vec3(${K2.join(', ')}));
  float up = 1.0 + 3.0 * r1.x;
  float acc = 16.0 + 10.0 * r1.y;
  float unIn = (aChunk.x > 0.5 && aChunk.x < ${(g.nix - 1.5).toFixed(1)} && aChunk.y > ${(-g.iz0 + 0.5).toFixed(1)} && aChunk.y < ${(g.niz - g.iz0 - 1.5).toFixed(1)}) ? a : 0.0;
  vec3 ang = vec3(r1.z - 0.5, r2.x - 0.5, r2.y - 0.5) * vec3(1.0, 1.4, 0.9) * unIn;
  vec3 drift = vec3(r2.z - 0.5, 0.0, fract(s * ${K3}) - 0.5) * 3.0 * unIn;
  vec3 piv = vec3(${g.x0.toFixed(1)} + (aChunk.x + 0.5) * ${g.x.toFixed(1)}, ${g.pivotY.toFixed(1)}, aChunk.y * ${g.z.toFixed(1)});
  vec3 q = transformed - piv;
  q = unRotX(q, ang.x);
  q = unRotY(q, ang.y);
  q = unRotZ(q, ang.z);
  transformed = piv + q - vec3(0.0, up * a + 0.5 * acc * a * a, 0.0) + drift;
}
// the load wave: a chunk west of uLoad.x comes up from below as the checker, half a second before its time, and takes its place
float unLd = uLoad.y + (uLoad.x - (${g.x0.toFixed(1)} + (aChunk.x + 0.5) * ${g.x.toFixed(1)})) / max(uLoad.z, 1.0) - uUnT;
if (uLoad.z > 0.0 && unLd > 0.0) {
  vUn = 1.0;
  transformed.y -= unLd > 0.5 ? 4000.0 : 48.0 * unLd * unLd;
}`;
}

const GLSL_FRAG_DECL = `
flat varying float vUn;
varying vec3 vLoc;
varying vec3 vNrm;`;

// the checker: 1 m cells near z = 0, 3 m out to 120 m, 8 m beyond
const GLSL_FRAG_BODY = `
if (vUn > 0.5) {
  vec3 unAb = abs(vNrm);
  vec2 unUv = (unAb.y >= unAb.x && unAb.y >= unAb.z) ? vLoc.xz : (unAb.x >= unAb.z ? vLoc.zy : vLoc.xy);
  float unCell = abs(vLoc.z) < 40.0 ? 1.0 : (abs(vLoc.z) < 120.0 ? 3.0 : 8.0);
  vec2 unC = floor(unUv / unCell);
  float unChk = mod(unC.x + unC.y, 2.0) < 0.5 ? 0.0 : 1.0;
  diffuseColor.rgb = vec3(0.0);
  totalEmissiveRadiance = vec3(unChk, 0.0, unChk);
}`;

/**
 * The lit material of the unloading world: `litMaterial` plus the chunk motion and the checker. One sided: a camera that passes
 * through a house sees through its walls (a noclip), not a black inside.
 * `load`: the load wave of the meshes of this material: (the x where it starts, the time at which it starts, its speed toward -x in
 * m/s). A chunk is not there before the wave comes. A speed of 0: no wave, the meshes are there from the start.
 */
export function unloadMaterial(atlas: LitAtlas, un: Unload, load: THREE.Vector3): THREE.MeshLambertMaterial {
  const m = litMaterial(atlas);
  const base = m.onBeforeCompile;
  const vert = vertBody(un.grid);
  m.onBeforeCompile = (s, r) => {
    base.call(m, s, r);
    s.uniforms.uUn = { value: un.tex };
    s.uniforms.uUnT = un.uT;
    s.uniforms.uLoad = { value: load };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>${GLSL_VERT_DECL}`)
      .replace('vACell = aCell;', `vACell = aCell;${vert}`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>${GLSL_FRAG_DECL}`)
      .replace('totalEmissiveRadiance += litEmit;', `totalEmissiveRadiance += litEmit;${GLSL_FRAG_BODY}`);
  };
  m.customProgramCacheKey = () => `lit-unload|${un.grid.key}`;
  return m;
}

// ---------------------------------------------------------------- cutting the geometry into chunks
type Vtx = number[]; // x y z nx ny nz u v

/** Cuts the convex polygon `poly` with the plane `axis = c`: [side below c, side above c]. */
function cut(poly: Vtx[], axis: number, c: number): [Vtx[], Vtx[]] {
  const lo: Vtx[] = [], hi: Vtx[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const dp = p[axis]! - c, dq = q[axis]! - c;
    if (dp <= 0) lo.push(p);
    if (dp >= 0) hi.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const u = dp / (dp - dq);
      const v = p.map((a, k) => a + (q[k]! - a) * u);
      v[axis] = c;
      lo.push(v);
      hi.push(v);
    }
  }
  return [lo, hi];
}

/** Cuts `poly` at every chunk border that it crosses, in x and then in z. */
function cutToChunks(g: ChunkGrid, tri: Vtx[], x0: number, x1: number, z0: number, z1: number): Vtx[][] {
  let polys: Vtx[][] = [tri];
  for (let kx = Math.floor((x0 - g.x0) / g.x) + 1; g.x0 + kx * g.x < x1; kx++) {
    const c = g.x0 + kx * g.x;
    polys = polys.flatMap((p) => { const [a, b] = cut(p, 0, c); return [a, b].filter((q) => q.length >= 3); });
  }
  for (let kz = Math.floor(z0 / g.z - 0.5) + 1; (kz + 0.5) * g.z < z1; kz++) {
    const c = (kz + 0.5) * g.z;
    polys = polys.flatMap((p) => { const [a, b] = cut(p, 2, c); return [a, b].filter((q) => q.length >= 3); });
  }
  return polys;
}

/** The attributes of a chunked geometry (see chunkArrays): plain typed arrays, so a scene can memoize them (ctx.memo). */
export interface ChunkArrays { pos: Float32Array; nrm: Float32Array; uv: Float32Array; cel: Float32Array; chk: Float32Array }

/** A filter of the pieces: a piece with its middle at (x, z) is left out when it gives false. */
export type ChunkKeep = (x: number, z: number) => boolean;

/**
 * One geometry of the Builder kind (position, normal, aUv, aCell; not indexed), baked into the world by `matrix`, cut into chunks,
 * with `aChunk` = (ix, iz, kind). The kind (0, 1 or 2) picks the clock of `Unload`. `keep`: null keeps every piece.
 */
export function chunkGeometry(g: ChunkGrid, src: THREE.BufferGeometry, matrix: THREE.Matrix4, kind: number, keep: ChunkKeep | null): THREE.BufferGeometry {
  return chunkedGeometry(chunkArrays(g, src, matrix, kind, keep));
}

/** The geometry of chunkArrays' attributes. */
export function chunkedGeometry(a: ChunkArrays): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(a.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(a.nrm, 3));
  geo.setAttribute('aUv', new THREE.BufferAttribute(a.uv, 2));
  geo.setAttribute('aCell', new THREE.BufferAttribute(a.cel, 4));
  geo.setAttribute('aChunk', new THREE.BufferAttribute(a.chk, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** The attributes of chunkGeometry (the slow part: it cuts every triangle at the chunk borders). */
export function chunkArrays(g: ChunkGrid, src: THREE.BufferGeometry, matrix: THREE.Matrix4, kind: number, keep: ChunkKeep | null): ChunkArrays {
  const P = src.getAttribute('position'), N = src.getAttribute('normal'), UV = src.getAttribute('aUv'), CE = src.getAttribute('aCell');
  if (src.index) throw new Error('chunkGeometry: the geometry must not be indexed');
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], cel: number[] = [], chk: number[] = [];
  const tmp = new THREE.Vector3();
  const emit = (poly: Vtx[], cell: THREE.Vector4) => {
    let cx = 0, cz = 0;
    for (const v of poly) { cx += v[0]!; cz += v[2]!; }
    if (keep && !keep(cx / poly.length, cz / poly.length)) return;
    const ix = g.ixOf(cx / poly.length), iz = g.izOf(cz / poly.length);
    for (let i = 1; i + 1 < poly.length; i++) {
      for (const v of [poly[0]!, poly[i]!, poly[i + 1]!]) {
        pos.push(v[0]!, v[1]!, v[2]!);
        nrm.push(v[3]!, v[4]!, v[5]!);
        uv.push(v[6]!, v[7]!);
        cel.push(cell.x, cell.y, cell.z, cell.w);
        chk.push(ix, iz, kind);
      }
    }
  };
  const cell = new THREE.Vector4();
  for (let i = 0; i + 2 < P.count; i += 3) {
    const tri: Vtx[] = [];
    for (let k = 0; k < 3; k++) {
      tmp.fromBufferAttribute(P, i + k).applyMatrix4(matrix);
      const n = new THREE.Vector3().fromBufferAttribute(N, i + k).applyMatrix3(nm).normalize();
      tri.push([tmp.x, tmp.y, tmp.z, n.x, n.y, n.z, UV.getX(i + k), UV.getY(i + k)]);
    }
    cell.set(CE.getX(i), CE.getY(i), CE.getZ(i), CE.getW(i));
    const xs = tri.map((v) => v[0]!), zs = tri.map((v) => v[2]!);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    if (x1 - x0 <= g.x && z1 - z0 <= g.z) { emit(tri, cell); continue; }
    for (const p of cutToChunks(g, tri, x0, x1, z0, z1)) emit(p, cell);
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), cel: new Float32Array(cel), chk: new Float32Array(chk) };
}

/**
 * Replaces every plain mesh under `root` (not instanced) by a chunked, world-baked copy under `parent` with the material `mat`.
 * `kindOf` tells the kind of a mesh. The old meshes are removed from the scene (not deleted: the geometry is freed). A mesh that is
 * hidden stays hidden: it is not copied.
 */
export function chunkTree(g: ChunkGrid, root: THREE.Object3D, parent: THREE.Object3D, mat: THREE.Material, kindOf: (m: THREE.Mesh) => number) {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && o.geometry.getAttribute('aChunk') === undefined) meshes.push(o); });
  parent.updateMatrixWorld(true);
  const parentInv = parent.matrixWorld.clone().invert();
  for (const m of meshes) {
    if (!m.visible) { m.removeFromParent(); continue; }
    const geo = chunkGeometry(g, m.geometry, m.matrixWorld.clone().premultiply(parentInv), kindOf(m), null);
    const c = new THREE.Mesh(geo, mat);
    c.castShadow = m.castShadow;
    c.receiveShadow = m.receiveShadow;
    c.frustumCulled = false;
    m.removeFromParent();
    m.geometry.dispose();
    parent.add(c);
  }
}
