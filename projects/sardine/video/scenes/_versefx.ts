// What makes the ride of verse 2 fast, and what its two counter-melody voices play (treatment v9 "Plate 7").
//   posts    marker posts beside the track, one each 11 m, on the side away from the ride cam: they whip past
//   dust     puffs at the wheels of the rear car: each stays where it came up, grows and goes
//   the duet (对唱): one voice plays the sky, the other the ground. Both stand in the world ahead of the train, fixed where the
//   note put them, and each lasts as long as its note is held, then goes in a short release.
//     sky     each note draws a streak of light across the sky, 220 m ahead: it grows while the note is held, higher for a higher note
//     ground  each note sends a ring of light out over the ground from the track, 60 m ahead: it widens while the note is held;
//             the wheels of the front car throw sparks on the note
// `pose(t)` writes everything for time t: a pure function of t.
import * as THREE from 'three';
import { mulberry32, smooth } from '@pve/engine/util';
import { Builder, allFaces, at, col, glowMaterial, instanced, type LitAtlas } from '@pve/engine/lit';
import type { TrackFrame } from '@pve/engine/track';

export interface VerseNote { start: number; end: number; pitch: number }

export interface VerseFxSpec {
  /** The frame of the track at a distance along the route, and the length of the route. */
  frame: (d: number) => TrackFrame;
  len: number;
  /** The middle of the front car on the route at time t, its speed (m/s), and the distance between the cars. */
  dAt: (t: number) => number;
  speed: number;
  pitch: number;
  /** The ride runs from `t0` to `t1` (the train leaves the track there). */
  t0: number;
  t1: number;
  /** The two voices of the duet: the one in the sky and the one on the ground (that one also throws the sparks while the train is on the track). Every note is drawn. */
  sky: readonly VerseNote[];
  ground: readonly VerseNote[];
}

const POST_STEP = 11, OFF = 3.6;
const PUFF_STEP = 2.4, PUFF_LIFE = 0.5, PUFFS = 48;
const SPARKS = 14, SPARK_LIFE = 0.28;
const WARM = col('#ffd27a'), HOT = col('#fff6d8');
/** The sky: a light over the route that flies ahead of the train at this speed (m/s, more than the train), at this height (low note .. high note), with a tail of at most this length. */
const SKY_Y0 = 12, SKY_Y1 = 26, SKY_GROW = 260, SKY_LEN = 60, SKY_SEGS = 10;
/** The ground: a ring this far ahead of the train, from this radius, widening at this speed to at most this radius; the band is this wide. */
const RING_AHEAD = 60, RING_R0 = 3, RING_GROW = 90, RING_MAX = 70, RING_BAND = 6;
/** After the note each light goes in this time (s). At most this many lights of each voice at once. */
const RELEASE = 0.35, LIGHTS = 6;
const SKY_COL = { lo: col('#7fd6ff'), hi: col('#e8f6ff') }, GROUND_COL = { lo: col('#ff9a3c'), hi: col('#ffe08a') };

export class VerseFx {
  readonly root = new THREE.Group();
  private puffs: THREE.InstancedMesh;
  private sparks: THREE.InstancedMesh;
  private sparkDirs: THREE.Vector3[] = [];
  private streaks: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  /** How high each note is in its voice, 0..1. */
  private level: { sky: number[]; ground: number[] };
  private o = new THREE.Object3D();
  private c = new THREE.Color();
  private m = new THREE.Matrix4();
  private x = new THREE.Vector3(1, 0, 0);
  private v = new THREE.Vector3();
  private a = new THREE.Vector3();

  constructor(A: LitAtlas, mat: THREE.Material, private s: VerseFxSpec) {
    const white = allFaces({ cell: A.solid('#f0f0ea', 0.5) }), red = allFaces({ cell: A.solid('#d83030', 0.5) });
    const d0 = s.dAt(s.t0) - 40, d1 = Math.min(s.len - 1, s.dAt(s.t1) + 30);
    // ---- the marker posts: 1.3 m, white with a red top
    const pb = new Builder();
    const basis = (f: TrackFrame, lift: number) => this.m.makeBasis(f.tangent, f.up, f.side).setPosition(f.pos.clone().addScaledVector(f.side, -OFF).addScaledVector(f.up, lift)).clone();
    for (let d = Math.ceil(d0 / POST_STEP) * POST_STEP; d < d1; d += POST_STEP) {
      const f = s.frame(d);
      pb.box(0.14, 1.1, 0.14, white, basis(f, -0.4));
      pb.box(0.16, 0.25, 0.16, red, basis(f, 0.7));
    }
    const posts = new THREE.Mesh(pb.geometry(), mat);
    posts.frustumCulled = false;
    this.root.add(posts);
    // ---- the duet
    const levels = (ns: readonly VerseNote[]) => {
      const lo = Math.min(...ns.map((n) => n.pitch)), hi = Math.max(...ns.map((n) => n.pitch));
      return ns.map((n) => (hi > lo ? (n.pitch - lo) / (hi - lo) : 0.5));
    };
    this.level = { sky: levels(s.sky), ground: levels(s.ground) };
    this.streaks = instanced(new THREE.BoxGeometry(1, 1, 1), glowMaterial(THREE.FrontSide), LIGHTS * (SKY_SEGS + 1), { color: true });
    // one ring scaled as a whole: its band is RING_BAND wide at the largest radius and narrower while it is small
    this.rings = instanced(new THREE.RingGeometry(1 - RING_BAND / RING_MAX, 1, 48, 1), glowMaterial(), LIGHTS, { color: true });
    this.root.add(this.streaks, this.rings);
    // ---- the dust
    const db = new Builder();
    db.box(1, 1, 1, allFaces({ cell: A.solid('#b9ab8e', 0.05) }), at(0, -0.5, 0));
    this.puffs = instanced(db.geometry(), mat, PUFFS);
    // ---- the sparks of the ground voice
    this.sparks = instanced(new THREE.BoxGeometry(1, 1, 1), glowMaterial(THREE.FrontSide), 3 * SPARKS, { color: true });
    const rnd = mulberry32(0x5fa);
    for (let i = 0; i < SPARKS; i++) this.sparkDirs.push(new THREE.Vector3(-0.3 - 0.7 * rnd(), 0.15 + 0.5 * rnd(), (rnd() < 0.5 ? -1 : 1) * (0.2 + 0.6 * rnd())));
    this.root.add(this.puffs, this.sparks);
  }

  /** The notes of a voice that show at t, the newest first: index, how long it has been held, and the time since its end. */
  private sounding(ns: readonly VerseNote[], t: number): { k: number; held: number; after: number }[] {
    const out: { k: number; held: number; after: number }[] = [];
    for (let k = ns.length - 1; k >= 0 && out.length < LIGHTS; k--) {
      const n = ns[k]!;
      if (n.start > t) continue;
      const after = Math.max(0, t - n.end);
      if (after > RELEASE) continue;
      out.push({ k, held: Math.min(t, n.end) - n.start, after });
    }
    return out;
  }

  /** The point in the sky over the route at distance d, `y` m up. */
  private skyPoint(out: THREE.Vector3, d: number, y: number): THREE.Vector3 {
    const f = this.s.frame(Math.min(this.s.len - 1, d));
    return out.copy(f.pos).addScaledVector(f.up, y);
  }

  /**
   * The sky voice: a light that leaves the sky over the front car on the note and flies up the line ahead of the train, higher for a
   * higher note, for as long as the note is held; its tail is a streak in pieces that follow the curve, brightest at the head.
   */
  private poseSky(t: number) {
    const s = this.s, o = this.o, b = new THREE.Vector3();
    let n = 0;
    for (const { k, held, after } of this.sounding(s.sky, t)) {
      const note = s.sky[k]!, lv = this.level.sky[k]!;
      const y = SKY_Y0 + (SKY_Y1 - SKY_Y0) * lv;
      const from = s.dAt(note.start) + 10;
      const head = from + (s.speed + SKY_GROW) * (held + after);
      const tail = Math.max(from + (s.speed + SKY_GROW) * after * 0.9, head - SKY_LEN);
      const fade = 1 - smooth(after / RELEASE);
      for (let j = 0; j <= SKY_SEGS; j++) {
        const isHead = j === SKY_SEGS;
        const da = isHead ? head - 1.5 : tail + ((head - tail) * j) / SKY_SEGS, db = isHead ? head + 1.5 : tail + ((head - tail) * (j + 1)) / SKY_SEGS;
        if (db - da < 1e-3) continue;
        this.skyPoint(this.a, da, y);
        this.skyPoint(b, db, y);
        this.v.subVectors(b, this.a);
        const len = this.v.length(), u = isHead ? 1 : (j + 1) / SKY_SEGS;
        const thick = isHead ? 3.2 : 0.5 + 1.6 * u;
        o.position.copy(this.a).add(b).multiplyScalar(0.5);
        o.quaternion.setFromUnitVectors(this.x, this.v.divideScalar(len));
        o.scale.set(len + thick, thick, thick);
        o.updateMatrix();
        this.streaks.setMatrixAt(n, o.matrix);
        if (isHead) this.c.copy(HOT).multiplyScalar(6 * fade);
        else this.c.copy(SKY_COL.lo).lerp(SKY_COL.hi, lv).multiplyScalar(fade * (0.3 + 2.8 * u * u));
        this.streaks.setColorAt(n, this.c);
        n++;
      }
    }
    this.streaks.count = n;
    this.streaks.instanceMatrix.needsUpdate = true;
    if (this.streaks.instanceColor) this.streaks.instanceColor.needsUpdate = true;
  }

  /** The ground voice: a ring of light that widens over the ground from the track ahead of the train. */
  private poseGround(t: number) {
    const s = this.s;
    let n = 0;
    for (const { k, held, after } of this.sounding(s.ground, t)) {
      const note = s.ground[k]!, lv = this.level.ground[k]!;
      const f = s.frame(Math.min(s.len - 1, s.dAt(note.start) + RING_AHEAD));
      const r = Math.min(RING_MAX, RING_R0 + RING_GROW * (held + 0.5 * after)), fade = 1 - smooth(after / RELEASE);
      // the ring lies flat on the ground of the track (its plane: along and across the track)
      this.m.makeBasis(f.tangent, f.side, f.up).setPosition(this.a.copy(f.pos).addScaledVector(f.up, 0.2));
      this.m.multiply(new THREE.Matrix4().makeScale(r, r, 1));
      this.rings.setMatrixAt(n, this.m);
      this.rings.setColorAt(n, this.c.copy(GROUND_COL.lo).lerp(GROUND_COL.hi, lv).multiplyScalar(7 * fade * (1 - 0.5 * (r / RING_MAX))));
      n++;
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }

  pose(t: number) {
    const s = this.s, o = this.o;
    const on = t >= s.t0 - 0.5 && t < s.t1 + 1.2;
    this.root.visible = on;
    if (!on) return;
    this.poseSky(t);
    this.poseGround(t);
    // the dust: the puffs that the rear wheels made in the last half second
    const run = Math.min(t, s.t1);
    const rear = s.dAt(run) - s.pitch - 7;
    let n = 0;
    const jMax = Math.floor(rear / PUFF_STEP);
    for (let j = jMax; j > jMax - PUFFS / 2 && n < PUFFS; j--) {
      const d = j * PUFF_STEP, age = t - (run - (rear - d) / s.speed);
      if (age > PUFF_LIFE || d < s.dAt(s.t0) - s.pitch - 7) break;
      const f = s.frame(d), u = age / PUFF_LIFE;
      for (const side of [-1, 1]) {
        const k = (((j * 7 + side * 3) % 11) + 11) % 11 / 11;
        o.position.copy(f.pos).addScaledVector(f.side, side * (0.8 + 0.5 * u + 0.3 * k)).addScaledVector(f.up, 0.15 + 1.1 * u * (0.6 + 0.8 * k));
        o.rotation.set(3 * u + j, 2 * u + 2 * j, 0);
        o.scale.setScalar((0.25 + 1.0 * smooth(u / 0.5)) * (1 - smooth((u - 0.55) / 0.45)) * (0.7 + 0.6 * k));
        o.updateMatrix();
        this.puffs.setMatrixAt(n++, o.matrix);
      }
    }
    this.puffs.count = n;
    this.puffs.instanceMatrix.needsUpdate = true;
    // the sparks: from the front wheels where they were at a note of the ground voice, thrown back and out
    n = 0;
    for (let k = s.ground.length - 1; k >= 0 && n + SPARKS <= 3 * SPARKS; k--) {
      const note = s.ground[k]!;
      const age = t - note.start;
      if (age < 0) continue;
      if (age > SPARK_LIFE) break;
      if (note.start >= s.t1) continue;
      const f = s.frame(s.dAt(note.start) + 7);
      const lum = 3 * (1 - age / SPARK_LIFE);
      for (let i = 0; i < SPARKS; i++) {
        const dir = this.sparkDirs[i]!;
        this.v.set(0, 0, 0).addScaledVector(f.tangent, dir.x).addScaledVector(f.up, dir.y).addScaledVector(f.side, dir.z);
        const sp = 9 + 14 * ((i * 37) % 10) / 10;
        o.position.copy(f.pos).addScaledVector(f.side, Math.sign(dir.z) * 0.55).addScaledVector(this.v, sp * age).addScaledVector(f.up, 0.1 - 9 * age * age);
        o.quaternion.setFromUnitVectors(this.x, this.v.normalize());
        o.scale.set(0.5 + 1.4 * (1 - age / SPARK_LIFE), 0.05, 0.05);
        o.updateMatrix();
        this.sparks.setMatrixAt(n, o.matrix);
        this.sparks.setColorAt(n, this.c.copy(i % 3 ? WARM : HOT).multiplyScalar(lum));
        n++;
      }
    }
    this.sparks.count = n;
    this.sparks.instanceMatrix.needsUpdate = true;
    if (this.sparks.instanceColor) this.sparks.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const m of [this.streaks, this.rings, this.sparks]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.puffs.dispose();
  }
}
