// A real JPEG re-save on the GPU, without the entropy coder: 8x8 DCT of the luma, 4:2:0 chroma (16x16 px
// blocks), quantization with the baseline tables at a quality, inverse DCT. Four separable passes of 8 taps.
// `passes` re-saves run in one frame, each with the block grid shifted, so the loss compounds as it does when a
// picture is cropped and saved again. No state between frames: any frame renders alone.
// After ../video-refs/rtjpeg (MIT), which does the same in one WebGPU compute pass.
import * as THREE from 'three';
import { FSPass, H, makeRT, W } from './gl';

const QL = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const QC = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, ...Array<number>(32).fill(99)];
const arr = (a: number[]) => `float[64](${a.map((v) => v.toFixed(1)).join(',')})`;

const HEAD = /* glsl */ `
uniform sampler2D tex;
uniform vec2 uOff;       // block grid offset, logical px (whole numbers)
uniform float uQ;        // quantization table scale (quality 50 = 1)
uniform float uInFrame;  // 1: tex is the 1920x1080 frame (clamped at its edges), else a padded intermediate
uniform float uOutFrame; // 1: this pass writes the 1920x1080 frame, else a padded intermediate
const float QL[64] = ${arr(QL)};
const float QC[64] = ${arr(QC)};
// The intermediates are the frame with PAD px on every side, so the blocks at the edges (shifted grid, partial
// 16 px chroma blocks) read replicated edge pixels, as a real encoder pads, instead of missing coefficients.
const float PAD = 16.0;
const vec2 RES = vec2(1920.0, 1080.0);
const vec2 PRES = RES + 2.0 * PAD;
// pixel index in the padded, shifted grid
vec2 LP() { return floor(FRAG_PX + uOutFrame * PAD - uOff); }
vec4 at(vec2 q) {
  vec2 P = q + uOff;
  return uInFrame > 0.5 ? texture(tex, (P - PAD + 0.5) / RES) : texture(tex, (P + 0.5) / PRES);
}
float Ck(float k) { return k < 0.5 ? 0.70710678 : 1.0; }
float cosT(float x, float k) { return cos((2.0 * x + 1.0) * k * PI / 16.0); }
vec3 ycc(vec3 lin) {
  vec3 s = toSRGB(clamp(lin, 0.0, 1.0)) * 255.0;
  return vec3(dot(s, vec3(0.299, 0.587, 0.114)) - 128.0,
              dot(s, vec3(-0.168736, -0.331264, 0.5)),
              dot(s, vec3(0.5, -0.418688, -0.081312)));
}
float quant(float v, float q) { q = max(1.0, floor(q * uQ + 0.5)); return floor(v / q + 0.5) * q; }
`;

// 1 · forward DCT along rows. Luma per pixel; chroma per 2x2 sample (each of the 4 px holds the sample's value).
const FWD_ROW = HEAD + /* glsl */ `
void main() {
  vec2 p = LP();
  float n = mod(p.x, 8.0), bx = p.x - n;
  float Y = 0.0;
  for (int i = 0; i < 8; i++) { float x = float(i); Y += ycc(at(vec2(bx + x, p.y)).rgb).x * cosT(x, n); }
  vec2 s = floor(p / 2.0);
  float m = mod(s.x, 8.0), cbx = s.x - m;
  vec2 C = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    float x = float(i);
    vec2 q = vec2(2.0 * (cbx + x), 2.0 * s.y);
    vec3 avg = (at(q).rgb + at(q + vec2(1.0, 0.0)).rgb + at(q + vec2(0.0, 1.0)).rgb + at(q + vec2(1.0, 1.0)).rgb) * 0.25;
    C += ycc(avg).yz * cosT(x, m);
  }
  fragColor = vec4(Y * 0.5 * Ck(n), C * 0.5 * Ck(m), 1.0);
}`;

// 2 · forward DCT along columns, then quantize: each pixel holds coefficient (k, l) of its block.
const FWD_COL = HEAD + /* glsl */ `
void main() {
  vec2 p = LP();
  float l = mod(p.y, 8.0), by = p.y - l, k = mod(p.x, 8.0);
  float Y = 0.0;
  for (int i = 0; i < 8; i++) { float y = float(i); Y += at(vec2(p.x, by + y)).x * cosT(y, l); }
  Y = quant(Y * 0.5 * Ck(l), QL[int(l) * 8 + int(k)]);
  vec2 s = floor(p / 2.0);
  float lm = mod(s.y, 8.0), cby = s.y - lm, km = mod(s.x, 8.0);
  vec2 C = vec2(0.0);
  for (int i = 0; i < 8; i++) { float y = float(i); C += at(vec2(2.0 * s.x, 2.0 * (cby + y))).yz * cosT(y, lm); }
  C *= 0.5 * Ck(lm);
  float qc = QC[int(lm) * 8 + int(km)];
  fragColor = vec4(Y, quant(C.x, qc), quant(C.y, qc), 1.0);
}`;

// 3 · inverse DCT along columns.
const INV_COL = HEAD + /* glsl */ `
void main() {
  vec2 p = LP();
  float j = mod(p.y, 8.0), by = p.y - j;
  float Y = 0.0;
  for (int i = 0; i < 8; i++) { float l = float(i); Y += 0.5 * Ck(l) * at(vec2(p.x, by + l)).x * cosT(j, l); }
  vec2 s = floor(p / 2.0);
  float jm = mod(s.y, 8.0), cby = s.y - jm;
  vec2 C = vec2(0.0);
  for (int i = 0; i < 8; i++) { float l = float(i); C += 0.5 * Ck(l) * at(vec2(2.0 * s.x, 2.0 * (cby + l))).yz * cosT(jm, l); }
  fragColor = vec4(Y, C, 1.0);
}`;

// 4 · inverse DCT along rows, back to linear RGB.
const INV_ROW = HEAD + /* glsl */ `
void main() {
  vec2 p = LP();
  float i0 = mod(p.x, 8.0), bx = p.x - i0;
  float Y = 0.0;
  for (int i = 0; i < 8; i++) { float k = float(i); Y += 0.5 * Ck(k) * at(vec2(bx + k, p.y)).x * cosT(i0, k); }
  vec2 s = floor(p / 2.0);
  float im = mod(s.x, 8.0), cbx = s.x - im;
  vec2 C = vec2(0.0);
  for (int i = 0; i < 8; i++) { float k = float(i); C += 0.5 * Ck(k) * at(vec2(2.0 * (cbx + k), 2.0 * s.y)).yz * cosT(im, k); }
  float y = Y + 128.0;
  vec3 rgb = vec3(y + 1.402 * C.y, y - 0.344136 * C.x - 0.714136 * C.y, y + 1.772 * C.x) / 255.0;
  fragColor = vec4(toLinear(clamp(rgb, 0.0, 1.0)), 1.0);
}`;

/** JPEG quality (1..100) to the scale of the baseline tables. */
export function qualityScale(q: number) {
  const c = Math.max(1, Math.min(100, q));
  return (c < 50 ? 5000 / c : 200 - 2 * c) / 100;
}

export interface JpegOpts {
  /** 1..100. */
  quality: number;
  /** Re-saves in this frame, 1 or more. Each costs four passes. */
  passes: number;
  /** Shift of the block grid per re-save, logical px. */
  shift?: [number, number];
}

const uniforms = () => ({
  tex: { value: null }, uOff: { value: new THREE.Vector2() }, uQ: { value: 1 }, uInFrame: { value: 0 }, uOutFrame: { value: 0 },
});
const PAD = 16;

export class Jpeg {
  private fr = new FSPass(FWD_ROW, uniforms());
  private fc = new FSPass(FWD_COL, uniforms());
  private ic = new FSPass(INV_COL, uniforms());
  private ir = new FSPass(INV_ROW, uniforms());
  private a = makeRT(W + 2 * PAD, H + 2 * PAD);
  private b = makeRT(W + 2 * PAD, H + 2 * PAD);
  private r = makeRT(W + 2 * PAD, H + 2 * PAD);

  /** Re-save `src` (a 1920x1080 frame) `o.passes` times into `out`. */
  render(renderer: THREE.WebGLRenderer, src: THREE.Texture, out: THREE.WebGLRenderTarget, o: JpegOpts) {
    const q = qualityScale(o.quality);
    const n = Math.max(1, Math.round(o.passes));
    const [sx, sy] = o.shift ?? [3, 5];
    let input = src;
    for (let g = 0; g < n; g++) {
      const ox = ((g * sx) % 8 + 8) % 8, oy = ((g * sy) % 8 + 8) % 8;
      const last = g === n - 1;
      const step = (pass: FSPass, from: THREE.Texture, to: THREE.WebGLRenderTarget, inFrame: boolean, outFrame: boolean) => {
        pass.u.tex!.value = from;
        (pass.u.uOff!.value as THREE.Vector2).set(ox, oy);
        pass.u.uQ!.value = q;
        pass.u.uInFrame!.value = inFrame ? 1 : 0;
        pass.u.uOutFrame!.value = outFrame ? 1 : 0;
        pass.render(renderer, to);
      };
      step(this.fr, input, this.a, g === 0, false);
      step(this.fc, this.a.texture, this.b, false, false);
      step(this.ic, this.b.texture, this.a, false, false);
      step(this.ir, this.a.texture, last ? out : this.r, false, last);
      input = this.r.texture;
    }
  }

  dispose() {
    for (const p of [this.fr, this.fc, this.ic, this.ir]) p.dispose();
    for (const t of [this.a, this.b, this.r]) t.dispose();
  }
}
