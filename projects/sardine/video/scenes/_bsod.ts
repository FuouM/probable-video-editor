// The crash of the window manager (treatment v9 "Plate 8", chorus 2 end) over the engine's text mode (`@pve/engine/textmode`): the
// message of the crash on full-width banners in the chrome font, and the full blue screen that ends the crash (chorus 2 shows it,
// chorus 3 datamoshes it away). A frame depends only on t.
import { LH, LW } from '@pve/engine/lit';
import type { TextLayer } from '@pve/engine/textlayer';
import { SPB } from './_time';
import type { Fonts } from './_fonts';
import { chromeText, chromeWidth } from './_playerChrome';

/** The full blue screen: the lines under the label (the baseline y in px, the text). */
const BSOD_LINES: readonly (readonly [number, string])[] = [
  [142, 'A fatal exception 0E has occurred at 0028:C0011E36 in VXD JELLY(01) +'],
  [154, '00010E36. The current application will be terminated.'],
  [174, '*  Press any key to terminate the current application.'],
  [186, '*  Press CTRL+ALT+DEL again to restart your computer. You will'],
  [198, '   lose any unsaved information in all applications.'],
];
const BAR = '#1838c8', BAR_INK = '#e8f0ff';

/** Paints the full blue screen at t into `l`: the grey label, the lines of the fatal exception, and the key that it waits for. */
export function paintBsod(l: TextLayer, f: Fonts, t: number) {
  l.rect(0, 0, LW, LH, '#0000aa');
  const lab = ' WINMGR ', lw = chromeWidth(f, lab) + 4, lx = Math.round((LW - lw) / 2);
  l.rect(lx, 112, lw, 11, '#aaaaaa');
  chromeText(l, f, lab, lx + 2, 120, '#0000aa', null);
  for (const [y, s] of BSOD_LINES) chromeText(l, f, s, 96, y, '#ffffff', null);
  const key = 'Press any key to continue', on = Math.floor(t / (SPB / 2)) % 2 === 0;
  chromeText(l, f, on ? `${key} _` : key, Math.round((LW - chromeWidth(f, key)) / 2), 222, '#ffffff', null);
}

/** The message of the crash over the text mode: each line in the chrome font on a full-width blue banner (the baseline y in px, the text). */
export function crashBanners(l: TextLayer, f: Fonts, lines: readonly (readonly [number, string])[]) {
  for (const [y, s] of lines) {
    l.rect(0, y - 8, LW, 11, BAR);
    chromeText(l, f, s, 6, y, BAR_INK, null);
  }
}
