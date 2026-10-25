// Benchmark of GLSL_COMMON (glsl/common.ts): a full-frame FSPass of fbm (6 octaves of 2D simplex) plus
// one 3D simplex per pixel. Engine modules load with import() in setup (bun test imports this file).
import { defineBench } from '../bench/kit';
import type { EffectBench } from '../bench/types';

export const bench: EffectBench[] = [
  defineBench({
    id: 'glsl.noise',
    kind: 'helper',
    async setup() {
      const { FSPass, makeRT, W, H } = await import('../gl');
      const pass = new FSPass(/* glsl */ `
        uniform float time;
        void main() {
          vec2 p = (vUv - 0.5) * vec2(${(W / H).toFixed(6)}, 1.0) * 6.0;
          float n = fbm(p + time, 6) * 0.6 + snoise(vec3(p * 2.0, time)) * 0.4;
          fragColor = vec4(heat(n * 0.5 + 0.5), 1.0);
        }`, { time: { value: 0 } });
      return { pass, rt: makeRT() };
    },
    run({ renderer }, s) {
      s.pass.u.time!.value += 1 / 60;
      s.pass.render(renderer, s.rt);
    },
    dispose(_, s) {
      s.pass.mat.dispose();
      s.rt.dispose();
    },
  }),
  defineBench({
    id: 'glsl.raymarch.unconstrained',
    kind: 'helper',
    async setup() {
      const [{ FSPass, makeRT }, THREE] = await Promise.all([import('../gl'), import('three')]);
      const pass = new FSPass(/* glsl */ `
        uniform vec3 ro;
        uniform float time;
        float sdTorusKnot(vec3 p) {
          vec2 q = vec2(length(p.xz) - 1.2, p.y);
          float a = atan(p.z, p.x);
          vec2 cs = vec2(cos(a * 2.5 + time), sin(a * 2.5 + time));
          return length(q - cs * 0.4) - 0.18;
        }
        void main() {
          vec3 rd = camRay(FRAG_PX, ro, vec3(0.0), 0.6, 0.0);
          float t = 0.02;
          vec3 col = C_INK;
          for (int i = 0; i < 96; i++) {
            vec3 p = ro + rd * t;
            float d = sdTorusKnot(p);
            if (d < 0.001) { col = C_BONE; break; }
            t += d * 0.9;
            if (t > 20.0) break;
          }
          fragColor = vec4(col, 1.0);
        }`, {
        ro: { value: new THREE.Vector3(0, 0, 5) },
        time: { value: 0 },
      });
      return { pass, rt: makeRT() };
    },
    run({ renderer }, s) {
      s.pass.u.time!.value += 1 / 60;
      s.pass.render(renderer, s.rt);
    },
    dispose(_, s) {
      s.pass.mat.dispose();
      s.rt.dispose();
    },
  }),
  defineBench({
    id: 'glsl.raymarch.culled',
    kind: 'helper',
    async setup() {
      const [{ FSPass, makeRT }, THREE] = await Promise.all([import('../gl'), import('three')]);
      const pass = new FSPass(/* glsl */ `
        uniform vec3 ro;
        uniform float time;
        float sdTorusKnot(vec3 p) {
          vec2 q = vec2(length(p.xz) - 1.2, p.y);
          float a = atan(p.z, p.x);
          vec2 cs = vec2(cos(a * 2.5 + time), sin(a * 2.5 + time));
          return length(q - cs * 0.4) - 0.18;
        }
        void main() {
          vec3 rd = camRay(FRAG_PX, ro, vec3(0.0), 0.6, 0.0);
          float t0, t1;
          if (!raySphere(ro, rd, vec3(0.0), 1.8, t0, t1)) {
            fragColor = vec4(C_INK, 1.0);
            return;
          }
          float t = max(0.02, t0);
          vec3 col = C_INK;
          float focal = 540.0 / tan(0.6 * 0.5);
          for (int i = 0; i < 96; i++) {
            vec3 p = ro + rd * t;
            float d = sdTorusKnot(p);
            if (d < hitEps(t, focal, 0.001)) { col = C_BONE; break; }
            t += d * 0.9;
            if (t > t1) break;
          }
          fragColor = vec4(col, 1.0);
        }`, {
        ro: { value: new THREE.Vector3(0, 0, 5) },
        time: { value: 0 },
      });
      return { pass, rt: makeRT() };
    },
    run({ renderer }, s) {
      s.pass.u.time!.value += 1 / 60;
      s.pass.render(renderer, s.rt);
    },
    dispose(_, s) {
      s.pass.mat.dispose();
      s.rt.dispose();
    },
  }),
];
