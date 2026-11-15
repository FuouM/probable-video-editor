// pve golden: one still of projects/pdoom_original per timeline entry, at the middle of the entry (scale 1, 1 sample,
// grain on), compared with tests/golden/<id>.png. --capture writes the files instead.
// Pixels come from the engine's final render target (readPixels), not from a page screenshot.
// The rule: max diff 0. One exception: a still that differs by 1 level in at most 2 pixels renders again once,
// and the second render must have max diff 0 (the GPU can round a float 1 level apart on a single pixel).
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { ROOT, withPage, type PveWindow } from './browser';
import { decodePng, diffImages, encodePng, type Image } from './png';

export const GOLDEN_PROJECT = 'pdoom_original';
export const GOLDEN_DIR = path.join(ROOT, 'tests/golden');

/** The still at `t` from the engine's final render target, top-down rows. */
async function grab(page: Page, t: number): Promise<Image> {
  // RGBA, bottom-up rows, base64 (8 MB per frame through the protocol)
  const b64 = await page.evaluate(async (t) => {
    const p = (window as unknown as PveWindow).__pve!;
    p.still(t, 1, 0.5);
    const px = await p.engine.readPixelsAsync();
    let s = '';
    for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000));
    return btoa(s);
  }, t);
  const bottomUp = Buffer.from(b64, 'base64'), row = 1920 * 4, height = bottomUp.length / row;
  const data = new Uint8Array(bottomUp.length);
  for (let y = 0; y < height; y++) data.set(bottomUp.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return { width: 1920, height, data };
}

/** Compares (or with `capture` writes) the golden stills and prints one line per entry. Returns true when every still matches. */
export async function runGolden(capture: boolean): Promise<boolean> {
  if (capture) mkdirSync(GOLDEN_DIR, { recursive: true });
  let failed = false;
  await withPage(GOLDEN_PROJECT, {}, async (page) => {
    const timeline = await page.evaluate(() => (window as unknown as PveWindow).__pve!.timeline);
    console.log(`${timeline.length} timeline entries, ${capture ? 'capture' : 'compare'}`);
    for (const e of timeline) {
      const t = (e.start + e.end) / 2;
      const img = await grab(page, t);
      const file = path.join(GOLDEN_DIR, `${e.id}.png`);
      const label = `${e.id.padEnd(12)} t=${t.toFixed(4)}`;
      if (capture) {
        await Bun.write(file, encodePng(img));
        console.log(`${label}  wrote ${path.relative(ROOT, file)}`);
      } else if (!existsSync(file)) {
        failed = true;
        console.log(`${label}  MISSING ${path.relative(ROOT, file)}`);
      } else {
        const golden = decodePng(await Bun.file(file).bytes());
        let d = diffImages(img, golden);
        // the GPU can round a float 1 level apart on a single pixel: render once more
        if (d.maxDiff === 1 && d.pixels <= 2) d = diffImages(await grab(page, t), golden);
        if (d.maxDiff) failed = true;
        console.log(`${label}  max diff ${d.maxDiff}  differing px ${d.pixels}${d.maxDiff ? '  FAIL' : ''}`);
      }
    }
  });
  if (!capture) console.log(failed ? 'golden: FAIL' : 'golden: pass');
  return !failed;
}
