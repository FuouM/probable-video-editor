// Plate 4 · Stamps, printed (risograph). The hook (lines 29-35) as one riso poster on four spot drums
// (fluorescent pink, yellow, medium blue, black; see _era_riso.ts). The とぅとぅる lines are a grid of large blue
// kana, six rows of eight slots, one row per line, each on a yellow stripe (even rows) or a blue tint (odd rows);
// each "風" is cut through every drum onto the red substrate. ぽいじゃんぽいじゃん (line 32) is two rows of huge
// fluorescent pink kana overprinted across the grid (purple over the blue) and knocked out of the yellow, so pink
// never lies on yellow (that mix would be the red's orange). Every line is a new pass at its first syllable (a
// copy): each drum slips further off register on its own. A yellow spine stands at the right; line 36 (神っぽいな)
// prints a black slab over it with a new 神 seal cut through onto the red substrate, っぽいな knocked out of the
// black to the yellow beneath.
// v4 motion (treatment, "Motion (v4)"). Each kana stamps in: two steps of 24 fps oversize and off register in its
// drum, then it prints in place. The kick jumps the sheet in the feed (the colour drums part from the key) and
// knocks a random set of printed kana out of a black block for 3 steps. The snare slips the pink drum and pops
// registration marks on the grid. The hats flood the ink.
import type { Frame } from '@pve/engine/scene';
import type { AudioData } from '@pve/engine/audio';
import { H, SCALE, scaleContext2D, W } from '@pve/engine/gl';
import { lineNo, units, type Line, type WrittenUnit } from '@pve/engine/lyrics';
import { drawV } from '@pve/engine/type';
import { hash, lastTime, stepT } from '@pve/engine/util';
import { changesOf, copyTimes, fnt, genAt, PageScene, rebate, SANS, seal, statusLine, type SurfaceOpts } from './_page';
import { RISO } from './_era_riso';
import { Drums, ink, type Drum } from './riso-drums';

/** s: a stamp (2 steps), a kick block (3 steps), a snare mark (4 steps). */
const STAMP = 2 / 24;
const BLOCK = 3 / 24;
const MARK = 4 / 24;
/** Mixed frame rates: each drum moves at its own rate, like animation on threes. The page (stamps, blocks, marks)
 * steps at 24; the sheet in the feed at 10, the pink drum at 15, the ink flood at 6 (all divide 30, so the held
 * frames come at an even beat). */
const RATE = { feed: 10, pink: 15, ink: 6 };

/**
 * The free parameters of the riso surface pass at t (see _era_riso.ts): the copies made, the sheet in the feed on
 * the kick, the pink drum on the snare, the ink flood on the hats. `e`: the strength (0.5 at the start of the
 * plate, 1 from ぽいじゃん). The plate and the transition into it (drums.ts) use this one function.
 */
export function drumReact(au: AudioData, t: number, e: number, copies: number): [number, number, number, number] {
  const kick = au.sample(stepT(t, RATE.feed)).kick;
  const snare = au.sample(stepT(t, RATE.pink)).snare;
  const hat = au.sample(stepT(t, RATE.ink)).hat;
  return [copies, -22 * e * kick, 16 * e * snare, 0.7 * e * hat];
}

/** Full coverage on the black drum. */
const SOLID = '#ffffff';
/** A blue tint, screened into dots by the shader. */
const TINT = 0.24;

/** The grid: left edge, slot width, row top, row pitch, glyph size. */
const X0 = 48;
const SLOT = 196;
const TOP = 44;
const PITCH = 162;
const EM = 124;
/** The slab of line 36. */
const SLAB = { x: 1652, y: TOP, w: W - 40 - 1652, h: PITCH * 6 };
const SMALL = /[ぁぃぅぇぉっゃゅょゎ]/;

interface Cell {
  u: WrittenUnit;
  text: string;
  quoted: boolean;
  x: number;
  cy: number;
}
interface Row {
  line: Line;
  cells: Cell[];
  top: number;
}

/** Advances of the glyphs of `text` at the current font: a small kana tucks in under the glyph before it. */
function advances(c: CanvasRenderingContext2D, text: string, em: number): number[] {
  const chs = [...text];
  return chs.map((ch, i) => c.measureText(ch).width - (SMALL.test(chs[i + 1] ?? '') ? em * 0.3 : 0));
}

/** One unit as a run of glyphs, centred on (cx, cy), squeezed to maxW. */
function run(c: CanvasRenderingContext2D, text: string, cx: number, cy: number, em: number, maxW: number) {
  c.font = fnt(SANS, em, 900);
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  const adv = advances(c, text, em);
  const w = adv.reduce((a, b) => a + b, 0);
  const sx = Math.min(1, maxW / w);
  c.save();
  c.translate(cx - (w * sx) / 2, cy + em * 0.05);
  c.scale(sx, 1);
  let x = 0;
  [...text].forEach((ch, i) => {
    c.fillText(ch, x, 0);
    x += adv[i]!;
  });
  c.restore();
}

export default class Riso extends PageScene {
  private drums!: Drums;
  private rows: Row[] = [];
  private poi!: { line: Line; cells: (Cell & { em: number })[] };
  private kami!: { line: Line; us: WrittenUnit[] };
  private copies: number[] = [];
  private gen0 = 0;
  private kicks: number[] = [];
  private snares: number[] = [];
  /** Every printed kana with its drum, for the stamps and the kick blocks. */
  private all: { cell: Cell; em: number; drum: Drum; maxW: number }[] = [];
  /** A black-drum block with a kana knocked out, per kana (built on first use). */
  private blocks = new Map<string, HTMLCanvasElement>();

  override async init() {
    await super.init();
    this.warm([RISO]);
    const L = this.ctx.lyrics;
    this.copies = copyTimes(L);
    this.gen0 = genAt(this.copies, L, units(lineNo(L, 29))[0]!.start) - 1;
    this.drums = new Drums();

    [29, 30, 31, 33, 34, 35].forEach((n, k) => {
      const line = lineNo(L, n);
      const top = TOP + k * PITCH;
      const cells = units(line).map((u, j): Cell => ({
        u,
        text: u.glyph.replace(/"/g, ''),
        quoted: u.glyph.includes('"'),
        x: X0 + j * SLOT + SLOT / 2,
        cy: top + EM / 2 + 8,
      }));
      this.rows.push({ line, cells, top });
    });

    // ぽいじゃん: two rows of four units, sized to fill the grid width
    const l32 = lineNo(L, 32);
    const us = units(l32);
    const c = this.layer.ctx;
    c.font = fnt(SANS, 100, 900);
    const wOf = (u: WrittenUnit) => advances(c, u.glyph, 100).reduce((a, b) => a + b, 0) / 100;
    const gap = 0.06;
    const rowEm = Math.max(...[0, 4].map((s) => us.slice(s, s + 4).reduce((a, u) => a + wOf(u) + gap, -gap)));
    const em = Math.min(380, (SLOT * 8 - 16) / rowEm);
    const cells: (Cell & { em: number })[] = [];
    [0, 4].forEach((s, r) => {
      let x = X0 + 8;
      const cy = TOP + PITCH * (r === 0 ? 1.5 : 4.5);
      for (const u of us.slice(s, s + 4)) {
        const w = wOf(u) * em;
        cells.push({ u, text: u.glyph, quoted: false, x: x + w / 2, cy, em });
        x += w + gap * em;
      }
    });
    this.poi = { line: l32, cells };

    const l36 = lineNo(L, 36);
    this.kami = { line: l36, us: units(l36) };
    this.changes = changesOf(L, [29, 30, 31, 32, 33, 34, 35, 36], this.copies);
    for (const r of this.rows) for (const cell of r.cells) if (!cell.quoted) this.all.push({ cell, em: EM, drum: 'blue', maxW: SLOT - 14 });
    for (const cell of this.poi.cells) this.all.push({ cell, em: cell.em, drum: 'pink', maxW: 1e4 });
    // the page also changes when a stamp settles
    this.changes = [...this.changes, ...this.all.map((a) => a.cell.u.start + STAMP)].sort((a, b) => a - b);
    const a = this.ctx.audio;
    this.kicks = a.events('kick', this.ctx.start, this.ctx.end).map(([t]) => t);
    this.snares = a.events('snare', this.ctx.start, this.ctx.end).map(([t]) => t);
  }

  /** The running time, the stamps in flight, the kick blocks and the snare marks. */
  protected override live(c: CanvasRenderingContext2D, f: Frame) {
    const t = f.t;
    c.save();
    // stamps: oversize and off register in their drum, added like the drum adds
    c.globalCompositeOperation = 'lighter';
    for (const { cell, em, drum, maxW } of this.all) {
      const dt = t - cell.u.start;
      if (dt < 0 || dt >= STAMP) continue;
      const s = dt < STAMP / 2 ? 1.45 : 1.15;
      const k = hash(cell.x, cell.cy);
      c.fillStyle = ink(drum);
      run(c, cell.text, cell.x + (k - 0.5) * 30 * s, cell.cy - 14 * s, em * s, maxW * s);
    }
    c.globalCompositeOperation = 'destination-out';
    c.globalAlpha = 0.25;
    // kick: a random set of printed kana knocked out of black blocks
    const kick = lastTime(this.kicks, t);
    if (kick !== null && t - kick < BLOCK) {
      const printed = this.all.filter((a) => a.cell.u.start + STAMP <= kick && a.drum === 'blue');
      const n = Math.min(printed.length, 2 + Math.round(4 * this.energy(t)));
      for (let i = 0; i < n; i++) {
        const a = printed[Math.floor(hash(kick, i, 5) * printed.length)]!;
        const b = this.block(a.cell.text);
        const sz = SLOT - 6;
        c.drawImage(b, a.cell.x - sz / 2, a.cell.cy - sz / 2 + 2, sz, sz);
      }
    }
    // snare: registration marks pop on grid crossings
    const sn = lastTime(this.snares, t);
    if (sn !== null && t - sn < MARK) {
      c.strokeStyle = '#ffffff';
      c.lineWidth = 3;
      const grow = 1 - (t - sn) / MARK;
      for (let i = 0; i < 6; i++) {
        const x = X0 - 8 + Math.floor(hash(sn, i, 1) * 9) * SLOT;
        const y = TOP + Math.floor(hash(sn, i, 2) * 7) * PITCH - 14;
        const r = 16 + 22 * grow;
        c.beginPath();
        c.arc(x, y, r * 0.55, 0, Math.PI * 2);
        c.moveTo(x - r, y);
        c.lineTo(x + r, y);
        c.moveTo(x, y - r);
        c.lineTo(x, y + r);
        c.stroke();
      }
    }
    statusLine(c, genAt(this.copies, this.ctx.lyrics, f.t), f.t, '', '', SOLID);
    c.restore();
  }

  /** 0 at the first line of the plate, 1 from ぽいじゃん (line 32) on. */
  private energy(t: number): number {
    const a = this.rows[0]!.line.start, b = this.poi.line.start;
    return Math.min(1, Math.max(0, (t - a) / (b - a)));
  }


  /** A solid square with the kana knocked out (white = black-drum coverage). */
  private block(text: string): HTMLCanvasElement {
    let b = this.blocks.get(text);
    if (!b) {
      const sz = SLOT - 6;
      b = document.createElement('canvas');
      b.width = b.height = Math.round(sz * SCALE);
      const c = scaleContext2D(b.getContext('2d', { willReadFrequently: true })!, SCALE);
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, sz, sz);
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = '#000000';
      run(c, text, sz / 2, sz / 2, EM, sz - 14);
      this.blocks.set(text, b);
    }
    return b;
  }

  /** The sheet in the feed on the kick, the pink drum on the snare, the ink on the hats; each at its own rate. */
  protected override react(f: Frame, o: SurfaceOpts): [number, number, number, number] {
    return drumReact(this.ctx.audio, f.t, 0.5 + 0.5 * this.energy(f.t), o.p?.[0] ?? 0);
  }

  draw(c: CanvasRenderingContext2D, f: Frame): SurfaceOpts {
    const t = f.t;
    const gen = genAt(this.copies, this.ctx.lyrics, t);
    const passes = Math.max(0, gen - this.gen0);
    const d = this.drums;
    const K = d.black;
    const gx = X0 - 8;
    const gw = SLOT * 8 + 16;
    d.begin(c);

    // yellow: the spine at the right
    c.fillStyle = ink('yellow');
    c.fillRect(SLAB.x, SLAB.y, SLAB.w, SLAB.h);

    // the とぅとぅる grid, a row per line from its first syllable: a yellow stripe or a blue tint under blue kana,
    // a black rule and the black gloss below; "風" is cut through to the red after printing
    this.rows.forEach((r, k) => {
      if (t < r.line.start) return;
      c.fillStyle = k % 2 === 0 ? ink('yellow') : ink('blue', TINT);
      c.fillRect(gx, r.top, gw, PITCH - 28);
      K.fillStyle = SOLID;
      K.fillRect(gx, r.top + PITCH - 4, gw, 3);
      for (const cell of r.cells) {
        if (t < cell.u.start + (cell.quoted ? 0 : STAMP)) continue;
        if (cell.quoted) {
          K.font = fnt(SANS, 56, 900);
          K.textBaseline = 'middle';
          K.textAlign = 'center';
          K.fillText('“', cell.x - EM * 0.62, cell.cy - EM * 0.32);
          K.fillText('”', cell.x + EM * 0.62, cell.cy + EM * 0.42);
        } else {
          c.fillStyle = ink('blue');
          run(c, cell.text, cell.x, cell.cy, EM, SLOT - 14);
        }
      }
      this.gloss(K, r.line, t, X0 + 2, r.top + PITCH - 16);
    });

    // ぽいじゃん: the pink drum across the grid, its gloss at the end of each row; the shader knocks the pink
    // out of the yellow
    const p = this.poi;
    c.fillStyle = ink('pink');
    for (const cell of p.cells) if (t >= cell.u.start + STAMP) run(c, cell.text, cell.x, cell.cy, cell.em, 1e4);
    c.font = fnt(SANS, 30, 900);
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    p.line.written!.phrases.forEach((ph, k) => {
      if (t < ph.start) return;
      const last = p.cells[k * 4 + 3]!;
      c.fillText(ph.text, X0 + SLOT * 7 - 30, last.cy + last.em * 0.56);
    });
    const reg = 1.5 + 2 * passes;

    // line 36: the black slab over the spine on 神, っぽいな and its gloss knocked out to the yellow
    const k = this.kami;
    const on36 = t >= k.us[0]!.start;
    if (on36) {
      K.fillStyle = SOLID;
      K.fillRect(SLAB.x, SLAB.y, SLAB.w, SLAB.h);
      K.save();
      K.globalCompositeOperation = 'destination-out';
      drawV(K, 'っぽいな', SLAB.x + SLAB.w / 2 + 14, 340, 128, SANS, 900, (i) => t >= k.us[i + 1]!.start);
      const gloss = k.line.written!.phrases.filter((ph) => ph.start <= t).map((ph) => ph.text).join(' ');
      if (gloss) {
        K.translate(SLAB.x + 24, 340);
        K.rotate(Math.PI / 2);
        K.font = fnt(SANS, 24, 900);
        K.textAlign = 'left';
        K.textBaseline = 'middle';
        K.fillText(gloss, 0, 0);
      }
      K.restore();
    }

    // the true marks, in the bottom margin outside the print area (the running time: see `live`)
    statusLine(K, gen, t, '', '', SOLID);
    d.end(c);

    // holes onto the red: each "風", and the new seal of line 36
    c.save();
    c.globalCompositeOperation = 'destination-out';
    for (const r of this.rows) {
      for (const cell of r.cells) if (cell.quoted && t >= cell.u.start) run(c, cell.text, cell.x, cell.cy, EM, SLOT - 14);
    }
    c.restore();
    if (on36) seal(c, SLAB.x + SLAB.w / 2, 200, 104, 'hole', SANS);

    return { era: RISO, gen, reg, p: [passes, 0, 0, 0] };
  }

  /** The EN gloss of a line, small, phrase by phrase as they are sung. */
  private gloss(c: CanvasRenderingContext2D, line: Line, t: number, x: number, y: number) {
    const text = line.written!.phrases.filter((ph) => ph.start <= t).map((ph) => ph.text).join(' ');
    if (!text) return;
    c.fillStyle = SOLID;
    c.font = fnt(SANS, 22, 900);
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(text, x, y);
  }
}
