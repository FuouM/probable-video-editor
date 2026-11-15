// The upload of a WebCodecs export to the dev server (app/scripts/api-webcodecs.ts): start opens an ffmpeg session,
// push collects encoded chunks, flush sends them, finish writes the MP4, cancel drops the session.
import { apiJson, apiUrl } from './api';

export class WebCodecsUpload {
  private pendingChunks: BlobPart[] = [];
  /** Bytes pushed since the last flush. */
  pendingBytes = 0;

  private constructor(private projectId: string, private sessionId: string) {}

  /** Opens a session for frames `from`..`to` (s) at `fps` and `scale`. Throws the server's error. */
  static async start(projectId: string, fps: number, from: number, to: number, scale: number): Promise<WebCodecsUpload> {
    const { sessionId } = await apiJson<{ sessionId: string }>(
      projectId,
      `render/webcodecs/start?fps=${fps}&from=${from.toFixed(3)}&to=${to.toFixed(3)}&scale=${scale}`,
      { method: 'POST' },
      'Failed to start WebCodecs render session',
    );
    return new WebCodecsUpload(projectId, sessionId);
  }

  private route(action: 'chunk' | 'finish' | 'cancel'): string {
    return `render/webcodecs/${action}?session=${encodeURIComponent(this.sessionId)}`;
  }

  /** Keeps an encoded chunk until the next flush. */
  push(chunk: EncodedVideoChunk): void {
    const buf = new Uint8Array(chunk.byteLength);
    chunk.copyTo(buf);
    this.pendingChunks.push(buf);
    this.pendingBytes += buf.byteLength;
  }

  /** Sends the kept chunks. */
  async flush(): Promise<void> {
    if (this.pendingChunks.length === 0) return;
    const blob = new Blob(this.pendingChunks);
    this.pendingChunks = [];
    this.pendingBytes = 0;
    await apiJson(this.projectId, this.route('chunk'), { method: 'POST', body: blob }, 'Failed to send video chunk to backend');
  }

  /** Closes the stream: the server writes the MP4 and answers its path (from the repository root) and size. */
  finish(): Promise<{ ok: boolean; outputFile: string; size: number }> {
    return apiJson(this.projectId, this.route('finish'), { method: 'POST' }, 'Failed to finalize MP4 export');
  }

  /** Drops the session. Never throws. */
  async cancel(): Promise<void> {
    await fetch(apiUrl(this.projectId, this.route('cancel')), { method: 'POST' }).catch(() => {});
  }
}
