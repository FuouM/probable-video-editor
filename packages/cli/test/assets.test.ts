import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assetsError, fetchAssets, packAssets, readManifest, verifyAssets, type Download } from '../src/assets';
import { checkProject } from '../src/check';
import { CliError } from '../src/out';
import { makeProject } from './fixture';

let tmp = '', ref = { id: 'demo', dir: '' };
const assets = () => path.join(ref.dir, 'video/assets');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'pve-assets-test-'));
  ref = { id: 'demo', dir: path.join(tmp, 'demo') };
  mkdirSync(assets(), { recursive: true });
  writeFileSync(path.join(assets(), 'a.png'), 'aaa');
  writeFileSync(path.join(assets(), 'timeline.json'), '{}');
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

/** A fake release: a folder with the files, copied by name. */
function release(files: Record<string, string>): { download: Download; asked: string[][] } {
  const asked: string[][] = [];
  const download: Download = async (_tag, names, into) => {
    asked.push(names);
    for (const n of names) if (n in files) writeFileSync(path.join(into, n), files[n]!);
  };
  return { download, asked };
}

test('pack writes the manifest with SHA-256, size and the release tag, and prints the upload command', () => {
  const r = packAssets(ref);
  expect(r.manifest).toEqual({
    v: 1,
    release: 'demo-assets',
    assets: [
      { path: 'a.png', sha256: sha('aaa'), size: 3 },
      { path: 'timeline.json', sha256: sha('{}'), size: 2 },
    ],
  });
  expect(readManifest(ref)).toEqual(r.manifest);
  expect(r.upload).toBe('gh release upload demo-assets projects/demo/video/assets/a.png projects/demo/video/assets/timeline.json --clobber');
  expect(readFileSync(path.join(ref.dir, 'video/assets.json'), 'utf8').split('\n')).toHaveLength(9);
});

test('pack leaves out the folders of video/assets/ (they stay in git)', () => {
  mkdirSync(path.join(assets(), 'ui'));
  writeFileSync(path.join(assets(), 'ui', 'desk.html'), '<p>');
  expect(packAssets(ref).manifest.assets.map((a) => a.path)).toEqual(['a.png', 'timeline.json']);
});

test('verify reports a missing file and a changed file', () => {
  const m = packAssets(ref).manifest;
  expect(verifyAssets(ref, m)).toEqual([]);
  rmSync(path.join(assets(), 'a.png'));
  writeFileSync(path.join(assets(), 'timeline.json'), '[1]');
  expect(verifyAssets(ref, m).map((p) => [p.path, p.kind])).toEqual([['a.png', 'missing'], ['timeline.json', 'mismatch']]);
  writeFileSync(path.join(assets(), 'timeline.json'), '[]');
  expect(verifyAssets(ref, m)[1]!.detail).toBe('SHA-256 differs from the manifest');
});

test('the error names pve assets fetch', () => {
  const m = packAssets(ref).manifest;
  rmSync(path.join(assets(), 'a.png'));
  const e = assetsError(ref, verifyAssets(ref, m));
  expect(e).toBeInstanceOf(CliError);
  expect(e.problem.fix).toBe('pve assets fetch -p demo');
  expect(e.problem.message).toContain('a.png (missing');
});

test('fetch downloads only the missing and changed files and keeps the good ones', async () => {
  const m = packAssets(ref).manifest;
  rmSync(path.join(assets(), 'a.png'));
  writeFileSync(path.join(assets(), 'timeline.json'), 'changed');
  const rel = release({ 'a.png': 'aaa', 'timeline.json': '{}' });
  const r = await fetchAssets(ref, rel.download);
  expect(r).toEqual({ present: 0, fetched: ['a.png', 'timeline.json'] });
  expect(verifyAssets(ref, m)).toEqual([]);

  const again = release({});
  expect(await fetchAssets(ref, again.download)).toEqual({ present: 2, fetched: [] });
  expect(again.asked).toEqual([]);
});

test('fetch checks the SHA-256 of what it downloaded and does not store a wrong file', async () => {
  packAssets(ref);
  rmSync(path.join(assets(), 'a.png'));
  const rel = release({ 'a.png': 'not the file' });
  await expect(fetchAssets(ref, rel.download)).rejects.toThrow(/does not match video\/assets.json: a.png \(mismatch/);
  expect(verifyAssets(ref, readManifest(ref)).map((p) => p.kind)).toEqual(['missing']);
});

test('fetch names the file that the release lacks', async () => {
  packAssets(ref);
  rmSync(path.join(assets(), 'a.png'));
  await expect(fetchAssets(ref, release({}).download)).rejects.toThrow(/a.png \(missing: the release demo-assets has no such file\)/);
});

test('pve check reports missing assets with the fetch command', async () => {
  const { dir, cleanup } = makeProject();
  try {
    mkdirSync(path.join(dir, 'video/assets'), { recursive: true });
    copyFileSync(path.join(dir, 'video/video.json'), path.join(dir, 'video/assets/x.bin'));
    const project = { id: 'song', dir };
    packAssets(project);
    expect((await checkProject(project)).problems.filter((p) => p.rule === 'assets')).toEqual([]);
    rmSync(path.join(dir, 'video/assets/x.bin'));
    const bad = (await checkProject(project)).problems.filter((p) => p.rule === 'assets');
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ severity: 'error', file: 'video/assets.json', fix: 'pve assets fetch -p song' });
  } finally {
    cleanup();
  }
});
