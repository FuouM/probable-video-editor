// The /api/project routes of the dev server (app/vite.config.ts and app/scripts/api-*.ts) for the studio panels.

/** The URL of route `sub` of project `projectId`, e.g. `render/status?scale=2`. */
export function apiUrl(projectId: string, sub: string): string {
  return `/api/project/${encodeURIComponent(projectId)}/${sub}`;
}

/**
 * Sends a request to route `sub` of project `projectId` and returns its JSON body. On an HTTP error status it throws
 * the `error` text of the reply, else `failText` (default `HTTP <status>`).
 */
export async function apiJson<T>(projectId: string, sub: string, init?: RequestInit, failText?: string): Promise<T> {
  const res = await fetch(apiUrl(projectId, sub), init);
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => null);
    const msg = err && typeof err === 'object' && 'error' in err && typeof err.error === 'string' && err.error ? err.error : undefined;
    throw new Error(msg ?? failText ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** A POST request with a JSON body. */
export function postJson(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
