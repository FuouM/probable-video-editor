// Wall calendar on the right in broken (final chorus): timelapse tear, twisting 3D pages.
import { SCALE, W } from '@pve/engine/gl';
import { clamp, ease } from '@pve/engine/util';
import { INK, Life, PAPER, bricks, hashI, stepT } from './_kit';
import { ACOLS, AH, AROWS, AW, type Ascii } from './_ascii';

export const PAGE = { cols: 38, rows: 24 };

export function drawPage(pc: CanvasRenderingContext2D, day: number, gen: number, life: Life) {
  pc.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  pc.fillStyle = PAPER;
  pc.fillRect(0, 0, PAGE.cols * AW, PAGE.rows * AH);
  pc.strokeStyle = INK;
  pc.lineWidth = 3;
  pc.fillStyle = INK;
  pc.fillRect(0, 0, PAGE.cols * AW, 3 * AH);
  pc.fillStyle = PAPER;
  for (let k = 0; k < 6; k++) pc.fillRect(30 + k * 70, 6, 14, 14);
  pc.fillStyle = INK;
  pc.font = '700 16px monospace';
  pc.textAlign = 'center';
  pc.textBaseline = 'middle';
  for (const b of bricks('day').bricks) pc.fillRect((2 + b.cx * 0.65) * AW, (3.4 + b.cy * 0.16) * AH, b.len * 0.65 * AW - 1, AH * 0.13);
  const num = String(day + 1).padStart(3, '0'), nb = bricks(num), nw = nb.cols * 1.15;
  const nx0 = (PAGE.cols - nw) / 2;
  for (const b of nb.bricks) pc.fillRect((nx0 + b.cx * 1.15) * AW + 1, (6.2 + b.cy * 0.9) * AH + 1, b.len * 1.15 * AW - 2, AH * 0.9 - 2);
  const b = life.at(gen);
  for (let r = 0; r < 5; r++) for (let q = 0; q < PAGE.cols - 4; q++) {
    const alive = b[(18 + r * 3) * ACOLS + 12 + q * 2];
    pc.fillText(alive ? '#' : '.', (2 + q) * AW + AW / 2, (18 + r) * AH + AH / 2);
  }
}

export function renderCalendar(
  c: CanvasRenderingContext2D,
  t: number,
  t0: number,
  tDays: number,
  gen: number,
  life: Life,
  pageCanvas: HTMLCanvasElement,
  pc: CanvasRenderingContext2D,
) {
  const tc = stepT(t, 24);
  const tearsAt = (x: number) => Math.max(0, x < tDays ? (x - t0) * 12 : (tDays - t0) * 12 + (x - tDays) * 24);
  const tearContinuous = tearsAt(tc);
  const tearNow = Math.floor(tearContinuous);
  const day = tearNow;
  const pw = PAGE.cols * AW, ph = PAGE.rows * AH;
  const px = W - pw - 60, py = 96;

  const ringX = px + pw / 2, ringY = py + 14;
  const tearFrac = tearContinuous - day;
  const jitterX = (hashI(day, 1, 11) - 0.5) * 5.5;
  const jitterY = (hashI(day, 2, 13) - 0.5) * 4.5;
  const jitterRot = (hashI(day, 3, 17) - 0.5) * 0.032;
  const ripTug = Math.exp(-tearFrac * 6) * Math.sin(tearFrac * Math.PI * 4);
  const shakeX = jitterX + ripTug * 3.5;
  const shakeY = jitterY + Math.abs(ripTug) * 2.0;
  const shakeRot = jitterRot + ripTug * 0.022;

  drawPage(pc, day, Math.max(0, Math.floor(gen)), life);
  c.save();
  c.translate(ringX, ringY);
  c.rotate(shakeRot);
  c.translate(-ringX + shakeX, -ringY + shakeY);
  c.drawImage(pageCanvas, px, py, pw, ph);
  c.restore();
  const flightPages = 8;
  for (let k = Math.max(0, tearNow - flightPages); k < tearNow; k++) {
    const agePages = tearContinuous - k;
    const u = clamp(agePages / flightPages, 0, 1);
    if (u <= 0 || u >= 1) continue;
    drawPage(pc, k, Math.max(0, Math.floor(gen) - (tearNow - k)), life);
    const move = ease.outQuad(u);
    const fanX = (hashI(k, 14) - 0.3) * 180 * move;
    const fanY = (hashI(k, 15) - 0.5) * 220 * move;
    const bx = px + pw * 0.5 + move * 460 + fanX + shakeX, by = py - move * 340 + fanY + shakeY;
    const baseRot = -move * (0.65 + 0.45 * hashI(k, 9));
    const Strips = 24, sh = ph / Strips;
    for (let s = 0; s < Strips; s++) {
      const v = s / Strips;
      const curl = u * (2.2 + 1.4 * v);
      const twist = baseRot - 0.65 * v * Math.sin(curl);
      const sx = Math.max(0.15, Math.cos(curl * 0.7));
      const ox = Math.sin(curl) * 65 * v, oy = (v * ph) * (1 - 0.4 * u * v);
      c.save();
      c.translate(bx, by);
      c.rotate(twist);
      c.translate(ox, oy);
      c.scale(sx, 1);
      c.drawImage(pageCanvas, 0, s * sh * SCALE, pw * SCALE, (sh + 1.5) * SCALE, -pw * 0.5, 0, pw, sh + 1.5);
      c.restore();
    }
  }
}

function getCalendarChar(cq: number, cr: number, day: number): string {
  if (cr < 3) {
    if (cr === 1 && cq % 6 === 2) return 'O';
    return cr === 1 ? '=' : '#';
  }
  if (cr < 6) {
    if (cq >= 14 && cq < 25) return 'DAY'[Math.floor((cq - 14) / 4)] ?? '#';
    return '.';
  }
  if (cr < 18) {
    const num = String(day + 1).padStart(3, '0');
    if (cq >= 6 && cq < 32) {
      const dIdx = Math.floor((cq - 6) / 9);
      if (dIdx >= 0 && dIdx < 3) return num[dIdx]!;
    }
    return '.';
  }
  return (cq * 7 + cr * 13) % 5 === 0 ? '#' : '.';
}

export function renderCalendarParticles(
  c: CanvasRenderingContext2D,
  t: number,
  tOn: number,
  day: number,
  ascii: Ascii,
  sandstormFn: (q: number, r: number, dt: number) => number,
  dtStorm: number,
) {
  const tau = t - tOn;
  if (tau < 0 || tau > 0.85) return;

  const col0 = 117, row0 = 5;
  const p = tau / 0.85;
  const GLYPHS_ASCII = '0123456789abcdefghijklmnopqrstuvwxyz.:-=+*#%@/\\_!?';
  const stepSeed = Math.floor(t * 24);
  const visited = new Uint8Array(ACOLS * AROWS);

  // Each cell of the calendar pad on the ASCII grid becomes an ASCII particle riding the dustwave
  for (let cr = 0; cr < PAGE.rows; cr++) {
    const r0 = row0 + cr;
    for (let cq = 0; cq < PAGE.cols; cq++) {
      const q0 = col0 + cq;
      const d = sandstormFn(q0, r0, dtStorm);

      // Dustwave wind velocity: 48 cols/s to the right along with turbulent displacement
      const h1 = hashI(cq, cr, 7), h2 = hashI(cq, cr, 9);
      const vx = 48.0 * (1.0 + 0.35 * (d - 0.44)) + (h1 - 0.25) * 16.0;
      const vy = (d - 0.48) * 16.0 + (h2 - 0.5) * 12.0;

      // Immediate initial burst right on downbeat: goes straight into scattered particles
      const burstX = Math.round(1 + (h1 - 0.2) * 5.0 + (1 - cq / PAGE.cols) * 2.0);
      const burstY = Math.round((h2 - 0.5) * 5.0 + (d - 0.48) * 4.0);

      const q = q0 + burstX + Math.round(vx * tau);
      const r = r0 + burstY + Math.round(vy * tau);

      if (q < 0 || q >= ACOLS || r < 0 || r >= AROWS) continue;

      const idx = r * ACOLS + q;
      if (visited[idx] === 1) continue;
      visited[idx] = 1;

      // ASCII identity: goes straight to scrambled particles with dust glyphs, never a static calendar frame
      let ch = getCalendarChar(cq, cr, day);
      const isScrambled = hashI(cq, cr, 13) < 0.45 + p * 0.75;
      if (isScrambled || ch === '.') {
        const chIdx = Math.floor(hashI(q + stepSeed * 3, r, 17) * GLYPHS_ASCII.length);
        ch = GLYPHS_ASCII[chIdx]!;
      }
      const isBright = ch !== '.' && (p < 0.35 || h2 < 0.60);
      ascii.glyph(c, ch, q * AW, r * AH, isBright);
    }
  }
}
