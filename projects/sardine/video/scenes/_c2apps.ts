// The fake programs of chorus 2 (`chorus2.ts`): the reminders of the jellyfish, the small ERR boxes, the Close Program box of line 29
// (Ctrl+Alt+Del) and the box that asks again for WINMGR.EXE. Each draws the inside of its window on the text layer as a pure
// function of t.
import type { Line } from '@pve/engine/lyrics';
import type { TextLayer } from '@pve/engine/textlayer';
import { hashSin } from '@pve/engine/util';
import { FR, SPB } from './_time';
import type { Fonts } from './_fonts';
import { printKana } from './_kana';
import { layoutOnce } from './_captionCarriers';
import { CURSOR_FLOOR } from './_buddy';
import { centreOf, contentRect, type Rect, type Vec2, type WinSpec } from './_playerTypes';
import { chromeText, chromeWidth } from './_playerChrome';
import { FILL, T_COPIES, T_END1, T_SEL1, T_SEL2 } from './_c2clock';

export const PANEL = '#d8dcea';
const PANEL_CA = '#b4c2e2';

/**
 * The Close Program box of line 29 (Ctrl+Alt+Del): a list of the programs, scrolled to its end, with one JELLY.EXE row for each copy
 * that has come, and the buttons End Task, Shut Down and Cancel. Then the box that asks again for WINMGR.EXE.
 */
export const TM_RECT: Rect = [170, 70, 300, 150];
const tmContent = contentRect(TM_RECT, false);
/** The list shows this many rows of 11 px. */
export const TM_VIS = 6;
const tmRowY = (i: number) => tmContent[1] + 8 + 11 * i;
/** The place where the cursor clicks row `v` of the list. */
export const tmRowAt = (v: number): Vec2 => [tmContent[0] + 60, tmRowY(v) + 5];
export const tmButton = (i: number): Rect => [tmContent[0] + Math.round((tmContent[2] - 3 * 62 + 4) / 2) + 62 * i, tmContent[1] + tmContent[3] - 16, 58, 12];
export const CONF_RECT: Rect = [222, 132, 236, 72];
const confContent = contentRect(CONF_RECT, false);
const confButton = (i: number): Rect => [confContent[0] + Math.round((confContent[2] - 2 * 62 + 4) / 2) + 62 * i, confContent[1] + confContent[3] - 15, 58, 12];
/** The cursor is on the End Task of the second box when the desktop repaints, and it drops straight down: it lies at `CURSOR_REST` when chorus 3 starts. */
export const CURSOR_LAST: Vec2 = centreOf(confButton(0));
export const CURSOR_REST: Vec2 = [CURSOR_LAST[0], CURSOR_FLOOR];
const ERR_CODES = ['E_DAY_NULL', 'SECTOR 49?', 'E_NO_TOMORROW', 'ROW LOCKED', 'E_TEX 0xFF', 'STACK 0xDAY'] as const;

/** The button `i` of `n` of a reminder with the content rectangle `c`. */
export function remButton(c: Rect, i: number, n: number): Rect {
  const bw = 36, bh = 12, total = n * bw + (n - 1) * 6;
  return [c[0] + Math.round((c[2] - total) / 2) + i * (bw + 6), c[1] + c[3] - bh - 4, bw, bh];
}

/** A reminder of the jellyfish: a small dialog with an info icon, the line (each unit pressed in on its start) and its buttons. `copy`: the `ca` voice, in a cool ink. */
export function reminder(f: Fonts, id: string, title: string, rect: Rect, line: Line, copy: boolean, buttons: readonly string[]): WinSpec {
  const panel = copy ? PANEL_CA : PANEL;
  return {
    id, title, rect,
    body: {
      kind: 'draw',
      draw: (l, c, t) => {
        const [x, y, w, h] = c;
        l.rect(x, y, w, h, panel);
        // a reminder that the point pulls in is too small for its text
        if (w < 100 || h < 36) return;
        l.rect(x + 6, y + 6, 11, 11, '#2a4ab8');
        l.rect(x + 11, y + 8, 2, 2, '#ffffff');
        l.rect(x + 11, y + 11, 2, 4, '#ffffff');
        const lay = layoutOnce(f, line, `rem|${copy ? 1 : 0}`, { x: 0, y: 0, align: 'center', n: 1, ink: copy ? '#3e5ea8' : '#14141c', edge: panel, outer: panel });
        if (w >= lay.box[2] + 30) {
          const dx = x + 22 + Math.round((w - 28) / 2) - Math.round(lay.box[0] + lay.box[2] / 2), dy = y + 5 - lay.box[1];
          printKana(l, lay, t, copy ? { motion: 'press', dx, dy, hot: '#ffffff' } : { motion: 'press', dx, dy, hot: '#d82828' });
        }
        buttons.forEach((b, i) => appButton(l, f, remButton(c, i, buttons.length), b, false));
      },
    },
  };
}

/** The inside of ERR box n: a red stop icon, a hex dump line or an error code, in turn. */
export function drawErr(l: TextLayer, f: Fonts, c: Rect, n: number) {
  const [x, y, w, h] = c;
  l.rect(x, y, w, h, '#6a6884');
  if (w < 40 || h < 20) return;
  if (n % 3 === 0) {
    const cx = x + Math.round(w / 2), cy = y + Math.round(h / 2);
    l.rect(cx - 6, cy - 4, 12, 8, '#c81818');
    l.rect(cx - 4, cy - 6, 8, 12, '#c81818');
    l.rect(cx - 3, cy - 1, 6, 2, '#ffffff');
    return;
  }
  if (n % 3 === 1) {
    const hex = Array.from({ length: 3 }, (_, i) => Math.floor(hashSin(n, i) * 256).toString(16).toUpperCase().padStart(2, '0')).join(' ');
    chromeText(l, f, `0x${((n * 4099) % 65536).toString(16).toUpperCase().padStart(4, '0')}`, x + 3, y + 9, '#e8e8f0', null);
    chromeText(l, f, hex, x + 3, y + 19, '#c8f0c8', null);
    return;
  }
  const code = ERR_CODES[Math.floor(n / 3) % ERR_CODES.length]!;
  chromeText(l, f, code, x + Math.max(2, Math.round((w - chromeWidth(f, code)) / 2)), y + Math.round(h / 2) + 3, '#ffe0e0', null);
}

/** A push button of a program, in when `down`. */
function appButton(l: TextLayer, f: Fonts, r: Rect, text: string, down: boolean) {
  const [bx, by, bw, bh] = r, d = down ? 1 : 0;
  l.rect(bx, by, bw, bh, '#40445a');
  l.rect(bx + d, by + d, bw - 1, bh - 1, '#f4f6fc');
  l.rect(bx + 1, by + 1, bw - 2, bh - 2, '#c4c8d6');
  chromeText(l, f, text, bx + d + Math.round((bw - chromeWidth(f, text)) / 2), by + d + 9, '#14141c', null);
}

/**
 * The inside of the Close Program box: the list (scrolled to its end; one JELLY.EXE row for each copy that has come, with its CPU
 * share), the warning of Win98 and the three buttons. The selected row is blue. WINMGR.EXE goes from the list when it is ended.
 */
export function drawTm(l: TextLayer, f: Fonts, c: Rect, t: number) {
  const [x, y, w, h] = c;
  l.rect(x, y, w, h, PANEL);
  if (w < 200 || h < 110) return;
  const copies = Array.from({ length: 12 }, (_, i) => T_COPIES + i * 2 * SPB).filter((b) => b <= t).length;
  const ended = t >= FILL[0] + 2 * FR;
  const cpu = (i: number) => 96 + Math.floor(hashSin(i, Math.floor(t * 4)) * 4);
  const rows: [string, string, string][] = [['MÖBIUS.EXE', '', '3%'], ['BUDDY.EXE', '[Not responding]', '12%']];
  for (let i = 0; i < copies; i++) rows.push(['JELLY.EXE', '[Not responding]', `${cpu(i)}%`]);
  if (!ended) rows.push(['WINMGR.EXE', '', '0%']);
  rows.push(['SYSTRAY.EXE', '', '0%']);
  // the list box: white, sunk, scrolled to its end
  const lx = x + 6, ly = y + 6, lw = w - 12, lh = TM_VIS * 11 + 4;
  l.rect(lx - 1, ly - 1, lw + 2, lh + 2, '#40445a');
  l.rect(lx, ly, lw, lh, '#ffffff');
  const first = Math.max(0, rows.length - TM_VIS);
  const sel = ended ? -1 : t >= T_SEL2 ? TM_VIS - 2 : t >= T_SEL1 ? TM_VIS - 3 : -1;
  for (let v = 0; v < TM_VIS && first + v < rows.length; v++) {
    const [name, note, share] = rows[first + v]!, ry = tmRowY(v), on = v === sel;
    if (on) l.rect(lx + 1, ry, lw - 12, 11, '#000080');
    const ink = on ? '#ffffff' : '#14141c';
    chromeText(l, f, name, lx + 4, ry + 8, ink, null);
    if (note) chromeText(l, f, note, lx + 82, ry + 8, on ? '#ffffff' : '#b02020', null);
    chromeText(l, f, share, lx + lw - 16 - chromeWidth(f, share), ry + 8, ink, null);
  }
  // the scroll bar: the thumb at the end
  l.rect(lx + lw - 10, ly, 10, lh, '#c4c8d6');
  const th = Math.max(8, Math.round((lh * TM_VIS) / rows.length));
  l.rect(lx + lw - 9, ly + lh - th, 8, th, '#8a8ea0');
  chromeText(l, f, 'WARNING: Pressing CTRL+ALT+DEL again will restart', x + 8, ly + lh + 12, '#14141c', null);
  chromeText(l, f, 'your computer. You will lose unsaved information.', x + 8, ly + lh + 22, '#14141c', null);
  ['End Task', 'Shut Down', 'Cancel'].forEach((b, i) => appButton(l, f, tmButton(i), b, i === 0 && t >= T_END1 && t < T_END1 + 0.15));
}

/** The inside of the box that asks again: WINMGR.EXE is not responding, End Task or Cancel. */
export function drawConf(l: TextLayer, f: Fonts, c: Rect, t: number) {
  const [x, y, w, h] = c;
  l.rect(x, y, w, h, PANEL);
  if (w < 160 || h < 40) return;
  l.rect(x + 8, y + 6, 13, 13, '#c81818');
  l.rect(x + 12, y + 8, 5, 9, '#ffffff');
  chromeText(l, f, 'This program is not responding.', x + 28, y + 12, '#14141c', null);
  chromeText(l, f, 'End Task: all unsaved data is lost.', x + 28, y + 22, '#14141c', null);
  ['End Task', 'Cancel'].forEach((b, i) => appButton(l, f, confButton(i), b, i === 0 && t >= FILL[0] && t < FILL[0] + 0.15));
}
