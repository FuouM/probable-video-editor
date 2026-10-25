// ceiling (Verse 2): the blue plate. A wireframe ceiling seen from below turns slowly (15 fps). Tiles carry
// words of the song in the ceiling's perspective; they change like a board of signs: on every downbeat a
// new random handful of the tiles in view take words (the words jump to other tiles, nothing flips), and
// when a word of the line names a thing, a tile in view switches to its pictogram (an eye on "looked", a
// clock on "moment", a house on "home"). The sung line runs along the bottom with a hard shadow; the next
// line slides in and pushes the one before it out to the left; when a syllable is done its bricks let go
// and drop like stepped Tetris pieces, a cell per tick at 12 fps. From "reason" the line stands on black
// boxes so it reads over the falling ceiling. From "ceiling" the tiles come loose one per eighth, tilt and
// fall at the camera, over the bars; the last ones keep falling into dust (the Over transition `tiles`).
import type { Frame } from '@pve/engine/scene';
import { H, W } from '@pve/engine/gl';
import { ease, prog } from '@pve/engine/util';
import { BAR, BEAT, BEAT0, INK, PAPER, PrintScene, brickRect, drawBars, hashI, lastBefore, readout, stepT, sylAt, sylLine, sylOfChar, type PrintOpts, type SylLine } from './_kit';
import { CeilingFall, WORD_SYMBOL, quad, tileSymbol, tileWord } from './_ceiling';
import { ceilingGrid, ceilingProj, headOffset } from './_motifs';
import { mark } from '@pve/engine/marks';

const CELL = 7;
const YTOP = 780;
const HEAD = 1180;
const CX = W / 2, CY = H / 2 + 140, PITCH = 0.5;
const WORD_TILES = 14; // tiles that carry a word in each bar

/** The ceiling tiles that could be in view: (tx, tz) of each. */
const CANDIDATES: [number, number][] = [];
for (let tz = -12; tz <= 14; tz++) for (let tx = -16; tx <= 15; tx++) CANDIDATES.push([tx, tz]);

/** A pictogram tile: it switches to the symbol when its word is sung, on a tile in view. */
interface SymTile { at: number; sym: string; n: number }

export default class Ceiling extends PrintScene {
  private lines: SylLine[] = [];
  /** song time of "reason": from there the line stands on black boxes */
  private tReason = Infinity;
  private fall!: CeilingFall;
  private syms: SymTile[] = [];
  private drumHits: number[] = [];
  private lineX: number[] = [];
  private allSyls: { li: number; k: number; text: string; start: number; end: number; tapeX: number; tapeXEnd: number }[] = [];

  override init() {
    const ly = this.ctx.lyrics;
    this.lines = ly.linesIn(this.ctx.start, this.ctx.end).map((l) => sylLine(ly, l));
    this.fall = new CeilingFall(ly, this.ctx.start, this.ctx.end);
    this.lines.forEach((sl) => sl.line.words.forEach((w, wi) => {
      const sym = WORD_SYMBOL[w.w.toLowerCase().replace(/[^a-z]/g, '')];
      if (sym) this.syms.push({ at: w.start, sym, n: sl.line.i * 17 + wi });
    }));
    const reason = this.lines.flatMap((sl) => sl.line.words).find((w) => w.w.toLowerCase() === 'reason');
    this.tReason = reason?.start ?? Infinity;

    // detect drum hits from the drums stem envelope
    this.drumHits = [];
    const step = 0.02;
    let prev = this.ctx.audio.env('drums', this.ctx.start);
    for (let t = this.ctx.start + step; t <= this.ctx.end; t += step) {
      const cur = this.ctx.audio.env('drums', t);
      const d = cur - prev;
      if (d > 0.04 && cur > 0.15) {
        this.drumHits.push(t);
        t += 0.10;
      }
      prev = cur;
    }

    // precompute unified multi-line text tape offsets
    this.lineX = [0];
    for (let i = 0; i < this.lines.length - 1; i++) {
      this.lineX.push(this.lineX[i]! + (this.lines[i]!.bt.cols + 8) * CELL);
    }
    this.allSyls = [];
    for (let li = 0; li < this.lines.length; li++) {
      const sl = this.lines[li]!;
      for (let k = 0; k < sl.syls.length; k++) {
        const s = sl.syls[k]!;
        const [a, b] = sl.ranges[k]!;
        const xa = sl.bt.charX[a]!;
        const xb = sl.bt.charX[b - 1]! + sl.bt.charW[b - 1]!;
        this.allSyls.push({
          li, k, text: s.text, start: s.start, end: s.end,
          tapeX: this.lineX[li]! + xa * CELL,
          tapeXEnd: this.lineX[li]! + xb * CELL,
        });
      }
    }
  }

  /** The tiles in view (centre inside the box, above the line) all through [ta, tb], not yet fallen at tb. */
  private inView(ta: number, tb: number): [number, number][] {
    const pa = ceilingProj(ta, CX, CY, PITCH), pb = ceilingProj(tb, CX, CY, PITCH);
    const ok = (q: [number, number, number]) => q[2] >= 0.6 && q[0] > 90 && q[0] < W - 90 && q[1] > BAR + 50 && q[1] < YTOP - 30;
    return CANDIDATES.filter(([tx, tz]) => ok(pa(tx + 0.5, tz + 0.5)) && ok(pb(tx + 0.5, tz + 0.5)) && !this.fall.gone(tx, tz, tb));
  }

  /** `count` distinct tiles from `pool`, in an order hashed from `seed`. */
  private pick(pool: [number, number][], seed: number, count: number) {
    return pool
      .map((p, i) => ({ p, h: hashI(p[0] * 31 + p[1], seed, 41) + i * 1e-9 }))
      .sort((a, b) => a.h - b.h)
      .slice(0, count)
      .map((x) => x.p);
  }

  private hitAt(t: number): number {
    let count = 0;
    for (let i = 0; i < this.drumHits.length; i++) {
      if (this.drumHits[i]! <= t) count = i + 1;
      else break;
    }
    return count;
  }

  private getTapeHead(t: number): number {
    const syls = this.allSyls;
    if (t <= syls[0]!.start) return syls[0]!.tapeX;
    const last = syls[syls.length - 1]!;
    if (t >= last.end) return last.tapeXEnd;

    for (let i = 0; i < syls.length; i++) {
      const cur = syls[i]!;
      const next = syls[i + 1];
      if (!next || t < next.start) {
        const targetX = next ? next.tapeX : cur.tapeXEnd;
        const gap = next ? next.start - cur.end : 0;
        if (gap > 0.4) {
          if (t < cur.end) {
            const p = prog(t, cur.start, cur.end, ease.outCubic);
            return cur.tapeX + (cur.tapeXEnd - cur.tapeX) * p;
          } else {
            const slideStart = Math.max(cur.end, next.start - 0.5);
            const p = prog(t, slideStart, next.start, ease.inOutCubic);
            return cur.tapeXEnd + (next.tapeX - cur.tapeXEnd) * p;
          }
        } else {
          const tEnd = next ? next.start : cur.end;
          const p = prog(t, cur.start, tEnd, ease.outCubic);
          return cur.tapeX + (targetX - cur.tapeX) * p;
        }
      }
    }
    return last.tapeXEnd;
  }

  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    const t = f.t;
    const tc = Math.max(this.ctx.start, stepT(t, 15));
    const proj = ceilingGrid(c, tc, W / 2, H / 2 + 140, 0.5, 1.8);
    const fall = this.fall;
    const flat = () => 0;
    const bar = Math.floor((tc - BEAT0 + 1e-4) / (4 * BEAT));

    // the holes the fallen tiles leave: dark
    c.fillStyle = INK;
    for (const fl of fall.tiles) if (tc >= fl.at) quad(c, proj, fl.tx, fl.tz, 0, 0, 1, 1, flat);

    // word tiles: on every drum hit, words choose a new tile in view
    const hits = this.hitAt(tc);
    const hitT = hits > 0 ? this.drumHits[hits - 1]! : this.ctx.start;
    const nextHitT = hits < this.drumHits.length ? this.drumHits[hits]! : this.ctx.end;
    const pool = this.inView(hitT, nextHitT);
    const used = new Set<string>();
    this.pick(pool, hits, WORD_TILES).forEach(([tx, tz], i) => {
      if (fall.gone(tx, tz, tc)) return;
      used.add(`${tx},${tz}`);
      const word = fall.words[Math.floor(hashI(hits, i, 7) * fall.words.length)]!;
      tileWord(c, proj, tx, tz, word, hashI(hits, i, 9) < 0.3, flat);
    });

    // pictograms: when a word names a thing, it chooses a tile in view and jumps to a new tile on drum hits
    for (const s of this.syms) {
      const a = tc - s.at;
      if (a < 0 || a > 4 * BEAT) continue;
      const [tile] = this.pick(pool.filter(([x, z]) => !used.has(`${x},${z}`)), s.n * 73 + hits, 1);
      if (!tile || fall.gone(tile[0], tile[1], tc)) continue;
      used.add(`${tile[0]},${tile[1]}`);
      tileSymbol(c, proj, tile[0], tile[1], s.sym);
    }
    drawBars(c);
    // readouts on the top bar (the lyric falls through the bottom one), under the tiles that fall over it
    let down = 0;
    for (const fl of fall.tiles) if (tc >= fl.at) down++;
    readout(c, `VERSE 2 · CEILING YAW ${((tc * 0.08 * 180) / Math.PI).toFixed(1)}°`, 'left', true);
    readout(c, `TILES DOWN ${String(down).padStart(3, '0')}`, 'right', true);
    // falling tiles: down at the camera, tilting, out over the bars
    fall.draw(c, tc);

    // the lines and their tears: the text tape slides in continuously from the right, each line following
    // the previous one with zero hitch or jerk
    const tick = stepT(t, 12);
    const tl = stepT(t, 24);
    const cur = lastBefore(this.lines, (l) => l.line.start <= tl);
    const k = sylAt(cur, tl);
    const tapeHead = this.getTapeHead(tl);
    const xs = this.lineX.map((lx) => HEAD - tapeHead + lx);
    const ci = this.lines.indexOf(cur);
    const drawn: { x: number; y: number; len: number; box: boolean }[] = [];
    this.lines.forEach((sl, li) => {
      if (li > ci) return;
      const next = this.lines[li + 1];
      const live = sl === cur;
      const ks = live ? k : sl.syls.length - 1;
      if (ks < 0) return;
      const x0 = xs[li]!;
      const isReason = /reason to live/i.test(sl.line.text);
      sl.bt.bricks.forEach((br, i) => {
        const si = sylOfChar(sl, br.ci);
        if (si < 0 || si > ks) return;
        const s = sl.syls[si]!;
        // a finished line lets go of what is left once the next one starts
        let tr = s.end + 0.25 + hashI(i, 1) * 0.9;
        if (next && !live) tr = Math.min(tr, next.line.start + hashI(i, 2) * 0.6);
        const n = Math.max(0, Math.floor((tick - tr) * 12));
        const y = YTOP + br.cy * CELL + Math.round((n * CELL * (1 + n * 0.15)) / CELL) * CELL;
        if (y > H) return;
        const x = x0 + br.cx * CELL;
        if (x > W || x + br.len * CELL < 0) return;
        drawn.push({ x, y, len: br.len, box: isReason });
        if (n === 0) mark(`syl:${s.text}`, x, y, br.len * CELL, CELL);
      });
    });
    c.fillStyle = INK;
    for (const d of drawn) if (d.box) c.fillRect(d.x - CELL, d.y - CELL, (d.len + 2) * CELL, 3 * CELL);
    for (const d of drawn) c.fillRect(d.x + CELL * 0.5, d.y + CELL * 0.5, d.len * CELL, CELL);
    c.fillStyle = PAPER;
    for (const d of drawn) brickRect(c, d.x, d.y, d.len, CELL);
    // no Conway floaters on the ceiling: no Life plane, no clumps
    return { view: { x: tc * 20, y: 0 }, plane: 0, clumps: 0 };
  }
}
