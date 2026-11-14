// The icons of the sardine game UI: the toolbar icons (v5) and the tool icons (v5 and v6), drawn with an engine Ui
// round a centre (cx, cy).
import type { Ui } from '@pve/engine/ui';

type Icon = (cx: number, cy: number) => void;

/** The toolbar icons (film, grid, home, ..., the v5 tools, the speed keys, rotate). */
export function gameIcons(ui: Ui) {
  return {
    film: (cx: number, cy: number) => { ui.rect(cx - 6, cy - 4, 12, 8, '#2a2a34'); for (let i = 0; i < 4; i++) { ui.rect(cx - 5 + i * 3, cy - 3, 2, 2, '#c8c8d8'); ui.rect(cx - 5 + i * 3, cy + 1, 2, 2, '#c8c8d8'); } },
    grid: (cx: number, cy: number) => { for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) ui.rect(cx - 6 + i * 6, cy - 6 + j * 6, 5, 5, '#d8d8e8'); },
    home: (cx: number, cy: number) => { ui.rect(cx - 2, cy - 1, 4, 7, '#f0c070'); ui.line(cx - 6, cy, cx, cy - 6, '#f0c070'); ui.line(cx + 6, cy, cx, cy - 6, '#f0c070'); ui.line(cx - 4, cy, cx, cy - 4, '#f0c070'); ui.line(cx + 4, cy, cx, cy - 4, '#f0c070'); },
    disc: (cx: number, cy: number) => { ui.ring(cx, cy, 5, '#f0f0f0'); ui.ring(cx, cy, 4, '#f0f0f0'); ui.ring(cx, cy, 3, '#c8c8d8'); },
    window: (cx: number, cy: number) => { ui.rect(cx - 6, cy - 5, 12, 10, '#1e1e2c'); ui.rect(cx - 5, cy - 4, 10, 8, '#a8b0d0'); ui.rect(cx, cy - 4, 1, 8, '#1e1e2c'); },
    plus: (cx: number, cy: number) => { ui.rect(cx - 1, cy - 6, 3, 13, '#38c050'); ui.rect(cx - 6, cy - 1, 13, 3, '#38c050'); },
    map: (cx: number, cy: number) => { ui.rect(cx - 6, cy - 6, 13, 13, '#38b070'); for (let i = -4; i <= 4; i += 4) { ui.rect(cx - 6, cy + i, 13, 1, '#1e6a40'); ui.rect(cx + i, cy - 6, 1, 13, '#1e6a40'); } },
    menu: (cx: number, cy: number) => { for (let i = -4; i <= 4; i += 4) ui.rect(cx - 6, cy + i - 1, 13, 2, '#e8e8f0'); },
    shovel: (cx: number, cy: number) => { ui.line(cx + 6, cy - 6, cx - 1, cy + 1, '#a8703c'); ui.line(cx + 5, cy - 6, cx - 2, cy + 1, '#a8703c'); ui.rect(cx - 6, cy + 1, 5, 5, '#b8c0c8'); ui.rect(cx - 6, cy + 5, 5, 1, '#6c747c'); ui.rect(cx + 5, cy - 7, 3, 2, '#d8d8e0'); },
    rail: (cx: number, cy: number) => { for (let i = -5; i <= 5; i += 3) ui.rect(cx - 6, cy + i, 13, 1, '#8a5c34'); ui.rect(cx - 4, cy - 7, 1, 14, '#c8ccd4'); ui.rect(cx + 4, cy - 7, 1, 14, '#c8ccd4'); },
    eraser: (cx: number, cy: number) => { for (let i = 0; i < 6; i++) ui.line(cx - 6 + i, cy + 3, cx - 1 + i, cy - 4, i < 3 ? '#f0f0f0' : '#e04858'); ui.line(cx - 6, cy + 4, cx + 3, cy + 4, '#8a2030'); },
    scissors: (cx: number, cy: number) => { ui.line(cx - 4, cy + 3, cx + 5, cy - 6, '#d8dce4'); ui.line(cx + 4, cy + 3, cx - 5, cy - 6, '#d8dce4'); ui.ring(cx - 4, cy + 4, 2, '#e03030'); ui.ring(cx + 4, cy + 4, 2, '#e03030'); },
    close: (cx: number, cy: number) => { ui.line(cx - 5, cy - 5, cx + 5, cy + 5, '#ffffff'); ui.line(cx - 4, cy - 5, cx + 5, cy + 4, '#ffffff'); ui.line(cx + 5, cy - 5, cx - 5, cy + 5, '#ffffff'); ui.line(cx + 4, cy - 5, cx - 5, cy + 4, '#ffffff'); },
    record: (cx: number, cy: number) => { ui.rect(cx - 6, cy - 6, 13, 13, '#c02828'); ui.rect(cx - 3, cy - 3, 7, 7, '#f0e0e0'); },
    bulldozer: (cx: number, cy: number) => { ui.rect(cx - 6, cy - 1, 9, 5, '#e0b020'); ui.rect(cx - 2, cy - 5, 5, 4, '#e0b020'); ui.rect(cx + 3, cy + 1, 4, 4, '#a07810'); ui.rect(cx - 7, cy + 4, 14, 2, '#303038'); ui.rect(cx - 7, cy - 2, 2, 7, '#c8ccd4'); },
    pause: (cx: number, cy: number) => { ui.rect(cx - 4, cy - 5, 3, 11, '#f0f0f0'); ui.rect(cx + 2, cy - 5, 3, 11, '#f0f0f0'); },
    play: (cx: number, cy: number) => { for (let i = 0; i < 6; i++) ui.rect(cx - 3 + i, cy - 5 + i, 1, 11 - 2 * i, '#f0f0f0'); },
    fast: (cx: number, cy: number) => { for (const o of [-5, 0]) for (let i = 0; i < 5; i++) ui.rect(cx + o + i, cy - 5 + i, 1, 11 - 2 * i, '#f0f0f0'); },
    rotate: (cx: number, cy: number) => {
      ui.ring(cx, cy + 1, 5, '#f0f0f0');
      ui.ring(cx, cy + 1, 4, '#f0f0f0');
      ui.rect(cx - 6, cy - 6, 7, 5, '#5d5a78');
      ui.rect(cx - 1, cy - 8, 8, 2, '#f0f0f0');
      ui.rect(cx + 3, cy - 10, 2, 6, '#f0f0f0');
      ui.rect(cx + 1, cy - 9, 6, 4, '#f0f0f0');
    },
  };
}

/** The icons of the v6 tools, 13 px. */
function v6Icons(ui: Ui): Record<string, Icon> {
  const l = ui.l;
  return {
    bend: (cx, cy) => {
      for (let i = 0; i <= 12; i++) {
        const u = i / 12, v = 1 - u;
        ui.rect(cx + Math.round(v * v * -6 + 2 * v * u * 5 + u * u * 5), cy + Math.round(v * v * 5 + 2 * v * u * 5 + u * u * -3), 2, 2, '#c8ccd4');
      }
      ui.rect(cx + 3, cy - 7, 5, 5, '#1a1a22');
      ui.rect(cx + 4, cy - 6, 3, 3, '#ffd23a');
    },
    poke: (cx, cy) => {
      ui.rect(cx - 2, cy - 6, 4, 8, '#1a1a22');
      ui.rect(cx - 1, cy - 5, 2, 7, '#f0c090');
      ui.rect(cx - 5, cy + 1, 10, 6, '#1a1a22');
      ui.rect(cx - 4, cy + 2, 8, 4, '#f0c090');
      l.put(cx - 5, cy - 6, '#ffd23a'); l.put(cx + 4, cy - 6, '#ffd23a'); l.put(cx + 5, cy - 3, '#ffd23a'); l.put(cx - 6, cy - 3, '#ffd23a');
    },
    punch: (cx, cy) => {
      ui.rect(cx - 7, cy - 1, 8, 8, '#1a1a22');
      ui.rect(cx - 6, cy, 6, 6, '#f0c090');
      for (let i = 0; i < 3; i++) ui.rect(cx - 5 + i * 2, cy, 1, 2, '#c08858');
      const b = '#ffd23a';
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) ui.line(cx + 4 + dx * 2, cy - 3 + dy * 2, cx + 4 + dx * 4, cy - 3 + dy * 4, b);
      ui.rect(cx + 3, cy - 4, 3, 3, '#e07020');
    },
    delete: (cx, cy) => {
      ui.rect(cx - 5, cy - 5, 11, 2, '#d8dce4');
      ui.rect(cx - 2, cy - 7, 5, 2, '#d8dce4');
      ui.rect(cx - 4, cy - 3, 9, 10, '#8a929c');
      ui.rect(cx - 4, cy - 3, 1, 10, '#aab2bc');
      for (const x of [-2, 0, 2]) ui.rect(cx + x, cy - 1, 1, 6, '#4a525c');
      ui.rect(cx - 4, cy + 6, 9, 1, '#4a525c');
    },
    zone: (cx, cy) => {
      for (let i = -6; i <= 6; i += 2) { l.put(cx + i, cy - 5, '#38c050'); l.put(cx + i, cy + 5, '#38c050'); }
      for (let j = -5; j <= 5; j += 2) { l.put(cx - 6, cy + j, '#38c050'); l.put(cx + 6, cy + j, '#38c050'); }
      ui.rect(cx - 4, cy - 3, 9, 7, '#1e6a40');
      ui.rect(cx - 7, cy - 6, 3, 3, '#ffd23a');
      ui.rect(cx + 5, cy + 4, 3, 3, '#ffd23a');
    },
    disaster: (cx, cy) => {
      const c = '#ffd23a', d = '#e07020';
      for (const o of [0, 1]) {
        ui.line(cx + 3 + o, cy - 7, cx - 3 + o, cy, o ? d : c);
        ui.line(cx - 3 + o, cy, cx + 2 + o, cy, o ? d : c);
        ui.line(cx + 2 + o, cy, cx - 3 + o, cy + 7, o ? d : c);
      }
      ui.rect(cx - 4, cy + 6, 2, 2, '#d83030');
    },
    flower: (cx, cy) => {
      ui.rect(cx, cy + 1, 1, 6, '#38b070');
      ui.rect(cx + 1, cy + 4, 3, 1, '#38b070'); ui.rect(cx - 3, cy + 3, 3, 1, '#38b070');
      for (const [dx, dy] of [[0, -4], [0, 0], [-2, -2], [2, -2]] as const) ui.rect(cx + dx - 1, cy + dy - 1, 3, 3, '#e86aa0');
      ui.rect(cx - 1, cy - 3, 3, 3, '#ffd23a');
    },
    wind: (cx, cy) => {
      const c = '#bfefff';
      ui.rect(cx - 6, cy - 4, 9, 1, c); ui.rect(cx + 3, cy - 5, 2, 1, c); ui.rect(cx + 5, cy - 4, 1, 2, c); ui.rect(cx + 3, cy - 2, 2, 1, c);
      ui.rect(cx - 6, cy, 12, 1, c); ui.rect(cx + 6, cy - 1, 1, 3, c); ui.rect(cx + 3, cy + 2, 3, 1, c);
      ui.rect(cx - 6, cy + 4, 7, 1, c); ui.rect(cx + 1, cy + 3, 2, 1, c); ui.rect(cx + 3, cy + 4, 1, 2, c); ui.rect(cx + 1, cy + 6, 2, 1, c);
    },
    pickup: (cx, cy) => {
      ui.rect(cx - 5, cy + 1, 11, 6, '#1a1a22');
      ui.rect(cx - 4, cy + 2, 9, 4, '#b8803c');
      ui.rect(cx - 4, cy + 3, 9, 1, '#e8c080');
      ui.rect(cx, cy - 6, 1, 6, '#f0f0f6');
      ui.rect(cx - 1, cy - 5, 3, 1, '#f0f0f6'); ui.rect(cx - 2, cy - 4, 5, 1, '#f0f0f6');
    },
    loadstate: (cx, cy) => {
      ui.rect(cx - 6, cy - 6, 13, 13, '#1a1a22');
      ui.rect(cx - 5, cy - 5, 11, 11, '#3a5ac8');
      ui.rect(cx - 3, cy - 5, 7, 4, '#b8c0c8');
      ui.rect(cx + 1, cy - 4, 2, 2, '#1a1a22');
      ui.rect(cx - 4, cy + 0, 9, 6, '#f0f0f6');
      ui.rect(cx - 3, cy + 2, 7, 1, '#b8c0d0'); ui.rect(cx - 3, cy + 4, 5, 1, '#b8c0d0');
    },
  };
}

/** Draws the icon of a tool (the four of v5 and the ten of v6) at (cx, cy). Throws for an unknown tool. */
export function toolIcons(ui: Ui): (tool: string, cx: number, cy: number) => void {
  const I = gameIcons(ui);
  const known: Record<string, Icon> = { shovel: I.shovel, rail: I.rail, bulldozer: I.bulldozer, scissors: I.scissors, ...v6Icons(ui) };
  return (tool, cx, cy) => {
    const f = known[tool];
    if (!f) throw new Error(`editor: no icon for tool "${tool}"`);
    f(cx, cy);
  };
}
