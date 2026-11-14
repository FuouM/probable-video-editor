// The subtitle (`subtitle`): the English fan line, one calm Silkscreen line at one fixed place for the whole video.
// Each phrase appears when it starts. A long line wraps to two rows. Every scene calls it last.
import type { Line } from '@pve/engine/lyrics';
import { LW, type Col } from '@pve/engine/lit';
import type { TextLayer } from '@pve/engine/textlayer';
import { outlined } from '@pve/engine/type';
import { HOLD, writtenOf, type Fonts } from './_fonts';

interface EnglishStyle {
  /** Baseline of the (last) row. Default 340. */
  y?: number;
  ink?: Col;
  edge?: Col;
  /** Widest row, px. Default 600. */
  maxW?: number;
  /** A solid dark strip behind each row (2 px padding), as long as the phrases that have started. */
  back?: boolean;
}

/** The rows of the English line of `line`: each phrase appears when it starts, in English reading order, until the line ends. */
function englishRows(l: TextLayer, f: Fonts, line: Line, t: number, s: EnglishStyle = {}) {
  const w = writtenOf(line);
  if (t < w.units[0]!.start || t > line.end + HOLD) return;
  const sink = l.sink({ 1: s.ink ?? '#f4efe2', 2: s.edge ?? '#0c0c14' });
  const texts = w.phrases.map((ph, k) => (k + 1 < w.phrases.length ? `${ph.text} ` : ph.text).toUpperCase());
  // rows: break between phrases when a row would pass maxW
  const maxW = s.maxW ?? 600;
  const rows: number[][] = [[]];
  let rw = 0;
  texts.forEach((tx, k) => {
    const wd = f.latin.width(tx);
    if (rw + wd > maxW && rows[rows.length - 1]!.length) { rows.push([]); rw = 0; }
    rows[rows.length - 1]!.push(k);
    rw += wd;
  });
  const y = s.y ?? 340;
  rows.forEach((row, r) => {
    const ry = y - (rows.length - 1 - r) * 11;
    let x = Math.round((LW - row.reduce((a, k) => a + f.latin.width(texts[k]!), 0)) / 2);
    const shown: [number, number][] = [];
    for (const k of row) {
      const wd = f.latin.width(texts[k]!);
      if (w.phrases[k]!.start <= t) {
        shown.push([x, x + wd]);
        if (s.back) l.rect(x - 2, ry - 9, wd + 4, 12, '#0a0c14');
      }
      x += wd;
    }
    for (const k of row) {
      if (w.phrases[k]!.start > t) continue;
      outlined(sink, f.latin, texts[k]!, shown.shift()![0], ry, 1, 2);
    }
  });
}

/**
 * Baseline of the subtitle: the same for every scene. The last row sits here, a second row sits above it. The strip behind
 * it ends at y = 334, above the bottom toolbar (from y = 338) and above the status bar of a maximized window.
 */
export const SUBTITLE_Y = 332;

/**
 * The English fan line of `line` as the subtitle of the video. One place, one style. A scene calls it last, after the
 * chrome and the cursor, so it reads over the toolbar, the ticker and any picture. It draws nothing outside the line's time.
 */
export function subtitle(l: TextLayer, f: Fonts, line: Line, t: number) {
  englishRows(l, f, line, t, { y: SUBTITLE_Y, back: true });
}
