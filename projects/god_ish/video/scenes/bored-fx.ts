// Plate 6 · Bored: the moving parts of the chat (v4). Reactions that burst, stickers, typos with a red squiggle.
// All of them are set dressing (rule 6) and pure functions of t and seeded hashes.
import { hash, roundRectFill, stepN } from '@pve/engine/util';
import { fnt, RED, SANS, tone } from './_page';

/** The type step. */
export const FPS = 24;
/** Steps (24 fps) from an onset to t; negative before it. */
export const age = (t: number, at: number) => stepN(t, FPS) - stepN(at, FPS);

/** Reactions: a glyph and a count. 神 reacts in red. All glyphs are in the Noto Sans JP subset. */
export const PILLS: { g: string; red?: boolean }[] = [
  { g: '神', red: true }, { g: 'ｗ' }, { g: '？' }, { g: '眠' }, { g: '飽' }, { g: '(^^)' }, { g: '!!' }, { g: '+1' },
];
/** Stickers (kaomoji) that pop in the free right side of the list. */
export const KAOS = [
  '(^_^)', 'ヽ(°〇°)ノ', '(・_・)', '(-_-)zzz', '(>_<)', '(^^;)', 'ｗｗｗ', 'orz', '(×_×)', '(゜ロ゜)', '(・△・)', '！？',
];
/** What you type into the input bar on the hats (and delete on the kicks). */
export const SPAM = 'ｗｗｗ？！^・ノ神眠飽ｗ…';
const KANJI = '神紙髪上眠飽踊言味意何夢愛死心音';
/** The reactions that pop on the hats. */
export const HATS = ['ｗ', '！', '？', '神', '眠', '飽', '^^', 'ｗｗ', '…', 'ノ', '(^^)', '+1', '！？'];

/** A wrong glyph for a unit: a kana next to it in the table, or another kanji of the song. */
export function typo(g: string, h: number): string {
  const code = g.charCodeAt(0);
  const step = 1 + Math.floor(h * 3);
  if (code >= 0x3041 && code <= 0x3093) return String.fromCharCode(0x3041 + ((code - 0x3041 + step) % 83));
  if (code >= 0x30a1 && code <= 0x30f4) return String.fromCharCode(0x30a1 + ((code - 0x30a1 + step) % 84));
  return KANJI[Math.floor(h * KANJI.length)]!;
}

/** A red spell-check squiggle under [x, x + w] at baseline y. */
export function squiggle(c: CanvasRenderingContext2D, x: number, y: number, w: number) {
  c.strokeStyle = RED;
  c.lineWidth = 3;
  c.beginPath();
  for (let k = 0, px = x; px <= x + w; k++, px += 6) {
    if (k === 0) c.moveTo(px, y);
    else c.lineTo(px, y + (k % 2 ? 5 : 0));
  }
  c.stroke();
}

/** How long a super-reaction burst lives, s, and how much of that it fades out in at the end. */
export const SPRAY_LIFE = 0.6;
const SPRAY_FADE = 0.3;

/**
 * A super-reaction burst: n copies of the reaction glyph fly right out of its pill and fall, at 12 fps, for dt
 * seconds since the kick (0 .. SPRAY_LIFE), and fade out over the last SPRAY_FADE (on every 24 fps step, not in
 * 12 fps steps, so that they do not cut out). A "+add" label rises over the pill.
 */
export function spray(
  c: CanvasRenderingContext2D, g: string, red: boolean, x: number, y: number, dt: number, seed: number, n: number,
  add: number,
) {
  const a = Math.floor(dt * 12) / 12;
  c.save();
  c.globalAlpha = Math.max(0, Math.min(1, (SPRAY_LIFE - dt) / SPRAY_FADE));
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const vx = 260 + hash(seed, i, 1) * 820;
    const vy = -320 + hash(seed, i, 2) * 300;
    const px = x + vx * a;
    const py = y + vy * a + 1300 * a * a;
    const s = (54 + hash(seed, i, 3) * 56) * (a === 0 ? 1.25 : 1);
    c.save();
    c.translate(px, py);
    c.rotate((hash(seed, i, 4) - 0.5) * 2.4 * a);
    c.font = fnt(SANS, s, 700);
    c.fillStyle = red && hash(seed, i, 5) < 0.6 ? RED : tone(0.95 - a * 0.5);
    c.fillText(g, 0, 0);
    c.restore();
  }
  c.font = fnt(SANS, 34, 700);
  c.fillStyle = tone(0.97);
  c.fillText(`+${add}`, x, y - 44 - a * 90);
  c.restore();
}

/** A kaomoji sticker: a gray chip, popping at 1.5x on its first step, turned by rot. */
export function sticker(c: CanvasRenderingContext2D, text: string, x: number, y: number, a: number, rot: number) {
  const s = a === 0 ? 1.5 : a === 1 ? 1.15 : 1;
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.scale(s, s);
  c.font = fnt(SANS, 72, 700);
  const w = c.measureText(text).width;
  c.fillStyle = a === 0 ? tone(0.95) : tone(0.33);
  roundRectFill(c, -w / 2 - 28, -58, w + 56, 116, 28);
  c.fillStyle = a === 0 ? tone(0.08) : tone(0.96);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, 0, 2);
  c.restore();
}
