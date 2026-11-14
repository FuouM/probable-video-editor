// The input track of the sardine player (`PlayerTrack`): a list of timed player inputs, compiled once. It resolves the
// cursor (a curved path that eases out, a small overshoot, a 2-frame press, an idle twitch), the windows (open with a
// 2-frame box grow, drag, maximize, close, view cycle), the selected tool, the game speed, the tooltip, the console and
// the carry. Every query is a pure function of t.
import { clamp01, lerp, smooth } from '@pve/engine/util';
import { LH, LW } from '@pve/engine/lit';
import { FPS, FR } from './_time';
import { dragEase, easeOut3 } from './_ease';
import {
  FULL, contentRect, centreOf, hashInt, inside,
  type CarryState, type ClickState, type CommandState, type ConsoleState, type ConsoleTimes, type CursorState,
  type HandleState, type MapInput, type PlayerInput, type PlayerState, type Rect, type Speed, type TipState, type Tool, type Vec2,
  type WinSpec, type WinState,
} from './_playerTypes';

/** The cursor's default travel time for a distance in px. */
const travel = (dist: number) => Math.max(0.16, Math.min(0.5, 0.16 + dist / 1100));
/**
 * The shortest time in which a hand moves the cursor `dist` px (of the 640 px frame): a fast flick, about 1600 px/s after a start of
 * 0.05 s. A move that is given less time starts earlier (it still arrives on its beat); a drag, a pan or a carry that is faster is
 * not a hand, and the track refuses it.
 */
const minTravel = (dist: number) => (dist < 3 ? 0 : 0.05 + dist / 1600);
/** A move arrives this long before its beat. */
const LEAD = 2 * FR;
/** The open box of a window grows in 2 frames. */
const GROW_FRAMES = 2;
const IDLE_FROM = 0.4;

interface CurSeg { t0: number; t1: number; from: Vec2; to: Vec2; drag: boolean; bend: number; via?: Vec2[] }
interface Press { t0: number; t1: number; right: boolean }
/** A click: when and where. `win` is the window it hit (null: none), found on first use. */
interface ClickRec { at: number; pos: Vec2; right: boolean; win?: string | null }
interface HandleRec { id: string; t0: number; dur: number; from: Vec2; to: Vec2; via: Vec2[] | null; snap: Vec2 | null; snapDur: number }
interface TipRec { at: number; text: string | null; times: readonly number[] | undefined; away: boolean }
type WinEvent =
  | { at: number; kind: 'maximize' | 'restore' | 'close' | 'focus' | 'deny' }
  | { at: number; kind: 'view'; view?: number }
  | { at: number; kind: 'drag'; by: Vec2; dur: number; spring: boolean };
interface WinLife { spec: WinSpec; at: number; origin: Vec2; max0: boolean; events: WinEvent[]; order: number }
interface ConsoleRec { cmd: string; reply: string | undefined; times: ConsoleTimes }
interface CarryRec { t0: number; t1: number; from: Vec2; to: Vec2; swing: Float32Array; vel: Float32Array }
/** The input of one kind. */
type In<K extends PlayerInput['kind']> = Extract<PlayerInput, { kind: K }>;

/** The console snaps open in two steps of one frame, as a terminal does, and shut in two. */
const CONSOLE_SLIDE = 2 * FR;

/** The key times of a console input at `at`: the first key 0.4 s after `~`, then about 11 keys a second with a little jitter, Enter 0.25 s after the last key, the rise 0.9 s after Enter. */
export function consoleTimes(at: number, cmd: string): ConsoleTimes {
  const typed: number[] = [];
  let t = at + 0.4;
  for (let k = 0; k < [...cmd].length; k++) { typed.push(t); t += 0.07 + 0.04 * hashInt(k, 91); }
  const enter = typed.length ? typed[typed.length - 1]! + 0.25 : at + 0.5;
  return { open: at, typed, enter, close: enter + 0.9 };
}

/** The lines at the top of every console. */
const CONSOLE_BANNER = ['PVE 0.9  BUILD 2411  x64', 'MAP LINE_01  OBJ 1042', ''];

/** The pendulum of a hanging object: its length (m), the damping (1/s), the time step of the integration, the tail time after the release, the grab time, the tail-beat rate (rad/s). */
const CARRY_L = 0.35, CARRY_DAMP = 1.6, CARRY_STEP = 1 / 288, CARRY_TAIL = 1.5, CARRY_GRAB = 0.14, CARRY_WRIGGLE = 44;

/** The upward jump of a clicked window in px, by frame. */
const CLICK_JUMP = [1, 2, 1, 0] as const;
/** A refused close: the [x] is red this long, the status bar reads CANNOT CLOSE this long, the window jerks this many frames. */
const DENY_FLASH = 6 * FR;
const DENY_STATUS = 1;
const DENY_JERK_FRAMES = 8;
const DEFAULT_CLOCK = 23 * 3600 + 41 * 60 + 7;

/** A damped spring from 1 to 0 with an overshoot of 20 % (a refused window drag coming back). It is 0 after 0.9 s. */
function springBack(tau: number): number {
  if (tau >= 0.9) return 0;
  const w = 26, z = 0.45, wd = w * Math.sqrt(1 - z * z);
  return Math.exp(-z * w * tau) * (Math.cos(wd * tau) + ((z * w) / wd) * Math.sin(wd * tau));
}

const clockText = (s: number) => {
  const n = Math.floor(s) % 86400, p = (v: number) => String(v).padStart(2, '0');
  return `${p(Math.floor(n / 3600))}:${p(Math.floor(n / 60) % 60)}:${p(n % 60)}`;
};

// ================================================================ the compile

/**
 * Turns the sorted inputs into the records that `PlayerTrack` reads: one handler for each input kind. The handlers run
 * in input order and keep the hand's place (`pos`) and the time it is free (`free`), so a move that is too fast for a
 * hand starts earlier and a drag that is too fast is refused.
 */
class TrackCompiler {
  readonly segs: CurSeg[] = [];
  readonly presses: Press[] = [];
  readonly clicks: ClickRec[] = [];
  readonly handles: HandleRec[] = [];
  readonly tips: TipRec[] = [];
  readonly lives = new Map<string, WinLife>();
  readonly tools: { at: number; tool: Tool | null }[] = [];
  readonly speeds: { at: number; mode: Speed }[] = [];
  readonly consoles: ConsoleRec[] = [];
  readonly carries: CarryRec[] = [];
  private pos: Vec2;
  private free = -Infinity;
  private order = 0;

  constructor(start: Vec2, tool: Tool | null, speed: Speed) {
    this.pos = start;
    this.tools.push({ at: -Infinity, tool });
    this.speeds.push({ at: -Infinity, mode: speed });
  }

  input(i: PlayerInput) {
    switch (i.kind) {
      case 'move': this.move(i); break;
      case 'click': this.click(i); break;
      case 'drag': this.drag(i); break;
      case 'handle': this.handle(i); break;
      case 'pan': this.pan(i); break;
      case 'dragWindow': this.dragWindow(i); break;
      case 'tool': this.tools.push({ at: i.at, tool: i.tool }); break;
      case 'speed': this.speeds.push({ at: i.at, mode: i.mode }); break;
      case 'tip': this.tip(i); break;
      case 'console': this.console(i); break;
      case 'carry': this.carry(i); break;
      case 'open': this.open(i); break;
      case 'maximize': case 'restore': case 'close': case 'focus':
        this.win(i.id, i.at, i.kind).events.push({ at: i.at, kind: i.kind });
        break;
      case 'denyClose': this.win(i.id, i.at, 'denyClose').events.push({ at: i.at, kind: 'deny' }); break;
      case 'view': this.view(i); break;
      case 'cam': this.cam(i); break;
      default: break; // map inputs: MapCam reads them
    }
  }

  /** A segment of the cursor path from where the hand is to `to`. `drag`: a press-and-move, which must not be faster than a hand. */
  private seg(t0: number, t1: number, to: Vec2, drag: boolean, what: string) {
    const pos = this.pos, free = this.free;
    const d = Math.hypot(to[0] - pos[0], to[1] - pos[1]), need = minTravel(d);
    if (drag && t1 - t0 < need - 1e-6) {
      throw new Error(`player: ${what} at ${t0.toFixed(3)} s moves ${Math.round(d)} px in ${(t1 - t0).toFixed(3)} s; a hand needs ${need.toFixed(3)} s (from ${pos.map(Math.round).join(',')} to ${to.map(Math.round).join(',')})`);
    }
    // a move that is too fast for a hand leaves earlier
    if (!drag) t0 = Math.min(t0, t1 - need);
    if (t0 < free - 1e-6) {
      // the hand is still on its way: start where the last move ended
      t0 = free;
      if (t1 - t0 < Math.max(3 * FR, need) - 1e-6) {
        throw new Error(`player: ${what} at ${(t1 + LEAD).toFixed(3)} s leaves no time to move ${Math.round(d)} px from the last input (free at ${free.toFixed(3)} s, a hand needs ${need.toFixed(3)} s)`);
      }
    }
    const bend = (hashInt(this.segs.length, 3) < 0.5 ? -1 : 1) * (0.07 + 0.1 * hashInt(this.segs.length, 5));
    this.segs.push({ t0, t1, from: pos, to, drag, bend });
    this.pos = to;
    this.free = t1;
  }

  /** The press-and-move segment of a drag that goes along `via`, and its press. Returns the segment. */
  private held(at: number, dur: number, to: Vec2, via: Vec2[] | undefined, what: string): CurSeg {
    this.seg(at, at + dur, to, true, what);
    const s = this.segs[this.segs.length - 1]!;
    if (via) s.via = via;
    this.presses.push({ t0: s.t0, t1: s.t1, right: false });
    return s;
  }

  /** The window `id`, which must be open at `at`. */
  private win(id: string, at: number, what: string): WinLife {
    const w = this.lives.get(id);
    if (!w) throw new Error(`player: ${what} of window "${id}" at ${at.toFixed(3)} s, but it has not been opened`);
    if (at < w.at) throw new Error(`player: ${what} of window "${id}" at ${at.toFixed(3)} s is before it opens (${w.at.toFixed(3)} s)`);
    return w;
  }

  private move(i: In<'move'>) {
    const d = Math.hypot(i.to[0] - this.pos[0], i.to[1] - this.pos[1]);
    const t1 = i.at - LEAD;
    this.seg(t1 - (i.dur ?? travel(d)), t1, i.to, false, 'move');
  }

  private click(i: In<'click'>) {
    this.presses.push({ t0: i.at, t1: i.at + GROW_FRAMES * FR, right: i.button === 'right' });
    this.clicks.push({ at: i.at, pos: [Math.round(this.pos[0]), Math.round(this.pos[1])], right: i.button === 'right' });
  }

  private drag(i: In<'drag'>) {
    this.seg(i.at, i.at + i.dur, i.to, true, 'drag');
    this.presses.push({ t0: i.at, t1: i.at + i.dur, right: false });
  }

  private handle(i: In<'handle'>) {
    const from = this.pos;
    const s = this.held(i.at, i.dur, i.to, i.via, 'handle drag');
    this.handles.push({ id: i.id, t0: s.t0, dur: s.t1 - s.t0, from, to: i.to, via: i.via ?? null, snap: i.snap ?? null, snapDur: i.snapDur ?? 2 * FR });
  }

  private pan(i: In<'pan'>) {
    this.seg(i.at, i.at + i.dur, [this.pos[0] + i.by[0], this.pos[1] + i.by[1]], true, 'pan');
    this.presses.push({ t0: i.at, t1: i.at + i.dur, right: true });
  }

  private dragWindow(i: In<'dragWindow'>) {
    const w = this.win(i.id, i.at, 'drag');
    w.events.push({ at: i.at, kind: 'drag', by: i.by, dur: i.dur, spring: i.spring ?? false });
    this.seg(i.at, i.at + i.dur, [this.pos[0] + i.by[0], this.pos[1] + i.by[1]], true, 'window drag');
    this.presses.push({ t0: i.at, t1: i.at + i.dur, right: false });
  }

  private tip(i: In<'tip'>) {
    if (i.text !== null && i.times && i.times.length !== [...i.text].length) throw new Error(`player: tip at ${i.at.toFixed(3)} s has ${[...i.text].length} units and ${i.times.length} times`);
    this.tips.push({ at: i.at, text: i.text, times: i.times, away: i.away === true });
  }

  private console(i: In<'console'>) {
    const times = consoleTimes(i.at, i.cmd);
    const prev = this.consoles[this.consoles.length - 1];
    if (prev && i.at < prev.times.close + CONSOLE_SLIDE) throw new Error(`player: console at ${i.at.toFixed(3)} s opens before the console before it has risen (${(prev.times.close + CONSOLE_SLIDE).toFixed(3)} s)`);
    this.consoles.push({ cmd: i.cmd, reply: i.reply, times });
  }

  private carry(i: In<'carry'>) {
    const from = this.pos;
    const s = this.held(i.at, i.dur, i.to, i.via, 'carry');
    this.carries.push(carryRec(s, from, i.scale ?? 60));
  }

  private open(i: In<'open'>) {
    if (this.lives.has(i.win.id)) throw new Error(`player: window "${i.win.id}" is opened twice`);
    this.lives.set(i.win.id, { spec: i.win, at: i.at, origin: i.origin ?? centreOf(i.win.rect), max0: i.maximized ?? false, events: [], order: this.order++ });
  }

  private view(i: In<'view'>) {
    this.win(i.id, i.at, 'view').events.push({ at: i.at, kind: 'view', ...(i.view !== undefined ? { view: i.view } : {}) });
  }

  private cam(i: In<'cam'>) {
    const w = this.win(i.id, i.at, 'cam');
    const labels = w.spec.cam?.labels;
    if (!labels) throw new Error(`player: cam input at ${i.at.toFixed(3)} s, but window "${i.id}" has no cam`);
    if (i.cam < 0 || i.cam >= labels.length) throw new Error(`player: cam ${i.cam} at ${i.at.toFixed(3)} s, window "${i.id}" has ${labels.length} feeds`);
    w.events.push({ at: i.at, kind: 'view', view: i.cam });
  }
}

// ================================================================ the windows at time t

/** What the events of a window up to t have done: maximized or not, the last touch (the draw order), the view, the drag offset, the time since the last refused close. */
interface WinReplay { maximized: boolean; touch: number; view: number; dx: number; dy: number; deny: number }

function replay(life: WinLife, t: number, views: number): WinReplay {
  let maximized = life.max0, touch = life.at, view = 0, dx = 0, dy = 0, deny = Infinity;
  for (const e of life.events) {
    if (e.at > t) continue;
    if (e.kind === 'maximize') { maximized = true; touch = e.at; }
    else if (e.kind === 'restore') { maximized = false; touch = e.at; }
    else if (e.kind === 'focus') touch = e.at;
    else if (e.kind === 'deny') { deny = t - e.at; touch = e.at; }
    else if (e.kind === 'view') view = e.view ?? (view + 1) % views;
    else if (e.kind === 'drag') {
      const u = (t - e.at) / e.dur;
      const p = u < 1 ? dragEase(u) : e.spring ? springBack(t - e.at - e.dur) : 1;
      dx += e.by[0] * p; dy += e.by[1] * p;
      touch = e.at;
    }
  }
  return { maximized, touch, view, dx, dy, deny };
}

/** The sideways jerk of a window `deny` seconds after a refused close, px. */
function denyJerk(deny: number): number {
  let jx = 0;
  if (deny < DENY_JERK_FRAMES * FR) {
    const f = Math.floor(deny * FPS + 1e-6);
    jx += Math.round(4 * (1 - f / DENY_JERK_FRAMES) * (f % 2 === 0 ? 1 : -1));
  }
  return jx;
}

/** The box of a window that opens: it grows from `origin` to `rect` in `GROW_FRAMES` frames. */
function growBox(rect: Rect, origin: Vec2, frame: number): { grow: number; box: Rect } {
  const grow = frame >= GROW_FRAMES ? 1 : frame / GROW_FRAMES;
  const f = frame === 0 ? 0.35 : 0.7;
  const [ox, oy] = origin;
  const box: Rect = grow >= 1 ? rect : [
    Math.round(ox + (rect[0] - ox) * f), Math.round(oy + (rect[1] - oy) * f), Math.round(rect[2] * f), Math.round(rect[3] * f),
  ];
  return { grow, box };
}

/** The state of an open window at t. `jy`: the jump of the clicks. `z` is 0: the caller sorts the windows. */
function winState(life: WinLife, t: number, jy: number): { w: WinState; z: number; order: number } {
  const cam = life.spec.cam;
  const body = life.spec.body;
  const views = Math.max(1, cam ? cam.labels.length : body?.kind === 'view' ? body.views ?? 1 : 1);
  const { maximized, touch, view, dx, dy, deny } = replay(life, t, views);
  // the jerk of a refused close
  const jx = denyJerk(deny);
  const r0 = life.spec.rect;
  const rect: Rect = maximized ? FULL : [Math.round(r0[0] + dx + jx), Math.round(r0[1] + dy + jy), r0[2], r0[3]];
  const { grow, box } = growBox(rect, life.origin, Math.floor((t - life.at) * FPS + 1e-6));
  const status = life.spec.status;
  const alert = life.spec.alert ?? 'none';
  const denied = deny < DENY_STATUS;
  const v = view % views;
  return {
    order: life.order,
    z: touch + (life.spec.modal ? 1e6 : 0),
    w: {
      spec: life.spec, id: life.spec.id, title: life.spec.title,
      status: denied ? 'CANNOT CLOSE' : typeof status === 'function' ? status(t) : status ?? '',
      rect, content: contentRect(rect, maximized), maximized, z: 0, grow, box, view: v, alert,
      flash: alert !== 'none' && Math.floor(t * 6) % 2 === 0, age: t - life.at,
      closeFlash: deny < DENY_FLASH, denied,
      ...(cam ? { cam: { index: v, label: cam.labels[v]!, labels: cam.labels, stamp: clockText((cam.clock ?? DEFAULT_CLOCK) + (t - life.at)), rec: Math.floor(t * 2) % 2 === 0 } } : {}),
    },
  };
}

// ================================================================ the track

/** The player's inputs, compiled once. Every method is a pure function of t. */
export class PlayerTrack {
  readonly inputs: PlayerInput[];
  /** The inputs that move the map camera, in time order. */
  readonly map: MapInput[];
  private segs: CurSeg[];
  private presses: Press[];
  private clicks: ClickRec[];
  private handles: HandleRec[];
  private tips: TipRec[];
  private start: Vec2;
  private lives: Map<string, WinLife>;
  private tools: { at: number; tool: Tool | null }[];
  private speeds: { at: number; mode: Speed }[];
  private consoles: ConsoleRec[];
  private carries: CarryRec[];

  /** `cursor`: where the cursor rests before its first move. Default the middle of the frame. */
  constructor(inputs: PlayerInput[], o: { cursor?: Vec2; tool?: Tool | null; speed?: Speed } = {}) {
    for (const i of inputs) if (!Number.isFinite(i.at)) throw new Error(`player: input ${i.kind} has no time`);
    this.inputs = [...inputs].sort((a, b) => a.at - b.at);
    this.start = o.cursor ?? [LW / 2, LH / 2];
    const c = new TrackCompiler(this.start, o.tool ?? null, o.speed ?? 'play');
    this.map = this.inputs.filter((i): i is MapInput => ['pan', 'edge', 'zoom', 'rotate', 'follow', 'look'].includes(i.kind));
    for (const i of this.inputs) c.input(i);
    this.segs = c.segs;
    this.presses = c.presses;
    this.clicks = c.clicks;
    this.handles = c.handles;
    this.tips = c.tips;
    this.lives = c.lives;
    this.tools = c.tools;
    this.speeds = c.speeds;
    this.consoles = c.consoles;
    this.carries = c.carries;
  }

  // ---------------------------------------------------------------- cursor

  /** The cursor at time t. */
  cursorAt(t: number): CursorState {
    let x: number, y: number;
    // the last segment that has started
    let k = -1;
    for (let j = 0; j < this.segs.length && this.segs[j]!.t0 <= t; j++) k = j;
    if (k < 0) [x, y] = this.start;
    else {
      const s = this.segs[k]!;
      if (t >= s.t1) [x, y] = s.to;
      else [x, y] = s.drag ? dragAt(s, (t - s.t0) / (s.t1 - s.t0)) : moveAt(s, (t - s.t0) / (s.t1 - s.t0));
      if (t >= s.t1) {
        // idle: after a short rest the hand twitches by a pixel now and then
        const next = this.segs[k + 1];
        if (t - s.t1 > IDLE_FROM && (!next || next.t0 - t > 0.25)) {
          const slot = Math.floor(t * 6);
          if (hashInt(slot, 17) < 0.3) { x += hashInt(slot, 1) < 0.5 ? -1 : 1; y += hashInt(slot, 2) < 0.5 ? 0 : 1; }
        }
      }
    }
    let down = false, right = false;
    for (const p of this.presses) if (t >= p.t0 - 1e-6 && t < p.t1 - 1e-6) { down = true; right = p.right; }
    return { x: Math.round(x), y: Math.round(y), down, right };
  }

  /** Where the cursor rests after the last input before t (no twitch). */
  restAt(t: number): Vec2 {
    let at = this.start;
    for (const s of this.segs) if (s.t1 <= t) at = s.to;
    return at;
  }

  toolAt(t: number): Tool | null { return [...this.tools].reverse().find((x) => x.at <= t)!.tool; }
  speedAt(t: number): Speed { return [...this.speeds].reverse().find((x) => x.at <= t)!.mode; }

  // ---------------------------------------------------------------- clicks, handles, tip

  /** The window that a click hit (the topmost under the cursor at the click), or null. */
  private clickWin(c: ClickRec): string | null {
    if (c.win === undefined) {
      c.win = null;
      const ws = this.windowStates(c.at, false);
      for (let k = ws.length - 1; k >= 0; k--) {
        const w = ws[k]!;
        if (w.grow >= 1 && inside(w.rect, c.pos[0], c.pos[1])) { c.win = w.id; break; }
      }
    }
    return c.win;
  }

  /** The clicks of the last `within` seconds (default 0.5), oldest first: where, when, how old and which window they hit. */
  clicksAt(t: number, within = 0.5): ClickState[] {
    const out: ClickState[] = [];
    for (const c of this.clicks) {
      const age = t - c.at;
      if (age < 0 || age >= within) continue;
      const winId = this.clickWin(c);
      out.push({ at: c.at, x: c.pos[0], y: c.pos[1], age, right: c.right, ...(winId ? { winId } : {}) });
    }
    return out;
  }

  /** The handle `id` at time t, or null before its first drag. */
  handleAt(id: string, t: number): HandleState | null {
    let rec: HandleRec | undefined;
    for (const h of this.handles) if (h.id === id && h.t0 <= t) rec = h;
    if (!rec) return null;
    const u = (t - rec.t0) / rec.dur;
    const mix = (a: Vec2, b: Vec2, k: number): Vec2 => [Math.round(lerp(a[0], b[0], k)), Math.round(lerp(a[1], b[1], k))];
    if (u < 1) { const k = dragEase(u); return { id, pos: rec.via ? polyAt([rec.from, ...rec.via, rec.to], k) : mix(rec.from, rec.to, k), from: rec.from, u: k, phase: 'held', since: t - rec.t0 }; }
    const since = t - (rec.t0 + rec.dur);
    if (!rec.snap) return { id, pos: rec.to, from: rec.from, u: 1, phase: 'released', since };
    return { id, pos: mix(rec.to, rec.snap, smooth(since / rec.snapDur)), from: rec.from, u: 1, phase: 'snapped', since };
  }

  /** Every handle that has been grabbed by time t. */
  handlesAt(t: number): HandleState[] {
    const ids = [...new Set(this.handles.map((h) => h.id))];
    return ids.map((id) => this.handleAt(id, t)).filter((h): h is HandleState => h !== null);
  }

  /** The tooltip at time t, or null. */
  tipAt(t: number): TipState | null {
    let rec: TipRec | undefined;
    for (const r of this.tips) if (r.at <= t) rec = r;
    if (!rec || rec.text === null) return null;
    const chars = [...rec.text];
    let n = 0;
    while (n < chars.length && (rec.times?.[n] ?? rec.at) <= t) n++;
    const c = this.cursorAt(t);
    return { text: chars.slice(0, n).join(''), full: rec.text, anchor: [c.x, c.y], age: t - rec.at, landAge: n > 0 ? t - (rec.times?.[n - 1] ?? rec.at) : 0, away: rec.away };
  }

  // ---------------------------------------------------------------- console, commands, carry

  /** The time at which the command `cmd` is entered (Enter), or null. A scene reads it to let the world react. */
  commandTime(cmd: string): number | null {
    const c = this.consoles.find((x) => x.cmd === cmd);
    return c ? c.times.enter : null;
  }

  /** The commands entered by time t, oldest first. */
  commandsAt(t: number): CommandState[] {
    return this.consoles.filter((c) => c.times.enter <= t).map((c) => ({ cmd: c.cmd, at: c.times.enter, age: t - c.times.enter }));
  }

  /** The console at time t, or null while it is up. */
  consoleAt(t: number): ConsoleState | null {
    let k = -1;
    for (let j = 0; j < this.consoles.length && this.consoles[j]!.times.open <= t; j++) k = j;
    if (k < 0) return null;
    const c = this.consoles[k]!, tm = c.times;
    let drop: number;
    if (t < tm.open + CONSOLE_SLIDE) drop = t < tm.open + FR ? 0.5 : 1;
    else if (t <= tm.close) drop = 1;
    else drop = t < tm.close + FR ? 0.5 : 0;
    if (drop <= 0) return null;
    const lines = [...CONSOLE_BANNER];
    for (let j = 0; j < k; j++) {
      lines.push(`]${this.consoles[j]!.cmd}`);
      if (this.consoles[j]!.reply !== undefined) lines.push(this.consoles[j]!.reply!);
    }
    const fired = t >= tm.enter;
    const n = tm.typed.filter((x) => x <= t).length;
    return { drop, text: [...c.cmd].slice(0, n).join(''), caret: Math.floor(t * 3.5) % 2 === 0, lines, reply: fired && c.reply !== undefined ? c.reply : null, fired };
  }

  /** The pick-up hand with its object at time t, or null before the grab and 1.5 s after the release. */
  carryAt(t: number): CarryState | null {
    let rec: CarryRec | undefined;
    for (const c of this.carries) if (c.t0 <= t) rec = c;
    if (!rec || t > rec.t1 + CARRY_TAIL) return null;
    const idx = Math.min(rec.swing.length - 1, Math.max(0, (t - rec.t0) / CARRY_STEP));
    const i0 = Math.floor(idx), i1 = Math.min(rec.swing.length - 1, i0 + 1), f = idx - i0;
    const swingVel = lerp(rec.vel[i0]!, rec.vel[i1]!, f);
    const since0 = t - rec.t0;
    const phase = t >= rec.t1 ? 'drop' : since0 < CARRY_GRAB ? 'grab' : 'carry';
    const c = this.cursorAt(t);
    return {
      phase, since: phase === 'drop' ? t - rec.t1 : phase === 'grab' ? since0 : since0 - CARRY_GRAB, pos: [c.x, c.y], from: rec.from, to: rec.to,
      lift: phase === 'drop' ? 1 : smooth(since0 / CARRY_GRAB), swing: lerp(rec.swing[i0]!, rec.swing[i1]!, f), swingVel,
      wriggle: CARRY_WRIGGLE * since0, amp: clamp01(0.55 + 0.08 * Math.min(5, Math.abs(swingVel))),
    };
  }

  // ---------------------------------------------------------------- windows

  /** The upward jump of the window `id` at t from the clicks that hit it, px (negative: up). */
  private clickJump(id: string, t: number): number {
    let jy = 0;
    for (const c of this.clicks) {
      const age = t - c.at;
      if (age < 0 || age >= CLICK_JUMP.length * FR || this.clickWin(c) !== id) continue;
      jy -= CLICK_JUMP[Math.floor(age * FPS + 1e-6)] ?? 0;
    }
    return jy;
  }

  /** The windows at time t, bottom to top. `fx`: with the jumps of the clicks (the hit test of a click leaves them out). */
  private windowStates(t: number, fx: boolean): WinState[] {
    const out: { w: WinState; z: number; order: number }[] = [];
    for (const life of this.lives.values()) {
      if (t < life.at) continue;
      if (life.events.some((e) => e.kind === 'close' && e.at <= t)) continue;
      out.push(winState(life, t, fx ? this.clickJump(life.spec.id, t) : 0));
    }
    out.sort((a, b) => a.z - b.z || a.order - b.order);
    return out.map((o, k) => ({ ...o.w, z: k }));
  }

  /** The state of everything the track shows at time t. */
  stateAt(t: number): PlayerState {
    const windows = this.windowStates(t, true);
    const top = [...windows].reverse().find((w) => w.maximized && w.grow >= 1 && !w.spec.modal) ?? null;
    return {
      t, cursor: this.cursorAt(t), windows, maximized: top, tool: this.toolAt(t), speed: this.speedAt(t),
      clicks: this.clicksAt(t), handles: this.handlesAt(t), tip: this.tipAt(t), console: this.consoleAt(t), commands: this.commandsAt(t), carry: this.carryAt(t),
    };
  }
}

// ================================================================ cursor math

/** A move of the cursor: a slightly curved path that eases out, overshoots a little and corrects. u in 0..1. */
function moveAt(s: CurSeg, u: number): Vec2 {
  const dx = s.to[0] - s.from[0], dy = s.to[1] - s.from[1];
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return s.to;
  const dir: Vec2 = [dx / dist, dy / dist];
  const ov = Math.min(6, 0.05 * dist);
  const end: Vec2 = [s.to[0] + dir[0] * ov, s.to[1] + dir[1] * ov];
  const OV = 0.78;
  if (u >= OV) {
    const k = smooth((u - OV) / (1 - OV));
    return [lerp(end[0], s.to[0], k), lerp(end[1], s.to[1], k)];
  }
  const q = easeOut3(u / OV);
  // a quadratic curve whose middle bulges sideways by `bend` of the distance
  const mx = (s.from[0] + end[0]) / 2 - dir[1] * dist * s.bend, my = (s.from[1] + end[1]) / 2 + dir[0] * dist * s.bend;
  const a = (1 - q) * (1 - q), b = 2 * (1 - q) * q, c = q * q;
  return [a * s.from[0] + b * mx + c * end[0], a * s.from[1] + b * my + c * end[1]];
}

/** The pendulum of the hanging object of a carry: the hand moves along the segment, the object swings under it. Sampled once, every `CARRY_STEP`, from the grab on. */
function carryRec(s: CurSeg, from: Vec2, pxPerM: number): CarryRec {
  const dur = s.t1 - s.t0, n = Math.ceil((dur + CARRY_TAIL) / CARRY_STEP) + 1;
  const swing = new Float32Array(n), vel = new Float32Array(n);
  const h = CARRY_STEP;
  const raw = (t: number): Vec2 => (t <= s.t0 ? s.from : t >= s.t1 ? s.to : dragAt(s, (t - s.t0) / dur, false));
  // the pendulum sees the hand through a 0.1 s mean (11 taps): the eased start of a drag would else be a yank of the whole hand
  const hand = (t: number): number => {
    let x = 0;
    for (let j = -5; j <= 5; j++) x += raw(t + j * 0.01)[0];
    return x / 11;
  };
  let a = 0, w = 0;
  for (let k = 0; k < n; k++) {
    const t = s.t0 + k * h;
    swing[k] = 1.15 * Math.tanh(a / 1.15);
    vel[k] = w;
    // a pivot that moves with ax: theta'' = -(g/L) sin(theta) - (ax/L) cos(theta) - c theta'
    const ax = (hand(t + h) - 2 * hand(t) + hand(t - h)) / (h * h) / pxPerM;
    w += (-(9.81 / CARRY_L) * Math.sin(a) - (ax / CARRY_L) * Math.cos(a) - CARRY_DAMP * w) * h;
    a += w * h;
  }
  return { t0: s.t0, t1: s.t1, from, to: s.to, swing, vel };
}

/** A press-and-move of the cursor: a straight line, eased at the start, and it stops dead. `round` false keeps the sub-pixel path (the swing of a carry). */
function dragAt(s: CurSeg, u: number, round = true): Vec2 {
  const k = dragEase(u);
  if (s.via) return polyAt([s.from, ...s.via, s.to], k, round);
  return [lerp(s.from[0], s.to[0], k), lerp(s.from[1], s.to[1], k)];
}

/** The point at share k (0..1) of the length of a polyline. */
function polyAt(pts: readonly Vec2[], k: number, round = true): Vec2 {
  const r = round ? Math.round : (v: number) => v;
  let len = 0;
  for (let j = 1; j < pts.length; j++) len += Math.hypot(pts[j]![0] - pts[j - 1]![0], pts[j]![1] - pts[j - 1]![1]);
  let d = clamp01(k) * len;
  for (let j = 1; j < pts.length; j++) {
    const a = pts[j - 1]!, b = pts[j]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= l || j === pts.length - 1) { const w = l > 0 ? Math.min(1, d / l) : 1; return [r(lerp(a[0], b[0], w)), r(lerp(a[1], b[1], w))]; }
    d -= l;
  }
  return pts[pts.length - 1]!;
}
