// Plate 10 · The new original (new script, 188.56–202.10 s, trimmed at bar 114).
// Full codex folio + Live 4-Era Synthesis Specimen Apparatus:
// - Right (`x = 800..1850`): Reborn Plate 0 codex in the new script. `ぽい辞書` in red down the title rail; a
//   geometric woven knotwork initial holds `愛`; lines 70-73 sit in four ruled dictionary entries with red
//   rubricated headwords (`別れ`, `死ぬ`, `患`, `踊`), Fraktur English glosses, and a marginalia vine growing
//   one step per sung syllable from the snail at its root to the bird at its top.
// - Left (`x = 100..620`, above the `(330, 800)` seal): Live 4-Era Specimen Box drafting each sung glyph at
//   large scale on the 12×12 modernist snap grid with brush entry vectors, press serif brackets, and JPEG block
//   terminals, launching era shards (`look: 'assembly'`) across the spread into the codex columns.
// - A cappella climax (`いたかった人生`, 200.68–201.91 s): on `人生` (201.415 s), `人` and `生` cut straight
//   through the vellum onto the red substrate (`destination-out`) in both Entry 3's column and at monumental
//   scale inside the Left Specimen Box.
// - Loop seam exit (`201.78–202.10 s`): a fresh blank vellum sheet sweeps right-to-left over the completed
//   codex, and the `神` seal punches through at `(330, 800)` onto red, settling into exact Frame 0 by `bar:114`.
import type { Frame } from '@pve/engine/scene';
import { H, W } from '@pve/engine/gl';
import { lineNo, units, type Line, type WrittenUnit } from '@pve/engine/lyrics';
import { clamp, lastTime } from '@pve/engine/util';
import { copyTimes, GLOSS, fnt, genAt, INK, MONO, PageScene, PAPER, rebate, RED, seal, statusLine, tone, type SurfaceOpts } from './_page';
import { SCRIPT } from './_era_script';
import { advance, loadScript, strokeSpans, writeStrokes, type PStroke } from './new-script';
import { constructed, placeHand } from './new-hand';
import {
  assemble, Assembly, buildKnot, buildVine, CODEX_BLOCK, CODEX_BOTTOM, CODEX_TOP, CODEX_XS,
  drawKnot, drawMarginalia, drawSnail, drawSpecimenBase, drawSpecimenLive, INI, layer2D,
  Palimpsest, roundSquare, SPEC_FIELD, VINE_BOX, VINE_X,
  type Built, type SpecimenGlyph, type Written,
} from './new-looks';

interface Writing {
  strokes: PStroke[];
  spans: [number, number][];
  t0: number;
  dur: number;
  lockEnd: number;
  red: boolean;
  hole: boolean;
  em: number;
  built: Built | null;
}

interface CodexEntry {
  line: Line;
  us: WrittenUnit[];
  x: number;
  top: number;
}

const LINE_EM = 40;
const HEAD_EM = 78;
const SUB_EM = 46;
const TITLE_EM = 76;
const INI_EM = 164;
const JINSEI_COL_EM = 82;
const SMALL = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ';
/** The seal: where plate 0 has it, so the last frame is frame 0. */
const SEAL: [number, number, number] = [330, 800, 120];
/** Fresh vellum sheet sweep window (s) and seal punch window (s) before bar 114 (202.10 s). */
const SHEET_T = [201.78, 202.01] as const;
const PUNCH_T = [201.94, 202.06] as const;
/** The last beat the seal pumps on (s): after it the song is a cappella. */
const LAST_PUMP = 200.38;

const writeDur = (s: number, e: number) => Math.min(0.38, Math.max(0.11, e - s));
/** A glyph in the new script. Its nodes show from 60 px up, where they stay clear of the strokes. */
const hand = (ch: string, ox: number, oy: number, em: number, weight: number): PStroke[] => placeHand(constructed(ch), ox, oy, em, weight, em >= 60);

export default class New extends PageScene {
  private knot = buildKnot();
  private vine = buildVine();
  private titleStrokes: PStroke[] = [];
  private writings: Writing[] = [];
  private entries: CodexEntry[] = [];
  private specimens: SpecimenGlyph[] = [];
  private jinseiSpec: { jin: PStroke[]; sei: PStroke[]; tJin: number; tSei: number; dur: number } | null = null;
  private jinseiColBox: [number, number, number, number] = [0, 0, 0, 0];
  private onsets: number[] = [];
  private copies: number[] = [];
  private palimpsest: Palimpsest | null = null;
  private assembly: Assembly | null = null;
  private totalLen = 0;
  private base: { c: CanvasRenderingContext2D; done: boolean[] } | null = null;
  private vineL: { c: CanvasRenderingContext2D; sung: number } | null = null;

  override async init() {
    await super.init();
    this.warm([SCRIPT]);
    const L = this.ctx.lyrics;
    const look = this.ctx.params.look ?? 'assembly';
    if (look !== 'palimpsest' && look !== 'assembly') throw new Error(`new: look must be palimpsest|assembly, got ${String(look)}`);
    const useAssembly = look === 'assembly';

    const lineNums = [70, 71, 72, 73] as const;
    const lines = lineNums.map((i) => lineNo(L, i));
    const glyphs = lines.flatMap((l) => units(l).map((u) => u.glyph)).join('') + '神ぽい辞書';
    await loadScript(this.ctx.assets, glyphs.replace(/[「」"\s]/g, ''));

    // Title column on the far right: ぽい辞書 in the new script (red rubric)
    this.titleStrokes = [];
    [...'ぽい辞書'].forEach((ch, r) => {
      this.titleStrokes.push(...hand(ch, 1830 - TITLE_EM / 2, 128 + r * (TITLE_EM + 8), TITLE_EM, 1.25));
    });

    this.writings = [];
    this.entries = [];
    this.specimens = [];
    this.totalLen = 0;

    const addWriting = (strokes: PStroke[], t0: number, dur: number, em: number, red: boolean, hole: boolean) => {
      const spans = strokeSpans(strokes, em);
      const built = useAssembly && !hole ? assemble(strokes, spans, t0, dur, em) : null;
      const lockEnd = built ? Math.max(...built.lock, t0 + dur) : t0 + dur;
      for (const st of strokes) this.totalLen += st.len;
      this.writings.push({ strokes, spans, t0, dur, lockEnd, red, hole, em, built });
    };

    // Headword unit spans for the 4 entries:
    // Line 70: 別れ (units 6..8)
    // Line 71: 死ぬ (units 7..9), secondary 人生 (units 0..2)
    // Line 72: 患 (unit 7..8), secondary 理解 (units 3..5)
    // Line 73: 踊 (unit 4..5), secondary 無邪気 (units 0..3), climax 人生 (units 12..14)
    const headSpans: { red: [number, number]; sub?: [number, number] }[] = [
      { red: [6, 8] },
      { red: [7, 9], sub: [0, 2] },
      { red: [7, 8], sub: [3, 5] },
      { red: [4, 5], sub: [0, 3] },
    ];

    const sfPad = 28;
    const specEm = SPEC_FIELD.s - sfPad * 2;
    const specOx = SPEC_FIELD.x + sfPad, specOy = SPEC_FIELD.y + sfPad;

    lines.forEach((line, k) => {
      const us = units(line);
      const x = CODEX_XS[k]!;
      const top = k === 0 ? INI.y + INI.r + 28 : CODEX_TOP;
      const bx = x - 60;
      let y = top;
      let hySub = top;
      let hyRed = k === 0 ? top : top + (headSpans[k]!.sub ? (headSpans[k]!.sub![1] - headSpans[k]!.sub![0]) * (SUB_EM + 4) + 14 : 0);

      this.entries.push({ line, us, x, top });

      us.forEach((u, j) => {
        const isJinseiEnd = k === 3 && j >= 12;
        const dur = isJinseiEnd ? 0.14 : writeDur(u.start, u.end);
        const clean = [...u.glyph.replace(/[「」"\s]/g, '')];
        const allChars = [...u.glyph.replace(/["\s]/g, '')];

        // Specimen glyph entry for the Left Apparatus
        const redSpan = headSpans[k]!.red;
        const isRedHead = j >= redSpan[0] && j < redSpan[1];
        if (clean.length > 0 && !isJinseiEnd) {
          const ch = clean[0]!;
          const sk = constructed(ch);
          const spStrokes = placeHand(sk, specOx, specOy, specEm, 1.05);
          const spans = strokeSpans(spStrokes, specEm);
          this.specimens.push({
            ch, sk, strokes: spStrokes, spans, t0: u.start, dur, unitIdx: j, lineIdx: line.i, red: isRedHead,
            built: assemble(spStrokes, spans, u.start, dur, specEm),
          });
        }

        // Entry 0, Unit 0 (愛): written inside the Reborn Knotwork Initial
        if (k === 0 && j === 0) {
          const ai = hand('愛', INI.x - INI_EM / 2, INI.y - INI_EM / 2, INI_EM, 1);
          addWriting(ai, u.start, dur, INI_EM, false, false);
          return;
        }

        // Entry 3, Units 12..13 (人生, a cappella climax): cut straight through onto the RED substrate!
        if (isJinseiEnd) {
          const idx = j - 12; // 0 for 人, 1 for 生
          const jx = x - 28;
          const jy = 640 + idx * (JINSEI_COL_EM + 6);
          if (idx === 0) {
            this.jinseiColBox = [jx - JINSEI_COL_EM / 2 - 12, 628, JINSEI_COL_EM + 24, 2 * (JINSEI_COL_EM + 6) + 18];
          }
          const st = hand(clean[0]!, jx - JINSEI_COL_EM / 2, jy, JINSEI_COL_EM, 1.5);
          addWriting(st, u.start, dur, JINSEI_COL_EM, true, true);
          return;
        }

        // Regular sung line column
        const colStrokes: PStroke[] = [];
        for (const ch of allChars) {
          const sm = SMALL.includes(ch) ? LINE_EM * 0.18 : 0;
          colStrokes.push(...hand(ch, bx - LINE_EM / 2 + sm, y - sm * 0.5, LINE_EM, 1.6));
          y += advance(ch) * LINE_EM;
        }
        addWriting(colStrokes, u.start, dur, LINE_EM, false, false);

        // Secondary ink headword (人生 in L71, 理解 in L72, 無邪気 in L73)
        const sub = headSpans[k]!.sub;
        if (sub && j >= sub[0] && j < sub[1]) {
          const subStrokes: PStroke[] = [];
          for (const ch of clean) {
            subStrokes.push(...hand(ch, x - SUB_EM / 2, hySub, SUB_EM, 1.5));
            hySub += SUB_EM + 4;
          }
          addWriting(subStrokes, u.start, dur, SUB_EM, false, false);
        }

        // Primary RED rubricated headword (別れ, 死ぬ, 患, 踊)
        const red = headSpans[k]!.red;
        if (j >= red[0] && j < red[1]) {
          const headStrokes: PStroke[] = [];
          for (const ch of clean) {
            headStrokes.push(...hand(ch, x - HEAD_EM / 2, hyRed, HEAD_EM, 1.25));
            hyRed += HEAD_EM + 4;
          }
          addWriting(headStrokes, u.start, dur, HEAD_EM, true, false);
        }
      });
    });

    // Monumental 人生 inside the Left Specimen Box during the a cappella climax
    const l73Units = units(lines[3]!);
    const uJin = l73Units[12]!, uSei = l73Units[13]!;
    const jEm = 168;
    const jCx = SPEC_FIELD.x + SPEC_FIELD.s / 2;
    const jCy = SPEC_FIELD.y + SPEC_FIELD.s / 2;
    this.jinseiSpec = {
      jin: hand('人', jCx - jEm / 2, jCy - jEm + 6, jEm, 1.3),
      sei: hand('生', jCx - jEm / 2, jCy - 6, jEm, 1.3),
      tJin: uJin.start,
      tSei: uSei.start,
      dur: 0.14,
    };

    this.onsets = lines.flatMap((l) => units(l).map((u) => u.start));
    this.copies = copyTimes(L);
    if (look === 'palimpsest') this.palimpsest = new Palimpsest(L);
    else this.assembly = new Assembly();
    this.base = this.freshBase();
    this.vineL = null;
  }

  /** Build the static base canvas with the codex frame, title, knotwork initial, snail, and Specimen Box frame. */
  private freshBase() {
    const c = layer2D(W, H);
    this.drawStaticFolio(c);
    return { c, done: this.writings.map(() => false) };
  }

  private drawStaticFolio(c: CanvasRenderingContext2D) {
    // 1. Ruled codex text block on the right
    c.strokeStyle = tone(0.52);
    c.lineWidth = 1.6;
    c.strokeRect(CODEX_BLOCK[0] - 14, CODEX_TOP - 44, CODEX_BLOCK[1] - CODEX_BLOCK[0] + 28, CODEX_BOTTOM - CODEX_TOP + 70);
    c.lineWidth = 1;
    c.strokeRect(CODEX_BLOCK[0] - 8, CODEX_TOP - 38, CODEX_BLOCK[1] - CODEX_BLOCK[0] + 16, CODEX_BOTTOM - CODEX_TOP + 58);

    // Modernist ticks along the top and bottom codex rails
    c.strokeStyle = tone(0.72);
    c.lineWidth = 1;
    for (let x = CODEX_BLOCK[0]; x <= CODEX_BLOCK[1]; x += 24) {
      c.beginPath();
      c.moveTo(x, CODEX_TOP - 44);
      c.lineTo(x, CODEX_TOP - 38);
      c.moveTo(x, CODEX_BOTTOM + 20);
      c.lineTo(x, CODEX_BOTTOM + 26);
      c.stroke();
    }

    // Column rules for each of the 4 dictionary entries
    c.fillStyle = tone(0.82);
    for (const x of CODEX_XS) {
      for (const dx of [36, -90, -134]) {
        const y0 = x === CODEX_XS[0] && dx > -100 ? INI.y + INI.r + 10 : CODEX_TOP - 30;
        c.fillRect(x + dx, y0, 1, CODEX_BOTTOM + 12 - y0);
      }
    }

    // Entry numbers (01..04) at the head of each entry column
    c.fillStyle = tone(0.45);
    c.font = fnt(MONO, 11, 600);
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    CODEX_XS.forEach((x, k) => {
      if (k > 0) c.fillText(`0${k + 1}`, x - 26, CODEX_TOP - 14);
    });

    // 2. Title column on the far right: ぽい辞書 in RED new script
    c.fillStyle = RED;
    writeStrokes(c, this.titleStrokes, 1, TITLE_EM);

    // 3. Reborn Geometric Knotwork Initial: red registration dots + woven bands
    c.fillStyle = RED;
    const dots = roundSquare(INI.x, INI.y, INI.r + 6, 38, 9);
    for (const { p } of dots) {
      c.beginPath();
      c.arc(p[0], p[1], 1.8, 0, Math.PI * 2);
      c.fill();
    }
    drawKnot(c, this.knot);

    // 4. Snail at the root of the marginalia vine
    drawSnail(c, VINE_X - 68, CODEX_BOTTOM + 34);

    // 5. Left Specimen Apparatus static frame
    drawSpecimenBase(c);
  }

  draw(c: CanvasRenderingContext2D, f: Frame): SurfaceOpts {
    const t = f.t;
    c.fillStyle = PAPER;
    c.fillRect(0, 0, W, H);

    const gen = genAt(this.copies, this.ctx.lyrics, t);

    // Once the fresh sheet has completely covered the page and the seal punch has settled, draw pure Frame 0
    if (t >= PUNCH_T[1]) {
      seal(c, SEAL[0], SEAL[1], SEAL[2], 'hole');
      statusLine(c, gen, t);
      return { era: SCRIPT, gen };
    }

    if (this.palimpsest) this.scrape(c, t);

    // Update and draw cached base layer (static folio + finished non-hole writings)
    const done = this.writings.map((w) => !w.hole && t >= w.lockEnd);
    if (!this.base || this.base.done.some((d, i) => d && !done[i])) {
      this.base = this.freshBase();
    }
    const base = this.base;
    this.writings.forEach((w, i) => {
      if (!done[i] || base.done[i]) return;
      base.c.fillStyle = w.red ? RED : INK;
      writeStrokes(base.c, w.strokes, 1, w.em);
      base.done[i] = true;
    });
    c.drawImage(base.c.canvas, 0, 0, W, H);

    // Draw in-progress writings (and flying era shards in assembly mode)
    for (let i = 0; i < this.writings.length; i++) {
      const w = this.writings[i]!;
      if (done[i] || w.hole) continue;
      const color = w.red ? RED : INK;
      if (w.built && this.assembly) {
        this.assembly.draw(c, w.strokes, w.built, t, color);
      } else if (t >= w.t0) {
        c.fillStyle = color;
        writeStrokes(c, w.strokes, (t - w.t0) / w.dur, w.em);
      }
    }

    // Draw hole writings (a cappella 人生 in Entry 3 column: cuts box open onto RED substrate with 人生 in vellum!)
    const jSpec = this.jinseiSpec!;
    if (t >= jSpec.tJin) {
      const [bx, by, bw, bh] = this.jinseiColBox;
      const hasSei = t >= jSpec.tSei;
      const curH = hasSei ? bh : bh / 2;
      c.save();
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = '#000';
      c.fillRect(bx, by, bw, curH);
      c.restore();
      c.save();
      c.fillStyle = PAPER;
      for (const w of this.writings) {
        if (!w.hole || t < w.t0) continue;
        writeStrokes(c, w.strokes, (t - w.t0) / w.dur, w.em);
      }
      c.restore();
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.strokeRect(bx, by, bw, curH);
    }

    // Fraktur English glosses along each entry column
    for (const e of this.entries) {
      if (t < e.line.start - 0.05) continue;
      const gloss = e.line.written!.phrases.filter((ph) => ph.start <= t).map((ph) => ph.text).join(' ');
      if (!gloss) continue;
      c.save();
      c.translate(e.x - 110, e.top);
      c.rotate(Math.PI / 2);
      c.fillStyle = INK;
      c.font = fnt(GLOSS, 25);
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(gloss, 0, 0);
      c.restore();
    }

    // Marginalia vine (cached per sung syllable count)
    const sung = this.onsets.filter((s) => s <= t).length;
    if (this.vineL?.sung !== sung) {
      const v = (this.vineL ??= { c: layer2D(VINE_BOX[2], VINE_BOX[3]), sung: -1 });
      v.sung = sung;
      v.c.clearRect(0, 0, VINE_BOX[2], VINE_BOX[3]);
      v.c.save();
      v.c.translate(-VINE_BOX[0], -VINE_BOX[1]);
      drawMarginalia(v.c, this.vine, sung, this.onsets.length);
      v.c.restore();
    }
    c.drawImage(this.vineL.c.canvas, VINE_BOX[0], VINE_BOX[1], VINE_BOX[2], VINE_BOX[3]);

    // Live 4-Era Synthesis Specimen Box on the left
    let activeSpec: SpecimenGlyph | null = null;
    for (const sp of this.specimens) {
      if (sp.t0 <= t) activeSpec = sp;
      else break;
    }
    drawSpecimenLive(c, activeSpec, jSpec, t);

    // Underlying seal on the codex page: pulses on the beats while the codex is written; the last pump is 200.38 s,
    // the beats after it are the a cappella (voice only), so the seal rests
    const b = lastTime(this.ctx.audio.beats, Math.min(t, LAST_PUMP + 1e-3));
    const pulse = b === null ? 0 : 0.075 * Math.exp(-(t - b) / 0.09);
    seal(c, SEAL[0], SEAL[1], SEAL[2] * (1 + pulse), 'hole');

    // Fresh vellum sheet layover (`SHEET_T`: sweeps right-to-left over the completed codex)
    if (t >= SHEET_T[0]) {
      const u = clamp((t - SHEET_T[0]) / (SHEET_T[1] - SHEET_T[0]), 0, 1);
      const ease = u * u * (3 - 2 * u);
      const sheetX = Math.round(W * (1 - ease));

      // Cast shadow ahead of the leading paper edge
      if (sheetX > 0 && sheetX < W) {
        const grad = c.createLinearGradient(sheetX - 32, 0, sheetX, 0);
        grad.addColorStop(0, 'rgba(18, 15, 13, 0)');
        grad.addColorStop(1, 'rgba(18, 15, 13, 0.28)');
        c.fillStyle = grad;
        c.fillRect(Math.max(0, sheetX - 32), 0, 32, H);
      }

      // Fresh blank vellum sheet covering [sheetX, W]
      c.fillStyle = PAPER;
      c.fillRect(sheetX, 0, W - sheetX, H);

      // Crisp paper bevel edge at sheetX
      if (sheetX > 0 && sheetX < W) {
        c.strokeStyle = tone(0.45);
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(sheetX, 0);
        c.lineTo(sheetX, H);
        c.stroke();
      }

      // As the fresh sheet covers x = 330, the 神 seal punches through the fresh sheet onto red
      if (t >= PUNCH_T[0]) seal(c, SEAL[0], SEAL[1], SEAL[2], 'hole');
    }

    statusLine(c, gen, t);
    return { era: SCRIPT, gen };
  }

  /** The traces left under the strokes written by t (look: palimpsest). */
  private scrape(c: CanvasRenderingContext2D, t: number) {
    const written: Written[] = [];
    let done = 0, g = 0;
    for (const w of this.writings) {
      const p = (t - w.t0) / w.dur;
      w.strokes.forEach((st, k) => {
        const [a, b] = w.spans[k]!;
        const frac = Math.min(1, (p - a) / (b - a));
        if (frac > 0) {
          written.push({ st, frac, g });
          done += frac * st.len;
        }
        g++;
      });
    }
    this.palimpsest!.draw(c, written, done / Math.max(1, this.totalLen), LINE_EM);
  }
}
