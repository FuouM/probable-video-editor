// `pve serve`: the render server. It keeps a dev server and a headless Chrome running between commands, so a command
// skips the start of Vite and Chrome (about 2 s), and the commands that only render frames (still, look, probe, seam,
// nan) reuse a warm page of the same project and clips (it skips the page boot and the scene init too). The server
// writes out/cache/serve.json; every command reads it and opens its pages in that Chrome (browser.ts withPages).
// A warm page loaded the sources of one moment: a command that finds a newer source file (app, engine, core, project)
// closes it and boots a new one. The server stops after it is idle for --idle minutes.
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext } from 'playwright-core';
import { acquireProfile, alive, angleOf, CHROME_ARGS, deadline, ensureServer, killTree, readServe, SERVE_FILE, SERVE_USED, type ServeState } from './browser';
import { startJob } from './jobs';

/** Runs the server in this process until it is idle for `idleMin` minutes or is stopped. */
export async function runServe(idleMin: number): Promise<void> {
  const old = readServe();
  if (old) throw new Error(`a render server runs already (pid ${old.pid}, ${old.url})`);
  const { url, stop } = await ensureServer();
  const { dir, release } = acquireProfile();
  let ctx: BrowserContext | null = null;
  const end = async () => {
    rmSync(SERVE_FILE, { force: true });
    if (ctx) await deadline(ctx.close(), 10_000, 'closing Chrome').catch(() => {});
    release();
    stop();
  };
  try {
    rmSync(path.join(dir, 'DevToolsActivePort'), { force: true });
    // port 0: Chrome picks a free port and writes it to DevToolsActivePort in the profile
    ctx = await chromium.launchPersistentContext(dir, { channel: 'chrome', headless: true, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, args: [...CHROME_ARGS, '--remote-debugging-port=0'] });
    let port = 0;
    for (let i = 0; i < 100 && !port; i++) {
      try { port = Number(readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { await Bun.sleep(100); }
    }
    if (!port) throw new Error('Chrome wrote no DevToolsActivePort within 10 s');
    const state: ServeState = { pid: process.pid, url, cdp: `http://127.0.0.1:${port}`, angle: angleOf(), profile: path.basename(dir), since: new Date().toISOString(), idleMin };
    writeFileSync(SERVE_USED, '');
    writeFileSync(SERVE_FILE, JSON.stringify(state, null, 2));
    console.log(`render server ready: ${url}, Chrome ${state.cdp} (${state.angle}), stops after ${idleMin} min idle`);
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    ctx.on('close', () => resolve());
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => resolve());
    while (true) {
      const idle = (Date.now() - statSync(SERVE_USED).mtimeMs) / 60_000;
      if (idle > idleMin) { console.log(`idle for ${idleMin} min: stopping`); break; }
      if (await Promise.race([closed.then(() => true), Bun.sleep(5_000).then(() => false)])) { console.log('Chrome closed: stopping'); break; }
    }
  } finally {
    await end();
  }
}

/** Starts the server as a background job and waits until it is ready. */
export async function startServe(idleMin: number): Promise<ServeState> {
  const old = readServe();
  if (old) return old;
  const job = startJob(['serve', 'run', '--idle', String(idleMin)]);
  for (let i = 0; i < 600; i++) {
    const s = readServe();
    if (s) return s;
    if (!alive(job.pid)) break;
    await Bun.sleep(100);
  }
  throw new Error(`the render server did not start: see out/jobs/${job.id}.log`);
}

/** Stops the server (its process tree: Chrome and Vite). Returns the state it had, or null when none ran. */
export function stopServe(): ServeState | null {
  const s = readServe();
  if (!s) return null;
  killTree({ pid: s.pid, kill: () => process.kill(s.pid) });
  rmSync(SERVE_FILE, { force: true });
  return s;
}

/** One page of the server: its project and clips, whether a command uses it, and how long ago it was last used. */
export interface ServePage { url: string; project: string; only: string; leased: number | null; warm: boolean; idleS: number | null }

/** The pages of the running server. */
export async function servePages(s: ServeState): Promise<ServePage[]> {
  const cdp = await deadline(chromium.connectOverCDP(s.cdp), 10_000, 'connecting to the render server');
  try {
    const out: ServePage[] = [];
    for (const p of cdp.contexts()[0]?.pages() ?? []) {
      const u = new URL(p.url(), 'http://x');
      if (!u.searchParams.has('export')) continue;
      const info = await p.evaluate(() => {
        const w = window as unknown as { __pveLease?: number | null; __pveStamp?: number; __pveUsed?: number };
        return { leased: w.__pveLease ?? null, warm: w.__pveStamp !== undefined, used: w.__pveUsed ?? null };
      }).catch(() => ({ leased: null, warm: false, used: null }));
      out.push({ url: p.url(), project: u.searchParams.get('project') ?? '?', only: u.searchParams.get('only') ?? 'all', leased: info.leased, warm: info.warm, idleS: info.used === null ? null : Math.round((Date.now() - info.used) / 1000) });
    }
    return out;
  } finally {
    await cdp.close().catch(() => {});
  }
}
