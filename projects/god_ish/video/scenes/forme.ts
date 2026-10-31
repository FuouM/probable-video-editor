// Copy transition plate 1 → 2 (Over transition, treatment "Motion (v4)"): lock up the forme. The typed glyphs
// pop off the typewriter sheets as metal sorts, a random set on each beat of the drumless bar of 神っぽいな;
// each leaves its glyph cut through the paper onto the red, rises face down and turns over to show its reversed
// face, then glides over its slot in the chase. The bed of the press glides in from the right under the carbons.
// When the line ends (the snare comes back) the sorts drop onto the bed, the masthead first (the original's
// 神っぽいな lift off as they are sung), then column by column, right to left, the typewriter's tray emptying
// into the body. The quoins lock the forme. The ink roller runs right to left and the impression cylinder
// follows it, rolling back over the forme from the cut and leaving the printed broadsheet behind it (the
// broadsheet clip, under the transition), its headline first. Every move is smooth. The camera never moves.
// The page is flat; this act is 3D. Params: `last` and `first`, the last line of plate 1 and the first of plate 2.
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { clearRT, H, makeRT, W } from '@pve/engine/gl';
import { lineNo, units } from '@pve/engine/lyrics';
import { hash } from '@pve/engine/util';
import { loadType } from './_page';
import { G, Sheets, SH, STACK, SW } from './carbons-sheet';
import { Tray, TRAY_BOX } from './carbons-tray';
import { sheetAt } from './carbons';
import { bodyShown, bodyText, HEAD12, MAST, pressOnsets, RESERVED, SHEET } from './broadsheet';
import { BODY_X, bodyLayout, TIER, TIERS } from './broadsheet-body';
import { Atlas, BED_Z, D, FOV, FormeGL, TYPE_HIGH, worldAt } from './forme-gl';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** The bed quad reaches this far past the frame (px). */
const BED_PAD = 80;
const ROLLER_R = 52;
/** The impression cylinder: radius, and how long it takes to roll over the forme from the cut (s). */
const CYL_R = 120;
const CYL_T = 1.3;
/** The cylinder rolls out with this ease exponent: it starts at CYL_EXP * span / CYL_T px/s and slows. */
const CYL_EXP = 3.4;
/** The inking roller runs this far ahead of the cylinder's contact line (px). */
const ROLL_LEAD = 230;
/** A sort: its rise and turn-over after the pop (s), the shortest glide to its slot, the drop onto the bed. */
const TURN = 0.32, MIN_TRANSIT = 0.45, DROP = 0.16;
/** Sheet glyph weight, body sort weight, masthead weight. */
const W_SHEET = 400;
const W_BODY = 500;
const W_MAST = 900;
/** Vertical presentation forms back to the glyph of the tray. */
const HFORM: Record<string, string> = { '︑': '、', '︒': '。', '﹁': '「', '﹂': '」', '﹃': '『', '﹄': '』', '︙': '…', '︵': '（', '︶': '）', '︓': '：', '︕': '！', '︖': '？' };

interface Sort {
  kind: 'sheet' | 'tray' | 'mast';
  /** Atlas cells: the face it shows reversed (its place in the forme), the hole it leaves (sheets). */
  face: number;
  hole: number;
  /** Source: frame px centre, angle (canvas, clockwise), size. */
  sx: number; sy: number; sa: number; ss: number;
  /** Target: forme px centre and size. */
  tx: number; ty: number; ts: number;
  pop: number; dep: number; arr: number; land: number;
  /** The height it holds over its slot before the drop. */
  zh: number;
  /** Hover: height, drift, tumble, spin in flight (turns). */
  h: number; dx: number; dy: number; tr: number; spin: number; seed: number;
}

interface Pose { x: number; y: number; z: number; rx: number; ry: number; rz: number; s: number }

export default class Forme extends Scene {
  private gl!: FormeGL;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(FOV, W / H, 10, D * 3);
  private sorts: Sort[] = [];
  private sortMesh!: THREE.InstancedMesh;
  private holeMesh!: THREE.InstancedMesh;
  private shadowMesh!: THREE.InstancedMesh;
  private paper!: THREE.Mesh;
  private print!: THREE.Mesh;
  private bed!: THREE.Mesh;
  private roller!: THREE.Mesh;
  private cylinder!: THREE.Mesh;
  /** The cut; the end of line 11 (the gather); the first beat the bed moves on. */
  private cut = 0;
  private g0 = 0;
  private b0 = 0;
  /** The bed glides from bs to home at be. */
  private bs = 0;
  private be = 0;
  /** The quoins are driven home from here. */
  private q0 = 0;
  /** The impression cylinder's contact line: frame x where it starts on the cut, and where it leaves the frame. */
  private x0 = SHEET[2] + 40;
  private x1 = -CYL_R - 110;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sv = new THREE.Vector3();
  private pa: Pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 0 };

  override async init() {
    const pr = this.ctx.params;
    if (typeof pr.last !== 'number' || typeof pr.first !== 'number') throw new Error('forme: params last and first must be line indexes');
    if (typeof pr.at !== 'number') throw new Error('forme: no resolved at');
    await loadType(this.ctx.assets);
    const L = this.ctx.lyrics;
    const au = this.ctx.audio;
    const last = lineNo(L, pr.last), first = lineNo(L, pr.first);
    this.cut = pr.at;
    this.g0 = last.end;
    if (!(this.g0 + 0.36 < this.cut && first.start < this.cut + 0.1)) throw new Error(`forme: lines ${pr.last}/${pr.first} leave no room for the lock-up before the cut at ${this.cut}`);
    this.be = this.g0 + 0.18;
    this.q0 = this.cut - 0.12;
    // the headline of the first line of plate 2 must be printed by its second onset
    const head = HEAD12.x[0]! - HEAD12.size / 2;
    const second = units(first)[1]!.start;
    if (this.contact(second) + CYL_R > head) throw new Error(`forme: the cylinder prints line ${pr.first}'s headline after its second onset (${second.toFixed(3)} s: contact ${Math.round(this.contact(second))} + ${CYL_R} > headline edge ${Math.round(head)})`);

    // the pops: the last kick before the drums drop out, the sung onsets of the line after it, then 16ths to its end
    const us = units(last);
    const kick = au.events('kick', last.start, this.g0).map(([t]) => t).pop() ?? last.start;
    const waves = [kick, ...us.map((u) => u.start).filter((t) => t > kick + 0.05)];
    const tail = waves[waves.length - 1]! + 0.05;
    for (let b = Math.ceil(au.beatAt(tail) * 4) / 4; au.timeOfBeat(b) < this.g0 - 0.03; b += 0.25) waves.push(au.timeOfBeat(b));
    this.b0 = au.timeOfBeat(Math.ceil(au.beatAt(us[us.length - 1]!.start)));
    this.bs = this.b0 - 0.21;

    // the forme: the body columns the broadsheet shows on the cut, and the masthead
    const press = pressOnsets(L);
    const imp = press.onsets.filter((o) => o <= this.cut).length;
    const lay = bodyLayout(bodyText(L), RESERVED, SHEET);
    const cols = bodyShown(lay.slots.length, imp, press.fill);
    const body = lay.cells.filter((c) => c.col < cols).map((c) => ({
      ch: c.ch, x: c.x + (c.small ? c.size * 0.12 : 0), y: c.y - (c.small ? c.size * 0.1 : 0), size: c.size,
    }));
    const bx0 = Math.min(...body.map((b) => b.x)), bx1 = Math.max(...body.map((b) => b.x));
    // the body is set column by column, right to left
    const landAt = (x: number, seed: number) => this.g0 + 0.14 + 0.55 * (1 - (x - bx0) / (bx1 - bx0)) + 0.04 * hash(seed, 7);
    // when the inking roller, which runs ROLL_LEAD ahead of the cylinder, reaches frame x: the sorts there are down by then
    const rollerAt = (x: number) => {
      for (let t = this.g0; t < this.cut + CYL_T; t += 0.002) if (this.contact(t) - ROLL_LEAD <= x) return t;
      return this.cut + CYL_T;
    };
    const latest = (x: number) => rollerAt(x) - 0.12;
    // a sort glides to over its slot (at least MIN_TRANSIT) and drops onto the bed
    const timing = (pop: number, wish: number, last: number, seed: number) => {
      const dep = pop + TURN + 0.08 * hash(seed, 8);
      const arr = Math.max(dep + 0.12, Math.min(last - DROP, Math.max(wish - DROP, dep + MIN_TRANSIT)));
      return { dep, arr, land: arr + DROP };
    };

    const sheets = new Sheets(L);
    const tray = new Tray(L, TRAY_BOX);
    const entries: [string, number][] = [['神', W_MAST], ...MAST.name.map((ch): [string, number] => [ch, W_MAST]), ...body.map((b): [string, number] => [b.ch, W_BODY])];
    type Src = { ch: string; x: number; y: number; a: number; k: number; t: number; line: number };
    const srcs: Src[] = [];
    STACK.forEach((st, k) => {
      const [px, py] = sheetAt(k);
      const cs = Math.cos(st.rot), sn = Math.sin(st.rot);
      sheets.strikes.forEach((s, i) => {
        if (s.t > this.g0) return;
        for (const c of sheets.place(L, k, i, this.g0)) {
          // the glyph centre on the slipped sheet
          const gx = c.x + c.ox * Math.cos(c.a) - c.oy * Math.sin(c.a) - SW / 2;
          const gy = c.y + c.ox * Math.sin(c.a) + c.oy * Math.cos(c.a) - SH / 2;
          srcs.push({ ch: c.ch, x: px + SW / 2 + st.dx + gx * cs - gy * sn, y: py + SH / 2 + st.dy + gx * sn + gy * cs, a: c.a + st.rot, k, t: s.t, line: s.line });
          entries.push([c.ch, W_SHEET]);
        }
      });
    });
    const atlas = new Atlas(entries);
    this.gl = new FormeGL(atlas);

    // when the bed's leading edge passes frame x
    const passes = (x: number) => {
      for (let t = this.bs; t < this.be; t += 0.002) if (this.shift(t) - BED_PAD <= x) return t;
      return this.be;
    };
    const pickWave = (seed: number, from: number, to: number) => {
      const ok = waves.filter((w) => w >= from && w <= to);
      if (!ok.length) throw new Error(`forme: no beat between ${from.toFixed(3)} and ${to.toFixed(3)} s to pop a sort on`);
      // later waves are larger
      const wt = ok.map((_, i) => 1 + i);
      let r = hash(seed, 11) * wt.reduce((a, b) => a + b, 0);
      for (let i = 0; i < ok.length; i++) if ((r -= wt[i]!) <= 0) return ok[i]!;
      return ok[ok.length - 1]!;
    };

    // masthead: the original's 神っぽいな; the body: the other typed glyphs, by glyph where the body has it
    const free = body.map((_, i) => i).sort((a, b) => hash(a, 21) - hash(b, 21));
    const take = (ch: string | null) => {
      const j = ch === null ? 0 : free.findIndex((i) => body[i]!.ch === ch);
      return j < 0 ? -1 : free.splice(j, 1)[0]!;
    };
    const sheetSorts: [Src, number][] = [];
    const later: Src[] = [];
    srcs.forEach((s) => {
      if (s.k === 0 && s.line === pr.last) return;
      const j = take(s.ch);
      if (j < 0) later.push(s);
      else sheetSorts.push([s, j]);
    });
    for (const s of later) {
      if (!free.length) throw new Error('forme: more typed glyphs than body sorts printed at the cut');
      sheetSorts.push([s, take(null)]);
    }
    let n = 0;
    const base = (seed: number) => ({
      h: 110 + 190 * hash(seed, 1), dx: 0, dy: -30 - 40 * hash(seed, 3), tr: 0.15 + 0.3 * hash(seed, 4),
      spin: hash(seed, 5) < 0.2 ? (hash(seed, 6) < 0.5 ? -1 : 1) : 0, seed, zh: BED_Z + TYPE_HIGH + 60 + 90 * hash(seed, 9),
    });
    for (const [s, j] of sheetSorts) {
      const seed = n++;
      const b = body[j]!;
      // carbons pop before the bed runs over them; the original's sorts drift right, off line 11
      const deadline = s.k === 0 ? this.g0 - 0.02 : passes(s.x - 40) - 0.05;
      const wish = landAt(b.x, seed);
      // a sort that pops early enough has the time to glide to its slot
      const early = wish - TURN - 0.08 - MIN_TRANSIT - DROP;
      const pop = pickWave(seed, s.t + 0.12, waves.some((w) => w >= s.t + 0.12 && w <= Math.min(early, deadline)) ? Math.min(early, deadline) : deadline);
      const o = base(seed);
      o.dx = s.k === 0 ? 40 + 60 * hash(seed, 2) : (hash(seed, 2) - 0.5) * 80;
      this.sorts.push({
        kind: 'sheet', face: atlas.of(b.ch, W_BODY), hole: atlas.of(s.ch, W_SHEET),
        sx: s.x, sy: s.y, sa: s.a, ss: G, tx: b.x, ty: b.y, ts: b.size,
        pop, ...timing(pop, wish, latest(b.x), seed), ...o,
      });
    }
    for (const s of srcs.filter((x) => x.k === 0 && x.line === pr.last)) {
      const k = MAST.name.indexOf(s.ch);
      if (k < 0) throw new Error(`forme: the masthead has no "${s.ch}"`);
      const seed = n++;
      const small = s.ch === 'っ';
      // each syllable lifts its glyph as it is struck; they set the masthead in the order they were sung
      const pop = s.t + 0.1;
      this.sorts.push({
        kind: 'mast', face: atlas.of(s.ch, W_MAST), hole: atlas.of(s.ch, W_SHEET),
        sx: s.x, sy: s.y, sa: s.a, ss: G,
        tx: MAST.x + (small ? MAST.size * 0.12 : 0), ty: MAST.y + k * MAST.step - (small ? MAST.size * 0.1 : 0), ts: MAST.size,
        pop, ...timing(pop, this.g0 + 0.12 + k * 0.045, latest(MAST.x), seed), ...base(seed), h: 200 + 30 * k, dx: 30 * k - 40, dy: -40 + 15 * k, spin: 0,
      });
    }
    // the rest of the body comes out of the tray, a stream from the slot of each glyph
    const trayWaves = waves.filter((w) => w >= this.b0 - 0.42);
    for (const j of free) {
      const b = body[j]!;
      const cell = tray.cellOf(HFORM[b.ch] ?? b.ch);
      const seed = n++;
      const wish = landAt(b.x, seed);
      const early = wish - TURN - 0.08 - MIN_TRANSIT - DROP;
      const pop = Math.min(trayWaves[Math.floor(hash(seed, 12) * trayWaves.length)]! + hash(seed, 13) * 0.03, early);
      this.sorts.push({
        kind: 'tray', face: atlas.of(b.ch, W_BODY), hole: -1,
        sx: cell.x, sy: cell.y, sa: 0, ss: tray.s - 6, tx: b.x, ty: b.y, ts: b.size,
        pop, ...timing(pop, wish, latest(b.x), seed),
        ...base(seed), h: 60 + 160 * hash(seed, 1), dx: (hash(seed, 2) - 0.5) * 60, dy: -20 - 50 * hash(seed, 3),
      });
    }

    // the scene
    const N = this.sorts.length;
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(N), 1));
      geo.setAttribute('aInk', new THREE.InstancedBufferAttribute(new Float32Array(N), 1));
      const m = new THREE.InstancedMesh(geo, mat, N);
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    };
    this.paper = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.1, H * 1.1), this.gl.paper);
    this.print = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.1, H * 1.1), this.gl.print);
    this.bed = new THREE.Mesh(new THREE.PlaneGeometry(W + 2 * BED_PAD, H + 2 * BED_PAD), this.gl.bed);
    this.bed.position.z = BED_Z;
    this.holeMesh = inst(new THREE.PlaneGeometry(1, 1), this.gl.hole);
    this.sortMesh = inst(new THREE.BoxGeometry(1, 1, 1), this.gl.sort);
    this.shadowMesh = inst(new THREE.PlaneGeometry(1, 1), this.gl.shadow);
    this.roller = new THREE.Mesh(new THREE.CylinderGeometry(ROLLER_R, ROLLER_R, H + 300, 40), this.gl.roller);
    this.roller.position.z = BED_Z + TYPE_HIGH + ROLLER_R;
    const cylLen = H + 500;
    this.cylinder = new THREE.Mesh(new THREE.CylinderGeometry(CYL_R, CYL_R, cylLen, 64), this.gl.cylinder);
    this.cylinder.position.z = BED_Z + TYPE_HIGH + CYL_R;
    this.gl.cylinder.uniforms.uHalf!.value = cylLen / 2 - 70;
    // the printed sheet goes over the forme, the cylinder over the sheet
    this.print.renderOrder = 10;
    this.cylinder.renderOrder = 11;
    this.scene.add(this.paper, this.print, this.bed, this.roller, this.cylinder);
    for (const o of [this.paper, this.print, this.bed, this.roller, this.cylinder]) o.frustumCulled = false;

    // the forme's fixed parts: the brass rules of the broadsheet, its furniture, the seal block
    const u = this.gl.bed.uniforms;
    (u.uSheet!.value as THREE.Vector4).set(...SHEET);
    const rules: [number, number, number, number][] = [
      [BODY_X[0], TIERS[0]! - 8, 1770 - BODY_X[0], 3],
      ...TIERS.slice(1).map((y): [number, number, number, number] => [BODY_X[0], y - 4, BODY_X[1] - BODY_X[0], 2]),
      [BODY_X[0], TIERS[5]! + TIER + 4, 1770 - BODY_X[0], 3],
      [1646, TIERS[0]!, 2, TIERS[5]! + TIER - TIERS[0]!],
      [1662, 640, 92, 2],
    ];
    rules.forEach((r, i) => (u.uRules!.value as THREE.Vector4[])[i]!.set(...r));
    u.uNRules!.value = rules.length;
    RESERVED.forEach((r, i) => (u.uFurn!.value as THREE.Vector4[])[i]!.set(...r));
    (u.uTierX!.value as THREE.Vector2).set(...BODY_X);
    (u.uSeal!.value as THREE.Vector3).set(MAST.x, MAST.sealY, MAST.sealR);
    u.uSealCell!.value = atlas.of('神', W_MAST);
    // compile every material against a render target and upload the atlas now: lazily on the first pop it would drop frames
    this.ctx.renderer.initTexture(atlas.tex);
    const tiny = makeRT(1, 1);
    this.holeMesh.count = 1;
    this.sortMesh.count = 1;
    this.shadowMesh.count = 1;
    this.ctx.renderer.render(this.scene, this.cam);
    this.holeMesh.count = 0;
    this.sortMesh.count = 0;
    this.shadowMesh.count = 0;
    tiny.dispose();
  }

  /** The bed's shift right of its place (frame px): one smooth glide from off the frame to home. */
  private shift(t: number): number {
    const far = W + 2 * BED_PAD + 40;
    const u = clamp01((t - this.bs) / (this.be - this.bs));
    return far * (1 - (0.5 - 0.5 * Math.cos(Math.PI * u)));
  }

  /**
   * Frame x of the impression cylinder's contact line: from the cut it rolls from x0 to x1 in CYL_T, fast over the
   * headline and slowing over the body; before the cut it comes in at the speed it starts with.
   */
  private contact(t: number): number {
    const span = this.x0 - this.x1;
    if (t < this.cut) return this.x0 + ((CYL_EXP * span) / CYL_T) * (this.cut - t);
    return this.x0 - span * (1 - (1 - clamp01((t - this.cut) / CYL_T)) ** CYL_EXP);
  }

  /** A sort hovering after its pop, at time t. */
  private hover(s: Sort, t: number, p: Pose) {
    const tau = Math.max(0, t - s.pop);
    const rise = clamp01(tau / 0.24);
    const lift = 1 + 2.4 * (rise - 1) ** 3 + 1.4 * (rise - 1) ** 2; // ease out with a little overshoot
    const z0 = s.kind === 'tray' ? BED_Z - TYPE_HIGH : 0;
    const drift = easeOut(clamp01(tau / 0.5));
    const [x, y] = worldAt(s.sx, s.sy, 0);
    p.x = x + s.dx * drift;
    p.y = y - s.dy * drift;
    p.z = z0 + (s.h - z0) * lift + 7 * Math.sin(tau * 7 + s.seed) * rise;
    p.rx = s.tr * Math.sin(tau * 5 + s.seed) * rise;
    // the sorts of the sheets rise face down and turn over
    p.ry = (s.kind === 'tray' ? 0 : Math.PI * (1 - easeInOut(clamp01((tau - 0.03) / 0.28)))) + s.tr * 0.6 * Math.cos(tau * 4 + s.seed) * rise;
    p.rz = -s.sa + 0.4 * s.tr * tau * (s.seed % 2 ? 1 : -1);
    p.s = s.ss;
  }

  /**
   * A sort in three parts: the hover after its pop (rise and turn over), the glide over its slot (at least
   * MIN_TRANSIT), and the drop onto the bed. All smooth: no stepping.
   */
  private pose(s: Sort, t: number, p: Pose) {
    if (t < s.dep) {
      this.hover(s, t, p);
      return;
    }
    const top = BED_Z + TYPE_HIGH;
    const bs = (s.ts * (D - top)) / D;
    if (t < s.arr) {
      const a = this.pa;
      this.hover(s, s.dep, a);
      const [bx, by] = worldAt(s.tx + this.shift(s.arr), s.ty, top);
      const u = (t - s.dep) / (s.arr - s.dep);
      const e = u * u * (3 - 2 * u);
      p.x = lerp(a.x, bx, e);
      p.y = lerp(a.y, by, e);
      p.z = lerp(a.z, s.zh, e) + 40 * Math.sin(Math.PI * u);
      p.rx = a.rx * (1 - e);
      p.ry = a.ry * (1 - e);
      p.rz = lerp(a.rz + 2 * Math.PI * s.spin, 0, e);
      p.s = lerp(a.s, bs, e);
      return;
    }
    // it falls: slow at first, fastest as it lands
    const u = clamp01((t - s.arr) / (s.land - s.arr));
    const [bx, by] = worldAt(s.tx + this.shift(t), s.ty, top);
    p.x = bx;
    p.y = by;
    p.z = BED_Z + (s.zh - BED_Z) * (1 - u * u);
    p.rx = 0;
    p.ry = 0;
    p.rz = 0;
    p.s = bs;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t;
    const gl = this.gl;
    const before = t < this.cut;
    gl.paper.uniforms.under!.value = f.under;

    // the bed, the ink roller, the quoins
    const shift = this.shift(t);
    const frontX = shift - BED_PAD;
    this.paper.visible = before;
    (gl.paper.uniforms.uSpan!.value as THREE.Vector2).set(-1e9, frontX - W / 2);
    this.bed.visible = shift < W + BED_PAD;
    this.bed.position.x = shift;
    const bu = gl.bed.uniforms;
    bu.uShift!.value = shift;
    const rollX = this.contact(t) - ROLL_LEAD;
    bu.uRoll!.value = rollX;
    bu.uQuoin!.value = easeOut(clamp01((t - this.q0) / 0.12));
    this.roller.visible = rollX < W + ROLLER_R * 2 && rollX > -ROLLER_R * 2;
    this.roller.position.x = rollX - W / 2;

    // the impression cylinder, the printed sheet behind it and the cylinder's shadow on the sheet
    const xc = this.contact(t);
    this.cylinder.visible = xc - CYL_R * 1.3 < W;
    const cx = worldAt(xc, H / 2, BED_Z + TYPE_HIGH)[0];
    this.cylinder.position.x = cx;
    gl.cylinder.uniforms.uTurn!.value = (this.x0 - xc) / CYL_R;
    this.print.visible = !before;
    // from the cylinder's axis: the cylinder covers the line where the sheet leaves it
    (gl.print.uniforms.uSpan!.value as THREE.Vector2).set(cx, 1e9);
    (gl.common.uShade!.value as THREE.Vector3).set(cx + CYL_R * 0.95, cx + CYL_R * 0.95 + 60, this.cylinder.visible ? 0.35 : 0);

    // the sorts, their holes and shadows
    let ns = 0, nh = 0, nd = 0;
    const p: Pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 0 };
    const cellS = this.sortMesh.geometry.getAttribute('aCell') as THREE.InstancedBufferAttribute;
    const inkS = this.sortMesh.geometry.getAttribute('aInk') as THREE.InstancedBufferAttribute;
    const cellH = this.holeMesh.geometry.getAttribute('aCell') as THREE.InstancedBufferAttribute;
    const modeH = this.holeMesh.geometry.getAttribute('aInk') as THREE.InstancedBufferAttribute;
    for (const s of this.sorts) {
      if (t < s.pop) continue;
      // the hole it left: under the bed once the bed is over it
      if (before && s.sx < frontX + (s.kind === 'tray' ? 0 : 20)) {
        const [hx0, hy0] = worldAt(s.sx, s.sy, 0);
        this.q.setFromAxisAngle(this.v.set(0, 0, 1), -s.sa);
        const side = s.kind === 'tray' ? s.ss + 2 : s.ss;
        this.m4.compose(this.v.set(hx0, hy0, s.kind === 'tray' ? 0.35 : 0.3), this.q, this.sv.set(side, side, 1));
        this.holeMesh.setMatrixAt(nh, this.m4);
        cellH.setX(nh, Math.max(0, s.hole));
        modeH.setX(nh, s.kind === 'tray' ? 1 : 0);
        nh++;
      }
      // under the printed sheet once the cylinder has passed
      if (!before && s.tx > xc + 20) continue;
      this.pose(s, t, p);
      this.e.set(p.rx, p.ry, p.rz, 'ZYX');
      this.q.setFromEuler(this.e);
      this.m4.compose(this.v.set(p.x, p.y, p.z + TYPE_HIGH / 2), this.q, this.sv.set(p.s, p.s, TYPE_HIGH));
      this.sortMesh.setMatrixAt(ns, this.m4);
      cellS.setX(ns, s.face);
      inkS.setX(ns, t >= s.land && rollX < s.tx ? 1 : 0);
      ns++;
      // its shadow, on the paper or on the bed
      if (p.z > BED_Z + 1) {
        const sxp = (p.x * D) / (D - p.z) + W / 2;
        const floor = sxp > frontX ? BED_Z + 0.4 : 0.4;
        const hgt = p.z - floor;
        this.q.setFromAxisAngle(this.v.set(0, 0, 1), p.rz);
        // a high light from the top left: the shadow falls a little right and down
        this.m4.compose(this.v.set(p.x + 0.35 * hgt, p.y - 0.43 * hgt, floor), this.q, this.sv.set(p.s, p.s, 1));
        this.shadowMesh.setMatrixAt(nd++, this.m4);
      }
    }
    for (const [m, c] of [[this.sortMesh, ns], [this.holeMesh, nh], [this.shadowMesh, nd]] as const) {
      m.count = c;
      m.visible = c > 0;
      m.instanceMatrix.needsUpdate = true;
    }
    for (const a of [cellS, inkS, cellH, modeH]) a.needsUpdate = true;

    // the camera is locked on the page
    this.cam.position.set(0, 0, D);
    this.cam.updateMatrixWorld(true);
    (gl.roller.uniforms.uCam!.value as THREE.Vector3).copy(this.cam.position);

    const r = this.ctx.renderer;
    clearRT(r, out, [0, 0, 0]);
    r.setRenderTarget(out);
    r.clearDepth();
    r.render(this.scene, this.cam);
  }

  override dispose() {
    this.gl.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
