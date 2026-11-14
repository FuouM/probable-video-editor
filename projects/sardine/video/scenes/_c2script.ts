// The script of the player and the jellyfish in chorus 2 (`chorus2.ts`): the inputs of the cursor and the plan of the desktop buddy
// (`_buddy.ts`), act by act. `C2Script.build` gives both; the scene makes the buddy and the track from them.
import type { Line } from '@pve/engine/lyrics';
import { LH, LW } from '@pve/engine/lit';
import { hashSin } from '@pve/engine/util';
import { BAR, FR, SPB, bar } from './_time';
import type { Fonts } from './_fonts';
import { BUDDY_MPP, dropHit, type Actor, type BuddyPlan } from './_buddy';
import { centreOf, clickAt, contentRect, type PlayerInput, type Rect, type Vec2, type WinSpec } from './_playerTypes';
import { fishCamWindow, loadErrorModal, modalButton } from './_playerWindows';
import { LAP, SPEED, lapAt } from './_c2shared';
import { RIDE_RECT, clickClose, rideWindow } from './_sceneKit';
import { CONF_RECT, CURSOR_LAST, TM_RECT, TM_VIS, drawConf, drawErr, drawTm, remButton, reminder, tmButton, tmRowAt } from './_c2apps';
import { FILL, T0, T_CONF, T_COPIES, T_END, T_END1, T_KILL, T_SEL1, T_SEL2, T_SINK, T_TM, T_VERSE } from './_c2clock';

/** The minimap and the fish cam stand where verse 2 left them. */
const MINI_RECT: Rect = [480, 14, 156, 100];
const FISH_RECT: Rect = [464, 208, 172, 110];
/** The first LOAD ERROR modal of verse 2 stood here: the cursor is on its OK when the clip starts. */
const ERR_AT: Vec2 = [20, 40];
/** The home of the jellyfish: the rim of its bell, left of the fish cam. Its size (1 = 188 px tall). */
const HOME: Vec2 = [444, 236];
const SIZE = 0.55;
/** The jellyfish carries the dialog of line 22 to this corner. */
const CARRY_TO: Vec2 = [14, 28];
/** The reminders of the timetable. */
const TITLES = ['[NEXT: あした]', '[11/3 引越し]', '[あしたのひるすぎ]', '[CANNOT DELETE ROW]'] as const;
const REM_H = 66;
/** The place of the reminder of lead line k (1..7): three places in the top left of the frame, in turn. */
const remAt = (k: number): Vec2 => [14 + 22 * ((k - 1) % 3), 26 + 26 * ((k - 1) % 3)];
/** The `ca` copy lies this far off. */
const CA_OFF = 3;
const ERR_W = 72, ERR_H = 40;
const ERR_SLOTS: Vec2[] = [[6, 150], [562, 118], [6, 196], [562, 162], [6, 242]];

type Anchor = Actor['anchors'][number]['to'];
type Offer = BuddyPlan['offers'][number];

export class C2Script {
  readonly inputs: PlayerInput[] = [];
  readonly plan: BuddyPlan;
  /** The offer of line 23: the scene clicks its buttons when the buddy can say where they are. */
  readonly offer: Offer;
  /** The cursor at the start: on the OK of the first LOAD ERROR modal of verse 2. */
  readonly cursor0: Vec2;
  private readonly main: Actor;
  private readonly dialog: WinSpec;

  /** `lead`: lead lines 22-30; `ko`, `ca`: the voices of lines 22-29; `snares`: the snares of the second half, one ERR box each. */
  constructor(private readonly f: Fonts, private readonly lead: readonly Line[], ko: Line[], private readonly ca: readonly Line[], snares: readonly number[]) {
    const errBase = loadErrorModal(f);
    this.cursor0 = centreOf(modalButton(f, { ...errBase, rect: [ERR_AT[0], ERR_AT[1], errBase.rect[2], errBase.rect[3]] }, 'OK'));
    // the dialog of line 22, where `interlude.ts` left it. Here it is no modal: the state has loaded
    const say = lead[0]!.written?.jp;
    const dlgBase = loadErrorModal(f, { id: 'dlg22', ...(say ? { say } : {}) });
    const D: Rect = [Math.round((LW - dlgBase.rect[2]) / 2), Math.round((LH - dlgBase.rect[3]) / 2), dlgBase.rect[2], dlgBase.rect[3]];
    this.dialog = { ...dlgBase, rect: D, modal: false, dim: 0 };
    this.openWindows();
    this.plan = {
      actors: [], carries: [], drops: [], knocks: [], laughs: [], spins: [], offers: [], says: ko,
      // the jellyfish stand still over the text mode and explode on the hits of the fill before the blue screen: the copies on hits 2-3,
      // the first one on hit 3
      kill: T_KILL, gone: (n) => (n === 0 ? FILL[2] : FILL[1 + (n % 2)]!), sink: T_SINK, end: T_END,
    };
    // on the dialog it has the size of the seam (`interlude.ts`: the bar is 2.6 jellyfish wide); it is smaller when it goes home
    this.main = { from: [D[0] + D[2] / 2, D[1]], size: (D[2] * BUDDY_MPP) / 2.6, phase: 0.4, anchors: [] };
    this.plan.actors.push(this.main);
    this.carryDialog();
    this.openReminders();
    this.offer = this.offerLine(ko);
    this.dodge();
    this.grab();
    this.lift();
    this.business();
    this.copies();
    this.closeProgram();
    this.errBoxes(snares);
  }

  private go(t: number, to: Anchor, dur: number, size?: number) {
    this.main.anchors.push({ t, to, dur, ...(size !== undefined ? { size } : {}) });
  }

  private drop(id: string, rect: Rect, at: number, line: Line, n: number) {
    this.plan.drops.push({ id, at, rect, line, n });
    this.inputs.push({ at: dropHit(rect, at), kind: 'close', id });
  }

  private remRect(k: number): Rect {
    const [x, y] = remAt(k);
    return [x, y, Math.max(150, 16 * this.lead[k]!.written!.units.length + 48), REM_H];
  }

  private caRect(k: number): Rect {
    const r = this.remRect(k);
    return [r[0] + CA_OFF, r[1] + CA_OFF, r[2], r[3]];
  }

  private btn(r: Rect, i = 0, n = 1): Vec2 { return centreOf(remButton(contentRect(r, false), i, n)); }

  /** The cursor clicks the reminder of line k away, then its copy. */
  private dismiss(k: number, at: number, i = 0, n = 1) {
    this.inputs.push(...clickClose(at, this.btn(this.remRect(k), i, n), `rem${k}`));
    this.inputs.push(...clickClose(at + 0.45, this.btn(this.caRect(k), i, n), `rem${k}c`));
  }

  /** The windows of the seam from verse 2, and the try of the downbeat, where the OK of the first modal was: this one loads. */
  private openWindows() {
    const kmh = Math.round(SPEED * 3.6);
    const under = (t: number) => LAP.at(lapAt(t)).up.y < 0;
    const ride = rideWindow(RIDE_RECT, (t) => (t < T0 + 1.2 ? 'LOAD OK  (SLOT 1)' : `CAR 1  ${kmh} km/h  LAP ${1 + Math.floor((t - T0) / (8 * BAR))}`), null);
    const mini: WinSpec = { id: 'mini', title: '[MAP: MÖBIUS]', rect: MINI_RECT, body: { kind: 'view' }, status: (t) => `DAY ???  ${under(t) ? 'UNDERSIDE' : 'TOPSIDE'}` };
    const fishWin = fishCamWindow({ id: 'fish', rect: FISH_RECT, clock: T_VERSE });
    this.inputs.push(
      { at: T0 - 1.5, kind: 'open', win: ride, maximized: true },
      { at: T0 - 1.5, kind: 'open', win: mini },
      { at: T0 - 1.5, kind: 'open', win: fishWin },
      { at: T0 - 1.5, kind: 'open', win: this.dialog },
      ...clickAt(T0, this.cursor0, { dur: 0.16 }),
    );
  }

  /** Bars 61-62: it has the dialog. The cursor goes for its OK, and it carries the dialog off. When the line has ended it drops it. */
  private carryDialog() {
    const D = this.dialog.rect, lead = this.lead;
    this.go(T0 - 1, { win: 'dlg22', rest: D }, 0.01);
    const by: Vec2 = [CARRY_TO[0] - D[0], CARRY_TO[1] - D[1]];
    this.plan.carries.push({ id: 'dlg22', t: T0 + 0.25, dur: 0.6, by });
    this.inputs.push(...clickAt(T0 + 0.56, centreOf(modalButton(this.f, this.dialog, 'OK')), { dur: 0.3 }));
    const tDrop = lead[0]!.end + 0.05;
    this.plan.carries.push({ id: 'dlg22', t: tDrop - 0.26, dur: 0.22, by: [0, -14] });
    this.drop('dlg22', [CARRY_TO[0], CARRY_TO[1] - 14, D[2], D[3]], tDrop, lead[0]!, 2);
    this.go(tDrop, HOME, 0.6, SIZE);
  }

  /** The reminders: one for each lead line, and the `ca` copy under it. */
  private openReminders() {
    for (let k = 1; k <= 7; k++) {
      const at = this.lead[k]!.start - 3 * FR, buttons = k === 4 ? ['OK', 'LATER'] : ['OK'];
      this.inputs.push({ at, kind: 'open', win: reminder(this.f, `rem${k}c`, TITLES[k % 4]!, this.caRect(k), this.ca[k]!, true, buttons), origin: HOME });
      this.inputs.push({ at: at + FR, kind: 'open', win: reminder(this.f, `rem${k}`, TITLES[k % 4]!, this.remRect(k), this.lead[k]!, false, buttons), origin: HOME });
    }
  }

  /** Bars 63-64 (line 23): it offers the line with two buttons, turns about itself and knocks on the glass, twice in each bar. */
  private offerLine(ko: readonly Line[]): Offer {
    this.plan.knocks.push(bar(63) + 2 * SPB, bar(63) + 3 * SPB, bar(64) + 2 * SPB, bar(64) + 3 * SPB);
    this.plan.spins.push(bar(64));
    const offer: Offer = { line: 1, buttons: ['OK', 'NO'], presses: [{ at: ko[1]!.end - 1.15, i: 1 }, { at: ko[1]!.end - 0.7, i: 1 }] };
    this.plan.offers.push(offer);
    this.plan.laughs.push([ko[1]!.end - 0.62, ko[1]!.end - 0.1]);
    this.dismiss(1, this.lead[1]!.end + 0.17);
    return offer;
  }

  /** Bars 65-66 (line 24): it sits on the fish cam. The cursor goes for it twice, it dodges and laughs. */
  private dodge() {
    this.go(bar(65) - 0.18, { win: 'fish', rest: FISH_RECT }, 0.4);
    const dodge1: Vec2 = [372, 236], dodge2: Vec2 = [452, 168];
    this.inputs.push(...clickAt(bar(65) + 1.12, [FISH_RECT[0] + 86, FISH_RECT[1] + 5]));
    this.go(bar(65) + 0.94, dodge1, 0.22);
    this.inputs.push(...clickAt(bar(65) + 1.72, [dodge1[0], dodge1[1] + 16]));
    this.go(bar(65) + 1.54, dodge2, 0.22);
    this.plan.laughs.push([bar(65) + 1.8, bar(66) + 0.95]);
    this.go(bar(66) + 1.0, HOME, 0.4);
    this.dismiss(2, this.lead[2]!.end + 0.13);
  }

  /** Bars 67-68 (line 25): the cursor goes for the next reminder. It grabs the cursor and holds on: no click for a bar. */
  private grab() {
    const tGrab = this.lead[3]!.start + 0.6;
    this.inputs.push({ at: tGrab + 0.25, kind: 'move', to: [300, 170], dur: 0.3 });
    this.go(tGrab, 'cursor', 0.3);
    const jerks: Vec2[] = [[250, 140], [334, 192], [262, 204], [340, 150], [292, 176]];
    jerks.forEach((to, i) => this.inputs.push({ at: tGrab + 0.6 + 0.45 * i, kind: 'move', to, dur: 0.14 }));
    this.inputs.push({ at: bar(69) - 0.55 + 0.2, kind: 'move', to: [214, 128], dur: 0.14 });
  }

  /** Bars 69-70 (line 26): it lets go, lifts the reminder that the player could not close, and drops it. LATER: the next reminder comes at once. */
  private lift() {
    const tFree = bar(69) - 0.55, R3 = this.remRect(3);
    this.go(tFree, { win: 'rem3', rest: R3 }, 0.35);
    this.plan.carries.push({ id: 'rem3', t: tFree + 0.5, dur: 0.3, by: [0, -18] });
    this.drop('rem3', [R3[0], R3[1] - 18, R3[2], R3[3]], tFree + 1.0, this.lead[3]!, 1);
    this.go(tFree + 1.0, HOME, 0.6);
    this.inputs.push(...clickClose(tFree + 1.9, this.btn(this.caRect(3)), 'rem3c'));
    this.dismiss(4, this.lead[4]!.end + 0.08, 1, 2);
  }

  /**
   * Bars 71-75: its own business while the copies come. It turns, floats over to the minimap and knocks there (the minimap goes a
   * little out of its place with each knock), comes home, laughs at them. The cursor puts the minimap back, and tries to wipe a dead
   * block away.
   */
  private business() {
    this.plan.spins.push(bar(71), bar(73) + 2 * SPB, bar(75) + 2 * SPB);
    this.go(bar(71) + 2 * SPB, [404, 96], 0.5);
    this.plan.knocks.push(bar(72) + 2 * SPB, bar(72) + 3 * SPB);
    const SHOVE: Vec2 = [-9, 5];
    for (const k of [bar(72) + 2 * SPB, bar(72) + 3 * SPB]) this.plan.carries.push({ id: 'mini', t: k, dur: 0.12, by: SHOVE });
    this.go(bar(73), HOME, 0.5);
    this.plan.laughs.push([bar(74) + SPB, bar(74) + 3 * SPB]);
    // the cursor tidies: it takes the minimap by its title bar and puts it back where it was
    const tTidy = bar(73) + 2.5 * SPB;
    this.inputs.push({ at: tTidy - 2 * FR, kind: 'move', to: [MINI_RECT[0] + 2 * SHOVE[0] + 24, MINI_RECT[1] + 2 * SHOVE[1] + 6], dur: 0.25 });
    this.inputs.push({ at: tTidy, kind: 'dragWindow', id: 'mini', by: [-2 * SHOVE[0], -2 * SHOVE[1]], dur: 0.3 });
    // it rubs at the faults of the fish cam: nothing comes off
    const tWipe = tTidy + 0.64;
    this.inputs.push({ at: tWipe - 2 * FR, kind: 'move', to: [FISH_RECT[0] + 30, FISH_RECT[1] + 44], dur: 0.22 });
    for (let i = 0; i < 3; i++) this.inputs.push({ at: tWipe + 0.17 * i, kind: 'drag', to: [FISH_RECT[0] + (i % 2 ? 30 : 120), FISH_RECT[1] + 44 + 8 * i], dur: 0.14 });
  }

  /** Bars 69-76: it multiplies. A copy grows out of it each half bar and takes a place on the status bar or on a title bar. */
  private copies() {
    const top = (u: number) => ({ win: 'top', rest: [0, 0, LW, 10] as Rect, u });
    const perches: Anchor[] = [
      [150, 292], { win: 'mini', rest: MINI_RECT, u: 0.32 }, [104, 294], { win: 'fish', rest: FISH_RECT, u: 0.76 }, top(0.3), [58, 292],
      { win: 'rem6', rest: this.remRect(6), u: 0.72 }, top(0.62), [404, 150], top(0.46), { win: 'rem7', rest: this.remRect(7), u: 0.3 }, [22, 294],
    ];
    perches.forEach((to, i) => {
      const born = T_COPIES + i * 2 * SPB;
      this.plan.actors.push({ born, from: HOME, size: 0.34 + 0.06 * hashSin(i, 70), phase: 1.1 + 0.83 * i, anchors: [{ t: born + 0.1, to, dur: 0.5 }] });
    });
    const lead = this.lead;
    this.dismiss(5, lead[5]!.end + 0.2);
    this.dismiss(6, lead[6]!.end + 0.1);
    // the copy on the reminder of line 28 goes down to the status bar when that reminder is clicked away
    this.plan.actors[7]!.anchors.push({ t: lead[6]!.end + 0.1, to: [196, 292], dur: 0.45 });
    // a copy takes the cursor after the last click, and keeps it
    this.plan.actors[9]!.anchors.push({ t: lead[6]!.end + 0.75, to: 'cursor', dur: 0.35 });
  }

  /**
   * Line 29: Ctrl+Alt+Del (by keys: no click). The player selects the last JELLY.EXE; the copy that holds the cursor drags it one row
   * down, and the next click selects WINMGR.EXE. End Task, and End Task again in the box that asks, on the first hit of the fill.
   */
  private closeProgram() {
    const f = this.f;
    this.inputs.push({ at: T_TM, kind: 'open', win: { id: 'tm', title: '[Close Program]', rect: TM_RECT, body: { kind: 'draw', draw: (l, c, t) => drawTm(l, f, c, t) } } });
    this.inputs.push(...clickAt(T_SEL1, tmRowAt(TM_VIS - 3)));
    this.inputs.push({ at: T_SEL1 + 0.3, kind: 'move', to: tmRowAt(TM_VIS - 2), dur: 0.12 });
    this.inputs.push(...clickAt(T_SEL2, tmRowAt(TM_VIS - 2)));
    this.inputs.push(...clickAt(T_END1, centreOf(tmButton(0))));
    this.inputs.push({ at: T_CONF, kind: 'open', win: { id: 'conf', title: '[WINMGR.EXE]', rect: CONF_RECT, body: { kind: 'draw', draw: (l, c, t) => drawConf(l, f, c, t) } } });
    this.inputs.push(...clickAt(FILL[0], CURSOR_LAST));
  }

  /** An ERR box on every snare of the second half; each stays for a bar. */
  private errBoxes(snares: readonly number[]) {
    const f = this.f;
    snares.forEach((s, n) => {
      const [x, y] = ERR_SLOTS[n % ERR_SLOTS.length]!;
      const id = `err${n}`;
      this.inputs.push({ at: s, kind: 'open', win: { id, title: '[ERR]', rect: [x, y, ERR_W, ERR_H], body: { kind: 'draw', draw: (l, c) => drawErr(l, f, c, n) } }, origin: HOME });
      if (s + BAR < T_SINK) this.inputs.push({ at: s + BAR, kind: 'close', id });
    });
  }
}
