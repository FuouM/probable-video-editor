// Static build of the real-time player for GitHub Pages: `bun run site:build`. The site plays every project that
// has a snapshot (projects/<id>/site/manifest.json); PVE_SITE_PROJECTS (comma list) picks others, the first of the
// list is the video the page opens with (default: breaked_neuro first, then the rest by name). The page runs the engine
// in the visitor's browser, so the build only bundles the engine and the projects' scenes. The inputs come from a
// committed snapshot per project (scripts/site-data.ts) because the build has no Lyric-Sync; the build fails when a
// source file changed after its snapshot.
// The audio is not in git. It is the release asset named in the manifest: the CI downloads each one into a folder and
// sets PVE_SITE_AUDIO_DIR to it (default: the local copy in projects/<id>/site/). The build checks its SHA-256.
// A release asset cannot be fetched from the page (no CORS headers), so the build copies it to the site.
//
// Output: out/site/ (index.html, assets/, fonts/, data/projects.json, and per project data/<id>/: inputs.json,
// subtitles.json, audio.mp3, thumbnail.jpg, assets/ = the project's video/assets/).
// PVE_SITE_BASE sets the URL path of the site (default ./: works under any path, e.g. /<repo>/).
import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO, projectDir } from './scripts/project';
import { siteDir, staleSources, type SiteManifest } from './scripts/site-sources';

const FIRST = 'breaked_neuro';

/** The ids of the videos of the site, in the order of the list on the page. */
function projectIds(): string[] {
  const env = process.env.PVE_SITE_PROJECTS;
  if (env) return env.split(',').map((s) => s.trim()).filter(Boolean);
  const all = readdirSync(path.join(REPO, 'projects'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(siteDir(projectDir(e.name)), 'manifest.json')))
    .map((e) => e.name)
    .sort();
  return all.includes(FIRST) ? [FIRST, ...all.filter((i) => i !== FIRST)] : all;
}

function files(root: string, rel = ''): string[] {
  return readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(root, `${rel}${e.name}/`) : [`${rel}${e.name}`]));
}

/** Emits each project's snapshot as data/<id>/ and the list data/projects.json, after checking that each snapshot is current. */
function siteData(ids: string[]): Plugin {
  const audio = new Map<string, Buffer>();
  return {
    name: 'pve-site-data',
    buildStart() {
      if (!ids.length) this.error('no project has a snapshot: run bun app/scripts/site-data.ts <project>');
      for (const id of ids) {
        const dir = projectDir(id);
        const snap = siteDir(dir);
        const manifestFile = path.join(snap, 'manifest.json');
        if (!existsSync(manifestFile)) this.error(`projects/${id}/site/ has no snapshot: run bun app/scripts/site-data.ts ${id}`);
        const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as SiteManifest;
        const stale = staleSources(dir, manifest);
        if (stale.length) this.error(`projects/${id}/site/ is older than: ${stale.join(', ')}\nRun bun app/scripts/site-data.ts ${id} and commit projects/${id}/site/.`);
        for (const f of ['inputs.json', 'subtitles.json']) if (!existsSync(path.join(snap, f))) this.error(`projects/${id}/site/${f} is missing: run bun app/scripts/site-data.ts ${id}`);

        const audioPath = path.join(process.env.PVE_SITE_AUDIO_DIR ?? snap, manifest.audio.file);
        if (!existsSync(audioPath)) this.error(`no audio at ${audioPath}: download ${manifest.audio.file} from the release ${manifest.audio.release}, or set PVE_SITE_AUDIO_DIR`);
        const buf = readFileSync(audioPath);
        const sha = createHash('sha256').update(buf).digest('hex');
        if (sha !== manifest.audio.sha256) this.error(`${audioPath} is not the audio of the snapshot (SHA-256 ${sha}, manifest ${manifest.audio.sha256}): upload the file site-data.ts wrote`);
        audio.set(id, buf);
      }
    },
    generateBundle() {
      const list = ids.map((id) => {
        const dir = projectDir(id);
        const snap = siteDir(dir);
        const emit = (name: string, source: Buffer | string) => this.emitFile({ type: 'asset', fileName: `data/${id}/${name}`, source });
        const manifest = JSON.parse(readFileSync(path.join(snap, 'manifest.json'), 'utf8')) as SiteManifest;
        // the URL of the mix carries its hash: a browser or a CDN that kept the old mix asks for the new one
        const inputs = JSON.parse(readFileSync(path.join(snap, 'inputs.json'), 'utf8')) as { mix: string };
        inputs.mix = `${inputs.mix}?v=${manifest.audio.sha256.slice(0, 12)}`;
        emit('inputs.json', JSON.stringify(inputs));
        emit('subtitles.json', readFileSync(path.join(snap, 'subtitles.json')));
        emit('audio.mp3', audio.get(id)!);
        const cover = existsSync(path.join(snap, 'thumbnail.jpg'));
        if (cover) emit('thumbnail.jpg', readFileSync(path.join(snap, 'thumbnail.jpg')));
        // what the scenes fetch at run time: the project's video/assets/ (type faces, stroke data)
        const assets = path.join(dir, 'video/assets');
        if (existsSync(assets)) for (const f of files(assets)) emit(`assets/${f}`, readFileSync(path.join(assets, f)));
        const video = JSON.parse(readFileSync(path.join(dir, 'video/video.json'), 'utf8')) as { title?: string };
        return { id, title: video.title ?? id, duration: manifest.audio.duration, thumbnail: cover };
      });
      this.emitFile({ type: 'asset', fileName: 'data/projects.json', source: JSON.stringify(list) });
    },
  };
}

export default defineConfig({
  root: path.join(import.meta.dirname, 'site'),
  base: process.env.PVE_SITE_BASE ?? './',
  publicDir: path.join(import.meta.dirname, 'public'),
  plugins: [siteData(projectIds())],
  define: { 'import.meta.env.VITE_PVE_DATA': JSON.stringify('data/') },
  server: { fs: { allow: [REPO] } },
  build: { target: 'esnext', assetsInlineLimit: 0, outDir: path.join(REPO, 'out/site'), emptyOutDir: true },
});
