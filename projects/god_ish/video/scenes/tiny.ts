// Plate 7 · Tiny (screen, repost). A light social timeline. Each sung line (45-50) is a post; its text fills unit
// by unit on the onsets, the EN gloss smaller under it. Each new line is a quote-repost of the post before: the
// earlier post sits one level deeper inside the new one, as a screenshot of a screenshot (tiny-post.ts), and the
// whole frame is a real JPEG re-save (SurfaceOpts.jpeg) one quality step lower at each line. Lines 45-47: the
// reverse of plate 2, the chrome goes one piece per syllable, the outermost first, until only the post is left.
// Lines 48-49: 器 shrinks one step per syllable, and the nest takes it one level smaller again, to a few px.
// Line 50: one post alone on the empty frame, nothing quoted, nothing counted.
//
// Motion (v4), in 24 fps steps:
// - Voice: each glyph strikes in selected (tiny-post.ts) with a caret after it. A new line is a quote-repost:
//   three steps before it the screenshot is taken (crop brackets close on the post, the phone's status bar drops
//   on it, it shrinks pixelated toward its card); on the onset the card pops in (too small, too large, in place)
//   and the feed jolts down and settles (an inertial scroll). Line 48 glides the post to the middle and pushes in.
//   器 slams in, then on each syllable it steps smaller with an overshoot; brackets and its true px follow it.
// - Chrome (45-47): each piece that goes is plucked up and falls off the frame, turning.
// - Kick: the like heart bursts (red dots), the like count jumps. Snare: the repost arrows turn, the count jumps,
//   a repost toast slides in. Hat: a set of replies pops around the post one by one; the badge counts up.
// - Line 50 drops all of it: the nest of 49 scrolls up and away, the lone post stays. On its kicks it only tugs
//   (pull to refresh, a spinner) and nothing new comes. After 143 s the drums stop and it stands still.
import type { Frame } from '@pve/engine/scene';
import { H, W } from '@pve/engine/gl';
import { lineNo, syllables, units } from '@pve/engine/lyrics';
import { font } from '@pve/engine/type';
import { hash, stepN } from '@pve/engine/util';
import { copyTimes, genAt, INK, MONO, PageScene, PAPER, tone, type SurfaceOpts } from './_page';
import { SCREEN } from './_era_screen';
import { chrome, COL_X, FEED_TOP, type El } from './tiny-chrome';
import { chatter, type Burst, type Rect } from './tiny-pops';
import { age, CARD_X, type Hit, type Post, Posts, PW, QW, SB, statusBar } from './tiny-post';

const FIRST = 45, LAST = 50;
/** Dressing per post (lines 45-49) when it goes up: reply, repost, like, views. Line 50: nothing counted. */
const BASE: [number, number, number, number][] = [
  [3, 12, 41, 1100], [9, 88, 230, 6400], [31, 402, 1900, 41000], [77, 1600, 8800, 210000], [140, 5200, 27000, 1.2e6],
];
/** JPEG quality of the frame at each post, one save lower per repost; later posts save twice. */
const QUALITY = [34, 26, 20, 15, 11, 8];
/** 器: px when it is sung, and the step on every syllable after it (to about 4 px on the screen at the end of 49). */
const KI0 = 240, KI_STEP = 0.74;
/** Lines 48-49: the camera pushes in on the post (fit to the frame). */
const ZOOM = 1.22;
/** The feed on a new post: down, back, settle (px per step). */
const JOLT = [44, -18, 7];
/** Line 48: the glide to the middle of the frame. */
const GLIDE = [0.45, 0.78, 0.94];
/** Steps before a quote-repost in which the screenshot is taken. */
const PRE = 3;
/** Steps a chrome piece falls. */
const FALL = 14;
/** Hat replies per burst and snare toasts, by line 45..49. */
const HAT_N = [3, 4, 6, 5, 5];
const SNARE_N = [1, 1, 2, 1, 1];
/** The middle of the post column. */
const MID = COL_X + PW / 2;
/** The fade to red: from bar 80.1 to the cut into gott2 (s). */
const FADE = [144.62, 146.3] as const;

interface Place { x: number; y: number; z: number; h: number }

export default class Tiny extends PageScene {
  private posts!: Posts;
  private copies: number[] = [];
  private els: El[] = [];
  /** When each chrome element goes (same order as els). */
  private gone: number[] = [];
  private kiStart = Infinity;
  private kiSteps: number[] = [];
  /** End of each post's life: the start of the next (Infinity for the last). */
  private ends: number[] = [];
  private kicks: number[] = [];
  private snares: number[] = [];
  private hats: number[] = [];
  private bursts: Burst[] = [];

  override async init() {
    await super.init();
    this.warm([SCREEN], true);
    const L = this.ctx.lyrics;
    const sung = (i: number) => {
      const line = lineNo(L, i);
      const ghosts = line.written!.ghosts;
      return syllables(line).filter((_, k) => !ghosts.includes(k)).map((s) => s.start);
    };
    const list: Post[] = [];
    for (let i = FIRST; i <= LAST; i++) {
      const line = lineNo(L, i);
      const all = units(line);
      const ki = i === 48 ? all.find((u) => u.glyph === '器')! : null;
      const k = i - FIRST;
      list.push({
        user: k, line, us: all.filter((u) => u !== ki), gloss: line.written!.phrases, start: all[0]!.start,
        quote: k > 0 && i < LAST ? k - 1 : -1, ki, liked: i < LAST,
      });
    }
    this.ends = list.map((_, k) => list[k + 1]?.start ?? Infinity);
    const ki = list[48 - FIRST]!.ki!;
    this.kiStart = ki.start;
    this.kiSteps = [...sung(48), ...sung(49)].filter((s) => s > ki.start);
    this.copies = copyTimes(L);

    const au = this.ctx.audio;
    const ev = (kind: string) => au.events(kind, this.ctx.start - 1, this.ctx.end + 1).map(([t]) => t);
    this.kicks = ev('kick');
    this.snares = ev('snare');
    this.hats = ev('hat');
    // the chatter: every hat and snare until line 50 (nobody answers it)
    const quiet = list[LAST - FIRST]!.start;
    const lineOf = (t: number) => Math.max(0, list.findLastIndex((p) => p.start <= t));
    this.bursts = [
      ...this.hats.filter((t) => t < quiet).map((t): Burst => ({ t, kind: 'hat', n: HAT_N[lineOf(t)]! })),
      ...this.snares.filter((t) => t < quiet).map((t): Burst => ({ t, kind: 'snare', n: SNARE_N[lineOf(t)]! })),
    ].sort((a, b) => a.t - b.t);

    this.posts = new Posts(list, {
      kiPx: (t) => KI0 * Math.pow(KI_STEP, this.kiSteps.filter((s) => s <= t).length),
      kiScale: (t) => this.kiScale(t),
      tally: (k, t) => this.tally(k, t),
      hit: (k, t, kind) => this.hit(k, t, kind),
    });

    // the chrome empties on the onsets of 45-47, the piece farthest from the post first
    this.els = chrome((t) => {
      const i = this.lastOf(this.hats, t);
      const n = this.hats.filter((h) => h >= this.ctx.start - 0.1 && h <= t).length;
      return [9 + n, i >= 0 ? age(t, this.hats[i]!) : 99];
    });
    const on = [...sung(45), ...sung(46), ...sung(47)].sort((a, b) => a - b);
    const fx = MID, fy = 500;
    const order = this.els.map((_, j) => j)
      .sort((a, b) => Math.hypot(this.els[b]!.cx - fx, this.els[b]!.cy - fy) - Math.hypot(this.els[a]!.cx - fx, this.els[a]!.cy - fy));
    this.gone = new Array<number>(this.els.length);
    order.forEach((j, r) => {
      this.gone[j] = on[Math.min(on.length - 1, Math.floor(((r + 1) * on.length) / this.els.length) - 1)]!;
    });
  }

  /** Index of the last time in sorted `ts` at or before t, -1 before the first. */
  private lastOf(ts: number[], t: number): number {
    let i = -1;
    for (let j = 0; j < ts.length && ts[j]! <= t; j++) i = j;
    return i;
  }

  /** 器: the slam on its onset (a size up), then on each step down an overshoot (too small, then a little large). */
  private kiScale(t: number): number {
    if (t < this.kiStart) return 1;
    const i = this.lastOf(this.kiSteps, t);
    if (i < 0) {
      const a = age(t, this.kiStart);
      return a === 0 ? 1.3 : a === 1 ? 1.1 : 1;
    }
    const a = age(t, this.kiSteps[i]!);
    return a === 0 ? 0.8 : a === 1 ? 1.06 : 1;
  }

  /** The drum hits that fall in post k's own life up to t. */
  private within(ts: number[], k: number, t: number): number[] {
    const p = this.posts.posts[k]!;
    const tt = Math.min(t, this.ends[k]!);
    return ts.filter((e) => e >= p.start - 0.06 && e <= tt);
  }

  /** The counts of post k at t: they go up with its drums while it is live, then stand (the screenshot). */
  private tally(k: number, t: number): [number, number, number, number] | null {
    const b = BASE[k];
    if (!b) return null;
    const p = this.posts.posts[k]!;
    const tt = Math.min(t, this.ends[k]!);
    const nh = this.within(this.hats, k, t).length;
    const ns = this.within(this.snares, k, t).length;
    const nk = this.within(this.kicks, k, t).length;
    const steps = Math.max(0, stepN(tt, 12) - stepN(p.start, 12));
    return [
      b[0] + nh * Math.max(1, Math.round(b[0] * 0.25)),
      b[1] + ns * Math.max(1, Math.round(b[1] * 0.15)),
      b[2] + nk * Math.max(3, Math.round(b[2] * 0.2)),
      b[3] * (1 + 0.025 * steps),
    ];
  }

  private hit(k: number, t: number, kind: Hit): number {
    if (!BASE[k]) return 99;
    const hs = this.within(kind === 'kick' ? this.kicks : kind === 'snare' ? this.snares : this.hats, k, t);
    return hs.length ? age(t, hs[hs.length - 1]!) : 99;
  }

  /** Where post k stands at t: the left edge, top, scale and height (unscaled). */
  private place(c: CanvasRenderingContext2D, k: number, t: number): Place {
    const p = this.posts.posts[k]!;
    const h = this.posts.height(c, k, t);
    const i = k + FIRST;
    let z = 1, y: number;
    if (i <= 47) y = FEED_TOP;
    else if (i <= 49) {
      z = Math.min(ZOOM, (H - 110) / h);
      y = Math.max(40, (H - z * h) / 2);
    } else y = Math.max(40, (H - h) / 2);
    const a = age(t, p.start);
    if (k > 0 && i < LAST && a >= 0 && a < JOLT.length) y += JOLT[a]!;
    if (i === 48 && a >= 0 && a < GLIDE.length) {
      const o = this.place(c, k - 1, p.start - 1e-3);
      const e = GLIDE[a]!;
      z = o.z + (z - o.z) * e;
      y = o.y + (y - o.y) * e;
    }
    return { x: MID - (z * PW) / 2, y, z, h };
  }

  draw(c: CanvasRenderingContext2D, f: Frame): SurfaceOpts {
    const t = f.t;
    const L = this.ctx.lyrics;
    const gen = genAt(this.copies, L, t);
    const ps = this.posts.posts;
    let k = 0;
    for (let j = 0; j < ps.length; j++) if (ps[j]!.start <= t) k = j;
    const i = k + FIRST;

    const fade = Math.min(1, Math.max(0, (t - FADE[0]) / (FADE[1] - FADE[0])));
    const bgAlpha = Math.max(0, 1.0 - fade * fade);
    c.clearRect(0, 0, W, H);
    if (bgAlpha > 0) {
      c.fillStyle = bgAlpha >= 1 ? PAPER : `rgba(255, 255, 255, ${bgAlpha})`;
      c.fillRect(0, 0, W, H);
    }
    const P = this.place(c, k, t);
    // line 50: on its kicks the lone post only tugs (pull to refresh) and nothing comes
    let pull = 99;
    if (i === LAST) {
      const ks = this.kicks.filter((e) => e >= ps[k]!.start && e <= t);
      if (ks.length) pull = age(t, ks[ks.length - 1]!);
      if (pull < 3) P.y += [22, 12, 4][pull]!;
    }
    const rect: Rect = [P.x, P.y, P.x + PW * P.z, P.y + P.h * P.z];

    // the chrome: in place until its onset, then plucked up and falling off the frame
    this.els.forEach((e, j) => {
      const g = this.gone[j]!;
      if (t < g) {
        e.draw(c, rect[3], t);
        return;
      }
      const a = age(t, g);
      if (a >= FALL) return;
      const s = a / 24;
      const dy = a === 0 ? -16 : 2600 * s * s;
      const dx = (hash(j, 7) - 0.5) * 520 * s;
      const rot = (hash(j, 8) - 0.5) * 2.2 * s;
      c.save();
      c.translate(e.cx + dx, e.cy + dy);
      c.rotate(rot);
      c.translate(-e.cx, -e.cy);
      e.draw(c, rect[3], g - 1e-3);
      c.restore();
    });

    // line 50: the nest of 49 scrolls up and away
    if (i === LAST) {
      const a = age(t, ps[k]!.start);
      if (a < 5) {
        const at = ps[k]!.start - 1e-3;
        const o = this.place(c, k - 1, at);
        const up = [0.1, 0.32, 0.66, 1.1, 1.6][a]! * H;
        this.posts.drawPost(c, k - 1, at, o.x, o.y - up, o.z);
      }
    }

    // the screenshot before a quote-repost: brackets close on the post, the status bar drops, it shrinks
    const n = k + 1;
    const pre = n < ps.length && ps[n]!.quote >= 0 ? age(t, ps[n]!.start) : 0;
    if (pre >= -PRE && pre < 0) {
      if (pre === -1) {
        const ts = ps[n]!.start + 1e-4;
        const Q = this.place(c, n, ts);
        this.posts.height(c, n, ts);
        const s1 = (Q.z * QW) / PW;
        const x1 = Q.x + Q.z * CARD_X, y1 = Q.y + Q.z * this.posts.cardY;
        const x0 = P.x, y0 = P.y - SB * P.z, s0 = P.z;
        const e = 0.55;
        this.posts.screenshot(c, k, t, ps[n]!.start, x0 + (x1 - x0) * e, y0 + (y1 - y0) * e, s0 + (s1 - s0) * e);
      } else {
        this.post(c, k, t, P);
        if (pre === -2) {
          c.save();
          c.translate(P.x, P.y - SB * P.z);
          c.scale(P.z, P.z);
          statusBar(c, ps[n]!.start);
          c.restore();
        }
        const o = pre === -3 ? 26 : 6;
        brackets(c, rect[0] - o, rect[1] - o - (pre === -2 ? SB * P.z : 0), rect[2] + o, rect[3] + o, 64, 10);
      }
    } else this.post(c, k, t, P);

    // 器: brackets and its true size on the screen
    if (i === 48 || i === 49) this.kiMark(c, k, t, P);

    // line 50: the refresh spinner
    if (i === LAST && pull < 8) {
      const cx = MID, cy = P.y - 54;
      c.strokeStyle = tone(0.4);
      c.lineWidth = 6;
      c.beginPath();
      c.arc(cx, cy, 20, pull * 0.9, pull * 0.9 + 4.4);
      c.stroke();
    }

    // the chatter around the post (until line 50)
    chatter(c, t, this.bursts, rect);

    // small true marks: generation, line, depth of the nest, JPEG quality, time
    let depth = 0;
    for (let q = ps[k]!.quote; q >= 0; q = ps[q]!.quote) depth++;
    c.font = font(MONO, 26);
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    c.fillStyle = bgAlpha < 1 ? `rgba(0, 0, 0, ${bgAlpha})` : INK;
    c.fillText(`GEN ${String(gen).padStart(2, '0')} · line ${i} · quote depth ${depth} · JPEG q${QUALITY[k]} · ${t.toFixed(2)} s`, W - 40, H - 30);
    c.textBaseline = 'alphabetic';

    // (the re-save lifts toward the q74 of gott2 so the cut meets the same red)
    const q = Math.round(QUALITY[k]! + (74 - QUALITY[k]!) * fade * fade);
    return { era: SCREEN, gen, p: [0, fade * fade, 0, 0], jpeg: { quality: q, passes: k >= 3 && fade < 0.9 ? 2 : 1, shift: [3, 5] } };
  }

  /** The live post on a paper card at its place. */
  private post(c: CanvasRenderingContext2D, k: number, t: number, P: Place) {
    c.save();
    c.translate(P.x, P.y);
    c.scale(P.z, P.z);
    if (k < LAST - FIRST) {
      c.fillStyle = PAPER;
      c.fillRect(0, 0, PW, P.h);
    }
    this.posts.paint(c, k, t, 0, false, true);
    c.restore();
  }

  /** Brackets close on 器 and its size on the screen stands beside it, true px; it inverts on each step. */
  private kiMark(c: CanvasRenderingContext2D, k: number, t: number, P: Place) {
    if (t < this.kiStart) return;
    const [ox, oy, s] = [P.x, P.y, P.z];
    let b = k + FIRST === 48 ? this.posts.lastKi : null;
    if (k + FIRST === 49) {
      const q = this.posts.kiOf(k - 1);
      const cd = this.posts.lastCard;
      if (q) b = { x: cd.x + q.x * cd.s, y: cd.y + (SB + q.y) * cd.s, w: q.w * cd.s, h: q.h * cd.s };
    }
    if (!b) return;
    const x0 = ox + b.x * s, y0 = oy + b.y * s, w = b.w * s, h = b.h * s;
    const pad = Math.max(6, w * 0.08);
    brackets(c, x0 - pad, y0 - pad, x0 + w + pad, y0 + h + pad, Math.max(12, Math.min(48, w * 0.3)), 5);
    const i = this.lastOf(this.kiSteps, t);
    const fresh = age(t, i >= 0 ? this.kiSteps[i]! : this.kiStart) === 0;
    const label = `器 ${h < 10 ? h.toFixed(1) : Math.round(h)} px`;
    c.font = font(MONO, 30);
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    const lx = x0 + w + pad + 22, ly = y0 + h / 2;
    if (fresh) {
      c.fillStyle = INK;
      c.fillRect(lx - 8, ly - 22, c.measureText(label).width + 16, 44);
    }
    c.fillStyle = fresh ? PAPER : INK;
    c.fillText(label, lx, ly + 1);
    c.textBaseline = 'alphabetic';
  }
}

/** Crop brackets: the four corners of x0, y0 .. x1, y1, arms `len`, `th` thick. */
function brackets(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, len: number, th: number) {
  c.fillStyle = INK;
  for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) {
    c.fillRect(sx > 0 ? x : x - len, sy > 0 ? y : y - th, len, th);
    c.fillRect(sx > 0 ? x : x - th, sy > 0 ? y : y - len, th, len);
  }
}
