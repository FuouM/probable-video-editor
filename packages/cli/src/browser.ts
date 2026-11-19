// The browser session of every command that renders (still, look, bench, render, order, golden,
// determinism): the Vite dev server and headless Chrome pages on the app's export mode
// (?export=1&project=<id>, window.__pve).
// Chrome runs with a persistent profile (its GPU shader cache keeps compiled shaders between runs). Two
// Chromes cannot share a profile, so a lock file guards each one. A command takes the first free profile of a
// pool, so commands run side by side. When all profiles are busy, the command fails at once: it never waits.
// Each page step has a deadline (PVE_READY_TIMEOUT, PVE_FRAME_TIMEOUT): a stuck scene fails the command.
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type Page } from 'playwright-core';
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
 * Each private server takes its own dependency cache (`out/cache/vite-<k>`, a pool locked as the Chrome profiles). With one
 * shared cache, a server that bundles the dependencies again replaces the files that another server's page is loading: that
 * page gets 404 for `.vite/deps/three.js` and never boots.
 */
export async function ensureServer(url?: string): Promise<{ url: string; stop: () => void }> {
  if (url) {
    if (await reachable(url)) return { url, stop: () => {} };
    throw new Error(`no dev server answers at ${url}`);
  }
  const busy: string[] = [];
  let cache: { dir: string; release: () => void } | null = null;
  for (let k = 0; k < PROFILES && !cache; k++) {
    const dir = path.join(ROOT, `out/cache/vite-${k}`);
    const r = tryLock(dir);
    if (typeof r === 'function') cache = { dir, release: r };
    else busy.push(r);
  }
  if (!cache) throw new Error(`all ${PROFILES} Vite caches are busy:\n  ${busy.join('\n  ')}\nStop a stuck one with taskkill /PID <pid> /T /F.`);
  const { dir, release } = cache;
  // a free port: the OS picks one for a moment, Vite takes it
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  // no live reload: a file saved mid-render must not reload the page. `--bun`: the project loader in
  // vite.config.ts reads prompt.yaml with Bun.YAML, so Vite runs in the Bun runtime, not in Node.
  const proc = Bun.spawn(['bunx', '--bun', 'vite', '--port', String(port), '--strictPort'], { cwd: APP, stdout: 'ignore', stderr: 'ignore', env: { ...process.env, PVE_NO_HMR: '1', PVE_VITE_CACHE: dir } });
  const u = `http://localhost:${port}`;
  const stop = () => { killTree(proc); release(); };
  for (let i = 0; i < 300 && !(await reachable(u)); i++) await Bun.sleep(100);
  if (!(await reachable(u))) { stop(); throw new Error(`the Vite dev server did not start on port ${port} within 30 s`); }
  return { url: u, stop };
}

export function alive(pid: number): boolean {
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
  /**
   * Reuse a warm page of the render server (`pve serve`) with the same URL and the current sources, and keep it warm
   * after. Only for commands that render frames and leave no state (a frame is a pure function of its time).
   */
  warm?: boolean;
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
  // after a lost WebGL context (a GPU reset: a shader too slow for the driver's watchdog), Chrome blocks WebGL for the
  // site, and the next page of that profile cannot open a context ("Web page caused context loss and was blocked")
  '--disable-domain-blocking-for-3d-apis',
];

/** An open export page. `release` ends its use: it closes the Chrome of the command, or the page of the render server, or hands a warm page back. */
export interface OpenPage {
  browser: BrowserContext;
  page: Page;
  /** Console errors and warnings, page errors and failed requests. */
  logs: string[];
  release(): Promise<void>;
}

/** Collects the console errors and warnings, page errors and failed requests of `page` into `logs`. Returns the function that stops it. */
function listen(page: Page, logs: string[]): () => void {
  // A failed load (404, network error) is a console error whose location is the failed URL. The
  // favicon request is not a page request, so the console is the only place where it shows.
  const onConsole = (m: ConsoleMessage) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    logs.push(`[${m.type()}] ${m.text()}${m.text().startsWith('Failed to load resource') ? ` ${m.location().url}` : ''}`);
  };
  const onError = (e: Error) => logs.push(`[pageerror] ${e.message}`);
  page.on('console', onConsole);
  page.on('pageerror', onError);
  return () => { page.off('console', onConsole); page.off('pageerror', onError); };
}

/** Loads the export page `target` in `page` and waits until it is ready, then checks it. */
async function bootPage(page: Page, target: string, o: OpenOptions, logs: string[]): Promise<void> {
  const scale = o.scale ?? 1;
  // One deadline for load and init. Playwright's own timeouts do not fire while the page's main thread is busy.
  // A page error or a WebGL context that does not open while the page boots stops it for good: fail at once, not
  // after the deadline (a module that did not load, a GPU process that went away).
  const t0 = performance.now();
  const { promise: broke, reject: fail } = Promise.withResolvers<never>();
  broke.catch(() => {});
  const onError = (e: Error) => fail(new Error(`the page failed while it loaded: ${e.message}`));
  const onConsole = (m: ConsoleMessage) => { if (m.type() === 'error' && m.text().includes('Error creating WebGL context')) fail(new Error(`the page could not open a WebGL context (the GPU process failed or is out of contexts): ${m.text()}`)); };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  try {
    const boot = (async () => {
      await page.goto(target, { timeout: READY_MS });
      await page.waitForFunction(() => { const p = (window as unknown as PveWindow).__pve; return p?.ready || p?.error; }, null, { timeout: READY_MS });
    })();
    await deadline(Promise.race([boot, broke]), READY_MS, `loading the page (clips: ${o.only ?? 'all'})`);
  } finally {
    page.off('pageerror', onError);
    page.off('console', onConsole);
  }
  if (process.env.PVE_VERBOSE) console.error(`page ready in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const err = await page.evaluate(() => (window as unknown as PveWindow).__pve!.error);
  if (err) throw new Error(`app failed to boot:\n${err}\n${logs.join('\n')}`);
  const size: [number, number] = await page.evaluate(() => { const p = (window as unknown as PveWindow).__pve!; return [p.width ?? 1920, p.height ?? 1080]; });
  if (size[0] !== 1920 * scale || size[1] !== 1080 * scale) throw new Error(`app renders ${size[0]}x${size[1]}, expected ${1920 * scale}x${1080 * scale} (--scale ${scale})`);
  const sceneErrors: string[] = await page.evaluate(() => (window as unknown as PveWindow).__pve!.errors);
  if (sceneErrors.length) console.error('SCENE ERRORS:\n' + sceneErrors.join('\n'));
}

/** Open project `project` in export mode in a Chrome of its own and wait until it is ready. Takes a free profile first (fails at once if none). */
export async function openPage(url: string, project: string, o: OpenOptions = {}): Promise<OpenPage> {
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
    listen(page, logs);
    await bootPage(page, pageUrl(url, project, o), o, logs);
    return { browser, page, logs, release: () => closeBrowser(browser) };
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
  /** Prints the log of the page, then releases it. */
  close(p: OpenPage): Promise<void>;
  /** Releases every open page. */
  closeAll(): Promise<void>;
  /** Releases every open page, then throws when a page logged an error (`assertNoBrowserErrors`). */
  check(): Promise<void>;
}

// ------------------------------------------------------------------ the render server (pve serve)

/** The state file of the render server (`pve serve run` writes it, the commands read it). */
export const SERVE_FILE = path.join(ROOT, 'out/cache/serve.json');
/** Its mtime is the last use of the render server: the server stops after its idle time. */
export const SERVE_USED = path.join(ROOT, 'out/cache/serve.used');
export interface ServeState { pid: number; url: string; cdp: string; angle: string; profile: string; since: string; idleMin: number }
/** The ANGLE backend of the Chrome that these flags launch: a server serves only the commands of its backend. */
export const angleOf = () => process.env.PVE_ANGLE ?? ANGLE[process.platform] ?? 'default';
/** Idle warm pages that the server keeps (the least recently used one closes first). */
const WARM_PAGES = 3;

/** The state of a running render server, or null (a state file of a process that is gone is removed). */
export function readServe(): ServeState | null {
  let s: ServeState;
  try { s = JSON.parse(readFileSync(SERVE_FILE, 'utf8')) as ServeState; } catch { return null; }
  if (alive(s.pid)) return s;
  rmSync(SERVE_FILE, { force: true });
  return null;
}

/** The newest mtime of the files that a page loads: the app, the engine, the core and the project (not its out/ and site/). */
function sourceStamp(project: string): number {
  let newest = 0;
  const walk = (dir: string) => {
    let names: string[];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (n === 'out' || n === 'site' || n === 'node_modules' || n.startsWith('.')) continue;
      const f = path.join(dir, n);
      const s = statSync(f);
      if (s.isDirectory()) walk(f);
      else if (s.mtimeMs > newest) newest = s.mtimeMs;
    }
  };
  for (const d of ['app/src', 'app/index.html', 'packages/engine/src', 'packages/core/src', `projects/${project}`]) {
    const f = path.join(ROOT, d);
    if (d.endsWith('.html')) newest = Math.max(newest, statSync(f).mtimeMs);
    else walk(f);
  }
  return newest;
}

/** The URL of the export page of `project` with these options. */
function pageUrl(url: string, project: string, o: OpenOptions): string {
  const scale = o.scale ?? 1;
  return `${url}/?export=1&project=${encodeURIComponent(project)}${o.only ? `&only=${o.only}` : ''}${scale !== 1 ? `&scale=${scale}` : ''}${o.hdr === 'float' ? '&hdr=float' : ''}`;
}

/** What a page of the server holds: its lease (the pid of the command that uses it), the source stamp it loaded, its last use. */
type WarmWindow = PveWindow & { __pveLease?: number | null; __pveStamp?: number; __pveUsed?: number };

/** Hands a warm page back to the server, then closes the least recently used idle warm pages over WARM_PAGES. */
async function handBack(ctx: BrowserContext, page: Page): Promise<void> {
  await page.evaluate(() => { const w = window as unknown as WarmWindow; w.__pveLease = null; w.__pveUsed = Date.now(); }).catch(() => {});
  const idle: { page: Page; used: number }[] = [];
  for (const p of ctx.pages()) {
    const used = await p.evaluate(() => { const w = window as unknown as WarmWindow; return w.__pveStamp !== undefined && !w.__pveLease ? w.__pveUsed ?? 0 : -1; }).catch(() => -1);
    if (used >= 0) idle.push({ page: p, used });
  }
  idle.sort((a, b) => b.used - a.used);
  for (const { page: p } of idle.slice(WARM_PAGES)) await p.close().catch(() => {});
}

/** Takes a warm page of the server for `target` that loaded the current sources, or null. A page with stale sources closes. */
async function leaseWarm(ctx: BrowserContext, target: string, stamp: number): Promise<Page | null> {
  for (const p of ctx.pages()) {
    if (p.url() !== target) continue;
    const got = await p.evaluate(({ pid, stamp }) => {
      const w = window as unknown as WarmWindow;
      if (w.__pveStamp === undefined) return 'booting';
      if (w.__pveLease && w.__pveLease !== pid) return w.__pveLease;
      if (w.__pveStamp !== stamp) return 'stale';
      w.__pveLease = pid;
      return 'ok';
    }, { pid: process.pid, stamp }).catch(() => 'gone');
    if (got === 'ok') return p;
    if (got === 'stale') { await p.close().catch(() => {}); continue; }
    // a lease of a command that is gone: take the page over
    if (typeof got === 'number' && !alive(got)) {
      const taken = await p.evaluate(({ pid, old, stamp }) => {
        const w = window as unknown as WarmWindow;
        if (w.__pveLease !== old || w.__pveStamp !== stamp) return false;
        w.__pveLease = pid;
        return true;
      }, { pid: process.pid, old: got, stamp }).catch(() => false);
      if (taken) return p;
    }
  }
  return null;
}

/** Opens a page on the render server: a warm page when `o.warm` and one is free, else a new page. */
async function openOnServer(ctx: BrowserContext, url: string, project: string, o: OpenOptions): Promise<OpenPage> {
  writeFileSync(SERVE_USED, '');
  const target = pageUrl(url, project, o);
  const stamp = o.warm ? sourceStamp(project) : 0;
  const logs: string[] = [];
  const warm = o.warm ? await leaseWarm(ctx, target, stamp) : null;
  if (warm) {
    const detach = listen(warm, logs);
    if (process.env.PVE_VERBOSE) console.error('pve: warm page of the render server');
    return { browser: ctx, page: warm, logs, release: async () => { detach(); await handBack(ctx, warm); } };
  }
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  const detach = listen(page, logs);
  try {
    await bootPage(page, target, o, logs);
  } catch (e) {
    if (logs.length) console.error('BROWSER LOG:\n' + logs.slice(0, 40).join('\n'));
    await page.close().catch(() => {});
    throw e;
  }
  if (!o.warm) return { browser: ctx, page, logs, release: async () => { detach(); await page.close().catch(() => {}); } };
  await page.evaluate(({ pid, stamp }) => { const w = window as unknown as WarmWindow; w.__pveLease = pid; w.__pveStamp = stamp; }, { pid: process.pid, stamp });
  return { browser: ctx, page, logs, release: async () => { detach(); await handBack(ctx, page); } };
}

/**
 * Runs `fn` with pages of `project`. With a render server (`pve serve`, same ANGLE backend) the pages open in its Chrome
 * on its dev server; else the command starts its own server and Chrome. Releases every page (log first) after, and
 * fails on browser errors of any page. `PVE_NO_SERVE=1`, `url`, `headed` and `gpuCanvas` never use the render server.
 */
export async function withPages<T>(project: string, o: OpenOptions & { url?: string }, fn: (pages: Pages) => Promise<T>): Promise<T> {
  const serve = o.url || o.headed || o.gpuCanvas || process.env.PVE_NO_SERVE ? null : readServe();
  let ctx: BrowserContext | null = null, cdp: Browser | null = null;
  if (serve && serve.angle === angleOf()) {
    cdp = await deadline(chromium.connectOverCDP(serve.cdp), 10_000, 'connecting to the render server');
    ctx = cdp.contexts()[0] ?? null;
    if (!ctx) throw new Error(`the render server (pid ${serve.pid}) has no browser context: stop it with pve serve stop`);
  }
  const { url, stop } = serve && ctx ? { url: serve.url, stop: () => {} } : await ensureServer(o.url);
  const open = new Set<OpenPage>();
  const logs: string[] = [];
  const pages: Pages = {
    async open(more = {}) {
      const p = ctx ? await openOnServer(ctx, url, project, { ...o, ...more }) : await openPage(url, project, { ...o, ...more });
      open.add(p);
      return p;
    },
    async close(p) {
      if (!open.delete(p)) return;
      if (p.logs.length) console.error('BROWSER LOG:\n' + p.logs.slice(0, 40).join('\n'));
      logs.push(...p.logs);
      await p.release();
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
    // disconnects from the render server (its Chrome keeps running); the end of a long command is a use too
    if (cdp) { writeFileSync(SERVE_USED, ''); await cdp.close().catch(() => {}); }
  }
}

/** Runs `fn` with one page of `project` (see `withPages`). */
export function withPage<T>(project: string, o: OpenOptions & { url?: string }, fn: (page: Page) => Promise<T>): Promise<T> {
  return withPages(project, o, async (pages) => fn((await pages.open()).page));
}
