# AviUtl projects and video assets

A song can come with an AviUtl project (`.aup`, AviUtl 1.x with ExEdit). pve reads the file. It never runs AviUtl and it never writes a `.aup`. The reader is `packages/aviutl`. It is pure TypeScript and has no dependencies.

The reader decodes only what pve uses: sprites, texts, groups, frame buffers and the audio object. Anything else on the timeline stops the import with a list (see "Errors").

## `pve aup`

```
bun run pve aup <file.aup> -p <id> [--skip a.bmp,b.png]
```

The command writes `projects/<id>/video/assets/timeline.json` and prints one JSON line with the counts of what it wrote.

- The sprite sheets must be PNG files in `projects/<id>/video/assets/`. The command reads their pixel size to get the cell size of each sheet.
- `--skip` leaves out every object of the named image files. The names go into `skipped` in the output.
- The sections come from the calibrated lyrics of the project (`user_input/lyrics.calibrated.json`), not from the aup. The command needs the song inputs of the project, including `generated/features.json`.
- The aup file stays outside the repository. Only `timeline.json` and the sprites are used later.

### Errors

The command collects all problems and prints them together. It exits with 1 and writes nothing when any of these is true:

- An object has an effect that the reader does not know, or the first effect is not a known object type.
- A sprite script is not the sprite-sheet script (see "Sprite sheets"), or has a moving parameter.
- A `標準描画` trackbar moves (mode not 0), or its blend mode is not known. The reader reads still values only.
- An object is chained (a mid-point of the object before it).
- A sprite sheet is not in `video/assets/` (and not in `--skip`), or its size does not divide into the grid.

To support a new effect, change `packages/aviutl/src/decode.ts` and add a test with a synthetic block.

## `timeline.json`

All frame numbers count from 0 on the frame grid of the aup (`fps`). A range has `start` and `end`. Both are frames, and `end` is the last frame (inclusive). A frame `f` is at `f / fps` seconds.

| Field | Meaning |
|---|---|
| `v` | Schema version. Now `1`. |
| `source` | File name of the aup. |
| `fps` | Frames per second of the aup (18 for sardine). |
| `size` | `[width, height]` of the aup frame in pixels. |
| `frames` | Number of frames of the edit. |
| `grid` | The BPM grid of the timeline: `enabled`, `tempo`, `beat` (beats per bar), `offsetFrame`. |
| `sections` | `{ name, start, end, bar }`. `bar` is 1-based on the beat grid of the song. |
| `sprites` | The picture objects (see below). |
| `texts` | The text objects: the lyric lines. |
| `groups` | The group controls. |
| `buffers` | The frame buffers. |
| `audio` | The audio objects: `{ object, layer, start, end, file }`. |
| `skipped` | `{ file, objects }` for each file that `--skip` left out. |

Every object in a list has `object` (its index in the aup), `layer` (0 is the lowest) and `start`, `end`.

### Drawing fields

Sprites, texts, groups and buffers have these fields (from `標準描画` or the group control).

| Field | Unit |
|---|---|
| `x`, `y`, `z` | Pixels of the aup frame. The origin is the frame centre. |
| `zoom` | Percent. 100 is the size of the image. |
| `transparency` | Percent. 0 is opaque. 100 is invisible. |
| `rotation` | Degrees. |
| `blend` | `normal`, `add`, `subtract`, `multiply`, `screen`, `overlay`, `lighten`, `darken`, `luminance`, `colorDifference`, `shade`, `lightDark` or `difference`. |

### Sprites

| Field | Meaning |
|---|---|
| `file` | PNG file name in `video/assets/`. |
| `sheet` | `{ width, height, cols, rows, cellWidth, cellHeight }`. The size is the PNG size. `cols` is the `uro` of the script. `rows` is the `mag` of the script. A plain image has one column and one row. |
| `kih` | Cell offset. |
| `hold` | Frames that one cell stays on screen. |
| `cx` | Scroll. `obj.cx = sign(cx) * floor(abs(cx) * n)`, with `n` the frame inside the object. 0 is no scroll. |

The cell on screen at frame `f` is `floor((f - start) / hold + kih) mod (cols * rows)`. The cells run along the rows (cell 1 is the second column of the first row).

### Texts

`text` (lines are separated by `\r\n`), `font`, `size` (pixels) and `color` (`#rrggbb`).

### Groups and buffers

A group moves the layers above it. `layers` is the number of layers it covers. 0 means all layers above. `outline` is `{ size, blur, color }` and is only set when the group has the outline effect.

A frame buffer copies the picture so far. `resize` is `{ zoom, x, y }` in percent.

## Sprite sheets

Every sprite object carries the sprite-sheet script `dot_anime_script`. Its parameter lines are `mag`, `uro` and `kih`. The script body must match the known text. Two lines may differ:

- The `fs=` line. `fs=(obj.frame+kih)%bs` gives `hold` 1. `fs=math.floor(obj.frame/N +kih)%bs` gives `hold` N.
- An optional `obj.cx=` line (`-math.floor(obj.frame*1.5)` and the like). It gives `cx`.

Any other change to the script stops the import.

## Release assets

The sprites and `timeline.json` are not in git. They are assets of the GitHub release `<id>-assets`. `video/assets.json` is in git and lists them. The pattern is the same as the site audio (`docs/SITE.md`).

```
{ "v": 1, "release": "sardine-assets", "assets": [ { "path": "ca_1.png", "sha256": "...", "size": 1234 } ] }
```

`path` is the file name under `video/assets/`. It is also the name of the release asset. Release assets have no folders, so `video/assets/` must have no folders.

### `pve assets pack`

```
bun run pve assets pack -p <id>
```

The command writes `video/assets.json` from the files in `video/assets/`. It prints the `gh release upload` command and the `gh release create` command for a new release. It does not run them. Run the upload yourself after `pack`, and commit `video/assets.json`.

### `pve assets fetch`

```
bun run pve assets fetch -p <id>
```

The command compares the local files with `video/assets.json`. It downloads the missing and the changed files with `gh release download`, and checks each file against its SHA-256 before it stores the file. A release that does not match the manifest is an error and nothing is stored. The command needs the GitHub CLI (`gh`) and a sign-in.

`bun run pve check -p <id>` reports every missing or changed file as an error. The error text names `pve assets fetch -p <id>`.
