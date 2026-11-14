// `pve order`: finds the frame that leaves state behind. A frame must be a pure function of its time, so the target frame must
// give the same pixels after any other frames. The command renders the target on a new page (the reference), then renders it
// again after other frames and compares.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { closeBrowser, deadline, ensureServer, FRAME_MS, openPage, type PveWindow } from './browser';
import { decodePng, diffImages, encodePng, type Image } from './png';

/** mulberry32: a small seeded PRNG in [0, 1). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The times of the determinism check (scripts/determinism.ts): `n` seeded random times in time order, and the same times shuffled. */
export function seededTimes(seed: number, n: number, duration: number): { times: number[]; shuffled: number[] } {
  const rand = rng(seed);
  const times = Array.from({ length: n }, () => Math.round(rand() * duration * 1000) / 1000).sort((a, b) => a - b);
  const shuffled = [...times];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return { times, shuffled };
}

/** One comparison of the target against the reference. `after`: the frames rendered before the target in this trial. */
export interface OrderRow {
  after: number[];
  same: boolean;
  maxDiff: number;
  pixels: number;
  box: [number, number, number, number] | null;
  /** The mask file (white: a pixel that differs), when `png` is set and the pictures differ. */
  mask: string | null;
  /** How the draw calls differ from the reference, when `draws` is set and the pictures differ. */
  draws: string | null;
}

export interface OrderOptions {
  project: string;
  /** The clips that the page loads (comma-separated ids): the clips of the target and of the other frames. Fewer clips load faster. */
  only: string;
  /** The precision of the lit HDR targets. A fault that shows at `half` (16-bit) and not at `float` (32-bit) is the GPU's blend rounding, not an order fault. */
  hdr: 'half' | 'float';
  target: number;
  after: number[];
  /**
   * `each`: one page. For each time: render it, then the target (state can stay from the trials before).
   * `fresh`: a new page for each time: render it, then the target.
   * `chain`: a new page: render all the times in the given order, then the target.
   * `bisect`: as `chain`, then remove times while the target still differs (new page for each trial). The result is a
   * short list of frames that are enough to change the target.
   */
  mode: 'each' | 'fresh' | 'chain' | 'bisect';
  /** Folder for the reference PNG, the PNG of each trial that differs, and its mask. */
  png: string | null;
  /** Compare the draw calls of the target frame too (what three drew, in which order, with which inputs). */
  draws: boolean;
  /**
   * With `draws`: -1 reads no pictures back (the inputs of the draws only: a readback after each draw is slow and can hide a fault).
   * -2 reads the picture back after each draw and compares the digests. A call number reads back after that call only: on one page,
   * the output of that call of the reference is kept and each trial says how its output differs from it.
   */
  watch: number;
  /** JavaScript that runs on the page before the target of each trial, with `e` = the engine (`e.renderer` is three's renderer). It tests a guess: if a reset here makes the target right, that state is the fault. Empty: none. */
  between: string;
  /** `chain`: the number of times to run the same trial, each on a new page (a result that changes is not an order fault: it is random). */
  repeat: number;
  log: (line: string) => void;
}

/** The parts of the page's renderer and its draw arguments that the draw log reads. */
interface DrawTarget { width: number; height: number; texture: { type: number } }
interface DrawAttribute { count: number; array?: ArrayBufferView; data?: { array: ArrayBufferView } }
interface DrawGeometry { attributes: Record<string, DrawAttribute> }
interface DrawMaterial { id: number; type: string; name: string; transparent: boolean; blending: number; opacity: number }
interface DrawMatrix { elements: number[] }
interface DrawObject { id: number; type: string; name: string; count?: number; renderOrder: number; matrixWorld: DrawMatrix; instanceMatrix?: DrawAttribute | null; instanceColor?: DrawAttribute | null }
interface DrawCamera { matrixWorldInverse: DrawMatrix; projectionMatrix: DrawMatrix }
type DrawFn = (camera: DrawCamera, scene: unknown, geometry: DrawGeometry, material: DrawMaterial, object: DrawObject, group: unknown) => void;
interface DrawRenderer { renderBufferDirect: DrawFn; getRenderTarget(): DrawTarget | null; getContext(): WebGL2RenderingContext; properties: { get(m: DrawMaterial): { uniforms?: Record<string, { value: unknown }> } } }
interface DrawEngine { renderer: DrawRenderer }

/**
 * One draw call of the target frame. `key` says what was drawn (the same on every page). `ids` are three's object and material ids
 * (they depend on what the page made before). `data` has one digest for each input of the draw: `pose` (object and camera matrices),
 * `attr.<name>` (vertex data), `instanceMatrix`, `instanceColor`, `opacity` and `u.<name>` (each uniform; a data texture by its pixels).
 * `out` is the digest of the colour target after the draw (targets up to 1920x1080).
 */
interface Draw { key: string; ids: string; data: Record<string, string> }

/** Renders `seq` in order on the page. Returns the SHA-256 of the last frame, and its draw calls when `draws` is set. */
async function renderSeq(page: Page, seq: number[], draws: boolean, watch: number, between: string): Promise<{ hash: string; draws: Draw[]; watch: string | null }> {
  return deadline(page.evaluate(async ({ seq, draws, watch, between }) => {
    const reset = between === '' ? null : new Function('e', between) as (engine: unknown) => void;
    const store = window as unknown as { __pveOrderWatch?: Float32Array | Uint8Array };
    let watched: string | null = null;
    const p = (window as unknown as PveWindow).__pve!;
    const r = (p.engine as unknown as DrawEngine).renderer;
    const log: Draw[] = [];
    // FNV-1a digests of typed arrays, read as bytes. The digest of a large array is kept for the frame (many draws share one array).
    const seen = new Map<ArrayBufferView, string>();
    const raw = (a: ArrayBufferView): string => {
      const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      let h = 0x811c9dc5;
      for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 0x01000193);
      return `${b.length}:${(h >>> 0).toString(16)}`;
    };
    const bytes = (a: ArrayBufferView): string => {
      if (a.byteLength < 65536) return raw(a);
      const old = seen.get(a);
      if (old !== undefined) return old;
      const s = raw(a);
      seen.set(a, s);
      return s;
    };
    const dig = (v: unknown, depth: number): string => {
      if (v === null || v === undefined) return 'null';
      if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return String(v);
      if (ArrayBuffer.isView(v)) return bytes(v);
      if (Array.isArray(v)) return `[${v.map((x) => dig(x, depth + 1)).join(',')}]`;
      if (typeof v !== 'object' || depth > 4) return '?';
      const o = v as Record<string, unknown>;
      if (o.isTexture === true) {
        const image = (o.image ?? null) as Record<string, unknown> | null;
        const data = image ? image.data : null;
        return `tex ${image ? `${String(image.width)}x${String(image.height)}` : ''} ${ArrayBuffer.isView(data) ? bytes(data) : ''}`;
      }
      if (typeof o.toArray === 'function') return dig((o.toArray as () => unknown)(), depth + 1);
      return `{${Object.keys(o).sort().map((k) => `${k}:${dig(o[k], depth + 1)}`).join(',')}}`;
    };
    const attr = (a: DrawAttribute): string => (a.data ? bytes(a.data.array) : a.array ? bytes(a.array) : 'none');
    let px = new Uint8Array(0);
    for (let i = 0; i < seq.length; i++) {
      const hook = draws && i === seq.length - 1, base = r.renderBufferDirect;
      if (hook) r.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
        const rt = r.getRenderTarget(), pos = geometry.attributes.position;
        const data: Record<string, string> = {
          pose: dig([object.matrixWorld.elements, camera.matrixWorldInverse.elements, camera.projectionMatrix.elements], 0),
          opacity: String(material.opacity),
        };
        for (const k of Object.keys(geometry.attributes)) data[`attr.${k}`] = attr(geometry.attributes[k]!);
        if (object.instanceMatrix) data.instanceMatrix = attr(object.instanceMatrix);
        if (object.instanceColor) data.instanceColor = attr(object.instanceColor);
        base(camera, scene, geometry, material, object, group);
        const uniforms = r.properties.get(material).uniforms;
        if (uniforms) for (const k of Object.keys(uniforms)) data[`u.${k}`] = dig(uniforms[k]!.value, 0);
        const gl = r.getContext();
        // the GL state of the draw (three keeps its own copy: a raw GL call can make the two differ)
        const blendOn = gl.isEnabled(gl.BLEND);
        data.gl = [
          `blend ${blendOn ? `${gl.getParameter(gl.BLEND_EQUATION_RGB)} ${gl.getParameter(gl.BLEND_SRC_RGB)} ${gl.getParameter(gl.BLEND_DST_RGB)} ${gl.getParameter(gl.BLEND_SRC_ALPHA)} ${gl.getParameter(gl.BLEND_DST_ALPHA)}` : 'off'}`,
          `depth ${gl.isEnabled(gl.DEPTH_TEST) ? gl.getParameter(gl.DEPTH_FUNC) : 'off'} write ${gl.getParameter(gl.DEPTH_WRITEMASK)}`,
          `cull ${gl.isEnabled(gl.CULL_FACE) ? gl.getParameter(gl.CULL_FACE_MODE) : 'off'} front ${gl.getParameter(gl.FRONT_FACE)}`,
          `mask ${gl.getParameter(gl.COLOR_WRITEMASK)}`,
          `scissor ${gl.isEnabled(gl.SCISSOR_TEST) ? gl.getParameter(gl.SCISSOR_BOX) : 'off'} viewport ${gl.getParameter(gl.VIEWPORT)}`,
          `offset ${gl.isEnabled(gl.POLYGON_OFFSET_FILL) ? `${gl.getParameter(gl.POLYGON_OFFSET_FACTOR)} ${gl.getParameter(gl.POLYGON_OFFSET_UNITS)}` : 'off'}`,
          `stencil ${gl.isEnabled(gl.STENCIL_TEST)} coverage ${gl.isEnabled(gl.SAMPLE_ALPHA_TO_COVERAGE)} dither ${gl.isEnabled(gl.DITHER)}`,
        ].join(', ');
        if (log.length === watch) {
          // the watched call: what the GPU has, not what three thinks it has: each uniform of the program and each vertex buffer
          const prog = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
          const enc = new TextEncoder();
          for (const sh of gl.getAttachedShaders(prog) ?? []) {
            const src = gl.getShaderSource(sh) ?? '';
            data[`gpu.shader.${gl.getShaderParameter(sh, gl.SHADER_TYPE) === gl.VERTEX_SHADER ? 'vertex' : 'fragment'}`] = raw(enc.encode(src));
          }
          const uniformCount = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
          for (let k = 0; k < uniformCount; k++) {
            const info = gl.getActiveUniform(prog, k);
            if (!info) continue;
            for (let e = 0; e < info.size; e++) {
              const name = info.size > 1 ? info.name.replace('[0]', `[${e}]`) : info.name;
              const loc = gl.getUniformLocation(prog, name);
              if (loc) data[`gpu.u.${name}`] = dig(gl.getUniform(prog, loc), 0);
            }
          }
          const bound = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
          const attrCount = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES) as number;
          for (let k = 0; k < attrCount; k++) {
            const info = gl.getActiveAttrib(prog, k);
            if (!info) continue;
            const loc = gl.getAttribLocation(prog, info.name);
            // a mat4 attribute takes four locations
            for (let c = 0; c < (info.type === gl.FLOAT_MAT4 ? 4 : 1); c++) {
              const at = loc + c;
              const buffer = gl.getVertexAttrib(at, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
              let content = 'no buffer';
              if (buffer) {
                gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                const all = new Uint8Array(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE) as number);
                gl.getBufferSubData(gl.ARRAY_BUFFER, 0, all);
                content = raw(all);
              }
              data[`gpu.attr.${info.name}.${c}`] = `${gl.getVertexAttrib(at, gl.VERTEX_ATTRIB_ARRAY_ENABLED) ? 'on' : 'off'} size ${gl.getVertexAttrib(at, gl.VERTEX_ATTRIB_ARRAY_SIZE)} type ${gl.getVertexAttrib(at, gl.VERTEX_ATTRIB_ARRAY_TYPE)} stride ${gl.getVertexAttrib(at, gl.VERTEX_ATTRIB_ARRAY_STRIDE)} offset ${gl.getVertexAttribOffset(at, gl.VERTEX_ATTRIB_ARRAY_POINTER)} divisor ${gl.getVertexAttrib(at, gl.VERTEX_ATTRIB_ARRAY_DIVISOR)} ${content}`;
            }
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, bound);
          data['gpu.depth'] = `clear ${gl.getParameter(gl.DEPTH_CLEAR_VALUE)} range ${gl.getParameter(gl.DEPTH_RANGE)}`;
        }
        if ((watch === -2 || log.length === watch) && rt && rt.width * rt.height <= 1920 * 1080) {
          // the target is still bound: read it back (8-bit targets as bytes, float targets as floats)
          const n = rt.width * rt.height * 4;
          const buf = rt.texture.type === 1009 ? new Uint8Array(n) : new Float32Array(n);
          gl.readPixels(0, 0, rt.width, rt.height, gl.RGBA, rt.texture.type === 1009 ? gl.UNSIGNED_BYTE : gl.FLOAT, buf);
          const ok = gl.getError() === gl.NO_ERROR;
          data.out = ok ? raw(buf) : 'not readable';
          if (ok && log.length === watch) {
            // the watched call: the first render of the page keeps its output, the later ones compare with it
            const old = store.__pveOrderWatch;
            if (!old) store.__pveOrderWatch = buf;
            else {
              let count = 0, max = 0, x0 = rt.width, y0 = rt.height, x1 = -1, y1 = -1;
              const first: string[] = [];
              for (let j = 0; j < n; j += 4) {
                const d = Math.max(Math.abs(buf[j]! - old[j]!), Math.abs(buf[j + 1]! - old[j + 1]!), Math.abs(buf[j + 2]! - old[j + 2]!), Math.abs(buf[j + 3]! - old[j + 3]!));
                if (d === 0) continue;
                const x = (j / 4) % rt.width, y = Math.floor(j / 4 / rt.width);
                count++; max = Math.max(max, d);
                x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
                if (first.length < 6) first.push(`(${x},${y}) ${Array.from(old.subarray(j, j + 4)).join(' ')} -> ${Array.from(buf.subarray(j, j + 4)).join(' ')}`);
              }
              watched = `call ${watch} output: ${count} texels differ, max ${max}, box ${x0},${y0}-${x1},${y1} (y up)\n        ${first.join('\n        ')}`;
            }
          }
        }
        log.push({
          key: `${rt ? `${rt.width}x${rt.height}` : 'screen'} ${object.type} "${object.name}" ${material.type} "${material.name}" blend ${material.blending}${material.transparent ? ' transparent' : ''} order ${object.renderOrder} verts ${pos ? pos.count : 0}${object.count === undefined ? '' : ` x${object.count}`}`,
          ids: `object ${object.id} material ${material.id}`,
          data,
        });
      };
      if (reset && i === seq.length - 1 && seq.length > 1) reset(p.engine);
      p.still(seq[i]!, 1, 0.5);
      if (hook) r.renderBufferDirect = base;
      px = await p.engine.readPixelsAsync();
    }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', px)), (b) => b.toString(16).padStart(2, '0')).join('');
    return { hash, draws: log, watch: watched };
  }, { seq, draws, watch, between }), FRAME_MS * Math.max(1, seq.length), `rendering ${seq.length} frames`);
}

/** Says how the draw calls of a trial differ from the reference: the first place where the calls differ, else the calls whose inputs differ. */
function compareDraws(ref: Draw[], got: Draw[]): string {
  let i = 0;
  while (i < ref.length && i < got.length && ref[i]!.key === got[i]!.key) i++;
  if (i < ref.length || i < got.length) {
    const sorted = (d: Draw[]) => d.map((x) => x.key).sort().join('\n');
    const kind = sorted(ref) === sorted(got) ? 'the same calls in another order' : `other calls (${ref.length} in the reference, ${got.length} here)`;
    const show = (d: Draw[]) => d.slice(Math.max(0, i - 1), i + 4).map((x, k) => `      ${Math.max(0, i - 1) + k}: ${x.key}  [${x.ids}]`).join('\n');
    return `draws: ${kind}; first difference at call ${i}\n    reference:\n${show(ref)}\n    here:\n${show(got)}`;
  }
  const lines: string[] = [];
  ref.forEach((a, k) => {
    const b = got[k]!;
    const names = [...new Set([...Object.keys(a.data), ...Object.keys(b.data)])].filter((n) => a.data[n] !== b.data[n]);
    if (names.length) lines.push(`      ${k}: ${a.key}  [${b.ids}]\n        differs: ${names.map((n) => `${n} (${String(a.data[n]).slice(0, 60)} -> ${String(b.data[n]).slice(0, 60)})`).join('; ')}`);
  });
  const head = `draws: the same ${ref.length} calls in the same order`;
  if (lines.length === 0) return `${head}, with the same inputs (matrices, vertex and instance data, uniforms, data textures)`;
  return `${head}; ${lines.length} calls have other inputs:\n${lines.slice(0, 12).join('\n')}${lines.length > 12 ? `\n      … ${lines.length - 12} more` : ''}`;
}

const lastPng = async (page: Page): Promise<Image> => decodePng(Buffer.from(await page.evaluate(() => (window as unknown as PveWindow).__pve!.png()), 'base64'));

function maskOf(a: Image, b: Image): Image {
  const data = new Uint8Array(a.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const d = a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = d ? 255 : 0;
    data[i + 3] = 255;
  }
  return { width: a.width, height: a.height, data };
}

export async function runOrder(o: OrderOptions): Promise<OrderRow[]> {
  const { url, stop } = await ensureServer();
  const rows: OrderRow[] = [];
  let n = 0;
  try {
    const open = () => openPage(url, o.project, { only: o.only, hdr: o.hdr });
    // the reference: the target as the first frame of a new page
    const t0 = performance.now();
    let cur = await open();
    const t1 = performance.now();
    const { hash: refHash, draws: refDraws } = await renderSeq(cur.page, [o.target], o.draws, o.watch, '');
    o.log(`page ready in ${((t1 - t0) / 1000).toFixed(1)} s (clips: ${o.only}), reference frame in ${((performance.now() - t1) / 1000).toFixed(1)} s`);
    const ref = await lastPng(cur.page);
    if (o.png !== null) {
      mkdirSync(o.png, { recursive: true });
      await Bun.write(path.join(o.png, 'ref.png'), encodePng(ref));
    }
    /** Renders `seq` then the target on `page` and compares the target with the reference. */
    const trial = async (page: Page, seq: number[], after: number[]): Promise<OrderRow> => {
      const { hash, draws, watch } = await renderSeq(page, [...seq, o.target], o.draws, o.watch, o.between);
      if (hash === refHash) return { after, same: true, maxDiff: 0, pixels: 0, box: null, mask: null, draws: null };
      const got = await lastPng(page);
      const d = diffImages(ref, got);
      let mask: string | null = null;
      if (o.png !== null && d.pixels > 0) {
        const k = String(n++).padStart(2, '0');
        await Bun.write(path.join(o.png, `got-${k}.png`), encodePng(got));
        mask = path.join(o.png, `mask-${k}.png`);
        await Bun.write(mask, encodePng(maskOf(ref, got)));
      }
      const said = o.draws ? `${compareDraws(refDraws, draws)}${watch === null ? '' : `\n      ${watch}`}` : null;
      return { after, same: d.pixels === 0, maxDiff: d.maxDiff, pixels: d.pixels, box: d.box, mask, draws: said };
    };
    /** A trial on a new page. */
    const freshTrial = async (seq: number[]): Promise<OrderRow> => {
      const pg = await open();
      try { return await trial(pg.page, seq, seq); } finally { await closeBrowser(pg.browser); }
    };
    try {
      if (o.mode === 'each') for (const t of o.after) rows.push(await trial(cur.page, [t], [t]));
    } finally {
      await closeBrowser(cur.browser);
    }
    if (o.mode === 'fresh') for (const t of o.after) rows.push(await freshTrial([t]));
    if (o.mode === 'chain' || o.mode === 'bisect') {
      const first = await freshTrial(o.after);
      rows.push(first);
      for (let k = 1; k < o.repeat; k++) rows.push(await freshTrial(o.after));
      if (o.mode === 'bisect' && !first.same) {
        // delta debugging: drop chunks of the list while the target still differs
        let seq = o.after, parts = 2;
        while (seq.length >= 2) {
          const size = Math.ceil(seq.length / parts);
          let cut = false;
          for (let i = 0; i < seq.length; i += size) {
            const rest = [...seq.slice(0, i), ...seq.slice(i + size)];
            if (rest.length === 0) continue;
            const r = await freshTrial(rest);
            o.log(`  bisect: ${rest.length} frames -> ${r.same ? 'same' : `differs (${r.pixels} px)`}`);
            if (!r.same) { seq = rest; parts = Math.max(2, parts - 1); cut = true; rows.push(r); break; }
          }
          if (!cut) {
            if (parts >= seq.length) break;
            parts = Math.min(seq.length, parts * 2);
          }
        }
      }
    }
  } finally {
    stop();
  }
  return rows;
}

/** Renders time `t` on the page, but draws only the calls `from` <= index < `to` (the other calls are left out). Returns what each call is. */
async function renderPart(page: Page, t: number, from: number, to: number): Promise<string[]> {
  return deadline(page.evaluate(async ({ t, from, to }) => {
    const p = (window as unknown as PveWindow).__pve!;
    const r = (p.engine as unknown as DrawEngine).renderer;
    const keys: string[] = [];
    const base = r.renderBufferDirect;
    r.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
      const rt = r.getRenderTarget(), pos = geometry.attributes.position, k = keys.length;
      keys.push(`${rt ? `${rt.width}x${rt.height}` : 'screen'} ${object.type} "${object.name}" ${material.type} "${material.name}" blend ${material.blending}${material.transparent ? ' transparent' : ''} verts ${pos ? pos.count : 0}${object.count === undefined ? '' : ` x${object.count}`} [object ${object.id} material ${material.id}]`);
      if (k >= from && k < to) base(camera, scene, geometry, material, object, group);
    };
    p.still(t, 1, 0.5);
    r.renderBufferDirect = base;
    await p.engine.readPixelsAsync();
    return keys;
  }, { t, from, to }), FRAME_MS, `rendering ${t}`);
}

export interface CulpritOptions {
  project: string;
  only: string;
  hdr: 'half' | 'float';
  /** The frame that comes out wrong, the frame before it that makes it wrong, and a frame that makes it right again. */
  target: number;
  bad: number;
  good: number;
  log: (line: string) => void;
}

/**
 * The subtractive search: which draw calls of the `bad` frame make the target wrong. Each trial on one page: render `good` (the
 * state is right), render `bad` with some of its draw calls left out, render the target and compare it with the reference.
 * Returns the lines of the report: the smallest run of calls `from`..`to` that is enough to make the target wrong.
 */
export async function findCulprit(o: CulpritOptions): Promise<string[]> {
  const { url, stop } = await ensureServer();
  try {
    const { browser, page } = await openPage(url, o.project, { only: o.only, hdr: o.hdr });
    try {
      const refHash = (await renderSeq(page, [o.target], false, -1, '')).hash;
      let keys: string[] = [];
      /** True when the target is wrong after `bad` drawn with the calls from..to only. */
      const wrong = async (from: number, to: number): Promise<boolean> => {
        await renderSeq(page, [o.good], false, -1, '');
        keys = await renderPart(page, o.bad, from, to);
        const w = (await renderSeq(page, [o.target], false, -1, '')).hash !== refHash;
        o.log(`  calls ${from}..${to - 1} of ${keys.length}: target ${w ? 'wrong' : 'right'}`);
        return w;
      };
      if (!(await wrong(0, Infinity))) return [`no fault: the target is right after ${o.bad}`];
      const total = keys.length;
      if (await wrong(0, 0)) return [`the target is wrong after ${o.bad} with none of its ${total} draw calls: the fault is not in a draw call (look at what the scene does before it draws)`];
      // the shortest start of the frame that is enough, then the latest first call of it that is still enough
      let lo = 0, hi = total;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (await wrong(0, mid)) hi = mid; else lo = mid; }
      const to = hi;
      lo = 0; hi = to - 1;
      while (hi - lo > 0) { const mid = (lo + hi + 1) >> 1; if (await wrong(mid, to)) lo = mid; else hi = mid - 1; }
      const from = lo;
      const lines = [`calls ${from}..${to - 1} of the ${total} draw calls of ${o.bad} are enough to make ${o.target} wrong:`];
      for (let k = from; k < to; k++) if (k < from + 6 || k >= to - 6) lines.push(`  ${k}: ${keys[k]}`);
      return lines;
    } finally {
      await closeBrowser(browser);
    }
  } finally {
    stop();
  }
}
