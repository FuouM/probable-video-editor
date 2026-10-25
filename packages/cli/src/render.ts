// Real frames from the engine in headless Chrome (DESIGN 10): stills, contact sheets and video renders.
// Every function takes an open export page (browser.ts); the commands in main.ts open it.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import type { AdaptiveSampling } from '@pve/engine/engine';
import type { BenchRecord } from '@pve/engine/bench/types';
import { assertNoBrowserErrors, chromeVersion, ensureServer, gpuInfo, openPage, type OpenOptions, type OpenPage, type PveWindow, type StreamFrame } from './browser';

export type Samples = number | AdaptiveSampling;

/** `--samples N` (fixed) or `auto` (adaptive per 32 px tile, see Engine.render). */
export function parseSamples(s: string, o: { min?: number; max?: number; tol?: number; refine?: 'tiles' | 'frame' } = {}): Samples {
  if (s === 'auto') return { min: o.min ?? 4, max: o.max ?? 324, tol: o.tol ?? 3, refine: o.refine ?? 'tiles' };
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--samples takes a whole number of at least 1, or auto (got '${s}')`);
  return n;
}

export interface StillOptions {
  samples: Samples;
  shutter: number;
  /** The video's frame rate: a still's shutter is `shutter` of one frame, as in the export. */
  fps: number;
  scale: number;
}

/** Renders each time into its PNG file. Returns the sub-frame count of each still. */
export async function stills(page: Page, items: { t: number; file: string }[], o: StillOptions): Promise<number[]> {
  const counts: number[] = [];
  for (const { t, file } of items) {
    mkdirSync(path.dirname(file), { recursive: true });
    counts.push(await page.evaluate(([t, s, sh, fps]) => (window as unknown as PveWindow).__pve!.still(t, s, sh, fps), [t, o.samples, o.shutter, o.fps] as const));
    // at scale > 1 the canvas is shown downscaled on the page: save the full-res pixel buffer instead
    if (o.scale !== 1) await Bun.write(file, Buffer.from(await page.evaluate(() => (window as unknown as PveWindow).__pve!.png()), 'base64'));
    else await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  }
  return counts;
}

export interface SheetTile {
  t: number;
  /** Burnt in above the tile: time, clip id, bar.beat. */
  label: string;
  /** First tile of a group (a clip, a cut): the label is drawn in the accent colour. */
  head?: boolean;
}

/** A contact sheet: `cols` tiles of 480x270 a row, each with its label. Writes the PNG to `out`. */
export async function sheet(page: Page, tiles: SheetTile[], cols: number, out: string, o: Omit<StillOptions, 'scale'>): Promise<void> {
  const dataUrl: string = await page.evaluate(async ({ tiles, cols, samples, shutter, fps }) => {
    const P = (window as unknown as PveWindow).__pve!;
    const cw = 480, ch = 270, pad = 4, lab = 20;
    const rows = Math.ceil(tiles.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * (cw + pad) + pad; cv.height = rows * (ch + lab + pad) + pad;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#222'; c.fillRect(0, 0, cv.width, cv.height);
    const src = document.getElementById('c') as HTMLCanvasElement;
    tiles.forEach((tile, i) => {
      P.still(tile.t, samples, shutter, fps);
      const x = pad + (i % cols) * (cw + pad), y = pad + Math.floor(i / cols) * (ch + lab + pad);
      c.drawImage(src, x, y + lab, cw, ch);
      c.fillStyle = tile.head ? '#ffb347' : '#ddd'; c.font = '13px monospace'; c.fillText(tile.label, x + 2, y + 14);
    });
    return cv.toDataURL('image/png');
  }, { tiles, cols, samples: o.samples, shutter: o.shutter, fps: o.fps });
  mkdirSync(path.dirname(out), { recursive: true });
  await Bun.write(out, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
}

// ------------------------------------------------------------------ video
// Two stages. render: the pages stream raw RGB frames, and one ffmpeg per clip writes them as a lossless
// segment: FFV1 in Matroska, BT.709 yuv420p. That is exactly the input of the final encode, at about a
// quarter of the size of PNG frames (measured on pdoom_original: 0.95 MB a frame against 3.98 MB). encode:
// one ffmpeg joins the segments and encodes the MP4 with the audio of the range, on the GPU (NVENC) by
// default. The segments stay on disk: a killed render resumes, one clip renders again, and a new encode
// needs no render.

/** The frames of one clip in the range: [f0, f1). */
export interface Segment {
  f0: number;
  f1: number;
  clip: string;
}

/** render.json in the render folder. */
export interface RenderManifest {
  project: string;
  name: string;
  fps: number;
  scale: number;
  samples: Samples;
  shutter: number;
  /** Range in seconds, frame-aligned: frames [from * fps, to * fps). */
  from: number;
  to: number;
  clips: Segment[];
}

export interface FrameLine extends StreamFrame {
  t: number;
  clip: string;
}

export type SegmentCodec = 'ffv1' | 'x264' | 'nvenc';

/** `new` renders the range from nothing. `resume` renders the segments that are not complete. `clips` renders the segments of `redo` again. */
export type RenderMode = 'new' | 'resume' | 'clips';

export interface FramesOptions {
  project: string;
  /** The render folder out/render/<name>/: render.json, frames.jsonl, the MP4. */
  dir: string;
  name: string;
  /** The segment folder. It is not stored: each command finds it the same way (--frames, PVE_FRAMES, default). */
  framesDir: string;
  fps: number;
  scale: number;
  samples: Samples;
  shutter: number;
  from: number;
  to: number;
  /** Clips of the edit, in time order. */
  clips: { id: string; start: number }[];
  mode: RenderMode;
  redo?: string[];
  workers: number;
  chunk: number;
  memGb: number;
  headed?: boolean;
  url?: string;
  segmentCodec?: SegmentCodec;
  onProgress?: (p: {
    status: 'rendering' | 'encoding' | 'complete' | 'error';
    totalFrames: number;
    renderedFrames: number;
    fps: number;
    elapsedS: number;
    etaS: number;
    activeClip?: string;
    clips: Array<{
      id: string;
      f0: number;
      f1: number;
      total: number;
      rendered: number;
      percent: number;
      status: 'pending' | 'rendering' | 'done';
    }>;
  }) => void;
}

/** The frames of each clip in [f0, f1). */
export function segmentsOf(f0: number, f1: number, fps: number, clips: { id: string; start: number }[]): Segment[] {
  // (before the first clip there is no clip on screen: no id)
  const clipAt = (f: number) => [...clips].reverse().find((c) => Math.round(c.start * fps) <= f)?.id ?? '';
  const cuts = [...new Set(clips.map((c) => Math.round(c.start * fps)).filter((f) => f > f0 && f < f1))].sort((a, b) => a - b);
  const edges = [f0, ...cuts, f1];
  return edges.slice(0, -1).map((a, i) => ({ f0: a, f1: edges[i + 1]!, clip: clipAt(a) }));
}

/** Contiguous runs [a, b) of sorted segments. */
function runs(segs: Segment[]): [number, number][] {
  const out: [number, number][] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last[1] === s.f0) last[1] = s.f1;
    else out.push([s.f0, s.f1]);
  }
  return out;
}

/** The segment file. It gets this name only when its ffmpeg exited without error (it writes `<file>.part` before). */
export const segmentFile = (framesDir: string, s: Segment) => path.join(framesDir, `${String(s.f0).padStart(6, '0')}-${String(s.f1).padStart(6, '0')}.mkv`);

export function readManifest(dir: string): RenderManifest {
  const file = path.join(dir, 'render.json');
  if (!existsSync(file)) throw new Error(`no render in ${dir} (render.json): render the range first`);
  return JSON.parse(readFileSync(file, 'utf8')) as RenderManifest;
}

export interface RenderResult {
  manifest: RenderManifest;
  /** Lines of the frames rendered now, in frame order. */
  frames: FrameLine[];
  /** Wall time of the render stage, seconds. */
  wallS: number;
  /** Facts of the render page, for the record. Null when no segment needed a render. */
  page: { gpu: string; timerQuery: boolean; chrome: string } | null;
}

/**
 * The render stage: one lossless segment per clip into the segment folder. `workers` headless Chromes take
 * chunks of `chunk` frames in order. The server puts their frames back in order and writes them to the
 * ffmpeg of their segment. A frame is acknowledged once it is written or waits in a reorder buffer of at
 * most `memGb`. Past that, the page waits (each page keeps at most a few frames unacknowledged).
 * Writes frames.jsonl (one line per frame of the range) and render.json.
 */
export async function renderFrames(o: FramesOptions): Promise<RenderResult> {
  const framesFile = path.join(o.dir, 'frames.jsonl');
  let manifest: RenderManifest;
  let todo: Segment[];
  if (o.mode === 'new') {
    const f0 = Math.round(o.from * o.fps), f1 = Math.round(o.to * o.fps);
    if (f1 <= f0) throw new Error(`empty range: ${o.from} to ${o.to}`);
    rmSync(o.dir, { recursive: true, force: true });
    rmSync(o.framesDir, { recursive: true, force: true });
    manifest = {
      project: o.project, name: o.name, fps: o.fps, scale: o.scale, samples: o.samples, shutter: o.shutter,
      from: f0 / o.fps, to: f1 / o.fps, clips: segmentsOf(f0, f1, o.fps, o.clips),
    };
    todo = manifest.clips;
  } else {
    manifest = readManifest(o.dir);
    const want = JSON.stringify({ fps: o.fps, scale: o.scale, samples: o.samples, shutter: o.shutter });
    const had = JSON.stringify({ fps: manifest.fps, scale: manifest.scale, samples: manifest.samples, shutter: manifest.shutter });
    if (want !== had) throw new Error(`--${o.mode}: the render in ${o.dir} has ${had}, this command ${want}`);
    if (o.mode === 'clips') {
      todo = manifest.clips.filter((s) => o.redo!.includes(s.clip));
      if (!todo.length) throw new Error(`--clips: no segment of ${o.redo!.join(', ')} in ${o.dir} (clips: ${[...new Set(manifest.clips.map((s) => s.clip))].join(', ')})`);
    } else todo = manifest.clips.filter((s) => !existsSync(segmentFile(o.framesDir, s)));
  }
  mkdirSync(o.dir, { recursive: true });
  mkdirSync(o.framesDir, { recursive: true });
  writeFileSync(path.join(o.dir, 'render.json'), JSON.stringify(manifest, null, 2) + '\n');

  const stats: FrameLine[] = [];
  const t0 = performance.now();
  const page = todo.length ? await streamFrames(o, todo, stats) : null;
  const wallS = (performance.now() - t0) / 1000;

  // frames.jsonl: the lines of the frames not rendered now stay
  stats.sort((a, b) => a.n - b.n);
  const now = new Set(stats.map((f) => f.n));
  const kept: FrameLine[] = o.mode !== 'new' && existsSync(framesFile)
    ? readFileSync(framesFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as FrameLine).filter((f) => !now.has(f.n))
    : [];
  const all = [...kept, ...stats].sort((a, b) => a.n - b.n);
  writeFileSync(framesFile, all.map((f) => JSON.stringify({ n: f.n, t: +f.t.toFixed(6), clip: f.clip, samples: f.samples, gpuMs: f.gpuMs === null ? null : +f.gpuMs.toFixed(3), wallMs: +f.wallMs.toFixed(3) }) + '\n').join(''));
  console.log(page ? `${stats.length} frames (${todo.length} segments) in ${wallS.toFixed(1)} s (${(stats.length / wallS).toFixed(1)} fps) into ${o.framesDir}` : 'every segment is complete: nothing to render');
  return { manifest, frames: stats, wallS, page };
}

/** Streams the frames of the segments `segs` from the pages into their segment files. Returns the page facts. */
async function streamFrames(o: FramesOptions, segs: Segment[], stats: FrameLine[]): Promise<NonNullable<RenderResult['page']>> {
  const OW = 1920 * o.scale, OH = 1080 * o.scale;
  const rs = runs(segs);
  const order = segs.flatMap((s) => Array.from({ length: s.f1 - s.f0 }, (_, i) => s.f0 + i));
  const total = order.length;
  const segOf = (n: number) => segs.find((s) => n >= s.f0 && n < s.f1)!;
  // One writer per segment, opened at its first frame and closed after its last. Frames are sRGB (toSRGB in
  // the final pass): convert with the BT.709 matrix and tag the stream, otherwise ffmpeg converts with BT.601
  // while players and YouTube decode untagged HD as BT.709. FFV1 with 24 slices encodes on every core.
  const writerArgs = (file: string) => {
    const codecArgs = o.segmentCodec === 'nvenc'
      ? ['-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'ull', '-qp', '0']
      : o.segmentCodec === 'x264'
      ? ['-c:v', 'libx264', '-crf', '0', '-preset', 'ultrafast']
      : ['-c:v', 'ffv1', '-level', '3', '-slices', '24', '-slicecrc', '0'];
    return [
      'ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${OW}x${OH}`, '-r', String(o.fps), '-i', 'pipe:0',
      '-vf', 'vflip,scale=out_color_matrix=bt709,setparams=color_primaries=bt709:color_trc=bt709', '-pix_fmt', 'yuv420p',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
      ...codecArgs, '-f', 'matroska', file,
    ];
  };
  // (set and cleared inside the drain and signal closures: typed so that TypeScript does not narrow it to null)
  let writer = null as { seg: Segment; part: string; ff: Bun.Subprocess<'pipe', 'inherit', 'inherit'> } | null;
  const closing: Promise<void>[] = [];

  const frameBytes = OW * OH * 3;
  const cap = Math.max(4, Math.floor((o.memGb * 1e9) / frameBytes));
  const workers = Math.max(1, Math.min(o.workers, Math.ceil(total / o.chunk)));
  const waiting = new Map<number, Uint8Array>();
  const owed = new Map<number, number>(); // frames over the cap, not yet acknowledged -> their worker
  const queue: number[][] = Array.from({ length: workers }, () => []); // frame numbers each worker will send, in order
  const sockets: (Bun.ServerWebSocket<{ k: number }> | undefined)[] = [];
  const ackCount = new Array<number>(workers).fill(0);
  const ack = (k: number) => { ackCount[k]!++; sockets[k]?.send(String(ackCount[k])); };
  let idx = 0, ending = false;
  const onSignal = () => { writer?.ff.kill(9); process.exit(130); };
  process.once('SIGINT', onSignal);

  // any failure stops the render: closing the sockets makes every page's stream() throw
  let failure: Error | null = null;
  const failedP = Promise.withResolvers<never>();
  failedP.promise.catch(() => {});
  const writtenP = Promise.withResolvers<void>();
  const fail = (e: unknown) => {
    if (failure) return;
    failure = e instanceof Error ? e : new Error(String(e));
    for (const ws of sockets) ws?.close();
    failedP.reject(failure);
  };

  const t0 = performance.now();
  let draining = false;
  const drain = async () => {
    if (draining || failure) return;
    draining = true;
    try {
      while (!failure && idx < total && waiting.has(order[idx]!)) {
        const n = order[idx]!;
        const buf = waiting.get(n)!;
        waiting.delete(n);
        if (!writer) {
          const seg = segOf(n);
          const part = `${segmentFile(o.framesDir, seg)}.part`;
          const ff = Bun.spawn(writerArgs(part), { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });
          writer = { seg, part, ff };
          const mine = writer;
          void ff.exited.then((code) => { if (code !== 0 && !ending && writer === mine) fail(new Error(`ffmpeg (segment writer) exited early with code ${code}`)); });
        }
        writer.ff.stdin.write(buf);
        if (n === writer.seg.f1 - 1) {
          const { ff, seg, part } = writer;
          writer = null;
          await ff.stdin.flush();
          ff.stdin.end();
          closing.push(ff.exited.then((code) => {
            if (code !== 0) throw new Error(`ffmpeg (segment writer) exited with code ${code}`);
            renameSync(part, segmentFile(o.framesDir, seg));
          }));
        }
        const k = owed.get(n);
        if (k !== undefined) { owed.delete(n); ack(k); }
        idx++;
        // the oldest owed frames, while there is room
        for (const [m, kk] of owed) {
          if (waiting.size > cap) break;
          owed.delete(m);
          ack(kk);
        }
        if (o.onProgress && (idx % 15 === 0 || idx === total)) {
          const el = (performance.now() - t0) / 1000;
          const currentFps = el > 0 ? idx / el : 0;
          const eta = currentFps > 0 ? Math.max(0, (total - idx) / currentFps) : 0;
          const curSeg = idx < total ? segOf(order[idx]!) : null;
          const clipList = segs.map((s) => {
            const segTotal = s.f1 - s.f0;
            const segDone = Math.max(0, Math.min(idx - s.f0, segTotal));
            const pct = segTotal > 0 ? Math.round((segDone / segTotal) * 100) : 100;
            const st: 'pending' | 'rendering' | 'done' = idx < s.f0 ? 'pending' : (idx >= s.f1 ? 'done' : 'rendering');
            return { id: s.clip, f0: s.f0, f1: s.f1, total: segTotal, rendered: segDone, percent: pct, status: st };
          });
          o.onProgress({
            status: 'rendering',
            totalFrames: total,
            renderedFrames: idx,
            fps: +currentFps.toFixed(1),
            elapsedS: +el.toFixed(1),
            etaS: +eta.toFixed(0),
            activeClip: curSeg?.clip ?? '',
            clips: clipList,
          });
        }
        if (idx % 60 === 0 || idx === total) {
          const el = (performance.now() - t0) / 1000;
          process.stdout.write(`\r${idx}/${total} frames  ${(idx / el).toFixed(1)} fps  eta ${((total - idx) / (idx / el)).toFixed(0)}s   `);
        }
        if (idx === total) writtenP.resolve();
      }
    } catch (e) { fail(e); } finally { draining = false; }
  };
  const server = Bun.serve<{ k: number }>({
    port: 0,
    fetch(req, srv) { return srv.upgrade(req, { data: { k: +(new URL(req.url).searchParams.get('w') ?? 0) } }) ? undefined : new Response('ws only', { status: 400 }); },
    websocket: {
      maxPayloadLength: Math.max(64 * 1024 * 1024, frameBytes + 1024),
      open(ws) { sockets[ws.data.k] = ws; if (failure) ws.close(); },
      message(ws, msg) {
        if (failure) return;
        try {
          const k = ws.data.k, n = queue[k]!.shift();
          if (typeof msg === 'string') throw new Error(`worker ${k} sent text`);
          if (n === undefined) throw new Error(`worker ${k} sent a frame it was not given`);
          if (msg.length !== frameBytes) throw new Error(`worker ${k} sent ${msg.length} bytes for frame ${n}`);
          waiting.set(n, msg);
          if (waiting.size <= cap || n === order[idx]) ack(k);
          else owed.set(n, k);
          void drain();
        } catch (e) { fail(e); }
      },
    },
  });

  // chunks in order from a shared cursor, never across a gap between runs
  let ri = 0, cursor = rs[0]![0];
  const take = (): [number, number] | null => {
    while (ri < rs.length && cursor >= rs[ri]![1]) { ri++; if (ri < rs.length) cursor = rs[ri]![0]; }
    if (ri >= rs.length) return null;
    const a = cursor;
    cursor = Math.min(rs[ri]![1], a + o.chunk);
    return [a, cursor];
  };
  const { url, stop } = await ensureServer(o.url);
  const pages: OpenPage[] = [];
  const closePages = async () => {
    for (const p of pages.splice(0)) {
      if (p.logs.length) console.error('BROWSER LOG:\n' + p.logs.slice(0, 40).join('\n'));
      await p.browser.close().catch(() => {});
    }
  };
  let ok = false;
  try {
    const open: OpenOptions = { scale: o.scale, headed: o.headed };
    const opened = await Promise.allSettled(Array.from({ length: workers }, (_, k) => openPage(url, o.project, { ...open, slot: k })));
    for (const p of opened) if (p.status === 'fulfilled') pages.push(p.value);
    for (const p of opened) if (p.status === 'rejected') throw p.reason;
    const facts = { ...(await gpuInfo(pages[0]!.page)), chrome: chromeVersion(pages[0]!.browser) };
    const rendering = Promise.all(pages.map(async ({ page }, k) => {
      for (let r = take(); r && !failure; r = take()) {
        for (let n = r[0]; n < r[1]; n++) queue[k]!.push(n);
        const fr = await page.evaluate((a) => (window as unknown as PveWindow).__pve!.stream(a), {
          from: r[0] / o.fps, to: r[1] / o.fps, fps: o.fps, ws: `ws://localhost:${server.port}/?w=${k}`, samples: o.samples, shutter: o.shutter, inflight: 4,
        });
        for (const f of fr) stats.push({ ...f, t: f.n / o.fps, clip: segOf(f.n).clip });
      }
    }));
    rendering.catch(() => {});
    // (a page error stops the render; a failure on this side stops waiting for the pages)
    await Promise.race([rendering, failedP.promise]).catch((e) => { fail(e); throw failure; });
    await Promise.race([writtenP.promise, failedP.promise]);
    const logs = pages.flatMap((p) => p.logs);
    await closePages();
    ending = true;
    await Promise.all(closing);
    // a broken shader or a scene that throws makes wrong frames: the render fails (fix it, then --clips)
    assertNoBrowserErrors(logs);
    ok = true;
    process.stdout.write('\n');
    return facts;
  } finally {
    ending = true;
    process.off('SIGINT', onSignal);
    if (!ok) writer?.ff.kill(9);
    await closePages();
    stop();
    server.stop(true);
  }
}

export type Encoder = 'nvenc' | 'x264';

export interface EncodeOptions {
  /** The song's mix (audio track), or null for no audio. */
  mix: string | null;
  /** `nvenc`: H.264 on the GPU (default). `x264`: H.264 on the CPU, about 3 times slower at the same quality. */
  encoder: Encoder;
  /** Constant quality: NVENC `-cq`, x264 `-crf`. 16 by default. */
  quality: string;
  /** x264 only. */
  preset: string;
  x264: string;
  /** Default <dir>/<project>-<name>.mp4. */
  out?: string;
}

/**
 * The encode stage: the segments of the render in `dir`, joined, to H.264 (BT.709, yuv420p) with the AAC
 * audio of the range. Throws when a segment is not complete. Returns the MP4 path and the wall time.
 * Measured on pdoom_original frames: NVENC `-preset p7 -tune hq -cq 16` gives the PSNR of x264
 * `-preset slow -crf 16 -tune grain` within 1.6 dB per clip (higher on 3 of 6), with a smaller file.
 */
export function encodeVideo(dir: string, framesDir: string, e: EncodeOptions): { out: string; seconds: number } {
  const m = readManifest(dir);
  const missing = m.clips.filter((s) => !existsSync(segmentFile(framesDir, s)));
  if (missing.length) throw new Error(`${missing.length} of ${m.clips.length} segments are not complete in ${framesDir} (first: ${path.basename(segmentFile(framesDir, missing[0]!))}): render again with --resume`);
  const out = e.out ?? path.join(dir, `${m.project}-${m.name}.mp4`);
  const list = path.join(framesDir, 'segments.txt');
  writeFileSync(list, m.clips.map((s) => `file '${path.basename(segmentFile(framesDir, s))}'`).join('\n') + '\n');
  const args = ['ffmpeg', '-y', '-loglevel', 'error', '-stats', '-f', 'concat', '-safe', '0', '-i', list];
  if (e.mix) args.push('-ss', String(m.from), '-t', String(m.to - m.from), '-i', e.mix, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '320k', '-af', 'apad', '-shortest');
  const video = e.encoder === 'nvenc'
    ? ['-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', e.quality, '-b:v', '0', '-spatial-aq', '1', '-temporal-aq', '1', '-bf', '3', '-profile:v', 'high']
    : ['-c:v', 'libx264', '-preset', e.preset, '-crf', e.quality, '-tune', 'grain', '-x264-params', e.x264];
  args.push(
    '-frames:v', String(Math.round(m.to * m.fps) - Math.round(m.from * m.fps)), '-pix_fmt', 'yuv420p', ...video,
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', out,
  );
  mkdirSync(path.dirname(out), { recursive: true });
  const t0 = performance.now();
  const r = Bun.spawnSync(args, { stdout: 'inherit', stderr: 'inherit' });
  if (r.exitCode !== 0) throw new Error(`ffmpeg encode exited with code ${r.exitCode}`);
  return { out, seconds: (performance.now() - t0) / 1000 };
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1]! : 0; };
const p90 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]! : 0; };

/** A `render` line of bench/results.jsonl: the summary of the frames rendered now. */
export interface RenderRecord extends BenchRecord {
  kind: 'render';
  from: number;
  to: number;
  fps: number;
  samples: Samples;
  shutter: number;
  samplesMean: number;
  /** Frames rendered. `n` counts the frames with a GPU time. */
  frames: number;
  /** Wall time of the render stage (pages and segment writing), seconds. */
  wallS: number;
}

/**
 * The `render` record (DESIGN 12.1): median and p90 of the GPU time per frame (timer query), over the
 * frames that have one (a disjoint event voids the GPU times of its chunk: `n` < `frames`). Throws when no
 * frame has a GPU time (no EXT_disjoint_timer_query_webgl2).
 */
export function renderRecord(frames: FrameLine[], m: RenderManifest, wallS: number, base: Pick<BenchRecord, 'ts' | 'commit' | 'dirty' | 'machine'>): RenderRecord {
  const gpu = frames.flatMap((f) => (f.gpuMs === null ? [] : [f.gpuMs]));
  if (!gpu.length) throw new Error('no render record: no frame has a GPU time (pve doctor shows the timer query support)');
  return {
    ...base,
    project: m.project,
    scale: m.scale,
    id: `render.${m.name}`,
    kind: 'render',
    method: 'timer-query',
    n: gpu.length,
    frames: frames.length,
    medianMs: +median(gpu).toFixed(3),
    p90Ms: +p90(gpu).toFixed(3),
    compileMs: 0,
    wallMedianMs: +median(frames.map((f) => f.wallMs)).toFixed(3),
    from: m.from,
    to: m.to,
    fps: m.fps,
    samples: m.samples,
    shutter: m.shutter,
    samplesMean: +(frames.reduce((a, f) => a + f.samples, 0) / frames.length).toFixed(2),
    wallS: +wallS.toFixed(1),
  };
}
