// `pve nan`: finds the draw call that writes NaN or Inf into a float target. On the next 8-bit pass such a texel shows as a
// black dot (or a black block, after a blur or a bloom), and a backend can make NaN where another makes 0 (normalize of a
// zero vector, pow of a negative base, 0/0).
// The command renders each time with a hook on each draw call. After a draw, a small GPU pass reads the draw's target and
// writes one tile into an atlas: 64 x 36 blocks of the target, each the count of its texels that are not finite (an
// exponent of all ones: a bit test, which no compiler can fold away as it can fold isnan). The page reads the atlas back
// once at the end of the frame, so the GPU never stalls between draws and a frame takes about as long as a normal render.
// A draw that adds such texels to its target is a source. The counts are exact, the box is in whole blocks (30 x 30 px of a
// 1920x1080 target). `--at x,y` follows one point of the frame through every draw, to the texel.
import type { Page } from 'playwright-core';
import { deadline, FRAME_MS, withPage, type PveWindow } from './browser';

/** One draw call that left texels that are not finite in its target. */
export interface NanDraw {
  /** The index of the draw call in the frame. */
  call: number;
  /** What was drawn: target size and type, object, material. */
  key: string;
  /** Where the page called the draw: the first frames of the call stack outside three (file:line). */
  from: string;
  /** Texels of the target that are not finite after the draw (NaN and Inf), and how many of them this draw added. */
  nan: number;
  inf: number;
  added: number;
  /** The box of those texels in frame px (1920x1080, y down), in whole blocks (1/64 x 1/36 of the target). */
  box: [number, number, number, number];
}

/** The value of the `--at` point in the target of one draw call (only when it changed since the last draw into that target). */
export interface NanTrace { call: number; key: string; from: string; value: number[] }

export interface NanFrame { t: number; draws: number; sources: NanDraw[]; later: NanDraw[]; trace: NanTrace[] }

export interface NanOptions {
  project: string;
  only: string | undefined;
  hdr: 'half' | 'float';
  times: number[];
  /** A point of the frame (1920x1080 px, y down) to follow through the draws, or null. */
  at: [number, number] | null;
}

/** The parts of three's renderer and render targets that the hook reads. */
interface HookTarget { width: number; height: number; samples: number; isWebGLCubeRenderTarget?: boolean; isWebGL3DRenderTarget?: boolean; isWebGLArrayRenderTarget?: boolean; texture: { type: number; uuid: string } }
interface HookMaterial { type: string; name: string; id: number }
interface HookObject { type: string; name: string }
type HookFn = (camera: unknown, scene: unknown, geometry: unknown, material: HookMaterial, object: HookObject, group: unknown) => void;
interface HookRenderer {
  renderBufferDirect: HookFn;
  getRenderTarget(): HookTarget | null;
  getContext(): WebGL2RenderingContext;
  properties: { get(o: object): { __webglTexture?: WebGLTexture } };
}

async function scanFrame(page: Page, t: number, at: [number, number] | null): Promise<Omit<NanFrame, 't'>> {
  return deadline(page.evaluate(async ({ t, at }) => {
    const p = (window as unknown as PveWindow).__pve!;
    // the export API types the engine only as far as the commands use it: the renderer is three's
    const engine = p.engine as unknown as { renderer: HookRenderer };
    const r = engine.renderer;
    const gl = r.getContext();
    const W = 1920, H = 1080;
    // the atlas: one tile of TW x (TH + 1) texels per draw call, the last row holds the --at value
    const TW = 64, TH = 36, COLS = 32, ROWS = 64;
    type Kit = { prog: WebGLProgram; vao: WebGLVertexArrayObject; fbo: WebGLFramebuffer; atlas: WebGLTexture; u: Record<string, WebGLUniformLocation | null> };
    const store = window as unknown as { __pveNan?: Kit };
    if (!store.__pveNan) {
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('nan: the GPU cannot render to float targets (EXT_color_buffer_float)');
      const sh = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`nan: ${gl.getShaderInfoLog(s)}`);
        return s;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
void main() { vec2 v = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0); }`));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uSrc;
uniform ivec2 uSize, uTile, uAt;
out vec4 o;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy) - uTile;
  if (q.y == ${TH}) { o = q.x == 0 ? texelFetch(uSrc, uAt, 0) : vec4(0.0); return; }
  ivec2 a = q * uSize / ivec2(${TW}, ${TH}), b = (q + 1) * uSize / ivec2(${TW}, ${TH});
  float nan = 0.0, inf = 0.0;
  for (int y = a.y; y < b.y; y++) for (int x = a.x; x < b.x; x++) {
    uvec4 v = floatBitsToUint(texelFetch(uSrc, ivec2(x, y), 0));
    // exponent all ones: Inf (mantissa 0) or NaN
    bvec4 e = equal(v & 0x7f800000u, uvec4(0x7f800000u));
    bvec4 m = notEqual(v & 0x007fffffu, uvec4(0u));
    if (any(e)) { if (any(bvec4(e.x && m.x, e.y && m.y, e.z && m.z, e.w && m.w))) nan += 1.0; else inf += 1.0; }
  }
  o = vec4(nan, inf, 0.0, 1.0);
}`));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`nan: ${gl.getProgramInfoLog(prog)}`);
      const atlas = gl.createTexture()!;
      const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, TW * COLS, (TH + 1) * ROWS);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      const fbo = gl.createFramebuffer()!;
      const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, atlas, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
      const u: Kit['u'] = {};
      for (const n of ['uSrc', 'uSize', 'uTile', 'uAt']) u[n] = gl.getUniformLocation(prog, n);
      store.__pveNan = { prog, vao: gl.createVertexArray()!, fbo, atlas, u };
    }
    const kit = store.__pveNan;
    const UNIT = (gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number) - 1;

    /** The block tile of the target of the last draw into atlas slot `slot` (GL state saved and restored for three). */
    const tile = (tex: WebGLTexture, w: number, h: number, slot: number) => {
      const fbDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), fbRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      const vp = gl.getParameter(gl.VIEWPORT) as Int32Array, prog = gl.getParameter(gl.CURRENT_PROGRAM), vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      const active = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
      const caps = [gl.BLEND, gl.DEPTH_TEST, gl.SCISSOR_TEST, gl.STENCIL_TEST, gl.CULL_FACE, gl.RASTERIZER_DISCARD].map((c) => [c, gl.isEnabled(c)] as const);
      const mask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
      gl.activeTexture(gl.TEXTURE0 + UNIT);
      const unitTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.bindFramebuffer(gl.FRAMEBUFFER, kit.fbo);
      const x = (slot % COLS) * TW, y = Math.floor(slot / COLS) * (TH + 1);
      gl.viewport(x, y, TW, TH + 1);
      for (const [c] of caps) gl.disable(c);
      gl.colorMask(true, true, true, true);
      gl.useProgram(kit.prog);
      gl.bindVertexArray(kit.vao);
      gl.uniform1i(kit.u.uSrc!, UNIT);
      gl.uniform2i(kit.u.uSize!, w, h);
      gl.uniform2i(kit.u.uTile!, x, y);
      gl.uniform2i(kit.u.uAt!, at ? Math.min(w - 1, Math.floor((at[0] / W) * w)) : 0, at ? Math.min(h - 1, Math.floor((1 - at[1] / H) * h)) : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // three keeps a copy of this state: put back exactly what it set
      gl.bindVertexArray(vao);
      gl.useProgram(prog);
      gl.colorMask(mask[0]!, mask[1]!, mask[2]!, mask[3]!);
      for (const [c, on] of caps) if (on) gl.enable(c);
      gl.viewport(vp[0]!, vp[1]!, vp[2]!, vp[3]!);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbDraw);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbRead);
      gl.bindTexture(gl.TEXTURE_2D, unitTex);
      gl.activeTexture(active);
    };

    // the caller of the draw: stack frames outside three and outside this hook, as file:line
    const from = (): string => {
      const out: string[] = [];
      for (const l of (new Error().stack ?? '').split('\n').slice(1)) {
        const m = /https?:\/\/[^/\s]+\/(?:@fs\/)?([^\s)?]+)(?:\?[^\s)]*)?:(\d+):\d+/.exec(l);
        // three (a bundled dependency) and the page's own render wrapper (src/main.ts) say nothing about the scene
        if (!m || /\/deps\/|^src\/main\.ts$/.test(m[1]!)) continue;
        out.push(`${m[1]!.replace(/^.*\/(projects|packages)\//, '$1/')}:${m[2]}`);
        if (out.length === 3) break;
      }
      return out.join(' < ') || '?';
    };

    const TYPE: Record<number, string> = { 1009: 'u8', 1015: 'f32', 1016: 'f16' };
    const calls: { call: number; slot: number; key: string; from: string; id: string; w: number; h: number }[] = [];
    let call = 0;
    const base = r.renderBufferDirect;
    r.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
      base.call(r, camera, scene, geometry, material, object, group);
      const k = call++;
      const rt = r.getRenderTarget();
      // the canvas, cube, 3D and array targets are not read; a multisampled target is resolved only after the render
      if (!rt || rt.samples > 0 || rt.isWebGLCubeRenderTarget || rt.isWebGL3DRenderTarget || rt.isWebGLArrayRenderTarget) return;
      const type = TYPE[rt.texture.type];
      const tex = r.properties.get(rt.texture).__webglTexture;
      if (type === undefined || !tex) return;
      const slot = calls.length;
      if (slot >= COLS * ROWS) throw new Error(`nan: more than ${COLS * ROWS} draws into targets in one frame`);
      tile(tex, rt.width, rt.height, slot);
      calls.push({ call: k, slot, key: `${rt.width}x${rt.height} ${type} ${object.type} "${object.name}" ${material.type} "${material.name}" [material ${material.id}]`, from: from(), id: rt.texture.uuid, w: rt.width, h: rt.height });
    };
    try {
      p.still(t, 1, 0.5);
    } finally {
      r.renderBufferDirect = base;
    }
    await p.engine.readPixelsAsync();

    // one readback of the rows of the atlas that the frame used
    const rows = Math.ceil(calls.length / COLS) * (TH + 1);
    const atlas = new Float32Array(TW * COLS * Math.max(rows, 1) * 4);
    if (calls.length) {
      const prevFb = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, kit.fbo);
      gl.readPixels(0, 0, TW * COLS, rows, gl.RGBA, gl.FLOAT, atlas);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevFb);
    }
    const sources: NanDraw[] = [], later: NanDraw[] = [], trace: NanTrace[] = [];
    const bad: Record<string, number> = {}, lastAt: Record<string, string> = {};
    for (const c of calls) {
      const x = (c.slot % COLS) * TW, y = Math.floor(c.slot / COLS) * (TH + 1);
      const texel = (i: number, j: number) => ((y + j) * TW * COLS + x + i) * 4;
      let nan = 0, inf = 0, bx0 = TW, by0 = TH, bx1 = -1, by1 = -1;
      for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
        const o = texel(i, j), n = atlas[o]!, f = atlas[o + 1]!;
        if (n + f === 0) continue;
        nan += n; inf += f;
        bx0 = Math.min(bx0, i); bx1 = Math.max(bx1, i); by0 = Math.min(by0, j); by1 = Math.max(by1, j);
      }
      if (at) {
        const o = texel(0, TH), v = Array.from(atlas.subarray(o, o + 4));
        const s = v.join(' ');
        if (lastAt[c.id] !== s) { lastAt[c.id] = s; trace.push({ call: c.call, key: c.key, from: c.from, value: v }); }
      }
      const before = bad[c.id] ?? 0;
      bad[c.id] = nan + inf;
      if (nan + inf === 0) continue;
      // blocks to frame px, y down (the target is y up)
      const box: NanDraw['box'] = [Math.floor((bx0 / TW) * W), Math.floor((1 - (by1 + 1) / TH) * H), Math.ceil(((bx1 + 1) / TW) * W) - 1, Math.ceil((1 - by0 / TH) * H) - 1];
      const d: NanDraw = { call: c.call, key: c.key, from: c.from, nan, inf, added: Math.max(0, nan + inf - before), box };
      (d.added > 0 ? sources : later).push(d);
    }
    return { draws: call, sources, later, trace };
  }, { t, at }), FRAME_MS, `scanning ${t}`);
}

/** Renders each time with the hook, one frame after the other on one page, and hands each result to `onFrame` as it comes. */
export async function runNan(o: NanOptions, onFrame: (f: NanFrame) => void): Promise<NanFrame[]> {
  return withPage(o.project, { only: o.only, hdr: o.hdr, warm: true }, async (page) => {
    const frames: NanFrame[] = [];
    for (const t of o.times) {
      const f = { t, ...(await scanFrame(page, t, o.at)) };
      frames.push(f);
      onFrame(f);
    }
    return frames;
  });
}
