// pve bench (DESIGN 12): runs the GPU benchmarks in headless Chrome (window.__pve.bench) and appends one
// line per benchmark to bench/results.jsonl.
//   no names:        every engine effect and every clip of the project (the reference workload on pdoom_original)
//   clip ids:        scene.<clip> of those clips only (the page loads only them)
//   other names:     the benchmarks whose id contains the name (`post`, `lines.10k`)
import path from 'node:path';
import type { BenchOptions, BenchRecord } from '@pve/engine/bench/types';
import { assertNoBrowserErrors, chromeVersion, ensureServer, openPage, type PveWindow } from './browser';
import { table } from './out';
import { appendRecords, compare, formatCompare, gitState, machine, RESULTS } from './records';

/** Median scene cost at preview scale for 60 fps live preview (DESIGN 12.4). */
export const BUDGET_MS = 1000 / 60;

export interface BenchArgs {
  project: string;
  /** Clip ids of the project, and effect id parts. */
  names: string[];
  clipIds: string[];
  n?: number;
  scenes?: boolean;
  scale?: number;
  dry?: boolean;
  compareRef?: string;
  out?: string;
}

export interface BenchRun {
  records: BenchRecord[];
  marks: number;
}

/** Runs the benchmarks and prints the table, the budget lines and the compare. Appends unless `dry`. */
export async function runBench(a: BenchArgs): Promise<BenchRun> {
  const clips = a.names.filter((x) => a.clipIds.includes(x));
  const filter = a.names.map((x) => (clips.includes(x) ? `scene.${x}` : x));
  const opts: BenchOptions = { n: a.n ?? 30, scenes: a.scenes ?? true, ...(filter.length ? { filter } : {}) };
  // only clips named: load only them (faster boot, no other scene compiles)
  const only = clips.length && clips.length === a.names.length ? clips.join(',') : undefined;
  const { commit, dirty } = gitState();
  const out = a.out ?? RESULTS;

  const { url, stop } = await ensureServer();
  try {
    const { browser, page, logs } = await openPage(url, a.project, { scale: a.scale ?? 1, only });
    try {
      const chrome = chromeVersion(browser);
      const res = await page.evaluate((o) => (window as unknown as PveWindow).__pve!.bench(o), opts);
      if (logs.length) console.error('BROWSER LOG:\n' + logs.join('\n'));
      // a scene with a broken shader measures nothing: no records
      assertNoBrowserErrors(logs);
      if (!res.results.length) throw new Error(`no benchmark matches ${a.names.join(', ') || '(all)'}`);
      const ts = new Date().toISOString();
      const records: BenchRecord[] = res.results.map((r) => ({ ...r, ts, commit, dirty, machine: machine(res.gpu, chrome), project: a.project, scale: res.scale }));

      console.log(`${res.gpu} | chrome ${chrome} | ${res.method} | scale ${res.scale} | ${a.project}`);
      console.log(table(
        records.map((r) => [r.id, r.method, String(r.n), r.medianMs.toFixed(3), r.p90Ms.toFixed(3), r.wallMedianMs.toFixed(3), r.compileMs.toFixed(3)]),
        ['id', 'method', 'n', 'median', 'p90', 'wall med', 'compile'],
      ));
      const scenes = records.filter((r) => r.kind === 'scene');
      if (scenes.length && res.scale === 1) {
        console.log(`\nbudget: median scene cost under ${BUDGET_MS.toFixed(1)} ms (60 fps preview)`);
        console.log(table(scenes.map((r) => [r.id, `${r.medianMs.toFixed(2)} ms`, `${((100 * r.medianMs) / BUDGET_MS).toFixed(0)} %`, r.medianMs > BUDGET_MS ? 'OVER BUDGET' : 'ok'])));
      }
      let marks = 0;
      if (a.compareRef) {
        const c = compare(a.compareRef, records);
        marks = c.rows.filter((r) => r.mark).length;
        console.log(`\n${formatCompare(a.compareRef, c)}`);
      }
      if (a.dry) console.log('dry run: nothing written');
      else {
        appendRecords(records, out);
        console.log(`appended ${records.length} lines to ${path.relative(process.cwd(), out)}`);
      }
      return { records, marks };
    } finally {
      await browser.close();
    }
  } finally {
    stop();
  }
}
