// _cnn: The convolutional network diagram and its shatter snapshot, shared by cnn and over_shatter.
import type { AudioData } from '@pve/engine/audio';
import type { Lyrics } from '@pve/engine/lyrics';
import { H, SCALE, W } from '@pve/engine/gl';
import { clamp, ease, keys, prog } from '@pve/engine/util';
import { BAR, BEAT, BLUE, INK, PAPER, bricks, brickRect, drawBars, gray, hashI, readout, rebate, stepT, type PrintOpts } from './_kit';
import { IMPACT, SHARDS, drawCracks, flashPieces, shardOn, shardPath, traceCrackEdges } from './_shatter';

const IW = 192, IH = 108;
const CLASSES = ['wall', 'mirror', 'room', 'ceiling', 'dust', 'shadow', 'bird', 'hand', 'eye', 'signal', 'pond'];
const FC_X = 3150, CLS_X = 3420, OUT_X = 4040;
const FLASHES = 64;
const STOP = 15.75;
export const SHATTER = 0.3;
const GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
type Map2 = { w: number; h: number; v: Float32Array; canvas?: HTMLCanvasElement };

function conv(m: Map2, k: number[]): Map2 {
  const out = new Float32Array(m.w * m.h);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    let s = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const xx = x + i, yy = y + j;
      if (xx >= 0 && yy >= 0 && xx < m.w && yy < m.h) s += k[(j + 1) * 3 + i + 1]! * m.v[yy * m.w + xx]!;
    }
    out[y * m.w + x] = s;
  }
  return { w: m.w, h: m.h, v: out };
}
function relu(m: Map2): Map2 {
  let mx = 1e-6;
  for (let i = 0; i < m.v.length; i++) { m.v[i] = Math.max(0, m.v[i]!); mx = Math.max(mx, m.v[i]!); }
  for (let i = 0; i < m.v.length; i++) m.v[i] = m.v[i]! / mx;
  return m;
}
function pool(m: Map2): Map2 {
  const w = Math.floor(m.w / 2), h = Math.floor(m.h / 2);
  const v = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    v[y * w + x] = Math.max(m.v[2 * y * m.w + 2 * x]!, m.v[2 * y * m.w + 2 * x + 1]!, m.v[(2 * y + 1) * m.w + 2 * x]!, m.v[(2 * y + 1) * m.w + 2 * x + 1]!);
  }
  return { w, h, v };
}
function toCanvas(m: Map2) {
  const cv = document.createElement('canvas');
  cv.width = m.w; cv.height = m.h;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(m.w, m.h);
  for (let i = 0; i < m.v.length; i++) {
    const g = Math.round(11 + 232 * m.v[i]!);
    img.data[i * 4] = g; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = g; img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  m.canvas = cv;
  return m;
}

interface Layer { name: string; maps: Map2[]; X: number; px: number; a: number; b: number; src?: number }

export class CnnDiagram {
  readonly start: number;
  readonly end: number;
  private audio: AudioData;
  private layers: Layer[] = [];
  private fc: number[] = [];
  private words: string[] = [];
  private snap = document.createElement('canvas');
  private sc: CanvasRenderingContext2D | null = null;
  private snapBuilt = false;

  constructor(ly: Lyrics, audio: AudioData, start: number, end: number) {
    this.start = start;
    this.end = end;
    this.audio = audio;
    const input: Map2 = { w: IW, h: IH, v: new Float32Array(IW * IH) };
    const words = ly.lines.filter((l) => l.start < start).flatMap((l) => l.text.toLowerCase().split(' '));
    this.words = [...new Set(words.map((w) => w.replace(/[^a-z'()]/g, '')).filter((w) => w.length > 2))];
    let x = 2, y = 2;
    for (const w of words) {
      const bt = bricks(w.replace(/[^a-z'()]/g, ''));
      if (x + bt.cols > IW - 2) { x = 2; y += 12; }
      if (y + 10 > IH) break;
      for (const b of bt.bricks) for (let j = 0; j < b.len; j++) input.v[(y + b.cy) * IW + x + b.cx + j] = 1;
      x += bt.cols + 6;
    }
    const K1 = [
      [-1, -1, -1, 2, 2, 2, -1, -1, -1], [-1, 2, -1, -1, 2, -1, -1, 2, -1],
      [2, -1, -1, -1, 2, -1, -1, -1, 2], [1, 1, 1, 1, 1, 1, 1, 1, 1],
    ];
    const c1 = K1.map((k) => toCanvas(relu(conv(input, k))));
    const p1 = c1.map((m) => toCanvas(pool(m)));
    const c2 = Array.from({ length: 6 }, (_, j) => {
      const acc: Map2 = { w: p1[0]!.w, h: p1[0]!.h, v: new Float32Array(p1[0]!.w * p1[0]!.h) };
      p1.forEach((m, q) => {
        const k = Array.from({ length: 9 }, (_, n) => hashI(j * 9 + n, q, 11) * 2 - 1);
        const r = conv(m, k);
        for (let i = 0; i < acc.v.length; i++) acc.v[i] = acc.v[i]! + r.v[i]!;
      });
      return toCanvas(relu(acc));
    });
    const p2 = c2.map((m) => toCanvas(pool(m)));
    const p3 = p2.map((m) => toCanvas(pool(m)));
    const flat = p3.flatMap((m) => [...m.v]);
    this.fc = Array.from({ length: 32 }, (_, j) => flat.reduce((s, v, i) => s + v * (hashI(i, j, 13) * 2 - 1), 0));
    const mx = Math.max(...this.fc.map(Math.abs));
    this.fc = this.fc.map((v) => Math.max(0, v / mx));
    this.layers = [
      { name: 'input 192×108', maps: [toCanvas(input)], X: 0, px: 3, a: 0, b: 1.5 },
      { name: 'conv 3×3 · 4', maps: c1, X: 760, px: 3, a: 1.5, b: 5, src: 0 },
      { name: 'max pool 2×2', maps: p1, X: 1500, px: 3, a: 5, b: 6.5, src: 1 },
      { name: 'conv 3×3 · 6', maps: c2, X: 2000, px: 3, a: 6.5, b: 9.5, src: 2 },
      { name: 'max pool 2×2', maps: p2, X: 2520, px: 3, a: 9.5, b: 10.5, src: 3 },
      { name: 'max pool 2×2', maps: p3, X: 2820, px: 3, a: 10.5, b: 11.5, src: 4 },
    ];
  }

  private place(L: Layer, n: number, u: number, v: number, cam: number): [number, number] {
    const ox = L.X - cam + 160 + n * 22, oy = 330 + n * 26;
    return [ox + u * L.px + v * L.px * 0.42, oy + v * L.px * 0.55 - u * L.px * 0.16];
  }

  camAt(btc: number) {
    return keys(btc, [[0, 0], [1.5, 0], [4, 700, ease.inOutCubic], [6, 1400, ease.inOutCubic], [9, 1950, ease.inOutCubic], [11.5, 2650, ease.inOutCubic], [14, 3000, ease.inOutCubic]]);
  }

  private drawPopBox(c: CanvasRenderingContext2D, bs: number, cam: number, t: number) {
    const x = OUT_X - cam + 160, y = H / 2, s = 320;
    const g = prog(bs, 13, 13.5, ease.outCubic);
    if (g <= 0) return;
    const ss = s * g;
    c.fillStyle = INK;
    c.fillRect(x - ss / 2, y - ss / 2, ss, ss);
    c.strokeStyle = BLUE;
    c.lineWidth = 8;
    c.strokeRect(x - ss / 2 - 4, y - ss / 2 - 4, ss + 8, ss + 8);
    c.strokeStyle = PAPER;
    c.lineWidth = 3.5;
    c.strokeRect(x - ss / 2, y - ss / 2, ss, ss);
    if (g < 1) return;
    const hh = Math.round(s * 0.14);
    c.fillStyle = PAPER;
    c.fillRect(x - s / 2, y - s / 2, s, hh);

    const tBar128 = 4580 / 30; // 152.6667 s (Bar 128 start)
    if (t >= tBar128) {
      rebate(c, 'PRED VOID · CONF 1.00', x - s / 2 + 14, y - s / 2 + hh / 2, 'left', 0);
      this.drawTunnel(c, x, y, s, hh, t, tBar128);
    } else {
      const u = Math.max(0, (bs - 12.75) / (STOP - 12.75));
      const flash = Math.floor(FLASHES * u * u * u);
      const pred = Math.floor(hashI(flash, 7) * CLASSES.length);
      const conf = (0.72 + 0.27 * hashI(flash, 8)).toFixed(2);
      rebate(c, `PRED ${CLASSES[pred]!.toUpperCase()} · CONF ${conf}`, x - s / 2 + 14, y - s / 2 + hh / 2, 'left', 0);
      c.fillStyle = PAPER;
      if (hashI(flash, 11) < 0.22) {
        const m = Math.round(s * 0.17);
        for (const [gx, gy] of GLIDER) brickRect(c, x - 1.5 * m + gx! * m, y + hh * 0.25 - 1.5 * m + gy! * m, 1, m, 0.1);
      } else {
        const word = this.words[Math.floor(hashI(flash, 12) * this.words.length)]!;
        const bt = bricks(word), m = Math.min(Math.floor((s - 60) / bt.cols), Math.round(s * 0.065));
        for (const b of bt.bricks) brickRect(c, x - (bt.cols * m) / 2 + b.cx * m, y + hh * 0.25 - 5 * m + b.cy * m, b.len, m);
      }
    }
  }

  private drawTunnel(c: CanvasRenderingContext2D, x: number, y: number, s: number, hh: number, t: number, t0: number) {
    const tx = x - s / 2 + 3, ty = y - s / 2 + hh + 2, tw = s - 6, th = s - hh - 5;
    const cx = x, cy = ty + th / 2;
    c.save();
    c.beginPath();
    c.rect(tx, ty, tw, th);
    c.clip();
    c.fillStyle = INK;
    c.fillRect(tx, ty, tw, th);

    const dt = Math.max(0, t - t0);
    // Fast continuous zoom speed throughout the entire bar (10 rings/sec)
    const phase = (dt * 10.0) % 1.0;
    const N = 14;

    // Curving longitudinal ribs from center outward
    const nRibs = 8;
    c.strokeStyle = gray(0.6);
    c.lineWidth = 1.5;
    for (let k = 0; k < nRibs; k++) {
      const baseA = (k / nRibs) * Math.PI * 2;
      c.beginPath();
      for (let j = 0; j <= 24; j++) {
        const dj = j / 24;
        const sz = Math.pow(dj, 1.8);
        const twist = dj * 2.8 + dt * 6.5;
        const a = baseA + twist * 0.35;
        const wave = 1 + 0.22 * Math.sin(3 * a + twist) + 0.16 * Math.cos(5 * a - twist * 0.7);
        const rx = (tw * 0.58 * sz) * wave, ry = (th * 0.58 * sz) * (wave * 0.95);
        const px = cx + rx * Math.cos(a), py = cy + ry * Math.sin(a);
        if (j === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke();
    }

    // Concentric curvy, undulating tunnel rings rushing forward
    for (let i = 0; i < N; i++) {
      const d = (i + phase) / N;
      const sz = Math.pow(d, 2.0);
      if (sz < 0.03) continue;

      const isBlue = (i + Math.floor(dt * 12)) % 3 === 0;
      c.strokeStyle = isBlue ? BLUE : PAPER;
      c.lineWidth = isBlue ? 2.5 : (0.9 + sz * 2.0);

      const twist = d * 3.5 + dt * 8.0;
      const STEPS = 48;
      c.beginPath();
      for (let step = 0; step <= STEPS; step++) {
        const a = (step / STEPS) * Math.PI * 2;
        const wave = 1
          + 0.24 * Math.sin(3 * a + twist)
          + 0.16 * Math.cos(5 * a - twist * 0.6)
          + 0.10 * Math.sin(2 * a + dt * 9);
        const rx = (tw * 0.55 * sz) * wave;
        const ry = (th * 0.55 * sz) * (wave * 0.92);
        const px = cx + rx * Math.cos(a);
        const py = cy + ry * Math.sin(a);
        if (step === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.closePath();
      c.stroke();
    }

    // Swirling vortex singularity in the deep center
    const coreR = 4 + 3 * Math.sin(dt * 18);
    c.fillStyle = BLUE;
    c.beginPath();
    c.arc(cx, cy, coreR * 1.5, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = PAPER;
    c.beginPath();
    c.arc(cx, cy, coreR * 0.6, 0, Math.PI * 2);
    c.fill();

    c.restore();
  }

  frame(c: CanvasRenderingContext2D, t: number, cracks: boolean, skew?: number) {
    c.fillStyle = INK;
    c.fillRect(0, 0, W, H);
    const bt = (t - this.start) / 1.2;
    const tc = stepT(t, 12, skew);
    const cam = this.camAt((tc - this.start) / 1.2);
    c.imageSmoothingEnabled = false;
    const ts = stepT(t, 15, skew);
    const bs = (ts - this.start) / 1.2;
    this.layers.forEach((L) => {
      const fill = prog(bs, L.a, L.b);
      if (fill <= 0) return;
      L.maps.forEach((m, n) => {
        const [x0, y0] = this.place(L, n, 0, 0, cam);
        const [x1, y1] = this.place(L, n, m.w, 0, cam);
        const [x2, y2] = this.place(L, n, 0, m.h, cam);
        if (Math.max(x0, x1, x2) < -200 || Math.min(x0, x1, x2) > W + 200) return;
        c.save();
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.transform((x1 - x0) / m.w, (y1 - y0) / m.w, (x2 - x0) / m.h, (y2 - y0) / m.h, x0, y0);
        const rows = Math.ceil(m.h * fill);
        c.drawImage(m.canvas!, 0, 0, m.w, rows, 0, 0, m.w, rows);
        c.strokeStyle = PAPER;
        c.lineWidth = 0.6;
        c.strokeRect(0, 0, m.w, m.h);
        c.restore();
      });
      if (L.src !== undefined && fill > 0 && fill < 1) {
        const S = this.layers[L.src]!;
        const sm = S.maps[0]!, om = L.maps[0]!;
        const row = Math.floor(fill * om.h);
        const col = Math.floor(((ts * 5) % 1) * om.w);
        const sx = (col / om.w) * sm.w, sy = (row / om.h) * sm.h;
        const win = [this.place(S, 0, sx - 1.5, sy - 1.5, cam), this.place(S, 0, sx + 1.5, sy - 1.5, cam), this.place(S, 0, sx + 1.5, sy + 1.5, cam), this.place(S, 0, sx - 1.5, sy + 1.5, cam)];
        const o = this.place(L, 0, col + 0.5, row + 0.5, cam);
        c.strokeStyle = PAPER;
        c.lineWidth = 1.5;
        c.beginPath(); win.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.stroke();
        c.lineWidth = 0.8;
        for (const p of win) { c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(o[0], o[1]); c.stroke(); }
        c.fillStyle = PAPER;
        c.fillRect(o[0] - 3, o[1] - 3, 6, 6);
      }
      const [lx, lyy] = this.place(L, L.maps.length - 1, 0, L.maps[0]!.h, cam);
      rebate(c, L.name, lx, lyy + 22, 'left', 0.8);
    });
    this.loss(c, bs);
    const fcX = FC_X - cam + 160;
    const lit = Math.floor(prog(bs, 11.5, 12.5) * 32);
    if (lit > 0) {
      const P = this.layers[5]!;
      // solid mid-gray, not a thin alpha line: on the black ground it must survive the halftone
      c.strokeStyle = gray(0.5);
      c.lineWidth = 1;
      c.beginPath();
      for (let n = 0; n < P.maps.length; n++) {
        const [px, py] = this.place(P, n, P.maps[n]!.w, P.maps[n]!.h / 2, cam);
        for (let j = 0; j < lit; j += 2) { c.moveTo(px, py); c.lineTo(fcX, 230 + j * 16 + 8); }
      }
      c.stroke();
    }
    for (let j = 0; j < lit; j++) {
      c.fillStyle = gray(0.4 + 0.6 * this.fc[j]!);
      brickRect(c, fcX, 230 + j * 16, 3, 16);
    }
    if (lit > 0) rebate(c, 'dense · 32', fcX, 230 + 32 * 16 + 18, 'left', 0.8);
    if (bs >= 12.5) this.head(c, bs, cam, fcX);
    drawBars(c);
    readout(c, `INSTRUMENTAL · CNN BAR ${String(Math.min(16, Math.floor(bs) + 1)).padStart(2, '0')}/16`, 'left');
    readout(c, `DENSE LIT ${String(lit).padStart(2, '0')}/32`, 'right');
    if (bt >= 13) this.drawPopBox(c, bt, cam, t);
    const tBar128 = 4580 / 30; // 152.6667 s (start of Bar 128, frame 4580)
    const tBar127 = this.start + 14 * 1.2; // 151.48 s (Bar 127 start)
    if (cracks && t >= tBar127) {
      if (t < tBar128) {
        // Bar 127-128: normal speed propagation, stepped at 10 fps
        const tcCrack = stepT(t, 10, skew);
        const p = prog(tcCrack, tBar127, tBar128) * 0.40;
        drawCracks(c, p, 0, IMPACT[0], IMPACT[1]);
      } else {
        // Bar 128-129 (starts on frame 4580):
        // 1. Add a new crack such that every beat = 4 new cracks (16 new cracks over 4 beats)
        const subBeat = Math.min(16, Math.floor((t - tBar128) / (BEAT / 4) + 1e-4));
        const p = 0.40 + 0.60 * (subBeat / 16);
        drawCracks(c, p, subBeat, IMPACT[0], IMPACT[1]);
        // 2. Every beat, a set of pieces flashes, 2 times per beat (8 half-beats), persisting until the next flash
        const hb = Math.min(7, Math.max(0, Math.floor((t - tBar128) / (BEAT / 2) + 1e-4)));
        flashPieces(c, hb);
      }
    }
  }

  private loss(c: CanvasRenderingContext2D, bs: number) {
    const enter = prog(bs, 0.1, 1.0, ease.outCubic);
    if (enter <= 0) return;
    const x0 = 72, w = (W - 144) * enter, h = 120 * enter, y0 = H - BAR - 30 - h;
    const e = prog(bs, 0.2, 16);
    c.strokeStyle = gray(0.6);
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0, y0 + h); c.lineTo(x0 + w, y0 + h); c.stroke();
    if (e <= 0) return;
    c.strokeStyle = PAPER;
    c.lineWidth = 1.5;
    c.beginPath();
    const N = 480, n = Math.max(2, Math.floor(e * N));
    const dur = 16 * 1.2;
    for (let i = 0; i <= n; i++) {
      const u = i / N;
      const hit = this.audio.env('low', this.start + u * dur);
      const v = Math.exp(-u * 3.2) * 0.8 + 0.08 + hit * 0.22 * (1 - u * 0.5) + (hashI(i, 81) - 0.5) * 0.04;
      const px = x0 + (i / n) * w, py = y0 + h - Math.min(1, v) * h;
      if (i) c.lineTo(px, py); else c.moveTo(px, py);
    }
    c.stroke();
    rebate(c, `LOSS · STEP ${String(n).padStart(3, '0')}/${N} · EPOCH ${String(Math.floor(e * 64)).padStart(2, '0')}/64`, x0, y0 - 12, 'left', 0.8 * enter);
  }

  private head(c: CanvasRenderingContext2D, bs: number, cam: number, fcX: number) {
    const clsX = CLS_X - cam + 160, outX = OUT_X - cam + 160, outY = H / 2, S = 320;
    const show = prog(bs, 12.5, 13);
    const nCls = Math.ceil(show * CLASSES.length);
    const rowY = (k: number) => 190 + k * 48;
    const u = prog(bs, 12.75, STOP);
    const flash = Math.min(FLASHES, Math.floor(FLASHES * u * u));
    const final = bs >= STOP;
    const pred = final ? CLASSES.length - 1 : Math.floor(hashI(flash, 7) * (CLASSES.length - 1));
    let sum = 0;
    const score = (k: number) => Math.exp(final ? (k === pred ? 9 : 0) : hashI(flash, k, 9) * 2 + (k === pred ? 2.5 : 0));
    for (let k = 0; k < CLASSES.length; k++) sum += score(k);

    c.strokeStyle = gray(0.6);
    c.lineWidth = 1;
    c.beginPath();
    for (let k = 0; k < nCls; k++) for (let j = 0; j < 32; j += 2) { c.moveTo(fcX + 48, 230 + j * 16 + 8); c.lineTo(clsX, rowY(k)); }
    c.stroke();
    for (let k = 0; k < nCls; k++) {
      const p = u > 0 ? score(k) / sum : 0, y = rowY(k), on = k === pred && u > 0;
      rebate(c, CLASSES[k]!.toUpperCase(), clsX, y - 12, 'left', on ? 1 : 0.75);
      c.fillStyle = on ? PAPER : gray(0.6);
      c.fillRect(clsX, y - 2, 12 + p * 170, 10);
      rebate(c, p.toFixed(2), clsX + 190, y + 3, 'left', on ? 1 : 0.7);
      if (bs < 13) continue;
      c.strokeStyle = PAPER;
      c.lineWidth = on ? 4 : 1.4;
      c.beginPath();
      c.moveTo(clsX + 230, y + 3);
      c.bezierCurveTo(clsX + 420, y + 3, outX - S / 2 - 220, outY, outX - S / 2, outY);
      c.stroke();
    }
  }

  ensureSnap() {
    if (this.snapBuilt) return;
    this.snap.width = Math.round(W * SCALE);
    this.snap.height = Math.round(H * SCALE);
    this.sc = this.snap.getContext('2d')!;
    this.sc.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    this.sc.clearRect(0, 0, W, H);
    this.frame(this.sc, this.end, false, 0);
    this.snapBuilt = true;
  }

  drawShards(c: CanvasRenderingContext2D, t: number) {
    this.ensureSnap();
    // Frame 4616 (cut) starts already a bit into the shattering so it explodes immediately
    const a = Math.max(0, stepT(t, 30) - this.end + 0.085);
    for (const s of SHARDS) {
      if (!shardOn(s, a)) continue;
      c.save();
      shardPath(c, s, a);
      c.save();
      c.clip();
      const isFlashed = hashI(s.id, 99, 41) < 0.30;
      if (isFlashed) {
        const isBlue = hashI(s.id, 99, 53) < 0.45;
        c.fillStyle = isBlue ? BLUE : PAPER;
        c.fill();
      } else {
        c.drawImage(this.snap, 0, 0, W, H);
      }
      c.restore();
      // Only stroke internal crack edges; never stroke the outer screen edges!
      traceCrackEdges(c, s);
      c.strokeStyle = BLUE;
      c.lineWidth = 5;
      c.stroke();
      c.strokeStyle = PAPER;
      c.lineWidth = 1.5;
      c.stroke();
      c.restore();
    }
  }

  draw(c: CanvasRenderingContext2D, t: number): PrintOpts {
    const tc = stepT(t, 12);
    const cam = this.camAt((tc - this.start) / 1.2);
    const view = { x: cam * 0.35, y: 0 };
    this.frame(c, t, true);
    return { plane: 0.45, view };
  }
}
