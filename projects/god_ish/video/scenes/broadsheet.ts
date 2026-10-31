// Plate 2 · Broadsheet (movable type). A Japanese newspaper front page: masthead with the 神 seal, tiers (段) of
// vertical body text, ruled. Each sung line is set as a headline on its onsets, with ruby read from the sung
// syllables and a small EN gloss. The press runs faster than the type: every syllable pulls an impression that
// sets many body columns at once, until the tiers and then the margins are full (line 13). Copy loss: sorts wear
// with every impression after their onset (kerning drift, tilt, starved ink, squash, nicks); the sheet takes
// ink spread and the set-off of its facing sheet. Lines 14-15: 夢 in wood type, growing linearly in time past the
// sheet. Line 16: a stop-press box, and THE END in red wood type. Line 17: two impressions, one per うええい, each
// doubling the sheet off register and cutting its うええい through it onto the red.
import type { Frame } from '@pve/engine/scene';
import { H, makeCanvas, SCALE, scaleContext2D, W } from '@pve/engine/gl';
import { pad0 } from '@pve/engine/util';
import { lineNo, rubyOf, syllables, units, type Line, type Lyrics, type Syl, type WrittenUnit } from '@pve/engine/lyrics';
import { font } from '@pve/engine/type';
import { changesOf, copyTimes, CUT1, CUT2, genAt, INK, MONO, PageScene, PAPER, rebate, RED, SANS, seal, SERIF, statusLine, type SurfaceOpts } from './_page';
import { PRESS } from './_era_press';
import { Body, BODY_X, TIER, TIERS, type Rect } from './broadsheet-body';
import { box, column, gloss, latinWood, sort, wear, Wood } from './broadsheet-type';

export const SHEET: Rect = [110, 30, 1810, 1050];
/** Headlines that the body sets around. */
const H12: Rect = [1462, 72, 1640, 650];
const H13: Rect = [1300, 72, 1458, 420];
const BANNER: Rect = [250, 72, 1290, 196];
/** The masthead: the seal centre and radius, the name 神っぽいな down from y, a step per sort. */
export const MAST = { x: 1708, sealY: 135, sealR: 54, y: 245, step: 72, size: 70, name: ['神', 'っ', 'ぽ', 'い', 'な'] };
/** Line 12, the first headline: its two columns, top and size. */
export const HEAD12 = { x: [1590, 1505], y: 84, size: 74 };
/** The boxes the body sets around: the headlines, the banner and its ruby, the masthead. */
export const RESERVED: Rect[] = [H12, H13, [BANNER[0], BANNER[1], BANNER[2], BANNER[3] + 26], [1648, 30, 1810, 1050]];
/** The body text: lines 0-13 reprinted. */
export function bodyText(lyr: Lyrics): string {
  let text = '';
  for (let i = 0; i <= 13; i++) {
    const l = lineNo(lyr, i);
    if (l.written) text += `${l.written.jp.replace(/\s/g, '')}。`;
  }
  return text;
}
/** The impressions: the sung syllable onsets of lines 12-17, sorted, and how many of them fill the sheet (lines 12-13). */
export function pressOnsets(lyr: Lyrics): { onsets: number[]; fill: number } {
  const onsets: number[] = [];
  let fill = 0;
  for (let i = 12; i <= 17; i++) {
    const line = lineNo(lyr, i);
    const ghosts = new Set(line.written!.ghosts);
    for (const [k, s] of syllables(line).entries()) if (!ghosts.has(k)) onsets.push(s.start);
    if (i === 13) fill = onsets.length;
  }
  return { onsets: onsets.sort((a, b) => a - b), fill };
}
/** Body columns printed after `imp` impressions, of `count`. */
export const bodyShown = (count: number, imp: number, fill: number) => Math.round(count * (0.06 + 0.94 * Math.min(1, imp / fill)));
/** 夢: its centre, its size at its onset, and the factor per syllable that sets its size at the end of line 15. */
const DREAM = { x: 820, y: 560, s0: 260, k: 1.17 };
/** Its reading fades out linearly over this size range (px). */
const DREAM_RUBY: [number, number] = [500, 900];
/** The 夢 block is cut once at this size (px) and scaled; it spans DREAM_PAD times its size from its centre. */
const DREAM_REF = 520;
const DREAM_PAD = 0.8;
/** THE END: top left and cap height. */
const END = { x: 190, y: 480, h: 250 };
/** うええい: the two columns cut by the two impressions, and the offset of each impression. */
const UEEI = [{ x: 1500, dx: 5, dy: 3 }, { x: 1235, dx: -4, dy: 6 }];
const UEEI_Y = 290;
const UEEI_SIZE = 170;
/** Top of the slips of the true marks on the bed. */
const MARKS_Y = 1057;

interface Sung { line: Line; us: WrittenUnit[]; syls: Syl[] }

export default class Broadsheet extends PageScene {
  private copies: number[] = [];
  /** Syllable onsets of lines 12-17: each pulls an impression. */
  private onsets: number[] = [];
  /** Onsets of lines 12-13: the sheet is full at the last. */
  private fillOnsets = 0;
  private L: Sung[] = [];
  private body!: Body;
  /** The wood block of THE END, on its own layer, set again only when it changes. */
  private end = new Wood();
  /** The onsets that grow 夢: the first is its own. */
  private dreamT: number[] = [];
  /** The right edge of THE END as last set. */
  private endX1 = END.x;
  private baseCv: HTMLCanvasElement | null = null;
  private baseCtx: CanvasRenderingContext2D | null = null;
  private baseKey = '';
  private box14Cv: HTMLCanvasElement | null = null;
  private box14Ctx: CanvasRenderingContext2D | null = null;
  private box14Key = '';
  private box15Cv: HTMLCanvasElement | null = null;
  private box15Ctx: CanvasRenderingContext2D | null = null;
  private box15Key = '';

  override async init() {
    this.continuousLive = true;
    await super.init();
    this.warm([PRESS]);
    const lyr = this.ctx.lyrics;
    this.copies = copyTimes(lyr);
    for (let i = 12; i <= 17; i++) {
      const line = lineNo(lyr, i);
      this.L[i] = { line, us: units(line), syls: syllables(line) };
    }
    const press = pressOnsets(lyr);
    this.onsets = press.onsets;
    this.fillOnsets = press.fill;
    this.body = new Body(bodyText(lyr), RESERVED, SHEET);
    this.changes = changesOf(lyr, [12, 13, 14, 15, 16, 17], this.copies);
    const l14 = this.L[14]!;
    const from = l14.us.find((u) => u.glyph === '夢')!.start;
    this.dreamT = [14, 15].flatMap((li) => this.L[li]!.syls.map((s) => s.start)).filter((s) => s >= from - 1e-6).sort((a, b) => a - b);
    const dream = l14.us.findIndex((u) => u.glyph === '夢');
    this.dreamBlock(l14, dream, 'rim');
    this.dreamBlock(l14, dream, 'face');
    this.dreamBlock(l14, dream, 'ruby');
  }

  /**
   * 夢 grows linearly in time on every frame (over the base page, under the stop-press boxes and line 17),
   * followed by the true marks on the bed on their slips of paper.
   */
  protected override live(c: CanvasRenderingContext2D, f: Frame) {
    const t = f.t;
    const L = this.L;
    const l14 = L[14]!;
    const dream = l14.us.findIndex((u) => u.glyph === '夢');
    const s = this.dreamSize(t);
    if (s > 0) {
      const side = s * DREAM_PAD * 2, x = DREAM.x - side / 2, y = DREAM.y - side / 2;
      c.drawImage(this.dreamBlock(l14, dream, 'rim'), x, y, side, side);
      c.save();
      c.globalCompositeOperation = 'darken';
      c.drawImage(this.dreamBlock(l14, dream, 'face'), x, y, side, side);
      const ra = 1 - (s - DREAM_RUBY[0]) / (DREAM_RUBY[1] - DREAM_RUBY[0]);
      if (ra > 0) {
        c.globalAlpha = Math.min(1, ra);
        c.drawImage(this.dreamBlock(l14, dream, 'ruby'), x, y, side, side);
      }
      c.restore();
      // Re-composite the stop-press boxes and line 17 over 夢 so 夢 stays behind them
      if (t >= l14.line.start && this.box14Cv) c.drawImage(this.box14Cv, 140, 250);
      if (t >= L[15]!.line.start && this.box15Cv) c.drawImage(this.box15Cv, 346, 250);
      if (t >= L[16]!.line.start) this.drawLine16And17(c, t);
    }
    const gen = genAt(this.copies, this.ctx.lyrics, t);
    const cur = [17, 16, 15, 14, 13, 12].find((i) => L[i]!.line.start <= t) ?? 12;
    const us = L[cur]!.us;
    let ui = 0;
    us.forEach((u, i) => { if (u.start <= t) ui = i + 1; });
    const leftExtra = `IMPRESSION ${String(this.imp(t)).padStart(3, '0')}   LINE ${cur}  ${ui}/${us.length}`;
    statusLine(c, gen, t, leftExtra, '', INK, true);
  }
  /** Impressions pulled at or before t. */
  private imp(t: number) {
    let n = 0;
    for (const o of this.onsets) if (o <= t) n++;
    return n;
  }

  private blocks = new Map<string, HTMLCanvasElement>();

  /**
   * The 夢 wood block at DREAM_REF, square, centred: 'face' the grained face, 'ruby' its reading, 'rim' the
   * rim of bare paper around it. Cut once on a scratch Wood at the frame centre, then copied out.
   */
  private dreamBlock(l14: Sung, dream: number, kind: 'face' | 'ruby' | 'rim'): HTMLCanvasElement {
    let cv = this.blocks.get(kind);
    if (cv) return cv;
    const s = DREAM_REF, side = s * DREAM_PAD * 2, cx = W / 2, cy = H / 2;
    const wood = new Wood();
    const wc = wood.begin(kind)!;
    wc.font = `900 ${s}px "${SANS}"`;
    wc.textAlign = 'center';
    wc.textBaseline = 'middle';
    if (kind === 'rim') {
      wc.strokeStyle = PAPER;
      wc.lineJoin = 'round';
      wc.lineWidth = Math.max(6, s * 0.014);
      wc.strokeText('夢', cx, cy);
    } else if (kind === 'face') {
      wc.fillStyle = INK;
      wc.fillText('夢', cx, cy);
      wood.grain(cx - s * 0.6, cy - s * 0.6, cx + s * 0.6, cy + s * 0.6, s, 14);
    } else {
      wc.fillStyle = INK;
      const r = rubyOf(l14.us[dream]!, l14.syls);
      wc.font = `700 ${s * 0.16}px "${SANS}"`;
      if (r) [...r].forEach((ch, k) => wc.fillText(ch, cx + s * 0.6, cy - s * 0.16 + k * s * 0.17));
    }
    cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(side * SCALE);
    const c = scaleContext2D(cv.getContext('2d', { willReadFrequently: true })!, SCALE);
    c.translate(side / 2 - cx, side / 2 - cy);
    wood.print(c, [cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2]);
    this.blocks.set(kind, cv);
    return cv;
  }

  /**
   * The size of 夢 at t: from its onset to the last syllable of line 15 it grows linearly in time, from DREAM.s0
   * to the size DREAM.k per syllable gives. It does not follow the syllables: that jittered.
   */
  private dreamSize(t: number): number {
    const T = this.dreamT;
    if (!T.length || t < T[0]!) return 0;
    const u = Math.min(1, (t - T[0]!) / (T[T.length - 1]! - T[0]!));
    return DREAM.s0 + (DREAM.s0 * DREAM.k ** (T.length - 1) - DREAM.s0) * u;
  }

  draw(c: CanvasRenderingContext2D, f: Frame): SurfaceOpts {
    const t = f.t;
    const lyr = this.ctx.lyrics;
    const imp = this.imp(t);
    const wearOf = (start: number) => wear(imp - this.imp(start));
    const L = this.L;
    const gen = genAt(this.copies, lyr, t);

    const u12 = L[12]!.us.filter((u) => u.start <= t).length;
    const u13 = L[13]!.us.filter((u) => u.start <= t).length;
    const ph12 = L[12]!.line.written!.phrases.filter((p) => p.start <= t).length;
    const ph13 = L[13]!.line.written!.phrases.filter((p) => p.start <= t).length;
    const baseKey = `${gen}:${imp}:${u12}:${u13}:${ph12}:${ph13}`;
    if (!this.baseCv) {
      const { cv, c: bc } = makeCanvas();
      this.baseCv = cv;
      this.baseCtx = bc;
    }
    if (baseKey !== this.baseKey) {
      this.baseKey = baseKey;
      const bc = this.baseCtx!;
      bc.clearRect(0, 0, W, H);
      // the press bed and the sheet
      bc.fillStyle = INK;
      bc.fillRect(0, 0, W, H);
      bc.fillStyle = PAPER;
      bc.fillRect(SHEET[0], SHEET[1], SHEET[2] - SHEET[0], SHEET[3] - SHEET[1]);
      // rules: a heavy rule under the top, tier rules, the masthead rule
      bc.fillStyle = INK;
      bc.fillRect(BODY_X[0], TIERS[0]! - 8, 1770 - BODY_X[0], 3);
      for (const y of TIERS.slice(1)) bc.fillRect(BODY_X[0], y - 4, BODY_X[1] - BODY_X[0], 1.5);
      bc.fillRect(BODY_X[0], TIERS[5]! + TIER + 4, 1770 - BODY_X[0], 3);
      bc.fillRect(1646, TIERS[0]!, 1.5, TIERS[5]! + TIER - TIERS[0]!);

      // the body: the press sets columns faster than the type comes
      this.body.print(bc, bodyShown(this.body.count, imp, this.fillOnsets));

      // the masthead: the 神 seal cut onto the red, the name, the edition (第 GEN 版)
      seal(bc, MAST.x, MAST.sealY, MAST.sealR, 'hole');
      MAST.name.forEach((ch, k) => sort(bc, ch, MAST.x, MAST.y + k * MAST.step, MAST.size, SERIF, 900, wear(imp * 0.5), 5000 + k, false, ch === 'っ'));
      bc.fillStyle = INK;
      bc.fillRect(1662, 640, 92, 2);
      ['第', pad0(gen), '版'].forEach((ch, k) => sort(bc, ch, MAST.x, 680 + k * 34, 28, SERIF, 600, 0, 5100 + k));

      // line 12: the first headline, two columns of bold Mincho
      const hBase = (i: number, idx: number[], x: number, y: number, size: number, family: string, weight: number) =>
        column(bc, L[i]!.us, x, y, { size, family, weight, idx, t, wearOf, seed: i * 1000 + x, syls: L[i]!.syls });
      hBase(12, [0, 1, 2, 3, 4], HEAD12.x[0]!, HEAD12.y, HEAD12.size, SERIF, 900);
      hBase(12, [5, 6, 7, 8, 9, 10, 11], HEAD12.x[1]!, HEAD12.y, HEAD12.size, SERIF, 900);
      this.glosses(bc, 12, t, H12[0] + 6, 618, 166);

      // line 13: two columns of bold Gothic, then the banner 逆に興奮してきたなあ, white out of a black slab: onto the red
      hBase(13, [0, 1, 2, 3, 4], 1420, 84, 58, SANS, 900);
      hBase(13, [5, 6, 7, 8, 9], 1345, 84, 58, SANS, 900);
      this.glosses(bc, 13, t, H13[0] + 6, 384, 150, [0, 1]);
      this.banner(bc, t, wearOf);
    }

    c.drawImage(this.baseCv!, 0, 0);

    const h = (i: number, idx: number[], x: number, y: number, size: number, family: string, weight: number, targetCtx = c) =>
      column(targetCtx, L[i]!.us, x, y, { size, family, weight, idx, t, wearOf, seed: i * 1000 + x, syls: L[i]!.syls });
    // lines 14-15: stop-press boxes; 夢 in wood type grows past the sheet. The block is cut once at a reference
    // size and scaled: the grain and the stroked rim of a glyph this large cost 10-20 ms to draw.
    // 夢 is drawn in live() on every frame so its linear growth is completely smooth (no 24/30 fps beat)
    const l14 = L[14]!;
    if (t >= l14.line.start) {
      const u14 = l14.us.filter((u) => u.start <= t).length;
      const ph14 = l14.line.written!.phrases.filter((p) => p.start <= t).length;
      const key14 = `${imp}:${u14}:${ph14}`;
      if (!this.box14Cv) {
        const { cv, c: bc } = makeCanvas(196, 450);
        this.box14Cv = cv;
        this.box14Ctx = bc;
      }
      if (key14 !== this.box14Key) {
        this.box14Key = key14;
        const bc = this.box14Ctx!;
        bc.clearRect(0, 0, 196, 450);
        bc.save();
        bc.translate(-140, -250);
        box(bc, 140, 250, 336, 700);
        h(14, [0, 1, 2, 3, 4], 288, 272, 62, SERIF, 900, bc);
        h(14, [5, 6, 7, 8, 9], 196, 272, 62, SERIF, 900, bc);
        this.glosses(bc, 14, t, 154, 600, 168);
        bc.restore();
      }
      c.drawImage(this.box14Cv!, 140, 250);
    }
    if (t >= L[15]!.line.start) {
      const l15 = L[15]!;
      const u15 = l15.us.filter((u) => u.start <= t).length;
      const ph15 = l15.line.written!.phrases.filter((p) => p.start <= t).length;
      const key15 = `${imp}:${u15}:${ph15}`;
      if (!this.box15Cv) {
        const { cv, c: bc } = makeCanvas(196, 450);
        this.box15Cv = cv;
        this.box15Ctx = bc;
      }
      if (key15 !== this.box15Key) {
        this.box15Key = key15;
        const bc = this.box15Ctx!;
        bc.clearRect(0, 0, 196, 450);
        bc.save();
        bc.translate(-346, -250);
        box(bc, 346, 250, 542, 700);
        h(15, [0, 1, 2, 3, 4], 494, 272, 62, SERIF, 900, bc);
        h(15, [5, 6, 7, 8, 9], 402, 272, 62, SERIF, 900, bc);
        this.glosses(bc, 15, t, 360, 600, 168);
        bc.restore();
      }
      c.drawImage(this.box15Cv!, 346, 250);
    }

    // line 16 & 17 are drawn via drawLine16And17 (and re-composited over 夢 in live)
    this.drawLine16And17(c, t);
    const l17 = L[17]!;
    const imps: [number, number][] = [];
    UEEI.forEach((u, k) => {
      if (l17.us[k * 4]!.start <= t) imps.push([u.dx, u.dy]);
    });

    return {
      era: PRESS,
      gen,
      bleed: 0.5 + Math.min(0.6, imp * 0.008),
      p: [imp * 0.0004, 1, Math.min(0.9, imp * 0.012), Math.min(1, imp / 40)],
      // the marks on the bed below the sheet are set after the impressions
      imp: imps,
      impRect: [0, 0, W, MARKS_Y],
    };
  }

  private drawLine16And17(c: CanvasRenderingContext2D, t: number) {
    const L = this.L;
    const imp = this.imp(t);
    const wearOf = (start: number) => wear(imp - this.imp(start));
    const h = (i: number, idx: number[], x: number, y: number, size: number, family: string, weight: number) =>
      column(c, L[i]!.us, x, y, { size, family, weight, idx, t, wearOf, seed: i * 1000 + x, syls: L[i]!.syls });
    const l16 = L[16]!;
    if (t >= l16.line.start) {
      box(c, 1456, 60, 1646, 590);
      h(16, [0, 1, 2, 3, 4, 5], 1596, 82, 58, SERIF, 900);
      h(16, [6, 7, 8], 1506, 82, 58, SERIF, 900);
      this.glosses(c, 16, t, 1470, 470, 166);
      const the = l16.us.findIndex((u) => u.glyph === 'THE');
      const end = l16.us.findIndex((u) => u.glyph === 'END');
      const on = [the, end].map((i) => l16.us[i]!.start <= t);
      const wc = this.end.begin(on.join());
      if (wc) {
        let x1 = END.x;
        if (on[0]) x1 = Math.max(x1, latinWood(wc, 'THE', END.x, END.y, END.h, RED));
        if (on[1]) x1 = Math.max(x1, latinWood(wc, 'END', END.x, END.y + END.h + 40, END.h, RED));
        if (x1 > END.x) this.end.grain(END.x, END.y, x1, END.y + END.h * 2 + 40, END.h * 1.6, 16, false);
        this.endX1 = x1;
      }
      if (this.endX1 > END.x) this.end.print(c, [END.x - 8, END.y - 8, this.endX1 + 8, END.y + END.h * 2 + 48]);
    }
    const l17 = L[17]!;
    UEEI.forEach((u, k) => {
      const first = l17.us[k * 4]!;
      if (first.start > t) return;
      c.font = `900 ${UEEI_SIZE}px "${SANS}"`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = k === 0 ? CUT1 : CUT2;
      for (let j = 0; j < 4; j++) {
        const g = l17.us[k * 4 + j]!;
        if (g.start > t) break;
        c.fillText(g.glyph, u.x, UEEI_Y + UEEI_SIZE * (j + 0.5));
      }
      gloss(c, l17.line.written!.phrases[k]!.text, u.x - 60, UEEI_Y + UEEI_SIZE * 4 + 12, 160, 18, true);
    });
  }

  /** The EN phrases of line i that have begun, small, from (x, y) down. `only`: the phrases of this column. */
  private glosses(c: CanvasRenderingContext2D, i: number, t: number, x: number, y: number, maxW: number, only?: number[]) {
    const ph = this.L[i]!.line.written!.phrases;
    const text = ph.filter((p, k) => p.start <= t && (!only || only.includes(k))).map((p) => p.text).join(' ');
    if (text) gloss(c, text, x, y, maxW, 16);
  }

  /** 逆に興奮してきたなあ: a black slab across the top, the sung glyphs and their ruby cut out of it onto the red. */
  private banner(c: CanvasRenderingContext2D, t: number, wearOf: (s: number) => number) {
    const l = this.L[13]!;
    const idx = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    if (l.us[idx[0]!]!.start > t) return;
    const [x0, y0, x1, y1] = BANNER;
    c.fillStyle = INK;
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
    const size = 90, step = (x1 - x0 - 40) / idx.length;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    idx.forEach((i, k) => {
      const u = l.us[i]!;
      if (u.start > t) return;
      const x = x0 + 20 + step * (k + 0.5);
      sort(c, u.glyph, x, y0 + 78, size, SANS, 900, wearOf(u.start) * 0.5, 13000 + i);
      const r = rubyOf(u, l.syls);
      if (r) {
        c.font = `700 22px "${SANS}"`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(r, x, y0 + 18);
      }
    });
    c.restore();
    // the gloss under the slab, in EN reading order
    this.glosses(c, 13, t, x0, y1 + 5, x1 - x0, [2, 3]);
  }
}
