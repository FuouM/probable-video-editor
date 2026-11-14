// Background jobs. `pve job <command> [args]` starts a pve command in the background with a log and
// returns at once. `pve wait [id]` blocks until the job ends (or a timeout) and prints its log. The job
// runner (job-runner.ts) writes out/jobs/<id>.exit with the exit code, so the wait returns on the poll
// tick after the command ends: no fixed sleeps, no pipes that a child process (Chrome, Vite) keeps open.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './browser';

export const JOBS = path.join(ROOT, 'out/jobs');
const RUNNER = path.join(import.meta.dir, 'job-runner.ts');
const POLL_MS = 250;
/** No wait blocks longer than this (an agent tool call has a deadline of about 180 s). */
export const MAX_WAIT_S = 175;

export interface Job {
  id: string;
  pid: number;
  args: string[];
  /** Start time, ms since the epoch. */
  start: number;
}

export interface WaitResult {
  job: Job;
  /** The exit code, or undefined while the job runs. */
  code: number | undefined;
  /** True when the process is gone but wrote no exit code (killed or crashed). */
  lost: boolean;
  log: string;
}

export const jobFile = (id: string, ext: 'json' | 'log' | 'exit') => path.join(JOBS, `${id}.${ext}`);

export function startJob(args: string[]): Job {
  mkdirSync(JOBS, { recursive: true });
  const id = `${args[0]}-${Date.now().toString(36)}`;
  writeFileSync(jobFile(id, 'log'), '');
  // Detached: the runner outlives `pve job` (a plain child dies with it on Windows) and has no console,
  // so no window opens and steals focus. The runner starts the command itself with a hidden console.
  const runner = spawn(process.execPath, [RUNNER, id, ...args], { cwd: process.cwd(), detached: true, windowsHide: true, stdio: 'ignore' });
  if (runner.pid === undefined) throw new Error(`pve job: could not start ${args.join(' ')}`);
  runner.unref();
  const job: Job = { id, pid: runner.pid, args, start: Date.now() };
  writeFileSync(jobFile(id, 'json'), JSON.stringify(job));
  return job;
}

/** The job with this id or id prefix. No id: the newest job. */
export function findJob(id: string | undefined): Job {
  const ids = existsSync(JOBS) ? readdirSync(JOBS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  const hits = id ? ids.filter((j) => j === id || j.startsWith(id)) : ids;
  if (!hits.length) throw new Error(id ? `no job '${id}' in ${path.relative(process.cwd(), JOBS)}` : 'no jobs');
  const jobs = hits.map((j) => JSON.parse(readFileSync(jobFile(j, 'json'), 'utf8')) as Job);
  if (id && jobs.length > 1 && !jobs.some((j) => j.id === id)) throw new Error(`job '${id}' is ambiguous: ${hits.join(', ')}`);
  return jobs.find((j) => j.id === id) ?? jobs.sort((a, b) => b.start - a.start)[0]!;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readCode = (id: string) => {
  const f = jobFile(id, 'exit');
  return existsSync(f) ? Number(readFileSync(f, 'utf8')) : undefined;
};

/** Polls until the job writes its exit code, its process is gone, or timeoutS passes. */
export async function waitJob(job: Job, timeoutS: number): Promise<WaitResult> {
  const end = performance.now() + Math.min(timeoutS, MAX_WAIT_S) * 1000;
  let code = readCode(job.id);
  let lost = false;
  while (code === undefined && performance.now() < end) {
    if (!alive(job.pid)) {
      code = readCode(job.id);
      lost = code === undefined;
      break;
    }
    await Bun.sleep(POLL_MS);
    code = readCode(job.id);
  }
  return { job, code, lost, log: readFileSync(jobFile(job.id, 'log'), 'utf8') };
}

export const logPath = (id: string) => jobFile(id, 'log');
