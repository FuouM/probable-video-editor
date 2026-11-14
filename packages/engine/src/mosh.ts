// A datamosh: a broken video stream that has lost its key frames. A key frame (a 640x360 picture) starts the chain; each next frame
// only moves the pixels of the chain along the motion of the 3D world, so the key picture smears and stretches as the camera moves.
// Where the motion brings in points from outside the frame, the chain holds nothing and the clean picture shows. `present` dissolves
// the chain pixel by pixel into the clean picture.
//
// The motion is the motion of the camera: for each frame a pass writes the world position of every pixel of a window, and the warp
// pass looks up where that point was in the frame before. The sky is at the far plane. Moving objects move as if they stood still.
// A frame of the mosh is the chain of all frames since the key frame: the caller steps the chain from the key frame to the frame.
import * as THREE from 'three';
import { FSPass } from './gl';
import { LH, LW } from './lit';
import { UNSHOULDER_GLSL } from './litview';

const WARP_FRAG = /* glsl */ `
uniform sampler2D uPrev, uPos; uniform mat4 uPrevVP, uInvVP; uniform vec4 uRect;
void main() {
  vec2 px = vUv * vec2(${LW}.0, ${LH}.0);
  vec2 l = (px - uRect.xy) / uRect.zw;
  // outside the window nothing moves
  if (l.x < 0.0 || l.y < 0.0 || l.x > 1.0 || l.y > 1.0) { fragColor = texelFetch(uPrev, ivec2(px), 0); return; }
  vec4 P = texelFetch(uPos, ivec2(px), 0);
  vec3 w;
  if (P.a > 0.5) w = P.xyz;
  else { vec4 h = uInvVP * vec4(l * 2.0 - 1.0, 1.0, 1.0); w = h.xyz / h.w; }
  vec4 c = uPrevVP * vec4(w, 1.0);
  vec2 q = c.xy / c.w * 0.5 + 0.5;
  // a point that was not in the frame before: the chain holds nothing there (alpha 0), the clean picture shows
  if (c.w <= 0.0 || q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { fragColor = vec4(0.0); return; }
  fragColor = texelFetch(uPrev, ivec2(uRect.xy + q * uRect.zw), 0);
}`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D uSrc;
void main() { fragColor = texture(uSrc, vUv); }`;

// The chain holds display colours (sRGB, as a text layer) and in alpha whether it holds the key picture. `uPic` and the output are
// the engine's frame colours (linear, under the tone shoulder of the output pass of `LitView`). The output: the clean picture, and
// over it the moshed key picture where the chain still holds it, dissolving pixel by pixel as `uU` goes from 0 to 1.
const OUT_FRAG = /* glsl */ `
${UNSHOULDER_GLSL}
uniform sampler2D uSrc, uPic; uniform float uU;
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec4 m = texture(uSrc, vUv);
  vec3 pic = texture(uPic, vUv).rgb;
  float keep = m.a * step(uU, h1(floor(vUv * vec2(${LW}.0, ${LH}.0))));
  fragColor = vec4(mix(pic, unshoulder(min(toLin(m.rgb), vec3(0.99))), keep), 1.0);
}`;

const target = (type: THREE.TextureDataType) => new THREE.WebGLRenderTarget(LW, LH, {
  type, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: type !== THREE.UnsignedByteType, generateMipmaps: false,
});

export class Mosh {
  private pos = target(THREE.HalfFloatType);
  private frames = [target(THREE.UnsignedByteType), target(THREE.UnsignedByteType)];
  private cur = 0;
  private posMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
        p = instanceMatrix * p;
        #endif
        vec4 w = modelMatrix * p;
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vW;
      void main() { gl_FragColor = vec4(vW, 1.0); }`,
    side: THREE.DoubleSide,
  });
  private warp = new FSPass(WARP_FRAG, {
    uPrev: { value: null }, uPos: { value: null },
    uPrevVP: { value: new THREE.Matrix4() }, uInvVP: { value: new THREE.Matrix4() }, uRect: { value: new THREE.Vector4() },
  });
  private copy = new FSPass(COPY_FRAG, { uSrc: { value: null } });
  private out = new FSPass(OUT_FRAG, { uSrc: { value: null }, uPic: { value: null }, uU: { value: 0 } });

  /** Starts the chain on the key frame `key` (a 640 x 360 picture). */
  start(r: THREE.WebGLRenderer, key: THREE.Texture) {
    this.cur = 0;
    this.copy.u.uSrc!.value = key;
    this.copy.render(r, this.frames[0]!);
  }

  /**
   * One frame of the chain: `scene` posed for the frame, seen by `cam`; `prev` is the camera of the frame before. `rect`: the window
   * that moves (x, y from the top, w, h in px of the 640 x 360 frame); outside it the chain stands still.
   */
  step(r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, prev: THREE.PerspectiveCamera, rect: readonly [number, number, number, number]) {
    const [x, y, w, h] = rect, gy = LH - (y + h);
    // the world position of each pixel of the window (alpha 0: the sky)
    const clear = new THREE.Color(), alpha = r.getClearAlpha(), auto = r.shadowMap.autoUpdate;
    r.getClearColor(clear);
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.pos);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    this.pos.viewport.set(x, gy, w, h);
    const over = scene.overrideMaterial, bg = scene.background;
    scene.overrideMaterial = this.posMat;
    scene.background = null;
    r.render(scene, cam);
    scene.overrideMaterial = over;
    scene.background = bg;
    this.pos.viewport.set(0, 0, LW, LH);
    r.setClearColor(clear, alpha);
    r.shadowMap.autoUpdate = auto;
    // the warp: each pixel takes the pixel of the frame before where its point was
    const u = this.warp.u, src = this.frames[this.cur]!, dst = this.frames[1 - this.cur]!;
    u.uPrev!.value = src.texture;
    u.uPos!.value = this.pos.texture;
    (u.uPrevVP!.value as THREE.Matrix4).multiplyMatrices(prev.projectionMatrix, prev.matrixWorldInverse);
    (u.uInvVP!.value as THREE.Matrix4).multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    (u.uRect!.value as THREE.Vector4).set(x, gy, w, h);
    this.warp.render(r, dst);
    this.cur = 1 - this.cur;
  }

  /** Writes the clean picture `pic` with the moshed key picture over it to `out`; `u` (0..1): how far the key picture has dissolved. */
  present(r: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, pic: THREE.Texture, u: number) {
    this.out.u.uSrc!.value = this.frames[this.cur]!.texture;
    this.out.u.uPic!.value = pic;
    this.out.u.uU!.value = u;
    this.out.render(r, out);
  }

  dispose() {
    this.pos.dispose();
    for (const f of this.frames) f.dispose();
    this.posMat.dispose();
    this.warp.dispose();
    this.copy.dispose();
    this.out.dispose();
  }
}
