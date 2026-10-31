// pve gate: every check that must pass before a commit, in parallel, with one short report.
// Steps: one `tsc -p` per project of the root `typecheck` script, `pve check`, `bun test` and `golden`.
// The first failure stops the other steps (a failed typecheck makes the long steps worthless).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './browser';
import { checkProject } from './check';
import { fmtCounts, fmtProblem } from './out';
import type { ProjectRef } from './project';

export interface GateStep {
  name: string;
  /** A process to run in the repository root. */
  cmd?: string[];
  /** Or work in this process. It returns the output that the report shows when ok is false. */
  fn?: () => Promise<{ ok: boolean; output: string }>;
  /** Which end of the output the report shows for a failed step. The first lines of `tsc` matter, the last lines of a test run. */
  show?: 'head' | 'tail';
}

export type GateStatus = 'ok' | 'FAIL' | 'cancelled' | 'skipped';

export interface GateResult {
  name: string;
  status: GateStatus;
  ms: number;
  /** The shown lines of a failed step. */
  output?: string;
}

export const OUTPUT_LINES = 30;

/** Stops a process and its children. A `bun` shim leaves the real process as a child on Windows. */
function killTree(pid: number): void {
  if (process.platform === 'win32') Bun.spawnSync(['taskkill', '/PID', String(pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' });
  else try { process.kill(pid, 'SIGKILL'); } catch { /* it has exited */ }
}

const cut = (text: string, show: 'head' | 'tail') => {
  const lines = text.replace(/\r/g, '').trimEnd().split('\n');
  const more = lines.length - OUTPUT_LINES;
  if (more <= 0) return lines.join('\n');
  return show === 'head' ? `${lines.slice(0, OUTPUT_LINES).join('\n')}\n... ${more} more lines` : `... ${more} earlier lines\n${lines.slice(-OUTPUT_LINES).join('\n')}`;
};

/** Runs the steps at the same time. With `failFast` the first failure stops the steps that still run. */
export async function runSteps(steps: GateStep[], o: { failFast: boolean }): Promise<GateResult[]> {
  const results: GateResult[] = steps.map((s) => ({ name: s.name, status: 'cancelled', ms: 0 }));
  const pids = new Set<number>();
  let stopped = false;
  const stop = () => {
    stopped = true;
    for (const pid of pids) killTree(pid);
  };
  await Promise.all(steps.map(async (s, i) => {
    const t0 = performance.now();
    const done = (status: GateStatus, output?: string) => {
      results[i] = { name: s.name, status, ms: Math.round(performance.now() - t0), ...(output ? { output: cut(output, s.show ?? 'tail') } : {}) };
      if (status === 'FAIL' && o.failFast) stop();
    };
    if (stopped) return;
    try {
      if (s.fn) {
        const r = await s.fn();
        done(r.ok ? 'ok' : 'FAIL', r.ok ? undefined : r.output);
      } else {
        const proc = Bun.spawn(s.cmd!, { cwd: ROOT, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
        pids.add(proc.pid);
        const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        pids.delete(proc.pid);
        if (stopped && code !== 0) results[i] = { name: s.name, status: 'cancelled', ms: Math.round(performance.now() - t0) };
        else done(code === 0 ? 'ok' : 'FAIL', code === 0 ? undefined : (out + err));
      }
    } catch (e) {
      done('FAIL', e instanceof Error ? e.message : String(e));
    }
  }));
  return results;
}

/** The `tsc -p <project>` arguments of the root `typecheck` script: the gate cannot drift from `bun run typecheck`. */
export function typecheckProjects(script: string): string[] {
  return script.split('&&').map((c) => c.trim().split(/\s+/)).filter((w) => w[0] === 'tsc' && w[1] === '-p' && w[2]).map((w) => w[2]!);
}

/** Paths whose change makes the golden stills the right check (AGENTS.md: the engine and the pdoom_original scenes). */
export const GOLDEN_PATHS = ['packages/engine/', 'projects/pdoom_original/', 'tests/golden/'];

/** Does the work tree change a path that the golden stills cover? */
export function goldenNeeded(porcelain: string): boolean {
  return porcelain.split('\n').some((l) => GOLDEN_PATHS.some((p) => l.slice(3).replace(/^"/, '').startsWith(p)));
}

export type GoldenMode = 'auto' | 'always' | 'never';

/** `git status --porcelain` of the repository (not trimmed: the first column is a status). */
export function porcelain(): string {
  return Bun.spawnSync(['git', 'status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, stdout: 'pipe', stderr: 'ignore' }).stdout.toString();
}

export interface GateOptions {
  golden: GoldenMode;
  failFast: boolean;
  /** Step names to leave out: `typecheck` (all `typecheck:*`), `check`, `test`, `golden`. */
  skip: string[];
  /** Optional step names to run exclusively: `typecheck`, `check`, `test`, `golden`. */
  only?: string[];
}

export interface GateReport {
  ok: boolean;
  /** Why the golden step ran or not. */
  golden: string;
  steps: GateResult[];
  ms: number;
}

export function gateSteps(ref: ProjectRef, o: GateOptions, porcelain: string): { steps: GateStep[]; golden: string } {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const tsc = path.join(ROOT, 'node_modules/.bin', process.platform === 'win32' ? 'tsc.exe' : 'tsc');
  const steps: GateStep[] = [
    ...typecheckProjects(pkg.scripts.typecheck ?? '').map((p): GateStep => ({ name: `typecheck:${p}`, cmd: [tsc, '-p', p], show: 'head' })),
    {
      name: 'check',
      show: 'head',
      async fn() {
        const r = await checkProject(ref);
        const errors = r.problems.filter((p) => p.severity === 'error');
        return { ok: errors.length === 0, output: `${r.problems.map(fmtProblem).join('\n')}\n${ref.id}: ${fmtCounts(r.problems)}` };
      },
    },
    { name: 'test', cmd: ['bun', 'test'] },
  ];
  const needed = goldenNeeded(porcelain);
  const golden = o.golden === 'always' ? 'always' : o.golden === 'never' ? 'off (--golden never)' : needed ? 'on: the work tree changes the engine or pdoom_original' : 'off: no change in ' + GOLDEN_PATHS.join(', ');
  if (o.golden === 'always' || (o.golden === 'auto' && needed)) steps.push({ name: 'golden', cmd: ['bun', 'scripts/golden.ts'] });
  let active = steps;
  if (o.only?.length) active = active.filter((s) => o.only!.some((k) => s.name === k || s.name.startsWith(`${k}:`)));
  active = active.filter((s) => !o.skip.some((k) => s.name === k || s.name.startsWith(`${k}:`)));
  return { steps: active, golden };
}

export async function runGate(ref: ProjectRef, o: GateOptions, porcelain: string): Promise<GateReport> {
  const t0 = performance.now();
  const { steps, golden } = gateSteps(ref, o, porcelain);
  const results = await runSteps(steps, { failFast: o.failFast });
  return { ok: results.every((r) => r.status === 'ok'), golden, steps: results, ms: Math.round(performance.now() - t0) };
}

export function formatGate(ref: ProjectRef, r: GateReport): string {
  const w = Math.max(...r.steps.map((s) => s.name.length));
  const lines = r.steps.map((s) => `${s.status.padEnd(9)} ${s.name.padEnd(w)}  ${(s.ms / 1000).toFixed(1)} s`);
  for (const s of r.steps) if (s.output) lines.push('', `--- ${s.name}`, s.output);
  lines.push('', `${r.ok ? 'ok' : 'FAIL'}  gate ${ref.id}: ${r.steps.filter((s) => s.status === 'ok').length}/${r.steps.length} steps ok, golden ${r.golden} (${(r.ms / 1000).toFixed(1)} s)`);
  return lines.join('\n');
}
