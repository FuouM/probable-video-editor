// The fonts and the lyric lanes of the lit renderer (treatment "Typography").
// - `loadFonts`: the pixel fonts of the lyrics and of the game chrome.
// - `loadLanes`: the other voices, `ko` (the tuna) and `ca` (the double of the lead), lines in the same shape as the lead lane.
// - `lineAt`, `writtenOf`, `HOLD`: the line that shows at a time, and its written form.
import { Lyrics, type Line, type LineWritten, type LyricsInputLine } from '@pve/engine/lyrics';
import { PixelFont } from '@pve/engine/type';
import lanesFile from '../lanes.json';

// The generated file is typed by what the JSON holds: it is the engine's LyricsInputLine (make-lanes.ts writes it from engineLines).
const laneLines = lanesFile as unknown as Record<'ko' | 'ca', LyricsInputLine[]>;

export interface Fonts {
  /** DotGothic16 at 16 px: the lyrics, scaled up by whole numbers for big type. */
  kana: PixelFont;
  /** Silkscreen at 8 px. */
  latin: PixelFont;
  /** DotGothic16 at 10 px: kana in the 10 px title and status bars of the game windows. */
  kanaS: PixelFont;
}

export async function loadFonts(assets: string): Promise<Fonts> {
  const [kana, latin, kanaS] = await Promise.all([
    PixelFont.load('DotGothic16', `${assets}DotGothic16-Regular.ttf`, 16, 'あイワシAbg'),
    PixelFont.load('Silkscreen', `${assets}Silkscreen-Regular.ttf`, 8, 'ABGabg'),
    PixelFont.load('DotGothic16', `${assets}DotGothic16-Regular.ttf`, 10, 'あイワシAbg'),
  ]);
  return { kana, latin, kanaS };
}

/** The seconds a line stays after its last syllable ends. */
export const HOLD = 0.6;

/** The written form of `line`. Throws when the lyric map `map` gives the line none. */
export function writtenOf(line: Line, map = 'lyrics.map.json'): LineWritten {
  const w = line.written;
  if (!w) throw new Error(`sardine: line ${line.i} has no written form (${map})`);
  return w;
}

// ---------------------------------------------------------------- lanes

export interface Lanes {
  /** The tuna voice: chorus 2 lines 0..7 (106.667 s), chorus 3 lines 8..15 (135.111 s). */
  ko: Lyrics;
  /** The double of the lead, in the same slots as the lead's lines of chorus 2 and 3. */
  ca: Lyrics;
}

let lanes: Lanes | null = null;

/** The `ko` and `ca` lanes (`lyrics.map.<lane>.json` joined with `lyrics.calibrated.<lane>.json`, see make-lanes.ts). */
export function loadLanes(): Lanes {
  lanes ??= {
    ko: new Lyrics({ lines: laneLines.ko }),
    ca: new Lyrics({ lines: laneLines.ca }),
  };
  return lanes;
}

/** The line of `lines` that shows at time t (its first syllable has started and it has not ended), or null. */
export function lineAt(lines: Line[], t: number): Line | null {
  for (let k = lines.length - 1; k >= 0; k--) {
    const ln = lines[k]!;
    const u = ln.written?.units[0];
    if (u && u.start <= t && t <= ln.end + HOLD) return ln;
  }
  return null;
}
