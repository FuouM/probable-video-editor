// The atlas cells of the room kit (`_home.ts`): the surfaces of the room, the cells of the town, and the pictures on the walls.
// `paintRoomCells` paints them all in one fixed order (the order of the atlas cells must not change).
import { mulberry32 } from '@pve/engine/util';
import type { Cell, Painter } from '@pve/engine/lit';
import type { RoomKit } from './_homeKit';

const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '001', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
  ':': ['0', '1', '0', '1', '0'],
};

/** Draws `text` (digits and colon) in a 3x5 face, each pixel an n x n block. (x, y) is the top left, y down. */
function digits(p: Painter, text: string, x: number, y: number, c: string, n = 1, emit = 0): number {
  for (const ch of text) {
    const g = DIGITS[ch];
    if (!g) continue;
    g.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '1') p.rect(x + i * n, p.cell.h - (y + (j + 1) * n), n, n, c, emit);
    });
    x += (g[0]!.length + 1) * n;
  }
  return x;
}
const digitsWidth = (text: string, n = 1) => [...text].reduce((w, ch) => w + ((DIGITS[ch]?.[0]?.length ?? 0) + 1) * n, 0) - n;

function circle(p: Painter, cx: number, cy: number, r: number, c: string) {
  const steps = Math.ceil(r * 8);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    p.px(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), c);
  }
}

/** The default calendar picture: a paddy field under hills, 92 x 60 texels. */
function paintPaddy(p: Painter) {
  const w = p.cell.w, h = p.cell.h;
  const rnd = mulberry32(11);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c: string;
      const ridge1 = 38 + 6 * Math.sin(x * 0.11 + 1) + 3 * Math.sin(x * 0.29);
      const ridge2 = 33 + 4 * Math.sin(x * 0.17 + 4) + 2 * Math.sin(x * 0.41);
      if (y >= ridge1) c = y > 48 ? '#8ab4e0' : y > 42 ? '#a8c8e4' : '#d6dcd0';
      else if (y >= ridge2) c = '#5d7f6a';
      else if (y >= 27) c = '#46685a';
      else {
        const band = Math.floor(Math.pow(27 - y, 0.8) / 1.6);
        c = band % 3 === 2 ? '#8cb4c4' : band % 2 ? '#8ab84a' : '#9cc45a';
      }
      p.px(x, y, c);
    }
  }
  for (let i = 0; i < 40; i++) p.px(Math.floor(rnd() * w), Math.floor(rnd() * 26), '#a8d070');
  // sun, farmhouse, trees
  for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) if (x * x + y * y <= 14) p.px(66 + x, 49 + y, '#fff0b0');
  p.rect(22, 27, 9, 5, '#e8e0d0');
  for (let i = 0; i < 5; i++) p.rect(21 + i, 32 + i, 11 - 2 * i, 1, '#5a4a48');
  p.rect(25, 27, 2, 3, '#4a3a38');
  for (const x of [10, 14, 36, 80]) { p.rect(x, 27, 3, 4, '#2c4a38'); p.rect(x + 1, 31, 1, 2, '#4a3a2a'); }
  // frame
  for (let x = 0; x < w; x++) { p.px(x, 0, '#f4efe2'); p.px(x, h - 1, '#f4efe2'); p.px(x, 1, '#f4efe2'); p.px(x, h - 2, '#f4efe2'); }
  for (let y = 0; y < h; y++) { p.px(0, y, '#f4efe2'); p.px(w - 1, y, '#f4efe2'); }
}

/** Paints every cell of the room into `kit.cells`. */
export function paintRoomCells(kit: RoomKit) {
  paintSurfaces(kit);
  paintTownCells(kit);
  paintWallCells(kit);
}

/** The surfaces of the room, its furniture, the cardboard, and the glass of the balcony door. */
function paintSurfaces(kit: RoomKit) {
  const A = kit.atlas, c = kit.cells;
  const L = (n: string, cell: Cell, map?: 'tile' | 'fit') => { c[n] = kit.face(cell, map); };
  L('tatami', A.paint(8, 8, (p) => {
    for (let y = 0; y < 8; y++) p.rect(0, y, 8, 1, y % 2 ? '#7f8c4c' : '#76834a');
    p.speckle('#8c9858', 0.18, 3); p.speckle('#6c7840', 0.12, 5);
  }));
  L('tatamiSide', A.paint(4, 4, (p) => { p.fill('#5a6638'); p.speckle('#4e5a30', 0.3, 2); }));
  L('plaster', A.paint(16, 16, (p) => { p.fill('#aaa6ae'); p.speckle('#a4a0a8', 0.2, 4); p.speckle('#b0acb4', 0.08, 6); }));
  L('ceiling', A.paint(16, 16, (p) => { p.fill('#cfc7bb'); p.speckle('#c4bcb0', 0.15, 8); p.rect(0, 0, 16, 1, '#bdb5a8'); p.rect(0, 0, 1, 16, '#bdb5a8'); }));
  L('wood', A.paint(8, 8, (p) => { p.fill('#8a5a34'); for (const y of [1, 4, 6]) p.rect(0, y, 8, 1, y === 4 ? '#946238' : '#7e5230'); p.speckle('#704828', 0.1, 3); }));
  L('woodDark', A.paint(8, 8, (p) => { p.fill('#4c3222'); p.rect(0, 2, 8, 1, '#42291b'); p.rect(0, 5, 8, 1, '#56382a'); }));
  L('metal', A.paint(4, 4, (p) => { p.fill('#8a8e96'); p.rect(0, 0, 4, 1, '#a0a4ac'); }));
  L('rail', A.paint(4, 4, (p) => { p.fill('#4d3b33'); p.rect(0, 3, 4, 1, '#5e4a40'); }));
  L('conc', A.paint(16, 16, (p) => { p.fill('#7b7882'); p.speckle('#6e6b76', 0.25, 3); p.speckle('#88858e', 0.1, 5); p.rect(0, 0, 16, 1, '#625f6a'); p.rect(0, 0, 1, 16, '#625f6a'); }));
  L('outer', A.paint(16, 16, (p) => { p.fill('#8a8490'); p.speckle('#7c7684', 0.25, 9); }));
  L('soil', A.paint(8, 8, (p) => { p.fill('#3b2619'); p.speckle('#2e1d12', 0.3, 4); p.speckle('#4a3222', 0.2, 6); }));
  L('planter', A.paint(8, 8, (p) => { p.fill('#5a3424'); p.rect(0, 0, 8, 1, '#4a2a1c'); p.rect(0, 4, 8, 1, '#4e2e20'); p.speckle('#684030', 0.15, 2); }));
  L('cloth', A.paint(8, 8, (p) => { p.fill('#a8693c'); for (const x of [1, 4, 6]) p.rect(x, 0, 1, 8, x === 4 ? '#b87848' : '#985a32'); }));
  L('blanket', A.paint(16, 16, (p) => {
    p.fill('#2a3470');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y) % 8 === 0 || (x - y + 16) % 8 === 0) p.px(x, y, '#4a64b0');
    p.speckle('#242c60', 0.15, 3);
  }));
  L('futon', A.paint(16, 16, (p) => { p.fill('#c8d2dc'); for (const y of [0, 4, 8, 12]) p.rect(0, y, 16, 1, '#b4c2d2'); p.speckle('#bcc8d4', 0.12, 4); }));
  L('duvet', A.paint(16, 16, (p) => { p.fill('#7a98a8'); for (let y = 2; y < 16; y += 4) for (let x = (y / 4) % 2 ? 0 : 2; x < 16; x += 4) p.px(x, y, '#c8dce0'); p.speckle('#6e8c9c', 0.15, 5); }));
  L('pillow', A.paint(8, 8, (p) => { p.fill('#e8e4dc'); p.speckle('#d8d4c8', 0.2, 3); }));
  L('zabuton', A.paint(8, 8, (p) => { p.fill('#4a5a3a'); p.rect(0, 0, 8, 1, '#7a8a5a'); p.rect(0, 0, 1, 8, '#7a8a5a'); p.speckle('#5a6a46', 0.2, 2); }));
  L('plastic', A.paint(8, 8, (p) => { p.fill('#7c7e8a'); p.speckle('#70727e', 0.2, 2); p.speckle('#868894', 0.1, 4); }));
  L('plasticDark', A.paint(8, 8, (p) => { p.fill('#6a6c76'); p.speckle('#5e606a', 0.2, 5); }));
  L('bezelBottom', A.paint(64, 9, (p) => {
    p.fill('#aeb1b9'); p.rect(0, 8, 64, 1, '#c0c3ca');
    for (let x = 6; x < 26; x += 2) p.rect(x, 2, 1, 5, '#8a8d96');
    p.rect(42, 3, 5, 3, '#5e606a'); p.rect(50, 3, 5, 3, '#5e606a'); p.rect(58, 4, 2, 2, '#ff3a28', 3);
  }));
  L('drawers', A.paint(64, 29, (p) => {
    p.fill('#8a5a34');
    for (const x0 of [3, 33]) {
      p.rect(x0, 3, 28, 22, '#4c3222'); p.rect(x0 + 1, 4, 26, 20, '#9a6a40');
      p.rect(x0 + 8, 9, 12, 2, '#c8c0a8'); p.rect(x0 + 8, 8, 12, 1, '#5a4a38');
    }
    p.speckle('#7e5230', 0.1, 6);
  }, ), 'fit');
  L('orange', A.solid('#e8831a'));
  L('orangeDark', A.solid('#c8620c'));
  L('cream', A.solid('#e8e0cc'));
  L('white', A.solid('#d8d4cc'));
  L('ceramic', A.paint(8, 8, (p) => { p.fill('#d8d0c0'); p.rect(0, 5, 8, 1, '#3a5a9a'); p.rect(0, 6, 8, 1, '#3a5a9a'); }));
  L('tea', A.solid('#5a7a30'));
  L('black', A.solid('#1c1c22'));
  L('grey', A.solid('#4a4c56'));
  L('led', A.solid('#ff3a28', 3));
  L('lampOn', A.solid('#fff2c8', 5));
  L('lampOff', A.solid('#d8d0c0'));
  L('lampRim', A.solid('#8a8480'));
  L('navy', A.solid('#3a4668'));
  L('tape', A.solid('#d6bc80'));
  L('red', A.solid('#b02828'));
  L('boardIn', A.paint(8, 8, (p) => { p.fill('#6a4a2a'); p.speckle('#5a3e22', 0.25, 3); p.speckle('#7a5732', 0.1, 6); }));
  // cardboard: the side, the top with the tape, and the labelled fronts made on demand
  L('board', A.paint(8, 8, (p) => { p.fill('#b48850'); p.speckle('#a67a44', 0.2, 3); p.speckle('#c29860', 0.12, 6); p.rect(0, 0, 8, 1, '#9a6c38'); }));
  L('boardTop', A.paint(24, 24, (p) => {
    p.fill('#b48850'); p.speckle('#a67a44', 0.2, 3); p.speckle('#c29860', 0.12, 6);
    p.rect(9, 0, 6, 24, '#d6bc80'); p.rect(9, 0, 1, 24, '#c0a468'); p.rect(14, 0, 1, 24, '#c0a468');
  }), 'fit');
  // the glass of the balcony door, stretched once over the pane: two faint reflections, the rest clear
  L('glass', A.paint(24, 64, (p) => {
    for (let y = 8; y < 58; y++) p.rect(Math.round(2 + (y - 8) * 0.34), y, 1, 1, '#4a5a80', 0.12);
    for (let y = 6; y < 34; y++) p.rect(Math.round(14 + (y - 6) * 0.3), y, 1, 1, '#4a5a80', 0.12);
  }), 'fit');
}

/** The cells of the town: the windows, the roofs and walls, the ground, the hills, the poles. */
function paintTownCells(kit: RoomKit) {
  const A = kit.atlas, c = kit.cells;
  const L = (n: string, cell: Cell) => { c[n] = kit.face(cell); };
  L('winDark', A.solid('#222c40'));
  L('winWarm', A.solid('#ffcc66', 3.5));
  L('winCool', A.solid('#9ec0ff', 3));
  L('winPale', A.solid('#ffe8b0', 3.5));
  L('roofA', A.solid('#3a3a4a'));
  L('roofB', A.solid('#6a3a30'));
  L('roofC', A.solid('#3a5a50'));
  L('wallA', A.solid('#d8d0c0'));
  L('wallB', A.solid('#a8a8b0'));
  L('wallC', A.solid('#c8b080'));
  L('wallD', A.solid('#c0c8c0'));
  L('ground', A.paint(8, 8, (p) => { p.fill('#2a3028'); p.speckle('#242a22', 0.3, 3); }));
  L('road', A.paint(8, 8, (p) => { p.fill('#3a3a40'); p.speckle('#34343a', 0.3, 5); }));
  L('hillA', A.paint(8, 8, (p) => { p.fill('#2c3a44'); p.speckle('#26343e', 0.3, 2); }));
  L('hillB', A.paint(8, 8, (p) => { p.fill('#3a4a50'); p.speckle('#34444a', 0.3, 4); }));
  L('hillC', A.paint(8, 8, (p) => { p.fill('#4a5a62'); p.speckle('#44545c', 0.3, 6); }));
  L('leaf', A.solid('#1e3a2a'));
  L('pole', A.solid('#3a2c26'));
  L('wire', A.solid('#14141a'));
  L('lampPost', A.solid('#ffd890', 5));
}

/** The picture of the calendar and the cells of the wall decor. */
function paintWallCells(kit: RoomKit) {
  const A = kit.atlas, c = kit.cells;
  c.paddy = kit.face(A.paint(92, 60, paintPaddy), 'fit');
  const kana = kit.kana, latin = kit.latin;
  // month page: 92 x 96, NOV 2026 (the 1st is a Sunday), the 3rd circled, 引越し in red under the grid
  c.month = kit.face(A.paint(92, 96, (p) => {
    p.fill('#ece6d4');
    p.rect(0, 82, 92, 14, '#b02828');
    latin.draw(p.sink({ 1: '#f4efe2' }), 'NOV 2026', 22, 11, 1);
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    days.forEach((d, i) => latin.draw(p.sink({ 1: i === 0 ? '#b02828' : i === 6 ? '#2c4c9a' : '#3a3a42' }), d, 4 + i * 12, 20, 1));
    for (let d = 1; d <= 30; d++) {
      const idx = d - 1, col = idx % 7, row = Math.floor(idx / 7);
      const text = String(d);
      const x = 3 + col * 12 + Math.round((12 - digitsWidth(text)) / 2);
      digits(p, text, x, 25 + row * 11, col === 0 ? '#b02828' : col === 6 ? '#2c4c9a' : '#2a2a30');
    }
    circle(p, 3 + 2 * 12 + 6, p.cell.h - 1 - (25 + 2) , 6.5, '#d02020');
    circle(p, 3 + 2 * 12 + 6, p.cell.h - 1 - (25 + 2), 5.5, '#d02020');
    kana.draw(p.sink({ 1: '#c02020' }), '引越し', 22, 91, 1);
  }), 'fit');
  // the tear-off pad: NOV, a big 3, the weekday
  c.pad = kit.face(paintPage(kit, 3), 'fit');
  // the sign: two lines of kana on cream paper
  c.sign = kit.face(A.paint(124, 40, (p) => {
    p.fill('#e6dfc8'); p.rect(0, 0, 124, 1, '#c8c0a4'); p.rect(0, 39, 124, 1, '#c8c0a4');
    kana.draw(p.sink({ 1: '#26262c' }), 'あしたのことは', 6, 16, 1);
    kana.draw(p.sink({ 1: '#26262c' }), 'しっている', 6, 34, 1);
  }), 'fit');
  // the wall clock (round, clear corners)
  c.clock = kit.face(A.paint(26, 26, (p) => {
    for (let y = 0; y < 26; y++) for (let x = 0; x < 26; x++) {
      const d = Math.hypot(x - 12.5, y - 12.5);
      if (d <= 12.5) p.px(x, y, d > 10.8 ? '#3a3a44' : '#e8e4d8');
    }
    for (const [x, y] of [[12, 22], [12, 3], [3, 12], [22, 12]] as const) p.rect(x, y, 2, 2, '#26262c');
    for (let i = 0; i < 9; i++) p.px(13, 13 + i * 0 + (i < 7 ? i : 0), '#26262c');
    for (let i = 0; i < 6; i++) p.px(13 - i, 13, '#26262c');
  }), 'fit');
  // the alarm clock face, red digits
  c.alarm = kit.face(A.paint(20, 9, (p) => { p.fill('#14080a'); digits(p, '4:58', 2, 2, '#ff3a28', 1, 4); }), 'fit');
  // torn pages: four variants of the page of day 3 (火), as in the treatment every page shows the same date
  for (let i = 0; i < 4; i++) c[`page${i}`] = kit.face(paintPage(kit, 3, i), 'fit');
}

/** A tear-off page 44 x 60: red head, the month, a big day number, the weekday. */
function paintPage(kit: RoomKit, day: number, variant = 0): Cell {
  return kit.atlas.paint(44, 60, (p) => {
    p.fill('#ece6d4'); p.speckle('#e0d8c4', 0.1, day + 3 + variant * 17);
    p.rect(0, 52, 44, 8, '#b02828');
    kit.latin.draw(p.sink({ 1: '#f4efe2' }), 'NOV', 14, 7, 1);
    const text = String(day), n = 5;
    digits(p, text, Math.round((44 - digitsWidth(text, n)) / 2), 13, '#26262c', n);
    kit.kana.draw(p.sink({ 1: '#b02828' }), '火', 14, 56, 1);
  });
}
