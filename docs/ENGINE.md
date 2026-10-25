# Engine guide (for scene authors)

The engine is the workspace package `@pve/engine` (`packages/engine/`, TypeScript + three.js). The web app (`app/`, run with bun + Vite) plays one project, `projects/<id>/`, chosen with `?project=<id>`. It renders any song time `t` deterministically at 1920×1080 (or at 2× that, 3840×2160, with `?scale=2`. See "Output scale" below). The same code drives the live preview and the offline 60 fps export.

## Running things

- Preview: `cd app && bunx --bun vite`, then http://localhost:5173/?project=pdoom_original&t=23.0 (space = play/pause, ←/→ = ±1 s, shift = ±5 s, `,`/`.` = ±1 frame, `[`/`]` = previous/next timeline entry, `l` = loop the current entry, `h` = hide the UI).
- The commands are `bun run pve <command>` from the repository root (`skills/pve/SKILL.md` has the loop). Each one takes `-p <id>` (or `PVE_PROJECT`, or runs inside `projects/<id>/`). Output goes to `projects/<id>/out/`.
- Stills (LOOK at the PNGs): `bun run pve still 12.5 @loss lyric:FOOM -p pdoom_original`. Times are seconds or time expressions.
- Contact sheets: `bun run pve look open -p pdoom_original` (12 tiles inside the clip), `pve look cuts` (both sides of every cut), `pve look` (the whole song). Each tile shows its time, clip and bar.beat.
- A range as video (to judge motion): `bun run pve render --from @hook1 --to @room -p pdoom_original`.
- Typecheck: `bun run typecheck` (the app config includes `projects/*/video/scenes`). `bun run pve check` is the fast check (schema, expressions, compile, banned calls, missing features).
- The render commands print `SCENE ERRORS` and browser console errors. A console error (a shader that does not compile, a scene that throws) makes `still`, `look`, `bench` and `render` fail.
- 4K: add `--scale 2` to `still`, `look` or `render` (`still` then saves full-resolution 3840×2160 PNGs). Check your scene at both scales: downscaled, the 4K frame should look like the 1080p one, only sharper.
- The commands use the dev server at http://localhost:5173 if it answers, else they start a private one without live reload. A live-reloading server reloads the page when a file changes, so do not edit files during a render on it. Chrome runs with one persistent profile: a second command waits until the first one is done.

## Data

- `lyrics` (`@pve/engine/lyrics`): `lines[]` with `i,text,start,end,words[]`, each word `{w,start,end,syl?,line,index,gi}` (word-level, aligned to the vocal, where `syl` holds `[start, end]` per syllable on words with two or more). Find lines by content, never hard-code times: `const l = this.ctx.lyrics.get('sudden drop')` → `l.words[3].start` (`get` throws when the text is missing, and `get(text, n)` takes the n-th match). Queries: `find(text)` (all matching lines), `linesIn(t0, t1)` (the lines of a clip: `linesIn(ctx.start, ctx.end)`), `lineAt(t)`, `lastLine(t)`, `nextLine(t)`, `wordAt(t)`, `lastWord(t)`, `findWords('P(doom)')`. Helpers: `Lyrics.wordProgress(word, t)` (0..1 sung progress, by syllable when known), `Lyrics.lineCharProgress(line, t)` (chars sung so far — for per-glyph wipes).
- `audio` (`@pve/engine/audio`): `beats[]`, `downbeats[]`, `sections[]`, `beatAt(t)` (continuous beat index), `barAt(t)`, `timeOfBeat(i)`, `nearestBeat(t)`, `events('kick'|'snare'|'hat'|'vocal', t0, t1)`, `env(name, t)` for `rms|low|mid|high|vocal|drums|bass|other` (0..1), `hit(kind, t, halfLife)` decaying pulses. A song has the stem envelopes and the onset kinds that Lyric-Sync computed: `pve check` names each one that a scene reads and the song lacks.
- Every `Frame` carries `f.a` = `{rms,low,mid,high,vocal,drums,bass,other,kick,snare,hat,vonset}`, and `f.beat`, `f.bar` (continuous indices: 12.5 is half way from beat 12 to beat 13, beat 0 is the first beat, and bar 0 is the first downbeat) with `f.beatPhase`, `f.barPhase` (their fractional parts, 0..1).
- Palette keys (`rgba(key)`, `LIN[key]`, GLSL `C_<KEY>`): `ink` (background black), `ink2` (raised black), `graphite` (dim lines), `ash` (mid grey), `bone` (paper white, primary text), `signal` (hazard orange), `ember` (light orange), `blood` (deep red-orange), `acid` (rare accent). A project replaces them in `video/assets/palette.json`.

## Writing a scene

One file `projects/<id>/video/scenes/<name>.ts`, default-exporting a class extending `Scene` (`@pve/engine/scene`). A clip in `video/video.json` names it with `"scene": "<name>"`. A clip without a `scene` renders the storyboard card (`@pve/engine/storyboard`: clip id, `brief`, bar.beat with a beat pulse, the lyric line sung now).

```ts
import * as THREE from 'three';
import { Scene, type Frame } from '@pve/engine/scene';
import { FSPass, Layer2D, W, H, clearRT } from '@pve/engine/gl';

export default class MyScene extends Scene {
  bg = new FSPass(`uniform float t; void main(){ fragColor = vec4(C_INK, 1.0); }`, { t: { value: 0 } });
  text = new Layer2D();
  async init() { /* build geometry, precompute text outlines, etc. */ }
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp, lyrics } = this.ctx;
    this.bg.u.t!.value = f.t;
    this.bg.render(renderer, out);            // fullscreen shader → out (overwrites)
    const c = this.text.ctx; this.text.clear(); /* draw with Canvas2D */
    comp.draw(renderer, this.text.upload(), out); // alpha-over onto out
    return { bloom: 0.7 };                   // post overrides (optional)
  }
}
```

Rules:

- **Deterministic**: output must be a pure function of `f.t` (and seeded randomness: `mulberry32(seed)`, `hash(...)`). Never use `Math.random()`, `Date.now()` or `performance.now()` for visuals. The export averages many sub-frames per frame in any order (see "Motion blur and sampling"). If you need simulation state (particles, feedback buffers), set `stateful = true`, reset in `reset()`, and integrate with `f.dt`. The engine fast-forwards after seeks. Such a scene can only be exported with a fixed `--samples`.
- `render()` must fully overwrite `out` (a HalfFloat linear-HDR target). Colours are **linear**. Values > ~0.85 bloom. Use palette constants (`C_INK`, `C_BONE`, `C_SIGNAL` in GLSL, `LIN.signal` in TS for GL, and `rgba('signal', a)` for Canvas2D).
- `ctx.params` holds the timeline entry parameters (one module can serve several entries). `ctx.start/ctx.end` holds its window. `ctx.assets` holds the URL of the project `video/assets/` folder (with a trailing slash) for textures and data files. `f.lt`/`f.p` tracks local time and progress.
- Transitions: by default the engine crossfades overlapping entries. For custom transitions set `handlesTransition = true` and composite `f.under` (the previous scene's frame) yourself using `f.tin` (0→1 over the overlap). Most cuts should be hard cuts on downbeats (no overlap) — that's the default when windows touch.
- Post overrides you can return: `exposure, bloom, bloomThreshold, bloomKnee, bloomRadius, halation, ca, grain, vignette, hud (HUD opacity), frame (crop marks), paper, fade, flash, shake:[x,y], zoom, invert, overlay` (values for the project overlay, see below). Defaults in `packages/engine/src/post.ts`.
- Performance: the median scene cost at preview scale must stay under 16.7 ms (60 fps live preview). `bun run pve bench <clip>` measures it on the GPU and prints it against this budget. Canvas2D layers cost a texture upload each (`layer2d.upload` in `bench/results.jsonl`). Do not use more than 2–3 per scene. Precompute in `init()`.
- Write your scene files (and helper files named `scenes/<name>-*.ts` or `scenes/_*.ts`), `video/video.json` and `video/assets/`. Do not edit the engine (`packages/`): report what you need instead.

## Project overlay and assets

- `video.json` `"overlay": "<name>"` names a module in `video/scenes/` that default-exports a class extending `Overlay` (`@pve/engine/scene`). One instance draws over every clip into the HUD layer (Canvas2D, logical px), after the crop marks: `draw(c, t, { paper, params })`. `params` are the `overlay` post overrides of the active scene. pdoom's corner P(doom) gauge is `projects/pdoom_original/video/scenes/hud.ts` (shown with `{ overlay: { gauge: 1 } }`).
- `video/assets/palette.json` replaces palette colours by key (`{ "signal": "#22C3FF" }`, keys of `DEFAULT_HEX` in `palette.ts`). The page applies it before the engine modules load, so `HEX`, `LIN`, `rgba()` and the GLSL constants all use it.
- `video/assets/fonts/<path>` replaces the engine font file `app/public/fonts/<path>` of the same path (e.g. `fonts/src/IBMPlexMono-Regular.ttf`, `fonts/stroke/EMSAllure.svg`). The family names do not change.

## Toolbox

- `gl.ts`: `FSPass(frag, uniforms)` fullscreen GLSL3 pass (has `vUv`, writes `fragColor`, gets `GLSL_COMMON`), `Compositor` via `this.ctx.comp.draw(renderer, tex, target, {mode:'normal'|'add'|'screen'|'multiply'|'max', opacity, tint, scale, offset})`, `Layer2D` (1920×1080 logical Canvas2D → sRGB texture), `makeRT()` (screen-sized HDR target, where `makeRT(w, h)` takes logical px), `clearRT(renderer, rt, [r,g,b])`, `SCALE`/`PW`/`PH` (output scale and physical size).
- `glsl/common.ts` (`GLSL_COMMON`, prepended to FSPass, import it into your own ShaderMaterials): palette consts `C_INK`, `C_BONE`, `C_SIGNAL`, `sat(x)`, `remap(x,a,b,c,d)`, `rot2(angle)` (mat2), `luma(rgb)`, hashes `hash11(float)`, `hash12(vec2)`, `hash22(vec2)`, `hash13(vec3)`, `hash33(vec3)` (0..1), `snoise(vec2|vec3)` (-1..1), `fbm(vec2|vec3 p, int octaves)` (the octave count is required), `curl2(vec2 p, float t)`, 2D SDFs `sdCircle(p, r)`, `sdBox(p, halfSize)`, `sdSegment(p, a, b)`, 3D `sdSphere`, `sdBox3`, `sdCapsule(p, a, b, r)`, `sdTorus(p, vec2(R, r))`, `smin/smax(a, b, k)`, `aaFill(d)`, `aaStroke(d, width)`, **`hatch(u, darkness)` and `engrave(uv, darkness, freq, angle)`** for engraving-style shading (`hatchD(u, darkness, du)` takes the derivative of `u` from the caller, for a coordinate whose `fwidth` lies, such as an angle that wraps), `heat(x)` orange ramp, `toSRGB/toLinear`. A shader that does not compile fails `pve still`, `look` and `bench` with the GLSL error.
- `lines.ts`: `LineBatch(capacity, {screen2D, worldWidth, blend})` — GPU capsule segments, 2D pixels (y down) or 3D with a camera. `seg2`, `seg`, `polyline`, `render(renderer, out, camera?)`. Colours linear, can exceed 1 for glow. Good for 10k–200k segments.
- `type.ts`: fonts. `F.archivo(width 62–125, weight 300–900)` (grotesk with width steps 62/75/87.5/100/112.5/125), `F.archivoItalic()`, `F.serif(weight, italic)` (Cormorant Garamond), `F.mono(weight, italic)` (IBM Plex Mono). `font(family, px)` → CSS font string. `layout(text, family, size, tracking)` → `{ text, family, size, width, ascent, descent, glyphs: [{ ch, i, x, w }] }` with the font kerning (draw glyph i at `glyphs[i].x`, `w` is its advance). `glyphX(text, i, family, size)` → where to start drawing `text[i..]` when a word is drawn in pieces (sung or unsung colours, wipes). Never offset a piece by `measure(text.slice(0, i))`, which drops the kern between the pieces. `fitSize(text, family, maxWidth, max)` (largest size that fits), `measure(text, family, size, tracking)` (width in px), `textPath2D` (opentype outline as Path2D), `textPathCommands`, `textPoints(text, family, size, step)` (points filling the glyphs — "text made of atoms"). `smart(s)` / `plain(s)`: typewriter quotes → typographic (’ “ ” …) and back.
- `stroke.ts`: single-stroke plotter/engraving fonts (`script`, `hscript`, `sans`, `readable`, `tech`, `serif`, `osmotron`, `felix`): `strokeText(text, font, size, tracking, kern)`, `drawStrokeText(ctx2d, st, lengthPx)` → returns pen head position, `writtenLength(st, charTimes, t)` to sync writing to word timings. The fonts have no kerning tables: pairs that leave a hole (To, Yo, We, AV, LT…) are kerned optically from the glyph shapes (off for the connected scripts).

## Typography

- Proportional text gets the font kerning: whole strings through Canvas2D get it automatically. Glyph-by-glyph drawing must use `layout()` / `glyphX()`. Adjacent runs in different fonts or sizes have no kerning between them. Set that gap by eye.
- Lyrics come with typographic punctuation (`don’t`, `’cause`, `“Just`): `Word.w` and `Line.text` go through `smart()`, and `lyrics.get()` matches straight or curly quotes. Hardcoded display strings use ’ “ ” … – — × − too. Mono text (IBM Plex Mono) is the UI/terminal voice and keeps typewriter quotes (`plain()` for a lyric shown as typed input).
- No outlined or haloed type.
- `util.ts`: `clamp, lerp, remap, smoothstep, ease.*, prog(x,a,b,ease), keys(t, [[t,v,ease],...]), springStep, pulse, mulberry32, hash, noise1/2/3, fbm1/2, polylineLengths, pointAtLength, window01`.
- `hud.ts`: the global HUD layer: crop marks (post `frame`, ink on `paper`) and the project overlay.

## Output scale (4K)

`?scale=2` (`--scale 2` on `pve still`, `look`, `render`) renders a true 3840×2160 frame. Scenes keep laying out in logical 1920×1080 px (`W`, `H`, `ctx.W`, `ctx.H` never change). The engine handles the rest:

- Render targets: `out`, the engine targets and `makeRT()` are physical (`PW`×`PH`). `makeRT(w, h)` takes logical px and allocates `w*SCALE`×`h*SCALE`. Pass `{ pxScale: 1 }` for a data-sized target whose resolution must not follow the output.
- `Layer2D`: the backing canvas is `SCALE`× larger and its context is pre-scaled, so drawing code works in logical px. `setTransform`/`resetTransform`/`getTransform`, `shadowBlur`, `shadowOffsetX/Y` and `filter` px lengths are patched to stay logical. Not patched: `canvas.width/height` and `getImageData`/`putImageData` are physical px, and `drawImage(layer.canvas, x, y)` needs an explicit size. `new Layer2D(w, h, 1)` makes a deliberately low-res layer (e.g. a soft glow). `scaleContext2D(ctx, SCALE)` applies the same patch to your own canvas.
- `LineBatch`: coordinates and widths stay logical. The AA feather and hairline floor work in physical px, so hairlines stay crisp.
- GLSL (`GLSL_COMMON`): `gl_FragCoord`, `fwidth` and `dFdx` are physical. Use `FRAG_PX` (the fragment position in logical px) instead of `gl_FragCoord.xy` whenever it is combined with logical sizes, and `PX_SCALE` to convert. A line whose width comes from `fwidth` ("a 1.2 px hairline": `1.0 - smoothstep(a, b, d / fwidth(u))`) gets thinner and fainter at 4K: write it as `pxLine(d, a, b)`, which is identical at 1× and keeps the 1× ink with sharper edges at 4K (`rampLine` does the same for the linear-ramp idiom). `hatch`, `engrave` and `aaStroke` already do this. LOD thresholds and supersampling offsets expressed in pixels should be logical (`fwidth(u) * PX_SCALE`, offsets `/ PX_SCALE`).
- Offscreen canvases used as textures (atlases, text planes) keep their own size: make them `SCALE`× larger (with `ctx.scale(SCALE, SCALE)`) if they are shown large, or they look soft at 4K.
- Post (bloom, halation, CA, grain, vignette) and the HUD scale automatically. The bloom pyramid stays at the logical resolution.
- Half scale: `?scale=0.5` renders 960×540 (the web player offers it for slow GPUs, see `docs/SITE.md`). It is for viewing only: `still`, `look` and `render` take whole numbers. `SCALE` is 0.5 or a whole number from 1 to 4. The `SCALE === 1` shader branches are the 1× look, so every other value takes the physical-footprint branches. A line thinner than one physical px keeps its ink but gets fainter.

## Motion blur and sampling

The export renders every frame as the average of many sub-frames spread over the shutter (`--shutter 0.2`: a fifth of the frame time, centred on the frame time) before post-processing. `--samples N` takes N evenly spaced sub-frames. `--samples auto` chooses the count per 32×32-logical-px tile (`Engine.render`, `AdaptiveSampling`):

- The count steps through 4, 12, 36, 108, 324. Each step adds a sub-frame either side of every existing one, so each set is evenly spread and centred on the frame's time.
- After each step the engine compares the new sub-frames average with the old one (displayed values, worst 2×2-logical-px block). Stepped copies of a moving edge differ between the two sets, while a converged streak or a still image does not. Stepping shrinks as 1/count, so the remaining error is about half the change the last step made. A tile stops when that is below `--tol` (default 3 levels of 255) in it and its 8 neighbours. A tile that has stopped is final: it is the average of its first n sub-frames, the image the per-frame sampler would give had it stopped at n.
- Later sub-frames skip the tiles that have stopped: the engine writes the tiles still refining into the depth buffer of its targets, and while it renders a sub-frame every draw into them is depth-tested against that mask, whatever the material says, so the GPU rejects the stopped tiles before shading them (early-Z, as a stencil test does not reject early on Apple GPUs). The final average weighs each tile by its own count.
- In practice a still frame stops at 12, ordinary camera motion at 36, and whips, slams and fast zooms at 108 or 324. At 1:1 in 4K, 108 can't be told from 324, while 36 still shows faint striations on the fastest edges.
- `refine: 'frame'` (`--refine frame`) decides for the whole frame at once, as before tiles: every tile then takes the count its worst tile needs.

What this asks of scenes:

- Sub-frames render out of time order and in any number. Scene output must depend on `f.t` only. `stateful` scenes cannot sample adaptively (the engine refuses). Nothing may count `render()` calls.
- Per-frame flicker and jitter keyed to 60 fps must use `frameIdx(t)` (`util.ts`), not `Math.floor(t * 60)`. `frameIdx` is constant over the frame shutter. `floor` switches at the frame time and double-exposes two states in every frame.
- Noise that changes with continuous `t` (a hash seeded by time) is resampled in every sub-frame: it averages out, but slowly, and makes the adaptive sampler work harder. Seed it with `frameIdx(t)` unless it is meant to smooth out.
- A spark emitter whose rate varies over time passes the rate as a function of the birth time, with its maximum (`sparkParticles(..., { rate: (tb) => ..., rateMax })`). A rate read at the current `t` re-times every particle from one sub-frame to the next.
- Shaders that supersample internally (4 rotated-grid taps) take `ssTap: SS_TAP` and `${SS_TAP_GLSL}` and loop through `k` from `ssK0()` to `ssK1()` with `rgss(k)`, weighting by `ssWeight()`. The engine hands each sub-frame one tap, cycling them (every set is a multiple of 4). This averages to the same image for a quarter of the cost. In the preview and single-sample stills they take all four.
- Post parameters (shake, flash, zoom, fades, the HUD mode) are read at one point of the shutter, 1/8 of it after the frame time (where the video was tuned, and a point every sample set includes). The HUD, grain and dither draw once per frame.
- Masked tiles keep what the last sub-frame drew there. That is safe for `out` and the engine's own targets. A scene's own target keeps being drawn in full (and costs full price) unless the scene lists it in `tileMasked`: only a target with a depth buffer whose texels are read back at their own screen position or within a few px of it (`margin: 1` widens the mask by a tile), like shoggoth's half-res G-buffer, or, with `moving: true`, one read through a zoom or pan that the scene gives before each sub-frame's draws with `ctx.mapTileMask(rt, map)`, like the room at the bottom of loom's dive (`null` while it is read through the spiral). A target read through a warp or a wide blur must not be listed.
- A draw into a masked target whose material asks for its own depth test (3D with a depth buffer) can't use the mask: the engine draws that sub-frame again unmasked and keeps drawing that scene unmasked.

## Shared motifs and project modules

### pdoom_original (`projects/pdoom_original/video/scenes/_motifs.ts`)
Use these so recurring motifs look identical across plates: `sparkHead(lineBatch, x, y, t, scale, intensity)` + `sparkParticles(lineBatch, t, headAt, opts)` (the spark, drawn with a 2D additive `LineBatch`), `sparkHead2D` (Canvas2D fallback), and the mask: `drawMask2D(ctx, x, y, R, rot)`, `MASK` geometry constants and `GLSL_MASK` (`sdMaskInk(p)` in mask units, y down).

### breaked_neuro (`projects/breaked_neuro/video/scenes/_*.ts`)
Key architectural modules for procedural animation and simulations:
- `_machine.ts`: Host machine, `GPULife` torus background plane, `ShipLayer` spaceship rendering, and `PrintScene` binarization shader.
- `_conway.ts`: CPU `Life` board with discrete generation stepping and deterministic seek replay from seed.
- `_mirror.ts`: Mirror shard geometry, Voronoi fracture cells, and reflection projection.
- `_dust.ts`: 2D sandstorm and dust displacement particle system.
- `_paper.ts`: Crumpled paper surface mesh and texture unwrapping.
- `_broken.ts`: ASCII DOOM renderer, Cantor step terrain, and BBS terminal layouts.

## Object marks and probing
Scenes can annotate rendered objects with bounding boxes using `mark()` from `@pve/engine/marks`:
```ts
import { mark } from '@pve/engine/marks'
mark('word:break', x, y, width, height, [r, g, b])
```
Use `pve probe` in the CLI to inspect these marks:
- `pve probe <from..to> -t <name>` tracks an object bounding box and saves a crop strip.
- `pve probe --lyrics <clip>` verifies that sung lyrics stay inside screen bounds.
