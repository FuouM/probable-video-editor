// walls (Verse 1 until the mirror line): "i looking at the walls as days went by". The wall of Verse 1
// (`_wall.ts`) slides by slowly, as from a train window, the lyric written on it; mid-distance pipes and
// posts go by faster, the alley in front fastest. mirror takes the same wall on from the cut.
// Rates: wall and lyric 15 fps, mid 15, alley 12.
import type { Frame } from '@pve/engine/scene';
import { PrintScene, drawBars, readout, stepT, type PrintOpts } from './_kit';
import { MID_SPEED, NEAR_SPEED, WALL_SPEED, WallWorld } from './_wall';

export default class Walls extends PrintScene {
  private world!: WallWorld;

  override init() {
    this.world = new WallWorld(this.ctx.lyrics, this.ctx.start, this.ctx.end);
  }

  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    const t = f.t, t0 = this.ctx.start;
    // step relative to the clip start, so the first frame has shift 0 (the intro's "i" lands exactly there)
    const tw = t0 + stepT(t - t0, 15);
    const shift = (tw - t0) * WALL_SPEED;
    this.world.drawWall(c, shift, tw);
    this.world.midLayer(c, stepT(t - t0, 15) * MID_SPEED);
    this.world.alley(c, stepT(t - t0, 12) * NEAR_SPEED);
    drawBars(c);
    readout(c, `VERSE 1 · WALL ${String(Math.floor((tw * WALL_SPEED) / 702)).padStart(3, '0')}`, 'left');
    readout(c, `${((t * WALL_SPEED) / 100).toFixed(1)} M`, 'right');
    return { view: { x: shift, y: 0 }, plane: 0.7 };
  }
}
