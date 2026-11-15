// Plate 0, look 'illuminated': a European illuminated page set in Japanese. A knotwork initial (woven bands, over and
// under, red and ink, dotted round in red) holds the first glyph 愛. The text block is ruled; the headwords are
// rubricated, the gloss is in Fraktur. All the Japanese is written by the copyist's brush (original-brush.ts) in
// KanjiVG stroke order across each unit's sung time: 愛 in the initial, the sung lines in ink, the headwords in red.
// In the margin a vine grows one step per sung syllable, with a snail at its root and a bird at its top.
import { H, makeCanvas, W } from '@pve/engine/gl';
import { GLOSS, fnt, INK, PAPER, RED, tone } from './_page';
import { buildKnot, buildVine, drawBird, drawKnot, polyline, roundSquare, strokePts } from './_knot';
import { brushGlyph, writeBrush, type BStroke } from './original-brush';
import type { Entry } from './original';
import type { Ink } from './feed-plan';

type P = [number, number];

const TOP = 130;
const BOTTOM = 960;
const XS = [1690, 1440, 1220, 1000]; // the headword column of each entry
const BLOCK: [number, number] = [850, 1770]; // the text block, left and right
const INI = { x: 1635, y: 268, r: 135 }; // the initial: centre and half side
const INI_EM = 168;
const VINE_X = 800;
/** The vine's layer: stem, tendrils, leaves, berries and the bird at its top (logical px). */
const VINE_BOX = [VINE_X - 120, TOP - 80, 240, BOTTOM + 30 - (TOP - 80)] as const;

// ---------- marginalia ----------
/** The snail at the root of the vine: a coiled shell over a soft foot, the head raised with two feelers. */
function snail(c: CanvasRenderingContext2D, x: number, y: number) {
  // the foot: a soft body from the pointed tail on the left, under the shell, up the neck to the raised head
  c.fillStyle = tone(0.88);
  c.beginPath();
  c.moveTo(x - 52, y + 11);
  c.quadraticCurveTo(x - 20, y + 1, x + 10, y);
  c.quadraticCurveTo(x + 30, y - 2, x + 38, y - 12);
  c.quadraticCurveTo(x + 48, y - 20, x + 54, y - 8);
  c.quadraticCurveTo(x + 58, y + 2, x + 50, y + 8);
  c.quadraticCurveTo(x + 40, y + 13, x + 10, y + 13);
  c.quadraticCurveTo(x - 25, y + 13, x - 52, y + 11);
  c.closePath();
  c.fill();
  c.lineWidth = 1.8;
  c.stroke();
  // the feelers, each with an eye at its tip
  strokePts(c, [[x + 42, y - 14], [x + 42, y - 26], [x + 39, y - 36]], 1.6);
  strokePts(c, [[x + 49, y - 14], [x + 54, y - 25], [x + 58, y - 33]], 1.6);
  c.fillStyle = INK;
  c.beginPath();
  c.arc(x + 39, y - 37, 2.6, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(x + 58.5, y - 34, 2.6, 0, Math.PI * 2);
  c.fill();
  // the shell: a pale disc with the coil drawn in, tighter towards its centre
  const sx = x - 6, sy = y - 18, R = 26;
  c.fillStyle = tone(0.94);
  c.beginPath();
  c.arc(sx, sy, R, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 2;
  c.stroke();
  const coil: P[] = [];
  const turns = 2.6;
  for (let a = 0; a <= turns * Math.PI * 2; a += 0.08) {
    const r = R * (1 - a / (turns * Math.PI * 2)) ** 1.15;
    coil.push([sx + 2 + Math.cos(a + 1.2) * r * 0.98, sy - 1 + Math.sin(a + 1.2) * r * 0.98]);
  }
  strokePts(c, coil, 1.4);
}

/** Strokes written from t0 over dur, in ink or red. */
interface Writing {
  strokes: BStroke[];
  t0: number;
  dur: number;
  red: boolean;
  em: number;
}

const LINE_EM = 40;
const HEAD_EM = 80;
const RUBY_EM = 22;
const TITLE_EM = 54;
/** A unit is written across its sung time, but never slower than 0.42 s nor faster than 0.12 s. */
const writeDur = (s: number, e: number) => Math.min(0.42, Math.max(0.12, e - s));
const SMALL = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ';

export class Illuminated {
  private knot = buildKnot(INI, 34);
  private vine = buildVine({ x: VINE_X, top: TOP, bottom: BOTTOM, amp: 13, wave: 52, first: 40, step: 64, splay: 1.1 });
  private title: BStroke[] = [];
  private writing: Writing[] = [];
  private onsets: number[];
  /** The glyph boxes of each sung unit, by `${line}:${unit}`: centre x, y and em (愛 in the initial too). */
  readonly cells = new Map<string, [number, number, number][]>();
  /** Every sung glyph written in ink (not the rubrics), one by one: the seam to plate 1 lifts them off. */
  readonly ink: Ink[] = [];
  /**
   * The page as far as it no longer changes: the ruled block, title, initial and snail, and every writing done
   * (`done`). A finished writing is added once; a seek back draws it again. Only writings in progress are
   * drawn on each frame.
   */
  private base: { c: CanvasRenderingContext2D; done: boolean[] };
  /** The vine at `sung` syllables, on its own small layer. */
  private vineL: { c: CanvasRenderingContext2D; sung: number } | null = null;

  constructor(private entries: Entry[]) {
    const first = entries[0]!.us[0]!;
    if (first.glyph !== '愛') throw new Error(`illuminated: line 0 must open on 愛, got ${first.glyph}`);
    // the title column, already on the page: red brush
    [...'ぽい辞書'].forEach((ch, r) => this.title.push(...brushGlyph(ch, 1830 - TITLE_EM / 2, 140 + r * (TITLE_EM + 4), TITLE_EM, 50 + r, 1.15)));
    // 愛 in the initial
    const ai = brushGlyph('愛', INI.x - INI_EM / 2, INI.y - INI_EM / 2, INI_EM, 3, 0.72);
    this.writing.push({ strokes: ai, t0: first.start, dur: writeDur(first.start, first.end), red: false, em: INI_EM });
    this.cells.set(`${entries[0]!.line.i}:0`, [[INI.x, INI.y, INI_EM]]);
    this.ink.push({ ch: '愛', key: `${entries[0]!.line.i}:0`, x: INI.x, y: INI.y, em: INI_EM, strokes: ai });
    entries.forEach((e, k) => {
      const x = XS[k]!;
      const top = k === 0 ? INI.y + INI.r + 30 : TOP;
      const bx = x - 62;
      let y = top, hy = top;
      e.us.forEach((u, j) => {
        const dur = writeDur(u.start, u.end);
        const cs = [...u.glyph.replace(/[「」"\s]/g, '')];
        // the sung line beside the headword (愛 is in the initial)
        if (!(k === 0 && j === 0)) {
          const line: BStroke[] = [];
          const boxes: [number, number, number][] = [];
          for (const ch of cs) {
            // small kana sit high and right in a vertical line (KanjiVG draws them low and left)
            const sm = SMALL.includes(ch) ? LINE_EM * 0.24 : 0;
            const g = brushGlyph(ch, bx - LINE_EM / 2 + sm, y - sm, LINE_EM, k * 97 + j * 3 + line.length, 1.15);
            line.push(...g);
            boxes.push([bx + sm, y - sm + LINE_EM / 2, LINE_EM]);
            this.ink.push({ ch, key: `${e.line.i}:${j}`, x: bx + sm, y: y - sm + LINE_EM / 2, em: LINE_EM, strokes: g });
            y += SMALL.includes(ch) ? LINE_EM * 0.68 : LINE_EM;
          }
          this.cells.set(`${e.line.i}:${j}`, boxes);
          if (y > BOTTOM + 10) throw new Error(`illuminated: line ${e.line.i} runs past the block`);
          this.writing.push({ strokes: line, t0: u.start, dur, red: false, em: LINE_EM });
        }
        if (j < e.head[0] || j >= e.head[1]) return;
        // the headword: the rubric, written in red as it is sung
        const head: BStroke[] = [];
        for (const ch of cs) {
          head.push(...brushGlyph(ch, x - HEAD_EM / 2, hy, HEAD_EM, 7 + k * 13 + hy, 1.2));
          hy += HEAD_EM + 2;
        }
        this.writing.push({ strokes: head, t0: u.start, dur, red: true, em: HEAD_EM });
        if (e.ruby && j === e.head[1] - 1) {
          // the reading beside the headword, small red kana, written after the headword
          const ruby: BStroke[] = [];
          [...e.ruby].forEach((ch, i) => ruby.push(...brushGlyph(ch, x + 56 - RUBY_EM / 2, top + 8 + i * (RUBY_EM + 3), RUBY_EM, i, 1.4)));
          this.writing.push({ strokes: ruby, t0: u.start + dur, dur: 0.4, red: true, em: RUBY_EM });
        }
      });
    });
    this.onsets = entries.flatMap((e) => e.us.map((u) => u.start));
    this.base = this.fresh();
  }

  /** The base with nothing written yet. */
  private fresh() {
    const c = makeCanvas(W, H).c;
    this.page(c);
    return { c, done: this.writing.map(() => false) };
  }

  draw(c: CanvasRenderingContext2D, t: number) {
    const done = this.writing.map((w) => t >= w.t0 + w.dur);
    if (this.base.done.some((d, i) => d && !done[i])) this.base = this.fresh();
    const base = this.base;
    this.writing.forEach((w, i) => {
      if (!done[i] || base.done[i]) return;
      base.c.fillStyle = w.red ? RED : INK;
      writeBrush(base.c, w.strokes, 1, w.em);
      base.done[i] = true;
    });
    c.drawImage(base.c.canvas, 0, 0, W, H);

    // the brush in progress: 愛, the sung lines, the rubrics
    this.writing.forEach((w, i) => {
      if (t < w.t0 || done[i]) return;
      c.fillStyle = w.red ? RED : INK;
      writeBrush(c, w.strokes, (t - w.t0) / w.dur, w.em);
    });

    this.entries.forEach((e, k) => this.entry(c, e, k, t));
    const sung = this.onsets.filter((s) => s <= t).length;
    if (this.vineL?.sung !== sung) {
      const v = (this.vineL ??= { c: makeCanvas(VINE_BOX[2], VINE_BOX[3]).c, sung: -1 });
      v.sung = sung;
      v.c.clearRect(0, 0, VINE_BOX[2], VINE_BOX[3]);
      v.c.save();
      v.c.translate(-VINE_BOX[0], -VINE_BOX[1]);
      this.marginalia(v.c, sung);
      v.c.restore();
    }
    c.drawImage(this.vineL.c.canvas, VINE_BOX[0], VINE_BOX[1], VINE_BOX[2], VINE_BOX[3]);
  }

  /** What never changes: the ruled text block, the title column, the initial (dots and knot) and the snail. */
  private page(c: CanvasRenderingContext2D) {
    // the ruled text block: a double frame and column rules
    c.strokeStyle = tone(0.55);
    c.lineWidth = 1.5;
    c.strokeRect(BLOCK[0] - 14, TOP - 44, BLOCK[1] - BLOCK[0] + 28, BOTTOM - TOP + 70);
    c.lineWidth = 1;
    c.strokeRect(BLOCK[0] - 8, TOP - 38, BLOCK[1] - BLOCK[0] + 16, BOTTOM - TOP + 58);
    c.fillStyle = tone(0.82);
    for (const x of XS) for (const dx of [36, -92, -136]) {
      const y0 = x === XS[0] && dx > -100 ? INI.y + INI.r + 10 : TOP - 30;
      c.fillRect(x + dx, y0, 1, BOTTOM + 12 - y0);
    }

    // the title column
    c.fillStyle = RED;
    writeBrush(c, this.title, 1, TITLE_EM);

    // the initial: red dots round it, the knot
    c.fillStyle = RED;
    const dots = roundSquare(INI.x, INI.y, INI.r + 6, 40, 9);
    for (const { p } of dots) {
      c.beginPath();
      c.arc(p[0], p[1], 1.7, 0, Math.PI * 2);
      c.fill();
    }
    drawKnot(c, this.knot);

    // the snail waits at the root of the vine
    c.strokeStyle = INK;
    c.fillStyle = INK;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    snail(c, VINE_X - 70, BOTTOM + 34);
  }

  /** The Fraktur gloss along an entry, phrase by phrase as sung. */
  private entry(c: CanvasRenderingContext2D, e: Entry, k: number, t: number) {
    if (t < e.line.start - 0.05) return;
    const x = XS[k]!;
    const top = k === 0 ? INI.y + INI.r + 30 : TOP;
    const gloss = e.line.written!.phrases.filter((ph) => ph.start <= t).map((ph) => ph.text).join(' ');
    if (!gloss) return;
    c.save();
    c.translate(x - 112, top);
    c.rotate(Math.PI / 2);
    c.fillStyle = INK;
    c.font = fnt(GLOSS, 26);
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(gloss, 0, 0);
    c.restore();
  }

  /** The vine grows one step on every sung syllable of lines 0-3; the bird perches at the top before the final strikes. */
  private marginalia(c: CanvasRenderingContext2D, sung: number) {
    const { stem, sprigs } = this.vine;
    const fullSteps = Math.max(1, this.onsets.length - 3);
    const grown = Math.min(1, sung / fullSteps) * stem.length * 3;
    c.strokeStyle = INK;
    c.fillStyle = INK;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (grown <= 0) return;
    strokePts(c, stem.slice(0, Math.max(2, Math.floor(grown / 3))), 2.4);
    for (const sp of sprigs) {
      if (sp.at > grown) break;
      c.strokeStyle = INK;
      strokePts(c, sp.pts, 1.5);
      if (sp.leaf) {
        c.fillStyle = tone(0.9);
        polyline(c, sp.leaf, 0, sp.leaf.length - 1, false);
        c.closePath();
        c.fill();
        c.lineWidth = 1.3;
        c.stroke();
        const n = sp.leaf.length >> 1;
        strokePts(c, [sp.leaf[0]!, sp.leaf[n - 1]!], 0.9);
      }
      c.fillStyle = RED;
      for (const b of sp.berries) {
        c.beginPath();
        c.arc(b[0], b[1], 4, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.fillStyle = INK;
    if (sung >= fullSteps) drawBird(c, stem[stem.length - 1]![0] - 8, TOP - 44);
  }
}
