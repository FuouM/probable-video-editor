#!/usr/bin/env bun
// Golden stills of projects/pdoom_original: one still per timeline entry at its middle (scale 1, 1 sample, grain on).
//   bun run golden              compare with tests/golden/<id>.png (exit 1 on any pixel difference)
//   bun run golden -- --capture write tests/golden/<id>.png
// Pixels come from the engine's final render target (readPixels), not from a page screenshot.
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, ensureServer, openPage, type PveWindow } from '../packages/cli/src/browser';
import { decodePng, diffImages, encodePng } from './png';

const capture = process.argv.includes('--capture');
const dir = path.join(ROOT, 'tests/golden');
if (capture) mkdirSync(dir, { recursive: true });

const { url, stop } = await ensureServer();
let failed = false;
try {
  const { browser, page, logs } = await openPage(url, 'pdoom_original');
  try {
    const timeline = await page.evaluate(() => (window as unknown as PveWindow).__pve!.timeline);
    console.log(`${timeline.length} timeline entries, ${capture ? 'capture' : 'compare'}`);
    for (const e of timeline) {
      const t = (e.start + e.end) / 2;
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
      const img = { width: 1920, height, data };
      const file = path.join(dir, `${e.id}.png`);
      const label = `${e.id.padEnd(12)} t=${t.toFixed(4)}`;
      if (capture) {
        await Bun.write(file, encodePng(img));
        console.log(`${label}  wrote ${path.relative(ROOT, file)}`);
      } else if (!existsSync(file)) {
        failed = true;
        console.log(`${label}  MISSING ${path.relative(ROOT, file)}`);
      } else {
        let d = diffImages(img, decodePng(await Bun.file(file).bytes()));
        if (d.maxDiff === 1 && d.pixels <= 2) {
          // Transient GPU 1-level float rounding noise on single pixel: retry render once
          const b64Retry = await page.evaluate(async (t) => {
            const p = (window as unknown as PveWindow).__pve!;
            p.still(t, 1, 0.5);
            const px = await p.engine.readPixelsAsync();
            let s = '';
            for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000));
            return btoa(s);
          }, t);
          const retryRaw = Buffer.from(b64Retry, 'base64');
          const retryData = new Uint8Array(retryRaw.length);
          for (let y = 0; y < height; y++) retryData.set(retryRaw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
          d = diffImages({ width: 1920, height, data: retryData }, decodePng(await Bun.file(file).bytes()));
        }
        if (d.maxDiff) failed = true;
        console.log(`${label}  max diff ${d.maxDiff}  differing px ${d.pixels}${d.maxDiff ? '  FAIL' : ''}`);
      }
    }
    if (logs.length) console.error('BROWSER LOG:\n' + logs.join('\n'));
  } finally {
    await browser.close();
  }
} finally {
  stop();
}
if (!capture) console.log(failed ? 'golden: FAIL' : 'golden: pass');
process.exit(failed ? 1 : 0);
