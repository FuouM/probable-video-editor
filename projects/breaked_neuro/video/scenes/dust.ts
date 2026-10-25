// dust (Verse 3), four movements; the lyric lives inside each picture, never up the side.
// 1 "as time goes on / waiting for none": an LED alarm clock. Its digits are seven-segment shapes whose
//   segments are made of Life cells (the song's time), the colon blinks on the kicks, and the sung line runs
//   along its LED marquee.
// 2 "one has to ask where do i go from here": a maze is carved depth-first onto the blue; the carving head
//   is a snake, longer by a cell every bar, and food jumps to a new place on every kick and is eaten when it
//   gets there. The line is the level name over the maze. "having lost everything": the walls fall away
//   and the solid maze grows into the sky of the cube, with no cut.
// 3 "looking at my shadow" to "as cold as my heart": a stationary camera on a cube standing on the ground;
//   time-lapse, a day a bar: the sun rises, crosses and sets and the shadow swings round; at night the sky is
//   black with the moon and long-exposure star trails turning round the pole (no Life plane here). The line
//   is painted on the ground and the shadow passes over it. From "fading" the cube lets go of its cells,
//   they rise as dust, frozen on "heart".
// 4 "i am losing my existence": an identity record; each syllable redacts one of its fields in blue, and on
//   "existence" its status is struck VOID. On "dis|fi" the record comes apart into cells that are drawn into
//   one line, the pencil that writes "gured" on the blueprint of Verse 4.
import type { Frame } from '@pve/engine/scene';
import { H, W } from '@pve/engine/gl';
import { clamp, ease, prog } from '@pve/engine/util';
import {
  BAR, BEAT, BEAT0, BLUE, BOX_H, INK, PAPER, PrintScene, brickRect, bricks, drawBars, gray, hashI, lastBefore, readout, stepT, sylAt, sylLine, sylOfChar,
  type PrintOpts, type SylLine,
} from './_kit';
import { headOffset } from './_motifs';
import { CardFold, cardLineRect, drawCard } from './_cardfold';
import { mark } from '@pve/engine/marks';

const MW = 40, MH = 18, MC = 34; // maze cells
const MX = Math.round((W - MW * MC) / 2), MY = BAR + 120;
const DAY = 4 * BEAT; // a day of the time-lapse: one bar

/** Seven-segment layout: segments a..g as [x, y, horizontal] in segment units (2 wide, 4 high). */
const SEGS: [number, number, boolean][] = [[0, 0, true], [2, 0, false], [2, 2, false], [0, 4, true], [0, 2, false], [0, 0, false], [0, 2, true]];
const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];

type V3 = [number, number, number];

export default class Dust extends PrintScene {
  private lines: SylLine[] = [];
  private tMaze = 0;
  private tLost = 0;
  private tCube = 0;
  private tFade = 0;
  private tFreeze = Infinity;
  private tExist = 0;
  private tDis = 0;
  private exist!: SylLine;
  private dis!: SylLine;
  private fold!: CardFold;
  /** the maze, in carving order: [cell, the cell it was carved from (-1 for the first)] */
  private carve: [number, number][] = [];
  private seedLen = 0;
  private kicks: number[] = [];
  /** the readouts (left, right) of the sub-scene on screen: each sub-scene sets them, `draw` prints them on the bar */
  private hud: [string, string] = ['', ''];

  /** Return the [cell, fromCell] pairs on the 40x18 maze grid that form the 7-segment digits of `digits` (e.g. "0120"). */
  private digitCarve(digits: string): [number, number][] {
    const dCols = [5, 12, 23, 30];
    const r0 = 3;
    const out: [number, number][] = [];
    const seen = new Set<number>();
    const addRun = (pts: [number, number][]) => {
      let prev = -1;
      for (const [x, y] of pts) {
        const c = y * MW + x;
        if (!seen.has(c)) {
          seen.add(c);
          out.push([c, prev]);
        }
        prev = c;
      }
    };
    for (let d = 0; d < 4; d++) {
      const on = DIGITS[+digits[d]!]!;
      const c0 = dCols[d]!;
      SEGS.forEach(([sx, sy, hor], si) => {
        if (!on.includes('abcdefg'[si]!)) return;
        const xStart = c0 + sx * 2, yStart = r0 + sy * 2;
        const pts: [number, number][] = [];
        for (let k = 0; k <= 4; k++) pts.push(hor ? [xStart + k, yStart] : [xStart, yStart + k]);
        addRun(pts);
      });
    }
    return out;
  }

  override init() {
    const ly = this.ctx.lyrics;
    this.lines = ly.linesIn(this.ctx.start, this.ctx.end).map((l) => sylLine(ly, l));
    this.tMaze = ly.get('one has to ask').start;
    this.tLost = ly.get('having lost everything').start;
    this.tCube = ly.get('looking at my shadow').start;
    this.tFade = ly.get('slowly fading').words.find((w) => w.w === 'fading')!.start - 0.25;
    this.tFreeze = ly.get('as cold as my heart').words.find((w) => w.w === 'heart')!.start;
    this.exist = sylLine(ly, 'i am losing my existence');
    this.tExist = this.exist.line.start;
    this.dis = sylLine(ly, 'disfigured beyond recognition');
    this.tDis = this.dis.line.start;
    this.fold = new CardFold(this.exist, this.dis, 15);
    this.kicks = [];
    const step = 0.02;
    let prevLow = this.ctx.audio.env('low', this.ctx.start);
    for (let t = this.ctx.start + step; t <= this.tLost; t += step) {
      const curLow = this.ctx.audio.env('low', t);
      const d = curLow - prevLow;
      if (d > 0.08 && curLow > 0.35) {
        this.kicks.push(t);
        t += 0.14;
      }
      prevLow = curLow;
    }
    const seen = new Uint8Array(MW * MH);
    // Seed the maze with the exact 7-segment corridors of "01:20" (at tMaze = 80.98 s) so the time literally becomes the start of the maze!
    const m = Math.floor(this.tMaze / 60), s = Math.floor(this.tMaze - m * 60);
    const initDigits = `${String(m).padStart(2, '0')}${String(s).padStart(2, '0')}`;
    const seedPairs = this.digitCarve(initDigits);
    const stack: number[] = [];
    for (const [c, from] of seedPairs) {
      seen[c] = 1;
      this.carve.push([c, from]);
      stack.push(c);
    }
    this.seedLen = this.carve.length;
    while (stack.length) {
      const cur = stack[stack.length - 1]!;
      const x = cur % MW, y = Math.floor(cur / MW);
      const nb = [[1, 0], [0, 1], [-1, 0], [0, -1]]
        .map(([dx, dy]) => [x + dx!, y + dy!] as const)
        .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < MW && ny < MH && !seen[ny * MW + nx])
        .sort((a, b) => hashI(a[0], a[1], cur) - hashI(b[0], b[1], cur));
      if (!nb.length) { stack.pop(); continue; }
      const [nx, ny] = nb[0]!;
      const n = ny * MW + nx;
      seen[n] = 1;
      this.carve.push([n, cur]);
      stack.push(n);
    }
  }

  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    const t = f.t;
    c.fillStyle = INK;
    c.fillRect(0, BAR, W, BOX_H);
    let o: PrintOpts = {};
    if (t < this.tMaze) {
      const t0 = this.ctx.start;
      const tc = Math.max(t0, stepT(t, 12)), tl = Math.max(t0, stepT(t, 24));
      const subLines = this.lines.filter((l) => l.line.start < this.tMaze - 0.05);
      const sl = lastBefore(subLines, (l) => l.line.start <= tl);
      this.clock(c, tc, sl, tl, t);
    } else if (t < this.tCube) {
      const t0 = this.tMaze;
      const tq = Math.max(t0, stepT(t, 15)), tl = Math.max(t0, stepT(t, 24));
      const subLines = this.lines.filter((l) => l.line.start >= this.tMaze - 0.05 && l.line.start < this.tCube - 0.05);
      const sl = lastBefore(subLines, (l) => l.line.start <= tl);
      this.maze(c, tq, sl, tl);
    } else if (t < this.tExist) {
      const t0 = this.tCube;
      const tq = Math.max(t0, stepT(t, 15)), tl = Math.max(t0, stepT(t, 24));
      const subLines = this.lines.filter((l) => l.line.start >= this.tCube - 0.05 && l.line.start < this.tExist - 0.05);
      const sl = lastBefore(subLines, (l) => l.line.start <= tl);
      o = this.cube(c, tq, sl, tl);
    } else {
      const tr = Math.max(this.tExist, stepT(t, 24));
      this.record(c, tr);
    }
    drawBars(c);
    readout(c, this.hud[0], 'left');
    readout(c, this.hud[1], 'right');
    // Conway plane and clumps disabled across all of "dust"
    return { ...o, plane: 0, clumps: 0 };
  }

  /**
   * The LED alarm clock: solid vector segments (no halftone grid moiré), a blinking colon, and the line on
   * its marquee. In the last 0.45 s before tMaze, the clock frame and its 7-segment bars morph outward into
   * the maze grid and initial carved corridors.
   */
  /**
   * The LED alarm clock: its 7-segment digits are laid out directly on the 40x18 maze grid (so there is zero
   * position jump at tMaze). In the last 0.45 s before tMaze, the clock casing & marquee dissolve away,
   * leaving the "01:20" corridors in place as the starting walls/passages of the maze!
   */
  private clock(c: CanvasRenderingContext2D, tc: number, sl: SylLine, tl: number, rawT: number) {
    const toMaze = prog(rawT, this.tMaze - 0.45, this.tMaze, ease.inOutCubic);
    const fadeCase = 1 - toMaze;
    const bx = MX - 30, by = MY - 24, bw = MW * MC + 60, bh = MH * MC + 48;

    if (fadeCase > 0.02) {
      c.save();
      c.strokeStyle = gray(1, fadeCase);
      c.lineWidth = 3;
      c.beginPath();
      c.roundRect(bx, by, bw, bh, 48 * fadeCase);
      c.stroke();
      // Clock feet and top alarm bells fading out as it becomes the maze
      c.lineWidth = 2;
      c.strokeRect(bx + 90, by + bh, 64, 34 * fadeCase);
      c.strokeRect(bx + bw - 154, by + bh, 64, 34 * fadeCase);
      for (const x of [bx + 180, bx + bw - 180]) {
        c.beginPath();
        c.arc(x, by - 6, 56 * fadeCase, Math.PI, 0);
        c.stroke();
      }
      c.restore();
    }

    // Draw the 7-segment digits of song time directly as maze corridors on the 40x18 grid!
    const m = Math.floor(tc / 60), s = Math.floor(tc - m * 60);
    const digits = `${String(m).padStart(2, '0')}${String(s).padStart(2, '0')}`;
    this.hud = [`VERSE 3 · CLOCK ${digits.slice(0, 2)}:${digits.slice(2)}`, 'ALARM NONE SET'];
    const wall = 6;
    const cellXY = (cell: number): [number, number] => [MX + (cell % MW) * MC, MY + Math.floor(cell / MW) * MC];
    for (const [cell, from] of this.digitCarve(digits)) {
      const [x, y] = cellXY(cell);
      c.clearRect(x + wall, y + wall, MC - 2 * wall, MC - 2 * wall);
      if (from < 0) continue;
      const [fx, fy] = cellXY(from);
      c.clearRect(Math.min(x, fx) + wall, Math.min(y, fy) + wall, Math.abs(x - fx) + MC - 2 * wall, Math.abs(y - fy) + MC - 2 * wall);
    }

    // Colon in the center column (col 19, rows 5 and 9): blinks on every kick drum hit, fading out right as maze carving starts
    const lastKick = this.kicks.filter((tk) => tk <= tc).at(-1) ?? -Infinity;
    const lit = (tc - lastKick) < 0.12;
    if (lit && fadeCase > 0.2) {
      for (const r of [5, 9]) {
        const [cx0, cy0] = cellXY(r * MW + 19);
        c.clearRect(cx0 + wall, cy0 + wall, MC - 2 * wall, MC - 2 * wall);
      }
    }

    // Marquee under the digits inside the clock face
    if (fadeCase > 0.15) {
      const mx = MX + 4 * MC, my = MY + 14 * MC, mw = (MW - 8) * MC;
      c.save();
      c.beginPath();
      c.rect(mx, my, mw, 50);
      c.clip();
      const k = sylAt(sl, tl);
      const bt = sl.bt;
      const lcell = 5;
      const x0m = Math.min(mx, headOffset(sl, tl, mx + mw - 20, lcell, true));
      c.fillStyle = gray(1, fadeCase);
      for (const b of bt.bricks) {
        const si = sl.ranges.findIndex(([a, e]) => b.ci >= a && b.ci < e);
        if (si > k || si < 0) continue;
        for (let j = 0; j < b.len; j++) c.fillRect(x0m + (b.cx + j) * lcell, my + b.cy * lcell, lcell - 1, lcell - 1);
      }
      if (k >= 0) {
        const [a, e] = sl.ranges[k]!;
        const xa = x0m + bt.charX[a]! * lcell, xe = x0m + (bt.charX[e - 1]! + bt.charW[e - 1]!) * lcell;
        mark(`syl:${sl.syls[k]!.text}`, xa, my, xe - xa, 50);
      }
      c.restore();
    }
  }

  /**
   * The maze: starts at `this.seedLen` (the exact "01:20" corridors left by the clock!) and carves outward
   * depth-first onto the blue with a pathfinder trace (no snake body) and random food that jumps on every kick.
   */
  private maze(c: CanvasRenderingContext2D, tq: number, sl: SylLine, tl: number) {
    const tLostEnd = 85.94; // onset of "everything"
    const level = `VERSE 3 · MAZE LEVEL ${String(Math.max(1, sl.line.i - 13)).padStart(2, '0')}`;
    // "having lost everything": all of it carved, the food gone (the food phase below sets its own)
    this.hud = [`${level} · CARVED ${String(this.carve.length).padStart(3, '0')}`, 'FOOD 00'];
    if (tq < tLostEnd) {
      const N = this.carve.length;
      const head = Math.min(N - 1, this.seedLen - 1 + Math.floor(prog(tq, this.tMaze, this.tLost - 0.3) * (N - this.seedLen)));
      const pMelt = tq >= this.tLost ? prog(tq, this.tLost, tLostEnd) : 0;
      const wall = Math.max(0, Math.round(6 * (1 - pMelt)));
      const cellXY = (cell: number): [number, number] => [MX + (cell % MW) * MC, MY + Math.floor(cell / MW) * MC];
      for (let k = 0; k <= head; k++) {
        const [cell, from] = this.carve[k]!;
        const [x, y] = cellXY(cell);
        c.clearRect(x + wall, y + wall, MC - 2 * wall, MC - 2 * wall);
        if (from < 0) continue;
        const [fx, fy] = cellXY(from);
        c.clearRect(Math.min(x, fx) + wall, Math.min(y, fy) + wall, Math.abs(x - fx) + MC - 2 * wall, Math.abs(y - fy) + MC - 2 * wall);
      }
      if (tq >= this.tLost) {
        // "having lost": the walls fall away as the maze transitions into a solid rectangle
        for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
          const threshold = (y / MH) * 0.3 + hashI(x, y, 17) * 0.7;
          if (pMelt > threshold) c.clearRect(MX + x * MC, MY + y * MC, MC, MC);
        }
      } else {
        // the food jumps on every kick drum hit since the maze began
        const kickCount = this.kicks.filter((tk) => tk <= tl).length;
        const foodCount = 16;
        const foods: [number, number][] = [];
        c.fillStyle = PAPER;
        for (let f = 0; f < foodCount; f++) {
          const fx = Math.floor(hashI(f, kickCount, 71) * MW);
          const fy = Math.floor(hashI(f, kickCount, 72) * MH);
          const px = MX + fx * MC, py = MY + fy * MC;
          foods.push([px + MC / 2, py + MC / 2]);
          c.fillRect(px + 10, py + 10, MC - 20, MC - 20);
        }
        // Thin pathfinder trace line along the active search branch toward the nearest evasive food (no snake body)
        const [hx, hy] = cellXY(this.carve[head]![0]);
        const hcx = hx + MC / 2, hcy = hy + MC / 2;
        c.strokeStyle = PAPER;
        c.lineWidth = 2;
        c.beginPath();
        const traceLen = Math.min(head, 18);
        for (let k = head - traceLen; k <= head; k++) {
          const [cx0, cy0] = cellXY(this.carve[k]![0]);
          if (k === head - traceLen) c.moveTo(cx0 + MC / 2, cy0 + MC / 2);
          else c.lineTo(cx0 + MC / 2, cy0 + MC / 2);
        }
        c.stroke();
        // Dashed targeting line from pathfinder head to nearest food (which jumps away every syllable)
        if (foods.length > 0) {
          let best = foods[0]!, bd = Infinity;
          for (const fd of foods) {
            const d = Math.abs(fd[0] - hcx) + Math.abs(fd[1] - hcy);
            if (d < bd) { bd = d; best = fd; }
          }
          c.setLineDash([5, 5]);
          c.lineWidth = 1.5;
          c.beginPath();
          c.moveTo(hcx, hcy);
          c.lineTo(best[0], hcy);
          c.lineTo(best[0], best[1]);
          c.stroke();
          c.setLineDash([]);
        }
        this.hud = [`${level} · CARVED ${String(head + 1).padStart(3, '0')}`, `FOOD ${String(foodCount).padStart(2, '0')}`];
      }
    } else {
      // "everything": the solid maze becomes the sky of the first day, with no cut. Its edges travel in
      // stepped moves to the sky of `cube` (frame sides, top bar, horizon) while the horizon line runs out
      // from the centre along its bottom edge; on the last beat `cube` takes over: the ground falls from
      // the horizon and the cube stacks up a layer at a time.
      const HZ = BAR + 300; // the horizon of `cube`
      const tSky = this.tCube - BEAT;
      if (tq < tSky) {
        const p = prog(tq, tLostEnd, tSky, ease.inOutCubic);
        const x1 = MX + MW * MC, y1 = MY + MH * MC;
        const left = Math.round(MX * (1 - p)), right = Math.round(x1 + (W - x1) * p);
        const top = Math.round(MY + (BAR - MY) * p), bottom = Math.round(y1 + (HZ - y1) * p);
        c.clearRect(left, top, right - left, bottom - top);
        const half = Math.round((W / 2) * prog(tq, tLostEnd, tSky, ease.outCubic));
        c.fillStyle = PAPER;
        c.fillRect(W / 2 - half, bottom, 2 * half, 2);
      } else {
        const next = this.lines.find((l) => l.line.start >= this.tCube - 0.05)!;
        this.cube(c, tq, next, tl, prog(tq, tSky, this.tCube));
      }
    }
    // the level name: the sung line, over the maze (only syllables started in this sub-scene)
    const k = sylAt(sl, tl);
    if (k >= 0) {
      c.fillStyle = PAPER;
      const cell = Math.min(6, (W - MX - 60) / sl.bt.cols);
      for (const b of sl.bt.bricks) {
        const si = sl.ranges.findIndex(([a, e]) => b.ci >= a && b.ci < e);
        if (si > k || si < 0) continue;
        brickRect(c, MX + b.cx * cell, MY - 82 + b.cy * cell, b.len, cell);
      }
      const [a, e] = sl.ranges[k]!;
      mark(`syl:${sl.syls[k]!.text}`, MX + sl.bt.charX[a]! * cell, MY - 82, (sl.bt.charX[e - 1]! + sl.bt.charW[e - 1]! - sl.bt.charX[a]!) * cell, 10 * cell);
    }
  }

  /**
   * The cube and its days: sun and shadow, moon and star trails, the line on the ground, then dust. The
   * cube is 6x6x6 voxels lit by the sun (or the moon); each voxel casts its shadow along the light onto the
   * ground; from "fading" the voxels let go one by one, outside and top first, and rise as dust. `intro`
   * (0..1) is the last beat before "looking": the ground falls from the horizon and the cube stacks up.
   */
  private cube(c: CanvasRenderingContext2D, tq: number, sl: SylLine, tl: number, intro = 1): PrintOpts {
    const age = Math.max(0, tq - this.tCube);
    // Strict 2-beat day + 2-beat night cycle (DAY = 4 * BEAT), starting at sunrise (th = 0) at age = 0 so there is never a 1-frame night flash
    const phase = ((age / DAY) % 1 + 1) % 1;
    const day = phase < 0.5;
    const th = phase * Math.PI * 2;
    const sunP: V3 = [Math.cos(th) * 9, Math.sin(th) * 6, 7];
    const HZ = BAR + 300; // horizon
    const CAM: V3 = [0, 1.6, -7];
    const proj = (p: V3): [number, number] => {
      const zc = p[2] - CAM[2];
      return [W / 2 + (p[0] / zc) * 1100, HZ + ((CAM[1] - p[1]) / zc) * 1100 - 150];
    };
    // the sky: blue by day, black at night with the trails of the stars round the pole
    if (!day) {
      c.fillStyle = INK;
      c.fillRect(0, BAR, W, HZ - BAR);
      const pole: [number, number] = [W * 0.78, BAR + 40];
      c.strokeStyle = PAPER;
      c.lineWidth = 1.5;
      const sweep = Math.min(Math.PI * 1.6, age * 0.35);
      for (let i = 0; i < 70; i++) {
        const r = 30 + hashI(i, 61) * 1400, a0 = hashI(i, 62) * Math.PI * 2;
        c.beginPath();
        c.arc(pole[0], pole[1], r, a0, a0 + sweep);
        c.stroke();
      }
      c.fillStyle = INK;
      c.fillRect(0, HZ, W, H);
    } else c.clearRect(0, BAR, W, HZ - BAR);
    // sun or moon on its arc; the light comes from it (a direction: they are far away)
    const body: V3 = day ? sunP : [-sunP[0], -sunP[1], 7];
    const [bx, by] = [W / 2 + (body[0] / 16) * W, HZ - (body[1] / 6) * 260];
    if (by < HZ) {
      c.fillStyle = PAPER;
      c.beginPath();
      c.arc(bx, by, day ? 46 : 34, 0, Math.PI * 2);
      c.fill();
      if (!day) { c.fillStyle = INK; c.beginPath(); c.arc(bx + 14, by - 8, 30, 0, Math.PI * 2); c.fill(); }
    }
    const ln = Math.hypot(body[0], body[1], body[2]);
    const L: V3 = [body[0] / ln, body[1] / ln, body[2] / ln];
    // the ground: paper by day, solid ink at night (no intermediate gray to prevent halftone moire); in the
    // intro it falls from the horizon line
    c.fillStyle = day ? PAPER : INK;
    c.fillRect(0, HZ, W, intro < 1 ? Math.max(2, Math.round(ease.outCubic(intro) * (H - BAR - HZ))) : H - BAR - HZ);
    if (!day) {
      // crisp horizon demarcation at night
      c.strokeStyle = PAPER;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(0, HZ);
      c.lineTo(W, HZ);
      c.stroke();
    }
    // the voxels still standing, and the dust (frozen on "heart")
    const N = 6, S = 1.1, v = S / N, built = Math.ceil(intro * N);
    const td = Math.min(stepT(tq, 12, 0), this.tFreeze); // (tq is held at 15 fps already: no skew)
    const span = Math.max(0.1, this.tFreeze - this.tFade);
    const standing: V3[] = [];
    const dust: { p: V3; a: number; id: number }[] = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
      if (j >= built) continue; // the intro: the layers not yet stacked
      const id = (i * N + j) * N + k;
      // release order: the outside and the top go first, then inwards
      const edge = Math.max(Math.abs(i - (N - 1) / 2), Math.abs(k - (N - 1) / 2)) / ((N - 1) / 2);
      const order = 0.45 * (1 - edge) + 0.35 * (1 - j / (N - 1)) + 0.2 * hashI(id, 41);
      const tr = this.tFade + order * span * 0.92;
      const p: V3 = [-S / 2 + i * v, j * v, -S / 2 + k * v];
      if (td < tr) standing.push(p);
      else dust.push({ p, a: td - tr, id });
    }

    // shadows: every standing voxel cast along the light onto the ground (the hull of its 8 corners)
    const lyc = Math.max(0.12, L[1]);
    const cast = (p: V3): [number, number] => proj([p[0] - (L[0] * p[1]) / lyc, 0, p[2] - (L[2] * p[1]) / lyc]);
    const shadow = new Path2D();
    const lit = L[1] > 0.05;
    if (lit) {
      for (const p of standing) {
        const pts: [number, number][] = [];
        for (const dy of [0, v]) for (const [dx, dz] of [[0, 0], [v, 0], [v, v], [0, v]] as const) pts.push(cast([p[0] + dx, p[1] + dy, p[2] + dz]));
        convexHull(pts).forEach((q, n) => (n ? shadow.lineTo(q[0], q[1]) : shadow.moveTo(q[0], q[1])));
        shadow.closePath();
      }
      c.fillStyle = day ? INK : BLUE;
      c.fill(shadow, 'nonzero');
    }

    // the line painted on the ground in front of the cube: ink on the lit ground, paper where the shadow
    // falls on it (it always reads)
    const k = sylAt(sl, tl);
    // sized so the whole line stays in the frame (at most 1600 px wide on its nearest row)
    const ZT = -2.3, gcell = Math.min(0.09, 1600 / (sl.bt.cols * (1100 / (ZT - CAM[2])))), lx0 = -(sl.bt.cols * gcell) / 2;
    const text = new Path2D();
    let tx0 = Infinity, ty0 = Infinity, tx1 = -Infinity, ty1 = -Infinity;
    for (const b of sl.bt.bricks) {
      const si = sl.ranges.findIndex(([a, e]) => b.ci >= a && b.ci < e);
      if (si > k || si < 0) continue;
      const x0 = lx0 + b.cx * gcell, x1 = x0 + b.len * gcell * 0.9, z0 = ZT + (9 - b.cy) * gcell * 1.5, z1 = z0 + gcell * 1.35;
      const pts = [proj([x0, 0, z0]), proj([x1, 0, z0]), proj([x1, 0, z1]), proj([x0, 0, z1])];
      pts.forEach((q, n) => (n ? text.lineTo(q[0], q[1]) : text.moveTo(q[0], q[1])));
      text.closePath();
      for (const q of pts) { tx0 = Math.min(tx0, q[0]); tx1 = Math.max(tx1, q[0]); ty0 = Math.min(ty0, q[1]); ty1 = Math.max(ty1, q[1]); }
    }
    c.fillStyle = day ? INK : PAPER;
    c.fill(text);
    if (day && lit) {
      c.save();
      c.clip(shadow);
      c.fillStyle = PAPER;
      c.fill(text);
      c.restore();
    }
    if (k >= 0 && tx1 > tx0) mark(`syl:${sl.syls[k]!.text}`, tx0, ty0, tx1 - tx0, ty1 - ty0);

    // the voxels, far to near; at night add rim lights along exposed top/silhouette faces so the cube & voxels read clearly
    const tone = (n: V3) => {
      const d = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) * (L[1] > 0 ? 1 : 0);
      if (day) return 0.12 + 0.8 * d;
      const rim = n[1] > 0.5 ? 0.24 : n[0] < -0.5 || n[0] > 0.5 ? 0.16 : 0.08;
      return 0.14 + 0.38 * d + rim;
    };
    const key = (p: V3) => `${Math.round((p[0] + S / 2) / v)},${Math.round(p[1] / v)},${Math.round((p[2] + S / 2) / v)}`;
    const occupied = new Set(standing.map(key));
    const dist = (p: V3) => Math.hypot(p[0] + v / 2 - CAM[0], p[1] + v / 2 - CAM[1], p[2] + v / 2 - CAM[2]);
    const vox = (p: V3, size: number, rot: number) => {
      const [ci, cj, ck] = key(p).split(',').map(Number) as [number, number, number];
      const cs = Math.cos(rot), sn = Math.sin(rot), g = (1 - size) / 2;
      for (const f of VOXEL_FACES) {
        if (rot === 0 && occupied.has(`${ci + f.n[0]},${cj + f.n[1]},${ck + f.n[2]}`)) continue;
        const fc: V3 = [p[0] + v / 2 + (f.n[0] * v) / 2, p[1] + v / 2 + (f.n[1] * v) / 2, p[2] + v / 2 + (f.n[2] * v) / 2];
        if (f.n[0] * (CAM[0] - fc[0]) + f.n[1] * (CAM[1] - fc[1]) + f.n[2] * (CAM[2] - fc[2]) <= 0) continue;
        const pts = f.q.map(([a, b, d]) => {
          const x = (a - 0.5) * size, z = (d - 0.5) * size;
          return proj([p[0] + v / 2 + (x * cs - z * sn) * v, p[1] + (b * size + g) * v, p[2] + v / 2 + (x * sn + z * cs) * v]);
        });
        c.fillStyle = gray(tone(f.n));
        c.beginPath();
        pts.forEach((q, n) => (n ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
        c.closePath();
        c.fill();
        if (!day) {
          const isRimEdge = rot !== 0 || cj === N - 1 || ci === 0 || ci === N - 1 || ck === 0;
          c.strokeStyle = isRimEdge ? PAPER : gray(0.55);
          c.lineWidth = isRimEdge ? 1.4 : 0.7;
          c.stroke();
        }
      }
    };
    for (const p of standing.sort((a, b) => dist(b) - dist(a))) vox(p, 0.94, 0);
    // dust: the voxels that let go rise and drift on the wind, tumbling and shrinking, gone in 2.4 s
    for (const d of dust.sort((a, b) => dist(b.p) - dist(a.p))) {
      const life = clamp(1 - d.a / 2.4);
      if (life <= 0) continue;
      const p: V3 = [d.p[0] - 0.5 * d.a - 0.12 * d.a * d.a + Math.sin(d.id + d.a * 3) * 0.06 * d.a, d.p[1] + 0.45 * d.a + 0.5 * d.a * d.a, d.p[2] + 0.2 * d.a * (hashI(d.id, 3) - 0.5)];
      vox(p, 0.94 * (0.3 + 0.7 * life), d.a * (1 + 2 * hashI(d.id, 4)));
    }
    this.hud = [`VERSE 3 · CUBE DAY ${String(Math.floor(age / DAY) + 1).padStart(2, '0')} · ${day ? 'SUN' : 'MOON'} ${String(Math.round((((th / (Math.PI * 2)) % 1) + 1) % 1 * 24)).padStart(2, '0')}H`, `VOXELS ${String(standing.length).padStart(3, '0')}`];
    // the starry sky is the picture here: no Life plane
    return { plane: 0, clumps: 0, grain: 0.6 };
  }

  /** The identity record: a field redacted per syllable, VOID on "existence", then it is cut into tiles that fold into the row of "disfigured". */
  private record(c: CanvasRenderingContext2D, tr: number) {
    const ex = this.exist;
    const k = sylAt(ex, tr);
    this.hud = [`VERSE 3 · RECORD REDACTED ${String(k + 1).padStart(2, '0')}/${String(ex.syls.length).padStart(2, '0')}`, tr >= ex.syls[ex.syls.length - 1]!.start ? 'STATUS VOID' : 'STATUS OPEN'];
    if (tr < this.fold.t0) {
      drawCard(c, tr, ex);
      if (k >= 0) mark(`syl:${ex.syls[k]!.text}`, ...cardLineRect(ex, k));
      return;
    }
    if (k >= 0 && tr < ex.line.end) mark(`syl:${ex.syls[k]!.text}`, ...cardLineRect(ex, k));
    const dl = this.dis;
    const FCELL = 15, COS = Math.cos(Math.PI / 6), SIN = Math.sin(Math.PI / 6);
    const sc = Math.min(0.8, 1250 / (dl.bt.cols * FCELL * COS));
    const ox = 110, oy = 360;
    const iso = (x: number, y: number, z: number): [number, number] => [
      ox + (x - z) * COS * sc,
      oy + ((x + z) * SIN * 0.55 - y) * sc,
    ];
    this.fold.reveal(c, tr, this.ctx.end);
    this.fold.draw(c, tr, iso);
    // (the dimension line of this row is the blueprint's: it draws in with the sheet in flock, not here)
    // the sung bricks rise from the slab
    const k2 = sylAt(dl, tr);
    dl.bt.bricks.forEach((br, bi) => {
      const si = sylOfChar(dl, br.ci);
      if (si < 0 || si > k2) return;
      const s = dl.syls[si]!;
      const warp = prog(tr, s.start + 0.06, s.end + 0.06, ease.outBack);
      const px3 = br.cx * FCELL + warp * (hashI(bi, 40) - 0.5) * 22;
      const py3 = (9 - br.cy) * FCELL + warp * (hashI(bi, 41) - 0.5) * 18;
      const pz3 = warp * (hashI(bi, 42) - 0.5) * 36;
      const L = br.len * FCELL, D = FCELL * prog(tr, s.start, s.start + 0.12, ease.outCubic);
      const P = (dx: number, dy: number, dz: number) => iso(px3 + dx, py3 + dy, pz3 + dz);
      const poly = (pts: [number, number][], fill: string) => {
        c.fillStyle = fill;
        c.beginPath(); pts.forEach((p, j) => (j ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fill();
        c.strokeStyle = PAPER; c.lineWidth = 1; c.stroke();
      };
      poly([P(0, 0, 0), P(L, 0, 0), P(L, FCELL, 0), P(0, FCELL, 0)], PAPER);
      poly([P(0, FCELL, 0), P(L, FCELL, 0), P(L, FCELL, D), P(0, FCELL, D)], gray(0.65));
      poly([P(0, 0, 0), P(0, FCELL, 0), P(0, FCELL, D), P(0, 0, D)], INK);
    });
    if (k2 >= 0) {
      const [a, e] = dl.ranges[k2]!;
      const [x0, y0] = iso(dl.bt.charX[a]! * FCELL, 10 * FCELL, 0);
      const [x1, y1] = iso((dl.bt.charX[e - 1]! + dl.bt.charW[e - 1]!) * FCELL, 0, 0);
      mark(`syl:${dl.syls[k2]!.text}`, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) + 20, Math.abs(y1 - y0) + 20);
    }
  }
}

/** The faces of a unit voxel a camera in front, above and to either side can see: normal, corners (0..1). */
const VOXEL_FACES: { n: V3; q: V3[] }[] = [
  { n: [0, 0, -1], q: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
  { n: [-1, 0, 0], q: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [1, 0, 0], q: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, 1, 0], q: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] },
];

/** The convex hull of some points (monotone chain). */
function convexHull(pts: [number, number][]): [number, number][] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], hi: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]!; while (hi.length >= 2 && cross(hi[hi.length - 2]!, hi[hi.length - 1]!, q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
