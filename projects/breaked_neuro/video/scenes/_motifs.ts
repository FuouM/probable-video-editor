// Motifs that recur across plates and must look the same everywhere: the first lyric "i" the title packs
// into, the tesseract, the head of a sliding line, the wireframe ceiling (Verse 2, and a red herring in the
// intro), the vortex of "without a destination" and the crumpled page (room's paper ball opens into atone's
// ledger page).
import { H, W } from '@pve/engine/gl';
import { mark } from '@pve/engine/marks';
import { clamp, ease, prog } from '@pve/engine/util';
import { BAR, BLUE, BOX_H, INK, PAPER, brickRect, bricks, gray, hashI, sylAt, type Syl, type SylLine } from './_kit';

/**
 * The first sung "i" (Verse 1, on the wall): the brick "i" (2x10 sub-cells, chamfered) at 4x4 micro-cells
 * per sub-cell: 288 slots. The 256 cells of BREAKED fill all but 32 of them; the 32 empty slots are holes
 * onto the blue. `m` is the micro-cell size in px, (x, y) the top-left where the intro delivers it at the cut.
 */
export const FIRST_I = { x: 1400, y: 178, m: 9 };
/** The 256 filled micro-cells of the first "i" in reading order (top to bottom, left to right). */
export const I_CELLS: { i: number; j: number }[] = (() => {
  const slots: { i: number; j: number }[] = [];
  for (const b of bricks('i').bricks) {
    for (let k = 0; k < b.len; k++) {
      for (let dj = 0; dj < 4; dj++) for (let di = 0; di < 4; di++) slots.push({ i: (b.cx + k) * 4 + di, j: b.cy * 4 + dj });
    }
  }
  // 32 holes, scattered by hash
  const holes = new Set<number>();
  for (let n = 0; holes.size < 32; n++) holes.add(Math.floor(hashI(n, 77) * slots.length));
  return slots.filter((_, n) => !holes.has(n)).sort((a, b) => a.j - b.j || a.i - b.i);
})();

/** Size of the first "i" in micro-cells. */
export const I_SIZE = { i: Math.max(...I_CELLS.map((p) => p.i)) + 1, j: Math.max(...I_CELLS.map((p) => p.j)) + 1 };

/** Draw the first "i" with its top-left at (x, y); `keep(k)` may drop cell k of I_CELLS. Marks `first-i` unless `markIt` is false. */
export function drawFirstI(c: CanvasRenderingContext2D, x: number, y: number, m = FIRST_I.m, keep?: (k: number) => boolean, markIt = true) {
  c.fillStyle = PAPER;
  I_CELLS.forEach((p, k) => { if (!keep || keep(k)) brickRect(c, x + p.i * m, y + p.j * m, 1, m, 0.14); });
  if (markIt) mark('first-i', x, y, I_SIZE.i * m, I_SIZE.j * m, c);
}

/** The 16 vertices of the 4-cube (±1 on every axis) and its 32 edges (vertex pairs one axis apart). */
const T_VERTS: number[][] = Array.from({ length: 16 }, (_, i) => [0, 1, 2, 3].map((b) => ((i >> b) & 1 ? 1 : -1)));
const T_EDGES: [number, number][] = [];
for (let i = 0; i < 16; i++) for (let b = 0; b < 4; b++) if (!(i & (1 << b))) T_EDGES.push([i, i | (1 << b)]);

/**
 * The tesseract (the abstract stand-in for "(i)"): a 4-cube turning in the XW and YW planes, projected to
 * 3D and then to the screen at (cx, cy), size `s` px; `deform` 0..1 bends its vertices with a slow wave.
 * Edges in paper; `width` px.
 */
export function tesseract(c: CanvasRenderingContext2D, cx: number, cy: number, s: number, t: number, deform = 0, width = 3, edgeReveal = 1) {
  if (edgeReveal <= 0) return;
  const a = t * 0.9, b = t * 0.55, e = t * 0.3;
  const pts = T_VERTS.map((v, i) => {
    let [x, y, z, w] = v as [number, number, number, number];
    if (deform > 0) {
      const k = deform * 0.35;
      x += Math.sin(t * 2.1 + i * 1.7) * k; y += Math.sin(t * 1.7 + i * 2.3) * k; w += Math.sin(t * 1.3 + i) * k;
    }
    [x, w] = [x * Math.cos(a) - w * Math.sin(a), x * Math.sin(a) + w * Math.cos(a)];
    [y, w] = [y * Math.cos(b) - w * Math.sin(b), y * Math.sin(b) + w * Math.cos(b)];
    [x, z] = [x * Math.cos(e) - z * Math.sin(e), x * Math.sin(e) + z * Math.cos(e)];
    const p4 = 1 / (3 - w); // 4D to 3D
    const X = x * p4, Y = y * p4, Z = z * p4;
    const p3 = 1 / (2.2 - Z); // 3D to the screen
    return [cx + X * p3 * s, cy + Y * p3 * s] as [number, number];
  });
  c.strokeStyle = PAPER;
  c.lineWidth = width;
  c.beginPath();
  T_EDGES.forEach(([i, j], ei) => {
    const ep = Math.min(1, Math.max(0, (edgeReveal * 1.4) - (ei / T_EDGES.length) * 0.4));
    if (ep <= 0) return;
    const [x0, y0] = pts[i]!, [x1, y1] = pts[j]!;
    c.moveTo(x0, y0);
    c.lineTo(x0 + (x1 - x0) * ep, y0 + (y1 - y0) * ep);
  });
  c.stroke();
  c.fillStyle = PAPER;
  pts.forEach(([x, y], vi) => {
    if (edgeReveal * 1.2 >= vi / pts.length) c.fillRect(x - width, y - width, width * 2, width * 2);
  });
}

/**
 * x of the strip origin that keeps the sung position of a line at headX. The head eases through each
 * syllable; with `glide` it runs at a steady speed from one syllable's start to the next's instead.
 */
export function headOffset(sl: SylLine, t: number, headX: number, cell: number, glide = false) {
  const k = Math.max(0, sylAt(sl, t));
  const cur = sl.syls[k]!;
  const [a, b] = sl.ranges[k]!;
  const xa = sl.bt.charX[a]!, xb = sl.bt.charX[b - 1]! + sl.bt.charW[b - 1]!;
  if (!glide) return headX - (xa + (xb - xa) * prog(t, cur.start, cur.end, ease.outCubic)) * cell;
  const next = sl.syls[k + 1];
  const xn = next ? sl.bt.charX[sl.ranges[k + 1]![0]]! : xb;
  return headX - (xa + (xn - xa) * prog(t, cur.start, next ? next.start : cur.end)) * cell;
}

/** Projection of a ceiling point (x, z) in tile units, `drop` units below the plane, to [screen x, screen y, depth]. */
export type CeilProj = (x: number, z: number, drop?: number) => [number, number, number];

/** The projection of the ceiling at t, seen from (cx, cy) with pitch 0..1 (see ceilingGrid). */
export function ceilingProj(t: number, cx: number, cy: number, pitch: number): CeilProj {
  const yaw = t * 0.08;
  const pa = 0.5 + pitch * 0.6;
  const f = 820, h = 3;
  return (x, z, drop = 0) => {
    const xr = x * Math.cos(yaw) - z * Math.sin(yaw), zr = x * Math.sin(yaw) + z * Math.cos(yaw);
    const hh = h - drop;
    const yc = hh * Math.cos(pa) - zr * Math.sin(pa);
    const zc = hh * Math.sin(pa) + zr * Math.cos(pa);
    return [cx + (xr / zc) * f, cy - (yc / zc) * f, zc];
  };
}

/**
 * A wireframe ceiling grid seen from below, slowly turning. (cx, cy) screen centre, pitch 0..1, line width.
 * Returns the projection of the ceiling (see CeilProj).
 */
export function ceilingGrid(c: CanvasRenderingContext2D, t: number, cx: number, cy: number, pitch: number, lw: number, span = 12): CeilProj {
  const proj = ceilingProj(t, cx, cy, pitch);
  const seg = (x0: number, z0: number, x1: number, z1: number) => {
    const N = 24;
    c.beginPath();
    let pen = false;
    for (let i = 0; i <= N; i++) {
      const [sx, sy, sz] = proj(x0 + ((x1 - x0) * i) / N, z0 + ((z1 - z0) * i) / N);
      if (sz < 0.3) { pen = false; continue; }
      if (pen) c.lineTo(sx, sy); else { c.moveTo(sx, sy); pen = true; }
    }
    c.stroke();
  };
  c.strokeStyle = PAPER;
  c.lineWidth = lw;
  for (let i = -span; i <= span; i++) { seg(i, -span, i, span); seg(-span, i, span, i); }
  return proj;
}

const TREE_WORDS = [
  'mirror', 'walls', 'shadow', 'ceiling', 'dust', 'demon', 'signal', 'void',
  'nowhere', 'light', 'sight', 'despair', 'falling', 'atone', 'broken', 'fake',
  'alone', 'static', 'error', 'escape', 'return', 'blind', 'hollow', 'silence',
];
const FALLBACK_SYLS = ['went', 'on', 'with', 'out', 'a', 'des', 'ti', 'na', 'tion'];

/**
 * Game tree for "went on without a destination": the current "correct" sung syllable sits at the center (cx, cy);
 * as each syllable is sung, the camera pans along the winning blue branch to center the new syllable node,
 * while dual upper/lower and forward branches sprout into candidate nodes holding random words, spilling
 * out over the letterbox bars. Near the frame edge every node and edge fades out (see edgeFade), so nothing
 * is cut off there.
 */
export interface TreeAudioReact {
  drumHits: number;
}

/** px over which the tree fades out toward the frame edge */
const EDGE_FADE = 160;
/** Alpha of a tree item at (x, y): 1 inside, 0 at the nearest frame edge, linear over the last EDGE_FADE px. */
const edgeFade = (x: number, y: number) => clamp(Math.min(x, W - x, y, H - y) / EDGE_FADE);

/** A '#rrggbb' or 'rgba(r,g,b,a)' colour at alpha `a`. */
const tint = (col: string, a: number) => col[0] === '#'
  ? `rgba(${parseInt(col.slice(1, 3), 16)},${parseInt(col.slice(3, 5), 16)},${parseInt(col.slice(5, 7), 16)},${a})`
  : col.replace(/[\d.]+\)$/, `${a})`);


export function vortex(
  c: CanvasRenderingContext2D, age0: number, tf: number, cx: number, cy: number, amt: number, overBars = false,
  slOrSyls?: SylLine | readonly Syl[],
  audioReact?: TreeAudioReact,
) {
  if (amt <= 0.01) return;
  const syls: readonly Syl[] | null = slOrSyls ? ('syls' in slOrSyls ? slOrSyls.syls : slOrSyls) : null;
  const sylTexts = syls && syls.length > 0 ? syls.map((s) => s.text.toLowerCase()) : FALLBACK_SYLS;
  const nSyls = sylTexts.length;
  let stepPos = 0;
  if (syls && syls.length > 0) {
    for (let i = 0; i < syls.length; i++) {
      const s = syls[i]!;
      if (tf >= s.start) {
        const nextT = syls[i + 1]?.start ?? (s.end + 0.25);
        const trans = Math.min(0.18, Math.max(0.06, (nextT - s.start) * 0.45));
        stepPos = i - 1 + ease.outCubic(Math.min(1, Math.max(0, (tf - s.start) / trans)));
      }
    }
    stepPos = Math.max(0, stepPos);
  } else {
    stepPos = Math.max(0, age0 * 3.2);
  }

  const spineXY = (k: number): [number, number] => [
    k * 360,
    Math.sin(k * 1.7 + 0.4) * 95,
  ];
  const k0 = Math.floor(stepPos), frac = stepPos - k0;
  const [p0x, p0y] = spineXY(k0), [p1x, p1y] = spineXY(k0 + 1);
  const camX = p0x + (p1x - p0x) * frac;
  const camY = p0y + (p1y - p0y) * frac;
  const toScreen = (wx: number, wy: number): [number, number] => [cx + (wx - camX), cy + (wy - camY)];

  /**
   * Style for `col` with its alpha running a0 at (x0, y0) to a1 at (x1, y1) (one alpha if they match). A
   * fading blue is cut as a hole onto the blue ground instead: a blue tint over the black would print black,
   * a hole prints as blue dots that thin out like everything else.
   */
  const fadeStyle = (col: string, a0: number, a1 = a0, x0 = 0, y0 = 0, x1 = 0, y1 = 0): string | CanvasGradient => {
    const hole = col === BLUE && Math.min(a0, a1) < 1;
    c.globalCompositeOperation = hole ? 'destination-out' : 'source-over';
    const ink = hole ? INK : col;
    if (Math.abs(a1 - a0) < 0.01) return a0 >= 1 ? ink : tint(ink, a0);
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, tint(ink, a0));
    g.addColorStop(1, tint(ink, a1));
    return g;
  };

  const drawArrowEdge = (x0: number, y0: number, x1: number, y1: number, active: boolean, reach = 1, reactive = false) => {
    if (reach <= 0.02) return;
    const ex = x0 + (x1 - x0) * reach, ey = y0 + (y1 - y0) * reach;
    const a0 = edgeFade(x0, y0), a1 = edgeFade(ex, ey);
    if (a0 <= 0 && a1 <= 0) return;
    const dx = ex - x0, dy = ey - y0, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const line = (col: string, width: number) => {
      c.strokeStyle = fadeStyle(col, a0, a1, x0, y0, ex, ey);
      c.lineWidth = width;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(ex, ey); c.stroke();
    };
    if (active) {
      line(BLUE, 8 * amt);
      line(PAPER, 2.2);
    } else if (reactive) line(BLUE, 2.4);
    else line(overBars ? PAPER : gray(0.55), overBars ? 2 : 1.6);
    const ahDist = Math.min(len * 0.68, Math.max(24, len - 58));
    if (ahDist > 18) {
      const hx = x0 + ux * ahDist, hy = y0 + uy * ahDist;
      const hs = active ? 13 : 9;
      c.fillStyle = fadeStyle(active ? PAPER : reactive ? BLUE : (overBars ? PAPER : gray(0.7)), a0 + (a1 - a0) * (ahDist / len));
      c.beginPath();
      c.moveTo(hx + ux * hs, hy + uy * hs);
      c.lineTo(hx - ux * hs * 0.6 + nx * hs * 0.75, hy - uy * hs * 0.6 + ny * hs * 0.75);
      c.lineTo(hx - ux * hs * 0.2, hy - uy * hs * 0.2);
      c.lineTo(hx - ux * hs * 0.6 - nx * hs * 0.75, hy - uy * hs * 0.6 - ny * hs * 0.75);
      c.closePath();
      c.fill();
    }
  };

  const drawWordNode = (sx: number, sy: number, word: string, active: boolean, scale = 1, hollowCenter = false, reactive = false) => {
    // box, text and outline fade together, by the node's centre
    const a = edgeFade(sx, sy);
    if (a <= 0) return;
    const bt = bricks(word);
    const cell = Math.round((active ? 5 : 3.5) * scale);
    const padX = active ? 18 : 10, padY = active ? 12 : 8;
    const bw = Math.max(active ? 110 : 64, bt.cols * cell + padX * 2);
    const bh = 10 * cell + padY * 2;
    const x = sx - bw / 2, y = sy - bh / 2;
    if (x > 1960 || x + bw < -40 || y > 1120 || y + bh < -40) return;
    if (active) {
      if (hollowCenter) {
        const fw = Math.max(bw + 70, 220), fh = Math.max(bh + 44, 120);
        c.strokeStyle = fadeStyle(BLUE, a);
        c.lineWidth = 8;
        c.strokeRect(sx - fw / 2, sy - fh / 2, fw, fh);
        c.strokeStyle = fadeStyle(PAPER, a);
        c.lineWidth = 2.5;
        c.strokeRect(sx - fw / 2 - 4, sy - fh / 2 - 4, fw + 8, fh + 8);
        return;
      }
      c.fillStyle = fadeStyle(BLUE, a);
      c.fillRect(x, y, bw, bh);
      c.strokeStyle = fadeStyle(PAPER, a);
      c.lineWidth = 2.5;
      c.strokeRect(x, y, bw, bh);
      c.fillStyle = fadeStyle(PAPER, a);
    } else if (reactive) {
      c.fillStyle = fadeStyle(BLUE, a);
      c.fillRect(x, y, bw, bh);
      c.strokeStyle = fadeStyle(PAPER, a);
      c.lineWidth = 2.2;
      c.strokeRect(x, y, bw, bh);
      c.fillStyle = fadeStyle(PAPER, a);
    } else {
      c.fillStyle = fadeStyle(INK, a);
      c.fillRect(x, y, bw, bh);
      c.strokeStyle = fadeStyle(overBars ? PAPER : gray(0.55), a);
      c.lineWidth = 1.6;
      c.strokeRect(x, y, bw, bh);
      c.fillStyle = fadeStyle(overBars ? PAPER : gray(0.72), a);
    }
    const tx0 = sx - (bt.cols * cell) / 2, ty0 = sy - (10 * cell) / 2;
    for (const b of bt.bricks) brickRect(c, tx0 + b.cx * cell, ty0 + b.cy * cell, b.len, cell);
  };

  c.save();
  if (overBars) {
    c.beginPath();
    c.rect(0, 0, 1920, BAR);
    c.rect(0, 1080 - BAR, 1920, BAR);
    c.clip();
  }

  // three syllables back: a group leaves the list only once all of it has faded out past the left edge
  const kMin = Math.max(0, k0 - 3), kMax = Math.min(nSyls - 1, k0 + 2);
  for (let k = kMin; k <= kMax; k++) {
    const [wx, wy] = spineXY(k);
    const [sx, sy] = toScreen(wx, wy);
    const appear = Math.min(1, Math.max(0, (stepPos - k + 1.35) * 1.2)) * amt;
    if (appear <= 0.02) continue;
    const offsets: [number, number][] = [
      [-130, -280], [115, -330],
      [-120, 290], [125, 340],
      [-240, -145], [245, 155],
    ];
    offsets.forEach(([ox, oy], bi) => {
      const jx = ox + (hashI(k, bi, 11) - 0.5) * 55;
      const jy = oy + (hashI(k, bi, 12) - 0.5) * 45;
      const [bx, by] = [sx + jx, sy + jy];
      const rReach = Math.min(1, appear * 1.25);
      const nodeId = k * 19 + bi;
      const isLit = audioReact && audioReact.drumHits > 0
        ? (hashI(nodeId, audioReact.drumHits, 7) < 0.32)
        : false;
      drawArrowEdge(sx, sy, bx, by, false, rReach, isLit);
      if (appear > 0.45) {
        const gReach = Math.min(1, (appear - 0.45) / 0.55);
        for (const side of [-1, 1]) {
          const subId = k * 31 + bi * 7 + (side > 0 ? 1 : 0);
          const subLit = audioReact && audioReact.drumHits > 0
            ? (hashI(subId, audioReact.drumHits, 11) < 0.32)
            : false;
          const gx = bx + side * (95 + hashI(k, bi, side > 0 ? 15 : 16) * 55) + (ox > 0 ? 45 : -45);
          const gy = by + (oy < 0 ? -1 : 1) * (115 + hashI(k, bi, side > 0 ? 17 : 18) * 55);
          drawArrowEdge(bx, by, gx, gy, false, gReach, subLit);
          if (gReach > 0.35) {
            const gWord = TREE_WORDS[Math.floor(hashI(subId, 23) * TREE_WORDS.length)]!;
            drawWordNode(gx, gy, gWord, false, 0.85 * gReach, false, subLit);
          }
        }
      }
      if (rReach > 0.25) {
        const word = TREE_WORDS[Math.floor(hashI(nodeId, 21) * TREE_WORDS.length)]!;
        drawWordNode(bx, by, word, false, Math.min(1, rReach * 1.15), false, isLit);
      }
    });
  }

  for (let k = kMin; k < kMax; k++) {
    const [w0x, w0y] = spineXY(k), [w1x, w1y] = spineXY(k + 1);
    const [s0x, s0y] = toScreen(w0x, w0y), [s1x, s1y] = toScreen(w1x, w1y);
    const reach = Math.min(1, Math.max(0, (stepPos - k + 0.85) * 1.15)) * amt;
    drawArrowEdge(s0x, s0y, s1x, s1y, true, reach);
  }
  for (let k = kMin; k <= kMax; k++) {
    const [wx, wy] = spineXY(k);
    const [sx, sy] = toScreen(wx, wy);
    const isCenter = Math.abs(k - stepPos) < 0.55;
    const txt = sylTexts[k % sylTexts.length]!;
    drawWordNode(sx, sy, txt, true, isCenter ? 1.15 : 0.95, isCenter);
  }
  c.restore();
}

// ---------- the crumpled page: room's paper ball opens into atone's ledger page ----------

/** atone's ledger in Life cells of `cell` px: text rows from (x0, y0), `rowStep` cells apart; `right` cells kept free on the right for the tally. */
export const LEDGER = { cell: 8, x0: 12, y0: 6, right: 24, rowStep: 14 } as const;

/**
 * The ledger's rules on its page (the box): one under every text row, the margin rule and the tally rule.
 * `tone` < 1 darkens the row rules with a page turned from the light (room's paper ball).
 */
export function ledgerRules(c: CanvasRenderingContext2D, tone = 1) {
  const { cell, x0, y0, right, rowStep } = LEDGER;
  c.fillStyle = gray(0.62 * tone);
  for (let y = y0 + 10; y * cell < BOX_H; y += rowStep) c.fillRect(0, BAR + y * cell + 3, W, 1);
  c.fillStyle = INK;
  c.fillRect((x0 - 3) * cell, BAR, 2, BOX_H);
  c.fillRect(W - (right - 4) * cell, BAR, 1, BOX_H);
}

const PAGE_NX = 10, PAGE_NY = 5;
/**
 * The crumpled page: PAGE_NX x PAGE_NY cells of two triangles each. `uv`: every vertex on the flat page, 0..1
 * across and down (inner vertices jittered, so the creases run crooked). `tris`: vertex indices, clockwise on
 * the page. `creases`: the inner edges the flattened page keeps (about two in three) and their tones, keyed
 * lower index * 4096 + higher.
 */
export const PAGE = (() => {
  const uv: [number, number][] = [];
  for (let j = 0; j <= PAGE_NY; j++) for (let i = 0; i <= PAGE_NX; i++) {
    const ju = i > 0 && i < PAGE_NX ? (hashI(i, j, 41) - 0.5) * 0.7 : 0;
    const jv = j > 0 && j < PAGE_NY ? (hashI(i, j, 42) - 0.5) * 0.7 : 0;
    uv.push([(i + ju) / PAGE_NX, (j + jv) / PAGE_NY]);
  }
  const row = PAGE_NX + 1;
  // an edge along the page's own edge is no crease
  const onBorder = (p: number, q: number) => (Math.floor(p / row) === Math.floor(q / row) && (p < row || p >= row * PAGE_NY))
    || (p % row === q % row && (p % row === 0 || p % row === PAGE_NX));
  const tris: [number, number, number][] = [];
  const creases = new Map<number, number>();
  for (let j = 0; j < PAGE_NY; j++) for (let i = 0; i < PAGE_NX; i++) {
    const a = j * row + i, b = a + 1, e = a + row, d = e + 1;
    const cell: [number, number, number][] = hashI(i, j, 43) < 0.5 ? [[a, b, d], [a, d, e]] : [[a, b, e], [b, d, e]];
    for (const t of cell) {
      tris.push(t);
      for (let m = 0; m < 3; m++) {
        const p = Math.min(t[m]!, t[(m + 1) % 3]!), q = Math.max(t[m]!, t[(m + 1) % 3]!);
        if (onBorder(p, q) || hashI(p, q, 44) > 0.68) continue;
        creases.set(p * 4096 + q, 0.4 + 0.3 * hashI(p, q, 45));
      }
    }
  }
  return { uv, tris, creases };
})();

/** Vertex i of the crumpled page laid flat, in px: the page is the box. */
export const pagePt = (i: number): [number, number] => [PAGE.uv[i]![0] * W, BAR + PAGE.uv[i]![1] * BOX_H];

/** px width of a crease on the flat page */
export const CREASE_W = 1.4;

/** The creases the flattened page keeps (room's last frames, atone's first beats); `a` fades them (halftone). */
export function pageCreases(c: CanvasRenderingContext2D, a = 1) {
  c.lineWidth = CREASE_W;
  for (const [key, tone] of PAGE.creases) {
    const [x0, y0] = pagePt(Math.floor(key / 4096)), [x1, y1] = pagePt(key % 4096);
    c.strokeStyle = gray(tone, a);
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }
}

