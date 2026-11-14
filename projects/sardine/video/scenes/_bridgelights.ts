// The world of the bridge plays the music (treatment v9 "Plate 5", "Music reactivity"). All of it is far from the train or
// behind it, so nothing covers the train, and all of it is large:
//   arps (tracks 2, 3, 4)  light pillars far behind the ridges: one beam for each note, its place across the frame from its pitch.
//                          From the catch: the gates of light along the climb and the pools of light in the cloud deck
//   chords (track 14)      the aurora: three curtains round the whole sky, one of them flares on each chord. A salvo of fireworks
//   kick (19), snare (18)  the rims of the ridges and of the peaks of the cloud deck, the stars, the rings of stars round the moon.
//                          One firework on each snare
//   after the wind stops   the frost on the window grows one step on each kick; ice bursts on the kicks. A firework opens and stays
//                          in the air, frozen, until the tuna have the train
// and the tuna that catch the falling train and carry it. The camera never moves on the music.
// `BridgeLights.pose(t)` writes everything for time t: a pure function of t.
import * as THREE from 'three';
import { mulberry32, stepT, smooth } from '@pve/engine/util';
import { col, glowMaterial, instanced, type LitAtlas } from '@pve/engine/lit';
import { TunaSchool } from './_tuna';
import { T_CLIMB, T_DIVE, T_DROP, T_END, T_LAUNCH, T_MOON, T_PULL, T_START, T_WIND, type TrainPath } from './_bridgepath';

export interface BridgeMidi { notes: readonly { track: number; start: number; end: number; pitch: number }[] }
/** The camera of the ride window at time t, with its matrices up to date. The result is a scratch object: read it at once. */
export type CamAt = (t: number) => THREE.PerspectiveCamera;
export interface Peak { x: number; z: number; base: number; r: number; h: number; layer: number }

/**
 * The arp tracks: how far off their pillars stand (m), how wide a pillar is (m), the colour, and the lane of the frame (NDC x, from and
 * to) where the pitches of the track go. The lanes do not overlap, so the beams of two tracks never stand on each other.
 */
const ARPS = [
  { track: 2, dist: 2000, w: 26, col: '#ffd23a', lane: [-0.86, -0.34] },
  { track: 4, dist: 1850, w: 20, col: '#ff4ad8', lane: [-0.22, 0.22] },
  { track: 3, dist: 1700, w: 16, col: '#3ae8ff', lane: [0.34, 0.86] },
] as const;
const PILLAR_LIFE = 0.5, PILLARS = 48;
const CHORD_TRACK = 14;
const AURORA: { r: number; y: number; h: number; lo: string; hi: string }[] = [
  { r: 2600, y: 380, h: 520, lo: '#3affa0', hi: '#5a7aff' },
  { r: 2800, y: 520, h: 640, lo: '#7affd0', hi: '#c84aff' },
  { r: 3000, y: 300, h: 460, lo: '#4ad8ff', hi: '#ff5aa8' },
];
const RIM_KICK = '#bfe0ff', RIM_SNARE = '#ff7ac0';
const BURST_N = 16, BURST_LIFE = 0.55, BURSTS = 6 * BURST_N;
/** A firework: this many sparks, and they live this long. The frozen ones stay until the wind runs again. */
const SPARKS = 44, SHELL_LIFE = 1.3, SHELLS = 30, T_AGAIN = 73.0;
const SHELL_COLS = ['#ff3a4a', '#ffb02a', '#ffe66a', '#ff5ac8', '#6af0ff', '#9a7aff', '#7aff9a'];
const ICE_SPARK = new THREE.Color('#d8f2ff');
const TUNA_N = 11;
/** The tuna rise from below the deck from here and hold the car from T_CATCH. */
const T_SWOOP = 72.2, T_CATCH = T_PULL - 0.2;
/** After the catch the sway of the tuna and their turn to the car's heading come in over this time, s. */
const CATCH_EASE = 0.6;
/** Two tuna change places under the car: the time, and the two fish. */
const SWAPS: readonly (readonly [number, number, number])[] = [[76.9, 0, 4], [78.67, 3, 7], [80.44, 2, 6], [82.22, 1, 5], [83.6, 4, 8]];
/** One tuna loses its hold, falls back and comes in again. */
const LOST = { fish: 9, from: 77.5, to: 79.5 } as const;

const unique = (a: number[]) => [...new Set(a.map((t) => Math.round(t * 1000)))].sort((x, y) => x - y).map((ms) => ms / 1000);

/** The time since the last element of the sorted `a` that is <= t (Infinity when there is none). */
export function since(a: readonly number[], t: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m]! <= t) lo = m + 1; else hi = m; }
  return lo > 0 ? t - a[lo - 1]! : Infinity;
}

/** A note of the bridge: from its first frame up to its end. */
const inside = (t: number) => t >= T_START - 1e-6 && t < T_END;

/**
 * The age at time t of a thing that started at `t0` (a firework, a bass wave): after the wind stops it goes on a moment and then holds,
 * until the wind runs again.
 */
export function windAge(t0: number, t: number): number {
  if (t < T_WIND || t0 >= T_AGAIN) return t - t0;
  const held = t0 < T_WIND ? T_WIND - t0 : Math.min(Math.min(t, T_AGAIN) - t0, 0.3);
  return t < T_AGAIN ? held : held + (t - T_AGAIN);
}

/** The unit ray of the camera through the point (x, y) of its frame (-1..1 each way). */
export function rayOf(cam: THREE.PerspectiveCamera, x: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, 0.5).unproject(cam).sub(cam.position).normalize();
}

interface Pillar { t: number; x: number; z: number; y0: number; h: number; w: number; c: THREE.Color }
interface Burst { t: number; snare: boolean; o: THREE.Vector3; dirs: THREE.Vector3[]; spin: number[]; c: THREE.Color; size: number }
interface Shell { t: number; o: THREE.Vector3; R: number; w: number; c: THREE.Color; c2: THREE.Color; dirs: THREE.Vector3[] }

export class BridgeLights {
  readonly root = new THREE.Group();
  readonly kicks: number[];
  readonly snares: number[];
  /** Every arp note time, sorted: the letters of the lines take their light from them. */
  readonly arpTimes: number[];
  private frostKicks: number[];
  private pillars: THREE.InstancedMesh;
  private notes: Pillar[] = [];
  private aurora: THREE.Mesh[] = [];
  private chords: number[];
  private rims: THREE.Mesh[] = [];
  private shards: THREE.InstancedMesh;
  private bursts: Burst[] = [];
  private tuna: TunaSchool;
  private tunaSlots: THREE.Vector3[] = [];
  private tunaFrom: THREE.Vector3[] = [];
  private shells: Shell[] = [];
  private sparks: THREE.InstancedMesh;
  /** The light of the fireworks on the train and on the clouds. */
  private flash = new THREE.PointLight('#ffffff', 0, 260, 1.2);
  private starRings: { group: THREE.Group; mat: THREE.MeshBasicMaterial }[] = [];
  private gates: THREE.InstancedMesh;
  private gateAt: THREE.Vector3[] = [];
  private pools: THREE.InstancedMesh;
  private poolAt: THREE.Vector3[] = [];
  private arpNotes: { t: number; c: THREE.Color }[] = [];
  private x = new THREE.Vector3(1, 0, 0);
  private d = new THREE.Vector3();
  private o = new THREE.Object3D();
  private c = new THREE.Color();

  constructor(A: LitAtlas, mat: THREE.Material, private path: TrainPath, midi: BridgeMidi, cam: CamAt, peaks: readonly Peak[]) {
    this.kicks = unique(midi.notes.filter((n) => n.track === 19 && inside(n.start)).map((n) => n.start));
    this.snares = unique(midi.notes.filter((n) => n.track === 18 && inside(n.start)).map((n) => n.start));
    this.chords = unique(midi.notes.filter((n) => n.track === CHORD_TRACK && inside(n.start)).map((n) => n.start));
    this.frostKicks = this.kicks.filter((k) => k >= T_WIND - 1e-3 && k < T_WIND + 2.4);
    this.arpTimes = unique(midi.notes.filter((n) => ARPS.some((a) => a.track === n.track) && inside(n.start)).map((n) => n.start));
    this.pillars = this.buildPillars(midi, cam);
    this.buildAurora();
    this.buildRims(peaks);
    this.shards = this.buildBursts();
    this.sparks = this.buildShells(cam);
    this.buildStarRings();
    this.gates = this.buildGates(midi);
    this.pools = this.buildPools();
    this.root.add(this.gates, this.pools);
    this.tuna = this.buildTuna(A, mat);
  }

  /** The arp pillars: one beam for each arp note. */
  private buildPillars(midi: BridgeMidi, cam: CamAt): THREE.InstancedMesh {
    const pillars = instanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), glowMaterial(), PILLARS, { color: true });
    this.root.add(pillars);
    for (const a of ARPS) {
      const ns = midi.notes.filter((n) => n.track === a.track && inside(n.start));
      if (!ns.length) continue;
      const lo = Math.min(...ns.map((n) => n.pitch)), hi = Math.max(...ns.map((n) => n.pitch));
      const base = col(a.col);
      for (const n of ns) {
        // the pitch is the place across the lane of the track in the frame: a piano roll that stands in the sky. The beam stands still
        // in the world: `placeBeam` looks ahead at the camera of its whole life and puts it where the lane is on the mean
        const u = hi > lo ? (n.pitch - lo) / (hi - lo) : 0.5;
        this.notes.push({
          t: n.start, ...this.placeBeam(cam, n.start, a.lane[0] + (a.lane[1] - a.lane[0]) * u, a.dist), w: a.w,
          c: base.clone().lerp(new THREE.Color(1, 1, 1), 0.35 * (((n.pitch % 12) + 12) % 12) / 11),
        });
      }
    }
    this.notes.sort((p, q) => p.t - q.t);
    return pillars;
  }

  /** The aurora: curtains round the whole sky, so every view of the ride cam has them. */
  private buildAurora() {
    for (const [k, a] of AURORA.entries()) {
      const g = new THREE.CylinderGeometry(a.r, a.r, a.h, 120, 4, true);
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const cols = new Float32Array(pos.count * 3);
      const lo = col(a.lo), hi = col(a.hi), cc = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const ang = Math.atan2(z, x);
        const v = y / a.h + 0.5; // 0 at the foot, 1 at the top
        // the foot of the curtain waves; the rays are bright and dark bands along the angle
        pos.setY(i, y + 70 * Math.sin(5 * ang + 1.9 * k) + 30 * Math.sin(13 * ang + k));
        const ray = 0.55 + 0.45 * Math.sin(41 * ang + 3 * Math.sin(7 * ang + k));
        const level = v <= 0.01 ? 0 : v < 0.3 ? 1 : v < 0.55 ? 0.7 : v < 0.8 ? 0.32 : 0;
        cc.copy(lo).lerp(hi, smooth((v - 0.2) / 0.6)).multiplyScalar(level * ray);
        cols.set([cc.r, cc.g, cc.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      const m = glowMaterial();
      m.vertexColors = true;
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = -2;
      this.aurora.push(mesh);
      this.root.add(mesh);
    }
  }

  /** The rims: a bright line along both flanks of each peak, just outside its outline. One mesh for each layer. */
  private buildRims(peaks: readonly Peak[]) {
    for (let layer = 0; layer < 4; layer++) {
      const P: number[] = [];
      const bar = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number) => {
        // a thin quad from a to b; its width lies in the plane of the two flanks
        const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
        const nx = (-dy * (dx / (Math.hypot(dx, dz) || 1))) / len, ny = Math.hypot(dx, dz) / len, nz = (-dy * (dz / (Math.hypot(dx, dz) || 1))) / len;
        const h = w / 2;
        const q = [[ax - nx * h, ay - ny * h, az - nz * h], [bx - nx * h, by - ny * h, bz - nz * h], [bx + nx * h, by + ny * h, bz + nz * h], [ax + nx * h, ay + ny * h, az + nz * h]] as const;
        for (const i of [0, 1, 2, 0, 2, 3]) P.push(...q[i]!);
      };
      for (const p of peaks) {
        if (p.layer !== layer) continue;
        const w = layer === 3 ? 1.6 : 3 + 1.5 * layer, top = p.base + p.h + w, out = p.r + w;
        for (const s of [-1, 1]) {
          bar(p.x, top, p.z, p.x + s * out, p.base, p.z, w);
          // the peaks of the cloud deck stand on both sides of the line: the view along the line sees these flanks
          if (layer === 3) bar(p.x, top, p.z, p.x, p.base, p.z + s * out, w);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      const mesh = new THREE.Mesh(g, glowMaterial());
      mesh.frustumCulled = false;
      this.rims.push(mesh);
      this.root.add(mesh);
    }
  }

  /** The bursts after the wind stops: ice on the kicks (round the train, on its far side). */
  private buildBursts(): THREE.InstancedMesh {
    const shards = instanced(new THREE.TetrahedronGeometry(1), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }), BURSTS, { color: true });
    this.root.add(shards);
    for (const t of this.kicks) {
      if (t < T_WIND - 1e-6 || t >= T_DIVE) continue;
      const r = mulberry32(Math.round(t * 1000) + 19);
      const p = this.path.at(t).p;
      const o = new THREE.Vector3(p.x + 4 + 16 * r(), p.y + (r() - 0.3) * 10, -6 - 16 * r());
      const dirs = Array.from({ length: BURST_N }, () => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(12 * (0.6 + 0.6 * r())));
      this.bursts.push({ t, snare: false, o, dirs, spin: dirs.map(() => r() * 6), c: col('#bfe8ff'), size: 0.9 });
    }
    this.bursts.sort((p, q) => p.t - q.t);
    return shards;
  }

  /**
   * The fireworks: one shell on each snare, a salvo of three on each chord. Before the moon they stand in the sky behind the rows of the
   * lines, under them. From the moon line they stand round the disc (the salvos) and low beside the climb (the snares).
   */
  private buildShells(cam: CamAt): THREE.InstancedMesh {
    const sparks = instanced(new THREE.BoxGeometry(1, 1, 1), glowMaterial(), SHELLS * SPARKS, { color: true });
    sparks.renderOrder = -1;
    this.root.add(sparks, this.flash);
    for (const t of this.snares) this.addShell(cam, t, 0);
    for (const t of this.chords) for (let s = 1; s <= 3; s++) this.addShell(cam, t + 0.07 * (s - 1), s);
    this.shells.sort((p, q) => p.t - q.t);
    return sparks;
  }

  /** One shell at t: `salvo` 0 is the shell of a snare, 1 to 3 the shells of a chord. */
  private addShell(cam: CamAt, t: number, salvo: number) {
    if (t < T_LAUNCH - 0.5 || t >= T_DIVE) return;
    const M = this.path.moon;
    const r = mulberry32(Math.round(t * 1000) * 7 + salvo);
    const c = cam(t);
    let o: THREE.Vector3, R: number, w: number;
    if (t < T_MOON - 1) {
      const dist = 1500 + 200 * r();
      o = c.position.clone().addScaledVector(rayOf(c, -0.85 + 1.7 * r(), -0.02 + 0.3 * r()), dist);
      R = 150 + 90 * r();
      w = 7;
    } else if (salvo > 0) {
      // round the disc, behind its plane: the disc covers what is behind it, so only the part round its rim shows
      const a = r() * Math.PI * 2, rad = M.radius * (1.25 + 0.5 * r());
      const right = new THREE.Vector3(0, 1, 0).cross(M.normal).normalize(), up = M.normal.clone().cross(right);
      o = M.centre.clone().addScaledVector(right, rad * Math.cos(a)).addScaledVector(up, rad * Math.sin(a)).addScaledVector(M.normal, -30);
      R = 26 + 14 * r();
      w = 0.9;
    } else {
      // low beside the climb, ahead of the train: under the glyphs of the disc
      const p = this.path.at(t + 1.4).p;
      o = new THREE.Vector3(p.x, p.y - 5 - 8 * r(), (r() < 0.5 ? -1 : 1) * (22 + 16 * r()));
      R = 9 + 5 * r();
      w = 0.28;
    }
    const dirs = Array.from({ length: SPARKS }, () => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(0.75 + 0.25 * r()));
    const k = Math.floor(r() * SHELL_COLS.length);
    this.shells.push({ t, o, R, w, c: col(SHELL_COLS[k]!), c2: col(SHELL_COLS[(k + 1 + Math.floor(r() * 3)) % SHELL_COLS.length]!), dirs });
  }

  /** The rings of stars round the moon: they turn against each other, and flash on the drums. */
  private buildStarRings() {
    const M = this.path.moon;
    const right = new THREE.Vector3(0, 1, 0).cross(M.normal).normalize(), up = M.normal.clone().cross(right);
    const basis = new THREE.Matrix4().makeBasis(right, up, M.normal);
    [[1.22, 40], [1.5, 30], [1.85, 52], [2.3, 44]].forEach(([rad, n], k) => {
      const mat = glowMaterial();
      const im = instanced(new THREE.OctahedronGeometry(1), mat, n!);
      for (let i = 0; i < n!; i++) {
        const a = (i / n!) * Math.PI * 2;
        this.o.position.set(rad! * M.radius * Math.cos(a), rad! * M.radius * Math.sin(a), 0);
        this.o.rotation.set(0, 0, 0);
        this.o.scale.setScalar((i % 4 ? 0.7 : 1.5) * (1 + 0.35 * k));
        this.o.updateMatrix();
        im.setMatrixAt(i, this.o.matrix);
      }
      const group = new THREE.Group();
      group.add(im);
      group.position.copy(M.centre).addScaledVector(M.normal, -4 - 3 * k);
      group.quaternion.setFromRotationMatrix(basis);
      this.starRings.push({ group, mat });
      this.root.add(group);
    });
  }

  /** The arp notes from the catch, and the gates of light along the climb that they light: two posts at each beat of the path. */
  private buildGates(midi: BridgeMidi): THREE.InstancedMesh {
    for (const a of ARPS) for (const n of midi.notes) if (n.track === a.track && n.start >= T_DROP && n.start < T_END) this.arpNotes.push({ t: n.start, c: col(a.col) });
    this.arpNotes.sort((p, q) => p.t - q.t);
    // the posts stand under the path, so they are low in the frame of the hip view: under the glyphs of the disc
    for (let t = T_CLIMB + 0.3; t < T_DIVE - 1.6; t += 0.4444) {
      const p = this.path.at(t).p;
      for (const s of [-1, 1]) this.gateAt.push(new THREE.Vector3(p.x, p.y - 17, s * 13));
    }
    const gates = instanced(new THREE.BoxGeometry(0.7, 11, 0.7).translate(0, 5.5, 0), glowMaterial(), this.gateAt.length, { color: true });
    this.gateAt.forEach((p, i) => { this.o.position.copy(p); this.o.rotation.set(0, 0, 0); this.o.scale.setScalar(1); this.o.updateMatrix(); gates.setMatrixAt(i, this.o.matrix); });
    return gates;
  }

  /** The pools of light in the cloud deck that the arp notes light. */
  private buildPools(): THREE.InstancedMesh {
    const pr = mulberry32(0x9001);
    for (let k = 0; k < 40; k++) this.poolAt.push(new THREE.Vector3(300 + pr() * 430, -53 + pr() * 6, (pr() < 0.6 ? -1 : 1) * (34 + pr() * 130)));
    const pools = instanced(new THREE.CylinderGeometry(1, 1, 1, 10), glowMaterial(), this.poolAt.length, { color: true });
    this.poolAt.forEach((p, i) => { this.o.position.copy(p); this.o.rotation.set(0, 0, 0); this.o.scale.set(22 + 16 * pr(), 5, 22 + 16 * pr()); this.o.updateMatrix(); pools.setMatrixAt(i, this.o.matrix); });
    return pools;
  }

  /** The tuna: two rows under the car, and one beside the far windows at the catch. */
  private buildTuna(A: LitAtlas, mat: THREE.Material): TunaSchool {
    const tuna = new TunaSchool(A, mat, TUNA_N, false, 1);
    this.root.add(tuna.root);
    const tr = mulberry32(77);
    for (let i = 0; i < TUNA_N; i++) {
      const row = i % 2, k = Math.floor(i / 2);
      this.tunaSlots.push(i === TUNA_N - 1 ? new THREE.Vector3(12.6, 2.2, -0.7) : new THREE.Vector3(-8 + 4 * k + (tr() - 0.5), -1.6 - 0.6 * tr(), row ? 1.3 : -1.3));
      this.tunaFrom.push(new THREE.Vector3(-30 - 20 * tr(), -40 - 15 * tr(), (tr() - 0.5) * 30));
    }
    return tuna;
  }

  /** The brightness of the stars at t (a factor of the sky's): they jump on each kick. */
  stars(t: number): number { return 0.75 + 0.7 * Math.exp(-since(this.kicks, t) / 0.16); }

  /** The growth of the frost on the window (0..1): one step on each kick after the wind stops, 2 frames each. It melts when the train pulls up. */
  frost(t: number): number {
    if (t < T_WIND || !this.frostKicks.length) return 0;
    let p = 0;
    for (const k of this.frostKicks) p += smooth((t - k) / (2 / 36));
    return (p / this.frostKicks.length) * (1 - smooth((t - T_PULL) / 1.6));
  }

  pose(t: number) {
    this.posePillars(t);
    this.poseAurora(t);
    this.poseRims(t);
    this.poseBursts(t);
    this.poseShells(t);
    this.poseMoonLights(t);
    this.poseTuna(t);
  }

  /**
   * The place of a beam that starts at t0: it stands `dist` m away (across the ground) from the camera at the middle of its life, in the
   * direction that puts it at NDC x `nx` on the mean over its life. Its foot is under the bottom edge of the frame and its top over the
   * top edge at every time of its life. Found with a few secant steps on the direction.
   */
  private placeBeam(cam: CamAt, t0: number, nx: number, dist: number): { x: number; z: number; y0: number; h: number } {
    const S = [0, 0.1, 0.2, 0.3, 0.4, PILLAR_LIFE].map((s) => t0 + s);
    const mid = cam(t0 + PILLAR_LIFE / 2), o = mid.position.clone();
    const r0 = rayOf(mid, nx, 0);
    const p = new THREE.Vector3();
    const at = (a: number) => p.set(o.x + dist * Math.cos(a), o.y, o.z + dist * Math.sin(a));
    const f = (a: number) => { let m = 0; for (const s of S) m += at(a).project(cam(s)).x; return m / S.length - nx; };
    let a0 = Math.atan2(r0.z, r0.x), a1 = a0 + 0.01, f0 = f(a0), f1 = f(a1);
    for (let k = 0; k < 6 && Math.abs(f1) > 1e-4 && f1 !== f0; k++) {
      const a2 = a1 - (f1 * (a1 - a0)) / (f1 - f0);
      a0 = a1; f0 = f1; a1 = a2; f1 = f(a1);
    }
    at(a1);
    const x = p.x, z = p.z;
    let lo = Infinity, top = -Infinity;
    for (const s of S) {
      const c = cam(s), d = Math.hypot(x - c.position.x, z - c.position.z), v = p.set(x, o.y, z).project(c).x;
      for (const ny of [-1.15, 1.15]) {
        const r = rayOf(c, v, ny), y = c.position.y + (r.y * d) / Math.max(0.05, Math.hypot(r.x, r.z));
        lo = Math.min(lo, y); top = Math.max(top, y);
      }
    }
    return { x, z, y0: lo, h: top - lo };
  }

  private posePillars(t: number) {
    let n = 0;
    for (const a of this.notes) {
      if (a.t > t) break;
      const age = t - a.t;
      if (age >= PILLAR_LIFE || n >= PILLARS) continue;
      // the beam shoots up in 2 frames, holds, then thins out
      const rise = smooth(age / 0.06), thin = 1 - smooth((age - 0.12) / (PILLAR_LIFE - 0.12));
      this.o.position.set(a.x, a.y0, a.z);
      this.o.scale.set(a.w * Math.max(0.04, thin), a.h * rise + 1, a.w * Math.max(0.04, thin));
      this.o.rotation.set(0, 0, 0);
      this.o.updateMatrix();
      this.pillars.setMatrixAt(n, this.o.matrix);
      this.pillars.setColorAt(n, this.c.copy(a.c).multiplyScalar(0.5 + 1.6 * (1 - smooth(age / 0.22))));
      n++;
    }
    this.pillars.count = n;
    this.pillars.instanceMatrix.needsUpdate = true;
    if (this.pillars.instanceColor) this.pillars.instanceColor.needsUpdate = true;
  }

  private poseAurora(t: number) {
    const ts = stepT(t, 18);
    let k = -1;
    for (let i = 0; i < this.chords.length && this.chords[i]! <= ts; i++) k = i;
    const pulse = k < 0 ? 0 : Math.exp(-(ts - this.chords[k]!) / 0.8);
    const p = this.path.at(t).p;
    this.aurora.forEach((m, i) => {
      const a = AURORA[i]!;
      m.position.set(p.x, Math.max(p.y, 0) + a.y, 0);
      // the curtains drift round the sky, each its own way
      m.rotation.y = (i % 2 ? -1 : 1) * 0.012 * ts + i;
      (m.material as THREE.MeshBasicMaterial).color.setScalar(0.08 + (k >= 0 && k % 3 === i ? 0.75 : 0.22) * pulse);
    });
  }

  private poseRims(t: number) {
    this.rims.forEach((m, layer) => {
      // the kick runs from the near ridge to the far one; the snare takes the middle ridge and the peaks of the deck
      const kick = Math.exp(-since(this.kicks, t - 0.04 * layer) / 0.16);
      const snare = layer % 2 ? Math.exp(-since(this.snares, t) / 0.2) : 0;
      const c = (m.material as THREE.MeshBasicMaterial).color;
      c.copy(col(RIM_KICK)).multiplyScalar(0.05 + 1.5 * kick);
      c.add(this.c.copy(col(RIM_SNARE)).multiplyScalar(1.7 * snare));
    });
  }

  private poseBursts(t: number) {
    const ts = stepT(t, 18);
    let n = 0;
    for (const h of this.bursts) {
      if (h.t > ts) break;
      const age = ts - h.t;
      if (age >= BURST_LIFE) continue;
      const s = 1 - age / BURST_LIFE;
      for (let i = 0; i < h.dirs.length && n < BURSTS; i++) {
        this.o.position.copy(h.o).addScaledVector(h.dirs[i]!, age * (1 - 0.4 * age));
        this.o.rotation.set(h.spin[i]! + age * 9, h.spin[i]! * 2, age * 5);
        this.o.scale.setScalar(h.size * Math.max(0.05, s));
        this.o.updateMatrix();
        this.shards.setMatrixAt(n, this.o.matrix);
        this.shards.setColorAt(n, this.c.copy(h.c).multiplyScalar(1.2 + 1.8 * s));
        n++;
      }
    }
    this.shards.count = n;
    this.shards.instanceMatrix.needsUpdate = true;
    if (this.shards.instanceColor) this.shards.instanceColor.needsUpdate = true;
  }

  private poseShells(t: number) {
    const ts = stepT(t, 18);
    const frozen = t >= T_WIND && t < T_AGAIN ? smooth((t - T_WIND) / 0.4) : 0;
    let n = 0, light = 0;
    const o = this.o, d = this.d;
    this.flash.color.setRGB(0, 0, 0);
    for (const h of this.shells) {
      if (h.t > t) break;
      const age = windAge(h.t, t);
      if (age >= SHELL_LIFE || n + SPARKS > SHELLS * SPARKS) continue;
      // the sparks fly out fast, slow down and sink; they go dark from the middle of their life, with a flicker at the end
      const e = 1 - Math.exp(-5 * age), sink = 0.12 * h.R * age * age;
      const lum = 2.6 * Math.exp(-age / 0.55) * (1 - smooth((age - 0.9) / 0.4));
      const tail = h.R * 0.16 * Math.exp(-3.5 * age) + h.w;
      for (let i = 0; i < SPARKS; i++) {
        const dir = h.dirs[i]!;
        o.position.copy(h.o).addScaledVector(dir, h.R * e);
        o.position.y -= sink;
        o.quaternion.setFromUnitVectors(this.x, d.copy(dir).normalize());
        o.scale.set(tail, h.w, h.w);
        o.updateMatrix();
        this.sparks.setMatrixAt(n, o.matrix);
        const flick = age > 0.7 && !frozen ? 0.4 + 0.6 * ((Math.sin(i * 12.9898 + ts * 37) * 43758.5453) % 1 > 0 ? 1 : 0) : 1;
        this.c.copy(i % 3 ? h.c : h.c2).lerp(ICE_SPARK, 0.7 * frozen).multiplyScalar(Math.max(lum * (1 - 0.6 * frozen), 0.4 * frozen) * flick);
        this.sparks.setColorAt(n, this.c);
        n++;
      }
      // its light, for a quarter of a second
      const l = Math.exp(-(t - h.t) / 0.22);
      if (t - h.t < 1 && l > light) { light = l; this.flash.color.copy(h.c); }
    }
    this.sparks.count = n;
    this.sparks.instanceMatrix.needsUpdate = true;
    if (this.sparks.instanceColor) this.sparks.instanceColor.needsUpdate = true;
    // the light stands over the far side of the train
    const p = this.path.at(t).p;
    this.flash.position.set(p.x + 10, p.y + 22, p.z - 30);
    this.flash.intensity = 170 * light;
  }

  /** The lights of the moon line: the rings of stars round the disc, the gates along the climb and the pools in the deck. */
  private poseMoonLights(t: number) {
    const near = t >= T_PULL;
    const kick = Math.exp(-since(this.kicks, t) / 0.14), snare = Math.exp(-since(this.snares, t) / 0.2);
    this.starRings.forEach((r, k) => {
      r.group.visible = near;
      r.group.rotation.z = (k % 2 ? -1 : 1) * (0.05 + 0.03 * k) * t;
      // the kick runs out through the rings, the snare takes them all
      const kk = Math.exp(-since(this.kicks, t - 0.05 * k) / 0.14);
      r.mat.color.copy(col(k % 2 ? '#ffe9a8' : '#cfe6ff')).multiplyScalar(0.5 + 2.4 * kk + 1.3 * snare);
    });
    this.gates.visible = near;
    this.pools.visible = t >= T_DROP;
    if (!this.pools.visible) return;
    // each arp note lights one gate and one pool; the gate of the note is one that the train comes to next
    const lit = (count: number, i: number, salt: number, ahead: number): { v: number; c: THREE.Color | null } => {
      let v = 0, c: THREE.Color | null = null;
      for (let k = this.arpNotes.length - 1; k >= 0; k--) {
        const a = this.arpNotes[k]!;
        if (a.t > t) continue;
        const age = t - a.t;
        if (age > 0.45) break;
        const pick = ahead >= 0 ? (ahead + (k % 6)) % count : Math.floor(((Math.sin(k * 78.233 + salt) * 43758.5453) % 1 + 1) % 1 * count);
        if (pick === i) { const e = Math.exp(-age / 0.12); if (e > v) { v = e; c = a.c; } }
      }
      return { v, c };
    };
    // the first gate that is still ahead of the train
    const px = this.path.at(t).p.x;
    let first = 0;
    while (first < this.gateAt.length && this.gateAt[first]!.x < px + 6) first++;
    for (let i = 0; i < this.gateAt.length; i++) {
      const g = lit(this.gateAt.length, i, 1, first);
      this.gates.setColorAt(i, g.c ? this.c.copy(g.c).multiplyScalar(0.25 + 2.6 * g.v) : this.c.setRGB(0.1, 0.14, 0.25).multiplyScalar(1 + 1.5 * kick));
    }
    for (let i = 0; i < this.poolAt.length; i++) {
      const g = lit(this.poolAt.length, i, 5, -1);
      this.pools.setColorAt(i, g.c ? this.c.copy(g.c).multiplyScalar(0.9 * g.v) : this.c.setRGB(0.012, 0.016, 0.03));
    }
    if (this.gates.instanceColor) this.gates.instanceColor.needsUpdate = true;
    if (this.pools.instanceColor) this.pools.instanceColor.needsUpdate = true;
  }

  /** Fish i in the frame of the car at t: the rise from under the deck, its place under the car, the changes of place and the one that loses its hold. */
  private tunaLocal(i: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    const u = smooth((t - T_SWOOP) / (T_CATCH - T_SWOOP));
    // each fish arrives a little after the one before, the first ones under the nose
    const lag = (i / TUNA_N) * 0.35;
    out.copy(this.tunaFrom[i]!).lerp(this.tunaSlots[i]!, smooth((u - lag) / (1 - lag)));
    if (t < T_CATCH) return out;
    const s = t - T_CATCH;
    // the body works: a wave that runs back along the row, and a slow sway. They come in over CATCH_EASE, so the fish do not jump at the catch
    const e = smooth(s / CATCH_EASE);
    out.y += e * 0.22 * Math.sin(7 * s - 0.6 * this.tunaSlots[i]!.x) * ((i % 3) - 1 || 0.5);
    out.z += e * 0.3 * Math.sin(2.3 * s + 1.7 * i);
    out.x += e * 0.5 * Math.sin(1.3 * s + 2.9 * i);
    // two change places: one goes under the other
    for (const [at, a, b] of SWAPS) {
      if (i !== a && i !== b) continue;
      const w = smooth((t - at) / 1.1);
      if (w <= 0) continue;
      const other = this.tunaSlots[i === a ? b : a]!, own = this.tunaSlots[i]!;
      out.x += (other.x - own.x) * w;
      out.z += (other.z - own.z) * w;
      out.y -= (i === a ? 1.5 : -0.25) * Math.sin(Math.PI * w);
    }
    // the one at the front glass dives under the nose and goes under the car when the moon line starts
    if (i === TUNA_N - 1) { const w = (t - (T_MOON - 0.4)) / 1.2; out.y -= 5.2 * smooth(w / 0.5); out.x -= 9 * smooth((w - 0.4) / 0.6); out.z += 2 * smooth((w - 0.4) / 0.6); }
    if (i === LOST.fish) {
      // it falls back fast and comes in again slowly
      const w = (t - LOST.from) / (LOST.to - LOST.from);
      if (w > 0 && w < 1) { const b = w < 0.25 ? smooth(w / 0.25) : 1 - smooth((w - 0.25) / 0.75); out.x -= 15 * b; out.y -= 7 * b; out.z += 3 * b * Math.sin(9 * w); }
    }
    return out;
  }

  private poseTuna(t: number) {
    if (t < T_SWOOP || t >= T_DIVE + 0.25) { this.tuna.pose(t, [], []); return; }
    const m = this.path.matrix(t), m1 = this.path.matrix(t - 1 / 36);
    const pos: THREE.Vector3[] = [], vel: THREE.Vector3[] = [], wag: number[] = [];
    const fwd = new THREE.Vector3(1, 0, 0).transformDirection(m).multiplyScalar(20);
    for (let i = 0; i < TUNA_N; i++) {
      const a = this.tunaLocal(i, t, new THREE.Vector3());
      const b = this.tunaLocal(i, t - 1 / 36, new THREE.Vector3());
      // the heading: before the catch, the way it goes. After it, the way the car goes, turned by the fish's own move under the car; the
      // fish turns from the one to the other over CATCH_EASE
      const fall = a.clone().applyMatrix4(m).sub(b.clone().applyMatrix4(m1)).multiplyScalar(36);
      const held = a.clone().sub(b).multiplyScalar(36 * 1.5).transformDirection(m).multiplyScalar(a.distanceTo(b) * 36 * 1.5).add(fwd);
      const v = t >= T_CATCH ? fall.lerp(held, smooth((t - T_CATCH) / CATCH_EASE)) : fall;
      pos.push(a.applyMatrix4(m));
      vel.push(v.lengthSq() < 1 ? fwd.clone() : v);
      wag.push(i === LOST.fish && t > LOST.from && t < LOST.to ? 2.2 : 1.3);
    }
    this.tuna.pose(t, pos, vel, wag, 2.2);
  }

  dispose() {
    for (const m of [this.pillars, this.shards, this.sparks, this.gates, this.pools, ...this.aurora, ...this.rims]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    for (const r of this.starRings) { r.mat.dispose(); (r.group.children[0] as THREE.InstancedMesh).geometry.dispose(); }
  }
}
