// thumbnail: the upload's cover, not a clip of the video (video.json does not name it). Rendered with
// `pve board video/scenes/thumbnail.ts -p god_ish`. The frame is the machine voice's picture: the page is cut open,
// red takes the frame, and the title is cut out of the red in Fraktur and Mincho so its letters show the paper.
// Metal sorts of the press lie over the red, with the 神 seal.
import type { Frame } from '@pve/engine/scene';
import { W } from '@pve/engine/gl';
import { hash } from '@pve/engine/util';
import { FRAKTUR, fnt, PageScene, PAPER, SERIF, tone, type SurfaceOpts } from './_page';
import { MODERN } from './_era_modern';

const M = 110; // page margin
const SORTS = [...'神っぽいな愛別人生死夢風'];
/** The sorts: x, y, size, turn (rad). Placed by hand so none of them hides a letter of the title. */
const TILES: [number, number, number, number][] = [
  [1560, 150, 120, 0.32], [1730, 330, 96, -0.5], [1380, 90, 84, -0.18], [900, 110, 100, 0.55],
  [1180, 230, 78, -0.4], [250, 130, 92, -0.3], [1790, 640, 88, 0.7], [1500, 440, 70, 0.2],
  [1560, 830, 72, -0.6],
];

export default class Thumbnail extends PageScene {
  draw(c: CanvasRenderingContext2D, _f: Frame): SurfaceOpts {
    // the red shows wherever the page has no mark: only the letters and the sorts are paper
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    c.fillStyle = PAPER;

    c.font = fnt(FRAKTUR, 100);
    const size = Math.min(520, Math.floor(((W - 2 * M) / c.measureText('God-ish').width) * 100));
    c.font = fnt(FRAKTUR, size);
    c.fillText('God-ish', M - 6, 620);

    c.font = fnt(SERIF, 232, 900);
    c.fillText('神っぽいな', M, 900);

    TILES.forEach(([x, y, z, a], i) => {
      c.save();
      c.translate(x, y);
      c.rotate(a);
      c.fillStyle = tone(0.35);
      c.strokeStyle = tone(0.35);
      c.lineWidth = 1.5;
      c.beginPath();
      c.roundRect(-z / 2, -z / 2, z, z, 3);
      c.fill();
      c.stroke();
      c.scale(-1, 1);
      c.fillStyle = PAPER;
      c.font = fnt(SERIF, z * 0.8, 700);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(SORTS[(i + Math.floor(hash(i, 3) * SORTS.length)) % SORTS.length]!, 0, 0);
      c.restore();
    });

    // the seal, in paper: ring and glyph
    const [sx, sy, r] = [1700, 870, 108];
    c.strokeStyle = PAPER;
    c.fillStyle = PAPER;
    c.lineWidth = r * 0.09;
    c.beginPath();
    c.arc(sx, sy, r * 0.93, 0, Math.PI * 2);
    c.stroke();
    c.font = fnt(SERIF, r * 1.15, 700);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('神', sx, sy + r * 0.04);

    return { era: MODERN, gen: 0, p: [0.9, 0.9, 0.8, 55] };
  }
}
