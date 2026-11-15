// The browser session of every command that renders (still, look, bench, render, order, golden,
// determinism): the Vite dev server and headless Chrome pages on the app's export mode
// (?export=1&project=<id>, window.__pve).
// Chrome runs with a persistent profile (its GPU shader cache keeps compiled shaders between runs). Two
// Chromes cannot share a profile, so a lock file guards each one. A command takes the first free profile of a
// pool, so commands run side by side. When all profiles are busy, the command fails at once: it never waits.
// Each page step has a deadline (PVE_READY_TIMEOUT, PVE_FRAME_TIMEOUT): a stuck scene fails the command.
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { BenchOptions, BenchPageResult } from '@pve/engine/bench/types';
import type { AdaptiveSampling } from '@pve/engine/engine';
import type { CamRecord, Mark, Metric } from '@pve/engine/marks';
import type { Lyrics } from '@pve/engine/lyrics';

export const ROOT = path.resolve(import.meta.dir, '../../..');
export const APP = path.join(ROOT, 'app');

/** Per-frame statistics of stream(). */
export interface StreamFrame {
  /** Frame number (t = n / fps). */
  n: number;
  /** Sub-frames rendered. */
  samples: number;
  /** GPU time of the frame's render (timer query); null without the extension or after a disjoint event. */
  gpuMs: number | null;
  /** Wall time the page spent on the frame: render, readback of the frame before, and the send. */
  wallMs: number;
}

/** The page's export API (app/src/main.ts setupExport), as far as the commands use it. */
export interface PveExport {
  ready?: boolean;
  error?: string;
  project: string;
  width: number;
  height: number;
  duration: number;
  errors: string[];
  timeline: { id: string; start: number; end: number }[];
  still(t: number, samples?: number | AdaptiveSampling, shutter?: number, fps?: number): number;
  png(): Promise<string>;
  /** The named objects of the last rendered frame (scenes call `mark` from @pve/engine/marks). */
  marks(): Mark[];
  /** The values that scenes reported for the last rendered frame (`metric` from @pve/engine/marks). */
  metrics(): Metric[];
  /** The cameras of the last rendered frame; recorded only after `recordCams(true)`. */
  cameras(): CamRecord[];
  recordCams(on: boolean): void;
  stream(o: { from: number; to: number; fps: number; ws: string; samples?: number | AdaptiveSampling; shutter?: number; inflight?: number; webcodecs?: boolean }): Promise<StreamFrame[]>;
  engine: {
    hudOff: boolean;
    render(t: number, dt?: number, toScreen?: boolean, samples?: number | AdaptiveSampling, shutter?: number): number;
    readPixelsAsync(buf?: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
    lyrics?: Lyrics;
  };
  bench(opts?: BenchOptions): Promise<BenchPageResult>;
}
export type PveWindow = { __pve?: PveExport };

/** The Chrome profile pool: `chrome-profile`, `chrome-profile-1` … `chrome-profile-7`. A command takes free ones. */
export const PROFILE = path.join(ROOT, 'out/cache/chrome-profile');
export const PROFILES = 8;
const profileDir = (k: number) => (k ? `${PROFILE}-${k}` : PROFILE);

function seconds(v: string | undefined, def: number): number {
  const n = Number(v);
  return v !== undefined && Number.isFinite(n) && n > 0 ? n : def;
}
/** Deadline for the page to boot and load its clips (scene init), in ms. `PVE_READY_TIMEOUT` in seconds, default 60. */
export const READY_MS = seconds(process.env.PVE_READY_TIMEOUT, 60) * 1000;
/** Deadline for one frame (`still`, one sheet tile), in ms. `PVE_FRAME_TIMEOUT` in seconds, default 30. */
export const FRAME_MS = seconds(process.env.PVE_FRAME_TIMEOUT, 30) * 1000;

/**
 * Rejects when `p` takes longer than `ms`. A page that runs a scene in a loop never answers, so each page step
 * goes through this. The caller then closes the browser, which stops the page.
 */
export async function deadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  p.catch(() => {}); // after a timeout the browser closes and `p` rejects: nobody waits for it then
  const { promise: late, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => reject(new Error(`${what} took more than ${ms / 1000} s: the page is stuck (a scene loops, or its init or render is too slow). PVE_READY_TIMEOUT and PVE_FRAME_TIMEOUT (seconds) set the limits.`)), ms);
  try { return await Promise.race([p, late]); } finally { clearTimeout(timer); }
}

/** ANGLE backend for this platform (Chrome's default elsewhere). */
export const ANGLE: Partial<Record<NodeJS.Platform, string>> = { win32: 'd3d11', darwin: 'metal' };

async function reachable(url: string) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}

/** Stop a child process and its children (on Windows `bunx` is a shim with the real process as a child). */
export function killTree(proc: { pid: number; kill: () => void }) {
  if (process.platform === 'win32') Bun.spawnSync(['taskkill', '/PID', String(proc.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' });
  else proc.kill();
}

/**
 * The dev server for a headless page: `url` if given and it answers, else a private one without live reload.
 * A shared dev server with live reload reloads the page when an agent saves a file mid-render.
 */
export async function ensureServer(url?: string): Promise<{ url: string; stop: () => void }> {
  if (url) {
    if (await reachable(url)) return { url, stop: () => {} };
    throw new Error(`no dev server answers at ${url}`);
  }
  // a free port: the OS picks one for a moment, Vite takes it
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  // no live reload: a file saved mid-render must not reload the page. `--bun`: the project loader in
  // vite.config.ts reads prompt.yaml with Bun.YAML, so Vite runs in the Bun runtime, not in Node.
  const proc = Bun.spawn(['bunx', '--bun', 'vite', '--port', String(port), '--strictPort'], { cwd: APP, stdout: 'ignore', stderr: 'ignore', env: { ...process.env, PVE_NO_HMR: '1' } });
  const u = `http://localhost:${port}`;
  for (let i = 0; i < 300 && !(await reachable(u)); i++) await Bun.sleep(100);
  if (!(await reachable(u))) { killTree(proc); throw new Error(`the Vite dev server did not start on port ${port} within 30 s`); }
  return { url: u, stop: () => killTree(proc) };
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return e instanceof Error && 'code' in e && e.code === 'EPERM'; }
}

/** Held profile locks of this process, released on exit. A lock left by a killed process is taken over. */
const held = new Set<string>();
process.on('exit', () => { for (const f of held) rmSync(f, { force: true }); });

/** Takes the lock of profile folder `dir`. Returns the release function, or the holder when another process has it. */
function tryLock(dir: string): (() => void) | string {
  const file = `${dir}.lock`;
  mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, cmd: process.argv.slice(1).map((a) => path.basename(a)).join(' '), since: new Date().toISOString() }));
      closeSync(fd);
      held.add(file);
      return () => { held.delete(file); rmSync(file, { force: true }); };
    } catch (e) {
      if (!(e instanceof Error && 'code' in e && e.code === 'EEXIST')) throw e;
    }
    let holder: { pid?: number; cmd?: string; since?: string } = {};
    try { holder = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; /* being written: read again */ }
    if (holder.pid !== undefined && !alive(holder.pid)) { rmSync(file, { force: true }); continue; }
    return `${path.basename(dir)}: ${holder.cmd ?? '?'} (pid ${holder.pid ?? '?'}, since ${holder.since ?? '?'})`;
  }
  return `${path.basename(dir)}: lock file is changing`;
}

/** Takes the first free profile of the pool. Throws at once when all are busy. */
export function acquireProfile(): { dir: string; release: () => void } {
  const busy: string[] = [];
  for (let k = 0; k < PROFILES; k++) {
    const dir = profileDir(k);
    const r = tryLock(dir);
    if (typeof r === 'function') return { dir, release: r };
    busy.push(r);
  }
  throw new Error(`all ${PROFILES} Chrome profiles are busy:\n  ${busy.join('\n  ')}\nStop a stuck one with taskkill /PID <pid> /T /F.`);
}

export interface OpenOptions {
  scale?: number;
  /** Load only these clips (comma-separated ids). */
  only?: string;
  headed?: boolean;
  /** Keep the GPU 2D canvas, as in the live preview (not deterministic: for timing only, never for pixels). */
  gpuCanvas?: boolean;
  /** The precision of the lit HDR targets: `half` (16-bit float, the default) or `float` (32-bit: free of the GPU's 16-bit blend rounding, for the checks). */
  hdr?: 'half' | 'float';
}

/**
 * Chrome flags for every headless render (stills, golden, determinism, video, bench).
 * `--disable-accelerated-2d-canvas`: the GPU (Skia) 2D canvas is not deterministic. On an RTX 3060 with
 * D3D11 ANGLE the same frame drifts by up to 17 levels on Canvas2D text and line edges during a session
 * and between runs. The software 2D canvas gives the same pixels on every render. WebGL stays on the GPU.
 */
export const CHROME_ARGS = [
  // PVE_ANGLE (such as `gl`) renders on another ANGLE backend, to reproduce a fault that one browser setup shows
  ...(process.env.PVE_ANGLE ? [`--use-angle=${process.env.PVE_ANGLE}`] : ANGLE[process.platform] ? [`--use-angle=${ANGLE[process.platform]}`] : []),
  '--disable-accelerated-2d-canvas',
  '--enable-gpu-rasterization', '--ignore-gpu-blocklist',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
];

/** An open export page. Closing `browser` releases the profile lock. */
export interface OpenPage {
  browser: BrowserContext;
  page: Page;
  /** Console errors and warnings, page errors and failed requests. */
  logs: string[];
}

/** Open project `project` in export mode and wait until it is ready. Takes a free profile first (fails at once if none). */
export async function openPage(url: string, project: string, o: OpenOptions = {}): Promise<OpenPage> {
  const scale = o.scale ?? 1;
  const { dir: profile, release } = acquireProfile();
  let browser: BrowserContext;
  try {
    browser = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      headless: !o.headed,
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      args: o.gpuCanvas ? CHROME_ARGS.filter((x) => x !== '--disable-accelerated-2d-canvas') : CHROME_ARGS,
    });
  } catch (e) {
    release();
    throw e;
  }
  browser.on('close', release);
  const logs: string[] = [];
  try {
    const page = browser.pages()[0] ?? (await browser.newPage());
    // A failed load (404, network error) is a console error whose location is the failed URL. The
    // favicon request is not a page request, so the console is the only place where it shows.
    page.on('console', (m) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return;
      logs.push(`[${m.type()}] ${m.text()}${m.text().startsWith('Failed to load resource') ? ` ${m.location().url}` : ''}`);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    // One deadline for load and init. Playwright's own timeouts do not fire while the page's main thread is busy.
    const t0 = performance.now();
    const boot = (async () => {
      await page.goto(`${url}/?export=1&project=${encodeURIComponent(project)}${o.only ? `&only=${o.only}` : ''}${scale !== 1 ? `&scale=${scale}` : ''}${o.hdr === 'float' ? '&hdr=float' : ''}`, { timeout: READY_MS });
      await page.waitForFunction(() => { const p = (window as unknown as PveWindow).__pve; return p?.ready || p?.error; }, null, { timeout: READY_MS });
    })();
    await deadline(boot, READY_MS, `loading the page (clips: ${o.only ?? 'all'})`);
    if (process.env.PVE_VERBOSE) console.error(`page ready in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    const err = await page.evaluate(() => (window as unknown as PveWindow).__pve!.error);
    if (err) throw new Error(`app failed to boot:\n${err}\n${logs.join('\n')}`);
    const size: [number, number] = await page.evaluate(() => { const p = (window as unknown as PveWindow).__pve!; return [p.width ?? 1920, p.height ?? 1080]; });
    if (size[0] !== 1920 * scale || size[1] !== 1080 * scale) throw new Error(`app renders ${size[0]}x${size[1]}, expected ${1920 * scale}x${1080 * scale} (--scale ${scale})`);
    const sceneErrors: string[] = await page.evaluate(() => (window as unknown as PveWindow).__pve!.errors);
    if (sceneErrors.length) console.error('SCENE ERRORS:\n' + sceneErrors.join('\n'));
    return { browser, page, logs };
  } catch (e) {
    if (logs.length) console.error('BROWSER LOG:\n' + logs.slice(0, 40).join('\n'));
    await closeBrowser(browser);
    throw e;
  }
}

/** Full Chrome version of an open page's browser (`138.0.7204.101`; the user agent has only `138.0.0.0`). */
export function chromeVersion(ctx: BrowserContext): string {
  const b = ctx.browser();
  if (!b) throw new Error('the browser context has no browser: no Chrome version');
  return b.version();
}

/** The GPU of the page's WebGL2 context, and whether it has EXT_disjoint_timer_query_webgl2. */
export async function gpuInfo(page: Page): Promise<{ gpu: string; timerQuery: boolean }> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw new Error('no WebGL2 context');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (!info) throw new Error('no WEBGL_debug_renderer_info: the GPU name is hidden');
    return { gpu: String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)), timerQuery: gl.getExtension('EXT_disjoint_timer_query_webgl2') !== null };
  });
}

/**
 * Throws when the page logged an error (a shader that does not compile, a scene that throws, a file that
 * does not load): the frames of such a run are not evidence. Warnings pass.
 */
export function assertNoBrowserErrors(logs: string[]): void {
  const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  if (errors.length) throw new Error(`the page logged ${errors.length} error${errors.length === 1 ? '' : 's'}, the frames are not valid:\n${errors.slice(0, 10).join('\n')}`);
}

/** Closes Chrome. A busy page can delay the close: give up after 10 s (Playwright kills Chrome when the process exits). */
export async function closeBrowser(browser: BrowserContext): Promise<void> {
  await deadline(browser.close(), 10_000, 'closing Chrome').catch(() => {});
}

/** The pages of one `withPages` run. Closing a page prints its log first. */
export interface Pages {
  /** Opens a page of the project (the options of `withPages`, then these). */
  open(o?: OpenOptions): Promise<OpenPage>;
  /** Prints the log of the page, then closes it. */
  close(p: OpenPage): Promise<void>;
  /** Closes every open page. */
  closeAll(): Promise<void>;
  /** Closes every open page, then throws when a page logged an error (`assertNoBrowserErrors`). */
  check(): Promise<void>;
}

/**
 * Runs `fn` with pages of `project`: starts the server if needed, closes every page (log first) and the server after.
 * Fails on browser errors of any page.
 */
export async function withPages<T>(project: string, o: OpenOptions & { url?: string }, fn: (pages: Pages) => Promise<T>): Promise<T> {
  const { url, stop } = await ensureServer(o.url);
  const open = new Set<OpenPage>();
  const logs: string[] = [];
  const pages: Pages = {
    async open(more = {}) {
      const p = await openPage(url, project, { ...o, ...more });
      open.add(p);
      return p;
    },
    async close(p) {
      if (!open.delete(p)) return;
      if (p.logs.length) console.error('BROWSER LOG:\n' + p.logs.slice(0, 40).join('\n'));
      logs.push(...p.logs);
      await closeBrowser(p.browser);
    },
    async closeAll() {
      for (const p of [...open]) await pages.close(p);
    },
    async check() {
      await pages.closeAll();
      assertNoBrowserErrors(logs);
    },
  };
  try {
    const result = await fn(pages);
    await pages.check();
    return result;
  } finally {
    await pages.closeAll();
    stop();
  }
}

/** Runs `fn` with one page of `project` (see `withPages`). */
export function withPage<T>(project: string, o: OpenOptions & { url?: string }, fn: (page: Page) => Promise<T>): Promise<T> {
  return withPages(project, o, async (pages) => fn((await pages.open()).page));
}
