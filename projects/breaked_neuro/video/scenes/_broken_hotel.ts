// Hilbert's hotel door grid styled as Dwarf Fortress stone quarters in broken (final chorus).
import { clamp, ease } from '@pve/engine/util';
import { hashI } from './_kit';
import { ACOLS, AROWS, Grid, Tone } from './_ascii';

export function renderHotel(
  g: Grid,
  n: number,
  wall: number,
  appear: number,
  shiftFrac = 1,
) {
  const dw = 16, dh = 10;
  const GLYPHS_ASCII = '0123456789abcdefghijklmnopqrstuvwxyz.:-=+*#%@/\\_!?';
  if (appear > 0.15) {
    for (let r = 0; r < AROWS; r++) for (let q = 0; q < ACOLS; q++) {
      if (q < 14 || q >= 146 || r < 8 || r >= 52) {
        const distEdge = Math.max(
          q < 14 ? (14 - q) / 14 : q >= 146 ? (q - 146) / 14 : 0,
          r < 8 ? (8 - r) / 8 : r >= 52 ? (r - 52) / 8 : 0,
        );
        const thresh = 0.2 + (1 - distEdge) * 0.35 + hashI(q, r, 17) * 0.25;
        if (appear < thresh) continue;
        const h = hashI(q, r, 19);
        const finalCh = h < 0.18 ? '~' : h < 0.45 ? '^' : '.';
        const finalTone = h < 0.12 ? Tone.Hole : Tone.Dim;
        if (appear < thresh + 0.18 && appear < 0.98) {
          const scrambleH = hashI(q, r, Math.floor(appear * 30));
          const scrambleCh = GLYPHS_ASCII[Math.floor(scrambleH * GLYPHS_ASCII.length)]!;
          const scrambleTone = scrambleH < 0.35 ? Tone.Hole : Tone.Dim;
          g.set(q, r, scrambleCh, scrambleTone);
        } else {
          g.set(q, r, finalCh, finalTone);
        }
      }
    }
  }
  for (let rr = 0; rr < 4; rr++) for (let q = 0; q < 8; q++) {
    const distCenter = Math.hypot(q - 3.5, rr - 1.5) / 4.2;
    const rApp = clamp((appear * 1.45) - distCenter * 0.45, 0, 1);
    if (rApp <= 0.05) continue;
    const slideX = Math.round((q - 3.5) * (1 - ease.outBack(rApp)) * 8);
    const slideY = Math.round((rr - 1.5) * (1 - ease.outCubic(rApp)) * 5);
    const room = rr * 8 + q + 1;
    const guest = room - n;
    const x0 = 16 + q * dw + slideX, y0 = 10 + rr * dh + slideY;
    const curW = Math.max(4, Math.round((dw - 2) * rApp));
    const curH = Math.max(3, Math.round((dh - 1) * rApp));
    for (let y = 0; y < curH; y++) for (let x = 0; x < curW; x++) g.set(x0 + x, y0 + y, '.', Tone.None);
    for (let x = 0; x < curW; x++) {
      g.set(x0 + x, y0, '#', Tone.Dim);
      g.set(x0 + x, y0 + curH - 1, '#', Tone.Dim);
    }
    for (let y = 0; y < curH; y++) {
      const isDoor = y === Math.floor(curH / 2);
      g.set(x0, y0 + y, isDoor ? '+' : '#', isDoor ? Tone.Bright : Tone.Dim);
      g.set(x0 + curW - 1, y0 + y, isDoor ? '+' : '#', isDoor ? Tone.Bright : Tone.Dim);
    }
    if (rApp < 0.85) continue;
    g.set(x0 + dw - 5, y0 + 2, '=', Tone.Dim);
    [...String(room)].forEach((ch, k) => g.set(x0 + 2 + k, y0 + 1, ch, Tone.Bright));
    const walkOffset = Math.round((1 - ease.outCubic(shiftFrac)) * -dw * 0.75);
    const who = guest >= 1 ? `@g${guest}` : n > 0 && room === 1 ? '(i)' : '';
    const gx = x0 + 4 + walkOffset;
    [...who].forEach((ch, k) => {
      if (gx + k > x0 && gx + k < x0 + dw - 2) {
        g.set(gx + k, y0 + 4, ch, room === 1 && n > 0 ? Tone.Hole : Tone.Bright);
      }
    });
  }
  for (let r = 0; r < AROWS; r++) for (let q = 0; q < ACOLS; q++) {
    const d = Math.min(q, ACOLS - 1 - q, Math.floor((r * ACOLS) / AROWS / 2.67), Math.floor(((AROWS - 1 - r) * ACOLS) / AROWS / 2.67));
    if (d < wall) g.set(q, r, '#', Tone.Bright);
  }
}
