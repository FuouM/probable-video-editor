// Cell renderers for Chorus 2 ("without"): fractals, 3D falling letters tunnel, Narcissus pond reflection, and eye drawing.
import { clamp, ease, prog } from '@pve/engine/util';
import { sylAt } from '@pve/engine/lyrics';
import { mark } from '@pve/engine/marks';
import { W } from '@pve/engine/gl';
import { BAR, BEAT, BEAT0, BOX_H, INK, PAPER, brickRect, gray, hashI, type Placed, type SylLine } from './_kit';

export interface CellLike {
  sl: SylLine;
  placed: Placed[];
  rows: number;
  x: number;
  y: number;
}

// ---------- the fractals of "signal": each developed level by level ----------
export type Fractal = { name: string; fill: boolean; at: (d: number) => Path2D };
export const FRACTALS: Fractal[] = [
  {
    name: 'SIERPINSKI', fill: true, at: (d) => {
      const p = new Path2D();
      const tri = (ax: number, ay: number, s: number, k: number) => {
        if (k === 0) { p.moveTo(ax, ay + s); p.lineTo(ax + s / 2, ay); p.lineTo(ax + s, ay + s); p.closePath(); return; }
        tri(ax + s / 4, ay, s / 2, k - 1); tri(ax, ay + s / 2, s / 2, k - 1); tri(ax + s / 2, ay + s / 2, s / 2, k - 1);
      };
      tri(0, 0, 1, d);
      return p;
    },
  },
  {
    name: 'KOCH', fill: false, at: (d) => {
      let pts: [number, number][] = [[0.1, 0.3], [0.9, 0.3], [0.5, 0.3 + 0.8 * 0.866], [0.1, 0.3]];
      for (let l = 0; l < d; l++) {
        const nx: [number, number][] = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = pts[i]!, [bx, by] = pts[i + 1]!;
          const dx = (bx - ax) / 3, dy = (by - ay) / 3;
          nx.push([ax, ay], [ax + dx, ay + dy], [ax + dx * 1.5 + dy * 0.866, ay + dy * 1.5 - dx * 0.866], [ax + 2 * dx, ay + 2 * dy]);
        }
        nx.push(pts[pts.length - 1]!);
        pts = nx;
      }
      const p = new Path2D();
      pts.forEach(([x, y], i) => (i ? p.lineTo(x, y * 0.8) : p.moveTo(x, y * 0.8)));
      return p;
    },
  },
  {
    name: 'H-TREE', fill: false, at: (d) => {
      const p = new Path2D();
      const h = (cx: number, cy: number, s: number, k: number, horiz: boolean) => {
        if (k < 0) return;
        const [ax, ay, bx, by] = horiz ? [cx - s, cy, cx + s, cy] : [cx, cy - s, cx, cy + s];
        p.moveTo(ax, ay); p.lineTo(bx, by);
        h(ax, ay, s / Math.SQRT2, k - 1, !horiz); h(bx, by, s / Math.SQRT2, k - 1, !horiz);
      };
      h(0.5, 0.5, 0.25, d + 1, true);
      return p;
    },
  },
  {
    name: 'CARPET', fill: true, at: (d) => {
      const p = new Path2D();
      const carpet = (x0: number, y0: number, s: number, k: number) => {
        if (k === 0) return;
        const t = s / 3;
        p.rect(x0 + t, y0 + t, t, t);
        for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) if (i !== 1 || j !== 1) carpet(x0 + i * t, y0 + j * t, t, k - 1);
      };
      p.rect(0, 0, 1, 0.004);
      carpet(0, 0, 1, d + 1);
      return p;
    },
  },
  {
    name: 'VICSEK', fill: true, at: (d) => {
      const p = new Path2D();
      const vic = (x0: number, y0: number, s: number, k: number) => {
        if (k === 0) { p.rect(x0, y0, s, s); return; }
        const t = s / 3;
        vic(x0 + t, y0, t, k - 1);
        vic(x0, y0 + t, t, k - 1);
        vic(x0 + t, y0 + t, t, k - 1);
        vic(x0 + 2 * t, y0 + t, t, k - 1);
        vic(x0 + t, y0 + 2 * t, t, k - 1);
      };
      vic(0.06, 0.06, 0.88, d + 1);
      return p;
    },
  },
  {
    name: 'DRAGON', fill: false, at: (d) => {
      let pts: [number, number][] = [[0.22, 0.55], [0.78, 0.55]];
      const steps = Math.min(11, (d + 1) * 2 + 2);
      for (let l = 0; l < steps; l++) {
        const nx: [number, number][] = [pts[0]!];
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = pts[i]!, [bx, by] = pts[i + 1]!;
          const dx = bx - ax, dy = by - ay;
          const dir = i % 2 === 0 ? 1 : -1;
          nx.push([ax + (dx - dir * dy) * 0.5, ay + (dy + dir * dx) * 0.5], [bx, by]);
        }
        pts = nx;
      }
      const p = new Path2D();
      pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
      return p;
    },
  },
  {
    name: 'LEVY-C', fill: false, at: (d) => {
      let pts: [number, number][] = [[0.26, 0.68], [0.74, 0.68]];
      const steps = Math.min(10, (d + 1) * 2 + 1);
      for (let l = 0; l < steps; l++) {
        const nx: [number, number][] = [pts[0]!];
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = pts[i]!, [bx, by] = pts[i + 1]!;
          const dx = bx - ax, dy = by - ay;
          nx.push([ax + (dx + dy) * 0.5, ay + (dy - dx) * 0.5], [bx, by]);
        }
        pts = nx;
      }
      const p = new Path2D();
      pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
      return p;
    },
  },
  {
    name: 'CANTOR', fill: true, at: (d) => {
      const p = new Path2D();
      const bars = (x0: number, y0: number, w: number, k: number) => {
        p.rect(x0, y0, w, 0.08);
        if (k <= 0) return;
        bars(x0, y0 + 0.14, w / 3, k - 1);
        bars(x0 + (2 * w) / 3, y0 + 0.14, w / 3, k - 1);
      };
      bars(0.06, 0.12, 0.88, d + 1);
      return p;
    },
  },
];
export const LEVELS = 4; // four depth steps per fractal, halved evolution rate (2 beats per fractal, 1 step per eighth)

/** Bootstrap Icons `hand-index-thumb` (MIT), 16x16 viewBox, finger pointing up at (6.75, 0.25). */
export const HAND_SVG = 'M6.75 1a.75.75 0 0 1 .75.75V8a.5.5 0 0 0 1 0V5.467l.086-.004c.317-.012.637-.008.816.027.134.027.294.096.448.182.077.042.15.147.15.314V8a.5.5 0 0 0 1 0V6.435l.106-.01c.316-.024.584-.01.708.04.118.046.3.207.486.43.081.096.15.19.2.259V8.5a.5.5 0 1 0 1 0v-1h.342a1 1 0 0 1 .995 1.1l-.271 2.715a2.5 2.5 0 0 1-.317.991l-1.395 2.442a.5.5 0 0 1-.434.252H6.118a.5.5 0 0 1-.447-.276l-1.232-2.465-2.512-4.185a.517.517 0 0 1 .809-.631l2.41 2.41A.5.5 0 0 0 6 9.5V1.75A.75.75 0 0 1 6.75 1M8.5 4.466V1.75a1.75 1.75 0 1 0-3.5 0v6.543L3.443 6.736A1.517 1.517 0 0 0 1.07 8.588l2.491 4.153 1.215 2.43A1.5 1.5 0 0 0 6.118 16h6.302a1.5 1.5 0 0 0 1.302-.756l1.395-2.441a3.5 3.5 0 0 0 .444-1.389l.271-2.715a2 2 0 0 0-1.99-2.199h-.581a5 5 0 0 0-.195-.248c-.191-.229-.51-.568-.88-.716-.364-.146-.846-.132-1.158-.108l-.132.012a1.26 1.26 0 0 0-.56-.642 2.6 2.6 0 0 0-.738-.288c-.31-.062-.739-.058-1.05-.046zm2.094 2.025';
export const HAND_FILL = 'M8.5 1.75v2.716l.047-.002c.312-.012.742-.016 1.051.046.28.056.543.18.738.288.273.152.456.385.56.642l.132-.012c.312-.024.794-.038 1.158.108.37.148.689.487.88.716.075.09.141.175.195.248h.582a2 2 0 0 1 1.99 2.199l-.272 2.715a3.5 3.5 0 0 1-.444 1.389l-1.395 2.441A1.5 1.5 0 0 1 12.42 16H6.118a1.5 1.5 0 0 1-1.342-.83l-1.215-2.43L1.07 8.589a1.517 1.517 0 0 1 2.373-1.852L5 8.293V1.75a1.75 1.75 0 0 1 3.5 0z';

/** An eye at (ex, ey), width w: almond lids, a paper iris ring, a blue pupil looking at (lx, ly) 0..1. */
export function drawEye(c: CanvasRenderingContext2D, ex: number, ey: number, w: number, open: number, lx: number, ly: number) {
  const h = w * 0.55 * open;
  c.save();
  c.beginPath();
  c.moveTo(ex - w, ey);
  c.quadraticCurveTo(ex, ey - h * 2, ex + w, ey);
  c.quadraticCurveTo(ex, ey + h * 2, ex - w, ey);
  c.closePath();
  c.fillStyle = gray(0.85);
  c.fill();
  c.clip();
  const ix = ex + (lx - 0.5) * w * 0.7, iy = ey + (ly - 0.5) * w * 0.3;
  c.fillStyle = INK;
  c.beginPath(); c.arc(ix, iy, w * 0.42, 0, Math.PI * 2); c.fill();
  c.fillStyle = PAPER;
  c.beginPath(); c.arc(ix, iy, w * 0.34, 0, Math.PI * 2); c.fill();
  c.globalCompositeOperation = 'destination-out';
  c.beginPath(); c.arc(ix, iy, w * 0.18, 0, Math.PI * 2); c.fill();
  c.restore();
  c.strokeStyle = PAPER;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(ex - w, ey);
  c.quadraticCurveTo(ex, ey - h * 2, ex + w, ey);
  c.stroke();
  for (let l = 1; l < 6; l++) {
    const u = l / 6, lx0 = ex - w + 2 * w * u, ly0 = ey - h * 2 * 2 * u * (1 - u);
    c.beginPath(); c.moveTo(lx0, ly0); c.lineTo(lx0 + (u - 0.5) * 14, ly0 - 12); c.stroke();
  }
}

/** "as i falling through my feeling": the whole line stands, shadowed; then whole letters fall into a blue hole. */
export function drawFalling(
  c: CanvasRenderingContext2D,
  cell: CellLike,
  t: number,
  ti: number,
  CW: number,
  CH: number,
  PAD: number,
  CELL: number,
) {
  const { x, y, sl } = cell;
  const cx = x + CW / 2, cy = y + CH / 2 + 40;
  c.strokeStyle = gray(0.55);
  for (let j = 0; j < 6; j++) {
    const z = 0.15 + ((j / 6 - ti * 0.55) % 1 + 1) % 1;
    const s = 60 / z;
    c.lineWidth = clamp(1.4 / z, 0.6, 3);
    for (let g = -4; g <= 4; g++) {
      c.beginPath(); c.moveTo(cx + g * s, cy - 4 * s); c.lineTo(cx + g * s, cy + 4 * s); c.stroke();
      c.beginPath(); c.moveTo(cx - 4 * s, cy + g * s); c.lineTo(cx + 4 * s, cy + g * s); c.stroke();
    }
  }
  c.beginPath(); c.arc(cx, cy, 34, 0, Math.PI * 2);
  c.save(); c.globalCompositeOperation = 'destination-out'; c.fill(); c.restore();
  const tx = x + PAD, ty = y + PAD;
  const k = sylAt(sl, t);
  if (k >= 0) {
    const [a, e] = sl.ranges[k]!;
    mark(`syl:${sl.syls[k]!.text}`, tx + sl.bt.charX[a]! * CELL, ty, (sl.bt.charX[e - 1]! + sl.bt.charW[e - 1]! - sl.bt.charX[a]!) * CELL, 10 * CELL, c);
  }
  const chars = new Map<number, Placed[]>();
  for (const p of cell.placed) (chars.get(p.b.ci) ?? chars.set(p.b.ci, []).get(p.b.ci)!).push(p);
  const fall0 = sl.syls[sl.syls.length - 1]!.start, g = 640;
  for (const [ci, ps] of chars) {
    const si = ps[0]!.si;
    if (si > k) continue;
    const tf = fall0 + hashI(ci, 51) * 0.55 + (ci / Math.max(1, sl.bt.text.length)) * 0.25;
    const a = Math.max(0, t - tf);
    let ax = Infinity, ay = Infinity;
    for (const p of ps) { ax = Math.min(ax, tx + p.x * CELL); ay = Math.min(ay, ty + p.y * CELL); }
    let lw = 0;
    for (const p of ps) lw = Math.max(lw, tx + p.x * CELL + p.b.len * CELL - ax);
    const lh = Math.max(...ps.map((p) => ty + p.y * CELL + CELL - ay));
    const hx = ax + lw / 2, hy = ay + lh / 2;
    const dist = Math.hypot(cx - hx, cy - hy) || 1;
    const f = clamp((0.5 * g * a * a) / dist, 0, 1);
    if (f >= 1) continue;
    const sway = Math.sin(a * 8.5 + ci * 1.7) * 10 * a * (1 - f);
    const nx = hx + (cx - hx) * f + sway;
    const ny = hy + (cy - hy) * f;
    const sc = Math.pow(1 - f, 0.9);
    const rot = 0.5 * (hashI(ci, 53) - 0.5) * 5 * a * a;
    c.save();
    c.translate(nx, ny);
    c.rotate(rot);
    c.scale(sc, sc);
    for (const p of ps) {
      const lx = tx + p.x * CELL - ax - lw / 2, ly = ty + p.y * CELL - ay - lh / 2;
      c.fillStyle = INK;
      c.fillRect(lx + 2, ly + 2, p.b.len * CELL, CELL);
      c.fillStyle = PAPER;
      brickRect(c, lx, ly, p.b.len, CELL);
    }
    c.restore();
  }
}

/** "as i staring at myself": Narcissus as the Bootstrap pointing hand, angled down at the water, lowered
 *  nearer and nearer; it and the line are reflected in the blue pond, a ring spreading on every beat. */
export function drawNarcissus(
  c: CanvasRenderingContext2D,
  cell: CellLike,
  t: number,
  ti: number,
  CW: number,
  CH: number,
  PAD: number,
  CELL: number,
  pond: HTMLCanvasElement,
  pc: CanvasRenderingContext2D,
  handFill: Path2D,
  handLine: Path2D,
  drawText: (c: CanvasRenderingContext2D, cell: CellLike, t: number, x: number, y: number) => void,
) {
  const { x, y, sl } = cell;
  const water = y + CH * 0.62;
  c.clearRect(x, water, CW, y + CH - water);
  const down = prog(t, sl.line.start, sl.line.end + 1.5, ease.inOutCubic);
  const tipX = x + CW * 0.58, tipY = water - 56 + 48 * down;
  pc.setTransform(1, 0, 0, 1, 0, 0);
  pc.clearRect(0, 0, pond.width, pond.height);
  const hand = (g: CanvasRenderingContext2D) => {
    g.save();
    g.translate(tipX, tipY);
    g.rotate(2.55);
    const s = 9.5;
    g.scale(s, s);
    g.translate(-6.75, -1);
    g.fillStyle = INK;
    g.fill(handFill);
    g.fillStyle = PAPER;
    g.fill(handLine);
    g.restore();
  };
  hand(c);
  drawText(c, cell, t, x + PAD, y + PAD);
  pc.save();
  pc.translate(-x, 2 * water - y);
  pc.scale(1, -1);
  hand(pc);
  const k = sylAt(sl, t);
  pc.fillStyle = gray(0.7);
  for (const p of cell.placed) if (p.si <= k) pc.fillRect(x + PAD + p.x * CELL, y + PAD + p.y * CELL, p.b.len * CELL - 0.6, CELL - 0.6);
  pc.restore();
  const top = Math.floor(water - y);
  for (let r = top; r < CH; r += 3) {
    const dx = Math.sin(r * 0.21 + ti * 7) * (2 + (r - top) * 0.04);
    c.drawImage(pond, 0, r, CW, 3, x + dx, y + r, CW, 3);
  }
  const beat = Math.floor((ti - BEAT0) / BEAT), a = ti - (BEAT0 + beat * BEAT);
  c.strokeStyle = PAPER;
  c.lineWidth = 1.5;
  c.beginPath();
  c.ellipse(tipX, water + 12, 10 + a * 200, 3 + a * 40, 0, 0, Math.PI * 2);
  c.stroke();
}

/** Unified Pokemon-style spiral of squares across the entire 1920xBOX_H grid at once, wiping to BLUE. */
export function wipeGrid(c: CanvasRenderingContext2D, p: number) {
  if (p <= 0) return;
  c.save();
  c.beginPath(); c.rect(0, BAR, W, BOX_H); c.clip();
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = INK;
  const s = 48, nx = Math.ceil(W / s), ny = Math.ceil(BOX_H / s);
  let l = 0, r = nx - 1, tp = 0, b = ny - 1, idx = 0;
  const total = nx * ny, upto = Math.floor(total * p);
  while (l <= r && tp <= b && idx < upto) {
    for (let k = l; k <= r && idx < upto; k++, idx++) c.fillRect(k * s, BAR + tp * s, s, s);
    tp++;
    for (let k = tp; k <= b && idx < upto; k++, idx++) c.fillRect(r * s, BAR + k * s, s, s);
    r--;
    for (let k = r; k >= l && idx < upto; k--, idx++) c.fillRect(k * s, BAR + b * s, s, s);
    b--;
    for (let k = b; k >= tp && idx < upto; k--, idx++) c.fillRect(l * s, BAR + k * s, s, s);
    l++;
  }
  c.restore();
}
