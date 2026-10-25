// bench/results.jsonl (DESIGN 12.3): one line per benchmark or render, tracked in git. Shared by pve bench
// and pve render.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BenchRecord } from '@pve/engine/bench/types';
import { ANGLE, ROOT } from './browser';
import { table } from './out';

export const RESULTS = path.join(ROOT, 'bench/results.jsonl');

const git = (...a: string[]) => Bun.spawnSync(['git', ...a], { cwd: ROOT }).stdout.toString().trim();

/**
 * The commit and the dirty flag of the work tree. Read it before the run, so that appending to
 * results.jsonl does not make the tree dirty.
 */
export function gitState(): { commit: string; dirty: boolean } {
  return { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '' };
}

/** The machine fields of a record. `gpu` and `chrome` come from the page. */
export function machine(gpu: string, chrome: string): BenchRecord['machine'] {
  const cpus = os.cpus();
  return {
    gpu,
    angle: ANGLE[process.platform] ?? 'default',
    chrome,
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: `${cpus[0]?.model.trim() ?? 'unknown'} (${cpus.length} cores, ${(os.totalmem() / 2 ** 30).toFixed(1)} GB)`,
  };
}

export function appendRecords(records: object[], file = RESULTS): void {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, records.map((r) => JSON.stringify(r) + '\n').join(''));
}

export function readRecords(file = RESULTS): BenchRecord[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as BenchRecord);
}

const sameMachine = (a: BenchRecord['machine'], b: BenchRecord['machine']) =>
  a.gpu === b.gpu && a.angle === b.angle && a.os === b.os && a.cpu === b.cpu;

/** The newest record per id at `ref` (commit prefix, tag, or `last` = the newest run in the file before `like`). */
export function referenceRecords(ref: string, like: BenchRecord, all: BenchRecord[]): Map<string, BenchRecord> {
  const usable = all.filter((r) => sameMachine(r.machine, like.machine) && r.scale === like.scale && r.project === like.project && r.ts < like.ts);
  let pick: BenchRecord[];
  if (ref === 'last') {
    const ts = usable.reduce((m, r) => (r.ts > m ? r.ts : m), '');
    pick = usable.filter((r) => r.ts === ts);
  } else {
    const full = git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`) || ref;
    pick = usable.filter((r) => r.commit.startsWith(full));
  }
  const byId = new Map<string, BenchRecord>();
  for (const r of pick) if (!byId.has(r.id) || byId.get(r.id)!.ts < r.ts) byId.set(r.id, r);
  return byId;
}

export interface CompareRow {
  id: string;
  refMs: number | null;
  newMs: number;
  /** Percent change, null without a reference. */
  pct: number | null;
  /** The larger p90 - median of the two records. */
  spread: number | null;
  /** Above 10 % and above the spread. */
  mark: boolean;
}

/** Compares records with the records at `ref`. Throws when `ref` has no records of this machine, scale and project. */
export function compare(ref: string, records: BenchRecord[], all = readRecords()): { refCommit: string; rows: CompareRow[] } {
  const base = referenceRecords(ref, records[0]!, all);
  if (!base.size) throw new Error(`--compare ${ref}: no records of this machine, scale and project in ${path.relative(ROOT, RESULTS)}`);
  const rows = records.map((r): CompareRow => {
    const b = base.get(r.id);
    if (!b) return { id: r.id, refMs: null, newMs: r.medianMs, pct: null, spread: null, mark: false };
    const delta = r.medianMs - b.medianMs;
    const pct = b.medianMs > 0 ? (100 * delta) / b.medianMs : 0;
    const spread = Math.max(r.p90Ms - r.medianMs, b.p90Ms - b.medianMs);
    return { id: r.id, refMs: b.medianMs, newMs: r.medianMs, pct, spread, mark: Math.abs(pct) > 10 && Math.abs(delta) > spread };
  });
  return { refCommit: [...base.values()][0]!.commit.slice(0, 7), rows };
}

export function formatCompare(ref: string, c: { refCommit: string; rows: CompareRow[] }): string {
  const marks = c.rows.filter((r) => r.mark).length;
  return [
    `compare with ${ref} (${c.refCommit})`,
    table(
      c.rows.map((r) => [
        r.id,
        r.refMs === null ? '-' : r.refMs.toFixed(3),
        r.newMs.toFixed(3),
        r.pct === null ? '(no reference)' : `${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(1)} %`,
        r.spread === null ? '' : r.spread.toFixed(3),
        r.mark ? '!' : '',
      ]),
      ['id', 'ref med', 'new med', 'change', 'spread', 'mark'],
    ),
    `${marks} mark${marks === 1 ? '' : 's'}`,
  ].join('\n');
}
