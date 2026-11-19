// Chat rooms: messages between agents of different harnesses (and the human) on one project.
// A room is two files in <project>/out/chat/ (git ignores out/): <room>.jsonl, the messages in order, one JSON
// object per line, and <room>.cursors.json, the last seq that each participant read. A writer holds
// <room>.lock while it gives a seq or writes the cursors, so two senders never take the same seq and a cursor
// update is never lost. A reader takes no lock: it reads whole lines only.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface ChatMsg {
  /** 1-based, one higher than the message before. */
  seq: number;
  /** ISO-8601 UTC. */
  ts: string;
  from: string;
  /** One participant, or '*' (all). No `to`: all. */
  to?: string;
  /** Markdown. */
  body: string;
  /** Paths from the repository root. */
  files?: string[];
  /** The sender waits for the human director. */
  needsHuman?: boolean;
}

export interface Room {
  name: string;
  dir: string;
  log: string;
  cursors: string;
  lock: string;
}

export const CHAT_DIR = 'out/chat';
const ROOM_NAME = /^[A-Za-z0-9_-]+$/;
const LOCK_WAIT_MS = 5000;
/** A lock older than this was left by a process that died. */
const LOCK_STALE_MS = 10000;
const DEBOUNCE_MS = 50;
/** fs.watch can miss events on Windows: read the room again at least this often. */
const POLL_MS = 2000;

/** The room `name` of the project in `projectDir`. Throws on a name that is not a plain file name. */
export function openRoom(projectDir: string, name = 'main'): Room {
  if (!ROOM_NAME.test(name)) throw new Error(`room '${name}': use letters, digits, '-' and '_' only`);
  const dir = path.join(projectDir, CHAT_DIR);
  return { name, dir, log: path.join(dir, `${name}.jsonl`), cursors: path.join(dir, `${name}.cursors.json`), lock: path.join(dir, `${name}.lock`) };
}

/** All the messages. A last line with no newline is a message that is still being written: it is left out. */
export function readMessages(r: Room): ChatMsg[] {
  if (!existsSync(r.log)) return [];
  const text = readFileSync(r.log, 'utf8');
  const lines = text.split('\n');
  lines.pop();
  return lines.filter((l) => l.trim()).map((l) => JSON.parse(l) as ChatMsg);
}

export function readCursors(r: Room): Record<string, number> {
  return existsSync(r.cursors) ? (JSON.parse(readFileSync(r.cursors, 'utf8')) as Record<string, number>) : {};
}

function locked<T>(r: Room, fn: () => T): T {
  mkdirSync(r.dir, { recursive: true });
  const end = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      closeSync(openSync(r.lock, 'wx'));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(r.lock).mtimeMs > LOCK_STALE_MS) rmSync(r.lock, { force: true });
      } catch {
        // the holder removed it between the two calls
      }
      if (Date.now() > end) throw new Error(`room ${r.name} is locked: ${path.relative(process.cwd(), r.lock)}`);
      Bun.sleepSync(5);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(r.lock, { force: true });
  }
}

/** Writes the cursors through a temp file and a rename: a reader never sees half a file. Hold the lock. */
function writeCursors(r: Room, cursors: Record<string, number>) {
  const tmp = `${r.cursors}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cursors, null, 2));
  renameSync(tmp, r.cursors);
}

/** Moves the cursor of `who` to `seq`. A cursor never goes back. */
export function markRead(r: Room, who: string, seq: number) {
  locked(r, () => {
    const c = readCursors(r);
    if ((c[who] ?? 0) >= seq) return;
    c[who] = seq;
    writeCursors(r, c);
  });
}

/**
 * Appends a message with the next seq. It does not move the sender's cursor: a message for the sender that came
 * while it was busy stays unread. A sender never gets its own message (isFor).
 */
export function sendMessage(r: Room, msg: Omit<ChatMsg, 'seq' | 'ts'>, now = new Date()): ChatMsg {
  return locked(r, () => {
    const seq = (readMessages(r).at(-1)?.seq ?? 0) + 1;
    // keys in a fixed order (seq, ts, from, to, body, files, needsHuman); absent options stay out of the line
    const m: ChatMsg = { seq, ts: now.toISOString(), from: msg.from, ...(msg.to ? { to: msg.to } : {}), body: msg.body };
    if (msg.files?.length) m.files = msg.files;
    if (msg.needsHuman) m.needsHuman = true;
    appendFileSync(r.log, `${JSON.stringify(m)}\n`);
    return m;
  });
}

/** True when `me` must read `m`: another participant sent it, to `me` or to all. */
export const isFor = (m: ChatMsg, me: string) => m.from !== me && (!m.to || m.to === '*' || m.to === me);

export interface TakeOpts {
  /** Read after this seq instead of after the cursor. */
  after?: number;
  /** Do not move the cursor. */
  peek?: boolean;
}

/** The unread messages for `me`. Unless `peek`: moves the cursor of `me` to the last message of the room. */
export function takeUnread(r: Room, me: string, o: TakeOpts = {}): ChatMsg[] {
  const all = readMessages(r);
  const after = o.after ?? readCursors(r)[me] ?? 0;
  const got = all.filter((m) => m.seq > after && isFor(m, me));
  if (got.length && !o.peek) markRead(r, me, all.at(-1)!.seq);
  return got;
}

/**
 * Blocks until there is a message for `me`, and takes it (takeUnread). It reads the room once before it watches,
 * so a message that came while the caller was busy returns at once. `timeoutS` 0: no timeout. Returns [] on timeout.
 */
export async function waitUnread(r: Room, me: string, timeoutS: number, o: TakeOpts = {}): Promise<ChatMsg[]> {
  mkdirSync(r.dir, { recursive: true });
  const end = timeoutS > 0 ? Date.now() + timeoutS * 1000 : Infinity;
  let wake = () => {};
  let debounce: Timer | undefined;
  let poll: Timer | undefined;
  const watcher = watch(r.dir, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => wake(), DEBOUNCE_MS);
  });
  try {
    for (;;) {
      const got = takeUnread(r, me, o);
      if (got.length) return got;
      const left = end - Date.now();
      if (left <= 0) return [];
      const { promise, resolve } = Promise.withResolvers<void>();
      wake = resolve;
      poll = setTimeout(resolve, Math.min(POLL_MS, left));
      await promise;
      clearTimeout(poll);
    }
  } finally {
    watcher.close();
    clearTimeout(debounce);
    clearTimeout(poll);
  }
}

export function clearRoom(r: Room) {
  locked(r, () => {
    writeFileSync(r.log, '');
    writeCursors(r, {});
  });
}

export interface RoomStatus {
  room: string;
  messages: number;
  last?: { seq: number; from: string; ts: string; needsHuman: boolean };
  /** Unread messages of each participant (the cursors and the senders). */
  unread: Record<string, number>;
}

export function roomStatus(r: Room): RoomStatus {
  const all = readMessages(r);
  const cursors = readCursors(r);
  const who = [...new Set([...Object.keys(cursors), ...all.map((m) => m.from)])].sort();
  const unread = Object.fromEntries(who.map((p) => [p, all.filter((m) => m.seq > (cursors[p] ?? 0) && isFor(m, p)).length]));
  const m = all.at(-1);
  return { room: r.name, messages: all.length, last: m && { seq: m.seq, from: m.from, ts: m.ts, needsHuman: m.needsHuman === true }, unread };
}

/** `#12  designer -> claude  2026-11-19T10:00:00.000Z  NEEDS HUMAN`, the files, then the body. */
export function formatMessage(m: ChatMsg): string {
  const head = [`#${m.seq}`, `${m.from} -> ${m.to ?? '*'}`, m.ts, ...(m.needsHuman ? ['NEEDS HUMAN'] : [])].join('  ');
  return [head, ...(m.files?.length ? [`files: ${m.files.join(', ')}`] : []), m.body.trimEnd()].join('\n');
}
