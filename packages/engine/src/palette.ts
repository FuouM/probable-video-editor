import { hexToLinear } from './util';

// The default palette: ink, bone, and one signal colour, plus one rare accent (acid).
// A project replaces colours with video/assets/palette.json ({ "signal": "#33AAFF", ... }), applied with
// setPalette before the other engine modules load (GLSL_COMMON bakes the colours in when it loads).
export const DEFAULT_HEX = {
  ink: '#0A0A0B', // background black (slightly warm)
  ink2: '#151517', // raised black (panels, paper-in-the-dark)
  graphite: '#5E5B57', // dim lines, secondary text
  ash: '#9C978F', // mid grey
  bone: '#EEE9DF', // paper white, primary text
  signal: '#FF4D12', // hazard orange: the spark, the fuse
  ember: '#FF8A3D', // hotter, lighter orange for cores/highlights
  blood: '#C21D0B', // deep red-orange for shadows of signal
  acid: '#D8FF3C', // the rare accent
} as const;

export type PaletteKey = keyof typeof DEFAULT_HEX;

/** The palette in use: the defaults with the project's colours. */
export const HEX: Record<PaletteKey, string> = { ...DEFAULT_HEX };

/** Linear RGB triplets for GL uniforms. */
export const LIN = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)]),
) as Record<PaletteKey, [number, number, number]>;

/**
 * Replace palette colours (keys of DEFAULT_HEX, values '#RRGGBB'). Call it before the other engine modules
 * are imported. Throws on an unknown key or a bad colour, with the key in the message.
 */
export function setPalette(colors: Record<string, unknown>) {
  for (const [k, v] of Object.entries(colors)) {
    if (!(k in DEFAULT_HEX)) throw new Error(`palette: unknown colour '${k}' (colours: ${Object.keys(DEFAULT_HEX).join(', ')})`);
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`palette: '${k}' must be '#RRGGBB', got ${JSON.stringify(v)}`);
    HEX[k as PaletteKey] = v;
    LIN[k as PaletteKey] = hexToLinear(v);
  }
}

/** CSS rgba() for Canvas2D. */
export function rgba(key: PaletteKey | string, a = 1): string {
  const hex = (HEX as Record<string, string>)[key] ?? key;
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
