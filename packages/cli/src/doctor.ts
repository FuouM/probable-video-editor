// pve doctor (DESIGN 8.2): the toolchain that the commands need, and what this machine's GPU supports.
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { APP, CHROME_ARGS, gpuInfo, ROOT } from './browser';

export interface Finding {
  name: string;
  ok: boolean;
  detail: string;
}

function run(cmd: string[]): { ok: boolean; out: string } {
  try {
    const r = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
    return { ok: r.exitCode === 0, out: r.stdout.toString() + r.stderr.toString() };
  } catch (e) {
    return { ok: false, out: e instanceof Error ? e.message : String(e) };
  }
}

export async function doctor(): Promise<Finding[]> {
  const out: Finding[] = [{ name: 'bun', ok: true, detail: Bun.version }];

  const ff = run(['ffmpeg', '-hide_banner', '-version']);
  if (!ff.ok) out.push({ name: 'ffmpeg', ok: false, detail: `not found on PATH: ${ff.out.trim().split('\n')[0]}` });
  else {
    const enc = run(['ffmpeg', '-hide_banner', '-encoders']).out;
    const missing = ['libx264', 'aac'].filter((e) => !new RegExp(`\\s${e}\\s`).test(enc));
    out.push({ name: 'ffmpeg', ok: !missing.length, detail: `${ff.out.split('\n')[0]!.trim()}${missing.length ? `; missing encoders: ${missing.join(', ')}` : '; libx264, aac'}` });
  }

  try {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: CHROME_ARGS });
    try {
      const page = await browser.newPage();
      const g = await gpuInfo(page);
      out.push({ name: 'chrome', ok: true, detail: `${browser.version()} headless, ${CHROME_ARGS[0]}` });
      out.push({ name: 'gpu', ok: true, detail: g.gpu });
      out.push({ name: 'timer query', ok: g.timerQuery, detail: g.timerQuery ? 'EXT_disjoint_timer_query_webgl2: benchmarks measure GPU time (timer-query)' : 'no EXT_disjoint_timer_query_webgl2: pve bench and pve render cannot measure GPU time' });
    } finally {
      await browser.close();
    }
  } catch (e) {
    out.push({ name: 'chrome', ok: false, detail: `Chrome does not start: ${e instanceof Error ? e.message.split('\n')[0] : e}. Install Google Chrome` });
  }

  const link = path.join(ROOT, 'packages/core/node_modules/lyricsync');
  try {
    const target = realpathSync(link);
    const isLink = lstatSync(link).isSymbolicLink();
    Bun.resolveSync('lyricsync/song-folder', path.join(ROOT, 'packages/core'));
    out.push({ name: 'lyric-sync', ok: isLink, detail: `${isLink ? 'linked' : 'a copy, not a link'}: ${target}` });
  } catch (e) {
    out.push({ name: 'lyric-sync', ok: false, detail: `lyricsync does not resolve (${e instanceof Error ? e.message.split('\n')[0] : e}). Run bun link in Lyric-Sync/packages/lyricsync, then bun install here` });
  }

  try {
    const pkg = Bun.resolveSync('vite/package.json', APP);
    out.push({ name: 'vite', ok: true, detail: (await Bun.file(pkg).json()).version });
  } catch {
    out.push({ name: 'vite', ok: false, detail: 'vite does not resolve from app/: run bun install' });
  }
  return out;
}
