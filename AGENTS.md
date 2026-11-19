# pve: rules for agents

The engine guide and drawing APIs are in [`docs/ENGINE.md`](docs/ENGINE.md). The agent workflow is in [`skills/pve/SKILL.md`](skills/pve/SKILL.md).

## Evidence

- A task is done only when its acceptance command passed and the real engine produced the evidence (PNG, MP4, benchmark record). Never write a surrogate renderer, a copied golden, or a mock that a test accepts.
- Write what you ran in the commit message.
- Every change to `packages/engine` or to the `pdoom_original` scenes must pass `bun run golden`. The rule: max diff 0 for each still. One exception: a still that differs by 1 level in at most 2 pixels renders once more, and the second render must have max diff 0 (the GPU can round a float 1 level apart on a single pixel). A deliberate pixel change needs a new golden set that the human approves after a side-by-side look, in its own commit.
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

- **Render server first:** at the start of a session run `bun run pve serve status`, and `bun run pve serve start` when none runs. With it, every command skips the start of Vite and Chrome, and `still`, `look`, `probe`, `seam` and `nan` reuse a warm page of the same clips: a still takes about 1 s instead of 5 s. A source file that is newer than a warm page makes the command boot a new page, so edits always show. It stops by itself after 30 min without a command (`--idle <min>`). `bun run pve serve stop` stops it. It serves one ANGLE backend: a command with another `PVE_ANGLE` starts its own Chrome.
- **Render server and VRAM:** each warm page holds a whole engine in GPU memory, and the pages of a long session can fill the GPU. The main agent may keep its server between tasks. A subagent never starts, uses or stops the server: it runs every command with `PVE_NO_SERVE=1`, so each command starts its own Chrome and frees it when it ends. Stopping the server would also stop the main agent's pages.

Each message turn re-reads the full conversation context from prompt cache (often 100k to 200k tokens per turn). Chain commands and batch tool calls to save turns:

- **Loop seam:** run `bun run pve seam -p <id>`. Never write throwaway Python image diff scripts.
- **Order faults:** when `bun run determinism` fails or a still changes between renders, run `bun run pve order -p <id> <time> ...`. Never write throwaway probe scripts for the page.
- **Black dots and blocks:** when a still shows a black dot or a black block (or only one browser setup shows it), run `bun run pve nan -p <id> <time>` (add `PVE_ANGLE=gl` for ANGLE over OpenGL). It names the draw call and the scene file line that write NaN or Inf. Never bisect a shader with throwaway colour probes before it.
- **Review stills:** run `bun run pve still -p <id> <times...> --sheet <out.png>`. It renders the stills and compiles an annotated contact sheet in one browser run. Read that one image. Never write Python PIL grid scripts.
- **Pre-commit checks:** run `bun run pve gate -p <id>`. It runs all workspace typechecks, the project linter and unit tests in parallel in ~7 s. Never run them as separate tool calls.
- **Commits:** run `bun run pve commit -p <id> -m "<msg>" --paths <a>,<b>`. It runs the gate and commits `projects/<id>/` and the listed paths in one command. Separate the paths with commas, not spaces. Never run separate `git add`, `git commit`, `git status`, `git log` turns.
- **CLI help:** every command accepts `--help` and `-h` (such as `bun run pve look --help` or `bun run pve help look`). Never guess command options.
- **Batch tool calls:** issue independent tool calls (`read`, `grep`, `edit`) in the same turn. Never serialize independent reads across multiple turns.

## Windows

- `bun` in `Bun.spawn` can be a shim with the real `bun.exe` as a child. Stop a process tree with `taskkill /PID <pid> /T /F`.
- Chrome uses D3D11 ANGLE. Persistent profiles (a pool of 8 in `out/cache/chrome-profile`, `-1` to `-7`) keep compiled shaders between runs. A command takes the first free profile and fails at once when all are busy: it never waits. A stuck page fails the command after `PVE_READY_TIMEOUT` (boot, default 60 s) or `PVE_FRAME_TIMEOUT` (one frame, default 30 s).
- Run a command that can take longer than about a minute (`look`, `render`, `bench`, `perf`, `gate`) as a job: `bun run pve job <command> [args] [--wait]` runs in the background with a hidden console (no windows pop up or steal focus). With `--wait` it blocks until the job ends, prints the log and exits with the job's code in one command. Without `--wait` it returns at once with the job id: block later with `bun run pve wait [id]`. Exit 3 means still running after timeout (default 175 s): call wait again. Do not sleep for a fixed time.

## UI (studio and player)

- The studio and the player use SoulWindow (`soulwindow` in `app/package.json`). Import it. Never copy its CSS or components into `app/`.
- Put pve CSS in `app/src/ui/styles/` or `app/site/player.css`, in `@layer app`. Do not write unlayered rules or `!important` to win a specificity fight.
- Take colours from tokens (`--sys-*`, `--sw-*`, `--tl-*`, `--perf-*`). Literal colours live only in `app/src/ui/styles/tokens.css` and in the player's subtitle overlay (it is part of the picture). Canvas code reads tokens with `readTokens()`, at start and in `onTheme()`, never per frame.
- Take sizes from density tokens and z-index from `--z-*`.
- Use the SoulWindow primitive first (`.win-button`, `.group-box`, `.ds-modal-*`, `.daw-chip`, `.daw-tbtn`, `seekBar()`). When Lyric-Sync and pve need the same new part, add it to SoulWindow first, tag a release, then update both apps.

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
| `bun run pve <command> -p <id>` | The unified CLI. Run `bun run pve help` to list all subcommands. `bun run pve help <command>` (or `--help`) lists the options of a command, each with its description. `skills/pve/SKILL.md` documents the agent workflow. |
| `bun run pve init <song folder>` | Make `projects/<id>/` from a finished Lyric-Sync song folder, with a storyboard `video.json` (one clip per section). |
| `bun run pve doctor` | Check Bun, ffmpeg, Chrome, the GPU, timer query support, the Lyric-Sync link and Vite. |
| `bun run pve outline -p <id> [clip...]` | Print the resolved edit and the song: clips, markers, sections, lyric lines and notes, with times and bar.beat. |
| `bun run pve find -p <id> <text>` | Find lyric lines, words, syllables, sections, markers and clips that match, each with a time expression. |
| `bun run pve scene new <name> -p <id>` | Write `video/scenes/<name>.ts` from the scene template. |
| `bun run pve check -p <id>` | Lint inputs, `video.json`, expressions, and scene files. Use `--watch` to check again on file changes. |
| `bun run pve kit -p <id>` | Write `video/KIT.md`: an index of the scene modules (purpose, exports with `file:line` and doc, importers). Read it before you search the scene modules. `pve check` warns when it is out of date. `--check` only tests it. |
| `bun run pve at -p <id> "<where>"` | Locate a bar, frame, time, lyric or range as JSON lines. See `docs/LYRICMAP.md`. |
| `bun run pve aup <file.aup> -p <id>` | Read an AviUtl project and write `video/assets/timeline.json` (sprites, sheet grids, texts, sections). `--skip <files>` leaves out image files. See `docs/AVIUTL.md`. |
| `bun run pve assets pack\|fetch -p <id>` | `pack` writes `video/assets.json` (SHA-256 of each file of `video/assets/`) and prints the `gh release upload` command. `fetch` downloads the missing files from the release `<id>-assets` and checks them. See `docs/AVIUTL.md`. |
| `bun run pve still -p <id> <times>` | Render stills at times or ranges (`--step s`, `--transition <id>`, `--sheet <out.png>`, `--cols n`, `--crop x,y,w,h`, `--precision float`). `--sheet` compiles the stills into a labeled contact sheet grid in one step. `--crop` makes each tile one part of the frame (1920x1080 px), zoomed in whole pixels: use it to check UI details. `--precision float` renders with 32-bit HDR targets: use it when you compare stills by pixel (see "Precision" in `docs/ENGINE.md`). Never write image crop scripts. |
| `bun run pve look -p <id> [clips\|cuts\|range]` | Render contact sheet boards with timestamps and bar numbers. |
| `bun run pve diff <a.png> <b.png>` | Compare two PNGs: prints mean channel diff, max diff, differing px (`--tol n`, default 0). |
| `bun run pve seam -p <id>` | Render frame 0 and frame (duration - 1/fps) and compare them in one command (`--tol n`, default 0.28). |
| `bun run pve probe -p <id> <time\|from..to>` | Numbers instead of stills. Lists the named objects of scenes (`mark`) at times. `--target <name>` tracks one object. `--cams` gives the main camera per frame (position, yaw/pitch/roll, lens, step from the frame before), `--jumps` keeps only the frames where a step stands out, `--metrics` prints the values that scenes report. Use it to check motion and seams. |
| `bun run pve order -p <id> <target> [times]` | Find the frame that leaves state behind: render the target on a new page, then again after the other times, and compare. `--seed n --chain` replays the order of the determinism check, `--bisect` shortens the list, `--precision float` tells the GPU's 16-bit blend rounding from an order fault, `--draws` / `--outputs` / `--watch <call>` compare the draw calls, `--culprit --good <time>` leaves draw calls out until the target is right. Run `--help` first. |
| `bun run pve nan -p <id> <time\|from..to>` | Find the draw call that writes NaN or Inf into a float target (a black dot or block after the next 8-bit pass). A GPU pass checks the target after each draw, so a frame takes about as long as a normal render. Prints the first source: its target, material, block box in frame px and the scene file line that called it. `--at x,y` follows one point through every draw. |
| `bun run pve board <scene-file> -p <id>` | Render a standalone exploratory board or cover scene (such as `video/scenes/thumbnail.ts`) to PNG. `--at a,b,c --sheet <out.png>` makes one labeled contact sheet with a tile for each time (`--cols n`): use it for a scene that shows another candidate at each time. |
| `bun run pve props <props-file> -p <id> [model...]` | Render the models of a scene module alone: one row per model, one tile per view (front, back, side, top, wire) under a neutral studio light on a grid, labelled with the size in metres and the triangles. The module names its models in a `PropTable` and default-exports `propBoard(table)` (`@pve/engine/props`). `--views a,b`, `--cols n`, `--crop x,y,w,h`, `--sheet <out.png>` (default `<project>/out/props/<file>.png`). |
| `bun run pve subs -p <id>` | Export synchronized YouTube and offline subtitles (`--format ttml\|srt\|ass\|ytt\|all`, default `ttml`). The cue model and the writers are in `lyricsync/formats`. |
| `bun run pve first-frame <video> <image>` | Replace frame 0 of a video file with a cover image. Copies audio untouched and encodes video with NVENC on the GPU (`--encoder nvenc\|x264`, `--crf`, `--preset`, `--out`). |
| `bun run pve bench -p <id> [clip...\|effect...]` | GPU benchmark of the effects and clips, or the named ones. Appends to `bench/results.jsonl`. `--board <files>` also benchmarks scene files that `video.json` does not name. |
|`bun run pve perf [clip...] -p <id>`|Play clips in real time and report CPU frame times and missed frames (`--from/--to <time\|bar\|expr>`, `--step n`, `--frames`, `--slow <ms>`, `--profile`, `--gpu-canvas`). `--draws` counts, per frame, the render calls, the draw calls and the program lookups of three by cause. Do not read times from a run with `--draws`.|
|`bun run pve job <command> [args]`|Start a pve command in the background with a log in `out/jobs/` (`--wait` blocks until done and prints the log in one turn).|
|`bun run pve serve start\|stop\|status`|The render server: a dev server and a headless Chrome that stay up between commands (`out/cache/serve.json`). Commands find it and use it. `still`, `look`, `probe`, `seam` and `nan` reuse warm pages. `status` lists its pages. `PVE_NO_SERVE=1` makes a command start its own Chrome.|
|`bun run pve wait [id]`|Block until the job (default: the newest) ends, then print its log and exit with its code. Exit 3 when it still runs after `--timeout s` (default 175).|
|`bun run pve chat <action> -p <id>`|A chat room between agents of other harnesses and the human, in `projects/<id>/out/chat/<room>.jsonl` (git ignores it). `send --as <me> [--to <who>] -m <text>` (`-m -` reads stdin, `--file <md>`, `--files a,b`, `--needs-human`). `wait --as <me>` blocks until a message for you comes, prints it and moves your cursor. Exit 3 after `--timeout s` (default 175, `0` waits with no end): call wait again. `read` (`--unread --as <me>`, `--last n`, `--all`), `status`, `clear`. `--room <name>` (default `main`).|
| `bun run pve render -p <id>` | Render full video or ranges (`--from/--to`, `--samples auto`, `--shutter s`, `--first-frame <image>`). Lossless segments per clip, then one encode on the GPU (`--encoder x264` encodes on the CPU). |
| `bun run pve notes -p <id> [filter]` | List and filter open review notes from `video/notes.json` and `video/notes/*.md`. |
| `bun run pve gate -p <id>` | Run all pre-commit checks in parallel. Stops at the first failure (`--quick`, `--only <step,...>`, `--golden auto\|always\|never`, `--skip <step,...>`, `--keep-going`). |
| `bun run pve commit -p <id> -m "<msg>"` | Run the gate, then commit `projects/<id>/` and the `--paths` only (comma-separated: `--paths a,b`). `--dry` prints the files. `--push` pushes to origin. Commit only when the human asks. |

### Repository Verification

| Command | Does |
|---|---|
| `bun install` | Install all workspaces (`packages/*`, `app`) from the root. |
| `bun run typecheck` | Type-check the engine, core, CLI, app, project scenes, and tests. |
| `bun test` | Run all unit tests (core, CLI, bench coverage, timeline parity). |
| `bun run golden` | Runs `pve golden`: compare one still of `pdoom_original` per timeline entry with `tests/golden/` (max diff 0, with the 1-level retry of "Evidence"). `-- --capture` writes the files. Fails when the page logs an error. |
| `bun run determinism` | Runs `pve determinism`: render 100 seeded times in order and shuffled, then compare pixels (`-p <id>`, default `pdoom_original`, `--n`, `--seed`, `--precision both\|float\|half`, default `both`). A difference at 32-bit HDR precision is an order fault and fails. A difference at 16 bits only is the blend rounding of the GPU: the check reports it and passes. A page that logs an error fails the check. See "Precision" in `docs/ENGINE.md`. |
| `bun run bench` | Run the reference GPU workload (`pve bench -p pdoom_original`) in headless Chrome and append to `bench/results.jsonl`. |
| `bun run verify-export -- -p <id>` | Runs `pve verify-export`: check the full render export (decode, duration, video size, fps, AAC). `--input <mp4>` checks another file. |

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
