// The save dialog of Chorus 2, shared by without (it stops at 99 %) and the Over transition whose laser
// breaks out of its progress bar into cnn: about half the frame wide, left aligned, low in the box.
import { BAR } from './_kit';
import { H, W } from '@pve/engine/gl';

export const DIALOG = { x: 120, y: H - BAR - 300, w: W / 2, h: 220 };
/** the progress bar's well inside the dialog */
export const BAR_RECT = { x: DIALOG.x + 36, y: DIALOG.y + 104, w: DIALOG.w - 72, h: 36 };
/** the share of the bar the fill stops at */
export const STUCK = 0.99;
