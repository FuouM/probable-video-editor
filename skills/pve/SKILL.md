---
name: pve
description: Make a code-rendered music video for a finished Lyric-Sync song with pve. Use to block out the edit, write scenes, check them, look at real frames, measure their cost and resolve director notes.
---

# pve: make a music video with code

pve renders a music video from code. The song comes timed from Lyric-Sync. You write the edit (`video/video.json`) and the scenes (`video/scenes/*.ts`). The CLI checks your work and shows real frames from the engine.

Run every command from the repository root as `bun run pve <command> -p <id>`. `<id>` is the folder name in `projects/`. `bun run pve help` lists the commands.

## Files

| File | You |
|---|---|
| `projects/<id>/user_input/`, `generated/` | Read only. Lyric-Sync owns the song: mix, beats, lyrics, sections, features. |
| `video/video.json` | Write. The edit: markers and clips. |
| `video/scenes/<name>.ts` | Write. One scene class per file. Helper files: `<name>-*.ts` or `_*.ts`. |
| `video/assets/` | Write. Textures, data, `palette.json`, fonts. |
| `video/treatment.md` | Read. The idea of the video from the human. |
| `video/notes.json` | Read. Write only with `pve notes resolve`. |
| `packages/` | Do not edit. Report what you need from the engine. |

## The loop

Do the steps in this order. The cheapest evidence comes first.

1. Read the brief: `pve outline` and `video/treatment.md`. The outline prints clips, markers, sections, lyric lines and open notes with times and `bar.beat`. `pve outline <clip>` prints only that clip and the lyric lines inside it.
2. Block out the edit. Write clips with a `brief` and no `scene`. Each clip without a scene renders a storyboard card. Run `pve check`.
3. Make a scene: `pve scene new <name>`. Set `"scene": "<name>"` on the clip. The template renders as it is.
4. Check: `pve check`. It takes under a second. Fix every error before you render. It does not compile GLSL and does not type-check.
5. Look and probe: `pve look <clip>` for a contact sheet. `pve still <time...>` for full-size frames. `pve look cuts` for both sides of every cut. When scenes mark what they draw (`mark(name, x, y, w, h, c?)` from `@pve/engine/marks`, e.g. `syl:<text>`, `word:<text>`, `first-i`), use `pve probe <from..to> -t <name>` to track an object box and save a zoomed crop strip, and `pve probe --lyrics <clip...>` to verify every sung syllable is on screen. A shader that does not compile or a scene that throws makes `look`, `still` and `probe` fail with the browser error.
6. Measure: `pve bench <clip>`. Keep the median scene cost under 16.7 ms.
7. Type-check before you report a scene done: `bun run typecheck` (about 30 s).
8. Read notes: `pve notes`. Fix each note, then run `pve notes resolve <id>`.
9. Render a range only when motion must be judged: `pve render --from @a --to @b`. The human starts the final render.

## video.json

```json
{ "v": 2, "title": "Song", "fps": 60, "size": [1920, 1080],
  "markers": { "drop": { "at": "lyric:fall down@beat<=" } },
  "clips": [
    { "id": "intro", "at": 0, "brief": "Black. One line draws in." },
    { "id": "drop", "at": "@drop", "scene": "drop", "params": { "hue": 2 }, "xfade": 0.25 }
  ],
  "transitions": [
    { "id": "glass", "scene": "over_glass", "at": "clip:drop.start", "pre": 0.2, "post": 1.2 }
  ] }
```

- Clips form one ordered track. A clip ends at the `at` of the next clip, or at `to` when you set it.
- `params` go to the scene unchanged (`this.ctx.params`). One scene can serve several clips.
- `xfade` is the seconds of crossfade into the next clip. Most cuts are hard cuts on a beat.
- `transitions` (optional): "Over" transitions, decoupled from both clips. Each runs from `at - pre` to `at + post` and is drawn after the clips, on top of them. Its scene gets the composited clips as `f.under` and must draw them where it draws nothing (`f.p` runs 0..1 over its span, and `this.ctx.params.at` is the resolved `at`). An id must not be a clip id. `pve outline` lists them, and the studio shows them on the OVER lane.
- `overlay` (optional) names a scene file that draws over every clip.

## Time expressions

Use expressions, not seconds. Then a cut follows the song when the human re-times it.

| Target | Means |
|---|---|
| `12.5` | Seconds. |
| `@name` | A marker. |
| `clip:id.start`, `clip:id.end` | A clip edge. |
| `bar:12` | The 12th downbeat (1-based). |
| `beat:40` | Beat 40 (0-based). |
| `section:Chorus 1`, `section:Chorus 1.end` | A section edge. |
| `lyric:text`, `word:text`, `syl:text` | A line that contains the text, a word or a syllable that equals it. Add `.end` for the end. Add `#n` (0-based) when it matches more than once. |
| `end` | The end of the song. |

After the target: `@beat<=` snaps to the beat at or before it (20 ms tolerance), `@beat~` to the nearest beat, `@downbeat<=` and `@downbeat~` to downbeats. Then offsets: `+2b` (beats), `-1bar`, `+3f` (frames), `+0.1s`. `A || B` uses B when A does not resolve.

`pve find <text>` prints every match with an expression that resolves, and its distance from the beat.

## Scene contract

```ts
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '@pve/engine/scene';

export default class Drop extends Scene {
  override init() {}           // load and build resources once (`override` on every Scene method you write)
  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    // draw the whole of `out` (linear HDR) as a function of f.t
    return { bloom: 0.6 };
  }
}
```

- `f.t` song time, `f.lt` and `f.p` time and progress in the clip, `f.beat`, `f.bar`, `f.beatPhase`, `f.barPhase`.
- `f.a`: audio at `f.t`. Envelopes `rms`, `low`, `mid`, `high` exist in every song. `vocal`, `drums`, `bass`, `other` and the hits `kick`, `snare`, `hat`, `vonset` exist only when the song has them. `pve check` names each one that your scene reads and the song does not have.
- `this.ctx.lyrics.get('text')` finds a line. Use its word times. Do not type times into a scene. `this.ctx.lyrics.linesIn(this.ctx.start, this.ctx.end)` gives the lines of the clip.
- `this.ctx.audio`: `beats`, `downbeats`, `timeOfBeat(i)`, `events(kind, t0, t1)`, `env(name, t)`. `f.beat` and `f.bar` are continuous (12.5 is half way to beat 13).
- `this.ctx.assets` is the URL of `video/assets/`.

`docs/ENGINE.md` describes the drawing API: `FSPass`, `Layer2D`, `LineBatch`, the `GLSL_COMMON` functions with their signatures, the type and stroke fonts, the palette keys, the post overrides. Use these. `projects/breaked_neuro/video/scenes/verse.ts` and `chorus.ts` are complete scenes of about 300 lines. The `pdoom_original` scenes are longer and use more of the engine.

## Rules for scenes

1. A frame is a pure function of `f.t`. Do not use `Math.random`, `Date.now` or `performance.now`. Use `hash()`, `noise1()` or `mulberry32(seed)` from `@pve/engine/util`. `pve check` finds these calls.
2. The export renders each frame as the average of many sub-frames, in any order. A scene that keeps state from frame to frame must set `stateful = true`, reset in `reset()` and step with `f.dt`.
3. Lay out in logical 1920×1080 px (`W`, `H`). The engine scales to 4K.
4. Colours are linear. Use the palette: `rgba('signal')` in Canvas2D, `LIN.signal` for GL, `C_SIGNAL` in GLSL.
5. Write only your files (see Files).

## Budget

The median scene cost at preview scale must stay under 16.7 ms (60 fps live preview). `pve bench <clip>` prints the GPU time per frame (`median`, `p90`) and marks `OVER BUDGET`. Only the median counts. `wall med` adds the CPU work and the frame readback of the measurement. Measure before you add more work to a scene. Each Canvas2D layer costs a texture upload. Build geometry and text layouts in `init()`, not in `render()`.

## Evidence

- Say that a scene works only after you looked at a `pve look` or `pve still` PNG of it.
- Give the bench median of each scene that you changed.
- A command that fails prints the file, the JSON path or line, and the fix. Do the fix. Exit codes: 0 success, 1 error, 2 wrong arguments.
- Two commands that render wait for each other (one Chrome profile). Do not start renders in parallel.
