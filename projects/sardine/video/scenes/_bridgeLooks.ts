// The looks of the bridge (treatment "Colour script"): the light and the sky of each line, and the blend from one to the next.
import { lerp, smooth } from '@pve/engine/util';
import { T_MOON, T_SWING, T_WIND } from './_bridgepath';
import { mix } from './_bridgePaint';
import { SPB } from './_time';

/** The light and the sky of a moment. Each line of the bridge has its own sky. */
export interface Look { zenith: string; horizon: string; ground: string; stars: number; hemiSky: string; hemiGround: string; hemi: number; sun: string; sunI: number; fog: string; fogD: number }

/** 花: crimson and magenta, with gold light. */
const FLOWER: Look = { zenith: '#1c0414', horizon: '#b01a5c', ground: '#1a0a14', stars: 0.8, hemiSky: '#c0608c', hemiGround: '#3a1422', hemi: 1.05, sun: '#ffc86a', sunI: 2.0, fog: '#5a1238', fogD: 0.0011 };
/** 鳥: amber over teal. */
const BIRD: Look = { zenith: '#f0a43c', horizon: '#1e8a86', ground: '#0a2c30', stars: 0.1, hemiSky: '#e8b070', hemiGround: '#1a4a4a', hemi: 1.15, sun: '#ffd28a', sunI: 2.3, fog: '#2a6c68', fogD: 0.0008 };
/** 風: ice cyan and white. The sky is deep over a band of cyan, so the pale row of the line reads; the white is the frost, the ice and the clouds. */
const WIND: Look = { zenith: '#041a36', horizon: '#2f8fc0', ground: '#bfe6f4', stars: 0.7, hemiSky: '#9adcf4', hemiGround: '#3a6a8a', hemi: 1.25, sun: '#e8f8ff', sunI: 1.9, fog: '#3a88b0', fogD: 0.001 };
/** 月: deep violet, with silver from the moon (the gold is the lamp of the car). The view is far from the train: more light on it, so the car reads. */
const MOON: Look = { zenith: '#0c0424', horizon: '#3c1a70', ground: '#08041a', stars: 1, hemiSky: '#6a52b8', hemiGround: '#1a1038', hemi: 1.8, sun: '#e8e4ff', sunI: 2.6, fog: '#1c1048', fogD: 0.0012 };

function blend(a: Look, b: Look, u: number): Look {
  if (u <= 0) return a;
  if (u >= 1) return b;
  return {
    zenith: mix(a.zenith, b.zenith, u), horizon: mix(a.horizon, b.horizon, u), ground: mix(a.ground, b.ground, u), stars: lerp(a.stars, b.stars, u),
    hemiSky: mix(a.hemiSky, b.hemiSky, u), hemiGround: mix(a.hemiGround, b.hemiGround, u), hemi: lerp(a.hemi, b.hemi, u),
    sun: mix(a.sun, b.sun, u), sunI: lerp(a.sunI, b.sunI, u), fog: mix(a.fog, b.fog, u), fogD: lerp(a.fogD, b.fogD, u),
  };
}

/** The look of time t. Each sky comes with the move of the camera to the view of its line: the swing to the side view, the stop of the wind, the swing to the hip view. */
export function lookAt(t: number): Look {
  return blend(blend(blend(FLOWER, BIRD, smooth((t - T_SWING) / SPB)), WIND, smooth((t - T_WIND) / 0.6)), MOON, smooth((t - (T_MOON - 2 * SPB)) / (2 * SPB)));
}
