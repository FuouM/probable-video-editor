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
