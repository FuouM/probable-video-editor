// A choice a project offers to the viewer of the web player, such as the face of its small English text. A project lists
// them as `options` in projects/<id>/video/player.ts. The player shows one list per option and calls `apply` on a
// change (and once at the start, for a choice it remembers). The picture is not drawn by the option itself: `apply`
// changes the module state that the scenes read, and says which scenes loaded before it and must load again.
export interface PlayerOption {
  id: string;
  /** Short label in the control bar. */
  label: string;
  values: { id: string; label: string }[];
  default: string;
  /** Takes `value`. `assets`: URL of the project's video/assets/. Returns the names of the scenes that must load again (none at the start). */
  apply(value: string, assets: string): Promise<string[]>;
}

/**
 * The look of the player's subtitle line for a project whose own type it should match (`subtitles` in
 * projects/<id>/video/player.ts). Sizes are pixels of a frame 360 px high: the player scales them with the picture.
 */
export interface SubtitleStyle {
  /** The faces to load, each a file in the project's video/assets/. */
  fonts: { family: string; file: string }[];
  /** The CSS font-family list of the line. */
  family: string;
  /** The size of the font, and the height of one row with its strip. */
  size: number;
  row: number;
  /** From the bottom edge of the picture to the bottom of the last strip. */
  bottom: number;
  /** Show the text in capitals. */
  upper: boolean;
  /** The ink, its outline (1 px) and the solid strip behind the tokens that have started (2 px padding). */
  ink: string;
  edge: string;
  back: string;
  /** The subtitles are on until the viewer turns them off (the video draws no line of its own). */
  on: boolean;
  /** The Japanese track joins the units of the lyric map into words, one token for each romaji word (a map of single kana). */
  jaWords: boolean;
}
