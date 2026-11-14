// The air of the bridge (treatment v9 "Plate 5").
//   `AirLines`  thin streaks of air. Each one hangs at a fixed place in the air, and the train flies through them: they run past the
//               car and along its sides, and they bend round the nose. With `sv_wind 0` the train stops, so they stop where they
//               are: they go pale blue and sag, as threads of ice. When the tuna carry the train up, new ones run again.
//   `IceCoat`   the freeze of the car. From `sv_wind 0` a coat of frost creeps over the car from the nose; on each hit of the drum
//               fill of bar 40 the front jumps on, until the whole car is a block of ice with icicles on the eaves and under the
//               floor. The coat grows out of the car: its vertices rise in crystals. When the train falls, cracks run over the coat
//               from the nose and it bursts into shards, nose first. The shards keep the speed of the car, the air slows them, so
//               the falling train leaves them behind.
// `pose(t)` writes everything for time t: a pure function of t.
import * as THREE from 'three';
import { mulberry32, smooth } from '@pve/engine/util';
import { col, instanced, v3 } from '@pve/engine/lit';
import { T_DIVE, T_DROP, T_END, T_START, T_WIND, type TrainPath } from './_bridgepath';

const LINES = 150, SEGS = 4;
/** The lines repeat along the path with this period, m. A line is seen from 55 m ahead of the middle of the car to 35 m behind it. */
const PERIOD = 90, AHEAD = 55;
/** The air goes round a hull of this radius, m. */
const HULL = 2.7;
/** The lines have stopped by here, and the new ones run from here. */
const T_HELD = T_WIND + 0.6, T_AGAIN = 73.0;
const AIR = col('#b8d0ff'), ICE = col('#e4f6ff');

export class AirLines {
  readonly mesh: THREE.InstancedMesh;
  private lanes: { d: number; r: number; th: number }[] = [];
  /** The distance that the train has gone, at 72 Hz from T_START. */
  private dist: Float32Array;
  private o = new THREE.Object3D();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Color();
  private x = new THREE.Vector3(1, 0, 0);

  constructor(private path: TrainPath) {
    this.mesh = instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }), LINES * SEGS);
    const rnd = mulberry32(0x31d);
    for (let i = 0; i < LINES; i++) this.lanes.push({ d: rnd() * PERIOD, r: 0.6 + 10.5 * Math.pow(rnd(), 1.4), th: rnd() * Math.PI * 2 });
    const n = Math.ceil((T_END - T_START) * 72) + 2;
    this.dist = new Float32Array(n);
    for (let k = 1; k < n; k++) this.dist[k] = this.dist[k - 1]! + path.speed(T_START + (k - 0.5) / 72) / 72;
  }

  private gone(t: number): number {
    const f = Math.max(0, (t - T_START) * 72), k = Math.min(this.dist.length - 2, Math.floor(f));
    return this.dist[k]! + (this.dist[k + 1]! - this.dist[k]!) * (f - k);
  }

  /** A point of the stream line of lane (r, th) at `s` metres ahead of the middle of the car, in the car frame: the air opens round the nose and closes behind the tail. */
  private point(r0: number, th: number, s: number, sag: number, out: THREE.Vector3): THREE.Vector3 {
    const open = smooth((17 - s) / 8) * (1 - smooth((-10 - s) / 9));
    const r = Math.hypot(r0, HULL * open);
    return out.set(s, 1.85 + 0.85 * r * Math.sin(th) - sag, r * Math.cos(th));
  }

  pose(t: number) {
    const show = t >= T_START + 0.4 && t < T_DIVE;
    this.mesh.visible = show;
    if (!show) return;
    // the frame of the lines: the car now, or the car where it stopped
    const held = t >= T_WIND && t < T_AGAIN;
    const tf = held ? Math.min(t, T_HELD) : t;
    const m = this.path.matrix(tf);
    const speed = this.path.speed(Math.min(tf, T_WIND));
    const ice = held ? smooth((t - T_WIND) / 0.5) : 0;
    const len = Math.min(4.5, 0.11 * speed) * (t >= T_AGAIN ? smooth((t - T_AGAIN) / 0.7) : 1);
    const thick = 0.04 + 0.05 * ice;
    const D = this.gone(tf);
    this.c.copy(AIR).lerp(ICE, ice).multiplyScalar(1.2 + 0.5 * ice);
    let n = 0;
    for (const l of this.lanes) {
      const head = AHEAD - ((((D - l.d) % PERIOD) + PERIOD) % PERIOD);
      for (let j = 0; j < SEGS; j++) {
        // a thread of ice sags in its middle
        const sagA = ice * 0.35 * Math.sin((Math.PI * j) / SEGS), sagB = ice * 0.35 * Math.sin((Math.PI * (j + 1)) / SEGS);
        this.point(l.r, l.th, head + (len * j) / SEGS, sagA, this.a).applyMatrix4(m);
        this.point(l.r, l.th, head + (len * (j + 1)) / SEGS, sagB, this.b).applyMatrix4(m);
        const o = this.o;
        o.position.copy(this.a).add(this.b).multiplyScalar(0.5);
        const d = this.b.sub(this.a), L = d.length();
        o.quaternion.setFromUnitVectors(this.x, d.divideScalar(L || 1));
        o.scale.set(Math.max(0.0001, L), thick, thick);
        o.updateMatrix();
        this.mesh.setMatrixAt(n, o.matrix);
        this.mesh.setColorAt(n, this.c);
        n++;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** The coat: its box round the car (m: length, height, width; the lowest y), the thickest frost (m), the highest crystals (m). */
const COAT = { L: 20.1, H: 3.5, W: 2.96, y0: 0.32 } as const;
const COAT_THICK = 0.08, COAT_SPIKE = 0.2;
/** The front of the frost is this far from the nose (m) when the fill starts; the rest goes on the hits of the fill. */
const CREEP = 6.0;
/** The break: the cracks run for this long (s) from the start of the fall, then the coat bursts, nose to tail, over BURST_RUN (s). */
const CRACK_RUN = 0.12, BURST_RUN = 0.25;
/** The shards: how many, how long they fly (s), the drag of the air (1/s), gravity (m/s2). */
const SHARDS = 420, SHARD_LIFE = 1.8, DRAG = 2.2, GRAV = 9.8;
const ICICLES = 64;

const NOISE_GLSL = /* glsl */ `
float icH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float icN(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(icH(i), icH(i + vec3(1, 0, 0)), f.x), mix(icH(i + vec3(0, 1, 0)), icH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(icH(i + vec3(0, 0, 1)), icH(i + vec3(1, 0, 1)), f.x), mix(icH(i + vec3(0, 1, 1)), icH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// the rounded normal of the coat box at a point: one value for each point, so the faces of the box move together at their edges
vec3 icNormal(vec3 p) {
  vec3 q = (p - vec3(0.0, ${(COAT.y0 + COAT.H / 2).toFixed(3)}, 0.0)) / vec3(${(COAT.L / 2).toFixed(3)}, ${(COAT.H / 2).toFixed(3)}, ${(COAT.W / 2).toFixed(3)});
  return normalize(sign(q) * pow(abs(q), vec3(8.0)));
}
// how far the frost covers the point: 0 ahead of the front, 1 behind it. The front is ragged
float icMask(vec3 p, float front) { return smoothstep(-0.35, 0.35, p.x - front + 1.1 * (icN(p * 0.9) - 0.5)); }`;

/** The x of the front of the frost at time t (the nose is at +x): it creeps from the wind stop, then jumps on each hit of the fill. */
function frontAt(t: number, hits: readonly number[]): number {
  const nose = COAT.L / 2 + 0.6, tail = -COAT.L / 2 - 0.6;
  if (t < T_WIND) return nose;
  let f = nose - CREEP * smooth((t - T_WIND) / (hits[0]! - T_WIND));
  hits.forEach((h, k) => {
    // each hit: the front jumps on in 2 frames
    const from = nose - CREEP + ((tail - nose + CREEP) * k) / hits.length, to = nose - CREEP + ((tail - nose + CREEP) * (k + 1)) / hits.length;
    if (t >= h) f = from + (to - from) * smooth((t - h) / (2 / 36));
  });
  return f;
}

/** The time at which the coat bursts at x. */
const burstAt = (x: number) => T_DROP + CRACK_RUN + (BURST_RUN * (COAT.L / 2 - x)) / COAT.L;

export class IceCoat {
  /** Add it to the root of the car. */
  readonly root = new THREE.Group();
  /** Add it to the scene: the shards fly in the world. */
  readonly shards: THREE.InstancedMesh;
  private coat: THREE.Mesh;
  private coatMat: THREE.ShaderMaterial;
  private icicles: THREE.InstancedMesh;
  private icicleData: { x: number; y: number; z: number; len: number }[] = [];
  private shardData: { tb: number; p0: THREE.Vector3; v0: THREE.Vector3; q0: THREE.Quaternion; ax: THREE.Vector3; w: number; s: THREE.Vector3 }[] = [];
  private iceMat = new THREE.MeshLambertMaterial({ color: col('#e4f6ff'), emissive: col('#4a7ca8'), flatShading: true });
  private o = new THREE.Object3D();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();

  /** `hits`: the times of the hits of the fill, in order. */
  constructor(private hits: readonly number[], path: TrainPath) {
    this.coatMat = IceCoat.coatMaterial();
    const box = new THREE.BoxGeometry(COAT.L, COAT.H, COAT.W, 110, 22, 18).translate(0, COAT.y0 + COAT.H / 2, 0);
    this.coat = new THREE.Mesh(box, this.coatMat);
    this.coat.frustumCulled = false;
    this.root.add(this.coat);
    const rnd = mulberry32(0x1ce);
    this.icicles = this.buildIcicles(rnd);
    this.root.add(this.icicles);
    this.shards = this.buildShards(rnd, path);
    this.shards.count = 0;
  }

  /** The icicles: on both eaves and under both edges of the floor. */
  private buildIcicles(rnd: () => number): THREE.InstancedMesh {
    const cone = new THREE.ConeGeometry(0.12, 1, 5).rotateX(Math.PI).translate(0, -0.5, 0);
    const icicles = instanced(cone, this.iceMat, ICICLES);
    for (let k = 0; k < ICICLES; k++) {
      const eave = k % 3 !== 0;
      this.icicleData.push({
        x: (rnd() - 0.5) * (COAT.L - 0.6), y: eave ? COAT.y0 + COAT.H - 0.25 : COAT.y0 + 0.05,
        z: (rnd() < 0.5 ? -1 : 1) * (COAT.W / 2 + 0.05), len: (eave ? 0.5 : 0.3) + rnd() * (eave ? 1.4 : 0.8),
      });
    }
    return icicles;
  }

  /** The shards: plates of the coat (and the icicles), laid over the sides, the roof and the ends of the box. */
  private buildShards(rnd: () => number, path: TrainPath): THREE.InstancedMesh {
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const shards = instanced(geo, this.iceMat, SHARDS);
    const faces = [
      { a: COAT.L * COAT.H, n: v3(0, 0, 1) }, { a: COAT.L * COAT.H, n: v3(0, 0, -1) }, { a: COAT.L * COAT.W, n: v3(0, 1, 0) },
      { a: COAT.W * COAT.H, n: v3(1, 0, 0) }, { a: COAT.W * COAT.H, n: v3(-1, 0, 0) },
    ];
    const total = faces.reduce((s, f) => s + f.a, 0), up = v3(0, 1, 0);
    for (let k = 0; k < SHARDS; k++) {
      let r = rnd() * total, f = faces[0]!;
      for (const g of faces) { if (r < g.a) { f = g; break; } r -= g.a; }
      const u = rnd() - 0.5, w = rnd() - 0.5, n = f.n;
      const local = n.y > 0 ? v3(u * COAT.L, COAT.y0 + COAT.H, w * COAT.W)
        : n.z !== 0 ? v3(u * COAT.L, COAT.y0 + (w + 0.5) * COAT.H, (n.z * COAT.W) / 2)
        : v3((n.x * COAT.L) / 2, COAT.y0 + (w + 0.5) * COAT.H, u * COAT.W);
      local.addScaledVector(n, 0.1);
      const tb = burstAt(local.x), M = path.matrix(tb), rot = new THREE.Quaternion().setFromRotationMatrix(M);
      const nw = n.clone().applyQuaternion(rot);
      const v0 = path.at(tb).v.clone().addScaledVector(nw, 2 + 5 * rnd()).add(v3(rnd() - 0.5, rnd() - 0.2, rnd() - 0.5).multiplyScalar(3));
      const q0 = rot.clone().multiply(new THREE.Quaternion().setFromUnitVectors(up, n)).multiply(new THREE.Quaternion().setFromAxisAngle(up, rnd() * 6.28));
      const sz = 0.18 + 0.4 * rnd() * rnd();
      this.shardData.push({
        tb, p0: local.applyMatrix4(M), v0, q0, ax: v3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), w: 4 + 10 * rnd(),
        s: v3(sz * (1 + rnd()), sz * 0.3, sz * (0.8 + 0.6 * rnd())),
      });
    }
    return shards;
  }

  /** The material of the coat: it rises out of the car in crystals where the front has passed, and cracks and bursts in the fall. */
  private static coatMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { uFront: { value: COAT.L }, uThick: { value: 0 }, uTime: { value: 0 }, uCrack: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uFront, uThick;
        varying vec3 vP;
        varying vec3 vN;
        varying vec3 vView;
        varying float vM;
        ${NOISE_GLSL}
        void main() {
          vec3 p = position;
          vec3 n = icNormal(p);
          float m = icMask(p, uFront);
          // the coat rises out of the car: lumps of frost and crystals that stand up from them
          float spike = pow(icN(p * 3.3), 5.0);
          p += n * (0.02 + m * (uThick * (0.4 + icN(p * 1.6)) + ${COAT_SPIKE.toFixed(2)} * spike * smoothstep(0.3, 1.0, m)));
          vP = position;
          vM = m;
          vN = normalize(normalMatrix * n);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uCrack;
        varying vec3 vP;
        varying vec3 vN;
        varying vec3 vView;
        varying float vM;
        ${NOISE_GLSL}
        void main() {
          if (vM < 0.02) discard;
          // the coat is gone where it has burst
          if (uTime >= ${T_DROP.toFixed(3)} + ${CRACK_RUN.toFixed(3)} + ${BURST_RUN.toFixed(3)} * (${(COAT.L / 2).toFixed(3)} - vP.x) / ${COAT.L.toFixed(3)}) discard;
          // the facets of the moved surface light the crystals: the normal of the drawn triangle, in view space
          vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
          if (dot(n, vView) < 0.0) n = -n;
          float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.0);
          float lit = clamp(dot(n, normalize(vec3(0.35, 0.8, 0.5))), 0.0, 1.0);
          // feathers of frost: ridged noise
          float fe = 1.0 - abs(2.0 * icN(vP * 3.0 + 2.0 * icN(vP * 9.0)) - 1.0);
          vec3 c = mix(vec3(0.16, 0.36, 0.56), vec3(0.72, 0.86, 0.95), clamp(0.5 * fe + 0.5 * fres, 0.0, 1.0));
          c *= 0.45 + 0.75 * lit;
          // glints: single grains that flash
          vec3 g = floor(vP * 11.0);
          float h = icH(g);
          c += vec3(2.2) * step(0.993, h) * max(0.0, sin(uTime * 18.0 + h * 80.0));
          // the cracks: the edges of cells of ice, from the nose back, as the fall starts
          vec3 cp = vP * 1.4, ci = floor(cp);
          float f1 = 9.0, f2 = 9.0;
          for (int k = 0; k < 27; k++) {
            vec3 o = vec3(float(k % 3) - 1.0, float((k / 3) % 3) - 1.0, float(k / 9) - 1.0);
            vec3 r = ci + o + vec3(icH(ci + o), icH(ci + o + 7.1), icH(ci + o + 13.3)) - cp;
            float d = dot(r, r);
            if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
          }
          float edge = 1.0 - smoothstep(0.0, 0.06, sqrt(f2) - sqrt(f1));
          float run = step((${(COAT.L / 2).toFixed(3)} - vP.x) / ${COAT.L.toFixed(3)}, uCrack * 1.3);
          c += vec3(0.7, 0.95, 1.0) * 2.5 * edge * run;
          // thin frost where the feathers are thin: the car shows through; the crystals and the rim are thick
          gl_FragColor = vec4(c, vM * clamp(0.35 + 0.45 * fe + 0.3 * fres, 0.0, 0.92));
        }`,
      transparent: true, depthWrite: false,
    });
  }

  pose(t: number) {
    const front = frontAt(t, this.hits), cover = (COAT.L / 2 + 0.6 - front) / (COAT.L + 1.2);
    const u = this.coatMat.uniforms;
    u.uFront!.value = front;
    u.uThick!.value = COAT_THICK * smooth(cover / 0.6);
    u.uTime!.value = t;
    u.uCrack!.value = Math.min(1, Math.max(0, (t - T_DROP) / CRACK_RUN));
    const on = t >= T_WIND && t < burstAt(-COAT.L / 2) + 0.01;
    this.coat.visible = on;
    this.icicles.visible = on;
    if (on) {
      // an icicle grows once the frost has passed it, and goes with the coat where it bursts
      this.icicleData.forEach((d, k) => {
        const g = t < burstAt(d.x) ? smooth((d.x - front - 0.5) / 2.5) : 0;
        this.o.position.set(d.x, d.y, d.z);
        this.o.quaternion.identity();
        this.o.scale.set(Math.max(0.0001, g), Math.max(0.0001, d.len * g), Math.max(0.0001, g));
        this.o.updateMatrix();
        this.icicles.setMatrixAt(k, this.o.matrix);
      });
      this.icicles.instanceMatrix.needsUpdate = true;
    }
    // the shards: the speed of the car at the burst, slowed by the air and pulled down
    let n = 0;
    for (const d of this.shardData) {
      const tau = t - d.tb;
      if (tau < 0 || tau >= SHARD_LIFE) continue;
      const e = (1 - Math.exp(-DRAG * tau)) / DRAG, vt = GRAV / DRAG;
      this.p.copy(d.p0).addScaledVector(d.v0, e);
      this.p.y += vt * e - vt * tau;
      this.o.position.copy(this.p);
      this.o.quaternion.copy(d.q0).premultiply(this.q.setFromAxisAngle(d.ax, d.w * tau));
      this.o.scale.copy(d.s).multiplyScalar(1 - smooth((tau - SHARD_LIFE + 0.4) / 0.4));
      this.o.updateMatrix();
      this.shards.setMatrixAt(n++, this.o.matrix);
    }
    this.shards.count = n;
    this.shards.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.coat.geometry.dispose();
    this.coatMat.dispose();
    this.icicles.geometry.dispose();
    this.shards.geometry.dispose();
    this.iceMat.dispose();
  }
}
