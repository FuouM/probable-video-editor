// Plate 7 · Tiny: the chatter around the post (set dressing, rule 6). On each hat a set of replies pops in around
// the post one by one (a speech bubble, a size up, then in place, held, gone): handles, hashtags, w, kaomoji and
// shreds of the song's own lines. On each snare a repost toast slides in from the edge of the frame. They never
// cover the post. All in 24 fps steps.
import { H, W } from '@pve/engine/gl';
import { hash } from '@pve/engine/util';
import { fnt, INK, PAPER, RED, SANS } from './_page';
import { age, USERS } from './tiny-post';

/** A drum hit that sets off chatter: `n` items, one per step. */
export interface Burst { t: number; kind: 'hat' | 'snare'; n: number }
/** A frame rect the chatter keeps clear of. */
export type Rect = [number, number, number, number];

/** Replies: Latin dressing, and shreds of the lyrics (glyphs the subset font has). `red`: the god. */
const CHATTER: { s: string; red?: true }[] = [
  { s: 'wwww' }, { s: 'lol' }, { s: '+1' }, { s: 'RT' }, { s: '!!' }, { s: '(^o^)' }, { s: '(*_*)' }, { s: 'w' },
  { s: '#kamippoi' }, { s: '#repost' }, { s: '#screenshot' }, { s: '#nemui' },
  { s: 'きっしょ' }, { s: 'それな' }, { s: '逆に' }, { s: 'ファン' }, { s: 'ちっちゃ' }, { s: 'かっけえ' },
  { s: '神っぽい', red: true },
];
const HOLD = { hat: 12, snare: 14 };

/** The chatter of `bursts` at t around the clear rect `r`. */
export function chatter(c: CanvasRenderingContext2D, t: number, bursts: Burst[], r: Rect) {
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  for (const b of bursts) {
    if (b.t > t) break;
    const a0 = age(t, b.t);
    if (a0 > b.n + HOLD[b.kind] + 2) continue;
    for (let j = 0; j < b.n; j++) {
      const a = a0 - j;
      if (a < 0 || a > HOLD[b.kind] + 1) continue;
      if (b.kind === 'hat') bubble(c, b, j, a, r);
      else toast(c, b, j, a, r);
    }
  }
  c.textBaseline = 'alphabetic';
}

/** x, y for an item w x h beside the clear rect: left or right of it, or above or under it; null: no room. */
function spot(b: Burst, j: number, w: number, h: number, r: Rect): [number, number] | null {
  const m = 36;
  const zones: Rect[] = [
    [m, m, r[0] - m, H - 70], [r[2] + m, m, W - m, H - 70], [m, m, W - m, r[1] - m], [m, r[3] + m, W - m, H - 70],
  ].filter((z) => z[2] - z[0] >= w && z[3] - z[1] >= h) as Rect[];
  if (!zones.length) return null;
  const z = zones[Math.floor(hash(b.t, j, 31) * zones.length)]!;
  return [z[0] + hash(b.t, j, 32) * (z[2] - z[0] - w), z[1] + hash(b.t, j, 33) * (z[3] - z[1] - h)];
}

/** A reply bubble: a size up on its step, in place, held, then it shrinks away. */
function bubble(c: CanvasRenderingContext2D, b: Burst, j: number, a: number, r: Rect) {
  const it = CHATTER[Math.floor(hash(b.t, j, 30) * CHATTER.length)]!;
  const px = Math.round(36 + hash(b.t, j, 34) * 34);
  c.font = fnt(SANS, px, 700);
  const tw = c.measureText(it.s).width;
  const w = tw + px * 0.9, h = px * 1.5;
  const at = spot(b, j, w, h + 16, r);
  if (!at) return;
  const s = a === 0 ? 1.35 : a === 1 ? 0.94 : a === HOLD.hat ? 0.7 : a > HOLD.hat ? 0.35 : 1;
  const [x, y] = at;
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.scale(s, s);
  c.translate(-w / 2, -h / 2);
  const left = hash(b.t, j, 35) < 0.5;
  c.fillStyle = a === 0 ? INK : PAPER;
  c.strokeStyle = INK;
  c.lineWidth = 4;
  c.beginPath();
  c.roundRect(0, 0, w, h, h / 2);
  const tx = left ? h * 0.6 : w - h * 0.6;
  c.moveTo(tx - 10, h - 1);
  c.lineTo(tx + (left ? -14 : 14), h + 16);
  c.lineTo(tx + 12, h - 1);
  c.fill();
  c.stroke();
  c.fillStyle = a === 0 ? PAPER : it.red ? RED : INK;
  c.fillText(it.s, px * 0.45, h / 2 + 2);
  c.restore();
}

/** A repost toast: an ink pill with the arrows and `@handle reposted`; it slides in from the frame's edge. */
function toast(c: CanvasRenderingContext2D, b: Burst, j: number, a: number, r: Rect) {
  const u = USERS[Math.floor(hash(b.t, j, 40) * (USERS.length - 1))]!;
  const s = `@${u.h} reposted`;
  c.font = fnt(SANS, 28, 700);
  const w = c.measureText(s).width + 92, h = 56;
  const at = spot(b, j + 7, w, h, r);
  if (!at) return;
  let [x, y] = at;
  const fromLeft = x + w / 2 < W / 2;
  const slide = a === 0 ? 0.7 : a === 1 ? 0.18 : a === 2 ? -0.04 : a >= HOLD.snare ? 1.2 : 0;
  x += (fromLeft ? -1 : 1) * slide * (fromLeft ? x + w : W - x);
  y = Math.round(y);
  c.fillStyle = INK;
  c.beginPath();
  c.roundRect(x, y, w, h, h / 2);
  c.fill();
  // the arrows, in paper
  c.strokeStyle = PAPER;
  c.lineWidth = 3;
  const ix = x + 38, iy = y + h / 2;
  c.beginPath();
  c.moveTo(ix - 12, iy + 4);
  c.lineTo(ix - 12, iy - 7);
  c.lineTo(ix + 8, iy - 7);
  c.moveTo(ix + 12, iy - 4);
  c.lineTo(ix + 12, iy + 7);
  c.lineTo(ix - 8, iy + 7);
  c.moveTo(ix + 4, iy - 12);
  c.lineTo(ix + 9, iy - 7);
  c.lineTo(ix + 4, iy - 2);
  c.moveTo(ix - 4, iy + 2);
  c.lineTo(ix - 9, iy + 7);
  c.lineTo(ix - 4, iy + 12);
  c.stroke();
  c.fillStyle = PAPER;
  c.fillText(s, x + 70, iy + 1);
}
