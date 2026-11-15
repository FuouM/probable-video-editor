// The glass of a 4:3 CRT in a lit room (see `litview.ts`):
//  - `CrtTube`: it shows the 16:9 picture of a view letterboxed in its middle rows, an optional title layer over it, and the tube
//    warming up (a bright line that opens into the picture). The result is a texture for the screen of the room.
//  - `plotGlassCrack`: the cracks of a hit on the glass, on a 640 x 360 layer.
// Everything here is a pure function of its arguments.
import * as THREE from 'three';
import { FSPass } from './gl';
import { LH, LW } from './lit';
import { TextLayer } from './textlayer';
import { hashSin } from './util';

/** The tube is 4:3 (640 x 480 texels) and shows the 640 x 360 picture in its middle rows. */
export const TUBE_W = 640;
export const TUBE_H = 480;
const BAR_ROWS = (TUBE_H - 360) / 2;

/**
 * The cracks of a hit on the glass, on a 640 x 360 layer: radial, jagged lines from the impact pixel `o` out past the edges, with a few
 * short branches and two broken rings near the centre. Plots only (the caller clears and commits the layer).
 */
export function plotGlassCrack(l: TextLayer, o: readonly [number, number]) {
  const hash = hashSin;
  const plot = (x: number, y: number, c: string) => { if (x >= 0 && y >= 0 && x < LW && y < LH) l.rect(x, y, 1, 1, c); };
  const seg = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) {
      const x = Math.round(x0 + ((x1 - x0) * k) / n), y = Math.round(y0 + ((y1 - y0) * k) / n);
      plot(x + 1, y + 1, '#10141c');
      plot(x, y, '#e8f2ff');
    }
  };
  const RAYS = 13;
  for (let i = 0; i < RAYS; i++) {
    let a = ((i + 0.35 * hash(i, 3)) / RAYS) * Math.PI * 2;
    let x = o[0], y = o[1];
    for (let s = 0; s < 40; s++) {
      const len = 10 + 16 * hash(i, s);
      a += (hash(i, s + 50) - 0.5) * 0.5;
      const nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
      seg(Math.round(x), Math.round(y), Math.round(nx), Math.round(ny));
      if (hash(i, s + 90) < 0.22) {
        const b = a + (hash(i, s + 7) < 0.5 ? -1 : 1) * (0.5 + 0.4 * hash(s, i));
        seg(Math.round(nx), Math.round(ny), Math.round(nx + Math.cos(b) * 14), Math.round(ny + Math.sin(b) * 14));
      }
      x = nx; y = ny;
      if (x < -10 || y < -10 || x > LW + 10 || y > LH + 10) break;
    }
  }
  for (const r of [9, 22]) {
    for (let i = 0; i < RAYS; i++) {
      if (hash(i, r) < 0.35) continue;
      const a0 = (i / RAYS) * Math.PI * 2, a1 = ((i + 1) / RAYS) * Math.PI * 2;
      const rr = r * (0.85 + 0.3 * hash(i, r + 1));
      seg(Math.round(o[0] + Math.cos(a0) * rr), Math.round(o[1] + Math.sin(a0) * rr), Math.round(o[0] + Math.cos(a1) * rr), Math.round(o[1] + Math.sin(a1) * rr));
    }
  }
}

/** The screen picture: the picture (or the title layer over it) letterboxed in the 4:3 tube, and the tube warming up. */
const COMP_FRAG = /* glsl */ `
uniform sampler2D uGame, uTitle;
uniform float uPower, uShow, uLinear, uFit, uFitE;
vec3 invAces(vec3 y) {
  y = min(y, vec3(0.9999));
  vec3 A = 2.43 * y - 2.51, B = 0.59 * y - 0.03, C = 0.14 * y;
  return (-B - sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);
}
// the engine's tone shoulder (the inverse of \`unshoulder\` of the output pass of LitView)
vec3 shoulder(vec3 x) {
  const float k = 0.72;
  return mix(x, k + (1.0 - k) * (1.0 - exp(-(x - k) / (1.0 - k))), step(k, x));
}
void main() {
  ivec2 p = ivec2(floor(vUv * vec2(${TUBE_W}.0, ${TUBE_H}.0)));
  ivec2 g = ivec2(p.x, p.y - ${BAR_ROWS});
  vec3 c = vec3(0.0);
  if (g.y >= 0 && g.y < 360) {
    // the picture is the 640 x 360 render at x3: its pixel centres are exact
    vec3 px = texture(uGame, (vec2(g) + 0.5) / vec2(640.0, 360.0)).rgb;
    c = mix(toLinear(px), px, uLinear) * uShow;
    // the picture of a finished render target is pre-shoulder: the engine's tone shoulder turns it into the displayed light
    vec3 lit = mix(shoulder(px), px, uLinear) * uShow;
    c = mix(c, invAces(lit) / uFitE, uFit);
    vec4 tx = texelFetch(uTitle, g, 0);
    c = mix(c, toLinear(tx.rgb), tx.a);
  }
  // the tube warms up: a bright line that opens into the picture
  float band = step(abs(vUv.y - 0.5) * 2.0, max(uPower, 0.008));
  c = c * band + vec3(0.9, 0.95, 1.0) * band * (1.0 - smoothstep(0.0, 0.3, uPower)) * 1.5;
  fragColor = vec4(c, 1.0);
}`;

/** How the tube shows its picture. Every field is given on each draw. */
export interface TubeOpts {
  /** The picture is already linear (`LitView.toScreen`), not display-encoded (a finished render target). */
  linear: boolean;
  /** A layer over the picture (a title screen), or null for none. */
  title: THREE.Texture | null;
  /** 0..1: how far the tube has opened from its white line (1: open). */
  power: number;
  /** 0..1: the picture's strength (0 shows the title alone). */
  show: number;
  /**
   * The room view's output pass applies ACES at `exposure` to the screen. With `weight` 1 the picture is written through the inverse of that curve,
   * so that a room view that fills the frame at that exposure (and no bloom) shows the picture exactly. 0 shows it as it is. Ramp the weight with the push.
   */
  fit: { weight: number; exposure: number };
}

/** The tube fully open, the picture at full strength, no title and no fit. */
export const TUBE_PLAIN: TubeOpts = { linear: false, title: null, power: 1, show: 1, fit: { weight: 0, exposure: 1 } };

export class CrtTube {
  /** The glass texture: give it to the screen material of the room. */
  readonly screen = new THREE.WebGLRenderTarget(TUBE_W, TUBE_H, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false,
  });
  private comp = new FSPass(COMP_FRAG, {
    uGame: { value: null }, uTitle: { value: null }, uPower: { value: 1 }, uShow: { value: 1 }, uLinear: { value: 0 }, uFit: { value: 0 }, uFitE: { value: 1 },
  });
  /** The empty layer: it stands for `title: null`. */
  private none = new TextLayer();

  constructor() { this.none.commit(); }

  draw(renderer: THREE.WebGLRenderer, game: THREE.Texture, o: TubeOpts) {
    const { title, power, show, linear, fit } = o;
    const u = this.comp.u;
    u.uGame!.value = game;
    u.uTitle!.value = title === null ? this.none.tex : title;
    u.uPower!.value = power;
    u.uShow!.value = show;
    u.uLinear!.value = linear ? 1 : 0;
    u.uFit!.value = fit.weight;
    u.uFitE!.value = fit.exposure;
    this.comp.render(renderer, this.screen);
  }

  dispose() {
    this.screen.dispose();
    this.comp.dispose();
    this.none.dispose();
  }
}
