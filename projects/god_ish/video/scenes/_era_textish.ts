// Era · text-ish: everything fluent and nothing exact. Clean, smooth, a little too even: the paper has no fibre,
// only a soft mottle; corners and serifs melt into rounded, plausible shapes (a local blur, then a hard level,
// so edges stay sharp but every corner is rounded off), and the whole page sits on a slow warp so no line is
// quite straight. The red is flat. Both losses grow with the copies.
//   uP.x  rounding radius, px (corners melt; 0 = exact)
//   uP.y  page warp, px (slow, changes only on a copy)
//   uP.z  mottle of the paper, 0..1
//   uP.w  height of the exact strip at the bottom, px (the true small marks stay exact)
import type { EraDef } from './_page';

export const TEXTISH: EraDef = {
  name: 'textish',
  bleed: 0,
  glsl: /* glsl */ `
// the slow warp: fixed between copies (seeded by the generation, not by time)
vec2 drift(vec2 p) {
  vec2 q = p * 0.0021 + vec2(uGen * 1.37, uGen * 0.71);
  return vec2(fbm(q, 3) - 0.5, fbm(q + vec2(17.3, 5.9), 3) - 0.5) * 2.0 * uP.y;
}
// rounded level of one channel: blur over two rings, then a hard level between the local extremes
vec2 melt(vec2 p, float r) {
  vec4 c0 = tapL(p);
  float t0 = toneOf(c0), h0 = 1.0 - clamp(c0.a, 0.0, 1.0);
  float sum = t0, hs = h0, lo = t0, hi = t0, n = 1.0;
  for (int k = 0; k < 2; k++) {
    float rr = r * (k == 0 ? 0.5 : 1.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398 + float(k) * 0.392699;
      vec4 c = tapL(p + rr * vec2(cos(a), sin(a)));
      float tt = toneOf(c);
      sum += tt; hs += 1.0 - clamp(c.a, 0.0, 1.0); n += 1.0;
      lo = min(lo, tt); hi = max(hi, tt);
    }
  }
  float tb = sum / n, hb = hs / n;
  float span = hi - lo;
  float lev = span < 0.04 ? t0 : lo + span * smoothstep(0.32, 0.68, (tb - lo) / span);
  return r < 0.5 ? vec2(t0, h0) : vec2(lev, smoothstep(0.32, 0.68, hb));
}
vec3 surface(vec2 p, vec2 warp) {
  float exact = step(p.y, uP.w);
  vec2 q = p + (warp + drift(p)) * (1.0 - exact);
  vec2 m = melt(q, uP.x * (1.0 - exact));
  float t = m.x, hole = m.y;
  float mot = (fbm(p * 0.0016 + uGen * 0.13, 4) - 0.5) * uP.z;
  vec3 paper = S(238.0, 238.0, 235.0) * (1.0 + mot * 0.06);
  vec3 ink = S(22.0, 22.0, 27.0);
  vec3 col = mix(ink, paper, t);
  float red = redOf(tapL(q));
  col = mix(col, RED(), red);
  return mix(col, RED(), hole);
}`,
};
