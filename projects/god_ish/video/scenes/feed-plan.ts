// Seam 0 → 1, "glyphs become type": what the old plate and the transition share. On the strikes of 失 and 敬 the
// brush glyphs of the manuscript pop off the page, a random half on each strike. original.ts takes a popped glyph
// off its page (a pale impression stays); feed.ts flies it as a metal slug into the glyph tray of plate 1.
import { SCALE } from '@pve/engine/gl';
import { lineNo, units, type Lyrics } from '@pve/engine/lyrics';
import { hash } from '@pve/engine/util';
import { PAPER, tone } from './_page';
import type { BStroke } from './original-brush';

/** One brush glyph in ink on the manuscript: its unit key `${line}:${unit}`, box centre and em, its strokes. */
export interface Ink {
  ch: string;
  key: string;
  x: number;
  y: number;
  em: number;
  strokes: BStroke[];
}

/** 失敬 stays on the page: the typebar strikes it in Mincho over the brush (original.ts, typeOver). */
const STAYS = '失敬';

/** The onsets of 失 and 敬 in line 3: the two strikes that knock the glyphs loose. */
export function strikes(L: Lyrics): [number, number] {
  const us = units(lineNo(L, 3));
  const a = us.find((u) => u.glyph.includes('失')), b = us.find((u) => u.glyph.includes('敬'));
  if (!a || !b) throw new Error('feed: line 3 has no 失敬');
  return [a.start, b.start];
}

/**
 * When each ink glyph pops off the page (Infinity: it stays). Set A pops on 失 and lands in the tray on the cut;
 * set B pops on 敬 and lands on the next kicks. A glyph whose face plate 1 strikes in its first lines (4-6) is in
 * set A: its slug must be in the tray before the selector takes it.
 */
export function popTimes(L: Lyrics, ink: Ink[]): number[] {
  const [a, b] = strikes(L);
  const early = [4, 5, 6].flatMap((i) => units(lineNo(L, i)).map((u) => u.glyph)).join('');
  return ink.map((g, i) => (STAYS.includes(g.ch) ? Infinity : early.includes(g.ch) || hash(i, 31) < 0.45 ? a : b));
}

/** A popped glyph's patch for the page: paper over its strokes and a pale impression where it lay. */
export interface LiftPatch {
  cv: HTMLCanvasElement;
  /** Top left and side, canvas px. */
  x: number;
  y: number;
  side: number;
}

/** Draw the patch once (at the output scale); `c.drawImage(p.cv, p.x, p.y, p.side, p.side)` takes the glyph off. */
export function liftPatch(g: Ink): LiftPatch {
  const side = Math.ceil(g.em * 1.5), x = Math.floor(g.x - side / 2), y = Math.floor(g.y - side / 2);
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.ceil(side * SCALE);
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.setTransform(SCALE, 0, 0, SCALE, -SCALE * x, -SCALE * y);
  c.fillStyle = PAPER;
  c.strokeStyle = PAPER;
  c.lineWidth = 3;
  for (const st of g.strokes) {
    c.fill(st.full);
    c.stroke(st.full);
  }
  c.translate(2, 2);
  c.fillStyle = tone(0.9);
  for (const st of g.strokes) c.fill(st.full);
  return { cv, x, y, side };
}
