// Transition plate 6 → 7 (bored → tiny; video.json `transitions`, id theme): the theme of the screen is switched from
// dark to light across the cut, inside both plates, in a snap of 6 steps of 24 fps (0.25 s). An Over transition that
// is as long before the cut as after it. One S curve p runs from 0 (dark) to 1 (light) and stands at 0.5 on the cut.
// Before the cut bored (dark) is moved along it, after the cut tiny (light) is moved along it from the other end, so
// the grays of both plates are at the same mid gray on the cut and the cut does not show. Each gray goes to its
// opposite (the dark panels become light, the light text dark), and a colour that is not a gray keeps its hue (the
// red of the beam, the badges, the NEW divider). The layout does not move.
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { FSPass } from '@pve/engine/gl';
import { clamp, stepN } from '@pve/engine/util';
import { POST } from './_page';

/** Steps of the switch (24 fps, the step of the page), half of them before the cut and half after it. */
const FPS = 24;
const STEPS = 6;

/** The S curve: slow at both ends, fast on the cut (smootherstep). */
const curve = (x: number) => {
  const t = clamp(x);
  return t * t * t * (t * (6 * t - 15) + 10);
};

const FRAG = /* glsl */ `
uniform sampler2D under;   // bored before the cut, tiny after it
uniform float uTheme;      // p: 0 dark .. 1 light
uniform float uAfter;      // 1 after the cut
void main() {
  vec3 c = texture(under, vUv).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  // grays flip, colours keep their hue
  float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  float w = 1.0 - smoothstep(0.12, 0.35, sat);
  // bored is dark and goes to light with p; tiny is light and comes from dark: its lightness at p is bored's at 1 - p
  float lum2 = uAfter > 0.5 ? mix(1.0 - lum, lum, uTheme * w + (1.0 - w)) : mix(lum, 1.0 - lum, uTheme * w);
  fragColor = vec4(clamp(c + (lum2 - lum), 0.0, 1.0), 1.0);
}`;

export default class Theme extends Scene {
  override handlesTransition = true;
  private pass!: FSPass;
  private cut = 0;

  override async init() {
    const pr = this.ctx.params;
    if (typeof pr.at !== 'number') throw new Error('theme: no resolved at');
    this.cut = pr.at;
    this.pass = new FSPass(FRAG, { under: { value: null }, uTheme: { value: 0 }, uAfter: { value: 0 } });
    // compile the pass now: on the first frame of the transition it would stall it
    const tiny = new THREE.WebGLRenderTarget(1, 1);
    this.pass.render(this.ctx.renderer, tiny);
    tiny.dispose();
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    if (!f.under) throw new Error('theme: nothing under the transition');
    const u = this.pass.u;
    u.under!.value = f.under;
    // in steps: the last step of bored and the first of tiny are both at p = 0.5
    const j = stepN(f.t, FPS) - stepN(this.cut, FPS);
    const before = f.t < this.cut;
    u.uTheme!.value = curve(0.5 + (before ? Math.min(j, -1) + 1 : j) / STEPS);
    u.uAfter!.value = before ? 0 : 1;
    this.pass.render(this.ctx.renderer, out);
    return POST;
  }

  override dispose() {
    this.pass.dispose();
  }
}
