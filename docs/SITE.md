# The web player (GitHub Pages)

The site plays `breaked_neuro` in real time. The visitor's browser runs the engine and draws every frame to the song. The site holds no video file. The page looks like the studio (`app/src/ui/daw.css`) and has no timeline or editor.

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
| RES | 0.5x (960 x 540), 1x (1920 x 1080) or 2x (3840 x 2160). |
| Fullscreen (F, double click on the picture) | Shows the picture and the transport bar full screen. The bar hides while the song plays. |

The group box title shows the output size, the frames per second and the CPU time of one frame.

## Resolution

The engine reads its output scale once, from `?scale=` in the page URL. The RES list reloads the page with the new scale and the same song time (`?t=`). The song stops, and the start dialog shows "Resume". 0.5x is for slow GPUs. `SCALE` can be 0.5, or a whole number from 1 to 4. The golden stills (scale 1) are the same at every scale setting.

## Files

| File | Purpose |
|---|---|
| `app/site/` | The page: `index.html`, `player.ts`, `player.css`, `boot.ts`. |
| `app/vite.site.config.ts` | The static build. It writes `out/site/`. |
| `app/scripts/site-data.ts` | Writes the snapshot of a project (see below). |
| `app/scripts/site-sources.ts` | Hashes the files the snapshot is made from. |
| `projects/<id>/site/` | The snapshot: `inputs.json` and `manifest.json` (in git), `<id>.mp3` (not in git). |
| `.github/workflows/pages.yml` | Builds and deploys the site. |

## The snapshot

The dev server builds the project inputs from the Lyric-Sync song folder. The CI has no Lyric-Sync. So `bun run site:data` runs on your machine and writes the same inputs as `projects/<id>/site/inputs.json`. It also encodes the mix as MP3 (192 kbit/s) and writes `manifest.json` with the SHA-256 of every source file and of the MP3.

Run `bun run site:data` again after you change `video/video.json`, `video/assets/`, the timing, the features or the calibrated lyrics. Commit `inputs.json` and `manifest.json`. Scene code needs no snapshot: the build always bundles the current scenes.

The build fails when a source file is newer than the snapshot, and it names the files. Hashes use LF line endings, so a Windows checkout and the CI agree.

## The audio

The MP3 is a release asset, not a file in git. The release is `site-audio`. The asset is `<id>.mp3`. A browser cannot fetch a release asset from another site (GitHub sends no CORS headers). So the CI downloads the asset and the build copies it into the site as `data/audio.mp3`. The build checks the SHA-256 against `manifest.json` and fails when they differ.

To change the audio, run `bun run site:data`, then upload the new file:

```sh
gh release upload site-audio projects/breaked_neuro/site/breaked_neuro.mp3 --clobber
```

## Build and preview on your machine

```sh
bun run site:data        # only after a source changed
bun run site:build       # writes out/site/
bun run site:preview     # http://localhost:4173
```

The build needs the local MP3 from `site:data`. Set `PVE_SITE_AUDIO` to use another file. Set `PVE_SITE_BASE` for a site that is not at the root of its host (the default `./` works at any path).

## The rebuild rule

Nothing renders in the CI. A build is one `vite build`, a few seconds. The workflow runs on a push to `main` only when a file the page is made of changes: `app/`, `packages/engine/`, `packages/core/`, `projects/*/video/`, `projects/*/site/`, `package.json`, `bun.lock` or the workflow. Docs, benchmarks and golden stills do not start it. A newer run replaces a deploy that is still running. The "Run workflow" button starts it by hand.

Set the Pages source to "GitHub Actions" once (Settings, Pages).
