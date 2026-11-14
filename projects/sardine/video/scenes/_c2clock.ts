// The clock of chorus 2 (`chorus2.ts`): the clip, the copies of the jellyfish, the drum fill of bar 76, the crash and the Close Program
// box of line 29. Shared by the scene, its player script (`_c2script.ts`) and its fake programs (`_c2apps.ts`).
import { FR, SPB, bar } from './_time';

export const T0 = bar(61);
export const T_END = bar(77);
/** Beat 3 of bar 76: the full blue screen. */
export const T_SINK = bar(76) + 2 * SPB;
/** Beat 4 of bar 76, line 30 (あ): the train is back as it is, in the text mode of the rest of the world, to the end of the clip. */
export const T_REVEAL = bar(76) + 3 * SPB;
/** The jellyfish took the dialog of line 22 at this time (`interlude.ts`). */
export const T_VERSE = bar(53);
/** The copies of the jellyfish show from bar 69, one each half bar. */
export const T_COPIES = bar(69);
/** The drum fill of bar 76 (snare and woodblock): End Task on the first hit, and the jellyfish explode on the next two. */
export const FILL = [133.333, 133.667, 134.0, 134.222, 134.444, 134.556] as const;
/** End Task hits on the first hit of the fill: for 4 frames the desktop tears, then the window manager is dead and the screen is in text mode. */
export const T_KILL = FILL[0] + 4 * FR;
/**
 * Line 29: the Close Program box opens; the player selects the last JELLY.EXE, is dragged one row down onto WINMGR.EXE, presses End
 * Task, and presses End Task in the box that asks again on the first hit of the fill.
 */
export const T_TM = 131.112, T_SEL1 = T_TM + 1.5 * SPB, T_SEL2 = T_TM + 3 * SPB, T_END1 = T_TM + 4 * SPB, T_CONF = T_END1 + 3 * FR;
