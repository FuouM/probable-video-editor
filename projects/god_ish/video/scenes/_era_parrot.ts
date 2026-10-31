// Era · parrot: a quiet manuscript gloss. The vellum of the original, paler and smoother after many copies;
// the ink is thinner (it fades a little with each generation) and pools less; the rubric is the same vermilion.
// Grays are a dry wash, for the hairlines and bars of the margin.
import type { EraDef } from './_page';

export const PARROT: EraDef = {
  name: 'parrot',
  bleed: 0.9,
  glsl: /* glsl */ `
vec3 surface(vec2 p, vec2 warp) {
  vec4 c = tapL(p + warp);
  float t = toneOf(c), red = redOf(c), hole = 1.0 - clamp(c.a, 0.0, 1.0);
  float mott = 0.965 + 0.035 * fbm(p * 0.003, 4) + 0.015 * fbm(p * vec2(0.002, 0.03), 2);
  vec3 paper = S(238.0, 229.0, 208.0) * mott * (1.0 - 0.03 * step(0.998, hash12(floor(p / 3.0))));
  vec3 ink = S(42.0, 30.0, 22.0);
  vec3 verm = mix(RED(), S(200.0, 64.0, 36.0), 0.3);
  float e = edgeAt(p + warp, 1.2);
  float thin = 1.0 - 0.0025 * uGen;
  float dens = (0.88 + 0.12 * e) * (0.96 + 0.04 * fbm(p * 0.05 + uSeed, 2)) * thin;
  vec3 col = mix(paper, ink, (1.0 - t) * dens);
  col = mix(col, verm * (0.92 + 0.08 * e), red);
  col = mix(col, SUB(p), hole);
  return mix(col, ink, GRAIN(p) * 0.3 * (1.0 - hole));
}`,
};
