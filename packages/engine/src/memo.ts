// A persistent memo for the slow parts of scene loads (SceneCtx.memo, physics `bake`). A value lives in a slot (a stable
// name, so a new key replaces the old value and the store does not grow with each edit) under a key (a hash of
// everything the value comes from). A value must be structured-clonable: plain objects, arrays, typed arrays.
// The store is off by default: the studio turns it on (setMemoStore). Exports and tests always compute.

export interface MemoStore {
  get(slot: string): Promise<{ key: string; value: unknown } | undefined>;
  put(slot: string, key: string, value: unknown): Promise<void>;
}

let store: MemoStore | null = null;

/** The store memo uses (null: memo always computes). */
export function setMemoStore(s: MemoStore | null) {
  store = s;
}

/** The value in `slot` if it was stored under `key`, else `compute()`, stored there for the next load. */
export async function memo<T>(slot: string, key: string, compute: () => T | Promise<T>): Promise<T> {
  if (!store) return compute();
  const hit = await store.get(slot);
  if (hit && hit.key === key) return hit.value as T;
  const value = await compute();
  await store.put(slot, key, value);
  return value;
}

/** Hex SHA-256 of `parts` (strings and numeric arrays, in order). */
export async function digest(parts: (string | ArrayBufferView)[]): Promise<string> {
  const enc = new TextEncoder();
  const bufs = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : new Uint8Array(p.buffer, p.byteOffset, p.byteLength)));
  const all = new Uint8Array(bufs.reduce((n, b) => n + b.byteLength + 4, 0));
  const len = new DataView(all.buffer);
  let at = 0;
  for (const b of bufs) {
    // (each part with its length first: ['ab', 'c'] and ['a', 'bc'] differ)
    len.setUint32(at, b.byteLength);
    all.set(b, at + 4);
    at += b.byteLength + 4;
  }
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('');
}

const DAY = 86_400_000;

/** A record of the IndexedDB store: `used` is the date it was last read or written (ms). */
interface Slot { key: string; value: unknown; used: number }

/** A MemoStore in IndexedDB database `name`. Slots not read for `keepDays` days are deleted when it opens. */
export async function indexedDbMemo(name = 'pve-memo', keepDays = 14): Promise<MemoStore> {
  const open = indexedDB.open(name, 1);
  open.onupgradeneeded = () => open.result.createObjectStore('slots');
  const db = await request(open);
  const cutoff = Date.now() - keepDays * DAY;
  const prune = db.transaction('slots', 'readwrite').objectStore('slots').openCursor();
  prune.onsuccess = () => {
    const c = prune.result;
    if (!c) return;
    const rec: Slot = c.value;
    if (rec.used < cutoff) c.delete();
    c.continue();
  };
  return {
    async get(slot) {
      const rec: Slot | undefined = await request(db.transaction('slots').objectStore('slots').get(slot));
      if (!rec) return undefined;
      // (the read date only matters by the day: a write per day at most)
      if (rec.used < Date.now() - DAY) void request(db.transaction('slots', 'readwrite').objectStore('slots').put({ ...rec, used: Date.now() }, slot));
      return rec;
    },
    async put(slot, key, value) {
      const rec: Slot = { key, value, used: Date.now() };
      await request(db.transaction('slots', 'readwrite').objectStore('slots').put(rec, slot));
    },
  };
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  return promise;
}
