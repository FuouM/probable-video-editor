// Plate 0, look 'shakyo' (写経): a sutra-copying sheet. A ruled grid of square cells, 17 to a column, read right to
// left. The title column ぽい辞書, then each entry in two columns: its headword in red brush (the rubric) with the
// Fraktur gloss below it, and the sung line, one glyph to a cell, written by brush in real stroke order across each
// unit's sung time.
import { H } from '@pve/engine/gl';
import type { Line } from '@pve/engine/lyrics';
import { GLOSS, fnt, INK, RED, tone } from './_page';
import { brushGlyph, writeBrush, type BStroke } from './original-brush';
import type { Entry } from './original';
import type { Ink } from './feed-plan';

const C = 54; // the cell
const ROWS = 17;
const TOP = 78;
const RIGHT = 1824;
const COLS = 32;
const EM = 49; // the glyph box inside a cell
const RUBY = 20;

interface Glyphs {
  strokes: BStroke[];
  t0: number;
  dur: number;
  red: boolean;
  em: number;
}

const colX = (k: number) => RIGHT - C * (k + 0.5);
const rowY = (r: number) => TOP + C * r + (C - EM) / 2;
const chars = (g: string) => [...g.replace(/[「」"\s]/g, '')];

export class Shakyo {
  private title: BStroke[] = [];
  private glyphs: Glyphs[] = [];
  private glosses: { line: Line; x: number; y: number }[] = [];
  /** The glyph boxes of each sung unit, by `${line}:${unit}`: centre x, y and em. */
  readonly cells = new Map<string, [number, number, number][]>();
  /** Every sung glyph written in ink (not the rubrics), one by one: the seam to plate 1 lifts them off. */
  readonly ink: Ink[] = [];

  constructor(entries: Entry[]) {
    [...'ぽい辞書'].forEach((ch, r) => this.title.push(...brushGlyph(ch, colX(0) - EM / 2, rowY(r), EM, r)));
    entries.forEach((e, k) => {
      const hc = 2 + 2 * k, lc = 3 + 2 * k;
      let hr = 0, lr = 0;
      e.us.forEach((u, j) => {
        const dur = Math.min(0.42, Math.max(0.12, u.end - u.start));
        const cs = chars(u.glyph);
        const line: BStroke[] = [];
        const boxes: [number, number, number][] = [];
        for (const ch of cs) {
          if (lr >= ROWS) throw new Error(`shakyo: line ${e.line.i} is longer than ${ROWS} cells`);
          const g = brushGlyph(ch, colX(lc) - EM / 2, rowY(lr), EM, lc * 31 + lr);
          line.push(...g);
          boxes.push([colX(lc), rowY(lr) + EM / 2, EM]);
          this.ink.push({ ch, key: `${e.line.i}:${j}`, x: colX(lc), y: rowY(lr) + EM / 2, em: EM, strokes: g });
          lr++;
        }
        this.cells.set(`${e.line.i}:${j}`, boxes);
        this.glyphs.push({ strokes: line, t0: u.start, dur, red: false, em: EM });
        if (j < e.head[0] || j >= e.head[1]) return;
        // the headword is written in red as it is sung
        const head: BStroke[] = [];
        for (const ch of cs) head.push(...brushGlyph(ch, colX(hc) - EM / 2, rowY(hr++), EM, hc * 31 + hr, 1.15));
        this.glyphs.push({ strokes: head, t0: u.start, dur, red: true, em: EM });
        if (e.ruby && j === e.head[1] - 1) {
          // the reading: small kana under the headword, two cells
          const ruby: BStroke[] = [];
          [...e.ruby].forEach((ch, i) => ruby.push(...brushGlyph(ch, colX(hc) - RUBY / 2, TOP + C * hr + 5 + i * (RUBY + 4), RUBY, i, 1.4)));
          this.glyphs.push({ strokes: ruby, t0: u.start, dur, red: false, em: RUBY });
          hr += Math.ceil(([...e.ruby].length * (RUBY + 4) + 5) / C);
        }
      });
      this.glosses.push({ line: e.line, x: colX(hc), y: TOP + C * (hr + 0.5) });
    });
  }

  draw(c: CanvasRenderingContext2D, t: number) {
    // the ruling: column rules, fainter cell rules, a double frame
    const left = RIGHT - C * COLS, bottom = TOP + C * ROWS;
    c.fillStyle = tone(0.84);
    for (let r = 1; r < ROWS; r++) c.fillRect(left, TOP + C * r, RIGHT - left, 1);
    c.fillStyle = tone(0.62);
    for (let k = 1; k < COLS; k++) c.fillRect(RIGHT - C * k, TOP, 1, bottom - TOP);
    c.strokeStyle = tone(0.5);
    c.lineWidth = 2;
    c.strokeRect(left - 10, TOP - 10, RIGHT - left + 20, bottom - TOP + 20);
    c.lineWidth = 1;
    c.strokeRect(left - 0.5, TOP - 0.5, RIGHT - left + 1, bottom - TOP + 1);
    if (bottom + 30 > H) throw new Error('shakyo: the grid runs off the page');

    c.fillStyle = INK;
    writeBrush(c, this.title, 1, EM);
    for (const g of this.glyphs) {
      if (t < g.t0) continue;
      c.fillStyle = g.red ? RED : INK;
      writeBrush(c, g.strokes, (t - g.t0) / g.dur, g.em);
    }
    // the gloss: tiny Fraktur down the headword column, phrase by phrase as sung
    for (const gl of this.glosses) {
      const text = gl.line.written!.phrases.filter((ph) => ph.start <= t).map((ph) => ph.text).join(' ');
      if (!text) continue;
      c.save();
      c.translate(gl.x, gl.y);
      c.rotate(Math.PI / 2);
      c.fillStyle = INK;
      c.font = fnt(GLOSS, 17);
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(text, 0, 0);
      c.restore();
    }
  }
}
