// thumbnail: the cover of the upload, not a clip of the video (video.json does not name it). Rendered with
// `bun run pve board video/scenes/thumbnail.ts -p sardine --out projects/sardine/out/thumbnail.png`.
// The train of the intro (`Ride.cover`: the picture of the car with no part of the program over it). The sardine comes up into the
// frame from the bottom left corner, close to the lens and large: it is the subject. A jellyfish from the rest of the video sits on
// the seat. The logo is over the picture: three words in three colours, as on the box of a game.
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { NO_FILM_POST } from '@pve/engine/post';
import { Compositor, FSPass, makeRT } from '@pve/engine/gl';
import { LH, LW } from '@pve/engine/lit';
import { hashSin } from '@pve/engine/util';
import { TextLayer } from '@pve/engine/textlayer';
import { Mask, type Pixels } from '@pve/engine/type';
import { Ui } from '@pve/engine/ui';
import { loadFonts, type Fonts } from './_fonts';
import { drawCursor } from './_playerChrome';
import { Fish } from './_fish';
import { Jellyfish, screenPoint } from './_jelly';
import type { GameWorld } from './_gameWorld';
import Ride from './ride';

/** The time of the intro that the picture shows. */
const T = 11.6;
/**
 * The sardine of the cover, in the 640 x 360 frame: its tail is out of the frame past the bottom left corner, its nose is left of
 * the middle under the logo. Each end: x, y (px) and how far from the eye (m). The tail is nearer, so the fish is seen from below.
 */
const HERO = { tail: [-96, 446, 0.5], nose: [222, 160, 1.0] } as const;
/** A soft light for the sardine only: its colour, its strength, where its light ends (m), and how far it stands from the sardine toward the eye (m). */
const FILL = { colour: '#fff4e0', power: 0.3, range: 2.0, reach: 0.5 } as const;
/** The jellyfish on the seat: where it is in the 640 x 360 frame (x, y), how far from the eye (m), and its size. */
const JELLY = [536, 214, 2.3, 0.5] as const;
/** A warm light over the middle of the seat: where it is in the frame (x, y), how far from the eye (m), its strength and where its light ends (m). */
const GLOW = { at: [392, 226, 2.1], colour: '#fff4e0', power: 1.2, range: 3 } as const;
/** The cursor of the game on the logo: the place of its tip (px) and its size (a whole number of times the cursor of the game). */
const CURSOR = { x: 546, y: 122, n: 3 } as const;

/**
 * The colours of the logo, as indices of the sink. Each word has four bands from the top down and a dark line round its type: the cyan
 * of the game's windows (the sardine), the amber of its lamps (the soil) and the magenta of its missing texture (the growth).
 */
const INK = {
  shadow: 1, navy: 2, white: 3, gold: 4, sleeper: 5, leaf: 6, leafDark: 7,
  fish: [10, 11, 12, 13, 14], soil: [20, 21, 22, 23, 24], grow: [30, 31, 32, 33, 34],
} as const;
/** The colours as they look on screen. The fifth tone of a word is its line. */
const SHOWN: Record<number, string> = {
  1: '#02030a', 2: '#0a0a2e', 3: '#ffffff', 4: '#ffe45a', 5: '#ffb81e', 6: '#7af04a', 7: '#1c8a2c',
  10: '#eaffff', 11: '#7aeaff', 12: '#1cc0ff', 13: '#1672ec', 14: '#0a2c8a',
  20: '#fffbd0', 21: '#ffe24a', 22: '#ffae14', 23: '#ff6a10', 24: '#8a2a04',
  30: '#ffe4fa', 31: '#ff86ea', 32: '#ff30cc', 33: '#c414a4', 34: '#5a0650',
};
/** The linear value of a colour: the logo goes over the finished frame, which is linear light. */
const lin = (c: string) => `#${new THREE.Color(c).getHexString(THREE.LinearSRGBColorSpace)}`;
const INKS: Record<number, string> = Object.fromEntries(Object.entries(SHOWN).map(([k, c]) => [k, lin(c)]));

/** The 4 x 4 Bayer matrix (0..15): the fade of the shade is an ordered dither, as the picture has. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** The picture behind the logo is darker: in full to the row `SHADE.full`, then it fades out over `SHADE.fade` rows. */
const SHADE = { full: 152, fade: 32, alpha: 0.5 } as const;

/**
 * A word of the logo with its pen at x and its baseline at y: a dark shadow, a navy border, a white rim, a line in the dark tone of
 * the word, the type in four bands of colour (the light one on top), and a shine: two white strokes that cross the type at an angle.
 * Returns the pen x after the word.
 */
function word(sink: Pixels, fonts: Fonts, s: string, n: number, x: number, y: number, tones: readonly number[]): number {
  const ink = Mask.text(fonts.kana, s, n), line = ink.grow(1), rim = line.grow(2), border = rim.grow(2);
  border.draw(sink, x + 3, y + 4, INK.shadow);
  border.draw(sink, x, y, INK.navy);
  rim.draw(sink, x, y, INK.white);
  line.draw(sink, x, y, tones[4]!);
  const top = y + ink.y0;
  for (let k = 0; k < 4; k++) ink.draw(sink, x, y, tones[k]!, (_px, py) => Math.min(3, Math.floor(((py - top) * 4) / ink.h)) === k);
  // the shine: a wide stroke and a thin one, at 45 degrees, a third of the way along the word
  const at = x + ink.x0 + Math.round(ink.w * 0.34) + ink.h;
  ink.draw(sink, x, y, INK.white, (px, py) => { const d = px + (py - top) - at; return (d >= 0 && d < 2 * n) || (d >= 3 * n && d < 4 * n); });
  return x + ink.adv;
}

/** A glint: a cross of four points with a bright middle, `r` px long, at (cx, cy). */
function glint(l: TextLayer, cx: number, cy: number, r: number, c: string) {
  l.rect(cx - r, cy, 2 * r + 1, 1, c);
  l.rect(cx, cy - r, 1, 2 * r + 1, c);
  if (r >= 3) l.rect(cx - 1, cy - 1, 3, 3, c);
  if (r >= 5) for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) l.rect(cx + dx, cy + dy, 1, 1, c);
}

/** A sprout with its foot at (x, y): a stem and two leaves with a dark edge. */
function sprout(l: TextLayer, x: number, y: number) {
  const parts: [number, number, number, number][] = [[0, -11, 2, 11], [-8, -15, 8, 4], [-6, -17, 5, 2], [2, -19, 9, 4], [4, -21, 6, 2]];
  for (const [dx, dy, w, h] of parts) l.rect(x + dx - 1, y + dy - 1, w + 2, h + 2, INKS[INK.navy]!);
  for (const [dx, dy, w, h] of parts) l.rect(x + dx, y + dy, w, h, INKS[INK.leaf]!);
  l.rect(x - 7, y - 12, 6, 1, INKS[INK.leafDark]!);
  l.rect(x + 3, y - 16, 7, 1, INKS[INK.leafDark]!);
}

/** A piece of track from x0 to x1 with its top at y: two rails on sleepers, and an arrow head at each end (the arrow of a station board). */
function track(l: TextLayer, x0: number, x1: number, y: number) {
  l.rect(x0 - 2, y - 2, x1 - x0 + 4, 11, INKS[INK.navy]!);
  for (let x = x0 + 8; x < x1 - 8; x += 7) l.rect(x, y, 3, 7, INKS[INK.sleeper]!);
  l.rect(x0, y + 1, x1 - x0, 1, INKS[INK.white]!);
  l.rect(x0, y + 5, x1 - x0, 1, INKS[INK.white]!);
  for (let k = 0; k < 7; k++) {
    for (const [x, s] of [[x0 - 4 - k, 1], [x1 + 3 + k, 1]] as const) {
      l.rect(x - s, y + 3 - (6 - k) - 1, 3, 2 * (6 - k) + 3, INKS[INK.navy]!);
    }
  }
  for (let k = 0; k < 6; k++) {
    l.rect(x0 - 4 - k, y + 3 - (5 - k), 1, 2 * (5 - k) + 1, INKS[INK.white]!);
    l.rect(x1 + 3 + k, y + 3 - (5 - k), 1, 2 * (5 - k) + 1, INKS[INK.white]!);
  }
}

/** The glints round the logo: x, y, the length of a point (px). */
const GLINTS: readonly (readonly [number, number, number])[] = [
  [70, 22, 5], [84, 60, 2], [56, 104, 3], [78, 144, 2], [322, 8, 2], [470, 12, 3], [574, 26, 5], [560, 74, 2], [588, 112, 3], [566, 150, 2],
  [248, 90, 2], [44, 150, 2], [600, 60, 2], [30, 44, 3],
];

/** The arrow cursor of the game, `n` times as large, with its tip at (x, y), and the ticks of a click round the tip. */
function cursor(l: TextLayer, fonts: Fonts, x: number, y: number, n: number) {
  // the cursor at its own size on a layer of its own, then each of its pixels as a block
  const one = new TextLayer(), S = 24;
  drawCursor(new Ui(one, fonts.latin), 2, 2, null);
  for (let v = 0; v < S; v++) {
    for (let u = 0; u < S; u++) {
      const o = ((LH - 1 - v) * LW + u) * 4, d = one.data;
      if (d[o + 3]! === 0) continue;
      l.rect(x + (u - 2) * n, y + (v - 2) * n, n, n, lin(`#${[d[o]!, d[o + 1]!, d[o + 2]!].map((b) => b.toString(16).padStart(2, '0')).join('')}`));
    }
  }
  one.dispose();
  for (const [dx, dy, w, h] of [[-9, -3, 6, 2], [-3, -9, 2, 6], [-8, -8, 3, 3]] as const) l.rect(x + dx, y + dy, w, h, INKS[INK.gold]!);
}

/**
 * The logo: イワシが and つちから in the first row, はえてくるんだ under them, in the middle of the width of the frame. A sprout grows out
 * of つちから, a piece of track lies under the logo, the cursor of the game clicks the last glyph, glints stand round it, and motes of
 * light drift over the whole picture.
 */
function logoLayer(fonts: Fonts): TextLayer {
  const l = new TextLayer(), sink = l.sink(INKS);
  for (let y = 0; y < SHADE.full + SHADE.fade; y++) {
    const k = y < SHADE.full ? 16 : Math.round(16 * (1 - (y - SHADE.full) / SHADE.fade));
    for (let x = 0; x < LW; x++) if (BAYER[(y % 4) * 4 + (x % 4)]! < k) l.rect(x, y, 1, 1, '#000000', SHADE.alpha);
  }
  // the motes: small and faint low in the frame, more of them near the logo
  for (let i = 0; i < 90; i++) {
    const x = Math.round(hashSin(i, 1) * LW), y = Math.round(hashSin(i, 2) ** 1.6 * LH), big = hashSin(i, 3) < 0.25;
    const c = INKS[hashSin(i, 4) < 0.5 ? INK.gold : hashSin(i, 4) < 0.8 ? INK.white : INK.fish[1]]!;
    l.rect(x, y, big ? 2 : 1, big ? 2 : 1, c, 0.45 + 0.5 * hashSin(i, 5));
  }
  sprout(l, 386, 28);
  const pen = word(sink, fonts, 'イワシが', 4, 92, 66, INK.fish);
  word(sink, fonts, 'つちから', 3, pen + 10, 66, INK.soil);
  word(sink, fonts, 'はえてくるんだ', 4, 96, 136, INK.grow);
  track(l, 112, 528, 154);
  GLINTS.forEach(([x, y, r], i) => glint(l, x, y, r, INKS[i % 3 === 2 ? INK.gold : INK.white]!));
  cursor(l, fonts, CURSOR.x, CURSOR.y, CURSOR.n);
  l.commit();
  return l;
}

/**
 * The grade of the cover: the picture of the car is a calm night scene under yellow lamps, and the cover must stand out in a list.
 * The yellow cast of the lamps goes (the walls are cream, not ochre), the dark parts go to night blue, and the whole picture gets
 * more light. The colours of the logo are then the strong colours of the cover.
 */
const GRADE_FRAG = /* glsl */ `
uniform sampler2D uSrc;
void main() {
  vec3 c = texture(uSrc, vUv).rgb;
  // the white balance: against the yellow of the lamps
  c *= vec3(0.9, 1.0, 1.42);
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(lum), c, 1.35), 0.0);
  // contrast: the dark parts go down, the bright parts keep their light
  c = pow(c, vec3(1.3)) * 2.3;
  fragColor = vec4(c, 1.0);
}`;

export default class Thumbnail extends Scene {
  private ride = new Ride(this.ctx);
  private logo!: TextLayer;
  private over = new Compositor();
  private pic = makeRT();
  private grade = new FSPass(GRADE_FRAG, { uSrc: { value: this.pic.texture } });
  private fill = new THREE.PointLight(FILL.colour, FILL.power, FILL.range);
  private glow = new THREE.PointLight(GLOW.colour, GLOW.power, GLOW.range);
  private jelly: Jellyfish | null = null;

  override async init() {
    await this.ride.init();
    this.logo = logoLayer(await loadFonts(this.ctx.assets));
  }

  /** Makes the picture of the car a cover: the sardine large from the bottom left corner (`HERO`), its light, the jellyfish and the light of the seat. */
  private dress(W: GameWorld, eye: THREE.PerspectiveCamera, sardine: Fish): THREE.Object3D[] {
    const jelly = (this.jelly ??= new Jellyfish(W.atlas, W.mat, { size: JELLY[3] }));
    // the sardine: from the tail point to the nose point, as long as the way between them. It is posed in the frame of its parent (the car)
    const tail = screenPoint(eye, HERO.tail[0], HERO.tail[1], HERO.tail[2]), nose = screenPoint(eye, HERO.nose[0], HERO.nose[1], HERO.nose[2]);
    const mid = tail.clone().lerp(nose, 0.5), parent = sardine.root.parent!;
    const toParent = parent.matrixWorld.clone().invert();
    sardine.pose(T, mid.clone().applyMatrix4(toParent), nose.clone().sub(tail).transformDirection(toParent).multiplyScalar(1.2));
    sardine.root.scale.setScalar(nose.distanceTo(tail) / 0.7);
    this.fill.position.copy(eye.position).sub(mid).setLength(FILL.reach).add(mid);
    jelly.drift(T, screenPoint(eye, JELLY[0], JELLY[1], JELLY[2]));
    this.glow.position.copy(screenPoint(eye, GLOW.at[0], GLOW.at[1], GLOW.at[2]));
    return [this.fill, this.glow, jelly.root];
  }

  render(_f: Frame, out: THREE.WebGLRenderTarget) {
    this.ride.cover(T, this.pic, (W, eye, sardine) => this.dress(W, eye, sardine));
    this.grade.render(this.ctx.renderer, out);
    this.over.draw(this.ctx.renderer, this.logo.tex, out);
    return NO_FILM_POST;
  }

  override dispose() {
    this.ride.dispose();
    this.logo?.dispose();
    this.over.dispose();
    this.pic.dispose();
    this.grade.dispose();
  }
}
