# pve: rules for agents

The engine guide and drawing APIs are in [`docs/ENGINE.md`](docs/ENGINE.md). The agent workflow is in [`skills/pve/SKILL.md`](skills/pve/SKILL.md).

## Evidence

- A task is done only when its acceptance command passed and the real engine produced the evidence (PNG, MP4, benchmark record). Never write a surrogate renderer, a copied golden, or a mock that a test accepts.
- Write what you ran in the commit message.
- Every change to `packages/engine` or to the `pdoom_original` scenes must pass `bun run golden` (max abs diff 0). A deliberate pixel change needs a new golden set that the human approves after a side-by-side look, in its own commit.
- A new effect (post pass, pipeline stage, drawing helper) and its benchmark entry go in the same commit. Each phase ends with one reference benchmark run in `bench/results.jsonl`.

## Scope

- pve does no audio analysis. Timing comes from a Lyric-Sync song folder. Never write song files (`user_input/`, `generated/`, `lyricsync/`) from pve code.
- `projects/pdoom_original/` keeps the original pdoom timing. Change its formats only, never its times.
- The engine has no project names. Project-only code lives in `projects/<id>/video/`.
- Do not add speculative engine features without a benchmark measurement that asks for them.

## Sources

- The old tree is the worktree `../probable-video-editor` (branch `feat/lyricsync-editor`). Copy files from it with file tools. Do not use `git show`, `git checkout` or `git restore` to put old files into this tree.
- Lyric-Sync is `../Lyric-Sync`. Changes there follow its own `AGENTS.md`.

## Commits and paths

- Commit only when the human asks.
- Never write absolute, machine-specific paths (drive letters, home folders) into code, tests, fixtures or docs.

## Windows

- `bun` in `Bun.spawn` can be a shim with the real `bun.exe` as a child. Stop a process tree with `taskkill /PID <pid> /T /F`.
- Chrome uses D3D11 ANGLE. Use the persistent profile in `out/cache/chrome-profile` so shaders do not compile again on each run.
- Run jobs longer than about a minute in the background with a log file, then read the log.

## Docs

- Write docs in STE-flavored English (ASD-STE100 structure rules): short sentences, active voice, no semicolons, one name for one thing.

## Setup

`@pve/core` reads song folders through the `lyricsync` package of the sibling repository `../Lyric-Sync`. The link is `link:lyricsync`. Do these steps once on each machine, in this order:

1. In `../Lyric-Sync`: `bun install`.
2. In `../Lyric-Sync/packages/lyricsync`: `bun link`.
3. In this repository: `bun install`.

## Commands

### General CLI and Engine

| Command | Does |
|---|---|
| `bun run pve <command> -p <id>` | The unified CLI. Run `bun run pve help` to list all subcommands. `skills/pve/SKILL.md` documents the agent workflow. |
| `bun run pve check -p <id>` | Lint inputs, `video.json`, expressions, and scene files. Use `--watch` to check again on file changes. |
| `bun run pve at -p <id> "<where>"` | Locate a bar, frame, time, lyric or range as JSON lines. See `docs/LYRICMAP.md`. |
| `bun run pve still -p <id> <times>` | Render stills at times or ranges (`--step s`, `--transition <id>`). |
| `bun run pve look -p <id> [clips\|cuts\|range]` | Render contact sheet boards with timestamps and bar numbers. |
| `bun run pve board <scene-file> -p <id>` | Render a standalone exploratory board or cover scene (such as `video/scenes/thumbnail.ts`) to PNG. |
| `bun run pve subs -p <id>` | Export synchronized YouTube and offline subtitles (`--format ttml\|srt\|all`, default `ttml`). |
| `bun run pve first-frame <video> <image>` | Replace frame 0 of a video file with a cover image. Copies audio untouched and encodes video with x264. |
| `bun run pve perf <clip> -p <id>` | Play clips in real time and report CPU frame times and missed frames. |
| `bun run pve render -p <id>` | Render full video or ranges (`--samples auto`, `--shutter s`, `--first-frame <image>`). |
| `bun run pve notes -p <id> [filter]` | List and filter open review notes from `video/notes.json` and `video/notes/*.md`. |
| `bun run pve gate -p <id>` | Run all pre-commit checks in parallel. Stops at the first failure (`--quick`, `--only <step,...>`, `--golden auto\|always\|never`, `--skip <step,...>`). |
| `bun run pve commit -p <id> -m "<msg>"` | Run the gate, then commit project files and explicit `--paths` only (`--push` pushes to origin). Commit only when the human asks. |

### Repository Verification

| Command | Does |
|---|---|
| `bun install` | Install all workspaces (`packages/*`, `app`) from the root. |
| `bun run typecheck` | Type-check the engine, core, CLI, app, project scenes, and root scripts. |
| `bun test` | Run all unit tests (core, CLI, bench coverage, timeline parity). |
| `bun run golden` | Compare one still per timeline entry with `tests/golden/` (max abs diff 0). |
| `bun run determinism` | Render 100 seeded times in order and shuffled, then compare pixels. |
| `bun run bench` | Run reference GPU workload in headless Chrome and append to `bench/results.jsonl`. |
| `bun run verify-export -- --project <id>` | Check full render export integrity (decode, duration, video size, fps, AAC). |

### Web Player and Static Site

| Command | Does |
|---|---|
| `cd app && bunx --bun vite` | Serve live preview at `http://localhost:5173/?project=<id>` (`&t=40` starts at 40 s). |
| `bun run site:data -- <project>` | Write static player data to `projects/<id>/site/` (`--keep-audio` keeps existing MP3). See `docs/SITE.md`. |
| `bun run site:build` | Build the static web player into `out/site/`. Fails if the data snapshot is stale. |
| `bun run site:preview` | Serve `out/site/` at `http://localhost:4173`. |

### Project-Specific Scripts

| Command | Does |
|---|---|
| `bun projects/pdoom_original/video/make-plates.ts` | Render the plate stills of the outro rewind montage for `pdoom_original` into `video/assets/plates/`. |
