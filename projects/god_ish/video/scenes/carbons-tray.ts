// The glyph tray of the Japanese typewriter (和文タイプ), seen from above: a dense grid of metal type faces, each
// one a glyph reversed (as the metal reads). The tray holds the kana, the vertical quotes and marks, and every
// kanji the song sings, in the order it first sings them. The selector stands over one face at a time.
import { units, type Lyrics } from '@pve/engine/lyrics';
import { fnt, SERIF, tone } from './_page';
import { SH } from './carbons-sheet';

/** The tray on the desk of plate 1: x, y, w, h (canvas px). The seam 0 → 1 (feed.ts) lands its slugs in it. */
export const TRAY_BOX = [60, 150, 410, SH] as const;

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCharCode(a + i));
/** Hiragana ぁ..ゖ, katakana ァ..ヺ and the long mark. */
const KANA = [...range(0x3041, 0x3096), ...range(0x30a1, 0x30fa), 'ー'];
const MARKS = ['〝', '〟', '、', '。', '「', '」', '…'];
const KANJI = /[\u4e00-\u9fff々]/;

export interface TrayCell { x: number; y: number }

export class Tray {
  /** Face size, px. */
  readonly s: number;
  private readonly at = new Map<string, TrayCell>();
  private readonly img: HTMLCanvasElement;

  /** box: x, y, w, h of the tray on the page. */
  constructor(lyrics: Lyrics, readonly box: readonly [number, number, number, number]) {
    const kanji: string[] = [];
    for (const l of lyrics.lines) {
      for (const u of units(l)) for (const ch of u.glyph) if (KANJI.test(ch) && !kanji.includes(ch)) kanji.push(ch);
    }
    const faces = [...KANA, ...MARKS, ...kanji];
    const [bx, by, bw, bh] = box;
    // the largest face that fits the whole vocabulary in the box
    let s = 48;
    while (Math.floor(bw / s) * Math.floor(bh / s) < faces.length) s--;
    this.s = s;
    const cols = Math.floor(bw / s), rows = Math.floor(bh / s);
    const x0 = bx + (bw - cols * s) / 2, y0 = by + (bh - rows * s) / 2;

    this.img = document.createElement('canvas');
    this.img.width = bw;
    this.img.height = bh;
    const c = this.img.getContext('2d', { willReadFrequently: true })!;
    // the bed: iron between the faces
    c.fillStyle = tone(0.06);
    c.fillRect(0, 0, bw, bh);
    c.font = fnt(SERIF, s * 0.66, 500);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i < cols * rows; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const x = x0 + col * s + s / 2, y = y0 + row * s + s / 2;
      // the top of the type bar
      c.fillStyle = tone(0.6);
      c.fillRect(x - bx - s / 2 + 2, y - by - s / 2 + 2, s - 4, s - 4);
      const ch = faces[i];
      if (ch === undefined) continue; // the spare slots at the end of the tray hold blank bars
      this.at.set(ch, { x, y });
      // the face, reversed
      c.save();
      c.translate(x - bx, y - by);
      c.scale(-1, 1);
      c.fillStyle = tone(0.16);
      c.fillText(ch, 0, 0);
      c.restore();
    }
  }

  /** The face the selector takes for a written unit: its first glyph that is a face (quotes are struck apart). */
  cellOf(glyph: string): TrayCell {
    for (const ch of glyph) {
      const cell = this.at.get(ch);
      if (cell) return cell;
    }
    throw new Error(`the tray has no face for "${glyph}"`);
  }

  /** The tray, and the selector over `sel`; `struck`: the bar is up at the platen, its slot shows empty. */
  draw(c: CanvasRenderingContext2D, sel: TrayCell, struck: boolean) {
    const [bx, by, bw, bh] = this.box;
    c.drawImage(this.img, bx, by);
    const s = this.s;
    c.save();
    if (struck) {
      c.fillStyle = tone(0);
      c.fillRect(sel.x - s / 2 + 2, sel.y - s / 2 + 2, s - 4, s - 4);
    }
    // the selector: two rails through the face and a frame on it
    c.fillStyle = tone(1);
    const g = s / 2 + 4;
    c.fillRect(bx, sel.y - 1, sel.x - g - bx, 2);
    c.fillRect(sel.x + g, sel.y - 1, bx + bw - sel.x - g, 2);
    c.fillRect(sel.x - 1, by, 2, sel.y - g - by);
    c.fillRect(sel.x - 1, sel.y + g, 2, by + bh - sel.y - g);
    c.strokeStyle = tone(1);
    c.lineWidth = 3;
    c.strokeRect(sel.x - g, sel.y - g, 2 * g, 2 * g);
    c.restore();
  }
}
