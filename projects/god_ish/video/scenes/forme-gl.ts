// The 3D parts of the forme transition (forme.ts): one perspective camera that sees the plane z = 0 as the
// 1920×1080 frame px for px, a glyph atlas, and the materials: the page under the transition (`under`), the red
// holes the sorts leave in the paper, the metal sorts, their hard shadows, the bed of the press with the chase,
// the ink roller and the impression cylinder. World units are logical px: X right from the frame centre, Y up, Z at the
// camera. Colours are written as sRGB tones and leave the shaders linear.
import * as THREE from 'three';
import { H, SCALE, W } from '@pve/engine/gl';
import { GLSL_COMMON } from '@pve/engine/glsl/common';
import { cameraDistance } from '@pve/engine/util';
import { fnt, SERIF } from './_page';

/** Vertical field of view (deg) and the camera distance at which the plane z = 0 fills the frame. */
export const FOV = 30;
export const D = cameraDistance(FOV);
/** Type-high: every sort is this tall, whatever its body size (px). */
export const TYPE_HIGH = 48;
/** The top of the bed: it slides in just over the paper. */
export const BED_Z = 2;

/** World X, Y of frame px (x, y) seen at height z. */
export const worldAt = (x: number, y: number, z: number): [number, number] => [((x - W / 2) * (D - z)) / D, ((H / 2 - y) * (D - z)) / D];

// ---------- the glyph atlas ----------
/** Atlas: the em of each glyph is EM px in a cell of CELL px. */
const EM = 64;
const CELL = 80;
const PAD = (CELL - EM) / 2;
const COLS = 16;

export class Atlas {
  readonly tex: THREE.CanvasTexture;
  readonly grid: THREE.Vector2;
  private readonly at = new Map<string, number>();

  /** entries: glyph and font weight. */
  constructor(entries: [string, number][]) {
    for (const [ch, w] of entries) {
      const k = `${ch}|${w}`;
      if (!this.at.has(k)) this.at.set(k, this.at.size);
    }
    const rows = Math.ceil(this.at.size / COLS);
    const cv = document.createElement('canvas');
    cv.width = COLS * CELL * SCALE;
    cv.height = rows * CELL * SCALE;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.scale(SCALE, SCALE);
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const [k, i] of this.at) {
      const [ch, w] = k.split('|') as [string, string];
      c.font = fnt(SERIF, EM, Number(w));
      c.fillText(ch, (i % COLS) * CELL + CELL / 2, Math.floor(i / COLS) * CELL + CELL / 2);
    }
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.flipY = false;
    this.tex.generateMipmaps = false;
    this.tex.minFilter = THREE.LinearFilter;
    this.grid = new THREE.Vector2(COLS, rows);
  }

  of(ch: string, w: number): number {
    const i = this.at.get(`${ch}|${w}`);
    if (i === undefined) throw new Error(`forme atlas: no glyph "${ch}" at ${w}`);
    return i;
  }
}

// ---------- shaders ----------
const HEAD = /* glsl */ `precision highp float;
precision highp int;
${GLSL_COMMON}
uniform sampler2D uAtlas;
uniform vec2 uAtlasN;
/** The impression cylinder's shadow: world X from x to y is darkened by z. */
uniform vec3 uShade;
const vec3 LDIR = vec3(-0.4706, 0.5752, 0.6693);
/** Coverage of glyph \`cell\` at q (0..1 across its em, y down). */
float glyphA(float cell, vec2 q) {
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return 0.0;
  vec2 c = vec2(mod(cell, uAtlasN.x), floor(cell / uAtlasN.x));
  return texture(uAtlas, (c + ${(PAD / CELL).toFixed(4)} + q * ${(EM / CELL).toFixed(4)}) / uAtlasN).a;
}
float shade(float X) { return X > uShade.x && X < uShade.y ? 1.0 - uShade.z : 1.0; }
out vec4 fragColor;
`;

const VERT_INST = /* glsl */ `precision highp float;
in vec3 position; in vec3 normal; in vec2 uv; in mat4 instanceMatrix;
in float aCell; in float aInk;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vObj; out vec3 vN; out vec3 vW; out vec2 vUv; out float vCell; out float vInk;
void main() {
  vObj = position; vUv = uv; vCell = aCell; vInk = aInk;
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const VERT = /* glsl */ `precision highp float;
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec3 vObj; out vec3 vN; out vec3 vW; out vec2 vUv;
void main() {
  vObj = position; vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** A page: the page under the transition, px for px at rest, kept between world X uSpan.x and uSpan.y. */
const FRAG_PAPER = /* glsl */ `${HEAD}
uniform sampler2D under;
uniform vec2 uSpan;
in vec3 vW;
void main() {
  if (vW.x < uSpan.x || vW.x > uSpan.y) discard;
  vec2 res = vec2(${W.toFixed(1)}, ${H.toFixed(1)});
  vec2 uv = clamp((vW.xy + res * 0.5) / res, 0.5 / res, 1.0 - 0.5 / res);
  fragColor = vec4(texture(under, uv).rgb * shade(vW.x), 1.0);
}`;

/** Holes left in the paper: mode 0 a glyph cut onto the red substrate, mode 1 an empty tray slot. */
const FRAG_HOLE = /* glsl */ `${HEAD}
uniform vec2 uSpan;
in vec3 vW; in vec2 vUv; in float vCell; in float vInk;
void main() {
  if (vW.x < uSpan.x || vW.x > uSpan.y) discard;
  vec3 col;
  if (vInk < 0.5) {
    if (glyphA(vCell, vec2(vUv.x, 1.0 - vUv.y)) < 0.5) discard;
    col = C_SIGNAL * (0.92 + 0.08 * fbm((vW.xy + vec2(960.0, -540.0)) * vec2(0.004, -0.004) + 2.0, 3));
  } else col = toLinear(vec3(0.02));
  fragColor = vec4(col * shade(vW.x), 1.0);
}`;

/** A sort: the face (+z) carries the glyph reversed, raised; the foot (-z) has its groove; a nick on one side. */
const FRAG_SORT = /* glsl */ `${HEAD}
in vec3 vObj; in vec3 vN; in vec3 vW; in float vCell; in float vInk;
void main() {
  vec3 n = normalize(vN);
  float lam = max(dot(n, LDIR), 0.0);
  float c;
  if (vObj.z > 0.499) {
    // the face: reversed glyph on the shoulder; ink from the roller
    float g = glyphA(vCell, vec2(0.5 - vObj.x, 0.5 - vObj.y));
    float rim = step(0.45, max(abs(vObj.x), abs(vObj.y)));
    float shoulder = 0.32 + 0.12 * rim;
    float relief = mix(0.88, 0.015, vInk);
    c = mix(shoulder, relief, step(0.5, g)) * (0.6 + 0.5 * lam);
  } else if (vObj.z < -0.499) {
    c = (abs(vObj.y) < 0.05 ? 0.14 : 0.42) * (0.6 + 0.5 * lam);
  } else {
    float nick = vObj.y > 0.499 && vObj.z > -0.2 && vObj.z < -0.08 ? 0.45 : 1.0;
    c = 0.36 * nick * (0.25 + 0.95 * lam);
  }
  fragColor = vec4(toLinear(vec3(c)) * shade(vW.x), 1.0);
}`;

/** A hard shadow: a dark square on whatever it falls on. */
const FRAG_SHADOW = /* glsl */ `${HEAD}
in vec3 vW;
void main() { fragColor = vec4(0.0, 0.0, 0.0, 0.3); }`;

/**
 * The bed of the press as it comes in: the forme (chase, quoins, furniture, the spacing recess between the
 * columns, the brass rules and the red 神 seal block) at its final place shifted by uShift px. uRoll: the roller's
 * frame x (what lies right of it is inked); uQuoin 0..1: the quoins driven home.
 */
const FRAG_BED = /* glsl */ `${HEAD}
uniform float uShift;
uniform float uRoll;
uniform float uQuoin;
uniform float uSealCell;
uniform vec4 uSheet;      // the chase's inner edge, frame px
uniform vec4 uRules[12];  // brass rules x, y, w, h
uniform int uNRules;
uniform vec4 uFurn[4];    // furniture blocks
uniform vec2 uTierX;      // the body area
uniform vec3 uSeal;       // seal centre and radius
in vec3 vW;
float inR(vec2 p, vec4 r) { return step(r.x, p.x) * step(p.x, r.x + r.z) * step(r.y, p.y) * step(p.y, r.y + r.w); }
float inB(vec2 p, vec4 b) { return step(b.x, p.x) * step(p.x, b.z) * step(b.y, p.y) * step(p.y, b.w); }
void main() {
  vec2 p = vec2(vW.x + 960.0 - uShift, 540.0 - vW.y);
  float c;
  bool inked = p.x > uRoll;
  vec4 outer = uSheet + vec4(-34.0, -34.0, 34.0, 34.0);
  if (p.x < -70.0) {
    // the leading end of the bed: a lit iron edge
    c = 0.30 + 0.20 * step(-74.0, p.x);
  } else if (inB(p, outer) < 0.5) {
    // the press bed
    c = 0.035 + 0.02 * fbm(p * 0.01, 3) + 0.35 * step(0.9965, hash12(floor(p / 2.0)));
  } else if (inB(p, uSheet) < 0.5) {
    // the chase: iron bars, a lit inner bevel; the quoins (wedge pairs) in the right bar and the foot
    c = 0.22 + 0.06 * fbm(vec2(p.x * 0.02, p.y * 0.02), 3);
    float bev = min(min(p.x - outer.x, outer.z - p.x), min(p.y - outer.y, outer.w - p.y));
    c += 0.12 * step(bev, 3.0);
    float ib = min(min(p.x - uSheet.x, uSheet.z - p.x), min(p.y - uSheet.y, uSheet.w - p.y));
    c += 0.18 * step(-3.0, ib) * step(ib, 0.0);
    float q = 0.0;
    for (int k = 0; k < 2; k++) {
      float qy = k == 0 ? 300.0 : 780.0;
      vec2 a = vec2(p.x - uSheet.z - 17.0, p.y - qy);
      if (abs(a.x) < 13.0 && abs(a.y) < 40.0) q = a.x * 3.0 + a.y > uQuoin * 14.0 - 7.0 ? 1.0 : 0.7;
      float qx = k == 0 ? 520.0 : 1280.0;
      vec2 b = vec2(p.x - qx, p.y - uSheet.w - 17.0);
      if (abs(b.y) < 13.0 && abs(b.x) < 40.0) q = b.y * 3.0 + b.x > uQuoin * 14.0 - 7.0 ? 1.0 : 0.7;
    }
    if (q > 0.0) c = 0.42 * q + 0.04 * hash12(floor(p));
  } else {
    // inside the chase: furniture where nothing is set, a dark recess of spacing between the body columns
    c = 0.26 + 0.05 * fbm(vec2(p.x * 0.004, p.y * 0.06), 3);
    c *= 0.85 + 0.15 * step(4.0, mod(p.y - uSheet.y, 150.0));
    for (int k = 0; k < 4; k++) if (inB(p, uFurn[k]) > 0.5) c = 0.34 + 0.06 * fbm(vec2(p.x * 0.05, p.y * 0.003), 3);
    if (p.x > uTierX.x && p.x < uTierX.y) {
      float body = 0.0;
      for (int k = 0; k < 6; k++) body = max(body, step(72.0 + float(k) * 156.0, p.y) * step(p.y, 222.0 + float(k) * 156.0));
      bool furn = false;
      for (int k = 0; k < 4; k++) furn = furn || inB(p, uFurn[k]) > 0.5;
      if (body > 0.5 && !furn) c = 0.10 + 0.06 * step(mod(p.x, 20.0), 1.5);
    }
    // the brass rules, type-high: they take ink
    for (int k = 0; k < 12; k++) {
      if (k >= uNRules) break;
      if (inR(p, uRules[k]) > 0.5) c = inked ? 0.03 : 0.66;
    }
    // the 神 seal block in red: a ring and the glyph, reversed
    vec2 s = p - uSeal.xy;
    float r = length(s);
    if (r < uSeal.z) {
      float ring = step(uSeal.z - 9.0, r);
      float g = glyphA(uSealCell, vec2(0.5 - s.x / (uSeal.z * 1.5), 0.5 + s.y / (uSeal.z * 1.5)));
      if (ring + step(0.5, g) > 0.5) {
        fragColor = vec4(C_SIGNAL * (inked ? 0.8 : 1.0) * shade(vW.x), 1.0);
        return;
      }
      c = 0.06;
    }
  }
  fragColor = vec4(toLinear(vec3(c)) * shade(vW.x), 1.0);
}`;

/** The composition roller: black rubber, a wet sheen of ink. */
const FRAG_ROLLER = /* glsl */ `${HEAD}
in vec3 vN; in vec3 vW;
uniform vec3 uCam;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uCam - vW);
  float lam = max(dot(n, LDIR), 0.0);
  float spec = pow(max(dot(reflect(-LDIR, n), v), 0.0), 24.0);
  float c = 0.03 + 0.10 * lam + 0.55 * spec;
  fragColor = vec4(toLinear(vec3(c)) * shade(vW.x), 1.0);
}`;

/**
 * The impression cylinder (axis Y): the sheet wrapped round it, its gripper bar turning with it (uTurn rad),
 * steel flanges at the ends (|y| > uHalf).
 */
const FRAG_CYL = /* glsl */ `${HEAD}
in vec3 vObj; in vec3 vN; in vec3 vW;
uniform vec3 uCam;
uniform float uTurn;
uniform float uHalf;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uCam - vW);
  float lam = max(dot(n, LDIR), 0.0);
  float spec = pow(max(dot(reflect(-LDIR, n), v), 0.0), 18.0);
  float a = mod(atan(vObj.z, vObj.x) + uTurn, 6.28318);
  float c;
  if (abs(vObj.y) > uHalf) c = 0.30 + 0.25 * lam + 0.5 * spec;
  else {
    c = (0.80 + 0.04 * fbm(vec2(a * 40.0, vObj.y * 0.01), 3)) * (0.5 + 0.6 * lam);
    // the gripper bar, and the edges of the tympan sheets every sixth of a turn
    if (a < 0.16) c = 0.10 + 0.35 * spec;
    else if (fract(a / 1.0472) < 0.025) c *= 0.55;
  }
  fragColor = vec4(toLinear(vec3(c)), 1.0);
}`;

/** Materials of the forme; `common` uniforms are shared by all of them. */
export class FormeGL {
  readonly common: Record<string, THREE.IUniform>;
  readonly paper: THREE.RawShaderMaterial;
  readonly hole: THREE.RawShaderMaterial;
  readonly sort: THREE.RawShaderMaterial;
  readonly shadow: THREE.RawShaderMaterial;
  readonly bed: THREE.RawShaderMaterial;
  readonly roller: THREE.RawShaderMaterial;
  readonly print: THREE.RawShaderMaterial;
  readonly cylinder: THREE.RawShaderMaterial;

  constructor(atlas: Atlas) {
    this.common = { uAtlas: { value: atlas.tex }, uAtlasN: { value: atlas.grid }, uShade: { value: new THREE.Vector3(0, 0, 0) } };
    const mk = (vert: string, frag: string, u: Record<string, THREE.IUniform> = {}, o: THREE.ShaderMaterialParameters = {}) =>
      new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vert, fragmentShader: frag, uniforms: { ...this.common, ...u }, ...o });
    this.paper = mk(VERT, FRAG_PAPER, { under: { value: null }, uSpan: { value: new THREE.Vector2(-1e9, 1e9) } });
    this.hole = mk(VERT_INST, FRAG_HOLE, { uSpan: this.paper.uniforms.uSpan! });
    // the printed sheet lies on the type: drawn over the forme, after it
    this.print = mk(VERT, FRAG_PAPER, { under: this.paper.uniforms.under!, uSpan: { value: new THREE.Vector2(1e9, 1e9) } }, { depthTest: false, depthWrite: false });
    this.sort = mk(VERT_INST, FRAG_SORT);
    this.shadow = mk(VERT_INST, FRAG_SHADOW, {}, { transparent: true, depthWrite: false });
    this.bed = mk(VERT, FRAG_BED, {
      uShift: { value: 0 }, uRoll: { value: 1e9 }, uQuoin: { value: 0 }, uSealCell: { value: 0 },
      uSheet: { value: new THREE.Vector4() }, uRules: { value: Array.from({ length: 12 }, () => new THREE.Vector4()) }, uNRules: { value: 0 },
      uFurn: { value: Array.from({ length: 4 }, () => new THREE.Vector4(-1, -1, -1, -1)) }, uTierX: { value: new THREE.Vector2() },
      uSeal: { value: new THREE.Vector3() },
    });
    this.roller = mk(VERT, FRAG_ROLLER, { uCam: { value: new THREE.Vector3() } });
    this.cylinder = mk(VERT, FRAG_CYL, { uCam: this.roller.uniforms.uCam!, uTurn: { value: 0 }, uHalf: { value: 0 } });
  }

  dispose() {
    for (const m of [this.paper, this.hole, this.sort, this.shadow, this.bed, this.roller, this.print, this.cylinder]) m.dispose();
    (this.common.uAtlas!.value as THREE.Texture).dispose();
  }
}
