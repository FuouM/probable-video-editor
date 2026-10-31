// Plate 3 · The entries (modernist). A Swiss grid dictionary page in Gothic: 12 columns, the headword of the
// line in the left four, the entries in the right eight. Line 18 cuts a fresh seal (the largest red so far) that
// the next copies close; line 27 opens it again. Line 19 drops the IQ: on each syllable of 下がっていく the line
// re-renders on a grid half as fine, the true cells per em printed as IQ n. Lines 20-21 print in negative.
// Each その〇〇 of lines 22-23 and 25-26 is an entry with a cross-reference → 神, and the references run as red
// leaders down the gutters into the seal; lines 24 and 27 set the entries side by side in two columns (比況,
// comparison). Line 28 copies ぽい three times. The "My God" calls cut the page open onto red (voice-call.ts), and
// the page that closes over it is one generation older.
//
// Motion (v4), all in 24 fps steps:
// - Voice: each glyph strikes in as an inverted sort (a size up, then in place), then prints. The cursor stands
//   after the newest glyph, the column under it is lit (tabs on the head and foot rules, a dot band in the free
//   rows). A new line wipes the page column by column behind a black bar.
// - Kick: the head rule slams, the seal punches, the red plate jumps off register, registration marks pop on grid
//   crossings, heavy rules shoot across the free rows, the entry number ticks, packets run down the leaders to 神.
// - Snare: a random set of the printed glyphs inverts; a big sort drops into a free cell.
// - Hat: offset-dot fields flash in free cells and fade by the screen.
// - Density (the number of marks per hit) grows with the plate and the generations.
// - "My God": the page is cut open on the seal.
import type { Frame } from '@pve/engine/scene';
import { H, W } from '@pve/engine/gl';
import { hash, stepN } from '@pve/engine/util';
import { lineNo, syllables, units, type Line, type WrittenPhrase, type WrittenUnit } from '@pve/engine/lyrics';
import {
  copyTimes, fnt, genAt, INK, PageScene, PAPER, rebate, RED, SANS, statusLine, tone, VOICE,
  type SurfaceOpts,
} from './_page';
import { MODERN } from './_era_modern';
import { closeAt, drawCall, fitCall } from './voice-call';

// ---------- the grid ----------
const M = 96; // margin
const GUT = 24;
const CW = 122; // 12 columns: 12 * 122 + 11 * 24 = 1728 = W - 2M
const colX = (i: number) => M + i * (CW + GUT);
const span = (n: number) => n * CW + (n - 1) * GUT;
const LX = colX(0);
const LW = span(4); // the headword and the seal
const RX = colX(4);
const RW = span(8); // the entries
const TOP = 176; // first line of the content
const FOOT = H - 108; // the foot rule
const ROW = CW + GUT; // the rows of the grid are as high as the columns are wide
const ROWS = 5; // rows of cells between TOP and FOOT
/**
 * The grid of the page: hairlines on the margins and in the gutters. The call that closes into this plate (voice.ts)
 * draws the same, so the page it closes with is the page this plate opens on.
 */
export function entriesGrid(c: CanvasRenderingContext2D, neg = false) {
  c.fillStyle = tone(neg ? 0.28 : 0.72);
  c.fillRect(M, TOP - 24, 1, FOOT - TOP + 24);
  c.fillRect(W - M - 1, TOP - 24, 1, FOOT - TOP + 24);
  for (let i = 1; i < 12; i++) c.fillRect(colX(i) - GUT / 2, TOP - 24, 1, FOOT - TOP + 24);
}
/** The baseline of the rebates (generation, time) at the foot of the page. */
export const FOOT_TEXT_Y = H - 72;
/** The kami ring is pumped full from here on and leaks after LEAK_AT (note 728f). */
const PUMP_FROM = 65.49;
const LEAK_AT = 75.3;
/** The pool brims over the foot rule and runs off the page from here (bar 46). */
const SPILL_AT = 76.9;
const SEAL = { x: LX + LW / 2, y: 700, r: 262 };
const BUS_X = RX - GUT / 2; // the gutter between the headword block and the entries: the leaders run down it
/** Line 19 is set at 128 px, so IQ 128 (cells per em) is one cell per px: the line as it is. */
const IQ_EM = 128;
/** Layer step: everything that moves here moves in type steps. */
const FPS = 24;

const clean = (g: string) => g.replace(/[「」"]/g, '');

/** A run of units of one line: a headword, or one その〇〇 entry with its phrase. */
interface Group {
  line: Line;
  us: WrittenUnit[];
  from: number;
  to: number;
  phrase: WrittenPhrase;
  reading: string;
}

/** A glyph as printed on the page: what the music can pick up again. */
interface Sort {
  s: string;
  x: number;
  base: number;
  w: number;
  size: number;
  weight: number;
  red: boolean;
  start: number;
}

/** A cross-reference → 神 on the page: where its arrow is and when it printed. */
interface Ref {
  x: number;
  y: number;
  start: number;
}

/** The romaji of the words of `line` sung at or before t (and from t0 on). */
const reading = (line: Line, t: number, t0 = -Infinity, t1 = Infinity) =>
  line.words.filter((w) => w.start <= t && w.start >= t0 - 1e-3 && w.start < t1 - 1e-3).map((w) => w.w).join(' ');

/** Index of the last time in sorted `ts` at or before t, -1 before the first. */
function lastAt(ts: number[], t: number): number {
  let lo = 0, hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Steps (24 fps) from an onset to t. */
const age = (t: number, at: number) => stepN(t, FPS) - stepN(at, FPS);

export default class Entries extends PageScene {
  private times: number[] = [];
  private g0 = 0; // GEN when the plate starts (line 18)
  private gEnd = 1; // GEN when it ends
  private lines = new Map<number, Line>();
  private starts = new Map<number, number>();
  private heads = new Map<number, [number, number]>();
  private groups = new Map<number, Group[]>();
  private iqFrom = 0; // the unit of 下 in line 19
  private poi: number[] = []; // the units of the three ぽ of line 28
  private big: HTMLCanvasElement | null = null;
  private small: HTMLCanvasElement | null = null;
  private kicks: number[] = [];
  private snares: number[] = [];
  private hats: number[] = [];
  private pumpAt: number[] = []; // kicks that pump the ring, one equal step of the level each
  // what the page as drawn holds (reset on every page)
  private sorts: Sort[] = [];
  private refs: Ref[] = [];
  private yb = TOP; // the bottom of the content
  private K = INK;
  private bg = PAPER;

  override async init() {
    await super.init();
    this.warm([MODERN]);
    const L = this.ctx.lyrics;
    for (let i = 18; i <= 28; i++) {
      this.lines.set(i, lineNo(L, i));
      this.starts.set(i, syllables(this.line(i))[0]!.start);
    }
    const find = (i: number, head: string): [number, number] => {
      const us = units(this.line(i));
      const text = us.map((u) => clean(u.glyph));
      for (let k = 0; k < text.length; k++) {
        let acc = '', to = k;
        while (to < text.length && acc.length < head.length) acc += text[to++];
        if (acc === head) return [k, to];
      }
      throw new Error(`headword ${head} not in line ${i}`);
    };
    const HEAD: Record<number, string> = {
      18: '神っぽい', 19: 'IQ', 20: '邪心', 21: '害虫', 22: 'その', 23: 'その', 24: '比況', 25: 'その', 26: 'その',
      27: '卑怯', 28: 'ぽい',
    };
    for (const [i, h] of Object.entries(HEAD)) this.heads.set(+i, find(+i, h));
    // the その〇〇 entries: a group runs from そ+の to the next そ+の, one English phrase each
    for (const i of [22, 23, 25, 26]) {
      const line = this.line(i);
      const us = units(line);
      const w = line.written!;
      const starts: number[] = [];
      us.forEach((u, k) => { if (u.glyph === 'そ' && us[k + 1]?.glyph === 'の') starts.push(k); });
      if (starts.length !== w.phrases.length) throw new Error(`line ${i}: ${starts.length} その entries, ${w.phrases.length} phrases`);
      this.groups.set(i, starts.map((from, g) => {
        const to = starts[g + 1] ?? us.length;
        const t1 = to < us.length ? us[to]!.start : Infinity;
        return { line, us, from, to, phrase: w.phrases[g]!, reading: reading(line, Infinity, us[from]!.start, t1) };
      }));
    }
    this.iqFrom = find(19, '下')[0];
    const l28 = units(this.line(28));
    this.poi = l28.flatMap((u, k) => (u.glyph === 'ぽ' ? [k] : []));
    this.times = copyTimes(L);
    this.g0 = genAt(this.times, L, this.starts.get(18)!);
    this.gEnd = Math.max(this.g0 + 1, genAt(this.times, L, this.ctx.end - 0.01));
    const au = this.ctx.audio;
    const ev = (k: string) => au.events(k, this.ctx.start - 1, this.ctx.end + 1).map(([t]) => t);
    this.kicks = ev('kick');
    this.snares = ev('snare');
    this.hats = ev('hat');
    // each kick of the run sends one packet down every 神 leader already grown
    const refAt = [22, 23, 25, 26].flatMap((i) => this.groups.get(i)!.map((g) => g.us[g.to - 1]!.start));
    const full = this.starts.get(27)!;
    this.pumpAt = [];
    for (const k of this.kicks) {
      if (k < PUMP_FROM || k >= full || !refAt.some((s) => s <= k)) continue;
      this.pumpAt.push(k);
    }
    this.big = document.createElement('canvas');
    this.big.width = RW;
    this.big.height = 3 * Math.ceil(IQ_EM * 1.2);
    this.small = document.createElement('canvas');
  }

  private line(i: number): Line {
    return this.lines.get(i)!;
  }

  /** The line sung at t: the last of 18..28 that has started (18 before it). */
  private current(t: number): number {
    let cur = 18;
    for (let i = 19; i <= 28; i++) if (this.starts.get(i)! <= t) cur = i;
    return cur;
  }

  /** 0..1: how dense the marks are at t. Grows through the plate and with each copy. */
  private density(t: number, gen: number): number {
    const p = Math.min(1, Math.max(0, (t - this.ctx.start) / (this.ctx.end - this.ctx.start)));
    const g = Math.min(1, Math.max(0, (gen - this.g0) / (this.gEnd - this.g0)));
    return Math.min(1, 0.15 + 0.5 * p + 0.35 * g);
  }

  draw(c: CanvasRenderingContext2D, f: Frame): SurfaceOpts {
    const t = f.t;
    const cur = this.current(t);
    const gen = genAt(this.times, this.ctx.lyrics, t);

    const reg = this.page(c, t, cur, gen);

    // a new line wipes in column by column behind a black bar; the page before it stays right of the bar
    const t0 = this.starts.get(cur)!;
    const w = age(t, t0);
    if (cur > 18 && w >= 0 && w < 4) {
      const front = M + ((w + 1) / 5) * (W - 2 * M);
      c.save();
      c.beginPath();
      c.rect(front, 0, W - front, H);
      c.clip();
      this.page(c, t0 - 1e-3, cur - 1, genAt(this.times, this.ctx.lyrics, t0 - 1e-3));
      c.restore();
      c.fillStyle = INK;
      c.fillRect(front - CW, 0, CW, H);
      c.fillStyle = RED;
      c.fillRect(front - 8, 0, 8, H);
      this.page(c, t, cur, gen, true);
    }

    // "My God": red takes the frame with the call cut out of it, the page shows through the letters. The call
    // slams in a third too large about the middle of the frame for 3 steps, then sits.
    for (const v of VOICE) {
      if ((v.id === 'mygod1' || v.id === 'mygod2') && t >= v.start && t < v.end) {
        const set = fitCall(c, v.text, M, W - M, 900);
        if (age(t, v.start) < 3) {
          const k = 1.32;
          set.x = W / 2 - (W / 2 - set.x) * k;
          set.y = H / 2 + (set.y - H / 2) * k;
          set.size = Math.round(set.size * k);
        }
        drawCall(c, v.text, closeAt(t, v.end), set);
      }
    }

    const K = this.K;
    rebate(c, `LINE ${cur}   BAR ${Math.floor(f.bar)}`, W - M, 104, 'right', K);
    statusLine(c, gen, t, '', '', K);
    return { era: MODERN, gen, reg, p: [this.g0, 0, 0, 0] };
  }

  /**
   * The whole page at t with its motion. `onlyRefresh`: the page is already drawn (the wipe drew the page before
   * over part of it), only set the fields the frame reads after (K, bg). Returns the red plate's misregistration.
   */
  private page(c: CanvasRenderingContext2D, t: number, cur: number, gen: number, onlyRefresh = false): number {
    const neg = cur === 20 || cur === 21; // the grid prints in negative
    const K = neg ? PAPER : INK;
    this.K = K;
    this.bg = neg ? INK : PAPER;
    const d = this.density(t, gen);
    const ki = lastAt(this.kicks, t);
    const ka = ki >= 0 ? age(t, this.kicks[ki]!) : 99;
    let reg = 3 + 0.4 * (gen - this.g0) + (ka === 0 ? 12 : ka === 1 ? 6 : 0);
    if (cur === 28) reg += this.poiCopies(t);
    if (onlyRefresh) return reg;
    this.sorts = [];
    this.refs = [];
    this.yb = TOP;

    c.fillStyle = this.bg;
    c.fillRect(0, 0, W, H);

    // the grid: hairlines in the gutters and on the margins (before line 18 starts, only the bare grid shows through gott1)
    entriesGrid(c, neg);
    // the foot rule is part of the bare page too
    c.fillStyle = K;
    c.fillRect(M, FOOT, W - 2 * M, 2);
    if (t < this.starts.get(18)!) return reg;
    // the head: title, a heavy rule that slams on the kick, the entry number ticking; the foot: a thin rule
    c.fillStyle = K;
    c.font = fnt(SANS, 40, 700);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillText('ぽい辞書', M, 106);
    const slam = ka === 0 ? 22 : ka === 1 ? 14 : 8;
    c.fillRect(M, 124, W - 2 * M, slam);
    this.number(c, ki, ka, K);

    // "My God" cuts the page open and takes the seal: it is not on the page while the call is up
    if (!this.called(t)) this.sealAt(c, t, gen, neg, ka, reg);
    this.headword(c, cur, t, K);

    switch (cur) {
      case 18: this.yb = this.entry(c, 18, RX, TOP, RW, 132, t, K); break;
      case 19: this.yb = this.iq(c, t, K); break;
      case 20: this.yb = this.entry(c, 20, RX, TOP, RW, 112, t, K); break;
      case 21: {
        const y = this.entry(c, 20, RX, TOP, RW, 64, t, K);
        this.yb = this.entry(c, 21, RX, y + 40, RW, 112, t, K);
        break;
      }
      case 22: case 25: this.yb = this.cards(c, cur, RX, TOP, 1, t, K); break;
      case 23: case 26: {
        const y = this.cards(c, cur - 1, RX, TOP, 1, t, K);
        this.yb = this.cards(c, cur, RX, y + 24, 1, t, K);
        break;
      }
      case 24: case 27: {
        // 比況: the entries of the two lines before stand side by side
        const a = cur === 24 ? 22 : 25;
        const y = this.entry(c, cur, RX, TOP, RW, 76, t, K) + 24;
        const cw = span(4);
        this.yb = Math.max(this.column(c, a, RX, y, cw, t, K), this.column(c, a + 1, colX(8), y, cw, t, K));
        break;
      }
      case 28: this.yb = this.poiPoi(c, t, K); break;
    }

    this.leaders(c, t);
    const free = this.freeRows();
    const newest = this.sorts.reduce<Sort | null>((m, s) => (s.start <= t && (!m || s.start >= m.start) ? s : m), null);
    this.scan(c, newest, free, neg);
    this.hatFields(c, t, d, free, neg);
    this.kickMarks(c, t, d, free, K);
    this.snarePops(c, t, d, free);
    if (newest) this.cursor(c, newest, t, K);
    return reg;
  }

  // ---------- the music ----------

  /** The rows of cells in the entries block below the content (row indexes 0..ROWS-1). */
  private freeRows(): number[] {
    const out: number[] = [];
    for (let r = 0; r < ROWS; r++) if (TOP + r * ROW >= this.yb + 12) out.push(r);
    return out;
  }

  /** The entry number in the head: one more on every kick of the plate; the digits that change print inverted. */
  private number(c: CanvasRenderingContext2D, ki: number, ka: number, K: string) {
    const k0 = lastAt(this.kicks, this.ctx.start - 1e-3);
    const n = Math.max(0, ki - k0);
    const s = `${String(n).padStart(4, '0')}`;
    const prev = `${String(Math.max(0, n - 1)).padStart(4, '0')}`;
    c.font = fnt(SANS, 40, 700);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    let x = colX(4);
    c.fillStyle = K;
    c.fillText('No.', x, 106);
    x += c.measureText('No. ').width;
    for (let i = 0; i < 4; i++) {
      const ch = s[i]!;
      const w = c.measureText(ch).width;
      if (ka <= 1 && ch !== prev[i]) {
        c.fillStyle = K;
        c.fillRect(x - 2, 70, w + 4, 46);
        c.fillStyle = this.bg;
      } else c.fillStyle = K;
      c.fillText(ch, x, 106);
      x += w;
    }
  }

  /** The column under the newest glyph is lit: a tab on the head rule and the foot rule, a dot band below. */
  private scan(c: CanvasRenderingContext2D, newest: Sort | null, free: number[], neg: boolean) {
    if (!newest) return;
    const cx = newest.x + newest.w / 2;
    const col = Math.max(0, Math.min(11, Math.floor((cx - M + GUT / 2) / (CW + GUT))));
    const x = colX(col);
    c.fillStyle = this.K;
    c.fillRect(x, 132, CW, 18);
    c.fillRect(x, FOOT - 16, CW, 16);
    if (free.length && col >= 4) {
      const y0 = TOP + free[0]! * ROW;
      c.fillStyle = tone(neg ? 0.62 : 0.7);
      c.fillRect(x, y0, CW, FOOT - 24 - y0);
    }
  }

  /** Hats: offset-dot fields in free cells, darkest on the hat, then lighter each step (the screen thins). */
  private hatFields(c: CanvasRenderingContext2D, t: number, d: number, free: number[], neg: boolean) {
    if (!free.length) return;
    const n = 1 + Math.round(d * 3);
    for (let i = lastAt(this.hats, t); i >= 0; i--) {
      const h = this.hats[i]!;
      const a = age(t, h);
      if (a > 4) break;
      const v = 0.3 + 0.13 * a;
      c.fillStyle = tone(neg ? 0.95 - 0.11 * a : v);
      for (let j = 0; j < n; j++) {
        const col = 4 + Math.floor(hash(h, j, 1) * 8);
        const row = free[Math.floor(hash(h, j, 2) * free.length)]!;
        const wide = hash(h, j, 3) < 0.3 ? 2 : 1;
        const cols = Math.min(wide, 12 - col);
        c.fillRect(colX(col), TOP + row * ROW, span(cols), CW);
      }
    }
  }

  /** Kicks: registration marks pop on grid crossings, heavy rules shoot across the free rows. */
  private kickMarks(c: CanvasRenderingContext2D, t: number, d: number, free: number[], K: string) {
    for (let i = lastAt(this.kicks, t); i >= 0; i--) {
      const k = this.kicks[i]!;
      const a = age(t, k);
      if (a > 5) break;
      // registration marks: a ring and a cross, held 4 steps
      if (a < 4) {
        const n = 2 + Math.round(d * 5);
        c.strokeStyle = K;
        c.fillStyle = K;
        c.lineWidth = 3;
        for (let j = 0; j < n; j++) {
          const x = colX(1 + Math.floor(hash(k, j, 4) * 11)) - GUT / 2;
          const y = TOP + Math.floor(hash(k, j, 5) * (ROWS + 1)) * ROW - GUT / 2;
          const r = a === 0 ? 26 : 18;
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.stroke();
          c.fillRect(x - r - 14, y - 1.5, 2 * r + 28, 3);
          c.fillRect(x - 1.5, y - r - 14, 3, 2 * r + 28);
        }
      }
      // rules: shoot out from a gutter across the free rows in two steps, hold, gone after 6
      if (free.length) {
        const n = 1 + Math.round(d * 2);
        c.fillStyle = K;
        for (let j = 0; j < n; j++) {
          const row = free[Math.floor(hash(k, j, 6) * free.length)]!;
          const y = TOP + row * ROW - GUT / 2 - 5;
          const c0 = 4 + Math.floor(hash(k, j, 7) * 6);
          const c1 = Math.min(11, c0 + 2 + Math.floor(hash(k, j, 8) * 5));
          const x0 = colX(c0), x1 = colX(c1) + CW;
          const len = a === 0 ? (x1 - x0) * 0.5 : x1 - x0;
          if (hash(k, j, 9) < 0.5) c.fillRect(x0, y, len, 10);
          else c.fillRect(x1 - len, y, len, 10);
        }
      }
    }
  }

  /** Snares: a random set of the printed glyphs inverts; a big sort of the line drops into a free cell. */
  private snarePops(c: CanvasRenderingContext2D, t: number, d: number, free: number[]) {
    const i = lastAt(this.snares, t);
    if (i < 0) return;
    const sn = this.snares[i]!;
    const a = age(t, sn);
    if (a > 5) return;
    const done = this.sorts.filter((s) => age(t, s.start) > 2);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    if (done.length && a < 3) {
      const n = Math.min(done.length, 3 + Math.round(d * 10));
      const m = a === 2 ? Math.ceil(n / 2) : n;
      for (let j = 0; j < m; j++) this.invert(c, done[Math.floor(hash(sn, j, 10) * done.length)]!);
    }
    if (free.length && done.length) {
      const n = 1 + Math.round(d * 2);
      for (let j = 0; j < n; j++) {
        const s = done[Math.floor(hash(sn, j, 11) * done.length)]!;
        const col = 4 + Math.floor(hash(sn, j, 12) * 8);
        const row = free[Math.floor(hash(sn, j, 13) * free.length)]!;
        const x = colX(col), y = TOP + row * ROW;
        const drop = a === 0 ? -ROW / 3 : 0;
        c.fillStyle = s.red ? RED : this.K;
        c.fillRect(x, y + drop, CW, CW);
        c.fillStyle = this.bg;
        c.font = fnt(SANS, CW * 0.86, 900);
        c.textAlign = 'center';
        c.fillText(s.s, x + CW / 2, y + drop + CW * 0.8);
        c.textAlign = 'left';
      }
    }
  }

  /** The cursor: a bar after the newest glyph, set on the onset, blinking on the eighths. */
  private cursor(c: CanvasRenderingContext2D, s: Sort, t: number, K: string) {
    const a = age(t, s.start);
    if (a > 2 && Math.floor(a / 5) % 2 === 1) return;
    c.fillStyle = K;
    c.fillRect(s.x + s.w + 6, s.base - s.size * 0.86, Math.max(6, s.size * 0.07), s.size * 0.98);
  }

  /**
   * The cross-references: from each → 神 a red leader runs down the gutter beside its entry to a bus under the
   * content, along it to the gutter of the entries block and into the seal. Each grows in on its onset; on the
   * kick a packet runs down it to 神.
   */
  private leaders(c: CanvasRenderingContext2D, t: number) {
    if (!this.refs.length) return;
    const bus = Math.min(FOOT - 30, this.yb + 20);
    const rim = SEAL.x + SEAL.r;
    const paths = this.refs.map((r) => {
      const gx = r.x - GUT / 2;
      return { r, pts: [[r.x - 4, r.y], [gx, r.y], [gx, bus], [BUS_X, bus], [BUS_X, SEAL.y], [rim, SEAL.y]] as [number, number][] };
    });
    c.fillStyle = RED;
    const ki = lastAt(this.kicks, t);
    const kick = ki >= 0 ? this.kicks[ki]! : -Infinity;
    const ka = age(t, kick);
    for (const { r, pts } of paths) {
      const grow = Math.min(1, (age(t, r.start) + 1) / 4);
      const len = polyLen(pts);
      walk(pts, len * grow, (x0, y0, x1, y1) => c.fillRect(Math.min(x0, x1) - 2, Math.min(y0, y1) - 2, Math.abs(x1 - x0) + 4, Math.abs(y1 - y0) + 4));
      if (grow >= 1 && kick >= r.start && ka < 8) {
        const [px, py] = pointAt(pts, len * ((ka + 1) / 8));
        c.fillRect(px - 9, py - 9, 18, 18);
      }
    }
  }

  // ---------- the page ----------

  /** A sung glyph: it strikes in as an inverted sort (a size up, then in place) and then prints. */
  private put(c: CanvasRenderingContext2D, s: string, x: number, base: number, size: number, weight: number, fill: string, start: number, t: number) {
    c.font = fnt(SANS, size, weight);
    const w = c.measureText(s).width;
    const red = fill === RED;
    this.sorts.push({ s, x, base, w, size, weight, red, start });
    const a = age(t, start);
    if (a <= 1) {
      const sc = a === 0 ? 1.2 : 1;
      c.save();
      c.translate(x + w / 2, base - size * 0.38);
      c.scale(sc, sc);
      c.translate(-(x + w / 2), -(base - size * 0.38));
      c.fillStyle = red ? RED : this.K;
      c.fillRect(x - size * 0.04, base - size * 0.92, w + size * 0.08, size * 1.08);
      c.fillStyle = red ? PAPER : this.bg;
      c.fillText(s, x, base);
      c.restore();
      return;
    }
    c.fillStyle = fill;
    c.fillText(s, x, base);
  }

  /** A printed glyph picked up by the music: inverted in its own cell. */
  private invert(c: CanvasRenderingContext2D, s: Sort) {
    c.font = fnt(SANS, s.size, s.weight);
    c.fillStyle = s.red ? RED : this.K;
    c.fillRect(s.x - s.size * 0.04, s.base - s.size * 0.92, s.w + s.size * 0.08, s.size * 1.08);
    c.fillStyle = s.red ? PAPER : this.bg;
    c.fillText(s.s, s.x, s.base);
  }

  /** Whether the call "My God" is up at t (the red is open or closing). */
  private called(t: number): boolean {
    return VOICE.some((v) => (v.id === 'mygod1' || v.id === 'mygod2') && t >= v.start && t < v.end);
  }

  /**
   * The kami ring is pumped full: every kick of 65.49..the first 神っぽいな sends one packet down each leader
   * already grown (the true 神 cross-references of lines 22-26), and every kick raises the level by the same step,
   * whatever its strength, so the ring is full when line 27 cuts it as the reversed seal (the same picture).
   * A kick's packets reach the rim 7 steps later (sooner when line 27 is near, so the last one still fills the ring
   * before the cut), the level rises in 4 steps while the surface rocks once, a slow damped swing. Returns the liquid as a path of 8 px columns (the disc is
   * clipped by the caller), or null while the ring is empty.
   */
  private liquid(t: number, x: number, y: number, r: number): Path2D | null {
    const total = this.pumpAt.length || 1;
    let level = 0;
    let tilt = 0; // the lean of the surface
    const full = this.starts.get(27)!;
    for (let i = 0; i < this.pumpAt.length && this.pumpAt[i]! <= t; i++) {
      const delay = Math.max(0, Math.min(7, Math.floor((full - this.pumpAt[i]!) * FPS) - 4));
      const ka = age(t, this.pumpAt[i]!) - delay;
      level += Math.min(1, Math.max(0, (ka + 1) / 4));
      if (ka < 0) continue;
      tilt += r * 0.03 * Math.exp(-ka / 16) * Math.sin((ka * Math.PI * 2) / 30);
    }
    level /= total;
    if (level <= 0) return null;
    const base = y + r - 2 * r * level;
    const CWD = 8;
    const p = new Path2D();
    for (let dx = -r; dx < r; dx += CWD) {
      // the fundamental mode of the basin: one lobe up at one wall, down at the other, level in the middle
      const ty = Math.round(base + tilt * Math.sin(((dx + CWD / 2) / r) * (Math.PI / 2)));
      p.rect(x + dx, ty, CWD, y + r + 1 - ty);
    }
    return p;
  }

  /**
   * After the ring is full (75.3) it runs over at the bottom: a neck of ink drops from the foot of the ring onto the
   * foot rule and pools there, the pool spreading both ways along the rule, fast at first, then slower. The rule is
   * a dam: the pool brims over it in three places and runs down the foot of the page, faster and faster, out of
   * the bottom of the frame. All of it is cut as holes onto the red, like the disc, so it is one body of ink with
   * the ring and never off register. 24 fps steps.
   */
  private leak(c: CanvasRenderingContext2D, t: number) {
    if (t < LEAK_AT) return;
    const a = age(t, LEAK_AT);
    const { x: cx, y: cy, r } = SEAL;
    const p = new Path2D();

    // the neck from the foot of the ring to the rule
    const neck = 6 + 10 * Math.min(1, a / 12);
    p.rect(cx - neck / 2, cy + r - 6, neck, FOOT - (cy + r) + 10);

    // the pool on the rule: a flat wedge, thickest under the ring
    if (a >= 3) {
      const u = a - 3;
      const L = 20 + 105 * Math.sqrt(u / 24);
      const hmax = Math.min(18, 4 + 14 * Math.sqrt(u / 30));
      const x0 = Math.max(M, cx - L);
      const x1 = Math.min(W - M, cx + L);
      p.moveTo(x0, FOOT + 3);
      for (let x = x0; x < x1; x += 4) p.lineTo(x, FOOT + 2 - hmax * (1 - ((x - cx) / L) ** 2));
      p.lineTo(x1, FOOT + 3);
      p.closePath();
    }

    // over the dam: rivulets down the foot of the page
    const top = FOOT - 3;
    for (const rv of [
      { dx: -90, at: 0 },
      { dx: 30, at: 4 },
      { dx: 110, at: 8 },
    ]) {
      const kk = a - Math.round((SPILL_AT - LEAK_AT) * FPS) - rv.at;
      if (kk < 0) continue;
      const sx = cx + rv.dx;
      const bottom = Math.min(H + 12, top + 0.9 * kk * kk);
      const hw = (y: number) => 4.5 + 3.5 * Math.exp(-(y - top) / 28) + 0.6 * Math.sin(y / 13 + rv.dx);
      p.moveTo(sx - hw(top), top);
      for (let y = top; y < bottom; y += 6) p.lineTo(sx - hw(y), y);
      p.lineTo(sx - hw(bottom), bottom);
      p.arc(sx, bottom, hw(bottom), Math.PI, 0, true);
      for (let y = bottom; y > top; y -= 6) p.lineTo(sx + hw(y), y);
      p.lineTo(sx + hw(top), top);
      p.closePath();
    }
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.fill(p);
    c.restore();
  }

  /**
   * The seal of the last 神っぽいな line (18, then 27). Fresh, for its copy and the call after it, it is cut as a
   * reversed seal (白文): the whole disc a hole onto red, ring and 神 left standing in paper. Then the copies close
   * it: the 朱文 seal in red ink (ring and glyph only), then a gray ghost in the dot screen. It punches on the kick.
   */
  private sealAt(c: CanvasRenderingContext2D, t: number, gen: number, neg: boolean, ka: number, reg: number) {
    const from = this.starts.get(27)! <= t ? 27 : 18;
    const stage = gen - genAt(this.times, this.ctx.lyrics, this.starts.get(from)!);
    const { x, y } = SEAL;
    const r = SEAL.r * (ka === 0 ? 1.08 : ka === 1 ? 1.03 : 1);
    this.leak(c, t);
    c.save();
    // the ink box of 神 sits on the centre of the ring, not the em box
    const glyph = (size: number) => {
      c.font = fnt(SANS, size, 700);
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      const m = c.measureText('神');
      c.fillText('神', x - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2, y + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
    };
    const ring = (rr: number, w: number) => {
      c.lineWidth = r * w;
      c.beginPath();
      c.arc(x, y, r * rr, 0, Math.PI * 2);
      c.stroke();
    };
    // the reversed seal: the disc is a hole onto the red, ring and 神 stand in paper
    const reversed = (cut: () => void) => {
      c.globalCompositeOperation = 'destination-out';
      cut();
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = c.strokeStyle = PAPER;
      ring(0.86, 0.05);
      glyph(r * 1.05);
    };
    if (stage === 2) {
      // red ink is on the red plate, which prints off register by reg px: set it ahead of that so the seal stays centred
      c.translate(reg, reg * 0.6);
      c.fillStyle = c.strokeStyle = RED;
      ring(0.93, 0.09);
      glyph(r * 1.15);
    } else if (stage <= 1) {
      reversed(() => {
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      });
    } else {
      c.fillStyle = c.strokeStyle = tone(neg ? 0.55 : 0.84);
      ring(0.93, 0.09);
      glyph(r * 1.15);
      const liq = this.liquid(t, x, y, r);
      if (liq) {
        // the pump cuts the same reversed seal, bottom up, so the full ring is exactly line 27's
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.clip();
        reversed(() => {
          c.fill(liq);
          c.clip(liq);
        });
      }
    }
    c.restore();
  }

  /** The headword of the line in the left block, a glyph at its onset, as large as the four columns take. */
  private headword(c: CanvasRenderingContext2D, cur: number, t: number, K: string) {
    const [h0, h1] = this.heads.get(cur)!;
    const us = units(this.line(cur)).slice(h0, h1);
    if (!us.length || us[0]!.start > t) return;
    const full = cur === 19 ? 'IQ 128' : us.map((u) => clean(u.glyph)).join('');
    c.font = fnt(SANS, 100, 900);
    const size = Math.min(168, Math.floor((LW / c.measureText(full).width) * 100));
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    const base = TOP + size * 0.88;
    let x = LX - size * 0.04;
    for (const u of us) {
      if (u.start > t) break;
      const g = clean(u.glyph);
      this.put(c, g, x, base, size, 900, K, u.start, t);
      c.font = fnt(SANS, size, 900);
      x += c.measureText(g).width;
    }
    if (cur === 19) {
      const n = this.iqCells(t);
      if (n) {
        const k = units(this.line(19)).filter((u, i) => i >= this.iqFrom && u.start <= t).length - 1;
        const at = units(this.line(19))[this.iqFrom + k]!.start;
        c.font = fnt(SANS, size, 900);
        this.put(c, ` ${n}`, x, base, size, 900, K, at, t);
      }
    }
    // its reading, small, under it
    const r = reading(this.line(cur), t, us[0]!.start, us[us.length - 1]!.end);
    if (r) rebate(c, r, LX, TOP + size * 1.12, 'left', K);
  }

  /**
   * Lay the units of a line out left to right in a box w wide, wrapping; returns each unit's x, baseline and width
   * (also for units not sung yet, so nothing re-flows) and the bottom.
   */
  private flow(c: CanvasRenderingContext2D, us: WrittenUnit[], x: number, y: number, w: number, size: number) {
    c.font = fnt(SANS, size, 700);
    const lh = Math.round(size * 1.18);
    let cx = x, base = y + size * 0.9;
    const at = us.map((u) => {
      const uw = c.measureText(clean(u.glyph)).width;
      if (cx + uw > x + w + 1) { cx = x; base += lh; }
      const p = { x: cx, base, w: uw };
      cx += uw;
      return p;
    });
    return { at, bottom: base + size * 0.3 };
  }

  /** A whole line as an entry: the sung glyphs (神 in red ink), then its reading and its gloss. Returns the bottom. */
  private entry(c: CanvasRenderingContext2D, i: number, x: number, y: number, w: number, size: number, t: number, K: string): number {
    const line = this.line(i);
    const us = units(line);
    const { at, bottom } = this.flow(c, us, x, y, w, size);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    us.forEach((u, k) => {
      if (u.start > t) return;
      this.put(c, clean(u.glyph), at[k]!.x, at[k]!.base, size, 700, u.glyph === '神' ? RED : K, u.start, t);
    });
    return this.gloss(c, line, x, bottom, size, t, K);
  }

  /** The reading (romaji) and the English gloss under an entry, phrase by phrase. Returns the bottom. */
  private gloss(c: CanvasRenderingContext2D, line: Line, x: number, y: number, size: number, t: number, K: string): number {
    const r = reading(line, t);
    if (r) rebate(c, r, x, y + 14, 'left', K);
    const g = line.written!.phrases.filter((ph) => ph.start <= t).map((ph) => ph.text).join(' ');
    const gs = Math.max(26, Math.round(size * 0.3));
    if (g) {
      c.font = fnt(SANS, gs, 400);
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      c.fillStyle = K;
      c.fillText(g, x, y + 36 + gs * 0.8);
    }
    return y + 36 + gs * 1.2;
  }

  /** IQ: the cells per em the line is rendered on now (0 before 下). */
  private iqCells(t: number): number {
    const us = units(this.line(19));
    let n = 0;
    for (let k = this.iqFrom; k < this.iqFrom + 6; k++) if (us[k]!.start <= t) n++;
    return n ? IQ_EM >> (n - 1) : 0;
  }

  /**
   * Line 19 at 128 px. From 下 on, the glyphs sung before the newest are rasterised on a grid of IQ cells per em
   * (each syllable of 下がっていく halves it); the newest glyph is set crisp, so it reads at its onset.
   */
  private iq(c: CanvasRenderingContext2D, t: number, K: string): number {
    const line = this.line(19);
    const us = units(line);
    const { at, bottom } = this.flow(c, us, RX, TOP, RW, IQ_EM);
    const n = this.iqCells(t);
    const last = us.reduce((m, u, k) => (u.start <= t ? k : m), -1);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    if (!n) {
      us.forEach((u, k) => { if (u.start <= t) this.put(c, clean(u.glyph), at[k]!.x, at[k]!.base, IQ_EM, 700, K, u.start, t); });
    } else {
      // the older glyphs, rendered on the coarse grid: down to n cells per em, then up again without smoothing
      const big = this.big!, small = this.small!;
      const bh = Math.ceil(bottom - TOP);
      const b = big.getContext('2d', { willReadFrequently: true })!;
      b.clearRect(0, 0, big.width, big.height);
      b.font = fnt(SANS, IQ_EM, 700);
      b.textAlign = 'left';
      b.textBaseline = 'alphabetic';
      b.fillStyle = INK;
      us.forEach((u, k) => { if (k < last) b.fillText(clean(u.glyph), at[k]!.x - RX, at[k]!.base - TOP); });
      const s = n / IQ_EM;
      small.width = Math.ceil(RW * s);
      small.height = Math.ceil(bh * s);
      const sc = small.getContext('2d', { willReadFrequently: true })!;
      sc.imageSmoothingEnabled = true;
      sc.imageSmoothingQuality = 'high';
      sc.drawImage(big, 0, 0, RW, bh, 0, 0, small.width, small.height);
      c.save();
      c.imageSmoothingEnabled = false;
      c.drawImage(small, 0, 0, small.width, small.height, RX, TOP, small.width / s, small.height / s);
      c.restore();
      // the newest glyph, crisp
      const u = us[last]!;
      this.put(c, clean(u.glyph), at[last]!.x, at[last]!.base, IQ_EM, 700, K, u.start, t);
    }
    return this.gloss(c, line, RX, bottom, IQ_EM, t, K);
  }

  /** One その〇〇 entry: a rule, その small and the noun large, reading, gloss, and the cross-reference → 神. */
  private card(c: CanvasRenderingContext2D, g: Group, x: number, y: number, w: number, s: number, t: number, K: string): number {
    if (g.us[g.from]!.start > t) return y + 270 * s;
    // the rule draws across the card in two steps from its first onset
    const ra = age(t, g.us[g.from]!.start);
    c.fillStyle = K;
    c.fillRect(Math.round(x), Math.round(y), Math.round(ra === 0 ? w * 0.4 : w), Math.max(2, Math.round((ra <= 1 ? 10 : 4) * s)));
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    // the noun is set as large as the card takes: a long one (カリスマ) shrinks, so it stays out of the next card
    const px = (k: number) => Math.round((k < g.from + 2 ? 44 : 96) * s);
    const wt = (k: number) => (k < g.from + 2 ? 500 : 700);
    let natural = 0;
    for (let k = g.from; k < g.to; k++) {
      c.font = fnt(SANS, px(k), wt(k));
      natural += c.measureText(clean(g.us[k]!.glyph)).width;
    }
    const fit = Math.min(1, (w - 6) / natural);
    let cx = x;
    for (let k = g.from; k < g.to; k++) {
      const u = g.us[k]!;
      const size = Math.round(px(k) * fit), weight = wt(k);
      const glyph = clean(u.glyph);
      if (u.start <= t) this.put(c, glyph, cx, y + 116 * s, size, weight, K, u.start, t);
      c.font = fnt(SANS, size, weight);
      cx += c.measureText(glyph).width;
    }
    rebate(c, g.reading, x, y + 150 * s, 'left', K);
    if (g.phrase.start <= t) {
      c.font = fnt(SANS, Math.round(30 * s), 400);
      c.fillStyle = K;
      c.fillText(g.phrase.text, x, y + 196 * s);
    }
    const last = g.us[g.to - 1]!.start;
    if (last <= t) {
      const size = Math.max(30, Math.round(40 * s));
      c.font = fnt(SANS, size, 700);
      c.fillStyle = RED;
      c.fillText('→ 神', x, y + 250 * s);
      this.refs.push({ x, y: y + 250 * s - size * 0.35, start: last });
    }
    return y + 270 * s;
  }

  /** The その entries of a line in a row of three. Returns the bottom. */
  private cards(c: CanvasRenderingContext2D, i: number, x: number, y: number, s: number, t: number, K: string): number {
    const cw = (RW - 2 * GUT) / 3;
    let bottom = y;
    this.groups.get(i)!.forEach((g, k) => { bottom = Math.max(bottom, this.card(c, g, x + k * (cw + GUT), y, cw, s, t, K)); });
    return bottom;
  }

  /** The その entries of a line stacked in one column (two such columns compare them). Returns the bottom. */
  private column(c: CanvasRenderingContext2D, i: number, x: number, y: number, w: number, t: number, K: string): number {
    for (const g of this.groups.get(i)!) y = this.card(c, g, x, y, w, 0.56, t, K) + 8;
    return y;
  }

  /** Line 28: px of misregistration the ぽい copies add (each copy moves the red plate). */
  private poiCopies(t: number): number {
    const us = units(this.line(28));
    const copies = this.poi.filter((p) => us[p]!.start <= t).length;
    return Math.max(0, copies - 1) * 2;
  }

  /**
   * Line 28: ぽい three times, each a copy of the one before (a little grayer, so the screen takes it), then
   * 憧れちゃう！. Each copy lands with the copies before it stepping over by one. Returns the bottom.
   */
  private poiPoi(c: CanvasRenderingContext2D, t: number, K: string): number {
    const line = this.line(28);
    const us = units(line);
    const big = 168, nsize = 56;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    let cx = RX;
    const base = TOP + big * 0.9;
    const tail = this.poi[2]! + 2;
    for (let k = 0; k < tail; k++) {
      const u = us[k]!;
      const glyph = clean(u.glyph);
      const n = this.poi.filter((p) => p <= k).length - 1; // which ぽい this glyph belongs to
      const isNa = glyph === 'な';
      const size = isNa ? nsize : big;
      if (u.start <= t) this.put(c, glyph, cx, base, size, 700, isNa ? K : tone(n * 0.16), u.start, t);
      c.font = fnt(SANS, size, 700);
      cx += c.measureText(glyph).width;
    }
    const rest = us.slice(tail);
    const { at, bottom } = this.flow(c, rest, RX, base + 60, RW, 104);
    rest.forEach((u, k) => { if (u.start <= t) this.put(c, clean(u.glyph), at[k]!.x, at[k]!.base, 104, 700, K, u.start, t); });
    return this.gloss(c, line, RX, bottom, 104, t, K);
  }
}

// ---------- polylines (the leaders) ----------

function polyLen(pts: [number, number][]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.abs(pts[i]![0] - pts[i - 1]![0]) + Math.abs(pts[i]![1] - pts[i - 1]![1]);
  return l;
}

/** Call `seg` for the axis-aligned segments of `pts` up to length `len`. */
function walk(pts: [number, number][], len: number, seg: (x0: number, y0: number, x1: number, y1: number) => void) {
  for (let i = 1; i < pts.length && len > 0; i++) {
    const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!;
    const l = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    const k = Math.min(1, len / (l || 1));
    seg(x0, y0, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
    len -= l;
  }
}

/** The point at length `len` along `pts`. */
function pointAt(pts: [number, number][], len: number): [number, number] {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!;
    const l = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    if (len <= l) {
      const k = len / (l || 1);
      return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
    }
    len -= l;
  }
  return pts[pts.length - 1]!;
}
