// The game HUD of chorus 3 (`chorus3.ts`) over the ride window: the red ring on the thing that a tuna dives at, the plates of the typing
// game, the rings, notes and judgements of the DIVA game, and the key strip of the player. A frame depends only on t.
import * as THREE from 'three';
import type { Line } from '@pve/engine/lyrics';
import { LH } from '@pve/engine/lit';
import type { TextLayer } from '@pve/engine/textlayer';
import { FR } from './_time';
import type { Fonts } from './_fonts';
import { drawGlyph } from './_kana';
import { layoutOnce } from './_captionCarriers';
import { unitRomaji } from './_typing';
import { chromeText, chromeWidth } from './_playerChrome';
import type { Vec2 } from './_playerTypes';
import type { Falls } from './_c3fall';
import { JUDGE_HOLD, RING_LEAD, type Meta } from './_c3games';

export class C3Hud {
  private readonly pv = new THREE.Vector3();

  constructor(private readonly text: TextLayer, private readonly fonts: Fonts, private readonly ko: readonly Line[], private readonly meta: readonly Meta[], private readonly falls: Falls) {}

  /** The plate on a tuna: its syllable and (in the typing game) the key under it. */
  private plate(line: Line, unit: number, p: Vec2, hue: string, fill: string, key: boolean) {
    const lay = layoutOnce(this.fonts, line, 'c3|plate', { x: 0, y: 16, align: 'left', n: 1, maxW: 1e6, ink: '#ffffff', edge: fill, outer: fill });
    const g = lay.glyphs.find((q) => q.unit === unit);
    if (!g) return;
    const rom = key ? unitRomaji(line)[unit]!.text.toUpperCase() : '';
    const w = Math.max(lay.face.width(g.ch), chromeWidth(this.fonts, rom)) + 6, h = key ? 30 : 20;
    const x = p[0] - Math.round(w / 2), y = p[1] - Math.round(h / 2);
    this.text.rect(x - 1, y - 1, w + 2, h + 2, hue);
    this.text.rect(x, y, w, h, fill);
    drawGlyph(this.text, lay, g.ch, x + Math.round((w - lay.face.width(g.ch)) / 2), y + 17, { ink: '#ffffff', edge: fill, outer: fill });
    if (key) chromeText(this.text, this.fonts, rom, x + Math.round((w - chromeWidth(this.fonts, rom)) / 2), y + 27, '#ffffff', null);
  }

  /** A square ring of colour `c` round the pixel `p`. */
  private ring(p: Vec2, r: number, c: string) {
    const l = this.text;
    l.rect(p[0] - r, p[1] - r, 2 * r, 1, c); l.rect(p[0] - r, p[1] + r, 2 * r + 1, 1, c);
    l.rect(p[0] - r, p[1] - r, 1, 2 * r, c); l.rect(p[0] + r, p[1] - r, 1, 2 * r, c);
  }

  /**
   * The keys of the player, as a key display of a stream: a row of key caps over the status bar, bottom left. The newest key stands
   * at the right end and goes down when it is pressed; the older ones move left and go after `KEY_HOLD` s. The colour of a cap is its
   * judgement: green for a typed syllable, COOL gold, FINE cyan, red for a key too late or a MISS.
   */
  private keyStrip(t: number) {
    const l = this.text, KEY_HOLD = 2.2, MAX = 9, H = 17, Y = LH - 13 - H - 3;
    const keys: { at: number; m: Meta }[] = [];
    for (const m of this.meta) {
      const at = m.diva ? m.s : m.word === 'MISS' ? m.done + 0.12 : m.done;
      if (at <= t && t - at < KEY_HOLD) keys.push({ at, m });
    }
    keys.sort((a, b) => a.at - b.at);
    const shown = keys.slice(-MAX);
    // the row is laid out from the right end: each cap has the width of its key
    const widths = shown.map((k) => Math.max(H, chromeWidth(this.fonts, k.m.key) + 8));
    let x = 4 + widths.reduce((a, w) => a + w + 2, 0) - 2;
    for (let i = shown.length - 1; i >= 0; i--) {
      const { at, m } = shown[i]!, w = widths[i]!, age = t - at;
      x -= w;
      const down = age < 3 * FR ? 2 : 0;
      const face = m.word === 'MISS' ? '#ff7a7a' : m.word === 'COOL' ? '#ffe14a' : m.word === 'FINE' ? '#7ff0ff' : '#8affa0';
      const hot = age < 6 * FR;
      l.rect(x, Y + 2, w, H, '#0a0a12');
      l.rect(x, Y + down, w, H - 1, hot ? '#ffffff' : face);
      l.rect(x + 1, Y + down + 1, w - 2, H - 4, hot ? face : '#f4f6fa');
      chromeText(l, this.fonts, m.key, x + Math.round((w - chromeWidth(this.fonts, m.key)) / 2), Y + down + 11, '#14141c', null);
      x -= 2;
    }
  }

  /** The typing game on tuna `i`: its plate from its syllable until it is stopped or hits, and MISS over a tuna that got through. */
  private typing(i: number, m: Meta, line: Line, t: number, project: (p: THREE.Vector3) => Vec2 | null) {
    if (t < m.s || t > m.done + 0.5) return;
    const over = t >= m.done;
    const p = project(this.falls.centre(i, over ? m.done - 1e-3 : t, this.pv));
    if (!p) return;
    this.plate(line, m.unit, p, over ? (m.word === 'MISS' ? '#ff4a4a' : '#7dff8a') : '#f4efe2', over ? (m.word === 'MISS' ? '#7a1010' : '#0e6a24') : '#0a0c18', true);
    if (over && m.word === 'MISS') chromeText(this.text, this.fonts, 'MISS', p[0] - 12, p[1] - 22 - Math.round((t - m.done) * 24), '#ff4a4a', '#101018');
  }

  /** The DIVA game on tuna `i`: the ring that fills before the note, the trail and the plate of the note, and the judgement. */
  private diva(i: number, m: Meta, line: Line, t: number, project: (p: THREE.Vector3) => Vec2 | null) {
    if (t > m.s + JUDGE_HOLD) return;
    const l = this.text;
    const hue = m.unit % 2 === 0 ? '#ff4fa3' : '#38e0ff';
    const at = project(this.falls.centre(i, m.s - 1e-3, this.pv));
    if (at && t < m.s && t >= m.s - RING_LEAD) {
      for (let a = 0; a < 32; a++) { const th = (a / 32) * Math.PI * 2; l.rect(Math.round(at[0] + Math.cos(th) * 10) - 1, Math.round(at[1] + Math.sin(th) * 10) - 1, 2, 2, hue); }
      const th = -Math.PI / 2 + Math.PI * 2 * (1 - (m.s - t) / RING_LEAD);
      for (let s = 0; s < 8; s++) l.rect(Math.round(at[0] + Math.cos(th) * s), Math.round(at[1] + Math.sin(th) * s), 1, 1, '#ffffff');
    }
    if (t < m.done) {
      for (let k = 6; k >= 1; k--) { const q = project(this.falls.centre(i, t - k * 0.045, this.pv)); if (q) l.rect(q[0] - 1, q[1] - 1, 3, 3, hue, 1 - k / 7); }
      const p = project(this.falls.centre(i, t, this.pv));
      if (p) this.plate(line, m.unit, p, hue, '#0a0c18', false);
    }
    if (at && t >= m.s) chromeText(l, this.fonts, m.word, at[0] - 12, at[1] - 14 - Math.round((t - m.s) * 24), m.word === 'COOL' ? '#ffe14a' : m.word === 'FINE' ? '#7ff0ff' : '#ff4a4a', '#101018');
  }

  /** The two games and the key strip at t. `project` puts a world point into the picture of the ride window (px; null: out of it). */
  draw(t: number, project: (p: THREE.Vector3) => Vec2 | null) {
    this.keyStrip(t);
    this.falls.falls.forEach((f, i) => {
      const m = this.meta[i]!, line = this.ko[m.line]!;
      if (t < f.ti - f.flight) return;
      // the mark: a red ring on the thing, from the start of the dive until the tuna is stopped or hits
      if (t < m.done) {
        const tp = project(f.hit);
        if (tp) { const r = 7 + (Math.floor(t * 6) % 2); this.ring(tp, r, '#ff3030'); this.ring(tp, r - 1, '#ff3030'); }
      }
      if (m.diva) this.diva(i, m, line, t, project);
      else this.typing(i, m, line, t, project);
    });
  }
}
