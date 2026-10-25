// Over transition mirror -> room: the mirror's shards fly on across the cut. They are the same wedges as in
// the mirror plate (the same `MirrorGlass`), each still carrying its piece of the mirror's picture, turning
// and growing at the camera until they leave the frame over the bars; the room shows between them.
import type { Frame } from '@pve/engine/scene';
import { clamp, lerp } from '@pve/engine/util';
import { BEAT, BEAT0, OverScene, stepT, type PrintOpts } from './_kit';
import { MirrorGlass } from './_mirror';

export default class OverShards extends OverScene {
  private glass!: MirrorGlass;

  override init() {
    const tCut = this.ctx.params.at as number;
    // the mirror clip: from the beat at or before "more i look at the mirror" to the cut
    const more = this.ctx.lyrics.get('more i look at the mirror').start;
    const start = BEAT0 + Math.floor((more - BEAT0) / BEAT + 1e-6) * BEAT;
    this.glass = new MirrorGlass(this.ctx.lyrics, start, tCut);
    this.plane = { of: 'walls', t0: this.glass.t0Walls };
  }

  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    const tz = stepT(f.t, 24);
    // the picture on the glass as it was when it broke
    this.glass.drawInner(this.glass.g.hits[3]! + 0.15);
    this.glass.drawShards(c, this.glass.g.at(tz), tz);
    const pDim = clamp((f.t - this.ctx.start) / 3.5);
    const plane = lerp(1.0, 0.6, pDim);
    return {
      overlays: true,
      plane,
      clumpKill: 1, // the mirror's clumps are gone at the cut
      view: { x: 683.78, y: -21.80, cell: 4.22 },
      full: true,
    };
  }
}
