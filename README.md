# pve: Probable Video Editor

pve is an engine and studio for code-rendered music videos. Every frame is a deterministic function of song time. The live browser preview and the offline 1080p60 (or 4K60) export generate identical pixels.

The agent workflow is in [`skills/pve/SKILL.md`](skills/pve/SKILL.md).

**[Watch `breaked_neuro` live in your browser](https://fuoum.github.io/probable-video-editor/)**

## Projects

This repository contains two code-rendered music videos:

### 1. `breaked_neuro`
- **Watch**: [**Play it in your browser**](https://fuoum.github.io/probable-video-editor/). Your browser draws every frame live to the song, so it is not a video file. It needs WebGL2, and a desktop GPU is best. A resolution list (0.5x, 1x, 2x) and fullscreen are in the player.
- **Track**: 200 BPM Neurofunk Drum & Bass (194.261 s duration).
- **Architecture**: 13 clips and 36 scene modules. Features hybrid GPU torus cellular automata, discrete CPU Conway boards, 3D Voronoi mirror shard fracture geometry, 2D sandstorm displacement particles, Droste recursion, and ASCII DOOM terminal rendering.
- **Making Of**: Read the comprehensive post-mortem paper in [`docs/BREAKED_NEURO_MAKING_OF.md`](docs/BREAKED_NEURO_MAKING_OF.md).
- **Web player**: how it is built and deployed is in [`docs/SITE.md`](docs/SITE.md).

### 2. `pdoom_original` - mexicat
- **Track**: "I'm Upping My P(doom)" (156.650 s duration).
- **Architecture**: 22 clips and 42 scene modules with word-synced karaoke typography, GPU line batches, raymarched rooms, and procedural Shoggoth iris shaders.
- **Treatment**: The creative concept and plate-by-plate treatment are in [`docs/TREATMENT.md`](docs/TREATMENT.md).
- **Video**: [Watch on YouTube](https://www.youtube.com/watch?v=5EoO5413dBY).

## Repository Layout

- `projects/<id>/` — Project workspaces (`breaked_neuro`, `pdoom_original`). Each project holds timing files from Lyric-Sync, edit definitions in `video/video.json`, scene modules in `video/scenes/`, and assets in `video/assets/`.
- `packages/engine/` — `@pve/engine`: Three.js renderer core, post-processing pipeline (bloom, halation, grain, blur), typography, GPU line batches, HUD, and benchmark harness.
- `packages/core/` — `@pve/core`: Schema validation for `video.json`, time expression resolver, lyric queries, and project loader.
- `packages/cli/` — `@pve/cli`: Command-line tools for agents and human directors (`init`, `check`, `outline`, `find`, `scene new`, `still`, `look`, `probe`, `bench`, `render`, `notes`, `doctor`).
- `app/` — Web application: Bun and Vite NLE studio, program monitor, transport with audio metronome, canvas timeline, inspector, notes pins, and WebCodecs export.
- `tests/` — Golden image regression tests and timeline parity test suites.

## Requirements

- [Bun](https://bun.sh) (v1.4+)
- Google Chrome (headless renderer driven via playwright-core)
- FFmpeg (with libx264 and AAC support)
- Sibling repository `../Lyric-Sync` (see Setup in `AGENTS.md`)

## Studio and Preview

Launch the web studio with Vite:

```sh
bun install
cd app
bunx --bun vite
```

Open the studio in your browser:
- `breaked_neuro`: http://localhost:5173/?project=breaked_neuro
- `pdoom_original`: http://localhost:5173/?project=pdoom_original

Add `&t=40` to start at 40 seconds. Add `&scale=2` to preview at 4K resolution.

### Studio Keyboard Shortcuts

| Key | Action |
|---|---|
| Space | Play or pause |
| Left / Right | Seek ±1 s (±5 s with Shift) |
| `,` / `.` | Step one frame backward or forward |
| `[` / `]` | Jump to previous or next timeline clip |
| `l` | Loop current clip |
| `h` | Toggle UI visibility |

## CLI Commands

Run commands from the repository root:

```sh
# Verify project schema, expressions, and banned calls
bun run pve check -p breaked_neuro

# Inspect timeline clips, markers, sections, and notes
bun run pve outline -p breaked_neuro

# Render full-resolution still frames
bun run pve still 38.68 @drop lyric:fall -p breaked_neuro

# Render contact sheet boards for review
bun run pve look cuts -p breaked_neuro
bun run pve look mirror -p breaked_neuro

# Run GPU performance benchmark
bun run pve bench -p breaked_neuro

# Render video range
bun run pve render --from @hook1 --to @room -p pdoom_original

# Render full video with automatic adaptive sampling
bun run pve render -p breaked_neuro --samples auto --shutter 0.2
```

## Render Pipeline

The render pipeline operates in two stages:
1. **Render**: Headless Chrome renders chunks of frames. Chrome streams raw frames over WebSocket to FFmpeg workers. Workers write lossless FFV1 segments in Matroska containers (`yuv420p` BT.709).
2. **Encode**: FFmpeg concatenates the segments and encodes the final H.264 MP4 with AAC audio on the GPU (`h264_nvenc -preset p7 -tune hq -cq 16`). Use `--encoder x264` to encode on the CPU.

In the studio UI, users can also export directly to MP4 using browser WebCodecs hardware encoding.

## Verification

The engine protects determinism and visual stability with automated tests:

```sh
# Typecheck all packages, app, and project scenes
bun run typecheck

# Unit tests and timeline parity checks
bun test

# Compare timeline stills with golden references (max abs diff 0)
bun run golden

# Seek determinism test across 100 random timestamps
bun run determinism
```

## Credits

- **`breaked_neuro`**: Neurofunk Drum & Bass track, 200 BPM. Video written and directed with autonomous coding agents.
- **`pdoom_original`**: "I'm Upping My P(doom)". Lyrics by osmarks and MusicPerson. Sung version by deckard.
- **Fonts**: Archivo, IBM Plex Mono, Cormorant Garamond (SIL Open Font License). Single-stroke EMS and Hershey fonts (OFL and Public Domain).

## License

The code is released under the [MIT License](LICENSE). The fonts in `app/public/fonts/` keep their own licenses. Songs and lyrics belong to their respective authors.
