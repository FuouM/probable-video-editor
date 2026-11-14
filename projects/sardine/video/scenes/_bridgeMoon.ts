// The moon of the bridge, which is the game disc: craters, grooves, sheen, spin rings, the red read line and the cracks of the ram.
// `BridgeMoon.pose(t)` is a pure function of t.
import * as THREE from 'three';
import { mulberry32, stepT } from '@pve/engine/util';
import { Builder, litMesh, point, v3, type Cell, type Face, type LitAtlas } from '@pve/engine/lit';
import { T_DIVE, T_PULL, type MoonPlan } from './_bridgepath';
import { fbm, mix } from './_bridgePaint';
import { BAR } from './_time';

const DISC_PX = 320;
const R = DISC_PX / 2;
const SPIN = 0.25;
const SHEEN_SPIN = -0.55;
/** The ram: the cracks grow in four steps of 2 frames from T_DIVE, so they reach the whole disc before the cut at 85.333. */
const CRACK_LENS = [0.3, 0.6, 1.0, 1.8] as const;
const CRACK_STEP = 2 / 36;

type CrackPoint = { x: number; y: number; s: number };

/** The distance of disc pixel (x, y) from the middle, in disc radii. */
const hyp = (x: number, y: number) => Math.hypot(x + 0.5 - R, y + 0.5 - R) / R;

/** A square quad of half size S at depth z in the disc frame, with the whole cell mapped on it. */
function discQuad(mat: THREE.Material, cell: Cell, S: number, z: number): THREE.Mesh {
  const b = new Builder();
  b.quad(v3(-S, -S, z), v3(S, -S, z), v3(S, S, z), v3(-S, S, z), { cell, map: 'fit' });
  return litMesh(b, mat, { cast: false, receive: false });
}

export class BridgeMoon {
  /** The red light of the read line. It always stays in the scene: a light that leaves it changes the light count and recompiles every lit program. */
  private readonly readLight = point('#ff3040', 600, 70);
  /** The frame of the moon that does not turn (x right, y up, z to the train): add it to the scene. */
  readonly root = new THREE.Group();
  private base = new THREE.Group();
  private sheen = new THREE.Group();
  private rings: THREE.Group[] = [];
  private readLine = new THREE.Group();
  private crackStages: THREE.Group[] = [];
  private crackPaths: CrackPoint[][] = [];
  /** The impact point of the ram: its angle round the disc centre, and the disc's rest place and axes. */
  private angle = 0;
  private readonly rest = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  /** The angle of the impact point of the ram in the moon frame. */
  get impactAngle(): number { return this.angle; }

  build(A: LitAtlas, mat: THREE.Material, M: MoonPlan) {
    const impact = this.place(M);
    const S = M.radius;
    this.base.add(discQuad(mat, paintDisc(A), S, 0));
    this.root.add(this.base);
    this.sheen.add(discQuad(mat, paintSheen(A), S, 0.35));
    this.root.add(this.sheen);
    this.buildRings(A, mat, S);
    this.buildCracks(A, mat, S, impact);
    this.buildReadLine(A, mat, S);
  }

  /** Faces the disc to the camera (the basis is right, up, normal) and returns the impact point in the disc frame at time 0. */
  private place(M: MoonPlan): { x: number; y: number } {
    const right = v3(0, 1, 0).cross(M.normal).normalize();
    const up = M.normal.clone().cross(right);
    this.root.position.copy(M.centre);
    this.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, M.normal));
    // the impact point S of the ram: its unit coordinates on the disc and its angle in the frame that turns with the disc at T_DIVE
    const rel = M.scratch.clone().sub(M.centre);
    const ix = rel.dot(right) / M.radius, iy = rel.dot(up) / M.radius;
    this.angle = Math.atan2(iy, ix);
    this.rest.copy(M.centre);
    this.right.copy(right);
    this.up.copy(up);
    const aL = this.angle - SPIN * T_DIVE, rI = Math.hypot(ix, iy);
    return { x: rI * Math.cos(aL), y: rI * Math.sin(aL) };
  }

  /** The spin rings: dashed circles that turn at different rates round the disc. */
  private buildRings(A: LitAtlas, mat: THREE.Material, S: number) {
    for (const [rad, dashes, off] of [[0.78, 14, 0.0], [0.62, 10, 0.2]] as const) {
      const cell = A.paint(DISC_PX, DISC_PX, (p) => {
        for (let y = 0; y < DISC_PX; y++) for (let x = 0; x < DISC_PX; x++) {
          const r = hyp(x, y);
          if (Math.abs(r - rad) > 0.011) continue;
          const ang = Math.atan2(y + 0.5 - R, x + 0.5 - R) + Math.PI;
          if (Math.floor((ang / (Math.PI * 2)) * dashes * 2) % 2 === 0) p.px(x, y, '#d8ecff', 2.2);
        }
      });
      const g = new THREE.Group();
      g.add(discQuad(mat, cell, S * 1.5, -0.6 - off));
      this.rings.push(g);
      this.root.add(g);
    }
  }

  /** The cracks of the ram: radial cracks from the impact point, grown in four nested steps; hidden until T_DIVE. */
  private buildCracks(A: LitAtlas, mat: THREE.Material, S: number, impact: { x: number; y: number }) {
    this.crackPaths = planCracks(impact);
    for (const len of CRACK_LENS) {
      const g = new THREE.Group();
      g.add(discQuad(mat, paintCracks(A, this.crackPaths, impact, len), S, 0.5));
      g.visible = false;
      this.crackStages.push(g);
      this.base.add(g);
    }
  }

  /** The red read line (a radial bar that sweeps the disc in bars 45 to 48, in the frame that does not turn) and its red light. */
  private buildReadLine(A: LitAtlas, mat: THREE.Material, S: number) {
    const lb = new Builder();
    const red: Face = { cell: A.solid('#ff2a3a', 4.2) };
    lb.quad(v3(0.12 * S, -0.5, 0.7), v3(0.98 * S, -0.5, 0.7), v3(0.98 * S, 0.5, 0.7), v3(0.12 * S, 0.5, 0.7), red);
    this.readLine.add(litMesh(lb, mat, { cast: false, receive: false }));
    this.readLight.position.set(0.6 * S, 0, 8);
    this.readLine.add(this.readLight);
    this.root.add(this.readLine);
  }

  pose(t: number) {
    const near = t >= T_PULL;
    // the disc parts hide, the read line's group (with its light) stays: see the read line below
    for (const c of this.root.children) if (c !== this.readLine) c.visible = near;
    this.readLine.visible = true;
    if (!near) {
      for (const c of this.readLine.children) if (c !== this.readLight) c.visible = false;
      this.readLight.intensity = 0;
      return;
    }
    this.base.rotation.z = SPIN * t;
    this.sheen.rotation.z = SHEEN_SPIN * t;
    this.rings[0]!.rotation.z = 0.9 * t;
    this.rings[1]!.rotation.z = -0.6 * t;
    // the ram: the disc shudders in its plane, and the cracks grow in four steps of 2 frames
    const hit = Math.max(0, t - T_DIVE);
    const sh = hit > 0 ? 1.6 * Math.exp(-9 * hit) * Math.sin(70 * hit) : 0;
    this.root.position.copy(this.rest).addScaledVector(this.right, sh).addScaledVector(this.up, 0.6 * sh);
    this.crackStages.forEach((g, k) => { g.visible = t >= T_DIVE + k * CRACK_STEP - 1e-6; });
    this.poseReadLine(t);
  }

  /**
   * The read line: on from the first frame in which the disc is in view. It sweeps the disc once in each bar, in steps of 18 fps, and
   * flashes on every beat. The last sweep ends on the impact point at T_DIVE: the head reads where the train rams.
   */
  private poseReadLine(t: number) {
    const on = t < T_DIVE;
    // hide the bar, never the light: a light that leaves the scene changes the light count and recompiles every lit program
    for (const c of this.readLine.children) if (c !== this.readLight) c.visible = on;
    this.readLight.intensity = 0;
    if (!on) return;
    const SWEEP = 2.4;
    const ts = stepT(t, 18);
    const flash = Math.max(0, 1 - ((((ts / BAR) * 4) % 1) / 0.12));
    this.readLine.rotation.z = this.angle - SWEEP * ((T_DIVE - ts) / BAR);
    this.readLine.scale.set(1, 1 + 2 * flash, 1);
    this.readLight.intensity = 500 + 900 * flash;
  }
}

/** The face of the disc: a full moon (maria, highlands, craters) over the fine concentric grooves of a game disc, with a small hub. */
function paintDisc(A: LitAtlas): Cell {
  const rnd = mulberry32(0x5c4a);
  const craters = Array.from({ length: 38 }, () => {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.9;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.03 + rnd() * rnd() * 0.12 };
  });
  return A.paint(DISC_PX, DISC_PX, (p) => {
    for (let y = 0; y < DISC_PX; y++) for (let x = 0; x < DISC_PX; x++) {
      const dx = (x + 0.5 - R) / R, dy = (y + 0.5 - R) / R, r = Math.hypot(dx, dy);
      if (r > 1) continue;
      if (r < 0.025) { p.px(x, y, '#0a0b12', 0.2); continue; }
      if (r < 0.06) { p.px(x, y, '#9a9eb4', 0.9); continue; }
      const n = fbm(dx * 2.6 + 4, dy * 2.6 + 9);
      let c = n > 0.55 ? mix('#7a8096', '#9096ac', (n - 0.55) * 4) : mix('#ece6d2', '#cfcbbd', Math.min(1, n * 1.4));
      for (const k of craters) {
        const d = Math.hypot(dx - k.x, dy - k.y) / k.r;
        // the floor is dark with a shadow on the upper left, the rim is bright on the lower right
        if (d < 0.86) c = mix(c, '#4e5268', 0.5 + 0.25 * ((dx - k.x) / k.r < 0 ? 1 : 0));
        else if (d < 1.12) c = mix(c, '#ffffff', 0.5 * (1 + ((dx - k.x) - (dy - k.y)) / k.r) / 2 + 0.2);
      }
      // the fine grooves of the disc: thin concentric steps, 1 px wide
      if (Math.floor(r * DISC_PX * 0.5) % 3 === 0) c = mix(c, '#1c2036', 0.13);
      p.px(x, y, c, r > 0.97 ? 1.2 : 0.85);
    }
  });
}

/** The sheen of the disc: two rainbow lobes of sparse dots. */
function paintSheen(A: LitAtlas): Cell {
  return A.paint(DISC_PX, DISC_PX, (p) => {
    const c = new THREE.Color();
    for (let y = 0; y < DISC_PX; y++) for (let x = 0; x < DISC_PX; x++) {
      const r = hyp(x, y);
      if (r > 0.98 || r < 0.22 || (x * 7 + y * 13) % 4 !== 0) continue;
      const ang = Math.atan2(y + 0.5 - R, x + 0.5 - R);
      const lobe = Math.abs(Math.sin(2 * ang + 0.6));
      if (lobe < 0.9) continue;
      c.setHSL(((ang / (Math.PI * 2) + 1 + r * 0.6) % 1), 0.95, 0.62);
      p.px(x, y, `#${c.getHexString()}`, 0.9 * lobe);
    }
  });
}

/** The crack lines of the ram: radial random walks from the impact point, with forks. `s` is the length along the crack in disc radii. */
function planCracks(at: { x: number; y: number }): CrackPoint[][] {
  const rnd = mulberry32(0xc7ac);
  const paths: CrackPoint[][] = [];
  const ds = 0.01;
  const walk = (x0: number, y0: number, a0: number, s0: number, len: number, depth: number) => {
    const pts: CrackPoint[] = [];
    let x = x0, y = y0, a = a0;
    for (let s = 0; s <= len; s += ds) {
      pts.push({ x, y, s: s0 + s });
      a += (rnd() - 0.5) * 0.22;
      x += Math.cos(a) * ds; y += Math.sin(a) * ds;
      if (Math.hypot(x, y) > 1.02) break;
      if (depth < 2 && s > 0.12 && rnd() < 0.012) walk(x, y, a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5), s0 + s, (len - s) * 0.7, depth + 1);
    }
    paths.push(pts);
  };
  const N = 17;
  for (let k = 0; k < N; k++) walk(at.x, at.y, (k / N) * Math.PI * 2 + (rnd() - 0.5) * 0.3, 0, 2, 0);
  return paths;
}

/** One step of the cracks: every crack up to length `maxLen` (the steps are nested), a black core with a white-blue glow on both sides. */
function paintCracks(A: LitAtlas, paths: CrackPoint[][], at: { x: number; y: number }, maxLen: number): Cell {
  const pix = (v: number) => Math.round(v * R + R - 0.5);
  return A.paint(DISC_PX, DISC_PX, (p) => {
    const pts = paths.flatMap((c) => c.filter((q) => q.s <= maxLen));
    // the flash at the point of impact (the first step only)
    if (maxLen <= CRACK_LENS[0]) {
      const X = pix(at.x), Y = pix(at.y);
      const fr = Math.round(10 * DISC_PX / 192);
      for (let dy = -fr; dy <= fr; dy++) for (let dx = -fr; dx <= fr; dx++) if (dx * dx + dy * dy <= fr * fr) p.px(X + dx, Y + dy, '#fff4e0', 1.5);
    }
    for (const q of pts) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1]] as const) p.px(pix(q.x) + dx, pix(q.y) + dy, '#cfe0ff', 1.2);
    for (const q of pts) {
      const X = pix(q.x), Y = pix(q.y);
      p.px(X, Y, '#04050a');
      p.px(X + 1, Y, '#04050a'); p.px(X, Y + 1, '#04050a'); p.px(X + 1, Y + 1, '#04050a');
      if (q.s < 0.3) { p.px(X - 1, Y, '#04050a'); p.px(X, Y - 1, '#04050a'); p.px(X + 2, Y, '#04050a'); p.px(X, Y + 2, '#04050a'); }
    }
  });
}
