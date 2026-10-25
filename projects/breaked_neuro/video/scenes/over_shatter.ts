// Over transition cnn -> broken: the network screen's shards keep falling under gravity across the cut.
// Each shard carries its piece of the network image and classification box, dropping over the ASCII world of broken.
import type { Frame } from '@pve/engine/scene';
import { OverScene, type PrintOpts } from './_kit';
import { CnnDiagram } from './_cnn';

export default class OverShatter extends OverScene {
  private diag!: CnnDiagram;

  override init() {
    const tCut = this.ctx.params.at as number;
    const cnnStart = tCut - 16 * 1.2;
    this.diag = new CnnDiagram(this.ctx.lyrics, this.ctx.audio, cnnStart, tCut);
  }

  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    this.diag.drawShards(c, f.t);
    return {
      overlays: true,
      full: true,
    };
  }
}
