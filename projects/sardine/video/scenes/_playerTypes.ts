// The input model and the state types of the sardine player (treatment "The player", "Windows inside windows"), and the
// rectangle helpers of the window chrome: the title bar buttons, the toolbars and the content rectangle. `PlayerTrack`
// (`_playerTrack.ts`) compiles the inputs, `PlayerRig` (`_playerRig.ts`) draws the state.
import { LH, LW, type Col } from '@pve/engine/lit';
import type { TextLayer } from '@pve/engine/textlayer';

// ================================================================ basics

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
/** x, y, w, h in logical pixels (x right, y down). */
export type Rect = readonly [number, number, number, number];

export const inside = (r: Rect, x: number, y: number) => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];
/** Centre of a rectangle, for the cursor. */
export const centreOf = (r: Rect): Vec2 => [r[0] + Math.floor(r[2] / 2), r[1] + Math.floor(r[3] / 2)];

// ================================================================ the inputs

export type Tool = 'shovel' | 'rail' | 'bulldozer' | 'scissors' | 'bend' | 'poke' | 'punch' | 'delete' | 'zone' | 'disaster' | 'flower' | 'wind' | 'pickup' | 'loadstate';
/** The ten tools that v6 adds to the four of v5. Their buttons sit in the top bar after the menu buttons (`RigOptions.tools`). */
export const V6_TOOLS: readonly Tool[] = ['bend', 'poke', 'punch', 'delete', 'zone', 'disaster', 'flower', 'wind', 'pickup', 'loadstate'];
export type Speed = 'pause' | 'play' | 'fast';

/** What a window shows. */
export type WinBody =
  /** A live 3D view. The scene renders it into the window's `LitView` (`PlayerRig.compose`). `views`: how many cameras the view button cycles. `overlay`: drawn on the text layer over the picture (kana printed in a reminder window). */
  | { kind: 'view'; views?: number; overlay?: (l: TextLayer, content: Rect, t: number) => void }
  /** Anything drawn on the text layer, inside the content rectangle. */
  | { kind: 'draw'; draw: (l: TextLayer, content: Rect, t: number) => void }
  /** Lines of text and buttons: a modal, an ERR or a WARNING window. */
  | { kind: 'text'; lines: TextLine[]; buttons?: string[]; icon?: 'error' | 'warn' | 'info' };

export interface TextLine {
  text: string;
  /** The pixel scale of the font. Default 1. */
  n?: number;
  color?: Col;
}

/** A security-cam window (`WinSpec.cam`): a button for each feed in the title bar, a REC dot, a time stamp and corner brackets. The feeds are the views of the window and `cam` inputs cut between them with a hard cut. */
export interface CamSpec {
  /** The label of each feed, for example `['CAM 01', 'CAM 02']`. */
  labels: string[];
  /** The wall clock in seconds after midnight when the window opens. The time stamp counts on from it. Default 23:41:07. */
  clock?: number;
}

export interface WinSpec {
  id: string;
  /** Kana and Latin mix. For example `[キハ40 - CAR 1]`. */
  title: string;
  /** The outer rectangle when the window is not maximized. */
  rect: Rect;
  /** The status bar: dry game telemetry (`CAR 1  64 km/h`). A function of t for text that changes. */
  status?: string | ((t: number) => string);
  /** `warn` and `error` flash their border. */
  alert?: 'none' | 'warn' | 'error';
  /** Default: a live 3D view. */
  body?: WinBody;
  /** A modal dims everything under it and stays on top. */
  modal?: boolean;
  /** How much a modal darkens what is under it (0..1). Default 0.5. */
  dim?: number;
  /** A security-cam window: the body must be a view. `views` is then the count of the labels. */
  cam?: CamSpec;
}

export type PlayerInput =
  /** The cursor arrives at `to` two frames before `at`, after `dur` seconds of travel (default from the distance). */
  | { at: number; kind: 'move'; to: Vec2; dur?: number }
  /** A press of 2 frames from `at`. The cursor stays where it is. */
  | { at: number; kind: 'click'; button?: 'left' | 'right' }
  /** The cursor presses at `at`, moves to `to` in `dur` seconds and lets go. */
  | { at: number; kind: 'drag'; to: Vec2; dur: number }
  /** A right-drag of the map: the cursor moves by `by` px and the map follows it 1:1, then stops dead. */
  | { at: number; kind: 'pan'; by: Vec2; dur: number }
  /** An edge scroll: the map moves in screen direction `dir` (px, y down) for `dur` s. The speed ramps up. The scene puts the cursor at the edge. */
  | { at: number; kind: 'edge'; dir: Vec2; dur: number; speed?: number }
  /** A zoom notch (an index into the map's notches: 0 far, 1 default, 2 near). It takes 4 frames, or `dur` seconds as one smooth move. */
  | { at: number; kind: 'zoom'; notch: number; dur?: number }
  /**
   * The map goes to the ground point `to` (x, z) in `dur` seconds, as one smooth move (the game's locate button, or a click on its overview).
   * `straight`: for a look that runs with a zoom: `to` goes on a straight line on the screen to the middle, so the zoom goes into it and the
   * picture does not swing to the side.
   */
  | { at: number; kind: 'look'; to: Vec2; dur: number; straight?: boolean }
  /** A map rotation by 90 degrees. It is a hard change of view, as in RollerCoaster Tycoon. */
  | { at: number; kind: 'rotate'; steps: 1 | -1 }
  /** The map locks to the follow target (`MapOpts.follow`) with a short spring lag, or lets go and stops where it is. */
  | { at: number; kind: 'follow'; on: boolean }
  | { at: number; kind: 'tool'; tool: Tool | null }
  | { at: number; kind: 'speed'; mode: Speed }
  /** Opens a window. `origin`: where the 2-frame box grows from (default: the middle of the window). `maximized`: opens maximized. */
  | { at: number; kind: 'open'; win: WinSpec; origin?: Vec2; maximized?: boolean }
  /** Drags a window by its title bar: the cursor presses at its place at `at` and moves by `by`. */
  | { at: number; kind: 'dragWindow'; id: string; by: Vec2; dur: number; /** The window springs back to its place after the release: a drag that is refused. */ spring?: boolean }
  | { at: number; kind: 'maximize'; id: string }
  | { at: number; kind: 'restore'; id: string }
  | { at: number; kind: 'close'; id: string }
  /** The view button: switches the camera of the window with a hard cut. Without `view` it goes to the next one. */
  | { at: number; kind: 'view'; id: string; view?: number }
  /** Raises a window. */
  | { at: number; kind: 'focus'; id: string }
  /** The cam button of a security-cam window: a hard cut to feed `cam`. */
  | { at: number; kind: 'cam'; id: string; cam: number }
  /** A close attempt that fails: the [x] flashes red for 6 frames, the status bar reads CANNOT CLOSE for 1 s and the window jerks. The cursor clicks the button first (`clickAt`). */
  | { at: number; kind: 'denyClose'; id: string }
  /**
   * A drag of a tool handle (a rail end, a zone corner). The cursor presses at its place at `at`, where the handle is, and
   * moves to `to` in `dur` s. The handle follows the cursor 1:1. At the release it stays (`released`) or snaps to `snap`
   * over `snapDur` s (`snapped`). `PlayerState.handles` carries its state.
   */
  | { at: number; kind: 'handle'; id: string; to: Vec2; dur: number; via?: Vec2[]; snap?: Vec2; snapDur?: number }
  /** A tooltip box at the cursor tip. It follows the cursor on every frame. The text shows unit by unit (one code point each) on `times`; without `times` all at once. `text: null` removes it. */
  | { at: number; kind: 'tip'; text: string | null; times?: readonly number[]; /** The box stands above and left of the cursor instead of below and right (clear of a ghost that the cursor drags). */ away?: boolean }
  /**
   * The developer console of Quake and Source. The player presses `~` at `at`: a translucent panel drops from the top edge in 6 frames,
   * the player types `cmd` (about 11 keys a second, `consoleTimes` has the key times) and presses Enter: the command is entered and the
   * panel prints `reply` under it (when given). The panel rises 0.9 s later. The scene reads the entered command from
   * `PlayerState.commands` or `PlayerTrack.commandTime(cmd)` and lets the world react in the same frame.
   */
  | { at: number; kind: 'console'; cmd: string; reply?: string }
  /**
   * The pick-up hand carries an object (the sardine): the cursor presses at `at` where it is, the object lifts off in 0.14 s and hangs
   * from the hand, the hand carries it to `to` in `dur` s (along `via`) and lets go. `PlayerState.carry` has the swing of the hanging
   * object (a pendulum driven by the hand) and its wriggle. `scale`: screen px per metre for the swing, default 60.
   */
  | { at: number; kind: 'carry'; to: Vec2; dur: number; via?: Vec2[]; scale?: number };

/** The inputs of a click on `to`: the cursor arrives, then the press. */
export function clickAt(at: number, to: Vec2, o: { dur?: number; button?: 'left' | 'right' } = {}): PlayerInput[] {
  return [{ at, kind: 'move', to, ...(o.dur !== undefined ? { dur: o.dur } : {}) }, { at, kind: 'click', ...(o.button ? { button: o.button } : {}) }];
}

export type MapInput = Extract<PlayerInput, { kind: 'pan' | 'edge' | 'zoom' | 'rotate' | 'follow' | 'look' }>;

// ================================================================ the window rectangles

export const TITLE_H = 10;
export const STATUS_H = 10;
export const BORDER = 2;
export const FULL: Rect = [0, 0, LW, LH];

/** The content rectangle of a window: the area between its title bar and its status bar. */
export function contentRect(rect: Rect, maximized: boolean): Rect {
  return maximized
    ? [0, TITLE_H, LW, LH - TITLE_H - STATUS_H]
    : [rect[0] + BORDER, rect[1] + BORDER + TITLE_H, rect[2] - 2 * BORDER, rect[3] - 2 * BORDER - TITLE_H - STATUS_H];
}

/** The title bar buttons of a window: minimize, maximize and close. */
export function winButtons(rect: Rect, maximized: boolean): { min: Rect; max: Rect; close: Rect } {
  const x = maximized ? LW : rect[0] + rect[2] - BORDER;
  const y = maximized ? 1 : rect[1] + BORDER + 1;
  return { close: [x - 10, y, 9, 8], max: [x - 20, y, 9, 8], min: [x - 30, y, 9, 8] };
}

/** The view button of a window with several cameras: left of the title bar buttons. Its click is the hard cut of a view cycle. */
export function viewButton(rect: Rect, maximized: boolean): Rect {
  const m = winButtons(rect, maximized).min;
  // wider than the title bar buttons: the camera glyph needs the room to read
  return [m[0] - 15, m[1], 13, 8];
}

/** A point on the title bar to press for a window drag. */
export function titleGrab(rect: Rect): Vec2 { return [rect[0] + 24, rect[1] + BORDER + 4]; }

/** The width of a cam button in the title bar. */
const CAM_BTN_W = 35;

/** The cam buttons of a security-cam window, left of the title bar buttons. */
export function camButtons(rect: Rect, maximized: boolean, count: number): Rect[] {
  const m = winButtons(rect, maximized).min;
  return Array.from({ length: count }, (_, k): Rect => [m[0] - 1 - (count - k) * (CAM_BTN_W + 1), m[1], CAM_BTN_W, 8]);
}

/** The buttons of the toolbars, for the cursor to aim at. The top bar has 7 menu buttons and a close button. */
export const TOOLBAR = {
  menu: [4, LH - 20, 20, 18] as Rect,
  shovel: [26, LH - 20, 20, 18] as Rect,
  rail: [48, LH - 20, 20, 18] as Rect,
  bulldozer: [70, LH - 20, 20, 18] as Rect,
  scissors: [92, LH - 20, 20, 18] as Rect,
  pause: [122, LH - 20, 20, 18] as Rect,
  play: [144, LH - 20, 20, 18] as Rect,
  fast: [166, LH - 20, 20, 18] as Rect,
  ticker: [194, LH - 19, 246, 16] as Rect,
  counter: [446, LH - 19, 190, 16] as Rect,
  top: (k: number): Rect => [4 + k * 22, 2, 20, 18],
  /** The rotate button of the map (right of the ten tools, left of the close button). It shows with `RigOptions.rotate`. */
  rotate: [LW - 48, 2, 20, 18] as Rect,
  topClose: [LW - 24, 2, 20, 18] as Rect,
};

/** The button of any tool, for the cursor to aim at: the four of v5 in the bottom bar, the ten of v6 in the top bar. */
export function toolButton(tool: Tool): Rect {
  const k = V6_TOOLS.indexOf(tool);
  return k >= 0 ? [170 + k * 22, 2, 20, 18] : TOOLBAR[tool as 'shovel' | 'rail' | 'bulldozer' | 'scissors'];
}

// ================================================================ the state at time t

export interface CursorState { x: number; y: number; down: boolean; right: boolean }

/** The state of a security-cam window at time t. */
export interface CamState {
  /** The feed that shows. */
  index: number;
  label: string;
  labels: string[];
  /** The wall clock as `HH:MM:SS`. */
  stamp: string;
  /** True while the REC dot is lit (it blinks at 1 Hz). */
  rec: boolean;
}

export interface WinState {
  spec: WinSpec;
  id: string;
  title: string;
  status: string;
  /** The outer rectangle now (moved by drags, jerks and click jumps, full frame when maximized). */
  rect: Rect;
  /** The area for the window's picture. */
  content: Rect;
  maximized: boolean;
  /** Draw order, low to high. */
  z: number;
  /** 0..1: under 1 the window is only a box that grows. */
  grow: number;
  /** The growing box while `grow` < 1. */
  box: Rect;
  /** The index of the camera view (the view button, or the cam button). */
  view: number;
  alert: 'none' | 'warn' | 'error';
  /** True on the frames where an alert window shows its flash colour. */
  flash: boolean;
  /** Seconds since the window opened. */
  age: number;
  /** True for 6 frames after a refused close: the [x] is red. */
  closeFlash: boolean;
  /** True for 1 s after a refused close: the status bar reads CANNOT CLOSE. */
  denied: boolean;
  /** Only for a security-cam window. */
  cam?: CamState;
}

/** A click that is recent at time t. `age` is in seconds. `winId`: the topmost window under the cursor at the click, if any. The scene reacts in 3D with it (shake, dent, bounce). */
export interface ClickState { at: number; x: number; y: number; age: number; right: boolean; winId?: string }

/** A tool handle at time t. `pos`: its place in screen px. `u`: the progress of the drag (0..1, eased like the cursor). `since`: seconds since the phase began. */
export interface HandleState { id: string; pos: Vec2; from: Vec2; u: number; phase: 'held' | 'released' | 'snapped'; since: number }

/** A tooltip at time t: the part of the text that has shown, the full text (the box has its size), the anchor (the cursor at t), and `landAge`: seconds since the newest unit appeared (the unit lands inverted for 2 frames). */
export interface TipState { text: string; full: string; anchor: Vec2; age: number; landAge: number; away: boolean }

/** The developer console at time t. `drop`: how far it is open (0..1, in two steps). `lines`: what stands above the prompt (the banner, the commands entered before, their replies). `text`: what has been typed of the current command (all of it after Enter: the block cursor stays at its end). `reply`: the reply under the prompt, from Enter. `fired`: true from the Enter of the current command. */
export interface ConsoleState { drop: number; text: string; caret: boolean; lines: string[]; reply: string | null; fired: boolean }

/** A command that has been entered (Enter) by time t: the scene reads it to let the world react in the same frame. */
export interface CommandState { cmd: string; at: number; age: number }

/**
 * The pick-up hand with an object at time t. `phase`: `grab` (the object lifts, 0.14 s), `carry`, `drop` (from the release for 1.5 s: the scene lets the object fall).
 * `since`: seconds in the phase. `pos`: the cursor (the hand). `lift`: 0..1. `swing`: the angle of the hanging object off the vertical (rad, + toward screen right, soft limit 1.15),
 * `swingVel` its rate. `wriggle`: the phase of the tail beat (rad). `amp`: 0..1, how hard it wriggles.
 */
export interface CarryState { phase: 'grab' | 'carry' | 'drop'; since: number; pos: Vec2; from: Vec2; to: Vec2; lift: number; swing: number; swingVel: number; wriggle: number; amp: number }

/** The times of one console input: the `~` press, each key, Enter and the start of the rise. */
export interface ConsoleTimes { open: number; typed: number[]; enter: number; close: number }

export interface PlayerState {
  t: number;
  cursor: CursorState;
  /** The open windows, bottom to top. */
  windows: WinState[];
  /** The top maximized window (it covers the map and every window under it), or null. */
  maximized: WinState | null;
  tool: Tool | null;
  speed: Speed;
  /** The clicks of the last 0.5 s, oldest first. */
  clicks: ClickState[];
  /** The handles that have been grabbed, one for each id. */
  handles: HandleState[];
  tip: TipState | null;
  /** The developer console, or null while it is up. */
  console: ConsoleState | null;
  /** Every command entered by now, oldest first. */
  commands: CommandState[];
  /** The pick-up hand with its object, or null. */
  carry: CarryState | null;
}
