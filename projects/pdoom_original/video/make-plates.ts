#!/usr/bin/env bun
// Renders the plate stills that the outro's rewind montage shows: one JPEG per plate into
// video/assets/plates/figNN.jpg, at the time in video/assets/plates/plates.json (else the clip's middle),
// 4 samples, without the HUD. Run it again after a change to a plate:
//   bun projects/pdoom_original/video/make-plates.ts
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureServer, openPage, type PveWindow } from '../../../packages/cli/src/browser';

const FIGS = ['open', 'loss', 'room', 'shoggoth', 'spacetime', 'ascent', 'bureau', 'leftturn', 'paperclips', 'fuse', 'stack', 'dense', 'loom', 'ilya'];
const dir = path.join(import.meta.dir, 'assets/plates');
const times: Record<string, number> = await Bun.file(path.join(dir, 'plates.json')).json();

const { url, stop } = await ensureServer();
try {
  const { browser, page } = await openPage(url, 'pdoom_original');
  try {
    const tl = await page.evaluate(() => (window as unknown as PveWindow).__pve!.timeline);
    mkdirSync(dir, { recursive: true });
    await page.evaluate(() => { (window as unknown as PveWindow).__pve!.engine.hudOff = true; });
    for (let i = 0; i < FIGS.length; i++) {
      const e = tl.find((x) => x.id === FIGS[i]);
      if (!e) continue;
      const t = times[FIGS[i]!] ?? (e.start + e.end) / 2;
      await page.evaluate((t) => (window as unknown as PveWindow).__pve!.still(t, 4, 0.2), t);
      const f = path.join(dir, `fig${String(i + 1).padStart(2, '0')}.jpg`);
      await page.screenshot({ path: f, type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
      console.log(f, t.toFixed(2));
    }
  } finally {
    await browser.close();
  }
} finally {
  stop();
}
