// Text-ish glyphs (treatment rule 5): pseudo-kanji made of real parts of the song's kanji. One kanji is clipped
// to its left (or top) part and joined to the right (or bottom) part of another, sometimes across faces. They are
// texture in the outer margins only. Never lyrics, never inside the page.
import { fnt, SANS, SERIF } from './_page';
import { hash } from '@pve/engine/util';

/** Song kanji with a left/right build (偏 + 旁), and with a top/bottom build (冠 + 脚). All are in the subset fonts. */
export const LR = [...'例健作何代判別味孤張性怯憧批揺敬物独理祈神絵評語辞邪難飲飽権測深活況灯版服眠解転歌新'];
export const TB = [...'思患悪愁意愛感夢害定字単参品器奮香質集書景節第章索髪画音竟'];

/**
 * Where each song kanji divides into its two radicals, in em from the left (LR) or top (TB) of the cell. A chimera
 * cuts a at its own boundary and b at its own, and moves b by the difference: no radical of b is cut across and no
 * second one shows in the join. A glyph that is not listed falls back to the cut of the chimera.
 */
const BOUND: Record<string, number> = {
  例: 0.3, 健: 0.3, 作: 0.3, 何: 0.3, 代: 0.3, 判: 0.48, 別: 0.6, 味: 0.33, 孤: 0.44, 張: 0.42, 性: 0.3, 怯: 0.3, 憧: 0.3,
  批: 0.32, 揺: 0.32, 敬: 0.55, 物: 0.35, 独: 0.34, 理: 0.4, 祈: 0.35, 神: 0.35, 絵: 0.4, 評: 0.4, 語: 0.4, 辞: 0.5,
  邪: 0.5, 難: 0.5, 飲: 0.45, 飽: 0.42, 権: 0.4, 測: 0.32, 深: 0.32, 活: 0.32, 況: 0.3, 灯: 0.4, 版: 0.45, 服: 0.4,
  眠: 0.4, 解: 0.45, 転: 0.42, 歌: 0.5, 新: 0.5,
  思: 0.55, 患: 0.55, 悪: 0.58, 愁: 0.55, 意: 0.5, 愛: 0.4, 感: 0.62, 夢: 0.55, 害: 0.4, 定: 0.35, 字: 0.35, 単: 0.45,
  参: 0.5, 品: 0.5, 器: 0.5, 奮: 0.55, 香: 0.5, 質: 0.5, 集: 0.45, 書: 0.55, 景: 0.45, 節: 0.5, 第: 0.45, 章: 0.55,
  索: 0.45, 髪: 0.5, 画: 0.5, 音: 0.5, 竟: 0.55,
};
/** The cut of a and of b (em) and how far b moves (em) along the cut axis. */
function joint(g: Chimera): { ca: number; cb: number; shift: number } {
  const ca = BOUND[g.a] ?? g.cut, cb = BOUND[g.b] ?? g.cut;
  return { ca, cb, shift: ca - cb };
}

export interface Chimera {
  a: string;
  b: string;
  /** 'lr': a's left + b's right; 'tb': a's top + b's bottom. */
  mode: 'lr' | 'tb';
  /** Where the cut is, in em from the left (or top) of the cell. Never quite the same twice. */
  cut: number;
  famA: string;
  famB: string;
}

/** The chimera number k of a seed: deterministic. */
export function chimera(seed: number, k: number): Chimera {
  const h = (n: number) => hash(seed, k, n);
  const lr = h(1) < 0.68;
  const pool = lr ? LR : TB;
  const a = pool[Math.floor(h(2) * pool.length)]!;
  let b = pool[Math.floor(h(3) * pool.length)]!;
  if (b === a) b = pool[(pool.indexOf(a) + 7) % pool.length]!;
  return {
    a, b, mode: lr ? 'lr' : 'tb',
    cut: lr ? 0.36 + h(4) * 0.14 : 0.42 + h(4) * 0.14,
    famA: h(5) < 0.8 ? SERIF : SANS,
    famB: h(6) < 0.8 ? SERIF : SANS,
  };
}

/**
 * Draw a chimera centred on (x, y) at `size` px with the current fillStyle. The two halves overlap by a hair so
 * the join reads as one glyph.
 */
export function drawChimera(c: CanvasRenderingContext2D, g: Chimera, x: number, y: number, size: number, weight = 500) {
  const x0 = x - size / 2, y0 = y - size / 2;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const half = (ch: string, fam: string, rx: number, ry: number, rw: number, rh: number, dx: number, dy: number) => {
    c.save();
    c.beginPath();
    c.rect(rx, ry, rw, rh);
    c.clip();
    c.font = fnt(fam, size, weight);
    c.fillText(ch, x + dx, y + dy);
    c.restore();
  };
  const s = size * 1.2; // the clip runs past the em box: glyphs overshoot it
  if (g.mode === 'lr') {
    const { ca, shift } = joint(g);
    const cx = x0 + ca * size;
    half(g.a, g.famA, x0 - s, y0 - s, cx - (x0 - s), size + 2 * s, 0, 0);
    half(g.b, g.famB, cx, y0 - s, s * 2, size + 2 * s, shift * size, 0);
  } else {
    const { ca, shift } = joint(g);
    const cy = y0 + ca * size;
    half(g.a, g.famA, x0 - s, y0 - s, size + 2 * s, cy - (y0 - s), 0, 0);
    half(g.b, g.famB, x0 - s, cy, size + 2 * s, s * 2, 0, shift * size);
  }
}

/** A half of a chimera: its offset [dx, dy] px and turn (rad) about the centre of the glyph. */
export type HalfPose = [number, number, number];

/**
 * Draw a chimera centred on (x, y) with each half moved on its own (assembling, flying apart). The cut moves
 * with its half. Current fillStyle.
 */
interface HalfSprite {
  cv: HTMLCanvasElement;
  w: number;
  h: number;
}
const CHIM_REF = 200;
const chims = new Map<string, { a: HalfSprite; b: HalfSprite }>();

function getChimeraHalves(g: Chimera, weight: number, isPaper: boolean): { a: HalfSprite; b: HalfSprite } {
  const { ca, shift } = joint(g);
  const key = `${g.a}:${g.famA}:${g.b}:${g.famB}:${g.mode}:${ca.toFixed(2)}:${shift.toFixed(2)}:${weight}:${isPaper ? 'w' : 'b'}`;
  let hit = chims.get(key);
  if (hit) return hit;
  const s = CHIM_REF;
  const pad = s * 0.4;
  const side = Math.ceil(s + 2 * pad);
  const cx = side / 2, cy = side / 2;
  const x0 = cx - s / 2, y0 = cy - s / 2;

  const mkHalf = (ch: string, fam: string, isA: boolean): HalfSprite => {
    const cv = document.createElement('canvas');
    cv.width = side;
    cv.height = side;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.beginPath();
    if (g.mode === 'lr') {
      const cutX = x0 + ca * s;
      if (isA) c.rect(0, 0, cutX, side);
      else c.rect(cutX, 0, side - cutX, side);
    } else {
      const cutY = y0 + ca * s;
      if (isA) c.rect(0, 0, side, cutY);
      else c.rect(0, cutY, side, side - cutY);
    }
    c.clip();
    c.font = fnt(fam, s, weight);
    c.fillStyle = isPaper ? '#ffffff' : '#000000';
    c.fillText(ch, cx + (!isA && g.mode === 'lr' ? shift * s : 0), cy + (!isA && g.mode === 'tb' ? shift * s : 0));
    return { cv, w: side, h: side };
  };

  hit = {
    a: mkHalf(g.a, g.famA, true),
    b: mkHalf(g.b, g.famB, false),
  };
  chims.set(key, hit);
  return hit;
}

export function drawSplit(
  c: CanvasRenderingContext2D, g: Chimera, x: number, y: number, size: number, weight: number, pa: HalfPose, pb: HalfPose,
) {
  const isPaper = c.fillStyle === '#ffffff';
  const { a, b } = getChimeraHalves(g, weight, isPaper);
  const sc = size / CHIM_REF;
  const drawOne = (sp: HalfSprite, p: HalfPose) => {
    c.save();
    c.translate(x + p[0], y + p[1]);
    if (p[2]) c.rotate(p[2]);
    c.scale(sc, sc);
    c.drawImage(sp.cv, -sp.w / 2, -sp.h / 2);
    c.restore();
  };
  drawOne(a, pa);
  drawOne(b, pb);
}

const atlasCache = new Map<string, HTMLCanvasElement>();

/** An atlas of n chimeras in black on clear, cell px square, laid out in cols columns (cached by parameters). */
export function atlas(seed: number, n: number, cell: number, cols: number): HTMLCanvasElement {
  const key = `${seed}:${n}:${cell}:${cols}`;
  let cv = atlasCache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cols * cell;
  cv.height = Math.ceil(n / cols) * cell;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.fillStyle = '#000000';
  for (let k = 0; k < n; k++) {
    const x = (k % cols) * cell + cell / 2, y = Math.floor(k / cols) * cell + cell / 2;
    c.save();
    c.beginPath();
    c.rect(x - cell / 2, y - cell / 2, cell, cell);
    c.clip();
    drawChimera(c, chimera(seed, k), x, y, cell * 0.86, hash(seed, k, 9) < 0.5 ? 400 : 600);
    c.restore();
  }
  atlasCache.set(key, cv);
  return cv;
}
