// Code versions of the scene modules of a project, for the studio's memo cache (SceneCtx.memo). The version of a scene
// is a hash of: the scene file and the project files it imports (transitively), every source file of the workspace
// packages, the lockfile, the project inputs (`inputsHash`, see inputsHash) and the list of asset files (name,
// size, time). A change to any of them gives a new version, so a memo from older code or data is never used.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO } from './project';

/** `from '...'`, `import '...'`, `import('...')`. */
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;
const EXTS = ['', '.ts', '.js', '.json', '/index.ts'];

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name))
    .sort();
}

/** Per file: its hash and the project files it imports, while its size and time stay the same. */
const known = new Map<string, { size: number; mtime: number; hash: string; deps: string[] }>();

function fileInfo(f: string): { hash: string; deps: string[] } {
  const s = statSync(f), k = known.get(f);
  if (k && k.size === s.size && k.mtime === s.mtimeMs) return k;
  const buf = readFileSync(f);
  const deps: string[] = [];
  if (/\.[cm]?[jt]s$/.test(f)) {
    for (const m of buf.toString('utf8').matchAll(IMPORT)) {
      const dep = resolveImport(f, m[1]!);
      if (dep) deps.push(dep);
    }
  }
  const info = { size: s.size, mtime: s.mtimeMs, hash: createHash('sha256').update(buf).digest('hex'), deps };
  known.set(f, info);
  return info;
}

/** One hash over every file under packages/<pkg>/src and the lockfile. */
function workspaceHash(): string {
  const h = createHash('sha256');
  const pkgs = path.join(REPO, 'packages');
  for (const p of readdirSync(pkgs).sort()) {
    for (const f of files(path.join(pkgs, p, 'src'))) h.update(path.relative(REPO, f)).update(fileInfo(f).hash);
  }
  h.update(fileInfo(path.join(REPO, 'bun.lock')).hash);
  return h.digest('hex');
}

/** The project file a relative import names, or null for a package import. */
function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const bare = path.resolve(path.dirname(from), spec.replace(/[?#].*$/, ''));
  for (const ext of EXTS) {
    const f = bare + ext;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  throw new Error(`${path.relative(REPO, from)}: cannot resolve import '${spec}'`);
}

/** The scene file and every project file it imports, directly or through others. */
function closure(file: string): string[] {
  const seen = new Set<string>([file]);
  const stack = [file];
  while (stack.length) {
    for (const dep of fileInfo(stack.pop()!).deps) {
      if (!seen.has(dep)) { seen.add(dep); stack.push(dep); }
    }
  }
  return [...seen].sort();
}

/** A hash of the project inputs (the JSON the page gets, without `versions`). */
export function inputsHash(inputs: unknown): string {
  return createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
}

/**
 * Scene name (file of video/scenes/ without `.ts`) -> version, for the scene files of project folder `dir` (`only`: these). A scene
 * with an import that names no file (it is being written) gets no version: its module fails to load anyway, and nothing is memoized.
 */
export function sceneVersions(dir: string, inputs: string, only?: string[]): Record<string, string> {
  const base = createHash('sha256').update(workspaceHash()).update(inputs);
  for (const f of files(path.join(dir, 'video/assets'))) {
    const s = statSync(f);
    base.update(`${path.relative(dir, f)}:${s.size}:${s.mtimeMs}\n`);
  }
  const scenesDir = path.join(dir, 'video/scenes');
  const names = only ?? readdirSync(scenesDir).filter((n) => n.endsWith('.ts')).map((n) => n.slice(0, -3));
  const out: Record<string, string> = {};
  for (const name of names) {
    let deps: string[];
    try {
      deps = closure(path.join(scenesDir, `${name}.ts`));
    } catch {
      continue;
    }
    const h = base.copy();
    for (const f of deps) h.update(path.relative(dir, f)).update(fileInfo(f).hash);
    out[name] = h.digest('hex').slice(0, 32);
  }
  return out;
}
