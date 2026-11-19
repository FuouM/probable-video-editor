// pve commit: commits chosen paths only, after the gate, with the "Ran:" section that the repository's
// commit messages carry. It never stages the rest of the work tree (another agent can work in it).
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from './out';
import type { GateResult } from './gate';
import { loadIgnore } from './ignore';

function git(cwd: string, ...args: string[]): { out: string; code: number } {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return { out: (r.stdout.toString() + r.stderr.toString()).trimEnd(), code: r.exitCode ?? 1 };
}

/** The commit message: the summary, then what ran. */
export function commitMessage(summary: string, ran: GateResult[], extra: string[] = []): string {
  const lines = [...ran.filter((r) => r.status === 'ok').map((r) => r.name), ...extra];
  return lines.length ? `${summary}\n\nRan:\n${lines.map((l) => `- ${l}`).join('\n')}\n` : `${summary}\n`;
}

/** The paths (relative to `cwd`) that differ from HEAD or are new, excluding files in .pveignore. */
export function changedPaths(cwd: string, paths: string[]): string[] {
  const isIgnored = loadIgnore(cwd);
  const normPaths = paths.map((p) => p.replaceAll('\\', '/'));
  // -z: paths come raw (no quoting, no octal escapes of non-ASCII names), each entry ends with NUL
  const r = git(cwd, 'status', '--porcelain', '-z', '--untracked-files=all', '--', ...normPaths);
  if (r.code !== 0) throw new CliError({ rule: 'git', message: r.out, fix: 'run the command in a git repository' });
  const entries = r.out.split('\0');
  const out: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const file = entry.slice(3).replaceAll('\\', '/');
    // a rename or copy: the entry holds the new path, the next entry the old one
    if (status[0] === 'R' || status[0] === 'C') i++;
    if (status === '??' && isIgnored(file)) continue;
    out.push(file);
  }
  return out;
}

/**
 * Stages specific resolved `files` and commits them alone: leaves everything else that is staged
 * where it is. Throws a CliError when no path has a change.
 */
export function commitPaths(cwd: string, message: string, paths: string[], dry = false): { commit: string; files: string[] } {
  const normPaths = paths.map((p) => p.replaceAll('\\', '/'));
  const files = changedPaths(cwd, normPaths);
  if (!files.length) throw new CliError({ rule: 'commit', message: `nothing to commit in ${normPaths.join(', ')}`, fix: 'change a file there, or name other paths with --paths' });

  if (dry) {
    return { commit: 'dry-run', files };
  }

  const toAdd = files.filter((f) => existsSync(path.resolve(cwd, f)));
  const toRm = files.filter((f) => !existsSync(path.resolve(cwd, f)));
  if (toAdd.length) {
    const add = git(cwd, 'add', '-A', '--', ...toAdd);
    if (add.code !== 0) throw new CliError({ rule: 'git', message: `git add failed: ${add.out}` });
  }
  if (toRm.length) {
    const rm = git(cwd, 'rm', '-f', '--ignore-unmatch', '--', ...toRm);
    if (rm.code !== 0) throw new CliError({ rule: 'git', message: `git rm failed: ${rm.out}` });
  }

  // Use a temporary file for the commit message to avoid Windows shell quoting/newline corruption
  const scratchDir = path.join(cwd, '.scratch');
  mkdirSync(scratchDir, { recursive: true });
  const msgFile = path.join(scratchDir, `commit_${Date.now().toString(36)}.tmp`);
  writeFileSync(msgFile, message, 'utf8');
  const c = git(cwd, 'commit', '-F', msgFile, '--', ...files);
  try { unlinkSync(msgFile); } catch {}
  if (c.code !== 0) throw new CliError({ rule: 'git', message: `git commit failed: ${c.out}` });

  return { commit: git(cwd, 'rev-parse', '--short', 'HEAD').out, files };
}
