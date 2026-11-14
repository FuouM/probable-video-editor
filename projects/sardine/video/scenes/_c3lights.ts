// The lights of chorus 3 (treatment v9 "Plate 9", "Music reactivity"), as in the bridge (`_bridgelights.ts`): all of it is far off and
// large, so nothing covers the train, and each event is put where the camera looks when it happens, so it is in the picture. Each
// part is one voice of `midi.json`, and each note of that voice is one event:
//   arps (tracks 2, 3, 4)  the melody draws itself across the sky: each note is a star at the place of its time in the bar (left to
//                          right) and of its pitch (up), and a line of light runs to it from the note before. Each track its colour
//   chords (track 14)      a ring of light runs out from the eclipse
//   snare (track 18)       a firework in the sky
//   kick (track 19)        the stars of the sky and the corona pulse (`kick(t)`: the scene reads it)
//   hat (track 17)         a star that glints
//   harmony (track 13)     a shooting star
// The camera never moves on the music. Stage frame (`_c3stage.ts`). `pose(t)` writes everything for time t: a pure function of t.
import * as THREE from 'three';
import { col, glowMaterial, instanced } from '@pve/engine/lit';
import { hashSin } from '@pve/engine/util';
import { SPB, bar, BAR } from './_time';

export interface LightNote { track: number; start: number; pitch: number }

export interface LightSpec {
  /** The notes of the chorus (all tracks). */
  notes: readonly LightNote[];
  /** The show starts here. */
  from: number;
  /** The camera of the ride window at t, with its matrices up to date. */
  camAt: (t: number) => THREE.PerspectiveCamera;
  /** The direction of the eclipse. */
  eclipse: THREE.Vector3;
}

/** The arp tracks: the colour, and the band of the frame (ndc y, low pitch to high) where their notes stand. */
const ARPS = [
  { track: 2, col: '#ffd23a', band: [0.1, 0.4] },
  { track: 4, col: '#ff6ae0', band: [0.3, 0.7] },
  { track: 3, col: '#5af0ff', band: [0.5, 0.85] },
] as const;
/** How long a note of the melody lasts (s), how long its line takes to reach it (s), how far off the melody is drawn (m), how many
 * notes show at once. */
const NOTE_LIFE = 1.1, DRAW = 0.06, MEL_D = 2000, NOTES = 64;
/** A firework: this many sparks, and they live this long; how far off it opens (m). */
const SPARKS = 44, SHELL_LIFE = 1.2, SHELLS = 4, SHELL_D = 900;
const SHELL_COLS = ['#ff3a4a', '#ffb02a', '#ffe66a', '#ff5ac8', '#6af0ff', '#9a7aff', '#7aff9a'];
/** The ring of a chord: how long it runs, how far off it is drawn (m), and how many can run at once. */
const RING_LIFE = 0.7, RING_D = 2500, RINGS = 2;
const GLINT_LIFE = 0.3, GLINTS = 8, STREAK_LIFE = 0.45, STREAKS = 6, SKY_D = 2200;

const times = (notes: readonly LightNote[], track: number, from: number) => [...new Set(notes.filter((n) => n.track === track && n.start >= from).map((n) => Math.round(n.start * 1000)))].sort((a, b) => a - b).map((ms) => ms / 1000);
/** The unit ray of the camera through the point (x, y) of its frame (-1..1 each way). */
const rayOf = (cam: THREE.PerspectiveCamera, x: number, y: number) => new THREE.Vector3(x, y, 0.5).unproject(cam).sub(cam.position).normalize();

/** A note of the melody: its place in the sky (an offset from the eye), the note before it on its line (-1: the line starts here), its colour. */
interface Note { t: number; p: THREE.Vector3; prev: number; c: THREE.Color }
/** A thing of the sky: its time, its place (an offset from the eye), its turn to face the eye, a seed. */
interface Placed { t: number; p: THREE.Vector3; q: THREE.Quaternion; k: number }

export class C3Lights {
  readonly root = new THREE.Group();
  private melody: Note[] = [];
  private nodes: THREE.InstancedMesh;
  private links: THREE.InstancedMesh;
  private shells: Placed[] = [];
  private sparks: THREE.InstancedMesh;
  private chords: number[];
  private rings: THREE.InstancedMesh;
  private kicks: number[];
  private glints: Placed[] = [];
  private glintMesh: THREE.InstancedMesh;
  private streaks: Placed[] = [];
  private streakMesh: THREE.InstancedMesh;
  private o = new THREE.Object3D();
  private c = new THREE.Color();
  private v = new THREE.Vector3();

  constructor(private s: LightSpec) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const inst = (g: THREE.BufferGeometry, n: number) => {
      const im = instanced(g, glowMaterial(), n, { color: true });
      im.count = 0;
      this.root.add(im);
      return im;
    };
    // a thing put where the camera looks at its time: through the point (x, y) of the frame, `d` metres off, turned to the eye. Its place
    // is kept as an offset from the eye: it stays in the same place of the sky while the camera travels (no parallax), as the stars do
    const place = (t: number, x: number, y: number, d: number, k: number): Placed => {
      const p = rayOf(s.camAt(t), x, y).multiplyScalar(d);
      this.o.position.copy(p);
      this.o.lookAt(0, 0, 0);
      return { t, p, q: this.o.quaternion.clone(), k };
    };
    // ---- the melody of the arps: a note stands where the camera looks at its time; a line joins it to the note before in the same bar
    for (const a of ARPS) {
      const ns = s.notes.filter((n) => n.track === a.track && n.start >= s.from).sort((x, y) => x.start - y.start);
      if (!ns.length) continue;
      const lo = Math.min(...ns.map((n) => n.pitch)), hi = Math.max(...ns.map((n) => n.pitch));
      let last = -1;
      for (const n of ns) {
        const b = Math.floor((n.start - bar(1)) / BAR + 1e-6), u = (n.start - bar(1)) / BAR - b;
        const x = -0.82 + 1.64 * u, y = a.band[0] + (a.band[1] - a.band[0]) * (hi > lo ? (n.pitch - lo) / (hi - lo) : 0.5);
        this.melody.push({ t: n.start, p: rayOf(s.camAt(n.start), x, y).multiplyScalar(MEL_D), prev: b === last ? this.melody.length - 1 : -1, c: col(a.col) });
        last = b;
      }
    }
    // the notes in the order of time; the link to the note before is found again in the new order
    const made = this.melody, sorted = [...made].sort((a, b) => a.t - b.t);
    this.melody = sorted.map((n) => ({ ...n, prev: n.prev >= 0 ? sorted.indexOf(made[n.prev]!) : -1 }));
    this.nodes = inst(quad, NOTES);
    this.links = inst(quad, NOTES);
    // ---- the fireworks, the glints and the shooting stars: in the sky of the frame at their time
    times(s.notes, 18, s.from).forEach((t, k) => this.shells.push(place(t, (hashSin(k, 1) - 0.5) * 1.4, 0.15 + 0.5 * hashSin(k, 2), SHELL_D, k)));
    this.sparks = inst(quad, SPARKS * SHELLS);
    this.chords = times(s.notes, 14, s.from);
    this.rings = inst(new THREE.RingGeometry(0.975, 1, 64), RINGS);
    this.kicks = times(s.notes, 19, s.from);
    times(s.notes, 17, s.from).forEach((t, k) => this.glints.push(place(t, (hashSin(k, 11) - 0.5) * 1.8, 0.3 + 0.6 * hashSin(k, 12), SKY_D, k)));
    this.glintMesh = inst(quad, GLINTS * 2);
    times(s.notes, 13, s.from).forEach((t, k) => this.streaks.push(place(t, (hashSin(k, 22) - 0.5) * 1.4, 0.45 + 0.4 * hashSin(k, 23), SKY_D, k)));
    this.streakMesh = inst(quad, STREAKS);
  }

  /** The age of the newest element of the sorted list `a` at t (Infinity when there is none). */
  private static since(a: readonly number[], t: number): number {
    let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m]! <= t) lo = m + 1; else hi = m; }
    return lo > 0 ? t - a[lo - 1]! : Infinity;
  }

  /** The pulse of the kick at t: 1 on the kick, gone in a tenth of a second. */
  kick(t: number): number {
    return t < this.s.from ? 0 : Math.exp(-C3Lights.since(this.kicks, t) / 0.1);
  }

  /** The events of the sorted list `a` that started in the last `life` seconds before t, the newest first, at most `max`. */
  private static recent<T extends { t: number }>(a: readonly T[], t: number, life: number, max: number, f: (e: T, age: number, n: number) => void) {
    let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m]!.t <= t) lo = m + 1; else hi = m; }
    for (let k = lo - 1, n = 0; k >= 0 && n < max; k--) {
      const age = t - a[k]!.t;
      if (age > life) break;
      f(a[k]!, age, n++);
    }
  }

  pose(t: number) {
    const o = this.o, c = this.c;
    this.root.visible = t >= this.s.from - 0.5;
    if (!this.root.visible) return;
    o.rotation.set(0, 0, 0);

    // every place of the sky is an offset from the eye of now (see `place`)
    const cam = this.s.camAt(t), eye = cam.position, P = new THREE.Vector3(), Q = new THREE.Vector3();
    // ---- the melody: a star flares on its note; the line from the note before runs to it in `DRAW` s; both fade over `NOTE_LIFE`
    let n = 0, m = 0;
    const face = (p: THREE.Vector3, along: THREE.Vector3 | null) => {
      const z = this.v.copy(eye).sub(p).normalize();
      const x = along ? along.clone().addScaledVector(z, -along.dot(z)).normalize() : new THREE.Vector3(0, 1, 0).cross(z).normalize();
      o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, z.clone().cross(x), z));
    };
    C3Lights.recent(this.melody, t, NOTE_LIFE, NOTES, (e, age) => {
      const k = (1 - age / NOTE_LIFE) ** 2, flare = Math.exp(-age / 0.08);
      P.copy(eye).add(e.p);
      face(P, null);
      o.position.copy(P);
      o.scale.setScalar(20 + 50 * flare);
      o.updateMatrix();
      this.nodes.setMatrixAt(n, o.matrix);
      this.nodes.setColorAt(n++, c.copy(e.c).multiplyScalar(0.6 + 3 * flare).multiplyScalar(k));
      if (e.prev < 0) return;
      const a = Q.copy(eye).add(this.melody[e.prev]!.p), run = Math.min(1, age / DRAW);
      const d = P.clone().sub(a), end = a.clone().addScaledVector(d, run), len = d.length() * run;
      if (len < 1) return;
      face(a.clone().add(end).multiplyScalar(0.5), d);
      o.position.copy(a).add(end).multiplyScalar(0.5);
      o.scale.set(len, 9 + 10 * flare, 1);
      o.updateMatrix();
      this.links.setMatrixAt(m, o.matrix);
      this.links.setColorAt(m++, c.copy(e.c).multiplyScalar(2.6 * k));
    });
    this.nodes.count = n;
    this.links.count = m;

    // ---- the fireworks: the shell bursts, the sparks fall and fade
    n = 0;
    C3Lights.recent(this.shells, t, SHELL_LIFE, SHELLS, (e, age) => {
      const R = 120 + 70 * hashSin(e.k, 3), r = R * (1 - Math.exp(-5 * age)), fade = (1 - age / SHELL_LIFE) ** 1.5;
      const pc = col(SHELL_COLS[e.k % SHELL_COLS.length]!);
      o.quaternion.copy(e.q);
      for (let j = 0; j < SPARKS; j++) {
        const a = hashSin(e.k * 131 + j, 4) * Math.PI * 2, b = Math.acos(2 * hashSin(e.k * 131 + j, 5) - 1);
        o.position.set(eye.x + e.p.x + r * Math.sin(b) * Math.cos(a), eye.y + e.p.y + r * Math.cos(b) - 30 * age * age, eye.z + e.p.z + r * Math.sin(b) * Math.sin(a));
        o.scale.setScalar(R * 0.05 * (0.5 + fade));
        o.updateMatrix();
        this.sparks.setMatrixAt(n, o.matrix);
        this.sparks.setColorAt(n++, c.copy(pc).multiplyScalar((j % 3 ? 2.2 : 4) * fade * (age < 0.06 ? 2.5 : 1)));
      }
    });
    this.sparks.count = n;

    // ---- the rings of the chords: they run out from the eclipse, round the eye of now
    n = 0;
    const at = this.v.copy(eye).addScaledVector(this.s.eclipse, RING_D);
    for (let k = this.chords.length - 1; k >= 0 && n < RINGS; k--) {
      const age = t - this.chords[k]!;
      if (age < 0) continue;
      if (age > RING_LIFE) break;
      const u = age / RING_LIFE;
      o.position.copy(at);
      o.lookAt(cam.position);
      o.scale.setScalar(RING_D * (0.06 + 0.3 * (1 - (1 - u) ** 3)));
      o.updateMatrix();
      this.rings.setMatrixAt(n, o.matrix);
      this.rings.setColorAt(n++, c.setRGB(0.85, 0.9, 1).multiplyScalar(1.1 * (1 - u) ** 2));
    }
    this.rings.count = n;

    // ---- the glints of the hats: a cross of two thin bars
    n = 0;
    C3Lights.recent(this.glints, t, GLINT_LIFE, GLINTS, (e, age) => {
      const g = Math.sin(Math.PI * Math.min(1, age / GLINT_LIFE));
      for (let j = 0; j < 2; j++) {
        o.quaternion.copy(e.q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), j * (Math.PI / 2)));
        o.position.copy(eye).add(e.p);
        o.scale.set(60 * g + 4, 4, 1);
        o.updateMatrix();
        this.glintMesh.setMatrixAt(n, o.matrix);
        this.glintMesh.setColorAt(n++, c.setRGB(0.9, 0.95, 1).multiplyScalar(2.4 * g));
      }
    });
    this.glintMesh.count = n;

    // ---- the shooting stars: a streak that runs down across the sky
    n = 0;
    C3Lights.recent(this.streaks, t, STREAK_LIFE, STREAKS, (e, age) => {
      const u = age / STREAK_LIFE, dir = hashSin(e.k, 21) < 0.5 ? -1 : 1, tilt = dir * 0.57;
      const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt);
      o.quaternion.copy(e.q).multiply(turn);
      // along the streak: its own x axis in the plane that faces the eye
      const along = new THREE.Vector3(1, 0, 0).applyQuaternion(o.quaternion);
      o.position.copy(eye).add(e.p).addScaledVector(along, -dir * 500 * u);
      o.scale.set(260 * (1 - u) + 20, 5, 1);
      o.updateMatrix();
      this.streakMesh.setMatrixAt(n, o.matrix);
      this.streakMesh.setColorAt(n++, c.setRGB(1, 0.95, 0.8).multiplyScalar(2.6 * (1 - u)));
    });
    this.streakMesh.count = n;

    for (const msh of [this.nodes, this.links, this.sparks, this.rings, this.glintMesh, this.streakMesh]) {
      msh.instanceMatrix.needsUpdate = true;
      msh.instanceColor!.needsUpdate = true;
    }
  }

  dispose() {
    this.root.traverse((m) => { if (m instanceof THREE.Mesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  }
}
