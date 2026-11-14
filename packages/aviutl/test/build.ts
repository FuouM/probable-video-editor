// Builds small synthetic .aup files for the tests. The layout is the one that src/aup.ts reads. No real project is involved.
import { EDIT_HANDLE_HEAD, EDIT_HANDLE_SIZE } from '../src/aup.ts';

/** Shift_JIS bytes of the names the tests need (Bun has no Shift_JIS encoder). */
const SJIS_HEX: Record<string, string> = {
  画像ファイル: '89e6919c837483408343838b',
  スクリプト制御: '8358834e838a8376836790a78ce4',
  標準描画: '95578f80956089e6',
  テキスト: '8365834c83588367',
  音声ファイル: '89b990ba837483408343838b',
  標準再生: '95578f808dc490b6',
  グループ制御: '834f838b815b837690a78ce4',
  縁取り: '898f8ee682e8',
  フレームバッファ: '8374838c815b8380836f836283748340',
  リサイズ: '838a835483438359',
  美咲ゴシック: '94fc8de7835383568362834e',
  不明効果: '957396be8cf889ca',
};

export function sjis(name: string): Uint8Array {
  const hex = SJIS_HEX[name];
  if (hex) return Uint8Array.from(Buffer.from(hex, 'hex'));
  if (/^[\x20-\x7e]*$/.test(name)) return new TextEncoder().encode(name);
  throw new Error(`test builder: no Shift_JIS bytes for ${name}`);
}

export function utf16(text: string): Uint8Array {
  const b = Buffer.alloc(text.length * 2);
  b.write(text, 'utf16le');
  return new Uint8Array(b);
}

export const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** A zeroed buffer with `size` bytes and text or numbers written at offsets. */
function block(size: number): { b: Uint8Array; v: DataView } {
  const b = new Uint8Array(size);
  return { b, v: new DataView(b.buffer) };
}

const i32 = (n: number): Uint8Array => {
  const { b, v } = block(4);
  v.setInt32(0, n, true);
  return b;
};

/** The run-length codec of AviUtl: runs of 4 or more equal bytes become run blocks, the rest literal blocks. */
export function compress(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  const literal = (from: number, to: number) => {
    for (let i = from; i < to; ) {
      const k = Math.min(to - i, 0xffffff);
      if (k < 0x80) out.push(k);
      else out.push(0, k & 0xff, (k >> 8) & 0xff, k >> 16);
      for (let j = 0; j < k; j++) out.push(data[i + j]!);
      i += k;
    }
  };
  let litFrom = 0;
  for (let i = 0; i < data.length; ) {
    let j = i;
    while (j < data.length && data[j] === data[i] && j - i < 0xffffff) j++;
    if (j - i < 4) {
      i = j;
      continue;
    }
    literal(litFrom, i);
    const k = j - i;
    if (k < 0x80) out.push(0x80 | k, data[i]!);
    else out.push(0x80, k & 0xff, (k >> 8) & 0xff, k >> 16, data[i]!);
    i = j;
    litFrom = i;
  }
  literal(litFrom, data.length);
  return Uint8Array.from(out);
}

/** The effect types of the table, in this order. */
export const EFFECT_TABLE = [
  { name: '画像ファイル', tracks: 0, checks: 1, ext: 264 },
  { name: 'スクリプト制御', tracks: 0, checks: 0, ext: 2048 },
  { name: '標準描画', tracks: 6, checks: 1, ext: 0 },
  { name: 'テキスト', tracks: 2, checks: 5, ext: 2096 },
  { name: '音声ファイル', tracks: 2, checks: 3, ext: 264 },
  { name: '標準再生', tracks: 2, checks: 0, ext: 0 },
  { name: 'グループ制御', tracks: 7, checks: 1, ext: 20 },
  { name: '縁取り', tracks: 2, checks: 2, ext: 264 },
  { name: 'フレームバッファ', tracks: 0, checks: 1, ext: 0 },
  { name: 'リサイズ', tracks: 3, checks: 1, ext: 0 },
  { name: '不明効果', tracks: 0, checks: 0, ext: 4 },
];

export interface EffectSpec {
  type: string;
  /** Track values (`cur`). Fewer than the type needs: the rest are 0. */
  tracks?: number[];
  /** Mode of each track (0 = still). */
  modes?: number[];
  checks?: number[];
  ext?: Uint8Array;
}

export interface ObjectSpec {
  layer: number;
  start: number;
  end: number;
  preview?: string;
  effects: EffectSpec[];
}

function objectBytes(o: ObjectSpec, base: number): Uint8Array {
  const { b, v } = block(base);
  v.setUint32(0, 1, true);
  v.setUint32(base === 0x5c8 ? 0x5c0 : 4, o.layer, true);
  v.setUint32(8, o.start, true);
  v.setUint32(12, o.end, true);
  b.set(sjis(o.preview ?? '').subarray(0, 63), 0x10);
  v.setUint32(0x50, 0xffffffff, true);
  for (let k = 0; k < 12; k++) v.setInt32(0x54 + k * 12, -1, true);
  let extOffset = 0, tr = 0, cb = 0;
  const exts: Uint8Array[] = [];
  o.effects.forEach((e, k) => {
    const index = EFFECT_TABLE.findIndex((t) => t.name === e.type);
    const t = EFFECT_TABLE[index];
    if (!t) throw new Error(`test builder: no effect type ${e.type}`);
    v.setInt32(0x54 + k * 12, index, true);
    v.setInt32(0x54 + k * 12 + 8, extOffset, true);
    for (let j = 0; j < t.tracks; j++) {
      v.setInt32(0xf8 + (tr + j) * 4, e.tracks?.[j] ?? 0, true);
      v.setInt32(0x1f8 + (tr + j) * 4, e.tracks?.[j] ?? 0, true);
      v.setUint32(0x2f8 + (tr + j) * 4, e.modes?.[j] ?? 0, true);
    }
    for (let j = 0; j < t.checks; j++) v.setInt32(0x3f8 + (cb + j) * 4, e.checks?.[j] ?? 0, true);
    const ext = new Uint8Array(t.ext);
    ext.set((e.ext ?? new Uint8Array(0)).subarray(0, t.ext));
    exts.push(ext);
    extOffset += t.ext;
    tr += t.tracks;
    cb += t.checks;
  });
  v.setUint32(0xf4, extOffset, true);
  return concat(b, ...exts);
}

/** The ExEdit block, uncompressed. */
function exEditBytes(objects: ObjectSpec[], base: number, tempo: number): Uint8Array {
  const head = block(0x100);
  head.b.set(new TextEncoder().encode('80EE'), 0);
  head.v.setUint32(4, EFFECT_TABLE.length, true);
  head.v.setUint32(8, objects.length, true);
  head.v.setUint32(0x2c, 9006, true);
  head.v.setUint32(0x30, 1, true);
  head.v.setUint32(0x34, tempo * 10000, true);
  head.v.setUint32(0x38, 1, true);
  head.v.setUint32(0x5c, 4, true);
  const table = EFFECT_TABLE.map((t) => {
    const e = block(112);
    e.v.setUint32(4, t.tracks, true);
    e.v.setUint32(8, t.checks, true);
    e.v.setUint32(12, t.ext, true);
    e.b.set(sjis(t.name), 16);
    return e.b;
  });
  return concat(head.b, ...table, ...objects.map((o) => objectBytes(o, base)));
}

export interface AupSpec {
  width?: number;
  height?: number;
  rate?: number;
  scale?: number;
  frames?: number;
  /** Object base size. Default 0x508. */
  base?: 0x508 | 0x5c8;
  tempo?: number;
  objects: ObjectSpec[];
}

/** A whole .aup file: header, edit handle, some bytes of frame tables, the FilterProject block with the ExEdit data. */
export function buildAup(spec: AupSpec): Uint8Array {
  const handle = new Uint8Array(EDIT_HANDLE_SIZE - EDIT_HANDLE_HEAD);
  const hv = new DataView(handle.buffer);
  const put = (offset: number, n: number) => hv.setInt32(offset - EDIT_HANDLE_HEAD, n, true);
  put(0x310, spec.width ?? 256);
  put(0x314, spec.height ?? 192);
  put(0x468, spec.scale ?? 1);
  put(0x46c, spec.rate ?? 18);
  const raw = exEditBytes(spec.objects, spec.base ?? 0x508, spec.tempo ?? 135);
  const name = sjis('ExEdit');
  return concat(
    new TextEncoder().encode('AviUtl ProjectFile version 0.18\0'),
    i32(EDIT_HANDLE_SIZE),
    i32(1),
    new Uint8Array(2 * 260),
    compress(handle),
    i32(spec.frames ?? 100),
    new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    new TextEncoder().encode('FilterProject 0.1\0'),
    i32(name.length + 1),
    name,
    new Uint8Array(1),
    i32(raw.length),
    compress(raw),
  );
}

// object ext helpers

/** ext of 画像ファイル: 4 bytes, then the file path. */
export const imageExt = (path: string): Uint8Array => concat(new Uint8Array(4), sjis(path));

/** ext of スクリプト制御: the script text in UTF-16. */
export const scriptExt = (lines: string[]): Uint8Array => utf16(lines.join('\r\n'));

/** The sprite-sheet script with `mag`, `uro`, `kih` and the given `fs=` line. */
export function spriteScript(mag: number, uro: number, kih: number, fs = 'fs=(obj.frame+kih)%bs', extra: string[] = []): string[] {
  return [
    `mag=${mag}`, `uro=${uro}`, `kih=${kih}`,
    'bs=uro*mag', fs, 'sy=obj.h/mag', 'sx=obj.w/uro', 't1,t2=sx/2,sy/2', 'x0,x1=-t1,t1', 'y0,y1=-t2,t2',
    ...extra,
    'xb0,xb1=(fs%uro)*sx,(fs%uro)*sx+sx',
    'yb0,yb1=math.floor(fs/uro)*sy,math.floor(fs/uro)*sy+sy',
    'obj.drawpoly(x0,y0,0 , x1,y0,0 , x1,y1,0 , x0,y1,0 , xb0,yb0 , xb1,yb0 , xb1,yb1 , xb0,yb1 , 1)',
  ];
}

/** ext of テキスト: type, flags, align, color, font name at 0x10, text in UTF-16 at 0x30. */
export function textExt(font: string, text: string, rgb: [number, number, number]): Uint8Array {
  const ext = new Uint8Array(0x30);
  ext.set(rgb, 8);
  ext.set(sjis(font), 0x10);
  return concat(ext, utf16(text));
}
