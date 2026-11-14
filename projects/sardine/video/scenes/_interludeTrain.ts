// The train of verse 2 (`interlude.ts`): the ride on the twisted route, the slide out at Station もと, the game fault (the update hitches,
// the cars snap into the platform and flicker into the missing texture), the fall into the corridor of Platform 8 and the failed loads.
// Every pose is a pure function of t.
import * as THREE from 'three';
import { setMissing } from '@pve/engine/gl';
import { hashSin, smooth } from '@pve/engine/util';
import { FR, SPB } from './_time';
import { T_HIT, V0, X_HIT } from './_wreck';
import { CAR_PITCH, STATIONS, routePoint, twist } from './_route';
import type { GameWorld } from './_gameWorld';
import { P8 } from './_platform8';
import { COPY_THROW, FILL, T_CLICK, T_COPY, T_FAULT, T_SINK, T_SLIDE, TRIES, loadAt } from './_interludeClock';

export const ROUTE = twist();
/** The middle of the front car on the route at the hit, and at time t. The game is paused until the click: the train stands. */
const D_HIT = ROUTE.stations.moto + X_HIT;
export const dAt = (t: number) => D_HIT + V0 * (Math.max(t, T_CLICK) - T_HIT);
/** The cars fall with this pull (m/s^2) and stop dead in the floor of the corridor, upright and sunk 0.5 m in (`REST_Y` is the rail top of the car). */
const FALL_G = 70, REST_Y = P8.floor - 0.5, REST_Z = 4.0;
/**
 * The chase arm in the corridor: its height scaled by `ARM_IN[0]`, its side offset by `ARM_IN[1]` (almost none: not 0, the frame must stay
 * invertible), and the frame `LANE` m to the side of the middle of the corridor, away from the cars (they lie on the +z side). The eye
 * looks down the open half of the corridor at the signs, over the cars' side.
 */
const ARM_IN = [0.7, 0.02] as const, LANE = -1.8;
/** The slide along the corridor: the speed at its start (m/s) and the time in which it dies (s). After a failed load the cars start here again. */
const SLIDE_V = 34, SLIDE_T = 1.0, X_START = 4;

/** The time the cars are drawn at: on the hit the update freezes for 4 frames, then it runs in steps of 3 frames, and about one step in four goes back one step. */
function hitchT(t: number): number {
  if (t < T_HIT || t >= T_FAULT) return t;
  const n = Math.floor((t - T_HIT) / FR + 1e-6);
  if (n < 4) return T_HIT;
  const step = Math.floor((n - 4) / 3);
  return T_HIT + 4 * FR + 3 * FR * (hashSin(step, 11) < 0.25 ? Math.max(0, step - 1) : step);
}

/** The car in the frame of Station もと at time t (no turn): it runs along the platform track, slows to a stop, and from the hit snaps half into the platform on some steps. */
function glitchCar(t: number): THREE.Vector3 {
  const tau = t - T_HIT;
  if (tau < 0) return new THREE.Vector3(X_HIT + V0 * tau, 0, 0);
  const step = Math.floor(tau / (3 * FR));
  return new THREE.Vector3(X_HIT + V0 * 0.45 * (1 - Math.exp(-tau / 0.45)), 0, hashSin(step, 12) < 0.4 ? 1.6 : 0);
}

const lerpMatrix = (() => {
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), sa = new THREE.Vector3(), sb = new THREE.Vector3();
  /** `a` moved toward `b` by w (the place and the scale are straight blends, the turn the shortest one). */
  return (a: THREE.Matrix4, b: THREE.Matrix4, w: number): THREE.Matrix4 => {
    if (w <= 0) return a;
    a.decompose(pa, qa, sa);
    b.decompose(pb, qb, sb);
    return a.compose(pa.lerp(pb, w), qa.slerp(qb, w), sa.lerp(sb, w));
  };
})();

export class InterludeTrain {
  /** The frame of Station もと. */
  readonly station = new THREE.Matrix4();

  constructor() {
    const sp = routePoint(STATIONS.moto.s);
    this.station.makeRotationY(sp.yaw).setPosition(sp.x, 0, sp.z);
  }

  /**
   * The middle of car `k` in the frame of the station from `T_SINK`: it falls through the ground into the corridor and stops in its floor,
   * then slides. After a failed load it is at the start of the corridor again and slides a little, and each hit of the fill takes it a
   * step back.
   */
  under(t: number, k: number): THREE.Vector3 {
    const f = glitchCar(t);
    const ts = t - T_SINK - 0.12 * k;
    const land = Math.sqrt((2 * (f.y - REST_Y)) / FALL_G);
    let x: number, y: number;
    const n = loadAt(t);
    if (n < 0) {
      x = f.x + SLIDE_V * SLIDE_T * (1 - Math.exp(-Math.max(0, ts - 0.3) / SLIDE_T));
      // it stops dead in the floor, a little sunk in (a collision that the game got wrong)
      y = ts < land ? f.y - 0.5 * FALL_G * Math.max(0, ts) ** 2 : REST_Y;
    } else {
      const since = t - TRIES[n]!;
      x = X_START + 11 * (1 - Math.exp(-since / 0.5)) - 5 * FILL.filter((h) => h >= TRIES[n]! && h <= t + 1e-6).length;
      y = REST_Y;
    }
    return f.set(x - k * 0.55 * CAR_PITCH, y, f.z + (REST_Z - f.z) * smooth(ts / 1.4));
  }

  /**
   * The world matrix of car `k` (0 front, 1 rear) at time t. On the route until the slide. Then a game fault, not a crash: in the frame of
   * Station もと the car runs on along the platform as the update hitches (`hitchT`): it freezes on the hit, then moves in steps that
   * sometimes go back, and snaps half into the platform and out again. It never tips. The rear car runs into the front one and stands
   * inside it. From `T_SINK` both fall through the ground into the corridor and stop dead, upright and sunk into its floor (`under`).
   */
  carMatrix(t: number, k: number): THREE.Matrix4 {
    const m = ROUTE.car(dAt(t) - k * CAR_PITCH);
    if (t < T_SLIDE) return m;
    const tg = hitchT(t);
    const p = glitchCar(tg - k * (CAR_PITCH / V0));
    if (k === 1) p.x = Math.min(p.x, glitchCar(tg).x - 0.55 * CAR_PITCH);
    const ts = tg - T_SINK - 0.12 * k;
    if (ts > 0) p.lerp(this.under(tg, k), k === 0 ? 1 : smooth(ts / 0.4));
    return lerpMatrix(m, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).premultiply(this.station), smooth((t - T_SLIDE) / 0.6));
  }

  /**
   * The frame that the arm of the ride camera stands on: one chase camera from the ride to the end of the clip. On the ride it is the front
   * car. From the slide it is the place of the front car, upright and turned only about y (the camera must not roll with a car that tips
   * over); it goes down with the car through the ground into the corridor. In the corridor the frame stands on the floor in the middle of
   * the corridor, and the arm is scaled down (height and side, `ARM_IN`) so the eye stays under the ceiling and inside the walls.
   */
  camMatrix(t: number): THREE.Matrix4 {
    const m = this.carMatrix(t, 0);
    if (t < T_SLIDE) return m;
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    const fwd = new THREE.Vector3().setFromMatrixColumn(m, 0);
    const w = smooth((t - T_SINK) / 0.6);
    // in the station's frame: from the car's place to the floor under it, in the middle of the corridor
    const inv = this.station.clone().invert();
    const local = pos.clone().applyMatrix4(inv);
    local.y += (P8.floor - local.y) * w;
    local.z += (P8.z + LANE - local.z) * w;
    pos.copy(local).applyMatrix4(this.station);
    const s = new THREE.Vector3(1, 1 + (ARM_IN[0] - 1) * w, 1 + (ARM_IN[1] - 1) * w);
    const up = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-fwd.z, fwd.x)), s);
    return lerpMatrix(m, up, smooth((t - T_SLIDE) / 0.3));
  }

  /** Poses the cars of `world` at t: the fault flickers both into the missing texture; the rear car is a bad copy until `T_COPY`. */
  place(world: GameWorld, t: number) {
    world.cars.forEach((car, k) => {
      car.root.matrixAutoUpdate = false;
      car.root.matrix.copy(this.carMatrix(t, k));
      car.root.matrixWorldNeedsUpdate = true;
    });
    // the fault: both cars flicker into the missing texture, each on its own clock of 3-frame steps
    const fault = (k: number) => t >= T_HIT && t < T_FAULT && hashSin(Math.floor((t - T_HIT) / (3 * FR)), 20 + k) < 0.5;
    setMissing(world.cars[0].root, fault(0), 0.7);
    const rear = world.cars[1].root, bad = t < T_COPY;
    rear.visible = t >= T_CLICK && (!bad || (t - T_CLICK) % SPB < SPB / 2);
    setMissing(rear, bad || fault(1), 0.7);
    if (!bad || !rear.visible) return;
    // each beat the copy is read at another wrong place; the throw dies as it loads
    const n = Math.floor((t - T_CLICK) / SPB), w = COPY_THROW * (1 - smooth((t - T_CLICK) / (T_COPY - T_CLICK)));
    rear.matrix.premultiply(new THREE.Matrix4().makeTranslation(w * (hashSin(n, 1) - 0.5), 0, w * (hashSin(n, 2) - 0.5)));
  }

  /** True while the train hangs under the crossing. */
  underside(t: number): boolean { return t < T_SLIDE && ROUTE.at(dAt(t)).up.y < 0; }
}
