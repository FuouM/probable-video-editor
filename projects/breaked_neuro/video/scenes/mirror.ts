// mirror ("more i look at the mirror i" until the chorus). The wall of Verse 1 carries on from walls: it
// keeps sliding with its words on it, slows down over a bar and stops; the alley in front lets its last
// props go by. A fresh coat of black is rolled over a patch of the wall and the line types onto it, stuck
// to the wall as it comes to rest. From "mir|ror" the camera pulls back at one slow linear rate to "coming
// right at": the whole scene was inside a mirror hung on that wall, and out here the alley reads
// backwards, its painted words, its drainpipes and its air-conditioning units. "com|ing|right|at": the
// mirror jumps at the camera on every syllable (about the typed text, so it stays in the frame; "at" gets a
// row of its own, centred, and its kick brings it to the frame centre), the glass cracks from one point,
// and on "at" it shatters; the shards fly at the camera and on into the chorus (the Over transition `shards`).
// Rates: zoom 24 fps, typing 30 fps, wall 15 fps, alley 12.
import type { Frame } from '@pve/engine/scene';
import { ease, prog } from '@pve/engine/util';
import { SCALE, W } from '@pve/engine/gl';
import { BAR, BEAT, BEAT0, BOX_H, INK, PAPER, PrintScene, brickRect, bricks, damagedBrick, drawBars, gray, hashI, readout, stepT, type PrintOpts } from './_kit';
import { MirrorGeom, MirrorGlass, TEXT_X, TEXT_Y, type MirrorAt } from './_mirror';
import { WALL_SPEED } from './_wall';
import { mark } from '@pve/engine/marks';

/** Things of the alley around the mirror, in mirror units (px at scale 1, from the mirror centre). */
const PAINTED: [string, number, number, number][] = [
  ['looking at the walls', -2350, -330, 13], ['as days went by', 1150, -380, 12], ['real', 1230, 120, 22],
  ['or fake', -1900, 160, 16], ["i don't know", -1500, 520, 12], ['any', 1350, 520, 16],
];

export default class Mirror extends PrintScene {
  private glass!: MirrorGlass;
  private g!: MirrorGeom;

  override init() {
    this.glass = new MirrorGlass(this.ctx.lyrics, this.ctx.start, this.ctx.end);
    this.g = this.glass.g;
    // the plane and the ships are walls', running on from where walls left them
    this.plane = { of: 'walls', t0: this.glass.t0Walls };
  }


  /** Out here: the alley wall the mirror hangs on, mirrored (we are on the other side of the glass). */
  private drawOuter(c: CanvasRenderingContext2D, m: MirrorAt, tw: number) {
    const s = m.s, cx = m.mx + m.mw / 2, cy = m.my + m.mh / 2;
    c.fillStyle = INK;
    c.fillRect(0, 0, W, 1080);
    c.save();
    c.translate(cx, cy);
    c.scale(-s, s);
    // the wall: running courses, damaged, the mortar shows the blue
    const cell = 26, bw = 3;
    const ext = 1080 / s, wx = W / s;
    for (let r = Math.floor(-ext / cell); r * cell < ext; r++) {
      for (let n = Math.floor(-wx / (bw * cell)) - 1; n * bw * cell < wx; n++) {
        damagedBrick(c, n * bw * cell + ((r & 1) * bw * cell) / 2, r * cell, bw, cell, n * 197 + r * 7, 0.3, 0.1);
      }
    }
    // drainpipes and an air-conditioning unit of the alley
    c.fillStyle = gray(0.28);
    for (const x of [-1240, 1060, 2300]) {
      c.fillRect(x, -ext, 22, 2 * ext);
      for (let k = -6; k < 7; k++) c.fillRect(x - 6, k * 150, 34, 8);
    }
    const ax = 1500, ay = -720;
    c.fillStyle = INK;
    c.fillRect(ax, ay, 300, 220);
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    c.arc(ax + 110, ay + 110, 82, 0, Math.PI * 2);
    c.fill();
    for (let k = 0; k < 8; k++) c.fillRect(ax + 214, ay + 30 + k * 21, 62, 8);
    c.restore();
    c.fillStyle = INK;
    for (let k = 0; k < 3; k++) {
      const a = tw * 9 + (k * Math.PI * 2) / 3;
      c.beginPath();
      c.moveTo(ax + 110, ay + 110);
      c.arc(ax + 110, ay + 110, 72, a, a + 0.75);
      c.closePath();
      c.fill();
    }
    c.fillStyle = PAPER;
    c.fillRect(ax, ay, 300, 2);
    c.fillRect(ax, ay, 2, 220);
    // the words painted on the walls of Verse 1, still there
    c.fillStyle = gray(0.62);
    for (const [text, x, y, wc] of PAINTED) {
      for (const b of bricks(text).bricks) brickRect(c, x + b.cx * wc, y + b.cy * wc, b.len, wc);
    }
    c.restore();
  }

  draw(c: CanvasRenderingContext2D, f: Frame): PrintOpts {
    const g = this.g;
    const t = f.t;
    const tz = stepT(t, 24);
    let m = g.at(tz);
    // shake: a hard kick on every syllable of "coming right at", gone in 0.15 s
    let sx = 0, sy = 0;
    g.hits.forEach((h, k) => {
      const a = tz - h;
      if (a < 0 || a > 0.15) return;
      const amp = (10 + 6 * k) * (1 - a / 0.15);
      sx += (hashI(Math.round(tz * 24), k, 1) - 0.5) * 2 * amp;
      sy += (hashI(Math.round(tz * 24), k, 2) - 0.5) * 2 * amp;
    });
    m = { ...m, mx: m.mx + sx, my: m.my + sy };

    this.drawOuter(c, m, stepT(t, 15));
    const t30 = stepT(t, 30);
    const [, h1, h2, h3] = g.hits as [number, number, number, number];
    // the picture on the glass (held from the moment it breaks: the shards carry it into room)
    this.glass.drawInner(Math.min(t30, h3 + 0.15));
    // the plane is the inner wall's: it slides on with it (as in walls) and scales about the mirror centre
    // at the mirror's own scale
    const view = { x: -(m.mx + m.mw / 2 - W / 2) + this.glass.wallShift(t30) * m.s, y: -(m.my + m.mh / 2 - 540), cell: 3 * m.s };
    // the typed syllables, on screen
    const cur = g.current(t30), dx = this.glass.stuckDx(t30);
    const bySyl = new Map<number, [number, number, number, number]>();
    for (const p of cur.placed) {
      if (t30 < (cur.charT.get(p.b.ci) ?? Infinity)) continue;
      const x = TEXT_X + dx + p.x * cur.cell, y = TEXT_Y + p.y * cur.cell, r = bySyl.get(p.si);
      bySyl.set(p.si, r ? [Math.min(r[0], x), Math.min(r[1], y), Math.max(r[2], x + p.b.len * cur.cell), Math.max(r[3], y + cur.cell)] : [x, y, x + p.b.len * cur.cell, y + cur.cell]);
    }
    // (after "at" the same boxes ride the shards: close enough to say what is on screen)
    const kx = m.mw / W, ky = m.mh / BOX_H;
    for (const [si, [x0, y0, x1, y1]] of bySyl) mark(`syl:${cur.sl.syls[si]!.text}`, m.mx + x0 * kx, m.my + y0 * ky, (x1 - x0) * kx, (y1 - y0) * ky);
    const pOpen = prog(t, g.tComing, this.ctx.end, ease.inOutCubic);
    const barH = Math.round(BAR * (1 - pOpen));
    // the clumps start dying at bar 31, one by one, and none are left when "coming right at" starts
    const clumpKill = prog(t, BEAT0 + 30 * 4 * BEAT, g.tComing);
    if (tz < h3) {
      this.glass.drawMirror(c, m, tz >= h2 ? 9 : tz >= h1 ? 4 : 0);
      if (barH > 0) drawBars(c, [barH, barH, 0, 0]);
      this.readouts(c, m.s, tz >= h2 ? 9 : tz >= h1 ? 4 : 0, t30, barH);
      return { view, full: barH === 0, clumpKill };
    }
    // "at": the glass shatters along its cracks; the wedges fly at the camera, out over the bars (and on
    // across the cut: the Over transition `shards` draws the same wedges)
    if (barH > 0) drawBars(c, [barH, barH, 0, 0]);
    this.readouts(c, m.s, g.rays.length, t30, barH);
    this.glass.drawShards(c, m, tz);
    return { view, full: true, clumpKill };
  }

  /**
   * The readouts: the mirror's scale and its cracks, and the metres of walls' wall, which slows to a stop.
   * When the bars open on "coming right at", they leave with the bottom bar.
   */
  private readouts(c: CanvasRenderingContext2D, s: number, cracks: number, t30: number, barH: number) {
    if (barH <= 0) return;
    const dy = BAR - barH;
    readout(c, `VERSE 1 · MIRROR ${s.toFixed(2)}× · CRACKS ${String(cracks).padStart(2, '0')}`, 'left', false, dy);
    readout(c, `${((this.glass.t0Walls * WALL_SPEED + this.glass.wallShift(t30)) / 100).toFixed(1)} M`, 'right', false, dy);
  }
}
