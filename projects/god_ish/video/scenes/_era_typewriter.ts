// Era · Japanese typewriter: ribbon ink on bond paper. The ribbon's fabric shows in the strike (a fine weave),
// the ink fills in the counters (darks spread about a px, more with each copy) and lies unevenly (a slow wear
// field of the ribbon and the pressure of each strike, which the page carries as its gray). The grays are carbon:
// a soft, grainy neutral gray. Bare paper takes no ink.
// The dye code (magenta, DYE in _page.ts) prints the blue-violet dye of the carbon paper, grainy like the carbon
// gray; its coverage is how much the magenta stands above the green on the canvas.
import type { EraDef } from './_page';

export const TYPEWRITER: EraDef = {
  name: 'typewriter',
  bleed: 0.6,
  glsl: /* glsl */ `
float dyeOf(vec4 c) {
  if (c.a < 0.5) return 0.0;
  vec3 s = toSRGB(c.rgb);
  return clamp(min(s.r, s.b) - s.g, 0.0, 1.0);
}
vec3 surface(vec2 p, vec2 warp) {
  vec2 q = p + warp;
  vec4 c = tapL(q);
  float dye = dyeOf(c);
  float t = mix(toneOf(c), 1.0, dye), red = redOf(c), hole = 1.0 - clamp(c.a, 0.0, 1.0);
  vec3 paper = S(240.0, 237.0, 229.0) * (0.978 + 0.022 * fbm(p * 0.007, 3)) * (0.992 + 0.008 * hash12(floor(p / 2.0)));
  vec3 ink = S(24.0, 22.0, 22.0);
  vec3 carbon = S(64.0, 62.0, 61.0);
  float dark = 1.0 - t;
  // ribbon ink: the counters fill in, the darks spread (the dye does not)
  float fill = (1.0 - minTone(q, 0.8 + uGen * 0.05)) * (1.0 - dye);
  float solid = smoothstep(0.6, 0.86, max(dark, fill * 0.9));
  float weave = 0.5 + 0.5 * sin(p.x * 2.3) * sin(p.y * 2.3);
  float wear = 0.5 + 0.5 * fbm(p * 0.018 + 5.0, 3);
  float density = 0.78 + 0.12 * wear + 0.07 * weave + 0.15 * smoothstep(0.8, 1.0, dark);
  // carbon: soft grainy gray
  float g = 0.5 + 0.5 * fbm(p * 0.5 + 11.0, 2);
  float cv = clamp(dark * 1.25 - 0.35 * (g - 0.5) - 0.1 * hash12(floor(p)) - uGen * 0.004, 0.0, 1.0) * step(0.02, dark);
  vec3 col = mix(paper, carbon, cv * (1.0 - solid));
  col = mix(col, ink, solid * clamp(density, 0.0, 1.0));
  // the carbon dye: blue-violet, grainy as the carbon gray
  float dv = clamp(dye * 1.2 - 0.3 * (g - 0.5) - 0.08 * hash12(floor(p) + 3.0), 0.0, 1.0);
  col = mix(col, S(62.0, 44.0, 150.0), dv);
  col = mix(col, mix(paper, RED(), 0.95), red);
  return mix(col, SUB(p), hole);
}`,
};
