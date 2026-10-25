// Over transition without -> cnn: the progress bar that stopped at 99 % breaks out of its dialog as a laser.
// Across the cut the fill is left hanging where the dialog was, its last 1 % bursts, and a beam fires from
// it straight to the right, out over the frame's edge; it thins and breaks into dashes that scatter and fade.
import type { Frame } from '@pve/engine/scene';
import { W } from '@pve/engine/gl';
import { clamp, ease, prog } from '@pve/engine/util';
import { INK, OverScene, PAPER, gray, hashI, stepT, type PrintOpts } from './_kit';
import { BAR_RECT, STUCK } from './_dialog';

export default class OverLaser extends OverScene {
  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    const t = stepT(f.t, 30);
    const a = t - (this.ctx.params.at as number);
    const dur = this.ctx.end - this.ctx.start;
    const { x, y, w, h } = BAR_RECT;
    const fill = (w - 10) * STUCK;
    const sx = x + 5 + fill, sy = y + h / 2;
    // the fill left hanging, cracking away from its tail
    const hold = 1 - prog(a, 0.15, 0.5);
    if (hold > 0) {
      c.fillStyle = PAPER;
      const n = 24;
      for (let k = 0; k < n; k++) {
        if (hashI(k, 3) > hold) continue;
        c.fillRect(x + 5 + (fill * k) / n, y + 5, fill / n - 2, h - 10);
      }
    }
    // the beam: straight out to the right from the progress bar, thinning, then breaking into dashes
    const reach = prog(a, 0, 0.1, ease.outCubic);
    const thick = (h - 6) * (1 - 0.8 * prog(a, 0.2, dur * 0.85)) * (a < 0.05 ? 1.4 : 1);
    const len = (W + 400) * reach;
    const broken = prog(a, dur * 0.55, dur);
    c.save();
    c.translate(sx, sy);
    if (broken <= 0) {
      // halo bands (screened grays), the paper beam, its ink core
      c.fillStyle = gray(0.85, 0.35);
      c.fillRect(0, -thick * 1.5, len, thick * 3);
      c.fillStyle = PAPER;
      c.fillRect(0, -thick / 2, len, thick);
      c.fillStyle = INK;
      c.fillRect(0, -1.5, len, 3);
    } else {
      // breaking into dashes that drift apart and fade
      for (let k = 0; k * 60 < len; k++) {
        if (hashI(k, 9) < broken * 0.9) continue;
        const dy = (hashI(k, 10) - 0.5) * 240 * broken, dx = (hashI(k, 11) - 0.5) * 60 * broken;
        c.fillStyle = PAPER;
        c.fillRect(k * 60 + dx, dy - thick / 2, 40 * clamp(1 - broken), Math.max(2, thick));
      }
    }
    // the burst where it leaves the bar
    if (a < 0.2) {
      c.fillStyle = PAPER;
      for (let k = 0; k < 10; k++) {
        const an = (k / 10) * Math.PI * 2, r = 20 + a * 400;
        c.fillRect(Math.cos(an) * r - 4, Math.sin(an) * r - 4, 8, 8);
      }
    }
    c.restore();
    return {};
  }
}
