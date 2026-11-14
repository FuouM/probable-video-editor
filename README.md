# pve: Probable Video Editor

pve is an engine and studio for code-rendered music videos. Every frame is a deterministic function of song time. The live browser preview and the offline 1080p60 (or 4K60) export generate identical pixels.

The agent workflow is in [`skills/pve/SKILL.md`](skills/pve/SKILL.md).

| Video | Live in your browser | YouTube |
|---|---|---|
| `breaked_neuro` | [**Play**](https://fuoum.github.io/probable-video-editor/?project=breaked_neuro) | [**Watch in 4K**](https://www.youtube.com/watch?v=Tzy9nyStei8) |
| `god_ish` | [**Play**](https://fuoum.github.io/probable-video-editor/?project=god_ish) | [**Watch**](https://www.youtube.com/watch?v=J8DgUCVm_04) |
| `sardine` | [**Play**](https://fuoum.github.io/probable-video-editor/?project=sardine) | [**Watch**](https://www.youtube.com/watch?v=9vcmzFr_olU) |

## Projects

This repository contains four code-rendered music videos:

### 1. `breaked_neuro`
- **Watch**: [**Play it in your browser**](https://fuoum.github.io/probable-video-editor/?project=breaked_neuro) or [watch it on YouTube in 4K](https://www.youtube.com/watch?v=Tzy9nyStei8). Your browser draws every frame live to the song, so it is not a video file. It needs WebGL2, and a desktop GPU is best. A resolution list (0.5x, 1x, 2x) and fullscreen are in the player.
- **Track**: 200 BPM Neurofunk Drum & Bass (194.261 s duration).
- **Architecture**: 13 clips and 36 scene modules. Features hybrid GPU torus cellular automata, discrete CPU Conway boards, 3D Voronoi mirror shard fracture geometry, 2D sandstorm displacement particles, Droste recursion, and ASCII DOOM terminal rendering.
- **Making Of**: Read the comprehensive post-mortem paper in [`docs/making_of/breaked.md`](docs/making_of/breaked.md).
- **Web player**: how it is built and deployed is in [`docs/SITE.md`](docs/SITE.md).

### 2. `god_ish`
- **Watch**: [**Play it in your browser**](https://fuoum.github.io/probable-video-editor/?project=god_ish) or [watch it on YouTube](https://www.youtube.com/watch?v=J8DgUCVm_04). The player has subtitles (English, romaji and Japanese), a motion blur setting and a choice of face for the small English text.
- **Track**: "God-ish", 142 BPM with a 103 BPM interlude (3:22 duration).
- **Idea**: Every copy is a little less god, and the last copy becomes an original. The video moves through the eras of copying: manuscript, movable type, modernist print, risograph, a predicting machine, screens that re-save the page, reposts and text-ish glyphs. At the end the copying makes a script that no era had. Everything is procedural 2D type with rare 3D, and the type moves on syllables only. The treatment is in [`projects/god_ish/video/treatment.md`](projects/god_ish/video/treatment.md).
- **Architecture**: 13 clips and 6 transitions. Each era is a scene that copies the page of the era before it.
- **Making Of**: Read the comprehensive post-mortem paper in [`docs/making_of/god_ish.md`](docs/making_of/god_ish.md).

### 3. `sardine`
- **Watch**: [**Play it in your browser**](https://fuoum.github.io/probable-video-editor/?project=sardine) or [watch it on YouTube](https://www.youtube.com/watch?v=9vcmzFr_olU).
- **Track**: Koronba, "イワシがつちからはえてくるんだ" (A Sardine Grows from the Soil). A UTAU song, 135 BPM (170.667 s duration).
- **Idea**: A train simulator played too many times on the night before moving out. The sardine is the part of the player that is ready to leave. The game wears down like an old cartridge: every glitch is a fault of a game. The treatment is in [`projects/sardine/video/treatment.md`](projects/sardine/video/treatment.md).
- **Architecture**: 11 clips on one shared game world. Lit low-poly 3D at 640x360 with a Bayer dither, a cursor that moves like a human hand, Rapier physics baked at init, MIDI-driven lights, a datamosh with camera-only motion vectors and a world that unloads in chunks.
- **Making Of**: Read the post-mortem paper in [`docs/making_of/sardine.md`](docs/making_of/sardine.md).

### 4. `pdoom_original` - mexicat
- **Track**: "I'm Upping My P(doom)" (156.650 s duration).
- **Architecture**: 22 clips and 42 scene modules with word-synced karaoke typography, GPU line batches, raymarched rooms, and procedural Shoggoth iris shaders.
- **Treatment**: The creative concept and plate-by-plate treatment are in [`docs/TREATMENT.md`](docs/TREATMENT.md).
- **Video**: [Watch on YouTube](https://www.youtube.com/watch?v=5EoO5413dBY).

## Repository Layout

- `projects/<id>/` — Project workspaces (`breaked_neuro`, `god_ish`, `sardine`, `pdoom_original`). Each project holds timing files from Lyric-Sync, edit definitions in `video/video.json`, scene modules in `video/scenes/`, and assets in `video/assets/`.
- `packages/engine/` — `@pve/engine`: Three.js renderer core, post-processing pipeline (bloom, halation, grain, blur), typography, GPU line batches, HUD, and benchmark harness.
- `packages/core/` — `@pve/core`: Schema validation for `video.json`, time expression resolver, lyric queries, and project loader.
- `packages/cli/` — `@pve/cli`: Command-line tools for agents and human directors (`init`, `check`, `outline`, `find`, `at`, `scene new`, `still`, `look`, `board`, `probe`, `bench`, `perf`, `render`, `subs`, `notes`, `first-frame`, `gate`, `commit`, `doctor`).
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
- `god_ish`: http://localhost:5173/?project=god_ish
- `sardine`: http://localhost:5173/?project=sardine

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

# Write the subtitles for YouTube (--format ttml|srt|ass|ytt|all)
bun run pve subs -p god_ish --format all

# Replace the first frame of a video with an image (thumbnail for video platforms)
bun run pve first-frame video.mp4 thumbnail.jpg

# Render full video with automatic adaptive sampling and thumbnail replacement
bun run pve render -p god_ish --samples auto --first-frame projects/god_ish/site/thumbnail.jpg

# Run unified pre-commit checks (--quick runs typecheck and check in ~1.5s)
bun run pve gate -p god_ish --quick
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
- **`god_ish`**: "God-ish". Lyrics are in `projects/god_ish/user_input/` (`lyrics.map.json` holds the hand-written Japanese and English).
- **`sardine`**: "イワシがつちからはえてくるんだ" by Koronba. Original MV by Koronba. Timing from the UTAU projects and a fan MIDI. English is a fan translation.
- **Fonts**: Archivo, IBM Plex Mono, Cormorant Garamond, UnifrakturMaguntia, Pirata One, IM Fell English (SIL Open Font License). Single-stroke EMS and Hershey fonts (OFL and Public Domain).

## License

The code is released under the [MIT License](LICENSE). The fonts in `app/public/fonts/` keep their own licenses. Songs and lyrics belong to their respective authors.
