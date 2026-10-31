// Plate 8 · Epigone (text-ish, chorus 2). Everything fluent, nothing exact; the sung text stays real.
// Param `ish` (default 'both'):
//   'pseudo'     pseudo-kanji (real parts of the song's kanji, joined wrong) in the outer margins only.
//   'homophone'  no pseudo-kanji: after a kanji has been sung, later copies may swap it for a real kanji with the
//                same reading (神→紙→髪→上, 健康→拳工, 感じ→漢字, 意見→異見). The glyph being sung is always correct.
//   'both'       the homophone drift and the margin pseudo-kanji.
// v4 motion. The voice moves the type: each sung glyph hops in on its onset (one 24 fps step high, one step
// settling), headwords stamp in one glyph per onset, the loop turns one slot on each その.
// The music moves the rest (casting, see local notes / treatment):
//   kick   a large chimera assembles in a side margin: its two halves slide in and lock on the kick, hold, then
//          fly apart and fall. The same kick makes a past sung kanji slip: its right (or lower) half is
//          replaced by a wrong half for 0.2 s (radical drift; the glyph being sung is never touched).
//          In the loop the kick tightens the ring and moves the live cross-reference one entry on.
//   snare  a cross-reference line snaps from a margin glyph to the glyph being sung (the loop: the arrows snap
//          taut; lines 58-59: the leaders to the hole re-route).
//   hat    a random set of margin glyphs pops (new glyph, full ink, oversize for one step).
//   bass   size of the kick chimeras.
// Density of the margins builds to エピゴーネン, breathes for the loop, builds again to the end of the plate.
//   lines 51-53  three vertical entries; 健康 is the bold headword of line 52 and each copy thins it.
//                神っぽいな (51) keeps the seal open onto red.
//   My God       (mygod3, mygod4) red takes the frame with the call cut out in Fraktur; paper chimeras pop in it.
//   line 54      エピゴーネン: the highest loss. Stateless faux-datamosh: the line steps left on each onset and
//                moves inside block-displaced pixels of the page as it stood before "My God" (t_base).
//   lines 55-56  その〇〇 entries on a ring; each points to the next (→ 絵 …) and メロディ points back to タイトル:
//                the cross-references close into a loop around nothing.
//   line 57      比況: the two halves side by side.   lines 58-59  その〇〇 entries; each cross-reference → 神,
//                and their leaders all run into one hole onto red.
//   line 60      a new seal opens red (relapse).   line 61  ぽい stamped three times, each a copy of the last.
import type { Frame } from '@pve/engine/scene';
import { H, Layer2D, makeCanvas, W } from '@pve/engine/gl';
import { lineNo, units, type Line, type WrittenUnit } from '@pve/engine/lyrics';
import { drawV } from '@pve/engine/type';
import { clamp, hash, stepN } from '@pve/engine/util';
import {
  copyTimes, FRAKTUR, fnt, genAt, INK, PageScene, PAPER, rebate, SANS, seal, SERIF, statusLine, tone,
  VOICE, type SurfaceOpts,
} from './_page';
import { TEXTISH } from './_era_textish';
import { atlas, chimera, drawSplit, LR, TB, type Chimera, type HalfPose } from './epigone-ish';
import { ATLAS_CELL, ATLAS_COLS, ATLAS_N, ATLAS_SEED, marginCells, type Cell } from './epigone-page';

/** One その〇〇 entry: the その units, the headword units and the English of its syllables. */
interface Group {
  line: Line;
  sono: WrittenUnit[];
  head: WrittenUnit[];
}
/** A past sung kanji as drawn on this frame: where a kick may slip one of its halves. */
interface Drawn {
  ch: string;
  x: number;
  y: number;
  size: number;
  w: number;
  fam: string;
  start: number;
}

type Ish = 'pseudo' | 'homophone' | 'both';

const GLOSS = 26;
/** Seed of the large kick chimeras. */
const KICK_SEED = 81;
/** One step of the type layer. */
const STEP = 1 / 24;
/** Kick chimera: assembly, flight (s). */
const ASM = 0.125;
const FLY = 0.28;
/** Life of a hat pop and of a snare line (s). */
const POP = 0.28;
const SNAP = 0.3;
const SLIP = new Set([...LR, ...TB]);
/**
 * Real kanji with the same reading as a song kanji, in the order copies reach them (all added to the subset fonts).
 * Keyed by glyph, or by `line:glyph` where the reading depends on the word (言 is i in 52, gen in 58).
 */
const HOMO: Record<string, string> = {
  神: '紙髪上', 卑: '比非', 怯: '況京', 超: '長蝶', 健: '拳県', 康: '工公', '52:言': '云', 張: '貼', 感: '漢缶',
  畢: '筆必', 竟: '境鏡', 哀: '愛藍', 愁: '秋週', 絵: '江柄', 音: '恩温', 楽: '学額', 歌: '唄詩', 比: '非火',
  況: '京境', 名: '迷銘', '58:言': '原源', 意: '異医', 見: '県件', 批: '被悲', 評: '表票',
};

/** The hop of a glyph on its onset, in em (negative is up): one step high, one step settling. */
const hop = (age: number) => (age < STEP ? -0.3 : age < 2 * STEP ? -0.1 : 0);
/** The scale of a stamp on its onset. */
const slam = (age: number) => (age < 0 ? 1 : age < STEP ? 1.32 : age < 2 * STEP ? 1.1 : 1);
/** Index of the last time in sorted `a` at or before t, -1 before the first. */
function lastIdx(a: number[], t: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m]! <= t) lo = m + 1;
    else hi = m;
  }
  return lo - 1;
}

export default class Epigone extends PageScene {
  private L: Line[] = [];
  private copies: number[] = [];
  private g0 = 0;
  private ish: HTMLCanvasElement | null = null;
  /** The atlas in paper: chimeras cut out of the red on My God. */
  private ishW: HTMLCanvasElement | null = null;
  private mode: Ish = 'both';
  private lineOf = new Map<WrittenUnit, number>();
  private cells: Cell[] = [];
  private loop: Group[] = [];
  private refs: Group[] = [];
  private base: Layer2D | null = null;
  private tBase = 0;
  private kicks: number[] = [];
  private snares: number[] = [];
  private hats: number[] = [];
  /** Density of the margins over time: [t, d] knots. */
  private knots: [number, number][] = [];
  // per frame: the glyph being sung (where snare lines point) and the past kanji drawn
  private anchor: [number, number] = [W / 2, H / 2];
  private anchorT = -1;
  private drawn: Drawn[] = [];
  private mCv: HTMLCanvasElement | null = null;
  private mCtx: CanvasRenderingContext2D | null = null;
  private mLastKey = '';
  private stampSprites = new Map<number, { cv: HTMLCanvasElement; w: number; h: number }>();
  override async init() {
    await super.init();
    this.warm([TEXTISH], true);
    const lyr = this.ctx.lyrics;
    for (let i = 51; i <= 61; i++) {
      this.L[i] = lineNo(lyr, i);
      for (const u of units(this.L[i]!)) this.lineOf.set(u, i);
    }
    const m = this.ctx.params.ish ?? 'both';
    if (m !== 'pseudo' && m !== 'homophone' && m !== 'both') throw new Error(`epigone: ish must be pseudo|homophone|both, got ${String(m)}`);
    this.mode = m;
    this.copies = copyTimes(lyr);
    this.g0 = genAt(this.copies, lyr, this.L[51]!.start);
    if (m !== 'homophone') {
      this.ish = atlas(ATLAS_SEED, ATLAS_N, ATLAS_CELL, ATLAS_COLS);
      const w = document.createElement('canvas');
      w.width = this.ish.width;
      w.height = this.ish.height;
      const c = w.getContext('2d', { willReadFrequently: true })!;
      c.drawImage(this.ish, 0, 0);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = PAPER;
      c.fillRect(0, 0, w.width, w.height);
      this.ishW = w;
    }
    this.loop = [...this.groups(this.L[55]!), ...this.groups(this.L[56]!)];
    this.refs = [...this.groups(this.L[58]!), ...this.groups(this.L[59]!)];
    // the page as it stood just before the second "My God": the pixels line 54 moves inside
    this.tBase = VOICE.find((v) => v.id === 'mygod4')!.start - 0.05;

    const a = this.ctx.audio;
    const t0 = this.ctx.start - 1, t1 = this.ctx.end + 1;
    this.kicks = a.events('kick', t0, t1).map(([t]) => t);
    this.snares = a.events('snare', t0, t1).map(([t]) => t);
    this.hats = a.events('hat', t0, t1).map(([t]) => t);

    const L = this.L;
    const s54 = L[54]!.start;
    this.knots = [
      [this.ctx.start, 0.2], [L[52]!.start, 0.32], [L[53]!.start, 0.5], [s54 - 0.4, 0.78], [s54, 0.95],
      [L[55]!.start - 0.01, 1], [L[55]!.start, 0.5], [L[57]!.start, 0.66], [L[58]!.start, 0.72], [L[60]!.start, 0.86],
      [this.ctx.end, 1],
    ];

    this.cells = marginCells();
    const u61 = units(this.L[61]!);
    const ak = u61.findIndex((u) => u.glyph.startsWith('憧'));
    this.stampSprite(0, u61.slice(0, 3));
    this.stampSprite(1, u61.slice(3, 6));
    this.stampSprite(2, u61.slice(6, ak));
  }

  /** Density of the margins at t, 0..1. */
  private dens(t: number): number {
    const k = this.knots;
    if (t <= k[0]![0]) return k[0]![1];
    for (let i = 1; i < k.length; i++) {
      const [ta, da] = k[i - 1]!, [tb, db] = k[i]!;
      if (t < tb) return da + ((db - da) * (t - ta)) / Math.max(1e-6, tb - ta);
    }
    return k[k.length - 1]![1];
  }

  /**
   * `ch` as it reads `t`: about half the kanji drift. For those the first copy made since `t0` swaps it for a
   * homophone, later ones (with a little luck) walk it further down the chain.
   */
  private drift(ch: string, line: number, t0: number, t: number, seed: number): string {
    const chain = HOMO[`${line}:${ch}`] ?? HOMO[ch];
    if (!chain || this.mode === 'pseudo') return ch;
    const lyr = this.ctx.lyrics;
    const n = genAt(this.copies, lyr, t) - genAt(this.copies, lyr, t0);
    let s = 0;
    if (hash(seed, 43) < 0.5) for (let j = 1; j <= n; j++) if (j === 1 || hash(seed, j, 41) < 0.35) s++;
    return s === 0 ? ch : [...chain][Math.min(s, chain.length) - 1]!;
  }

  /** The glyph of a sung unit at t: exact while it is sung, then it may drift on later copies. */
  private glyph(u: WrittenUnit, t: number): string {
    if (t < u.end) return u.glyph;
    const line = this.lineOf.get(u) ?? 0;
    return this.drift(u.glyph, line, u.end, t, line * 100 + u.from);
  }

  /** Note a sung glyph drawn centred on (x, y): the newest is where snare lines point; past kanji may slip. */
  private note(u: WrittenUnit, ch: string, x: number, y: number, size: number, w: number, fam: string, t: number) {
    if (u.start >= this.anchorT) {
      this.anchorT = u.start;
      this.anchor = [x, y];
    }
    if (t - u.start > 0.35 && SLIP.has(ch)) this.drawn.push({ ch, x, y, size, w, fam, start: u.start });
  }

  /** The その〇〇 groups of a line. */
  private groups(line: Line): Group[] {
    const us = units(line);
    const out: Group[] = [];
    for (let k = 0; k < us.length; k++) {
      if (us[k]!.glyph === 'そ' && us[k + 1]?.glyph === 'の') {
        out.push({ line, sono: [us[k]!, us[k + 1]!], head: [] });
        k++;
      } else out[out.length - 1]!.head.push(us[k]!);
    }
    return out;
  }

  draw(c: CanvasRenderingContext2D, f: Frame): SurfaceOpts {
    const t = f.t;
    const lyr = this.ctx.lyrics;
    const gen = genAt(this.copies, lyr, t);
    const k = gen - this.g0;
    const L = this.L;
    const mosh = t >= L[54]!.start && t < L[55]!.start;
    this.drawn = [];
    this.anchorT = -1;
    this.anchor = [W / 2, H / 2];
    const bass = f.a.bass ?? 0;

    // "My God": red takes the frame with the call cut out of it; what is sung meanwhile stays (cut out too)
    for (const v of VOICE) {
      if (t < v.start || t >= v.end || (v.id !== 'mygod3' && v.id !== 'mygod4')) continue;
      c.clearRect(0, 0, W, H);
      this.pops(c, t, true);
      this.kickers(c, t, bass, true);
      // the call punches in on its onset, at 12 fps
      const age = t - v.start;
      const s = age < 1 / 12 ? 1.24 : age < 2 / 12 ? 1.08 : 1;
      c.save();
      c.translate(W / 2, H / 2 - 40);
      c.scale(s, s);
      c.fillStyle = PAPER;
      c.font = fnt(FRAKTUR, 220);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(v.text, 0, 0);
      c.restore();
      const live = lyr.lines.flatMap((l) => (l.written ? units(l) : [])).filter((u) => u.start >= v.start && u.start <= t);
      c.font = fnt(SERIF, 104, 700);
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      let x = 300;
      for (const u of live) {
        c.fillText(u.glyph, x, 860 + hop(t - u.start) * 104);
        x += c.measureText(u.glyph).width;
      }
      return { era: TEXTISH, gen };
    }

    c.save();
    if (mosh) this.line54(c, t);
    else this.page(c, t, gen);
    if (t >= L[51]!.start) {
      this.pops(c, t, false);
      this.kickers(c, t, bass, false);
      const ring = t >= L[55]!.start && t < L[57]!.start;
      const ptr = t >= L[58]!.start && t < L[60]!.start;
      if (!ring && !ptr) this.snaps(c, t);
      this.slips(c, t);
    }
    c.restore();

    const li = lyr.lines.findLast((l) => l.start <= t + 1e-3)?.i;
    statusLine(c, gen, t, '', li !== undefined ? `line ${li}` : '', INK, true);
    const melt = Math.min(2.2, 0.8 + 0.18 * k) + (mosh ? 0.6 : 0);
    const warp = Math.min(5, 1 + 0.4 * k);
    return {
      era: TEXTISH, gen, p: [melt, warp, 0.8, 46],
      jpeg: mosh ? { quality: 40, passes: 2 } : { quality: 74, passes: 1 },
    };
  }

  /** The page of every segment but line 54. */
  private page(c: CanvasRenderingContext2D, t: number, gen: number) {
    const L = this.L;
    c.fillStyle = PAPER;
    c.fillRect(0, 0, W, H);
    this.margins(c, t, gen);
    if (t < L[54]!.start) this.chorus(c, t, gen);
    else if (t < L[57]!.start) this.ring(c, t);
    else if (t < L[58]!.start) this.compare(c, t);
    else if (t < L[60]!.start) this.pointers(c, t);
    else this.relapse(c, t, gen);
  }

  /** Pseudo-kanji in the margins: cached on a backing canvas and updated when density or gen changes. */
  private margins(c: CanvasRenderingContext2D, t: number, gen: number) {
    const ish = this.ish;
    if (!ish) return;
    const d = 0.1 + 0.85 * this.dens(t);
    const dStep = Math.floor(d * 60);
    const key = `${gen}:${dStep}`;
    if (!this.mCv) {
      const { cv, c: mc } = makeCanvas();
      this.mCv = cv;
      this.mCtx = mc;
    }
    if (key !== this.mLastKey) {
      this.mLastKey = key;
      const mc = this.mCtx!;
      mc.clearRect(0, 0, W, H);
      this.cells.forEach((cell, i) => {
        if (cell.r >= d) return;
        const g = Math.floor(hash(i, Math.floor(gen / cell.period), 11) * ATLAS_N);
        mc.globalAlpha = cell.alpha;
        this.cellGlyph(mc, ish, g, cell.x, cell.y, cell.size);
      });
    }
    c.drawImage(this.mCv, 0, 0, W, H);
  }
  private cellGlyph(c: CanvasRenderingContext2D, src: HTMLCanvasElement, g: number, x: number, y: number, s: number) {
    c.drawImage(src, (g % ATLAS_COLS) * ATLAS_CELL, Math.floor(g / ATLAS_COLS) * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL, x - s / 2, y - s / 2, s, s);
  }

  // ---------- the music: pops, kick chimeras, snare lines, slips ----------

  /** Hat: a random set of margin cells pops a new glyph, full ink and oversize for a step. In red: paper. */
  private pops(c: CanvasRenderingContext2D, t: number, red: boolean) {
    const src = red ? this.ishW : this.ish;
    if (!src) return;
    const n = Math.round(3 + 15 * this.dens(t));
    for (let j = lastIdx(this.hats, t); j >= 0 && t - this.hats[j]! < POP; j--) {
      const age = t - this.hats[j]!;
      const sc = age < STEP ? 1.55 : age < 2 * STEP ? 1.2 : 1;
      for (let m = 0; m < n; m++) {
        const cell = this.cells[Math.floor(hash(j, m, 71) * this.cells.length)]!;
        const s = cell.size * sc;
        if (!red) {
          c.fillStyle = PAPER;
          c.fillRect(cell.x - s * 0.55, cell.y - s * 0.55, s * 1.1, s * 1.1);
        }
        this.cellGlyph(c, src, Math.floor(hash(j, m, 72) * ATLAS_N), cell.x, cell.y, s);
      }
    }
  }

  /**
   * Kick: a large chimera in a side margin. Its halves slide in over 3 steps and lock on the kick, it holds,
   * then the halves fly apart and fall. Left and right margins take turns. In red: paper, larger.
   */
  private kickers(c: CanvasRenderingContext2D, now: number, bass: number, red: boolean) {
    if (this.mode === 'homophone') return;
    // during the peel transition (last 1.3 s of epigone), peel.ts draws the kickers on its overlay:
    // do not draw them on the base page here, or the same radical is drawn twice
    if (now >= this.ctx.end - 1.35) return;
    const t = stepN(now, 24) / 24;
    const K = this.kicks;
    const L = this.L;
    const top = lastIdx(K, t + ASM);
    for (let k = top; k >= 0 && k >= top - 3; k--) {
      const tk = K[k]!;
      const tn = K[k + 1] ?? tk + 0.6;
      const hold = clamp(tn - tk - 0.12, 0.12, 0.4);
      if (t < tk - ASM || t >= tk + hold + FLY) continue;
      const g = chimera(KICK_SEED, k);
      const size = (150 + hash(k, 2) * 80) * (1 + 0.3 * bass) * (red ? 1.5 : 1);
      const side = k % 2;
      const x = side ? W - 170 - hash(k, 3) * 50 : 170 + hash(k, 3) * 50;
      // with horizontal rows on the page (line 54, line 61) they keep off the band of the rows, pinned by tk
      // so a chimera never jumps position across a line boundary; in red they keep to the upper corners
      const band: [number, number] | null = tk >= L[54]!.start && tk < L[55]!.start ? [320, 720] : tk >= L[61]!.start ? [280, 740] : null;
      let y = red ? 160 + hash(k, 4) * 160 : 200 + hash(k, 4) * 680;
      if (band && y > band[0] - size / 2 && y < band[1] + size / 2) {
        y = hash(k, 6) < 0.5 || band[1] + size / 2 > H - 120 ? Math.max(130, band[0] - size / 2) : band[1] + size / 2;
      }
      const [ax, ay] = g.mode === 'lr' ? [1, 0] : [0, 1];
      const w = hash(k, 5) < 0.5 ? 500 : 800;
      let pa: HalfPose = [0, 0, 0], pb: HalfPose = [0, 0, 0];
      let s = size;
      if (t < tk) {
        const q = (t - (tk - ASM)) / ASM;
        const off = (1 - q) * (1 - q) * size * 0.9;
        pa = [-ax * off, -ay * off, -(1 - q) * 0.35];
        pb = [ax * off, ay * off, (1 - q) * 0.35];
      } else if (t < tk + hold) {
        if (t - tk < STEP) s = size * 1.14;
      } else {
        const q = (t - tk - hold) / FLY;
        // apart and down; in red they mostly fall, so they never cross the call
        const sp = size * (red ? 0.3 : 1.1) * q;
        pa = [-ax * sp - ay * size * 0.3 * q, q * q * size * 1.6, -q * 0.9];
        pb = [ax * sp + ay * size * 0.3 * q, q * q * size * 2, q * 1.1];
      }
      if (!red && t >= tk - STEP && t < tk + hold) {
        c.fillStyle = PAPER;
        c.fillRect(x - s * 0.55, y - s * 0.55, s * 1.1, s * 1.1);
      }
      c.fillStyle = red ? PAPER : INK;
      drawSplit(c, g, x, y, s, w, pa, pb);
    }
  }

  /** Snare: a cross-reference line snaps from a margin glyph (popped to full ink) to the glyph being sung. */
  private snaps(c: CanvasRenderingContext2D, t: number) {
    const ish = this.ish;
    const [tx, ty] = this.anchor;
    if (this.anchorT < 0) return;
    for (let j = lastIdx(this.snares, t); j >= 0 && t - this.snares[j]! < SNAP; j--) {
      const age = t - this.snares[j]!;
      const cell = this.cells[Math.floor(hash(j, 81) * this.cells.length)]!;
      const dx = tx - cell.x, dy = ty - cell.y;
      const d = Math.hypot(dx, dy);
      const len = d - 80;
      if (len < 60) continue;
      const ux = dx / d, uy = dy / d;
      const p = age < STEP ? 0.45 : 1;
      const x0 = cell.x + ux * 30, y0 = cell.y + uy * 30;
      const x1 = x0 + ux * len * p, y1 = y0 + uy * len * p;
      c.strokeStyle = INK;
      c.fillStyle = INK;
      c.lineWidth = age < 0.09 ? 4 : 2;
      c.beginPath();
      c.moveTo(x0, y0);
      // after its first steps the line kinks once: it is a cross-reference, not a pointer
      if (age > 0.15) {
        const mx = x0 + ux * len * 0.5 - uy * 18 * (hash(j, 82) - 0.5) * 2, my = y0 + uy * len * 0.5 + ux * 18 * (hash(j, 82) - 0.5) * 2;
        c.lineTo(mx, my);
      }
      c.lineTo(x1, y1);
      c.stroke();
      if (p === 1) this.head(c, x1, y1, Math.atan2(uy, ux), 18);
      if (ish) {
        const s = cell.size * (age < 2 * STEP ? 1.4 : 1.15);
        c.fillStyle = PAPER;
        c.fillRect(cell.x - s * 0.55, cell.y - s * 0.55, s * 1.1, s * 1.1);
        this.cellGlyph(c, ish, Math.floor(hash(j, 83) * ATLAS_N), cell.x, cell.y, s);
      }
    }
  }

  /** An arrow head at (x, y) pointing along angle d. */
  private head(c: CanvasRenderingContext2D, x: number, y: number, d: number, s: number) {
    c.beginPath();
    c.moveTo(x + Math.cos(d) * 6, y + Math.sin(d) * 6);
    c.lineTo(x + Math.cos(d + 2.6) * s, y + Math.sin(d + 2.6) * s);
    c.lineTo(x + Math.cos(d - 2.6) * s, y + Math.sin(d - 2.6) * s);
    c.closePath();
    c.fill();
  }

  /**
   * Kick: a past sung kanji slips. Its right (or lower) half is pushed out by a wrong half from another song
   * kanji, which slides in and holds for 0.2 s; then the glyph is itself again. Dense: two per kick.
   */
  private slips(c: CanvasRenderingContext2D, t: number) {
    if (this.mode === 'homophone') return;
    const dn = this.dens(t);
    for (let k = lastIdx(this.kicks, t); k >= 0 && t - this.kicks[k]! < 0.2; k--) {
      const tk = this.kicks[k]!;
      const age = t - tk;
      const past = this.drawn.filter((e) => e.start < tk - 0.3);
      const n = Math.min(past.length, dn > 0.6 ? 2 : 1);
      for (let m = 0; m < n; m++) {
        const e = past[Math.floor(hash(k, m, 91) * past.length)]!;
        const lr = LR.includes(e.ch);
        const pool = lr ? LR : TB;
        let b = pool[Math.floor(hash(k, m, 92) * pool.length)]!;
        if (b === e.ch) b = pool[(pool.indexOf(b) + 5) % pool.length]!;
        const g: Chimera = { a: e.ch, b, mode: lr ? 'lr' : 'tb', cut: lr ? 0.44 : 0.5, famA: e.fam, famB: e.fam };
        const in_ = age < STEP ? 0.4 : age < 2 * STEP ? 0.12 : 0;
        const kick = age < 2 * STEP ? -0.05 * e.size : 0;
        c.fillStyle = PAPER;
        c.fillRect(e.x - e.size / 2, e.y - e.size / 2, e.size, e.size);
        c.fillStyle = INK;
        drawSplit(
          c, g, e.x, e.y, e.size, e.w,
          lr ? [kick, 0, 0] : [0, kick, 0],
          lr ? [0, in_ * e.size, 0] : [in_ * e.size, 0, 0],
        );
      }
    }
  }

  // ---------- the voice ----------

  /** Units down a column from `top`, each hopping in at its onset; weights a little uneven. */
  private column(
    c: CanvasRenderingContext2D, us: WrittenUnit[], x: number, top: number, size: number, t: number,
    weight: number, seed = 0,
  ): number {
    c.fillStyle = INK;
    for (const u of us) {
      if (t < u.start) break;
      const w = weight + Math.round((hash(seed, u.from, 3) - 0.5) * 180);
      const dy = hop(t - u.start) * size;
      const ch = this.glyph(u, t);
      this.note(u, ch, x, top + size / 2, size, w, SERIF, t);
      top = drawV(c, ch, x, top + dy, size, SERIF, w) - dy;
    }
    return top;
  }

  /** One glyph of a headword, stamped in on its onset, centred on (x, cy). */
  private stampV(c: CanvasRenderingContext2D, u: WrittenUnit, ch: string, x: number, cy: number, size: number, w: number, t: number) {
    const s = size * slam(t - u.start);
    this.note(u, ch, x, cy, size, w, SERIF, t);
    drawV(c, ch, x, cy - s / 2, s, SERIF, w);
  }

  /** The English of syllables [from, to) of a line, phrase by phrase as sung. */
  private gloss(line: Line, from: number, to: number, t: number): string {
    return line.written!.phrases.filter((p) => p.from >= from && p.from < to && p.start <= t).map((p) => p.text).join(' ');
  }

  /** An English gloss turned 90°, down from (x, y). */
  private glossV(c: CanvasRenderingContext2D, s: string, x: number, y: number) {
    if (!s) return;
    c.save();
    c.translate(x, y);
    c.rotate(Math.PI / 2);
    c.fillStyle = tone(0.18);
    c.font = fnt(SANS, GLOSS, 500);
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(s, 0, 0);
    c.restore();
  }

  /** Units in a row centred on cx (laid out whole, each hopping in at its onset). Returns the row's width. */
  private row(
    c: CanvasRenderingContext2D, us: WrittenUnit[], cx: number, y: number, px: number, fam: string, w: number, t: number,
  ): number {
    c.font = fnt(fam, px, w);
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    const ws = us.map((u) => c.measureText(u.glyph).width);
    const total = ws.reduce((a, b) => a + b, 0);
    let x = cx - total / 2;
    us.forEach((u, i) => {
      if (t >= u.start) {
        const ch = this.glyph(u, t);
        this.note(u, ch, x + ws[i]! / 2, y, px, w, fam, t);
        c.fillText(ch, x, y + hop(t - u.start) * px);
      }
      x += ws[i]!;
    });
    return total;
  }

  /** The round seal, open onto red from `open`; the next copy closes the glyph, the one after closes the ring. */
  private sealFor(c: CanvasRenderingContext2D, x: number, y: number, r: number, open: number, t: number, gen: number) {
    if (t < open) return;
    const n = gen - genAt(this.copies, this.ctx.lyrics, open);
    if (n >= 2) return;
    seal(c, x, y, r, 'hole');
    if (n === 1) {
      c.fillStyle = PAPER;
      c.beginPath();
      c.arc(x, y, r * 0.84, 0, Math.PI * 2);
      c.fill();
    }
  }

  /** 1 for two type steps after a kick, else 0. */
  private kicked(t: number): number {
    const k = lastIdx(this.kicks, t);
    return k >= 0 && t - this.kicks[k]! < 2 * STEP ? 1 : 0;
  }

  // ---------- lines 51-53 ----------
  private chorus(c: CanvasRenderingContext2D, t: number, gen: number) {
    const L = this.L;
    const top = 160;
    // line 51: 卑怯, the seal still open from 神っぽいな; its ring jumps on the kick
    this.sealFor(c, 560, 720, 150 * (1 + 0.07 * this.kicked(t)), L[51]!.start, t, gen);
    this.entryV(c, L[51]!, '卑怯', 1560, top, t, 51);
    // line 52: 健康, bold, stamped glyph by glyph; each copy thins it a little more
    const u52 = units(L[52]!);
    const h0 = u52.findIndex((u) => u.glyph === '健');
    const ken = u52[h0]!;
    if (t >= ken.start) {
      const kill = gen - genAt(this.copies, this.ctx.lyrics, ken.start);
      const weight = [900, 640, 420, 260][Math.min(3, kill)]!;
      c.fillStyle = kill >= 3 ? tone(0.4) : INK;
      [0, 1].forEach((i) => {
        const u = u52[h0 + i]!;
        if (t < u.start) return;
        this.stampV(c, u, this.glyph(u, t), 1300, top + i * 150 + 75, 150, weight, t);
      });
    }
    this.column(c, u52, 1170, top, 40, t, 500, 52);
    this.glossV(c, this.gloss(L[52]!, 0, 999, t), 1124, top);
    // line 53: 畢竟
    if (t >= L[53]!.start) this.entryV(c, L[53]!, '畢竟', 990, top, t, 53);
  }

  /** A vertical entry: headword column (one stamp per onset), sung column, English. */
  private entryV(c: CanvasRenderingContext2D, line: Line, head: string, x: number, top: number, t: number, seed: number) {
    const us = units(line);
    const hi = us.findIndex((u) => u.glyph === head[0]);
    if (hi >= 0) {
      c.fillStyle = INK;
      [...head].forEach((ch, i) => {
        const u = us[hi + i]?.glyph === ch ? us[hi + i]! : us[hi]!;
        if (t >= u.start) this.stampV(c, u, this.glyph(u, t), x, top + i * 84 + 42, 84, 700, t);
      });
    }
    this.column(c, us, x - 90, top, 40, t, 500, seed);
    this.glossV(c, this.gloss(line, 0, 999, t), x - 136, top);
  }

  // ---------- line 54: faux-datamosh ----------
  private line54(c: CanvasRenderingContext2D, t: number) {
    const L = this.L;
    // the earlier page, drawn once (it is a pure function of t_base)
    if (!this.base) {
      this.base = new Layer2D();
      this.base.clear();
      const [drawn, a, at] = [this.drawn, this.anchor, this.anchorT];
      this.page(this.base.ctx, this.tBase, genAt(this.copies, this.ctx.lyrics, this.tBase));
      [this.drawn, this.anchor, this.anchorT] = [drawn, a, at];
    }
    const src = this.base.canvas;
    const S = src.width / W;
    c.clearRect(0, 0, W, H);
    c.drawImage(src, 0, 0, W, H);

    const us = units(L[54]!);
    const PX = 120;
    const PEN = 1300;
    const Y = 520;
    c.font = fnt(SERIF, PX, 700);
    const ws = us.map((u) => c.measureText(u.glyph).width);
    const cur = us.findLastIndex((u) => u.start <= t);
    // the row steps left on each onset so the newest glyph ends at the pen
    let end = 0;
    for (let i = 0; i <= cur; i++) end += ws[i]!;
    const x0 = PEN - end;
    const motion = -end; // px the row moved since the line began
    const ages = us.map((u) => t - u.start);

    // old glyphs first, then old pixels carried by the new motion over them, then the newest glyphs crisp
    const BAND = [Y - 110, Y + 110];
    const glyphs = (fresh: boolean) => {
      c.fillStyle = INK;
      c.font = fnt(SERIF, PX, 700);
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      let x = x0;
      us.forEach((u, i) => {
        if (i <= cur && (ages[i]! < 0.3) === fresh && x + ws[i]! > 270 && x < W - 270) {
          const ch = this.glyph(u, t);
          this.note(u, ch, x + ws[i]! / 2, Y, PX, 700, SERIF, t);
          c.fillText(ch, x, Y + hop(ages[i]!) * PX);
        }
        x += ws[i]!;
      });
    };
    glyphs(false);
    const B = 24;
    const cover = 0.25 + 0.5 * Math.min(1, (t - L[54]!.start) / (L[54]!.end - L[54]!.start));
    for (let by = BAND[0]!; by < BAND[1]!; by += B) {
      for (let bx = 264; bx < W - 264; bx += B) {
        const h = hash(bx, by, cur, 5);
        if (h >= cover) continue;
        const dx = Math.round(motion * (0.35 + 0.65 * hash(bx, by, 13)));
        const sx = Math.max(0, Math.min(W - B, bx - dx));
        const sy = by + Math.round((hash(bx, by, cur, 17) - 0.5) * 2) * B * 0.25;
        c.clearRect(bx, by, B, B);
        c.drawImage(src, sx * S, sy * S, B * S, B * S, bx, by, B, B);
      }
    }
    glyphs(true);
    // the English, phrase by phrase, under the row
    c.fillStyle = PAPER;
    c.fillRect(300, BAND[1]! + 40, 900, 40);
    c.fillStyle = tone(0.18);
    c.font = fnt(SANS, 28, 400);
    c.textAlign = 'left';
    c.fillText(this.gloss(L[54]!, 0, 999, t), 300, BAND[1]! + 60);
  }

  // ---------- lines 55-56: the loop ----------
  /**
   * The ring turns one slot on each その (the entry being sung comes to the top), tightens a little on each
   * kick, and its arrows snap taut on each snare. The kick moves the live cross-reference one entry on.
   */
  private ring(c: CanvasRenderingContext2D, t: number) {
    const CX = W / 2, CY = 520;
    const n = this.loop.length;
    // turn: the entry being sung at the top, reached in 3 steps from the slot before
    const gi = Math.max(0, this.loop.findLastIndex((g) => g.sono[0]!.start <= t));
    const tg = this.loop[gi]!.sono[0]!.start;
    const q = gi === 0 ? 1 : Math.min(1, Math.floor((t - tg) / STEP + 1) / 3);
    const turn = -(gi - 1 + q) * (2 * Math.PI) / n;
    const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n + turn;
    // tighten: each kick since the loop began draws it in; the kick itself squeezes for two steps
    const k0 = lastIdx(this.kicks, this.L[55]!.start);
    const kn = lastIdx(this.kicks, t) - k0;
    const tight = Math.max(0.78, 1 - 0.022 * kn) - 0.035 * this.kicked(t);
    const RX = 600 * tight, RY = 330 * tight;
    const sn = lastIdx(this.snares, t);
    const taut = sn >= 0 && t - this.snares[sn]! < 0.12;
    const live = (kn % n + n) % n;
    const shown = (g: Group) => g.head.length > 0 && t >= g.head[0]!.start;
    const pos = (i: number): [number, number] => [CX + RX * Math.cos(ang(i)), CY + RY * Math.sin(ang(i))];
    // the arrows: entry i points to entry i+1 once that one exists; the last points back to the first
    c.strokeStyle = INK;
    c.fillStyle = INK;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (!shown(this.loop[i]!) || !shown(this.loop[j]!)) continue;
      // the arrow draws itself on over 3 steps from the onset of the entry it points to
      const grow = Math.min(1, Math.floor((t - this.loop[j]!.head[0]!.start) / STEP + 1) / 3);
      const a0 = ang(i) + 0.3, a1 = a0 + (ang(i + 1) - 0.3 - a0) * grow;
      const at = (a: number): [number, number] => [CX + RX * 0.62 * Math.cos(a), CY + RY * 0.56 * Math.sin(a)];
      c.lineWidth = i === live ? 6 : taut ? 4 : 2.5;
      c.beginPath();
      if (taut) {
        c.moveTo(...at(a0));
        c.lineTo(...at(a1));
      } else {
        for (let s = 0; s <= 24; s++) {
          const [x, y] = at(a0 + ((a1 - a0) * s) / 24);
          if (s === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
      }
      c.stroke();
      const [ex, ey] = at(a1);
      const [px, py] = taut ? at(a0) : at(a1 - 0.02);
      this.head(c, ex, ey, Math.atan2(ey - py, ex - px), i === live ? 22 : 16);
    }
    this.loop.forEach((g, i) => {
      const next = this.loop[(i + 1) % n]!;
      const xref = shown(next) ? next.head.map((u) => this.glyph(u, t)).join('') : '';
      const [x, y] = pos(i);
      this.entryH(c, g, x, y, t, xref ? (ax, ay) => this.xrefText(c, xref, ax, ay, i === live) : null);
    });
  }

  /** A horizontal その〇〇 entry centred on (x, y): その, the headword, the English, a cross-reference. */
  private entryH(
    c: CanvasRenderingContext2D, g: Group, x: number, y: number, t: number,
    xref: ((x: number, y: number) => void) | null,
  ) {
    if (t < g.sono[0]!.start) return;
    c.fillStyle = tone(0.25);
    this.row(c, g.sono, x, y - 64, 30, SERIF, 500, t);
    c.fillStyle = INK;
    this.row(c, g.head, x, y, 76, SERIF, 600 + Math.round((hash(g.head[0]?.from ?? 0, g.line.i) - 0.5) * 160), t);
    const from = g.sono[0]!.from, to = (g.head[g.head.length - 1] ?? g.sono[1]!).to;
    const en = this.gloss(g.line, from, to, t).replace(/,$/, '');
    if (en) {
      c.fillStyle = tone(0.18);
      c.font = fnt(SANS, GLOSS, 500);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(en, x, y + 58);
    }
    xref?.(x, y + 92);
  }

  private xrefText(c: CanvasRenderingContext2D, s: string, x: number, y: number, bold = false) {
    c.fillStyle = INK;
    c.font = fnt(SANS, bold ? 30 : 24, bold ? 800 : 500);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(`→ ${s}`, x, y);
  }

  // ---------- line 57: 比況, the halves side by side ----------
  private compare(c: CanvasRenderingContext2D, t: number) {
    const line = this.L[57]!;
    const us = units(line);
    const hi = us.findIndex((u) => u.glyph === '比');
    const top = 200;
    if (t >= us[hi]!.start) {
      c.fillStyle = INK;
      us.slice(hi, hi + 2).forEach((u, i) => {
        if (t >= u.start) this.stampV(c, u, this.glyph(u, t), 1330, top + i * 130 + 65, 130, 800, t);
      });
    }
    this.column(c, us.slice(0, hi), 1120, top, 64, t, 500);
    this.column(c, us.slice(hi + 2), 900, top, 64, t, 500);
    this.glossV(c, this.gloss(line, 0, us[hi]!.from, t), 1056, top);
    this.glossV(c, this.gloss(line, us[hi]!.from, 999, t), 836, top);
  }

  // ---------- lines 58-59: entries that point to 神 ----------
  /** Every entry's cross-reference runs a leader into one hole onto red; each snare re-routes the leaders. */
  private pointers(c: CanvasRenderingContext2D, t: number) {
    const HX = W / 2, HY = 540;
    const on = this.refs.map((g) => g.head.length > 0 && t >= g.head[0]!.start);
    const count = on.filter(Boolean).length;
    const sn = lastIdx(this.snares, t);
    const fresh = sn >= 0 && t - this.snares[sn]! < 0.1;
    c.strokeStyle = INK;
    c.fillStyle = INK;
    this.refs.forEach((g, i) => {
      if (!on[i]) return;
      const x = 560 + (i % 3) * 400, y = i < 3 ? 380 : 700;
      // out of the cross-reference (top row, down) or over the その (bottom row, up), one elbow, into the hole
      const up = i >= 3;
      const sy = up ? y - 98 : y + 110;
      const ey = up ? sy - 14 : sy + 14;
      const ex = x + (HX - x) * 0.5 + (hash(sn, i, 61) - 0.5) * 160;
      c.lineWidth = fresh ? 6 : 3;
      c.beginPath();
      c.moveTo(x, sy);
      c.lineTo(x, ey);
      c.lineTo(ex, ey);
      c.lineTo(HX + Math.sign(x - HX) * 30, HY + (up ? 30 : -30));
      c.stroke();
    });
    if (count > 0) {
      c.save();
      c.globalCompositeOperation = 'destination-out';
      c.beginPath();
      c.arc(HX, HY, 10 + 5 * count + 6 * this.kicked(t), 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    this.refs.forEach((g, i) => {
      const x = 560 + (i % 3) * 400, y = i < 3 ? 380 : 700;
      this.entryH(c, g, x, y, t, on[i] ? (ax, ay) => this.xrefText(c, this.drift('神', 58, g.head[0]!.start, t, 5800 + i), ax, ay) : null);
    });
  }

  // ---------- lines 60-61: the relapse and ぽい ×3 ----------
  private stampSprite(s: number, st: WrittenUnit[]): { cv: HTMLCanvasElement; w: number; h: number } {
    let hit = this.stampSprites.get(s);
    if (hit) return hit;
    const m = document.createElement('canvas').getContext('2d')!;
    m.font = fnt(SERIF, 110, 700);
    const ws = st.map((u) => m.measureText(u.glyph).width);
    const w = ws.reduce((a, b) => a + b, 0);
    const maxOffset = s * 7 + 10;
    const cvW = Math.ceil(w + maxOffset + 30);
    const cvH = Math.ceil(150 + s * 5);
    const { cv, c } = makeCanvas(cvW, cvH);
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    for (let k = s; k >= 0; k--) {
      c.fillStyle = k === 0 ? INK : tone(0.35 + 0.15 * k);
      const fam = k % 2 ? SANS : SERIF;
      const weight = 700 - k * 150;
      c.font = fnt(fam, 110, weight);
      let lx = k * 7;
      const ly = cvH / 2 + k * 5;
      st.forEach((u, i) => {
        c.fillText(u.glyph, lx, ly);
        lx += ws[i]!;
      });
    }
    hit = { cv, w, h: cvH };
    this.stampSprites.set(s, hit);
    return hit;
  }

  // ---------- lines 60-61: the relapse and ぽい ×3 ----------
  private relapse(c: CanvasRenderingContext2D, t: number, gen: number) {
    const L = this.L;
    this.sealFor(c, 1450, 560, 170 * (1 + 0.08 * this.kicked(t)), L[60]!.start, t, gen);
    if (t < L[61]!.start) {
      this.column(c, units(L[60]!), 1000, 180, 72, t, 600);
      this.glossV(c, this.gloss(L[60]!, 0, 999, t), 930, 180);
      return;
    }
    const us = units(L[61]!);
    const ak = us.findIndex((u) => u.glyph.startsWith('憧'));
    // ぽいな ぽいな ぽい: each stamp is a copy of the last, so it carries one more offset impression.
    // Each slams in on its first onset; the landing shakes the stamps already down.
    const stamps = [us.slice(0, 3), us.slice(3, 6), us.slice(6, ak)];
    const landing = stamps.findIndex((st) => t - st[0]!.start >= 0 && t - st[0]!.start < STEP);
    let x = 300;
    stamps.forEach((st, s) => {
      const t0 = st[0]!.start;
      if (t < t0) return;
      const sp = this.stampSprite(s, st);
      const sc = slam(t - t0);
      const shake = landing > s ? (hash(s, landing, 7) - 0.5) * 14 : 0;
      c.save();
      c.translate(x + sp.w / 2 + shake, 380);
      if (sc !== 1) c.scale(sc, sc);
      c.drawImage(sp.cv, -sp.w / 2, -sp.h / 2);
      c.restore();
      x += sp.w + 40;
    });
    c.fillStyle = INK;
    this.row(c, us.slice(ak), 300 + 390, 640, 130, SERIF, 600, t);
    const en = this.gloss(L[61]!, 0, 999, t);
    c.fillStyle = tone(0.18);
    c.font = fnt(SANS, 28, 400);
    c.textAlign = 'left';
    c.fillText(en, 300, 790);
  }
}
