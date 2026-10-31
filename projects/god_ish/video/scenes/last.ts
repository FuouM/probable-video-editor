// Plate 9 · Stamps, last (text-ish, post-chorus 2). The hook a third time, as hard stamps: every sung unit of
// lines 62-69 is one stamp, and every stamp is a copy (GEN counts each one). A fresh stamp lands with its glyph cut
// through onto the red; the next copy closes that hole, and each later copy adds an offset impression, lifts the
// ink and, after a few copies, turns the kana into almost-kana (two real kana joined wrong, last-stamps.ts).
//   とぅ / る       paper cards with an ink border, the gloss of their phrase under the glyph
//   ぽいじゃん (65)  solid ink blocks, the glyph knocked out
//   "風"           a red hanko, the glyph knocked out (red is the meaning: the -ish)
// Stamps land on a low-discrepancy scatter across a larger sheet while the view slowly zooms out as more stamps
// appear and fill the screen; each generation is a JPEG re-save that steps the quality down. Sparse pseudo-kanji
// sit in the outer margins only. The page opens clean: epigone's seal does not carry over (it goes with the page,
// see peel.ts). Line 69 (神っぽいな): 神 cuts the last seal through the pile, and each later syllable cuts it
// larger until it takes the whole frame; っぽいな stamps land in the corners. Plate 10 opens on the empty page.
// The kick throws a barrage of almost-kana onto the pile for 3 steps; the hats pop margin glyphs in full ink.
import type { Frame } from '@pve/engine/scene';
import { H, makeCanvas, SCALE, scaleContext2D, W } from '@pve/engine/gl';
import { lineNo, units, type Line, type WrittenUnit } from '@pve/engine/lyrics';
import { hash, lastTime, r2 } from '@pve/engine/util';
import {
  changesOf, copyTimes, fnt, genAt, genReset, INK, PageScene, PAPER, rebate, RED, SANS, seal, SERIF, statusLine, tone,
  type SurfaceOpts,
} from './_page';
import { TEXTISH } from './_era_textish';
import { atlas, drawChimera } from './epigone-ish';
import { almost } from './last-stamps';

type Kind = 'card' | 'solid' | 'hanko';
interface Stamp {
  u: WrittenUnit;
  line: Line;
  kind: Kind;
  /** The glyph without its quotes. */
  text: string;
  /** The gloss of the phrase that starts on this unit ('' if none). */
  en: string;
  x: number;
  y: number;
  size: number;
  rot: number;
  /** Copies after its own before the kana turns almost-kana. */
  drift: number;
}

const FIRST = 62;
const LAST = 69;
/** The last seal: centre, and its radius on each syllable of line 69. */
const SEAL_C: [number, number] = [W / 2, H / 2 - 20];
const SEAL_R = [190, 285, 380, 470, 560];
const CORNERS: [number, number][] = [[230, 190], [W - 230, 190], [230, H - 230], [W - 230, H - 230]];
const ATLAS_N = 60;
const ATLAS_CELL = 96;
const ATLAS_COLS = 10;
const ATLAS_SEED = 9;
/** Pad of a glyph sprite around the stamp box, logical px; a hanko's gloss hangs HANG px below its box. */
const PAD = 4;
const HANG = 44;
/** Copies after which a stamp no longer changes: its ink tone, impressions and almost-kana are final. */
const SETTLED = 11;
/** s: a stamp in the air before it lands, a kick barrage, a hat pop. */
const LAND = 2 / 24;
const BARRAGE = 3 / 24;
const POP = 2 / 24;
/** The view starts zoomed in and slowly pulls out across the plate as more stamps land and fill the widening screen. */
const ZOOM0 = 1.75;
/** JPEG quality of the k-th copy of the plate: steps down linearly from 76 to 4 across all 55 copies, with compounding passes. */
const QMAX = 76, QMIN = 4, KMAX = 55;
const quality = (k: number) => Math.max(QMIN, Math.round(QMAX - ((QMAX - QMIN) * Math.min(k, KMAX)) / KMAX));
const passes = (k: number) => (k >= 34 ? 2 : 1);
/** The glyph layer of one stamp state, at the output scale; drawn centred on the stamp. */
interface Sprite {
  cv: HTMLCanvasElement;
  w: number;
  h: number;
}

export default class Last extends PageScene {
  private copies: number[] = [];
  private stamps: Stamp[] = [];
  /** Onsets of every unit of the plate, in order: each is a copy. */
  private onsets: number[] = [];
  /** Of those, the ones that copy on top of the line starts (copyTimes has those). */
  private extra: number[] = [];
  private kami: WrittenUnit[] = [];
  private l69: Line | null = null;
  private ish: HTMLCanvasElement | null = null;
  private cells: { x: number; y: number; size: number; r: number }[] = [];
  /**
   * Glyph layers by stamp and face (`i:almost`). Large rotated glyphs miss the glyph cache and fill as paths,
   * which made this plate cost about 60 ms a frame; a sprite is filled once and then only drawn.
   */
  private sprites = new Map<string, Sprite>();
  /** The settled stamps of the pile, drawn once each (see `settled`). */
  private cache: { cv: HTMLCanvasElement; c: CanvasRenderingContext2D; m: number } | null = null;
  private kicks: number[] = [];
  private hats: number[] = [];
  private mCv: HTMLCanvasElement | null = null;
  private mCtx: CanvasRenderingContext2D | null = null;
  private mLastKey = '';

  override async init() {
    await super.init();
    this.warm([TEXTISH], true);
    const lyr = this.ctx.lyrics;
    this.copies = copyTimes(lyr);
    this.ish = atlas(ATLAS_SEED, ATLAS_N, ATLAS_CELL, ATLAS_COLS);

    const scatter: Omit<Stamp, 'x' | 'y' | 'size' | 'rot' | 'drift'>[] = [];
    for (let i = FIRST; i <= LAST; i++) {
      const line = lineNo(lyr, i);
      const us = units(line);
      us.forEach((u, k) => {
        this.onsets.push(u.start);
        if (k > 0) this.extra.push(u.start);
        if (i === LAST) return;
        const text = u.glyph.replace(/["“”〝〟]/g, '');
        const en = line.written!.phrases.filter((p) => p.from >= u.from && p.from < u.to).map((p) => p.text.replace(/,$/, '')).join(' ');
        scatter.push({ u, line, kind: text === '風' ? 'hanko' : i === 65 ? 'solid' : 'card', text, en });
      });
    }
    // low-discrepancy scatter (R2): each stamp sits within the visible frame at the zoom when it lands, and later
    // stamps bias toward the outer ring newly exposed as the view zooms out so the growing pile fills the whole screen
    const n = scatter.length;
    scatter.forEach((s, i) => {
      const p = i / Math.max(1, n - 1);
      const z = ZOOM0 / Math.pow(ZOOM0, p);
      const [fx, fy] = r2(i);
      let dx = 2 * fx - 1, dy = 2 * fy - 1;
      const r = Math.max(Math.abs(dx), Math.abs(dy));
      if (r > 0) {
        const rp = Math.pow(r, 1 - 0.52 * p);
        dx *= rp / r;
        dy *= rp / r;
      }
      const base = (s.kind === 'solid' ? 245 : s.kind === 'hanko' ? 170 : 200) * (1 - 0.1 * p);
      const size = base / z;
      const spanX = (W - 210) / z, spanY = (H - 210) / z;
      this.stamps.push({
        ...s, size,
        x: W / 2 + 0.5 * dx * spanX + (hash(i, 1) - 0.5) * (36 / z),
        y: H / 2 + 0.5 * dy * spanY + (hash(i, 2) - 0.5) * (36 / z),
        rot: (hash(i, 3) - 0.5) * 0.2,
        drift: 2 + Math.floor(hash(i, 4) * 3),
      });
    });
    // line 69: 神 is the seal; っぽいな land in the corners
    this.l69 = lineNo(lyr, LAST);
    const u69 = units(this.l69);
    this.kami = u69;
    u69.slice(1).forEach((u, k) => {
      const [x, y] = CORNERS[k % 4]!;
      this.stamps.push({ u, line: this.l69!, kind: 'card', text: u.glyph, en: '', x, y, size: 190, rot: (hash(k, 5) - 0.5) * 0.16, drift: 99 });
    });

    // the margins: one band of cells around the frame
    const P = 50;
    const add = (x: number, y: number) => {
      const i = this.cells.length;
      this.cells.push({ x, y, size: 36 + (hash(i, 6) - 0.5) * 8, r: hash(i, 7) });
    };
    for (let y = 60; y <= H - 80; y += P) { add(40, y); add(W - 40, y); }
    for (let x = 40 + P; x <= W - 40 - P; x += P) add(x, 40);
    this.changes = changesOf(lyr, [62, 63, 64, 65, 66, 67, 68, 69], [...this.copies, genReset(lyr)]);
    this.changes = [...this.changes, ...this.stamps.map((s) => s.u.start + LAND)].sort((a, b) => a - b);
    const a = this.ctx.audio;
    this.kicks = a.events('kick', this.ctx.start, this.ctx.end).map(([t]) => t);
    this.hats = a.events('hat', this.ctx.start, this.ctx.end).filter(([, s]) => s >= 0.3).map(([t]) => t);
    for (const s of this.stamps) {
      this.sprite(s, false);
      if (s.kind !== 'hanko') this.sprite(s, true);
    }
  }

  /** 0 at the plate's start, 1 at its end. */
  private energy(t: number): number {
    return Math.min(1, Math.max(0, (t - this.ctx.start) / (this.ctx.end - this.ctx.start)));
  }

  /** Zoom of the pile at time t: steps out from ZOOM0 to 1 on each stamp onset so the settled page caches cleanly. */
  private zoom(t: number): number {
    const total = this.stamps.length - (this.kami.length - 1);
    let m = 0;
    for (let i = 0; i < total; i++) if (this.stamps[i]!.u.start <= t) m++;
    const p = m <= 1 ? 0 : Math.min(1, (m - 1) / Math.max(1, total - 1));
    return ZOOM0 / Math.pow(ZOOM0, p);
  }

  /** The stamps in the air, the kick barrage, the hat pops, then the line and the running time on their slip. */
  protected override live(c: CanvasRenderingContext2D, f: Frame) {
    const t = f.t;
    const zm = this.zoom(t);
    // a stamp coming down: oversize and lifted, then a little over size
    for (const s of this.stamps) {
      const dt = t - s.u.start;
      if (dt < 0 || dt >= LAND) continue;
      const k = dt < LAND / 2 ? 1.55 : 1.12;
      const z = s.line.i === LAST ? 1 : zm;
      c.save();
      c.translate(W / 2, H / 2);
      c.scale(z, z);
      c.translate(-W / 2, -H / 2);
      c.translate(s.x + (18 / z) * (k - 1), s.y - (60 / z) * (k - 1));
      c.scale(k, k);
      c.translate(-s.x, -s.y);
      // in the air the face is printed, not yet cut: the cached sprite (vectors this large cost ~10 ms a draw)
      this.stamp(c, s, 1);
      c.restore();
    }
    const ish = this.ish!;
    const e = this.energy(t);
    // kick: almost-kana thrown onto the pile
    const kick = lastTime(this.kicks, t);
    if (kick !== null && t - kick < BARRAGE) {
      const n = 3 + Math.round(5 * e);
      for (let i = 0; i < n; i++) {
        const g = Math.floor(hash(kick, i, 21) * ATLAS_N);
        const z = 70 + 90 * hash(kick, i, 22) + (t - kick < 1 / 24 ? 30 : 0);
        const x = 150 + hash(kick, i, 23) * (W - 300), y = 120 + hash(kick, i, 24) * (H - 300);
        c.save();
        c.translate(x, y);
        c.rotate((hash(kick, i, 25) - 0.5) * 0.6);
        c.fillStyle = PAPER;
        c.fillRect(-z * 0.55, -z * 0.55, z * 1.1, z * 1.1);
        c.drawImage(ish, (g % ATLAS_COLS) * ATLAS_CELL, Math.floor(g / ATLAS_COLS) * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL, -z / 2, -z / 2, z, z);
        c.restore();
      }
    }
    // hat: margin glyphs pop in full ink, oversize
    const hat = lastTime(this.hats, t);
    if (hat !== null && t - hat < POP) {
      for (let i = 0; i < 2 + Math.round(4 * e); i++) {
        const cell = this.cells[Math.floor(hash(hat, i, 31) * this.cells.length)]!;
        const g = Math.floor(hash(hat, i, 32) * ATLAS_N);
        const z = cell.size * 1.8;
        c.fillStyle = PAPER;
        c.fillRect(cell.x - z / 2, cell.y - z / 2, z, z);
        c.drawImage(ish, (g % ATLAS_COLS) * ATLAS_CELL, Math.floor(g / ATLAS_COLS) * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL, cell.x - z / 2, cell.y - z / 2, z, z);
      }
    }
    const gen = this.gen(f.t);
    const k = this.stamps.filter((s) => s.u.start <= f.t).length + (this.kami[0]!.start <= f.t ? 1 : 0);
    const li = this.ctx.lyrics.lines.findLast((l) => l.start <= f.t + 1e-3)?.i;
    statusLine(c, gen, f.t, `JPEG q${quality(k)}`, li !== undefined ? `line ${li}` : '', INK, true);
  }

  /**
   * Copies at or before t: the song's (line starts, voice) and one more on every other unit of this plate. The kit
   * turns GEN to 00 just before the outro: the last seal is then the new original.
   */
  private gen(t: number): number {
    const g = genAt(this.copies, this.ctx.lyrics, t);
    return g === 0 ? 0 : g + this.extra.filter((s) => s <= t).length;
  }

  draw(c: CanvasRenderingContext2D, f: Frame): SurfaceOpts {
    const t = f.t;
    const gen = this.gen(t);
    // the copies of this plate: every unit landed (stamps and the seal), counted on past the GEN reset
    const k = this.stamps.filter((s) => s.u.start <= t).length + (this.kami[0]!.start <= t ? 1 : 0);
    c.fillStyle = PAPER;
    c.fillRect(0, 0, W, H);
    this.margins(c, gen, k);

    // a stamp's copies: every unit sung after it (the stamps after it and the cuts of the seal)
    const at = this.stamps.filter((s) => s.u.start <= t);
    const n = (s: Stamp) => this.onsets.filter((o) => o > s.u.start && o <= t).length;
    // the settled stamps (the oldest: the bottom of the pile) come from the cache, the rest are drawn, zoomed
    const pile = at.filter((s) => s.line.i !== LAST);
    let m = 0;
    while (m < pile.length && n(pile[m]!) >= SETTLED) m++;
    const zm = this.zoom(t);
    c.save();
    c.translate(W / 2, H / 2);
    c.scale(zm, zm);
    c.translate(-W / 2, -H / 2);
    c.drawImage(this.settled(m), 0, 0, W, H);
    for (const s of pile.slice(m)) if (t >= s.u.start + LAND) this.stamp(c, s, n(s));
    c.restore();
    // line 69: the last seal, cut larger on every syllable
    const ks = this.kami.filter((u) => u.start <= t).length;
    if (ks > 0) {
      const r = SEAL_R[Math.min(ks, SEAL_R.length) - 1]!;
      seal(c, SEAL_C[0], SEAL_C[1], r, 'hole');
      const en = this.l69!.written!.phrases.filter((p) => p.start <= t).map((p) => p.text).join(' ');
      if (en) {
        c.fillStyle = INK;
        c.font = fnt(SANS, 30, 600);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const w = c.measureText(en).width + 36;
        const y = Math.min(SEAL_C[1] + r + 6, H - 110);
        c.fillRect(SEAL_C[0] - w / 2, y, w, 46);
        c.fillStyle = PAPER;
        c.fillText(en, SEAL_C[0], y + 23);
      }
    }
    for (const s of at) if (s.line.i === LAST && t >= s.u.start + LAND) this.stamp(c, s, n(s));

    const q = quality(k);
    const li = this.ctx.lyrics.lines.findLast((l) => l.start <= t + 1e-3)?.i;
    statusLine(c, gen, t, `JPEG q${q}`, li !== undefined ? `line ${li}` : '', INK, true);
    const melt = Math.min(3.2, 2 + 0.022 * k);
    const warp = Math.min(7.5, 4 + 0.065 * k);
    return { era: TEXTISH, gen, p: [melt, warp, 0.8, 46], jpeg: { quality: q, passes: passes(k), shift: [3, 5] } };
  }

  /**
   * The first m stamps of the pile in their final state, on a transparent canvas. Playback adds the stamps that
   * settle one by one; a seek back draws the cache again.
   */
  private settled(m: number): HTMLCanvasElement {
    if (!this.cache) {
      const { cv, c } = makeCanvas();
      this.cache = { cv, c, m: 0 };
    }
    const k = this.cache;
    if (m < k.m) {
      k.c.clearRect(0, 0, W, H);
      k.m = 0;
    }
    for (; k.m < m; k.m++) this.stamp(k.c, this.stamps[k.m]!, SETTLED);
    return k.cv;
  }

  /** Sparse pseudo-kanji in the margin band, a few more with each copy; each cell changes glyph every other copy. */
  private margins(c: CanvasRenderingContext2D, gen: number, k: number) {
    const ish = this.ish!;
    const d = Math.min(0.45, 0.12 + 0.006 * k);
    const key = `${gen}:${k}`;
    if (!this.mCv) {
      const { cv, c: mc } = makeCanvas();
      this.mCv = cv;
      this.mCtx = mc;
    }
    if (key !== this.mLastKey) {
      this.mLastKey = key;
      const mc = this.mCtx!;
      mc.clearRect(0, 0, W, H);
      mc.save();
      this.cells.forEach((cell, i) => {
        if (cell.r >= d) return;
        const g = Math.floor(hash(i, Math.floor(gen / 2), 13) * ATLAS_N);
        mc.globalAlpha = 0.3 + hash(i, 8) * 0.4;
        mc.drawImage(
          ish, (g % ATLAS_COLS) * ATLAS_CELL, Math.floor(g / ATLAS_COLS) * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL,
          cell.x - cell.size / 2, cell.y - cell.size / 2, cell.size, cell.size,
        );
      });
      mc.restore();
    }
    c.drawImage(this.mCv, 0, 0, W, H);
  }

  /** Box of a stamp: width, height (with its gloss band), gloss band, border width. */
  private box(s: Stamp) {
    const z = s.size;
    const gl = s.en && s.kind !== 'hanko' ? z * 0.24 : 0;
    return { w: [...s.text].length * z + z * 0.36, h: z * 1.2 + gl, gl, lw: Math.max(4, z * 0.05) };
  }

  /**
   * The glyphs and gloss of a stamp, centred at (0, 0) of `c`: ink on a card, paper on a solid or a hanko (whose
   * gloss hangs below in ink). `almost`: the kana as almost-kana. The glyphs take the current composite (a fresh
   * stamp cuts them out), the gloss always prints over.
   */
  private glyphs(c: CanvasRenderingContext2D, s: Stamp, almostKana: boolean, fill: string) {
    const chars = [...s.text];
    const z = s.size;
    const { h, gl } = this.box(s);
    const gy = -gl / 2;
    const fam = s.kind === 'solid' ? SANS : SERIF;
    const weight = s.kind === 'solid' ? 900 : 700;
    c.fillStyle = fill;
    chars.forEach((ch, i) => {
      const x = -(chars.length - 1) * z / 2 + i * z;
      if (almostKana) drawChimera(c, almost(ch, fam, s.u.from * 7 + s.line.i + i), x, gy, z * 0.92, weight);
      else {
        c.font = fnt(fam, z * 0.92, weight);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(ch, x, gy);
      }
    });
    c.globalCompositeOperation = 'source-over';
    if (gl) {
      c.font = fnt(SANS, Math.max(20, gl * 0.62), 500);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(s.en, 0, h / 2 - gl * 0.7);
    } else if (s.kind === 'hanko' && s.en) {
      c.fillStyle = INK;
      c.font = fnt(SANS, 24, 500);
      c.textAlign = 'center';
      c.textBaseline = 'top';
      c.fillText(s.en, 0, h / 2 + 8);
    }
  }

  private sprite(s: Stamp, almostKana: boolean): Sprite {
    const i = this.stamps.indexOf(s);
    const key = `${i}:${almostKana}`;
    let sp = this.sprites.get(key);
    if (sp) return sp;
    const b = this.box(s);
    // tight around the box (drawImage under rotation costs by area); a hanko's gloss hangs below it
    const hangs = s.kind === 'hanko' && s.en;
    const m = this.layer.ctx;
    m.save();
    m.font = fnt(SANS, 24, 500);
    const enW = hangs ? m.measureText(s.en).width : 0;
    m.restore();
    const w = Math.ceil(Math.max(b.w, enW) + 2 * PAD), h = Math.ceil(b.h + 2 * (hangs ? HANG : PAD));
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(w * SCALE);
    cv.height = Math.ceil(h * SCALE);
    const c = scaleContext2D(cv.getContext('2d', { willReadFrequently: true })!, SCALE);
    c.translate(w / 2, h / 2);
    this.glyphs(c, s, almostKana, s.kind === 'card' ? INK : PAPER);
    sp = { cv, w, h };
    this.sprites.set(key, sp);
    return sp;
  }

  /** One stamp `n` copies after it landed: n = 0 is fresh (glyph onto red). */
  private stamp(c: CanvasRenderingContext2D, s: Stamp, n: number) {
    const { w, h, lw } = this.box(s);
    // the ink lifts with each copy: tone v on paper (a card's ink layer is black at alpha 1 - v)
    const v = n === 0 ? 0 : Math.min(0.32, 0.03 * n);
    const ink = tone(v);
    c.save();
    c.translate(s.x, s.y);
    c.rotate(s.rot);
    // the impressions of earlier copies, offset and lighter
    for (let k = Math.min(n, 3); k >= 1; k--) {
      c.strokeStyle = tone(0.35 + 0.15 * k);
      c.lineWidth = lw * 0.7;
      c.strokeRect(-w / 2 + k * 7, -h / 2 + k * 5, w, h);
    }
    if (s.kind === 'card') {
      c.fillStyle = PAPER;
      c.fillRect(-w / 2, -h / 2, w, h);
      c.strokeStyle = ink;
      c.lineWidth = lw;
      c.strokeRect(-w / 2 + lw / 2, -h / 2 + lw / 2, w - lw, h - lw);
    } else {
      c.fillStyle = s.kind === 'hanko' ? RED : ink;
      c.fillRect(-w / 2, -h / 2, w, h);
    }
    if (n === 0 && s.kind !== 'hanko') {
      // fresh: the glyph cuts through onto the red (one stamp at a time: drawn as vectors)
      c.globalCompositeOperation = 'destination-out';
      this.glyphs(c, s, false, s.kind === 'card' ? INK : PAPER);
    } else {
      const sp = this.sprite(s, n >= s.drift && s.kind !== 'hanko');
      if (s.kind === 'card') c.globalAlpha = 1 - v;
      c.drawImage(sp.cv, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
    }
    c.restore();
  }
}
