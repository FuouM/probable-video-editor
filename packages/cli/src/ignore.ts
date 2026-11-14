// Reads .pveignore from the repository root (like .gitignore for local untracked / scratch files).
// Tools like `pve gate` and `pve commit` ignore files matching these patterns.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function loadIgnore(root: string, filename = '.pveignore'): (file: string) => boolean {
  const p = path.join(root, filename);
  if (!existsSync(p)) return () => false;
  const lines = readFileSync(p, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const globs = lines.map((pat) => new Bun.Glob(pat.replaceAll('\\', '/')));
  return (file: string) => {
    const norm = file.replaceAll('\\', '/').replace(/^\.\//, '');
    const base = path.basename(norm);
    return globs.some((g) => g.match(norm) || g.match(base));
  };
}
