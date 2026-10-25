import { defineConfig, normalizePath, type Plugin } from 'vite';
import type { IncomingMessage } from 'node:http';
import type { Subprocess } from 'bun';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TimingData, resolveVideo, type VideoJson } from '@pve/core';
import { loadSong } from '@pve/core/load';
import { PROJECTS, REPO, projectDir } from './scripts/project';
import { projectInputs } from './scripts/inputs';

/** Query git status for modified/untracked scene files in a project. */
function getProjectStatus(id: string) {
  try {
    const raw = execSync(`git status --porcelain projects/${id}/video`, { encoding: 'utf8', cwd: REPO });
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
  } catch {
    return { projectId: id, dirtyClips: [], modifiedFiles: [], timestamp: Date.now() };
  }
}
async function readBody(req: IncomingMessage): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let data = '';
  req.on('data', (chunk: Buffer | string) => { data += chunk.toString(); });
  req.on('end', () => resolve(data));
  req.on('error', reject);
  return promise;
}


/**
 * Projects for the page. `GET /api/project/<id>` (no id: PVE_PROJECT) answers the project inputs, read with
 * the Lyric-Sync song-folder reader (it needs the Bun runtime: run Vite with `bunx --bun vite`):
 * video/video.json, the song timing, the features, the lyric lines and the URL of the mix.
 * `/projects/<id>/...` serves the files of a project folder. A change to a project's JSON or YAML reloads the page.
 */
interface ActiveRenderJob {
  id: string;
  proc: { pid: number; exited: Promise<number>; stdout: ReadableStream<Uint8Array>; kill: (signal?: number) => void };
  status: Record<string, unknown>;
}

async function getProjectRenderStatus(id: string, scale = 1) {
  const dir = projectDir(id);
  const videoFile = path.join(dir, 'video/video.json');
  if (!existsSync(videoFile)) return { clips: [], allRendered: false, finalMp4: null };

  try {
    const song = await loadSong(dir);
    const timing = new TimingData(song.timing);
    const video = JSON.parse(readFileSync(videoFile, 'utf8')) as VideoJson;
    const resolved = resolveVideo(video, timing);
    const fps = resolved.fps;
    const subDir = scale > 1 ? (scale === 2 ? '4k' : `${Math.round(scale * 1080)}p`) : 'full';
    const framesDir = path.join(dir, 'out/render', subDir, 'frames');
    const clips = resolved.clips.map((c) => {
      const f0 = Math.round(c.start * fps), f1 = Math.round(c.end * fps);
      const segFile = path.join(framesDir, `${String(f0).padStart(6, '0')}-${String(f1).padStart(6, '0')}.mkv`);
      const hasSegment = existsSync(segFile);
      const segStat = hasSegment ? statSync(segFile) : null;
      const sceneFile = path.join(dir, 'video/scenes', `${c.id}.ts`);
      const hasScene = existsSync(sceneFile);
      const isStale = hasSegment && hasScene && statSync(sceneFile).mtimeMs > (segStat?.mtimeMs ?? 0);
      return {
        id: c.id,
        start: c.start,
        end: c.end,
        f0,
        f1,
        total: f1 - f0,
        hasSegment,
        isStale,
        sizeBytes: segStat?.size ?? 0,
        status: (isStale ? 'stale' : hasSegment ? 'done' : 'pending') as 'stale' | 'done' | 'pending',
      };
    });
    const allRendered = clips.length > 0 && clips.every((c) => c.hasSegment);
    const mp4Name = scale > 1 ? (scale === 2 ? `${id}-4k.mp4` : `${id}-${Math.round(scale * 1080)}p.mp4`) : `${id}-full.mp4`;
    const mp4Path = path.join(dir, 'out/render', subDir, mp4Name);
    const hasFinalMp4 = existsSync(mp4Path);
    const finalMp4 = hasFinalMp4 ? {
      path: path.relative(REPO, mp4Path).replace(/\\/g, '/'),
      size: statSync(mp4Path).size,
      mtime: statSync(mp4Path).mtimeMs,
    } : null;

    return { clips, allRendered, finalMp4 };
  } catch (e) {
    return { clips: [], allRendered: false, finalMp4: null, error: String(e) };
  }
}

function projects(): Plugin {
  let currentRender: ActiveRenderJob | null = null;
  interface WebCodecsSession {
    ff: Subprocess<'pipe', 'ignore', 'pipe'>;
    outFile: string;
  }
  const activeWebCodecsSessions = new Map<string, WebCodecsSession>();
  return {
    name: 'pve-projects',
    configureServer(server) {
      server.watcher.add(PROJECTS);
      server.watcher.on('change', (f) => {
        const rel = normalizePath(path.relative(PROJECTS, f));
        if (rel.includes('/out/') || rel.includes('/bench/')) return;
        if (!rel.startsWith('..') && /\.(json|ya?ml)$/.test(rel) && !rel.includes('/lyricsync/')) server.ws.send({ type: 'full-reload' });
        const parts = rel.split('/');
        const projectId = parts[0];
        if (projectId) {
          server.ws.send({
            type: 'custom',
            event: 'pve:scene-status',
            data: getProjectStatus(projectId),
          });
        }
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
          const id = decodeURIComponent(sm[1] ?? '') || process.env.PVE_PROJECT || '';
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(getProjectStatus(id)));
          return;
        }
        const nm = /^\/api\/project(?:\/([^/?#]*))?\/notes(?:\/([^/?#]+))?(?:[?#].*)?$/.exec(url);
        if (nm) {
          const id = decodeURIComponent(nm[1] ?? '') || process.env.PVE_PROJECT || '';
          const noteSubId = nm[2] ? decodeURIComponent(nm[2]) : null;
          if (!id) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'no project id' }));
            return;
          }
          const dir = projectDir(id);
          const notesDir = path.join(dir, 'video/notes');

          if (req.method === 'DELETE' && noteSubId) {
            const file = path.join(notesDir, `${noteSubId}.md`);
            if (existsSync(file)) unlinkSync(file);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, deleted: noteSubId }));
            return;
          }

          if (req.method === 'GET') {
            const notes: Array<{ id: string; title: string; content: string; mtime: number }> = [];
            if (existsSync(notesDir)) {
              for (const name of readdirSync(notesDir)) {
                if (!name.endsWith('.md')) continue;
                const noteId = name.slice(0, -3);
                const file = path.join(notesDir, name);
                const content = readFileSync(file, 'utf8');
                const mtime = statSync(file).mtimeMs;
                const firstLine = content.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
                const title = firstLine.replace(/^#+\s*/, '') || noteId;
                notes.push({ id: noteId, title, content, mtime });
              }
            }
            notes.sort((a, b) => b.mtime - a.mtime);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, notes, notesDir: `projects/${id}/video/notes` }));
            return;
          }

          if (req.method === 'POST') {
            try {
              const raw = await readBody(req);
              const data = JSON.parse(raw) as { id?: string; content: string };
              if (!data.id || typeof data.id !== 'string') {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'note id required' }));
                return;
              }
              if (!existsSync(notesDir)) mkdirSync(notesDir, { recursive: true });
              const file = path.join(notesDir, `${data.id}.md`);
              writeFileSync(file, typeof data.content === 'string' ? data.content : '', 'utf8');
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ ok: true, id: data.id, savedAt: Date.now() }));
              return;
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: (err as Error).message }));
              return;
            }
          }
        }
        const rm = /^\/api\/project(?:\/([^/?#]*))?\/render(?:\/([^/?#]+)(?:\/([^/?#]+))?)?(?:[?#].*)?$/.exec(url);
        if (rm) {
          const id = decodeURIComponent(rm[1] ?? '') || process.env.PVE_PROJECT || '';
          const sub = rm[2];
          const action = rm[3];
          const urlParams = new URL(req.url ?? '', 'http://localhost').searchParams;
          if (!id) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'project id required' }));
            return;
          }
          if (req.method === 'GET' || sub === 'status') {
            const scaleParam = parseFloat(urlParams.get('scale') ?? '1') || 1;
            const renderStatus = await getProjectRenderStatus(id, scaleParam);
            res.end(JSON.stringify({
              active: !!currentRender,
              status: currentRender?.status ?? null,
              ...renderStatus,
            }));
            return;
          }
          if (req.method === 'POST' && sub === 'cancel') {
            if (currentRender) {
              try {
                if (process.platform === 'win32') {
                  execSync(`taskkill /PID ${currentRender.proc.pid} /T /F`);
                } else {
                  currentRender.proc.kill(9);
                }
              } catch {}
              currentRender = null;
              server.ws.send({
                type: 'custom',
                event: 'pve:render-progress',
                data: { projectId: id, status: 'aborted' },
              });
            }
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, canceled: true }));
            return;
          }
          if (req.method === 'POST' && sub === 'delete') {
            try {
              const raw = await readBody(req);
              const data = (raw ? JSON.parse(raw) : {}) as { clipId?: string; all?: boolean; scale?: number };
              const scale = data.scale || 1;
              const subDir = scale > 1 ? (scale === 2 ? '4k' : `${Math.round(scale * 1080)}p`) : 'full';
              const projDir = projectDir(id);
              const framesDir = path.join(projDir, 'out/render', subDir, 'frames');
              if (data.all) {
                if (existsSync(path.join(projDir, 'out/render', subDir))) {
                  rmSync(path.join(projDir, 'out/render', subDir), { recursive: true, force: true });
                }
              } else if (data.clipId) {
                const song = await loadSong(projDir);
                const timing = new TimingData(song.timing);
                const video = JSON.parse(readFileSync(path.join(projDir, 'video/video.json'), 'utf8')) as VideoJson;
                const resolved = resolveVideo(video, timing);
                const fps = resolved.fps;
                const clip = resolved.clips.find((c) => c.id === data.clipId);
                if (clip) {
                  const f0 = Math.round(clip.start * fps), f1 = Math.round(clip.end * fps);
                  const segFile = path.join(framesDir, `${String(f0).padStart(6, '0')}-${String(f1).padStart(6, '0')}.mkv`);
                  if (existsSync(segFile)) rmSync(segFile, { force: true });
                }
              }
              const renderStatus = await getProjectRenderStatus(id);
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ ok: true, ...renderStatus }));
              return;
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: (err as Error).message }));
              return;
            }
          }
          if (req.method === 'POST' && sub === 'webcodecs') {
            const urlParams = new URL(req.url ?? '', 'http://localhost').searchParams;
            if (action === 'start') {
              try {
                const fps = Number(urlParams.get('fps')) || 30;
                const from = Number(urlParams.get('from')) || 0;
                const to = Number(urlParams.get('to')) || 0;
                const projDir = projectDir(id);
                const song = await loadSong(projDir);
                const mixWav = song.prompt.mixPath;
                const absMixWav = path.isAbsolute(mixWav) ? mixWav : path.resolve(REPO, mixWav);
                const scaleParam = parseFloat(urlParams.get('scale') ?? '1') || 1;
                const subDir = scaleParam > 1 ? (scaleParam === 2 ? '4k' : `${Math.round(scaleParam * 1080)}p`) : 'full';
                const outName = scaleParam > 1 ? (scaleParam === 2 ? `${id}-4k.mp4` : `${id}-${Math.round(scaleParam * 1080)}p.mp4`) : `${id}-full.mp4`;
                const outDir = path.join(projDir, 'out/render', subDir);
                mkdirSync(outDir, { recursive: true });
                const outFile = path.join(outDir, outName);

                const args = [
                  'ffmpeg',
                  '-y', '-loglevel', 'error',
                  '-f', 'h264', '-r', String(fps),
                  '-i', 'pipe:0',
                ];
                if (existsSync(absMixWav)) {
                  args.push('-ss', String(from));
                  if (to > from) args.push('-t', String(to - from));
                  args.push('-i', absMixWav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '320k');
                } else {
                  args.push('-map', '0:v');
                }
                args.push('-c:v', 'copy', '-movflags', '+faststart', outFile);

                const ff = Bun.spawn(args, {
                  stdin: 'pipe',
                  stdout: 'ignore',
                  stderr: 'pipe',
                });

                const sessionId = `wc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                activeWebCodecsSessions.set(sessionId, { ff, outFile });

                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ ok: true, sessionId }));
                return;
              } catch (err) {
                res.statusCode = 500;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ error: (err as Error).message }));
                return;
              }
            }

            if (action === 'chunk') {
              const sessionId = urlParams.get('session') ?? '';
              const session = activeWebCodecsSessions.get(sessionId);
              if (!session) {
                res.statusCode = 404;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ error: 'WebCodecs session not found or expired' }));
                return;
              }
              req.on('data', (chunk: Buffer) => {
                session.ff.stdin.write(chunk);
              });
              req.on('end', () => {
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ ok: true }));
              });
              req.on('error', (err) => {
                res.statusCode = 500;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ error: err.message }));
              });
              return;
            }

            if (action === 'finish') {
              const sessionId = urlParams.get('session') ?? '';
              const session = activeWebCodecsSessions.get(sessionId);
              if (!session) {
                res.statusCode = 404;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ error: 'WebCodecs session not found' }));
                return;
              }
              try {
                session.ff.stdin.end();
                const exitCode = await session.ff.exited;
                activeWebCodecsSessions.delete(sessionId);
                if (exitCode !== 0) {
                  const errText = await new Response(session.ff.stderr).text();
                  throw new Error(`ffmpeg stream copy failed: ${errText || `exit code ${exitCode}`}`);
                }
                const stat = statSync(session.outFile);
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({
                  ok: true,
                  outputFile: path.relative(REPO, session.outFile).replace(/\\/g, '/'),
                  size: stat.size,
                }));
                return;
              } catch (err) {
                activeWebCodecsSessions.delete(sessionId);
                res.statusCode = 500;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ error: (err as Error).message }));
                return;
              }
            }

            if (action === 'cancel') {
              const sessionId = urlParams.get('session') ?? '';
              const session = activeWebCodecsSessions.get(sessionId);
              if (session) {
                try { session.ff.kill(); } catch {}
                activeWebCodecsSessions.delete(sessionId);
              }
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ ok: true, cancelled: true }));
              return;
            }
          }
          if (req.method === 'POST') {
            if (currentRender) {
              res.statusCode = 409;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: 'A render is already in progress' }));
              return;
            }
            try {
              const raw = await readBody(req);
              const data = (raw ? JSON.parse(raw) : {}) as {
                range?: 'full' | 'loop' | 'clip' | 'stale';
                from?: number;
                to?: number;
                clips?: string[];
                samples?: number | string;
                scale?: number;
                encodeOnly?: boolean;
                resume?: boolean;
              };
              const cliArgs = ['bun', path.join(REPO, 'packages/cli/src/main.ts'), 'render', '-p', id, '--progress-json'];
              const subDir = data.scale && data.scale > 1 ? (data.scale === 2 ? '4k' : `${Math.round(data.scale * 1080)}p`) : 'full';
              if (data.encodeOnly) {
                cliArgs.push('--encode-only', '--name', subDir);
                if (data.scale && data.scale !== 1) cliArgs.push('--scale', String(data.scale));
              } else {
                if (data.from !== undefined) cliArgs.push('--from', String(data.from));
                if (data.to !== undefined) cliArgs.push('--to', String(data.to));
                if (data.clips && data.clips.length) {
                  cliArgs.push('--clips', data.clips.join(','));
                  cliArgs.push('--no-encode');
                }
                if (data.resume) cliArgs.push('--resume');
                if (data.samples !== undefined) cliArgs.push('--samples', String(data.samples));
                if (data.scale && data.scale !== 1) cliArgs.push('--scale', String(data.scale));
                cliArgs.push('--name', subDir);
              }
              const proc = Bun.spawn(cliArgs, {
                cwd: REPO,
                stdout: 'pipe',
                stderr: 'pipe',
              });
              currentRender = { id, proc, status: { status: data.encodeOnly ? 'encoding' : 'starting' } };

              (async () => {
                const reader = proc.stdout.getReader();
                const decoder = new TextDecoder();
                let buf = '';
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  buf += decoder.decode(value, { stream: true });
                  const lines = buf.split('\n');
                  buf = lines.pop() ?? '';
                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('PROGRESS: ')) {
                      try {
                        const prog = JSON.parse(trimmed.slice('PROGRESS: '.length));
                        if (currentRender?.proc === proc) currentRender.status = prog;
                        server.ws.send({
                          type: 'custom',
                          event: 'pve:render-progress',
                          data: { projectId: id, ...prog },
                        });
                      } catch {}
                    }
                  }
                }
                const code = await proc.exited;
                if (currentRender?.proc === proc) {
                  if (code !== 0 && currentRender.status?.status !== 'complete') {
                    server.ws.send({
                      type: 'custom',
                      event: 'pve:render-progress',
                      data: { projectId: id, status: 'error', error: `Render failed with exit code ${code}` },
                    });
                  }
                  currentRender = null;
                }
              })();

              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ ok: true, started: true }));
              return;
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ error: (err as Error).message }));
              return;
            }
          }
        }
        const m = /^\/api\/project(?:\/([^/?#]*))?(?:[?#].*)?$/.exec(url);
        if (!m) return next();
        try {
          const id = decodeURIComponent(m[1] ?? '') || process.env.PVE_PROJECT || '';
          if (!id) throw new Error('no project: open the page with ?project=<id> or set PVE_PROJECT');
          const dir = projectDir(id);
          const body = await projectInputs(id, dir, {
            mix: (song) => `/projects/${id}/${normalizePath(path.relative(dir, song.prompt.mixPath)).split('/').map(encodeURIComponent).join('/')}`,
            font: (rel) => `/projects/${id}/video/assets/fonts/${rel}`,
          });
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        } catch (e) {
          res.statusCode = 404;
          res.setHeader('content-type', 'text/plain');
          res.end(String((e as Error).message ?? e));
        }
      });
    },
    handleHotUpdate(ctx) {
      const rel = normalizePath(path.relative(PROJECTS, ctx.file));
      if (!rel.startsWith('..')) {
        const m = /^([^/]+)\/video\/scenes\/([a-zA-Z0-9_-]+)\.ts$/.exec(rel);
        if (m) {
          const projectId = m[1];
          const sceneFile = m[2];
          const isHelper = sceneFile.startsWith('_') || sceneFile === 'pdoom';
          ctx.server.ws.send({
            type: 'custom',
            event: 'pve:scene-reload',
            data: {
              projectId,
              file: rel,
              scene: isHelper ? '*' : sceneFile,
              timestamp: ctx.timestamp,
            },
          });
          return [];
        }
      }
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [projects()],
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
