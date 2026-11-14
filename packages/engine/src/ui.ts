// Pixel UI drawing over a TextLayer: rectangles, lines, rings, outlined pixel text, bevelled push buttons (1 px
// edges, RollerCoaster Tycoon style) and the arrow cursor. A project adds its own icons on top of it.
import type { PixelFont } from './type';
import type { Col } from './lit';
import type { TextLayer } from './textlayer';

const ARROW = [
  '1          ', '11         ', '121        ', '1221       ', '12221      ', '122221     ', '1222221    ', '12222221   ',
  '122222221  ', '1222222221 ', '12222211111', '1221221    ', '121 1221   ', '11  1221   ', '1    1221  ', '     1221  ', '      11   ',
];

/** The state of a push button: at rest, under the cursor, held down by the cursor, or a selected toggle. */
export type KeyState = 'up' | 'hover' | 'down' | 'on';

/** Drawing helpers over a TextLayer: bars, bevelled buttons, outlined pixel text, the arrow cursor. */
export class Ui {
  constructor(readonly l: TextLayer, readonly font: PixelFont) {}

  rect(x: number, y: number, w: number, h: number, c: Col) { this.l.rect(x, y, w, h, c); }

  /** A 1 px line from (x0, y0) to (x1, y1) (Bresenham). */
  line(x0: number, y0: number, x1: number, y1: number, c: Col) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.l.put(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /** A ring of 48 dots of radius r. */
  ring(cx: number, cy: number, r: number, c: Col) {
    for (let a = 0; a < 48; a++) this.l.put(cx + Math.cos((a / 48) * Math.PI * 2) * r, cy + Math.sin((a / 48) * Math.PI * 2) * r, c);
  }

  /** A crisp circle of 1 px (midpoint algorithm). */
  circle(cx: number, cy: number, r: number, c: Col) {
    let x = r, y = 0, e = 1 - r;
    while (x >= y) {
      for (const [a, b] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]] as const) this.l.put(cx + a, cy + b, c);
      y++;
      if (e < 0) e += 2 * y + 1;
      else { x--; e += 2 * (y - x) + 1; }
    }
  }

  /** Text with a 1 px outline, each pixel an n x n block. */
  text(s: string, x: number, y: number, ink: Col, edge: Col, n = 1) {
    const set = new Set<number>();
    const key = (px: number, py: number) => (py + 512) * 4096 + px + 512;
    this.font.draw({ put: (px, py) => set.add(key(px, py)) }, s, 0, 0, 1);
    const blk = (px: number, py: number, c: Col, grow: number) => {
      for (let j = -grow; j < n + grow; j++) for (let i = -grow; i < n + grow; i++) this.l.put(x + px * n + i, y + (py + 7) * n + j, c);
    };
    const pts = [...set].map((k) => [(k % 4096) - 512, Math.floor(k / 4096) - 512] as const);
    for (const [px, py] of pts) blk(px, py, edge, 1);
    for (const [px, py] of pts) blk(px, py, ink, 0);
  }

  textWidth(s: string, n = 1) { return this.font.width(s) * n; }

  bevel(x: number, y: number, w: number, h: number, pressed = false) {
    this.rect(x, y, w, h, pressed ? '#4e4c68' : '#7a7896');
    this.rect(x, y, w, 1, pressed ? '#2e2c40' : '#aeacc8');
    this.rect(x, y, 1, h, pressed ? '#2e2c40' : '#aeacc8');
    this.rect(x, y + h - 1, w, 1, pressed ? '#aeacc8' : '#3a3850');
    this.rect(x + w - 1, y, 1, h, pressed ? '#aeacc8' : '#3a3850');
  }

  /**
   * A push button as in RollerCoaster Tycoon: 1 px edges, and the label never moves. A raised button has a light edge on the top and the left
   * and a dark edge on the bottom and the right. Held down or selected, it is sunk: a darker face, the dark edge on the top and the left, the
   * light edge on the bottom and the right. `flat` (a toolbar button): no face and no edges at rest, raised under the cursor.
   */
  key(x: number, y: number, w: number, h: number, state: KeyState = 'up', flat = false) {
    const sunk = state === 'down' || state === 'on';
    if (flat && state === 'up') return;
    if (!flat || sunk) this.rect(x, y, w, h, sunk ? '#55536f' : '#7a7896');
    const lo = '#2e2c40', hi = '#b4b2cc';
    this.rect(x, y, w, 1, sunk ? lo : hi);
    this.rect(x, y, 1, h, sunk ? lo : hi);
    this.rect(x, y + h - 1, w, 1, sunk ? hi : lo);
    this.rect(x + w - 1, y, 1, h, sunk ? hi : lo);
  }

  /** A 20 x 18 flat toolbar button with its icon in the middle (`key`). */
  button(x: number, y: number, state: KeyState, icon: (cx: number, cy: number) => void) {
    this.key(x, y, 20, 18, state, true);
    icon(x + 10, y + 9);
  }

  /** The arrow cursor (black edge, white face), its tip at (x, y). */
  arrow(x: number, y: number) {
    ARROW.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const c = row[i]; if (c === '1') this.l.put(x + i, y + j, '#101010'); else if (c === '2') this.l.put(x + i, y + j, '#f8f8f8'); } });
  }
}
