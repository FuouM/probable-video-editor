// The clock of the interlude and verse 2 (`interlude.ts`): the times of the room, the reread, the click, the ride, the fault and the
// failed loads. Shared by the scene and its parts (`_interludeRoom.ts`, `_interludeTrain.ts`, `_interludeVerse.ts`, `_interludeMap.ts`).
import { FR, SPB, bar } from './_time';
import { T_HIT } from './_wreck';

export const T_START = bar(49);
export const T_PUSH0 = bar(51);
/** The push into the glass: the eye travels for 0.36 s and the glass fills the frame; on that frame the picture is the game's own (no cross-fade: the glass is the frame). */
export const PUSH_MOVE = 0.36;
export const T_INSIDE = T_PUSH0 + PUSH_MOVE;
export const T_SNAP0 = 89.6;
export const T_SNAP1 = 90.55;
export const T_MODAL = bar(52);
export const T_CLICK = 92.0;
export const T_VERSE = bar(53);
/**
 * The second car is a bad copy of the first. The train has one car until the click on CONTINUE (T_CLICK). Then the copy loads
 * behind it, with no texture, on the first half of each beat, at another wrong place each beat. On beat 3 of bar 53 (T_COPY) it
 * stands in its place with its own paint and the coupler takes it.
 */
export const T_COPY = T_VERSE + 2 * SPB, COPY_THROW = 3;
/**
 * The save loads while the camera goes down to the train: the world turns from the map's look into the close look of the ride. The houses
 * grow from their map size to their close size one by one, in a wave that starts at the train and runs out at `LOAD_WAVE` m/s; each takes
 * `LOAD_GROW` s. The light, the sky and the haze go over with the move; the gantries and the lamps of verse 2 rise out of the ground.
 */
export const LOAD_WAVE = 1500, LOAD_GROW = 0.1;
export const T_LOADERR = 105.111;

/** The head: looks left (the box twice) and back, right (the sardine) and back. Each look takes about 0.4 s. */
export const T_LEFT = T_START + 0.222;
export const T_LEFT_BACK = T_START + 2 * SPB;
export const T_RIGHT = bar(50);
export const T_RIGHT_BACK = bar(50) + 2 * SPB;
/** The CRT holds the last frame of the bridge until this time (the game hangs on the cracked disc), then the reread map shows. */
export const T_HANG = T_START + 0.267;
/** The tries of LOAD STATE: the modal itself, then every kick (track 19). */
export const TRIES = [T_LOADERR, 105.222, 105.556, 105.778, 106.222, 106.667];
/** The drum fill of bar 60: on each hit of the woodblock the cars jump a step back along the corridor. */
export const FILL = [106.0, 106.111, 106.444];
/** A failed load: its first frames show the corridor gone and the camera this far under the floor (m). */
export const FLASH = 3, PEEK = 7;
/** The last LOAD ERROR carries line 22; the jellyfish comes down and takes it by its title bar. */
export const T_JELLY = 106.224;

/** The train leaves the track from here: too fast for the bend, it slides out to the line of the wreck. */
export const T_SLIDE = T_HIT - 0.7;
/**
 * The cars fall under the map from here (half a beat after the fault), into the corridor of Platform 8. They stop dead in its floor.
 * The ride camera stays the chase camera and follows them down.
 */
export const T_SINK = T_HIT + SPB / 2;
/** The fault lasts from the hit to here: the cars move in hitches and flicker into the missing texture. */
export const T_FAULT = T_SINK + 0.75;
/** The day counter stands until line 18, then jumps on each kick from `T_SKIP0`; from `T_SKIP1` it is `DAY ???`. */
export const T_SKIP0 = 96.667, T_SKIP1 = 100.889;

/** The index of the last failed load at t (-1 before the first). */
export function loadAt(t: number): number {
  let n = -1;
  for (const k of TRIES) if (t >= k - 1e-6) n++;
  return n;
}

/** True on the first `FLASH` frames of each failed load. */
export function loadFlash(t: number): boolean {
  const n = loadAt(t);
  return n >= 0 && t - TRIES[n]! < FLASH * FR - 1e-6;
}
