# god_ish — treatment v4 (motion, draft for review)

203.9 s · 142 BPM, 103 BPM from 92.12 s to 129.40 s · first downbeat 7.607 s · 16:9 · 30 fps with stepped layer rates · no figure, all procedural, 3D only for rare set-pieces · plays in real time in the web player.

Ask `pve at -p god_ish "<where>"` for every time in this file. Do not read the song JSON by hand.

## The idea

**Every copy is a little less god, and the last copy becomes an original.**

The song is about imitation: things that are 神っぽい, god-ish. Copying is also how anything lasts. Scribes copied scripture by hand, and their errors piled up. The press copied it exactly. Modernism made copying a system. Screens re-save it until it breaks. A machine predicts it. Each copy loses something, and each copy carries something on.

The video moves through these eras. Each era copies the page of the era before it. At the end, the copying makes a script that no era had.

**The video never says what made it.** The viewer knows. It shows only through true traces: a `GEN` count in the margin, a page that predicts its own next glyph, text-ish glyphs at the edges.

## Red

Red is the god: the thing that cannot be copied or predicted.

- **Substrate.** Red is under every page. It shows through holes: a cut seal, a cut glyph, a slit, a crack, worn ink. Copying closes the holes.
- **Rubric.** In the manuscript era red is ink for holy words, initials and headwords, as in real rubrication ("rubric" is from the Latin for red ochre).
- **Surprisal.** In the sermon, a sung glyph that the model ranked low locks in red.
- **Relapse.** Every 神っぽいな opens red again, and the next copies close it.

## The machine voice

Eight calls in the song are a synthetic "yukkuri" voice, on their own stem (`user_input/stems/…yukkuri_oh_my_god.wav`). They are not in the calibrated lyrics. Times are the non-silent spans of that stem (ffmpeg `silencedetect`, -40 dB, 0.25 s). Make them markers.

| Marker | Time (s) | Call |
|---|---|---|
| `ohmygod` | 6.76–7.47 | "Oh my God" (title, before the first downbeat) |
| `gott1` | 49.87–51.19 | "Gott ist tot" |
| `mygod1` | 54.28–54.98 | "My God" after line 18 |
| `mygod2` | 61.04–61.74 | "My God" after line 20 |
| `doyouknow` | 109.26–109.97 | "Do you know?" (end of the sermon) |
| `gott2` | 146.30–147.62 | "Gott ist tot" |
| `mygod3` | 150.72–151.42 | "My God" after line 51 |
| `mygod4` | 157.48–158.19 | "My God" after line 53 |

These calls are culturally loud, so they hit hard. They are the only time the page is spoken **to**. On each call the substrate takes the frame: the page is cut open and red fills it, with the call cut out of the red in Fraktur. Then the page closes over it again, one generation older. This is 8 large flips in 204 s, inside rule 11. The two "Gott ist tot" calls are longer, and they end an era (see the plates).

## Rules (for every frame)

1. **Generation is real.** `GEN nn` in the margin counts the copies since the original. A copy happens as a hard step on a syllable onset, mostly the first syllable of a line. Copying closes holes onto red, spreads the darks, and adds the loss of its era.
2. **Any frame renders alone.** A generation N is N applications of the copy function in one frame. No feedback between frames.
3. **Every sung syllable is legible at its onset.** Past text may decay.
4. **JP is the headword, EN is the gloss.** JP sits vertical where the era allows it. EN is smaller, in the face of the era. A loose split (`"~"` in the map) shows at phrase level only. Ghost syllables (`(o)`, line 73) are never drawn.
5. **Text-ish glyphs are texture, never lyrics.** Pseudo-kanji are random combinations of real radicals. They fill margins, debris and decay.
6. **No fake data in the marks.** Small marks are true: generation, line, syllable, bar, frame, probabilities. Social and chat UI (plates 6, 7) may invent handles, avatars and counts as set dressing.
7. **The voice moves the type. The music moves the rest.** Glyphs step, hop and re-flow on syllable onsets only. Drums, bass and synths move the auxiliary parts: the machine, the copies, the dust, the substrate (see "Motion (v4)"). The camera is locked. No screen zoom, dolly, punch-in or shake (director, v4 round 2: they look bad). The page is flat. 3D only in set-pieces.
8. **Sparse to dense.** The intro has one element. The frame fills as generations rise. The densest frame is the end of plate 9. The outro empties it again.
9. **A few dry puns.** Only おっきい / ちっちゃい (size), IQが下がって (resolution), ビーム, THE END. Played straight.
10. **Banned:** RGB split, generic glitch transitions, VHS static, lens effects, feathering, glows, centred karaoke subtitles, HUD boxes. Faux-datamosh and JPEG loss are allowed only as a copy of the digital eras, never as a transition effect.
11. **Luminance flips** over more than about 25 % of the frame: 3 per second or fewer.

## Time

30 fps. Layer rates: type 24, page and ink 12, dust and specks 8. Each layer holds time with `t0 + stepT(t - t0, fps)`. Motion (v4) can use any rate: stepped and smooth motion mix in one frame.

## Eras

| Era | Surface | Copy loss | Type |
|---|---|---|---|
| Manuscript | vellum grain, hand ink with pooling, ruled lines | scribal error: a glyph skipped or doubled, ink thinning | brush Mincho, red rubric initials, Fraktur for EN |
| Japanese typewriter (和文タイプ) | a tray of about 2000 glyph types, a selector arm, ribbon, carbon paper | each strike also makes fainter carbon copies: one generation per keystroke | Mincho type faces |
| Modernist | Swiss grid, flat paper, offset halftone dots | screen moiré, misregistration of plates | Gothic (sans), strict columns |
| Risograph | Japanese drum printer, four spot drums (fluorescent pink, yellow, medium blue, black), soy-ink grain, transparent overprint, paper show-through. The only era with colour beyond red: the inks carry no meaning, red still shows only through holes | ink starve, drum slip, registration drift per drum | whatever it prints |
| Screen: chat | a chat app (Discord-like): messages, typing indicator, replies that quote replies | re-save: JPEG quality drops, red blocks and bleeds first | system Gothic |
| Screen: timeline | a social timeline: posts, quote-reposts that nest one level deeper per copy, screenshots of screenshots | JPEG generations, faux-datamosh | screen type, stretched |
| Text-ish | everything fluent and nothing exact | to try: homophone drift (神→紙→髪→上, same reading), pseudo-kanji in the margins, or both | real glyphs only where sung |
| New script | see plate 10 | none | the new script |

Faux-datamosh is stateless: render the scene at a key time `t_base` and move its pixels with the motion of `t`. JPEG loss is separable DCT, quantize and inverse DCT passes, N times in one frame. Reference: `../video-refs/rtjpeg` (MIT).

## Fonts

Era faces are real fonts: Noto Serif JP (Mincho), Noto Sans JP (Gothic), a Fraktur (UnifrakturMaguntia), all OFL. Subset them to the glyphs of the lyrics (204 unique glyphs in the song) and the text-ish radicals. They are not in `app/public/fonts` yet.

**The new script is the one face we build.** Plate 10 needs 31 glyphs: 13 kanji (愛別人生死理解患無邪気踊神) and 18 kana. Each glyph is a stroke skeleton from KanjiVG, drawn by a procedural pen. The pen takes one trait from each era: the brush entry and exit of the manuscript, the bracketed serif of the press, joints snapped to the modernist grid, square terminals of the JPEG block. No era had all four. The strokes write in the real stroke order.

KanjiVG is CC BY-SA 3.0 (Ulrich Apel). The credits and the web player name it. The derived skeleton data in the repository keeps the same licence.

## Web player

The video also plays in real time in the web player (`docs/SITE.md`), with seeking. So every frame renders alone (rule 2), and the cost of a frame is a hard limit. The heavy parts are the JPEG generations and the n-gram fan. Generation N must not mean N full-frame passes at 1080p: run the copy chain on a smaller page texture, or cap the passes and bake the rest into the parameters. Check with `pve bench` before a plate is accepted.

## Homage motifs (from PinocchioP's MV, made procedural)

- **Halo** = the ring of a round 神 seal. The ring is a hole onto red.
- **Smoke** = drifting ink dust, toner dust, pixel dust by era. Discrete clumps, 8 fps.
- **Vertical lyric cards** = dictionary entries.
- **Big stamped kana on とぅとぅる** = type sorts, then stamps, then pixels.
- **Final 神 in a box** = the seal in the new script.

## Plates

| # | Section | Time (s) | Era | Plate |
|---|---|---|---|---|
| 0 | Intro | 0.00–21.12 | Manuscript | The original |
| 1 | Hook | 21.12–34.64 | Japanese typewriter | Carbons |
| 2 | Pre-chorus | 34.64–49.87 | Movable type | Broadsheet |
| — | Gott ist tot 1 | 49.87–51.19 | break | Death of the press |
| 3 | Chorus | 51.55–78.59 | Modernist | The entries |
| 4 | Post-chorus | 78.59–92.12 | Risograph | Stamps, printed |
| 5 | Interlude (103 BPM) | 92.12–110.76 | Prediction (IME) | The parrot |
| 6 | Verse | 110.76–129.40 | Screen: chat | Bored |
| 7 | Pre-chorus 2 | 129.40–146.30 | Screen: timeline | Tiny |
| — | Gott ist tot 2 | 146.30–147.62 | break | Death of the screen |
| 8 | Chorus 2 | 147.99–175.02 | Text-ish | Epigone |
| 9 | Post-chorus 2 | 175.02–188.56 | Text-ish | Stamps, last |
| 10 | Outro | 188.56–202.10 | New script | The new original |

### 0 · The original (0.00–21.12)

GEN 00. Expansion to try (pick from stills): **写経**, a shakyō grid page written by brush in real stroke order (KanjiVG), or an **illuminated** page with a procedural knotwork initial and marginalia. The page starts as the round 神 seal in the new script: the loop seam from plate 10. "Oh my God" (6.76 s) cuts the page open onto red. On the downbeat after it the opening closes back to the seal, now in the manuscript hand. Lines 0–1 (愛のネタバレ「別れ」っぽいな, 人生の…「死ぬ」っぽいな) are written stroke by stroke as two entries with red rubric initials. The quoted words (別れ, 死ぬ) are the headwords. Line 2 (意味深でかっこいい): ruby over 意味深. Line 3 (単語集で踊ってんだ失敬): the glyphs of the entries hop a step on each syllable. On 失敬 the page is copied: GEN 01.

### 1 · Carbons (21.12–34.64)

A Japanese typewriter (和文タイプ). The selector arm hunts across the glyph tray to each glyph and strikes on its syllable onset. Each strike also prints on the carbon sheets beside the original, each one fainter and softer. Picking a glyph from a fixed vocabulary is the parrot in metal. "風" types in quotes. Line 7 (ぽいじゃん): the typed glyphs all turn to one angle. Line 11 (神っぽいな): a new seal cuts through. Red relapse.

### 2 · Broadsheet (34.64–49.87)

- Lines 12–13 (もういいぜ…逆に興奮してきた): the press runs faster than the type. The sheet fills until no margin is left.
- Lines 14–15 (おっきいね…夢): 夢 in wood type grows past the sheet, linearly in time from its onset to the last syllable of line 15. It does not follow the syllables.
- Line 16 (品性はTHE END): THE END in wood type.
- Line 17 (うええい): two impressions, one per うええい.

### Gott ist tot 1 (49.87–51.19)

The era breaks. Red takes the frame with "Gott ist tot" cut out of it in Fraktur. The press era does not come back: the page that closes over the red is the modernist grid.

### 3 · The entries (51.55–78.59)

A Swiss grid dictionary. Gothic, offset dots.

- Line 18 (神っぽいなそれ卑怯): a fresh seal, the largest red so far. "My God" (54.28 s) answers it.
- Line 19 (IQが下がっていく): the line renders on a coarser grid on each syllable of 下がっていく: 128, 64, 32, 16 … cells high. The true size is printed as `IQ 128`, `IQ 64`…
- Lines 20–21 (邪心, 害虫はどっち): the grid prints in negative. "My God" (61.04 s) answers line 20.
- Lines 22–23, 25–26 (その髪型 その目… その名言 その意見…): each その〇〇 is an entry with a cross-reference `→ 神`.
- Lines 24, 27 (アレっぽいなそれ比況): 比況 is comparison. The entries stand side by side in two columns.
- Line 28 (ぽいなぽいなぽい憧れちゃう): ぽい three times, copied three times in one bar.

### 4 · Stamps, printed (78.59–92.12)

The hook again as a risograph poster: four drums (fluorescent pink, yellow, medium blue, black), soy-ink grain, each drum off register and slipping more with each copy, inks overprinting. Pink never overprints yellow (pink over yellow is close to the substrate red). It starts at the generation the chorus left. Line 36 (神っぽいな) cuts a new seal.

### 5 · The parrot (92.12–110.76)

103 BPM. The generation holds. The sermon is typed through a Japanese input method (IME). Before each word a conversion candidate window opens with numbered candidates of the same reading (kami → 神 紙 髪 上), ranked by a model trained on the song's own lyrics, so the ranks are true. On the onset the sung glyph is chosen. **A sung glyph the model ranked low is chosen in red.** Lines 37–40 are the sermon. Nothing names a model.

- 灯り (line 38): a flame-shaped hole onto red flickers at 8 fps.
- 神を否定し神に成り代わり (line 39): the seal fills with ink, and a hole in the shape of 小物 opens.
- 自戒の祈り (line 40): the fans close. The page stands.
- "Do you know?" (109.26 s): the plate ends here. From the call to the cut onto bored (110.76), the transition `divider.ts` draws the frame (see seam 5→6).

### 6 · Bored (110.76–129.40)

A chat app. Each line arrives as messages, with a typing indicator before them. Replies quote replies. Every re-save steps the JPEG quality down.

- Line 41 (何言ってんの？それウザい): the question mark is the largest glyph.
- Line 42 (眠っちゃうよ): one re-save per syllable, each at lower quality.
- Line 43 (飽きっぽい): the chat scrolls, one jump per syllable.
- Line 44 (ビーム): a slit cuts across the whole frame onto red, on the onset of ビ.

### 7 · Tiny (129.40–146.30)

Back to 142 BPM. A social timeline. Each line is a post. Each copy is a quote-repost of the last, one level deeper, and a screenshot of a screenshot.

- Lines 45–47 (きっしょい…逆にファンになってきた): the reverse of plate 2: the frame empties.
- Lines 48–49 (ちっちゃいね…器): 器 shrinks one step per syllable to a few px.
- Line 50 (天才ゆえ孤独ですね かっけえ…): one entry alone on an empty frame.

### Gott ist tot 2 (146.30–147.62)

The era breaks again. The screen ends. The page that closes over the red is text-ish.

### 8 · Epigone (147.99–175.02)

Text-ish. Everything is fluent and nothing is exact. To try: homophone drift (sung kanji drift to same-reading kanji after they are sung), pseudo-kanji only in the margins, and both. The sung text stays real.

- Line 52 (超健康…くたばっていく): 健康 bold, and each copy kills it a little more. "My God" calls answer lines 51 and 53 (150.72 s, 157.48 s).
- Line 54 (エピゴーネン): the highest generation. A candidate for faux-datamosh: the line moves inside the pixels of the chorus 1 entries.
- Lines 55–56 (そのタイトル その絵 そのストーリー / その音楽 その歌 そのメロディ): entries that point to entries. The cross-references close into a loop.

### 9 · Stamps, last (175.02–188.56)

Plate 1 a third time. The stamps are text-ish now: とぅとぅる in glyphs that are almost kana. Copies come on every syllable. The view starts zoomed in (1.75×) and slowly pulls out as more stamps appear and fill the widening screen. Every generation is a real JPEG re-save (SurfaceOpts.jpeg), its quality stepping down from q76 to q12 as copies accumulate. The end of this plate is the densest frame of the video. Line 69 (神っぽいな) cuts the last seal, and the cut takes the whole frame.

### 10 · The new original (188.56–202.10, trimmed at bar 114)

A full codex folio in **the new script** (see Fonts). On the right (`x = 800..1850`), Plate 0's illuminated dictionary is reborn: `ぽい辞書` in red down the title rail, a woven geometric knotwork initial holding `愛`, four ruled dictionary entries for lines 70–73 with red rubricated headwords (`別れ`, `死ぬ`, `患`, `踊`), Fraktur glosses, and a marginalia vine growing one step per sung syllable from the snail at its root to the bird at its top. On the left (`x = 100..620`, above the `(330, 800)` seal), a live 4-Era Synthesis Specimen Box drafts each sung glyph at large scale on the 12×12 modernist snap grid with brush entry vectors, press serif brackets and JPEG block terminals, launching era shards across the spread into the codex columns.

When the backing instruments drop out on `いたかった人生` (`200.68 s`), `人生` (`201.415 s`) cuts both Entry 3's foot block and the Specimen Field open onto the red substrate with `人生` carved in vellum. Then a fresh blank vellum sheet sweeps right-to-left over the completed codex and the round `神` seal punches through at `(330, 800)` onto red, landing on Frame 0 at `bar:114` (`202.10 s`).

## Audio

Stems in `user_input/stems`: kick, snare, hat, bass, piano, guitar, synthA, synthB, rhythm_FX, Miku lead / chorus / harmony, human, and `yukkuri_oh_my_god`. Type moves on the voice, so the calibrated syllables drive it. `features.json` (Lyric-Sync beatsync) gives the envelopes and the kick, snare and hat onsets of the drum stems. They drive the auxiliary motion only. The machine-voice times are in "The machine voice".

## Motion (v4)

Director review 2 said "static". v4 adds motion, mechanism and music reactivity, plate by plate. Director review 3 rejected subtle shader-only reactions (tints, halos, a red flicker) and simple seams (a page rolled up, a platen slam): motion must be visible and object-level, and a seam must carry the old plate's content across the cut, as the seams of breaked_neuro do.

- **Casting per era.** Each plate picks what each stem moves, to fit its machine. There is no global stem-to-element table.
- **Copy transitions.** A seam between two plates is a visible copy act in the machine of the next era. The content of the old plate goes through that machine and becomes the new plate. It runs about 1.5–2.5 s across the cut, staged on the drums. The two Gott ist tot breaks stay hard cuts.
- **Visible mechanism.** Show the parts of each machine that work: typebars, platen, rollers, the press, the scanner bar, the cursor, the scroll.
- **Pops.** Random sets of characters pop on the drums: wrong glyphs, inverted glyphs, colour pops, pseudo-kanji. They never cover the sung text at its onset.
- **Density arc.** Secondary marks build up with the generations (rule 8).
- **Energy.** Match the reference MV where the song asks for it (hooks, choruses, the plate 9 peak). Keep the verses calm.
- **Budget.** The web player must hold 30 fps: every frame under 33 ms. Medians stay well under that.
- **Camera.** There is none. The frame is never zoomed, punched in, shaken or moved. Impacts show in objects: stamps, slams, pops, sorts.

Director review 3 (v4 round 1): entries and epigone are the best plates ("kino") and set the standard for the others. The carbons half of the forme seam is good. The feed seam now pulls the manuscript off the typewriter page that lies under it.

### Plate 0 · original

| Driver | What moves |
|---|---|
| Intro (bars 1–4, no drums) | The seal, the one element of the intro, is still. A reverse bell swells from bar 3 and stops on bar 4: the page fades to red under it, the seal with it. In the manuscript the illuminator pricks red rosettes into the margins, more as the page fills. |
| Syllable | The brush is wet: ink drops fly off the glyphs of each unit for 3 steps and fall. |
| Oh my God | The call cuts the page open on the red and takes the intro seal. The page has no seal until the manuscript brings its own on the downbeat. |

### Seam 0→1 · glyphs become type (`feed.ts`, 20.37–22.10)

On 失 the typebar strikes 失 in Mincho over the brush, and half of the brush glyphs pop loose and hover. They arc toward the tray and turn over in flight into metal slugs with reversed Mincho faces. On 敬 the rest pop loose and a black platen pulls the manuscript up out of the frame, with the rubrics, the seal and the typed 失敬. The typewriter page (tray, blank original, carbons) already lies under it, so the cut is invisible. The loose glyphs stay in the air. On the kick of the cut (21.126) the first set slams into the tray cells. The second set hangs over the tray and lands on the next two kicks. Red never becomes type.

### Plate 1 · carbons react

The original does not react. The carbons are the copies, so they react:

| Driver | What moves |
|---|---|
| Kick | A cluster of 3–8 wrong glyphs (tray faces next to the sung glyph) strikes each carbon: big and dark, then they snap into place, smear and fade in 0.5–1 s. Their tray slots show empty for a moment. Some stay as noise, more with each generation. |
| Hat | 1–4 glyphs pop in the violet carbon dye (rarely in red) for 2 steps. |

The four とぅとぅる lines escalate it: line 4 only carbon 2, line 5 both, line 6 bigger, full from line 7. The snare is silent from 20 s to 34 s. The camera is locked. The violet is the canvas code `DYE` (`#ff00ff`), which only the typewriter era prints.

### Seam 1→2 · lock up the forme (`forme.ts`, 32.88–35.04)

From the last kick before the drumless bar, and then on っ ぽ い な, sets of typed glyphs pop off the sheets as metal sorts. Each one leaves its shape cut through the paper onto red. The tray empties too. Each sort rises and turns over for about 0.3 s, then glides over its slot in the chase for at least 0.45 s. Nothing moves faster than about 5,000 px/s, and every move is smooth (no 24 fps stepping). The press bed glides in from the right in one ease, about 0.8 s, and is home by 0.18 s after the line end (the snare, 34.224). On the snare the sorts drop onto the bed: the masthead first, where the original's 神っぽいな have lifted off as they were sung, then column by column, right to left. The quoins lock. An inking roller runs right to left, and 230 px behind it the impression cylinder rolls over the forme. The cylinder starts fast, because the headline must print by the second onset of line 12, then slows over 1.3 s. It leaves the printed broadsheet behind it, headline first. The camera is locked.

### Plate 2 · broadsheet

| Driver | What moves |
|---|---|
| Syllable (each impression) | The impression sets the body columns. |

### Seam 3→4 · the drums print (`drums.ts`, 78.17–78.69)

The four drums of the risograph print across the frame. From the last beat before the cut (78.17), a group of four bands (yellow, pink, blue, black, each 120 px behind the one before) sweeps from the left to the right in hard steps of 12 fps. The bands are printed by the riso plate itself, on every frame: its page code, its surface pass and its drum motion (`drumReact` in `riso.ts`). They have its inks, screens and drum slip, the yellow is knocked out around the pink, and the grain boils at the plate's rates (12 fps and 8 fps). They run the full height of the frame (the sheet's unprinted foot margin is cut away). In front of the bands the entries page plays on. Behind them is riso itself, rendered on every frame, so the whole page grain boils as it does on the plate. The last band leaves the frame on the cut (the downbeat, 78.59). No feathering, no black screen.

### Seam 5→6 · the red room is pressed (`divider.ts`, 109.26–111.46)

The plate hands over at the call. The call "Do you know?" cuts the sermon page open onto red (109.26) and the title punches in. The last prediction fan and its candidate window open under it, after the last glyph of the sermon. The red is a room. From the end of the call (109.97) its walls close in like the plates of a hydraulic press, in hard steps of 24 fps, quickly at first and then slower. The room lays itself out again at every step. The walls push each thing that is in their way: the three words of the title, each glyph of the fan with its ray, the window. Then they squeeze it flat, vertically. A body that cannot be squeezed to more than 0.9 of its height pops out of the room with a kick and falls under gravity, spinning, over bored. The window goes first, then the title, then the glyphs of the fan. 何 (line 41, 110.41 s) strikes in at the cursor as a block with its glyph cut out and its true rank beside it, and it goes the same way. The last step leaves a red line, the NEW divider of line 41 (rows 620–624), on the cut (the downbeat, 110.76). Around the thin dark walls, bored plays live: the sermon as the history of the channel above, the reply 何 below. The transition goes on for 0.7 s after the cut, so that what is still falling leaves the frame over bored (the last of it is gone at about 111.3). Nothing is stored from one frame to the next: every position is a function of the step. The camera never moves.

### Seam 8→9 · the page is peeled off in cards (`peel.ts`, 173.72–175.92)

The dense page of epigone comes off in cards, across the cut (175.02), and the clean page of last is laid bare under it. The epigone frame is cut into 24 × 12 tiles. On each of the last three kicks before the cut (173.76, 174.18, 174.61) a set of tiles is stamped up: it gets the ink border and the shadow of a stamp card of last, and swells and tilts for three steps of 24 fps. Then it falls off the frame under gravity, spinning. The lower rows tend to go first. Where a tile has left, the page of last shows: live under the transition before the cut, last itself after it, with no seal on it: epigone's seal goes off the page with its tiles and last opens clean. The sung text is never taken (rule 3): the tiles that carry the text of line 61 stay in place, on top of the falling cards. The three stamps of ぽいなぽいなぽい go on the last beat of epigone (the last kick before the cut, 174.61), and 憧れちゃうわ！ with its gloss just before the cut, on the hat before it (174.92), so that it is already coming off when last begins (the last syllable, わ！, is sung from 174.86). They go the same way, almost straight down. Every other card is gone long before, so the first stamps of last land on a clear page. A tile that has not been stamped up yet stays the page of epigone as it stood on the cut. The transition goes on for 0.9 s after the cut. The camera never moves.

### Plate 4 · riso

| Driver | What moves |
|---|---|
| Syllable | Each kana stamps in for 2 steps in its drum, oversize and off register, then prints in place. |
| Kick | The sheet jumps in the feed: the colour drums move, the black drum moves a third as far. A random set of printed kana is knocked out of black blocks for 3 steps. |
| Snare | The pink drum slips on its own. Registration marks pop on grid crossings. |
| Hat | The ink floods: denser dots, fuller solids. |

The effect grows from line 29 to ぽいじゃん (line 32).

Mixed frame rates: each drum moves at its own rate, like animation on threes. The page (stamps, kick blocks, snare marks) steps at 24 fps. The sheet in the feed (kick) moves at 10 fps, the pink drum (snare) at 15 fps, and the ink flood (hat) at 6 fps. The constants are `RATE` in `riso.ts`.

### Plate 5 · parrot

| Driver | What moves |
|---|---|
| Syllable | Each committed glyph strikes in as a block (ink, or red for a surprise) with the glyph cut out, then prints. The reading types in, the underline steps from dotted to solid, the window pops, sorts and folds. |
| Kick | The prediction fan bursts from the cursor: the parrot's top 11 next glyphs with true p, size by p. Each onset re-ranks it, strikes the sung glyph and crosses out a wrong first guess. |
| Hat | The cursor blinks, the ghost under it steps through the top three, and wrong guesses pop beside the committed glyphs, then stay in gray, struck out. |
| Snare | The parrot "corrects" a glyph it did not predict to its own first choice, then the sung glyph stamps back. |
| Do you know? | None: the call is the transition `divider.ts`. |

### Plate 6 · bored

| Driver | What moves |
|---|---|
| Syllable | The glyph pops in as a selection block at 1.35×, then hops to its place, with a caret. A new message scrolls the list up in a jump with an overshoot. |
| New line | A red NEW divider with the line and the save number. Each save pops a file chip in the input bar. |
| Kick | Reaction pills count up, pop and spray copies of their glyph. The unread badge ticks. Your typing in the input bar is selected and deleted. Some kicks pop a kaomoji sticker. |
| Snare | A recent message lights as a mention. A kaomoji sticker pops on the free side. |
| Hat | The typing dots hop. One spam character is typed into the input bar. Past glyphs turn into typos with a red squiggle for 2 steps. |
| Camera | Punches in on the jumbo ？, on ビ (the cat fires) and on ム (a second slit). |

### Plate 7 · tiny

| Driver | What moves |
|---|---|
| Syllable | Each glyph strikes in selected with a caret. 器 slams in, then steps smaller with an overshoot on each syllable. |
| New line | The screenshot is taken (crop brackets close, the status bar drops, the post shrinks pixelated), the quote card pops in and the feed jolts down and settles. |
| Chrome (45–47) | Each piece that goes is plucked up and falls off the frame, turning. |
| Kick | The like heart bursts and its count jumps. |
| Snare | The repost arrows turn, the count jumps, a repost toast slides in. |
| Hat | Replies pop around the post one by one. |

Line 50 drops all of it: the nest scrolls away, the lone post stays and only tugs on the kicks.

### Gott ist tot (voice)

The call is cut word by word across the voice's span. The debris of the dying era blows out across the red in 12 fps steps: metal sorts of the press (gott1), chips of the screen (gott2). The page that closes over the red stays clean.

### Plate 3 · entries

| Driver | What moves |
|---|---|
| Syllable | The glyph appears as a black block with the glyph cut out, 1.2× for one step, then prints. A cursor bar follows the newest glyph, and its column lights up. |
| New line | The new page wipes in from the left in 4 steps behind a black bar with a red edge. |
| Kick | The head rule slams, the seal pulses, the red plate jumps. Registration marks pop, heavy rules shoot across empty rows. `No. nnnn` counts up. Red squares run down the cross-reference lines into the seal. |
| Snare | A random set of glyphs on the page inverts for 3 steps. A big inverted glyph drops into an empty cell. |
| Hat | Dotted gray fields flash in empty cells. |
| その lines | Each `→ 神` grows a red line into the seal. |
| My God | The call slams in 1.32× too large, then settles. It takes the seal: the page has no seal from the call until its end (54.28–54.98 s, 61.04–61.74 s), then the seal is back. |

Marks only fill empty rows. The density grows to line 28.

### Plate 8 · epigone

| Driver | What moves |
|---|---|
| Syllable | The sung glyph hops in (0.3 em, 0.1 em, in place). Headwords stamp one glyph per onset. In the loop the ring turns one slot on each その. In line 61 each ぽい stamp slams in. |
| Kick | A large pseudo-kanji assembles in a side margin from two halves, holds, then flies apart. One sung kanji (never the current one) swaps half of itself for 0.2 s. Seals pulse, the loop tightens. |
| Snare | A cross-reference line snaps from a margin glyph to the sung glyph. In lines 58–59 every `→ 神` re-routes into one growing red hole. |
| Hat | A random set of margin glyphs pops a new glyph in full ink. |
| My God, エピゴーネン | The Fraktur slams in. |

The density builds to エピゴーネン, drops for the loop, and is full at 175.02 s, where plate 9 takes over.

### Plate 9 · last

| Driver | What moves |
|---|---|
| Syllable | A stamp comes down over 2 steps (oversize, lifted) and lands. The view steps out as each stamp lands (1.75× down to 1.0×) so stamps continuously fill the screen. Each cut of the last seal is larger. |
| Generation | Every generation is a JPEG re-save stepping down from q76 to q12 with compounding passes. |
| Kick | A barrage of almost-kana is thrown onto the pile for 3 steps. |
| Hat | Margin glyphs pop in full ink, oversize. |

### Plate 10 · new

No drums. The Specimen Box drafts each sung glyph live and launches era shards into the codex columns while the marginalia vine grows step by step and the seal pulses on the beats. On the a cappella `人生`, both the column block and the Specimen Field cut open onto the red substrate. A fresh vellum sheet sweeps across the page and the `神` seal punches through onto red: Frame 0.

## Director review 2 (board v2)

| Plate | Verdict | Next |
|---|---|---|
| 0 | illuminated is the look; the shakyō brush stroking is also good | default `look: illuminated`. Bring the shakyō brush pen into the illuminated page (write 愛 and the lines by brush). |
| 1 typewriter | good as is | later: the carbon copies react to the beat and the music |
| 3 modernist | liked | keep |
| 4 riso | lacking | build on real riso: more drum colours (fluorescent pink, yellow, teal…) layered and overprinted, not only black and red. Red stays the substrate and the meaning; check how extra inks fit the palette rule |
| 5 IME parrot | liked | keep |
| 6 chat, 7 timeline | loved | keep |
| 8 text-ish | pseudo is better | default `ish: pseudo` |
| Gott ist tot | cool and fitting | keep |
| 10 | palimpsest is meh, assembly may be cool | default `look: assembly` |

The whole video in real time: not bad, but static. The song asks for more motion and graphics. That is the next scope after the look is settled.

Idea to keep, not to build now: ビーム as the "cat firing a beam" reaction GIF of chat culture. The video uses no media and models no cat, so it needs a procedural or typographic form (for example a kaomoji or an ASCII-art cat whose beam is the slit onto red).

## Board v3

`out/stills/era_board_v3.png`. Plate 0 illuminated writes all JP by the shakyō brush. Plate 2 broadsheet and plate 9 last are built. Plate 4 is a four-drum riso. Plate 6 has the kaomoji cat (=^・^=)ノ firing the ビーム slit.

## Open

- Where faux-datamosh earns its place (candidate: line 54, エピゴーネン).
- Credits text: PinocchioP (words, music), the VocaColle stems, KanjiVG, the fonts.
- The right to publish: the web player puts the mix of a song by PinocchioP on a public site. Read the terms of the VocaColle stems before anything is published.
- The exact red against each era's ground, to tune in stills.
