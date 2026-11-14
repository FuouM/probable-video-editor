// The chrome of the sardine player on the 640x360 `TextLayer`: the palette, the chrome text (Silkscreen and kana), the
// tool handle, the snap banner, the ghost arc and the arrow cursor. `PlayerRig` (`_playerRig.ts`) draws the windows with them.
import { FR } from './_time';
import type { Fonts } from './_fonts';
import { LW, type Col } from '@pve/engine/lit';
import type { Ui } from '@pve/engine/ui';
import type { TextLayer } from '@pve/engine/textlayer';
import type { PixelFont } from '@pve/engine/type';
import { toolIcons } from './_toolIcons';
import type { HandleState, Rect, Tool, Vec2 } from './_playerTypes';

/** The palette of the chrome. */
export const C = {
  bar: '#5d5a78', barHi: '#9896b6', barLo: '#2e2c40',
  face: '#7a7896', faceHi: '#aeacc8', faceLo: '#3a3850', sunk: '#4e4c68',
  teal: '#2f6e76', tealHi: '#4b9a9c', grey: '#6c6a86',
  ink: '#f4f4f8', dark: '#101018', panel: '#cfcde0', panelInk: '#1c1a2a',
  err: '#d82828', warn: '#ffd23a',
};

/** True for a character of the wide (kana) face. */
export const isWide = (ch: string) => ch.charCodeAt(0) >= 0x2000;

/** The width of `s` in px: latin in Silkscreen, everything else in `wide` (the 10 px kana of the chrome by default), each pixel `n` px. */
export function chromeWidth(fonts: Fonts, s: string, n = 1, wide: PixelFont = fonts.kanaS): number {
  let w = 0;
  for (const ch of s) w += (isWide(ch) ? wide : fonts.latin).width(ch) * n;
  return w;
}

/**
 * Draws `s` with the pen at x and the baseline at y. Latin text is Silkscreen, other text is `o.wide` (the 10 px kana of the
 * bars by default). `edge` draws a 1 px outline in that colour. `o.n` scales the pixels. `o.clip` clips to a rectangle.
 */
export function chromeText(l: TextLayer, fonts: Fonts, s: string, x: number, y: number, ink: Col, edge: Col | null, o: { n?: number; wide?: PixelFont; clip?: Rect } = {}) {
  const n = o.n ?? 1;
  const wide = o.wide ?? fonts.kanaS;
  const pass = (c: Col, grow: number) => {
    let px = x;
    for (const ch of s) {
      const f = isWide(ch) ? wide : fonts.latin;
      const g = f.glyph(ch);
      for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
        if (!g.bits[j * g.w + i]) continue;
        const bx = px + (g.x0 + i) * n - grow, by = y + (g.y0 + j) * n - grow, sz = n + 2 * grow;
        if (o.clip) {
          const cx0 = Math.max(bx, o.clip[0]), cy0 = Math.max(by, o.clip[1]);
          const cx1 = Math.min(bx + sz, o.clip[0] + o.clip[2]), cy1 = Math.min(by + sz, o.clip[1] + o.clip[3]);
          if (cx1 > cx0 && cy1 > cy0) l.rect(cx0, cy0, cx1 - cx0, cy1 - cy0, c);
        } else l.rect(bx, by, sz, sz, c);
      }
      px += g.adv * n;
    }
  };
  if (edge !== null) pass(edge, 1);
  pass(ink, 0);
}

/** The yellow end-node handle of a tool (a rail end, a zone corner), centred on `h.pos`. It is larger while held and flashes white for 2 frames after a snap. */
export function drawHandle(l: TextLayer, h: Pick<HandleState, 'pos' | 'phase' | 'since'>, size = 5) {
  const s = h.phase === 'held' ? size + 2 : size;
  const [x, y] = [Math.round(h.pos[0]) - Math.floor(s / 2), Math.round(h.pos[1]) - Math.floor(s / 2)];
  const flash = h.phase === 'snapped' && h.since < 2 * FR;
  l.rect(x - 1, y - 1, s + 2, s + 2, '#101018');
  l.rect(x, y, s, s, flash ? '#ffffff' : '#ffd23a');
  if (!flash) { l.rect(x, y, s, 1, '#fff2a0'); l.rect(x, y + s - 1, s, 1, '#c8901c'); }
}

/**
 * The snap flash banner, for example `[LINKED: あした ⇔ きのう]`: a box centred on `at` that shows inverted (white) for 2 frames,
 * then dark with a cyan rim, until `hold` s have passed. `age` is the time since the snap (`HandleState.since`).
 */
export function drawSnapBanner(l: TextLayer, fonts: Fonts, text: string, at: Vec2, age: number, hold = 0.9) {
  if (age < 0 || age >= hold) return;
  const w = chromeWidth(fonts, text) + 10, h = 14;
  const x = Math.max(2, Math.min(LW - w - 2, Math.round(at[0] - w / 2))), y = Math.round(at[1] - h / 2);
  const inv = age < 2 * FR;
  l.rect(x - 1, y - 1, w + 2, h + 2, '#000000');
  l.rect(x, y, w, h, inv ? '#ffffff' : '#7af0ff');
  l.rect(x + 1, y + 1, w - 2, h - 2, inv ? '#ffffff' : '#0a0c14');
  chromeText(l, fonts, text, x + 5, y + 11, inv ? '#0a0c14' : '#e8fcff', null);
}

/**
 * A glowing ghost arc from `a` to `b`, bowed sideways by `bow` px (the preview of the bend tool). Pixel-crisp: a 4 px glow, a 2 px
 * core that marches along the arc at 18 steps/s.
 */
export function drawGhostArc(l: TextLayer, a: Vec2, b: Vec2, t: number, bow = 24) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const cx = (a[0] + b[0]) / 2 - (dy / len) * bow, cy = (a[1] + b[1]) / 2 + (dx / len) * bow;
  const n = Math.max(8, Math.ceil(len * 0.8));
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, v = 1 - u;
    pts.push([Math.round(v * v * a[0] + 2 * v * u * cx + u * u * b[0]), Math.round(v * v * a[1] + 2 * v * u * cy + u * u * b[1])]);
  }
  for (const p of pts) l.rect(p[0] - 1, p[1] - 1, 4, 4, '#1c6c86');
  const march = Math.floor(t * 18);
  pts.forEach((p, i) => { if ((i + march) % 6 < 4) l.rect(p[0], p[1], 2, 2, '#c8fbff'); });
}

/** The arrow cursor at `(x, y)`, and when a tool is selected its icon on a plate at the tip (RollerCoaster Tycoon, The Sims). A pressed cursor sits 1 px to the lower right. */
export function drawCursor(ui: Ui, x: number, y: number, tool: Tool | null, down = false) {
  const d = down ? 1 : 0;
  if (tool) {
    const px = x + d + 8, py = y + d + 8;
    ui.rect(px, py, 15, 15, '#101018');
    ui.rect(px + 1, py + 1, 13, 13, C.faceLo);
    toolIcons(ui)(tool, px + 7, py + 7);
  }
  ui.arrow(x + d, y + d);
}
