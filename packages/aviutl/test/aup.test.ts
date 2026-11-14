import { describe, expect, test } from 'bun:test';
import { AupDecodeError, AupFormatError, decodeTimeline, decompress, parseAup, parseSpriteScript, type Aup, type DecodeOptions } from '../src/index.ts';
import { buildAup, compress, imageExt, scriptExt, spriteScript, textExt, type AupSpec, type ObjectSpec } from './build.ts';

const SIZES: Record<string, { width: number; height: number }> = {
  'sheet.png': { width: 128, height: 96 },
  'plain.png': { width: 40, height: 30 },
};
const opts: DecodeOptions = { imageSize: (f) => SIZES[f] };

const draw = (x = 0, y = 0, blend = 0) => ({ type: '標準描画', tracks: [x * 10, y * 10, 0, 10000, 0, 0], checks: [blend] });
const sprite = (layer: number, start: number, end: number, file: string, script?: string[]): ObjectSpec => ({
  layer, start, end, preview: file,
  effects: [
    { type: '画像ファイル', ext: imageExt(`assets\\${file}`) },
    ...(script ? [{ type: 'スクリプト制御', ext: scriptExt(script) }] : []),
    draw(-3.6, 4),
  ],
});
const text = (layer: number, start: number, end: number, s: string): ObjectSpec => ({
  layer, start, end, preview: 'lyric',
  effects: [{ type: 'テキスト', tracks: [8, 0], ext: textExt('美咲ゴシック', s, [255, 128, 0]) }, draw()],
});

/** Parsed file and its decode, for a spec. */
function load(spec: AupSpec): Aup {
  return parseAup(buildAup(spec));
}

describe('compression', () => {
  test('round trips runs and literals', () => {
    const data = Uint8Array.from([...new Array(300).fill(7), 1, 2, 3, ...new Array(5).fill(0), 9, ...new Array(200000).fill(4)]);
    const packed = compress(data);
    const { out, end } = decompress(packed, 0, data.length);
    expect(out).toEqual(data);
    expect(end).toBe(packed.length);
  });

  test('a truncated stream is an error', () => {
    const packed = compress(new Uint8Array(1000).fill(3));
    expect(() => decompress(packed.subarray(0, 2), 0, 1000)).toThrow(AupFormatError);
  });
});

describe('parseAup', () => {
  test('reads size, fps, frames, grid and objects (old object base 0x508)', () => {
    const aup = load({ width: 256, height: 192, rate: 18, scale: 1, frames: 3072, base: 0x508, objects: [sprite(3, 10, 20, 'sheet.png', spriteScript(3, 4, 2)), text(24, 256, 307, 'ほげ')] });
    expect(aup).toMatchObject({ width: 256, height: 192, fps: 18, frames: 3072, version: 9006, objectBase: 0x508 });
    expect(aup.grid).toEqual({ enabled: true, tempo: 135, beat: 4, offsetFrame: 1 });
    expect(aup.objects.map((o) => [o.index, o.layer, o.start, o.end])).toEqual([[0, 3, 10, 20], [1, 24, 256, 307]]);
    expect(aup.objects[0]!.effects.map((e) => e.type)).toEqual(['画像ファイル', 'スクリプト制御', '標準描画']);
  });

  test('reads the 0.92 object base 0x5C8 (layer at +0x5C0)', () => {
    const aup = load({ base: 0x5c8, objects: [sprite(5, 0, 9, 'plain.png'), sprite(6, 3, 8, 'plain.png')] });
    expect(aup.objectBase).toBe(0x5c8);
    expect(aup.objects.map((o) => o.layer)).toEqual([5, 6]);
  });

  test('a fractional frame rate', () => {
    expect(load({ rate: 30000, scale: 1001, objects: [] }).fps).toBeCloseTo(29.97, 2);
  });

  test('rejects a file that is not a project', () => {
    expect(() => parseAup(new TextEncoder().encode('RIFF....WAVE'.repeat(10)))).toThrow(/not an AviUtl project/);
  });

  test('rejects a project without ExEdit data', () => {
    const bytes = buildAup({ objects: [] });
    const at = Buffer.from(bytes).indexOf('FilterProject');
    bytes[at] = 0x58;
    expect(() => parseAup(bytes)).toThrow(/no ExEdit data/);
  });

  test('rejects a truncated file', () => {
    const bytes = buildAup({ objects: [sprite(1, 0, 1, 'plain.png'), sprite(2, 0, 1, 'plain.png')] });
    expect(() => parseAup(bytes.subarray(0, bytes.length - 10))).toThrow(AupFormatError);
  });
});

describe('parseSpriteScript', () => {
  test('the plain script', () => {
    expect(parseSpriteScript(spriteScript(2, 8, 4).join('\r\n'))).toEqual({ mag: 2, uro: 8, kih: 4, hold: 1, cx: 0 });
  });

  test('frames per cell, with or without a space', () => {
    expect(parseSpriteScript(spriteScript(1, 4, 0, 'fs=math.floor(obj.frame/64 +kih)%bs').join('\n'))).toMatchObject({ hold: 64 });
    expect(parseSpriteScript(spriteScript(1, 4, 0, 'fs=math.floor(obj.frame/2+kih)%bs').join('\n'))).toMatchObject({ hold: 2 });
  });

  test('scroll', () => {
    expect(parseSpriteScript(spriteScript(4, 6, 0, undefined, ['obj.cx=-math.floor(obj.frame*1.5)']).join('\n'))).toMatchObject({ cx: -1.5 });
    expect(parseSpriteScript(spriteScript(4, 6, 0, undefined, ['obj.cx=math.floor(obj.frame*1.5)']).join('\n'))).toMatchObject({ cx: 1.5 });
  });

  test('another script is described, not accepted', () => {
    const other = spriteScript(2, 2, 0, undefined, ['obj.ox=100']);
    expect(parseSpriteScript(other.join('\n'))).toMatch(/not the sprite-sheet script \(first difference: "obj.ox=100"\)/);
    expect(parseSpriteScript('mag=2\nuro=x')).toMatch(/uro=<integer>/);
    expect(parseSpriteScript(spriteScript(0, 1, 0).join('\n'))).toMatch(/at least 1/);
  });
});

describe('decodeTimeline', () => {
  const aup = load({
    objects: [
      { layer: 0, start: 0, end: 99, preview: 'song.wav', effects: [{ type: '音声ファイル', ext: imageExt('song.wav').subarray(4) }, { type: '標準再生' }] },
      sprite(2, 0, 99, 'plain.png'),
      sprite(3, 10, 40, 'sheet.png', spriteScript(3, 4, 2, 'fs=math.floor(obj.frame/2 +kih)%bs')),
      text(24, 32, 63, 'うみ　のなか'),
      { layer: 18, start: 5, end: 99, effects: [{ type: 'グループ制御', tracks: [0, 880, 0, 10000, 0, 0, 2] }] },
      { layer: 22, start: 8, end: 90, effects: [{ type: 'グループ制御' }, { type: '縁取り', tracks: [1, 0], ext: Uint8Array.from([0x63, 0x64, 0x65, 0]) }] },
      { layer: 25, start: 20, end: 60, effects: [{ type: 'フレームバッファ' }, { type: 'リサイズ', tracks: [10000, 20000, 15000] }, { type: '標準描画', tracks: [830, -610, 0, 10000, 0, 0], checks: [1] }] },
    ],
  });

  test('sprites: file, sheet grid, cell size, offset, position, blend', () => {
    const tl = decodeTimeline(aup, opts);
    expect(tl).toMatchObject({ fps: 18, size: [256, 192], frames: 100 });
    expect(tl.sprites).toHaveLength(2);
    expect(tl.sprites[0]).toMatchObject({
      object: 1, layer: 2, start: 0, end: 99, file: 'plain.png', kih: 0, hold: 1, cx: 0,
      sheet: { width: 40, height: 30, cols: 1, rows: 1, cellWidth: 40, cellHeight: 30 },
      x: -3.6, y: 4, zoom: 100, transparency: 0, rotation: 0, blend: 'normal',
    });
    expect(tl.sprites[1]).toMatchObject({
      file: 'sheet.png', kih: 2, hold: 2,
      sheet: { width: 128, height: 96, cols: 4, rows: 3, cellWidth: 32, cellHeight: 32 },
    });
  });

  test('texts, groups, frame buffers and audio', () => {
    const tl = decodeTimeline(aup, opts);
    expect(tl.texts).toEqual([
      { object: 3, layer: 24, start: 32, end: 63, x: 0, y: 0, z: 0, zoom: 100, transparency: 0, rotation: 0, blend: 'normal', text: 'うみ　のなか', font: '美咲ゴシック', size: 8, color: '#ff8000' },
    ]);
    expect(tl.groups).toHaveLength(2);
    expect(tl.groups[0]).toMatchObject({ layer: 18, y: 88, layers: 2 });
    expect(tl.groups[0]!.outline).toBeUndefined();
    expect(tl.groups[1]!.outline).toEqual({ size: 1, blur: 0, color: '#636465' });
    expect(tl.buffers).toEqual([{ object: 6, layer: 25, start: 20, end: 60, x: 83, y: -61, z: 0, zoom: 100, transparency: 0, rotation: 0, blend: 'add', resize: { zoom: 100, x: 200, y: 150 } }]);
    expect(tl.audio).toEqual([{ object: 0, layer: 0, start: 0, end: 99, file: 'song.wav' }]);
  });

  test('skip drops the objects of a file and reports them', () => {
    const tl = decodeTimeline(aup, { imageSize: (f) => (f === 'sheet.png' ? undefined : SIZES[f]), skip: ['sheet.png'] });
    expect(tl.sprites.map((s) => s.file)).toEqual(['plain.png']);
    expect(tl.skipped).toEqual([{ file: 'sheet.png', objects: 1 }]);
  });

  test('a missing image file is an error that names the file', () => {
    expect(() => decodeTimeline(aup, { imageSize: () => undefined })).toThrow(/image file plain.png is not in the image folder/);
  });

  test('a sheet that the grid does not divide is an error', () => {
    const bad = load({ objects: [sprite(1, 0, 5, 'sheet.png', spriteScript(5, 4, 0))] });
    expect(() => decodeTimeline(bad, opts)).toThrow(/128x96, which 4 columns and 5 rows do not divide/);
  });

  test('unknown effect, unknown script, moving track and unknown object: all listed at once', () => {
    const bad = load({
      objects: [
        { layer: 1, start: 0, end: 9, preview: 'plain.png', effects: [{ type: '画像ファイル', ext: imageExt('plain.png') }, { type: '不明効果' }, draw()] },
        sprite(2, 0, 9, 'plain.png', spriteScript(1, 1, 0, undefined, ['obj.rx=45'])),
        { layer: 3, start: 0, end: 9, preview: 'plain.png', effects: [{ type: '画像ファイル', ext: imageExt('plain.png') }, { ...draw(), modes: [0, 2] }] },
        { layer: 4, start: 0, end: 9, effects: [{ type: '不明効果' }] },
      ],
    });
    let error: unknown;
    try {
      decodeTimeline(bad, opts);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AupDecodeError);
    const { problems } = error as AupDecodeError;
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/object 0 \(layer 1, frames 0-9\).*画像ファイル object has effect that the reader does not know: 不明効果/);
    expect(problems[1]).toMatch(/object 1 .*plain.png: the script body is not the sprite-sheet script/);
    expect(problems[2]).toMatch(/object 2 .*標準描画 has a moving trackbar/);
    expect(problems[3]).toMatch(/object 3 .*unknown object \(effects: 不明効果\)/);
  });

  test('an unknown blend mode is an error', () => {
    const bad = load({ objects: [{ layer: 1, start: 0, end: 9, preview: 'plain.png', effects: [{ type: '画像ファイル', ext: imageExt('plain.png') }, draw(0, 0, 40)] }] });
    expect(() => decodeTimeline(bad, opts)).toThrow(/blend mode 40/);
  });
});
