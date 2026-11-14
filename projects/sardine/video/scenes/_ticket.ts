// The commuter pass and its date stamps as a lit prop kit (see `_propKit.ts`). The kit is a `root` group (metres, y up) built once; its
// setters only change state that a pure function of time can set again. It owns no light.
import * as THREE from 'three';
import type { Fonts } from './_fonts';
import { Fish } from './_fish';
import { Builder, LitAtlas, litMaterial, litMesh, v3, type Cell } from '@pve/engine/lit';
import { Top, hash } from './_propKit';

const TW = 172;
const TH = 108;

/** A stamp mark of the pass: a round date stamp, a clipped notch at an edge, or a punched hole. */
type Mark =
  | { kind: 'stamp'; x: number; y: number; r: number }
  | { kind: 'notch'; x: number; y: number; edge: 'top' | 'bottom' | 'left' | 'right' }
  | { kind: 'hole'; x: number; y: number; r: number };

const MARKS: Mark[] = [
  { kind: 'stamp', x: 140, y: 92, r: 13 },
  { kind: 'notch', x: 94, y: 0, edge: 'top' },
  { kind: 'hole', x: 158, y: 62, r: 3 },
  { kind: 'stamp', x: 44, y: 88, r: 11 },
  { kind: 'notch', x: 138, y: TH - 1, edge: 'bottom' },
  { kind: 'hole', x: 14, y: 66, r: 3 },
  { kind: 'stamp', x: 108, y: 60, r: 12 },
  { kind: 'notch', x: 0, y: 72, edge: 'left' },
];

/** The radius of a punched hole in texels. */
const HOLE_R = 4;
/** The lines printed across the pass: `えきのホームに / あながあく`, a glyph for each of the 12 sung units. */
const TICKET_TEXT: readonly (readonly string[])[] = [['え', 'き', 'の', 'ホ', 'ー', 'ム', 'に'], ['あ', 'な', 'が', 'あ', 'く']];

/**
 * A Japanese commuter pass (定期券), 0.086 x 0.054 m times `scale`. Local frame: the card lies in the x-y plane, its
 * face toward +z, centred on the origin. The face prints a green header 通勤定期券, the route いま → あした and the
 * validity 11.03 〜 11.03; the back has the magnetic stripe. The corners are bevelled. `stamp(k)` adds the first k
 * stamp marks (round 「改」 date stamps, punched holes, clipped notches).
 */
export class Ticket {
  static readonly W = 0.086;
  static readonly H = 0.054;
  /** The radius of a punched hole, in metres on the unscaled card. */
  static readonly HOLE_R = (HOLE_R / TW) * 0.086;
  readonly root = new THREE.Group();
  readonly lights: THREE.Light[] = [];
  private front: Cell;
  private back: Cell;
  private marks = 0;
  private holes = 0;
  private painted = '';
  /** The printed glyphs: the pen of each in texels, and the centre of its hole. */
  private slots: { ch: string; x: number; y: number; cx: number; cy: number }[] = [];
  /** The card has its own small atlas (256 x 256): a change of the stamps or of the holes repaints 100 KB, not the shared 16 MB atlas. */
  private atlas = new LitAtlas(256);

  /**
   * `rows`: the lines printed huge across the card, as glyphs (default `えきのホームに / あながあく`, one glyph for each
   * sung unit of line 7 of the lead lane). Each glyph has one punch hole.
   */
  constructor(private fonts: Fonts, scale = 1, rows: readonly (readonly string[])[] = TICKET_TEXT) {
    const atlas = this.atlas;
    this.front = atlas.paint(TW, TH, () => {});
    this.back = atlas.paint(TW, TH, () => {});
    rows.forEach((row, r) => {
      const total = row.reduce((a, ch) => a + fonts.kana.width(ch), 0);
      let x = Math.floor((TW - 8 - total) / 2) + 4;
      for (const ch of row) {
        const adv = fonts.kana.width(ch);
        const y = 71 + r * 20;
        this.slots.push({ ch, x, y, cx: x + Math.floor(adv / 2), cy: y - 6 });
        x += adv;
      }
    });
    this.repaint();
    const T = 0.001;
    const w = Ticket.W / 2, h = Ticket.H / 2, c = 0.0032;
    const rim = { cell: atlas.solid(0xd9d7c5) };
    const b = new Builder();
    b.extrude([[-w + c, -h], [w - c, -h], [w, -h + c], [w, h - c], [w - c, h], [-w + c, h], [-w, h - c], [-w, -h + c]], T, null, rim);
    b.quad(v3(-w, -h, T / 2), v3(w, -h, T / 2), v3(w, h, T / 2), v3(-w, h, T / 2), { cell: this.front, map: 'fit' });
    b.quad(v3(w, -h, -T / 2), v3(-w, -h, -T / 2), v3(-w, h, -T / 2), v3(w, h, -T / 2), { cell: this.back, map: 'fit' });
    this.root.add(litMesh(b, litMaterial(atlas, { side: THREE.DoubleSide })));
    this.root.scale.setScalar(scale);
  }

  /** How many of the `times` have come at time t: the hole count for `setHoles`. */
  static holesAt(t: number, times: readonly number[]): number { return times.filter((x) => x <= t).length; }

  /** The pass shows its first `k` stamp marks (0..8). */
  stamp(k: number) {
    this.marks = Math.max(0, Math.min(MARKS.length, Math.round(k)));
    this.repaint();
  }

  /** The card has its first `n` holes punched through the printed glyphs (0..`holeCount`). */
  setHoles(n: number) {
    this.holes = Math.max(0, Math.min(this.slots.length, Math.round(n)));
    this.repaint();
  }

  /** The count of holes the printed text has: one for each glyph. */
  get holeCount(): number { return this.slots.length; }

  /** The centre of hole i in the card frame (metres, the card in the x-y plane, z = 0, scaled by `scale` only in world). */
  holePos(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const s = this.slots[i]!;
    return out.set(((s.cx + 0.5) / TW - 0.5) * Ticket.W, (0.5 - (s.cy + 0.5) / TH) * Ticket.H, 0);
  }

  /** The centre of hole i in world space (for a camera that looks through the last hole). */
  holeWorld(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    this.root.updateWorldMatrix(true, false);
    return this.root.localToWorld(this.holePos(i, out));
  }

  private repaint() {
    const key = `${this.marks}|${this.holes}`;
    if (key === this.painted) return;
    this.painted = key;
    const { marks, holes } = this;
    this.atlas.repaint(this.front, (p) => this.paintFront(new Top(p, TW, TH), marks, holes));
    this.atlas.repaint(this.back, (p) => this.paintBack(new Top(p, TW, TH), marks, holes));
  }

  /** The lyric, huge, in dark green ink with a pale halo so it reads over the printed card. */
  private print(d: Top) {
    const f = this.fonts.kana;
    const grow = (put: (x: number, y: number) => void) => (px: number, py: number) => { for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) put(px + a, py + b); };
    for (const s of this.slots) f.draw({ put: grow((x, y) => { for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) d.px(x + i, y + j, 0xf1efe2); }) }, s.ch, s.x, s.y, 1);
    for (const s of this.slots) f.draw({ put: grow((x, y) => d.px(x, y, 0x1a5a34)) }, s.ch, s.x, s.y, 1);
  }

  /** A hole through the card: a dark lip of 1 texel round clear texels. `back`: seen from the other side (mirrored). */
  private punch(d: Top, s: { cx: number; cy: number }, back: boolean) {
    const cx = back ? TW - 1 - s.cx : s.cx;
    for (let y = -HOLE_R - 1; y <= HOLE_R + 1; y++) for (let x = -HOLE_R - 1; x <= HOLE_R + 1; x++) {
      const r = Math.hypot(x, y);
      if (r <= HOLE_R + 0.3) d.clear(cx + x, s.cy + y);
      else if (r <= HOLE_R + 1.3) d.px(cx + x, s.cy + y, 0x23281f);
    }
  }

  private paintFront(d: Top, k: number, holes: number) {
    const { kana, latin } = this.fonts;
    const ink = 0x1c2a22;
    d.fill(0xf1efe2);
    for (let y = 0; y < TH; y += 3) d.rect(0, y, TW, 1, 0xeae8d8);
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) if (hash(x, y, 4) < 0.04) d.px(x, y, 0xe4e2d0);
    // header band
    d.rect(0, 0, TW, 21, 0xb9dcc0);
    d.rect(0, 21, TW, 1, 0x4f9a62);
    d.text(kana, '通勤定期券', 7, 17, ink);
    const R = (s: string) => TW - 7 - latin.width(s);
    d.text(latin, 'COMMUTER', R('COMMUTER'), 9, 0x2f6a40);
    d.text(latin, '6 MONTHS', R('6 MONTHS'), 19, 0x2f6a40);
    // the route band, with the green strip down the left edge
    d.rect(0, 27, TW, 24, 0xdfeccd);
    d.rect(0, 26, TW, 2, 0x5fae72);
    d.rect(0, 51, TW, 2, 0x5fae72);
    d.rect(0, 22, 5, TH - 22, 0x5fae72);
    d.text(kana, 'いま', 12, 45, ink);
    this.arrow(d, 51, 39);
    d.text(kana, 'あした', 80, 45, ink);
    // validity, one small row at the bottom: the middle of the card is for the lyric
    d.text(latin, 'VALID', 12, 103, 0x3a4a40);
    d.text(latin, '11.03 - 11.03', 12 + latin.width('VALID') + 6, 103, ink);
    this.print(d);
    for (let i = 0; i < k; i++) this.mark(d, MARKS[i]!, i);
    this.corners(d);
    for (let i = 0; i < k; i++) {
      const m = MARKS[i]!;
      if (m.kind !== 'stamp') this.cut(d, m);
    }
    for (let i = 0; i < holes; i++) this.punch(d, this.slots[i]!, false);
  }

  private paintBack(d: Top, k: number, holes: number) {
    d.fill(0xe6e7d5);
    for (let y = 0; y < TH; y += 3) d.rect(0, y, TW, 1, 0xdfe1ce);
    d.rect(0, 8, TW, 13, 0x241d1b);
    d.rect(0, 10, TW, 1, 0x3a312d);
    d.rect(0, 19, TW, 1, 0x15110f);
    d.text(this.fonts.kana, 'ご注意', 8, 40, 0x4a544c);
    // small print: grey runs standing for lines of notes
    for (let row = 0; row < 7; row++) {
      let x = 8;
      while (x < TW - 14) {
        const run = 4 + Math.floor(hash(row, x, 2) * 14);
        d.rect(x, 50 + row * 7, Math.min(run, TW - 8 - x), 2, 0x9ea69a);
        x += run + 3;
      }
    }
    // the holes and the notches go through the card: mirror them on the back
    for (let i = 0; i < k; i++) {
      const m = MARKS[i]!;
      if (m.kind === 'stamp') this.bleed(d, m);
    }
    this.corners(d);
    for (let i = 0; i < k; i++) {
      const m = MARKS[i]!;
      if (m.kind !== 'stamp') this.cut(d, { ...m, x: TW - 1 - m.x });
    }
    for (let i = 0; i < holes; i++) this.punch(d, this.slots[i]!, true);
  }

  /** The pale ghost of a date stamp on the back of the card. */
  private bleed(d: Top, m: Extract<Mark, { kind: 'stamp' }>) {
    const cx = TW - 1 - m.x;
    for (let y = -m.r; y <= m.r; y++) for (let x = -m.r; x <= m.r; x++) {
      const e = Math.abs(Math.hypot(x, y) - m.r);
      if (e < 0.8 && hash(x, y, 77) < 0.5) d.px(cx + x, m.y + y, 0xd9c1b4);
    }
  }

  private corners(d: Top) {
    const cut = [3, 1, 1];
    cut.forEach((n, y) => {
      for (let x = 0; x < n; x++) {
        d.clear(x, y); d.clear(TW - 1 - x, y); d.clear(x, TH - 1 - y); d.clear(TW - 1 - x, TH - 1 - y);
      }
    });
  }

  private arrow(d: Top, x0: number, y: number) {
    const x1 = x0 + 24, c = 0x1c2a22;
    d.rect(x0 + 1, y - 1, 22, 2, c);
    for (let i = 0; i < 6; i++) { d.px(x1 - i, y - i, c); d.px(x1 - i, y + i, c); }
  }

  private mark(d: Top, m: Mark, i: number) {
    if (m.kind === 'stamp') {
      const red = 0xc2262c;
      for (let y = -m.r; y <= m.r; y++) for (let x = -m.r; x <= m.r; x++) {
        const e = Math.abs(Math.hypot(x, y) - m.r);
        if (e < 1 && hash(x + i * 31, y, 5) > 0.1) d.px(m.x + x, m.y + y, red);
      }
      d.text(this.fonts.kana, '改', m.x - 8, m.y + 6, red);
      for (let x = -m.r + 3; x <= m.r - 3; x++) if (hash(x, i, 6) > 0.15) d.px(m.x + x, m.y - 8 + (m.r < 12 ? 1 : 0), red);
    }
  }

  /** Clears the texels of a hole or notch (they go through the card). */
  private cut(d: Top, m: Mark) {
    if (m.kind === 'hole') {
      for (let y = -m.r; y <= m.r; y++) for (let x = -m.r; x <= m.r; x++) if (Math.hypot(x, y) <= m.r + 0.3) d.clear(m.x + x, m.y + y);
    } else if (m.kind === 'notch') {
      for (let a = 0; a < 5; a++) for (let b = -(4 - a); b <= 4 - a; b++) {
        if (m.edge === 'top') d.clear(m.x + b, a);
        else if (m.edge === 'bottom') d.clear(m.x + b, TH - 1 - a);
        else if (m.edge === 'left') d.clear(a, m.y + b);
        else d.clear(TW - 1 - a, m.y + b);
      }
    }
  }
}

/**
 * The pass that the sardine carries, for `Fish.hold`: one size in every scene (`Fish.PASS_SCALE`). `punched`: the card of after line 7, with its
 * printed line and all its holes. Not punched: the plain card of before. `light`: the share of the light that the paper takes (it is nearly
 * white: under strong lamps it blooms into a blob).
 */
export function carriedPass(fonts: Fonts, punched: boolean, light = 0.7): Ticket {
  const pass = punched ? new Ticket(fonts, Fish.PASS_SCALE) : new Ticket(fonts, Fish.PASS_SCALE, []);
  if (punched) pass.setHoles(pass.holeCount);
  pass.root.traverse((o) => { if (o instanceof THREE.Mesh) (o.material as THREE.MeshLambertMaterial).color.setScalar(light); });
  return pass;
}
