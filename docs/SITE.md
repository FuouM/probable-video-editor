# The web player (GitHub Pages)

The site plays the videos of this repository in real time: `breaked_neuro` and `god_ish`. The visitor's browser runs the engine and draws every frame to the song. The site holds no video file. The page looks like the studio (`app/src/ui/daw.css`) and has no timeline or editor.

## Controls

| Control | Does |
|---|---|
| Play / pause (Space, K, click on the picture) | Starts and stops the song and the picture. |
| Seek bar | Click or drag to go to a time. A tick marks the start of each section. |
| Start, previous section, next section (Home, PageUp, PageDown) | Jump in the song. |
| Arrow left and right, J | Go back 5 s, go on 5 s, go back 10 s. |
| Keys 0 to 9 | Go to 0 % to 90 % of the song. |
| Loop (L) | Plays the song again from the start when it ends. |
| Volume, mute (Arrow up and down, M) | Set the volume. |
| CC (C) and the language list | Show the subtitles. See "Subtitles". |
| VIDEO | Opens another video. The page loads again (see "Videos"). |
| Project options (`EN FONT` for god_ish) | See "Project options". |
| SPEED (`<` and `>`) | 0.5x to 2x. The song plays faster or slower with its pitch. |
| BLUR | Off, 4 or 12 sub-frames of motion blur. See "Motion blur". |
| RES | 0.5x (960 x 540), 1x (1920 x 1080) or 2x (3840 x 2160). |
| Fullscreen (F, double click on the picture) | Shows the picture and the transport bar full screen. |

In fullscreen the bar is always hidden. It shows only while the pointer is over the bottom edge of the picture, and it hides at once when the pointer leaves. It shows the video, the output size, the frames per second and the CPU time of one frame (the group box title does that outside fullscreen).

## Loading screen

One box (`app/src/ui/loader.ts`, `.ld-*` in `daw.css`) in the start dialog of the player and in the monitor of the studio. It shows four steps: project data, fonts, scenes and audio. Each scene has a chip that turns green when the scene is ready. One bar covers all steps and never moves back. The studio waits for the decoded audio too. A failed step turns red and shows its message.

## Videos

A video is a project. The page without `?project=` shows only the cover cards of the videos ("Choose a video") and loads nothing. A card opens `?project=<id>`, which loads that video and shows its Play button. The palette of a project is baked into the engine modules, so a change of video loads the page again. The cover is `projects/<id>/site/thumbnail.jpg`. The page keeps `?scale=`.

The PVE PLAYER mark at the top left is a link to that page, so a visitor can choose again. It keeps `?scale=`.

## Motion blur

The offline render blurs by drawing sub-frames and averaging them. The player draws one sample by default. The BLUR list asks for 4 or 12 sub-frames (`Engine.render` in adaptive mode, shutter 0.5 of a frame of the film, so the blur is as wide as in the render). The caps in `video.json` still apply: a clip with `samples.max` 1 stays sharp and costs one sample. In god_ish that is every clip, so only the transitions blur (`feed`, `forme`). The choice stays in the browser.

Cost: each blurred frame draws once per sub-frame. In a transition of god_ish on headless software GL the CPU time of one frame went from 3.5 ms (no blur) to 7 to 9 ms (4 or 12 samples). A clip that is capped at 1 sample costs the same as without blur. Adaptive sampling needs scenes without state between frames (`Scene.stateful`). No scene of the two videos has state.

## Subtitles

`projects/<id>/site/subtitles.json` holds the tracks. `app/scripts/subtitles.ts` makes them from the calibrated lyrics. Nothing is translated or aligned again: each token has the time of the unit it comes from.

| Song | Tracks |
|---|---|
| No lyric map (`breaked_neuro`) | English: the words. |
| Lyric map (`god_ish`, `user_input/lyrics.map.json`) | English: the phrases of the map. Romaji: the words. Japanese: the glyph units of the map. |

The line shows 0.25 s before its first token and 0.7 s after its last. A token that is sung now is yellow, a token that was sung is white, and a token to come is dim. English phrases are in reading order, so their highlight can jump in a line. The choice (on or off, and the language of each video) stays in the browser.

## Project options

A project can offer choices to the viewer. It exports `options` from `projects/<id>/video/player.ts` (type `PlayerOption`, `packages/engine/src/options.ts`). The player shows one list for each option and remembers the choice. `apply` changes the state that the scenes read and names the scenes to load again. The engine loads them again with `Engine.reload`: the old scene draws until the new scene is ready.

`god_ish` has one option, `EN FONT`: the face of the small English text (the glosses and the credit roles, `GLOSS` in `_page.ts`). The calls (Gott ist tot, My God, Do you know?) and the title stay Fraktur, because they are big enough to read. The faces are UnifrakturMaguntia (the film), Pirata One and IM Fell English, all under the SIL Open Font License (`video/assets/type/OFL-*.txt`).

## Resolution

The engine reads its output scale once, from `?scale=` in the page URL. The RES list reloads the page with the new scale and the same song time (`?t=`). The song stops, and the start dialog shows "Resume". 0.5x is for slow GPUs. `SCALE` can be 0.5, or a whole number from 1 to 4. The golden stills (scale 1) are the same at every scale setting.

## Files

| File | Purpose |
|---|---|
| `app/site/` | The page: `index.html`, `player.ts`, `player.css`, `boot.ts`. |
| `app/src/ui/loader.ts` | The loading screen, shared with the studio. |
| `app/src/subtitles.ts` | The subtitle types and the line lookup. |
| `app/vite.site.config.ts` | The static build. It writes `out/site/`. |
| `app/scripts/site-data.ts` | Writes the snapshot of a project (see below). |
| `app/scripts/site-sources.ts` | Hashes the files the snapshot is made from. |
| `app/scripts/subtitles.ts` | Makes the subtitle tracks. |
| `projects/<id>/site/` | The snapshot: `inputs.json`, `subtitles.json`, `thumbnail.jpg` and `manifest.json` (in git), `<id>.mp3` (not in git). |
| `.github/workflows/pages.yml` | Builds and deploys the site. |

The build writes `out/site/data/projects.json` (the list of videos) and, for each video, `out/site/data/<id>/`: `inputs.json`, `subtitles.json`, `audio.mp3`, `thumbnail.jpg` and `assets/` (the folder `video/assets/` of the project, which the scenes fetch at run time).

## The snapshot

The dev server builds the project inputs from the Lyric-Sync song folder. The CI has no Lyric-Sync. So `bun run site:data -- <project>` runs on your machine and writes the same inputs as `projects/<id>/site/inputs.json`. It also writes the subtitles, makes `thumbnail.jpg` from `projects/<id>/out/thumbnail.png` (1280 x 720), encodes the mix as MP3 (192 kbit/s) and writes `manifest.json` with the SHA-256 of every source file and of the MP3.

Run it again after you change `video/video.json`, `video/assets/`, the timing, the features, the calibrated lyrics or the lyric map. Commit the JSON files and the thumbnail. Scene code needs no snapshot: the build always bundles the current scenes. `--keep-audio` does not encode the mix again. It keeps the MP3 and its manifest entry, so the release asset stays valid.

The build fails when a source file is newer than the snapshot, and it names the files. Hashes use LF line endings, so a Windows checkout and the CI agree.

## The cover

Each project has a scene that `video.json` does not name: `projects/<id>/video/scenes/thumbnail.ts`. Render it with `bun run pve board video/scenes/thumbnail.ts -p <id> --out projects/<id>/out/thumbnail.png` (`breaked_neuro` has `video/make-thumbnail.ts` for the same). Then run `site:data`.

## The audio

The MP3 is a release asset, not a file in git. The release is `site-audio`. The asset is `<id>.mp3`. A browser cannot fetch a release asset from another site (GitHub sends no CORS headers). So the CI downloads the assets and the build copies each one into the site as `data/<id>/audio.mp3`. The build checks the SHA-256 against `manifest.json` and fails when they differ.

To change the audio, run `bun run site:data -- <project>`, then upload the new file:

```sh
gh release upload site-audio projects/<id>/site/<id>.mp3 --clobber
```

A new video needs its MP3 in the release before the CI can build the site.

## Build and preview on your machine

```sh
bun run site:data -- <project>   # only after a source changed
bun run site:build               # writes out/site/
bun run site:preview             # http://localhost:4173
```

The build needs the local MP3 from `site:data` of each video. Set `PVE_SITE_AUDIO_DIR` to a folder with the MP3 files to use other files. Set `PVE_SITE_PROJECTS` (comma list) to build other videos or fewer. The list sets the order of the cards. Set `PVE_SITE_BASE` for a site that is not at the root of its host (the default `./` works at any path).

## The rebuild rule

Nothing renders in the CI. A build is one `vite build`, a few seconds. The workflow runs on a push to `main` only when a file the page is made of changes: `app/`, `packages/engine/`, `packages/core/`, `projects/*/video/`, `projects/*/site/`, `package.json`, `bun.lock` or the workflow. Docs, benchmarks and golden stills do not start it. A newer run replaces a deploy that is still running. The "Run workflow" button starts it by hand.

Set the Pages source to "GitHub Actions" once (Settings, Pages).
