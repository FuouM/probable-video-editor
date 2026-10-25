// video/notes.json (DESIGN 9.1): director notes. The studio adds them, the agent resolves them.
// Pure functions. No file access.

export interface Note {
  /** Unique in the file. */
  id: string;
  /** Song time (s). */
  t: number;
  /** Point on the frame in logical px (1920x1080), or absent for a note on the whole frame. */
  at?: [number, number];
  /** The clip on screen when the note was made. */
  clip: string;
  text: string;
  /** ISO time the note was made. */
  created: string;
  /** ISO time the note was resolved. Absent: open. */
  resolved?: string;
}

export interface NotesJson {
  v: 1;
  notes: Note[];
}

export type NotesResult = { ok: true; notes: NotesJson } | { ok: false; errors: { path: string; message: string }[] };

const NOTE_KEYS = ['id', 't', 'at', 'clip', 'text', 'created', 'resolved'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateNotes(json: unknown): NotesResult {
  const errors: { path: string; message: string }[] = [];
  const fail = (path: string, message: string) => errors.push({ path, message });
  if (!isObject(json)) return { ok: false, errors: [{ path: '$', message: 'must be an object' }] };
  for (const k of Object.keys(json)) if (k !== 'v' && k !== 'notes') fail(k, 'unknown key');
  if (json.v !== 1) fail('v', 'must be 1');
  if (!Array.isArray(json.notes)) {
    fail('notes', 'must be an array');
    return { ok: false, errors };
  }
  const ids = new Set<string>();
  json.notes.forEach((n: unknown, i) => {
    const p = `notes[${i}]`;
    if (!isObject(n)) return fail(p, 'must be an object');
    for (const k of Object.keys(n)) if (!NOTE_KEYS.includes(k)) fail(`${p}.${k}`, 'unknown key');
    if (typeof n.id !== 'string' || !n.id.trim()) fail(`${p}.id`, 'must be a non-empty string');
    else if (ids.has(n.id)) fail(`${p}.id`, `duplicate id '${n.id}'`);
    else ids.add(n.id);
    if (typeof n.t !== 'number' || !Number.isFinite(n.t) || n.t < 0) fail(`${p}.t`, 'must be a time in seconds, at least 0');
    if (n.at !== undefined && !(Array.isArray(n.at) && n.at.length === 2 && n.at.every((x) => typeof x === 'number' && Number.isFinite(x)))) fail(`${p}.at`, 'must be [x, y] in px');
    if (typeof n.clip !== 'string') fail(`${p}.clip`, 'must be a string');
    if (typeof n.text !== 'string' || !n.text.trim()) fail(`${p}.text`, 'must be a non-empty string');
    if (typeof n.created !== 'string' || Number.isNaN(Date.parse(n.created))) fail(`${p}.created`, 'must be an ISO time');
    if (n.resolved !== undefined && (typeof n.resolved !== 'string' || Number.isNaN(Date.parse(n.resolved)))) fail(`${p}.resolved`, 'must be an ISO time');
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, notes: json as unknown as NotesJson };
}
