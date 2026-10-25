// Entry: preview player (default) or export mode (?export=1, driven by scripts/render.ts).
import { Engine, type AdaptiveSampling } from '@pve/engine/engine';
import { PW, PH, SCALE } from '@pve/engine/gl';
import { marks } from '@pve/engine/marks';
import type { BenchOptions } from '@pve/engine/bench/types';
import { inputs, loadProject, project } from './project';
import { NleStudio } from './ui/nle';

const params = new URLSearchParams(location.search);
const EXPORT = params.has('export');
const ONLY = params.get('only'); // comma-separated scene ids to load (faster stills)
const FROM = params.get('t') ? parseFloat(params.get('t')!) : null;

const canvas = document.getElementById('c') as HTMLCanvasElement;
// physical size: 1920x1080 times ?scale= (the page CSS keeps showing it at 1920x1080)
canvas.width = PW;
canvas.height = PH;

const engine = new Engine(canvas, loadProject);

declare global {
  /** The export API (setupExport), or the boot error. Read by app/scripts/browser.ts. */
  interface Window { __pve?: object }
}

let TIMELINE: typeof engine.timeline = [];

async function boot() {
  const onlySet = ONLY ? new Set(ONLY.split(',')) : null;
  await engine.init(onlySet ? (e) => onlySet.has(e.id) : undefined);
  TIMELINE = engine.timeline;
  document.title = project.title;
  if (EXPORT) setupExport();
  else setupPlayer();
}

// ------------------------------------------------------------------ export API
/** The last frame stream() rendered (a range starting right after it needs no warm-up). */
let lastStreamed = -2;
const senders = new Map<string, Promise<Sender>>();
interface Sender { send(fill: (buf: Uint8Array) => Promise<unknown>): Promise<void> }

/**
 * A WebSocket written from a worker thread: send() fills a pooled frame buffer, transfers it to the worker
 * (no copy) and returns once the buffer is on its way, waiting first while `inflight` frames are unacknowledged.
 */
function sender(url: string, inflight: number): Promise<Sender> {
  let s = senders.get(url);
  if (s) return s;
  s = new Promise<Sender>((resolve, reject) => {
    const src = `let ws;
      onmessage = (e) => {
        const m = e.data;
        if (m.open) {
          ws = new WebSocket(m.open); ws.binaryType = 'arraybuffer';
          ws.onopen = () => postMessage({ open: true });
          ws.onerror = () => postMessage({ error: 'websocket error' });
          ws.onclose = () => postMessage({ error: 'websocket closed' });
          ws.onmessage = (ev) => postMessage({ acked: +ev.data || 0 });
        } else {
          ws.send(m.buf); // (copies the frame: the buffer can go straight back)
          postMessage({ free: m.buf }, [m.buf]);
        }
      };`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    const free: ArrayBuffer[] = [];
    let sent = 0, acked = 0, failed = '', pool = 0;
    let wake: (() => void) | null = null;
    const notify = () => { const f = wake; wake = null; f?.(); };
    const wait = () => new Promise<void>((r) => { wake = r; });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.open) resolve({ send });
      else if (m.error) { failed = m.error; reject(new Error(m.error)); notify(); }
      else if (m.acked !== undefined) { acked = Math.max(acked, m.acked); notify(); }
      else if (m.free) { free.push(m.free); notify(); }
    };
    async function send(fill: (buf: Uint8Array) => Promise<unknown>) {
      while (!failed && sent - acked >= inflight) await wait();
      if (failed) throw new Error(failed);
      // pooled frame buffers: enough to keep `inflight` frames moving without starving the render loop
      if (!free.length && pool < Math.max(2, inflight)) { free.push(new ArrayBuffer(Engine.RGB_BYTES)); pool++; }
      while (!free.length) await wait();
      const buf = free.pop()!;
      await fill(new Uint8Array(buf));
      w.postMessage({ buf }, [buf]);
      sent++;
    }
    w.postMessage({ open: url });
  });
  senders.set(url, s);
  return s;
}

function setupExport() {
  document.body.classList.add('export');
  const api = {
    project: project.id,
    engine,
    duration: engine.duration,
    errors: engine.errors,
    /** Output size in px (1920x1080 times scale); stream() sends frames of width*height*3 bytes (rgb24). */
    scale: SCALE,
    width: PW,
    height: PH,
    timeline: TIMELINE.map(({ id, start, end }) => ({ id, start, end })),
    /** Render a single frame at t (seeks as needed), with the shutter of a frame at `fps` as in stream(). */
    still(t: number, samples: number | AdaptiveSampling = 1, shutter = 0.5, fps = 60) { return engine.render(t, 1 / fps, true, samples, shutter); },
    /** The named objects of the last rendered frame (scenes call `mark`), boxes in 1920x1080 px. */
    marks() { return [...marks()]; },
    /** The last rendered frame as a full-resolution (PW x PH) PNG, base64 (for stills at scale > 1). */
    async png() {
      const px = await engine.readPixelsAsync(), row = PW * 4;
      const img = new ImageData(PW, PH);
      for (let y = 0; y < PH; y++) img.data.set(px.subarray((PH - 1 - y) * row, (PH - y) * row), y * row); // bottom-up -> top-down
      const oc = new OffscreenCanvas(PW, PH);
      oc.getContext('2d')!.putImageData(img, 0, 0);
      const b = new Uint8Array(await (await oc.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return btoa(s);
    },
    /**
     * Render [from, to) at fps and stream raw rgb24 frames (bottom-up) over a WebSocket, in order.
     * Returns when all frames were handed to the socket, with per-frame statistics: sub-frames, GPU time of
     * the render (a TIME_ELAPSED query per frame; null without EXT_disjoint_timer_query_webgl2 or after a
     * disjoint event) and the wall time of the loop iteration. The receiver acknowledges each frame it has
     * taken (a text message with its running count) and at most `inflight` frames are unacknowledged:
     * backpressure from the encoder, so a slow encode (4K) cannot pile frames up in memory. Pipelined: frame
     * n's readback is collected while n+1 renders, and the socket is written from a worker thread. Calls with
     * the same `ws` reuse its connection, so a renderer can be handed several ranges; a range that goes on
     * where the last one ended skips the warm-up.
     */
    async stream(opts: { from: number; to: number; fps: number; ws: string; samples?: number | AdaptiveSampling; shutter?: number; inflight?: number }) {
      const snd = await sender(opts.ws, opts.inflight ?? 4);
      const dt = 1 / opts.fps;
      const n0 = Math.round(opts.from * opts.fps), n1 = Math.round(opts.to * opts.fps);
      const S = opts.samples ?? 1, SH = opts.shutter ?? 0.5;
      // warm-up: render one frame before the range so the first frame is sequential for stateful scenes
      // (adaptive sampling only runs stateless scenes: one sample is enough for the warm-up)
      if (n0 > 0 && lastStreamed !== n0 - 1) engine.render((n0 - 1) * dt, dt, false, typeof S === 'number' ? S : 1, SH);
      const gl = engine.renderer.getContext() as WebGL2RenderingContext;
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
      if (ext) gl.getParameter(ext.GPU_DISJOINT_EXT); // (reading the flag clears it)
      const frames: { n: number; samples: number; gpuMs: number | null; wallMs: number }[] = [];
      const queries: { i: number; q: WebGLQuery }[] = [];
      // collects the queries whose results are in (in order: a later query is never ready before an earlier one)
      const collect = () => {
        while (queries.length && gl.getQueryParameter(queries[0]!.q, gl.QUERY_RESULT_AVAILABLE)) {
          const { i, q } = queries.shift()!;
          frames[i]!.gpuMs = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
          gl.deleteQuery(q);
        }
      };
      let pending = -1;
      for (let n = n0; n < n1; n++) {
        const w0 = performance.now();
        const q = ext ? gl.createQuery() : null;
        if (ext && q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        const k = engine.render(n * dt, dt, false, S, SH);
        if (ext && q) { gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push({ i: frames.length, q }); }
        engine.readStart(n & 1);
        if (pending >= 0) await snd.send((buf) => engine.readFinish(pending & 1, buf));
        pending = n;
        frames.push({ n, samples: k, gpuMs: null, wallMs: performance.now() - w0 });
        collect();
      }
      if (pending >= 0) await snd.send((buf) => engine.readFinish(pending & 1, buf));
      for (let tries = 0; queries.length && tries < 1000; tries++) {
        collect();
        if (!queries.length) break;
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 1);
        await promise;
      }
      for (const { q } of queries.splice(0)) gl.deleteQuery(q);
      if (ext && gl.getParameter(ext.GPU_DISJOINT_EXT)) for (const f of frames) f.gpuMs = null;
      lastStreamed = n1 - 1;
      return frames;
    },
    /** GPU benchmark of the engine (scripts/bench.ts). Loaded on demand: the normal page carries no bench code. */
    bench: (opts?: BenchOptions) => import('@pve/engine/bench/runner').then((m) => m.runBench(engine, opts)),
  };
  window.__pve = { ...api, ready: true };
}

// ------------------------------------------------------------------ preview player
function setupPlayer() {
  const errs = document.getElementById('errs');
  if (errs && engine.errors.length) {
    errs.textContent = engine.errors.join('\n\n');
    errs.classList.add('visible');
  }

  const projLabel = document.getElementById('project-name');
  if (projLabel) projLabel.textContent = project.id;

  new NleStudio(engine, inputs, TIMELINE, canvas, FROM);
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f55;position:fixed;top:0;left:0">${String(e?.stack ?? e)}</pre>`);
  window.__pve = { error: String(e?.stack ?? e) };
});
