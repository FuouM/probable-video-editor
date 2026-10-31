// pve commit: commits chosen paths only, after the gate, with the "Ran:" section that the repository's
// commit messages carry. It never stages the rest of the work tree (another agent can work in it).
import { CliError } from './out';
import type { GateResult } from './gate';

function git(cwd: string, ...args: string[]): { out: string; code: number } {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return { out: (r.stdout.toString() + r.stderr.toString()).trimEnd(), code: r.exitCode ?? 1 };
}

/** The commit message: the summary, then what ran. */
export function commitMessage(summary: string, ran: GateResult[], extra: string[] = []): string {
  const lines = [...ran.filter((r) => r.status === 'ok').map((r) => r.name), ...extra];
  return lines.length ? `${summary}\n\nRan:\n${lines.map((l) => `- ${l}`).join('\n')}\n` : `${summary}\n`;
}

/** The paths (relative to `cwd`) that differ from HEAD or are new. */
export function changedPaths(cwd: string, paths: string[]): string[] {
  const r = git(cwd, 'status', '--porcelain', '--untracked-files=all', '--', ...paths);
  if (r.code !== 0) throw new CliError({ rule: 'git', message: r.out, fix: 'run the command in a git repository' });
  return r.out.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''));
}

/**
 * Stages `paths` and commits them alone: `git commit -- <paths>` leaves everything else that is staged
 * where it is. Throws a CliError when no path has a change.
 */
export function commitPaths(cwd: string, message: string, paths: string[]): { commit: string; files: string[] } {
  const files = changedPaths(cwd, paths);
  if (!files.length) throw new CliError({ rule: 'commit', message: `nothing to commit in ${paths.join(', ')}`, fix: 'change a file there, or name other paths with --paths' });
  const add = git(cwd, 'add', '--', ...paths);
  if (add.code !== 0) throw new CliError({ rule: 'git', message: `git add failed: ${add.out}` });
  const c = git(cwd, 'commit', '-m', message, '--', ...paths);
  if (c.code !== 0) throw new CliError({ rule: 'git', message: `git commit failed: ${c.out}` });
  return { commit: git(cwd, 'rev-parse', '--short', 'HEAD').out, files };
}
