// The browser session of every command that renders (still, look, bench, render) and of the root check
// scripts (golden, determinism): the Vite dev server and one headless Chrome on the app's export mode
// (?export=1&project=<id>, window.__pve).
// Chrome runs with a persistent profile (its GPU shader cache keeps compiled shaders between runs). Two
// Chromes cannot share a profile, so a lock file guards each one: a second command waits for the first.
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { BenchOptions, BenchPageResult } from '@pve/engine/bench/types';
import type { AdaptiveSampling } from '@pve/engine/engine';
import type { Mark } from '@pve/engine/marks';

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
  stream(o: { from: number; to: number; fps: number; ws: string; samples?: number | AdaptiveSampling; shutter?: number; inflight?: number }): Promise<StreamFrame[]>;
  engine: {
    hudOff: boolean;
    render(t: number, dt?: number, toScreen?: boolean, samples?: number | AdaptiveSampling, shutter?: number): number;
    readPixelsAsync(buf?: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
  };
  bench(opts?: BenchOptions): Promise<BenchPageResult>;
}
export type PveWindow = { __pve?: PveExport };

/** Persistent Chrome profile. Slot k > 0 (a second render worker) uses `chrome-profile-k`. */
export const PROFILE = path.join(ROOT, 'out/cache/chrome-profile');

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

/** Use the dev server at `url` if it answers, else start a private one. */
export async function ensureServer(url = 'http://localhost:5173'): Promise<{ url: string; stop: () => void }> {
  if (await reachable(url)) return { url, stop: () => {} };
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

/**
 * Waits until this process holds the profile folder `dir` (lock file `<dir>.lock` with pid and command).
 * A lock whose process is gone is taken over. Returns the release function.
 */
export async function lockProfile(dir: string, onWait: (holder: string) => void = (h) => console.error(`waiting for Chrome: ${h}`)): Promise<() => void> {
  const file = `${dir}.lock`;
  mkdirSync(path.dirname(file), { recursive: true });
  let told = false;
  for (;;) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, cmd: process.argv.slice(1).map((a) => path.basename(a)).join(' '), since: new Date().toISOString() }));
      closeSync(fd);
      held.add(file);
      return () => { held.delete(file); rmSync(file, { force: true }); };
    } catch (e) {
      if (!(e instanceof Error && 'code' in e && e.code === 'EEXIST')) throw e;
    }
    let holder: { pid?: number; cmd?: string } = {};
    try { holder = JSON.parse(readFileSync(file, 'utf8')); } catch { /* being written: read again */ }
    if (holder.pid !== undefined && !alive(holder.pid)) {
      try { rmSync(file, { force: true }); } catch { /* retry */ }
      continue;
    }
    if (!told && holder.pid !== undefined) { onWait(`${holder.cmd ?? '?'} (pid ${holder.pid}) uses ${path.basename(dir)}`); told = true; }
    await Bun.sleep(250);
  }
}

export interface OpenOptions {
  scale?: number;
  /** Load only these clips (comma-separated ids). */
  only?: string;
  headed?: boolean;
  /** Profile slot: concurrent Chromes of one command need their own profile folders. */
  slot?: number;
}

/**
 * Chrome flags for every headless render (stills, golden, determinism, video, bench).
 * `--disable-accelerated-2d-canvas`: the GPU (Skia) 2D canvas is not deterministic. On an RTX 3060 with
 * D3D11 ANGLE the same frame drifts by up to 17 levels on Canvas2D text and line edges during a session
 * and between runs. The software 2D canvas gives the same pixels on every render. WebGL stays on the GPU.
 */
export const CHROME_ARGS = [
  ...(ANGLE[process.platform] ? [`--use-angle=${ANGLE[process.platform]}`] : []),
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

/** Open project `project` in export mode and wait until it is ready. Waits for the profile lock first. */
export async function openPage(url: string, project: string, o: OpenOptions = {}): Promise<OpenPage> {
  const scale = o.scale ?? 1;
  const profile = o.slot ? `${PROFILE}-${o.slot}` : PROFILE;
  const release = await lockProfile(profile);
  let browser: BrowserContext;
  try {
    browser = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      headless: !o.headed,
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      args: CHROME_ARGS,
    });
  } catch (e) {
    release();
    throw e;
  }
  browser.on('close', release);
  try {
    const page = browser.pages()[0] ?? (await browser.newPage());
    const logs: string[] = [];
    // A failed load (404, network error) is a console error whose location is the failed URL. The
    // favicon request is not a page request, so the console is the only place where it shows.
    page.on('console', (m) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return;
      logs.push(`[${m.type()}] ${m.text()}${m.text().startsWith('Failed to load resource') ? ` ${m.location().url}` : ''}`);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    await page.goto(`${url}/?export=1&project=${encodeURIComponent(project)}${o.only ? `&only=${o.only}` : ''}${scale !== 1 ? `&scale=${scale}` : ''}`);
    await page.waitForFunction(() => { const p = (window as unknown as PveWindow).__pve; return p?.ready || p?.error; }, null, { timeout: 120000 });
    const err = await page.evaluate(() => (window as unknown as PveWindow).__pve!.error);
    if (err) throw new Error(`app failed to boot:\n${err}\n${logs.join('\n')}`);
    const size: [number, number] = await page.evaluate(() => { const p = (window as unknown as PveWindow).__pve!; return [p.width ?? 1920, p.height ?? 1080]; });
    if (size[0] !== 1920 * scale || size[1] !== 1080 * scale) throw new Error(`app renders ${size[0]}x${size[1]}, expected ${1920 * scale}x${1080 * scale} (--scale ${scale})`);
    const sceneErrors: string[] = await page.evaluate(() => (window as unknown as PveWindow).__pve!.errors);
    if (sceneErrors.length) console.error('SCENE ERRORS:\n' + sceneErrors.join('\n'));
    return { browser, page, logs };
  } catch (e) {
    await browser.close().catch(() => {});
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

/** Runs `fn` with a page of `project`: starts the server if needed, closes everything after. Fails on browser errors. */
export async function withPage<T>(project: string, o: OpenOptions & { url?: string }, fn: (page: Page, logs: string[]) => Promise<T>): Promise<T> {
  const { url, stop } = await ensureServer(o.url);
  try {
    const { browser, page, logs } = await openPage(url, project, o);
    let result: T;
    try {
      result = await fn(page, logs);
    } finally {
      if (logs.length) console.error('BROWSER LOG:\n' + logs.slice(0, 40).join('\n'));
      await browser.close().catch(() => {});
    }
    assertNoBrowserErrors(logs);
    return result;
  } finally {
    stop();
  }
}
