// Era · risograph: four spot drums (fluorescent pink, yellow, medium blue, black) of soy ink on off-white paper.
// The riso plate is the one plate with colours beyond red; red keeps its meaning: it is only ever the substrate,
// seen through holes. The page code (see riso-drums.ts), where alpha > 0.5: r = pink coverage, g = yellow, b =
// blue, black = (1 - alpha) * 4. Alpha 0 = a hole onto red; copies close holes slowly. Pink never overprints
// yellow (that mix is the red's orange): the yellow is knocked out wherever pink lies within 0.7 uReg + 10 px
// (wider than the drums slip, so paper shows between them).
// Each drum is its own pass: its own misregistration (uReg px, along its own slip, plus a jitter per copy and a
// hair of skew), its own screen angle for tints, its own grain, ink density, top-edge starve in large solids and
// drum banding. Inks are transparent: they multiply (pink over blue is purple). Paper shows through the grain.
// Two roller tracks scuff the sheet along the feed. The bottom margin is outside the print area: only the black
// marks print there, sharp and on register, so GEN and the time stay legible.
// uP.x: copies made on this plate. uP.y: px the sheet jumps in the feed (the kick): the colour drums take all of
// it, the black drum a third, so the key plate visibly parts from the colours. uP.z: px the pink drum slips on
// its own (the snare, ぽいじゃん). uP.w: the ink flood of a hit (0..1): denser ink, fuller solids.
import type { EraDef } from './_page';

export const RISO: EraDef = {
  name: 'riso',
  bleed: 0.7,
  glsl: /* glsl */ `
// the four drum coverages at x: (pink, yellow, blue, black)
vec4 drumsAt(vec2 x) {
  vec4 c = tapL(x);
  return c.a > 0.5 ? vec4(toSRGB(c.rgb), clamp((1.0 - c.a) * 4.0, 0.0, 1.0)) : vec4(0.0);
}
// 1 inside a large solid of drum m: four taps at r all inked
float solidOf(vec2 x, float r, vec4 m) {
  float s = dot(drumsAt(x + vec2(r, 0.0)), m);
  s = min(s, dot(drumsAt(x - vec2(r, 0.0)), m));
  s = min(s, dot(drumsAt(x + vec2(0.0, r)), m));
  return min(s, dot(drumsAt(x - vec2(0.0, r)), m));
}
// the pink within the knockout radius of x: two rings of 12 taps and the centre
float pinkNear(vec2 x) {
  float r = 0.7 * uReg + 10.0 + uP.z;
  float k = drumsAt(x).r;
  for (int i = 0; i < 12; i++) {
    vec2 u = vec2(cos(float(i) * 0.5235988), sin(float(i) * 0.5235988));
    k = max(k, max(drumsAt(x + u * r * 0.5).r, drumsAt(x + u * r).r));
  }
  return k;
}
// one drum pass: 1 where this drum lays ink at p
float pass(vec2 p, vec2 x, vec4 m, float ang, float id, float dens) {
  float k = dot(drumsAt(x), m);
  // the yellow drum: knocked out around the pink
  if (m.g > 0.5 && k > 0.004) k *= 1.0 - pinkNear(x);
  float speck = step(0.99975, hash12(floor(p / 2.0) + uGrainF * 3.7 + id * 17.0));
  if (k < 0.004) return speck;
  float s = solidOf(x, 14.0, m);
  float top = 1.0 - dot(drumsAt(x + vec2(0.0, 30.0)), m);
  float mott = fbm(p * 0.010 + id * 7.3, 2);
  float band = fbm(vec2(p.x * 0.0025, p.y * 0.035) + id * 3.1, 2);
  float d = dens + 0.05 * uP.w - 0.09 * (mott + 0.5) - s * (0.05 + 0.12 * smoothstep(-0.2, 0.3, band) + 0.2 * top) * (1.0 - 0.7 * uP.w) - 0.006 * uP.x;
  // a tint is screened into dots at the drum's angle; a solid stays solid
  float scr = k > 0.97 ? 1.0 : halftoneDots(x, 7.0, ang, k);
  float n = hash12(floor(p / 1.5) + id * 41.7 + floor(uSeed) * 1.37);
  return max(step(n, scr * d), speck);
}
// where drum id sits on this copy: its own slip with the copies, a jitter per copy, a hair of skew
vec2 offOf(vec2 p, vec2 dir, float id) {
  float c = floor(uP.x);
  vec2 jit = vec2(hash12(vec2(c, id)), hash12(vec2(id, c + 5.0))) * 2.0 - 1.0;
  return uReg * dir + jit * min(uReg, 3.0) + vec2(0.0, (p.x - 960.0) * uReg * 0.0002 * (id - 1.5));
}
vec3 surface(vec2 p, vec2 warp) {
  vec2 q = p + warp;
  float margin = step(p.y, 60.0);
  vec3 paperC = S(241.0, 237.0, 225.0);
  vec3 paper = paperC * (0.975 + 0.025 * fbm(p * 0.02 + 1.0, 2));
  // roller tracks along the feed: faint gray scuffs, broken
  float track = smoothstep(6.0, 1.0, abs(p.x - 520.0)) + smoothstep(6.0, 1.0, abs(p.x - 1400.0));
  paper *= 1.0 - 0.07 * track * step(0.15, fbm(vec2(p.x * 0.3, p.y * 0.006) + floor(uP.x) * 1.7, 2));

  vec3 col = paper;
  if (margin > 0.5) {
    // outside the print area: the marks only, crisp
    col *= mix(vec3(1.0), S(40.0, 38.0, 44.0) / paperC, smoothstep(0.25, 0.6, drumsAt(p).w));
  } else {
    vec2 feed = vec2(0.0, uP.y);
    float cy = pass(p, q + feed + offOf(p, vec2(0.35, -0.75), 1.0), vec4(0.0, 1.0, 0.0, 0.0), 0.26, 1.0, 0.95);
    float cp = pass(p, q + feed + offOf(p, vec2(0.8, -0.6), 0.0) + vec2(0.8, -0.6) * uP.z, vec4(1.0, 0.0, 0.0, 0.0), 1.31, 0.0, 0.97);
    float cb = pass(p, q + feed + offOf(p, vec2(0.25, 0.95), 2.0), vec4(0.0, 0.0, 1.0, 0.0), 0.79, 2.0, 0.96);
    float ck = pass(p, q + feed * 0.33 + offOf(p, vec2(-0.3, 0.2), 3.0) * 0.2, vec4(0.0, 0.0, 0.0, 1.0), 0.0, 3.0, 0.98);
    col *= mix(vec3(1.0), S(255.0, 232.0, 0.0), cy);
    col *= mix(vec3(1.0), S(255.0, 72.0, 176.0), cp);
    col *= mix(vec3(1.0), S(50.0, 85.0, 164.0), cb);
    col *= mix(vec3(1.0), S(40.0, 38.0, 44.0) / paperC, ck);
  }
  // a hole stays open where it is wider than the copies have closed it
  return mix(col, SUB(p), holeAt(q, 0.6 + 0.05 * uP.x));
}`,
};
