// THROWAWAY: a specimen board of the new script (all 31 glyphs of the plate), rendered with `pve board`.
import type { Frame } from '@pve/engine/scene';
import { H, W } from '@pve/engine/gl';
import { fnt, INK, MONO, PageScene, PAPER, tone, type SurfaceOpts } from './_page';
import { SCRIPT } from './_era_script';
import { loadScript, writeStrokes } from './new-script';
import { constructed, placeHand } from './new-hand';

const SET = [...'愛のネタバレ別れっぽいな人生死ぬすべて理解し患た無邪気に踊か神'];
const CELL = 214;

export default class ScriptBoard extends PageScene {
  override async init() {
    await super.init();
    this.warm([SCRIPT]);
    await loadScript(this.ctx.assets, SET.join(''));
  }

  draw(c: CanvasRenderingContext2D, _f: Frame): SurfaceOpts {
    c.fillStyle = PAPER;
    c.fillRect(0, 0, W, H);
    c.fillStyle = tone(0.4);
    c.font = fnt(MONO, 12, 600);
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText(`NEW SCRIPT · ${SET.length} glyphs`, 40, 20);
    c.fillStyle = INK;
    SET.forEach((ch, i) => {
      const x = 56 + (i % 8) * CELL, y = 50 + Math.floor(i / 8) * 256;
      writeStrokes(c, placeHand(constructed(ch), x, y, CELL - 36), 1, CELL - 36);
    });
    return { era: SCRIPT, gen: 0 };
  }
}
