// All effect benchmarks: the `bench` arrays of the `<module>.bench.ts` files next to the engine modules.
// Importable by `bun test`: the bench files load engine runtime code only inside setup.
import { bench as blendcam } from '../blendcam.bench';
import { bench as chunks } from '../chunks.bench';
import { bench as crt } from '../crt.bench';
import { bench as dom } from '../dom.bench';
import { bench as dompaint } from '../dompaint.bench';
import { bench as engine } from '../engine.bench';
import { bench as frost } from '../frost.bench';
import { bench as gl } from '../gl.bench';
import { bench as glslCommon } from '../glsl/common.bench';
import { bench as hud } from '../hud.bench';
import { bench as jpeg } from '../jpeg.bench';
import { bench as lines } from '../lines.bench';
import { bench as lit } from '../lit.bench';
import { bench as litview } from '../litview.bench';
import { bench as mosh } from '../mosh.bench';
import { bench as physics } from '../physics.bench';
import { bench as post } from '../post.bench';
import { bench as readback } from '../readback.bench';
import { bench as storyboard } from '../storyboard.bench';
import { bench as stroke } from '../stroke.bench';
import { bench as textlayer } from '../textlayer.bench';
import { bench as textmode } from '../textmode.bench';
import { bench as tiles } from '../tiles.bench';
import { bench as track } from '../track.bench';
import { bench as type } from '../type.bench';
import { bench as ui } from '../ui.bench';
import type { EffectBench } from './types';

export const BENCH: readonly EffectBench[] = [...post, ...engine, ...tiles, ...readback, ...lines, ...gl, ...stroke, ...type, ...glslCommon, ...hud, ...storyboard, ...jpeg, ...physics, ...lit, ...litview, ...textlayer, ...track, ...ui, ...frost, ...blendcam, ...mosh, ...textmode, ...chunks, ...crt, ...dom, ...dompaint];

/** Engine modules that do no GPU or draw work in a frame of a video: they need no bench file. `props` draws only the model board of `pve props`. */
export const NON_EFFECT_MODULES = ['audio', 'domcss', 'domread', 'lyrics', 'marks', 'memo', 'options', 'palette', 'props', 'scale', 'scene', 'skew', 'util'] as const;
