// Era · screen and repost: lit pixels. A 640x360 panel (3 logical px a pixel, a 1 px dark gap between lit
// cells), flat backlight. The JPEG re-saves after this pass (SurfaceOpts.jpeg) make the loss; the lattice is
// what the blocks break first.
// uP.x: lattice depth (0 = default 0.14). uP.y: how far the panel has faded to the red substrate (0..1; tiny, into gott2).
import type { EraDef } from './_page';

export const SCREEN: EraDef = {
  name: 'screen',
  bleed: 0,
  glsl: /* glsl */ `
vec3 surface(vec2 p, vec2 warp) {
  // sample the page at the centre of the panel pixel: the page is shown at the panel's resolution
  vec2 cell = floor(p / 3.0);
  vec4 c = tapL(cell * 3.0 + 1.5 + warp);
  vec3 col = mix(S(14.0, 14.0, 16.0), S(246.0, 246.0, 243.0), toneOf(c));
  col = mix(col, RED(), max(redOf(c), 1.0 - clamp(c.a, 0.0, 1.0)));
  vec2 g = step(2.0, mod(p, 3.0));
  float depth = (uP.x > 0.0 ? uP.x : 0.14) * (1.0 - uP.y);
  return col * (1.0 - depth * max(g.x, g.y));
}`,
};
