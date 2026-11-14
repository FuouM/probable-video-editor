// What the web player does for sardine (app/site/player.ts reads this module). The video draws no English line of its own: the
// player's subtitles carry it, in the look of the game (Silkscreen at 8 px, capitals, an outline and a dark strip, low and centred).
import type { PlayerOption, SubtitleStyle } from '@pve/engine/options';

export const options: PlayerOption[] = [];

/** No motion blur: the picture is pixel art at 640 x 360, and a sub-frame average smears its pixels. The player hides BLUR. */
export const motionBlur = false;

export const subtitles: SubtitleStyle = {
  fonts: [
    { family: 'Silkscreen', file: 'Silkscreen-Regular.ttf' },
    { family: 'DotGothic16', file: 'DotGothic16-Regular.ttf' },
  ],
  family: "'Silkscreen', 'DotGothic16', monospace",
  size: 8,
  row: 12,
  bottom: 26,
  upper: true,
  ink: '#f4efe2',
  edge: '#0c0c14',
  back: '#0a0c14',
  on: true,
  jaWords: true,
};
