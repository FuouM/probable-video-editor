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

| Command | Does |
|---|---|
| `bun install` | Install all workspaces (`packages/*`, `app`) from the root. |
| `bun run typecheck` | Type-check the engine, core, the CLI, the app, the project scenes and the root scripts. |
| `bun run golden` | Compare one still per timeline entry with `tests/golden/` (max abs diff 0). |
| `bun run determinism` | Render 100 seeded times in order and shuffled. Compare the pixels. |
| `bun run bench` | `pve bench -p pdoom_original`: the reference GPU workload in headless Chrome. Append one line per benchmark to `bench/results.jsonl` (`-- --dry` prints only; names filter it; `--no-scenes`, `--n`, `--out`; `--compare <commit|tag|last>` marks changes above 10 % and above the spread). |
| `bun test` | Run the unit tests (core, CLI, bench coverage, `pdoom_original` timeline parity). |
| `bun run pve <command> -p <id>` | The CLI: `init`, `check`, `outline`, `find`, `scene new`, `still`, `look`, `bench`, `render`, `notes`, `doctor`. `bun run pve help` lists them. The agent loop is in `skills/pve/SKILL.md`. |
| `bun run verify-export -- --project <id>` | Check a full render: decode, duration, video size and fps, AAC. |
| `cd app && bunx --bun vite` | Preview at http://localhost:5173/?project=pdoom_original (`&t=40` starts at 40 s). |
| `bun projects/pdoom_original/video/make-plates.ts` | Render the plate stills of the outro's rewind montage into `video/assets/plates/`. |
