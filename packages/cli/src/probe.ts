// pve probe: look at one object instead of whole frames. Scenes name what they draw with `mark` from
// @pve/engine/marks; after each frame the page lists those marks (name, entry, box in 1920x1080 px). From that:
// - list the marks at some times (what is on screen, where, cut off by the frame or not),
// - track one object across times (its box and how far it moved) and save a zoomed strip of crops,
// - check the lyrics of clips: at every sung syllable, is it (or its word) marked on screen?
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import type { Mark } from '@pve/engine/marks';
import type { PveWindow } from './browser';
import type { Project } from './project';
import type { StillOptions } from './render';

export type Rect = [number, number, number, number];

const FW = 1920, FH = 1080;

/** Render each time and return its marks. */
export async function marksAt(page: Page, times: number[], o: Omit<StillOptions, 'scale'>): Promise<Mark[][]> {
  return page.evaluate(({ times, samples, shutter, fps }) => {
    const P = (window as unknown as PveWindow).__pve!;
    return times.map((t) => { P.still(t, samples, shutter, fps); return P.marks(); });
  }, { times, samples: o.samples, shutter: o.shutter, fps: o.fps });
}

/** `first-i` matches only itself; `syl:*` and `*shard*` are globs. */
export function nameMatcher(pattern: string): (name: string) => boolean {
  if (!pattern.includes('*')) return (n) => n === pattern;
  const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return (n) => re.test(n);
}

/** The bounding box of some marks, or null. */
export function union(ms: readonly Mark[]): Rect | null {
  if (!ms.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of ms) { x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x + m.w); y1 = Math.max(y1, m.y + m.h); }
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Where a box is against the frame: inside, partly outside (`cut`) or wholly outside (`off`). */
export function frameState(r: Rect): 'in' | 'cut' | 'off' {
  const [x, y, w, h] = r;
  if (x + w <= 0 || y + h <= 0 || x >= FW || y >= FH || w <= 0 || h <= 0) return 'off';
  if (x < 0 || y < 0 || x + w > FW || y + h > FH) return 'cut';
  return 'in';
}

/**
 * A strip of zoomed crops, one per time, each labelled. `rects[i]` null draws an empty tile ("not drawn").
 * Every tile has the size of the largest crop times `zoom`. Writes the PNG to `out`.
 */
export async function cropStrip(page: Page, tiles: { t: number; rect: Rect | null; label: string }[], zoom: number, out: string, o: Omit<StillOptions, 'scale'>): Promise<void> {
  const dataUrl: string = await page.evaluate(({ tiles, zoom, samples, shutter, fps }) => {
    const P = (window as unknown as PveWindow).__pve!;
    const src = document.getElementById('c') as HTMLCanvasElement;
    const k = src.width / 1920;
    const cw = Math.round(Math.max(64, ...tiles.map((t) => (t.rect ? t.rect[2] : 0))) * zoom);
    const ch = Math.round(Math.max(64, ...tiles.map((t) => (t.rect ? t.rect[3] : 0))) * zoom);
    const pad = 4, lab = 20, cols = Math.max(1, Math.min(tiles.length, Math.floor(3840 / (cw + pad))));
    const rows = Math.ceil(tiles.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * (cw + pad) + pad; cv.height = rows * (ch + lab + pad) + pad;
    const c = cv.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#222'; c.fillRect(0, 0, cv.width, cv.height);
    tiles.forEach((tile, i) => {
      const x = pad + (i % cols) * (cw + pad), y = pad + Math.floor(i / cols) * (ch + lab + pad);
      c.save(); c.beginPath(); c.rect(x, y, cw, lab); c.clip();
      c.fillStyle = '#ddd'; c.font = '12px monospace'; c.fillText(tile.label, x + 2, y + 14);
      c.restore();
      if (!tile.rect) { c.fillStyle = '#f55'; c.fillText('not drawn', x + 8, y + lab + 20); return; }
      P.still(tile.t, samples, shutter, fps);
      const [rx, ry, rw, rh] = tile.rect;
      c.drawImage(src, rx * k, ry * k, rw * k, rh * k, x, y + lab, rw * zoom, rh * zoom);
    });
    return cv.toDataURL('image/png');
  }, { tiles, zoom, samples: o.samples, shutter: o.shutter, fps: o.fps });
  mkdirSync(path.dirname(out), { recursive: true });
  await Bun.write(out, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
}

/** Lowercase letters, digits and apostrophes only: how syllable and word marks are compared. */
export const lyricKey = (s: string) => s.toLowerCase().replace(/[’`]/g, "'").replace(/[^\p{L}\p{N}']/gu, '');

export interface LyricCheck {
  /** when it was checked: a little after the syllable's start */
  t: number;
  clip: string;
  syl: string;
  word: string;
  /** the marks that show it (syl:<syl> or word:<word>) */
  state: 'shown' | 'cut' | 'off' | 'missing';
}

/** The sung syllables inside [from, to): the time each is checked at, its text and its word. */
export function sungSyllables(p: Project, from: number, to: number): { t: number; syl: string; word: string }[] {
  const out: { t: number; syl: string; word: string }[] = [];
  for (const w of p.timing.words) {
    for (const s of w.syl) {
      if (s.start < from || s.start >= to) continue;
      out.push({ t: Math.min(s.start + 0.08, (s.start + s.end) / 2, to - 1e-3), syl: s.text, word: w.text });
    }
  }
  return out;
}

/** Judge one syllable against a frame's marks: shown if a mark of it (or its word) is inside the frame. */
export function judgeSyllable(ms: readonly Mark[], syl: string, word: string): LyricCheck['state'] {
  const sk = lyricKey(syl), wk = lyricKey(word);
  const hits = ms.filter((m) => {
    const i = m.name.indexOf(':');
    if (i < 0) return false;
    const kind = m.name.slice(0, i), key = lyricKey(m.name.slice(i + 1));
    return (kind === 'syl' && key === sk) || (kind === 'word' && key === wk);
  });
  if (!hits.length) return 'missing';
  const states = hits.map((m) => frameState([m.x, m.y, m.w, m.h]));
  return states.includes('in') ? 'shown' : states.includes('cut') ? 'cut' : 'off';
}
