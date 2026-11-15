// Helpers of the /api/project routes of the dev server (vite.config.ts, api-notes.ts, api-render.ts, api-webcodecs.ts).
import type { IncomingMessage, ServerResponse } from 'node:http';

/** A route handler: false when `url` is not its route (or not a method it answers), so the next handler can try. */
export type ApiHandler = (req: IncomingMessage, res: ServerResponse, url: string) => Promise<boolean>;

/** Replies `body` as JSON with HTTP status `status`. */
export function json(res: ServerResponse, body: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

/** The text of an error for a JSON `{ error }` reply. */
export const errorText = (err: unknown): string => (err as Error).message;

/** The project id of a route: the URL segment, else PVE_PROJECT, else ''. */
export const routeProject = (segment: string | undefined): string => decodeURIComponent(segment ?? '') || process.env.PVE_PROJECT || '';

export async function readBody(req: IncomingMessage): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let data = '';
  req.on('data', (chunk: Buffer | string) => { data += chunk.toString(); });
  req.on('end', () => resolve(data));
  req.on('error', reject);
  return promise;
}
