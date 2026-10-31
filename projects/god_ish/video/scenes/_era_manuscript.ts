// Era · manuscript: vellum, iron-gall ink that pools at the stroke edges, vermilion rubric, washes for grays.
import type { EraDef } from './_page';

export const MANUSCRIPT: EraDef = {
  name: 'manuscript',
  bleed: 1.4,
  glsl: /* glsl */ `
vec3 surface(vec2 p, vec2 warp) {
  vec4 c = tapL(p + warp);
  float t = toneOf(c), red = redOf(c), hole = 1.0 - clamp(c.a, 0.0, 1.0);
  float mott = 0.95 + 0.05 * fbm(p * 0.004, 4) + 0.025 * fbm(p * vec2(0.002, 0.03), 2);
  vec3 paper = S(233.0, 221.0, 196.0) * mott * (1.0 - 0.05 * step(0.997, hash12(floor(p / 3.0))));
  vec3 ink = S(34.0, 22.0, 14.0);
  vec3 verm = mix(RED(), S(200.0, 64.0, 36.0), 0.35);
  float e = edgeAt(p + warp, 1.6);
  float dens = (0.86 + 0.14 * e) * (0.94 + 0.06 * fbm(p * 0.05 + uSeed, 2));
  vec3 col = mix(paper, ink, (1.0 - t) * dens);
  col = mix(col, verm * (0.9 + 0.1 * e), red);
  col = mix(col, SUB(p), hole);
  return mix(col, ink, GRAIN(p) * 0.4 * (1.0 - hole));
}`,
};
