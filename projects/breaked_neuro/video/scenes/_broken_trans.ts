// Transitions of broken (final chorus) between its last three ASCII views: the montage (the 4x3 wall of the
// twelve scenes) dives into the first-person DOOM corridor on "a far" (two beats), and the corridor rolls into
// the BBS/IRC client as split-flaps on "-ver see" (a beat and two thirds). Each holds its steps at the grid rate
// (15 fps) and starts its moves on the beats. Both are pure functions of time.
import { clamp, ease, prog } from '@pve/engine/util';
import { BEAT, BEAT0, hashI } from './_kit';
import { ACOLS, AROWS, Grid, Tone, rampChar } from './_ascii';

/** The montage held for the transition: the kind of each tile (4x3, row by row) and the luma of a kind at (u, v). */
export interface Montage { order: readonly number[]; luma: (kind: number, u: number, v: number) => number }

const STEP = 1 / 15; // one step of the grid rate: a move ends one step before its window ends, so the last held frame shows it done
const TW = 40, TH = 20; // a montage tile in cells (as in broken.ts)
const FLAP = ' .:-=+*#%@0123456789abcdefghijklmnopqrstuvwxyz'; // the flap alphabet of the split-flap roll

/** The beat nearest t. */
const beatOf = (t: number) => BEAT0 + Math.round((t - BEAT0) / BEAT) * BEAT;

/**
 * "a far": dive. On "a" a frame of holes rings one tile (the Droste squares) and the camera punches in on it; on
 * the off-beat the tile shows the corridor; on "far" the camera punches in until the tile is the frame.
 * `doom` holds the corridor at this time. Writes the frame into `g` (cleared); the lyric goes on top after.
 */
export function montageIntoDoom(g: Grid, m: Montage, doom: Grid, tq: number, t0: number) {
  const b0 = beatOf(t0), b1 = b0 + BEAT;
  // the dive tile: column 2, row 1 (right of the middle, clear of the lyric); the Droste squares move into it
  const TX = 2, TY = 1, x0 = TX * TW, y0 = TY * TH, tile = TY * 4 + TX;
  const order = m.order.slice();
  order[order.indexOf(9)] = order[tile]!;
  order[tile] = 9;
  const mm: Montage = { order, luma: m.luma };
  // zoom in log scale: half of it on "a", the rest on "far", each in a fast stroke
  const s = 0.5 * prog(tq, b0, b0 + 0.2, ease.outCubic) + 0.5 * prog(tq, b1, b1 + 0.2, ease.outCubic);
  const kx = ACOLS / TW, ky = AROWS / TH; // the zoom at which the tile fills the frame
  const zx = kx ** s, zy = ky ** s;
  const fx = (kx * x0) / (kx - 1), fy = (ky * y0) / (ky - 1); // the point that the zoom keeps in place
  const into = tq >= b0 + BEAT / 2;
  for (let r = 0; r < AROWS; r++) for (let q = 0; q < ACOLS; q++) {
    const x = q / zx + fx * (1 - 1 / zx), y = r / zy + fy * (1 - 1 / zy);
    if (into && x >= x0 && x < x0 + TW && y >= y0 && y < y0 + TH) put(g, q, r, doom, Math.floor((x - x0) * kx + 1e-6), Math.floor((y - y0) * ky + 1e-6));
    else montageAt(mm, g, q, r, x, y);
  }
  if (tq >= b0) frame(g, Math.round(fx + (x0 - fx) * zx), Math.round(fy + (y0 - fy) * zy), Math.round(fx + (x0 + TW - fx) * zx), Math.round(fy + (y0 + TH - fy) * zy));
}

/**
 * "-ver see": split-flap roll from the DOOM corridor (`doom`) into the IRC client (`irc`, without the lyric). From
 * the first beat a wave runs from the top left to the bottom right and starts every cell that changes. The cell
 * rolls forward through the flap alphabet to its new glyph and stops after as many flaps as its way is long, so
 * the new screen settles in a ragged order. The first flap is a hole. Writes the frame into `g` (cleared).
 */
export function doomIntoIrc(g: Grid, doom: Grid, irc: Grid, tq: number, t0: number, t1: number) {
  const b0 = beatOf(t0), end = t1 - STEP, seed = 23;
  const most = Math.max(1, Math.floor((end - b0) / STEP) - 3); // the most flaps of a cell: the wave takes the other steps
  const span = end - b0 - most * STEP;
  for (let r = 0; r < AROWS; r++) for (let q = 0; q < ACOLS; q++) {
    const i = r * ACOLS + q, ta = doom.tone[i]!, tb = irc.tone[i]!;
    if (!ta && !tb) continue;
    const ca = ta ? doom.ch[i]! : ' ', cb = tb ? irc.ch[i]! : ' ';
    const ia = Math.max(0, FLAP.indexOf(ca)), n = (Math.max(0, FLAP.indexOf(cb)) - ia + FLAP.length) % FLAP.length;
    const flips = ta === tb && ca === cb ? 0 : 1 + (n % most);
    const d = clamp(0.6 * (q / (ACOLS - 1)) + 0.4 * (r / (AROWS - 1)) + (hashI(q, r, seed) - 0.5) * 0.06);
    const k = Math.floor((tq - b0 - d * span) / STEP + 1e-6);
    if (k < 0) put(g, q, r, doom, q, r);
    else if (k >= flips) put(g, q, r, irc, q, r);
    else g.set(q, r, FLAP[(ia + Math.round((n * (k + 1)) / (flips + 1))) % FLAP.length]!, k === 0 ? Tone.Hole : Tone.Bright);
  }
}

/** Cell (sq, sr) of `src` into cell (q, r) of `g`; nothing for a cell outside `src`. */
function put(g: Grid, q: number, r: number, src: Grid, sq: number, sr: number) {
  if (sq < 0 || sr < 0 || sq >= ACOLS || sr >= AROWS) return;
  const i = sr * ACOLS + sq;
  g.set(q, r, src.ch[i]!, src.tone[i]! as Tone);
}

/** The montage at montage cell position (x, y) (fractions allowed) into cell (q, r) of `g`, by the montage's own rule. */
function montageAt(m: Montage, g: Grid, q: number, r: number, x: number, y: number) {
  if (!(x >= 0 && y >= 0 && x < ACOLS && y < AROWS)) return;
  const tx = Math.floor(x / TW), ty = Math.floor(y / TH);
  const l = m.luma(m.order[ty * 4 + tx]!, (x - tx * TW) / TW, (y - ty * TH) / TH);
  if (l > 0.05) g.set(q, r, rampChar(l), l > 0.85 ? Tone.Bright : Tone.Dim);
}

/** A frame of holes just outside the cell rectangle [qa, qb) x [ra, rb). */
function frame(g: Grid, qa: number, ra: number, qb: number, rb: number) {
  for (let q = qa - 1; q <= qb; q++) { g.set(q, ra - 1, '#', Tone.Hole); g.set(q, rb, '#', Tone.Hole); }
  for (let r = ra; r < rb; r++) { g.set(qa - 1, r, '#', Tone.Hole); g.set(qb, r, '#', Tone.Hole); }
}
