// Era · movable type: crisp solid ink with a darker rim (squeeze), an uneven impression (pressure varies across
// the sheet, the ink thins where it is light), and grays as engraved lines. Bare paper takes no ink.
// uP.x: extra speckle of the solids (0 = the era's own, grows with uGen anyway).
// uP.y: 1 = grays print as starved ink (a mottle of the face that took ink), not as engraving.
// uP.z: px the ink spreads (the darks grow into the paper).
// uP.w: set-off (0..1): the facing sheet, mirrored left to right, leaves its wet ink faintly on bare paper.
import type { EraDef } from './_page';

export const PRESS: EraDef = {
  name: 'press',
  bleed: 0.5,
  glsl: /* glsl */ `
vec3 surface(vec2 p, vec2 warp) {
  vec4 c = tapL(p + warp);
  float t = toneOf(c), red = redOf(c), hole = 1.0 - clamp(c.a, 0.0, 1.0);
  if (uP.z > 0.0) t = min(t, minTone(p + warp, uP.z));
  vec3 paper = S(239.0, 232.0, 216.0) * (0.975 + 0.025 * fbm(p * 0.006, 3)) * (0.99 + 0.01 * hash12(floor(p / 2.0)));
  vec3 ink = S(20.0, 18.0, 16.0);
  float dark = 1.0 - t;
  float e = edgeAt(p + warp, 1.2);
  float isEdge = smoothstep(0.18, 0.42, e) * step(minTone(p + warp, 1.5), 0.15);
  float solid = max(smoothstep(0.62, 0.86, dark), isEdge * dark); // thin type antialiases to grays: keep its coverage as ink
  // pressure: a slow field across the sheet; where it is light the face prints starved
  float press = 0.5 + 0.5 * fbm(p * 0.0025 + 3.0, 2);
  float grain = fbm(p * 0.11 + 7.0, 3) * 0.5 + 0.5 + 0.22 * hash12(floor(p));
  float speck = step(0.97 - 0.1 * (1.0 - press) - uGen * 0.004 - uP.x, grain) * (1.0 - step(0.25, e));
  float inked = solid * (1.0 - speck) * (0.86 + 0.08 * press + 0.06 * step(0.25, e));
  // grays: engraved lines, or a starved mottle; none on bare paper
  float mottle = 0.55 * (fbm(p * 0.08 + 11.0, 3) * 0.5 + 0.5) + 0.45 * hash12(floor(p / 1.5));
  float gray = uP.y > 0.5 ? step(mottle, dark * 1.05) : engrave(p, dark, 0.22, 0.6);
  float lines = gray * step(0.04, dark) * (1.0 - solid);
  vec3 col = mix(paper, ink, max(inked, lines * (0.8 + 0.2 * press)));
  if (uP.w > 0.0) {
    vec4 m = tapL(vec2(RES.x - p.x, p.y) + vec2(4.0, -3.0) + warp);
    float so = (1.0 - toneOf(m)) * step(0.5, m.a) * step(0.95, t) * step(mottle, 0.75);
    col = mix(col, ink, so * uP.w * 0.2);
  }
  col = mix(col, mix(paper, RED(), 0.95 - 0.25 * speck), red);
  return mix(col, SUB(p), hole);
}`,
};
