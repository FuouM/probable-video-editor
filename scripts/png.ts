// Minimal PNG codec for the pixel checks: 8-bit RGB/RGBA, no interlace. Decoded images are RGBA.
import { deflateSync, inflateSync } from 'node:zlib';

export interface Image { width: number; height: number; data: Uint8Array }

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, body: Uint8Array) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  out.set(body, 8);
  out.writeUInt32BE(Bun.hash.crc32(out.subarray(4, 8 + body.length)) >>> 0, 8 + body.length);
  return out;
}

/** Encode top-down RGBA pixels (filter 0 on every row, so the same pixels give the same bytes). */
export function encodePng({ width, height, data }: Image): Buffer {
  const row = width * 4;
  const raw = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bit, RGBA, deflate, filter set 0, no interlace
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

export function decodePng(file: Uint8Array): Image {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let width = 0, height = 0, channels = 0;
  const idat: Buffer[] = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, color, , , interlace] = body.subarray(8, 13);
      channels = color === 6 ? 4 : color === 2 ? 3 : 0;
      if (depth !== 8 || !channels || interlace) throw new Error(`unsupported PNG (depth ${depth}, color type ${color}, interlace ${interlace})`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels, cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  const data = new Uint8Array(width * height * 4);
  const isRgba = channels === 4;
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (stride + 1);
    const filter = raw[rowOffset]!;
    const line = raw.subarray(rowOffset + 1, rowOffset + 1 + stride);
    if (filter === 0) {
      cur.set(line);
    } else if (filter === 1) {
      for (let i = 0; i < channels; i++) cur[i] = line[i]!;
      for (let i = channels; i < stride; i++) cur[i] = (line[i]! + cur[i - channels]!) & 255;
    } else if (filter === 2) {
      for (let i = 0; i < stride; i++) cur[i] = (line[i]! + prev[i]!) & 255;
    } else if (filter === 3) {
      for (let i = 0; i < channels; i++) cur[i] = (line[i]! + (prev[i]! >> 1)) & 255;
      for (let i = channels; i < stride; i++) cur[i] = (line[i]! + ((cur[i - channels]! + prev[i]!) >> 1)) & 255;
    } else if (filter === 4) {
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? cur[i - channels]! : 0, b = prev[i]!, c = i >= channels ? prev[i - channels]! : 0;
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        cur[i] = (line[i]! + pred) & 255;
      }
    }
    if (isRgba) {
      data.set(cur, y * stride);
    } else {
      for (let x = 0; x < width; x++) {
        const dst = (y * width + x) * 4, src = x * 3;
        data[dst] = cur[src]!; data[dst + 1] = cur[src + 1]!; data[dst + 2] = cur[src + 2]!; data[dst + 3] = 255;
      }
    }
    prev.set(cur);
  }
  return { width, height, data };
}

/** Max absolute channel difference and the count of pixels with any difference (vectorized 32-bit fast path). */
export function diffImages(a: Image, b: Image): { maxDiff: number; pixels: number } {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`size ${a.width}x${a.height} != ${b.width}x${b.height}`);
  const d1 = a.data, d2 = b.data;
  const n = d1.length;
  const u1 = new Uint32Array(d1.buffer, d1.byteOffset, n >> 2);
  const u2 = new Uint32Array(d2.buffer, d2.byteOffset, n >> 2);
  const len = u1.length;
  let maxDiff = 0, pixels = 0;
  for (let i = 0; i < len; i++) {
    if (u1[i] !== u2[i]) {
      pixels++;
      const p1 = u1[i]!, p2 = u2[i]!;
      const r = Math.abs((p1 & 0xff) - (p2 & 0xff));
      const g = Math.abs(((p1 >> 8) & 0xff) - ((p2 >> 8) & 0xff));
      const b_ = Math.abs(((p1 >> 16) & 0xff) - ((p2 >> 16) & 0xff));
      const a_ = Math.abs(((p1 >>> 24) & 0xff) - ((p2 >>> 24) & 0xff));
      const m = Math.max(r, g, b_, a_);
      if (m > maxDiff) maxDiff = m;
    }
  }
  return { maxDiff, pixels };
}
