// Benchmarks of the per-tile refinement passes (tiles.ts): the sampling error, the tile maximum, the tile
// mask and the per-tile average. Engine modules load with import() in setup (bun test imports this file).
import type { Engine } from './engine';
import type { TileRefiner } from './tiles';
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
  const tiles = engine.tiles, w = tiles.maxRT.width, h = tiles.maxRT.height;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles.tileOn[y * w + x] = (x + y) & 1 ? 255 : 0;
  tiles.tileTex.needsUpdate = true;
}

/** errPass / errTilePass on the sums (as TileRefiner.sampleError). */
function sampleError(engine: Engine, p: TileRefiner['errPass']) {
  p.u.a!.value = engine.sumRT.texture;
  p.u.b!.value = engine.newRT.texture;
  p.u.invA!.value = 1;
  p.u.invB!.value = 1;
  p.render(engine.renderer, engine.tiles.errRT);
}

const dispose = (_: BenchCtx, f: BenchFrames) => disposeFrames(f);

export const bench: EffectBench[] = [
  defineBench({
    id: 'blur.err',
    kind: 'stage',
    setup: sums,
    run: ({ engine }) => sampleError(engine, engine.tiles.errPass),
    dispose,
  }),
  defineBench({
    id: 'blur.max',
    kind: 'stage',
    async setup(ctx) {
      const f = await sums(ctx);
      sampleError(ctx.engine, ctx.engine.tiles.errPass);
      return f;
    },
    run({ engine, renderer }) {
      const tiles = engine.tiles;
      tiles.maxPass.u.e!.value = tiles.errRT.texture;
      tiles.maxPass.render(renderer, tiles.maxRT);
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
    run: ({ engine }) => engine.tiles.writeTileMask(),
    dispose({ engine }, f) {
      // every masked target back to "all tiles on" (depth cleared to 1)
      for (const [rt, m] of engine.tiles.maskedRTs) engine.tiles.drawMask(rt, m.margin, null);
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
    run: ({ engine }) => sampleError(engine, engine.tiles.errTilePass),
    dispose,
  }),
  defineBench({
    id: 'blur.gain',
    kind: 'stage',
    async setup(ctx) {
      const tiles = ctx.engine.tiles;
      const f = await sums(ctx);
      // tiles stopped at 4 or 12 sub-frames
      const w = tiles.maxRT.width, h = tiles.maxRT.height;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles.gainBuf[y * w + x] = (x + y) & 1 ? 1 / 12 : 1 / 4;
      tiles.gainTex.needsUpdate = true;
      return f;
    },
    run: ({ engine }) => engine.tiles.average(engine.sumRT.texture, engine.avgRT),
    dispose,
  }),
];
