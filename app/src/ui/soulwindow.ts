// The SoulWindow theme / accent / density controller, created once per page (studio and player).
import { createSoulWindow } from 'soulwindow/runtime';
import { SW_OPTIONS } from './soulwindow-options';

export const sw = createSoulWindow(SW_OPTIONS);

/**
 * Calls `fn` after each theme or accent change. Canvas code reads its colours with `readTokens()` at
 * start and again here: readTokens walks every stylesheet, so never per frame.
 */
export function onTheme(fn: () => void): () => void {
  let key = `${sw.theme()}|${sw.accent()}`;
  return sw.subscribe((s) => {
    const next = `${s.theme}|${s.accent}`;
    if (next === key) return;
    key = next;
    fn();
  });
}
