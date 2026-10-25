# breaked — treatment v5

194.26 s · 200 BPM · bar = 1.2 s · first downbeat 0.296 s · sections are 16 bars (Verse 4 and Build up: 8).

## The idea

**The walls are made of what he says.**

Every syllable he sings becomes a brick, and the bricks pile up into walls. A line is a wall. The chorus is a room. He can't see the walls surrounding him because he is the one building them. He is never drawn: the first sung "i" is the title's 256 cells, and where the song needs a protagonist it is an abstract stand-in, a deforming tesseract (the network's answer, and the outro).

One blue thing is never gone. It is the "you", or what he did, or what he lost; the video never says which. **Blue is the ground behind everything**: every layer on top of it is binarized to black and paper, and blue shows through wherever the layers have holes (mortar gaps between bricks, torn edges, halftone gaps, a missing brick). Sometimes it is one pixel, sometimes the whole frame.

The video loops. The last frame is the first frame. The intro is the end of the previous cycle; its red herrings are memories from a loop the viewer hasn't seen yet.

## Rules (hold for every frame)

1. **Blue is always behind.** Nothing is drawn in blue; blue is the substrate, seen only through holes in the binarized layers. It never leaves; the layers only cover more or less of it.
2. **Bricks = letters = walls.** The lyric typeface is built from the same module (the brick) as every wall, square, and grid. Nothing on screen is made from a different vocabulary.
3. **Every syllable is legible at its onset.** The current syllable is always readable. Past syllables may turn into wall texture.
4. **No fake data.** Any small text is true about the song: lyric, syllable index, bar number, timecode.
5. **Luminance flips stay at or under 3 per second** for any change covering more than ~25% of the frame. Intensity comes from density and motion, not strobing.
6. **Banned:** RGB split, datamosh, glitch transitions, lens flares, light leaks, camera-shake presets, chromatic aberration, generic particle bursts, karaoke wipes, centered subtitles, HUD boxes, corridors, and anything a first-week After Effects user would reach for.
7. **No lyric line sits centred across the middle.** Type sits on walls, in grids, at edges, at architectural size, cropped, at several scales.

## Time

The video runs at **30 fps**. Layers run at their own lower rates inside it: 24 (type), 17 (scratches and clumps), 15 (walls, Life boards, the plane), 12 (ink boil, dust, the Tetris tears, the ships, the camera of the network diagram), 8 (grain). Each layer holds its time with `stepT(t, fps)`.

## Game of Life

The computational growth of what he said. A syllable that is done becomes a Life seed and goes on living: it can't be taken back.

- **The plane** ("small conways"): every plate has its own 640x360 torus at 3 px cells (`planeSeed` in `_machine.ts`, seeded from the clip id): Gosper guns firing into eaters and oscillators, one isolated part per 80x90 slot, so it never dies into ash or explodes. It runs from the plate's first frame at one constant rate (12 generations a second unless the plate sets its own) and never resets inside the plate. It moves and scales with the plate's camera (`PrintOpts.view`, anchored at the frame centre) and stays inside the 2.39:1 box (only the final chorus is full frame).
- **The ships** ("sideway conways"): c/2 spaceships and c/7 loafers drawn phase by phase on their own layer (`ShipLayer`), a few lanes per plate, one across the top bar; every two bars (on the downbeat) each ship switches to the next pattern in its lane (`lwss`, `mwss`, `hwss`, `loafer`), and each plate sets their speed (`shipSpeed`). They may cross the bars.

## Palette

| Ink | Use |
|---|---|
| Black `#0b0c0d` | void, walls |
| Paper `#f3f0ea` | bricks, type, field |
| Grays (only via halftone and grain, never flat mid-gray fills) | depth, fading |
| Primary blue (ultramarine, ≈ `#2a1fff`) | the ground behind every layer, never drawn, only revealed |

## Surface: dirty print matter

Everything goes through one print pass. Layers are drawn with coverage and tone; the pass binarizes them: coverage is thresholded with noise (torn edges, ink bleed), tone becomes black or paper through a halftone screen, and anything not covered shows the blue ground. Partial coverage turns into dots of blue through the layer. Clean vector geometry only exists before the print pass, never on screen. Overlays, all small, never feathered: grain (2 px specks, 8 fps, sparse), the plane, the ships, short vertical scratches (they may cross the bars), and sparse clumps riding right. Each plate sets how much of each it takes (`PrintOpts`: `noise` scales all, `grain`, `plane`, `ships`, `scratches`, `clumps`); text-heavy plates take less. Walls and letters take procedural damage: chips, cracks (holes onto the blue), missing bricks.

**Over transitions** (video.json `transitions`): a scene drawn on top of the clips around a cut, printed over them with no second set of overlays (`OverScene`): the mirror's shards flying into the chorus (`shards`), the ceiling's last tiles falling into dust (`tiles`), the save dialog's progress bar breaking out as a laser into the network (`laser`). Objects crossing the bars carry the impact: shards, falling tiles, the vortex's arrows, the warheads.

## Frame

2.39:1 letterbox inside 16:9. **The bars are walls**: solid black, the blue never shows in them. Objects poke out over them (passing slabs, the shards, the falling tiles, the vortex's arrows, the warheads), like the train coming out of the screen. They compress in four sudden moves at "walls surrounding me", crack at the end of the instrumental, and the whole screen **shatters at 153.88 s**: the final chorus is the only full-frame section. The outro rebuilds them course by course.

## Type

- **Brick letters**: constructed modular letterforms drawn in code at 2x: each glyph cell is 2x2 sub-cells, and the outer top-right and bottom-right corners are cut where nothing touches them. That gives the face its forward lean and makes "breaked" exactly 256 sub-cells. Digits and `:` `.` exist for clocks and counters. **The first sung "i"** is the brick "i" at 4x4 micro-cells: 288 slots; the 256 cells of BREAKED fill all but 32, which stay holes onto the blue. Each glyph is a set of bricks, so letters can assemble, fall apart, freeze, be exploded into diagrams, become Life, and break into code.
- **ASCII** (final chorus): a monospace grid of 12x18 px cells over the whole frame (`_ascii.ts`); letters there are built of their own letter.
- **Rebate mono**: IBM Plex Mono 12 px for the true marks (bar counts, part numbers, layer names).

## Lyric system (both layers)

- **Backbone**: on each syllable onset its bricks arrive (stamp, slide along grid lanes, or drop) and lock into the current wall course. Earlier syllables stay in the wall, dimmed by halftone. The rule mutates per section.
- **Key-line compositions** break the backbone for lines that carry the story (marked ★ below).

## Plates

| # | Section | Time (s) | Plate |
|---|---|---|---|
| 0 | Intro | 0.00–19.52 | Previous loop |
| 1 | Verse 1 | 19.52–38.68 | Walls going by, the mirror |
| 2 | Chorus 1 | 38.68–57.90 | The room, the ledger |
| 3 | Verse 2 | 57.90–77.08 | The ceiling |
| 4 | Verse 3 | 77.08–96.28 | Dust |
| 5 | Verse 4 | 96.28–107.98 | Exploded view |
| 6 | Build up | 107.98–115.48 | Droste |
| 7 | Chorus 2 | 115.48–134.68 | Without |
| 8 | Instrumental | 134.68–153.88 | The network |
| 9 | Final chorus | 153.88–173.08 | The fabric tears |
| 10 | Outro | 173.08–194.26 | Rebuild |

### 0 · Previous loop (0.00–19.52)

The song opens on a hit at 0.3 s. Black void, grain fading in from the loop seam, and one blue module off-centre, blinking off on every beat.

- **The bloom**: from bar 1 the module is the first cell of an R-pentomino. It blooms through the void as 16 px holes onto the blue at one constant rate, two generations a beat, to the last frame; the title breaking apart does not stop it. Rebate marks count it: rule, generation, population.
- **Red herrings** on the low hits (bars 4, 10, 14): a fragment of the wireframe ceiling, held under a beat.
- **A countdown that lies**: rebate marks count bars down. At 0 nothing explodes.
- **Title**: `BREAKED` registers in brick by brick, slowly at first: each brick shows its outline two frames before it lands, then hairlines through its edges and its index for three frames. A capline and a baseline draw in, and one stem per letter, a bar each, like a construction drawing. On the last bar the 256 sub-cells burst outward, hang, and fly cell for cell into the first sung "i", high on the wall of Verse 1, where the wall takes it over on its first frame.

### 1 · Walls going by (19.52–38.68)

Elevation view, never a corridor. A long damaged wall slides by slowly, as from a train window.

- "i looking at the walls as days went by" / "i don't know what's real or fake any": the lyric is written on the wall and moves with it: the first "i" is the title's cells, then word by word where it can be read, in reading order along rows. Each syllable forms its own way: sprayed, laid brick by brick, pasted and unrolled, chiselled, grown from Life cells, plotted, painted with drips. A couple of air-conditioning units are bolted to the wall between the words, fans turning. Mid distance: drainpipes and a few lamp posts. In front an alley goes by at 12 fps: stacks of boxes and crates, dumpsters, pipe runs from the top bar, chain-link fences.
- ★ "more i look at the mirror i" (scene `mirror`): the wall of Verse 1 (`_wall.ts`) carries on from `walls`, slows down over a bar and stops; a fresh coat of black is rolled over a patch of it and the line types onto it, stuck to the wall as it comes to rest. From "mir|ror" the camera pulls back at one slow linear rate to "coming": the whole scene was inside a mirror hung on that alley wall, and out here the alley reads backwards, its painted words, drainpipes and air-conditioning unit.
- "can't see myself like i used to in the past without you here": the whole line fits the glass.
- ★ "co|ming|right|at": the mirror jumps at the camera on every syllable, about the typed text so it stays in the frame ("at" gets a row of its own, centred, and its kick brings it to the frame centre); the glass cracks from one point and on "at" it shatters, the wedges (carrying their piece of the mirror) flying at the camera over the bars and, across the cut, on into the chorus (Over `shards`).

### 2 · The room (38.68–57.90)

A typewriter fills the frame with the chorus on a fixed letter grid, dimmed. The grid is an LED screen whose pixels are its own letters: the syllable being sung lights its letters as solid paper blocks with the letter knocked out.

- "i can't stop i just went on without a destination": the typewriter never stops; when the screen is full it wraps and types over itself. ★ "without a destination" (from 41.83 s): a vector field, streamlines spiralling into a blue singularity, and four big curved arrows bending along them, riding out over the bars.
- ★ "i can't see the": a flashlight brightens the dim wall where it shines, lands on each syllable at its onset, wanders off looking, and its circle opens until the whole wall is lit.
- ★ "walls surrounding me": **the walls compress in four sudden moves**, top, bottom, left, right, one per syllable of "walls sur|roun|ding", each a kick of the frame; in the window left the text is solid and the lit syllable is cut through to the blue on top of the wall of text.
- "what i have done i can't atone" (scene `atone`): a paper ledger. Each syllable is crisp ink while it is sung; when it ends it becomes a Life seed and goes on living, two generations a beat. The words that weigh most are blue, and their living cells stay blue. Each line has an entry number in the margin and is struck through when it ends; a tally of the days runs down the right edge, a mark a beat.

### 3 · The ceiling (57.90–77.08)

- A wireframe ceiling seen from below, turning slowly. Tiles in view carry words of the song; on every downbeat a new random selection of tiles in view take words (the words jump to other tiles, nothing flips). When a word of the line names a thing, a tile in view switches to its 1-bit pictogram: an eye, a clock, a house, a drop, a question mark, a heart. Every sung syllable is stamped on a tile of its own.
- The line runs along the bottom with a hard ink shadow; the next line slides in and pushes the one before it out to the left; tears: when a syllable is done its bricks drop like stepped Tetris pieces at 12 fps. From "reason to live" the words stand on black boxes so they read over the falling ceiling.
- ★ From "ceiling" the tiles come loose one per eighth, tilt and fall at the camera over the bars, leaving dark holes; on the last bar it all comes down, and the last tiles keep falling into dust (Over `tiles`).

### 4 · Dust (77.08–96.28)

Dissolution, four movements; the lyric lives inside each picture.

- ★ "as time goes on waiting for none": an LED alarm clock; its seven-segment digits (the song's time) are made of Life cells, the colon blinks on the beat, the line runs along its marquee in sync with the singing.
- "one has to ask where do i go from here": a maze is carved depth-first onto the blue by a snake, a cell longer every bar; food appears on the beat ahead of it and is eaten. The line is the level name. "having lost everything": the walls fall away.
- ★ "looking at my shadow" to "as cold as my heart": a stationary camera on a 6x6x6 voxel cube; a day a bar, the sun crosses and each voxel casts its shadow along the light ray onto the ground; at night the sky is black with the moon and long-exposure star trails round the pole (no plane here). The line is painted on the ground (ink on lit ground, paper inside the shadow). From "fading" the voxels let go outside-in and rise as tumbling 3D dust, frozen on "heart".
- ★ "i am losing my existence": a record of existence; each syllable redacts one field in blue, the photo loses its dots, "existence" stamps it VOID. On "dis|fi" the record comes apart into cells drawn into one line while the pencil writes "dis|fi" above it (and carries on with "gured" on the blueprint).

### 5 · Exploded view (96.28–107.98)

A blueprint (scene `flock`): paper linework on the blue, a bordered sheet with zone marks, a dot grid, a parts list, a detail view, a plan of the frame, a title block, dimension lines. All four lines fit the box.

- ★ "disfigured beyond recognition / it is my admission": the lines stand as extruded bricks in axonometric and stay; the pencil draws the first row in as it is sung; each syllable of "disfigured" knocks its bricks out of true.
- ★ "de|con|struc|tion": "de" cuts a section A-A and parts the letters; "con" and "struc" make the parts tremble, harder, and "struc" kicks the sheet; on "tion" the exploded view throws wide with leader lines and part numbers and the parts take off as a flock of birds, each leaving a fine Game of Life trail.
- ★ "and let everything stop in motion": the Droste window (`_droste.ts`) opens at the centre on "and", every word from "and" on a level of its own, and grows until it fills the whole frame by "emotion". The birds never freeze: from "stop" they turn into warhead glyphs and dive into the window a group an eighth on dashed ballistic arcs; a few become the escort arrows that fly down the tunnel with us.

### 6 · Droste ("emotion" 107.98–115.48)

- One continuous `DrosteFall` with `flock`: the levels fill the whole frame and beyond; every level holds a smaller one (0.42x, turned 0.18 rad), the rings between them blue, ink, paper in turn. The camera falls through it on one smooth curve, faster and faster; every sung word stands in its level's band and grows out past the frame with its level. The escort arrows fly with us down the tunnel round its spiral.
- From "inner demon": Maxwell's two sealed chambers ride in the side bands of every level, blue and paper particles bouncing, never sorted.
- In the last 0.45 s the 4x2 grid of Chorus 2 closes over the fall (gutters cut to the blue, cells closing to ink) so the cut into `without` is seamless.

### 7 · Without (115.48–134.68)

Every line here is exactly 2 bars (2.4 s). The frame is a 4x2 grid, one cell per line, in order; the gutters are holes onto the blue. Each cell has its own image of its line and **keeps living after it**; every cell takes some blue. The cell being sung kicks with the low end.

- "i can't even lie to myself": the letters of "myself" trade places every beat, as holes onto the blue while out of place, and fall back on the bar.
- "my despair is all that i have": the cell is papered with tiny "despair", and on every beat a few of the words turn blue; the line stands on a band cut through to the blue.
- ★ "i tried to grab something to help": an arcade crane game; 3D primitive prizes (cubes, octahedra, icosahedra, cylinders, cones) rain in on the beat and pile up with rigid-sphere collision; a 2D gantry and three-prong claw grab one off the pile and drop it back near the top.
- ★ "me stay alive without a light": the words show only inside a light onto the blue that follows the voice and closes on "light"; after, an empty light comes back for a frame now and then.
- ★ "without a sight": the words are holes onto the blue; under them a wall of six eyes with blue pupils looks around and blinks, shuts on "sight", and one twitches open now and then.
- ★ "without a signal": one fractal per beat, four steps per beat on the sixteenths (Sierpinski, Koch, H-tree, carpet in turn), cut to the blue.
- ★ "as i falling through my feeling": grid planes rush up past us; the whole line stands until 130.31 s, then each whole letter falls from rest with real gravity ($1/2 g t^2$) into a blue hole.
- ★ "as i staring at myself": Narcissus is the Bootstrap pointing hand, angled down at the water and lowered nearer and nearer to the blue pond; the hand and the line ripple in the water, a ring spreading on every beat.
- ★ "is there something to save (save)": every cell closes with its own battle-transition wipe to **blue**; the line runs across the frame and a save dialog stops at 99 %. On the second "(save)" everything else disappears: only the word `SAVE` (in blue) and the progress bar remain on a paper ground. Across the cut the progress bar fires straight right as a laser (Over `laser`, no rotation).

### 8 · The network (134.68–153.88)

No vocals, 16 bars, the showpiece (scene `cnn`). Everything he said, fed through a convolutional network.

- The input is the song so far, set in bricks on a 192x108 grid. 3x3 kernels slide over it (window and connection lines drawn) and the feature maps fill row by row; max-pooling halves them; a second convolution mixes them; pooling again; a dense column of 32 units wired to the pooled maps; a head of twelve classes with live softmax bars, every class curving into one output cell. Laid out in an oblique 3D like a network figure; the camera tracks the active layer at 12 fps while the Life plane moves with it in parallax. The training loss draws in over the first bar and spans the whole width, its x axis zooming out (`0..step` across the width) as training steps accumulate, bumping with the music.
- The output flashes the inputs it is shown (words of the song, a glider) with its prediction, faster and faster, and stops on the protagonist, a deforming tesseract, at 1.00 (bar 128, beat 3). Over the last bars a physical spiderweb of radial rays and cross-rings cracks outward from the output cell; on the last beat the whole screen breaks along those very cracks and the shards fall down under gravity, leaving the tesseract standing into `broken`.

### 9 · The fabric tears (153.88–173.08)

The apex, full frame. Behind the falling shards there are no bricks any more, only character cells (160x60 of 12x18 px). Every lyric line appears in place like `walls` (wrapped to fit the 60 rows, each syllable forming on its onset in blue over a dark margin, never sliding).

- ★ "(i) i": the tesseract from `cnn` collapses into the real "(i)" (a hole onto the blue spelled in its own letters) and "i" (bricks breaking into code). Behind it Cantor's diagonal: an endless list of binary rows scrolling up, each row's own digit on the diagonal flipped in blue. The rest of the line forms in blue in place; "without a destination" brings the vortex over the code.
- ★ "i can't see the": the chorus as a dim wall of text, a flashlight brightening it, and the sung words stamped large in blue over the wall; in the last 0.35 s the hotel doors rise in. "walls surrounding": Hilbert's hotel, the sung syllable in blue across the middle; each snap slams the walls in and moves every guest one door up, and "(i)" checks into room 1; "me" blows the walls out. "without a doubt": the diagonal again, the line in blue; "never gone" floods it blue in blocks.
- "what i have done i can't atone": a Life board of the syllables on the left (clear of the calendar), two generations a beat, the sung words kept readable in blue/paper over their living cells; on the right, a wall calendar whose day number counts up (`DAY 001`..), tearing off pages that curl and twist in 3D as they fly off to the right.
- ★ "the destination's still a far / i'll never see you again": a 4x3 wall of all twelve scenes, a permutation of `0..11` on every beat so every cell is unique, the line in blue in place; on "again" the tiles thin out and one blue module drifts away to nothing.

### 10 · Rebuild (173.08–194.26)

A hard cut into black. Right from 173.08 s the intro's bloom is on the blue at the generation the intro left it and runs backwards (a forward run from the R-pentomino, played in reverse) down to the single blue cell. Meanwhile the letterbox walls are laid course by course from the edges inwards, alternately top and bottom, brick by brick, their blue mortar always showing so the walls keep growing until 192 s and then dissolve brick by brick into the black of frame 0. At the centre the tesseract draws itself in, turns at 10 fps, and goes into the single cell as the bloom collapses. The credits stand in a plain box (`"Breaked" — written, composed and arranged by FuouM. Remix made with Suno. Visuals by Claude Opus 5.5 under FuouM's direction.`) with the overlays turned off while it is up. The last bar is the intro's first: black, the one hole blinking off on the beat, the intro's rebate.

## 3D usage

Wireframe and procedural only, never an environment: ceiling grid with falling tiles (P3), mirror pull-back and shatter (P1), the cube's time-lapse (P4), exploded axonometric (P5), Droste squares (P6), falling grid planes (P7), the network diagram and the tesseract (P8), the screen shatter (P8/P9). All of it passes through the print pass.

## Open

- The tesseract stays or goes after v5: the director decides.
- Exact blue: tune against the halftone pass in stills.
