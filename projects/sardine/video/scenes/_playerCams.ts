// The camera subsystem of sardine. The kick bounce of the ride cams is in `_rideMusic.ts`.
// Four camera modes, all pure functions of t:
//   1. HeadCam: head in the room (turns with overshoot, settles with critically damped spring).
//   2. MapCam: dimetric map (yaw in 90-degree steps, three zoom notches, pan/edge scroll/follow).
//   3. RideCam: spring arm on a train (chase34, side, low, cabin, with kick bounce and impact shake).
//   4. FixedCam: bolted down camera with notch transitions.
//   5. FishCam: tight lens on the sardine in the car.
import * as THREE from 'three';
import { lerp, smooth } from '@pve/engine/util';
import { LH, LW } from '@pve/engine/lit';
import type { PlayerTrack } from './_playerTrack';
import type { MapInput, Vec2, Vec3 } from './_playerTypes';
import { kickBounce } from './_rideMusic';
import { FR } from './_time';
import { dragEase } from './_ease';

// ================================================================ cameras

/** A camera mode: sets `cam` for time t. */
export interface PlayerCamera<C extends THREE.Camera = THREE.Camera> { apply(cam: C, t: number): void }

// ---------------------------------------------------------------- head (the room)

export interface HeadSpec {
  /** The eye: fixed at seated height. */
  eye: Vec3;
  /** Where the head looks before its first turn. */
  look: Vec3;
  /** Each turn: the look target changes at `at`. A turn has a cause (a sound, an event on the CRT). */
  turns?: { at: number; look: Vec3 }[];
  fov?: number;
  /** Stretches every turn in time: 1 is the turn of 0.25 s, 1.6 is the turn of a person who looks round (0.4 s). Default 1. */
  slow?: number;
}

/** The turn is about 0.25 s: this is the natural frequency of the critically damped spring. */
const HEAD_OMEGA = 19;

interface Turn { at: number; yaw: number; pitch: number; ey: number; ep: number; cy: number; cp: number }

function angles(eye: Vec3, look: Vec3): { yaw: number; pitch: number } {
  const dx = look[0] - eye[0], dy = look[1] - eye[1], dz = look[2] - eye[2];
  return { yaw: Math.atan2(dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** The coefficient c of e(τ) = (e0 + c τ) e^(-ω τ) that makes the overshoot `ovs` (radians, opposite to e0). */
function kick(e0: number, ovs: number): number {
  const a = Math.abs(e0);
  if (a < 1e-6 || ovs < 1e-6) return HEAD_OMEGA * e0;
  // the extreme of e is r e^(-1 - a / r) with r = |c| / ω: find r for that extreme by bisection
  let lo = 1e-6, hi = 4 * a + ovs;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (mid * Math.exp(-1 - a / mid) < ovs) lo = mid; else hi = mid;
  }
  return -Math.sign(e0) * HEAD_OMEGA * ((lo + hi) / 2);
}

/**
 * The head of the player in the room (treatment "The head"). The eye is fixed. The look target changes in turns of about
 * 0.25 s that overshoot by a few degrees, settle with a critically damped spring and then hold. The breathing is +-4 mm
 * at 0.3 Hz. Nothing else moves.
 */
export class HeadCam implements PlayerCamera<THREE.PerspectiveCamera> {
  private turns: Turn[] = [];
  private y0: number;
  private p0: number;

  constructor(private s: HeadSpec) {
    const a0 = angles(s.eye, s.look);
    this.y0 = a0.yaw;
    this.p0 = a0.pitch;
    let yaw = a0.yaw, pitch = a0.pitch;
    let prev: Turn | null = null;
    for (const tr of [...(s.turns ?? [])].sort((a, b) => a.at - b.at)) {
      const a = angles(s.eye, tr.look);
      // unwrap the yaw to the shortest turn
      let ty = a.yaw;
      while (ty - yaw > Math.PI) ty -= 2 * Math.PI;
      while (ty - yaw < -Math.PI) ty += 2 * Math.PI;
      // where the head is when the turn starts (the previous turn may still be settling)
      if (prev) { yaw = this.axis(prev, 'yaw', tr.at); pitch = this.axis(prev, 'pitch', tr.at); }
      const ey = yaw - ty, ep = pitch - a.pitch;
      const ovs = (d: number) => Math.abs(d) < THREE.MathUtils.degToRad(2) ? 0 : Math.min(THREE.MathUtils.degToRad(4), Math.max(THREE.MathUtils.degToRad(1.5), 0.07 * Math.abs(d)));
      const turn: Turn = { at: tr.at, yaw: ty, pitch: a.pitch, ey, ep, cy: kick(ey, ovs(ey)), cp: kick(ep, ovs(ep)) };
      this.turns.push(turn);
      prev = turn;
      yaw = ty;
      pitch = a.pitch;
    }
  }

  private axis(tr: Turn, which: 'yaw' | 'pitch', t: number): number {
    const tau = Math.max(0, t - tr.at) / (this.s.slow ?? 1);
    const [target, e0, c] = which === 'yaw' ? [tr.yaw, tr.ey, tr.cy] : [tr.pitch, tr.ep, tr.cp];
    return target + (e0 + c * tau) * Math.exp(-HEAD_OMEGA * tau);
  }

  /** The yaw and pitch of the gaze at time t (radians). */
  gaze(t: number): { yaw: number; pitch: number } {
    let k = -1;
    for (let j = 0; j < this.turns.length && this.turns[j]!.at <= t; j++) k = j;
    if (k < 0) return { yaw: this.y0, pitch: this.p0 };
    return { yaw: this.axis(this.turns[k]!, 'yaw', t), pitch: this.axis(this.turns[k]!, 'pitch', t) };
  }

  apply(cam: THREE.PerspectiveCamera, t: number) {
    const { yaw, pitch } = this.gaze(t);
    const e = this.s.eye;
    cam.position.set(e[0], e[1] + 0.004 * Math.sin(2 * Math.PI * 0.3 * t), e[2]);
    const cp = Math.cos(pitch);
    cam.lookAt(cam.position.x + Math.sin(yaw) * cp, cam.position.y + Math.sin(pitch), cam.position.z - Math.cos(yaw) * cp);
    if (this.s.fov !== undefined) { cam.fov = this.s.fov; cam.updateProjectionMatrix(); }
  }
}

// ---------------------------------------------------------------- map (the hand)

/** Screen pixels per metre of the map at notch 1: 1 m along a world axis is exactly 8 px across and 4 px down. */
export const MAP_PPM = 8 * Math.SQRT2;
/** The three zoom notches (far, default, near). */
export const MAP_NOTCHES = [MAP_PPM * 0.5, MAP_PPM, MAP_PPM * 2] as const;
const PITCH = THREE.MathUtils.degToRad(30);
const ZOOM_TIME = 4 * FR;
/** The yaw of the map at step 0: the 2:1 dimetric corner. */
const YAW0 = Math.PI / 4;

export interface MapOpts {
  /** The ground point (x, z) the map looks at before any input. */
  center: Vec2;
  /** Ground height of the look point. Default 0. */
  groundY?: number;
  /** The start notch: an index into `notches`. Default 1. */
  zoom?: number;
  /** The zoom notches of this map in px per metre, far to near. Default `MAP_NOTCHES`. A world that is larger than the frame at the far notch gives its own. */
  notches?: readonly number[];
  /** The yaw step before any input (90 degrees each). */
  yaw?: number;
  /** The world point the map follows while `follow` is on (a train, say). */
  follow?: (t: number) => THREE.Vector3;
  /** Time constant of the follow lag, s. Default 0.2. */
  lag?: number;
  /** Edge scroll speed at full ramp, px/s. Default 160. */
  edgeSpeed?: number;
}

export interface MapView {
  /** The ground point at the middle of the frame. */
  center: THREE.Vector3;
  ppm: number;
  /** The yaw of the camera around the point, radians. */
  yaw: number;
  steps: number;
}

interface CenterSeg { t0: number; at: (t: number) => [number, number] }

/** The right and forward (screen up) ground directions of the map for a yaw. */
function groundBasis(yaw: number): { r: [number, number]; f: [number, number] } {
  return { r: [Math.cos(yaw), -Math.sin(yaw)], f: [-Math.sin(yaw), -Math.cos(yaw)] };
}

/**
 * The map camera (treatment "The hand"): dimetric, 30 degree pitch, orthographic. The yaw moves in 90 degree steps. There
 * are three zoom notches of 4 frames each. Pan is an edge scroll (the speed ramps up) or a right-drag (1:1 with the
 * cursor, stops dead). Follow locks to a world point with a short lag. All of it comes from the track's inputs.
 */
export class MapCam implements PlayerCamera<THREE.OrthographicCamera> {
  private segs: CenterSeg[] = [];
  private zooms: { at: number; from: number; to: number; dur: number }[] = [];
  private rots: { at: number; steps: number }[] = [];
  private ppm0: number;
  private notches: readonly number[];
  /** The camera of `project`. */
  private projCam = new THREE.OrthographicCamera(-1, 1, 1, -1);

  constructor(track: PlayerTrack, private o: MapOpts) {
    this.notches = o.notches ?? MAP_NOTCHES;
    this.ppm0 = this.notch(o.zoom ?? 1);
    this.segs.push({ t0: -Infinity, at: () => [o.center[0], o.center[1]] });
    let steps = o.yaw ?? 0;
    let ppm = this.ppm0;
    for (const ev of track.map) {
      const prev = this.segs[this.segs.length - 1]!;
      const c0 = prev.at(ev.at);
      switch (ev.kind) {
        case 'rotate':
          steps += ev.steps;
          this.rots.push({ at: ev.at, steps });
          break;
        case 'zoom': {
          const to = this.notch(ev.notch);
          this.zooms.push({ at: ev.at, from: ppm, to, dur: ev.dur ?? ZOOM_TIME });
          ppm = to;
          break;
        }
        case 'look': this.segs.push(this.lookSeg(ev, c0)); break;
        case 'pan': this.segs.push(this.panSeg(ev, c0)); break;
        case 'edge': this.segs.push(this.edgeSeg(ev, c0)); break;
        case 'follow': this.segs.push(this.followSeg(ev, c0)); break;
      }
    }
  }

  private notch(k: number): number {
    const p = this.notches[k];
    if (p === undefined) throw new Error(`player: the map has no zoom notch ${k}`);
    return p;
  }

  /** A look from `c0` to the ground point of the input. */
  private lookSeg(ev: Extract<MapInput, { kind: 'look' }>, c0: [number, number]): CenterSeg {
    const { to, dur } = ev;
    if (ev.straight) {
      // the screen offset of `to` shrinks with k: the centre follows the scale of the zoom that runs at the same time
      return { t0: ev.at, at: (t) => {
        const s = (this.ppmAt(ev.at) / this.ppmAt(t)) * (1 - smooth((t - ev.at) / dur));
        return [to[0] + (c0[0] - to[0]) * s, to[1] + (c0[1] - to[1]) * s];
      } };
    }
    return { t0: ev.at, at: (t) => { const k = smooth((t - ev.at) / dur); return [lerp(c0[0], to[0], k), lerp(c0[1], to[1], k)]; } };
  }

  /** A right-drag: the map follows the cursor 1:1, grabbing the ground and pulling it. */
  private panSeg(ev: Extract<MapInput, { kind: 'pan' }>, c0: [number, number]): CenterSeg {
    const { r, f } = groundBasis(YAW0 + (this.stepsAt(ev.at)) * (Math.PI / 2));
    const p = this.ppmAt(ev.at);
    const dx = -ev.by[0] / p, dz = ev.by[1] / (p * Math.sin(PITCH));
    const end: [number, number] = [c0[0] + r[0] * dx + f[0] * dz, c0[1] + r[1] * dx + f[1] * dz];
    return { t0: ev.at, at: (t) => { const k = dragEase((t - ev.at) / ev.dur); return [lerp(c0[0], end[0], k), lerp(c0[1], end[1], k)]; } };
  }

  /** An edge scroll: the speed ramps up linearly over 0.5 s, then holds. */
  private edgeSeg(ev: Extract<MapInput, { kind: 'edge' }>, c0: [number, number]): CenterSeg {
    const { r, f } = groundBasis(YAW0 + this.stepsAt(ev.at) * (Math.PI / 2));
    const p = this.ppmAt(ev.at);
    const len = Math.hypot(ev.dir[0], ev.dir[1]) || 1;
    const ux = ev.dir[0] / len, uy = ev.dir[1] / len;
    const v = ev.speed ?? this.o.edgeSpeed ?? 160;
    const RAMP = 0.5;
    return {
      t0: ev.at,
      at: (t) => {
        const s = Math.max(0, Math.min(t - ev.at, ev.dur));
        // the speed ramps up linearly over RAMP, then holds
        const px = s < RAMP ? (v * s * s) / (2 * RAMP) : v * (RAMP / 2 + s - RAMP);
        const dx = (ux * px) / p, dz = (-uy * px) / (p * Math.sin(PITCH));
        return [c0[0] + r[0] * dx + f[0] * dz, c0[1] + r[1] * dx + f[1] * dz];
      },
    };
  }

  /** Follow on: the map eases onto the lagged follow point in 0.35 s. Follow off: it stops where it is. */
  private followSeg(ev: Extract<MapInput, { kind: 'follow' }>, c0: [number, number]): CenterSeg {
    if (!ev.on) return { t0: ev.at, at: () => c0 };
    const follow = this.o.follow;
    if (!follow) throw new Error('player: a follow input needs MapOpts.follow');
    const lag = this.o.lag ?? 0.2;
    return { t0: ev.at, at: (t) => { const k = smooth((t - ev.at) / 0.35); const g = this.lagged(follow, t, lag); return [lerp(c0[0], g[0], k), lerp(c0[1], g[1], k)]; } };
  }

  /** The follow point with an exponential lag: a weighted mean of its recent past (a pure function of t). */
  private lagged(f: (t: number) => THREE.Vector3, t: number, lag: number): [number, number] {
    const n = Math.ceil((4 * lag) / FR);
    let x = 0, z = 0, w = 0;
    for (let k = 0; k < n; k++) {
      const wk = Math.exp(-(k * FR) / lag);
      const p = f(t - k * FR);
      x += p.x * wk; z += p.z * wk; w += wk;
    }
    return [x / w, z / w];
  }

  private stepsAt(t: number): number {
    let s = this.o.yaw ?? 0;
    for (const r of this.rots) if (r.at <= t) s = r.steps;
    return s;
  }

  /** The scale at t. A zoom changes it by a constant factor per unit of its eased time, so a large zoom has an even pace. */
  private ppmAt(t: number): number {
    let p = this.ppm0;
    for (const z of this.zooms) if (z.at <= t) p = z.from * Math.pow(z.to / z.from, smooth((t - z.at) / z.dur)); else break;
    return p;
  }

  /** The state of the map camera at time t. */
  view(t: number): MapView {
    let k = 0;
    for (let j = 0; j < this.segs.length && this.segs[j]!.t0 <= t; j++) k = j;
    const c = this.segs[k]!.at(t);
    const steps = this.stepsAt(t);
    return { center: new THREE.Vector3(c[0], this.o.groundY ?? 0, c[1]), ppm: this.ppmAt(t), yaw: YAW0 + steps * (Math.PI / 2), steps };
  }

  /** Sets the orthographic camera for a frame of `w` x `h` logical pixels. */
  apply(cam: THREE.OrthographicCamera, t: number, w = LW, h = LH) {
    const v = this.view(t);
    const hw = w / v.ppm / 2, hh = h / v.ppm / 2;
    cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh;
    cam.near = -300; cam.far = 600;
    cam.position.set(v.center.x + Math.sin(v.yaw) * Math.cos(PITCH) * 150, v.center.y + Math.sin(PITCH) * 150, v.center.z + Math.cos(v.yaw) * Math.cos(PITCH) * 150);
    cam.lookAt(v.center);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /** The screen position (logical pixels, y down) of a world point at time t. */
  project(world: THREE.Vector3, t: number, w = LW, h = LH): Vec2 {
    const cam = this.projCam;
    this.apply(cam, t, w, h);
    const p = tmpP.copy(world).project(cam);
    return [((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h];
  }
}

// ---------------------------------------------------------------- ride (a train)

export type RideMode = 'chase34' | 'side' | 'low' | 'nose' | 'cabin';

/** A camera place in the train frame (x forward, y up, z to the left): the eye, the look point, the lens and the lag. */
export interface RideOffset { eye: Vec3; look: Vec3; fov: number; lag: number }

/** The defaults of the modes. The train kit's car is 20 m long and 2.8 m wide. `nose` is a close-up beside the front of the car. */
export const RIDE_OFFSETS: Record<RideMode, RideOffset> = {
  chase34: { eye: [-15, 4.4, -7.5], look: [3, 1.9, 0], fov: 42, lag: 0.14 },
  side: { eye: [0, 2.4, -22], look: [0, 2.0, 0], fov: 34, lag: 0.1 },
  low: { eye: [-11, 0.8, -5.5], look: [4, 2.9, 0], fov: 52, lag: 0.14 },
  nose: { eye: [2.5, 2.9, -5.2], look: [10.5, 2.4, 0], fov: 40, lag: 0.1 },
  cabin: { eye: [-7.9, 2.65, 0], look: [4, 2.45, 0], fov: 70, lag: 0 },
};

export interface RideSpec {
  /** The world matrix of the train (the kit's root: x forward, y up, z left) at time t. */
  pose: (t: number) => THREE.Matrix4;
  /** The mode, or the modes in time order (a view cycle is a hard cut). `swing`: the arm swings from the mode before to this one over that many seconds (about one beat) on an orbit round the look point, instead of cutting. */
  mode: RideMode | { at: number; mode: RideMode; swing?: number }[];
  /** Kick times (MIDI track 19). On each kick the arm bounces down and back (ガタン・ゴトン). */
  kicks?: readonly number[];
  /** True while the train is on rails (kicks count only then). Default always. */
  onRails?: (t: number) => boolean;
  /** Impacts shake the camera: time and size in metres (default 0.25). */
  impacts?: { at: number; amp?: number }[];
  /** The size of the kick bounce in metres. Default 0.035 (a cabin); a chase arm that shows the bounce needs more. */
  kickAmp?: number;
  offsets?: Partial<Record<RideMode, Partial<RideOffset>>>;
}

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpUp = new THREE.Vector3(), tmpP = new THREE.Vector3();

/**
 * The ride cam: a spring arm on the train (treatment "Camera modes"). The eye and the look point sit in the train
 * frame and lag behind it by a short exponential (a weighted mean of the train's recent poses), so the arm swings on
 * starts and curves. On each kick the arm bounces; on an impact it shakes. `cabin` is rigid (no lag).
 */
export class RideCam implements PlayerCamera<THREE.PerspectiveCamera> {
  private modes: { at: number; mode: RideMode; swing?: number }[];
  private off: Record<RideMode, RideOffset>;
  private kicks: readonly number[];

  constructor(private s: RideSpec) {
    this.modes = typeof s.mode === 'string' ? [{ at: -Infinity, mode: s.mode }] : [...s.mode].sort((a, b) => a.at - b.at);
    // a kick in the air is no joint: only the kicks of times on rails count
    this.kicks = s.onRails ? (s.kicks ?? []).filter((k) => s.onRails!(k)) : [...(s.kicks ?? [])];
    if (!this.modes.length) throw new Error('player: RideSpec.mode is empty');
    const merged = (m: RideMode): RideOffset => ({ ...RIDE_OFFSETS[m], ...s.offsets?.[m] });
    this.off = { chase34: merged('chase34'), side: merged('side'), low: merged('low'), nose: merged('nose'), cabin: merged('cabin') };
  }

  /** The mode at time t: the one the arm swings to, or has reached. */
  modeAt(t: number): RideMode {
    let m = this.modes[0]!.mode;
    for (const x of this.modes) if (x.at <= t) m = x.mode;
    return m;
  }

  /**
   * The arm in the train frame at time t: a mode, or the swing from one mode to the next. The swing orbits the eye round
   * the look point (the shortest way round) and blends the look point, the lens and the lag, with a smooth start and stop.
   * A swing that is cut by the next mode change starts that one from the pure mode before it.
   */
  armAt(t: number): RideOffset {
    let k = 0;
    while (k + 1 < this.modes.length && this.modes[k + 1]!.at <= t) k++;
    const cur = this.modes[k]!;
    const to = this.off[cur.mode];
    const swing = cur.swing ?? 0;
    if (k === 0 || swing <= 0 || t >= cur.at + swing) return to;
    const from = this.off[this.modes[k - 1]!.mode];
    const s = smooth((t - cur.at) / swing);
    const look = [0, 1, 2].map((i) => lerp(from.look[i]!, to.look[i]!, s)) as unknown as Vec3;
    const rel = (o: RideOffset) => ({ r: Math.hypot(o.eye[0] - o.look[0], o.eye[2] - o.look[2]), ang: Math.atan2(o.eye[2] - o.look[2], o.eye[0] - o.look[0]), h: o.eye[1] - o.look[1] });
    const a = rel(from), b = rel(to);
    const turn = ((((b.ang - a.ang + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    const ang = a.ang + turn * s, r = lerp(a.r, b.r, s), h = lerp(a.h, b.h, s);
    return { eye: [look[0] + r * Math.cos(ang), look[1] + h, look[2] + r * Math.sin(ang)], look, fov: lerp(from.fov, to.fov, s), lag: lerp(from.lag, to.lag, s) };
  }

  /** The time of the last hard cut (a mode change with no swing) at or before t: the lag must not reach back over it. */
  private cutAt(t: number): number {
    let at = -Infinity;
    for (let k = 1; k < this.modes.length && this.modes[k]!.at <= t; k++) if ((this.modes[k]!.swing ?? 0) <= 0) at = this.modes[k]!.at;
    return at;
  }

  apply(cam: THREE.PerspectiveCamera, t: number) {
    const o = this.armAt(t);
    const eye = new THREE.Vector3(), look = new THREE.Vector3();
    const n = o.lag > 0 ? Math.ceil((4 * o.lag) / FR) : 1;
    const cut = this.cutAt(t);
    let w = 0;
    for (let k = 0; k < n; k++) {
      const wk = o.lag > 0 ? Math.exp(-(k * FR) / o.lag) : 1;
      const m = this.s.pose(Math.max(cut, t - k * FR));
      eye.addScaledVector(tmpA.set(...o.eye).applyMatrix4(m), wk);
      // the look point lags half as much as the eye: the train drifts a little in the frame on speed
      look.addScaledVector(tmpB.set(...o.look).applyMatrix4(m), wk);
      w += wk;
    }
    eye.divideScalar(w);
    look.divideScalar(w);
    const m0 = this.s.pose(t);
    tmpUp.set(0, 1, 0).transformDirection(m0);
    const fov = o.fov;
    // the arm bounces along the train's up on each kick while the train is on rails
    if (this.kicks.length) eye.addScaledVector(tmpUp, kickBounce(t, this.kicks, this.s.kickAmp));
    for (const im of this.s.impacts ?? []) {
      const dt = t - im.at;
      if (dt < 0 || dt > 1.2) continue;
      const a = (im.amp ?? 0.25) * Math.exp(-9 * dt);
      const sh = tmpA.set(Math.sin(71 * dt + 1.3), Math.sin(53 * dt + 0.4), Math.sin(89 * dt)).multiplyScalar(a);
      eye.add(sh);
      look.addScaledVector(sh, 0.4);
    }
    cam.position.copy(eye);
    cam.up.copy(tmpUp);
    cam.lookAt(look);
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }
}

// ---------------------------------------------------------------- fixed

/** A zoom notch of a fixed camera (a security cam zooms in steps, like the map): the place it moves to at `at`. */
export interface FixedNotch { at: number; pos: Vec3; target: Vec3; fov: number }

export interface FixedSpec {
  pos: Vec3; target: Vec3; fov: number;
  /** 0.01 for macro shots. Default 0.05. */
  near?: number; far?: number;
  /** Zoom notches in time order. A notch takes 4 frames (a smooth step from the place before it). */
  notches?: FixedNotch[];
}

/** A window camera bolted to a place (a platform, a counter, a planter, a floor). Objects move in the frame, the camera does not. A security cam may zoom in notches. */
export class FixedCam implements PlayerCamera<THREE.PerspectiveCamera> {
  constructor(private s: FixedSpec) {}

  apply(cam: THREE.PerspectiveCamera, t: number) {
    let pos = this.s.pos, target = this.s.target, fov = this.s.fov;
    for (const n of this.s.notches ?? []) {
      if (t < n.at) break;
      const k = smooth((t - n.at) / ZOOM_TIME);
      pos = [lerp(pos[0], n.pos[0], k), lerp(pos[1], n.pos[1], k), lerp(pos[2], n.pos[2], k)];
      target = [lerp(target[0], n.target[0], k), lerp(target[1], n.target[1], k), lerp(target[2], n.target[2], k)];
      fov = lerp(fov, n.fov, k);
    }
    cam.position.set(...pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(...target);
    cam.fov = fov;
    cam.near = this.s.near ?? 0.05;
    cam.far = this.s.far ?? 2000;
    cam.updateProjectionMatrix();
  }
}

export interface FishCamSpec {
  /** The world matrix of the car (the train kit's root: x forward, y up, z left) at time t. */
  pose: (t: number) => THREE.Matrix4;
  /** The sardine in the car frame at time t. */
  fish: (t: number) => Vec3;
  /** The side of the car that the sardine looks out of: 1 left (z +), -1 right. The camera stands on the aisle side. Default 1. */
  window?: 1 | -1;
  /** The eye and the look point, as offsets from the sardine in the car frame (z is for window 1 and is mirrored for -1). Defaults: behind it, a little above, on the aisle side; the look point a little ahead of the nose toward the window. */
  eye?: Vec3;
  look?: Vec3;
  /** Default 36. */
  fov?: number;
  /** The lag of the car's motion, s. Default 0.05. */
  lag?: number;
  kicks?: readonly number[];
  kickAmp?: number;
}

const FISH_EYE: Vec3 = [-0.8, 0.2, -0.6], FISH_LOOK: Vec3 = [0.3, 0, 0.15];

/**
 * The camera of the `[FISH CAM]` window (treatment "Framing"): a tight lens on the sardine in the car, looking out with it. It is bolted to the
 * car, so it rides the rail joints: the car's pose lags a little and bounces on each kick, the sardine stays in the same place of the frame.
 */
export class FishCam implements PlayerCamera<THREE.PerspectiveCamera> {
  constructor(private s: FishCamSpec) {}

  apply(cam: THREE.PerspectiveCamera, t: number) {
    const side = this.s.window ?? 1;
    const e = this.s.eye ?? FISH_EYE, lk = this.s.look ?? FISH_LOOK;
    const f = this.s.fish(t);
    const lag = this.s.lag ?? 0.05;
    const n = lag > 0 ? Math.ceil((4 * lag) / FR) : 1;
    // the lag is a lag of the car's turn and bounce only: the camera is bolted in the car, so the travel of the car must not leave it
    // behind (at 40 m/s a lag of 0.05 s would put it 2 m back, through the partition of the cab)
    const eye = new THREE.Vector3(), look = new THREE.Vector3(), origin = new THREE.Vector3();
    let w = 0;
    for (let k = 0; k < n; k++) {
      const wk = lag > 0 ? Math.exp(-(k * FR) / lag) : 1;
      const m = this.s.pose(t - k * FR);
      eye.addScaledVector(tmpA.set(f[0] + e[0], f[1] + e[1], f[2] + e[2] * side).applyMatrix4(m), wk);
      look.addScaledVector(tmpB.set(f[0] + lk[0], f[1] + lk[1], f[2] + lk[2] * side).applyMatrix4(m), wk);
      origin.addScaledVector(tmpA.setFromMatrixPosition(m), wk);
      w += wk;
    }
    const now = tmpB.setFromMatrixPosition(this.s.pose(t));
    origin.divideScalar(w).sub(now);
    eye.divideScalar(w).sub(origin);
    look.divideScalar(w).sub(origin);
    tmpUp.set(0, 1, 0).transformDirection(this.s.pose(t));
    if (this.s.kicks?.length) eye.addScaledVector(tmpUp, kickBounce(t, this.s.kicks, this.s.kickAmp));
    cam.position.copy(eye);
    cam.up.copy(tmpUp);
    cam.lookAt(look);
    cam.fov = this.s.fov ?? 36;
    cam.near = 0.03;
    cam.far = 400;
    cam.updateProjectionMatrix();
  }
}
