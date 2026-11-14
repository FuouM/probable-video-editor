// The v7 lyric carriers of sardine (treatment "Lyric carriers"), drawn with the big kana of _kana.ts.
// Each carrier shows its full line and lands each unit on its calibrated start with ONE motion.
// Kana never fade in.
//   carrier                    kit                            landing motion
//   tooltip at the cursor tip  `tip` input of PlayerRig       invert (new unit, 2 frames)
//   flap board                 `drawFlapBoard`                flip
//   surface in the world       `PaintedText`                  press (default)
//   3D letter gates            `LetterGates`                  slam
//   news ticker                `drawNewsTicker`               press
//   speech balloon             `drawBalloon`                  slam
//   DIVA lyric bar             `drawDivaBar`                  invert
import * as THREE from 'three';
import type { Line } from '@pve/engine/lyrics';
import { LH, LW, col, type Col } from '@pve/engine/lit';
import { TextLayer } from '@pve/engine/textlayer';
import type { Rect, Vec2 } from './_playerTypes';
import { chromeText, chromeWidth } from './_playerChrome';
import { FPS } from './_time';
import { HOLD, writtenOf, type Fonts } from './_fonts';
import { big, layoutKana, printKana, type Ink, type KanaGlyph, type KanaLayout, type KanaStyle, type PrintMotion } from './_kana';

const layoutCache = new WeakMap<Line, Map<string, KanaLayout>>();

/** A layout made once for a line and a key: a carrier asks for it on every frame. */
export function layoutOnce(fonts: Fonts, line: Line, key: string, style: KanaStyle): KanaLayout {
  let m = layoutCache.get(line);
  if (!m) layoutCache.set(line, (m = new Map()));
  let lay = m.get(key);
  if (!lay) m.set(key, (lay = layoutKana(fonts, line, style)));
  return lay;
}

/** The units of `lay` that have not landed yet, dim: the full line is on its carrier before it is sung. `times`: the print time of each unit (default the unit's start). */
function drawGhost(l: Ink, lay: KanaLayout, t: number, ink: Col, times?: readonly number[]) {
  const sink = l.sink({ 1: ink, 2: lay.colors.edge ?? '#0c0c14', 3: lay.colors.outer ?? '#0c0c14' });
  const at = lay.glyphs.filter((g) => (times?.[g.unit] ?? g.start) > t);
  const mask = (g: KanaGlyph) => big(lay.face, g.ch, lay.n, lay.r1, lay.r2);
  for (const g of at) mask(g).outer?.draw(sink, g.x, g.y, 3);
  for (const g of at) mask(g).edge.draw(sink, g.x, g.y, 2);
  for (const g of at) mask(g).ink.draw(sink, g.x, g.y, 1);
}

// ---------------------------------------------------------------- flap board

export interface FlapBoardOpts {
  /** The outer rectangle of the board. */
  rect: Rect;
  /** The pixel scale of the kana. Default 2. */
  n?: number;
  /** Units per row. Default one row. */
  rows?: number[];
  /** A small Silkscreen line at the top left, for example `ホーム 3`. */
  head?: string;
}

/**
 * A split-flap board (the flap board of a station): a dark housing with one empty flap for every unit of the line. Each unit
 * flips to its kana on its start: the card turns to face you in 4 frames (`flip`). The board stays when the line has ended.
 */
export function drawFlapBoard(l: TextLayer, fonts: Fonts, line: Line, t: number, o: FlapBoardOpts) {
  const n = o.n ?? 2;
  const [x, y, w, h] = o.rect;
  const rows = o.rows ?? [line.written!.units.length];
  const lay = layoutOnce(fonts, line, `flap|${o.rect}|${n}|${rows}|${o.head ?? ''}`, {
    x: x + w / 2, y: y + 10 + (o.head ? 10 : 0) + 16 * n, align: 'center', n, rows, maxW: w - 20, gap: 4,
    ink: '#f6efdc', edge: '#2a2d3a', outer: '#2a2d3a',
  });
  l.rect(x, y, w, h, '#06070a');
  l.rect(x + 1, y + 1, w - 2, h - 2, '#383a46');
  l.rect(x + 2, y + 2, w - 4, h - 4, '#12141a');
  if (o.head) chromeText(l, fonts, o.head, x + 8, y + 12, '#aab0c4', null);
  for (const g of lay.glyphs) {
    const cw = fonts.kana.width(g.ch) * n + 4, top = g.y - 16 * n - 1, ch = 20 * n + 2;
    l.rect(g.x - 2, top, cw, ch, '#2a2d3a');
    l.rect(g.x - 2, top + Math.floor(ch / 2), cw, 1, '#06070a');
    l.rect(g.x - 2, top, 1, ch, '#3c4050');
  }
  printKana(l, lay, t, { motion: 'flip' });
}

// ---------------------------------------------------------------- painted surface

export interface PaintedTextOpts {
  /** The size of the texture in px and of the surface in metres. The default geometry is a plane of `size`. */
  px: readonly [number, number];
  size: readonly [number, number];
  /** Where the line lies on the texture (`x`, `y` baseline, `n`, `rows`, `align`, `gap`). Default: centred, `n` 2. */
  layout?: Partial<KanaStyle>;
  /** Default `press`. */
  motion?: PrintMotion | ((g: KanaGlyph) => PrintMotion);
  /** The time each unit is painted, by unit index (a click on a slat). Default the unit's start. */
  times?: readonly number[];
  /** Paints these units only (one syllable on each slat). */
  only?: (g: KanaGlyph) => boolean;
  ink?: Col;
  edge?: Col;
  outer?: Col;
  hot?: Col;
  /** The ink of the units that are not painted yet: they show dim, so a header lights syllable by syllable. Default: not shown. */
  ghost?: Col;
  /** Paper under the paint (a calendar header). Default clear: only the paint shows. */
  ground?: Col;
  /** Unlit surface with an HDR strength (sky dome, banner: above 1 it blooms). Default 1. Ignored when `lit`. */
  emit?: number;
  /** A surface that takes the light of the scene (road paint, slats). */
  lit?: boolean;
  /** Seconds the line stays on the surface after it has ended, on top of `HOLD`. Default 0. */
  hold?: number;
  /** The geometry to paint on, UVs 0..1 over the text (a patch of a sphere for the sky dome). Default a plane of `size`. */
  geometry?: THREE.BufferGeometry;
}

/**
 * The layout options (`PaintedTextOpts.layout`) that put the glyph of unit `k` at the middle `cx` of a small surface, baseline `y`:
 * the whole line is laid out to the left of it, so a slat shows its own syllable and `only: (g) => g.unit === k` paints it.
 */
export function layoutAtUnit(fonts: Fonts, line: Line, k: number, n: number, cx: number, y: number): Partial<KanaStyle> {
  const units = line.written!.units;
  let pen = 0;
  for (let i = 0; i < k; i++) pen += fonts.kana.width(units[i]!.glyph) * n;
  return { x: Math.round(cx - pen - (fonts.kana.width(units[k]!.glyph) * n) / 2), y, align: 'left', n, maxW: 1e6 };
}

/**
 * Text painted on a surface in the world: a calendar header, road markings, a slat, a banner, the sky dome. The line is laid
 * out on a small texture (`px`) and printed unit by unit with `printKana`. The mesh shows from the first print until the line
 * has ended. `update(t)` repaints the texture once per frame of the video, and only while the mesh shows. Place `mesh` in the
 * scene (road paint: lay it flat a hair above the road).
 */
export class PaintedText {
  readonly mesh: THREE.Mesh;
  readonly layout: KanaLayout;
  private surface: TextLayer;
  private firstOn: number;
  private last = NaN;

  constructor(fonts: Fonts, line: Line, private o: PaintedTextOpts) {
    const [pw, ph] = o.px;
    this.surface = new TextLayer(pw, ph, THREE.SRGBColorSpace);
    const lay = { x: pw / 2, align: 'center' as const, maxW: pw - 4, ...o.layout, n: o.layout?.n ?? 2, ink: o.ink, edge: o.edge, outer: o.outer };
    const y = o.layout?.y ?? Math.round(ph / 2 + 6 * layoutKana(fonts, line, { ...lay, y: 0 }).n);
    this.layout = layoutKana(fonts, line, { ...lay, y });
    this.layout.until += o.hold ?? 0;
    this.firstOn = Math.min(...this.layout.glyphs.map((g) => o.times?.[g.unit] ?? g.start));
    const map = this.surface.tex;
    const mat = o.lit
      ? new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      : new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    if (!o.lit) mat.color.setScalar(o.emit ?? 1);
    this.mesh = new THREE.Mesh(o.geometry ?? new THREE.PlaneGeometry(o.size[0], o.size[1]), mat);
    this.mesh.visible = false;
    this.mesh.receiveShadow = !!o.lit;
  }

  update(t: number) {
    const on = t >= this.firstOn - 1e-6 && t <= this.layout.until;
    this.mesh.visible = on;
    if (!on) return;
    const frame = Math.floor(t * FPS + 1e-6);
    if (frame === this.last) return;
    this.last = frame;
    const s = this.surface, o = this.o;
    s.clear();
    if (o.ground !== undefined) s.rect(0, 0, s.w, s.h, o.ground);
    if (o.ghost !== undefined) drawGhost(s, this.layout, t, o.ghost, o.times);
    printKana(s, this.layout, t, { motion: o.motion ?? 'press', ...(o.times ? { times: o.times } : {}), ...(o.only ? { only: o.only } : {}), ...(o.hot !== undefined ? { hot: o.hot } : {}) });
    s.commit();
  }

  dispose() {
    this.surface.dispose();
    (this.mesh.material as THREE.Material).dispose();
    if (!this.o.geometry) this.mesh.geometry.dispose();
  }
}

// ---------------------------------------------------------------- 3D letter gates

/** Where one letter gate stands: the centre of the glyph, its heading about y (0 faces +z, so a train that runs along x sees it side on at yaw 0 and head on at yaw π/2) and the size of one font pixel in metres (default 0.5: a glyph is 7 m tall). */
export interface GateSpot { pos: readonly [number, number, number]; yaw?: number; cell?: number }

export interface LetterGatesOpts {
  /** The place of each unit on the path of the train. */
  place: (unit: number, glyph: string) => GateSpot;
  ink?: Col;
  /** The ink of the first 2 frames. */
  hot?: Col;
  /** HDR strength of the ink (blooms above 1). Default 1.6. */
  emit?: number;
  /** Depth of a letter in font pixels. Default 3. */
  depth?: number;
  /** The time at which a letter is gone (the train smashes it). Default never. */
  gone?: (unit: number) => number;
}

const gateCache = new Map<string, THREE.BufferGeometry>();

/**
 * One glyph as a block letter: its font pixels merged by row into boxes, centred on the middle of the glyph, y up. `part` `left` or `right`
 * is that half of the glyph, cut down its middle (a letter that the scissors cut). The geometry is cached: do not dispose it.
 */
export function glyphGeometry(fonts: Fonts, ch: string, cell: number, depth: number, part: 'whole' | 'left' | 'right' = 'whole'): THREE.BufferGeometry {
  const key = `${fonts.kana.family}|${ch}|${cell}|${depth}|${part}`;
  const hit = gateCache.get(key);
  if (hit) return hit;
  const m = big(fonts.kana, ch, 1, 0, 0).ink;
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const cx = m.x0 + m.w / 2, cy = m.y0 + m.h / 2, hz = (depth * cell) / 2;
  const quad = (p: number[][], n: number[]) => {
    const base = pos.length / 3;
    for (const v of p) { pos.push(v[0]!, v[1]!, v[2]!); nor.push(n[0]!, n[1]!, n[2]!); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const box = (x0: number, x1: number, y0: number, y1: number) => {
    quad([[x0, y0, hz], [x1, y0, hz], [x1, y1, hz], [x0, y1, hz]], [0, 0, 1]);
    quad([[x1, y0, -hz], [x0, y0, -hz], [x0, y1, -hz], [x1, y1, -hz]], [0, 0, -1]);
    quad([[x0, y1, hz], [x1, y1, hz], [x1, y1, -hz], [x0, y1, -hz]], [0, 1, 0]);
    quad([[x0, y0, -hz], [x1, y0, -hz], [x1, y0, hz], [x0, y0, hz]], [0, -1, 0]);
    quad([[x1, y0, hz], [x1, y0, -hz], [x1, y1, -hz], [x1, y1, hz]], [1, 0, 0]);
    quad([[x0, y0, -hz], [x0, y0, hz], [x0, y1, hz], [x0, y1, -hz]], [-1, 0, 0]);
  };
  for (let v = 0; v < m.h; v++) {
    for (let u = 0; u < m.w; u++) {
      if (!m.bits[v * m.w + u]) continue;
      let u1 = u;
      while (u1 + 1 < m.w && m.bits[v * m.w + u1 + 1]) u1++;
      const y1 = -(m.y0 + v - cy) * cell;
      let a = m.x0 + u, b = m.x0 + u1 + 1;
      if (part === 'left') b = Math.min(b, cx);
      else if (part === 'right') a = Math.max(a, cx);
      if (b > a) box((a - cx) * cell, (b - cx) * cell, y1 - cell, y1);
      u = u1;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  gateCache.set(key, g);
  return g;
}

/**
 * Big 3D letters that stand along a path (the bridge: the train flies through each syllable as it is sung). Each unit appears
 * on its start and slams in: 3x, 2x, then 1x its size on 3 frames, in the hot ink for the first 2. It stays until `gone`.
 * Put `root` in the scene and call `update(t)` before the render.
 */
export class LetterGates {
  readonly root = new THREE.Group();
  private units: { mesh: THREE.Mesh; start: number; gone: number }[] = [];
  private inkMat: THREE.MeshBasicMaterial;
  private hotMat: THREE.MeshBasicMaterial;
  private rimMat: THREE.MeshBasicMaterial;

  constructor(fonts: Fonts, line: Line, o: LetterGatesOpts) {
    const w = writtenOf(line);
    const emit = o.emit ?? 1.6;
    const mat = (c: Col, k: number) => {
      const m = new THREE.MeshBasicMaterial({ toneMapped: false });
      m.color.copy(col(c)).multiplyScalar(k);
      return m;
    };
    this.inkMat = mat(o.ink ?? '#f6efdc', emit);
    this.hotMat = mat(o.hot ?? '#ffd23a', emit * 1.5);
    this.rimMat = mat('#1a1620', 1);
    w.units.forEach((u, k) => {
      const spot = o.place(k, u.glyph);
      const mesh = new THREE.Mesh(glyphGeometry(fonts, u.glyph, spot.cell ?? 0.5, o.depth ?? 3), this.inkMat);
      mesh.position.set(...spot.pos);
      const rim = new THREE.Mesh(mesh.geometry, this.rimMat);
      rim.scale.set(1.12, 1.08, 1);
      rim.position.z = -0.3 * (spot.cell ?? 0.5) * 2;
      mesh.add(rim);
      mesh.rotation.y = spot.yaw ?? 0;
      mesh.visible = false;
      this.root.add(mesh);
      this.units.push({ mesh, start: u.start, gone: o.gone?.(k) ?? Infinity });
    });
  }

  update(t: number) {
    for (const u of this.units) {
      const f = Math.floor((t - u.start) * FPS + 1e-6);
      const on = f >= 0 && t < u.gone;
      u.mesh.visible = on;
      if (!on) continue;
      u.mesh.scale.setScalar(f === 0 ? 2 : f === 1 ? 1.5 : 1);
      u.mesh.material = f < 2 ? this.hotMat : this.inkMat;
    }
  }

  dispose() {
    this.inkMat.dispose();
    this.rimMat.dispose();
    this.hotMat.dispose();
  }
}

// ---------------------------------------------------------------- news ticker

/**
 * The game's news ticker: a dark strip with a red `NEWS` block, and the line in 16 px kana. Each unit presses in on its start
 * (`press`) and a caret blinks after the last unit. The game reports what it did by itself. `rect` needs a height of 22 or more.
 * The strip is a UI element: the scene draws it for as long as the game shows it. The kana show from the first unit to the end
 * of the line.
 */
export function drawNewsTicker(l: TextLayer, fonts: Fonts, line: Line, t: number, o: { rect: Rect; label?: string }) {
  const [x, y, w, h] = o.rect;
  const label = o.label ?? 'NEWS';
  const lw = chromeWidth(fonts, label) + 10;
  l.rect(x, y, w, h, '#05070f');
  l.rect(x, y, w, 1, '#3ac8ff');
  l.rect(x, y + h - 1, w, 1, '#1a2a4a');
  l.rect(x, y, lw, h, '#b8202a');
  l.rect(x + lw, y, 1, h, '#ff6a5a');
  chromeText(l, fonts, label, x + 5, y + Math.round(h / 2) + 3, '#ffffff', null);
  const lay = layoutOnce(fonts, line, `ticker|${o.rect}`, {
    x: x + lw + 7, y: y + 16 + Math.floor((h - 20) / 2), align: 'left', n: 1, maxW: w - lw - 14, ink: '#f4efe2', edge: '#05070f', outer: '#05070f',
  });
  if (t < lay.glyphs[0]!.start || t > lay.until) return;
  printKana(l, lay, t, { motion: 'press' });
  const shown = lay.glyphs.filter((g) => g.start <= t);
  const last = shown[shown.length - 1]!;
  if (Math.floor(t * 6) % 2 === 0) l.rect(last.x + lay.face.width(last.ch) + 1, y + 4, 2, h - 8, '#3ac8ff');
}

// ---------------------------------------------------------------- speech balloon

export interface BalloonOpts {
  /** The point the tail points at (the mouth of the jellyfish). */
  anchor: Vec2;
  /** The pixel scale of the kana. Default 2. */
  n?: number;
  /** Widest row of kana, px. Default 280. */
  maxW?: number;
  rows?: number[];
  /** The balloon sits above the anchor (default), below it, or to its right (the tail points left at the anchor). */
  side?: 'above' | 'below' | 'right';
}

/**
 * A speech balloon of a 1999 desktop assistant: a pale yellow box with a dark border, a drop shadow and a pixel tail that points
 * at `anchor`. The line is full inside it; each unit slams in on its start (`slam`). Returns the balloon's rectangle, or null
 * while it does not show (from the first unit to the end of the line).
 */
export function drawBalloon(l: TextLayer, fonts: Fonts, line: Line, t: number, o: BalloonOpts): Rect | null {
  const n = o.n ?? 2, rows = o.rows ?? [line.written!.units.length], maxW = o.maxW ?? 280;
  const base = `bal|${n}|${rows}|${maxW}`;
  const probe = layoutOnce(fonts, line, `${base}|probe`, { x: 0, y: 0, align: 'center', n, rows, maxW });
  if (t < probe.glyphs[0]!.start || t > probe.until) return null;
  const W = probe.box[2] + 14, H = probe.box[3] + 12, tail = 9;
  const ax = Math.round(o.anchor[0]), ay = Math.round(o.anchor[1]);
  const right = o.side === 'right';
  const bx = right ? Math.min(LW - 3 - W, ax + tail) : Math.max(3, Math.min(LW - 3 - W, Math.round(ax - W / 2)));
  const by = right ? Math.max(3, Math.min(LH - 3 - H, Math.round(ay - H / 2))) : o.side === 'below' ? ay + tail : ay - tail - H;
  const FILL = '#fffbd0', EDGE = '#101018';
  l.rect(bx + 2, by + 2, W, H, '#000000', 0.45);
  l.rect(bx, by, W, H, EDGE);
  l.rect(bx + 1, by + 1, W - 2, H - 2, FILL);
  if (right) {
    const ty = Math.max(by + 6, Math.min(by + H - 6, ay));
    for (let r = 0; r < tail; r++) {
      const half = Math.max(0, Math.round(4 - (r * 4) / tail));
      const x = bx - 1 - r;
      l.rect(x, ty - half - 1, 1, 2 * half + 3, EDGE);
      if (r > 0) l.rect(x, ty - half, 1, 2 * half + 1, FILL);
    }
  } else {
    const tx = Math.max(bx + 8, Math.min(bx + W - 8, ax));
    for (let r = 0; r < tail; r++) {
      const half = Math.max(0, Math.round(5 - (r * 5) / tail));
      const y = o.side === 'below' ? by - 1 - r : by + H + r;
      l.rect(tx - half - 1, y, 2 * half + 3, 1, EDGE);
      if (r > 0 || o.side !== 'below') l.rect(tx - half, y, 2 * half + 1, 1, FILL);
    }
  }
  const lay = layoutOnce(fonts, line, `${base}|${bx},${by}`, {
    x: bx + W / 2, y: by + 6 + 16 * n + 1, align: 'center', n, rows, maxW, ink: '#101018', edge: FILL, outer: FILL,
  });
  printKana(l, lay, t, { motion: 'slam', hot: '#d82828' });
  return [bx, by, W, H];
}

// ---------------------------------------------------------------- DIVA lyric bar

export interface DivaOpts {
  /** Top of the bar, px. Default 262. */
  y?: number;
  /** The pixel scale of the kana. Default 2. */
  n?: number;
  /** Seconds that a note takes to fall onto its kana. Default 0.9. */
  lead?: number;
  /** A copy of the line (the `ca` voice): pressed 2 px right and down under the lead, in a cool ink, on its own times. */
  copy?: Line;
}

/**
 * The lyric bar of the DIVA game (Project DIVA): a dark strip over the lower picture with the full line dim. A note falls onto
 * each kana and hits it on its start: the kana lands as an inverted block for 3 frames (`invert`), and a square ring bursts
 * from the hit. The notes fall for `lead` s before each start. It shows from the first note to the end of the line.
 */
export function drawDivaBar(l: TextLayer, fonts: Fonts, line: Line, t: number, o: DivaOpts = {}) {
  const n = o.n ?? 2, y0 = o.y ?? 262, lead = o.lead ?? 0.9;
  const first = line.written!.units[0]!.start;
  if (t < first - lead - 0.1 || t > line.end + HOLD) return;
  const lay = layoutOnce(fonts, line, `diva|${n}|${y0}`, {
    x: LW / 2, y: y0 + 8 + 16 * n, align: 'center', n, maxW: 600, ink: '#f6efdc', edge: '#0a0c18', outer: '#0a0c18',
  });
  const bar: Rect = [lay.box[0] - 10, y0, lay.box[2] + 20, lay.box[3] + 16];
  l.rect(bar[0], bar[1], bar[2], bar[3], '#050816', 0.72);
  l.rect(bar[0], bar[1], bar[2], 1, '#38e0ff');
  l.rect(bar[0], bar[1] + bar[3] - 1, bar[2], 1, '#38e0ff');
  const step = Math.floor(t * 12) % 8;
  for (let x = bar[0] + step; x < bar[0] + bar[2] - 4; x += 8) l.rect(x, bar[1] + 3, 4, 1, '#38e0ff', 0.5);
  drawGhost(l, lay, t, '#4a5578');
  for (const g of lay.glyphs) {
    const cx = g.x + Math.floor((lay.face.width(g.ch) * n) / 2);
    const d = g.start - t;
    const hue = g.unit % 2 === 0 ? '#ff4fa3' : '#38e0ff';
    if (d > 0 && d <= lead) {
      const cy = bar[1] - 8 - Math.round((d / lead) * 70);
      for (let k = 0; k < 4; k++) l.rect(cx - 3 + k, cy - k, 7 - 2 * k, 1, hue), l.rect(cx - 3 + k, cy + k, 7 - 2 * k, 1, hue);
      l.rect(cx - 1, cy - 1, 3, 3, '#ffffff');
    }
    const f = Math.floor(-d * FPS + 1e-6);
    if (f >= 0 && f < 4) {
      const r = 6 + 4 * f, cy = bar[1];
      l.rect(cx - r, cy - r, 2 * r, 2, hue); l.rect(cx - r, cy + r - 2, 2 * r, 2, hue);
      l.rect(cx - r, cy - r, 2, 2 * r, hue); l.rect(cx + r - 2, cy - r, 2, 2 * r, hue);
    }
  }
  if (o.copy) {
    const cl = layoutOnce(fonts, o.copy, `diva-copy|${n}|${y0}`, {
      x: LW / 2 + 2, y: y0 + 10 + 16 * n, align: 'center', n, maxW: 600, ink: '#7fa8e8', edge: '#0a0c18', outer: '#0a0c18',
    });
    printKana(l, cl, t, { motion: 'press' });
  }
  printKana(l, lay, t, { motion: 'invert' });
}
