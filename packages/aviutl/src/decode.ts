// Turns the raw ExEdit objects of an Aup into the timeline that pve uses: sprites, texts, groups, frame buffers and audio.
// Only what pve uses is decoded. Everything else is an error that lists each object and what it has that this reader does not know.
import { sjisString, utf16String, type Aup, type AupEffect, type AupObject } from './aup.ts';

/** Blend modes of 標準描画, by the value of its check box. */
export const BLEND_MODES = ['normal', 'add', 'subtract', 'multiply', 'screen', 'overlay', 'lighten', 'darken', 'luminance', 'colorDifference', 'shade', 'lightDark', 'difference'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** Where and how an object draws (標準描画). Position and depth are in project pixels, zoom and rotation as ExEdit shows them. */
export interface Draw {
  x: number;
  y: number;
  z: number;
  /** Percent. 100 = the size of the image. */
  zoom: number;
  /** Percent. 0 = opaque, 100 = invisible (as ExEdit shows it). */
  transparency: number;
  /** Degrees. */
  rotation: number;
  blend: BlendMode;
}

/** The part of an object that every placement has. Frames count from 0, `end` is the last frame (inclusive). */
export interface Placement {
  /** Index of the object in the file. */
  object: number;
  layer: number;
  start: number;
  end: number;
}

/**
 * A picture of one file. A sprite sheet has `cols` x `rows` cells of the same size. The cell on screen at frame `f` is
 * `floor((f - start) / hold + kih) mod (cols * rows)`, counted along the rows. `cols` is the `uro` and `rows` the `mag` of the
 * sprite-sheet script of the object. A plain image has one cell and `kih` 0.
 */
export interface Sprite extends Placement, Draw {
  file: string;
  sheet: { width: number; height: number; cols: number; rows: number; cellWidth: number; cellHeight: number };
  kih: number;
  /** Frames that one cell stays on screen. */
  hold: number;
  /** Scroll: `obj.cx = sign(cx) * floor(|cx| * frame)`, 0 for none. */
  cx: number;
}

export interface TextObject extends Placement, Draw {
  text: string;
  font: string;
  /** Font size in project pixels. */
  size: number;
  /** `#rrggbb`. */
  color: string;
}

/** A group control: moves the layers above it (all of them when `layers` is 0). `outline` is set when the group has the 縁取り effect. */
export interface Group extends Placement, Draw {
  layers: number;
  outline?: { size: number; blur: number; color: string };
}

/** A frame buffer: copies the picture so far, then resizes it. `resize` is in percent. */
export interface FrameBuffer extends Placement, Draw {
  resize: { zoom: number; x: number; y: number };
}

export interface AudioObject extends Placement {
  file: string;
}

/** What `decodeTimeline` returns. All lists are in object order. */
export interface Timeline {
  fps: number;
  size: [number, number];
  frames: number;
  grid: { enabled: boolean; tempo: number; beat: number; offsetFrame: number };
  sprites: Sprite[];
  texts: TextObject[];
  groups: Group[];
  buffers: FrameBuffer[];
  audio: AudioObject[];
  /** Image files that `skip` dropped, with the number of objects dropped. */
  skipped: { file: string; objects: number }[];
}

export interface DecodeOptions {
  /** Pixel size of an image file, or undefined when the file is missing. A missing file is an error (unless the file is in `skip`). */
  imageSize(file: string): { width: number; height: number } | undefined;
  /** Image file names whose objects are left out. */
  skip?: readonly string[];
}

/** The input of the timeline does not decode. `problems` has one line for each cause. */
export class AupDecodeError extends Error {
  override name = 'AupDecodeError';
  constructor(readonly problems: string[]) {
    super(`${problems.length} problem${problems.length === 1 ? '' : 's'} in the aup:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  }
}

/**
 * The sprite-sheet script (`dot_anime_script`) that every sprite object carries, after its three parameter lines.
 * Two lines vary and are read apart from it: the `fs=` line (frames per cell) and an optional `obj.cx=` line (scroll).
 */
export const SPRITE_SCRIPT_TAIL = [
  'bs=uro*mag',
  'fs=',
  'sy=obj.h/mag',
  'sx=obj.w/uro',
  't1,t2=sx/2,sy/2',
  'x0,x1=-t1,t1',
  'y0,y1=-t2,t2',
  'xb0,xb1=(fs%uro)*sx,(fs%uro)*sx+sx',
  'yb0,yb1=math.floor(fs/uro)*sy,math.floor(fs/uro)*sy+sy',
  'obj.drawpoly(x0,y0,0 , x1,y0,0 , x1,y1,0 , x0,y1,0 , xb0,yb0 , xb1,yb0 , xb1,yb1 , xb0,yb1 , 1)',
];

const basename = (s: string) => s.split(/[\\/]/).pop() ?? s;
const hex2 = (n: number) => n.toString(16).padStart(2, '0');
const rgb = (b: Uint8Array) => `#${hex2(b[0]!)}${hex2(b[1]!)}${hex2(b[2]!)}`;
const where = (o: AupObject) => `object ${o.index} (layer ${o.layer}, frames ${o.start}-${o.end})`;

/** What a sprite-sheet script sets: the grid (`mag` rows, `uro` columns), the cell offset `kih`, the frames per cell and the scroll. */
export interface SpriteScript {
  mag: number;
  uro: number;
  kih: number;
  /** Frames that one cell stays (the divisor in `fs=math.floor(obj.frame/hold+kih)%bs`). 1 when the line has none. */
  hold: number;
  /** `obj.cx = sign(cx) * floor(|cx| * frame)`. 0 when the script does not set `obj.cx`. */
  cx: number;
}

/** The sprite-sheet script of an object, or a description of what is wrong with its text. */
export function parseSpriteScript(text: string): SpriteScript | string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  const params: Record<string, number> = {};
  for (const key of ['mag', 'uro', 'kih']) {
    const m = new RegExp(`^${key}=(-?\\d+)$`).exec(lines.shift() ?? '');
    if (!m) return `the script does not start with the parameter line ${key}=<integer>`;
    params[key] = Number(m[1]);
  }
  let hold = 1, cx = 0;
  const body: string[] = [];
  for (const line of lines) {
    const fs = /^fs=(?:\(obj\.frame ?\+kih\)|math\.floor\(obj\.frame\/(\d+) ?\+kih\))%bs$/.exec(line);
    const c = /^obj\.cx=(-?)math\.floor\(obj\.frame\*(\d+(?:\.\d+)?)\)$/.exec(line);
    if (fs) {
      hold = fs[1] ? Number(fs[1]) : 1;
      body.push('fs=');
    } else if (c) {
      cx = Number(c[2]) * (c[1] ? -1 : 1);
    } else body.push(line);
  }
  const differs = body.findIndex((l, i) => l !== SPRITE_SCRIPT_TAIL[i]);
  if (differs >= 0 || body.length !== SPRITE_SCRIPT_TAIL.length) {
    return `the script body is not the sprite-sheet script (first difference: ${JSON.stringify(lines[differs < 0 ? body.length : differs] ?? '(end)')})`;
  }
  const { mag, uro, kih } = params as { mag: number; uro: number; kih: number };
  if (mag < 1 || uro < 1) return `mag=${mag} and uro=${uro} must be at least 1`;
  if (hold < 1) return `the frames per cell must be at least 1`;
  return { mag, uro, kih, hold, cx };
}

/** The Draw of a 標準描画 effect. Tracks that move (mode not 0) and unknown blend modes go to `problems`. */
function drawOf(o: AupObject, e: AupEffect, problems: string[]): Draw {
  const t = e.tracks;
  if (t.some((k) => k.mode !== 0)) problems.push(`${where(o)}: 標準描画 has a moving trackbar (mode ${t.map((k) => k.mode).join(',')}). The reader decodes still values only`);
  const blend = BLEND_MODES[e.checks[0] ?? 0];
  if (!blend) problems.push(`${where(o)}: 標準描画 has blend mode ${e.checks[0]}, which is not known`);
  const v = (i: number) => t[i]?.cur ?? 0;
  return { x: v(0) / 10, y: v(1) / 10, z: v(2) / 10, zoom: v(3) / 100, transparency: v(4) / 10, rotation: v(5) / 100, blend: blend ?? 'normal' };
}

/** Effects an object may have, by the first effect. Anything else is unknown. */
const KNOWN: Record<string, readonly string[]> = {
  画像ファイル: ['スクリプト制御', '標準描画'],
  テキスト: ['標準描画'],
  音声ファイル: ['標準再生'],
  グループ制御: ['縁取り'],
  フレームバッファ: ['リサイズ', '標準描画'],
};

/** Decodes every object of the Aup. Throws AupDecodeError with all the problems when something is unknown. */
export function decodeTimeline(aup: Aup, opts: DecodeOptions): Timeline {
  const problems: string[] = [];
  const tl: Timeline = {
    fps: aup.fps, size: [aup.width, aup.height], frames: aup.frames, grid: aup.grid,
    sprites: [], texts: [], groups: [], buffers: [], audio: [], skipped: [],
  };
  const skip = new Set(opts.skip ?? []);
  const skipped = new Map<string, number>();
  const missing = new Set<string>();

  for (const o of aup.objects) {
    const first = o.effects[0]?.type;
    const allowed = first === undefined ? undefined : KNOWN[first];
    if (!allowed) {
      problems.push(`${where(o)}: unknown object (effects: ${o.effects.map((e) => e.type).join(', ') || 'none'})`);
      continue;
    }
    if (o.chain) {
      problems.push(`${where(o)}: a chained object (a mid-point) is not decoded`);
      continue;
    }
    const unknown = o.effects.slice(1).filter((e) => !allowed.includes(e.type));
    if (unknown.length) {
      problems.push(`${where(o)}: ${first} object has effect${unknown.length > 1 ? 's' : ''} that the reader does not know: ${unknown.map((e) => e.type).join(', ')}`);
      continue;
    }
    const at: Placement = { object: o.index, layer: o.layer, start: o.start, end: o.end };
    const effect = (type: string) => o.effects.find((e) => e.type === type);
    const draw = (): Draw => {
      const e = effect('標準描画');
      if (!e) {
        problems.push(`${where(o)}: ${first} object has no 標準描画`);
        return { x: 0, y: 0, z: 0, zoom: 100, transparency: 0, rotation: 0, blend: 'normal' };
      }
      return drawOf(o, e, problems);
    };

    switch (first) {
      case '画像ファイル': {
        const e = o.effects[0]!;
        const file = basename(sjisString(e.ext.subarray(4))) || o.preview;
        if (!file) {
          problems.push(`${where(o)}: image object without a file name`);
          break;
        }
        if (skip.has(file)) {
          skipped.set(file, (skipped.get(file) ?? 0) + 1);
          break;
        }
        const size = opts.imageSize(file);
        if (!size) {
          missing.add(file);
          break;
        }
        let script: SpriteScript = { mag: 1, uro: 1, kih: 0, hold: 1, cx: 0 };
        const s = effect('スクリプト制御');
        if (s) {
          const parsed = parseSpriteScript(utf16String(s.ext));
          if (typeof parsed === 'string') {
            problems.push(`${where(o)}: ${file}: ${parsed}`);
            break;
          }
          script = parsed;
        }
        if (size.width % script.uro !== 0 || size.height % script.mag !== 0) {
          problems.push(`${where(o)}: ${file} is ${size.width}x${size.height}, which ${script.uro} columns and ${script.mag} rows do not divide`);
          break;
        }
        tl.sprites.push({
          ...at, ...draw(), file, kih: script.kih, hold: script.hold, cx: script.cx,
          sheet: { width: size.width, height: size.height, cols: script.uro, rows: script.mag, cellWidth: size.width / script.uro, cellHeight: size.height / script.mag },
        });
        break;
      }
      case 'テキスト': {
        const e = o.effects[0]!;
        if (e.tracks.some((k) => k.mode !== 0)) problems.push(`${where(o)}: テキスト has a moving trackbar`);
        tl.texts.push({
          ...at, ...draw(),
          text: utf16String(e.ext.subarray(0x30)),
          font: sjisString(e.ext.subarray(0x10, 0x30)),
          size: e.tracks[0]?.cur ?? 0,
          color: rgb(e.ext.subarray(8, 11)),
        });
        break;
      }
      case '音声ファイル':
        tl.audio.push({ ...at, file: basename(sjisString(o.effects[0]!.ext)) || o.preview });
        break;
      case 'グループ制御': {
        const e = o.effects[0]!;
        const border = effect('縁取り');
        const outline = border
          ? { size: border.tracks[0]?.cur ?? 0, blur: border.tracks[1]?.cur ?? 0, color: rgb(border.ext.subarray(0, 3)) }
          : undefined;
        const t = e.tracks;
        if (t.some((k) => k.mode !== 0)) problems.push(`${where(o)}: グループ制御 has a moving trackbar`);
        const v = (i: number) => t[i]?.cur ?? 0;
        tl.groups.push({
          ...at, x: v(0) / 10, y: v(1) / 10, z: v(2) / 10, zoom: v(3) / 100, transparency: v(4) / 10, rotation: v(5) / 100, blend: 'normal',
          layers: v(6), ...(outline ? { outline } : {}),
        });
        break;
      }
      case 'フレームバッファ': {
        const r = effect('リサイズ');
        const k = r?.tracks ?? [];
        if (k.some((x) => x.mode !== 0)) problems.push(`${where(o)}: リサイズ has a moving trackbar`);
        tl.buffers.push({ ...at, ...draw(), resize: { zoom: (k[0]?.cur ?? 10000) / 100, x: (k[1]?.cur ?? 10000) / 100, y: (k[2]?.cur ?? 10000) / 100 } });
        break;
      }
    }
  }
  for (const file of [...missing].sort()) problems.push(`image file ${file} is not in the image folder`);
  tl.skipped = [...skipped].map(([file, objects]) => ({ file, objects }));
  if (problems.length) throw new AupDecodeError(problems);
  return tl;
}
