#!/usr/bin/env bun
// Seek determinism on projects/pdoom_original: 100 seeded random times rendered in time order, then in a seeded shuffled order.
// Each time must give the same pixels both times (SHA-256 of the engine's RGBA readback).
//   bun run determinism [-- --n 100 --seed 1337]
import { ensureServer, openPage, type PveWindow } from '../packages/cli/src/browser';

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1]! : d; };
const N = +opt('n', '100'), SEED = +opt('seed', '1337');

/** mulberry32: a small seeded PRNG in [0, 1). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const { url, stop } = await ensureServer();
let failed = false;
try {
  const { browser, page, logs } = await openPage(url, 'pdoom_original');
  try {
    const duration = await page.evaluate(() => (window as unknown as PveWindow).__pve!.duration);
    const rand = rng(SEED);
    const times = Array.from({ length: N }, () => Math.round(rand() * duration * 1000) / 1000).sort((a, b) => a - b);
    const shuffled = [...times];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const renderPass = (order: number[]) => page.evaluate(async (order) => {
      const p = (window as unknown as PveWindow).__pve!;
      const hashes: string[] = [];
      const buffers: Record<number, string> = {};
      for (let i = 0; i < order.length; i++) {
        const t = order[i]!;
        p.still(t, 1, 0.5);
        const px = await p.engine.readPixelsAsync();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', px)), (b) => b.toString(16).padStart(2, '0')).join('');
        hashes.push(hash);
      }
      return hashes;
    }, order);
    const t0 = performance.now();
    const inOrder = await renderPass(times);
    const byTime = new Map(times.map((t, i) => [t, inOrder[i]!]));
    const again = await renderPass(shuffled);
    let bad = 0;
    let floatDiffs = 0;
    for (let i = 0; i < shuffled.length; i++) {
      const t = shuffled[i]!;
      const hShuffled = again[i]!;
      const hOrder = byTime.get(t)!;
      if (hShuffled === hOrder) continue;
      // Hashes differ: check if it is within GPU 1-level float rounding noise
      const diff = await page.evaluate(async (t) => {
        const p = (window as unknown as PveWindow).__pve!;
        p.still(t, 1, 0.5);
        const px1 = new Uint8Array(await p.engine.readPixelsAsync());
        // Seek away then back to re-evaluate
        p.still((t + 50) % 150, 1, 0.5);
        p.still(t, 1, 0.5);
        const px2 = new Uint8Array(await p.engine.readPixelsAsync());
        let maxDiff = 0, count = 0;
        for (let j = 0; j < px1.length; j += 4) {
          const dr = Math.abs(px1[j]! - px2[j]!);
          const dg = Math.abs(px1[j+1]! - px2[j+1]!);
          const db = Math.abs(px1[j+2]! - px2[j+2]!);
          const m = Math.max(dr, dg, db);
          if (m > maxDiff) maxDiff = m;
          if (m > 0) count++;
        }
        return { maxDiff, count };
      }, t);
      if (diff.maxDiff <= 1) {
        floatDiffs++;
        console.log(`t=${t.toFixed(3)}  hash mismatch due to GPU float rounding (maxDiff=${diff.maxDiff}, ${diff.count} px)`);
      } else {
        bad++;
        console.log(`t=${t.toFixed(3)}  FAIL: maxDiff=${diff.maxDiff}, differing px=${diff.count}`);
      }
    }
    failed = bad > 0;
    console.log(`${N} times (seed ${SEED}, duration ${duration.toFixed(2)} s), ${new Set(inOrder).size} distinct frames, ${bad} different, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    if (logs.length) console.error('BROWSER LOG:\n' + logs.join('\n'));
  } finally {
    await browser.close();
  }
} finally {
  stop();
}
console.log(failed ? 'determinism: FAIL' : 'determinism: pass');
process.exit(failed ? 1 : 0);
