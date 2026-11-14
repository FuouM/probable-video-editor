// The bass of the bridge (track 5) as a rumble of the ground, as when a subwoofer plays. While a bass note sounds the vertices of the
// terrain and of the cloud deck shake: each vertex jumps on its own, a new jump every frame. The shake is hard on the attack, holds
// for as long as the note is held, and stops shortly after the note ends. It starts under the train and spreads out fast; it is
// weaker far from the train. A faint warm light comes up where the ground shakes most.
// `BassHeave.pose(t)` writes everything for time t: a pure function of t. The rumble holds when the wind stops, as the fireworks do.
import * as THREE from 'three';
import { col, litMaterial, type LitAtlas } from '@pve/engine/lit';
import { smooth } from '@pve/engine/util';
import { T_END, T_START, type TrainPath } from './_bridgepath';
import { windAge, type BridgeMidi } from './_bridgelights';

const BASS_TRACK = 5;
/** How many notes shake at most; the envelope: the attack peak and its decay (s), the level while held, the release (s). */
const HITS = 8, PEAK = 1.6, PEAK_DECAY = 0.12, HOLD = 0.75, RELEASE = 0.1;
/** How fast the rumble spreads (m/s) and how far it reaches (m, 1/e). */
const SPREAD = 450, FALL = 160;
/** The size of the jumps (m): up and down, and to the sides. The jumps change this many times a second. */
const SHAKE_Y = 0.9, SHAKE_XZ = 0.35, RATE = 36;
/** The colour of the light of the rumble for the lowest and the highest note, and its strength. */
const GLOW_LO = '#ff4a1a', GLOW_HI = '#ffc23a', GLOW = 0.12;

interface Hit { t: number; dur: number; x: number; z: number; s: number; c: THREE.Color }

/** The strength of a note of length `dur` at age `age`: a hard attack that settles to the held level, then a short release. */
function envelope(age: number, dur: number): number {
  const held = HOLD + (PEAK - HOLD) * Math.exp(-age / PEAK_DECAY);
  return smooth(age / 0.02) * held * (1 - smooth((age - dur) / RELEASE));
}

export class BassHeave {
  /** The material of the terrain and of the cloud deck: the lit material that shakes its vertices on the bass. */
  readonly mat: THREE.MeshLambertMaterial;
  private hits: Hit[] = [];
  /** The notes that sound at the time of the last pose: centre x, z, age (held at the wind stop), strength. */
  private hit = Array.from({ length: HITS }, () => new THREE.Vector4());
  private hitCol = Array.from({ length: HITS }, () => new THREE.Color());

  constructor(A: LitAtlas, path: TrainPath, midi: BridgeMidi) {
    const ns = midi.notes.filter((n) => n.track === BASS_TRACK && n.start >= T_START - 1e-6 && n.start < T_END);
    const lo = Math.min(...ns.map((n) => n.pitch)), hi = Math.max(...ns.map((n) => n.pitch));
    for (const n of ns) {
      // low notes shake harder
      const u = hi > lo ? (n.pitch - lo) / (hi - lo) : 0.5, p = path.at(n.start).p;
      this.hits.push({ t: n.start, dur: n.end - n.start, x: p.x, z: p.z, s: 1.25 - 0.5 * u, c: col(GLOW_LO).lerp(col(GLOW_HI), u) });
    }
    this.hits.sort((a, b) => a.t - b.t);

    this.mat = litMaterial(A, {
      extra: {
        key: 'bass-rumble',
        uniforms: { uHit: { value: this.hit }, uHitCol: { value: this.hitCol } },
        vertHead: `uniform vec4 uHit[${HITS}];
uniform vec3 uHitCol[${HITS}];
varying vec3 vRumbleGlow;
float rbHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`,
        vertBody: `
vec3 rbP = (modelMatrix * vec4(transformed, 1.0)).xyz;
// the key of the vertex: its place at rest, so the faces that share a vertex jump together
vec3 rbK = floor(rbP * 4.0 + 0.5) / 4.0;
vec3 rbD = vec3(0.0);
vRumbleGlow = vec3(0.0);
for (int i = 0; i < ${HITS}; i++) {
  vec4 h = uHit[i];
  if (h.w <= 0.0) continue;
  float age = h.z, d = length(rbP.xz - h.xy);
  // the front spreads out from the train; the shake is weaker far from it
  float a = h.w * smoothstep(0.0, 25.0, ${SPREAD.toFixed(1)} * age - d + 25.0) * exp(-d / ${FALL.toFixed(1)});
  float f = floor(age * ${RATE.toFixed(1)}) + float(i) * 17.0;
  rbD += a * vec3(${SHAKE_XZ.toFixed(2)} * (rbHash(rbK + f) - 0.5), ${SHAKE_Y.toFixed(2)} * (2.0 * rbHash(rbK + f + 3.1) - 1.0), ${SHAKE_XZ.toFixed(2)} * (rbHash(rbK + f + 7.3) - 0.5));
  vRumbleGlow += uHitCol[i] * a * ${GLOW.toFixed(2)};
}
transformed += rbD;`,
        fragHead: 'varying vec3 vRumbleGlow;',
        emit: 'vRumbleGlow',
      },
    });
  }

  pose(t: number) {
    // the notes that sound: the newest first
    let n = 0;
    for (let k = this.hits.length - 1; k >= 0 && n < HITS; k--) {
      const h = this.hits[k]!;
      if (h.t > t) continue;
      const age = windAge(h.t, t);
      if (age >= h.dur + RELEASE) continue;
      this.hit[n]!.set(h.x, h.z, age, h.s * envelope(age, h.dur));
      this.hitCol[n]!.copy(h.c);
      n++;
    }
    for (; n < HITS; n++) this.hit[n]!.w = 0;
  }

  dispose() {
    this.mat.dispose();
  }
}
