// Plate 7 · Tiny: one post of the timeline and its quote. A quoted post is a screenshot of the post (with the
// phone's status bar on top), set smaller and saved one generation lower in canvas: shrunk to a coarse grid and
// blown up again without smoothing, a little washed out. The quote inside it went through the same before, so
// every level of the nest is one screenshot more.
// Motion (v4), in 24 fps steps, only on the post being sung (`fx`): each glyph strikes in as a selected sort (an
// ink block with the glyph cut out, a size up, then in place) and a caret stands after the newest one; a glyph that
// is sung for 0.9 s or more (け and え of the last かっけえ…) stays selected and is drawn out with the note, wider
// and wavering, and rings down when the voice moves on; the quote
// card pops in on the line's first onset (too small, too large, in place); the counters pop on their drum (like:
// kick, with a burst of red dots; repost: snare, the arrows turn; reply: hat). A screenshot is frozen: its counters
// stand where they were when it was taken.
import type { Line, WrittenPhrase, WrittenUnit } from '@pve/engine/lyrics';
import { font } from '@pve/engine/type';
import { formatTime, stepN } from '@pve/engine/util';
import { fnt, INK, MONO, PAPER, RED, SANS, seal, tone } from './_page';

/** Invented users (set dressing, rule 6). `seal`: the 神 seal is the avatar. */
export const USERS: { name: string; h: string; tone: number; ini: string; seal?: boolean }[] = [
  { name: 'kimo', h: 'kimo.kawa', tone: 0.55, ini: 'K' },
  { name: 'okee', h: 'okee_minna', tone: 0.36, ini: 'O' },
  { name: 'gyaku', h: 'gyaku_fan', tone: 0.8, ini: 'G' },
  { name: 'nemui', h: 'nemui.exe', tone: 0.64, ini: 'N' },
  { name: 'chicchai', h: 'chicchai_', tone: 0.24, ini: 'C' },
  { name: 'kamippoi', h: 'kamippoi', tone: 0, ini: '', seal: true },
];

export interface Post {
  user: number;
  line: Line;
  /** The units set in the text rows (器 of line 48 is set on its own). */
  us: WrittenUnit[];
  gloss: WrittenPhrase[];
  start: number;
  /** Index of the quoted post, -1 for none. */
  quote: number;
  /** Line 48: the 器 unit, set large on its own row and shrinking. */
  ki: WrittenUnit | null;
  liked: boolean;
}

/** A drum that pops one counter: reply on the hat, repost on the snare, like on the kick. */
export type Hit = 'hat' | 'snare' | 'kick';

/** What the scene knows about time: 器, the counts and the drums. */
export interface Hooks {
  /** 器 px at t (the layout). */
  kiPx(t: number): number;
  /** The factor 器 is drawn at: the slam on its onset, the overshoot of each step down. */
  kiScale(t: number): number;
  /** reply, repost, like, views of post k at t (frozen once it is quoted); null: nothing counted. */
  tally(k: number, t: number): [number, number, number, number] | null;
  /** 24 fps steps from the last hit of `kind` while post k is the live post (99: none). */
  hit(k: number, t: number, kind: Hit): number;
}

/** A box in the coordinates of a canvas. */
export interface Box { x: number; y: number; w: number; h: number }

/** Post width (logical px) and its inner measures. */
export const PW = 900;
const PAD = 28, AV = 30;
const CX = PAD + 2 * AV + 20, CR = PW - PAD;
/** The left edge of the text and of the quote card in a post. */
export const CARD_X = CX;
const TEXT_PX = 64, TEXT_ROW = 84;
/** A sustained glyph: from this length (s), by how much it grows wider (a share), how fast, and how many steps it rings. */
const HOLD_MIN = 0.8, HOLD_STRETCH = 0.9, HOLD_K = 1.8, HOLD_RING = 12;
const GLOSS_PX = 28, GLOSS_ROW = 38;
/** The quote card is this share of the post width: each level of the nest is this much smaller. */
export const QW = Math.round(PW * 0.62);
/** Status bar of a screenshot, px at full size. */
export const SB = 40;
/** The grid of one screenshot save, px in the card. */
const BLOCK = 3;
const MAXH = 1600;
const HITS: (Hit | null)[] = ['hat', 'snare', 'kick', null];

/** 24 fps steps from an onset to t. */
export const age = (t: number, at: number) => stepN(t, 24) - stepN(at, 24);

/** A count as a timeline prints it: 41, 1.9K, 27K, 1.2M. */
export function fmt(n: number): string {
  n = Math.floor(n);
  if (n < 1000) return String(n);
  if (n < 1e4) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1e6) return `${Math.floor(n / 1000)}K`;
  return `${(n / 1e6).toFixed(1)}M`;
}

interface Shot { cv: HTMLCanvasElement; small: HTMLCanvasElement; key: string; h: number; ki: Box | null }

export class Posts {
  private shots: Shot[] = [];
  /** 器 as the last paint set it (in the coordinates of its canvas). */
  lastKi: Box | null = null;
  /** The last screenshot set by `paint`: x, y of its top left and its scale (the pop included). */
  lastCard = { x: 0, y: 0, s: 1 };
  /** The y of the quote card in the last paint (relative to the post's top). */
  cardY = 0;

  constructor(public posts: Post[], private h: Hooks) {
    for (let k = 0; k < posts.length; k++) {
      const cv = document.createElement('canvas');
      cv.width = PW;
      cv.height = MAXH;
      const small = document.createElement('canvas');
      small.width = Math.ceil(PW / BLOCK) + 1;
      small.height = Math.ceil((MAXH + SB) / BLOCK) + 1;
      this.shots.push({ cv, small, key: '', h: 0, ki: null });
    }
  }

  private key(k: number, t: number): string {
    const p = this.posts[k]!;
    const us = p.us.filter((u) => u.start <= t);
    const n = us.length;
    const fresh = n ? Math.min(2, age(t, us[n - 1]!.start)) : 0;
    const g = p.gloss.filter((u) => u.start <= t).length;
    const ki = p.ki && p.ki.start <= t ? `${this.h.kiPx(t).toFixed(2)}x${this.h.kiScale(t)}` : '-';
    return `${n}.${fresh}|${g}|${ki}|${this.h.tally(k, t)?.map(fmt).join(',')}|${p.quote >= 0 ? this.key(p.quote, t) : ''}`;
  }

  /** Post k at t on its own canvas (full size, no motion), drawn again only when its state changes. */
  private render(k: number, t: number): Shot {
    const s = this.shots[k]!;
    const key = this.key(k, t);
    if (s.key === key) return s;
    const c = s.cv.getContext('2d', { willReadFrequently: true })!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = PAPER;
    c.fillRect(0, 0, PW, MAXH);
    const keep = this.lastKi;
    this.lastKi = null;
    s.h = Math.min(MAXH, this.paint(c, k, t, 0, false));
    s.ki = this.lastKi;
    this.lastKi = keep;
    s.key = key;
    return s;
  }

  /** 器 in the cached screenshot of post k (canvas coordinates of that post), or null. */
  kiOf(k: number): Box | null {
    return this.shots[k]!.ki;
  }

  /** Height of post k at t. Also sets `cardY`. */
  height(c: CanvasRenderingContext2D, k: number, t: number): number {
    return this.paint(c, k, t, 0, true);
  }

  /** Height of the screenshot of post k at t (status bar included), at full size. */
  shotHeight(k: number, t: number): number {
    return SB + this.render(k, t).h;
  }

  /** Post k at t as a screenshot taken at `at`, set at x, y, scale s. */
  screenshot(c: CanvasRenderingContext2D, k: number, t: number, at: number, x: number, y: number, s: number) {
    this.shot(c, this.render(k, t), at, x, y, s);
  }

  /** Post k at t as it stands (no motion, no save), set at x, y, scale s. */
  drawPost(c: CanvasRenderingContext2D, k: number, t: number, x: number, y: number, s: number) {
    const q = this.render(k, t);
    c.drawImage(q.cv, 0, 0, PW, q.h, x, y, PW * s, q.h * s);
  }

  /**
   * Post k at top y of c (already translated to the post's left edge); `dry` only measures, `fx` draws the
   * motion of the live post. Returns its height.
   */
  paint(c: CanvasRenderingContext2D, k: number, t: number, top: number, dry: boolean, fx = false): number {
    const p = this.posts[k]!;
    const u = USERS[p.user]!;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    let y = top + PAD;
    // header: avatar, name, handle, the time of the post in the song
    if (!dry) {
      avatar(c, p.user, PAD + AV, y + AV, AV);
      c.font = fnt(SANS, 30, 700);
      c.fillStyle = INK;
      c.fillText(u.name, CX, y + 28);
      const w = c.measureText(u.name).width;
      c.font = fnt(SANS, 26, 400);
      c.fillStyle = tone(0.45);
      c.fillText(`@${u.h} · ${formatTime(p.start)}`, CX + w + 14, y + 28);
    }
    y += 40;
    // the text, unit by unit on the onsets, wrapped at the measure; each glyph strikes in selected
    const arrived = p.us.filter((x) => x.start <= t);
    c.font = fnt(SANS, TEXT_PX, 500);
    c.fillStyle = INK;
    let x = CX;
    if (arrived.length) y += TEXT_ROW;
    for (const a of arrived) {
      const w = c.measureText(a.glyph).width;
      // a held glyph is drawn out: it takes more room to the right, but the line does not wrap on it
      const sx = fx ? stretch(a, t) : 1;
      if (x + w > CR) { x = CX; y += TEXT_ROW; }
      if (!dry) {
        if (sx === 1) strike(c, a.glyph, x, y - 14, w, TEXT_PX, age(t, a.start));
        else drawn(c, a.glyph, x, y - 14, w, TEXT_PX, sx, t < a.end, age(t, a.start) / 24);
      }
      x += w * sx;
    }
    // the caret after the newest glyph: solid for a beat, then blinking
    if (fx && !dry && arrived.length) {
      const a = age(t, arrived[arrived.length - 1]!.start);
      if (a < 8 || Math.floor(a / 6) % 2 === 0) {
        c.fillStyle = INK;
        c.fillRect(x + 5, y - 14 - TEXT_PX * 0.86, 6, TEXT_PX * 0.98);
      }
    }
    // line 48: 器 on its own row, one step smaller on every syllable after it
    if (p.ki && p.ki.start <= t) {
      const px = this.h.kiPx(t);
      y += px * 1.08 + 6;
      if (!dry) {
        const d = px * this.h.kiScale(t);
        const base = y - px * 0.16;
        c.font = fnt(SANS, d, 700);
        c.fillStyle = INK;
        c.fillText(p.ki.glyph, CX, base);
        this.lastKi = { x: CX, y: base - d * 0.88, w: d, h: d };
      }
    }
    // the gloss, phrase by phrase as they are sung
    const words = p.gloss.filter((g) => g.start <= t).map((g) => g.text).join(' ').split(' ').filter(Boolean);
    if (words.length) {
      c.font = fnt(SANS, GLOSS_PX, 400);
      c.fillStyle = tone(0.4);
      let gx = CX;
      y += GLOSS_ROW;
      for (const wd of words) {
        const w = c.measureText(wd + ' ').width;
        if (gx + w > CR) { gx = CX; y += GLOSS_ROW; }
        if (!dry) c.fillText(wd, gx, y - 6);
        gx += w;
      }
    }
    // the quote: a screenshot of the post before, one level smaller and one save lower; it pops in on the onset
    if (p.quote >= 0) {
      y += 18;
      this.cardY = y - top;
      const q = this.render(p.quote, t);
      const s = QW / PW;
      const qh = (SB + q.h) * s;
      if (!dry) {
        const a = fx ? age(t, p.start) : 99;
        const pop = a === 0 ? 0.84 : a === 1 ? 1.08 : a === 2 ? 0.98 : 1;
        const w = PW * s;
        this.shot(c, q, p.start, CX + (w * (1 - pop)) / 2, y + (qh * (1 - pop)) / 2, s * pop);
      }
      y += qh;
    }
    // reply, repost, like, views
    y += 14;
    if (!dry) this.counts(c, k, CX, y + 22, t, fx);
    y += 48;
    return y - top + 8;
  }

  /** The screenshot of post q set at x, y at scale s: shrunk to the save grid, up again without smoothing. */
  private shot(c: CanvasRenderingContext2D, q: Shot, at: number, x: number, y: number, s: number) {
    const hh = SB + q.h;
    const sw = Math.max(1, Math.ceil((PW * s) / BLOCK)), sh = Math.max(1, Math.ceil((hh * s) / BLOCK));
    const sc = q.small.getContext('2d', { willReadFrequently: true })!;
    sc.setTransform(sw / PW, 0, 0, sh / hh, 0, 0);
    sc.imageSmoothingEnabled = true;
    sc.imageSmoothingQuality = 'high';
    sc.fillStyle = PAPER;
    sc.fillRect(0, 0, PW, hh);
    statusBar(sc, at);
    sc.drawImage(q.cv, 0, 0, PW, q.h, 0, SB, PW, q.h);
    // each save washes the darks a little
    sc.fillStyle = tone(0.88, 0.1);
    sc.fillRect(0, 0, PW, hh);
    c.save();
    c.beginPath();
    c.roundRect(x, y, PW * s, hh * s, 14 * s);
    c.clip();
    c.imageSmoothingEnabled = false;
    c.drawImage(q.small, 0, 0, sw, sh, x, y, sw * BLOCK, sh * BLOCK);
    c.restore();
    c.strokeStyle = tone(0.78);
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(x, y, PW * s, hh * s, 14 * s);
    c.stroke();
    this.lastCard = { x, y, s };
  }

  /** The action row: reply, repost, like (red when liked), views; each pops on its drum. */
  private counts(c: CanvasRenderingContext2D, k: number, x: number, y: number, t: number, fx: boolean) {
    const p = this.posts[k]!;
    const v = this.h.tally(k, t);
    const step = (CR - x) / 4;
    c.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) {
      const ix = x + i * step + 14;
      const kind = HITS[i];
      const a = fx && kind ? this.h.hit(k, t, kind) : 99;
      const lit = i === 2 && p.liked;
      const sc = a === 0 ? 1.8 : a === 1 ? 1.35 : a === 2 ? 1.1 : 1;
      const col = lit || (i === 2 && a <= 1) ? RED : a <= 2 ? INK : tone(0.45);
      // the like burst: a ring of red dots flies out of the heart
      if (i === 2 && a <= 3) {
        c.fillStyle = RED;
        const r = 26 + a * 16, d = Math.max(3, 10 - a * 2);
        for (let j = 0; j < 8; j++) {
          const an = (j / 8) * Math.PI * 2 + 0.2;
          c.fillRect(ix + Math.cos(an) * r - d / 2, y + Math.sin(an) * r - d / 2, d, d);
        }
      }
      c.save();
      c.translate(ix, y);
      c.scale(sc, sc);
      if (i === 1 && a <= 1) c.rotate(Math.PI / 2);
      c.strokeStyle = col;
      c.fillStyle = col;
      c.lineWidth = a <= 2 ? 3.5 : 2.5;
      icon(c, i, lit || (i === 2 && a <= 2));
      c.restore();
      if (v) {
        c.font = fnt(SANS, a <= 1 ? 30 : 24, a <= 1 ? 700 : 400);
        c.fillStyle = a <= 1 ? col : tone(0.45);
        c.fillText(fmt(v[i]!), ix + 26 + (a === 0 ? 10 : 0), y + 1 - (a === 0 ? 6 : 0));
      }
    }
    c.textBaseline = 'alphabetic';
  }
}

/** A sung glyph: on its onset an ink block with the glyph cut out, a size up; one step in place; then ink. */
function strike(c: CanvasRenderingContext2D, s: string, x: number, base: number, w: number, px: number, a: number) {
  if (a > 1) {
    c.fillText(s, x, base);
    return;
  }
  const k = a === 0 ? 1.28 : 1;
  const cx = x + w / 2, cy = base - px * 0.38;
  c.save();
  c.translate(cx, cy);
  c.scale(k, k);
  c.translate(-cx, -cy);
  c.fillStyle = INK;
  c.fillRect(x - 3, base - px * 0.94, w + 6, px * 1.12);
  c.fillStyle = PAPER;
  c.fillText(s, x, base);
  c.restore();
  c.fillStyle = INK;
}

/** How much wider than its glyph a sung unit is drawn at t: 1 for a short one, drawn out over a held note. */
function stretch(u: WrittenUnit, t: number): number {
  if (u.end - u.start < HOLD_MIN) return 1;
  const reach = (s: number) => HOLD_STRETCH * (1 - Math.exp(-HOLD_K * s));
  const s = age(Math.min(t, u.end), u.start) / 24;
  if (t < u.end) return 1 + reach(s);
  const r = age(t, u.end);
  if (r >= HOLD_RING) return 1;
  // the voice moves on: it lets go and rings down
  const q = r / 24;
  return 1 + reach(s) * Math.exp(-9 * q) * Math.cos(26 * q);
}

/** A glyph drawn out by sx from its left edge: while it sounds it stays selected and wavers a little, then plain ink. */
function drawn(c: CanvasRenderingContext2D, s: string, x: number, base: number, w: number, px: number, sx: number, sounding: boolean, secs: number) {
  c.save();
  c.translate(x, base);
  c.scale(sx, sounding ? 1 + 0.035 * Math.sin(2 * Math.PI * 5 * secs) : 1);
  if (sounding) {
    c.fillStyle = INK;
    c.fillRect(-3 / sx, -px * 0.94, w + 6 / sx, px * 1.12);
    c.fillStyle = PAPER;
  }
  c.fillText(s, 0, 0);
  c.restore();
  c.fillStyle = INK;
}

/** An icon of the action row at 0, 0: reply bubble, repost arrows, heart, view bars. */
function icon(c: CanvasRenderingContext2D, i: number, fill: boolean) {
  c.beginPath();
  if (i === 0) {
    c.roundRect(-13, -11, 26, 20, 8);
    c.moveTo(-6, 9);
    c.lineTo(-9, 15);
    c.lineTo(1, 9);
    c.stroke();
  } else if (i === 1) {
    c.moveTo(-12, 4);
    c.lineTo(-12, -7);
    c.lineTo(8, -7);
    c.moveTo(12, -4);
    c.lineTo(12, 7);
    c.lineTo(-8, 7);
    c.moveTo(4, -12);
    c.lineTo(9, -7);
    c.lineTo(4, -2);
    c.moveTo(-4, 2);
    c.lineTo(-9, 7);
    c.lineTo(-4, 12);
    c.stroke();
  } else if (i === 2) {
    heart(c, 0, 0, 1);
    if (fill) c.fill();
    else c.stroke();
  } else {
    for (let b = 0; b < 3; b++) c.fillRect(-11 + b * 9, 10 - (b + 1) * 7, 5, (b + 1) * 7);
  }
}

/** A heart path centred at x, y (about 36 px wide at k = 1). */
export function heart(c: CanvasRenderingContext2D, x: number, y: number, k: number) {
  c.moveTo(x, y + 11 * k);
  c.bezierCurveTo(x - 18 * k, y - 1 * k, x - 12 * k, y - 16 * k, x, y - 6 * k);
  c.bezierCurveTo(x + 12 * k, y - 16 * k, x + 18 * k, y - 1 * k, x, y + 11 * k);
}

/** The phone's status bar on top of a screenshot: the time of the repost, signal, battery. */
export function statusBar(c: CanvasRenderingContext2D, at: number) {
  c.fillStyle = PAPER;
  c.fillRect(0, 0, PW, SB);
  c.font = font(MONO, 24);
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.fillStyle = INK;
  c.fillText(formatTime(at), PAD, SB / 2 + 2);
  for (let k = 0; k < 4; k++) c.fillRect(PW - 150 + k * 12, SB / 2 + 10 - (k + 1) * 5, 8, (k + 1) * 5);
  c.strokeStyle = INK;
  c.lineWidth = 2;
  c.strokeRect(PW - 84, SB / 2 - 9, 44, 20);
  c.fillRect(PW - 40, SB / 2 - 4, 4, 10);
  c.fillRect(PW - 81, SB / 2 - 6, 24, 14);
  c.textBaseline = 'alphabetic';
}

/** A round avatar: a gray disc and an initial, or the seal. */
export function avatar(c: CanvasRenderingContext2D, user: number, x: number, y: number, r: number) {
  const u = USERS[user]!;
  c.save();
  c.fillStyle = u.seal ? tone(0.94) : tone(u.tone);
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  if (u.seal) seal(c, x, y, r * 0.92, 'ink', SANS);
  else {
    c.font = fnt(SANS, r * 1.1, 700);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = u.tone > 0.6 ? INK : PAPER;
    c.fillText(u.ini, x, y + r * 0.06);
  }
  c.restore();
}
