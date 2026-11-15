import { defineConfig, normalizePath, type ModuleNode, type Plugin } from 'vite';
import { soulwindow } from 'soulwindow/vite';
import { $ } from 'bun';
import path from 'node:path';
import { PROJECTS, REPO, projectDir } from '@pve/core/projects';
import { json, routeProject } from './scripts/api';
import { notesApi } from './scripts/api-notes';
import { renderApi } from './scripts/api-render';
import { projectInputs } from './scripts/inputs';
import { inputsHash, sceneVersions } from './scripts/versions';
import { SW_OPTIONS } from './src/ui/soulwindow-options';

/** Query git status for modified/untracked scene files in a project (async: a sync spawn stalls the dev server for every file write). */
async function getProjectStatus(id: string) {
  const out = await $`git status --porcelain projects/${id}/video`.cwd(REPO).quiet().nothrow();
  const raw = out.exitCode === 0 ? out.stdout.toString() : '';
  const dirtyClips = new Set<string>();
  const modifiedFiles: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const file = trimmed.slice(2).trim();
    modifiedFiles.push(file);
    const m = /video\/scenes\/([a-zA-Z0-9_-]+)\.ts$/.exec(file);
    if (m && !m[1].startsWith('_')) dirtyClips.add(m[1]);
  }
  return { projectId: id, dirtyClips: [...dirtyClips], modifiedFiles, timestamp: Date.now() };
}

/**
 * The scene names (top-level files of `<project>/video/scenes/` without a leading `_`) that import `mods`, directly or through
 * helper modules of the same folder, `mods` included. Only modules the page has loaded are in the graph.
 */
function scenesImporting(mods: ModuleNode[], sceneDir: string): string[] {
  const scenes = new Set<string>();
  const seen = new Set<ModuleNode>();
  const stack = [...mods];
  while (stack.length) {
    const mod = stack.pop()!;
    if (seen.has(mod) || !mod.file) continue;
    const rel = normalizePath(path.relative(sceneDir, mod.file));
    if (rel.startsWith('..')) continue;
    seen.add(mod);
    const m = /^([a-zA-Z0-9-][a-zA-Z0-9_-]*)\.ts$/.exec(rel);
    if (m) scenes.add(m[1]);
    stack.push(...mod.importers);
  }
  return [...scenes];
}

/**
 * Projects for the page. `GET /api/project/<id>` (no id: PVE_PROJECT) answers the project inputs, read with
 * the Lyric-Sync song-folder reader (it needs the Bun runtime: run Vite with `bunx --bun vite`):
 * video/video.json, the song timing, the features, the lyric lines and the URL of the mix.
 * `/projects/<id>/...` serves the files of a project folder. A change to a project's JSON or YAML reloads the page.
 * `/api/project/<id>/status` answers the git state of the scenes. scripts/api-notes.ts and scripts/api-render.ts
 * answer the notes and render routes.
 */
function projects(): Plugin {
  /** Project id -> hash of the inputs the page read last (the base of the scene versions, see scripts/versions.ts). */
  const inputHashes = new Map<string, string>();
  return {
    name: 'pve-projects',
    configureServer(server) {
      const renderRoute = renderApi(server);
      server.watcher.add(PROJECTS);
      // git status per project at most once per burst of writes (an agent writes several files in a row)
      const statusTimers = new Map<string, ReturnType<typeof setTimeout>>();
      const sendStatus = (projectId: string) => {
        clearTimeout(statusTimers.get(projectId));
        statusTimers.set(projectId, setTimeout(async () => {
          statusTimers.delete(projectId);
          server.ws.send({ type: 'custom', event: 'pve:scene-status', data: await getProjectStatus(projectId) });
        }, 300));
      };
      server.watcher.on('change', (f) => {
        const rel = normalizePath(path.relative(PROJECTS, f));
        if (rel.startsWith('..') || rel.includes('/out/') || rel.includes('/bench/')) return;
        if (/\.(json|ya?ml)$/.test(rel) && !rel.includes('/lyricsync/')) server.ws.send({ type: 'full-reload' });
        sendStatus(rel.split('/')[0]!);
      });
      server.middlewares.use(async (req, res, next) => {
        let url = req.url ?? '';
        if (url.startsWith('/fonts/')) {
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
        }
        if (url.startsWith('/node_modules/.vite/deps/')) {
          req.url = url.replace(/([?&])v=[^&]+(&|$)/, '$1').replace(/[?&]$/, '');
          url = req.url;
        }
        if (url.startsWith('/projects/')) {
          req.url = `/@fs/${encodeURI(normalizePath(PROJECTS))}/${url.slice('/projects/'.length)}`;
          return next();
        }
        const sm = /^\/api\/project(?:\/([^/?#]*))?\/status(?:[?#].*)?$/.exec(url);
        if (sm) {
          json(res, await getProjectStatus(routeProject(sm[1])));
          return;
        }
        if (await notesApi(req, res, url)) return;
        if (await renderRoute(req, res, url)) return;
        const m = /^\/api\/project(?:\/([^/?#]*))?(?:[?#].*)?$/.exec(url);
        if (!m) return next();
        try {
          const id = routeProject(m[1]);
          if (!id) throw new Error('no project: open the page with ?project=<id> or set PVE_PROJECT');
          const dir = projectDir(id);
          const body = await projectInputs(id, dir, {
            mix: (song) => `/projects/${id}/${normalizePath(path.relative(dir, song.prompt.mixPath)).split('/').map(encodeURIComponent).join('/')}`,
            font: (rel) => `/projects/${id}/video/assets/fonts/${rel}`,
          });
          const ih = inputsHash(body);
          inputHashes.set(id, ih);
          json(res, { ...body, versions: sceneVersions(dir, ih) });
        } catch (e) {
          res.statusCode = 404;
          res.setHeader('content-type', 'text/plain');
          res.end(String((e as Error).message ?? e));
        }
      });
    },
    handleHotUpdate(ctx) {
      const rel = normalizePath(path.relative(PROJECTS, ctx.file));
      const m = /^([^/]+)\/video\/scenes\/.+\.ts$/.exec(rel);
      if (!m) return;
      const projectId = m[1]!;
      // only the scenes that import the changed file reload, not every clip of the project
      const scenes = scenesImporting(ctx.modules, path.join(PROJECTS, projectId, 'video/scenes'));
      // HMR timestamps on the changed module and its importers: the re-imported scene then asks for fresh helper URLs (?t=)
      for (const mod of ctx.modules) ctx.server.moduleGraph.invalidateModule(mod, new Set(), ctx.timestamp, true);
      if (scenes.length) {
        // (no inputs hash: no page of this server has read the project, and a scene without a version is never memoized)
        const ih = inputHashes.get(projectId);
        const versions = ih === undefined ? {} : sceneVersions(path.join(PROJECTS, projectId), ih, scenes);
        ctx.server.ws.send({ type: 'custom', event: 'pve:scene-reload', data: { projectId, scenes, versions, timestamp: ctx.timestamp } });
      }
      return [];
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [projects(), soulwindow(SW_OPTIONS)],
  // PVE_NO_HMR=1: no live reload (export renders must not reload mid-run when a file changes)
  server: {
    port: 5173,
    strictPort: false,
    hmr: process.env.PVE_NO_HMR ? false : undefined,
    fs: { allow: [REPO] },
    watch: {
      ignored: ['**/out/**', '**/bench/**', '**/tests/**', '**/.git/**'],
    },
  },
  build: { target: 'esnext', assetsInlineLimit: 0 },
});
