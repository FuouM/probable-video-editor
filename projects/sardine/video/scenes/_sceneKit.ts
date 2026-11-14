// The parts that the game scenes (bridge, interlude, chorus 2, chorus 3) share: the ride window, windows that the game opens and the
// player clicks shut, the train dot of a minimap, the aim of the ride camera, the warm-up of key frames, and the sky of the map.
import type * as THREE from 'three';
import type { LitView, Output, Sky } from '@pve/engine/litview';
import type { TextLayer } from '@pve/engine/textlayer';
import { FR } from './_time';
import { clickAt, type PlayerInput, type Rect, type Vec2, type WinSpec } from './_playerTypes';
import type { RideCam } from './_playerCams';

/** The sky of the green map of the game world (the map and the minimaps of verse 2 and chorus 2). */
export const MAP_SKY: Sky = { zenith: '#547844', horizon: '#6e9258', ground: '#4a6a3a' };

/** The rectangle of the ride window when it is not maximized. */
export const RIDE_RECT: Rect = [60, 40, 520, 280];

/** `[Train 1 - Ride Cam]`: a live view with the status `status`, and `overlay` (or null) drawn over its picture. */
export function rideWindow(rect: Rect, status: (t: number) => string, overlay: ((l: TextLayer, c: Rect, t: number) => void) | null): WinSpec {
  return { id: 'ride', title: '[Train 1 - Ride Cam]', rect, status, body: overlay ? { kind: 'view', overlay } : { kind: 'view' } };
}

/** The cursor clicks `to` at `at`, and the window `id` closes 2 frames later. */
export function clickClose(at: number, to: Vec2, id: string): PlayerInput[] {
  return [...clickAt(at, to), { at: at + 2 * FR, kind: 'close', id }];
}

/** The game opens `win` at `from` (growing out of `origin`); the player shuts it at `to` with a click on `close` (null: it stays open). */
export function popup(win: WinSpec, from: number, to: number | null, close: Vec2, origin: Vec2): PlayerInput[] {
  const open: PlayerInput = { at: from, kind: 'open', win, origin };
  return to === null ? [open] : [open, ...clickClose(to, close, win.id)];
}

/** The train on a minimap: a 5 px dot of the colour `c` with a black edge, centred on the pixel `p`. */
export function trainDot(l: TextLayer, p: Vec2, c: string) {
  l.rect(p[0] - 3, p[1] - 3, 7, 7, '#000000');
  l.rect(p[0] - 2, p[1] - 2, 5, 5, c);
}

/** Aims `cam` as the ride window with the picture aspect `aspect` shows the world at t. */
export function aimRide(ride: RideCam, cam: THREE.PerspectiveCamera, t: number, aspect: number): THREE.PerspectiveCamera {
  cam.aspect = aspect;
  ride.apply(cam, t);
  cam.updateMatrixWorld(true);
  return cam;
}

/** Draws the game picture of each time in `times` once (programs, shadow maps and uploads), so no frame of the clip hitches. */
export function warmFrames(r: THREE.WebGLRenderer, view: LitView, text: TextLayer, times: readonly number[], draw: (t: number) => Output) {
  for (const t of times) view.toScreen(r, draw(t), text);
}
