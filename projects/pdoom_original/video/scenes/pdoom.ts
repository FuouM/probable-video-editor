// The P(doom) estimate of this video: each sung "P(doom)" raises it. The plates stage it inside their
// world (drawReadout, formatPDoom); the overlay (hud.ts) can show it in the corner.
import type { Lyrics } from '@pve/engine/lyrics';
import { rgba } from '@pve/engine/palette';
import { F, font } from '@pve/engine/type';
import { clamp, ease, noise1, prog, smoothstep } from '@pve/engine/util';

/** P(doom) steps: each sung "P(doom)" raises the estimate. */
export class PDoom {
  steps: { t: number; v: number }[] = [];
  constructor(lyrics: Lyrics) {
    const hits = lyrics.findWords('P(doom)').map((w) => w.start + 0.06);
    const vals = [0.15, 0.42, 0.81, 0.99];
    this.steps = [{ t: -1, v: 0.02 }, ...hits.map((t, i) => ({ t, v: vals[i] ?? 0.99 }))];
  }
  /** Value at t with the roll animation of each step (~0.9 s) and slow drift between steps. */
  value(t: number): number {
    let i = 0;
    while (i + 1 < this.steps.length && this.steps[i + 1]!.t <= t) i++;
    const cur = this.steps[i]!, prev = this.steps[Math.max(0, i - 1)]!;
    const k = i === 0 ? 1 : prog(t, cur.t, cur.t + 0.9, ease.outExpo);
    const base = prev.v + (cur.v - prev.v) * k;
    const next = this.steps[i + 1];
    // slow creep toward the next value (never more than 20% of the gap)
    const creep = next ? (next.v - cur.v) * 0.2 * smoothstep(cur.t + 1, next.t, t) : 0;
    const jitter = noise1(t * 3.1, 7) * 0.004 * (1 - k * 0.5);
    return clamp(base + creep + jitter, 0, 1);
  }
  /** 0..1 flash envelope right after a step. */
  flash(t: number): number {
    let f = 0;
    for (const s of this.steps) if (t >= s.t && s.t > 0) f = Math.max(f, Math.pow(0.5, (t - s.t) / 0.35));
    return f;
  }
  lastStep(t: number) { let s = this.steps[0]!; for (const x of this.steps) if (x.t <= t) s = x; return s; }
}

/** Canonical text format of a P(doom) value ('0.15', '0.991'). */
export const formatPDoom = (v: number) => v.toFixed(v >= 0.99 ? 3 : 2);

/**
 * Draw the P(doom) instrument (label, digits, tick bar) anywhere, at any scale, into a
 * Canvas2D context — for plates that stage the readout inside their world.
 * (x, y) = left end of the digits' baseline; the label sits above, the bar below.
 */
export function drawReadout(c: CanvasRenderingContext2D, x: number, y: number, v: number, o: { scale?: number; text?: string; digits?: string; label?: string; bar?: boolean } = {}) {
  const k = o.scale ?? 1;
  c.save();
  c.textBaseline = 'alphabetic';
  c.font = font(F.mono(500), 13 * k);
  c.letterSpacing = `${3 * k}px`;
  c.fillStyle = o.label ?? rgba('bone', 0.6);
  c.fillText('P(DOOM)', x, y - 44 * k);
  c.letterSpacing = '0px';
  c.font = font(F.mono(400), 40 * k);
  c.fillStyle = o.digits ?? rgba('bone', 0.92);
  c.fillText(o.text ?? formatPDoom(v), x - 2 * k, y);
  if (o.bar !== false) {
    const bw = 220 * k, by = y + 16 * k;
    c.fillStyle = rgba('bone', 0.18);
    c.fillRect(x, by, bw, Math.max(1, k));
    for (let i = 0; i <= 10; i++) c.fillRect(x + (bw * i) / 10, by - (i % 5 === 0 ? 5 : 3) * k, Math.max(1, k), (i % 5 === 0 ? 5 : 3) * k);
    c.fillStyle = rgba('signal', 1);
    c.fillRect(x, by - k, bw * clamp(v), 3 * k);
  }
  c.restore();
}
