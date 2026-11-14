// Reader for AviUtl 1.x project files (.aup) with the ExEdit timeline. Pure TypeScript, no dependencies, no I/O.
// Layout after karoterra/AupDotNet (MIT). Two object base sizes exist: 0x5C8 (ExEdit 0.92) and 0x508 (older).
// This file reads the container and the raw ExEdit objects. decode.ts turns the objects into sprites and texts.
const SJIS = new TextDecoder('shift_jis');
const UTF16 = new TextDecoder('utf-16le');

/** Error for a file that is not an AviUtl project, or one that this reader cannot follow. */
export class AupFormatError extends Error {
  override name = 'AupFormatError';
}

const HEADER = 'AviUtl ProjectFile version 0.18\0';
const FILTER_PROJECT = 'FilterProject 0.1';
/** Size of the EditHandle struct, and the size of its uncompressed head (flag and two file names). */
export const EDIT_HANDLE_SIZE = 0x4c09e8;
export const EDIT_HANDLE_HEAD = 0x20c;
const MAX_FILENAME = 260;
const EXEDIT_MAGIC = '80EE';
/** Objects have up to 12 effects. */
const MAX_EFFECTS = 12;

/** Shift_JIS text up to the first NUL. */
export function sjisString(u: Uint8Array): string {
  const z = u.indexOf(0);
  return SJIS.decode(z < 0 ? u : u.subarray(0, z));
}

/** UTF-16LE text up to the first NUL character. */
export function utf16String(u: Uint8Array): string {
  const even = u.subarray(0, u.length & ~1);
  for (let i = 0; i < even.length; i += 2) if (even[i] === 0 && even[i + 1] === 0) return UTF16.decode(even.subarray(0, i));
  return UTF16.decode(even);
}

/**
 * AviUtl's run-length codec. `n` output bytes are read from `b` at `p`.
 * A control byte has a count in its low 7 bits (0: a 3-byte count follows) and the high bit set for a run of one byte.
 * Returns the bytes and the position after the last input byte.
 */
export function decompress(b: Uint8Array, p: number, n: number): { out: Uint8Array; end: number } {
  const out = new Uint8Array(n);
  let i = 0;
  const need = (k: number) => {
    if (p + k > b.length) throw new AupFormatError(`compressed data ends early at byte ${p} (${i} of ${n} bytes decoded)`);
  };
  while (i < n) {
    need(1);
    const s = b[p++]!;
    let k = s & 0x7f;
    if (!k) {
      need(3);
      k = b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16);
      p += 3;
    }
    if (i + k > n) throw new AupFormatError(`compressed data overruns its ${n} bytes at byte ${p}`);
    if (s & 0x80) {
      need(1);
      out.fill(b[p++]!, i, i + k);
    } else {
      need(k);
      out.set(b.subarray(p, p + k), i);
      p += k;
    }
    i += k;
  }
  return { out, end: p };
}

/** One trackbar value of an effect. `cur` is the value of a still trackbar. `next` and `mode` matter only for moving ones (mode 0 = still). */
export interface Track {
  cur: number;
  next: number;
  mode: number;
}

/** One effect of an object, with its raw ext block. */
export interface AupEffect {
  /** Effect name, from the effect table of the file, for example `標準描画`. */
  type: string;
  tracks: Track[];
  checks: number[];
  /** The ext block. Empty for a chained (mid-point) object. */
  ext: Uint8Array;
}

/** One ExEdit object. Frames count from 0, `end` is the last frame (inclusive). */
export interface AupObject {
  index: number;
  layer: number;
  start: number;
  end: number;
  flag: number;
  /** The name that ExEdit shows on the timeline: the file name of a media object, the text of a text object. */
  preview: string;
  /** A chained object (a mid-point of the object before it). It shares the effects of that object. */
  chain: boolean;
  effects: AupEffect[];
}

export interface Aup {
  /** Frame size of the project. */
  width: number;
  height: number;
  /** Frames per second. */
  fps: number;
  /** Frames of the edit. */
  frames: number;
  /** ExEdit version field of the file (9006 for ExEdit 0.92 and its saved projects). */
  version: number;
  /** BPM grid of the timeline. */
  grid: { enabled: boolean; tempo: number; beat: number; offsetFrame: number };
  /** The object base size that the reader found: 0x5C8 (ExEdit 0.92) or 0x508 (older). */
  objectBase: 0x508 | 0x5c8;
  objects: AupObject[];
}

/** Reads a whole .aup file. Throws AupFormatError for a file that does not parse or does not end where it should. */
export function parseAup(bytes: Uint8Array): Aup {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (from: number, n: number) => SJIS.decode(bytes.subarray(from, from + n));
  if (bytes.length < HEADER.length + 8 || text(0, HEADER.length) !== HEADER) throw new AupFormatError('not an AviUtl project: the file header is missing');

  // The edit handle: size, flag, two file names, then the compressed rest. It has the frame size, rate and frame count.
  let p = HEADER.length;
  if (dv.getInt32(p, true) !== EDIT_HANDLE_SIZE) throw new AupFormatError(`unknown edit handle size ${dv.getInt32(p, true)} (expected ${EDIT_HANDLE_SIZE})`);
  p += 4 + 4 + 2 * MAX_FILENAME;
  const handle = decompress(bytes, p, EDIT_HANDLE_SIZE - EDIT_HANDLE_HEAD);
  const hv = new DataView(handle.out.buffer);
  const h = (offset: number) => hv.getInt32(offset - EDIT_HANDLE_HEAD, true);
  const width = h(0x310), height = h(0x314);
  const scale = h(0x468), rate = h(0x46c);
  if (width <= 0 || height <= 0 || scale <= 0 || rate <= 0) throw new AupFormatError(`bad edit handle: size ${width}x${height}, rate ${rate}/${scale}`);
  const frames = dv.getInt32(handle.end, true);

  const filterAt = indexOfText(bytes, FILTER_PROJECT, handle.end + 4);
  if (filterAt < 0) throw new AupFormatError('no ExEdit data: the project has no FilterProject block');
  p = filterAt + FILTER_PROJECT.length + 1;
  const nameLength = dv.getInt32(p, true);
  p += 4;
  const filterName = sjisString(bytes.subarray(p, p + nameLength));
  p += nameLength;
  const size = dv.getInt32(p, true);
  p += 4;
  const ex = parseExEdit(decompress(bytes, p, size).out, filterName);
  return { width, height, fps: rate / scale, frames, ...ex };
}

function indexOfText(b: Uint8Array, needle: string, from: number): number {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = from; i <= b.length - n.length; i++) {
    for (let k = 0; k < n.length; k++) if (b[i + k] !== n[k]) continue outer;
    return i;
  }
  return -1;
}

type ExEdit = Pick<Aup, 'version' | 'grid' | 'objectBase' | 'objects'>;

function parseExEdit(d: Uint8Array, name: string): ExEdit {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const u = (x: number) => v.getUint32(x, true);
  const i32 = (x: number) => v.getInt32(x, true);
  if (d.length < 0x100 || SJIS.decode(d.subarray(0, 4)) !== EXEDIT_MAGIC) throw new AupFormatError(`${name}: the ExEdit block has no ${EXEDIT_MAGIC} magic`);

  const effectTypes = u(4), objectCount = u(8);
  const grid = { enabled: u(0x30) !== 0, tempo: u(0x34) / 10000, beat: u(0x5c), offsetFrame: u(0x38) };
  const scenes = u(0x68), layers = u(0x6c), trackbarScripts = u(0x7c);
  let c = 0x100 + layers * 76 + scenes * 220 + trackbarScripts * 128;

  const types: { tracks: number; checks: number; ext: number; name: string }[] = [];
  for (let i = 0; i < effectTypes; i++, c += 112) {
    types.push({ tracks: u(c + 4), checks: u(c + 8), ext: u(c + 12), name: sjisString(d.subarray(c + 16, c + 112)) });
  }

  // The object base size: old ExEdit has the ext data at +0x508, 0.92 at +0x5C8. The right one walks the objects to the end of the data.
  const objStart = c;
  const endWith = (base: number): number => {
    let p = objStart, last = 0xffffffff;
    for (let n = 0; n < objectCount; n++) {
      if (p + base > d.length) return -1;
      const group = u(p + 0x50), ext = u(p + 0xf4);
      p += base + (group !== 0xffffffff && group === last && ext === 0 ? 0 : ext);
      last = group;
    }
    return p;
  };
  const objectBase = ([0x5c8, 0x508] as const).find((base) => endWith(base) === d.length);
  if (!objectBase) throw new AupFormatError(`${name}: the ${objectCount} objects fit the data with neither object size 0x5C8 (ExEdit 0.92) nor 0x508 (older)`);

  const objects: AupObject[] = [];
  let lastChain = 0xffffffff;
  for (let n = 0; n < objectCount; n++) {
    const s = c;
    if (s + objectBase > d.length) throw new AupFormatError(`${name}: object ${n} starts at byte ${s}, past the end of the data (${d.length} bytes)`);
    const chainGroup = u(s + 0x50);
    const extSize = u(s + 0xf4);
    const chain = chainGroup !== 0xffffffff && chainGroup === lastChain && extSize === 0;
    const effects: AupEffect[] = [];
    let trackIndex = 0, checkIndex = 0;
    for (let k = 0; k < MAX_EFFECTS; k++) {
      const typeIndex = i32(s + 0x54 + k * 12);
      if (typeIndex === -1) break;
      const t = types[typeIndex];
      if (!t) throw new AupFormatError(`${name}: object ${n}: effect type ${typeIndex} is not in the effect table (${types.length} types)`);
      const extOffset = i32(s + 0x54 + k * 12 + 8);
      const tracks: Track[] = [];
      for (let j = 0; j < t.tracks; j++) {
        const ix = trackIndex + j;
        tracks.push({ cur: i32(s + 0xf8 + ix * 4), next: i32(s + 0x1f8 + ix * 4), mode: u(s + 0x2f8 + ix * 4) });
      }
      const checks: number[] = [];
      for (let j = 0; j < t.checks; j++) checks.push(i32(s + 0x3f8 + (checkIndex + j) * 4));
      const extStart = s + objectBase + extOffset;
      if (!chain && extStart + t.ext > d.length) throw new AupFormatError(`${name}: object ${n}: the ext block of ${t.name} ends past the data`);
      effects.push({ type: t.name, tracks, checks, ext: chain ? new Uint8Array(0) : d.subarray(extStart, extStart + t.ext) });
      trackIndex += t.tracks;
      checkIndex += t.checks;
    }
    objects.push({
      index: n,
      layer: objectBase === 0x5c8 ? u(s + 0x5c0) : u(s + 4),
      start: u(s + 8),
      end: u(s + 12),
      flag: u(s),
      preview: sjisString(d.subarray(s + 0x10, s + 0x50)),
      chain,
      effects,
    });
    c += objectBase + (chain ? 0 : extSize);
    lastChain = chainGroup;
  }
  if (c !== d.length) throw new AupFormatError(`${name}: ${d.length - c} bytes follow the last object (the reader and the file disagree on the object layout)`);
  return { version: u(0x2c), grid, objectBase, objects };
}
