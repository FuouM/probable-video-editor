// broken (Final chorus), the apex: the fabric of reality tears and the world is shown as what it is made of.
// The screen cnn shattered falls away under gravity as dark glass and behind it there are no bricks any
// more, only character cells (12x18, the whole frame, no bars): the blue substrate shows in the gaps. Every
// line is written on the grid in place (like the words on the wall of Verse 1: wrapped, each syllable
// forming on its onset, never sliding), in blue over the binary so it reads.
// "(i) i": the tesseract from cnn turns into "(i)" (a hole onto the blue spelled in its own letters) and "i"
// (bricks breaking into code). Behind, Cantor's diagonal: an endless list of binary rows scrolling up, every
// row's own digit on the diagonal flipped in blue. "without a destination": the vortex of Chorus 1 over the
// code. "i can't see the": the chorus as a dim wall of text, a flashlight brightening it, and the sung words
// stamped large in blue where it shines; the hotel rises out of the wall at the end. "walls surrounding":
// Hilbert's hotel, every room full; on each snap the walls slam in and every guest moves one door up, and
// "(i)" checks into room 1; "me" blows the walls out. "without a doubt": the diagonal again, faster, the
// line in blue; "never gone" floods it blue in blocks. "what i have done": a Life board of the syllables,
// two generations a beat, on the left; on the right, a wall calendar tearing off a day a beat (an eighth
// from "days"), the day number counting up, each torn page curling and twisting in 3D as it flies off. "the
// destination's still a far": a wall of twelve distinct scenes, one per tile (never repeating), thinning
// out on "never" until one blue module is left; "i'll never see you again": it drifts away.
// Rates: grid 15 fps, line 24, Life two generations a beat.
import type { Frame } from '@pve/engine/scene';
import { H, SCALE, W } from '@pve/engine/gl';
import { mark } from '@pve/engine/marks';
import { clamp, ease, prog } from '@pve/engine/util';
import { BEAT, BEAT0, BLUE, INK, Life, PAPER, PrintScene, brickRect, bricks, genAt, gray, hashI, rebate, stepT, sylAt, sylLine, wrapLine, type Placed, type PrintOpts, type Syl, type SylLine } from './_kit';
import { ACOLS, AH, AROWS, AW, Ascii, Grid, Tone, rampChar, textCells } from './_ascii';
import { vortex } from './_motifs';
import { PAGE, renderCalendar, renderCalendarParticles } from './_broken_calendar';
import { renderAsciiDoom } from './_broken_doom';
import { doomIntoIrc, montageIntoDoom } from './_broken_trans';
import { renderHotel } from './_broken_hotel';
const FORM = 0.22; // seconds a syllable takes to form on the grid
const WALL_MAX = 13; // cells the closed walls reach after the last step on "me"

interface GridLine { sl: SylLine; placed: Placed[]; x0: number; y0: number; s: number }

export default class Broken extends PrintScene {
  protected override plane = { guns: 0.2, osc: 0.2, rate: 15 };
  private ascii = new Ascii();
  private g = new Grid();
  private lines: SylLine[] = [];
  private laid: GridLine[] = [];
  private chorus = '';
  private life = new Life(ACOLS, AROWS);
  private gen = -1;
  private l2Seeds: { syl: Syl; cells: { q: number; r: number; ch: string }[] }[] = [];
  private tDest = 0;
  private tSee = 0;
  private snaps: number[] = [];
  private tMe = 0;
  private tDoubt = 0;
  private tNever = 0;
  private tNeverGone = 0;
  private tDays = 0;
  private tFar = 0;
  private tMorphEnd = 0;
  private tNever2 = 0;
  private tA = 0;
  private tDoom = BEAT0 + 142 * 4 * BEAT; // Bar 143.1 (170.696 s)
  private tDoomEnd = 0;
  private tVer = 0;
  private tIrc = BEAT0 + 143 * 4 * BEAT;  // Bar 144.1 ("see you again")
  private tSee2 = 0;
  private gDoom = new Grid();
  private gIrc = new Grid();
  private page = document.createElement('canvas');
  private pc!: CanvasRenderingContext2D;
  private activeLyricCells = new Uint8Array(ACOLS * AROWS);
  private drumHitTimes: number[] = [];
  override init() {
    const ly = this.ctx.lyrics;
    this.lines = ly.linesIn(this.ctx.start, this.ctx.end).map((l) => sylLine(ly, l));
    this.laid = this.lines.map((sl) => {
      for (const [s, step] of [[2, 12], [2, 11], [1, 13]] as const) {
        const lay = wrapLine(sl, Math.floor((ACOLS - 12) / s), step);
        const w = Math.max(...lay.widths) * s, h = (lay.rows * step - (step - 10)) * s;
        if (h <= AROWS - 6 || s === 1) return { sl, placed: lay.placed, x0: Math.floor((ACOLS - w) / 2), y0: Math.floor((AROWS - h) / 2), s };
      }
      throw new Error('unreachable');
    });
    const [l0, l1, l2, l3] = this.lines as [SylLine, SylLine, SylLine, SylLine];
    const word = (sl: SylLine, w: string) => sl.line.words.find((x) => x.w.replace(/’/g, "'") === w.replace(/’/g, "'"))!;
    this.chorus = this.lines.map((s) => s.line.text.toLowerCase().replace(/’/g, "'")).join(' / ').replace(/[^a-z' ()/]/g, ' ');
    this.tDest = l0.line.start;
    this.tSee = l1.line.start;
    const sur = word(l1, 'surrounding');
    this.snaps = [word(l1, 'walls').start, ...(sur.syl ?? [[sur.start, sEnd(sur)]]).map(([a]) => a)];
    this.tMe = word(l1, 'me').start;
    this.tDoubt = word(l1, 'without').start;
    this.tNever = word(l1, 'never').start;
    const its = l1.line.words.find((x) => x.w.toLowerCase().replace(/[^a-z']/g, '') === "it's");
    this.tNeverGone = its ? its.start : this.tNever;
    this.tFar = l2.line.words.at(-1)!.start; // on the step "on" (168.28 s, Bar 140 downbeat)
    this.tMorphEnd = word(l3, 'still').start; // 2 beats into Bar 141 (170.08 s, Bar 141.3)
    this.tNever2 = word(l3, 'never').start;
    this.tA = word(l3, 'a').start; // 170.380 s ("a")
    const farWord = word(l3, 'far');
    this.tDoom = farWord.start; // 170.680 s (onset of "far", Bar 142 downbeat)
    this.tDoomEnd = word(l3, "i'll").start; // 170.980 s (spans full 2 beats across "a" and "far")
    const verSyl = l3.syls.find((s) => s.text === 'ver')!;
    this.tVer = verSyl.start; // 171.580 s (onset of ne"VER")
    this.tIrc = word(l3, 'see').start + 0.20;  // 172.080 s
    this.tSee2 = word(l3, 'see').start; // 171.880 s ("see you again")
    const maxCol = ACOLS - PAGE.cols - 10;
    // One hit per drum transient on the drums stem: a rising edge off a valley, a peak at least 0.18 above the valley,
    // and 80 ms of refractory time, so a single hit never re-rolls the tree twice.
    const env = (ts: number) => this.ctx.audio.env('drums', ts);
    const nSteps = Math.floor((this.ctx.end - this.ctx.start) / 0.01);
    this.drumHitTimes = [];
    for (let s = 1; s <= nSteps; s++) {
      const ts = this.ctx.start + s * 0.01;
      const last = this.drumHitTimes[this.drumHitTimes.length - 1];
      if (last !== undefined && ts - last <= 0.08) continue;
      if (env(ts) - env(ts - 0.02) <= 0.07) continue;
      let base = Infinity, peak = 0;
      for (let k = 1; k <= 8; k++) base = Math.min(base, env(ts - k * 0.01));
      for (let k = 0; k <= 4; k++) peak = Math.max(peak, env(ts + k * 0.01));
      if (peak - base > 0.18) this.drumHitTimes.push(ts);
    }
    let col = 5, row = 7;
    this.l2Seeds = [];
    l2.syls.forEach((s) => {
      const cells: { q: number; r: number; ch: string }[] = [];
      const w = textCells(s.text, 1, 0, 0, () => {});
      if (col > 5 && col + w > maxCol) { col = 5; row += 12; }
      textCells(s.text, 1, col, row, (q, r, ch) => cells.push({ q, r, ch }));
      col += w + 3;
      this.l2Seeds.push({ syl: s, cells });
    });
    this.page.width = Math.ceil(PAGE.cols * AW * SCALE);
    this.page.height = Math.ceil(PAGE.rows * AH * SCALE);
    this.pc = this.page.getContext('2d')!;
  }

  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    const t = f.t;
    const tq = stepT(t, 15), tl = stepT(t, 24);
    const g = this.g;
    g.clear();
    const [l0, l1, l2, l3] = this.lines as [SylLine, SylLine, SylLine, SylLine];

    if (tq < this.tSee) this.partA(tq, tl, l0);
    else if (tq < l2.line.start) this.partB(tq, tl, l1);
    else if (tq < this.tFar) this.board(t, tq, tl, l2);
    else if (t < this.tA) this.montage(tq, tl, l3);
    else if (t < this.tDoomEnd) this.gridToDoom(t, tq, tl, l3);
    else if (t < this.tVer) renderAsciiDoom(g, t, this.tA, () => this.placedLine(3, tl, 0, Tone.Hole));
    else if (t < this.tIrc) this.doomToIrc(t, tq, tl, l3);
    else this.asciiIrc(g, tq, tl, l3);
    this.ascii.draw(c, g);
    // For the entire first line "(i) i can't stop i just went on without a destination", run the Game Tree!
    if (tq < this.tSee) {
      let drumHits = 0;
      for (let i = 0; i < this.drumHitTimes.length; i++) {
        if (this.drumHitTimes[i]! <= t) drumHits = i + 1;
        else break;
      }
      const amt = prog(tq, this.ctx.start, this.ctx.start + 0.4, ease.outCubic) * (1 - prog(tq, this.tSee - 0.3, this.tSee));
      vortex(c, tq - this.ctx.start, stepT(t, 30), W / 2, H / 2, amt, false, l0.syls, { drumHits });
    }
    if (tq >= this.tSee && tq < this.snaps[0]! + 0.3) {
      const [fx, fy, r] = this.light(tq, tl, l1);
      const fade = 1 - prog(tq, this.snaps[0]! - 0.1, this.snaps[0]! + 0.3);
      if (fade > 0.01) {
        c.save();
        c.globalAlpha = fade;
        c.strokeStyle = PAPER;
        c.lineWidth = 2;
        c.beginPath(); c.arc(fx, fy, r, 0, Math.PI * 2); c.stroke();
        c.restore();
      }
    }
    if (tq >= l2.line.start && t < this.tFar) {
      renderCalendar(c, t, l2.line.start, this.tDays, this.gen, this.life, this.page, this.pc);
    } else if (t >= this.tFar && t < this.tFar + 0.85) {
      const dtStorm = Math.max(0, tq - this.tNeverGone);
      const tc = stepT(this.tFar, 24);
      const tearsAt = (x: number) => Math.max(0, x < this.tDays ? (x - l2.line.start) * 12 : (this.tDays - l2.line.start) * 12 + (x - this.tDays) * 24);
      const day = Math.floor(tearsAt(tc));
      renderCalendarParticles(c, t, this.tFar, day, this.ascii, sandstormD, dtStorm);
    }
    // Dust storm: starts growing smoothly from 0 during "it's never gone" (162.58 s), rages over calendar and morphs into grid through 2 beats into Bar 141 (170.08 s)
    if (tq >= this.tNeverGone && tq < this.tMorphEnd + 0.15) {
      this.renderDustStorm(c, tq, this.tNeverGone, l2.line.start);
    }
    // the Life plane stays; no sideway clumps in the final chorus (they come back one by one in the outro)
    return { full: true, plane: tq < this.tFar ? 0.35 : 0.45, clumps: 0 };
  }

  /**
   * \"(i) i can't stop i just went on without a destination\":
   * Opens directly on the ascii grid; iris wipes expand from the centre over 3 bars.
   */
  private partA(tq: number, tl: number, l0: SylLine) {
    const g = this.g;
    // Three identical iris wipes from the centre, one bar apart. Each wipe lasts 2.1 s and starts 0.3 s after its bar.
    // Bar 129: blue to black (ends on bar 131). Bar 130: back to blue (ends on bar 132). Bar 131: back to black (ends on bar 133).
    const bar = 4 * BEAT;
    const wipe = (k: number, delay = 0) => prog(tq, this.ctx.start + 0.3 + k * bar + delay, this.ctx.start + 2.4 + k * bar + delay, ease.inOutCubic);
    const w1 = wipe(0), w2 = wipe(1, 0.5 * BEAT), w3 = wipe(2, 1 * BEAT);
    const GLYPHS_ASCII = '0123456789abcdefghijklmnopqrstuvwxyz.:-=+*#%@/\\_!?';
    const stepSeed = Math.floor(tq * 24);
    for (let r = 0; r < AROWS; r++) {
      for (let q = 0; q < ACOLS; q++) {
        const dx = Math.abs(q - ACOLS / 2) / (ACOLS / 2), dy = Math.abs(r - AROWS / 2) / (AROWS / 2);
        const d = Math.max(dx, dy) / 1.25;
        const thresh = d + (hashI(q, r, 17) - 0.5) * 0.08;
        // The latest wipe that has reached this cell sets its colour, with a noisy terminal decoding wave like the credits box in outro.
        if (w3 >= thresh) {
          if (w3 < thresh + 0.12 && w3 < 1.05) {
            const h = hashI(q, r, stepSeed);
            const ch = GLYPHS_ASCII[Math.floor(h * GLYPHS_ASCII.length)]!;
            const tone = h < 0.22 ? Tone.Hole : h < 0.65 ? Tone.Bright : Tone.Dim;
            g.set(q, r, ch, tone);
          } else if (q % 8 === 0 && r % 4 === 0) {
            g.set(q, r, '+', Tone.Dim);
          }
        } else if (w2 >= thresh) {
          if (w2 < thresh + 0.12 && w2 < 1.05) {
            const h = hashI(q, r, stepSeed);
            const ch = GLYPHS_ASCII[Math.floor(h * GLYPHS_ASCII.length)]!;
            const tone = h < 0.35 ? Tone.Hole : Tone.Blue;
            g.set(q, r, ch, tone);
          } else {
            g.set(q, r, ' ', Tone.Blue);
          }
        } else if (w1 >= thresh) {
          if (w1 < thresh + 0.12 && w1 < 1.05) {
            const h = hashI(q, r, stepSeed);
            const ch = GLYPHS_ASCII[Math.floor(h * GLYPHS_ASCII.length)]!;
            const tone = h < 0.22 ? Tone.Hole : h < 0.65 ? Tone.Bright : Tone.Dim;
            g.set(q, r, ch, tone);
          } else if (q % 8 === 0 && r % 4 === 0) {
            g.set(q, r, '+', Tone.Dim);
          }
        } else {
          g.set(q, r, ' ', Tone.Blue);
        }
      }
    }
    const k = sylAt(l0, tl);
    if (k >= 0) {
      const txt = l0.syls[k]!.text;
      const c0 = Math.floor(ACOLS / 2 - txt.length * 4), r0 = Math.floor(AROWS / 2 - 5);
      const cols = textCells(txt, 2, c0, r0, (q, r, ch) => g.set(q, r, ch, Tone.Hole));
      mark(`syl:${txt}`, c0 * AW, r0 * AH, Math.max(12, cols) * AW, 20 * AH);
    }
  }

  /** "i can't see the walls surrounding me without a doubt it's never gone". */
  private partB(tq: number, tl: number, l1: SylLine) {
    const g = this.g;
    const snap0 = this.snaps[0]!;
    const dissolve = prog(tq, snap0 - 0.75, snap0 + 0.25, ease.inOutCubic);
    if (dissolve < 1) {
      const [fx, fy, r] = this.light(tq, tl, l1);
      const typed = Math.min(ACOLS * AROWS, Math.floor((tq - this.tSee) * 9000));
      for (let i = 0; i < typed; i++) {
        const q = i % ACOLS, rr = Math.floor(i / ACOLS);
        if (dissolve > 0 && hashI(q, rr, 37) < dissolve) continue;
        const dx = q * AW + AW / 2 - fx, dy = rr * AH + AH / 2 - fy;
        g.set(q, rr, this.chorus[i % this.chorus.length]!, dx * dx + dy * dy < r * r ? Tone.Bright : Tone.Dim);
      }
    }
    const join = prog(tq, snap0 - 0.85, snap0, ease.outCubic);
    if (tq < snap0) {
      if (join > 0) renderHotel(g, 0, 0, join);
      this.placedLine(1, tl, 0, Tone.Hole);
      return;
    }
    // The Cantor diagonals start cutting through the closed walls before "without" and widen smoothly across Bar 136
    const open = prog(tq, this.tDoubt - 0.2, this.tDoubt + 1.2, ease.inOutCubic);
    if (tq < this.tDoubt) {
      let n = 0;
      let shiftFrac = 1;
      for (const s of this.snaps) {
        if (s <= tq) {
          n++;
          shiftFrac = Math.min(1, (tq - s) / 0.22);
        }
      }
      // Four snaps close the walls in, "me" slams them in one more step. They never open again.
      const wall = Math.round(((n + (tq >= this.tMe ? 1 : 0)) / (this.snaps.length + 1)) * WALL_MAX);
      renderHotel(g, n, wall, 1, shiftFrac);
      if (open > 0) this.dfCantorTerrain(tq, 30, 0, open);
      const topFade = 1 - prog(tq, snap0, snap0 + 0.35);
      if (topFade > 0) {
        this.placedLine(1, Math.min(tl, snap0 - 0.02), 0, Tone.Hole);
      }
      const k = sylAt(l1, tl);
      if (k >= 0) {
        const txt = l1.syls[k]!.text, sc = 2, w = l1.bt.charW[l1.ranges[k]![0]]! * sc * 3;
        const c0 = Math.floor((ACOLS - txt.length * 8 * sc) / 2), r0 = 22;
        const cols = textCells(txt, sc, c0, r0, (q, r, ch) => g.set(q, r, ch, Tone.Hole));
        mark(`syl:${txt}`, c0 * AW, r0 * AH, Math.max(w, cols) * AW, 10 * sc * AH);
      }
      return;
    }
    if (open < 1) renderHotel(g, this.snaps.length, WALL_MAX, 1);
    const flood = prog(tq, this.tNever, l1.line.end, ease.inCubic);
    this.dfCantorTerrain(tq, 30, flood, open);
    this.placedLine(1, tl, 9, Tone.Hole);
  }


  /**
   * "what i have done" (163.91 s): Maintains the BLUE background from 163.64 s ("never gone") for continuity!
   * Over the blue substrate, renders a living Dwarf Fortress world/fortress simulation (mined halls, workshops,
   * stockpiles, wandering dwarves '@', river channels, status log, and Life cells) with the calendar on the right.
   */
  private board(t: number, tq: number, tl: number, l2: SylLine) {
    const life = this.life, g = this.g;
    const gn = genAt(t, l2.line.start, [2], 5); // (raw t: genAt holds it itself, and tq is held already)
    if (gn < this.gen || this.gen < 0) { life.seed.fill(0); life.reseed(); this.gen = 0; }
    for (let gg = this.gen; gg <= gn; gg++) {
      life.at(gg);
    }
    this.gen = gn;

    // 1. Clean solid BLUE background across the entire frame — zero holes, zero dots, zero caverns
    for (let r = 0; r < AROWS; r++) {
      for (let q = 0; q < ACOLS; q++) {
        g.set(q, r, ' ', Tone.Blue);
      }
    }

    // 2. Stable, non-glitching syllables of "what i have done..." in bright paper on blue with high-contrast ink backing
    this.drawL2(g, tl, l2, false);
  }

  private drawL2(g: Grid, tl: number, l2: SylLine, darkMargin: boolean) {
    this.activeLyricCells.fill(0);
    const k = sylAt(l2, tl);
    for (let si = 0; si <= k; si++) {
      const item = this.l2Seeds[si]!;
      const s = item.syl;
      if (tl < s.start) continue;
      const fp = prog(tl, s.start, s.start + FORM, ease.outCubic);

      for (const cell of item.cells) {
        if (hashI(cell.q, cell.r, si) > fp) continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const q = cell.q + dx, r = cell.r + dy;
          if (q >= 0 && q < ACOLS && r >= 0 && r < AROWS) {
            if (darkMargin) g.set(q, r, ' ', Tone.None);
            else this.activeLyricCells[r * ACOLS + q] = 1;
          }
        }
      }

      let q0 = Infinity, r0 = Infinity, q1 = -Infinity, r1 = -Infinity;
      for (const cell of item.cells) {
        if (hashI(cell.q, cell.r, si) > fp) continue;
        g.set(cell.q, cell.r, cell.ch, Tone.Hole);
        q0 = Math.min(q0, cell.q); r0 = Math.min(r0, cell.r);
        q1 = Math.max(q1, cell.q + 1); r1 = Math.max(r1, cell.r + 1);
      }
      if (si === k && q1 > q0) mark(`syl:${s.text}`, q0 * AW, r0 * AH, (q1 - q0) * AW, (r1 - r0) * AH);
    }
  }

  /** Organic 2D sandstorm displacement simulation: multi-layer turbulent wind plumes blowing across the screen and on top of the calendar. */
  private renderDustStorm(c: CanvasRenderingContext2D, tq: number, tStart: number, tFull: number) {
    const dt = Math.max(0, tq - tStart);
    // Smoothly grows from strictly 0 during "it's never gone" up to 1.0 at calendar start
    let intensity = Math.min(1.0, prog(tq, tStart, tFull, ease.inQuad));
    if (tq >= this.tFar) {
      intensity *= Math.max(0, 1.0 - prog(tq, this.tFar, this.tMorphEnd, ease.outCubic));
    }
    if (intensity <= 0.005) return;

    const GLYPHS_ASCII = '0123456789abcdefghijklmnopqrstuvwxyz.:-=+*#%@/\\_!?';
    const thresh = 0.68 - 0.24 * intensity;
    const maxProb = 0.70 * intensity;

    for (let r = 0; r < AROWS; r++) {
      for (let q = 0; q < ACOLS; q++) {
        if (this.activeLyricCells[r * ACOLS + q] === 1) continue;

        const d = sandstormD(q, r, dt);
        const particleX = q - Math.round(dt * 48.0);
        const particleH = hash2(particleX, r);

        if (d > thresh && particleH < maxProb) {
          const chIdx = Math.floor(hash2(particleX, r * 7 + 13) * GLYPHS_ASCII.length);
          const ch = GLYPHS_ASCII[chIdx]!;
          this.ascii.glyph(c, ch, q * AW, r * AH, true);
        }
      }
    }
  }

  /**
   * "the destination's still a far" (168.28 s .. 170.82 s): Morphs out of the blowing dust storm across Bar 140
   * (168.28 s .. 168.58 s) into the 4x3 wall of all twelve scenes, staying full until 170.82 s when the grid turns
   * into first-person ASCII DOOM.
   */
  private renderMontageGrid(g: Grid, tq: number) {
    const beat = Math.floor((tq - BEAT0) / BEAT);
    const tw = 40, th = 20;
    const order = Array.from({ length: 12 }, (_, i) => i).sort((a, b) => hashI(a, beat, 7) - hashI(b, beat, 7));
    const morphProg = prog(tq, this.tFar, this.tMorphEnd);
    const inMorph = morphProg < 1.0;
    const dt = Math.max(0, tq - this.tNeverGone);
    const GLYPHS_ASCII = '0123456789abcdefghijklmnopqrstuvwxyz.:-=+*#%@/\\_!?';

    for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 4; tx++) {
      const tile = ty * 4 + tx;
      const kind = order[tile]!;
      for (let r = 0; r < th; r++) for (let q = 0; q < tw; q++) {
        const gx = tx * tw + q, gy = ty * th + r;
        const l = motif(kind, q / tw, r / th, tq);

        if (inMorph) {
          const d = sandstormD(gx, gy, dt);
          const windWave = morphProg * 1.5 - (gx / ACOLS) * 0.5;
          const crystallize = clamp(windWave + (1 - d) * 0.4, 0, 1);

          if (crystallize >= 0.65) {
            if (l > 0.05) g.set(gx, gy, rampChar(l), l > 0.85 ? Tone.Bright : Tone.Dim);
          } else if (crystallize >= 0.25) {
            if (l > 0.05) {
              const particleX = gx - Math.round(dt * 48.0);
              const ch = (hash2(particleX, gy) < crystallize)
                ? rampChar(l)
                : GLYPHS_ASCII[Math.floor(hash2(particleX, gy * 7 + 13) * GLYPHS_ASCII.length)]!;
              g.set(gx, gy, ch, l > 0.85 ? Tone.Bright : Tone.Dim);
            }
          } else {
            const isBorder = (q === 0 || r === 0);
            if (isBorder && hash2(gx, gy) < 0.35 + morphProg * 0.5) {
              g.set(gx, gy, isBorder && q === 0 ? '|' : '-', Tone.Dim);
            } else if (d > 0.46) {
              const particleX = gx - Math.round(dt * 48.0);
              const ch = GLYPHS_ASCII[Math.floor(hash2(particleX, gy * 7 + 13) * GLYPHS_ASCII.length)]!;
              g.set(gx, gy, ch, Tone.Dim);
            }
          }
        } else {
          if (l <= 0.05) continue;
          g.set(gx, gy, rampChar(l), l > 0.85 ? Tone.Bright : Tone.Dim);
        }
      }
    }
  }

  /**
   * "the destination's still a far" (168.28 s .. 170.38 s): 4x3 wall of all twelve scenes.
   */
  private montage(tq: number, tl: number, l3: SylLine) {
    this.renderMontageGrid(this.g, tq);
    const [,, l2] = this.lines as [SylLine, SylLine, SylLine, SylLine];
    if (tl < l3.line.start) {
      this.drawL2(this.g, tl, l2, true);
    } else {
      this.placedLine(3, tl, 0, Tone.Hole);
    }
  }
  /**
   * "a far" (170.380 s .. 170.980 s): the camera dives into one tile of the 4x3 motif grid, which becomes the
   * 3D ASCII DOOM corridor (`montageIntoDoom` in `_broken_trans.ts`).
   */
  private gridToDoom(t: number, tq: number, tl: number, l3: SylLine) {
    const g = this.g;
    this.gDoom.clear();
    renderAsciiDoom(this.gDoom, t, this.tA, () => {});
    // the montage arrangement of the transition's first beat, held to its end
    const beat = Math.floor((this.tA + BEAT / 2 - BEAT0) / BEAT);
    const order = Array.from({ length: 12 }, (_, i) => i).sort((a, b) => hashI(a, beat, 7) - hashI(b, beat, 7));
    montageIntoDoom(g, { order, luma: (k, u, v) => motif(k, u, v, tq) }, this.gDoom, tq, this.tA);
    // Stamped lyrics centered in bright white over the transition
    this.placedLine(3, tl, 0, Tone.Hole);
  }

  /**
   * "-ver see" (171.580 s .. 172.080 s): the 3D ASCII DOOM corridor rolls into the retro BBS IRC client as
   * split-flaps (`doomIntoIrc` in `_broken_trans.ts`).
   */
  private doomToIrc(t: number, tq: number, tl: number, l3: SylLine) {
    // BBS IRC as destination into gIrc (without placing lyrics yet)
    this.gIrc.clear();
    this.asciiIrc(this.gIrc, tq, tl, l3, false);
    this.gDoom.clear();
    renderAsciiDoom(this.gDoom, t, this.tA, () => {});
    doomIntoIrc(this.g, this.gDoom, this.gIrc, tq, this.tVer, this.tIrc);
    // Stamped lyrics centered in bright white over the transition
    this.placedLine(3, tl, 0, Tone.Hole);
  }
  /**
   * From Bar 144 (171.896 s, "see you again") to the end of broken (173.08 s):
   * Retro BBS / IRC terminal client (#destination on irc.breaked.net): channel header, user list sidebar where
   * "+you" disconnects on "again", scrolling server/chat log, and command input line, while `placedLine` keeps
   * the sung lyrics anchored in place.
   */
  private asciiIrc(g: Grid, tq: number, tl: number, l3: SylLine, drawLyrics = true) {
    const dt = Math.max(-2.0, tq - this.tIrc);
    const againT = l3.line.words.at(-1)!.start;
    const youGone = tl >= againT;
    const putStr = (col: number, row: number, s: string, tone: Tone) => {
      const str = s.toLowerCase();
      for (let i = 0; i < str.length; i++) g.set(col + i, row, str[i]!, tone);
    };

    // 1. Outer BBS / IRC window borders, top title bar (row 1), user list divider (col 126), bottom status/input (rows 54..58)
    for (let q = 0; q < ACOLS; q++) {
      g.set(q, 0, '=', Tone.Bright);
      g.set(q, 2, '-', Tone.Dim);
      g.set(q, 54, '=', Tone.Hole);
      g.set(q, 56, '-', Tone.Dim);
      g.set(q, 59, '=', Tone.Bright);
    }
    for (let r = 1; r < 59; r++) {
      g.set(0, r, '|', Tone.Dim);
      g.set(126, r, '|', Tone.Bright);
      g.set(ACOLS - 1, r, '|', Tone.Dim);
    }
    putStr(3, 1, 'bbs/irc · irc.void.net:6667 · #destination [+nt] · topic: without a destination', Tone.Hole);
    putStr(129, 1, `users [${youGone ? '01' : '02'}]`, Tone.Bright);

    // 2. Right sidebar: Channel user list & BBS node status
    putStr(129, 4, '@(i)', Tone.Hole);
    if (!youGone) {
      putStr(129, 6, '+you', Tone.Bright);
      putStr(129, 8, ' [idle 00s]', Tone.Dim);
    } else {
      putStr(129, 6, ' [empty]', Tone.Dim);
    }
    putStr(129, 12, '--- nodes ---', Tone.Dim);
    putStr(129, 14, 'node 01: busy', Tone.Dim);
    putStr(129, 16, 'node 02: down', Tone.Dim);
    putStr(129, 18, `node 03: ${youGone ? 'eof' : 'link'}`, youGone ? Tone.Hole : Tone.Bright);
    putStr(129, 22, '--- ping ----', Tone.Dim);
    putStr(129, 24, `rtt: ${youGone ? 'timeout' : `${18 + Math.floor(dt * 90)}ms`}`, Tone.Dim);

    // 3. Scrolling IRC chat log in main pane (cols 2..124, rows 4..52)
    const logs: [number, string, Tone][] = [
      [-2.0, '*** connected to irc.void.net (port 6667)', Tone.Dim],
      [-1.5, '*** topic for #destination is: looking at the walls as days went by', Tone.Dim],
      [-1.0, '[02:48] <+you> are you still there?', Tone.Bright],
      [-0.5, "[02:49] <@(i)> the destination's still a far", Tone.Dim],
      [0.0, "[02:51] <@(i)> i'll never", Tone.Bright],
      [0.12, '[02:51] <@(i)> see you', Tone.Hole],
      [0.32, '[02:52] <@(i)> again', Tone.Hole],
      [0.48, '*** you (~you@mirror.local) has quit (connection reset by peer)', Tone.Bright],
      [0.65, '*** mode/#destination [+m] by server', Tone.Dim],
      [0.82, '[02:52] <@(i)> hello?', Tone.Hole],
      [0.98, '*** cannot send to channel: #destination (no such nick/channel)', Tone.Bright],
      [1.12, '*** disconnected from server (eof)', Tone.Hole],
    ];
    const visible = logs.filter(([at]) => dt >= at);
    visible.forEach(([, text, tone], idx) => {
      // Place lines along top and bottom of chat pane so center stays clear for the big sung lyrics
      const r = idx < 5 ? 4 + idx * 2 : 38 + (idx - 5) * 2;
      if (r < 53) putStr(3, r, text, tone);
    });

    // 4. Bottom status bar & live typing prompt
    putStr(3, 55, `[02:${51 + Math.floor(dt)}] [@(i)(+i)] [#destination(+nt)] [lag: ${youGone ? 'inf' : '0.02s'}]`, Tone.Bright);
    const prompt = youGone ? '[(i)] /quit _' : "[(i)] /msg you i'll never see you again_";
    putStr(3, 57, prompt, Tone.Hole);

    // At "see you again", turn off "the destination's still a far i'll never" so only "see you again" remains in its anchored position
    if (drawLyrics) this.placedLine(3, tl, 11, Tone.Hole, false);
  }
  /**
   * Line `li` written on the grid in place (like `walls`): wrapped, centred, each syllable forming on its
   * onset in `tone` over a 1-cell dark margin so it reads over any background.
   */
  private placedLine(li: number, tl: number, fromSyl: number, tone: Tone, shiftY = true) {
    const g = this.g, L = this.laid[li]!, sl = L.sl;
    if (li === 3 && tl >= this.tSee2) {
      fromSyl = Math.max(fromSyl, 11);
      shiftY = false;
    }
    const k = sylAt(sl, tl);
    if (k < fromSyl) return;
    const s = L.s;
    // if this sub-scene starts mid-line (`fromSyl > 0`), shift up so the first shown syllable is on the top row
    let yMin = Infinity;
    if (shiftY) for (const p of L.placed) if (p.si >= fromSyl) yMin = Math.min(yMin, p.y);
    const y0L = L.y0 - (Number.isFinite(yMin) ? yMin * s : 0);
    // dark margin around the syllables that have started, so blue/bright letters read cleanly over binary
    for (const p of L.placed) {
      if (p.si < fromSyl || p.si > k) continue;
      for (let j = -1; j <= p.b.len; j++) for (let dy = -1; dy <= s; dy++) for (let dx = -1; dx <= s; dx++) {
        g.set(L.x0 + (p.x + j) * s + dx, y0L + p.y * s + dy, ' ', Tone.None);
      }
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of L.placed) {
      if (p.si < fromSyl || p.si > k) continue;
      const sy = sl.syls[p.si]!;
      const fp = prog(tl, sy.start, sy.start + FORM, ease.outCubic);
      const ch = sl.bt.text.toLowerCase()[p.b.ci]!;
      for (let j = 0; j < p.b.len; j++) {
        if (hashI(p.b.cx + j, p.b.cy, p.si) > fp) continue;
        for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
          const q = L.x0 + (p.x + j) * s + dx, r = y0L + p.y * s + dy;
          g.set(q, r, ch, tone);
          if (p.si === k) { x0 = Math.min(x0, q); y0 = Math.min(y0, r); x1 = Math.max(x1, q + 1); y1 = Math.max(y1, r + 1); }
        }
      }
    }
    if (x1 > x0) mark(`syl:${sl.syls[k]!.text}`, x0 * AW, y0 * AH, (x1 - x0) * AW, (y1 - y0) * AH);
  }

  /**
   * Cantor's diagonal at 161.80 s ("without a doubt it's never gone"):
   * Multi-diagonal binary proof matrix with row indices f(n) on the left and constructed counterexample bars
   * (strictly rectilinear, zero sine-wave blobs), flooding to blue on "never gone".
   */
  private dfCantorTerrain(tq: number, rate: number, blueFlood = 0, open = 1) {
    const g = this.g;
    const scroll = Math.floor((tq - this.ctx.start) * rate);
    for (let r = 0; r < AROWS; r++) {
      const n = r + scroll;
      const d0 = n % 52, d1 = (n * 2) % 52;
      for (let q = 0; q < ACOLS; q++) {
        const colInBlock = q % 52;
        const diff0 = Math.abs(colInBlock - d0);
        const diff1 = Math.abs(colInBlock - d1);
        const distDiag = Math.min(Math.min(diff0, 52 - diff0), Math.min(diff1, 52 - diff1));
        if (open < 1) {
          const key = (distDiag / 26) * 0.42 + hashI(q, r, 53) * 0.54;
          if (key > open) continue;
          g.set(q, r, ' ', Tone.None);
        }
        if (blueFlood > 0) {
          const threshold = blueFlood >= 0.85 ? 52 : blueFlood * 36;
          if (distDiag <= threshold || blueFlood >= 0.95) {
            g.set(q, r, ' ', Tone.Blue);
            continue;
          }
        }
        const bit = hashI(n, q, 51) < 0.5 ? '0' : '1';
        if (distDiag <= 1) {
          g.set(q, r, bit === '0' ? '1' : '0', Tone.Hole);
        } else if (q < 10) {
          const hdr = `f(${String(n % 1000).padStart(3, '0')})=`;
          if (q < hdr.length) g.set(q, r, hdr[q]!, Tone.Bright);
        } else if (q % 52 === 0) {
          g.set(q, r, '|', Tone.Bright);
        } else if (q % 2 === 0) {
          g.set(q, r, bit, Tone.Dim);
        }
      }
    }
  }

  /**
   * The flashlight of "i can't see the": spawns at and tracks the center of the active sung syllable in laid[1].
   */
  private light(tq: number, tl: number, l1: SylLine): [number, number, number] {
    const L = this.laid[1]!;
    const k = Math.max(0, sylAt(l1, tl));
    // Compute screen center (tx, ty) of syllable k in laid[1]
    let q0 = Infinity, r0 = Infinity, q1 = -Infinity, r1 = -Infinity;
    for (const p of L.placed) {
      if (p.si === k) {
        q0 = Math.min(q0, L.x0 + p.x * L.s);
        r0 = Math.min(r0, L.y0 + p.y * L.s);
        q1 = Math.max(q1, L.x0 + (p.x + p.b.len) * L.s);
        r1 = Math.max(r1, L.y0 + (p.y + 1) * L.s);
      }
    }
    const tx = Number.isFinite(q0) ? ((q0 + q1) / 2) * AW : W / 2;
    const ty = Number.isFinite(r0) ? ((r0 + r1) / 2) * AH : H / 2;
    const onset = l1.syls[k]?.start ?? tl;
    const pull = Math.exp(-Math.max(0, tq - onset) / 0.25);
    const wobbleX = 110 * Math.sin(tq * 3.1) * (1 - pull * 0.75);
    const wobbleY = 65 * Math.cos(tq * 2.7) * (1 - pull * 0.75);
    const r = 240 + 1500 * prog(tq, this.tSee + 0.3, this.snaps[0]!, ease.inCubic);
    return [tx + wobbleX, ty + wobbleY, r];
  }
}

const sEnd = (w: { start: number; end: number }) => w.end;

/**
 * The twelve scenes of the song as luma fields on a tile (u, v 0..1), each distinct: 0 bricks (walls),
 * 1 mirror cracks, 2 vortex (room), 3 ruled ledger with tally (atone), 4 perspective ceiling, 5 seven-segment
 * clock (dust), 6 snake maze, 7 cube with shadow, 8 blueprint dimension (flock), 9 Droste squares (build_up),
 * 10 almond eye (without), 11 network feature maps (cnn).
 */
function motif(kind: number, u: number, v: number, t: number) {
  const s = Math.sin, fr = (x: number) => x - Math.floor(x);
  switch (kind) {
    case 0: return (fr(v * 6) > 0.18 && fr(u * 4 + (Math.floor(v * 6) % 2) * 0.5) > 0.08) ? 0.65 : 0;
    case 1: { const a = Math.atan2(v - 0.5, u - 0.5), r = Math.hypot(u - 0.5, v - 0.5); return fr(a * 2.2 + 0.3) < 0.05 || Math.abs(r - 0.32) < 0.025 ? 1 : 0.12; }
    case 2: { const r = Math.hypot(u - 0.5, (v - 0.5) * 0.6), a = Math.atan2(v - 0.5, u - 0.5); return fr(a / 6.283 + Math.log(r + 0.01) * 0.6 + t * 0.3) < 0.2 ? 0.9 : 0; }
    case 3: return fr(v * 7) < 0.1 ? 0.5 : (u < 0.12 || u > 0.82) && fr(v * 7) < 0.65 ? 0.9 : 0;
    case 4: { const z = 1 / (v + 0.08); return fr(z * 0.6) < 0.08 || fr((u - 0.5) * z * 0.8) < 0.08 ? 0.8 : 0; }
    case 5: { const d = Math.abs(u - 0.32) < 0.14 || Math.abs(u - 0.68) < 0.14; return d && Math.abs(v - 0.5) < 0.32 && (fr(v * 6) < 0.22 || fr(u * 7) < 0.22) ? 0.9 : 0; }
    case 6: return (Math.floor(u * 10) + Math.floor(v * 6)) % 2 && hashI(Math.floor(u * 10), Math.floor(v * 6), 7) < 0.6 ? 0.7 : 0;
    case 7: return Math.abs(u - 0.42) < 0.15 && Math.abs(v - 0.52) < 0.24 ? 1 : v > 0.72 && u > 0.42 && u < 0.85 ? 0.35 : 0;
    case 8: return (Math.abs(v - 0.3) < 0.03 && u > 0.15 && u < 0.85) || (Math.abs(v - 0.65) < 0.12 && fr(u * 9) < 0.55) ? 0.85 : 0;
    case 9: { const m = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)); return fr(Math.log(m + 0.001) * 2.5 - t) < 0.3 ? 0.9 : 0; }
    case 10: { const e = (u - 0.5) ** 2 / 0.16 + (v - 0.5) ** 2 / 0.05; return e < 1 ? (Math.hypot(u - 0.5, v - 0.5) < 0.1 ? 0 : 0.9) : 0; }
    default: return (Math.abs(u - 0.25) < 0.12 || Math.abs(u - 0.55) < 0.1) && Math.abs(v - 0.5) < 0.32 ? 0.75 : Math.abs(v - 0.5) < 0.04 && u > 0.65 ? 1 : 0;
  }
}

function hash2(x: number, y: number) {
  let h = ((x + 100000) * 374761393 + (y + 100000) * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise2D(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const bl = hash2(ix, iy), br = hash2(ix + 1, iy);
  const tl = hash2(ix, iy + 1), tr = hash2(ix + 1, iy + 1);
  return (bl * (1 - ux) + br * ux) * (1 - uy) + (tl * (1 - ux) + tr * ux) * uy;
}

function sandstormD(q: number, r: number, dt: number): number {
  const u1 = q * 0.025 - dt * 1.4;
  const v1 = r * 0.06 + Math.sin(dt * 0.5) * 0.4;
  const n1 = noise2D(u1, v1);

  const u2 = q * 0.06 - dt * 3.2 + (n1 - 0.5) * 2.2;
  const v2 = r * 0.14 + (n1 - 0.5) * 1.8;
  const n2 = noise2D(u2, v2);

  const u3 = q * 0.14 - dt * 6.5 + (n2 - 0.5) * 2.5;
  const v3 = r * 0.28;
  const n3 = noise2D(u3, v3);

  return n1 * 0.42 + n2 * 0.35 + n3 * 0.23;
}
