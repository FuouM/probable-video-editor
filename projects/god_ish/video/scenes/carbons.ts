// Plate 1 · Carbons (和文タイプ). A Japanese typewriter seen from above: on the left the glyph tray, where the
// selector jumps to the face of each sung glyph of lines 4-11 and strikes it on its onset; on the right the
// typed sheet and two carbons beside it. Each strike prints on every sheet of the stack, each carbon fainter,
// softer and further off register: the carbons are the generation loss. "風" types in quotes. Line 7
// (ぽいじゃん): its glyphs turn to one angle, a step per onset. Line 11 (神っぽいな): a seal cuts through the stack.
// The carbons take the drums, the original does not (treatment, "Motion (v4)"). The snare is silent here.
//   kick  a cluster of WRONG glyphs strikes the carbons: faces of the tray next to the sung one (the parrot in
//         metal), their slots in the tray show empty for the strike. They hit oversize and off their place and
//         snap down, then smear and fade within 0.5-1 s; some stay as noise, more with each generation.
//   hat   single glyphs of the carbons (typed or wrong) pop in the carbon dye for a step, now and then in red.
// The four とぅとぅる lines escalate it: line 4 calm, each adds a step, full from line 7.
import type { Frame } from '@pve/engine/scene';
import { H, SCALE, scaleContext2D, W } from '@pve/engine/gl';
import { lineNo, unitAt, units } from '@pve/engine/lyrics';
import { hash, stepN } from '@pve/engine/util';
import { changesOf, copyTimes, DYE, fnt, genAt, PageScene, RED, rebate, SERIF, tone, type SurfaceOpts } from './_page';
import { TYPEWRITER } from './_era_typewriter';
import { Tray, TRAY_BOX as TRAY, type TrayCell } from './carbons-tray';
import { G, LINES, P, Sheets, SH, SR, STACK, SW, TOP } from './carbons-sheet';

const SX = 510; // the original; the carbons follow to the right
const SY = 150;
const GAP = 20;
/** Frames of the strike: the bar is up at the platen and its slot in the tray shows empty. */
const STRIKE = 1 / 12;
/** Top left of sheet k on the page (0 the original, then the carbons). */
export const sheetAt = (k: number): [number, number] => [SX + k * (SW + GAP), SY];
/** The lines that escalate the reactivity, a step each. */
const ESCALATE = [4, 5, 6, 7];
/** The impact of a wrong glyph: s from the strike to its place. */
const HIT = 0.09;
/** A pop: s (2 steps of 24 fps, so it shows on at least one). */
const POP = 2 / 24;
/** Rows of the sheet a wrong glyph can land on. */
const ROWS = Math.floor((SH - TOP - G) / G);
/** The pad of a carbon's noise scratch around the sheet: room for its slip, px. */
const NPAD = 16;

/** A wrong glyph struck onto carbon k. */
interface Wrong {
  k: number; ch: string; t: number; x: number; y: number; a: number; sc: number;
  /** Impact offset px (snaps to 0), smear px over the life, life s, rest alpha (0: it goes), its tray slot. */
  ix: number; iy: number; mx: number; my: number; life: number; rest: number; slot: TrayCell;
}
/** A colour pop on carbon k: a typed glyph (strike i, cell j) or wrong glyph w. */
interface Pop { t: number; k: number; red: boolean; i: number; j: number; w: Wrong | null }

type Kind = 'gray' | 'hit' | 'dye' | 'red';

export default class Carbons extends PageScene {
  private copies: number[] = [];
  private esc: number[] = [];
  private tray!: Tray;
  private sheets!: Sheets;
  /** The tray face of each strike, in strike order. */
  private faces: TrayCell[] = [];
  private home!: TrayCell;
  private wrongs: Wrong[] = [];
  private pops: Pop[] = [];
  /** Glyph sprites by glyph, carbon and kind, all made at init. */
  private sprites = new Map<string, HTMLCanvasElement>();
  private readonly Z = Math.ceil(G * 1.7);
  /** The wrong glyphs that stay, in the order they settle (t + life). */
  private kept: Wrong[] = [];
  /** Per carbon: the settled wrong glyphs, sheet px (see `noise`), and how many of `kept` it holds. */
  private noiseC: (CanvasRenderingContext2D | null)[] = [null, null, null];
  private noiseN = [0, 0, 0];

  override async init() {
    await super.init();
    this.warm([TYPEWRITER]);
    const L = this.ctx.lyrics;
    this.copies = copyTimes(L);
    this.esc = ESCALATE.map((i) => lineNo(L, i).start);
    this.tray = new Tray(L, TRAY);
    this.sheets = new Sheets(L);
    this.faces = this.sheets.strikes.map((s) => this.tray.cellOf(s.glyph));
    this.home = this.tray.cellOf('ぁ');
    this.schedule();
    this.changes = changesOf(L, LINES, [
      ...this.copies, ...this.sheets.strikes.map((s) => s.t + STRIKE), ...this.kept.map((w) => w.t + w.life),
    ]);
    // warm the first page of carbons at init so the 3 sheets, tray and still canvas do not allocate mid-playback
    this.draw(this.layer.ctx, {
      t: this.ctx.start, ft: this.ctx.start, dt: 1 / 60, lt: 0, p: 0, start: this.ctx.start, end: this.ctx.end,
      seeked: true, preroll: false, beat: 0, bar: 0, beatPhase: 0, barPhase: 0,
      a: this.ctx.audio.sample(this.ctx.start), under: null, tin: 1, tout: 0,
    });
  }

  /** Escalation 0..1 at t: a quarter per とぅとぅる line begun. */
  private level(t: number): number {
    return this.esc.filter((s) => s <= t + 0.03).length / this.esc.length;
  }

  /** The faces of the tray around `cell`, within r faces (not the cell itself). */
  private near(cell: TrayCell, r: number, faces: [string, TrayCell][]): [string, TrayCell][] {
    const d = this.tray.s * (r + 0.5);
    return faces.filter(([, c]) => c !== cell && Math.abs(c.x - cell.x) < d && Math.abs(c.y - cell.y) < d);
  }

  /** The wrong glyphs on the kicks and the pops on the hats, all seeded, and their sprites. */
  private schedule() {
    const L = this.ctx.lyrics;
    const { start, end } = this.ctx;
    const sh = this.sheets;
    // the tray read back: every glyph that has a face, and where
    const cand = new Set<string>();
    for (let u = 0x3000; u < 0x3100; u++) cand.add(String.fromCharCode(u));
    for (const l of L.lines) for (const u of units(l)) for (const ch of u.glyph) cand.add(ch);
    const faces: [string, TrayCell][] = [];
    for (const ch of cand) {
      try { faces.push([ch, this.tray.cellOf(ch)]); } catch { /* no face */ }
    }
    const kami = sh.kami();

    for (const [te] of this.ctx.audio.events('kick', start, end + 0.5)) {
      const s = this.level(te);
      if (s === 0) continue;
      const gen = genAt(this.copies, L, te);
      const n = sh.struckBy(te);
      const last = n > 0 ? sh.strikes[n - 1]! : null;
      const sel = last ? this.faces[n - 1]! : this.home;
      const pool = this.near(sel, s < 0.5 ? 1 : 2, faces);
      for (const k of [1, 2]) {
        if (k === 1 && s < 0.5) continue; // line 4: the far carbon only
        const hk = (m: number) => hash(te, k, m, 41);
        const count = Math.max(3, Math.round((k === 2 ? 3 : 2) + 5 * s * (0.55 + 0.45 * hk(1))));
        // the cluster: at the sung strike, or anywhere on the sheet
        let cx: number, cy: number;
        if (last && hk(2) < 0.5) {
          const cl = last.cells[last.cells.length - 1]!;
          cx = cl.x - P * 0.5 * (hk(3) < 0.5 ? -1 : 1);
          cy = cl.y + G * Math.round(hk(4) * 4 - 1);
        } else {
          const line = LINES[Math.floor(hk(5) * LINES.length)]!;
          cx = sh.colX(line) + (hk(6) < 0.4 ? P * 0.5 : 0);
          cy = TOP + G / 2 + G * Math.floor(hk(7) * ROWS);
        }
        for (let g = 0; g < count; g++) {
          const h = (m: number) => hash(te, k, g, m, 43);
          const x = Math.min(SW - G, Math.max(G, cx + P * 0.5 * Math.round(h(1) * 4 - 2) + (h(2) - 0.5) * (4 + 10 * s)));
          const y = Math.min(SH - G, Math.max(G, cy + G * Math.round(h(3) * 4 - 2) + (h(4) - 0.5) * (4 + 10 * s)));
          // the seal cuts through 神: no wrong glyph over its hole
          if (Math.hypot(x - kami.x, y - kami.y) < SR + G * 0.6 || !pool.length) continue;
          const [ch, slot] = pool[Math.floor(h(5) * pool.length)]!;
          const ang = h(6) * Math.PI * 2;
          const keep = h(7) < Math.min(0.5, 0.045 * gen * (k === 2 ? 1.4 : 0.8));
          this.wrongs.push({
            k, ch, slot, t: te + Math.floor(h(8) * 3) / 60, x, y,
            a: (h(9) - 0.5) * (0.08 + 0.4 * s), sc: 0.88 + 0.3 * h(10),
            ix: Math.cos(ang) * (6 + 10 * s), iy: Math.sin(ang) * (6 + 10 * s),
            mx: (h(11) < 0.5 ? -1 : 1) * (3 + 7 * h(12)), my: (h(13) - 0.5) * 4,
            life: 0.5 + 0.5 * h(14), rest: keep ? 0.45 + 0.35 * h(15) : 0,
          });
        }
      }
    }
    this.wrongs.sort((a, b) => a.t - b.t);
    this.kept = this.wrongs.filter((w) => w.rest > 0).sort((a, b) => a.t + a.life - b.t - b.life);

    for (const [th, str] of this.ctx.audio.events('hat', start, end + 0.5)) {
      const s = this.level(th);
      if (s === 0 || str < 0.25 || hash(th, 51) > 0.3 + 0.7 * s) continue;
      const n = sh.struckBy(th);
      const count = 1 + Math.floor(hash(th, 52) * (1 + 2.6 * s));
      for (let g = 0; g < count; g++) {
        const h = (m: number) => hash(th, g, m, 53);
        const k = h(1) < 0.4 ? 1 : 2;
        const red = h(2) < 0.03 + 0.07 * s;
        // a wrong glyph in sight, or a typed one
        const alive = this.wrongs.filter((w) => w.k === k && w.t <= th && (w.rest > 0 || th < w.t + w.life));
        if (alive.length && h(3) < 0.45) {
          this.pops.push({ t: th, k, red, i: -1, j: 0, w: alive[Math.floor(h(4) * alive.length)]! });
        } else if (n > 0) {
          const i = Math.floor(h(5) * n);
          this.pops.push({ t: th, k, red, i, j: Math.floor(h(6) * sh.strikes[i]!.cells.length), w: null });
        }
      }
    }

    // the sprites, made now (a first draw in playback would stall)
    for (const w of this.wrongs) {
      this.sprite(w.ch, w.k, 'gray');
      this.sprite(w.ch, w.k, 'hit');
    }
    for (const p of this.pops) {
      const ch = p.w ? p.w.ch : sh.strikes[p.i]!.cells[p.j]!.ch;
      this.sprite(ch, p.k, p.red ? 'red' : 'dye');
    }
  }

  /** A glyph as carbon k prints it, in a Z px square: gray, the impact (dark and spread), dye or red. */
  private sprite(ch: string, k: number, kind: Kind): HTMLCanvasElement {
    const key = `${ch}|${k}|${kind}`;
    let cv = this.sprites.get(key);
    if (cv) return cv;
    const Z = this.Z;
    cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(Z * SCALE);
    const c = scaleContext2D(cv.getContext('2d', { willReadFrequently: true })!, SCALE);
    const st = STACK[k]!;
    // a wrong glyph is a fresh strike: a little darker than the carbon's own
    const fill = kind === 'gray' ? tone(st.tone - 0.12) : kind === 'hit' ? tone(0.14) : kind === 'dye' ? DYE : RED;
    c.filter = `blur(${st.blur * SCALE}px)`;
    c.font = fnt(SERIF, G, kind === 'hit' ? 600 : 400);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = fill;
    c.fillText(ch, Z / 2, Z / 2);
    if (kind === 'hit') {
      // the ink spreads under the blow
      c.strokeStyle = fill;
      c.lineWidth = 1.3;
      c.lineJoin = 'round';
      c.strokeText(ch, Z / 2, Z / 2);
    }
    this.sprites.set(key, cv);
    return cv;
  }

  /** Sprite at (x, y) sheet px, turned a, scaled sc; (ox, oy) offset in the turned cell. */
  private put(c: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, a: number, sc: number, ox = 0, oy = 0) {
    const z = this.Z * sc;
    // turned there and back (cheaper than save/restore)
    c.translate(x, y);
    c.rotate(a);
    c.drawImage(img, ox * sc - z / 2, oy * sc - z / 2, z, z);
    c.rotate(-a);
    c.translate(-x, -y);
  }

  draw(c: CanvasRenderingContext2D, f: Frame): SurfaceOpts {
    const t = f.t;
    const L = this.ctx.lyrics;
    // the desk
    c.fillStyle = tone(0.93);
    c.fillRect(0, 0, W, H);

    // the tray and the selector over the face of the last strike
    const k = this.sheets.struckBy(t) - 1;
    const struck = k >= 0 && t - this.sheets.strikes[k]!.t < STRIKE;
    this.tray.draw(c, k >= 0 ? this.faces[k]! : this.home, struck);

    // the stack, laid out side by side: the original and its carbons
    STACK.forEach((_, s) => {
      const [x, y] = sheetAt(s);
      this.sheets.draw(c, L, s, x, y, t);
      if (s > 0) this.noise(c, s, t);
      rebate(c, s === 0 ? 'ORIGINAL' : `CARBON ${s}`, x, y + SH + 22);
    });
    this.sheets.gloss(c, ...sheetAt(0), t);
    this.sheets.seals(c, sheetAt, t);

    const gen = genAt(this.copies, L, t);
    rebate(c, `GEN ${String(gen).padStart(2, '0')}`, TRAY[0], SY + SH + 22);
    if (k >= 0) {
      const us = units(lineNo(L, this.sheets.strikes[k]!.line));
      rebate(c, `LINE ${String(this.sheets.strikes[k]!.line).padStart(2, '0')}  ${unitAt(us, t) + 1}/${us.length}`, TRAY[0], SY + SH + 42);
    }
    return { era: TYPEWRITER, gen };
  }

  /**
   * The wrong glyphs settled on carbon k by t, as noise over the sheet (darken). They are set once, slipped, on a
   * scratch in the order they settle (a seek back sets them again); the scratch goes on the page 1:1.
   */
  private noise(c: CanvasRenderingContext2D, k: number, t: number) {
    let n = 0;
    while (n < this.kept.length && this.kept[n]!.t + this.kept[n]!.life <= t) n++;
    let s = this.noiseC[k];
    if (!s) {
      const cv = document.createElement('canvas');
      cv.width = Math.round((SW + 2 * NPAD) * SCALE);
      cv.height = Math.round((SH + 2 * NPAD) * SCALE);
      s = this.noiseC[k] = scaleContext2D(cv.getContext('2d', { willReadFrequently: true })!, SCALE);
      this.sheets.slip(s, k, NPAD, NPAD);
    }
    if (n < this.noiseN[k]!) {
      s.save();
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.clearRect(0, 0, s.canvas.width, s.canvas.height);
      s.restore();
      this.noiseN[k] = 0;
    }
    for (let i = this.noiseN[k]!; i < n; i++) {
      const w = this.kept[i]!;
      if (w.k !== k) continue;
      s.globalAlpha = w.rest;
      this.put(s, this.sprite(w.ch, k, 'gray'), w.x, w.y, w.a, w.sc);
    }
    s.globalAlpha = 1;
    this.noiseN[k] = n;
    if (!this.kept.some((w, i) => i < n && w.k === k)) return;
    const [sx, sy] = sheetAt(k);
    c.globalCompositeOperation = 'darken';
    c.drawImage(s.canvas, sx - NPAD, sy - NPAD, SW + 2 * NPAD, SH + 2 * NPAD);
    c.globalCompositeOperation = 'source-over';
  }

  /** Every step: the wrong glyphs, the pops, the empty slots of the wrong faces, the running time. */
  protected override live(c: CanvasRenderingContext2D, f: Frame) {
    const t = stepN(f.t, 24) / 24 + 1e-3;
    const L = this.ctx.lyrics;
    const s = this.tray.s;
    c.save();
    // the slots of the wrong faces show empty while they strike
    c.fillStyle = tone(0);
    for (const w of this.wrongs) {
      if (w.t > t) break;
      if (t - w.t < STRIKE) c.fillRect(w.slot.x - s / 2 + 2, w.slot.y - s / 2 + 2, s - 4, s - 4);
    }
    for (const k of [1, 2]) {
      c.save();
      this.sheets.slip(c, k, ...sheetAt(k));
      // carbon ink only darkens the sheet (a wrong glyph over a typed one does not wash it out)
      c.globalCompositeOperation = 'darken';
      for (const w of this.wrongs) {
        if (w.t > t) break;
        if (w.k !== k) continue;
        const age = t - w.t;
        if (age < HIT) {
          // the blow: oversize, off its place, dark and spread; it snaps down
          const u = 1 - age / HIT;
          this.put(c, this.sprite(w.ch, k, 'hit'), w.x + w.ix * u, w.y + w.iy * u, w.a * (1 + u), w.sc * (1 + 0.55 * u * u));
          continue;
        }
        const u = Math.min(1, (age - HIT) / (w.life - HIT));
        // settled: it is on the page (see `noise`)
        if (u >= 1) continue;
        const img = this.sprite(w.ch, k, 'gray');
        c.globalAlpha = w.rest + (1 - w.rest) * (1 - u);
        this.put(c, img, w.x, w.y, w.a, w.sc);
        // the smear: the sheet dragged under the platen
        c.globalAlpha = 0.55 * (1 - u);
        this.put(c, img, w.x + w.mx * u, w.y + w.my * u, w.a, w.sc);
        c.globalAlpha = 1;
      }
      c.globalCompositeOperation = 'source-over';
      for (const p of this.pops) {
        if (p.t > t) break;
        if (p.k !== k || t - p.t >= POP) continue;
        if (p.w) {
          const w = p.w;
          this.put(c, this.sprite(w.ch, k, p.red ? 'red' : 'dye'), w.x, w.y, w.a, w.sc * 1.15);
        } else {
          const cl = this.sheets.place(L, k, p.i, t)[p.j]!;
          this.put(c, this.sprite(cl.ch, k, p.red ? 'red' : 'dye'), cl.x, cl.y, cl.a, 1.15, cl.ox, cl.oy);
        }
      }
      c.restore();
    }
    c.restore();
    const gen = genAt(this.copies, this.ctx.lyrics, f.t);
    rebate(c, `${f.t.toFixed(2)} s`, W - 50, SY + SH + 22, 'right');
  }
}
