// Plate 10 looks & apparatus (clip params.look).
// The full codex folio:
// - Right (`x = 800..1850`): Reborn Plate 0 codex with geometric knotwork initial (holding 愛), red rubricated
//   headwords (別れ, 死ぬ, 患, 踊), ruled dictionary columns, Fraktur glosses, and a geometric marginalia vine
//   with snail and bird.
// - Left (`x = 100..620`, above the 神 seal): Live 4-Era Synthesis Specimen Box that drafts each sung glyph at
//   large scale on the 12×12 modernist snap grid with brush entry vectors, press serif brackets, and JPEG block
//   terminals, and punches a monumental 人生 cut-out onto the red substrate during the a cappella climax.
// - Look 'assembly': era shards launch from the Specimen Box and margins at 12 fps to build each stroke.
// - Look 'palimpsest': faint traces of earlier eras under the codex, scraped clean as strokes are written.
import { H, makeCanvas, SCALE, scaleContext2D, W } from '@pve/engine/gl';
import { lineNo, units, type Lyrics } from '@pve/engine/lyrics';
import { fnt, INK, MONO, PAPER, RED, SANS, SERIF, tone } from './_page';
import { segment, strokeSpans, writeStrokes, type PStroke, type Skel } from './new-script';

type P = [number, number];

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function canvas2D() {
  const { cv: el, c } = makeCanvas();
  return { el, c };
}

/** A transparent canvas at the output scale; draw in logical px. */
export function layer2D(w: number, h: number): CanvasRenderingContext2D {
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * SCALE);
  cv.height = Math.round(h * SCALE);
  return scaleContext2D(cv.getContext('2d', { willReadFrequently: true })!, SCALE);
}

/** The sung glyphs of lines a..b, one string. */
function glyphs(L: Lyrics, a: number, b: number): string[] {
  const out: string[] = [];
  for (let i = a; i <= b; i++) for (const u of units(lineNo(L, i))) out.push(...u.glyph.replace(/[「」"\s]/g, ''));
  return out;
}

/** Index of the last sample at or before arc length s. */
function sampleAt(st: PStroke, s: number): number {
  let i = 0;
  while (i < st.x.length - 1 && st.s[i + 1]! <= s) i++;
  return i;
}

// ---------- Codex Geometry & Knotwork Initial ----------

export const CODEX_TOP = 128;
export const CODEX_BOTTOM = 956;
export const CODEX_XS = [1675, 1435, 1205, 975] as const;
export const CODEX_BLOCK: [number, number] = [825, 1775];
export const INI = { x: 1620, y: 262, r: 132 };
export const VINE_X = 765;
export const VINE_BOX = [VINE_X - 120, CODEX_TOP - 80, 240, CODEX_BOTTOM + 36 - (CODEX_TOP - 80)] as const;

/** Left Typefounder's Proportion Square (`x = 138..522, y = 132..516`), centered above the (330, 800) seal. */
export const SPEC_BOX = { x: 138, y: 132, w: 384, h: 384 };
export const SPEC_FIELD = { x: 138, y: 132, s: 384 };

interface Band {
  pts: P[];
  fill: string;
}
interface Crossing {
  band: number;
  at: number;
}

export function roundSquare(cx: number, cy: number, r: number, q: number, h: number): { p: P; n: P }[] {
  const flat = 2 * (r - q), arc = (Math.PI / 2) * q, side = flat + arc, L = 4 * side;
  const out: { p: P; n: P }[] = [];
  const m = Math.round(L / h);
  for (let i = 0; i < m; i++) {
    const s = (i / m) * L, k = Math.floor(s / side), u = s - k * side;
    let lx: number, ly: number, nx: number, ny: number;
    if (u < flat) { lx = -r + q + u; ly = -r; nx = 0; ny = -1; }
    else {
      const a = -Math.PI / 2 + (u - flat) / q;
      lx = r - q + Math.cos(a) * q; ly = -r + q + Math.sin(a) * q; nx = Math.cos(a); ny = Math.sin(a);
    }
    for (let j = 0; j < k; j++) { [lx, ly] = [-ly, lx]; [nx, ny] = [-ny, nx]; }
    out.push({ p: [cx + lx, cy + ly], n: [nx, ny] });
  }
  return out;
}

function segX(a: P, b: P, c: P, d: P): boolean {
  const d1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
  const d3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]);
  const d4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function buildKnot(): { bands: Band[]; over: Crossing[] } {
  const ring = roundSquare(INI.x, INI.y, INI.r - 22, 30, 2);
  const N = 16, A = 11;
  const strand = (sg: number): P[] =>
    ring.map(({ p, n }, i) => {
      const o = sg * A * Math.sin((2 * Math.PI * N * i) / ring.length);
      return [p[0] + n[0] * o, p[1] + n[1] * o];
    });
  const bands: Band[] = [{ pts: strand(1), fill: RED }, { pts: strand(-1), fill: INK }];
  for (let k = 0; k < 4; k++) {
    const ang = Math.PI / 4 + (k * Math.PI) / 2;
    const cx = INI.x + Math.cos(ang) * (INI.r - 22) * 1.2, cy = INI.y + Math.sin(ang) * (INI.r - 22) * 1.2;
    const rot = ang + Math.PI / 2, pts: P[] = [];
    for (let i = 0; i < 110; i++) {
      const t = (2 * Math.PI * i) / 110;
      const x = (Math.sin(t) + 2 * Math.sin(2 * t)) * 12, y = (Math.cos(t) - 2 * Math.cos(2 * t)) * 12;
      pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    bands.push({ pts, fill: RED });
  }
  const hits: { a: number; i: number; b: number; j: number }[] = [];
  for (let a = 0; a < bands.length; a++) {
    for (let b = a; b < bands.length; b++) {
      const pa = bands[a]!.pts, pb = bands[b]!.pts;
      for (let i = 0; i < pa.length; i++) {
        for (let j = a === b ? i + 4 : 0; j < pb.length; j++) {
          if (a === b && j - i > pa.length - 4) continue;
          if (segX(pa[i]!, pa[(i + 1) % pa.length]!, pb[j]!, pb[(j + 1) % pb.length]!)) hits.push({ a, i, b, j });
        }
      }
    }
  }
  const visits = hits.flatMap((h, k) => [{ k, v: 0, band: h.a, at: h.i }, { k, v: 1, band: h.b, at: h.j }]);
  const top = hits.map(() => -1);
  for (let band = 0; band < bands.length; band++) {
    let up = true;
    for (const x of visits.filter((x) => x.band === band).sort((p, q) => p.at - q.at)) {
      if (top[x.k]! < 0) top[x.k] = up ? x.v : 1 - x.v;
      up = top[x.k] !== x.v;
    }
  }
  const over = hits.map((h, k) => (top[k] === 0 ? { band: h.a, at: h.i } : { band: h.b, at: h.j }));
  return { bands, over };
}

function polyline(c: CanvasRenderingContext2D, pts: P[], from: number, to: number, closed: boolean) {
  const n = pts.length;
  c.beginPath();
  for (let i = from; i <= to; i++) {
    const p = pts[closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))]!;
    if (i === from) c.moveTo(p[0], p[1]);
    else c.lineTo(p[0], p[1]);
  }
  if (closed && from === 0 && to === n - 1) c.closePath();
}

const BW = 7;
export function drawKnot(c: CanvasRenderingContext2D, k: { bands: Band[]; over: Crossing[] }) {
  // Inner 12x12 modernist snap grid inside the initial box
  const ir = INI.r - 34;
  c.strokeStyle = tone(0.86);
  c.lineWidth = 0.8;
  for (let i = 0; i <= 6; i++) {
    const o = -ir + (2 * ir * i) / 6;
    c.beginPath();
    c.moveTo(INI.x + o, INI.y - ir);
    c.lineTo(INI.x + o, INI.y + ir);
    c.moveTo(INI.x - ir, INI.y + o);
    c.lineTo(INI.x + ir, INI.y + o);
    c.stroke();
  }
  c.lineJoin = 'round';
  for (const b of k.bands) {
    polyline(c, b.pts, 0, b.pts.length - 1, true);
    c.strokeStyle = INK;
    c.lineWidth = BW + 3;
    c.stroke();
    c.strokeStyle = b.fill;
    c.lineWidth = BW;
    c.stroke();
  }
  c.lineCap = 'butt';
  for (const o of k.over) {
    const b = k.bands[o.band]!;
    polyline(c, b.pts, o.at - 7, o.at + 8, true);
    c.strokeStyle = PAPER;
    c.lineWidth = BW + 9;
    c.stroke();
    c.strokeStyle = INK;
    c.lineWidth = BW + 3;
    c.stroke();
    c.strokeStyle = b.fill;
    c.lineWidth = BW;
    c.stroke();
  }
}

// ---------- Marginalia Vine, Snail & Bird ----------

export interface Sprig {
  at: number;
  pts: P[];
  leaf: P[] | null;
  berries: P[];
}

export function buildVine(): { stem: P[]; sprigs: Sprig[] } {
  const stem: P[] = [];
  for (let y = CODEX_BOTTOM + 20; y >= CODEX_TOP - 20; y -= 3) {
    stem.push([VINE_X + 12 * Math.sin((CODEX_BOTTOM - y) / 50), y]);
  }
  const sprigs: Sprig[] = [];
  for (let k = 0, at = 38; at < (stem.length - 6) * 3; k++, at += 62) {
    const i = Math.round(at / 3), [sx, sy] = stem[i]!;
    const side = k % 2 ? 1 : -1;
    const pts: P[] = [[sx, sy]];
    let a = -Math.PI / 2 + side * 1.08, x = sx, y = sy;
    const L = 46 + 14 * Math.sin(k * 2.3);
    for (let s = 0; s < L; s += 2) {
      a -= side * (0.02 + 0.2 * (s / L) ** 2.2);
      x += Math.cos(a) * 2;
      y += Math.sin(a) * 2;
      pts.push([x, y]);
    }
    const mid = pts[Math.floor(pts.length * 0.45)]!;
    let leaf: P[] | null = null;
    const berries: P[] = [];
    if (k % 3 === 2) {
      for (let b = 0; b < 3; b++) berries.push([mid[0] + side * (8 + 6 * b), mid[1] - 6 + (b % 2) * 9]);
    } else {
      const la = -Math.PI / 2 + side * 1.6, lx = Math.cos(la), ly = Math.sin(la);
      leaf = [];
      for (let s = 0; s <= 1.0001; s += 0.1) leaf.push([mid[0] + lx * s * 24 - ly * 7 * Math.sin(Math.PI * s), mid[1] + ly * s * 24 + lx * 7 * Math.sin(Math.PI * s)]);
      for (let s = 1; s >= -0.0001; s -= 0.1) leaf.push([mid[0] + lx * s * 24 + ly * 7 * Math.sin(Math.PI * s), mid[1] + ly * s * 24 - lx * 7 * Math.sin(Math.PI * s)]);
    }
    sprigs.push({ at, pts, leaf, berries });
  }
  return { stem, sprigs };
}

function strokePts(c: CanvasRenderingContext2D, pts: P[], w: number) {
  c.lineWidth = w;
  polyline(c, pts, 0, pts.length - 1, false);
  c.stroke();
}

export function drawSnail(c: CanvasRenderingContext2D, x: number, y: number) {
  c.strokeStyle = INK;
  c.fillStyle = tone(0.88);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(x - 52, y + 11);
  c.quadraticCurveTo(x - 20, y + 1, x + 10, y);
  c.quadraticCurveTo(x + 30, y - 2, x + 38, y - 12);
  c.quadraticCurveTo(x + 48, y - 20, x + 54, y - 8);
  c.quadraticCurveTo(x + 58, y + 2, x + 50, y + 8);
  c.quadraticCurveTo(x + 40, y + 13, x + 10, y + 13);
  c.quadraticCurveTo(x - 25, y + 13, x - 52, y + 11);
  c.closePath();
  c.fill();
  c.lineWidth = 1.8;
  c.stroke();
  strokePts(c, [[x + 42, y - 14], [x + 42, y - 26], [x + 39, y - 36]], 1.6);
  strokePts(c, [[x + 49, y - 14], [x + 54, y - 25], [x + 58, y - 33]], 1.6);
  c.fillStyle = RED;
  c.beginPath();
  c.arc(x + 39, y - 37, 2.8, 0, Math.PI * 2);
  c.arc(x + 58.5, y - 34, 2.8, 0, Math.PI * 2);
  c.fill();
  const sx = x - 6, sy = y - 18, R = 26;
  c.fillStyle = tone(0.94);
  c.beginPath();
  c.arc(sx, sy, R, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 2;
  c.stroke();
  const coil: P[] = [];
  const turns = 2.6;
  for (let a = 0; a <= turns * Math.PI * 2; a += 0.08) {
    const r = R * (1 - a / (turns * Math.PI * 2)) ** 1.15;
    coil.push([sx + 2 + Math.cos(a + 1.2) * r * 0.98, sy - 1 + Math.sin(a + 1.2) * r * 0.98]);
  }
  strokePts(c, coil, 1.4);
}

function drawBird(c: CanvasRenderingContext2D, x: number, y: number) {
  c.save();
  c.translate(x - 10, y - 6);
  c.scale(1.38, 1.38);
  c.translate(-(x - 10), -(y - 6));
  const body: P[] = [];
  for (let a = Math.PI * 0.95; a < Math.PI * 2.15; a += 0.08) {
    body.push([x + Math.cos(a) * 18, y + Math.sin(a) * 10 * (a < Math.PI * 1.5 ? 1.2 : 0.9)]);
  }
  c.fillStyle = tone(0.92);
  c.beginPath();
  body.forEach(([px, py], i) => (i === 0 ? c.moveTo(px, py) : c.lineTo(px, py)));
  c.lineTo(x + 17, y + 1);
  c.quadraticCurveTo(x + 4, y + 10, x - 17, y + 2);
  c.closePath();
  c.fill();
  c.strokeStyle = INK;
  strokePts(c, body, 2.0);
  strokePts(c, [[x - 17, y + 2], [x + 4, y + 9], [x + 17, y + 1]], 2.0);
  strokePts(c, [[x + 16, y - 4], [x + 26, y - 16], [x + 31, y - 25]], 1.8);
  c.fillStyle = RED;
  c.beginPath();
  c.moveTo(x - 18, y - 3);
  c.lineTo(x - 28, y - 1);
  c.lineTo(x - 18, y + 2);
  c.closePath();
  c.fill();
  strokePts(c, [[x - 18, y - 3], [x - 28, y - 1], [x - 18, y + 2]], 1.5);
  c.strokeStyle = RED;
  strokePts(c, [[x - 6, y - 4], [x + 8, y - 6], [x + 14, y - 2]], 1.6);
  c.strokeStyle = INK;
  strokePts(c, [[x - 3, y + 8], [x - 5, y + 18]], 1.5);
  strokePts(c, [[x + 4, y + 8], [x + 3, y + 18]], 1.5);
  c.fillStyle = RED;
  c.beginPath();
  c.arc(x - 11, y - 3, 2.2, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

export function drawMarginalia(c: CanvasRenderingContext2D, vine: { stem: P[]; sprigs: Sprig[] }, sung: number, total: number) {
  const { stem, sprigs } = vine;
  const fullSteps = Math.max(1, total - 3);
  const grown = Math.min(1, sung / fullSteps) * stem.length * 3;
  if (grown <= 0) return;
  c.strokeStyle = INK;
  c.fillStyle = INK;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  strokePts(c, stem.slice(0, Math.max(2, Math.floor(grown / 3))), 2.4);
  for (const sp of sprigs) {
    if (sp.at > grown) break;
    c.strokeStyle = INK;
    strokePts(c, sp.pts, 1.5);
    if (sp.leaf) {
      c.fillStyle = tone(0.9);
      polyline(c, sp.leaf, 0, sp.leaf.length - 1, false);
      c.closePath();
      c.fill();
      c.lineWidth = 1.3;
      c.stroke();
      const n = sp.leaf.length >> 1;
      strokePts(c, [sp.leaf[0]!, sp.leaf[n - 1]!], 0.9);
    }
    c.fillStyle = RED;
    for (const b of sp.berries) {
      c.beginPath();
      c.arc(b[0], b[1], 4, 0, Math.PI * 2);
      c.fill();
    }
    // Modernist joint node at the stem attachment
    c.fillStyle = INK;
    c.fillRect(sp.pts[0]![0] - 2.5, sp.pts[0]![1] - 2.5, 5, 5);
  }
  if (sung >= fullSteps) drawBird(c, stem[stem.length - 1]![0] - 8, CODEX_TOP - 44);
}

// ---------- Left Typefounder's Proportion Square (Renaissance / Modernist 12×12 Grid) ----------

/** Static architectural frame of the left Typefounder's Square (baked onto the base layer). */
export function drawSpecimenBase(c: CanvasRenderingContext2D) {
  const sf = SPEC_FIELD;
  const cx = sf.x + sf.s / 2, cy = sf.y + sf.s / 2;

  // Vellum field and outer double rule
  c.fillStyle = tone(0.95);
  c.fillRect(sf.x, sf.y, sf.s, sf.s);
  c.strokeStyle = tone(0.45);
  c.lineWidth = 1.6;
  c.strokeRect(sf.x - 8, sf.y - 8, sf.s + 16, sf.s + 16);

  // 12×12 modernist snap grid with ruler ticks along top and left edges
  c.strokeStyle = tone(0.84);
  c.lineWidth = 0.8;
  for (let i = 1; i < 12; i++) {
    const gx = sf.x + (sf.s * i) / 12;
    const gy = sf.y + (sf.s * i) / 12;
    c.beginPath();
    c.moveTo(gx, sf.y);
    c.lineTo(gx, sf.y + sf.s);
    c.moveTo(sf.x, gy);
    c.lineTo(sf.x + sf.s, gy);
    c.stroke();
  }
  c.strokeStyle = tone(0.55);
  c.lineWidth = 1;
  for (let i = 0; i <= 12; i++) {
    const gx = sf.x + (sf.s * i) / 12;
    const gy = sf.y + (sf.s * i) / 12;
    const tk = i % 3 === 0 ? 7 : 4;
    c.beginPath();
    c.moveTo(gx, sf.y - 8);
    c.lineTo(gx, sf.y - 8 + tk);
    c.moveTo(sf.x - 8, gy);
    c.lineTo(sf.x - 8 + tk, gy);
    c.stroke();
  }

  // Inscribed proportion circle and diagonal guides (Pacioli / Tory typeconstruction geometry)
  c.save();
  c.strokeStyle = tone(0.76);
  c.lineWidth = 0.9;
  c.beginPath();
  c.arc(cx, cy, sf.s / 2 - 28, 0, Math.PI * 2);
  c.stroke();
  c.setLineDash([4, 4]);
  c.strokeStyle = tone(0.68);
  c.beginPath();
  c.moveTo(cx, sf.y);
  c.lineTo(cx, sf.y + sf.s);
  c.moveTo(sf.x, cy);
  c.lineTo(sf.x + sf.s, cy);
  c.moveTo(sf.x, sf.y);
  c.lineTo(sf.x + sf.s, sf.y + sf.s);
  c.moveTo(sf.x + sf.s, sf.y);
  c.lineTo(sf.x, sf.y + sf.s);
  c.stroke();
  c.restore();

  // Crisp inner frame and corner registration crosshairs
  c.strokeStyle = INK;
  c.lineWidth = 1.4;
  c.strokeRect(sf.x, sf.y, sf.s, sf.s);
  for (const [rx, ry] of [[sf.x - 8, sf.y - 8], [sf.x + sf.s + 8, sf.y - 8], [sf.x - 8, sf.y + sf.s + 8], [sf.x + sf.s + 8, sf.y + sf.s + 8]] as const) {
    c.strokeStyle = INK;
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(rx - 7, ry);
    c.lineTo(rx + 7, ry);
    c.moveTo(rx, ry - 7);
    c.lineTo(rx, ry + 7);
    c.stroke();
  }

  // Vertical plumb line down to the (330, 800) seal
  c.strokeStyle = tone(0.74);
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(cx, sf.y + sf.s + 8);
  c.lineTo(cx, 660);
  c.moveTo(cx - 10, 660);
  c.lineTo(cx + 10, 660);
  c.stroke();
}

export interface SpecimenGlyph {
  ch: string;
  sk: Skel[];
  strokes: PStroke[];
  spans: [number, number][];
  t0: number;
  dur: number;
  unitIdx: number;
  lineIdx: number;
  red: boolean;
  /** The snakes that build it (assemble), timed to its unit. */
  built: Built;
}

/**
 * Draw the active glyph inside the Specimen Box with its 4 era synthesis callouts,
 * or punch the monumental `人生` cut-out onto the red substrate during the a cappella climax (`t >= jinseiT0`).
 */
export function drawSpecimenLive(
  c: CanvasRenderingContext2D,
  active: SpecimenGlyph | null,
  jinsei: { jin: PStroke[]; sei: PStroke[]; tJin: number; tSei: number; dur: number },
  t: number,
) {
  const sf = SPEC_FIELD;
  const pad = 28;
  const boxEm = sf.s - pad * 2;
  const ox = sf.x + pad, oy = sf.y + pad;

  // A cappella climax (いたかった人生): punch the Proportion Square open onto the RED substrate,
  // with 人 (at tJin) and 生 (at tSei) carved in vellum over the red hole!
  if (t >= jinsei.tJin) {
    const hasSei = t >= jinsei.tSei;
    const holeH = hasSei ? sf.s - 12 : (sf.s - 12) / 2;

    // 1. Cut the Proportion Square open onto the living RED substrate
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    c.fillRect(sf.x + 6, sf.y + 6, sf.s - 12, holeH);
    c.restore();

    // 2. Write 人 and 生 in PAPER vellum over the red substrate hole as they are sung
    c.save();
    c.fillStyle = PAPER;
    writeStrokes(c, jinsei.jin, (t - jinsei.tJin) / jinsei.dur, 168);
    if (hasSei) {
      writeStrokes(c, jinsei.sei, (t - jinsei.tSei) / jinsei.dur, 168);
    }
    c.restore();

    // 3. Crisp ink border around the cut-out
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.strokeRect(sf.x + 6, sf.y + 6, sf.s - 12, holeH);
    return;
  }

  if (!active) return;
  const p = Math.min(1, Math.max(0, (t - active.t0) / active.dur));
  const kScale = boxEm / 109;

  // 1. Blueprint outline of all strokes + skeleton centerlines & snapped grid joints
  c.save();
  c.strokeStyle = tone(0.64);
  c.lineWidth = 1.1;
  for (const st of active.strokes) {
    for (const path of st.full) c.stroke(path);
  }
  c.strokeStyle = tone(0.76);
  c.lineWidth = 1;
  for (const sk of active.sk) {
    if (!sk.pts.length) continue;
    c.beginPath();
    c.moveTo(ox + sk.pts[0]![0] * kScale, oy + sk.pts[0]![1] * kScale);
    for (let i = 1; i < sk.pts.length; i++) {
      c.lineTo(ox + sk.pts[i]![0] * kScale, oy + sk.pts[i]![1] * kScale);
    }
    c.stroke();
    for (const [jx, jy] of sk.joints) {
      c.strokeStyle = tone(0.56);
      c.strokeRect(ox + jx * kScale - 3, oy + jy * kScale - 3, 6, 6);
    }
  }

  // 2. The strokes slither in from beyond the square and build the glyph (red for rubricated headwords, ink otherwise)
  c.save();
  c.beginPath();
  c.rect(sf.x, sf.y, sf.s, sf.s);
  c.clip();
  PLOT.draw(c, active.strokes, active.built, t, active.red ? RED : INK);
  c.restore();

  // 3. Construction marks on each begun stroke: the snapped joints, the pen-down cross, the square cut at its end
  active.strokes.forEach((st, idx) => {
    if (st.len < 0.5) return;
    const sn = active.built.snakes[idx]!;
    if (t < sn.start + FLY / 2) return;

    const sx0 = st.x[0]!, sy0 = st.y[0]!;
    const n = st.x.length - 1;
    const sk = active.sk[st.of!]!;

    // Red snapped joint nodes along the stroke
    c.fillStyle = RED;
    for (const [jx, jy] of sk.joints) {
      c.fillRect(ox + jx * kScale - 3, oy + jy * kScale - 3, 6, 6);
    }

    // The pen-down cross at the stroke's origin
    c.strokeStyle = RED;
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(sx0 - 9, sy0);
    c.lineTo(sx0 + 9, sy0);
    c.moveTo(sx0, sy0 - 9);
    c.lineTo(sx0, sy0 + 9);
    c.stroke();

    // The square cut: a tick across the end once the stroke is down
    if (t >= sn.land) {
      const dx = st.x[n]! - st.x[Math.max(0, n - 2)]!, dy = st.y[n]! - st.y[Math.max(0, n - 2)]!, l = Math.hypot(dx, dy) || 1;
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(st.x[n]! - (dy / l) * 11, st.y[n]! + (dx / l) * 11);
      c.lineTo(st.x[n]! + (dy / l) * 11, st.y[n]! - (dx / l) * 11);
      c.stroke();
    }
  });

  // 4. True small marks at the foot of the square: U+hex, stroke progress, line.unit
  const hex = active.ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
  const real = active.strokes.filter((s) => s.len >= 0.5);
  const curStroke = active.spans.filter(([a], i) => p >= a && active.strokes[i]!.len >= 0.5).length;
  c.fillStyle = tone(0.32);
  c.font = fnt(MONO, 12, 500);
  c.textAlign = 'left';
  c.textBaseline = 'top';
  c.fillText(`U+${hex} · ${curStroke}/${real.length}`, sf.x, sf.y + sf.s + 14);
  c.textAlign = 'right';
  c.fillText(`${active.lineIdx}.${String(active.unitIdx).padStart(2, '0')}`, sf.x + sf.s, sf.y + sf.s + 14);
  c.restore();
}

// ---------- palimpsest ----------

/** One stroke written so far: `frac` of its length; `g` a stable index for its scrape marks. */
export interface Written {
  st: PStroke;
  frac: number;
  g: number;
}

function askew(c: CanvasRenderingContext2D, a: number) {
  c.translate(W / 2, H / 2);
  c.rotate(a);
  c.translate(-W / 2, -H / 2);
}

function ghosts(c: CanvasRenderingContext2D, L: Lyrics) {
  c.globalCompositeOperation = 'darken';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
  };
  {
    const g = glyphs(L, 0, 3), cell = 64, cols = 12, rows = 14, x0 = 1060, y0 = 74;
    c.save();
    askew(c, -0.012);
    c.strokeStyle = tone(0.87);
    c.lineWidth = 1.5;
    for (let i = 0; i <= cols; i++) line(x0 + i * cell, y0, x0 + i * cell, y0 + rows * cell);
    for (let j = 0; j <= rows; j++) line(x0, y0 + j * cell, x0 + cols * cell, y0 + j * cell);
    c.fillStyle = tone(0.82);
    c.font = fnt(SERIF, 50, 800);
    let k = 0;
    for (let i = cols - 1; i >= 0; i--) for (let j = 0; j < rows; j++) c.fillText(g[k++ % g.length]!, x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell);
    c.restore();
  }
  {
    const g = glyphs(L, 4, 11), pitch = 46, x0 = 1460, y0 = 120;
    c.save();
    askew(c, 0.018);
    c.font = fnt(SERIF, 36, 400);
    let k = 0;
    for (let col = 0; col < 16; col++) {
      for (let j = 0; j < 19; j++, k++) {
        c.fillStyle = tone(0.78 + 0.1 * hash(k * 3.1));
        c.fillText(g[k % g.length]!, x0 - col * pitch + (hash(k) - 0.5) * 3, y0 + j * 44 + (hash(k + 0.5) - 0.5) * 4);
      }
    }
    c.restore();
  }
  {
    const g = glyphs(L, 29, 36);
    c.save();
    askew(c, -0.02);
    c.font = fnt(SANS, 170, 900);
    let k = 0;
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 5; i++, k++) {
        const x = 850 + i * 190, y = 300 + r * 230, ch = g[(k * 5) % g.length]!;
        c.fillStyle = tone(0.89);
        c.fillText(ch, x, y);
        c.fillStyle = tone(0.86);
        c.fillText(ch, x + 9, y + 5);
      }
    }
    c.restore();
  }
  c.globalCompositeOperation = 'source-over';
}

export class Palimpsest {
  private traces = canvas2D();
  private scratch = canvas2D();

  constructor(L: Lyrics) {
    ghosts(this.traces.c, L);
  }

  draw(c: CanvasRenderingContext2D, written: Written[], share: number, em: number) {
    if (share >= 1) return;
    const k = this.scratch.c;
    k.clearRect(0, 0, W, H);
    k.drawImage(this.traces.el, 0, 0, W, H);
    k.save();
    k.globalCompositeOperation = 'destination-out';
    k.strokeStyle = '#000';
    k.lineCap = 'round';
    k.lineJoin = 'round';
    for (const { st, frac, g } of written) {
      const upto = frac * st.len, m = sampleAt(st, upto);
      k.globalAlpha = 0.9;
      k.lineWidth = em * 1.05;
      k.beginPath();
      k.moveTo(st.x[0]!, st.y[0]!);
      for (let i = 1; i <= m; i++) k.lineTo(st.x[i]!, st.y[i]!);
      if (m === 0) k.lineTo(st.x[0]! + 0.1, st.y[0]!);
      k.stroke();
      for (let j = 0; j * 12 <= upto; j++) {
        const i = sampleAt(st, j * 12), h = (v: number) => hash(g * 131.7 + j * 7.3 + v);
        const a = -0.55 + 0.3 * h(1), len = em * (0.7 + 1.1 * h(2));
        const ox = st.x[i]! + (h(3) - 0.5) * em, oy = st.y[i]! + (h(4) - 0.5) * em;
        k.globalAlpha = 0.3 + 0.5 * h(5);
        k.lineWidth = 2 + 6 * h(6);
        k.beginPath();
        k.moveTo(ox - Math.cos(a) * len / 2, oy - Math.sin(a) * len / 2);
        k.lineTo(ox + Math.cos(a) * len / 2, oy + Math.sin(a) * len / 2);
        k.stroke();
      }
    }
    k.restore();
    c.save();
    c.globalAlpha = 1 - share ** 3;
    c.drawImage(this.scratch.el, 0, 0, W, H);
    c.restore();
  }
}

// ---------- assembly: the strokes slither in ----------

const FPS = 12;
/** A snake's flight: 6 steps at 12 fps. */
const FLY = 6 / FPS;
/** Length of a snake's run in, in em; the wave along its body, in em. */
const RUN_IN = 2.5;

/** One stroke as a snake: its track is a run in along the line of the stroke's own first segment, then the stroke. */
interface Snake {
  x: Float32Array;
  y: Float32Array;
  /** Arc length at each track sample. */
  s: Float32Array;
  total: number;
  start: number;
  land: number;
}
export interface Built {
  /** Per stroke: its snake (null for a node). */
  snakes: (Snake | null)[];
  /** Per stroke: when a node pops (0 for a stroke). */
  pop: number[];
  /** Per stroke: when it has landed and turns to clean ink. */
  lock: number[];
}

/**
 * Plan the snakes of one unit. Each stroke comes in from outside along its own first direction, head first, and
 * its body is exactly the stroke when the head reaches the end: the stroke builds itself by travelling its own
 * path. A node pops as the head passes it.
 */
export function assemble(strokes: PStroke[], spans: [number, number][], t0: number, dur: number, em: number): Built {
  const snakes = strokes.map((st, k): Snake | null => {
    if (st.len < 0.5) return null;
    const land = t0 + spans[k]![1] * dur;
    const n = st.x.length;
    const j = Math.min(n - 1, 6);
    const dx = st.x[j]! - st.x[0]!, dy = st.y[j]! - st.y[0]!, l = Math.hypot(dx, dy) || 1;
    const run = RUN_IN * em, m = Math.ceil(run / 2);
    const x = new Float32Array(m + n), y = new Float32Array(m + n), s = new Float32Array(m + n);
    for (let i = 0; i < m; i++) {
      const f = 1 - i / m;
      x[i] = st.x[0]! - (dx / l) * run * f;
      y[i] = st.y[0]! - (dy / l) * run * f;
    }
    for (let i = 0; i < n; i++) {
      x[m + i] = st.x[i]!;
      y[m + i] = st.y[i]!;
    }
    for (let i = 1; i < m + n; i++) s[i] = s[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, y[i]! - y[i - 1]!);
    return { x, y, s, total: s[m + n - 1]!, start: land - FLY, land };
  });
  const pop = strokes.map((st, k) => {
    if (st.len >= 0.5) return 0;
    // the snake of the same skeleton stroke whose track passes nearest the node (units with several glyphs repeat the index)
    let owner: Snake | null = null, at = 0, best = Infinity;
    for (let q = 0; q < strokes.length; q++) {
      const sn = snakes[q];
      if (!sn || strokes[q]!.of !== st.of) continue;
      for (let i = 0; i < sn.s.length; i++) {
        const d = Math.hypot(sn.x[i]! - st.x[0]!, sn.y[i]! - st.y[0]!);
        if (d < best) { best = d; owner = sn; at = sn.s[i]!; }
      }
    }
    if (!owner) throw new Error(`assemble: node ${k} has no stroke ${st.of}`);
    // the head goes at a constant speed: it reaches this node at the fraction of the track where the node lies
    return owner.start + (at / owner.total) * FLY;
  });
  const lock = strokes.map((_, k) => (snakes[k] ? snakes[k]!.land + 1 / FPS : pop[k]! + 3 / FPS));
  return { snakes, pop, lock };
}

export class Assembly {
  draw(c: CanvasRenderingContext2D, strokes: PStroke[], b: Built, t: number, color = INK) {
    const tq = Math.floor(t * FPS + 1e-6) / FPS;
    c.fillStyle = color;
    c.strokeStyle = color;
    strokes.forEach((st, k) => {
      if (tq >= b.lock[k]!) {
        for (const p of st.full) c.fill(p);
        return;
      }
      const sn = b.snakes[k];
      if (sn) this.snake(c, st, sn, tq);
      else if (tq >= b.pop[k]!) this.node(c, st, Math.round((tq - b.pop[k]!) * FPS));
    });
  }

  /** A node pops: a step too large, a step a little large, then its size. */
  private node(c: CanvasRenderingContext2D, st: PStroke, step: number) {
    const k = step === 0 ? 1.7 : step === 1 ? 1.25 : 1;
    c.save();
    c.translate(st.x[0]!, st.y[0]!);
    c.scale(k, k);
    c.translate(-st.x[0]!, -st.y[0]!);
    for (const p of st.full) c.fill(p);
    c.restore();
  }

  /** The snake at time tq: the head at a constant speed along the track, the body as long as the stroke, rigid. */
  private snake(c: CanvasRenderingContext2D, st: PStroke, sn: Snake, tq: number) {
    const u = Math.min(1, (tq - sn.start) / FLY);
    if (u <= 0) return;
    const head = sn.total * u;
    const tail = Math.max(0, head - st.len);
    const n = sn.s.length;
    c.lineWidth = st.w[0]!;
    c.lineCap = 'butt';
    c.lineJoin = 'miter';
    c.beginPath();
    // the point at arc length s, between samples i and i + 1
    const put = (s: number, i: number, first: boolean) => {
      const i1 = Math.min(n - 1, i + 1), f = Math.min(1, Math.max(0, (s - sn.s[i]!) / Math.max(1e-6, sn.s[i1]! - sn.s[i]!)));
      const x = sn.x[i]! + (sn.x[i1]! - sn.x[i]!) * f, y = sn.y[i]! + (sn.y[i1]! - sn.y[i]!) * f;
      if (first) c.moveTo(x, y);
      else c.lineTo(x, y);
    };
    let i = 0;
    while (i < n - 1 && sn.s[i + 1]! <= tail) i++;
    put(tail, i, true);
    for (i += 1; i < n && sn.s[i]! < head; i++) put(sn.s[i]!, i, false);
    put(head, Math.max(0, i - 1), false);
    c.stroke();
  }
}


const PLOT = new Assembly();
