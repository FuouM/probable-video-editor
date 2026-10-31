// A board is a scene file that video.json does not name: a type specimen, a layout sketch, a contact board of
// candidates. It is added to the page's timeline as a one-second clip long after the song, so no clip is on screen
// with it, and rendered through the engine like any frame.
import type { Page } from 'playwright-core';
import type { PveWindow } from './browser';
import { stills, type StillOptions } from './render';

/** Song time at which a board plays. */
export const BOARD_T0 = 100_000;

/**
 * Renders the scene module at `src` (a path on the dev server, `/projects/<id>/video/scenes/x.ts`) into the PNG
 * `file`, `at` seconds into the scene. Returns the sub-frame count of the still.
 */
export async function renderBoard(page: Page, src: string, id: string, file: string, at: number, o: StillOptions): Promise<number> {
  await page.evaluate(async ([t0, s, name]) => {
    const w = window as unknown as PveWindow & { __pve: { engine: Record<string, unknown> & { timeline: unknown[] } } };
    const e = { id: name, scene: name, load: () => import(/* @vite-ignore */ s), start: t0, end: t0 + 1 };
    w.__pve.engine.timeline.push(e);
    await (w.__pve.engine.loadEntry as (e: unknown) => Promise<void>).call(w.__pve.engine, e);
    w.__pve.engine.hudOff = true;
  }, [BOARD_T0, src, id] as const);
  const errors = await page.evaluate(() => (window as unknown as PveWindow).__pve!.errors);
  if (errors.length) throw new Error(errors.join('\n'));
  const counts = await stills(page, [{ t: BOARD_T0 + at, file }], o);
  return counts[0]!;
}
