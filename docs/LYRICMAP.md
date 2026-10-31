# Lyric map and `pve at`

`user_input/lyrics.calibrated.json` is the one source of lyric times. Nobody edits it by hand. The lyric map is a companion file. It holds no time. It says which Japanese glyph and which English phrase belong to each calibrated syllable.

A human or an agent writes the map by hand, line by line. The meaning of a line decides where a translation splits. A program does not parse the raw files for this reason.

## Files

| File (in `user_input/`) | Role |
|---|---|
| `lyrics.calibrated.json` | Times. Canonical. Not edited. |
| `lyrics.raw.jp.txt`, `lyrics.raw.en.txt` | The lyrics as written. Same line numbers in both files. |
| `lyrics.map.json` | The map. Written by hand. |

Every command that loads a song reads the map when it exists. It fails with `rule: lyric-map` when the map and the calibrated lyrics or the raw files disagree. The message names the JSON path (`lines[12].jp`).

## Format

```json
{ "v": 1, "song": "god_ish", "calibrated": "lyrics.calibrated.json",
  "raw": { "jp": "lyrics.raw.jp.txt", "en": "lyrics.raw.en.txt" },
  "note": "...", "skip": [1, 24, 64],
  "lines": [
    {"i":0,"r":3,"t":"ai no netabare wakare ppoi na","n":14,
     "jp":"愛 ~ の ネ タ バ レ 「別 ~ れ」 っ ぽ い な",
     "en":[[0,7,"Spoiler for love:"],[7,14,"\"Break-up\"-ish"]]}
  ] }
```

One line of `lines` per calibrated line, in order.

| Field | Meaning |
|---|---|
| `i` | Index of the line in the calibrated file. |
| `r` | Line number (1-based) in both raw files. |
| `t` | The calibrated line text. A different text means the map is stale. |
| `n` | Count of calibrated syllables of the line. Ghost syllables count. |
| `jp` | One slot for each syllable, separated by one space. See below. |
| `en` | English phrases. See below. |
| `ig` | Raw text that is not in the calibration. Removed from both raw lines before the compare. |
| `skip` (top level) | Raw line numbers (1-based) that are not main vocal. Every raw line must be mapped or skipped. |

### `jp` slots

- A slot with text is the glyph that the syllable is sung on. It is a kanji, one kana mora (`じゃ`, `ちょ`, `ファ`, `とぅ` are one slot) or a Latin word.
- `~` means: same glyph as the slot before. A kanji with two syllables is `愛 ~`.
- `_` means: ghost syllable. See below.
- Punctuation sticks to the nearest glyph: `「別`, `れ」`, `う！`, `"風"`. The glyphs of a line, joined, must rebuild the raw line (without spaces, quotes made plain).
- A Latin word is written as printed (`IQ`, `THE END`). Its syllables are sound-alikes of the sung sound (`a i ku`, `di e n`).

### Ghost syllables

A calibrated syllable with text in parentheses, for example `(o)`, exists only to sync the timing. It is not in the lyrics. Its slot is `_`. Never draw it. The parser sets `ghost: true` on it and gives it no glyph.

### `en` phrases

`[from, to, "text"]` or `[from, to, "text", "~"]`. `from` and `to` are syllable indexes in the line. `to` is not included.

- Phrases are in English reading order. Their spans can be in any order, and they can have gaps or overlap.
- The phrases, joined with spaces, must rebuild the raw English line. Quotes are plain quotes.
- The translation does not always split like the Japanese. The span is then a best guess, and the fourth element is `"~"` (loose). A syllable without a phrase is allowed.
- The time of a phrase is the start of its first syllable to the end of its last syllable.

## Change the map

1. Change a raw file or the calibrated lyrics.
2. Run `bun run pve at -p <id> "line 0"`. The error names each line that does not fit.
3. Edit those lines in `lyrics.map.json` by hand.

## `pve at`

`pve at [-p <id>] <where> [; <where>...]` locates anything. It prints one compact JSON object per line. It works on a song folder without `video/video.json`.

| Where | Means |
|---|---|
| `bar 111`, `bar 111.3` | Bar 111, or its beat 3 (the `bar.beat` that every pve output prints). |
| `beat 250` | Beat 250 (0-based, as `beat:250`). |
| `f5665`, `frame 5665` | A frame. |
| `94.4`, `94.4s`, `1:34.4` | A time. |
| `line 38`, `syl 38.5` | A calibrated line, or its syllable 5. Both 0-based. |
| `@marker`, `clip:id.start`, `section:Chorus`, `lyric:text`, `bar:12+2b` | Any time expression. |
| `a..b` | A range: `bar 111..115`, `f100..f400`, `1:00..1:10`. A bare number on the right takes the unit of the left side. It ends where `b` starts. |
| any other text | A search in the romaji, the Japanese, the English, the sections, the markers and the clips. `text#2` picks the hit with index 2. |

Options: `--syl` adds the syllables, the glyph units and the English phrases of each line, with times. `--frames` writes the times of those arrays as frames. `--max N` limits the text hits (default 20).

A point has these keys. A key without a value is absent.

| Key | Value |
|---|---|
| `t`, `f` | Seconds, and the nearest frame. |
| `bar`, `beat`, `off` | `bar.beat`, the beat index (continuous), and the distance to the nearest beat (`on beat`, `+31ms`). |
| `sec`, `clip` | Section name and clip id. |
| `line` | `i` (line), `r` (raw line), `s`, `e`, `f` (frames), `bar`, `t` (romaji), `jp`, `en`. With `--syl`: `syl` `[k, text, start, end, "ghost"?]`, `wd` `[word, from, to]`, `jpu` `[glyph, from, to, start, end]`, `enp` `[text, from, to, start, end, "~"?]`. |
| `syl` | The syllable that sounds at `t`: `k`, `w` (word), `t`, `s`, `e`, `jp` (`null` for a ghost), `ghost`, `en`, `loose`, `gap` (`t` is not inside the syllable). |
| `gap` | Between lines instead of `line` and `syl`: `prev` and `next` with `line`, `end` or `start`, and `d` (seconds from `t`). |

A text hit adds `q`, `n` (hit index), `kind` (`line`, `word`, `syl`, `jp`, `en`, `section`, `marker`, `clip`), `text` and `x` (a time expression, or seconds when none fits). A Japanese or English hit points to the glyph or the phrase that holds the text.

A range has `from`, `to`, `dur`, `frames`, `bars`, `beats`, `sec`, `clip` and `lines` (the lines that sound in it, with the same keys as `line`).

A query that fails prints `{"q":..., "error":..., "fix":...}`, and the exit code is 1. `pve find <text>` finds the same Japanese and English text and prints a table.
