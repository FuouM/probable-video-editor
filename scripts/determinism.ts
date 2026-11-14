#!/usr/bin/env bun
// Seek determinism on a project (default projects/pdoom_original): N seeded random times rendered in time order, then in a seeded shuffled order.
// Each time must give the same pixels both times (SHA-256 of the engine's RGBA readback). A time whose hashes differ is rendered again on a new
// page (in time order, then in the shuffled order) and the two pictures are compared: more than 1 level of difference is a difference.
//
// The check runs at two precisions of the lit HDR targets (packages/engine/src/litview.ts):
//   float  32-bit. A difference here is a true order fault (a frame reads state that another frame left): the check fails.
//   half   16-bit, the precision of the renders. The GPU does not always round an additive blend the same way at 16 bits, so a frame can
//          differ by one dither step from one render to the next. With `--precision both` (the default) a difference here, at a time that
//          is right at 32 bits, is reported as a precision difference and does not fail the check. With `--precision half` alone it fails
//          (the script cannot tell it from an order fault).
//   bun run determinism [-- --n 100 --seed 1337 --project <id> --precision both|float|half]
// To find the cause of a difference: bun run pve order -p <id> <time> --seed <seed> --chain [--precision float] (see `pve order --help`).
import { ensureServer, openPage, type PveWindow } from '../packages/cli/src/browser';
import { seededTimes } from '../packages/cli/src/order';

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1]! : d; };
const N = +opt('n', '100'), SEED = +opt('seed', '1337'), PROJECT = opt('project', 'pdoom_original'), PRECISION = opt('precision', 'both');
if (PRECISION !== 'both' && PRECISION !== 'float' && PRECISION !== 'half') {
  console.error('--precision takes both, float or half');
  process.exit(2);
}

type Hdr = 'half' | 'float';
interface Diff { t: number; maxDiff: number; count: number }

/** The times whose picture differs by more than 1 level between the two orders, at one precision. */
async function check(url: string, hdr: Hdr): Promise<Diff[]> {
  const { browser, page, logs } = await openPage(url, PROJECT, { hdr });
  try {
    const duration = await page.evaluate(() => (window as unknown as PveWindow).__pve!.duration);
    const { times, shuffled } = seededTimes(SEED, N, duration);
    const renderPass = (order: number[]) => page.evaluate(async (order) => {
      const p = (window as unknown as PveWindow).__pve!;
      const hashes: string[] = [];
      for (const t of order) {
        p.still(t, 1, 0.5);
        const px = await p.engine.readPixelsAsync();
        hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', px)), (b) => b.toString(16).padStart(2, '0')).join(''));
      }
      return hashes;
    }, order);
    const t0 = performance.now();
    const inOrder = await renderPass(times);
    const byTime = new Map(times.map((t, i) => [t, inOrder[i]!]));
    const again = await renderPass(shuffled);
    const suspects = [...new Set(shuffled.filter((t, i) => again[i]! !== byTime.get(t)!))].sort((a, b) => a - b).slice(0, 40);
    const bad: Diff[] = [];
    if (suspects.length) {
      // a new page: the pictures of the suspects in time order are the reference; then the whole shuffled order again
      const second = await openPage(url, PROJECT, { hdr });
      try {
        const diffs = await second.page.evaluate(async ({ suspects, shuffled }) => {
          const p = (window as unknown as PveWindow).__pve!;
          const ref = new Map<number, Uint8Array>();
          for (const t of suspects) {
            p.still(t, 1, 0.5);
            ref.set(t, new Uint8Array(await p.engine.readPixelsAsync()).slice());
          }
          const out: { t: number; maxDiff: number; count: number }[] = [];
          for (const t of shuffled) {
            p.still(t, 1, 0.5);
            const a = ref.get(t);
            if (!a) continue;
            const b = new Uint8Array(await p.engine.readPixelsAsync());
            let maxDiff = 0, count = 0;
            for (let j = 0; j < a.length; j += 4) {
              const m = Math.max(Math.abs(a[j]! - b[j]!), Math.abs(a[j + 1]! - b[j + 1]!), Math.abs(a[j + 2]! - b[j + 2]!));
              if (m > maxDiff) maxDiff = m;
              if (m > 0) count++;
            }
            out.push({ t, maxDiff, count });
          }
          return out;
        }, { suspects, shuffled });
        for (const d of diffs.sort((a, b) => a.t - b.t)) {
          if (d.maxDiff <= 1) console.log(`${hdr}  t=${d.t.toFixed(3)}  hash mismatch due to GPU float rounding (maxDiff=${d.maxDiff}, ${d.count} px)`);
          else { bad.push(d); console.log(`${hdr}  t=${d.t.toFixed(3)}  differs: maxDiff=${d.maxDiff}, differing px=${d.count}`); }
        }
      } finally {
        await second.browser.close();
      }
    }
    console.log(`${hdr}  ${N} times (seed ${SEED}, duration ${duration.toFixed(2)} s), ${new Set(inOrder).size} distinct frames, ${bad.length} different, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    if (logs.length) console.error('BROWSER LOG:\n' + logs.join('\n'));
    return bad;
  } finally {
    await browser.close();
  }
}

const { url, stop } = await ensureServer();
let failed = false;
try {
  const float = PRECISION === 'half' ? [] : await check(url, 'float');
  const half = PRECISION === 'float' ? [] : await check(url, 'half');
  // a difference at 32 bits is an order fault. A difference at 16 bits only is the blend rounding of the GPU, when the 32-bit pass ran
  const precision = PRECISION === 'both' ? half.filter((d) => !float.some((f) => f.t === d.t)) : [];
  const faults = PRECISION === 'half' ? half : float;
  for (const d of faults) console.log(`FAIL  t=${d.t.toFixed(3)}  the frame depends on the frames before it (maxDiff=${d.maxDiff}, ${d.count} px)`);
  if (precision.length) console.log(`precision: ${precision.length} frames differ at 16 bits and not at 32 bits (max diff ${Math.max(...precision.map((d) => d.maxDiff))}): the blend rounding of the GPU, not an order fault`);
  failed = faults.length > 0;
} finally {
  stop();
}
console.log(failed ? 'determinism: FAIL' : 'determinism: pass');
process.exit(failed ? 1 : 0);
