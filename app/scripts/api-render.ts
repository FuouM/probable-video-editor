// `/api/project/<id>/render[/<sub>[/<action>]]` (no id: PVE_PROJECT): the render dialog of the studio.
// GET (or sub status, ?scale): the clips with their segment state and the final MP4. POST cancel: stops the render.
// POST delete `{ clipId | all, scale }`: removes segments. POST webcodecs/<action>: see api-webcodecs.ts.
// POST: starts `pve render --progress-json` and sends its progress lines to the page (event pve:render-progress).
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { renderMp4Name, renderName, resolveVideo, segmentName, TimingData, type ResolvedVideo, type VideoJson } from '@pve/core';
import { loadSong } from '@pve/core/load';
import { REPO, VIDEO_FILE, projectDir } from '@pve/core/projects';
import { errorText, json, readBody, routeProject, type ApiHandler } from './api';
import { webcodecsApi } from './api-webcodecs';

const RENDER_ROUTE = /^\/api\/project(?:\/([^/?#]*))?\/render(?:\/([^/?#]+)(?:\/([^/?#]+))?)?(?:[?#].*)?$/;

interface ActiveRenderJob {
  proc: { pid: number; exited: Promise<number>; stdout: ReadableStream<Uint8Array>; kill: (signal?: number) => void };
  status: Record<string, unknown>;
}

/** The edit of the project in `dir`, resolved on its song. */
async function resolvedProject(dir: string): Promise<ResolvedVideo> {
  const song = await loadSong(dir);
  const video = JSON.parse(readFileSync(path.join(dir, VIDEO_FILE), 'utf8')) as VideoJson;
  return resolveVideo(video, new TimingData(song.timing));
}

async function renderStatus(id: string, scale = 1) {
  const dir = projectDir(id);
  try {
    const resolved = await resolvedProject(dir);
    const fps = resolved.fps;
    const out = path.join(dir, 'out/render', renderName(scale));
    const clips = resolved.clips.map((c) => {
      const f0 = Math.round(c.start * fps), f1 = Math.round(c.end * fps);
      const segFile = path.join(out, 'frames', segmentName(f0, f1));
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
    const mp4Path = path.join(out, renderMp4Name(id, scale));
    const finalMp4 = existsSync(mp4Path) ? {
      path: path.relative(REPO, mp4Path).replace(/\\/g, '/'),
      size: statSync(mp4Path).size,
      mtime: statSync(mp4Path).mtimeMs,
    } : null;
    return { clips, allRendered, finalMp4 };
  } catch (e) {
    return { clips: [], allRendered: false, finalMp4: null, error: String(e) };
  }
}

/** The handler of the render route. It keeps the one render that can run at a time. */
export function renderApi(server: ViteDevServer): ApiHandler {
  let currentRender: ActiveRenderJob | null = null;
  const webcodecs = webcodecsApi();
  const progress = (data: Record<string, unknown>) => server.ws.send({ type: 'custom', event: 'pve:render-progress', data });

  return async (req, res, url) => {
    const m = RENDER_ROUTE.exec(url);
    if (!m) return false;
    const id = routeProject(m[1]);
    const sub = m[2];
    const action = m[3];
    const params = new URL(req.url ?? '', 'http://localhost').searchParams;
    if (!id) {
      json(res, { error: 'project id required' }, 400);
      return true;
    }
    if (req.method === 'GET' || sub === 'status') {
      const scale = parseFloat(params.get('scale') ?? '1') || 1;
      json(res, { active: !!currentRender, status: currentRender?.status ?? null, ...(await renderStatus(id, scale)) });
      return true;
    }
    if (req.method === 'POST' && sub === 'cancel') {
      if (currentRender) {
        try {
          if (process.platform === 'win32') execSync(`taskkill /PID ${currentRender.proc.pid} /T /F`);
          else currentRender.proc.kill(9);
        } catch {}
        currentRender = null;
        progress({ projectId: id, status: 'aborted' });
      }
      json(res, { ok: true, canceled: true });
      return true;
    }
    if (req.method === 'POST' && sub === 'delete') {
      try {
        const raw = await readBody(req);
        const data = (raw ? JSON.parse(raw) : {}) as { clipId?: string; all?: boolean; scale?: number };
        const scale = data.scale || 1;
        const dir = projectDir(id);
        if (data.all) {
          rmSync(path.join(dir, 'out/render', renderName(scale)), { recursive: true, force: true });
        } else if (data.clipId) {
          const resolved = await resolvedProject(dir);
          const clip = resolved.clips.find((c) => c.id === data.clipId);
          if (clip) {
            const fps = resolved.fps;
            rmSync(path.join(dir, 'out/render', renderName(scale), 'frames', segmentName(Math.round(clip.start * fps), Math.round(clip.end * fps))), { force: true });
          }
        }
        json(res, { ok: true, ...(await renderStatus(id)) });
      } catch (err) {
        json(res, { error: errorText(err) }, 500);
      }
      return true;
    }
    if (req.method === 'POST' && sub === 'webcodecs' && (await webcodecs(req, res, id, action, params))) return true;
    if (req.method !== 'POST') return false;
    if (currentRender) {
      json(res, { error: 'A render is already in progress' }, 409);
      return true;
    }
    try {
      const raw = await readBody(req);
      const data = (raw ? JSON.parse(raw) : {}) as {
        from?: number;
        to?: number;
        clips?: string[];
        samples?: number | string;
        scale?: number;
        encodeOnly?: boolean;
        resume?: boolean;
      };
      const cliArgs = ['bun', path.join(REPO, 'packages/cli/src/main.ts'), 'render', '-p', id, '--progress-json'];
      const name = renderName(data.scale || 1);
      if (data.encodeOnly) {
        cliArgs.push('--encode-only', '--name', name);
        if (data.scale && data.scale !== 1) cliArgs.push('--scale', String(data.scale));
      } else {
        if (data.from !== undefined) cliArgs.push('--from', String(data.from));
        if (data.to !== undefined) cliArgs.push('--to', String(data.to));
        if (data.clips && data.clips.length) cliArgs.push('--clips', data.clips.join(','), '--no-encode');
        if (data.resume) cliArgs.push('--resume');
        if (data.samples !== undefined) cliArgs.push('--samples', String(data.samples));
        if (data.scale && data.scale !== 1) cliArgs.push('--scale', String(data.scale));
        cliArgs.push('--name', name);
      }
      const proc = Bun.spawn(cliArgs, { cwd: REPO, stdout: 'pipe', stderr: 'pipe' });
      currentRender = { proc, status: { status: data.encodeOnly ? 'encoding' : 'starting' } };

      void (async () => {
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
            if (!trimmed.startsWith('PROGRESS: ')) continue;
            try {
              const prog = JSON.parse(trimmed.slice('PROGRESS: '.length));
              if (currentRender?.proc === proc) currentRender.status = prog;
              progress({ projectId: id, ...prog });
            } catch {}
          }
        }
        const code = await proc.exited;
        if (currentRender?.proc === proc) {
          if (code !== 0 && currentRender.status?.status !== 'complete') {
            progress({ projectId: id, status: 'error', error: `Render failed with exit code ${code}` });
          }
          currentRender = null;
        }
      })();

      json(res, { ok: true, started: true });
    } catch (err) {
      json(res, { error: errorText(err) }, 500);
    }
    return true;
  };
}
