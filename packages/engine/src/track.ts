// Railway track along any curve (lit renderer). Two rails (default 1.067 m apart, the Japanese narrow gauge), sleepers
// every 0.6 m and a ballast bed. The rail tops lie on the curve; the bed lies below it. A free `up(u)` lets the
// track twist along its way (a Möbius strip), and `twoSided` puts rails and sleepers on the underside too.
import * as THREE from 'three';
import { Builder, type Face, type LitAtlas } from './lit';

export interface TrackOpts {
  /** The up vector of the track at u (0..1). Default: world up. It need not be exactly perpendicular. */
  up?: (u: number) => THREE.Vector3;
  /** Rails and sleepers on the underside too (a Möbius track). Then there is no ballast unless asked. */
  twoSided?: boolean;
  /** Distance between sleeper centres (m). Default 0.6. */
  sleeperGap?: number;
  /** A ballast bed under the sleepers. Default: yes on a one-sided track. */
  ballast?: boolean;
  /** Build the sleepers. Default true. A scene that takes sleepers away builds its own. */
  sleepers?: boolean;
  /** Distance between rail cross sections (m). Default 0.75. Use less on tight curves. */
  step?: number;
  /** The curve is a closed loop (the last section joins the first). */
  closed?: boolean;
  /** The painted faces to use (from `trackFaces`). A track that is rebuilt often paints them once: each paint takes atlas space. */
  faces?: TrackFaces;
  /** Distance between the rail centres (m). Default 1.067. */
  gauge?: number;
  /** Depth of the rail below its top (m). Default 0.15. */
  railDepth?: number;
  /** Half width of the rail head (m). Default 0.05. */
  railHead?: number;
  /** Half width of the rail web (m). Default 0.03. */
  railWeb?: number;
  /** Depth of the rail head (m). Default 0.05. */
  railHeadDepth?: number;
  /** Height of the sleeper top relative to the rail top (m). Default -0.15. */
  sleeperTop?: number;
  /** Height of the sleeper bottom relative to the rail top (m). Default -0.45. */
  sleeperBottom?: number;
  /** Sleeper length across the track and width along it (m). Default 2.2 and 0.22. */
  sleeperLength?: number;
  sleeperWidth?: number;
  /** Height of the ballast bed bottom relative to the rail top (m). Default -0.5. */
  bedBottom?: number;
}

/** A frame on the track: its position, the unit tangent, the unit side (to the right of the tangent) and the unit up. */
export interface TrackFrame { pos: THREE.Vector3; tangent: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3 }

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * The track frame at u (0..1 along the curve by arc length). side = tangent x up, so with the tangent along +x and
 * up along +y the side is +z. The up vector is made exactly perpendicular to the tangent.
 */
export function frameAt(path: THREE.Curve<THREE.Vector3>, up: ((u: number) => THREE.Vector3) | undefined, u: number): TrackFrame {
  const uu = Math.min(1, Math.max(0, u));
  const pos = path.getPointAt(uu);
  const tangent = path.getTangentAt(uu).normalize();
  const side = new THREE.Vector3().crossVectors(tangent, up ? up(u) : WORLD_UP).normalize();
  const upv = new THREE.Vector3().crossVectors(side, tangent).normalize();
  return { pos, tangent, side, up: upv };
}

/** The matrix that puts a Builder box (x along the track, y up, z to the side) on the frame, moved by (dt, dy, ds). */
export function frameMatrix(f: TrackFrame, dt = 0, dy = 0, ds = 0): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeBasis(f.tangent, f.up, f.side);
  m.setPosition(
    f.pos.x + f.tangent.x * dt + f.up.x * dy + f.side.x * ds,
    f.pos.y + f.tangent.y * dt + f.up.y * dy + f.side.y * ds,
    f.pos.z + f.tangent.z * dt + f.up.z * dy + f.side.z * ds,
  );
  return m;
}

/** The faces a track uses (colours are painted into the atlas once per call). */
export interface TrackFaces { rail: Face; sleeper: Face; ballast: Face }

/** The paint of the track faces: a base fill, a stripe (rail top, sleeper grain) and speckles. */
export interface TrackColours {
  rail: { fill: string; top: string; rust: string };
  sleeper: { fill: string; grain: string; speckle: string };
  ballast: { fill: string; speckles: [string, string, string] };
}

/** Grey steel rails with a bright top, brown wood sleepers, grey ballast. */
export const TRACK_COLOURS: TrackColours = {
  rail: { fill: '#6a6a72', top: '#8c8c94', rust: '#7a5a46' },
  sleeper: { fill: '#4c3a2c', grain: '#3a2c22', speckle: '#5a4636' },
  ballast: { fill: '#6f6c68', speckles: ['#86837d', '#55524f', '#9a968e'] },
};

export function trackFaces(atlas: LitAtlas, c: TrackColours = TRACK_COLOURS): TrackFaces {
  const rail: Face = { cell: atlas.paint(4, 4, (p) => { p.fill(c.rail.fill); p.rect(0, 3, 4, 1, c.rail.top); p.speckle(c.rail.rust, 0.18, 5); }) };
  const sleeper: Face = { cell: atlas.paint(8, 8, (p) => { p.fill(c.sleeper.fill); p.rect(0, 3, 8, 1, c.sleeper.grain); p.speckle(c.sleeper.speckle, 0.25, 11); }) };
  const [s1, s2, s3] = c.ballast.speckles;
  const ballast: Face = { cell: atlas.paint(16, 16, (p) => { p.fill(c.ballast.fill); p.speckle(s1, 0.3, 3); p.speckle(s2, 0.3, 8); p.speckle(s3, 0.08, 21); }) };
  return { rail, sleeper, ballast };
}

/**
 * Builds the track along `path`. Rail tops lie on the curve (y = 0 for a flat track), the sleepers and the ballast
 * below it. Returns the Builder: make a mesh of it with litMesh.
 */
export function buildTrack(atlas: LitAtlas, path: THREE.Curve<THREE.Vector3>, opts: TrackOpts = {}): Builder {
  const {
    sleeperGap: gap = 0.6, step = 0.75, closed = false, twoSided = false, ballast = !twoSided, faces = trackFaces(atlas),
    gauge = 1.067, railDepth = 0.15, railHead = 0.05, railWeb = 0.03, railHeadDepth = 0.05,
    sleeperTop = -0.15, sleeperBottom = -0.45, sleeperLength = 2.2, sleeperWidth = 0.22, bedBottom = -0.5,
  } = opts;
  const b = new Builder();
  const len = path.getLength();

  // the rail cross section, clockwise seen with the track side to the right and up up: foot-less I shape
  const railProfile = (centre: number): [number, number][] => [
    [centre - railWeb, -railDepth], [centre - railWeb, -railHeadDepth], [centre - railHead, -railHeadDepth], [centre - railHead, 0],
    [centre + railHead, 0], [centre + railHead, -railHeadDepth], [centre + railWeb, -railHeadDepth], [centre + railWeb, -railDepth],
  ];
  // the mirror of a profile about the bed centre (the underside); the order is reversed to keep the faces outward
  const mid = (sleeperTop + sleeperBottom) / 2;
  const flip = (prof: [number, number][]): [number, number][] => prof.map(([a, y]): [number, number] => [a, 2 * mid - y]).reverse();

  const nSec = Math.max(2, Math.ceil(len / step));
  const sections = (n: number) => {
    const out: { p: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3 }[] = [];
    const count = closed ? n : n + 1;
    for (let k = 0; k < count; k++) {
      const f = frameAt(path, opts.up, k / n);
      out.push({ p: f.pos, side: f.side, up: f.up });
    }
    return out;
  };
  const secs = sections(nSec);
  for (const c of [-gauge / 2, gauge / 2]) {
    b.sweep(secs, railProfile(c), faces.rail, closed);
    if (twoSided) b.sweep(secs, flip(railProfile(c)), faces.rail, closed);
  }
  // end caps of the rails are not built: a rail runs off the curve's ends, which is never seen

  if (ballast) {
    // a trapezoid bed, wider at the bottom, its top just under the sleepers' tops
    const bed: [number, number][] = [[-2.1, bedBottom], [-1.35, sleeperTop - 0.03], [1.35, sleeperTop - 0.03], [2.1, bedBottom]];
    b.sweep(secs, bed, faces.ballast, closed);
  }

  // sleepers: boxes standing on y = 0 in the builder, moved to the bed
  const nSl = opts.sleepers === false ? 0 : Math.max(1, Math.floor(len / gap));
  for (let k = 0; k < nSl; k++) {
    const u = closed ? k / nSl : (k + 0.5) / nSl;
    const f = frameAt(path, opts.up, u);
    const m = frameMatrix(f, 0, sleeperBottom, 0);
    b.box(sleeperWidth, sleeperTop - sleeperBottom, sleeperLength, { py: faces.sleeper, ny: twoSided ? faces.sleeper : undefined, px: faces.sleeper, nx: faces.sleeper, pz: faces.sleeper, nz: faces.sleeper }, m);
  }
  return b;
}
