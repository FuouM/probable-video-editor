// Era · modernist offset: flat paper, a crisp black plate, grays in a 45° dot screen, the red plate off register.
// Copy loss (uGen above uP.x, the generation the plate starts at): each copy re-screens the screen, so a second
// screen, a little finer and turned, beats against the first (moiré) and the dots gain. uReg moves the red plate.
import type { EraDef } from './_page';

export const MODERN: EraDef = {
  name: 'modern',
  bleed: 0,
  glsl: /* glsl */ `
vec3 surface(vec2 p, vec2 warp) {
  vec4 c = tapL(p + warp);
  float hole = 1.0 - clamp(c.a, 0.0, 1.0);
  // red is its own plate: the black plate sees paper where the page is red
  float t = mix(toneOf(c), 1.0, redOf(c));
  float dark = 1.0 - t;
  vec3 paper = S(242.0, 240.0, 234.0) * (0.99 + 0.01 * fbm(p * 0.003, 2));
  vec3 ink = S(18.0, 18.0, 20.0);
  // line art (type, rules: an edge next to a solid) prints with smooth anti-aliased coverage; flat grays go to the dot screen
  float line = smoothstep(0.22, 0.45, edgeAt(p + warp, 1.5)) * step(minTone(p + warp, 1.5), 0.08);
  float k = dark > 0.97 ? 1.0 : mix(halftoneDots(p, 5.0, 0.785, dark), dark, line);
  float m = clamp((uGen - uP.x) * 0.06, 0.0, 0.6);
  float k2 = dark > 0.97 ? 1.0 : mix(halftoneDots(p, 4.7, 0.895, dark), dark, line);
  k = mix(k, max(k, k2), m) * step(0.02, dark); // bare paper takes no ink
  vec3 col = mix(paper, ink, k);
  // the red plate, printed over the black, off register by uReg px
  float rp = redOf(tapL(p + warp + vec2(uReg, -uReg * 0.6)));
  col = mix(col, RED(), rp * (1.0 - k * 0.55));
  col = mix(col, SUB(p), hole);
  return mix(col, ink, GRAIN(p) * 0.25 * (1.0 - hole));
}`,
};
