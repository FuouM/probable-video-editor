#!/usr/bin/env bun
// THROWAWAY: renders video/scenes/script-board.ts (not a clip) into out/script-board.png.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureServer, openPage, type PveWindow } from '../../../packages/cli/src/browser';

const out = path.resolve(import.meta.dir, '../out/script-board.png');
const T0 = 10_000;

const { url, stop } = await ensureServer();
try {
  const { browser, page } = await openPage(url, 'god_ish', { only: 'none' });
  try {
    await page.evaluate(async ([t0, src]) => {
      const w = window as unknown as PveWindow & { __pve: { engine: Record<string, unknown> & { timeline: unknown[] } } };
      const e = { id: 'script-board', scene: 'script-board', load: () => import(/* @vite-ignore */ src), start: t0, end: t0 + 1 };
      w.__pve.engine.timeline.push(e);
      await (w.__pve.engine.loadEntry as (e: unknown) => Promise<void>).call(w.__pve.engine, e);
      w.__pve.engine.hudOff = true;
    }, [T0, '/projects/god_ish/video/scenes/script-board.ts'] as const);
    const errors = await page.evaluate(() => (window as unknown as PveWindow).__pve!.errors);
    if (errors.length) throw new Error(errors.join('\n'));
    await page.evaluate(([t, s]) => (window as unknown as PveWindow).__pve!.still(t, s, 0), [T0 + 0.5, 1] as const);
    mkdirSync(path.dirname(out), { recursive: true });
    await Bun.write(out, Buffer.from(await page.evaluate(() => (window as unknown as PveWindow).__pve!.png()), 'base64'));
    console.log(path.relative(process.cwd(), out));
  } finally {
    await browser.close();
  }
} finally {
  stop();
}
