// The runner of one background job (see jobs.ts): `bun job-runner.ts <id> <command> [args]`.
// startJob starts it detached, so it has no console and outlives `pve job`. It starts the pve command
// with a hidden console (windowsHide), so the processes of the command (git, tsc, ffmpeg) share that
// console and open no window. It writes the exit code of the command to out/jobs/<id>.exit.
import { spawn } from 'node:child_process';
import { closeSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { jobFile } from './jobs';

const [id, ...args] = process.argv.slice(2);
if (!id || !args.length) throw new Error('usage: bun job-runner.ts <id> <command> [args]');
const fd = openSync(jobFile(id, 'log'), 'a');
const child = spawn(process.execPath, [path.join(import.meta.dir, 'main.ts'), ...args], { windowsHide: true, stdio: ['ignore', fd, fd] });
closeSync(fd);
const { promise, resolve } = Promise.withResolvers<number>();
child.on('exit', (c) => resolve(c ?? 1));
child.on('error', () => resolve(1));
writeFileSync(jobFile(id, 'exit'), String(await promise));
