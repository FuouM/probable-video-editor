// The text windows of the sardine player: the layout of their lines and buttons (shared by `PlayerRig` and by the
// cursor's aim) and the window factories: the CONTINUE / DAY 1 modal, the LOAD ERROR modal, the ERR and WARNING
// windows and the `[FISH CAM]` window.
import type { Fonts } from './_fonts';
import { LH, LW } from '@pve/engine/lit';
import { chromeWidth, isWide } from './_playerChrome';
import { BORDER, STATUS_H, TITLE_H, contentRect, type Rect, type TextLine, type Vec2, type WinBody, type WinSpec } from './_playerTypes';

interface TextLay { lines: { x: number; y: number }[]; buttons: Rect[]; icon: Vec2 }

/**
 * The height of a line of a text window: its pixel scale times 8 and 6 px of air. A line with kana: the kana are 10 px high, so the
 * scale times 10 and 8 px of air (18 px at scale 1, as before).
 */
const lineHeight = (ln: TextLine) => { const n = ln.n ?? 1; return [...ln.text].some(isWide) ? n * 10 + 8 : n * 8 + 6; };

/** Places the lines and buttons of a text window inside `content`. Shared by drawing and by the cursor's aim. */
export function textLayout(fonts: Fonts, body: Extract<WinBody, { kind: 'text' }>, c: Rect): TextLay {
  const icon = body.icon ? 24 : 0;
  const heights = body.lines.map(lineHeight);
  const btnH = body.buttons?.length ? 22 : 0;
  const total = heights.reduce((a, b) => a + b, 0);
  const x0 = c[0] + icon + 4, rw = c[2] - icon - 8;
  let y = c[1] + Math.max(6, Math.floor((c[3] - btnH - total) / 2));
  const lines = body.lines.map((ln, k) => {
    const n = ln.n ?? 1;
    // the baseline: a line with kana has 4 px of air over its kana (10 px each scale step); a Latin line sits on its 8 px cell
    const out = { x: Math.round(x0 + (rw - chromeWidth(fonts, ln.text, n, fonts.kana)) / 2), y: y + (/[^\x00-\x7f]/.test(ln.text) ? 4 + n * 10 : n * 8) };
    y += heights[k]!;
    return out;
  });
  const labels = body.buttons ?? [];
  const widths = labels.map((b) => fonts.latin.width(b) + 16);
  const gap = 8;
  let bx = c[0] + Math.floor((c[2] - (widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, labels.length - 1))) / 2);
  const buttons = labels.map((_, k): Rect => { const r: Rect = [bx, c[1] + c[3] - 20, widths[k]!, 14]; bx += widths[k]! + gap; return r; });
  return { lines, buttons, icon: [c[0] + 6, c[1] + Math.max(6, Math.floor((c[3] - btnH) / 2) - 8)] };
}

/** The rectangle of the button `label` of a text window at its resting place (for the cursor to aim at). */
export function modalButton(fonts: Fonts, spec: WinSpec, label: string): Rect {
  const body = spec.body;
  if (body?.kind !== 'text') throw new Error(`player: window "${spec.id}" has no text body`);
  const k = (body.buttons ?? []).indexOf(label);
  if (k < 0) throw new Error(`player: window "${spec.id}" has no button "${label}"`);
  return textLayout(fonts, body, contentRect(spec.rect, false)).buttons[k]!;
}

/** The outer size [w, h] a text window needs for its lines and buttons. */
export function textSize(fonts: Fonts, lines: TextLine[], buttons: string[] = [], icon = false): [number, number] {
  const w = Math.max(...lines.map((ln) => chromeWidth(fonts, ln.text, ln.n ?? 1, fonts.kana)), buttons.reduce((a, b) => a + fonts.latin.width(b) + 24, 0)) + (icon ? 24 : 0) + 24;
  const h = lines.reduce((a, ln) => a + lineHeight(ln), 0) + (buttons.length ? 22 : 0) + 18 + 2 * BORDER + TITLE_H + STATUS_H;
  return [Math.max(w, 140) + 2 * BORDER, h];
}

const centred = (size: [number, number]): Rect => [Math.round((LW - size[0]) / 2), Math.round((LH - size[1]) / 2), size[0], size[1]];

/** The modal that opens in the interlude: `CONTINUE / DAY 1`. The cursor clicks CONTINUE. */
export function continueModal(fonts: Fonts, o: { id?: string; day?: number } = {}): WinSpec {
  const lines: TextLine[] = [{ text: `DAY ${o.day ?? 1}`, n: 3 }, { text: 'SAVE FOUND' }];
  return {
    id: o.id ?? 'continue', title: '[LOAD GAME]', rect: centred(textSize(fonts, lines, ['CONTINUE'], true)), modal: true, dim: 0.12, status: 'SLOT 1',
    body: { kind: 'text', lines, buttons: ['CONTINUE'], icon: 'info' },
  };
}

/** The red modal of a load that fails: `LOAD ERROR: SECTOR CORRUPT` and `CANNOT RETURN TO もと`. `say`: one more line under them (the last modal carries a lyric line). */
export function loadErrorModal(fonts: Fonts, o: { id?: string; where?: string; say?: string } = {}): WinSpec {
  // the last modal carries line 22 at 2x the 10 px kana (20 px, rule G4), in a larger window
  const lines: TextLine[] = [{ text: 'LOAD ERROR: SECTOR CORRUPT' }, { text: `CANNOT RETURN TO ${o.where ?? 'もと'}` }, ...(o.say ? [{ text: o.say.replace(/ /g, ''), n: 2 }] : [])];
  const size = textSize(fonts, lines, ['OK'], true);
  if (o.say) { size[0] = Math.max(size[0], 280); size[1] = Math.max(size[1], 110); }
  return {
    id: o.id ?? 'load-error', title: '[LOAD ERROR]', rect: centred(size), modal: true, alert: 'error', status: 'LOAD STATE (SLOT 1)',
    body: { kind: 'text', lines, buttons: ['OK'], icon: 'error' },
  };
}

/** An ERR (`error`) or WARNING (`warn`) window with lines of text. `rect` is the place; its size is `textSize`. */
export function alertWindow(fonts: Fonts, o: { id: string; level: 'warn' | 'error'; title?: string; lines: TextLine[]; at: Vec2; buttons?: string[] }): WinSpec {
  const size = textSize(fonts, o.lines, o.buttons ?? ['OK'], true);
  return {
    id: o.id, title: o.title ?? (o.level === 'error' ? '[ERR]' : '[WARNING]'), rect: [o.at[0], o.at[1], size[0], size[1]], alert: o.level,
    status: o.level === 'error' ? 'ERR' : 'WARNING',
    body: { kind: 'text', lines: o.lines, buttons: o.buttons ?? ['OK'], icon: o.level },
  };
}

/** The `[FISH CAM]` window (treatment "Framing"): a security-cam style window (REC dot, corner brackets, time stamp) whose view is a `FishCam`. The scene renders its view. */
export function fishCamWindow(o: { id?: string; rect: Rect; clock?: number }): WinSpec {
  return {
    id: o.id ?? 'fishcam', title: '[FISH CAM]', rect: o.rect, status: 'CAM F  OBJ 001', body: { kind: 'view' },
    cam: { labels: ['FISH'], ...(o.clock !== undefined ? { clock: o.clock } : {}) },
  };
}
