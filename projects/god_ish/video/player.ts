// What the viewer of the web player may change in god_ish (app/site/player.ts reads `options`).
import type { PlayerOption } from '@pve/engine/options';
import { GLOSS_FACES, setGlossFace, type GlossFace } from './scenes/_page';

/** The scenes that set GLOSS (the small English text) and measure or cache it when they load. */
const GLOSS_SCENES = ['original', 'feed', 'parrot', 'new'];

export const options: PlayerOption[] = [
  {
    id: 'gloss',
    label: 'EN FONT',
    values: Object.entries(GLOSS_FACES).map(([id, f]) => ({ id, label: f.label })),
    default: 'fraktur',
    // the calls (Gott ist tot, My God, Do you know?) and the title stay Fraktur: they are big enough to read
    async apply(value, assets) {
      if (!(value in GLOSS_FACES)) throw new Error(`gloss: unknown face "${value}"`);
      await setGlossFace(assets, value as GlossFace);
      return GLOSS_SCENES;
    },
  },
];
