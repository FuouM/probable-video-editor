// The names of the files of a render under projects/<id>/out/render/. Pure functions: the page, the dev server and
// the CLI use them.

/** The folder of a render at `scale`: `full` (scale 1 or less), `4k` (scale 2), else `<height>p`. */
export function renderName(scale: number): string {
  if (!(scale > 1)) return 'full';
  return scale === 2 ? '4k' : `${Math.round(scale * 1080)}p`;
}

/** The final MP4 of project `id` at `scale`: `<id>-<renderName>.mp4`. */
export function renderMp4Name(id: string, scale: number): string {
  return `${id}-${renderName(scale)}.mp4`;
}

/** The segment file of frames f0..f1 (end excluded) in the frames folder: `000000-000256.mkv`. */
export function segmentName(f0: number, f1: number): string {
  return `${String(f0).padStart(6, '0')}-${String(f1).padStart(6, '0')}.mkv`;
}
