// Plate 5 · The parrot (Interlude, 103 BPM). One gloss page, set one glyph at a time from the sermon (lines
// 37-40), read right to left, typed through a Japanese input method. Before each glyph its reading (kana of
// the sung syllables, parrot-ime.ts) is typed at the cursor, kana by kana, on a dotted underline; then the
// underline turns solid (conversion) and a numbered candidate window pops open beside it: the glyphs of the same
// reading, first in table order, then sorted into their ranks under a character bigram of the song's own lines
// (parrot-ngram.ts), with true ranks and p. On the onset the sung glyph is committed; if it was not candidate 1
// the highlight steps down to it and it commits in red. The committed window folds onto its chosen row.
// 灯り lights a flame-shaped hole; 否 fills the seal with ink and 小物 opens a hole in it; 自戒の祈り closes
// the windows and the fans. "Do you know?" and the end of the plate are the transition divider.ts: the red room
// of the call, with the last fan and window, and the press that closes it on bored. GEN holds.
//
// Motion (v4), in 24 fps steps:
// - Voice: each committed glyph strikes in as a block (ink, or red for a surprise) with the glyph cut out, a
//   size up, then prints. The reading types in, the underline steps from dotted to solid, the window pops,
//   sorts and folds.
// - Kick (one per bar): the prediction fan bursts from the cursor: the parrot's whole next-glyph distribution
//   after the last glyph, top 11 with true p, glyph size by p. While it is open, every onset re-ranks it: the
//   sung glyph is struck in its ray, the parrot's first guess is crossed out when it was wrong, and the glyphs
//   move to their ranks after the new glyph. It closes from the lowest rank before the next bar.
// - Hat: the cursor blinks, the predictive ghost under it steps through the parrot's top three, and the
//   parrot's wrong guesses pop beside the committed glyphs, then stay there in gray, struck out (density grows).
// - Snare: the parrot "corrects" a glyph it did not predict to its own first choice, then the sung glyph
//   stamps back.
// - The call: see divider.ts.
import type * as THREE from 'three';
import type { Frame, PostOverrides } from '@pve/engine/scene';
import { H, W } from '@pve/engine/gl';
import { drawV, font } from '@pve/engine/type';
import { clamp, hash, lerp, stepN } from '@pve/engine/util';
import { lineNo, units, type Line, type WrittenUnit } from '@pve/engine/lyrics';
import {
  copyTimes, GLOSS, fnt, genAt, INK, MONO, PageScene, PAPER, POST, rebate, RED, seal, SERIF, statusLine, tone, VOICE,
  type SurfaceOpts,
} from './_page';
import { PARROT } from './_era_parrot';
import { Bigram, clean, START } from './parrot-ngram';
import { candidates, reading, type ImeCand } from './parrot-ime';
import {
  age, COL_STEP, drawWindow, FAN, fanSet, FPS, lastAt, MAX_ROWS, placeSermon, READ_SIZE, ROW, SIZE, TOP, W_GAP,
  W_SEP, WW, X0, type FanItem, type FanSet, type Win,
} from './parrot-ui';

const FIRST = 37;
const LAST = 40;
/** The windows close at this glyph of line 40 (自戒の祈り). */
const CLOSE = '自';
/** The plate starts here (video.json: section Interlude); the first window opens no earlier. */
const PLATE_START = 92.12;
/** Lead of the first window of a line that follows a pause. */
const LEAD = 0.45;
/** Steps a fan stays open after a kick. */
const FAN_HOLD = 30;
/** Steps of a snare correction (the last one stamps the sung glyph back). */
const FIX_STEPS = 7;
/**
 * A candidate window opens this many steps before its onset (a syllable lasts about 3.5), so it is up for about
 * half a second: the table order, the sort into ranks, the highlight stepping down to the sung row. After the
 * onset it holds (longer when the glyph was a surprise), then folds in FOLD steps. A window never moves: it
 * stands at the place it got when the scene was laid out (`planWindows`).
 */
const WIN_LEAD = 7;
const WIN_HOLD = 1;
const WIN_HOLD_RED = 14;
const FOLD = 3;
/** Left limit of a window. */
const MIN_X = 24;


interface Slot {
  line: number;
  u: WrittenUnit;
  /** The sung glyph without punctuation, and its first character (what the fan predicts). */
  sung: string;
  ch: string;
  x: number;
  /** Top of the slot. */
  y: number;
  /** Cells down the column. */
  rows: number;
  /** The reading and its window, or none (the windows are closed from 自). */
  ime: (Win & { read: string }) | null;
  /** When the reading starts typing, and the steps it types for before the window opens. */
  open: number;
  typing: number;
  /** Window: when it opens and folds away, and where its right edge stands. */
  wOpen: number;
  wClose: number;
  wRight: number;
  rank: number;
  red: boolean;
  /** The parrot's prediction for this glyph (the distribution after the glyph before it). */
  fan: FanSet;
  /** The parrot's best guesses for this glyph that are not the sung one. */
  guesses: string[];
}

interface Gloss { line: Line; x: number }


export default class Parrot extends PageScene {
  private slots: Slot[] = [];
  private starts: number[] = [];
  private glosses: Gloss[] = [];
  private copies: number[] = [];
  private flame: { from: number; x: number; y: number } | null = null;
  private inkAt = 0;
  private smallAt = 0;
  /** When the windows and fans close (自). */
  private closeT = Infinity;
  private kicks: number[] = [];
  private hats: number[] = [];
  /** The first hat of the plate. */
  private h0 = 0;
  /** The fans: one burst per kick until 自. */
  private burstTimes: number[] = [];
  /** Snare corrections: the slot and the parrot's own choice for it. */
  private fixes: { at: number; j: number; glyph: string }[] = [];
  private fixTimes: number[] = [];
  /** The x of each column. */
  private cols: number[] = [];
  // per-frame scratch of the hat pops (no allocation per frame)
  private popN = new Int16Array(0);
  private popAt = new Float64Array(0);
  private callStart = VOICE.find((c) => c.id === 'doyouknow')!.start;

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    if (f.t >= this.callStart) return POST;
    return super.render(f, out);
  }

  override async init() {
    this.warm([PARROT]);
    const L = this.ctx.lyrics;
    this.copies = copyTimes(L);
    const model = new Bigram(L.lines.map((l) => {
      if (!l.written) throw new Error(`line ${l.i} has no written form`);
      return l.written.jp;
    }));

    const lay = placeSermon(L, FIRST, LAST);
    let prevStart = PLATE_START;
    let closed = false;
    for (let i = FIRST; i <= LAST; i++) {
      const line = lineNo(L, i);
      const us = units(line);
      const place = lay[i - FIRST]!;
      this.glosses.push({ line, x: place.x });
      let prev = START;
      us.forEach((u, k) => {
        const { x, y, rows } = place.cells[k]!;
        const sung = clean(u.glyph);
        const ch = [...sung][0]!;
        if (i === LAST && sung.startsWith(CLOSE)) closed = true;
        const read = reading(line, u);
        const win = candidates(model, prev, read, sung);
        const rank = win.cands[win.row]!.rank;
        const open = k === 0 ? Math.max(prevStart, u.start - LEAD) : prevStart;
        const dist = model.next(prev);
        this.slots.push({
          line: i, u, sung, ch, x, y, rows,
          ime: closed ? null : { read, ...win, table: tableRows(win.cands) },
          open, typing: Math.max(1, Math.min([...read].length, Math.ceil(age(u.start, open) * 0.4))),
          rank, red: !closed && rank > 1, wOpen: 0, wClose: 0, wRight: 0,
          fan: fanSet(x - SIZE / 2 - 6, y + SIZE / 2, dist.slice(0, FAN), prev),
          guesses: dist.filter((c) => c.ch !== ch).slice(0, 3).map((c) => c.ch),
        });
        prevStart = u.start;
        prev = [...sung].pop()!;
      });
    }
    this.planWindows();
    this.starts = this.slots.map((s) => s.u.start);
    this.popN = new Int16Array(this.slots.length);
    this.popAt = new Float64Array(this.slots.length);

    const find = (line: number, g: string) => {
      const s = this.slots.find((s) => s.line === line && s.u.glyph.startsWith(g));
      if (!s) throw new Error(`${g} not in line ${line}`);
      return s;
    };
    // 灯り: the flame burns under the column, below り
    const lamp = find(38, '灯');
    const end38 = this.slots.filter((s) => s.line === 38).pop()!;
    this.flame = { from: lamp.u.start, x: end38.x, y: end38.y + end38.rows * ROW + 120 };
    this.inkAt = find(39, '否').u.start;
    this.smallAt = find(39, '小').u.start;
    this.closeT = find(LAST, CLOSE).u.start;

    // the drums of the plate
    const au = this.ctx.audio;
    const ev = (k: string) => au.events(k, this.ctx.start - 1, this.ctx.end + 1).map(([t]) => t);
    this.kicks = ev('kick');
    this.hats = ev('hat');
    this.h0 = lastAt(this.hats, this.ctx.start - 1e-3) + 1;
    this.burstTimes = this.kicks.filter((k) => k >= this.ctx.start - 0.05 && k < this.closeT);
    // the snare corrects the newest glyph the parrot did not expect: a red one first, else one whose first
    // guess was another glyph (never the glyph just sung)
    for (const at of ev('snare')) {
      if (at < this.ctx.start || at >= this.closeT) continue;
      const m = lastAt(this.starts, at);
      let j = -1;
      for (let k = m - 1; k >= 0 && j < 0; k--) if (this.slots[k]!.red) j = k;
      for (let k = m - 1; k >= 0 && j < 0; k--) if (this.slots[k]!.fan.items[0]!.ch !== this.slots[k]!.ch) j = k;
      if (j < 0) continue;
      const s = this.slots[j]!;
      const own = s.red ? s.ime!.cands[0]! : null;
      this.fixes.push({ at, j, glyph: own ? own.s : s.fan.items[0]!.ch });
    }
    this.fixTimes = this.fixes.map((x) => x.at);
    this.cols = [...new Set(this.slots.map((s) => s.x))];
  }

  draw(c: CanvasRenderingContext2D, f: Frame): SurfaceOpts {
    const t = f.t;
    c.fillStyle = PAPER;
    c.fillRect(0, 0, W, H);

    // ruling: a scored line beside each column, faint
    c.fillStyle = tone(0.84);
    for (const x of this.cols) c.fillRect(x - COL_STEP / 2, 116, 1, TOP + MAX_ROWS * ROW - 80);
    c.fillRect(X0 + COL_STEP / 2 + 20, 116, 1, TOP + MAX_ROWS * ROW - 80);

    // the gloss: Fraktur along the first column of each line, phrase by phrase as they are sung
    for (const g of this.glosses) {
      const text = g.line.written!.phrases.filter((ph) => ph.start <= t).map((ph) => ph.text).join(' ');
      if (!text) continue;
      c.save();
      c.translate(g.x + 46, TOP + 4);
      c.rotate(Math.PI / 2);
      c.fillStyle = INK;
      c.font = fnt(GLOSS, 21);
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(text, 0, 0);
      c.restore();
    }

    const nx = lastAt(this.starts, t) + 1; // the slot to be committed next (slots.length after the last)
    this.fan(c, t, nx);
    this.pops(c, t);

    // the committed glyphs: each strikes in as a block; a surprise is red, with its rank beside it
    const fi = lastAt(this.fixTimes, t);
    const fix = fi >= 0 && age(t, this.fixes[fi]!.at) < FIX_STEPS ? this.fixes[fi]! : null;
    for (let j = 0; j < nx; j++) {
      const s = this.slots[j]!;
      if (fix && fix.j === j) {
        const a = age(t, fix.at);
        if (a < FIX_STEPS - 1) {
          this.block(c, fix.glyph, s, a === 0 ? 1.3 : 1, INK);
          c.font = font(MONO, 12);
          c.textAlign = 'right';
          c.textBaseline = 'top';
          c.fillStyle = INK;
          c.fillText('#1', s.x - SIZE * 0.62, s.y + 2);
          continue;
        }
        this.block(c, s.u.glyph, s, 1.15, s.red ? RED : INK);
        continue;
      }
      const a = age(t, s.u.start);
      if (a <= 1) this.block(c, s.u.glyph, s, a === 0 ? 1.3 : 1.1, s.red ? RED : INK);
      else {
        c.fillStyle = s.red ? RED : INK;
        drawV(c, s.u.glyph, s.x, s.y, SIZE, SERIF, 500);
      }
      if (s.red) {
        c.font = font(MONO, 11);
        c.textAlign = 'right';
        c.textBaseline = 'top';
        c.fillStyle = INK;
        c.fillText(`#${s.rank}`, s.x - SIZE / 2 - 4, s.y + 4);
      }
    }

    // the flame of 灯り, a hole onto red, 8 fps
    if (this.flame && t >= this.flame.from) this.flameHole(c, this.flame.x, this.flame.y, stepN(t, 8));
    this.seal(c, t);

    // the glyph being converted: its reading typing at the cursor, the underline, the cursor
    const hatI = lastAt(this.hats, t);
    const caretOn = hatI % 2 === 0;
    const next = this.slots[nx];
    if (next?.ime && t >= next.open) {
      const k = age(t, next.open);
      const kana = [...next.ime.read];
      const shown = Math.min(kana.length, Math.floor(((k + 1) * kana.length) / next.typing));
      const conv = k >= next.typing;
      c.fillStyle = INK;
      const bottom = drawV(c, kana.slice(0, shown).join(''), next.x, next.y + 4, READ_SIZE, SERIF, 400);
      // the underline: dotted while typing, solid once converting
      const ux = next.x - READ_SIZE / 2 - 9;
      if (conv) c.fillRect(ux, next.y + 4, 5, bottom - next.y - 4);
      else for (let y = next.y + 4; y < bottom; y += 9) c.fillRect(ux + 1, y, 3, 4);
      if (caretOn) c.fillRect(next.x - READ_SIZE / 2 - 4, bottom + 5, READ_SIZE + 8, 5);
      if (!conv) {
        // the predictive ghost: the parrot's next guesses in turn, one per hat
        const g = next.fan.items[(hatI - lastAt(this.hats, next.open)) % 3]!;
        c.fillStyle = tone(0.62);
        drawV(c, g.ch, next.x, bottom + 16, READ_SIZE, SERIF, 400);
        c.font = font(MONO, 11);
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.fillText(g.p.toFixed(3), next.x + READ_SIZE / 2 + 6, bottom + 16 + READ_SIZE / 2);
      }
    } else {
      // no reading: the cursor rests under the newest glyph
      const s = this.slots[nx - 1];
      if (s && caretOn) {
        c.fillStyle = INK;
        c.fillRect(s.x - SIZE / 2 - 4, s.y + s.rows * ROW + 6, SIZE + 8, 5);
      }
    }
    this.windows(c, t, nx);

    const gen = genAt(this.copies, this.ctx.lyrics, t);
    const s = this.slots[Math.max(0, nx - 1)]!;
    rebate(c, `LINE ${s.line}   BAR ${Math.floor(f.bar)}`, W - 96, 60, 'right');
    statusLine(c, gen, t);

    return { era: PARROT, gen };
  }

  /** A committed glyph as a block (ink or red) with the glyph cut out in paper, scaled about its centre. */
  private block(c: CanvasRenderingContext2D, glyph: string, s: Slot, k: number, fill: string) {
    const h = s.rows * SIZE + 8;
    const cy = s.y + h / 2 - 4;
    c.save();
    c.translate(s.x, cy);
    c.scale(k, k);
    c.translate(-s.x, -cy);
    c.fillStyle = fill;
    c.fillRect(s.x - SIZE * 0.58, s.y - 4, SIZE * 1.16, h);
    c.fillStyle = PAPER;
    drawV(c, glyph, s.x, s.y, SIZE, SERIF, 500);
    c.restore();
  }

  /** The seal: a hole, then ink rises in it on 否 (six steps), then 小物 is cut out of the ink. */
  private seal(c: CanvasRenderingContext2D, t: number) {
    const sx = 300, sy = 840, sr = 110;
    const a = age(t, this.inkAt);
    if (a < 6) seal(c, sx, sy, sr, 'hole');
    if (a < 0) return;
    const level = Math.min(1, (a + 1) / 6);
    c.save();
    c.beginPath();
    c.rect(sx - sr - 2, sy + sr - 2 * sr * level, 2 * sr + 4, 2 * sr * level + 2);
    c.clip();
    c.fillStyle = INK;
    c.beginPath();
    c.arc(sx, sy, sr, 0, Math.PI * 2);
    c.fill();
    c.restore();
    const b = age(t, this.smallAt);
    if (b < 0) return;
    const k = b === 0 ? 1.3 : b === 1 ? 1.1 : 1;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.translate(sx, sy + 4);
    c.scale(k, k);
    c.font = fnt(SERIF, 86, 700);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('小物', 0, 0);
    c.restore();
  }

  /**
   * The prediction fan of the last burst at t. While it is open each onset re-ranks it: on the onset step the
   * old fan shows the sung glyph struck in its ray and the parrot's first guess crossed out when it was wrong,
   * the next step the glyphs move halfway to their new ranks and the new ones pop, then the new fan prints.
   */
  private fan(c: CanvasRenderingContext2D, t: number, nx: number) {
    const bi = lastAt(this.burstTimes, t);
    if (bi < 0) return;
    const at = this.burstTimes[bi]!;
    const a = age(t, at);
    if (a >= FAN_HOLD) return;
    const s = this.slots[nx];
    if (!s?.ime) return;
    const cur = s.fan;
    let prev: FanSet | null = null;
    let tb = 9;
    let hit = '';
    let hitRed = false;
    const p = this.slots[nx - 1];
    if (p && p.u.start > at) {
      tb = age(t, p.u.start);
      if (tb < 2) { prev = p.fan; hit = p.ch; hitRed = p.red; }
    }
    const reach = a === 0 ? 0.55 : 1;
    const n = Math.min(cur.items.length, FAN_HOLD - a);
    const set = tb === 0 && prev ? prev : cur;
    const ox = tb === 1 && prev ? lerp(prev.ox, cur.ox, 0.5) : set.ox;
    const oy = tb === 1 && prev ? lerp(prev.oy, cur.oy, 0.5) : set.oy;

    // the rays: as thick as p
    c.strokeStyle = tone(0.5);
    for (let k = 0; k < Math.min(n, set.items.length); k++) {
      const it = set.items[k]!;
      const [x, y] = this.at(it, prev, cur, tb);
      const dx = x - ox, dy = y - oy;
      const len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len;
      const r1 = len * reach - it.size * 0.7;
      c.lineWidth = 1 + 7 * it.p;
      c.beginPath();
      c.moveTo(ox + ux * 70, oy + uy * 70);
      c.lineTo(ox + ux * Math.max(80, r1), oy + uy * Math.max(80, r1));
      c.stroke();
    }
    if (a === 0) return;

    // the glyphs: a block burst (1.3, then 1), then print with their p
    for (let k = 0; k < Math.min(n, set.items.length); k++) {
      const it = set.items[k]!;
      const [x, y] = this.at(it, prev, cur, tb);
      const isNew = tb === 1 && prev !== null && !prev.items.some((q) => q.ch === it.ch);
      const isHit = tb === 0 && it.ch === hit;
      const burst = a <= 2 || isNew || isHit;
      const sc = isHit ? 1.25 : a === 1 || isNew ? 1.3 : 1;
      c.font = fnt(SERIF, it.size, 500);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      if (burst) {
        const h = it.size * 1.12 * sc;
        c.fillStyle = isHit && hitRed ? RED : INK;
        c.fillRect(x - h / 2, y - h / 2, h, h);
        c.save();
        c.fillStyle = PAPER;
        c.translate(x, y);
        c.scale(sc, sc);
        c.fillText(it.ch, 0, 0);
        c.restore();
      } else {
        c.fillStyle = INK;
        c.fillText(it.ch, x, y);
      }
      // the parrot's first guess, crossed out when the sung glyph was another
      if (tb === 0 && k === 0 && it.ch !== hit) {
        c.fillStyle = INK;
        c.save();
        c.translate(x, y);
        c.rotate(-0.6);
        c.fillRect(-it.size * 0.75, -3, it.size * 1.5, 6);
        c.restore();
      }
      c.fillStyle = INK;
      c.font = font(MONO, 11);
      c.textBaseline = 'top';
      c.fillText(`${k + 1}  ${it.p.toFixed(3)}`, x, y + it.size * 0.62 + 4);
    }
    // what it predicts after
    const top = set.items[0]!;
    c.font = font(MONO, 12);
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.fillStyle = INK;
    c.fillText(`next | ${set.after === START ? '^' : set.after}`, top.x, top.y - top.size * 0.62 - 6);
  }

  /** Where a fan glyph stands: on the step after an onset, halfway from its old rank to its new one. */
  private at(it: FanItem, prev: FanSet | null, cur: FanSet, tb: number): [number, number] {
    if (tb !== 1 || !prev) return [it.x, it.y];
    const q = prev.items.find((o) => o.ch === it.ch);
    if (!q) return [it.x, it.y];
    const to = cur.items.find((o) => o.ch === it.ch) ?? it;
    return [lerp(q.x, to.x, 0.5), lerp(q.y, to.y, 0.5)];
  }

  /**
   * The parrot's wrong guesses: on a hat (more of them as the plate goes on) one committed glyph gets the
   * parrot's next best guess for it popped beside it (an inverted sort for two steps); it stays there in gray,
   * struck out. None from 自 on.
   */
  private pops(c: CanvasRenderingContext2D, t: number) {
    this.popN.fill(0);
    const end = Math.min(t, this.closeT);
    const span = this.closeT - this.ctx.start;
    for (let h = this.h0; h < this.hats.length && this.hats[h]! <= end; h++) {
      const th = this.hats[h]!;
      if (hash(h, 3) > 0.3 + 0.55 * clamp((th - this.ctx.start) / span)) continue;
      const m = lastAt(this.starts, th) + 1;
      if (m < 3) continue;
      const j = Math.floor(hash(h, 7) * (m - 2));
      const s = this.slots[j]!;
      if (s.red || !s.guesses.length) continue;
      this.popN[j]!++;
      this.popAt[j] = th;
    }
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const settled: { x: number; y: number; col: number; row: number }[] = [];
    for (let j = 0; j < this.slots.length; j++) {
      const n = this.popN[j]!;
      if (!n) continue;
      const s = this.slots[j]!;
      const g = s.guesses[(n - 1) % s.guesses.length]!;
      const x = s.x - COL_STEP / 2 + 4;
      const y = s.y + SIZE / 2;
      const a = age(t, this.popAt[j]!);
      if (a <= 1) {
        const z = a === 0 ? 46 : 36;
        c.fillStyle = INK;
        c.fillRect(x - z / 2, y - z / 2, z, z);
        c.fillStyle = PAPER;
        c.font = fnt(SERIF, Math.round(z * 0.8), 500);
        c.fillText(g, x, y);
        continue;
      }
      c.fillStyle = tone(0.5);
      c.font = fnt(SERIF, 24, 400);
      c.fillText(g, x, y);
      settled.push({ x, y, col: s.x, row: Math.round(s.y / ROW) });
    }
    // in vertical Japanese, strikethroughs run as a single vertical line straight down through the characters
    if (settled.length) {
      c.fillStyle = INK;
      const byCol = new Map<number, { x: number; y: number; row: number }[]>();
      for (const item of settled) {
        let list = byCol.get(item.col);
        if (!list) byCol.set(item.col, (list = []));
        list.push(item);
      }
      for (const list of byCol.values()) {
        list.sort((p, q) => p.y - q.y);
        let startY = list[0]!.y, endY = list[0]!.y, curRow = list[0]!.row, curX = list[0]!.x;
        for (let i = 1; i < list.length; i++) {
          const item = list[i]!;
          if (item.row === curRow + 1) {
            endY = item.y;
            curRow = item.row;
          } else {
            c.fillRect(curX - 1, startY - 15, 2, endY - startY + 30);
            startY = endY = item.y;
            curRow = item.row;
            curX = item.x;
          }
        }
        c.fillRect(curX - 1, startY - 15, 2, endY - startY + 30);
      }
    }
  }

  /**
   * Where and when each candidate window stands, laid out once. A window sits left of its cursor; if an open
   * window is in the way it goes left of that one. When no place is left, the window that folds first is cut short.
   */
  private planWindows() {
    const live: Slot[] = [];
    for (const s of this.slots) {
      if (!s.ime) continue;
      s.wOpen = Math.max(PLATE_START, s.u.start - WIN_LEAD / FPS);
      s.wClose = s.u.start + (s.red ? WIN_HOLD_RED : WIN_HOLD) / FPS + FOLD / FPS;
      for (let i = live.length - 1; i >= 0; i--) if (live[i]!.wClose <= s.wOpen) live.splice(i, 1);
      const natural = s.x - SIZE / 2 - W_GAP;
      for (;;) {
        const free = [natural, ...live.map((a) => a.wRight - WW - W_SEP)]
          .sort((a, b) => b - a)
          .find((r) => r - WW >= MIN_X && live.every((a) => r <= a.wRight - WW - W_SEP || r - WW >= a.wRight + W_SEP));
        if (free !== undefined || !live.length) { s.wRight = free ?? natural; break; }
        let first = 0;
        live.forEach((a, i) => { if (a.wClose < live[first]!.wClose) first = i; });
        const cut = live.splice(first, 1)[0]!;
        cut.wClose = Math.max(s.wOpen, cut.u.start + 1 / FPS);
      }
      live.push(s);
    }
  }

  /** The candidate windows open at t, oldest first (the newest stands on top). */
  private windows(c: CanvasRenderingContext2D, t: number, nx: number) {
    if (t >= this.closeT) return;
    const ts = stepN(t, FPS);
    for (let j = Math.max(0, nx - 12); j < Math.min(this.slots.length, nx + 5); j++) {
      const s = this.slots[j]!;
      if (!s.ime || t < s.wOpen || t >= s.wClose) continue;
      const a = ts - stepN(s.wOpen, FPS);
      const before = stepN(s.u.start, FPS) - ts;
      const done = before <= 0;
      // the highlight steps down to the sung row in the three steps before the onset
      const hi = done ? s.ime.row : Math.floor(s.ime.row * clamp((4 - before) / 3));
      const fold = done ? clamp((ts - (stepN(s.wClose, FPS) - FOLD)) / FOLD) : 0;
      drawWindow(c, s.ime, hi, s.wRight, s.y, done && s.red ? 'red' : 'ink', a, clamp((a - 2) / 2), fold);
    }
  }

  /** A flame-shaped hole standing on (x, y), drawn anew on each 8 fps step k. */
  private flameHole(c: CanvasRenderingContext2D, x: number, y: number, k: number) {
    const h = 96 * (0.84 + 0.28 * hash(k, 1));
    const w = 38 * (0.86 + 0.24 * hash(k, 2));
    const sway = (hash(k, 3) - 0.5) * 18;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    c.moveTo(x + sway, y - h);
    c.quadraticCurveTo(x + w * 0.78 + sway * 0.3, y - h * 0.42, x + w / 2, y - w / 2);
    c.arc(x, y - w / 2, w / 2, 0, Math.PI);
    c.quadraticCurveTo(x - w * 0.78 + sway * 0.3, y - h * 0.42, x + sway, y - h);
    c.fill();
    c.restore();
  }
}

/** Each window row's place when the candidates stand in table order (before any learning). */
function tableRows(cands: ImeCand[]): number[] {
  const order = cands.map((cd, k) => [cd.i, k] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(cands.length);
  order.forEach(([, k], r) => { out[k] = r; });
  return out;
}

