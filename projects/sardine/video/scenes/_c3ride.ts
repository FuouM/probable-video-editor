// The train and the one camera of chorus 3 and the outro (`chorus3.ts`). The train runs the lap of chorus 2 and then the new straight,
// and jumps each gap that a tuna made in the track. The camera never cuts: it leaves the side arm of chorus 2 and orbits the train
// (`ORBIT`); in the last bar it turns forward along the train to the wall, then goes on along the roof to the nose. A pose is a pure
// function of t.
import * as THREE from 'three';
import { LH, LW, camera, v3 } from '@pve/engine/lit';
import { smooth } from '@pve/engine/util';
import { SPB, bar } from './_time';
import { CAR_PITCH } from './_route';
import { LAP, SIDE_ARM, lapAt, upright } from './_c2shared';
import { RideCam } from './_playerCams';
import { T_HIT } from './_outro';
import { GW_TO_STAGE, L_EXIT, SPEED, T0, T_EXIT, X_EXIT, carOnRoute, xAt } from './_c3stage';

// One camera that never cuts. It orbits the train in the frame of the front car (x forward, y up, z to its right) about the middle
// of the two cars, and looks through that middle at what is behind it. At the first frame it is on the side arm of chorus 2. It goes
// round the left side and across the nose to the front right: from there it looks back over the train at the world that unloads
// behind it, with the eclipse above. Then it closes in. In the last bar it swings round to behind the train.
/** The keys of the orbit: time, angle (degrees: 0 ahead of the nose, 90 on the right, -90 on the left, 180 behind), distance and
 * height of the eye (m), height of the look (m), field of view (degrees). */
const ORBIT: readonly (readonly [number, number, number, number, number, number])[] = [
  [T0, -118, 17, 3.5, 2, 58],
  [141.6, -24, 26, 8, 2, 58],
  [144.6, 28, 32, 13, 1, 56],
  [152.5, 14, 14, 6.5, 2, 52],
  [bar(92), 180, 30, 10, 8, 58],
];
/** The camera leaves the side arm of chorus 2 over this time (s). */
const ARM_OUT = 3.2;
/** The view turns forward along the train to the wall: from a beat before the last bar of the chorus, over four beats. Then the eye goes forward along the roof to the nose. */
export const T_ANGLE = bar(92) - SPB;
const ANGLE = 4 * SPB, T_NOSE = bar(94) + SPB;

/** The time at which the middle of the front car is at x on the straight. */
const timeAt = (x: number) => T_EXIT + (X_EXIT - x) / SPEED;

export class C3Ride {
  /** The gaps that the tuna make in the track: the x of each (the game schedule fills it). */
  readonly gaps: number[] = [];
  private readonly aimCam = camera(52, 0.2, 6000);
  /** The side arm of chorus 2, on the same train. */
  private readonly ride = new RideCam({
    pose: (t: number) => this.carFrame(t),
    mode: 'side',
    offsets: { side: { eye: [...SIDE_ARM.eye], look: [...SIDE_ARM.look], fov: SIDE_ARM.fov, lag: SIDE_ARM.lag } },
  });

  /** The height of car `k` over the rail at t: it jumps each gap that a tuna made in the track, and comes down hard. */
  private hop(t: number, k: number): number {
    let y = 0;
    for (const gx of this.gaps) {
      const u = (t - (timeAt(gx + 10) + (k * CAR_PITCH) / SPEED)) / 0.5;
      if (u > 0 && u < 1) y += 1.3 * Math.sin(Math.PI * u);
      else if (u >= 1 && u < 2.2) y -= 0.22 * Math.exp(-5 * (u - 1)) * Math.abs(Math.sin(14 * (u - 1)));
    }
    return y;
  }

  /** The matrix of car `k` (0 front, 1 rear) at t, in the frame of the game world: on the lap of chorus 2, then on the new straight. */
  carMatrix(t: number, k: number): THREE.Matrix4 {
    const m = carOnRoute(lapAt(t) - k * CAR_PITCH);
    const y = this.hop(t, k);
    if (y === 0) return m;
    const tilt = (this.hop(t + 0.04, k) - this.hop(t - 0.04, k)) * 0.5;
    m.elements[13]! += y;
    return m.multiply(new THREE.Matrix4().makeRotationZ(tilt));
  }

  /** The frame of the front car in the stage frame at t, upright: x forward, y up, z to its right. */
  carFrame(t: number): THREE.Matrix4 {
    return GW_TO_STAGE.clone().multiply(upright(carOnRoute(lapAt(t))));
  }

  /** A point of the route in the stage frame: `ahead` metres ahead of the front car at t, `left` metres to its left. */
  routeAt(t: number, ahead: number, left: number): THREE.Vector3 {
    const l = lapAt(t) + ahead;
    if (l > L_EXIT) return v3(X_EXIT - (l - L_EXIT), 0, left);
    const f = LAP.at(l);
    return v3(f.pos.x, 0, f.pos.z).addScaledVector(v3(f.tangent.z, 0, -f.tangent.x).normalize(), left).applyMatrix4(GW_TO_STAGE);
  }

  /** A camera aimed as the ride window (maximized) shows the world at t. */
  camAt(t: number): THREE.PerspectiveCamera {
    const cam = camera(52, 0.2, 6000);
    this.aim(cam, t, LW / (LH - 24));
    return cam;
  }

  /** Puts `cam` at `eye` with its look at `look`, by the share `k` of the way from where it is. */
  private lean(cam: THREE.PerspectiveCamera, eye: THREE.Vector3, look: THREE.Vector3, fov: number, k: number) {
    if (k <= 0) return;
    const a = this.aimCam;
    a.position.copy(eye);
    a.up.set(0, 1, 0);
    a.lookAt(look);
    cam.position.lerp(eye, k);
    cam.quaternion.slerp(a.quaternion, k);
    cam.fov += (fov - cam.fov) * k;
  }

  /** The eye, the look (the frame of the front car) and the field of view of the orbit at t: a monotone cubic curve through the keys (`ORBIT`), so the speed has no step at a key and no channel overshoots a key. */
  private orbit(t: number): { eye: THREE.Vector3; look: THREE.Vector3; fov: number } {
    const n = ORBIT.length;
    let i = 0;
    while (i < n - 2 && t >= ORBIT[i + 1]![0]) i++;
    const a = ORBIT[i]!, b = ORBIT[i + 1]!, h = b[0] - a[0];
    const u = Math.min(1, Math.max(0, (t - a[0]) / h)), u2 = u * u, u3 = u2 * u;
    // the slope of channel c over the step from key j to key j + 1, and the slope at key j: zero at the first and the last key and where
    // the channel turns, else the harmonic mean of the steps on each side (it never overshoots a key)
    const step = (j: number, c: number) => (ORBIT[j + 1]![c]! - ORBIT[j]![c]!) / (ORBIT[j + 1]![0] - ORBIT[j]![0]);
    const slope = (j: number, c: number) => {
      if (j === 0 || j === n - 1) return 0;
      const d0 = step(j - 1, c), d1 = step(j, c);
      return d0 * d1 <= 0 ? 0 : 2 / (1 / d0 + 1 / d1);
    };
    const mix = (c: number) => (2 * u3 - 3 * u2 + 1) * a[c]! + (u3 - 2 * u2 + u) * h * slope(i, c) + (-2 * u3 + 3 * u2) * b[c]! + (u3 - u2) * h * slope(i + 1, c);
    const th = mix(1) * (Math.PI / 180), r = mix(2);
    const dir = v3(Math.cos(th), 0, Math.sin(th)), mid = v3(-CAR_PITCH / 2, 0, 0);
    // from ahead of the train the look runs back along the track, at the edge of the world that unloads; from the side and from
    // behind it goes through the middle of the train
    const w = smooth(Math.cos(th));
    const look = mid.clone().addScaledVector(dir, -30 * (1 - w)).add(v3(-50 * w, 0, 0)).setY(mix(4));
    return { eye: mid.clone().addScaledVector(dir, r).setY(mix(3)), look, fov: mix(5) };
  }

  /** Aims `cam` as the ride window shows the world at t (the stage frame). */
  aim(cam: THREE.PerspectiveCamera, t: number, aspect: number) {
    // the side arm of chorus 2, then the orbit
    this.ride.apply(cam, t);
    const F = this.carFrame(t), o = this.orbit(t);
    this.lean(cam, o.eye.applyMatrix4(F), o.look.applyMatrix4(F), o.fov, smooth((t - T0) / ARM_OUT));
    const x = xAt(t);
    // the last bar: forward along the train, to the wall. Then on along the roof to the nose
    this.lean(cam, v3(x + 30, 10, -2.5), v3(x - 80, 24, 0), 58, smooth((t - T_ANGLE) / ANGLE));
    this.lean(cam, v3(x - 1, 5.6, -1.5), v3(x - 60, 5, 0), 58, smooth((t - T_NOSE) / (T_HIT - T_NOSE)));
    // the hit: the canvas takes it; the camera moves by 2 px at most
    const hit = t - T_HIT;
    if (hit >= 0 && hit < 0.12) cam.position.y += 0.03 * Math.sin(80 * hit) * (1 - hit / 0.12);
    cam.aspect = aspect;
    cam.near = 0.3;
    cam.far = 6000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }
}
