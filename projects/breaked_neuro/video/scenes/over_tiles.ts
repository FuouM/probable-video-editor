// Over transition ceiling -> dust: the last tiles of the ceiling keep falling at the camera across the
// cut, over the bars, until they have passed it (the same tiles and the same fall as in the ceiling plate).
import type { Frame } from '@pve/engine/scene';
import { OverScene, stepT, type PrintOpts } from './_kit';
import { CeilingFall } from './_ceiling';

export default class OverTiles extends OverScene {
  private fall!: CeilingFall;

  override init() {
    const cut = this.ctx.params.at as number;
    this.fall = new CeilingFall(this.ctx.lyrics, cut - 20, cut);
  }

  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    this.fall.draw(c, stepT(f.t, 15));
    this.fall.drawFallingLyrics(c, f.t);
    return {};
  }
}
