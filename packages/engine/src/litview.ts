// One view of a lit world (see `lit.ts`): the 640x360 HDR target, the sky, the bloom chain and the output pass. Lit
// windows, lamps and screens are emissive and bloom. The output pass tone-maps the frame, lays the text layer over it,
// quantizes it with an ordered dither (so gradients show the dither pattern), can bend it into a CRT, and scales it x3
// with nearest sampling to the 1920x1080 frame.
import * as THREE from 'three';
import { FSPass, SCALE, W, H } from './gl';
import { SHOULDER_GLSL } from './post';
import { LH, LW, col, type Col } from './lit';
import { TextLayer } from './textlayer';

/**
 * The sky of a view (sRGB hex colours): `zenith` straight up, `horizon` at eye level, `ground` below the horizon
 * (seen only where nothing is drawn). `stars` 0..1. `body`: a sun or moon in direction `dir` with angular radius
 * `r` (rad), its colour and strength (HDR, so it blooms), and a glow out to `glow` times its radius.
 */
export interface Sky {
  zenith: Col; horizon: Col; ground: Col; stars?: number;
  /** An exponential horizon glow: the horizon colour fades out with sin(elevation) over this scale (default: the smooth rise to the zenith colour). A thin warm glow on a dark sky needs about 0.06. */
  glowBand?: number;
  /** `corona`: a total eclipse's ring and streamers round the body (colour and HDR strength), drawn when the body is a dark disc. */
  body?: { dir: THREE.Vector3; r: number; colour: Col; strength: number; glow?: number; corona?: { colour: Col; strength: number } };
}

/** Look of the output pass. */
export interface Output {
  exposure?: number;
  /** Bloom strength and the HDR level where it starts. */
  bloom?: number; threshold?: number;
  /** Quantize levels per channel (sRGB). */
  levels?: number;
  /** 0..1: the CRT (curvature, scanlines, dark edge). */
  crt?: number;
  /** 0..1 fade to black. */
  fade?: number;
  /** A second interface layer over everything, the overlay too: what must never be covered (the cursor of a game player). */
  top?: TextLayer;
}

const SKY_FRAG = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform float uOrtho;
uniform vec3 uZenith, uHorizon, uGround;
uniform float uStars;
uniform float uBand;
uniform vec4 uBody; // dir, angular radius
uniform vec3 uBodyCol;
uniform float uBodyGlow;
uniform vec3 uCoronaCol;
uniform vec2 uPixAng;
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 dir;
  if (uOrtho > 0.5) dir = normalize((uCamWorld * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
  else {
    vec4 v = uInvProj * vec4(ndc, 1.0, 1.0);
    dir = normalize((uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz);
  }
  float e = dir.y;
  vec3 c = e >= 0.0 ? mix(uHorizon, uZenith, uBand > 0.0 ? 1.0 - exp(-e / uBand) : pow(sat(e), 0.55)) : mix(uHorizon, uGround, sat(-e * 6.0));
  if (uStars > 0.0 && e > 0.02) {
    // a star field fixed to the sky: one cell per pixel of angle, a few cells lit
    vec2 sph = vec2(atan(dir.z, dir.x), asin(clamp(e, -1.0, 1.0)));
    vec2 cell = floor(sph / uPixAng);
    float h = hash12(cell);
    float lit = step(1.0 - 0.005 * uStars, h) * sat(e * 4.0);
    c += vec3(0.9, 0.92, 1.0) * lit * (0.6 + 1.4 * hash12(cell + 17.0));
  }
  if (uBody.w > 0.0) {
    vec3 bd = normalize(uBody.xyz);
    float a = acos(clamp(dot(dir, bd), -1.0, 1.0)) / uBody.w;
    if (a < 1.0) c = uBodyCol;
    else c += uBodyCol * 0.08 * exp(-(a - 1.0) * 3.0 / max(uBodyGlow, 1e-3));
    if (a >= 1.0 && dot(uCoronaCol, uCoronaCol) > 0.0) {
      // the corona: a thin bright ring on the rim, a halo and streamers that reach out along seven rays
      vec3 bu = normalize(cross(bd, vec3(0.0, 1.0, 0.0)));
      vec3 bv = cross(bd, bu);
      float ang = atan(dot(dir, bv), dot(dir, bu));
      float ray = 0.55 + 0.45 * sin(ang * 7.0 + 0.8) * sin(ang * 3.0 + 2.1);
      float ring = exp(-(a - 1.0) * 14.0);
      float halo = exp(-(a - 1.0) * 2.2) * ray;
      c += uCoronaCol * (1.4 * ring + 0.55 * halo + 0.18 * halo * halo);
    }
  }
  fragColor = vec4(c, 1.0);
}`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold; // < 0: no threshold
void main() {
  vec3 c = texture(uSrc, vUv).rgb * 4.0;
  c += texture(uSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  c += texture(uSrc, vUv + vec2( 1.0, -1.0) * uTexel).rgb;
  c += texture(uSrc, vUv + vec2(-1.0,  1.0) * uTexel).rgb;
  c += texture(uSrc, vUv + vec2( 1.0,  1.0) * uTexel).rgb;
  c /= 8.0;
  if (uThreshold >= 0.0) c = max(c - uThreshold, 0.0);
  fragColor = vec4(c, 1.0);
}`;

const UP_FRAG = /* glsl */ `
uniform sampler2D uSrc;
uniform sampler2D uBase;
uniform vec2 uTexel;
void main() {
  vec3 c = vec3(0.0);
  c += texture(uSrc, vUv + vec2(-2.0, 0.0) * uTexel).rgb;
  c += texture(uSrc, vUv + vec2( 2.0, 0.0) * uTexel).rgb;
  c += texture(uSrc, vUv + vec2(0.0, -2.0) * uTexel).rgb;
  c += texture(uSrc, vUv + vec2(0.0,  2.0) * uTexel).rgb;
  c += texture(uSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb * 2.0;
  c += texture(uSrc, vUv + vec2( 1.0, -1.0) * uTexel).rgb * 2.0;
  c += texture(uSrc, vUv + vec2(-1.0,  1.0) * uTexel).rgb * 2.0;
  c += texture(uSrc, vUv + vec2( 1.0,  1.0) * uTexel).rgb * 2.0;
  fragColor = vec4(c / 12.0 + texture(uBase, vUv).rgb, 1.0);
}`;

/** `toLin` (sRGB to linear) and `unshoulder` (the inverse of the tone shoulder of `SHOULDER_GLSL` below its white blend, k = 0.72). */
export const UNSHOULDER_GLSL = /* glsl */ `
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
// the inverse of the engine's tone shoulder below its white blend, so the frame arrives on screen as written here
vec3 unshoulder(vec3 y) {
  const float k = 0.72;
  vec3 x = k - (1.0 - k) * log(max(1.0 - (y - k) / (1.0 - k), 1e-4));
  return mix(y, x, step(k, y));
}`;

const OUT_FRAG = /* glsl */ `
${SHOULDER_GLSL}
uniform sampler2D uHdr, uBloom, uText, uOver, uTop;
uniform vec4 uRect;
uniform float uExposure, uBloomK, uLevels, uCrt, uFade, uScreen;
vec3 aces(vec3 x) { return sat((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)); }
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
${UNSHOULDER_GLSL}
void main() {
  vec2 q = (gl_FragCoord.xy - uRect.xy) / uRect.zw;
  float edge = 1.0;
  if (uCrt > 0.0) {
    vec2 c = q * 2.0 - 1.0;
    c *= 1.0 + uCrt * vec2(0.035, 0.05) * (c.yx * c.yx);
    q = c * 0.5 + 0.5;
    vec2 d = min(q, 1.0 - q);
    edge = sat(min(d.x * 640.0, d.y * 360.0) / (8.0 * uCrt + 1e-3));
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) edge = 0.0;
  }
  q = clamp(q, 0.0, 0.99999);
  ivec2 t = ivec2(floor(q * vec2(${LW}.0, ${LH}.0)));
  vec2 tc = (vec2(t) + 0.5) / vec2(${LW}.0, ${LH}.0);
  vec3 hdr = texelFetch(uHdr, t, 0).rgb + texture(uBloom, tc).rgb * uBloomK;
  vec3 s = toSrgb(aces(hdr * uExposure));
  vec4 tx = texelFetch(uText, t, 0);
  s = mix(s, tx.rgb, tx.a);
  // the overlay: a 3D layer over the interface (an object on a window's title bar), alpha 0 where it is empty
  vec4 ov = texelFetch(uOver, t, 0);
  s = mix(s, toSrgb(aces(ov.rgb * uExposure)), step(0.5, ov.a));
  // the top layer: over the overlay too
  vec4 tp = texelFetch(uTop, t, 0);
  s = mix(s, tp.rgb, tp.a);
  if (uScreen < 0.5) {
    // the dither: quantize every channel with an ordered threshold
    s = sat(floor(s * uLevels + bayer4(vec2(t))) / uLevels);
  }
  if (uCrt > 0.0) {
    float row = fract(q.y * ${LH}.0);
    s *= mix(1.0, 0.72 + 0.28 * smoothstep(0.0, 0.5, row) * smoothstep(1.0, 0.5, row), uCrt);
    vec2 c = q * 2.0 - 1.0;
    s *= mix(1.0, 1.0 - 0.35 * dot(c * c, vec2(0.5)), uCrt);
  }
  s *= edge * (1.0 - uFade);
  vec3 lin = toLin(s);
  fragColor = vec4(uScreen > 0.5 ? lin : unshoulder(min(lin, vec3(0.99))), 1.0);
}`;

/**
 * The precision of the HDR targets that scenes draw into: 16-bit float (the default: less memory, faster), or 32-bit float with
 * `?hdr=float` in the page address (the checks use it).
 * At 16 bits the GPU does not always round an additive blend the same way: the same draw with the same inputs can give a value one
 * 16-bit step higher in some texels. The dither of the output pass then moves a few pixels by one level step. The fault comes and goes
 * with the frames that the page rendered before, so it looks like a frame that depends on the render order. At 32 bits the step is
 * too small to reach the dither. A check that must tell a true order fault from this rounding renders at both precisions
 * (`scripts/determinism.ts`, `pve order --precision float`).
 */
const HDR_TYPE = typeof location !== 'undefined' && new URLSearchParams(location.search).get('hdr') === 'float' ? THREE.FloatType : THREE.HalfFloatType;

/**
 * One view of the world: the 640x360 HDR target, the sky, the bloom chain and the output pass. A scene with two
 * views (a room and the picture on a screen in it) owns two.
 */
export class LitView {
  readonly rt: THREE.WebGLRenderTarget;
  private readonly full: boolean;
  private screenRT: THREE.WebGLRenderTarget | null = null;
  private overRT: THREE.WebGLRenderTarget | null = null;
  private overOn = false;
  /** The finished picture (linear, not dithered) for use as a texture: the CRT screen in another view. */
  get screen(): THREE.WebGLRenderTarget {
    return (this.screenRT ??= new THREE.WebGLRenderTarget(LW, LH, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false,
    }));
  }
  private mips: THREE.WebGLRenderTarget[] = [];
  private ups: THREE.WebGLRenderTarget[] = [];
  private skyPass = new FSPass(SKY_FRAG, {
    uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uOrtho: { value: 0 },
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
    uStars: { value: 0 }, uBand: { value: 0 }, uBody: { value: new THREE.Vector4() }, uBodyCol: { value: new THREE.Color() }, uBodyGlow: { value: 1 }, uCoronaCol: { value: new THREE.Color(0, 0, 0) },
    uPixAng: { value: new THREE.Vector2(0.001, 0.001) },
  });
  private down = new FSPass(DOWN_FRAG, { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: -1 } });
  private up = new FSPass(UP_FRAG, { uSrc: { value: null }, uBase: { value: null }, uTexel: { value: new THREE.Vector2() } });
  private out = new FSPass(OUT_FRAG, {
    uHdr: { value: null }, uBloom: { value: null }, uText: { value: null }, uOver: { value: null }, uTop: { value: null }, uRect: { value: new THREE.Vector4() },
    uExposure: { value: 1 }, uBloomK: { value: 0.6 }, uLevels: { value: 24 }, uCrt: { value: 0 }, uFade: { value: 0 }, uScreen: { value: 0 },
  });
  private blank = new TextLayer();

  /** `w`, `h`: the size of the HDR target in logical pixels. A view of another size than the frame is a window view: it only renders (no bloom, no output pass). */
  constructor(readonly w = LW, readonly h = LH) {
    this.full = w === LW && h === LH;
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      type: HDR_TYPE, format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: true, generateMipmaps: false,
    });
    if (!this.full) return;
    const mk = (w: number, h: number) => new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, generateMipmaps: false,
    });
    for (let k = 1; k <= 5; k++) this.mips.push(mk(Math.max(1, LW >> k), Math.max(1, LH >> k)));
    for (let k = 1; k <= 4; k++) this.ups.push(mk(Math.max(1, LW >> k), Math.max(1, LH >> k)));
    this.blank.commit();
  }

  /** Renders `scene` (no sky, alpha 0 where empty) into the overlay that the next `present` or `toScreen` puts over the interface layer. */
  renderOver(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera) {
    this.overRT ??= new THREE.WebGLRenderTarget(this.w, this.h, {
      type: HDR_TYPE, format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false,
    });
    const prev = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.overRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    renderer.setClearColor(prev, alpha);
    this.overOn = true;
  }

  /** Renders the sky, then the scene through `cam`, into the HDR target. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, sky: Sky) {
    cam.updateMatrixWorld();
    const u = this.skyPass.u;
    if (cam instanceof THREE.PerspectiveCamera) {
      cam.updateProjectionMatrix();
      (u.uInvProj!.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
      const a = THREE.MathUtils.degToRad(cam.fov) / this.h;
      (u.uPixAng!.value as THREE.Vector2).set(a, a);
      u.uOrtho!.value = 0;
    } else u.uOrtho!.value = 1;
    (u.uCamWorld!.value as THREE.Matrix4).copy(cam.matrixWorld);
    (u.uZenith!.value as THREE.Color).copy(col(sky.zenith));
    (u.uHorizon!.value as THREE.Color).copy(col(sky.horizon));
    (u.uGround!.value as THREE.Color).copy(col(sky.ground));
    u.uStars!.value = sky.stars ?? 0;
    u.uBand!.value = sky.glowBand ?? 0;
    const b = sky.body;
    if (b) {
      (u.uBody!.value as THREE.Vector4).set(b.dir.x, b.dir.y, b.dir.z, b.r);
      (u.uBodyCol!.value as THREE.Color).copy(col(b.colour)).multiplyScalar(b.strength);
      u.uBodyGlow!.value = b.glow ?? 1;
      (u.uCoronaCol!.value as THREE.Color).copy(col(b.corona?.colour ?? 0)).multiplyScalar(b.corona?.strength ?? 0);
    } else {
      (u.uBody!.value as THREE.Vector4).set(0, 1, 0, 0);
      (u.uCoronaCol!.value as THREE.Color).setRGB(0, 0, 0);
    }
    this.skyPass.render(renderer, this.rt);
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.rt);
    renderer.clearDepth();
    renderer.render(scene, cam);
    renderer.autoClear = auto;
  }

  /** Renders a second scene over the picture of the last `render`, in front of all of it (the depth starts new): a room in front of the world that its door looks out on. */
  renderInFront(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera) {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.rt);
    renderer.clearDepth();
    renderer.render(scene, cam);
    renderer.autoClear = auto;
  }

  /** The bloom chain of the HDR target. Returns the bloom texture (half size). */
  private bloom(renderer: THREE.WebGLRenderer, threshold: number): THREE.Texture {
    let src: THREE.Texture = this.rt.texture;
    let sw = LW, sh = LH;
    this.mips.forEach((m, k) => {
      this.down.u.uSrc!.value = src;
      (this.down.u.uTexel!.value as THREE.Vector2).set(1 / sw, 1 / sh);
      this.down.u.uThreshold!.value = k === 0 ? threshold : -1;
      this.down.render(renderer, m);
      src = m.texture; sw = m.width; sh = m.height;
    });
    for (let k = this.ups.length - 1; k >= 0; k--) {
      const dst = this.ups[k]!;
      const from = k === this.ups.length - 1 ? this.mips[k + 1]! : this.ups[k + 1]!;
      this.up.u.uSrc!.value = from.texture;
      this.up.u.uBase!.value = this.mips[k]!.texture;
      (this.up.u.uTexel!.value as THREE.Vector2).set(1 / from.width, 1 / from.height);
      this.up.render(renderer, dst);
    }
    return this.ups[0]!.texture;
  }

  private setOut(renderer: THREE.WebGLRenderer, o: Output, text: TextLayer | null) {
    if (!this.full) throw new Error('lit view: a sized view (a window) has no output pass: blit its target into a full view');
    const u = this.out.u;
    u.uHdr!.value = this.rt.texture;
    u.uBloom!.value = this.bloom(renderer, o.threshold ?? 1.0);
    u.uText!.value = (text ?? this.blank).tex;
    // the overlay applies to one output only
    u.uOver!.value = this.overOn && this.overRT ? this.overRT.texture : this.blank.tex;
    this.overOn = false;
    u.uTop!.value = o.top === undefined ? this.blank.tex : o.top.tex;
    u.uExposure!.value = o.exposure ?? 1;
    u.uBloomK!.value = o.bloom ?? 0.35;
    u.uLevels!.value = o.levels ?? 24;
    u.uCrt!.value = o.crt ?? 0;
    u.uFade!.value = o.fade ?? 0;
  }

  /**
   * Writes the finished frame into `target` in the logical rectangle x, y (top left), w, h of the 1920x1080 frame.
   * The default is the whole frame (x3).
   */
  present(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, o: Output = {}, text: TextLayer | null = null, x = 0, y = 0, w = W, h = H) {
    this.setOut(renderer, o, text);
    const ph = target.height;
    const r = { x: x * SCALE, y: ph - (y + h) * SCALE, w: w * SCALE, h: h * SCALE };
    this.out.u.uScreen!.value = 0;
    (this.out.u.uRect!.value as THREE.Vector4).set(r.x, r.y, r.w, r.h);
    this.out.render(renderer, target, false, r);
  }

  /** Writes the finished picture into `screen` (linear, not dithered) for a CRT in another view. */
  toScreen(renderer: THREE.WebGLRenderer, o: Output = {}, text: TextLayer | null = null): THREE.Texture {
    this.setOut(renderer, o, text);
    this.out.u.uScreen!.value = 1;
    (this.out.u.uRect!.value as THREE.Vector4).set(0, 0, LW, LH);
    this.out.render(renderer, this.screen);
    return this.screen.texture;
  }

  dispose() {
    this.rt.dispose();
    this.overRT?.dispose();
    this.screenRT?.dispose();
    for (const m of [...this.mips, ...this.ups]) m.dispose();
    this.skyPass.dispose();
    this.down.dispose();
    this.up.dispose();
    this.out.dispose();
    this.blank.dispose();
  }
}

/**
 * Runs `draw`: the renders of one frame of a scene that is posed, through more than one camera (the windows of the frame). The
 * work of a render that does not depend on the camera is done once: the world matrices of the scene (before `draw`), and the
 * shadow maps (in the first render of `draw`). Rules for `draw`: it moves cameras only, it does not move, show or hide an object
 * or a light of the scene, and it renders no other scene that has lights with shadows.
 */
export function posedOnce(renderer: THREE.WebGLRenderer, scene: THREE.Scene, draw: () => void) {
  const matrices = scene.matrixWorldAutoUpdate, shadows = renderer.shadowMap.autoUpdate;
  scene.updateMatrixWorld();
  scene.matrixWorldAutoUpdate = false;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  try {
    draw();
  } finally {
    scene.matrixWorldAutoUpdate = matrices;
    renderer.shadowMap.autoUpdate = shadows;
    renderer.shadowMap.needsUpdate = false;
  }
}
