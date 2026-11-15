// `POST /api/project/<id>/render/webcodecs/<action>`: the page encodes H.264 with WebCodecs and uploads it here. ffmpeg
// muxes the stream with the mix into out/render/<renderName>/<id>-<renderName>.mp4 (no re-encode).
// start (?fps&from&to&scale) answers a session id. chunk, finish and cancel take ?session=<id>.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Subprocess } from 'bun';
import { renderMp4Name, renderName } from '@pve/core';
import { loadSong } from '@pve/core/load';
import { REPO, projectDir } from '@pve/core/projects';
import { errorText, json } from './api';

interface Session {
  ff: Subprocess<'pipe', 'ignore', 'pipe'>;
  outFile: string;
}

/** The handler of the WebCodecs upload sessions. It returns false for an unknown action. */
export function webcodecsApi() {
  const sessions = new Map<string, Session>();
  return async (req: IncomingMessage, res: ServerResponse, id: string, action: string | undefined, params: URLSearchParams): Promise<boolean> => {
    if (action === 'start') {
      try {
        const fps = Number(params.get('fps')) || 30;
        const from = Number(params.get('from')) || 0;
        const to = Number(params.get('to')) || 0;
        const dir = projectDir(id);
        const song = await loadSong(dir);
        const mixWav = song.prompt.mixPath;
        const absMixWav = path.isAbsolute(mixWav) ? mixWav : path.resolve(REPO, mixWav);
        const scale = parseFloat(params.get('scale') ?? '1') || 1;
        const outDir = path.join(dir, 'out/render', renderName(scale));
        mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, renderMp4Name(id, scale));

        const args = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'h264', '-r', String(fps), '-i', 'pipe:0'];
        if (existsSync(absMixWav)) {
          args.push('-ss', String(from));
          if (to > from) args.push('-t', String(to - from));
          args.push('-i', absMixWav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '320k');
        } else {
          args.push('-map', '0:v');
        }
        args.push('-c:v', 'copy', '-movflags', '+faststart', outFile);

        const ff = Bun.spawn(args, { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' });
        const sessionId = `wc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        sessions.set(sessionId, { ff, outFile });
        json(res, { ok: true, sessionId });
      } catch (err) {
        json(res, { error: errorText(err) }, 500);
      }
      return true;
    }

    const sessionId = params.get('session') ?? '';
    const session = sessions.get(sessionId);

    if (action === 'chunk') {
      if (!session) {
        json(res, { error: 'WebCodecs session not found or expired' }, 404);
        return true;
      }
      req.on('data', (chunk: Buffer) => {
        session.ff.stdin.write(chunk);
      });
      req.on('end', () => json(res, { ok: true }));
      req.on('error', (err) => json(res, { error: err.message }, 500));
      return true;
    }

    if (action === 'finish') {
      if (!session) {
        json(res, { error: 'WebCodecs session not found' }, 404);
        return true;
      }
      try {
        session.ff.stdin.end();
        const exitCode = await session.ff.exited;
        sessions.delete(sessionId);
        if (exitCode !== 0) {
          const errText = await new Response(session.ff.stderr).text();
          throw new Error(`ffmpeg stream copy failed: ${errText || `exit code ${exitCode}`}`);
        }
        json(res, { ok: true, outputFile: path.relative(REPO, session.outFile).replace(/\\/g, '/'), size: statSync(session.outFile).size });
      } catch (err) {
        sessions.delete(sessionId);
        json(res, { error: errorText(err) }, 500);
      }
      return true;
    }

    if (action === 'cancel') {
      if (session) {
        try { session.ff.kill(); } catch {}
        sessions.delete(sessionId);
      }
      json(res, { ok: true, cancelled: true });
      return true;
    }
    return false;
  };
}
