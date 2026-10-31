// Plate 6 · Bored (screen). A chat app in the dark: a server rail, a channel sidebar, the message list, an input
// bar, the members. The sermon (lines 37-40) is the history at the top of the channel; each sung line arrives as
// messages from the users, with a typing indicator before each one, and every message is a reply that quotes the
// reply before it (the quotes nest). A message fills unit by unit on the onsets; the EN gloss is a smaller line
// under it. Every save is a real JPEG re-save (SurfaceOpts.jpeg) and the quality steps down as the saves pile up:
// one at each line, and one on each syllable of line 42 (眠っちゃうよ). Line 41: the question mark is a jumbo
// message, the largest glyph. Line 43 (飽きっぽい): one message per unit, so the chat scrolls one jump per
// syllable. Line 44: on ビ a user posts a kaomoji cat and a slit fires from its hand across the frame onto red.
//
// v4 motion (see bored-fx.ts):
// - Syllable: the new glyph pops in as a light selection block at 1.35x, then hops down to its place; a caret
//   follows the newest glyph. A new message scrolls the list up in a jump with an overshoot (3 steps).
// - New line: a red NEW divider with the line and the save number. Each save pops a file chip in the input bar.
// - Kick: super reactions. Pills under the recent messages count up, pop, and spray copies of their glyph to the
//   right; the reacting members light; the unread badge on the rail ticks; your typing in the input bar is
//   selected and deleted. From the middle of the plate, some kicks pop a kaomoji sticker.
// - Snare: a mention. A recent message lights as a mention (red bar) and keeps a tint; # beam ticks; a kaomoji
//   sticker pops in the free right side of the list.
// - Hat: the typing dots step and hop; you type one spam character into the input bar; past glyphs turn into
//   typos with a red squiggle for 2 steps (more with the plate).
import type { Frame } from '@pve/engine/scene';
import { H, W } from '@pve/engine/gl';
import { hash, roundRectFill } from '@pve/engine/util';
import { lineNo, syllables, units, type Line, type WrittenPhrase, type WrittenUnit } from '@pve/engine/lyrics';
import { font } from '@pve/engine/type';
import {
  copyTimes, fnt, genAt, INK, MONO, PageScene, PAPER, RED, SANS, seal, tone, type SurfaceOpts,
} from './_page';
import { SCREEN } from './_era_screen';
import { age, HATS, KAOS, PILLS, SPAM, SPRAY_LIFE, spray, squiggle, sticker, typo } from './bored-fx';

/** Invented users (set dressing, rule 6). `seal`: the 神 seal is the avatar. */
const USERS: { h: string; tone: number; ini: string; seal?: boolean }[] = [
  { h: 'nemui.exe', tone: 0.55, ini: 'N' },
  { h: 'uzai', tone: 0.8, ini: 'U' },
  { h: 'okee_minna', tone: 0.38, ini: 'O' },
  { h: 'dance.plz', tone: 0.92, ini: 'D' },
  { h: 'kamippoi', tone: 0, ini: '', seal: true },
];
const GOD = 4;

interface Msg {
  user: number;
  line: Line;
  us: WrittenUnit[];
  gloss: WrittenPhrase[];
  start: number;
  /** Index of the message it replies to, -1 for none. */
  reply: number;
  /** Same user as the message before and no reply: no header (grouped). */
  grouped: boolean;
  /** Line 43: one row per unit, its gloss beside it. */
  compact: boolean;
  /** Line 41: the ？ of the last unit is a jumbo message of its own. */
  jumbo: boolean;
  /** Set dressing: a kaomoji message, no lyric units (the ビーム cat). */
  kao?: string;
  /** The first message of a sung line: a NEW divider above it. */
  first?: boolean;
  /** Its three reactions (indexes into PILLS), shown from their first kick. */
  pills: number[];
}

/** A kick that reacts on pill p of message k with `add`. */
interface Hit { t: number; k: number; p: number; add: number; seed: number }
interface Sticker { t: number; text: string; x: number; y: number; rot: number }

// the panels (x ranges) and rows
const RAIL = 104, SIDE = 420, MEM = 1580;
const TOP = 84; // channel header height
const INPUT = { y: H - 132, h: 76 };
const LIST_END = INPUT.y - 18; // the newest message ends here
const AV = 30; // avatar radius
const TX = SIDE + 110; // message text x
const TR = MEM - 56; // message text right edge
const TEXT_PX = 54, TEXT_ROW = 72;
const GLOSS_PX = 28, GLOSS_ROW = 38;
const QUOTE_ROW = 36, HEAD_ROW = 50;
const COMPACT_ROW = 66;
const JUMBO_PX = 600, JUMBO_ROW = 540;
const REACT_ROW = 66, DIV_ROW = 46;
const KAO_PX = 104, KAO_ROW = 128;
const BG = tone(0.2), SIDE_BG = tone(0.15), RAIL_BG = tone(0.1), FIELD = tone(0.27);
/** The ビーム slit: from the cat's hand to the right edge, rising at this slope, px thick. ム fires a second one. */
const SLIT = { slope: -440 / W, w: 60 };
const SLIT2 = { slope: -130 / W, w: 96 };
/** The ビーム cat (all its chars are in the Noto Sans JP subset) and its poster. */
const KAO = '(=^・^=)ノ', KAO_USER = 0;
/** The scroll that is still to run on the steps after a message arrives, as a fraction of its height. */
const JUMP = [0.55, 0.2, -0.06];
/** Hat pops: the free right side of the list (never under the sung text, which ends left of it). */
const POP = { x0: 1190, x1: 1500 };
/** Sticker lifetime, s. */
const STICK = 0.75;

/** JPEG quality of the n-th save of the plate: 72 down to 6 at the last save (n = 22). */
const QMAX = 72, QMIN = 6, NMAX = 22;
const quality = (n: number) => Math.round(QMAX * Math.pow(QMIN / QMAX, (Math.min(n, NMAX) - 1) / (NMAX - 1)));
/**
 * Re-saves run in one frame. Real time caps them at 3 (12 full-frame passes): the later saves are at a lower
 * quality and wipe out what the earlier ones kept, so the rest of the history lives in the quality.
 */
const passes = (n: number) => (n <= 1 ? 1 : 2);
const count = (ts: number[], t: number) => {
  let n = 0;
  for (const x of ts) if (x <= t) n++;
  return n;
};
const last = (ts: number[], t: number) => {
  let r = -Infinity;
  for (const x of ts) if (x <= t) r = x;
  return r;
};

export default class Bored extends PageScene {
  private msgs: Msg[] = [];
  private copies: number[] = [];
  /** The save times of the plate, in order. */
  private saves: number[] = [];
  /** Line 44: the onsets of ビ and ム. */
  private beam = 0;
  private mu = 0;
  private kicks: number[] = [];
  private snares: number[] = [];
  private hats: number[] = [];
  private hits: Hit[] = [];
  /** Snare mentions: message index and time. */
  private mentions: { t: number; k: number }[] = [];
  private stickers: Sticker[] = [];
  // per frame: the typos of this step (k * 64 + unit -> glyph) and where each pill was drawn (k * 4 + p)
  private typos = new Map<number, string>();
  private pillAt = new Map<number, [number, number]>();

  override async init() {
    await super.init();
    this.warm([SCREEN], true);
    const L = this.ctx.lyrics;
    // the history: the sermon, grouped under the seal
    for (let i = 37; i <= 40; i++) {
      const line = lineNo(L, i);
      const us = units(line);
      this.msgs.push({
        user: GOD, line, us, gloss: line.written!.phrases, start: us[0]!.start, reply: -1, grouped: i > 37,
        compact: false, jumbo: false, pills: [],
      });
    }
    // the sung lines: cut into messages at syllable indexes, each a reply to the one before. Line 43 sends one
    // message per unit, the cut so far sent again with the new unit: the first of each cut replies, the rest are
    // grouped under it, and each carries the gloss phrase that starts on its new unit
    const say = (i: number, cuts: number[], who: number[]) => {
      const line = lineNo(L, i);
      const all = units(line);
      cuts.forEach((a, k) => {
        const b = cuts[k + 1] ?? Infinity;
        const us = all.filter((u) => u.from >= a && u.from < b);
        const parts = i === 43 ? us.map((_, j) => us.slice(0, j + 1)) : [us];
        parts.forEach((p, j) => {
          const end = p[p.length - 1]!;
          const gloss = line.written!.phrases.filter((ph) =>
            i === 43 ? ph.from >= end.from && ph.from < end.to : ph.from >= p[0]!.from && ph.from < end.to);
          this.msgs.push({
            user: who[k]!, line, us: p, gloss, start: i === 43 ? end.start : p[0]!.start,
            reply: j === 0 ? this.msgs.length - 1 : -1, grouped: j > 0, compact: i === 43, jumbo: i === 41 && k === 0,
            first: k === 0 && j === 0, pills: [],
          });
        });
      });
    };
    say(41, [0, 7, 12], [1, 0, 1]);
    say(42, [0, 11, 17], [0, 2, 0]);
    say(43, [0, 11, 14], [2, 3, 2]);
    say(44, [0, 6, 14], [3, 1, 3]);

    const sung = (i: number) => {
      const line = lineNo(L, i);
      const ghosts = line.written!.ghosts;
      return syllables(line).filter((_, k) => !ghosts.includes(k)).map((s) => s.start);
    };
    const l44 = lineNo(L, 44);
    this.beam = units(l44).find((u) => u.glyph === 'ビ')!.start;
    this.mu = units(l44).find((u) => u.glyph === 'ム')!.start;
    // the cat: posted on the onset of ビ, between the messages
    const at = this.msgs.findIndex((m) => m.start > this.beam);
    const ix = at < 0 ? this.msgs.length : at;
    for (const m of this.msgs) if (m.reply >= ix) m.reply++;
    this.msgs.splice(ix, 0, {
      user: KAO_USER, line: l44, us: [], gloss: [], start: this.beam, reply: -1, grouped: false,
      compact: false, jumbo: false, kao: KAO, pills: [0, 5, 6],
    });
    // three reactions per sung message, in a seeded order
    this.msgs.forEach((m, k) => {
      if (m.kao || m.line.i < 41) return;
      m.pills = PILLS.map((_, i) => i).sort((a, b) => hash(k, a, 41) - hash(k, b, 41)).slice(0, 3);
    });
    this.copies = copyTimes(L);
    this.saves = [sung(41)[0]!, ...sung(42), sung(43)[0]!, sung(44)[0]!].sort((a, b) => a - b);

    const au = this.ctx.audio;
    const ev = (k: string) => au.events(k, this.ctx.start - 1, this.ctx.end + 1).map(([t]) => t);
    this.kicks = ev('kick');
    this.snares = ev('snare');
    this.hats = ev('hat');
    const shownAt = (t: number) => this.msgs.flatMap((m, k) => (m.start <= t ? [k] : []));
    // kicks: reactions on the recent sung messages (newest first, biased to the newest), more with the plate
    this.kicks.forEach((kt, j) => {
      const d = this.dens(kt);
      const cand = shownAt(kt).filter((k) => {
        const m = this.msgs[k]!;
        return m.pills.length && !m.compact && m.start > kt - 6;
      }).reverse();
      if (!cand.length) return;
      const n = 1 + Math.floor(d * 2.6);
      for (let i = 0; i < n; i++) {
        const r = hash(j, i, 1);
        const k = cand[Math.floor(r * r * cand.length)]!;
        const kao = this.msgs[k]!.kao !== undefined;
        this.hits.push({
          t: kt, k, p: kao ? 0 : Math.floor(hash(j, i, 2) * 3), add: 1 + Math.floor(hash(j, i, 3) * (2 + d * 7)),
          seed: j * 7 + i,
        });
      }
      if (d > 0.4 && hash(j, 9) < d) this.stickers.push(this.stick(kt, j + 100));
    });
    // snares: a mention on one of the recent messages (never the newest) and a sticker
    this.snares.forEach((st, j) => {
      const ks = shownAt(st);
      const cand = ks.slice(Math.max(0, ks.length - 7), ks.length - 1);
      if (cand.length) this.mentions.push({ t: st, k: cand[Math.floor(hash(j, 21) * cand.length)]! });
      this.stickers.push(this.stick(st, j));
    });
  }

  /** The density of the moving parts: 0 at the start of the plate, 1 at its end. */
  private dens(t: number) {
    return Math.max(0, Math.min(1, (t - this.ctx.start) / (this.ctx.end - this.ctx.start)));
  }

  private stick(t: number, j: number): Sticker {
    return {
      t, text: KAOS[Math.floor(hash(j, 31) * KAOS.length)]!, x: 1270 + hash(j, 32) * 170,
      y: TOP + 140 + hash(j, 33) * (LIST_END - TOP - 520), rot: (hash(j, 34) - 0.5) * 0.4,
    };
  }

  draw(c: CanvasRenderingContext2D, f: Frame): SurfaceOpts {
    const t = f.t;
    const L = this.ctx.lyrics;
    const d = this.dens(t);
    const n = Math.max(1, count(this.saves, t));
    const q = quality(n);
    const gen = genAt(this.copies, L, t);
    let N = 0;
    while (N < this.msgs.length && this.msgs[N]!.start <= t) N++;
    const shown = this.msgs.slice(0, N);
    const plate = shown.filter((m) => m.line.i >= 41).length;

    // hats: past glyphs (never the message being sung) turn into typos for 2 steps
    this.typos.clear();
    for (let j = 0; j < this.hats.length; j++) {
      const ht = this.hats[j]!;
      const a = age(t, ht);
      if (a < 0 || a > 1 || d < 0.08 || hash(j, 51) > 0.3 + d * 0.7) continue;
      const cand = shown.flatMap((m, k) => (k < N - 1 && !m.kao && !m.compact && m.us.length ? [k] : []));
      if (!cand.length) continue;
      const m = 1 + Math.floor(d * 2.5);
      for (let i = 0; i < m; i++) {
        const k = cand[cand.length - 1 - Math.floor(hash(j, i, 52) * Math.min(6, cand.length))]!;
        const us = this.msgs[k]!.us;
        const u = Math.floor(hash(j, i, 53) * us.length);
        this.typos.set(k * 64 + u, typo(us[u]!.glyph, hash(j, i, 54)));
      }
    }

    // the layout of the message list, newest at the bottom: heights, the scroll still to run, top y of each
    const hs: number[] = [];
    let acc = 0;
    for (let k = N - 1; k >= 0 && acc < LIST_END - TOP + 900; k--) {
      hs[k] = this.msg(c, k, t, 0, 0, true);
      acc += hs[k]!;
    }
    let off = 0;
    for (let k = N - 1; k >= 0 && hs[k] !== undefined; k--) {
      const a = age(t, this.msgs[k]!.start);
      if (a >= 0 && a < JUMP.length) off += hs[k]! * JUMP[a]!;
    }
    const tops: number[] = [];
    let y = LIST_END + off;
    for (let k = N - 1; k >= 0 && hs[k] !== undefined; k--) {
      y -= hs[k]!;
      tops[k] = y;
    }

    // the cat's hand (the end of ノ), with the recoil of the shot
    const cat = shown.findIndex((m) => m.kao);
    let hand: [number, number] | null = null;
    if (cat >= 0 && tops[cat] !== undefined) {
      c.font = fnt(SANS, KAO_PX, 500);
      const ab = age(t, this.beam);
      const rec = ab === 0 ? -26 : ab === 1 ? -12 : 0;
      hand = [TX + c.measureText(KAO).width - 10 + rec, tops[cat]! + 18 + HEAD_ROW + KAO_ROW - 28 - KAO_PX * 0.4];
    }

    const ab = age(t, this.beam), am = age(t, this.mu);
    c.save();

    // pass 1: the panels
    c.fillStyle = BG;
    c.fillRect(0, 0, W, H);
    c.fillStyle = RAIL_BG;
    c.fillRect(0, 0, RAIL, H);
    c.fillStyle = SIDE_BG;
    c.fillRect(RAIL, 0, SIDE - RAIL, H);
    c.fillRect(MEM, 0, W - MEM, H);
    c.fillStyle = tone(0.12);
    c.fillRect(SIDE, TOP - 3, MEM - SIDE, 3);
    c.fillRect(RAIL, TOP - 3, SIDE - RAIL, 3);
    c.fillStyle = FIELD;
    roundRectFill(c, SIDE + 36, INPUT.y, MEM - SIDE - 72, INPUT.h, 14);
    c.fillStyle = tone(0.26);
    roundRectFill(c, RAIL + 14, 256, SIDE - RAIL - 28, 52, 8); // the active channel

    // ビーム: on the onset of ビ a slit fires from the cat's hand across the frame onto red, on ム a wider one;
    // type stays on top
    if (hand) {
      slit(c, hand[0], hand[1], SLIT.slope, SLIT.w, ab);
      if (am >= 0) slit(c, hand[0], hand[1] + 6, SLIT2.slope, SLIT2.w, am);
    }

    // pass 2: the chrome
    const kn = count(this.kicks, t), sn = count(this.snares, t);
    const ka = age(t, last(this.kicks, t)), sa = age(t, last(this.snares, t));
    this.rail(c, 3 + kn, ka);
    this.sidebar(c, plate + sn, sa);
    this.members(c, shown, t);
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.fillStyle = tone(0.95);
    c.font = fnt(SANS, 32, 700);
    c.fillText('# kami-ppoi', SIDE + 36, TOP / 2);
    // small true marks: generation, line, the JPEG quality and save count, time
    const line = shown[N - 1]!.line.i;
    label(c, `GEN ${String(gen).padStart(2, '0')} · line ${line} · JPEG q${q} · save ${String(n).padStart(2, '0')} · ${t.toFixed(2)} s`, MEM - 36, TOP / 2, 'right');
    this.input(c, t, n, q, d);

    // the message list, newest at the bottom
    this.pillAt.clear();
    c.save();
    c.beginPath();
    c.rect(SIDE, TOP, MEM - SIDE, LIST_END + 8 - TOP);
    c.clip();
    for (let k = N - 1; k >= 0 && tops[k] !== undefined; k--) {
      if (tops[k]! + hs[k]! < TOP) break;
      this.msg(c, k, t, tops[k]!, hs[k]!, false);
    }
    c.restore();

    // kicks: the reactions burst out of their pills
    for (const h of this.hits) {
      const dt = t - h.t;
      const at = this.pillAt.get(h.k * 4 + h.p);
      if (dt < 0 || dt >= SPRAY_LIFE || !at) continue;
      const p = PILLS[this.msgs[h.k]!.pills[h.p]!]!;
      spray(c, p.g, !!p.red, at[0], at[1], dt, h.seed, 4 + Math.floor(d * 7), h.add);
    }
    // hats: a random set of reactions pops in the free right side of the list for 3 steps, more with the plate
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let j = 0; j < this.hats.length; j++) {
      const a = age(t, this.hats[j]!);
      if (a < 0 || a > 2) continue;
      const m = Math.round(hash(j, 61) * (1 + d * 4));
      for (let i = 0; i < m; i++) {
        const g = HATS[Math.floor(hash(j, i, 62) * HATS.length)]!;
        const s = (44 + hash(j, i, 63) * (36 + d * 54)) * (a === 0 ? 1.3 : a === 2 ? 0.85 : 1);
        c.font = fnt(SANS, s, 700);
        c.fillStyle = g === '神' ? RED : a === 0 ? PAPER : tone(a === 1 ? 0.72 : 0.45);
        c.fillText(g, POP.x0 + hash(j, i, 64) * (POP.x1 - POP.x0), TOP + 90 + hash(j, i, 65) * (LIST_END - TOP - 200));
      }
    }
    // stickers in the free right side of the list
    for (const s of this.stickers) {
      const dt = t - s.t;
      if (dt < 0 || dt >= STICK) continue;
      sticker(c, s.text, s.x, s.y, age(t, s.t), s.rot);
    }
    c.restore();

    return { era: SCREEN, gen, jpeg: { quality: q, passes: passes(n), shift: [3, 5] } };
  }

  /** The input bar: the spam you type on the hats, selected and deleted on the kicks; the save chip; who types. */
  private input(c: CanvasRenderingContext2D, t: number, n: number, q: number, d: number) {
    const cy = INPUT.y + INPUT.h / 2;
    const lk = Math.max(this.ctx.start - 1, last(this.kicks, t));
    const pk = Math.max(this.ctx.start - 1, last(this.kicks, lk - 1e-3));
    const typed = (a: number, b: number) =>
      this.hats.filter((h) => h > a && h <= b).map((h) => SPAM[Math.floor(hash(h * 100, 3) * SPAM.length)]!);
    const now = typed(lk, t).slice(-26);
    const ka = age(t, lk);
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    const x0 = SIDE + 76;
    if (now.length) {
      c.font = fnt(SANS, 34, 500);
      let x = x0;
      now.forEach((g, i) => {
        const w = c.measureText(g).width;
        const pop = i === now.length - 1 && age(t, last(this.hats, t)) === 0;
        c.fillStyle = pop ? PAPER : tone(0.9);
        if (pop) {
          c.save();
          c.translate(x + w / 2, cy);
          c.scale(1.4, 1.4);
          c.fillText(g, -w / 2, -4);
          c.restore();
        } else c.fillText(g, x, cy);
        x += w;
      });
      c.fillStyle = tone(0.95);
      c.fillRect(x + 4, cy - 22, 4, 44);
    } else if (ka >= 0 && ka < 3) {
      // the kick: select all and delete
      const old = typed(pk, lk).slice(-26).join('');
      if (old && ka < 2) {
        c.font = fnt(SANS, 34, 500);
        const w = c.measureText(old).width;
        c.fillStyle = tone(0.55);
        c.fillRect(x0 - 4, cy - 24, w + 8, 48);
        c.fillStyle = PAPER;
        c.fillText(old, x0, cy);
      }
    } else {
      c.font = fnt(SANS, 30, 400);
      c.fillStyle = tone(0.55);
      c.fillText('Message #kami-ppoi', x0, cy);
    }
    // the save chip: the file of the last save and its quality
    const sv = last(this.saves, t);
    const sa = age(t, sv);
    const s = sa === 0 ? 1.35 : sa === 1 ? 1.12 : 1;
    const txt = `save_${String(n).padStart(2, '0')}.jpg  q${q}`;
    c.font = font(MONO, 26);
    const w = c.measureText(txt).width + 70;
    const cx = MEM - 60 - w / 2;
    c.save();
    c.translate(cx, cy);
    c.scale(s, s);
    c.fillStyle = sa >= 0 && sa < 2 ? tone(0.9) : tone(0.17);
    roundRectFill(c, -w / 2, -26, w, 52, 10);
    c.fillStyle = sa >= 0 && sa < 2 ? INK : tone(0.8);
    c.fillRect(-w / 2 + 14, -14, 22, 28);
    c.fillText(txt, -w / 2 + 50, 2);
    c.restore();

    // who is typing: the next poster first; the dots step and hop on the hats
    const next = this.msgs.find((m) => m.start > t);
    const who = USERS[(next ?? this.msgs[this.msgs.length - 1]!).user]!.h;
    const others = Math.floor(d * 4) + (count(this.kicks, t) % 2);
    const lit = count(this.hats, t) % 3;
    const hop = age(t, last(this.hats, t)) <= 1;
    const dy = INPUT.y + INPUT.h + 30;
    for (let k = 0; k < 3; k++) {
      const on = k === lit;
      c.fillStyle = tone(on ? 0.97 : 0.45);
      c.beginPath();
      c.arc(SIDE + 54 + k * 26, dy - (on && hop ? 12 : 0), on ? 10 : 8, 0, Math.PI * 2);
      c.fill();
    }
    c.font = fnt(SANS, 26, 700);
    c.fillStyle = tone(0.88);
    c.fillText(who, SIDE + 136, dy);
    const ww = c.measureText(who + ' ').width;
    c.font = fnt(SANS, 26, 400);
    c.fillStyle = tone(0.7);
    c.fillText(others ? `and ${others} others are typing...` : 'is typing...', SIDE + 136 + ww, dy);
  }

  /** One message at top y, h tall (from a dry pass); `dry` only measures. Returns its height. */
  private msg(c: CanvasRenderingContext2D, k: number, t: number, top: number, h: number, dry: boolean): number {
    const m = this.msgs[k]!;
    const u = USERS[m.user]!;
    // snare: a mention lights the row; it keeps a tint
    if (!dry) {
      const mt = last(this.mentions.filter((x) => x.k === k).map((x) => x.t), t);
      if (mt > -Infinity) {
        const a = age(t, mt);
        c.fillStyle = a <= 1 ? tone(0.38) : a <= 5 ? tone(0.3) : tone(0.235);
        c.fillRect(SIDE, top + 4, MEM - SIDE, h - 4);
        c.fillStyle = RED;
        c.fillRect(SIDE, top + 4, a <= 5 ? 10 : 5, h - 4);
      }
    }
    let y = top;
    // a new line: the NEW divider, with its line and save
    if (m.first) {
      if (!dry) {
        const dy = y + DIV_ROW / 2 + 4;
        const txt = `NEW · line ${m.line.i} · save ${String(count(this.saves, m.start + 1e-3)).padStart(2, '0')}`;
        c.font = font(MONO, 22);
        const w = c.measureText(txt).width;
        c.fillStyle = RED;
        c.fillRect(SIDE + 24, dy - 1, MEM - SIDE - 72 - w - 40, 3);
        roundRectFill(c, MEM - 48 - w - 28, dy - 16, w + 28, 32, 6);
        c.fillStyle = PAPER;
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.fillText(txt, MEM - 48 - w - 14, dy + 1);
      }
      y += DIV_ROW;
    }
    y += m.grouped ? 4 : 18;
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    // the reply bar: the message it answers, and the ones that answered before it, nested
    if (m.reply >= 0) {
      const chain: number[] = [];
      for (let r = m.reply; r >= 0 && chain.length < 3; r = this.msgs[r]!.reply) chain.push(r);
      chain.reverse();
      chain.forEach((r, dd) => {
        const ind = (chain.length - 1 - dd) * 44;
        if (!dry) this.quote(c, r, TX + ind, y + QUOTE_ROW / 2, 0.75 - (chain.length - 1 - dd) * 0.15);
        y += QUOTE_ROW;
      });
      if (!dry) {
        // the elbow from the avatar up to the quote
        c.strokeStyle = tone(0.4);
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(SIDE + 36 + AV, y + 8);
        c.lineTo(SIDE + 36 + AV, y - QUOTE_ROW / 2 + 6);
        c.lineTo(TX - 12, y - QUOTE_ROW / 2);
        c.stroke();
      }
    }
    // header: avatar, handle, the time of the message in the song
    if (!m.grouped) {
      if (!dry) {
        avatar(c, m.user, SIDE + 36 + AV, y + AV + 4, AV);
        c.textBaseline = 'alphabetic';
        c.textAlign = 'left';
        c.font = fnt(SANS, 30, 700);
        c.fillStyle = tone(0.95);
        c.fillText(u.h, TX, y + 34);
        const w = c.measureText(u.h).width;
        c.font = font(MONO, 24);
        c.fillStyle = tone(0.62);
        const s = m.start;
        c.fillText(`Today at ${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`, TX + w + 20, y + 32);
      }
      y += HEAD_ROW;
    }
    if (m.kao) {
      c.fillStyle = tone(0.97);
      c.font = fnt(SANS, KAO_PX, 500);
      y += KAO_ROW;
      if (!dry) {
        const ab = age(t, this.beam);
        c.fillText(m.kao, TX + (ab === 0 ? -26 : ab === 1 ? -12 : 0), y - 28);
      }
      y = this.reactions(c, k, t, y, dry);
      return y - top + 10;
    }
    const arrived = m.us.filter((x) => x.start <= t);
    const gloss = m.gloss.filter((p) => p.start <= t);
    c.font = fnt(SANS, TEXT_PX, 500);
    if (m.compact) {
      // one row: the cut so far, set across, and the gloss phrase that starts on its new unit beside it
      if (!dry) {
        let x = TX;
        arrived.forEach((a) => {
          x += this.glyph(c, a.glyph, x, y + 54, age(t, a.start), null);
        });
        const p = gloss[0];
        if (p) {
          c.font = fnt(SANS, GLOSS_PX, 400);
          c.fillStyle = tone(0.62);
          c.fillText(p.text, x + 28, y + 48);
        }
      }
      y += COMPACT_ROW;
      return y - top + 12;
    }
    // the text, unit by unit, wrapped at the measure
    const big = m.jumbo && arrived.length === m.us.length;
    let x = TX;
    if (arrived.length) y += TEXT_ROW;
    arrived.forEach((a, i) => {
      const g = big && i === arrived.length - 1 ? a.glyph.replace('？', '') : a.glyph;
      c.font = fnt(SANS, TEXT_PX, 500);
      const w = c.measureText(g).width;
      if (x + w > TR) { x = TX; y += TEXT_ROW; }
      if (!dry) this.glyph(c, g, x, y - 18, age(t, a.start), this.typos.get(k * 64 + i) ?? null);
      x += w;
    });
    // the caret follows the newest glyph while the message is being sung
    if (!dry && arrived.length && arrived.length < m.us.length && k === this.newest(t)) {
      c.fillStyle = tone(0.95);
      c.fillRect(x + 6, y - 18 - TEXT_PX * 0.86, 5, TEXT_PX);
    }
    // line 41: the question mark is the largest glyph, a jumbo message of its own, in red; it slams in
    if (big) {
      if (!dry) {
        const qa = age(t, arrived[arrived.length - 1]!.start);
        const s = qa === 0 ? 1.5 : qa === 1 ? 1.2 : qa === 2 ? 1.06 : 1;
        const cx = TX - 40 + JUMBO_PX * 0.5, cy = y + JUMBO_ROW - 40 - JUMBO_PX * 0.42;
        c.save();
        c.translate(cx, cy);
        c.scale(s, s);
        c.translate(-cx, -cy);
        c.font = fnt(SANS, JUMBO_PX, 700);
        c.fillStyle = RED;
        c.fillText('？', TX - 40, y + JUMBO_ROW - 40);
        c.restore();
      }
      y += JUMBO_ROW;
    }
    // the gloss, phrase by phrase as they are sung
    const words = gloss.map((p) => p.text).join(' ').split(' ').filter(Boolean);
    if (words.length) {
      c.font = fnt(SANS, GLOSS_PX, 400);
      c.fillStyle = tone(0.62);
      let gx = TX;
      y += GLOSS_ROW;
      for (const wd of words) {
        const w = c.measureText(wd + ' ').width;
        if (gx + w > TR) { gx = TX; y += GLOSS_ROW; }
        if (!dry) c.fillText(wd, gx, y - 8);
        gx += w;
      }
    }
    if (m.pills.length) y = this.reactions(c, k, t, y, dry);
    return y - top + 10;
  }

  /** Index of the newest shown message. */
  private newest(t: number) {
    let k = -1;
    for (let i = 0; i < this.msgs.length; i++) if (this.msgs[i]!.start <= t) k = i;
    return k;
  }

  /**
   * One sung glyph at baseline y, a steps after its onset: a light selection block at 1.35x on its first step,
   * 1.12x a little high on the second, then in place. A typo draws the wrong glyph with a red squiggle.
   * Returns the advance.
   */
  private glyph(c: CanvasRenderingContext2D, g: string, x: number, y: number, a: number, wrong: string | null) {
    c.font = fnt(SANS, TEXT_PX, 500);
    const w = c.measureText(g).width;
    if (a <= 1) {
      const s = a === 0 ? 1.35 : 1.12;
      const cx = x + w / 2, cy = y - TEXT_PX * 0.36 - (a === 1 ? 10 : 0);
      c.save();
      c.translate(cx, cy);
      c.scale(s, s);
      c.translate(-cx, -cy);
      if (a === 0) {
        c.fillStyle = tone(0.93);
        c.fillRect(x - 5, y - TEXT_PX * 0.95, w + 10, TEXT_PX * 1.2);
        c.fillStyle = INK;
      } else c.fillStyle = PAPER;
      c.fillText(g, x, y - (a === 1 ? 10 : 0));
      c.restore();
    } else if (wrong) {
      c.save();
      c.translate(x + w / 2, y - TEXT_PX * 0.36);
      c.scale(1.15, 1.15);
      c.fillStyle = tone(0.97);
      c.textAlign = 'center';
      c.fillText(wrong, 0, TEXT_PX * 0.36);
      c.restore();
      squiggle(c, x, y + 8, w);
    } else {
      c.fillStyle = tone(0.93);
      c.fillText(g, x, y);
    }
    return w;
  }

  /** The reaction row of message k below y: the pills its kicks have hit, popping on each hit. */
  private reactions(c: CanvasRenderingContext2D, k: number, t: number, y: number, dry: boolean): number {
    if (!dry) {
      const m = this.msgs[k]!;
      let x = TX;
      const cy = y + REACT_ROW / 2 + 2;
      m.pills.forEach((pi, p) => {
        let n = 0, lt = -Infinity;
        for (const h of this.hits) if (h.k === k && h.p === p && h.t <= t) { n += h.add; lt = h.t; }
        if (!n) return;
        const pill = PILLS[pi]!;
        const a = age(t, lt);
        const s = a === 0 ? 1.4 : a === 1 ? 1.15 : 1;
        c.font = fnt(SANS, 36, 700);
        const gw = c.measureText(pill.g).width;
        c.font = font(MONO, 32);
        const txt = String(n);
        const w = gw + c.measureText(txt).width + 50;
        c.save();
        c.translate(x + w / 2, cy);
        c.scale(s, s);
        c.fillStyle = a <= 3 ? tone(0.95) : tone(0.42);
        roundRectFill(c, -w / 2 - 2, -28, w + 4, 56, 14);
        c.fillStyle = a <= 3 ? tone(0.3) : tone(0.27);
        roundRectFill(c, -w / 2 + 2, -24, w - 4, 48, 12);
        c.textBaseline = 'middle';
        c.textAlign = 'left';
        c.font = fnt(SANS, 36, 700);
        c.fillStyle = pill.red ? RED : tone(0.95);
        c.fillText(pill.g, -w / 2 + 16, 1);
        c.font = font(MONO, 32);
        c.fillStyle = tone(0.92);
        c.fillText(txt, -w / 2 + 28 + gw, 2);
        c.restore();
        this.pillAt.set(k * 4 + p, [x + w / 2, cy]);
        x += w + 14;
      });
      c.textBaseline = 'alphabetic';
    }
    return y + REACT_ROW;
  }

  /** A quoted message on one row: a small avatar, the handle, the text cut at the measure. */
  private quote(c: CanvasRenderingContext2D, r: number, x: number, y: number, v: number) {
    const m = this.msgs[r]!;
    avatar(c, m.user, x + 12, y, 12);
    c.textBaseline = 'middle';
    c.font = fnt(SANS, 24, 700);
    c.fillStyle = tone(v);
    const h = '@' + USERS[m.user]!.h;
    c.fillText(h, x + 34, y);
    let tx = x + 46 + c.measureText(h).width;
    c.font = fnt(SANS, 24, 400);
    c.fillStyle = tone(v - 0.12);
    for (const u of m.kao ? [{ glyph: m.kao }] : m.us) {
      const w = c.measureText(u.glyph).width;
      if (tx + w > TR - 40) { c.fillText('...', tx, y); break; }
      c.fillText(u.glyph, tx, y);
      tx += w;
    }
    c.textBaseline = 'alphabetic';
  }

  /** The server rail: the seal is this server; another one has unread mentions in red, ticking on the kicks. */
  private rail(c: CanvasRenderingContext2D, unread: number, ka: number) {
    const cx = RAIL / 2;
    c.fillStyle = tone(0.24);
    c.beginPath();
    c.arc(cx, 56, 34, 0, Math.PI * 2);
    c.fill();
    seal(c, cx, 56, 30, 'ink', SANS);
    c.fillStyle = tone(0.3);
    c.fillRect(cx - 22, 106, 44, 3);
    const ini = ['P', 'S', 'T', 'M'];
    ini.forEach((s, k) => {
      const y = 160 + k * 92;
      c.fillStyle = tone(0.3 + k * 0.05);
      c.beginPath();
      c.arc(cx, y, 34, 0, Math.PI * 2);
      c.fill();
      c.font = fnt(SANS, 30, 700);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = tone(0.9);
      c.fillText(s, cx, y + 2);
      if (k === 1) badge(c, String(unread), cx + 24, y + 24, ka === 0 ? 1.5 : ka === 1 ? 1.2 : 1);
    });
    c.textAlign = 'left';
  }

  /** The channel sidebar; # beam counts the plate's messages and the mentions, popping on the snares. */
  private sidebar(c: CanvasRenderingContext2D, plate: number, sa: number) {
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.font = fnt(SANS, 30, 700);
    c.fillStyle = tone(0.95);
    c.fillText('ppoi club', RAIL + 28, TOP / 2);
    c.font = font(MONO, 24);
    c.fillStyle = tone(0.62);
    c.fillText('TEXT CHANNELS', RAIL + 28, 124);
    const ch = ['general', 'sermon', 'kami-ppoi', 'beam', 'nemui', 'off-topic'];
    ch.forEach((s, k) => {
      const y = 170 + k * 56;
      c.font = fnt(SANS, 30, k === 2 ? 700 : 400);
      c.fillStyle = tone(k === 2 ? 0.97 : k === 3 ? 0.88 : 0.55);
      c.fillText('#  ' + s, RAIL + 32, y + 2);
      if (k === 3 && plate > 0) badge(c, String(plate), SIDE - 48, y, sa === 0 ? 1.6 : sa === 1 ? 1.25 : 1);
    });
    // the user panel
    c.fillStyle = tone(0.12);
    c.fillRect(RAIL, H - 100, SIDE - RAIL, 100);
    avatar(c, 0, RAIL + 50, H - 50, 26);
    c.font = fnt(SANS, 28, 700);
    c.fillStyle = tone(0.95);
    c.fillText('you', RAIL + 92, H - 62);
    c.font = font(MONO, 24);
    c.fillStyle = tone(0.62);
    c.fillText('idle', RAIL + 92, H - 32);
  }

  /** The member list: the last poster in bold; the members who react on a kick get a ring for 4 steps. */
  private members(c: CanvasRenderingContext2D, shown: Msg[], t: number) {
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.font = font(MONO, 24);
    c.fillStyle = tone(0.62);
    c.fillText(`ONLINE - ${USERS.length}`, MEM + 28, 124);
    const lastU = shown[shown.length - 1]!.user;
    const ring = new Set<number>();
    for (const h of this.hits) {
      const a = age(t, h.t);
      if (a >= 0 && a < 4) ring.add(Math.floor(hash(h.seed, 11) * USERS.length));
    }
    USERS.forEach((u, k) => {
      const y = 180 + k * 72;
      if (ring.has(k)) {
        c.strokeStyle = tone(0.97);
        c.lineWidth = 4;
        c.beginPath();
        c.arc(MEM + 56, y, 31, 0, Math.PI * 2);
        c.stroke();
      }
      avatar(c, k, MEM + 56, y, 24);
      c.textBaseline = 'middle';
      c.textAlign = 'left';
      c.font = fnt(SANS, 28, k === lastU || ring.has(k) ? 700 : 400);
      c.fillStyle = tone(k === lastU || ring.has(k) ? 0.97 : 0.62);
      c.fillText(u.h, MEM + 94, y + 2);
    });
  }
}

/**
 * A slit onto red from (x0, y0) to past the right edge at the slope, w px thick at the edge. It fires in 3 steps
 * (a steps after its onset): it shoots out to 40 % and 80 % of its run, twice and 1.4x as thick, then holds.
 */
function slit(c: CanvasRenderingContext2D, x0: number, y0: number, slope: number, w: number, a: number) {
  if (a < 0) return;
  const ext = a === 0 ? 0.4 : a === 1 ? 0.8 : 1;
  const ww = w * (a === 0 ? 2.6 : a === 1 ? 1.6 : 1);
  const x1 = x0 + (W + 400 - x0) * ext;
  const y1 = y0 + slope * (x1 - x0);
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.beginPath();
  c.moveTo(x0, y0 - ww * 0.15);
  c.lineTo(x1, y1 - ww / 2);
  c.lineTo(x1, y1 + ww / 2);
  c.lineTo(x0, y0 + ww * 0.15);
  c.closePath();
  c.fill();
  c.restore();
}

/** A round avatar: a gray disc and an initial, or the seal. */
function avatar(c: CanvasRenderingContext2D, user: number, x: number, y: number, r: number) {
  const u = USERS[user]!;
  c.save();
  c.fillStyle = u.seal ? tone(0.1) : tone(u.tone);
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

/** A red unread pill with a count in paper, at scale s (it pops when it ticks). */
function badge(c: CanvasRenderingContext2D, text: string, x: number, y: number, s = 1) {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  c.font = fnt(SANS, 22, 700);
  const w = Math.max(34, c.measureText(text).width + 18);
  c.fillStyle = RED;
  roundRectFill(c, -w / 2, -17, w, 34, 17);
  c.fillStyle = PAPER;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, 0, 1);
  c.restore();
}

/** A mono label, larger than the kit's rebate: on this screen 12 px would not survive the saves. */
function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign = 'left') {
  c.font = font(MONO, 24);
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.fillStyle = tone(0.8);
  c.fillText(text, x, y);
}
