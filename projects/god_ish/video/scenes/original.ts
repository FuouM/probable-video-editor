// Plate 0 · The original (manuscript). The page starts as the round 神 seal (the loop seam from
// plate 10). "Oh my God" cuts it open onto red; on the downbeat after it the page becomes the manuscript: lines 0-3
// as dictionary entries read right to left, each with a red headword (the quoted word), the sung line and an English
// gloss in Fraktur. 失敬 makes the first copy: the typebar of plate 1 strikes 失 and 敬 in Mincho over the brush,
// and each strike knocks a random half of the brush glyphs off the page (feed-plan.ts); the seam (feed.ts) flies
// them into the glyph tray of plate 1 as metal type. A pale impression stays where each one lay. Clip param `look`
// picks the page:
//   'illuminated' (default): a European illuminated page with a knotwork initial and marginalia, written by brush
//     (original-illuminated.ts)
//   'shakyo': a sutra-copying grid written by brush in stroke order (original-shakyo.ts)
import type { Frame } from '@pve/engine/scene';
import { H, W } from '@pve/engine/gl';
import { lineNo, units, type Line, type Lyrics, type WrittenUnit } from '@pve/engine/lyrics';
import { clamp, hash, lastTime } from '@pve/engine/util';
import { copyTimes, FRAKTUR, GLOSS, fnt, genAt, INK, MONO, PageScene, PAPER, RED, seal, SERIF, statusLine, tone, VOICE, type SurfaceOpts } from './_page';
import { MANUSCRIPT } from './_era_manuscript';
import { closeAt, drawCall, fitCall } from './voice-call';
import { loadScript } from './new-script';
import { SCRIPT } from './_era_script';
import { Shakyo } from './original-shakyo';
import { Illuminated } from './original-illuminated';
import { liftPatch, popTimes, type LiftPatch } from './feed-plan';

/** The reverse bell of the intro: it swells from bar 3.1 and stops on bar 4.1 (s). The page fades to red under it. */
const BELL = [4.3, 5.96] as const;
const CREDIT1_T = [0.86, 3.10] as const;
const CREDIT2_T = [3.247, 5.60] as const;

export interface Entry {
  line: Line;
  us: WrittenUnit[];
  /** The headword: the units it is made of. */
  head: [number, number];
  /** Reading in ruby beside the headword, or none. */
  ruby?: string;
}

const pageCache = new Map<string, Promise<{ entries: Entry[]; page: Shakyo | Illuminated }>>();

/** The manuscript page of plate 0 in look `look` (shakyo or illuminated), its brush loaded and cached across scenes. */
export function manuscriptPage(L: Lyrics, look: unknown, assets: string): Promise<{ entries: Entry[]; page: Shakyo | Illuminated }> {
  if (look !== 'shakyo' && look !== 'illuminated') throw new Error(`original: look must be shakyo|illuminated, got ${String(look)}`);
  const key = `${look}:${assets}`;
  let cached = pageCache.get(key);
  if (!cached) {
    cached = (async () => {
      const mk = (i: number, head: string, ruby?: string): Entry => {
        const line = lineNo(L, i);
        const us = units(line);
        const text = us.map((u) => u.glyph.replace(/[「」"]/g, ''));
        let from = -1;
        for (let k = 0; k < us.length && from < 0; k++) if (text.slice(k).join('').startsWith(head)) from = k;
        if (from < 0) throw new Error(`headword ${head} not in line ${i}`);
        let to = from, acc = '';
        while (acc.length < head.length) acc += text[to++];
        return { line, us, head: [from, to], ...(ruby ? { ruby } : {}) };
      };
      const entries = [mk(0, '別れ'), mk(1, '死ぬ'), mk(2, '意味深', 'いみしん'), mk(3, '単語集')];
      const glyphs = entries.flatMap((e) => e.us.map((u) => u.glyph)).join('') + '神ぽい辞書いみしん';
      await loadScript(assets, glyphs.replace(/[「」"\s…]/g, ''));
      return { entries, page: look === 'shakyo' ? new Shakyo(entries) : new Illuminated(entries) };
    })();
    pageCache.set(key, cached);
  }
  return cached;
}

export default class Original extends PageScene {
  private look: Shakyo | Illuminated | null = null;
  private copies: number[] = [];
  private seamEnd = 0;
  /** 失敬, typed over the brush: the onset and the glyph boxes of each strike. */
  private retype: { t: number; ch: string; box: [number, number, number] }[] = [];
  /** The patch that takes each popped ink glyph off the page (feed-plan.ts), and its pop time, by pop time. */
  private lifts: { p: LiftPatch; t: number }[] = [];
  /** Each sung unit with its glyph boxes (the ink spatter), and the beats of the plate (the pricks). */
  private sung: { t: number; boxes: [number, number, number][] }[] = [];
  private beats: number[] = [];

  override async init() {
    await super.init();
    this.warm([SCRIPT, MANUSCRIPT]);
    const L = this.ctx.lyrics;
    const { entries, page } = await manuscriptPage(L, this.ctx.params.look ?? 'illuminated', this.ctx.assets);
    this.look = page;
    this.copies = copyTimes(L);
    // the downbeat after "Oh my God" (bar 5): the manuscript begins
    const ohmygod = VOICE[0]!;
    const db = this.ctx.audio.downbeats.find((d) => d >= ohmygod.end);
    if (db === undefined) throw new Error('no downbeat after "Oh my God"');
    this.seamEnd = db;
    const pops = popTimes(L, page.ink);
    this.lifts = page.ink.flatMap((g, i) => (Number.isFinite(pops[i]!) ? [{ p: liftPatch(g), t: pops[i]! }] : [])).sort((a, b) => a.t - b.t);
    const last = entries[3]!;
    last.us.forEach((u, j) => {
      const chs = [...u.glyph].filter((ch) => '失敬'.includes(ch));
      const boxes = this.look!.cells.get(`${last.line.i}:${j}`) ?? [];
      chs.forEach((ch, i) => this.retype.push({ t: u.start, ch, box: boxes[i]! }));
    });
    if (this.retype.length !== 2 || this.retype.some((r) => !r.box)) throw new Error('original: 失敬 is not two boxed glyphs in line 3');
    for (const e of entries) e.us.forEach((u, j) => this.sung.push({ t: u.start, boxes: this.look!.cells.get(`${e.line.i}:${j}`) ?? [] }));
    this.beats = this.ctx.audio.beats.filter((b) => b >= this.ctx.start && b < this.ctx.end);
  }


  /**
   * The brush is wet: on each sung unit ink drops fly off its glyphs for 3 steps of 24 fps and fall. On each beat
   * the illuminator pricks a rosette of red dots into the margins, more as the page fills.
   */
  private wet(c: CanvasRenderingContext2D, t: number) {
    const ts = Math.floor(t * 24) / 24;
    for (const s of this.sung) {
      const dt = ts - s.t;
      if (dt < 0 || dt >= 3 / 24) continue;
      const step = Math.round(dt * 24);
      c.fillStyle = INK;
      s.boxes.forEach(([x, y, em], b) => {
        for (let i = 0; i < 7; i++) {
          const a = hash(s.t, b, i, 1) * Math.PI * 2, d = em * (0.55 + 0.5 * hash(s.t, b, i, 2)) * (1 + 0.6 * step);
          const r = Math.max(2.5, em * 0.07 * (1 - 0.3 * step) * (0.5 + hash(s.t, b, i, 3)));
          c.beginPath();
          c.arc(x + Math.cos(a) * d, y + Math.sin(a) * d + 6 * step * step, r, 0, Math.PI * 2);
          c.fill();
        }
      });
    }
    const beat = lastTime(this.beats, ts);
    if (beat === null || beat < this.seamEnd || ts - beat >= 3 / 24) return;
    const fill = Math.min(1, (beat - this.seamEnd) / (this.ctx.end - this.seamEnd));
    c.fillStyle = RED;
    for (let k = 0; k < 1 + Math.round(3 * fill); k++) {
      const x = 860 + hash(beat, k, 5) * 940, y = hash(beat, k, 6) < 0.5 ? 50 + hash(beat, k, 7) * 30 : H - 100 + hash(beat, k, 7) * 30;
      const r = 20 + 16 * (1 - (ts - beat) * 8);
      for (let i = 0; i < 8; i++) {
        c.beginPath();
        c.arc(x + Math.cos(i * 0.785) * r, y + Math.sin(i * 0.785) * r, 5, 0, Math.PI * 2);
        c.fill();
      }
      c.beginPath();
      c.arc(x, y, 7, 0, Math.PI * 2);
      c.fill();
    }
  }

  draw(c: CanvasRenderingContext2D, f: Frame): SurfaceOpts {
    const t = f.t;
    c.fillStyle = PAPER;
    c.fillRect(0, 0, W, H);
    const gen = genAt(this.copies, this.ctx.lyrics, t);
    const v = VOICE[0]!;

    // 1. Before "Oh my God" (t < v.start): intro seal, page fading to red under the bell
    if (t < v.start) {
      seal(c, 330, 800, 120, 'hole');
      this.credits(c, t);
      statusLine(c, gen, t);
      const x = clamp((t - BELL[0]) / (BELL[1] - BELL[0]), 0, 1);
      return { era: SCRIPT, gen, p: [x * x, 0, 0, 0] };
    }

    // 2. From "Oh my God" on: the background is already the manuscript page (the new sheet)
    this.look!.draw(c, t);

    // the glyphs the strikes of 失敬 knocked loose are in the air (feed.ts): off the page
    for (const l of this.lifts) {
      if (l.t > t) break;
      c.drawImage(l.p.cv, l.p.x, l.p.y, l.p.side, l.p.side);
    }
    this.typeOver(c, t);
    this.wet(c, t);

    // During "Oh my God" (6.76..7.47 s): cut the manuscript page open onto red in Fraktur
    if (t < v.end) {
      drawCall(c, v.text, closeAt(t, v.end), fitCall(c, v.text, 140, W - 140, 900));
    }

    // The manuscript seal lands on the downbeat after the call (seamEnd = 7.607 s)
    if (t >= this.seamEnd) {
      seal(c, 330, 800, 120, 'hole');
    }

    statusLine(c, gen, t);
    return { era: MANUSCRIPT, gen };
  }
  /** Intro credits (Note 8c3b): song & original MV at 0.86s (bar 1.1), visuals & idea at 3.25s (bar 2.2). */
  private credits(c: CanvasRenderingContext2D, t: number) {
    const card = t >= CREDIT1_T[0] && t < CREDIT1_T[1] ? 1 : t >= CREDIT2_T[0] && t < CREDIT2_T[1] ? 2 : 0;
    if (!card) return;

    const [tIn, tOut] = card === 1 ? CREDIT1_T : CREDIT2_T;
    const durIn = 0.24, durOut = 0.22;
    const uIn = clamp((t - tIn) / durIn, 0, 1);
    const uOut = clamp((t - (tOut - durOut)) / durOut, 0, 1);
    const alpha = uIn * (1 - uOut);
    if (alpha <= 0) return;

    // Codex colophon folio aligned with the manuscript text block (x = 920..1700, y = 260..620)
    const bx = 920, by = 260;

    c.save();
    c.globalAlpha = alpha;

    // Vertical rubric rule on the left of the colophon with double codex hairlines
    const ruleH = Math.round(320 * uIn);
    c.strokeStyle = tone(0.62);
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(bx, by);
    c.lineTo(bx, by + ruleH);
    c.moveTo(bx + 6, by);
    c.lineTo(bx + 6, by + ruleH);
    c.stroke();

    // Red rubric diamond & paragraph mark (pilcrow / fleuron rosette) at the head of the rule
    c.fillStyle = RED;
    c.beginPath();
    c.moveTo(bx + 3, by - 14);
    c.lineTo(bx + 10, by - 7);
    c.lineTo(bx + 3, by);
    c.lineTo(bx - 4, by - 7);
    c.closePath();
    c.fill();
    for (const dy of [-22, 10]) {
      c.beginPath();
      c.arc(bx + 3, by + dy, 2.2, 0, Math.PI * 2);
      c.fill();
    }

    const tx = bx + 36;
    c.textAlign = 'left';
    c.textBaseline = 'top';

    // Title headword: 神っぽいな in Mincho + God-ish in Fraktur rubric
    c.fillStyle = INK;
    c.font = fnt(SERIF, 62, 700);
    c.fillText('神っぽいな', tx, by - 6);
    const jw = c.measureText('神っぽいな').width;
    c.fillStyle = RED;
    c.font = fnt(FRAKTUR, 44);
    c.fillText('God-ish', tx + jw + 26, by + 10);

    // Scored horizontal codex line under the title
    c.strokeStyle = tone(0.76);
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(tx, by + 76);
    c.lineTo(tx + Math.round(640 * uIn), by + 76);
    c.stroke();

    const ROWS = card === 1
      ? [
          ['曲・詞', 'Music & Lyrics', 'ピノキオピー', 'PinocchioP'],
          ['唄', 'Vocals', '初音ミク', 'Hatsune Miku'],
          ['原曲映像', 'Original MV', 'ピノキオピー', 'PinocchioP'],
        ] as const
      : [
          ['映像', 'Visuals', 'Claude Opus 5.5', ''],
          ['企画', 'The Idea Guy', 'FM', ''],
        ] as const;

    const rowY = by + 102;
    ROWS.forEach(([jpRole, enRole, nameJp, nameEn], i) => {
      const y = rowY + i * 68;
      // Red rubric dot before each entry
      c.fillStyle = RED;
      c.beginPath();
      c.arc(tx + 4, y + 16, 3, 0, Math.PI * 2);
      c.fill();

      // Rubric role in red Mincho + Fraktur gloss below
      c.fillStyle = RED;
      c.font = fnt(SERIF, 20, 700);
      c.fillText(jpRole, tx + 18, y + 2);
      c.fillStyle = tone(0.42);
      c.font = fnt(GLOSS, 19);
      c.fillText(enRole, tx + 18, y + 28);

      // Credit name in crisp ink Mincho
      c.fillStyle = INK;
      c.font = fnt(SERIF, 30, 600);
      c.fillText(nameJp, tx + 190, y + 4);
      if (nameEn) {
        const nw = c.measureText(nameJp).width;
        c.fillStyle = tone(0.36);
        c.font = fnt(SERIF, 22, 400);
        c.fillText(nameEn, tx + 190 + nw + 18, y + 11);
      }
    });

    c.restore();
  }

  /**
   * 失敬 typed over the brush: on its onset the typebar comes up into the cell (2 steps of 24 fps) and leaves the
   * Mincho face, struck heavy, a hair off the brush glyph. The ribbon leaves a faint gray box around it.
   */
  private typeOver(c: CanvasRenderingContext2D, t: number) {
    for (const [i, r] of this.retype.entries()) {
      if (t < r.t) continue;
      const [x, y, em] = r.box;
      const dx = (hash(i, 7) - 0.5) * 6, dy = (hash(i, 8) - 0.5) * 6;
      c.fillStyle = tone(0.9);
      c.globalAlpha = 0.4;
      c.fillRect(x - em * 0.62 + dx, y - em * 0.62 + dy, em * 1.24, em * 1.24);
      c.globalAlpha = 1;
      c.fillStyle = INK;
      c.font = fnt(SERIF, Math.round(em * 1.05), 600);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(r.ch, x + dx, y + dy);
    }
  }
}
