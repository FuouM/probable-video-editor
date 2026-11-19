// pve assets pack|fetch: the files directly in video/assets/ are not in git. They are assets of a GitHub release (tag
// `<id>-assets`), and video/assets.json in git lists each file with its SHA-256 and size. Same idea as the site audio
// (app/scripts/site-data.ts). Release assets have no folders, so a release asset sits directly in video/assets/ and its
// release name is its file name. Folders of video/assets/ (such as assets/ui/ with the interface code of a scene) stay in git.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CliError } from './out';
import type { ProjectRef } from './project';

export const MANIFEST_FILE = 'video/assets.json';
export const ASSETS_DIR = 'video/assets';

export interface AssetEntry {
  /** File name under video/assets/ (and name of the release asset). */
  path: string;
  sha256: string;
  size: number;
}

/** video/assets.json. */
export interface AssetsManifest {
  v: 1;
  /** Tag of the GitHub release that holds the files. */
  release: string;
  assets: AssetEntry[];
}

/** One file that does not match the manifest. */
export interface AssetProblem {
  path: string;
  kind: 'missing' | 'mismatch';
  detail: string;
}

export const releaseTag = (id: string) => `${id}-assets`;

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The manifest of a project, or a CliError that says how to make it. */
export function readManifest(ref: ProjectRef): AssetsManifest {
  const file = path.join(ref.dir, MANIFEST_FILE);
  if (!existsSync(file)) throw new CliError({ rule: 'assets', file: MANIFEST_FILE, message: `no ${MANIFEST_FILE}`, fix: `put the files in projects/${ref.id}/${ASSETS_DIR}/, then pve assets pack -p ${ref.id}` });
  let doc: AssetsManifest;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8')) as AssetsManifest;
  } catch (e) {
    throw new CliError({ rule: 'assets', file: MANIFEST_FILE, message: `not valid JSON: ${e instanceof Error ? e.message : e}` });
  }
  if (doc.v !== 1 || typeof doc.release !== 'string' || !Array.isArray(doc.assets)) {
    throw new CliError({ rule: 'assets', file: MANIFEST_FILE, message: 'expected { "v": 1, "release": string, "assets": [{ path, sha256, size }] }' });
  }
  return doc;
}

/** Compares the local files with the manifest. Hashes only the files whose size matches. */
export function verifyAssets(ref: ProjectRef, manifest: AssetsManifest): AssetProblem[] {
  const dir = path.join(ref.dir, ASSETS_DIR);
  const problems: AssetProblem[] = [];
  for (const a of manifest.assets) {
    const file = path.join(dir, a.path);
    if (!existsSync(file)) {
      problems.push({ path: a.path, kind: 'missing', detail: 'the file is not in video/assets/' });
      continue;
    }
    const size = statSync(file).size;
    if (size !== a.size) problems.push({ path: a.path, kind: 'mismatch', detail: `size is ${size}, the manifest has ${a.size}` });
    else if (sha256(file) !== a.sha256) problems.push({ path: a.path, kind: 'mismatch', detail: 'SHA-256 differs from the manifest' });
  }
  return problems;
}

/** The error for files that are missing or differ. It names `pve assets fetch`. */
export function assetsError(ref: ProjectRef, problems: AssetProblem[]): CliError {
  const list = problems.map((p) => `${p.path} (${p.kind}: ${p.detail})`).join('; ');
  return new CliError({
    rule: 'assets', file: MANIFEST_FILE,
    message: `${problems.length} asset file${problems.length === 1 ? '' : 's'} of video/assets/ ${problems.length === 1 ? 'is' : 'are'} missing or differ${problems.length === 1 ? 's' : ''} from the manifest: ${list}`,
    fix: `pve assets fetch -p ${ref.id}`,
  });
}

/** Files directly in video/assets/, sorted. Folders are not release assets: they stay in git. */
function listAssets(ref: ProjectRef): string[] {
  const dir = path.join(ref.dir, ASSETS_DIR);
  if (!existsSync(dir)) throw new CliError({ rule: 'assets', message: `no folder ${ASSETS_DIR}/ in the project`, fix: `put the asset files in projects/${ref.id}/${ASSETS_DIR}/` });
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
}

export interface PackResult {
  manifest: AssetsManifest;
  /** The `gh release upload` command for the files. pve does not run it. */
  upload: string;
}

/** Writes video/assets.json from the files of video/assets/. */
export function packAssets(ref: ProjectRef): PackResult {
  const names = listAssets(ref);
  if (!names.length) throw new CliError({ rule: 'assets', message: `${ASSETS_DIR}/ has no files` });
  const dir = path.join(ref.dir, ASSETS_DIR);
  const assets = names.map((name): AssetEntry => ({ path: name, sha256: sha256(path.join(dir, name)), size: statSync(path.join(dir, name)).size }));
  const manifest: AssetsManifest = { v: 1, release: releaseTag(ref.id), assets };
  writeFileSync(path.join(ref.dir, MANIFEST_FILE), formatManifest(manifest));
  const files = names.map((n) => `projects/${ref.id}/${ASSETS_DIR}/${n}`);
  return { manifest, upload: `gh release upload ${manifest.release} ${files.join(' ')} --clobber` };
}

/** One entry per line, so a changed file is one line in a diff. */
export function formatManifest(m: AssetsManifest): string {
  const rows = m.assets.map((a) => `    ${JSON.stringify(a)}`).join(',\n');
  return `{\n  "v": 1,\n  "release": ${JSON.stringify(m.release)},\n  "assets": [\n${rows}\n  ]\n}\n`;
}

/** Downloads release assets by name into a folder. Throws a CliError when the download fails. */
export type Download = (release: string, names: string[], into: string) => Promise<void>;

/** `gh release download`: the same tool as the CI step of the site audio. */
export const ghDownload: Download = async (release, names, into) => {
  const args = ['gh', 'release', 'download', release, '--dir', into, '--clobber', ...names.flatMap((n) => ['--pattern', n])];
  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  try {
    proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  } catch (e) {
    throw new CliError({ rule: 'assets', message: `cannot run gh: ${e instanceof Error ? e.message : e}`, fix: 'install the GitHub CLI (gh) and sign in with gh auth login' });
  }
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) {
    throw new CliError({ rule: 'assets', message: `gh release download ${release} failed (exit ${code}): ${err.trim().split('\n').slice(-3).join(' ')}`, fix: `check that the release ${release} exists and has the files (see the upload command of pve assets pack)` });
  }
};

export interface FetchResult {
  /** Files that were already right. */
  present: number;
  /** Files downloaded. */
  fetched: string[];
}

/** Downloads the missing and changed files of the manifest, then checks every one of them against its SHA-256. */
export async function fetchAssets(ref: ProjectRef, download: Download = ghDownload): Promise<FetchResult> {
  const manifest = readManifest(ref);
  const todo = verifyAssets(ref, manifest);
  const names = todo.map((p) => p.path);
  if (names.length) {
    const tmp = mkdtempSync(path.join(tmpdir(), 'pve-assets-'));
    try {
      await download(manifest.release, names, tmp);
      const dir = path.join(ref.dir, ASSETS_DIR);
      mkdirSync(dir, { recursive: true });
      const bad: AssetProblem[] = [];
      for (const a of manifest.assets.filter((x) => names.includes(x.path))) {
        const got = path.join(tmp, a.path);
        if (!existsSync(got)) bad.push({ path: a.path, kind: 'missing', detail: `the release ${manifest.release} has no such file` });
        else if (sha256(got) !== a.sha256) bad.push({ path: a.path, kind: 'mismatch', detail: `the file in release ${manifest.release} has another SHA-256 than the manifest` });
        else copyFileSync(got, path.join(dir, a.path));
      }
      if (bad.length) {
        throw new CliError({
          rule: 'assets', file: MANIFEST_FILE,
          message: `the release ${manifest.release} does not match ${MANIFEST_FILE}: ${bad.map((p) => `${p.path} (${p.kind}: ${p.detail})`).join('; ')}`,
          fix: `upload the right files (pve assets pack -p ${ref.id} prints the command), or restore ${MANIFEST_FILE}`,
        });
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  const left = verifyAssets(ref, manifest);
  if (left.length) throw assetsError(ref, left);
  return { present: manifest.assets.length - names.length, fetched: names };
}
