// The window compositor of the sardine player (`PlayerRig`): RCT chrome (toolbar, ticker, counter, windows, modals, the
// console, the click effects, the arrow cursor) on the 640x360 `TextLayer`, and each window's 3D view as a sized
// `LitView` that is blitted in HDR into the main view, so the bloom, the tone map, the dither and the CRT run once over
// the whole composite. Nothing here writes the 16 MB atlas: the chrome is drawn into the small text layer.
import * as THREE from 'three';
import { FSPass } from '@pve/engine/gl';
import { Ui, type KeyState } from '@pve/engine/ui';
import { LH, LW, type Col } from '@pve/engine/lit';
import { LitView } from '@pve/engine/litview';
import { TextLayer } from '@pve/engine/textlayer';
import type { Fonts } from './_fonts';
import { gameIcons, toolIcons } from './_toolIcons';
import { FPS } from './_time';
import { C, chromeText, chromeWidth, drawCursor, isWide } from './_playerChrome';
import { textLayout } from './_playerWindows';
import type { PlayerTrack } from './_playerTrack';
import { hash } from './_propKit';
import {
  BORDER, STATUS_H, TITLE_H, TOOLBAR, V6_TOOLS, camButtons, centreOf, inside, toolButton, viewButton, winButtons,
  type CamState, type PlayerState, type Rect, type Vec2, type WinBody, type WinState,
} from './_playerTypes';

const BLIT_FRAG = /* glsl */ `
uniform sampler2D uSrc;
uniform vec4 uRect;
uniform float uGain;
void main() {
  ivec2 p = ivec2(floor(gl_FragCoord.xy - uRect.xy));
  fragColor = vec4(texelFetch(uSrc, p, 0).rgb * uGain, 1.0);
}`;

/** The panel of the console (px): it stands in the bottom right corner, over the status bar and clear of the English line. */
const CONSOLE_W = 236;
const CONSOLE_H = 66;
/** A click's ring, flash and jump take at most this many frames. */
const CLICK_FRAMES = 6;

export interface RigOptions {
  track: PlayerTrack;
  fonts: Fonts;
  /** Draw the toolbars (the map view). Default true. */
  bars?: boolean;
  /** The gap between the console panel and the right edge of the frame, px (a window in the bottom right corner needs the room). Default 4. */
  consoleInset?: number;
  /** The text of the status ticker in the bottom bar. */
  ticker?: string | ((t: number) => string);
  /** The YEAR / DAY counter at the right of the bottom bar (for example `YEAR ????  NOV 03`, `DAY 004`). */
  counter?: string | ((t: number) => string);
  /** Show the ten v6 tool buttons in the top bar. Default false (the v5 scenes). */
  tools?: boolean;
  /** Show the rotate button in the top bar. Default false. The cursor clicks it before a `rotate` input. */
  rotate?: boolean;
  /** The cursor carries the icon of the selected tool at its tip. Default true. */
  cursorTool?: boolean;
}

/**
 * The window compositor. One rig per scene. `compose` renders the windows' 3D views and blits them into the main view,
 * `draw` writes the chrome into the text layer and the cursor into `top`. The scene clears the layer first and presents the
 * main view with the layer and with `top` (`Output.top`) afterwards: the cursor is over everything, as a real cursor is.
 */
export class PlayerRig {
  /** The layer of the cursor: the scene presents it as `Output.top`, over the interface, the text the scene draws after the chrome and the 3D overlay. */
  readonly top = new TextLayer();
  private views = new Map<string, LitView>();
  private blit = new FSPass(BLIT_FRAG, { uSrc: { value: null }, uRect: { value: new THREE.Vector4() }, uGain: { value: 1 } });

  constructor(private o: RigOptions) {}

  get track(): PlayerTrack { return this.o.track; }

  state(t: number): PlayerState { return this.o.track.stateAt(t); }

  /** The sized HDR view of a window's picture (created once for each window and size). */
  view(win: WinState): LitView {
    const [, , w, h] = win.content;
    const v = this.views.get(win.id);
    if (v && v.w === w && v.h === h) return v;
    v?.dispose();
    const n = new LitView(w, h);
    this.views.set(win.id, n);
    return n;
  }

  /** The aspect of a window's picture, for its camera. */
  aspect(win: WinState): number { return win.content[2] / win.content[3]; }

  /**
   * Renders the 3D view of every visible window (`render` draws the window's world through its camera into `view`) and
   * blits the pictures into `main`'s HDR target in window order. Windows under a maximized window are not rendered.
   * Call it after the main view rendered its world. When a window is maximized, `main` is cleared first: the map under it
   * is not drawn.
   */
  compose(renderer: THREE.WebGLRenderer, main: LitView, st: PlayerState, render: (win: WinState, view: LitView) => void, gain: (win: WinState) => number = () => 1) {
    if (st.maximized) {
      // a clear to black: the map under a maximized window is not drawn, and the frame must not depend on the frame before
      const prev = new THREE.Color();
      renderer.getClearColor(prev);
      const alpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 1);
      renderer.setRenderTarget(main.rt);
      renderer.clear(true, true, false);
      renderer.setClearColor(prev, alpha);
    }
    for (const win of this.visible(st)) {
      if (win.spec.body && win.spec.body.kind !== 'view') continue;
      if (win.grow < 1) continue;
      const v = this.view(win);
      render(win, v);
      const [x, y, w, h] = win.content;
      const gy = LH - (y + h);
      const x0 = Math.max(0, x), y0 = Math.max(0, gy), x1 = Math.min(LW, x + w), y1 = Math.min(LH, gy + h);
      if (x1 <= x0 || y1 <= y0) continue;
      this.blit.u.uSrc!.value = v.rt.texture;
      (this.blit.u.uRect!.value as THREE.Vector4).set(x, gy, w, h);
      this.blit.u.uGain!.value = gain(win);
      this.blit.render(renderer, main.rt, false, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  }

  /** The windows that show: those above the top maximized window. */
  private visible(st: PlayerState): WinState[] {
    if (!st.maximized) return st.windows;
    return st.windows.filter((w) => w.z >= st.maximized!.z);
  }

  // ---------------------------------------------------------------- chrome

  /**
   * Draws the toolbars, the windows, the modals, the tooltip and the click effects into `l` (cleared by the caller), and the cursor
   * into `top` (cleared here). `over` draws after the windows and before the tooltip: handles, ghost arcs and banners go there.
   */
  draw(l: TextLayer, st: PlayerState, over?: (l: TextLayer, st: PlayerState) => void) {
    const ui = new Ui(l, this.o.fonts.latin);
    if (!st.maximized && this.o.bars !== false) this.bars(ui, st);
    for (const win of this.visible(st)) {
      if (win.spec.modal) l.shade(0, 0, LW, LH, win.spec.dim ?? 0.5);
      this.window(ui, win, st);
    }
    over?.(l, st);
    this.tooltip(ui, st);
    this.console(ui, st);
    this.clickFx(ui, st);
    this.top.clear();
    this.cursor(new Ui(this.top, this.o.fonts.latin), st);
    this.top.commit();
  }

  private pressed(st: PlayerState, r: Rect): boolean { return st.cursor.down && inside(r, st.cursor.x, st.cursor.y); }
  /** The state of a button: `on` when it is the selected toggle, `down` while the cursor holds it, `hover` while the cursor is over it. */
  private keyState(st: PlayerState, r: Rect, on = false): KeyState {
    return on ? 'on' : this.pressed(st, r) ? 'down' : inside(r, st.cursor.x, st.cursor.y) ? 'hover' : 'up';
  }

  private bars(ui: Ui, st: PlayerState) {
    const I = gameIcons(ui);
    const press = (r: Rect, on = false) => this.keyState(st, r, on);
    ui.rect(0, 0, LW, 22, C.bar);
    ui.rect(0, 21, LW, 1, C.barLo);
    ui.rect(0, 0, LW, 1, C.barHi);
    [I.film, I.grid, I.home, I.disc, I.window, I.plus, I.map].forEach((ic, k) => ui.button(4 + k * 22, 2, press(TOOLBAR.top(k)), ic));
    if (this.o.tools) {
      ui.rect(165, 4, 1, 14, C.barLo);
      ui.rect(166, 4, 1, 14, C.barHi);
      const icon = toolIcons(ui);
      for (const tool of V6_TOOLS) {
        const r = toolButton(tool);
        ui.button(r[0], r[1], press(r, st.tool === tool), (cx, cy) => icon(tool, cx, cy));
      }
    }
    if (this.o.rotate) ui.button(TOOLBAR.rotate[0], TOOLBAR.rotate[1], press(TOOLBAR.rotate), I.rotate);
    ui.key(LW - 24, 2, 20, 18, press(TOOLBAR.topClose));
    ui.rect(LW - 23, 3, 18, 16, '#c0342c');
    I.close(LW - 14, 11);
    const y = LH - 22;
    ui.rect(0, y, LW, 22, C.bar);
    ui.rect(0, y, LW, 1, C.barHi);
    ui.rect(0, LH - 1, LW, 1, C.barLo);
    const btn = (r: Rect, on: boolean, ic: (cx: number, cy: number) => void) => ui.button(r[0], r[1], press(r, on), ic);
    btn(TOOLBAR.menu, false, I.menu);
    btn(TOOLBAR.shovel, st.tool === 'shovel', I.shovel);
    btn(TOOLBAR.rail, st.tool === 'rail', I.rail);
    btn(TOOLBAR.bulldozer, st.tool === 'bulldozer', I.bulldozer);
    btn(TOOLBAR.scissors, st.tool === 'scissors', I.scissors);
    btn(TOOLBAR.pause, st.speed === 'pause', I.pause);
    btn(TOOLBAR.play, st.speed === 'play', I.play);
    btn(TOOLBAR.fast, st.speed === 'fast', I.fast);
    this.ticker(ui, st);
  }

  /** The status ticker and the counter of the bottom bar. */
  private ticker(ui: Ui, st: PlayerState) {
    const tk = TOOLBAR.ticker, ct = TOOLBAR.counter;
    ui.rect(tk[0], tk[1], tk[2], tk[3], C.sunk);
    ui.rect(tk[0], tk[1], tk[2], 1, C.barLo);
    ui.rect(ct[0], ct[1], ct[2], ct[3], C.sunk);
    ui.rect(ct[0], ct[1], ct[2], 1, C.barLo);
    const text = typeof this.o.ticker === 'function' ? this.o.ticker(st.t) : this.o.ticker ?? '';
    const wd = chromeWidth(this.o.fonts, text);
    const room = tk[2] - 8;
    // a ticker that does not fit scrolls, 2 px at 12 fps
    const off = wd > room ? (Math.floor(st.t * 12) * 2) % (wd + 40) : 0;
    chromeText(ui.l, this.o.fonts, text, tk[0] + 4 - off, tk[1] + 11, '#ffffff', C.sunk, { clip: [tk[0] + 2, tk[1] + 1, tk[2] - 4, tk[3] - 2] });
    const count = typeof this.o.counter === 'function' ? this.o.counter(st.t) : this.o.counter ?? '';
    chromeText(ui.l, this.o.fonts, count, ct[0] + ct[2] - 6 - chromeWidth(this.o.fonts, count), ct[1] + 11, '#ffd23a', C.sunk);
  }

  // ---------------------------------------------------------------- windows

  private window(ui: Ui, win: WinState, st: PlayerState) {
    const l = ui.l;
    if (win.grow < 1) {
      // the opening box: a bevelled outline that grows in 2 frames
      const [x, y, w, h] = win.box;
      l.rect(x, y, w, h, C.faceHi);
      l.rect(x + 1, y + 1, w - 2, h - 2, C.faceLo);
      l.rect(x + 2, y + 2, w - 4, h - 4, '#000000', 0);
      return;
    }
    const [x, y, w, h] = win.rect;
    const top = st.windows[st.windows.length - 1] === win || win.spec.modal === true;
    if (!win.maximized) this.frame(ui, win);
    // the title bar
    const tx = win.maximized ? 0 : x + BORDER, ty = win.maximized ? 0 : y + BORDER, tw = win.maximized ? LW : w - 2 * BORDER;
    l.rect(tx, ty, tw, TITLE_H, top ? C.teal : C.grey);
    l.rect(tx, ty, tw, 1, top ? C.tealHi : C.faceHi);
    chromeText(l, this.o.fonts, win.title, tx + 3, ty + 8, C.ink, top ? C.teal : C.grey);
    this.titleButtons(ui, win, st);
    this.statusBar(l, win, tx, tw, win.maximized ? LH - STATUS_H : y + h - BORDER - STATUS_H);
    this.content(ui, win, st);
  }

  /** The frame of a window that is not maximized: bevel, then the 2 px border (an alert window flashes it). */
  private frame(ui: Ui, win: WinState) {
    const l = ui.l, [x, y, w, h] = win.rect;
    ui.bevel(x, y, w, h);
    if (win.alert !== 'none' && win.flash) {
      const c = win.alert === 'error' ? C.err : C.warn;
      l.rect(x, y, w, BORDER, c); l.rect(x, y + h - BORDER, w, BORDER, c); l.rect(x, y, BORDER, h, c); l.rect(x + w - BORDER, y, BORDER, h, c);
    }
  }

  /** The minimize, maximize and close buttons of the title bar, and the cam buttons or the view button left of them. */
  private titleButtons(ui: Ui, win: WinState, st: PlayerState) {
    const l = ui.l, fonts = this.o.fonts;
    const b = winButtons(win.rect, win.maximized);
    const small = (r: Rect, glyph: () => void) => {
      ui.key(r[0], r[1], r[2], r[3], this.keyState(st, r));
      glyph();
    };
    small(b.min, () => l.rect(b.min[0] + 2, b.min[1] + 5, 5, 1, C.ink));
    small(b.max, () => { l.rect(b.max[0] + 2, b.max[1] + 1, 5, 1, C.ink); l.rect(b.max[0] + 2, b.max[1] + 2, 1, 4, C.ink); l.rect(b.max[0] + 6, b.max[1] + 2, 1, 4, C.ink); l.rect(b.max[0] + 2, b.max[1] + 6, 5, 1, C.ink); });
    small(b.close, () => {
      if (win.closeFlash) l.rect(b.close[0] + 1, b.close[1] + 1, b.close[2] - 2, b.close[3] - 2, C.err);
      ui.line(b.close[0] + 2, b.close[1] + 1, b.close[0] + 6, b.close[1] + 6, C.ink);
      ui.line(b.close[0] + 6, b.close[1] + 1, b.close[0] + 2, b.close[1] + 6, C.ink);
    });
    if (win.cam) {
      // one button for each feed: the one that shows is sunk and yellow
      camButtons(win.rect, win.maximized, win.cam.labels.length).forEach((r, k) => {
        const on = k === win.cam!.index;
        ui.key(r[0], r[1], r[2], r[3], this.keyState(st, r, on));
        const label = win.cam!.labels[k]!;
        chromeText(l, fonts, label, r[0] + Math.floor((r[2] - chromeWidth(fonts, label)) / 2), r[1] + 7, on ? '#ffd23a' : C.ink, null);
      });
    } else if (win.spec.body?.kind === 'view' && (win.spec.body.views ?? 1) > 1) {
      // the view button: a film camera seen from the side, two reels on the body and the lens on the right
      const v = viewButton(win.rect, win.maximized);
      small(v, () => {
        l.rect(v[0] + 2, v[1] + 1, 2, 2, C.ink);
        l.rect(v[0] + 6, v[1] + 1, 2, 2, C.ink);
        l.rect(v[0] + 3, v[1] + 3, 5, 3, C.ink);
        l.rect(v[0] + 8, v[1] + 4, 1, 1, C.ink);
        l.rect(v[0] + 9, v[1] + 3, 1, 3, C.ink);
      });
    }
  }

  /** The status bar at `sy`, `tw` px wide from `tx`: the status text and the time stamp of a security cam. */
  private statusBar(l: TextLayer, win: WinState, tx: number, tw: number, sy: number) {
    const fonts = this.o.fonts;
    l.rect(tx, sy, tw, STATUS_H, C.sunk);
    l.rect(tx, sy, tw, 1, C.barLo);
    const stamp = win.cam?.stamp ?? '';
    const stampW = stamp ? chromeWidth(fonts, stamp) + 6 : 0;
    chromeText(l, fonts, win.status, tx + 3, sy + 8, win.denied ? '#ff5a4a' : '#e8e8f0', C.sunk, { clip: [tx + 2, sy + 1, tw - 4 - stampW, STATUS_H - 1] });
    if (stamp) chromeText(l, fonts, stamp, tx + tw - stampW + 3, sy + 8, '#e8e8f0', C.sunk);
  }

  /** The content of a window: the hole for its 3D view (with the overlay and the cam marks), a drawing, or a text body. */
  private content(ui: Ui, win: WinState, st: PlayerState) {
    const l = ui.l, c = win.content;
    const body = win.spec.body ?? { kind: 'view' as const };
    if (body.kind === 'view') {
      l.rect(c[0], c[1], c[2], c[3], '#000000', 0);
      body.overlay?.(l, c, st.t);
      if (win.cam) this.camOverlay(l, win.cam, c);
    } else if (body.kind === 'draw') body.draw(l, c, st.t);
    else this.textBody(ui, win, body, st);
  }

  /** The marks of a security camera over its picture: corner brackets, the REC dot and the feed label. No noise, no colour shift. */
  private camOverlay(l: TextLayer, cam: CamState, c: Rect) {
    const ink = '#e8f0e8', m = 4, len = 9;
    for (const [x, y, sx, sy] of [[c[0] + m, c[1] + m, 1, 1], [c[0] + c[2] - m - 1, c[1] + m, -1, 1], [c[0] + m, c[1] + c[3] - m - 1, 1, -1], [c[0] + c[2] - m - 1, c[1] + c[3] - m - 1, -1, -1]] as const) {
      l.rect(sx > 0 ? x : x - len + 1, y, len, 1, ink);
      l.rect(x, sy > 0 ? y : y - len + 1, 1, len, ink);
    }
    const rx = c[0] + m + 5, ry = c[1] + m + 5;
    if (cam.rec) { l.rect(rx + 1, ry, 3, 5, '#ff2a2a'); l.rect(rx, ry + 1, 5, 3, '#ff2a2a'); }
    chromeText(l, this.o.fonts, 'REC', rx + 9, ry + 6, '#ffffff', '#000000');
    chromeText(l, this.o.fonts, cam.label, c[0] + c[2] - m - 5 - chromeWidth(this.o.fonts, cam.label), ry + 6, '#ffffff', '#000000');
  }

  private textBody(ui: Ui, win: WinState, body: Extract<WinBody, { kind: 'text' }>, st: PlayerState) {
    const l = ui.l, c = win.content, fonts = this.o.fonts;
    const lay = textLayout(fonts, body, c);
    l.rect(c[0], c[1], c[2], c[3], C.panel);
    if (body.icon) this.icon(l, body.icon, lay.icon[0], lay.icon[1]);
    body.lines.forEach((ln, k) => chromeText(l, fonts, ln.text, lay.lines[k]!.x, lay.lines[k]!.y, ln.color ?? C.panelInk, null, { n: ln.n ?? 1, wide: fonts.kana }));
    (body.buttons ?? []).forEach((label, k) => {
      const r = lay.buttons[k]!;
      ui.key(r[0], r[1], r[2], r[3], this.keyState(st, r));
      chromeText(l, fonts, label, r[0] + Math.floor((r[2] - chromeWidth(fonts, label)) / 2), r[1] + 11, C.ink, null);
    });
  }

  private icon(l: TextLayer, kind: 'error' | 'warn' | 'info', x: number, y: number) {
    const c = kind === 'error' ? '#c82828' : kind === 'warn' ? '#e0b020' : '#2a6ad0';
    l.rect(x + 2, y, 12, 16, c);
    l.rect(x, y + 2, 16, 12, c);
    l.rect(x + 7, y + 3, 2, kind === 'info' ? 2 : 6, '#ffffff');
    l.rect(x + 7, y + (kind === 'info' ? 7 : 11), 2, kind === 'info' ? 6 : 2, '#ffffff');
  }

  // ---------------------------------------------------------------- tooltip, console, click effects, cursor

  /**
   * The tooltip: a pale box at the cursor tip, which it follows. The box has the size of the full text. A tooltip that carries a lyric (it has kana) draws them
   * in the kana face at its native 16 px on a plate with 4 px of padding (rule G4). A tooltip with Latin text only keeps the small size.
   */
  private tooltip(ui: Ui, st: PlayerState) {
    const tip = st.tip;
    if (!tip) return;
    const fonts = this.o.fonts, l = ui.l;
    const lyric = [...tip.full].some((ch) => isWide(ch));
    const wide = lyric ? fonts.kana : fonts.kanaS;
    const w = chromeWidth(fonts, tip.full, 1, wide) + 8, h = lyric ? 24 : 14;
    const base = lyric ? 18 : 10;
    let x = tip.anchor[0] + 12, y = tip.anchor[1] + 20;
    if (tip.away) { x = tip.anchor[0] - w - 4; y = tip.anchor[1] - h - 8; }
    if (x + w > LW - 2) x = tip.anchor[0] - w - 4;
    if (y + h > LH - 2) y = tip.anchor[1] - h - 6;
    x = Math.max(2, x);
    l.rect(x, y, w, h, '#101018');
    l.rect(x + 1, y + 1, w - 2, h - 2, '#fff8c0');
    // the newest unit lands inverted: a dark block with the light glyph for 2 frames
    const units = [...tip.text];
    const newest = units.pop();
    const head = units.join('');
    chromeText(l, fonts, head, x + 4, y + base, '#101018', null, { wide });
    if (newest !== undefined) {
      const nx = x + 4 + chromeWidth(fonts, head, 1, wide);
      const landing = Math.floor(tip.landAge * FPS + 1e-6) < 2;
      if (landing) l.rect(nx - 1, y + 2, chromeWidth(fonts, newest, 1, wide) + 2, h - 4, '#101018');
      chromeText(l, fonts, newest, nx, y + base, landing ? '#fff8c0' : '#101018', null, { wide });
    }
  }

  /**
   * The developer console (`~`): a translucent panel that rises in the bottom right corner in 6 frames, in the style of Quake and Source. It
   * lists the banner, the commands entered before and their replies, then the prompt `]` with the typed text and a blinking block. It goes
   * over the windows and the tooltip, under the click effects and the cursor. It covers no window of the top corners and not the English line.
   */
  private console(ui: Ui, st: PlayerState) {
    const c = st.console;
    if (!c) return;
    const l = ui.l;
    const x0 = LW - CONSOLE_W - (this.o.consoleInset ?? 4);
    // at rest the panel stands over the status bar and the English line; it slides in from under the bottom edge
    const y0 = LH - 34 - CONSOLE_H + Math.round((CONSOLE_H + 34) * (1 - c.drop));
    const h = Math.min(CONSOLE_H, LH - y0);
    if (h <= 0) return;
    l.rect(x0, y0, CONSOLE_W, h, '#070a14', 0.84);
    l.rect(x0, y0, CONSOLE_W, 2, '#3ac8ff');
    if (h > 2) l.rect(x0, y0 + 2, CONSOLE_W, 1, '#0c3a50');
    // two lines of what came before, the prompt with the block cursor at the end of the typed text, and the reply under it
    const lines = c.lines.slice(-2);
    const row = (s: string, y: number, ink: Col) => { if (y < LH) ui.text(s, x0 + 6, y, ink, '#05070c'); };
    lines.forEach((s, k) => row(s, y0 + 14 + k * 10, s.startsWith(']') ? '#e8f4ff' : '#7fbfe0'));
    const py = y0 + 14 + lines.length * 10;
    const prompt = `]${c.text}`;
    row(prompt, py, '#ffffff');
    // `ui.text` draws the caps from y down: the block stands on the same rows, one pixel past the last letter
    if (c.caret && py < LH) l.rect(x0 + 6 + ui.textWidth(prompt) + 1, py, 5, 7, '#ffffff');
    if (c.reply !== null) row(c.reply, py + 10, '#7fbfe0');
  }

  /** The button under a point, if any: a toolbar button, a window button or a button of a text window. */
  private buttonAt(st: PlayerState, x: number, y: number): Rect | null {
    const vis = this.visible(st);
    for (let k = vis.length - 1; k >= 0; k--) {
      const w = vis[k]!;
      if (w.grow < 1 || !inside(w.rect, x, y)) continue;
      const b = winButtons(w.rect, w.maximized);
      const list: Rect[] = [b.min, b.max, b.close];
      if (w.cam) list.push(...camButtons(w.rect, w.maximized, w.cam.labels.length));
      else if (w.spec.body?.kind === 'view' && (w.spec.body.views ?? 1) > 1) list.push(viewButton(w.rect, w.maximized));
      if (w.spec.body?.kind === 'text') list.push(...textLayout(this.o.fonts, w.spec.body, w.content).buttons);
      return list.find((r) => inside(r, x, y)) ?? null;
    }
    if (st.maximized || this.o.bars === false) return null;
    const bars: Rect[] = [
      TOOLBAR.menu, TOOLBAR.shovel, TOOLBAR.rail, TOOLBAR.bulldozer, TOOLBAR.scissors, TOOLBAR.pause, TOOLBAR.play, TOOLBAR.fast, TOOLBAR.topClose,
      ...Array.from({ length: 7 }, (_, k) => TOOLBAR.top(k)), ...(this.o.tools ? V6_TOOLS.map(toolButton) : []), ...(this.o.rotate ? [TOOLBAR.rotate] : []),
    ];
    return bars.find((r) => inside(r, x, y)) ?? null;
  }

  /**
   * The impact of a click, drawn over everything but the cursor. A ring bursts from the cursor tip in 6 frames (radius 3, 6,
   * 9, 11, 13, 14): 2 px wide, a light ring with a dark outline. 5 short spark ticks fly out beyond it. For 3 frames the
   * button that was hit flashes (white, pale, a 2 px frame), or the outline of the window if it was no button. The window's
   * own jump of 1 to 2 px is in its rectangle (`WinState.rect`).
   */
  private clickFx(ui: Ui, st: PlayerState) {
    for (const c of st.clicks) {
      const f = Math.floor(c.age * FPS + 1e-6);
      if (f >= CLICK_FRAMES) continue;
      if (f < 3) this.clickFlash(ui.l, st, c.x, c.y, c.winId, f);
      const [light, mid] = c.right ? ['#7af0ff', '#3a9ab0'] : ['#ffffff', '#ffd23a'];
      const ink = f < 3 ? light : mid;
      const r = [3, 6, 9, 11, 13, 14][f]!;
      // the dark outline: one ring outside and one inside the 2 px light ring
      ui.circle(c.x, c.y, r + 1, '#101018');
      ui.circle(c.x, c.y, r - 2, '#101018');
      ui.circle(c.x, c.y, r, ink);
      ui.circle(c.x, c.y, r - 1, ink);
      // the sparks: 5 ticks of 3 px that fly out along fixed angles
      if (f < 5) this.sparks(ui, c.x, c.y, hash(Math.round(c.at * 1000), 9) * Math.PI * 2, [6, 10, 14, 18, 21][f]!, ink);
    }
  }

  /** Frame `f` (0..2) of the flash of the button that a click at (x, y) hit, or of the outline of the window `winId`. */
  private clickFlash(l: TextLayer, st: PlayerState, x: number, y: number, winId: string | undefined, f: number) {
    const frame = (r: Rect, w: number, c: Col) => {
      l.rect(r[0], r[1], r[2], w, c); l.rect(r[0], r[1] + r[3] - w, r[2], w, c);
      l.rect(r[0], r[1], w, r[3], c); l.rect(r[0] + r[2] - w, r[1], w, r[3], c);
    };
    const btn = this.buttonAt(st, x, y);
    const win = winId ? st.windows.find((w) => w.id === winId) : undefined;
    if (btn) {
      if (f === 0) l.rect(btn[0], btn[1], btn[2], btn[3], '#ffffff');
      else if (f === 1) l.rect(btn[0], btn[1], btn[2], btn[3], '#bfe0ff');
      else frame(btn, 2, '#ffffff');
    } else if (win && !win.maximized && win.grow >= 1) frame(win.rect, f < 2 ? 2 : 1, '#ffffff');
  }

  /** 5 spark ticks of 3 px at distance `d` from (x, y), the first at angle `base`. */
  private sparks(ui: Ui, x: number, y: number, base: number, d: number, ink: Col) {
    for (let k = 0; k < 5; k++) {
      const a = base + (k / 5) * Math.PI * 2;
      const x0 = Math.round(x + Math.cos(a) * d), y0 = Math.round(y + Math.sin(a) * d);
      const x1 = Math.round(x + Math.cos(a) * (d + 4)), y1 = Math.round(y + Math.sin(a) * (d + 4));
      ui.line(x0 + 2, y0 + 1, x1 + 2, y1 + 1, '#101018');
      ui.line(x0 + 1, y0 + 1, x1 + 1, y1 + 1, '#101018');
      ui.line(x0, y0, x1, y1, ink);
      ui.line(x0 + 1, y0, x1 + 1, y1, ink);
    }
  }

  private cursor(ui: Ui, st: PlayerState) {
    drawCursor(ui, st.cursor.x, st.cursor.y, this.o.cursorTool !== false ? st.tool : null, st.cursor.down);
  }

  /** The window rectangle `win` would have maximized or not, for the scene to aim the cursor. */
  buttonCentre(win: WinState, which: 'min' | 'max' | 'close'): Vec2 { return centreOf(winButtons(win.rect, win.maximized)[which]); }

  dispose() {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.blit.dispose();
    this.top.dispose();
  }
}
