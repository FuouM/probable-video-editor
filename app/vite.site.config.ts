// Static build of the real-time player for GitHub Pages: `bun run site:build` (project: PVE_SITE_PROJECT,
// default breaked_neuro). The page runs the engine in the visitor's browser, so the build only bundles the
// engine and the project's scenes. The inputs come from a committed snapshot (scripts/site-data.ts) because
// the build has no Lyric-Sync; the build fails when a source file changed after the snapshot.
// The audio is not in git. It is the release asset named in the manifest: the CI downloads it and sets
// PVE_SITE_AUDIO to its path (default: the local copy in projects/<id>/site/). The build checks its SHA-256.
// A release asset cannot be fetched from the page (no CORS headers), so the build copies it to the site.
//
// Output: out/site/ (index.html, assets/, fonts/, data/inputs.json, data/audio.mp3).
// PVE_SITE_BASE sets the URL path of the site (default ./: works under any path, e.g. /<repo>/).
import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO, projectDir } from './scripts/project';
import { siteDir, staleSources, type SiteManifest } from './scripts/site-sources';

const PROJECT = process.env.PVE_SITE_PROJECT ?? 'breaked_neuro';

/** Emits the project's snapshot as data/inputs.json and data/audio.mp3 after checking that it is current. */
function siteData(): Plugin {
  const dir = projectDir(PROJECT);
  const snap = siteDir(dir);
  let audio = Buffer.alloc(0);
  return {
    name: 'pve-site-data',
    buildStart() {
      const manifestFile = path.join(snap, 'manifest.json');
      if (!existsSync(manifestFile)) this.error(`projects/${PROJECT}/site/ has no snapshot: run bun app/scripts/site-data.ts ${PROJECT}`);
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as SiteManifest;
      const stale = staleSources(dir, manifest);
      if (stale.length) this.error(`projects/${PROJECT}/site/ is older than: ${stale.join(', ')}\nRun bun app/scripts/site-data.ts ${PROJECT} and commit projects/${PROJECT}/site/.`);

      const audioPath = process.env.PVE_SITE_AUDIO ?? path.join(snap, manifest.audio.file);
      if (!existsSync(audioPath)) this.error(`no audio at ${audioPath}: download ${manifest.audio.file} from the release ${manifest.audio.release}, or set PVE_SITE_AUDIO`);
      audio = readFileSync(audioPath);
      const sha = createHash('sha256').update(audio).digest('hex');
      if (sha !== manifest.audio.sha256) this.error(`${audioPath} is not the audio of the snapshot (SHA-256 ${sha}, manifest ${manifest.audio.sha256}): upload the file site-data.ts wrote`);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'data/inputs.json', source: readFileSync(path.join(snap, 'inputs.json')) });
      this.emitFile({ type: 'asset', fileName: 'data/audio.mp3', source: audio });
    },
  };
}

export default defineConfig({
  root: path.join(import.meta.dirname, 'site'),
  base: process.env.PVE_SITE_BASE ?? './',
  publicDir: path.join(import.meta.dirname, 'public'),
  plugins: [siteData()],
  define: { 'import.meta.env.VITE_PVE_INPUTS': JSON.stringify('data/inputs.json') },
  server: { fs: { allow: [REPO] } },
  build: { target: 'esnext', assetsInlineLimit: 0, outDir: path.join(REPO, 'out/site'), emptyOutDir: true },
});
