// thumbnail: the upload's cover, not a clip of the video (video.json does not name it). Rendered by
// video/make-thumbnail.ts. The frame is the intro's picture with the title large enough to read: the black
// void, the blue through the holes of an R-pentomino's bloom, BREAKED laid in bricks. A crack runs through
// the word. The blue shows in the gap, the two halves slip apart and the bricks at the crack come loose.
import type { Frame } from '@pve/engine/scene';
import { H, W } from '@pve/engine/gl';
import { pad0 } from '@pve/engine/util';
import { INK, Life, PAPER, PrintScene, bricks, brickRect, hashI, rebate, type PrintOpts } from './_kit';

const LC = 24; // px per bloom cell
const LW = Math.ceil(W / LC), LH = Math.ceil(H / LC);
const R_PENTOMINO = [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]];
const CELL = 31; // title sub-cell px
const REACH = 90; // bricks closer than this to the crack may come loose
const GAP = 120; // half width of the blue gap at its widest, away from the word
const SLIP = { x: 12, y: 9 }; // each half moves this far from the crack

/** The bloom generation drawn: the R-pentomino of the intro, late enough to have spread behind the word. */
const GEN = 330;

export default class Thumbnail extends PrintScene {
  private bloom = new Life(LW, LH);
  private title = bricks('breaked');
  private x0 = 0;
  private y0 = 0;
  /** the crack, top to bottom: x of each point, the y of point i is CY0 + i * CSTEP */
  private crack: { x: number; y: number }[] = [];

  override init() {
    const { title } = this;
    this.x0 = Math.round((W - title.cols * CELL) / 2);
    this.y0 = Math.round(H / 2 - (10 * CELL) / 2) - 26;
    // the crack leans left going down, between the A and the K, and jags
    const n = 11, y0 = -40, step = (H + 80) / n;
    const xc = this.x0 + (title.charX[4]! - 1) * CELL;
    for (let i = 0; i <= n; i++) {
      const y = y0 + i * step;
      this.crack.push({ x: xc - (y - H / 2) * 0.12 + (hashI(i, 71) - 0.5) * 36, y });
    }
    // the bloom starts in the crack, where the word broke first
    const sx = Math.round((xc - (this.y0 + 5 * CELL - H / 2) * 0.12) / LC), sy = Math.round((this.y0 + 5 * CELL) / LC);
    for (const [dx, dy] of R_PENTOMINO) this.bloom.seed[(sy + dy!) * LW + sx + dx!] = 1;
  }

  /** x of the crack at height y. */
  private crackX(y: number) {
    const p = this.crack;
    const k = Math.max(0, Math.min(p.length - 2, Math.floor((y - p[0]!.y) / (p[1]!.y - p[0]!.y))));
    const a = p[k]!, b = p[k + 1]!;
    return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
  }

  /** The clip path of one half: the crack's side of the frame, moved by `dx` (sign) of the slip. */
  private halfPath(c: CanvasRenderingContext2D, side: -1 | 1) {
    c.beginPath();
    const edge = side < 0 ? -200 : W + 200;
    c.moveTo(edge, this.crack[0]!.y);
    for (const p of this.crack) c.lineTo(p.x, p.y);
    c.lineTo(edge, this.crack[this.crack.length - 1]!.y);
    c.closePath();
  }

  draw(c: CanvasRenderingContext2D, _f: Frame): PrintOpts {
    const { title, x0, y0 } = this;
    c.fillStyle = INK;
    c.fillRect(0, 0, W, H);

    // the bloom: holes onto the blue
    const board = this.bloom.at(GEN);
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
      if (board[y * LW + x]) c.clearRect(x * LC + 1, y * LC + 1, LC - 2, LC - 2);
    }

    // the gap: the blue through the crack, widest in the word
    const mid = y0 + 5 * CELL;
    c.beginPath();
    const half = (p: { x: number; y: number }, i: number) => (16 + (GAP - 16) * (1 - Math.exp(-(((p.y - mid) / 260) ** 2)))) * (0.75 + 0.5 * hashI(i, 72));
    this.crack.forEach((p, i) => (i ? c.lineTo(p.x - half(p, i), p.y) : c.moveTo(p.x - half(p, i), p.y)));
    for (let i = this.crack.length - 1; i >= 0; i--) c.lineTo(this.crack[i]!.x + half(this.crack[i]!, i + 30), this.crack[i]!.y);
    c.closePath();
    c.save();
    c.clip();
    c.clearRect(0, 0, W, H);
    c.restore();

    // which bricks come loose: near the crack, the nearer the likelier
    const loose = new Set<number>();
    title.bricks.forEach((b, i) => {
      const by = y0 + (b.cy + 0.5) * CELL, bx = x0 + (b.cx + b.len / 2) * CELL;
      const d = Math.abs(bx - this.crackX(by));
      if (d < REACH && hashI(i, 73) < 0.3 * (1 - d / REACH)) loose.add(i);
    });

    // the two halves, each with a hard shadow so that the word reads on the blue
    for (const side of [-1, 1] as const) {
      c.save();
      this.halfPath(c, side);
      c.clip();
      c.translate(side * SLIP.x, side * SLIP.y * -1);
      title.bricks.forEach((b, i) => {
        if (loose.has(i)) return;
        const bx = x0 + b.cx * CELL, by = y0 + b.cy * CELL;
        c.fillStyle = INK;
        brickRect(c, bx + 9, by + 9, b.len, CELL);
        c.fillStyle = PAPER;
        brickRect(c, bx, by, b.len, CELL);
      });
      c.restore();
    }

    // the loose bricks, broken into their sub-cells, thrown from the crack
    let n = 0;
    for (const i of loose) {
      const b = title.bricks[i]!;
      const by = y0 + (b.cy + 0.5) * CELL, bx = x0 + (b.cx + b.len / 2) * CELL;
      const away = bx < this.crackX(by) ? -1 : 1;
      const near = 1 - Math.min(1, Math.abs(bx - this.crackX(by)) / REACH);
      for (let k = 0; k < b.len; k++, n++) {
        const h1 = hashI(n, 74), h2 = hashI(n, 75), h3 = hashI(n, 76);
        const px = x0 + (b.cx + k + 0.5) * CELL + away * (SLIP.x + near * (60 + 150 * h1)), py = y0 + (b.cy + 0.5) * CELL - away * SLIP.y * -1 + (h2 - 0.35) * 130 * near;
        const s = CELL * (0.55 + 0.4 * h3);
        c.save();
        c.translate(px, py);
        c.rotate((h2 - 0.5) * 1.3);
        if (h1 < 0.28) {
          c.clearRect(-s / 2, -s / 2, s, s); // a hole onto the blue
        } else {
          c.fillStyle = INK;
          c.fillRect(-s / 2 + 6, -s / 2 + 6, s, s);
          c.fillStyle = PAPER;
          c.fillRect(-s / 2, -s / 2, s, s);
        }
        c.restore();
      }
    }

    // shards out of the gap, above and below the word where the blue is wide
    for (let j = 0; j < 44; j++) {
      const above = j % 2 === 0;
      const y = above ? y0 - 20 - hashI(j, 77) * 300 : y0 + 10 * CELL + 20 + hashI(j, 77) * 300;
      const dx = (hashI(j, 78) - 0.5) * 2 * (GAP + 70) * (0.4 + Math.abs(y - mid) / 420);
      const s = 12 + 30 * hashI(j, 79) ** 2;
      c.save();
      c.translate(this.crackX(y) + dx, y);
      c.rotate((hashI(j, 80) - 0.5) * 1.6);
      if (Math.abs(dx) > 70) {
        c.clearRect(-s / 2, -s / 2, s, s);
      } else {
        c.fillStyle = INK;
        c.fillRect(-s / 2 + 5, -s / 2 + 5, s, s);
        c.fillStyle = PAPER;
        c.fillRect(-s / 2, -s / 2, s, s);
      }
      c.restore();
    }

    // rebate print, as on every plate
    rebate(c, `R-PENTOMINO · B3/S23 · GEN ${pad0(GEN, 4)}`, 72, H - 48, 'left', 1);
    rebate(c, '200 BPM', W - 72, H - 48, 'right', 1);
    return { noise: 0.5 };
  }
}
