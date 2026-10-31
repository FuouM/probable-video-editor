#!/usr/bin/env bun
// Renders the upload's cover: video/scenes/thumbnail.ts (a plate that video.json does not name) through the
// engine in headless Chrome, into out/thumbnail.png (1920x1080, the video's own pixels). Run it again after
// a change to the scene:
//   bun projects/breaked_neuro/video/make-thumbnail.ts [--samples 4]
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureServer, openPage, type PveWindow } from '../../../packages/cli/src/browser';

const si = process.argv.indexOf('--samples');
const samples = si > 0 ? Number(process.argv[si + 1]) : 4;
const out = path.resolve(import.meta.dir, '../out/thumbnail.png');
const T0 = 10_000; // song time of the plate: after the end of the song, so no clip is on screen with it

const { url, stop } = await ensureServer();
try {
  const { browser, page } = await openPage(url, 'breaked_neuro', { only: 'none' });
  try {
    await page.evaluate(async ([t0, src]) => {
      const w = window as unknown as PveWindow & { __pve: { engine: Record<string, unknown> & { timeline: unknown[] } } };
      const e = { id: 'thumbnail', scene: 'thumbnail', load: () => import(/* @vite-ignore */ src), start: t0, end: t0 + 1 };
      w.__pve.engine.timeline.push(e);
      await (w.__pve.engine.loadEntry as (e: unknown) => Promise<void>).call(w.__pve.engine, e);
      w.__pve.engine.hudOff = true;
    }, [T0, '/projects/breaked_neuro/video/scenes/thumbnail.ts'] as const);
    const errors = await page.evaluate(() => (window as unknown as PveWindow).__pve!.errors);
    if (errors.length) throw new Error(errors.join('\n'));
    await page.evaluate(([t, s]) => (window as unknown as PveWindow).__pve!.still(t, s, 0), [T0 + 0.5, samples] as const);
    mkdirSync(path.dirname(out), { recursive: true });
    await Bun.write(out, Buffer.from(await page.evaluate(() => (window as unknown as PveWindow).__pve!.png()), 'base64'));
    console.log(path.relative(process.cwd(), out));
  } finally {
    await browser.close();
  }
} finally {
  stop();
}
