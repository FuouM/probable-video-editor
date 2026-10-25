// The Droste fall of Verse 4 and the build-up, one function of song time shared by flock and build_up, so
// the cut between them (on "emotion") does not show. From "and let everything stop in motion" a window
// opens at the centre of the blueprint onto an endless recursion: every level holds a smaller one (0.42x,
// turned 0.18 rad), the ring between two levels filled in turn blue, ink and paper. We fall in from the
// start, slowly, faster and faster to the end (one smooth curve, no pulse, no hold); the window grows until
// it is bigger than the frame (we are inside) by the cut. Every sung word from "and" has a level of its
// own and stands in it, so it comes at us and goes out past the frame with its level. A few arrows (the
// warheads of the flock) fly down the tunnel with us, round a spiral. From "inner demon" the levels carry
// Maxwell's two sealed chambers either side, the blue and paper particles never sorted.
import type { Lyrics } from '@pve/engine/lyrics';
import { H, W } from '@pve/engine/gl';
import { mark } from '@pve/engine/marks';
import { clamp, ease, prog } from '@pve/engine/util';
import { BAR, BEAT, BEAT0, BLUE, BOX_H, INK, PAPER, brickRect, bricks, gray, hashI, syllables } from './_kit';

export const DROSTE = { cx: 960, cy: 540, box: 700 };
const R = 0.44; // size ratio of one level to the next
const TURN = 0.16; // rotation from one level to the next
const RINGS = ['blue', INK, PAPER] as const;
const FULL = 2600;
const RATE0 = 2.35, RATE1 = 2.75; // steady organic fall rate (no unnatural late surge)
const BASE_SIZE = 1520; // constant reference level size in px
const WORD_SIZE = 740;
const ESCORTS = 22; // 3D-curved arrows entering the tunnel until "inner demon"
const PARTICLES = 16;
export const DIVE = 0.75;

export class DrosteFall {
  readonly tFlockStart: number;
  /** "and let everything stop in motion": the window opens */
  readonly tOpen: number;
  /** "emotion": the window is past the frame, the cut to build_up */
  readonly tCut: number;
  /** "everything": the flock is already out of bounds and tunnel arrows begin */
  readonly tStop: number;
  /** "inner demon": free-roaming white and blue particles */
  readonly tDemon: number;
  /** first tunnel level that holds the free-roaming inner demon particles (emerges organically from the deep center) */
  readonly demonLevel: number;
  /** Chorus 2: the exact end of build_up (start of without) */
  readonly tEnd: number;
  /** end of the last word ("it") in build_up, after which the final level expands into the 4x2 grid */
  readonly tLastWordEnd: number;
  /** final level at tEnd that holds the 4x2 grid of Chorus 2 (without) */
  readonly finalLevel: number;
  readonly words = new Map<number, { w: string; t: number }>();

  constructor(ly: Lyrics) {
    this.tFlockStart = ly.get('disfigured beyond recognition').start;
    const and = ly.get('and let everything stop in motion');
    this.tOpen = and.start;
    this.tStop = and.words.find((w) => w.w === 'everything')!.start;
    this.tCut = ly.get('emotion').start;
    this.tDemon = ly.get('with my inner demon').words.find((w) => w.w === 'inner')!.start;
    // Chorus 2 starts at bar 97 (116.696 s); use Math.round so 116.62 s is not floored a bar early to 115.496 s!
    const first = ly.get("i can't even lie").start;
    this.tEnd = BEAT0 + Math.round((first - BEAT0) / (4 * BEAT)) * 4 * BEAT;
    const levelAt = (t: number) => Math.round(this.z(t) + Math.max(0.3, Math.log(BASE_SIZE / WORD_SIZE) / Math.log(1 / R)));
    this.demonLevel = levelAt(this.tDemon);
    let prev = -Infinity;
    let lastEnd = this.tEnd - 1.0;
    for (const line of ly.linesIn(this.tOpen, this.tEnd)) {
      let last = -1;
      for (const s of syllables(line)) {
        if (s.wi === last || s.start < this.tOpen - 1e-3) continue;
        last = s.wi;
        lastEnd = Math.max(lastEnd, s.word.end);
        const w = s.word.w.toLowerCase().replace(/’/g, "'").replace(/[^a-z' ]/g, '');
        const La = Math.max(prev + 1, levelAt(Math.min(s.start + 0.15, (s.start + s.word.end) / 2)));
        const Lb = Math.max(La, levelAt(Math.max(s.start, s.word.end - 0.12)));
        for (let L = La; L <= Lb; L++) this.words.set(L, { w, t: s.start });
        prev = Lb;
      }
    }
    this.tLastWordEnd = lastEnd;
    this.finalLevel = Math.max(prev + 1, Math.round(this.z(this.tEnd)));
  }

  /** Conway plane cell size at t: zooms continuously with the Droste fall from flock through build_up. */
  planeCell(t: number) {
    if (t <= this.tOpen) return 3;
    return 3 * (1 + 0.32 * Math.max(0, this.z(t)));
  }

  /** Levels fallen through by t: smooth, steady organic rate without late acceleration surge. */
  z(t: number) {
    const D = this.tEnd - this.tOpen, p = prog(t, this.tOpen, this.tEnd);
    const easeIn = p * p / (p + 0.08);
    return D * (RATE0 * easeIn + (RATE1 - RATE0) * 0.5 * p * p);
  }

  /** The clipping window's side at t: opens on "and", then expands smoothly past the frame by the cut. */
  box(t: number) {
    const open = prog(t, this.tOpen, this.tOpen + 0.45, ease.outCubic);
    const grow = prog(t, this.tOpen + 0.35, this.tCut, ease.inOutQuad);
    return DROSTE.box * open * Math.pow(FULL / DROSTE.box, grow);
  }

  /** Size in px of level L at t (pure exponential of L - z(t) so zoom speed never lurches at tCut). */
  size(L: number, t: number) {
    const open = prog(t, this.tOpen, this.tOpen + 0.4, ease.outCubic);
    return BASE_SIZE * open * Math.pow(R, L - this.z(t));
  }
  /**
   * Draw the fall at t: the levels inside the window (or the whole frame), the words, the chambers. Marks
   * every word in view as `word:<w>`.
   */
  draw(c: CanvasRenderingContext2D, t: number, overBars = false) {
    const { cx, cy } = DROSTE;
    const box = this.box(t), z = this.z(t);
    if (box < 2) return;
    c.save();
    if (overBars) {
      // only what falls on the black bars: the white words run on over them, the picture stays inside the frame
      c.beginPath();
      c.rect(0, 0, W, BAR);
      c.rect(0, H - BAR, W, BAR);
      c.clip();
    }
    if (box < FULL) {
      c.beginPath();
      c.rect(cx - box / 2, cy - box / 2, box, box);
      c.clip();
    }
    const L0 = Math.floor(z) - 2;
    for (let L = L0; L <= L0 + 14; L++) {
      const size = this.size(L, t), rot = TURN * (L - z);
      if (size < 3) break;
      if (size > 9000) continue;
      const col = RINGS[((L % 3) + 3) % 3]!;
      const fg = col === PAPER ? INK : PAPER;
      c.save();
      c.translate(cx, cy);
      c.rotate(rot);
      if (!overBars) {
        if (col === 'blue') c.clearRect(-size / 2, -size / 2, size, size);
        else {
          c.fillStyle = col;
          c.fillRect(-size / 2, -size / 2, size, size);
        }
      }
      if (!overBars && L >= this.demonLevel && size > 24) this.chambers(c, size, t, L, col);
      const w = this.words.get(L);
      if (w && t >= w.t - 0.22 && (!overBars || fg === PAPER)) {
        const bt = bricks(w.w);
        const cell = Math.min((size * 0.24) / 10, (size * 0.84) / bt.cols);
        const isCopy = this.words.get(L - 1)?.w === w.w;
        const wp = isCopy ? clamp((cell - 0.8) / (2.5 - 0.8), 0, 1) : prog(t, w.t - 0.22, w.t + 0.14, ease.outCubic);
        if (cell >= 0.8 && wp > 0.02) {
          const x0 = -(bt.cols * cell) / 2, y0 = -size * 0.36 - 5 * cell - (1 - wp) * cell * 2.5;
          c.fillStyle = wp < 0.85 ? gray(fg === PAPER ? 1 : 0, wp) : fg;
          for (const b of bt.bricks) {
            const bp = clamp((wp * 1.35) - (b.cx / Math.max(1, bt.cols)) * 0.35, 0, 1);
            if (bp <= 0) continue;
            brickRect(c, x0 + b.cx * cell, y0 + b.cy * cell + (1 - bp) * cell * 1.5, b.len * bp, cell);
          }
          if (!overBars) mark(`word:${w.w}`, x0, y0, bt.cols * cell, 10 * cell, c);
        }
      }
      c.restore();
    }
    c.restore();
    if (box < FULL && !overBars) {
      // the window's own edge
      c.strokeStyle = PAPER;
      c.lineWidth = 4;
      c.strokeRect(cx - box / 2, cy - box / 2, box, box);
    }
  }

  /**
   * "run from it" as white bricks only, on the same fall but with the zoom running on past `tEnd`
   * (`z` is held there), so the three words keep falling at the camera through the cut into Chorus 2.
   */
  drawWords(c: CanvasRenderingContext2D, t: number, overBars = false) {
    const { cx, cy } = DROSTE;
    const D = this.tEnd - this.tOpen, p = Math.max(0, (t - this.tOpen) / D);
    const z = D * (RATE0 * (p * p) / (p + 0.08) + (RATE1 - RATE0) * 0.5 * p * p);
    c.save();
    if (overBars) {
      c.beginPath();
      c.rect(0, 0, W, BAR);
      c.rect(0, H - BAR, W, BAR);
      c.clip();
    }
    for (const [L, w] of this.words) {
      if (w.w !== 'run' && w.w !== 'from' && w.w !== 'it') continue;
      c.fillStyle = w.w === 'it' ? INK : PAPER; // "it" stays black, as the Droste draws it
      const size = BASE_SIZE * Math.pow(R, L - z);
      if (size > 200000) continue;
      const wp = prog(t, w.t - 0.22, w.t + 0.14, ease.outCubic);
      const bt = bricks(w.w);
      const cell = Math.min((size * 0.24) / 10, (size * 0.84) / bt.cols);
      if (cell < 0.8 || wp <= 0.02) continue;
      c.save();
      c.translate(cx, cy);
      c.rotate(TURN * (L - z));
      const x0 = -(bt.cols * cell) / 2, y0 = -size * 0.36 - 5 * cell - (1 - wp) * cell * 2.5;
      for (const b of bt.bricks) {
        const bp = clamp((wp * 1.35) - (b.cx / Math.max(1, bt.cols)) * 0.35, 0, 1);
        if (bp <= 0) continue;
        brickRect(c, x0 + b.cx * cell, y0 + b.cy * cell + (1 - bp) * cell * 1.5, b.len * bp, cell);
      }
      c.restore();
    }
    c.restore();
  }

  /**
   * Free-roaming white and blue particles across the entire level background behind the inner Droste box.
   * Because they belong to levels `L >= this.demonLevel`, they emerge organically from the deep tunnel center
   * as we fall into the "inner demon" levels (no artificial fade-in on outer rings).
   */
  private chambers(c: CanvasRenderingContext2D, size: number, t: number, L: number, ringCol: string) {
    const fold = (v: number, n: number) => { const m = ((v % (2 * n)) + 2 * n) % (2 * n); return m > n ? 2 * n - m : m; };
    const r = size * 0.013;
    const span = size - 2 * r;
    const count = PARTICLES * 3;
    for (let i = 0; i < count; i++) {
      const id = L * 131 + i;
      const sp = 0.16 + 0.28 * hashI(id, 2), ang = hashI(id, 3) * Math.PI * 2;
      const px = -size / 2 + r + fold(hashI(id, 4) + Math.cos(ang) * sp * t, 1) * span;
      const py = -size / 2 + r + fold(hashI(id, 5) + Math.sin(ang) * sp * t, 1) * span;
      const isBlue = hashI(id, 6) < 0.5;
      c.beginPath();
      c.arc(px, py, r, 0, Math.PI * 2);
      if (isBlue) {
        c.fillStyle = BLUE;
        c.fill();
        if (ringCol === 'blue') {
          c.strokeStyle = PAPER;
          c.lineWidth = Math.max(1, size * 0.0025);
          c.stroke();
        }
      } else {
        c.fillStyle = PAPER;
        c.fill();
        if (ringCol === PAPER) {
          c.strokeStyle = INK;
          c.lineWidth = Math.max(1, size * 0.0025);
          c.stroke();
        }
      }
    }
  }

  escortIn(i: number) {
    const span = Math.max(1, this.tDemon - 1.1 - this.tStop);
    return this.tStop + (i / ESCORTS) * span;
  }

  /** 3D position (x, y, size, alpha) of tunnel arrow i along a slow 3D curved helical path into the tunnel. */
  private escortPos(i: number, t: number): { x: number; y: number; s: number; alpha: number } | null {
    const te = this.escortIn(i);
    if (t < te || i >= ESCORTS) return null;
    const dt = t - te;
    // Slow descent into the 3D tunnel (1.35 levels/s relative to camera)
    const depthAhead = -0.42 + dt * 1.35;
    if (depthAhead > 3.8) return null;
    const depthFade = clamp((3.8 - depthAhead) / 0.8, 0, 1);
    const timeFade = t > this.tDemon ? clamp(1.0 - (t - this.tDemon) / 1.0, 0, 1) : 1.0;
    const alpha = depthFade * timeFade;
    if (alpha <= 0.01) return null;

    const L = this.z(t) + depthAhead;
    const size = this.size(L, t);
    const side = i % 2 === 0 ? 1 : -1;
    const ang0 = i * 2.39996 + (hashI(i, 83) - 0.5) * 0.4;
    // Graceful 3D curve: gentle helical turn + radial sway as it descends into the tunnel
    const ang = ang0 + side * (0.65 * Math.sin(dt * 1.25) + 0.48 * dt);
    const rad = (0.43 - 0.08 * Math.sin(dt * 1.4 + i)) * size;
    const x = DROSTE.cx + Math.cos(ang) * rad;
    const y = DROSTE.cy + Math.sin(ang) * rad;
    const s = Math.max(0, Math.min(38, size * 0.032)) * Math.sqrt(alpha);
    if (s <= 0.5) return null;
    return { x, y, s, alpha };
  }

  escort(i: number, t: number): { x: number; y: number; a: number; s: number; alpha: number } | null {
    const p = this.escortPos(i, t);
    if (!p) return null;
    const pNext = this.escortPos(i, t + 0.03) ?? { x: DROSTE.cx, y: DROSTE.cy, s: p.s, alpha: p.alpha };
    const a = Math.atan2(pNext.y - p.y, pNext.x - p.x);
    return { x: p.x, y: p.y, a, s: p.s, alpha: p.alpha };
  }

  drawEscorts(c: CanvasRenderingContext2D, t: number) {
    for (let i = 0; i < ESCORTS; i++) {
      const e = this.escort(i, t);
      if (!e) continue;
      c.save();
      c.globalAlpha = e.alpha;
      c.strokeStyle = PAPER;
      c.lineWidth = Math.max(1.2, e.s * 0.12);
      c.setLineDash([7, 6]);
      c.beginPath();
      let started = false;
      for (let q = 0; q <= 10; q++) {
        const p = this.escortPos(i, Math.max(this.escortIn(i), t - 0.42 + (0.42 * q) / 10));
        if (!p) continue;
        if (started) c.lineTo(p.x, p.y); else { c.moveTo(p.x, p.y); started = true; }
      }
      c.stroke();
      c.setLineDash([]);
      drawWarhead(c, e.x, e.y, e.a, e.s);
      c.restore();
      mark('escort', e.x - e.s, e.y - e.s, 2 * e.s, 2 * e.s);
    }
  }
}

/**
 * A flight from (x0, y0) to (x1, y1) on a ballistic arc (it climbs, then curves round down into the
 * target), u 0..1 along it; `i` picks its side.
 */
export function arc(x0: number, y0: number, x1: number, y1: number, i: number, u: number) {
  const side = hashI(i, 71) < 0.5 ? -1 : 1;
  const mx = (x0 + x1) / 2 + side * (160 + 140 * hashI(i, 72)), my = Math.min(y0, y1) - 200 - 120 * hashI(i, 73);
  const q = 1 - u;
  const x = q * q * x0 + 2 * q * u * mx + u * u * x1, y = q * q * y0 + 2 * q * u * my + u * u * y1;
  const dx = 2 * q * (mx - x0) + 2 * u * (x1 - mx), dy = 2 * q * (my - y0) + 2 * u * (y1 - my);
  return { x, y, a: Math.atan2(dy, dx) };
}

/** A war-map warhead glyph pointing along angle a: a solid arrowhead on a short tail. */
export function drawWarhead(c: CanvasRenderingContext2D, x: number, y: number, a: number, s: number) {
  c.save();
  c.translate(x, y);
  c.rotate(a);
  c.fillStyle = PAPER;
  c.beginPath();
  c.moveTo(s * 1.4, 0);
  c.lineTo(-s * 0.6, -s * 0.9);
  c.lineTo(-s * 0.2, 0);
  c.lineTo(-s * 0.6, s * 0.9);
  c.closePath();
  c.fill();
  c.fillRect(-s * 1.6, -s * 0.18, s * 1.4, s * 0.36);
  c.restore();
}
