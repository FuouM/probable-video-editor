// All effect benchmarks: the `bench` arrays of the `<module>.bench.ts` files next to the engine modules.
// Importable by `bun test`: the bench files load engine runtime code only inside setup.
import { bench as engine } from '../engine.bench';
import { bench as gl } from '../gl.bench';
import { bench as glslCommon } from '../glsl/common.bench';
import { bench as hud } from '../hud.bench';
import { bench as lines } from '../lines.bench';
import { bench as post } from '../post.bench';
import { bench as storyboard } from '../storyboard.bench';
import { bench as stroke } from '../stroke.bench';
import { bench as type } from '../type.bench';
import type { EffectBench } from './types';

export const BENCH: readonly EffectBench[] = [...post, ...engine, ...lines, ...gl, ...stroke, ...type, ...glslCommon, ...hud, ...storyboard];

/** Engine modules that do no GPU or draw work: they need no bench file. */
export const NON_EFFECT_MODULES = ['audio', 'lyrics', 'marks', 'palette', 'scale', 'scene', 'skew', 'util'] as const;
