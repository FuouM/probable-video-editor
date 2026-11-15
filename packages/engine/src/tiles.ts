// Per-tile refinement of the adaptive motion blur (see Engine.render): the sampling error per block and per
// tile, which tiles still refine, the tile mask in the depth buffers of the masked targets, and the final
// average with a gain per tile.
import * as THREE from 'three';
import { FSPass, PW, PH, SCALE, clearRT, compositeFrag, makeRT } from './gl';
import { SHOULDER_GLSL } from './post';

/** Error block side in physical px (2x2 logical px), and error blocks per tile side. */
const B = 2 * SCALE, R = 16;
const EW = Math.ceil(PW / B), EH = Math.ceil(PH / B);
/** Physical px per tile side. */
const TP = B * R;
const SMALL = { depthBuffer: false, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, pxScale: 1 } as const;
/**
 * Sampling error: per block of B x B physical px, how far the displayed average moves when a step's new
 * sub-frames (2n, summed in b) are merged with the n before them (summed in a). With `tiles`, the error of
 * tiles no longer refining is forced to 0 (their sums hold nothing new).
 */
function errFrag(tiles: boolean) {
  return /* glsl */ `
      uniform sampler2D a; uniform sampler2D b; uniform float invA, invB;${tiles ? ' uniform sampler2D tiles;' : ''}
      ${SHOULDER_GLSL}
      vec3 disp(vec3 x) { return toSRGB(sat(shoulder(max(x, 0.0)))); }
      void main() {
        ivec2 p0 = ivec2(gl_FragCoord.xy) * ${B}, lim = ivec2(${PW - 1}, ${PH - 1});
        vec3 sa = vec3(0.0), sb = vec3(0.0);
        for (int y = 0; y < ${B}; y++) for (int x = 0; x < ${B}; x++) {
          ivec2 p = min(p0 + ivec2(x, y), lim);
          sa += texelFetch(a, p, 0).rgb; sb += texelFetch(b, p, 0).rgb;
        }
        vec3 e = abs(disp(sa * (invA / ${B * B}.0)) - disp(sb * (invB / ${B * B}.0)));${tiles ? `
        float on = texelFetch(tiles, ivec2(gl_FragCoord.xy) / ${R}, 0).r;` : ''}
        fragColor = vec4(170.0 * max(e.r, max(e.g, e.b))${tiles ? ' * on' : ''}, 0.0, 0.0, 1.0);
      }`;
}

/** Call `f` with the index of every tile in the 3x3 neighbourhood of tile (x, y) that lies inside the tw x th grid. */
function around(tw: number, th: number, x: number, y: number, f: (i: number) => void) {
  for (let yy = Math.max(0, y - 1); yy <= Math.min(th - 1, y + 1); yy++)
    for (let xx = Math.max(0, x - 1); xx <= Math.min(tw - 1, x + 1); xx++) f(yy * tw + xx);
}

/** Result of TileRefiner.refine. */
export interface TileRefineResult {
  /** The frame's sub-frame count (the count of the tiles that refined longest). */
  n: number;
  /** Tiles stopped at different counts: average with TileRefiner.average, not one gain. */
  perTile: boolean;
  /** Estimated sampling error after each step. */
  errors: number[];
  /** Share of the extra sub-frames (beyond the first set) actually shaded, or undefined when no step ran. */
  shaded?: number;
}

/**
 * Adaptive per-tile sampling. A tile is one texel of maxRT (R x R error blocks). It owns the error passes,
 * which tiles still refine (tileOn, 255) and the gain (1 / its sub-frame count) each tile's sum is averaged with.
 */
export class TileRefiner {
  readonly errPass = new FSPass(errFrag(false), { a: { value: null }, b: { value: null }, invA: { value: 1 }, invB: { value: 1 } });
  readonly errRT = makeRT(EW, EH, SMALL);
  readonly maxRT = makeRT(Math.ceil(EW / R), Math.ceil(EH / R), SMALL);
  readonly maxPass = new FSPass(/* glsl */ `
      uniform sampler2D e;
      void main() {
        ivec2 p0 = ivec2(gl_FragCoord.xy) * ${R};
        float m = 0.0;
        for (int y = 0; y < ${R}; y++) for (int x = 0; x < ${R}; x++) {
          ivec2 p = p0 + ivec2(x, y);
          if (p.x < ${EW} && p.y < ${EH}) m = max(m, texelFetch(e, p, 0).r);
        }
        fragColor = vec4(m, 0.0, 0.0, 1.0);
      }`, { e: { value: null } });
  private errBuf = new Float32Array(this.maxRT.width * this.maxRT.height * 4);
  readonly tileOn: Uint8Array;
  readonly tileTex: THREE.DataTexture;
  readonly gainBuf: Float32Array;
  readonly gainTex: THREE.DataTexture;
  private maskPass: FSPass;
  readonly errTilePass: FSPass;
  readonly gainPass: FSPass;
  /**
   * The targets that carry the tile mask, with the margin (in tiles) it is widened by: the engine's own
   * (everything a sub-frame's scenes draw into) and the targets scenes declare in Scene.tileMasked.
   */
  readonly maskedRTs = new Map<THREE.WebGLRenderTarget, { margin: number; moving?: boolean }>();
  private tileOnWide: Uint8Array;
  private tileTexWide: THREE.DataTexture;
  private nextTileOn: Uint8Array;
  /** Masking: draws into maskedRTs are depth-tested against the mask. `depthSeen`: a draw there wanted its own depth test. */
  masking = false;
  depthSeen = false;
  /** Timeline entries seen drawing with a depth test of their own: never masked (their 3D needs the depth buffer). */
  readonly depthEntries = new Set<string>();

  /** `sums`: the sum of the sub-frames so far (a) and of a step's new ones (b). */
  constructor(private renderer: THREE.WebGLRenderer, private sums: { sumRT: THREE.WebGLRenderTarget; newRT: THREE.WebGLRenderTarget }) {
    const tw = this.maxRT.width, th = this.maxRT.height;
    this.tileOn = new Uint8Array(tw * th);
    this.tileTex = new THREE.DataTexture(this.tileOn, tw, th, THREE.RedFormat, THREE.UnsignedByteType);
    this.tileOnWide = new Uint8Array(tw * th);
    this.tileTexWide = new THREE.DataTexture(this.tileOnWide, tw, th, THREE.RedFormat, THREE.UnsignedByteType);
    this.nextTileOn = new Uint8Array(tw * th);
    this.gainBuf = new Float32Array(tw * th);
    this.gainTex = new THREE.DataTexture(this.gainBuf, tw, th, THREE.RedFormat, THREE.FloatType);
    for (const t of [this.tileTex, this.tileTexWide, this.gainTex]) { t.unpackAlignment = 1; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; }
    // the tile mask in a depth buffer: 1 where a tile still refines, 0 where it has converged
    // (map: the target's px to output px, gl_FragCoord.xy * map.xy + map.zw)
    this.maskPass = new FSPass(/* glsl */ `
      uniform sampler2D tiles; uniform vec4 map;
      void main() {
        vec2 p = gl_FragCoord.xy * map.xy + map.zw;
        if (p.x < 0.0 || p.y < 0.0 || p.x >= ${PW}.0 || p.y >= ${PH}.0) discard;
        if (texelFetch(tiles, ivec2(floor(p / ${TP}.0)), 0).r < 0.5) discard;
        gl_FragDepth = 1.0;
        fragColor = vec4(0.0);
      }`, { tiles: { value: this.tileTex }, map: { value: new THREE.Vector4(1, 1, 0, 0) } });
    const mm = this.maskPass.mat;
    mm.colorWrite = false; mm.depthTest = true; mm.depthWrite = true; mm.depthFunc = THREE.AlwaysDepth;
    this.hookDepthState();
    this.errTilePass = new FSPass(errFrag(true), { a: { value: null }, b: { value: null }, invA: { value: 1 }, invB: { value: 1 }, tiles: { value: this.tileTex } });
    // the final average with a gain per tile: the Compositor's 'replace' draw (same uv maths, so a tile
    // comes out exactly as the whole-frame average at its count would) with opacity read from gainTex
    this.gainPass = new FSPass(
      compositeFrag('uniform sampler2D gain;', `texelFetch(gain, ivec2(gl_FragCoord.xy) / ${TP}, 0).r`),
      { tex: { value: null }, tint: { value: new THREE.Vector3(1, 1, 1) }, uvXform: { value: new THREE.Vector4(1, 1, 0, 0) }, premult: { value: false }, gain: { value: this.gainTex } },
    );
  }

  /**
   * Masked drawing for per-tile refinement. While `masking` is on, every draw into one of maskedRTs is
   * depth-tested (LEQUAL, no depth writes, clears included) against the tile mask, whatever its material
   * says: the draws scenes make are at depth <= 1, so they pass where the mask is 1 and converged tiles
   * (mask 0) are rejected before their fragments are shaded (early-Z). Draws into other targets (scenes'
   * own) keep their materials' depth state. A material that wants its own depth test while drawing into a
   * masked target sets depthSeen (its sub-frame is then drawn again unmasked, see Engine.render).
   */
  private hookDepthState() {
    const r = this.renderer, st = r.state, d = st.buffers.depth;
    const setTest = d.setTest.bind(d), setFunc = d.setFunc.bind(d), setMask = d.setMask.bind(d);
    let forced = false;
    const force = (on: boolean) => {
      if (on === forced) return;
      forced = on;
      if (on) { setTest(true); setFunc(THREE.LessEqualDepth); setMask(false); }
    };
    d.setTest = (v: boolean) => { if (!forced) setTest(v); };
    d.setFunc = (f: THREE.DepthModes) => { if (!forced) setFunc(f); };
    d.setMask = (m: boolean) => { if (!forced) setMask(m); };
    const setRenderTarget = r.setRenderTarget.bind(r);
    r.setRenderTarget = (target, ...rest) => {
      setRenderTarget(target, ...rest);
      force(this.masking && !!target && this.maskedRTs.has(target as THREE.WebGLRenderTarget));
    };
    const setMaterial = st.setMaterial.bind(st);
    st.setMaterial = (m, ...rest) => {
      if (forced && m.depthTest) this.depthSeen = true;
      setMaterial(m, ...rest);
    };
    this.setMasking = (on: boolean) => {
      this.masking = on;
      const t = r.getRenderTarget();
      force(on && !!t && this.maskedRTs.has(t));
    };
  }
  setMasking: (on: boolean) => void = () => {};

  /** Write tileOn into the depth buffer of the masked targets (1 = still refining, 0 = converged). */
  writeTileMask() {
    const was = this.masking;
    if (was) this.setMasking(false);
    this.tileTex.needsUpdate = true;
    // the mask widened by a tile, for scene targets read a little off the pixel
    const on = this.tileOn, wide = this.tileOnWide, tw = this.maxRT.width, th = this.maxRT.height;
    wide.fill(0);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      if (on[y * tw + x]) around(tw, th, x, y, (i) => { wide[i] = 255; });
    }
    this.tileTexWide.needsUpdate = true;
    // (a moving target is drawn whole unless its scene maps the mask, see mapTileMask)
    for (const [rt, m] of this.maskedRTs) this.drawMask(rt, m.margin, m.moving ? null : new THREE.Vector4(PW / rt.width, PH / rt.height, 0, 0));
    if (was) this.setMasking(true);
  }

  /** Write the tile mask into rt's depth buffer, through `map` (rt px -> output px); null: all of rt on. */
  drawMask(rt: THREE.WebGLRenderTarget, margin: number, map: THREE.Vector4 | null) {
    const r = this.renderer, d = r.state.buffers.depth;
    r.setRenderTarget(rt);
    if (!map) { r.clear(false, true, false); return; }
    d.setClear(0);
    r.clear(false, true, false);
    d.setClear(1);
    this.maskPass.u.tiles!.value = margin ? this.tileTexWide : this.tileTex;
    (this.maskPass.u.map!.value as THREE.Vector4).copy(map);
    this.maskPass.render(r, rt);
  }

  /** SceneCtx.mapTileMask: `map` takes rt uv to screen uv. */
  mapTileMask(rt: THREE.WebGLRenderTarget, map: THREE.Vector4 | null) {
    const m = this.maskedRTs.get(rt);
    if (!this.masking || !m?.moving) return;
    const r = this.renderer, prev = r.getRenderTarget(), x = new THREE.Vector4();
    if (map) x.set((map.x * PW) / rt.width, (map.y * PH) / rt.height, map.z * PW, map.w * PH);
    this.setMasking(false);
    this.drawMask(rt, m.margin, map ? x : null);
    this.setMasking(true);
    r.setRenderTarget(prev);
  }

  /**
   * How far the displayed frame (8-bit levels, worst block) moves when the 2n sub-frames summed in newRT
   * are merged with the n summed in sumRT. Stepped copies of a fast edge differ between the two
   * interleaved sets; a converged streak does not.
   */
  sampleError(n: number, tiles = false) {
    const r = this.renderer;
    // (with some tiles stopped, the error of those is forced to 0: their sums hold nothing new)
    const p = tiles ? this.errTilePass : this.errPass;
    p.u.a!.value = this.sums.sumRT.texture;
    p.u.b!.value = this.sums.newRT.texture;
    p.u.invA!.value = 1 / n;
    p.u.invB!.value = 1 / (2 * n);
    p.render(r, this.errRT);
    this.maxPass.u.e!.value = this.errRT.texture;
    this.maxPass.render(r, this.maxRT);
    r.readRenderTargetPixels(this.maxRT, 0, 0, this.maxRT.width, this.maxRT.height, this.errBuf);
    let m = 0;
    for (let i = 0; i < this.errBuf.length; i += 4) m = Math.max(m, this.errBuf[i]!);
    return m;
  }

  /**
   * Per-tile refinement from n sub-frames for up to `steps` steps: after each set, a tile goes on to the next
   * only while it or one of its 8 neighbours is still at or over `tol`; a tile that stopped never restarts.
   * Later sub-frames are drawn with converged tiles masked out by the depth test (rejected before shading),
   * only the tiles still refining are added to the sums, and each tile is averaged over its own count. So
   * every tile is exactly the whole-frame sampler's frame had it stopped at that tile's count.
   * `drawSet(n)`: sum sub-frames n..3n-1 into newRT (cleared before). `merge()`: add newRT to sumRT.
   */
  refine(n: number, steps: number, tol: number, drawSet: (n: number) => void, merge: () => void): TileRefineResult {
    const on = this.tileOn, tw = this.maxRT.width, th = this.maxRT.height, T = on.length;
    on.fill(255); // (an R8 texture: 255 reads as 1.0)
    const tileN = this.gainBuf; // count per tile, turned into the gain at the end
    tileN.fill(0);
    const errors: number[] = [];
    let live = T, shaded = 0, full = 0;
    for (let l = 0; l < steps && live > 0; l++) {
      const masked = live < T;
      clearRT(this.renderer, this.sums.newRT, [0, 0, 0], 0);
      if (masked) { this.writeTileMask(); this.setMasking(true); }
      drawSet(n);
      if (masked) this.setMasking(false);
      const err = this.sampleError(n, masked) / 2;
      errors.push(err);
      if (masked) this.setMasking(true);
      merge();
      if (masked) this.setMasking(false);
      shaded += 2 * n * live; full += 2 * n * T;
      n *= 3;
      // tiles whose neighbourhood is converged stop at this count
      const e = this.errBuf, next = this.nextTileOn;
      next.fill(0);
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const i = y * tw + x;
        if (!on[i]) continue;
        let m = 0;
        around(tw, th, x, y, (j) => { m = Math.max(m, e[j * 4]!); });
        if (m / 2 >= tol) next[i] = 255;
        else { tileN[i] = n; live--; }
      }
      on.set(next);
    }
    let perTile = false;
    if (full === 0) return { n, perTile, errors };
    // tiles still refining when the sets ran out end at the last count, which is the frame's
    for (let i = 0; i < T; i++) if (on[i]) tileN[i] = n;
    perTile = tileN.some((c) => c !== n);
    if (perTile) { for (let i = 0; i < T; i++) tileN[i] = 1 / tileN[i]!; this.gainTex.needsUpdate = true; }
    return { n, perTile, errors, shaded: shaded / full };
  }

  /** The per-tile average of `src` (a sum) into `target`, with each tile's gain from refine. */
  average(src: THREE.Texture, target: THREE.WebGLRenderTarget) {
    this.gainPass.u.tex!.value = src;
    this.gainPass.render(this.renderer, target);
  }

  dispose() {
    this.errRT.dispose();
    this.maxRT.dispose();
    this.tileTex.dispose();
    this.gainTex.dispose();
    this.errPass.dispose();
    this.errTilePass.dispose();
    this.maxPass.dispose();
    this.gainPass.dispose();
    this.maskPass.dispose();
  }
}
