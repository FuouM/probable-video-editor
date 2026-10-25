// Benchmarks of the post chain (post.ts): the engine's own Post on a real HDR frame.
import type * as THREE from 'three';
import { benchFrames, defineBench, disposeFrames, type BenchFrames } from './bench/kit';
import type { BenchCtx, EffectBench } from './bench/types';

/** Run the whole chain on the frame: every pass then holds the uniforms of a real frame. */
function chain({ engine, renderer }: BenchCtx, f: BenchFrames) {
  engine.post.render(renderer, f.input.texture, engine.hud.layer.texture, engine.finalRT, engine.lastPost, f.t);
}

async function primed(ctx: BenchCtx) {
  const f = await benchFrames(ctx.engine);
  chain(ctx, f);
  return f;
}

const dispose = (_: BenchCtx, f: BenchFrames) => disposeFrames(f);

export const bench: EffectBench[] = [
  defineBench({
    id: 'post.prefilter',
    kind: 'pass',
    setup: primed,
    run: ({ engine, renderer }) => engine.post.prefilter.render(renderer, engine.post.mips[0]!),
    dispose,
  }),
  defineBench({
    id: 'post.down',
    kind: 'pass',
    setup: primed,
    // the 13-tap downsample at every pyramid level (as Post.render)
    run({ engine, renderer }) {
      const p = engine.post, u = p.down.u;
      for (let i = 1; i < p.mips.length; i++) {
        const s = p.mips[i - 1]!;
        u.src!.value = s.texture;
        (u.texel!.value as THREE.Vector2).set(1 / s.width, 1 / s.height);
        p.down.render(renderer, p.mips[i]!);
      }
    },
    dispose,
  }),
  defineBench({
    id: 'post.up',
    kind: 'pass',
    setup: primed,
    // the tent upsample at every pyramid level (as Post.render)
    run({ engine, renderer }) {
      const p = engine.post, u = p.up.u, n = p.mips.length;
      let prev = p.mips[n - 1]!.texture;
      for (let i = n - 2; i >= 0; i--) {
        const small = i === n - 2 ? p.mips[n - 1]! : p.ups[i + 1]!;
        u.src!.value = prev;
        u.prev!.value = p.mips[i]!.texture;
        (u.texel!.value as THREE.Vector2).set(1 / small.width, 1 / small.height);
        u.radius!.value = 0.5 + engine.lastPost.bloomRadius;
        p.up.render(renderer, p.ups[i]!);
        prev = p.ups[i]!.texture;
      }
    },
    dispose,
  }),
  defineBench({
    id: 'post.final',
    kind: 'pass',
    setup: primed,
    run: ({ engine, renderer }) => engine.post.final.render(renderer, engine.finalRT),
    dispose,
  }),
  defineBench({
    id: 'post.chain',
    kind: 'pass',
    setup: ({ engine }) => benchFrames(engine),
    run: chain,
    dispose,
  }),
];
