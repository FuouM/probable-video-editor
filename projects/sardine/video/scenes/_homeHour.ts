// The hour table of the room kit (`_home.ts`): the sky, the sun or the moon, the ambient and the town for each hour of the day.
import { lerp } from '@pve/engine/util';

export interface HourKey {
  h: number;
  /** Sky: zenith, horizon, ground (below the horizon), stars 0..1. */
  zen: number; hor: number; gnd: number; stars: number;
  /** The sun or the moon: elevation and azimuth (degrees, azimuth positive toward +x, 0 = straight in from -z), colour, candela-like strength. */
  el: number; az: number; sun: number; sunI: number;
  /** Ambient sky and ground colour and strength. */
  hemiSky: number; hemiGnd: number; hemiI: number;
  /** Brightness of the town (it has no ambient occlusion, so it is lifted by hand at night). */
  town: number;
  /** Share of the house windows that are lit, 0..1. */
  win: number;
}

const HOURS: HourKey[] = [
  { h: 3.5, zen: 0x070a20, hor: 0x1a2248, gnd: 0x0c0e14, stars: 1, el: 42, az: -22, sun: 0xb4c4f0, sunI: 0.55, hemiSky: 0x3a4478, hemiGnd: 0x14161c, hemiI: 0.26, town: 1.9, win: 0.22 },
  { h: 4.8, zen: 0x151c42, hor: 0x3c4468, gnd: 0x10121a, stars: 0.6, el: 30, az: -18, sun: 0x8c9cd8, sunI: 0.4, hemiSky: 0x3a4272, hemiGnd: 0x181a22, hemiI: 0.26, town: 1.8, win: 0.3 },
  { h: 6.0, zen: 0x6c7690, hor: 0xc9c4c6, gnd: 0x5a5c60, stars: 0.05, el: 14, az: -14, sun: 0xd4d6e8, sunI: 1.6, hemiSky: 0x8a92aa, hemiGnd: 0x4a4c54, hemiI: 0.5, town: 1.3, win: 0.25 },
  { h: 7.5, zen: 0x8aa0c0, hor: 0xe8d8c8, gnd: 0x8a8a8a, stars: 0, el: 20, az: -30, sun: 0xffe0c0, sunI: 2.2, hemiSky: 0xa0b0d0, hemiGnd: 0x6a6258, hemiI: 0.6, town: 1.0, win: 0 },
  { h: 12, zen: 0x5a90d8, hor: 0xc0daf0, gnd: 0x909890, stars: 0, el: 55, az: 0, sun: 0xfff4e0, sunI: 3.0, hemiSky: 0xa0c0f0, hemiGnd: 0x786e60, hemiI: 0.8, town: 1.0, win: 0 },
  { h: 16.5, zen: 0x5080c8, hor: 0xe8d8c0, gnd: 0x888078, stars: 0, el: 25, az: 25, sun: 0xffe0b0, sunI: 2.4, hemiSky: 0x90a8d8, hemiGnd: 0x6a5e50, hemiI: 0.65, town: 1.0, win: 0 },
  { h: 18.0, zen: 0x3a3a7a, hor: 0xf08a48, gnd: 0x3a2a30, stars: 0.05, el: 15, az: 20, sun: 0xff9a48, sunI: 2.6, hemiSky: 0x7a6a9a, hemiGnd: 0x3a2a2a, hemiI: 1.1, town: 1.25, win: 0.15 },
  { h: 18.9, zen: 0x2a2858, hor: 0xb85a50, gnd: 0x241a20, stars: 0.2, el: 11, az: 18, sun: 0xff7a50, sunI: 2.0, hemiSky: 0x6a5a8a, hemiGnd: 0x2a2024, hemiI: 1.0, town: 1.6, win: 0.55 },
  { h: 19.8, zen: 0x1a1a48, hor: 0x70405a, gnd: 0x16141c, stars: 0.6, el: 20, az: -20, sun: 0x8a78c0, sunI: 0.4, hemiSky: 0x38306e, hemiGnd: 0x18161c, hemiI: 0.28, town: 1.8, win: 0.8 },
  { h: 21, zen: 0x0c1030, hor: 0x26305a, gnd: 0x0e1016, stars: 1, el: 38, az: -25, sun: 0xb4c4f0, sunI: 0.55, hemiSky: 0x3a4478, hemiGnd: 0x14161c, hemiI: 0.26, town: 1.9, win: 0.9 },
  { h: 23.5, zen: 0x080c26, hor: 0x1e2850, gnd: 0x0c0e14, stars: 1, el: 40, az: -22, sun: 0xb4c4f0, sunI: 0.55, hemiSky: 0x3a4478, hemiGnd: 0x14161c, hemiI: 0.26, town: 1.9, win: 0.6 },
  { h: 26, zen: 0x070a20, hor: 0x1a2248, gnd: 0x0c0e14, stars: 1, el: 42, az: -22, sun: 0xb4c4f0, sunI: 0.55, hemiSky: 0x3a4478, hemiGnd: 0x14161c, hemiI: 0.26, town: 1.9, win: 0.3 },
];

const NUM_KEYS = ['zen', 'hor', 'gnd', 'sun', 'hemiSky', 'hemiGnd'] as const;

const mixHex = (a: number, b: number, t: number) => {
  let o = 0;
  for (const s of [16, 8, 0]) o |= Math.round(lerp((a >> s) & 255, (b >> s) & 255, t)) << s;
  return o;
};

/** The interpolated key for an hour 0..24 (the table wraps at midnight). */
export function hourKey(hour: number): HourKey {
  const t0 = HOURS[0]!.h;
  let h = ((hour % 24) + 24) % 24;
  if (h < t0) h += 24;
  let k = 0;
  const next = (i: number): HourKey => (i + 1 < HOURS.length ? HOURS[i + 1]! : { ...HOURS[0]!, h: HOURS[0]!.h + 24 });
  while (k + 1 < HOURS.length && HOURS[k + 1]!.h <= h) k++;
  const a = HOURS[k]!;
  const b = next(k);
  const u = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
  const o = { ...a, h } as HourKey;
  for (const n of NUM_KEYS) o[n] = mixHex(a[n], b[n], u);
  for (const n of ['stars', 'el', 'az', 'sunI', 'hemiI', 'town', 'win'] as const) o[n] = lerp(a[n], b[n], u);
  return o;
}
