// Era · the new script: fresh paper, fresh ink, fresh red. No copy loss.
// uP.x: how far the page has faded to the red substrate (0..1; the reverse bell of the intro of `original`).
import type { EraDef } from './_page';

export const SCRIPT: EraDef = {
  name: 'script',
  bleed: 0.3,
  glsl: /* glsl */ `
vec3 surface(vec2 p, vec2 warp) {
  vec4 c = tapL(p + warp);
  vec3 paper = S(240.0, 233.0, 216.0) * (0.98 + 0.02 * fbm(p * 0.008, 3));
  vec3 col = mix(S(18.0, 15.0, 13.0), paper, toneOf(c));
  col = mix(col, RED(), redOf(c));
  return mix(mix(col, SUB(p), 1.0 - clamp(c.a, 0.0, 1.0)), SUB(p), uP.x);
}`,
};
