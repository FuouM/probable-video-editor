// Benchmarks of the engine's own stages (engine.ts): the adaptive motion-blur passes, the crossfade and
// screen blit, and the frame readbacks. Engine modules load with import() in setup (bun test imports this file).
import type { Engine } from './engine';
import { benchFrames, defineBench, disposeFrames, type BenchFrames } from './bench/kit';
import type { BenchCtx, EffectBench } from './bench/types';

/** Fill the sub-frame sums with real frames: sumRT = input, newRT = input2 (each a sum of one sub-frame). */
async function sums({ engine, renderer }: BenchCtx) {
  const f = await benchFrames(engine);
  engine.comp.draw(renderer, f.input.texture, engine.sumRT, { mode: 'replace', premult: false });
  engine.comp.draw(renderer, f.input2.texture, engine.newRT, { mode: 'replace', premult: false });
  return f;
}

/** Every other tile still refining (a checkerboard): half the frame masked, as in a late refinement step. */
function halfTiles(engine: Engine) {
  const w = engine.maxRT.width, h = engine.maxRT.height;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) engine.tileOn[y * w + x] = (x + y) & 1 ? 255 : 0;
  engine.tileTex.needsUpdate = true;
}

/** errPass / errTilePass on the sums (as Engine.sampleError). */
function sampleError(engine: Engine, p: Engine['errPass']) {
  p.u.a!.value = engine.sumRT.texture;
  p.u.b!.value = engine.newRT.texture;
  p.u.invA!.value = 1;
  p.u.invB!.value = 1;
  p.render(engine.renderer, engine.errRT);
}

const dispose = (_: BenchCtx, f: BenchFrames) => disposeFrames(f);

export const bench: EffectBench[] = [
  defineBench({
    id: 'blur.accum',
    kind: 'stage',
    async setup({ engine, renderer }) {
      const { clearRT } = await import('./gl');
      const f = await benchFrames(engine);
      clearRT(renderer, engine.sumRT, [0, 0, 0], 0);
      return f;
    },
    run({ engine, renderer }, f) {
      engine.accum.u.src!.value = f.input.texture;
      engine.accum.render(renderer, engine.sumRT);
    },
    dispose,
  }),
  defineBench({
    id: 'blur.err',
    kind: 'stage',
    setup: sums,
    run: ({ engine }) => sampleError(engine, engine.errPass),
    dispose,
  }),
  defineBench({
    id: 'blur.max',
    kind: 'stage',
    async setup(ctx) {
      const f = await sums(ctx);
      sampleError(ctx.engine, ctx.engine.errPass);
      return f;
    },
    run({ engine, renderer }) {
      engine.maxPass.u.e!.value = engine.errRT.texture;
      engine.maxPass.render(renderer, engine.maxRT);
    },
    dispose,
  }),
  defineBench({
    id: 'blur.mask',
    kind: 'stage',
    async setup({ engine }) {
      const f = await benchFrames(engine);
      halfTiles(engine);
      return f;
    },
    run: ({ engine }) => engine.writeTileMask(),
    dispose({ engine }, f) {
      // every masked target back to "all tiles on" (depth cleared to 1)
      for (const [rt, m] of engine.maskedRTs) engine.drawMask(rt, m.margin, null);
      disposeFrames(f);
    },
  }),
  defineBench({
    id: 'blur.errTile',
    kind: 'stage',
    async setup(ctx) {
      const f = await sums(ctx);
      halfTiles(ctx.engine);
      return f;
    },
    run: ({ engine }) => sampleError(engine, engine.errTilePass),
    dispose,
  }),
  defineBench({
    id: 'blur.gain',
    kind: 'stage',
    async setup(ctx) {
      const { engine } = ctx;
      const f = await sums(ctx);
      // tiles stopped at 4 or 12 sub-frames
      const w = engine.maxRT.width, h = engine.maxRT.height;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) engine.gainBuf[y * w + x] = (x + y) & 1 ? 1 / 12 : 1 / 4;
      engine.gainTex.needsUpdate = true;
      return f;
    },
    run({ engine, renderer }) {
      engine.gainPass.u.tex!.value = engine.sumRT.texture;
      engine.gainPass.render(renderer, engine.avgRT);
    },
    dispose,
  }),
  defineBench({
    id: 'engine.xfade',
    kind: 'pass',
    setup: ({ engine }) => benchFrames(engine),
    run({ engine, renderer }, f) {
      const u = engine.xfade.u;
      u.a!.value = f.input.texture;
      u.b!.value = f.input2.texture;
      u.k!.value = 0.5;
      engine.xfade.render(renderer, engine.mixRT);
    },
    dispose,
  }),
  defineBench({
    id: 'engine.blit',
    kind: 'pass',
    setup: ({ engine }) => benchFrames(engine),
    run({ engine, renderer }) {
      engine.blit.u.src!.value = engine.finalRT.texture;
      engine.blit.render(renderer, null);
    },
    dispose,
  }),
  defineBench({
    id: 'read.sync',
    kind: 'stage',
    async setup({ engine }) {
      const { PW, PH } = await import('./gl');
      return { f: await benchFrames(engine), buf: new Uint8Array(PW * PH * 4) };
    },
    run: ({ engine }, s) => { engine.readPixels(s.buf); },
    dispose: (_, s) => disposeFrames(s.f),
  }),
  defineBench({
    id: 'read.async',
    kind: 'stage',
    async setup({ engine }) {
      const { PW, PH } = await import('./gl');
      return { f: await benchFrames(engine), buf: new Uint8Array(PW * PH * 4) };
    },
    async run({ engine }, s) { await engine.readPixelsAsync(s.buf); },
    dispose: (_, s) => disposeFrames(s.f),
  }),
  defineBench({
    id: 'read.rgbPack',
    kind: 'stage',
    setup: ({ engine }) => benchFrames(engine),
    run({ engine, renderer }) {
      engine.rgbPass.u.src!.value = engine.finalRT.texture;
      engine.rgbPass.render(renderer, engine.rgbRT);
    },
    dispose,
  }),
  defineBench({
    id: 'read.pipelined',
    kind: 'stage',
    async setup({ engine }) {
      const { Engine } = await import('./engine');
      return { f: await benchFrames(engine), buf: new Uint8Array(Engine.RGB_BYTES) };
    },
    // one frame through the pipelined path: pack, queue the copy, wait for the fence, copy out
    async run({ engine }, s) {
      engine.readStart(0);
      await engine.readFinish(0, s.buf);
    },
    dispose: (_, s) => disposeFrames(s.f),
  }),
];
