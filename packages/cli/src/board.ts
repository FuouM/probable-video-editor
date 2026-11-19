// A board is a scene file that video.json does not name: a type specimen, a layout sketch, a contact board of
// candidates. It is added to the page's timeline as a one-second clip long after the song, so no clip is on screen
// with it, and rendered through the engine like any frame.
import type { Page } from 'playwright-core';
import { deadline, READY_MS, type PveWindow } from './browser';
import { stills, type StillOptions } from './render';

/** Song time at which a board plays. */
export const BOARD_T0 = 100_000;

/**
 * Adds the scene module at `src` (a path on the dev server, `/projects/<id>/video/scenes/x.ts`) to the page's timeline as the
 * clip `id` of `len` seconds starting at `t0`, with ctx.params `params`, and loads it. Throws the page's errors.
 */
export async function addBoard(page: Page, src: string, id: string, t0 = BOARD_T0, len = 1, params: Record<string, unknown> = {}): Promise<void> {
  await deadline(page.evaluate(async ([t0, s, name, len, params]) => {
    const w = window as unknown as PveWindow & { __pve: { engine: Record<string, unknown> & { timeline: unknown[] } } };
    const [url, exp] = s.split('#');
    const load = async () => {
      // Runtime-selected board module URL, loaded dynamically into the browser context.
      const mod = (await import(/* @vite-ignore */ url!)) as Record<string, unknown>;
      const Target = exp && mod[exp] ? mod[exp] : mod.default;
      if (!Target) throw new Error(`${s}: no export ${exp ?? 'default'}`);
      return { default: Target };
    };
    const e = { id: name, scene: name, load, start: t0, end: t0 + len, params };
    w.__pve.engine.timeline.push(e);
    await (w.__pve.engine.loadEntry as (e: unknown) => Promise<void>).call(w.__pve.engine, e);
    w.__pve.engine.hudOff = true;
  }, [t0, src, id, len, params] as const), READY_MS, `loading the board ${src}`);
  const errors = await page.evaluate(() => (window as unknown as PveWindow).__pve!.errors);
  if (errors.length) throw new Error(errors.join('\n'));
}

/**
 * Renders the scene module at `src` (a path on the dev server, `/projects/<id>/video/scenes/x.ts`) into the PNG
 * `file`, `at` seconds into the scene. Returns the sub-frame count of the still.
 */
export async function renderBoard(page: Page, src: string, id: string, file: string, at: number, o: StillOptions): Promise<number> {
  await addBoard(page, src, id);
  const counts = await stills(page, [{ t: BOARD_T0 + at, file }], o);
  return counts[0]!;
}
