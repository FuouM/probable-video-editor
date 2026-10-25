// room (Chorus 1 until "what i have done"): a typewriter fills the frame with the chorus, letter by letter,
// on a fixed grid, dimmed. The grid is an LED screen whose pixels are those letters: the syllable being
// sung lights its letters (paper), the rest stay dim (halftone). "without a destination": a vector field
// over the wall, streamlines spiralling into a blue singularity and big arrows riding them in. "i can't
// see the walls": a flashlight brightens the dim wall where it shines, finds each syllable on its onset,
// and its circle opens until the whole wall is lit. On "walls surrounding" the walls compress in four
// sudden moves (top, bottom, left, right), one per syllable, each a kick of the frame; inside the window
// that is left the text is solid and the lit syllable is cut through to the blue, so it reads. "it's never
// gone": the window is a sheet of paper; it crumples into a ball ("ne", "ver") and on "gone" opens flat,
// turned over: its back is atone's ledger page, creases and all.
// Rates: typewriter 30 fps, LED syllable switches on onsets, walls snap at 30 fps, field 12 fps, paper 30 fps.
import type { Frame } from '@pve/engine/scene';
import { H, SCALE, W } from '@pve/engine/gl';
import { clamp, ease, lerp, prog } from '@pve/engine/util';
import { BAR, BEAT, BLUE, BOX_H, GlyphAtlas, INK, PAPER, PrintScene, ROWS, brickRect, bricks, drawBars, gray, hashI, lastBefore, readout, stepT, sylAt, sylLine, type PrintOpts, type Syl, type SylLine } from './_kit';
import { CREASE_W, PAGE, ledgerRules, pageCreases, pagePt, vortex } from './_motifs';
import { squeezedLetters } from './_room_squeeze';
import { mark } from '@pve/engine/marks';

const SLOT_W = 24, SLOT_H = 36; // one letter of the wall: 6 sub-cells of 3 px + tracking, 10 rows + leading
const COLS = Math.floor(W / SLOT_W);
const ROWS_N = Math.floor(BOX_H / SLOT_H);
const GX = (W - COLS * SLOT_W) / 2, GY = BAR + (BOX_H - ROWS_N * SLOT_H) / 2;
const RATE = 1100; // letters typed per second: the screen is full in under two seconds
const FINAL: [number, number] = [36, 12]; // the window the walls leave, in slots
const REVEAL = 41.83; // song time the vortex and its arrows open
const FOCAL = 1600; // px: the perspective of the paper ball

/** Apply to `c` the affine map that takes the triangle `s` (x0, y0, x1, y1, x2, y2) onto the triangle `d`. */
function mapTri(c: CanvasRenderingContext2D, s: number[], d: number[]) {
  const ux = s[2]! - s[0]!, uy = s[3]! - s[1]!, vx = s[4]! - s[0]!, vy = s[5]! - s[1]!;
  const px = d[2]! - d[0]!, py = d[3]! - d[1]!, qx = d[4]! - d[0]!, qy = d[5]! - d[1]!;
  const det = ux * vy - vx * uy;
  const a = (px * vy - qx * uy) / det, b = (py * vy - qy * uy) / det;
  const cc = (qx * ux - px * vx) / det, dd = (qy * ux - py * vx) / det;
  c.transform(a, b, cc, dd, d[0]! - a * s[0]! - cc * s[1]!, d[1]! - b * s[0]! - dd * s[1]!);
}

export default class Room extends PrintScene {
  private knocked = new GlyphAtlas(3, INK);
  private dim = new GlyphAtlas(3, gray(0.22));
  private lit3 = new GlyphAtlas(3, PAPER);
  private text = '';
  private lines: SylLine[] = [];
  private snaps: number[] = [];
  /** the syllable onsets of "without a doubt": the beats the walls' idea moves on */
  private ideaPulses: number[] = [];
  /** "it's never gone": the sheet starts to crumple on "ne" (tIts), balls up on "ver" (tVer), opens on "gone" */
  private tIts = Infinity;
  private tVer = Infinity;
  private tGone = Infinity;
  /** the window side of the sheet: the live window, copied from the layer every frame it moves (SCALE px) */
  private face = document.createElement('canvas');
  private treeSyls: Syl[] = [];
  /** the LED pixels lit this frame, one per slot, and a 1-slot dark halo around them when squeezed */
  private lit = new Uint8Array(COLS * ROWS_N);
  private halo = new Uint8Array(COLS * ROWS_N);
  /** "went on without a destination": the game tree */
  private blue: [number, number] = [0, 0];
  /** "i can't see the": the flashlight, up to the first snap */
  private dark: [number, number] = [0, 0];

  override init() {
    const ly = this.ctx.lyrics;
    const chorus = ly.linesIn(this.ctx.start, this.ctx.start + 19.2);
    this.text = chorus.map((l) => l.text.toLowerCase().replace(/’/g, "'")).join(' / ').replace(/[^a-z' ()]/g, ' ');
    this.lines = ly.linesIn(this.ctx.start, this.ctx.end).map((l) => sylLine(ly, l));
    const sur = ly.get('walls surrounding me');
    const w = sur.words.find((x) => x.w === 'walls')!;
    const s = sur.words.find((x) => x.w === 'surrounding')!;
    this.snaps = [w.start, ...(s.syl ?? [[s.start, s.end]]).map(([a]) => a)];
    // "surrounding me" stays bare: the walls' idea pulses on the syllables of "without a doubt"
    const wi = sur.words.findIndex((x) => x.w.toLowerCase() === 'without');
    this.ideaPulses = sur.words.slice(wi, wi + 3).flatMap((x) => (x.syl ?? [[x.start, x.end]]).map(([a]) => a));
    const destLine = sylLine(ly, 'without a destination');
    const wentStart = destLine.line.words.find((x) => x.w === 'went')!.start;
    this.treeSyls = destLine.syls.filter((sy) => sy.start >= wentStart - 1e-3);
    // Extend the destination game tree back to "went on"
    this.blue = [wentStart, destLine.line.end];
    this.dark = [sur.start, w.start];
    const neverWord = sur.words.find((x) => x.w.toLowerCase() === 'never')!;
    const goneWord = sur.words.find((x) => x.w.toLowerCase() === 'gone')!;
    this.tIts = neverWord.start;
    this.tVer = neverWord.syl?.[1]?.[0] ?? (neverWord.start + neverWord.end) / 2;
    this.tGone = goneWord.start;
    this.face.width = Math.ceil(FINAL[0] * SLOT_W * SCALE);
    this.face.height = Math.ceil(FINAL[1] * SLOT_H * SCALE);
    this.plane = {};
  }

  /** The window the walls leave at t, in px: [top, bottom, left, right] insets. */
  private insets(t: number): [number, number, number, number] {
    const fw = FINAL[0] * SLOT_W, fh = FINAL[1] * SLOT_H;
    const target: [number, number, number, number] = [(H - fh) / 2, (H - fh) / 2, (W - fw) / 2, (W - fw) / 2];
    const base: [number, number, number, number] = [BAR, BAR, 0, 0];
    return base.map((b, i) => {
      const at = this.snaps[i] ?? Infinity;
      return b + (target[i]! - b) * prog(t, at, at + 0.07, ease.outExpo);
    }) as [number, number, number, number];
  }
  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    const t = f.t;
    const tt = stepT(t, 30);
    c.fillStyle = INK;
    c.fillRect(0, 0, W, H);
    const [top, bot, left, right] = this.insets(tt);
    // a kick of the whole frame on every snap of the walls
    let sx = 0, sy = 0;
    this.snaps.forEach((at, i) => {
      const a = tt - at;
      if (a < 0 || a > 0.12) return;
      const amp = (10 + 2 * i) * (1 - a / 0.12);
      sx += (hashI(Math.round(tt * 30), i, 1) - 0.5) * 2 * amp;
      sy += (hashI(Math.round(tt * 30), i, 2) - 0.5) * 2 * amp;
    });
    c.save();
    c.translate(sx, sy);
    const wx = left + (W - left - right) / 2, wy = top + (H - top - bot) / 2;

    // the LED image: the syllable being sung, one slot per sub-cell, centred in the window; two slots per
    // sub-cell while it still fits
    const sl = lastBefore(this.lines, (l) => l.line.start <= tt);
    const k = sylAt(sl, tt);
    const lit = this.lit.fill(0);
    const halo = this.halo.fill(0);
    if (k >= 0 && tt < sl.syls[k]!.end + 0.25) {
      const bt = bricks(sl.syls[k]!.text);
      const winCols = Math.floor((W - left - right) / SLOT_W);
      const sc = bt.cols * 2 <= winCols - 2 ? 2 : 1;
      const c0 = Math.floor((wx - GX) / SLOT_W - (bt.cols * sc) / 2);
      const r0 = Math.floor((wy - GY) / SLOT_H - (ROWS * sc) / 2);
      for (const b of bt.bricks) for (let j = 0; j < b.len; j++) for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) {
        const cc = c0 + (b.cx + j) * sc + dx, rr = r0 + b.cy * sc + dy;
        if (cc >= 0 && rr >= 0 && cc < COLS && rr < ROWS_N) lit[rr * COLS + cc] = 1;
        for (let hy = -1; hy <= 1; hy++) for (let hx = -1; hx <= 1; hx++) {
          const hc = cc + hx, hr = rr + hy;
          if (hc >= 0 && hr >= 0 && hc < COLS && hr < ROWS_N) halo[hr * COLS + hc] = 1;
        }
      }
      mark(`syl:${sl.syls[k]!.text}`, GX + c0 * SLOT_W + sx, GY + r0 * SLOT_H + sy, bt.cols * sc * SLOT_W, ROWS * sc * SLOT_H);
    }
    // "went on without a destination": zooming game tree starting at "went on"
    const fieldAmt = tt >= this.blue[0] && tt < this.blue[1] + 0.3
      ? prog(tt, this.blue[0], this.blue[0] + 0.35, ease.outCubic) * (1 - prog(tt, this.blue[1], this.blue[1] + 0.3))
      : 0;
    if (fieldAmt > 0) vortex(c, stepT(t, 12) - this.blue[0], stepT(t, 12), wx, wy, fieldAmt, false, this.treeSyls);
    // its onset, then looks around, and its circle opens until the whole wall is lit
    let lx = 0, ly = 0, lr = -1;
    if (tt >= this.dark[0]) {
      const onset = k >= 0 ? sl.syls[k]!.start : tt;
      const pull = Math.exp(-Math.max(0, tt - onset) / 0.18);
      const fx = W / 2 + 560 * Math.sin(tt * 1.7) + 160 * Math.sin(tt * 4.3);
      const fy = H / 2 + 230 * Math.sin(tt * 2.3 + 1);
      lx = fx + (wx - fx) * pull;
      ly = fy + (wy - fy) * pull;
      lr = 220 + 1500 * prog(tt, this.dark[0] + 0.3, this.dark[1] + 0.5, ease.inCubic);
    }
    const squeezed = tt >= (this.snaps[0] ?? Infinity);
    // the typewriter: slots fill row by row and wrap round, overwriting with the text that follows
    const typed = Math.floor((tt - this.ctx.start) * RATE);
    const n = Math.min(typed, COLS * ROWS_N);
    for (let slot = 0; slot < n; slot++) {
      // the letter in a slot is the latest one typed there
      const lap = Math.floor((typed - 1 - slot) / (COLS * ROWS_N));
      const idx = slot + lap * COLS * ROWS_N;
      const ch = this.text[idx % this.text.length]!;
      const x = GX + (slot % COLS) * SLOT_W, y = GY + Math.floor(slot / COLS) * SLOT_H;
      if (lit[slot]) {
        if (squeezed) {
          // in the window: the lit syllable is cut through to the blue, solid, on top of the wall of text
          c.clearRect(x - 2, y - 3, SLOT_W, SLOT_H);
        } else {
          // a lit pixel: a paper block with its letter knocked out, so the syllable reads as solid light
          c.fillStyle = PAPER;
          c.fillRect(x - 2, y - 3, SLOT_W - 1, SLOT_H - 1);
          if (ch !== ' ') this.knocked.draw(c, ch, x, y);
        }
        continue;
      }
      if (ch === ' ') continue;
      // When squeezed, dim the 1-slot halo around the blue LED syllable so the blue blocks read cleanly against the white wall
      if (squeezed && halo[slot]) {
        this.dim.draw(c, ch, x, y);
        continue;
      }
      const dx = x + SLOT_W / 2 - lx, dy = y + SLOT_H / 2 - ly;
      const bright = squeezed || (lr > 0 && dx * dx + dy * dy < lr * lr);
      (bright ? this.lit3 : this.dim).draw(c, ch, x, y);
    }
    // the edge of the light
    if (lr > 0 && !squeezed) {
      c.strokeStyle = PAPER;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(lx, ly, lr, 0, Math.PI * 2);
      c.stroke();
    }
    c.restore();
    drawBars(c, [top, bot, left, right]);
    squeezedLetters(c, tt, { pulses: this.ideaPulses, end: this.tIts, win: [top, bot, left, right], fin: this.insets(Infinity), shake: [sx, sy], text: this.text });

    // "it's never gone": the window crumples into a paper ball and opens flat on "gone", turned over: atone's page
    if (tt >= this.tIts) this.drawSheet(c, tt, left, top, W - left - right, H - top - bot);
    readout(c, `CHORUS 1 · LED WALL ${COLS}×${ROWS_N} · TYPED ${String(typed).padStart(5, '0')}`, 'left');
    readout(c, `WALLS IN ${this.snaps.filter((s) => s <= tt).length}/${this.snaps.length}`, 'right');

    if (fieldAmt > 0) vortex(c, stepT(t, 12) - this.blue[0], stepT(t, 12), wx, wy, fieldAmt, true, this.treeSyls);
    return {
      // up to atone's noise by the cut, so the overlays don't jump there
      noise: 0.5 + 0.5 * prog(tt, this.tGone, this.ctx.end - 0.05),
      plane: 0,
      // the mirror killed its clumps: they come back one by one instead of all popping in at the cut
      clumpKill: 1 - clamp((t - this.ctx.start) / 2),
      view: { x: 683.78, y: -21.80, cell: 4.22 },
      full: t < this.ctx.start + 1.6,
    };
  }

  /**
   * "it's never gone": the window is a sheet of paper. On "ne" it bends, cupped at the camera; on "ver" it is
   * crushed into a ball, the paper side out, and turns over; on "gone" it opens and lies flat over the whole
   * box, paper side up. That side is atone's ledger page, creases and all, so the cut lands on the same page.
   * The window side shows the live window; its black lifts to a dotted gray as it folds, and its creases are
   * paper, so the ball reads on the black. (bx, by, bw, bh): the window.
   */
  private drawSheet(c: CanvasRenderingContext2D, tt: number, bx: number, by: number, bw: number, bh: number) {
    const tFlat = this.ctx.end - 0.05; // flat for the last frames
    // "ne" bends it (a smooth cup, the window still reads), "ver" crushes it into the ball, "gone" opens it
    const bend = prog(tt, this.tIts, this.tIts + 0.22, ease.outCubic), crush = prog(tt, this.tVer, this.tVer + 0.22, ease.outCubic);
    const k = (0.4 * bend + 0.6 * crush) * (1 - prog(tt, this.tGone, tFlat, ease.inOutCubic));
    if (k <= 0) {
      if (tt < this.tGone) return; // not folded yet: the window itself
      c.fillStyle = PAPER;
      c.fillRect(0, BAR, W, BOX_H);
      ledgerRules(c);
      pageCreases(c);
      drawBars(c);
      return;
    }
    // the window side: the live window (its cut-through syllable stays blue)
    const fc = this.face.getContext('2d')!;
    fc.fillStyle = BLUE;
    fc.fillRect(0, 0, this.face.width, this.face.height);
    fc.drawImage(c.canvas, bx * SCALE, by * SCALE, bw * SCALE, bh * SCALE, 0, 0, bw * SCALE, bh * SCALE);
    c.fillStyle = INK;
    c.fillRect(bx - 4, by - 4, bw + 8, bh + 8);

    // turned from the window side (r 0) to the paper side (r 1), tumbling on the way; from the window's size
    // to the box's while it is balled up
    const r = prog(tt, this.tVer, tFlat, ease.inOutCubic);
    const d = prog(tt, this.tVer + 0.1, this.tGone, ease.inOutCubic);
    const fw = lerp(bw, W, d), fh = lerp(bh, BOX_H, d);
    const cx = lerp(bx + bw / 2, W / 2, d), cy = lerp(by + bh / 2, BAR + BOX_H / 2, d);
    const ry = Math.PI * (1 - r), rx = 0.5 * Math.sin(Math.PI * r), rz = -0.35 * Math.sin(Math.PI * r);
    const cY = Math.cos(ry), sY = Math.sin(ry), cX = Math.cos(rx), sX = Math.sin(rx), cZ = Math.cos(rz), sZ = Math.sin(rz);
    const P: [number, number, number][] = [], S: [number, number][] = [];
    PAGE.uv.forEach(([u, v], i) => {
      // flat page <-> ball, the ball with the paper side out; crushed, every vertex goes its own way
      const ki = 1 - Math.pow(1 - k, 1 + crush * (0.7 * hashI(i, 1, 31) - 0.3));
      const lon = (u - 0.5) * Math.PI * 1.85 + (hashI(i, 1, 32) - 0.5) * 0.55 * crush;
      const lat = (v - 0.5) * Math.PI * 0.95 + (hashI(i, 1, 33) - 0.5) * 0.45 * crush;
      const rad = 165 * (1 + crush * ((hashI(i, 1, 34) - 0.5) * 0.5 + 0.08 * Math.sin(tt * 16 + i)));
      const x0 = lerp((u - 0.5) * fw, Math.cos(lat) * Math.sin(lon) * rad, ki);
      const y0 = lerp((v - 0.5) * fh, Math.sin(lat) * rad, ki);
      const z0 = Math.cos(lat) * Math.cos(lon) * rad * ki;
      const x1 = x0 * cY + z0 * sY, z1 = z0 * cY - x0 * sY;
      const y2 = y0 * cX - z1 * sX, z2 = y0 * sX + z1 * cX;
      const x3 = x1 * cZ - y2 * sZ, y3 = x1 * sZ + y2 * cZ;
      const s = FOCAL / (FOCAL - z2);
      P.push([x3, y3, z2]);
      S.push([cx + x3 * s, cy + y3 * s]);
    });
    const lift = clamp(4 * k);
    const tris = PAGE.tris.map((t) => ({ t, z: P[t[0]]![2] + P[t[1]]![2] + P[t[2]]![2] })).sort((p, q) => p.z - q.z);
    for (const { t: [i0, i1, i2] } of tris) {
      const [ax, ay] = S[i0]!, [bx1, by1] = S[i1]!, [ex, ey] = S[i2]!;
      const area = (bx1 - ax) * (ey - ay) - (by1 - ay) * (ex - ax);
      const paper = area > 0; // the page's own winding: its paper side faces the camera
      // light from the upper left and front; 1 for a facet square to the camera
      const p = P[i0]!, q = P[i1]!, e = P[i2]!;
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = e[0] - p[0], vy = e[1] - p[1], vz = e[2] - p[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = (Math.hypot(nx, ny, nz) || 1) * Math.sign(nz || 1);
      const sh = 0.3 + 0.7 * clamp((-0.337 * nx - 0.421 * ny + 0.842 * nz) / (nl * 0.842));
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx1, by1); c.lineTo(ex, ey); c.closePath();
      if (Math.abs(area) > 1) {
        const base = paper
          ? (sh >= 0.999 ? PAPER : `rgb(${[1, 3, 5].map((j) => Math.round(parseInt(PAPER.slice(j, j + 2), 16) * sh)).join(',')})`)
          : gray((0.2 + 0.25 * sh) * lift);
        c.fillStyle = base;
        c.fill();
        c.strokeStyle = base; // seals the seam with the next facet
        c.lineWidth = 1;
        c.stroke();
        c.save();
        c.clip();
        if (paper) {
          mapTri(c, [...pagePt(i0), ...pagePt(i1), ...pagePt(i2)], [ax, ay, bx1, by1, ex, ey]);
          ledgerRules(c, sh);
        } else {
          const [u0, v0] = PAGE.uv[i0]!, [u1, v1] = PAGE.uv[i1]!, [u2, v2] = PAGE.uv[i2]!;
          mapTri(c, [(1 - u0) * bw, v0 * bh, (1 - u1) * bw, v1 * bh, (1 - u2) * bw, v2 * bh], [ax, ay, bx1, by1, ex, ey]);
          c.globalCompositeOperation = 'lighten';
          c.drawImage(this.face, 0, 0, bw, bh);
        }
        c.restore();
        if (!paper) {
          c.fillStyle = `rgba(0,0,0,${0.3 * (1 - sh)})`;
          c.fill();
        }
      }
      // its edges: the page's creases dark on the paper side (faint once flat), the rest only while folded;
      // paper on the window side, once it is crushed (bent, it is still smooth)
      for (const [m, n] of [[i0, i1], [i1, i2], [i2, i0]] as const) {
        const tone = PAGE.creases.get(Math.min(m, n) * 4096 + Math.max(m, n));
        const al = paper && tone !== undefined ? 1 : clamp(3 * k) * (paper ? 1 : crush);
        if (al <= 0) continue;
        c.strokeStyle = paper ? gray(lerp(tone ?? 0.5, 0.1, k), al) : gray(1, al);
        c.lineWidth = CREASE_W + 0.5 * k;
        c.beginPath(); c.moveTo(S[m]![0], S[m]![1]); c.lineTo(S[n]![0], S[n]![1]); c.stroke();
      }
    }
    drawBars(c);
  }
}
