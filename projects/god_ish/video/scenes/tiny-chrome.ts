// Plate 7 · Tiny: the timeline around the post (set dressing, rule 6): the nav, the feed header, the compose
// box, the posts below, search, trends, who to follow. Each piece is one element; on lines 45-47 they go one by
// one, the outermost first, until only the post is left (tiny.ts knocks them off the frame). The notification
// badge counts the hats and pops on each.
import { H } from '@pve/engine/gl';
import { fnt, INK, PAPER, RED, SANS, seal, tone } from './_page';
import { avatar, PW } from './tiny-post';

/** One piece of the chrome. `below`: the y under the post (for the feed posts under it). */
export interface El {
  cx: number;
  cy: number;
  draw(c: CanvasRenderingContext2D, below: number, t: number): void;
}

/** The notification badge at t: its count and the 24 fps steps since it last changed. */
export type Badge = (t: number) => [number, number];

export const NAV_X = 150;
export const COL_X = 500;
export const COL_R = COL_X + PW;
const RIGHT_X = 1440, RIGHT_W = 400;
/** The post starts under the compose box. */
export const FEED_TOP = 236;

function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, px: number, weight: number, v: number | string) {
  c.font = fnt(SANS, px, weight);
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.fillStyle = typeof v === 'string' ? v : tone(v);
  c.fillText(s, x, y);
}

function pill(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, label: string, px: number, ink: string) {
  c.fillStyle = fill;
  c.beginPath();
  c.roundRect(x, y, w, h, h / 2);
  c.fill();
  c.font = fnt(SANS, px, 700);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = ink;
  c.fillText(label, x + w / 2, y + h / 2 + 1);
}

function bar(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number) {
  c.fillStyle = tone(v);
  c.beginPath();
  c.roundRect(x, y, w, h, h / 2);
  c.fill();
}

/** A panel of the right column: a light card with small corners. */
function card(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number) {
  c.fillStyle = tone(v);
  c.beginPath();
  c.roundRect(x, y, w, h, 20);
  c.fill();
}

const NAV = ['Home', 'Explore', 'Notifications', 'Messages', 'Bookmarks', 'Communities', 'Profile', 'More'];
const TRENDS: [string, string][] = [
  ['#kamippoi', '48.2K posts'], ['#repost', '12.9K posts'], ['#screenshot', '9,114 posts'],
  ['#nemui', '3,870 posts'], ['#beam', '1,206 posts'],
];
const FOLLOW: [number, string, string][] = [[3, 'nemui', '@nemui.exe'], [1, 'okee', '@okee_minna'], [4, 'chicchai', '@chicchai_']];

export function chrome(badge: Badge): El[] {
  const els: El[] = [];
  // backgrounds first, so the pieces on them draw on top
  els.push({ cx: RIGHT_X + RIGHT_W / 2, cy: 390, draw: (c) => card(c, RIGHT_X, 116, RIGHT_W, 548, 0.96) });
  els.push({ cx: RIGHT_X + RIGHT_W / 2, cy: 840, draw: (c) => card(c, RIGHT_X, 690, RIGHT_W, 330, 0.96) });
  els.push({
    cx: COL_X + PW / 2, cy: H / 2,
    draw: (c) => {
      c.fillStyle = tone(0.88);
      c.fillRect(COL_X - 2, 0, 2, H);
      c.fillRect(COL_R, 0, 2, H);
    },
  });
  // nav
  els.push({ cx: NAV_X + 40, cy: 64, draw: (c) => seal(c, NAV_X + 34, 64, 34, 'ink', SANS) });
  NAV.forEach((s, k) => {
    const y = 150 + k * 70;
    els.push({
      cx: NAV_X + 120, cy: y,
      draw: (c, _below, t) => {
        c.strokeStyle = INK;
        c.lineWidth = 3;
        c.beginPath();
        if (k % 3 === 0) c.roundRect(NAV_X + 18, y - 15, 30, 30, 6);
        else if (k % 3 === 1) c.arc(NAV_X + 33, y, 15, 0, Math.PI * 2);
        else { c.moveTo(NAV_X + 33, y - 17); c.lineTo(NAV_X + 50, y + 14); c.lineTo(NAV_X + 16, y + 14); c.closePath(); }
        c.stroke();
        text(c, s, NAV_X + 70, y + 1, 30, k === 0 ? 700 : 400, INK);
        if (k === 2) {
          const [n, a] = badge(t);
          const s = a === 0 ? 1.7 : a === 1 ? 1.3 : 1;
          const w = n > 9 ? 40 : 30;
          const bx = NAV_X + 38 + w / 2, by = y - 15;
          c.save();
          c.translate(bx, by);
          c.scale(s, s);
          pill(c, -w / 2, -15, w, 30, RED, String(n), 20, PAPER);
          c.restore();
        }
      },
    });
  });
  els.push({ cx: NAV_X + 150, cy: 732, draw: (c) => pill(c, NAV_X, 700, 300, 64, INK, 'Post', 30, PAPER) });
  els.push({
    cx: NAV_X + 120, cy: 1000,
    draw: (c) => {
      avatar(c, 2, NAV_X + 30, 1000, 28);
      text(c, 'you', NAV_X + 72, 986, 26, 700, INK);
      text(c, '@you', NAV_X + 72, 1016, 24, 400, 0.45);
    },
  });
  // the feed: header, tabs, compose, the posts under the post
  els.push({ cx: COL_X + 90, cy: 44, draw: (c) => text(c, 'Home', COL_X + 28, 44, 34, 700, INK) });
  els.push({
    cx: COL_X + PW / 2, cy: 100,
    draw: (c) => {
      text(c, 'For you', COL_X + 150, 98, 28, 700, INK);
      text(c, 'Following', COL_X + PW / 2 + 150, 98, 28, 400, 0.45);
      c.fillStyle = INK;
      c.fillRect(COL_X + 150, 118, 100, 5);
      c.fillStyle = tone(0.88);
      c.fillRect(COL_X, 124, PW, 2);
    },
  });
  els.push({
    cx: COL_X + PW / 2, cy: 178,
    draw: (c) => {
      avatar(c, 2, COL_X + 58, 178, 30);
      text(c, 'What is happening?!', COL_X + 108, 178, 32, 400, 0.5);
      pill(c, COL_R - 150, 152, 122, 52, tone(0.6), 'Post', 26, PAPER);
      c.fillStyle = tone(0.88);
      c.fillRect(COL_X, 228, PW, 2);
    },
  });
  for (let k = 0; k < 3; k++) {
    els.push({
      cx: COL_X + PW / 2, cy: 900 + k * 190,
      draw: (c, below) => {
        const y = below + k * 190;
        c.fillStyle = tone(0.88);
        c.fillRect(COL_X, y, PW, 2);
        c.fillStyle = tone(0.82);
        c.beginPath();
        c.arc(COL_X + 58, y + 58, 30, 0, Math.PI * 2);
        c.fill();
        bar(c, COL_X + 108, y + 36, 180 + k * 40, 22, 0.82);
        bar(c, COL_X + 108, y + 80, PW - 160 - k * 70, 30, 0.9);
        bar(c, COL_X + 108, y + 124, PW - 320 + k * 50, 30, 0.9);
      },
    });
  }
  // the right column
  els.push({ cx: RIGHT_X + RIGHT_W / 2, cy: 54, draw: (c) => { bar(c, RIGHT_X, 24, RIGHT_W, 60, 0.93); text(c, 'Search', RIGHT_X + 60, 55, 28, 400, 0.5); } });
  els.push({ cx: RIGHT_X + 150, cy: 156, draw: (c) => text(c, "What's happening", RIGHT_X + 24, 156, 30, 700, INK) });
  TRENDS.forEach(([s, n], k) => {
    const y = 214 + k * 88;
    els.push({
      cx: RIGHT_X + RIGHT_W / 2, cy: y + 20,
      draw: (c) => {
        text(c, 'Trending in Japan', RIGHT_X + 24, y, 22, 400, 0.45);
        text(c, s, RIGHT_X + 24, y + 30, 28, 700, INK);
        text(c, n, RIGHT_X + 24, y + 60, 22, 400, 0.45);
      },
    });
  });
  els.push({ cx: RIGHT_X + 120, cy: 730, draw: (c) => text(c, 'Who to follow', RIGHT_X + 24, 730, 30, 700, INK) });
  FOLLOW.forEach(([u, name, h], k) => {
    const y = 806 + k * 80;
    els.push({
      cx: RIGHT_X + RIGHT_W / 2, cy: y,
      draw: (c) => {
        avatar(c, u, RIGHT_X + 52, y, 28);
        text(c, name, RIGHT_X + 94, y - 14, 26, 700, INK);
        text(c, h, RIGHT_X + 94, y + 16, 22, 400, 0.45);
        pill(c, RIGHT_X + RIGHT_W - 130, y - 24, 108, 48, INK, 'Follow', 22, PAPER);
      },
    });
  });
  return els;
}
