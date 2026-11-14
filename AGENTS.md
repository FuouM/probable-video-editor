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
## Token efficiency

Each message turn re-reads the full conversation context from prompt cache (often 100k to 200k tokens per turn). Chain commands and batch tool calls to save turns:

- **Loop seam:** run `bun run pve seam -p <id>`. Never write throwaway Python image diff scripts.
- **Order faults:** when `bun run determinism` fails or a still changes between renders, run `bun run pve order -p <id> <time> ...`. Never write throwaway probe scripts for the page.
- **Review stills:** run `bun run pve still -p <id> <times...> --sheet <out.png>`. It renders the stills and compiles an annotated contact sheet in one browser run. Read that one image. Never write Python PIL grid scripts.
- **Long jobs:** run `bun run pve job <command> [args] --wait`. It runs with a hidden console and returns the output in one turn. Never sleep for a fixed time in eval.
- **Pre-commit checks:** run `bun run pve gate -p <id>`. It runs all workspace typechecks, the project linter and unit tests in parallel in ~7 s. Never run them as separate tool calls.
- **Commits:** run `bun run pve commit -p <id> -m "<msg>"`. It runs the gate and commits in one command. Never run separate `git add`, `git commit`, `git status`, `git log` turns.
- **CLI help:** every command accepts `--help` and `-h` (such as `bun run pve look --help` or `bun run pve help look`). Never guess command options.
- **Batch tool calls:** issue independent tool calls (`read`, `grep`, `edit`) in the same turn. Never serialize independent reads across multiple turns.


## Windows

- `bun` in `Bun.spawn` can be a shim with the real `bun.exe` as a child. Stop a process tree with `taskkill /PID <pid> /T /F`.
- Chrome uses D3D11 ANGLE. Persistent profiles (a pool of 8 in `out/cache/chrome-profile`, `-1` to `-7`) keep compiled shaders between runs. A command takes the first free profile and fails at once when all are busy: it never waits. A stuck page fails the command after `PVE_READY_TIMEOUT` (boot, default 60 s) or `PVE_FRAME_TIMEOUT` (one frame, default 30 s).
- Run a command that can take longer than about a minute (`look`, `render`, `bench`, `perf`, `gate`) as a job: `bun run pve job <command> [args] [--wait]` runs in the background with a hidden console (no windows pop up or steal focus). With `--wait` it blocks until the job ends, prints the log and exits with the job's code in one command. Without `--wait` it returns at once with the job id: block later with `bun run pve wait [id]`. Exit 3 means still running after timeout (default 175 s): call wait again. Do not sleep for a fixed time.

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
| `bun run pve kit -p <id>` | Write `video/KIT.md`: an index of the scene modules (purpose, exports with `file:line` and doc, importers). Read it before you search the scene modules. `pve check` warns when it is out of date. `--check` only tests it. |
| `bun run pve at -p <id> "<where>"` | Locate a bar, frame, time, lyric or range as JSON lines. See `docs/LYRICMAP.md`. |
| `bun run pve aup <file.aup> -p <id>` | Read an AviUtl project and write `video/assets/timeline.json` (sprites, sheet grids, texts, sections). `--skip <files>` leaves out image files. See `docs/AVIUTL.md`. |
| `bun run pve assets pack\|fetch -p <id>` | `pack` writes `video/assets.json` (SHA-256 of each file of `video/assets/`) and prints the `gh release upload` command. `fetch` downloads the missing files from the release `<id>-assets` and checks them. See `docs/AVIUTL.md`. |
| `bun run pve still -p <id> <times>` | Render stills at times or ranges (`--step s`, `--transition <id>`, `--sheet <out.png>`, `--cols n`, `--crop x,y,w,h`, `--precision float`). `--sheet` compiles the stills into a labeled contact sheet grid in one step. `--crop` makes each tile one part of the frame (1920x1080 px), zoomed in whole pixels: use it to check UI details. `--precision float` renders with 32-bit HDR targets: use it when you compare stills by pixel (see "Precision" in `docs/ENGINE.md`). Never write image crop scripts. |
| `bun run pve look -p <id> [clips\|cuts\|range]` | Render contact sheet boards with timestamps and bar numbers. |
| `bun run pve diff <a.png> <b.png>` | Compare two PNGs: prints mean channel diff, max diff, differing px (`--tol n`, default 0). |
| `bun run pve seam -p <id>` | Render frame 0 and frame (duration - 1/fps) and compare them in one command (`--tol n`, default 0.28). |
| `bun run pve order -p <id> <target> [times]` | Find the frame that leaves state behind: render the target on a new page, then again after the other times, and compare. `--seed n --chain` replays the order of the determinism check, `--bisect` shortens the list, `--precision float` tells the GPU's 16-bit blend rounding from an order fault, `--draws` / `--outputs` / `--watch <call>` compare the draw calls, `--culprit --good <time>` leaves draw calls out until the target is right. Run `--help` first. |
| `bun run pve board <scene-file> -p <id>` | Render a standalone exploratory board or cover scene (such as `video/scenes/thumbnail.ts`) to PNG. `--at a,b,c --sheet <out.png>` makes one labeled contact sheet with a tile for each time (`--cols n`): use it for a scene that shows another candidate at each time. |
| `bun run pve subs -p <id>` | Export synchronized YouTube and offline subtitles (`--format ttml\|srt\|ass\|ytt\|all`, default `ttml`). The cue model and the writers are in `lyricsync/formats`. |
| `bun run pve first-frame <video> <image>` | Replace frame 0 of a video file with a cover image. Copies audio untouched and encodes video with x264. |
|`bun run pve perf [clip...] -p <id>`|Play clips in real time and report CPU frame times and missed frames (`--from/--to <time\|bar\|expr>`, `--step n`, `--frames`, `--slow <ms>`, `--profile`, `--gpu-canvas`). `--draws` counts, per frame, the render calls, the draw calls and the program lookups of three by cause. Do not read times from a run with `--draws`.|
|`bun run pve job <command> [args]`|Start a pve command in the background with a log in `out/jobs/` (`--wait` blocks until done and prints the log in one turn).|
|`bun run pve wait [id]`|Block until the job (default: the newest) ends, then print its log and exit with its code. Exit 3 when it still runs after `--timeout s` (default 175).|
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
| `bun run determinism` | Render 100 seeded times in order and shuffled, then compare pixels (`--project <id>`, `--n`, `--seed`, `--precision both\|float\|half`, default `both`). A difference at 32-bit HDR precision is an order fault and fails. A difference at 16 bits only is the blend rounding of the GPU: the check reports it and passes. See "Precision" in `docs/ENGINE.md`. |
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
