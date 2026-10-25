// cnn (Build up - Instrumental, 16 bars, no voice): everything he said, fed through a convolutional network.
// The diagram is laid out in an oblique 3D like a network figure, and the camera tracks the active layer.
// On the last beat the screen shatters along radial cracks and falls under gravity into broken (over_shatter).
import type { Frame } from '@pve/engine/scene';
import { PrintScene, type PrintOpts } from './_kit';
import { CnnDiagram } from './_cnn';

export default class Cnn extends PrintScene {
  private diag!: CnnDiagram;

  override init() {
    this.diag = new CnnDiagram(this.ctx.lyrics, this.ctx.audio, this.ctx.start, this.ctx.end);
  }

  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    return this.diag.draw(c, f.t);
  }
}
