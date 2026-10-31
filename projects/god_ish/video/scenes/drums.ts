// Transition plate 3 → 4 (entries → riso; video.json `transitions`, id drums): the four drums of the risograph
// print across the frame. An Over transition that ends on the cut. A group of four bands (yellow, pink, blue, black,
// each trailing the one before it) sweeps from the left to the right in hard steps of 12 fps. In front of the bands
// is the entries page, as it plays. Behind them is the first frame of riso (the plate as it shows on the cut,
// rendered once), so the page is replaced as the bands pass and the last band leaves the frame on the cut.
// The bands are printed by the riso plate itself, with its page code (riso-drums.ts), its surface pass
// (_era_riso.ts) and its drum motion (`drumReact`), on every frame, so they have its inks, screens and slip, the
// yellow is knocked out around the pink, and the grain boils at the same rates (seed 12 fps, grain 8 fps).
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { FSPass, H, makeRT, W } from '@pve/engine/gl';
import { stepN } from '@pve/engine/util';
import { copyTimes, genAt, PageScene, POST, type SurfaceOpts } from './_page';
import { RISO } from './_era_riso';
import { Drums as DrumSet, ink } from './riso-drums';
import { drumReact } from './riso';
/** The steps of the sweep (fps; a divisor of the 24 fps of the page), and how wide each band is (px). */
const FPS = 12;
const GAP = 120;
/** Where the first band's leading edge is at 1: the last band has left the frame. */
const REACH = W + 4 * GAP;
/** The slip of a drum can lay ink this far outside its band (px). */
const PAD = 8;
/** The unprinted margin at the foot of the riso sheet (px, see `margin` in _era_riso.ts). */
const MARGIN = 60;

/** The four bands as a riso print: one page of the plate's code, drawn by the drums. */
class Bands extends PageScene {
  /** The leading edge of the first (yellow) band, frame px. */
  edge = 0;
  private drums = new DrumSet();
  private copies: number[] = [];

  override async init() {
    await super.init();
    this.warm([RISO]);
    this.copies = copyTimes(this.ctx.lyrics);
  }

  draw(c: CanvasRenderingContext2D, f: Frame): SurfaceOpts {
    const d = this.drums;
    d.begin(c);
    const x = (k: number) => this.edge - k * GAP;
    c.fillStyle = ink('yellow');
    c.fillRect(x(1), 0, GAP, H);
    c.fillStyle = ink('pink');
    c.fillRect(x(2), 0, GAP, H);
    c.fillStyle = ink('blue');
    c.fillRect(x(3), 0, GAP, H);
    d.black.fillStyle = '#ffffff';
    d.black.fillRect(x(4), 0, GAP, H);
    d.end(c);
    // the state of the plate on its first line: one pass (copy) made
    return { era: RISO, gen: genAt(this.copies, this.ctx.lyrics, f.t), reg: 1.5 + 2, p: [1, 0, 0, 0] };
  }

  protected override react(f: Frame, o: SurfaceOpts): [number, number, number, number] {
    return drumReact(this.ctx.audio, f.t, 0.5, o.p?.[0] ?? 0);
  }
}

const FRAG = /* glsl */ `
uniform sampler2D under;   // entries, as it plays
uniform sampler2D next;    // riso on the cut
uniform sampler2D printed; // the four bands, printed
uniform float uEdge;       // frame px: the leading edge of the first band; -1: after the cut
const float GAP = ${GAP.toFixed(1)};
const float PAD = ${PAD.toFixed(1)};
// the riso sheet leaves its foot unprinted (the marks margin): the bands are taken from above it, stretched down
const float MARGIN = ${MARGIN.toFixed(1)};
const float H = ${H.toFixed(1)};
void main() {
  float x = FRAG_PX.x;
  vec3 col;
  if (uEdge < 0.0 || x >= uEdge + PAD) col = texture(under, vUv).rgb;
  else if (x >= uEdge - 4.0 * GAP - PAD) col = texture(printed, vec2(vUv.x, (MARGIN + vUv.y * (H - MARGIN)) / H)).rgb;
  else col = texture(next, vUv).rgb;
  fragColor = vec4(col, 1.0);
}`;

export default class Drums extends Scene {
  override handlesTransition = true;
  private pass!: FSPass;
  private next = makeRT();
  private printed = makeRT();
  private bands!: Bands;
  private cut = 0;

  override async init() {
    const pr = this.ctx.params;
    if (typeof pr.at !== 'number') throw new Error('drums: no resolved at');
    this.cut = pr.at;
    this.pass = new FSPass(FRAG, {
      under: { value: null }, next: { value: this.next.texture }, printed: { value: this.printed.texture }, uEdge: { value: 0 },
    });
    // riso itself, the page the bands uncover: rendered on every frame via ctx.renderClip, so its paper and grain
    // boil as they do on the plate (a frame rendered once would hold the grain still)
    this.bands = new Bands({ ...this.ctx, id: 'drums-bands', params: {}, start: this.ctx.start, end: this.ctx.end });
    await Promise.all([this.ctx.ensureClip('riso'), this.bands.init()]);
    // compile the pass now: on the first frame of the transition it would stall it
    const tiny = new THREE.WebGLRenderTarget(1, 1);
    this.pass.render(this.ctx.renderer, tiny);
    tiny.dispose();
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    if (!f.under) throw new Error('drums: nothing under the transition');
    const u = this.pass.u;
    u.under!.value = f.under;
    if (f.t >= this.cut) {
      // on the cut and after it the transition is out of the way: riso plays under it
      u.uEdge!.value = -1;
    } else {
      this.ctx.renderClip('riso', f.t, this.next, f.dt);
      // the steps are on the global grid of 12 fps, so a step always starts a new step of the page (24 fps): the
      // print is redrawn exactly when the bands move
      const n = Math.max(1, Math.round((this.cut - this.ctx.start) * FPS));
      const s = Math.min(1, Math.max(0, (stepN(f.t, FPS) - (stepN(this.cut, FPS) - n)) / n));
      this.bands.edge = s * REACH;
      this.bands.render(f, this.printed);
      u.uEdge!.value = this.bands.edge;
    }
    this.pass.render(this.ctx.renderer, out);
    return POST;
  }

  override dispose() {
    this.pass.dispose();
    this.next.dispose();
    this.printed.dispose();
    this.bands.dispose();
  }
}
