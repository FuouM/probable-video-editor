# sardine: treatment v9

Song: Koronba, イワシがつちからはえてくるんだ. 135 BPM, 96 bars, 170.667 s. Bar = 1.778 s, beat = 0.444 s. 36 fps, so 1 beat = 16 frames. Lit low-poly 3D at 640x360, nearest x3 to 1920x1080.

Lyrics:

- `user_input/lyrics.map.json`: lead kana with English.
- `user_input/lyrics.map.ko.json`: the second voice, the tuna lines.
- `user_input/lyrics.map.ca.json`: the lead double in chorus 2.

v9 comes from the director's review of the v8 build (`video/notes/3534.md`) and three rounds of questions. The director puts v8 at 70 to 80 percent: the narrative is clear and the one world works. The argon review (`.scratch/v8_after/argon_v9.md`) is a second opinion. Where it and the director's note disagree, the director's note is correct. "From the argon review" below lists what the director took from it.

**This file is the only plan.** There is no handoff file and no refinement file. When the plan changes, change this file.

## What v8 got wrong

v8 is the base. Its world, its story and its carriers stay, except where this table says so.

| Fault | What it did | v9 |
|---|---|---|
| State that is not a function of t | In the studio preview the duckboard and the zone buildings are sometimes broken or in the wrong order on the first play. A scrub puts them right. The render is correct. | Find the cause first (pass 0). Every body, layer and swap takes its state from t on each frame, on the first frame too. |
| A cursor that waits | The cursor stands still between its clicks, in every act. | The cursor is a person at all times (see "The hand"). |
| A world that does not feel a hit | The cut, the splice, the flower walls and the stall have no weight. | The world takes the hit: the ground, the props, the train and the windows shake as objects (see "Framing"). |
| Chorus 3 is chorus 2 again | The same lap, a compass camera, lines painted flat on the sky that overlap, a typing game with no clear stakes, little light. | A long straight line, the world that breaks from the left, a wall that grows, a sky that falls apart, tuna that destroy the world (see "Plate 9"). |
| The outro | A train in empty purple space, a small unsharp wall, no pace. Far under the level of the other scenes. | No flight. The wall is the set piece of the whole last chorus (see "Plate 10"). |
| Not enough light after bar 44 | The arp beams and the pulses leave the frame as the camera turns to the moon. | More light, in the frame, all the way (see "Plate 5" and "Plate 9"). |
| Loose ends of continuity | The pass comes and goes on the fish and changes its size. The fish jumps from its seat to the cab. Two cars with nothing between them. Faces that z-fight on the tuna. | Listed in the plates. Pass 0 and pass 1. |

## The rules of v8 stay

1. **One game world.** One stem, one loop, five stations, one town. Every game shot and every map window shows it.
2. **The world is the subject.** Lyrics are diegetic and readable on a first watch, but no shot is staged for them.
3. **The cursor is where the action is.** A tooltip follows the cursor on every frame. A tool acts only in the cursor's hand.
4. **A camera with weight.** No snare punch, no bob, no step zoom. From 56.000 the train never stops.
5. **Every click has a result that spreads.** Baked physics: small pieces, real bodies, things that react to each other.
6. **Less.** The chorus 2 replay windows are out. The verse 2 day skips stay: the day counter jumps on each kick (see "Plate 7").

## v9 in short

1. **The cursor is never idle.** It pokes, tidies and, from 56.000, panics.
2. **The world takes the hit.** Objects shake on an impact. The camera almost does not.
3. **The tooltip leads the eye.** It is the best tool to take the viewer's attention from one place to the next.
4. **More light.** Fireworks, beams, lamps: "more blings = more good".
5. **Chorus 3 is a race out of the loop** to the painted wall at the end of the world. A new straight track opens from the loop, and the world unloads behind the train. At the end the train breaks through the wall, and the game breaks.
6. **Three layers.** The game world (the sardine), the program (the cursor, the windows, the views), the CRT (the player and the viewer). The mini jellyfish live in the middle one and damage it.

A stranger who knows Koronba should say: "I did not expect this reading of the song."

## The idea

**A train simulator played too many times on the night before moving out.**

Someone moves out tomorrow (`11月3日 引越し`). On the last night they sit at the kotatsu between boxes and play a 1999 isometric train-and-town simulation (in the style of RollerCoaster Tycoon and A-Train) on a curved CRT.

## The spine

**The sardine is the part of the player that is ready to leave. The player is not ready yet.**

- **The player** does not want tomorrow to come.
- **The sardine** is the player's avatar in the game. It wants to move on. It rides the train toward `あした`, it packs the boxes in the game's copy of the room, and it carries a pass to `あした`.
- **The game** is a timetable. Tomorrow is a row in it. Cutting the track does not delete the row. The game is not angry. It runs, and its events come whatever the player does.

| Act | Sections | What happens |
|---|---|---|
| 1. The player traps the sardine | chirp to chorus 1b (0.000–56.000) | The player cuts the line and splices tomorrow to yesterday. They pick the sardine out of the train and drop it into the house. They punch the pass invalid and delete the duckboard. The game then loses its props and zones buildings by itself, and the player opens the ground to clear the board. |
| 2. The sardine defies the player | 56.000 to verse 2 (56.000–106.667) | The train outruns the hole into the tunnel and leaves the map. The player cannot close its window. The train rams the moon, the game disc, and cracks it. The player rereads and reloads. The track comes back twisted. The train runs every station through and wrecks Station `もと`. |
| 3. The game runs tomorrow | chorus 2 to outro (106.667–170.667) | The player keeps playing on the broken save, with a jellyfish in the way. The player tries to kill the jellyfish and kills the program: the screen crashes to a blue screen. Tomorrow just past noon comes as doomsday: the tuna destroy the world, and the player fights them at the keyboard to the end. The train leaves the loop on a new straight, hits the painted wall at the end of the world and breaks the game. The real room is empty at dawn. |

Control flips at 56.000. Up to that time the player wins every action. From that time the player loses every action. In chorus 3 the player wins single keys and loses the world.

Do not explain the story on screen. v6 read well because it showed little and left room. Show the event and go on.

The tuna are doomsday with no meaning attached. Do not explain them. In the bridge they catch the falling train, but only to carry it into the moon.

## Theme: wearing down

Each forced loop wears the copy more. Every break in the picture is a fault of a game, not of a film.

| Wear | Where |
|---|---|
| A cut and spliced timeline | Verse 1: the scissors and the bend tool. |
| Missing assets | Chorus 1b: props turn into magenta and black checkerboards, by themselves. |
| Out of bounds | Bridge: the train leaves the map. |
| A cracked disc | Bridge: the moon is the disc. |
| A bad read and a retry | Interlude: `RETRY 1/3..3/3`. The pieces come back in the wrong places. |
| A save that loads with an error | Interlude: the track settles twisted. |
| Noclip | Verse 2: at もと the train goes through the platform into a place that should not be there. |
| A save that never loads | Verse 2: `LOAD STATE` fails on each kick. |
| A process that gets out of control | Chorus 2: the jellyfish and its copies damage the picture of the program. |
| A world that gets unloaded | Chorus 3: the line behind the train turns to checkerboard and drops away. |
| The end of the world box | Chorus 3 and outro: the world unloads behind the train, and the train hits the painted wall at its end. |

Game glitches only: wrong placement, duplicates, clipping, noclip, z-fighting faces, missing textures, the view under the map, rigid-body debris. No RGB split, no VHS noise, no chromatic aberration, no datamosh.

One exception, in one place: the picture faults under the mini jellyfish in chorus 2 (see "The jellyfish"). They are faults of the program's own picture (blocks, stale patches, shifted rows, wrong palette), they stay inside the windows of the program, and nothing else in the video has them.

A second exception, in one place: the end of chorus 2 is a crash of the program (see "Plate 8"). The screen tears, drops to a text mode and then to a blue screen. The blue screen goes over into chorus 3 as a datamosh (`_c3mosh.ts`). Nothing else in the video has a datamosh.

Z-fighting and clipping are wear only where a plate asks for them. On a model that is whole (the tuna, the car interior) they are faults: fix them.

The place under the map at もと and the stage behind the end wall are the two places that the game does not mean to show. もと plants the idea. The wall pays it off.

**Missing texture.** A missing asset keeps its shape and loses its material: an unlit magenta (`#ff00ff`) and black checkerboard, 8x8 cells per face. A swap is a hard cut on its syllable.

### Meta

Koronba deleted everything and left the internet. The fans archived what was left. This video is one more copy. The meta stays in the structure only: no re-upload artefacts, no watermarks. The video does not make the author's absence a spectacle.

## Three layers

| Layer | What it is | Who lives there | Camera |
|---|---|---|---|
| THE ROOM | A 6-tatami apartment on the last night. Boxes, the kotatsu with mandarins and a mug, the wall calendar (`NOV`, `3` circled, `引越し`), the clock, the balcony door, the grey CRT on a low cabinet. Some boxes are still open. | The player, and with the player the viewer. | The player's head. |
| THE PROGRAM | What the CRT shows: a bevelled toolbar, a status ticker, a mouse cursor, pop-up viewport windows, dialogs, the console. | The cursor. From chorus 2 the jellyfish and its copies. | The player's hand. |
| THE GAME WORLD | The simulation inside the windows: the track, the town, the train. | The sardine. The tuna. | The views of the program. |

A thing acts on its own layer. The cursor acts on the world only through a tool. The jellyfish does not touch the world: it takes windows, the cursor and the picture. The tuna do not touch the program. A crossing of layers is an event, and there are three: the pick-up hand that lifts the sardine (27.1), the cracks that run into the CRT glass (85.333), and the train that pokes out into the room (167.111).

Time in the room moves honestly: dusk at the chirp, deep night at the interlude, dawn at the outro.

- **Room to game:** a push into the CRT glass. The CRT shows the live game picture, with its window chrome, during the whole push. Nothing pops in on the last frame.
- **Game to room:** a crash, twice: the moon at 85.333 and the sky wall at 167.111. The head jerks back.

**The copy of the room.** The player's house stands in the game town, and it has a copy of the room. The copy and the real room are one model (`_home.ts`): the same walls, clock, calendar, kotatsu and quilt. They differ in the time of day, in the boxes (taped in the copy, open in the real room) and in the CRT. A copy-room shot has a window frame and may have the cursor in it. A real-room shot has neither.

## The game world

There is one game world. Build it once, in one module. Every game scene takes its geometry from it.

```
 イワシ ───────────── cut ──┐
        (the stem)          │        mountain tunnel
                      ┌─────┴──────────── ∩ ───────────┐
                      │                                │
                    もと          (the loop)            ？  + the zones
                      │                                │
                      └──── すのこ ───── ホーム ────────┘
                                      + the player's house
```

- **The stem.** A straight single track with Station イワシ. It never moves, and it never goes: it is in every state of the world. The cut and the splice are at its inner end. From the splice on, no train uses it. It lies there with its dark station, in view on the map and from the crossing, through verse 2 and chorus 2. Its outer end leaves the map: this is where the train came from before the video starts.
- **The loop.** About 100 m in radius, so about 630 m round. The player bends it out of the track ahead of the cut and joins it to the stem. In travel order it has ホーム (with the residential street and the player's house), ？ (with the ground where the game zones its buildings and where the sinkhole opens), the mountain with the tunnel, すのこ and もと.
- **The train.** Two cars with a joint. Each car stands on its own bogies, so the train bends at the joint and follows a curve. No car hangs over the inside of a bend. Between the cars are a coupler and a folding gangway: the cars are never joined by air. Act 2 starts with one car: the train of the bridge is one car (`_bridgeworld.ts`), and the train of the interlude stands with one car until the click on `CONTINUE`. Then the second car loads behind it as a bad copy with no texture, at another wrong place on each beat, and the coupler takes it on 93.778 (`T_COPY`).
- **Scale.** The train is 3.7 m high and 20 m long. The houses of the town have two sizes, by the view (`MAP_HOUSE`, `CLOSE_HOUSE`): a map view shows them at their true size, and the map reads as a map. A view that stands in the world (a ride cam, a station view, a cam of the room) shows them 1.5 times as large: beside the train they stand as houses do. The director chose both on a board. Both sizes stand on one plan (spaced for the large houses), so the map and the world show the same houses in the same places. When the camera goes from the map down into the world (the click on CONTINUE, 92.0) the save loads during the move: the houses grow from the map size to the close size in a wave out from the train, the light, the sky and the haze go over, and the objects of verse 2 rise out of the ground. The player's house keeps the measures of the room kit in both. A house is not a box: it has framed windows on every side, a door with a step, a base, and some of a balcony, an awning, a chimney, an aerial, an air conditioner, a hedge, a post box. The towers of the zones keep their size (35 m).
- **States.** The world has states, not copies: straight (before the splice), looped, zoned, holed, twisted, the long stem, unloaded. The time of day is a state too. A scene asks for a state and a time. It does not build ground of its own.
- **The twist.** At the interlude the reread puts the track back wrong. The loop and the stem keep their places and their stations. The read gives one piece of track twice, and the second copy is the piece that goes wrong: it lies across the loop on pillars, from the loop after ホーム to the loop before すのこ, and it turns over on the way. So the loop and the copy make a figure-8. A train that takes the crossing rides its top, turns with it, hangs under it over the middle of the loop with the fields overhead, turns on and comes down upright.
- **The way out.** In chorus 3 the train runs one more lap of chorus 2. A new straight opens from the loop at 33 degrees past Station ホーム (`L_EXIT`), piece by piece, away from the train, and the train takes it at 143.4. The straight is not the stem: it heads away from it. Past the edge of the map the game has nothing of its own to lay along the line, so it lays what it has: the same platform, the same board, the same lamps and the same street, again and again, for about 880 m to the wall.
- **The box.** The world stands in a box. Its end wall is painted canvas, at the end of the straight. Behind the wall is a stage (see "Plate 10").
- **Out of bounds.** The space past the tunnel is not part of the map (the bridge). It has its own scenery. The map knows where the train left it.
- **Minimaps.** A map window shows this world as a game minimap does: a simplified view of the same track, stations and state, from the same data. When the map is the main view, it is the real world from the map camera.
- **Reactions.** Things in the world react to each other. A cut rail springs. A dropped slat takes with it what stood on it. The sinkhole pulls real bodies. Bake with Rapier in `init()`, with more and smaller pieces than v7.
- **Life.** Before it breaks, the town lives, in small ways and never as a subject: a level crossing on the street whose bars come down and whose two red lamps take turns when the train comes, a vending machine that glows, smoke from a chimney, washing on a balcony and trees that move with the wind state, a signal that changes behind the train. Each of these has a state that an event can change: the wind stops, the crossing fails, the smoke stands still.
- **Speed.** A fast train has cues: sleepers under the rails that run past, dust at the wheels, marker posts close to the lens that whip past. In the air (the bridge) it has air lines: thin streaks that run past the train and along its sides. Use them from verse 2 on.

## Windows inside windows

When the player clicks a train, a station or a prop, a bevelled pop-up window opens (as in RollerCoaster Tycoon): a title bar, the buttons `[—][□][×]`, a live 3D view, a status bar.

1. **Two scales at once.** The map and a window show the same event. The first use of a window is the reaction of the sardine: when the player does something to the track, `[Car 1 - Interior]` shows the sardine as it sees and feels it.
2. **Maximize for detail.** `[□]` grows a window to the full frame. A player who wants a small window large goes to that window and maximizes it. They do not go to a button far away that does the same.
3. **Control.** In act 1 every window opens and closes when the player clicks. In act 2 a window refuses to close. In act 3 the jellyfish opens windows.

A window that shows the sardine's reaction stays open while the event goes on. Do not close it to make room for text.

A window never covers the subject of the main view. No window stands empty or still: if nothing happens in it, it is not open. A window that shows a ride changes its view (the side it looks out of, its subject) when the event changes.

A window is an object. A hard event in the world it shows makes it jump or sag on the screen.

**Status bars** show dry game telemetry only: `CAR 1  58 km/h  NEXT ？`, `EDIT: SPLICE  R=100m`, `ZOOM 2.5x`, `OBJ 014  FLOOR_SLAT  [DEL]`, `TEX 0x00FF00FF  MISSING`. Never a sentence, never a joke. The map status bar always has the zoom level.

## The player

The player is never seen. The camera must always feel like a person controls it: a person moves with intent, reacts late, overshoots a little, then holds still.

### The head (room shots)

- The eye is fixed at seated height at the kotatsu.
- A look is a turn of about 0.3 s with a small overshoot and a critically damped settle, then a hold. A turn has a cause. The speed is that of a person who looks, not of a person who is hit.
- The crash recoil is the one fast move.

### The hand (game shots)

All game camera motion in acts 1 and 3 comes from one input track: a list of player inputs on the beat grid.

| Input | Rule |
|---|---|
| Cursor move | A slightly curved path that eases out. It arrives a beat before the click. It moves at the speed of a hand: the eye can follow it. It never jumps: when a window shrinks or a view changes, the cursor travels to its next place. |
| Click | On the beat. A 2-frame press, a ring from the cursor tip, a flash and a 1–2 px jump of the target. A tool click gives the target a physical reaction. |
| Tool | The cursor takes the tool's icon, and the tool is in the cursor's hand from then on. A tool never moves or acts by itself. The scissors are at the cursor and cut when the player clicks. |
| Tooltip | **A tooltip follows the cursor on every frame.** It is at the cursor tip, below and right, and flips at a frame edge. It never stays where the cursor was. A line that the cursor carries over several clicks is one tooltip that fills as the cursor goes. Use its travel to take the eye to the next subject. |
| Pick up | As a player lifts a guest in RollerCoaster Tycoon. The thing in the hand turns and swings with the hand's motion. |
| Drag handle | A handle follows the cursor 1:1. A ghost of the result shows under it. The world changes as the handle moves, in every view that shows it. |
| Map pan | Edge scroll or right-drag. |
| Map zoom | One smooth move, or one notch in 4 frames. Never two steps in a row. The view centres on the thing the player wants to see. |
| Map rotate | 90° steps. |
| Follow | The map locks to a train with a short spring lag. |
| Window | Open, drag, maximize, close. No drag without a reason. |
| Console | From the bridge on. It stands at the bottom of the frame. It opens as a terminal does: it snaps open in two steps. Its block cursor stands at the end of the line that is typed, and the reply prints under that line. |
| Typing | Chorus 3: a key cap goes down at the bottom left for each key. The cursor still shuts the windows that the game opens. |

**The cursor is never idle.** Between two actions it does what a person does with a mouse. No habit is longer than its gap, and none takes the eye off an event.

| Habit | When |
|---|---|
| It follows the train or the fish and hovers on it. A hover gives a small tooltip of telemetry. | All acts. |
| It pokes: it hovers a house, a lamp or a prop, opens a menu and closes it, clicks a thing that does nothing. | Acts 1 and 3. |
| It tidies: it moves a window a few pixels to line it up, pulls a corner, puts a window back where the jellyfish moved it. | Acts 1 and 3. |
| It circles or taps on the beat over the place of its next click. | Before a click on a downbeat. |
| It is surprised: a short jump back and a hold when the game does a thing by itself. | Chorus 1b, from the first prop that goes missing. |
| It panics: fast, with overshoot, the same dead button twice and three times, `[×]` on a window that cannot close, a drag on the train that does not take. | From 56.000. |
| It shakes from side to side. | `LOAD ERROR`, chorus 2. |
| It lies still, for the first time. | The last bar of chorus 3: the hand has left the mouse for the keys, and at the wall it leaves both. |

### Framing

- **The subject is the world.** At any time the viewer knows where to look, because the thing that moves and the cursor are in the same place.
- **The camera gets there first.** Before an action the view moves to its target.
- **The sardine is in the frame** when a shot is about it, at a size that reads. It moves at the speed of a fish that swims: a glide, a bank, a stop. Never a dart across the room. It never jumps from one place to another between two views: the view that is open shows it on its way.
- **A dead second is a fault.** When an event ends, the next one has begun.
- **A move ends on the cut.** When a cut follows a motion (the fish to its seat, the fall through the duckboard), the motion ends or is at its height on the frame of the cut.
- **A camera with weight.** Acts 1 and 3: the hand rules above. Act 2: the ride cam is a spring arm on the train, smooth, with the v6 weight. It may swing to a new mode over one beat. On rails, the arm takes the rail joints on the kicks (`ガタン・ゴトン`), small. No snare punch, no bob in the air, no cut on a drum.
- **The world takes the hit.** An impact shakes objects: the ground tiles lift and settle in a ring from the place of the hit, props rock, lamps swing, the train rocks on its springs, a window on the screen jumps. This is the rule for every impact in the video. The camera gets a kick only at the largest ones (the cut, the splice, a flower wall, the stall, the moon, もと, the sky wall): 2 px at most, damped in 4 frames.
- **The train moves to the drums** when it stands or runs slowly in a fixed view: it rocks on its springs on the kicks, from outside as from inside.
- **The music moves the world.** Lights, sky, windows, lamps, wires, flowers and frost play the MIDI tracks (see "Music reactivity"). This is where the energy comes from.
- **Momentum.** From 56.000 to the sky wall the train never stops and never slows, except for the stall in the bridge and the wreck at もと. Each act is faster than the one before.

### Camera modes

| Mode | Use |
|---|---|
| Head | Room shots. |
| Map | Dimetric, 30° pitch, 90° rotate steps. |
| Ride cam | A spring arm on the train: 3/4 chase, flat side view, low angle (the hip view beside the rear of the train, looking forward), cabin. |
| Fixed | A window camera bolted to a place. A security cam is fixed, wide enough to hold its room, and may turn slowly as a real one does. |
| Fish cam | The camera of `[FISH CAM]`: in the car, on the sardine (`FishCam`). Each opening has its own view: the side of the car that it looks out of and its subject. |

Banned: free spline cameras, cameras through walls, slow robotic dollies, zooms into empty ground.

## The sardine

About 0.7 m, silver flanks, a dark blue-green back, black flank dots. It swims about a metre above the ground with weight and banking. The nose points along its path. It does not glow.

Three tells show that it is the player and that it wants to go:

- **The seat.** In the copy room it sits in the player's seat at the kotatsu.
- **The boxes.** It tapes the boxes that the player left open, at a steady pace, through the whole line.
- **The pass.** A commuter pass `いま → あした`. The player punches it invalid. From the moment the sardine takes the punched pass (38.0), the pass is under its fin in every view of every later scene, at one size, with its punch holes. It is there at the wall.

In act 1 it obeys the game. From 56.000 it does not.

## The jellyfish

From Koronba's jellyfish song (`.scratch/sardine/jelly_fish/`): a jellyfish the size of a person floats higher than the utility poles. Nobody knows where it came from. When you open the window, it comes closer. It grabs heads and holds on. It multiplies. It lifts its prey and drops it.

3D low-poly, a small bell, long tentacles, pale blue emissive. Pale blue is its colour only.

**It is a nuisance, not an enemy.** It is there, it is in the way, and it means well.

| Where | What it does |
|---|---|
| Chorus 1 (CAM 02) | It floats in front of the houses across the street, over the road markings. Its shadow lies on the street and on the markings. The viewer can see it. Nobody reacts. |
| Verse 2 → chorus 2 (106.2) | It comes in and takes the `LOAD ERROR` dialog by its title bar. |
| Chorus 2 | The desktop buddy of 1999. It lives at the bottom right of the screen, as those did. It has a repertoire, one act per phrase (see "Plate 8"). |
| Chorus 3 | Its copies hang in the sky of the line. Nobody reacts. |

**The copies damage the program.** The jellyfish and its copies live in the program layer, between the game world and the CRT. A copy does nothing to the world. It damages the picture of the window that it sits on:

| Fault | Look |
|---|---|
| Blocks | The picture under the bell breaks into 8x8 blocks of one colour each. |
| A stale patch | A rectangle keeps the picture of a beat ago. The train runs out of it and comes in again. |
| Shifted rows | Rows under the tentacles stand some pixels to the side, as far as a tentacle hangs. |
| Wrong palette | A patch takes the colours of the checkerboard, or the pale blue of the jellyfish. |
| Dead blocks | Blocks that stay black after the copy has moved on. They heal slowly, one block at a time. |

A copy starts with one fault. Each new copy has a larger patch. A fault moves with its copy and leaves a trail. By the last bars the faults join, and the ride shows through in pieces. The faults stop at the edges of the windows: the room, were we to see it, has none.

## Station names

Every board shows `きのう ← name → あした`.

| Name | English | Where |
|---|---|---|
| イワシ | Sardine | On the stem (intro). |
| ホーム | Platform / Home | By the player's house. |
| ？ | forgotten | By the zones. |
| すのこ | Duckboard | After the tunnel. |
| もと | The way it was | The station the train wrecks. |

## Seams

Every seam has a carrier: an object, a window or an input that is on both sides of the cut. No crossfade. The old shot's content keeps moving across the cut.

| Time (s) | From → to | Carrier |
|---|---|---|
| 0.000 | outro → chirp | The CRT's horizontal white line. |
| 7.111 | chirp → intro | Push into the CRT. The window chrome is in the CRT picture from the start of `DAY 1`. |
| 10.667 | platform → car interior | The doors close. A view cycle. |
| 14.222 | intro → verse 1 | The sardine comes to rest over its seat on the frame of the cut. |
| 17.45 | car → map | After line 0 has ended on the LED board, the car view shrinks into `[Car 1 - Interior]`. The cursor travels from that window down to the rail in the middle of the map, with its tooltip. |
| 25.778 | つながった | A flash at the splice node. The picture of the map jumps by whole pixels. The `[Car 1]` window shows the jolt at once. |
| 26.4–28.444 | map → copy room | The map zooms to the player's house and the train that passes it, at once after the join. The pick-up hand lifts the sardine out of the car and carries it, in view, to the balcony door. Its tooltip has `あ` and `ー` (28.000, 28.222). `[HOUSE - CAM 01]` opens and maximizes on the downbeat. |
| 31.556 | CAM 01 → CAM 02 | A cam switch in the maximized `[HOUSE]` window. CAM 01 does not go: while CAM 02 is the feed, the feed of CAM 01 stays on screen in a corner window. |
| 35.556 | CAM 02 → CAM 01 | The cursor goes to the corner window of CAM 01 and maximizes it. |
| 41.5–42.667 | balcony → Station ？ | On the last syllable of line 8 the sardine falls. We see it go down through the hole in the duckboard first (0.65 s, `FALL_CUT`). Then the view goes with it: down through the sky over Station ？, onto the platform on 42.667. |
| 49.778 | Station ？ → zones | One smooth zoom out, centred on the zone ground and the train. |
| 54.5–56.889 | hole → tunnel → bridge | The map zooms in on the train that runs from the hole and follows it into the tunnel mouth. The dark of the tunnel is the cut: the ride cam of the bridge starts inside it. `[MAP: OUT OF BOUNDS]` opens at 56.000. |
| 61.336–61.780 | chase → side view | The arm swings over the beat between line 13 and line 14. It is in the side view when line 14 starts. |
| 75.111–76.000 | side view → hip view | The arm swings over two beats and is beside the rear of the train when line 16 starts. |
| 81.500–84.500 | hip view → nose | One push along the train to the close-up of the nose. |
| 85.333 | moon → room | The crash. |
| 88.889 | room → green map | Push into the CRT. |
| 92.0–92.444 | map → the ride | The cursor clicks `CONTINUE`. The map camera goes down to the running train in one smooth move and becomes the ride cam: one camera and one curve from 91.8 to 93.0, with no step in position, direction or lens at 92.444. |
| 101.111–101.778 | ride → もと | The train is too fast for the bend. It slides out of the track and goes into Station もと. |
| 106.224–106.667 | verse 2 → chorus 2 | The jellyfish takes the last `LOAD ERROR` dialog. The dialog, the jellyfish, the minimap and the cursor stand on both sides. The ride picture changes on the downbeat: the state loads. |
| 131.112–134.667 | the program crashes | The player opens Close Program to end the jellyfish and ends the window manager. On the first hit of the fill (133.333) the desktop tears, and the screen drops to a blue text mode. On 134.222 the blue screen fills the frame. |
| 134.667–135.111 | chorus 2 → chorus 3 | On line 30 (`あ`) the blue screen breaks into characters that fall away. A datamosh of the blue screen goes along the motion of the camera into the picture of chorus 3 (`_c3mosh.ts`). |
| 135.111 | chorus 2 → chorus 3 | No cut. Chorus 3 draws the same world: the same train on the same loop, under the same camera. The sky is the eclipse from the first frame. |
| 135.111–152.5 | the loop → the straight | A new straight opens from the loop, piece by piece, away from the train. The camera leaves the side arm of chorus 2 and orbits the train: round the left side and across the nose to the front right (144.6), where it looks back over the train at the world that unloads. The train takes the straight at 143.4. Then the camera closes in (152.5). |
| 161.333 | chorus 3 → outro | No cut. From a beat before the last bar of the chorus, the camera swings round behind the train over four beats: ahead are the wall and its board. |
| 166.222–167.111 | sky wall → room | The crash. The nose goes through the canvas, and the view goes white toward a bright rectangle: the CRT glass from inside. |
| 167.111–168.06 | the glass | From close at the CRT the head pulls back. The small train of the game bursts out through the middle of the glass and flies out into the room. Then it is gone and the glass is whole. |
| 169.333 | room → CRT | Push into the CRT as the tube switches off. The push ends exactly on the frame 0 picture. |

## Typography

**Every Japanese line is diegetic, and none is the subject.** A line has one carrier. The carrier is part of a thing that acts: a tool in the cursor's hand, a board that the train passes, a fish that dives. The model is the kana on the DIVA tuna.

- **Readable.** A viewer who reads Japanese can read every line on a first watch. This is a test of the carrier's size and time on screen. It is not a reason to stop the world, to hold the camera or to clear the frame. A lamp, a window or the camera's own path must not cover a line or wash it out.
- **No letters as objects.** No extruded 3D letters that stand on the ground, on the track or beside the train. No 2D lyric box over the picture.
- **Quiet landings.** A syllable lands with a small motion that fits its carrier: a lamp that lights, a flap that turns, a 2-frame press. A slam is for a punchline only.
- **A line that has ended goes.** Its carrier clears itself in its own way (flaps turn blank, a tooltip closes) before the next line.
- **Syllables** appear on the calibrated times. Always the full line. A syllable that is held over two notes shows the second note (`あ`, then `あー`).
- **English** is the fan layer. The video draws no English line. The web player shows it as its subtitles, in the look of the game (Silkscreen at 8 px, capitals, an outline and a dark strip, low and centred: `subtitles` in `video/player.ts`). For YouTube, `pve subs` writes the subtitle files.
- **The `ko` voice** sings the tuna lines in chorus 2 and chorus 3. It never shares the lead's carrier.
- **The `ca` voice** doubles the lead in chorus 2: a second copy of the lead's carrier, 1–2 px off.
- Fonts: DotGothic16 for kana, Silkscreen for Latin.

### Lyric carriers

| Lines | Time (s) | Carrier |
|---|---|---|
| 0 `なんねんまえかのことでした` | 14.222 | The LED route board over the car door. The view stays in the car to 17.45. |
| 1–2 `だれかがハサミで / タイムラインをちょんぎった` | 17.333–22.667 | The tooltip of the scissors, at the cursor. |
| 3–4 `そして / あしたときのうがつながった` | 22.889–26.889 | The tooltip of the bend tool, at the cursor, while it drags the rail end. |
| 5 `あしたのことはしっている` | 28.000 | `あ`, `ー`: the tooltip of the pick-up hand. The line goes on on the calendar header. |
| 6 `イワシがつちからはえてくるんだ` | 31.556 | Road markings on the street below the balcony, in the light of the street lamps. They light with the house windows on the beat. |
| 7 `えきのホームにあながあく` | 35.556 | The tooltip of the punch, at the cursor. |
| 8 `すのこがきえるんだ` | 38.667 | One syllable on each slat. |
| 9 `きのうのきおくはきえたけど` | 42.667 | The flap board of Station ？. The flaps turn blank when the line ends. |
| 10 `きえたってこともよくわからないんだ` | 45.778 | One tooltip at the cursor for the whole line. It fills as the cursor runs from one missing prop to the next. |
| 11 `そらのうえからビルがたつ` | 49.778 | The news ticker. |
| 12 `めがみえなくなってきた` | 52.889 | The tooltip of the clear tool, at the cursor. Then its letters fall into the hole, and each takes its piece of the tooltip with it. |
| 13 `はなはかれず` | 56.444 | Far off, made of the music lights (see "Plate 5"). |
| 14 `とりはとばずねむる` | 61.780 | Far off: dense flocks of birds that form the glyphs. |
| 15 `かぜはとまりつめたく` | 68.900 | Far off, made of the music lights. |
| 16 `つきはみちもかけもせずまわる` | 76.000 | Burnt into the moon disc. |
| 17–20 `いままでと… / いちにちを… / すすんでく / ここは` | 92.444–102.000 | LED boards in steel hoops round the track, one phrase on each. A syllable is a group of lamps that light. The train runs through each hoop without a stop. The board hangs in its hoop and keeps level with the train, so it reads upright when the train is upside down on the crossing. A board that the camera reaches is not drawn. The last one, `ここは`, stands before Station もと. |
| 21 `もとにはもどらなくなった` | 102.222–105.111 | The yellow signs that hang in the corridor under もと (see "Plate 7"). |
| 22 `あしたのことはしっている` | 106.224 | The text of the `LOAD ERROR` dialog. |
| 23–29 (chorus 2 lead + `ca`) | 109.779–134.224 | The jellyfish's pop-ups (see "Plate 8"). |
| `ko` 0–7 | 106.667–134.222 | The jellyfish's speech balloon, at the bottom right. |
| 30–37 (`あしたのことは…` and chorus 3 lead) | 134.667–162.667 | Constellations (`StarLines`): each glyph is a figure of stars, fixed in the sky where the camera looks while the line is sung. The stars come on with the syllables and fall out of the sky after the line. The stars of line 30 come with the cut at 135.111. |
| `ko` 8–11 | 135.111–148.444 | Syllable plates on the tuna (the typing game). |
| `ko` 12–15 | 149.333–162.667 | Kana on the tuna notes of the DIVA game. |
| Credits | 163.111–166.222 | The name board of the end wall, lit row by row. |

## Look

| Topic | Decision |
|---|---|
| Light | Real lights: a sun or moon with a shadow map, sky and ground ambient, many point and spot lights. At night two colour temperatures: warm inside, cool blue outside. A lamp that stands in a shot lights its ground and casts shadows. |
| Shadows | The shadow map fits the subject of the shot: no steps on the edge of the train's shadow on a platform. |
| Glow | Lit windows, lamps, the CRT, the moon and the jellyfish are emissive and bloom. A lamp near a lyric carrier must not wash it out. |
| Horizon | No empty void, except under the map at もと and behind the sky. |
| Pixels | 640x360, nearest x3, aliased edges, an ordered 4x4 Bayer dither on the final colour. |
| Detail | More objects, not finer models. |
| UI | Bevelled grey and teal RCT chrome. |
| Security cam | `REC ●`, a time stamp, corner brackets. No noise. |
| CRT | An amount from 0 to 1. Zero at the end of each push. No CRT overlay on the game picture. |
| Layer rates | Trains, cameras and physics at 36 fps. Secondary motion at 12 or 18 fps with `stepT`. |

### Colour script

No section has the sky of the one before it. Settle each on a board before its pass.

| Section | Sky and light |
|---|---|
| chirp, intro | Dusk indigo. Amber lamp pools on the platform and in the car. |
| verse 1 | Burnt orange dusk on the stem. Night from `そして`, with lit stations. |
| chorus 1 | Late dusk, amber and violet. |
| chorus 1b | Summer noon: a cyan sky, bright green, short hard shadows. The sky goes dark as the hole grows. |
| bridge | Four skies, one per line. 花: crimson, magenta and gold. 鳥: amber over teal. 風: ice cyan and white. 月: deep violet with silver and gold from the moon. |
| interlude | The room at deep night. The green of the map. |
| verse 2 | Day, dusk and night, as the day counter jumps. |
| chorus 2 | The afternoon of the save before a storm: a heavy yellow-grey sky, sheet lightning far off on some snares. It goes dark on line 29. |
| chorus 3 | The eclipse from the first frame: a black-blue dome with stars, a warm horizon all round, a white-gold corona. Where the world unloads, the void under it glows red. |
| outro | The end wall is a painted dawn, gold and pink, under the lamps of its rig. The room at dawn. |

## Sections

Bars are 1-based. Bar n starts at (n − 1) × 1.7778 s.

| Bars | Time (s) | Section | Plate | Act |
|---|---|---|---|---|
| 1–4 | 0.000–7.111 | chirp | 0 · Boot | 1 |
| 5–8 | 7.111–14.222 | intro | 1 · Station イワシ | 1 |
| 9–16 | 14.222–28.444 | verse 1 | 2 · The cut | 1 |
| 17–24 | 28.444–42.667 | chorus 1, first half | 3 · The copy room | 1 |
| 25–32 | 42.667–56.889 | chorus 1, second half | 4 · Forgotten, the zones and the hole | 1, then 2 at 56.000 |
| 33–48 | 56.889–85.333 | bridge | 5 · Out of bounds | 2 |
| 49–52 | 85.333–92.444 | interlude | 6 · Reread | 2 |
| 53–60 | 92.444–106.667 | verse 2 | 7 · Through, and もと | 2 |
| 61–76 | 106.667–135.111 | chorus 2 | 8 · The jellyfish | 3 |
| 77–92 | 135.111–163.556 | chorus 3 | 9 · Just past noon | 3 |
| 93–96 | 163.556–170.667 | outro | 10 · The wall, the empty room | 3 |

A line marked **v9** is new or changed against the v8 build.

### Plate 0 · chirp (0.000–7.111)

Real room at dusk, head at the kotatsu.

- 0.000: the CRT shows one horizontal white line. The raster opens to the title screen.
- The head looks: the TV, down to the mug on the kotatsu, to one thing that is not right (an open box, or a first small leak of the game), back to the TV. Four looks, each with a cause and a hold.
- Bar 3 (3.556): `PRESS START` blinks. The menu cursor confirms `DAY 1`.
- Bar 4 (5.333) to 7.111: push into the CRT.

### Plate 1 · intro (7.111–14.222)

- `[キハ40 - CAR 1]` maximized, a fixed camera on the night platform イワシ. The camera does not move. The whole board is in the frame.
- **v9:** the train at the platform rocks on its springs on the kicks, as it does in the cabin view.
- Bars 5–6: the sardine waits by the board, then swims into the open door. **v9:** the cursor is alive here: it hovers the board and the train, and follows the fish.
- Bar 7 (10.667): the doors close. View cycle to the cabin. The train pulls out and gains speed without a break: the platform and the lamps go past the windows, and the speed in the status bar only goes up. **v9:** hand straps hang from the rail under the ceiling. They swing back as the train pulls out and jump on the kicks.
- **v9:** the sardine swims down the car and comes to rest over its seat exactly on 14.222.

### Plate 2 · verse 1 (14.222–28.444)

- Line 0 (14.222–17.45): full-frame cabin. The LED route board runs the line. Stay here until the line has ended. Then the car view shrinks into `[Car 1 - Interior]`, and the map shows the straight stem at dusk.
- **v9:** as the car view shrinks to the top right, the cursor travels down from it to the rail in the middle of the map. Its tooltip goes with it and takes the eye there. It does not jump.
- **v9:** `[Car 1 - Interior]` shows the sardine leave its seat and swim forward through the car to the cab (17.5–21.0), so that it is at the front glass for the cut. Nothing clips through the lens of that view.
- Line 1 `だれかがハサミで` (17.333): the player takes the scissors with a key, so the cursor has them at once, at the car window. The tooltip at the cursor carries the line. The cursor takes the scissors down to the track ahead of the train. The blades open and close on the beats in the cursor's hand.
- Line 2 `タイムラインをちょんぎった` (19.556): on `ちょん` the player clicks, and the blades cut the rail. The cut piece springs up, rolls over once and lies beside the track until the join. **v9:** the world takes the hit: the picture of the map jumps by whole pixels and settles (the windows and the cursor do not), and a spark flashes at the cut. The train runs on toward the cut without a jump back. In `[Car 1]` the sardine presses against the front glass.
- Line 3 `そして` (22.889): the map goes to night. The cursor clicks the bend tool. The editor ring shows only from that click.
- Line 4 `あしたときのうがつながった` (24.000): the cursor grabs the forward rail end and drags it round. The stem does not move at all. The track ahead curls into the big loop, with the mountain and its tunnel and the lit stations, and comes back to the end of the stem. `[Car 1 - Interior]` stays open: the sardine sees the track bend ahead through the front glass. **v9:** the sardine turns with the cursor: its body points where the dragged rail end points and banks as the hand goes round, and the hand straps swing out. No spin of its own.
- **v9:** on `つな` (25.778) the ends join with a flash at the node, and the picture of the map jumps by whole pixels. The train and the sardine jolt at once, on the join, not a beat later.
- **v9:** the map status bar has the zoom level (`ZOOM 1.0x`), and it changes with each zoom.
- **v9:** 26.4–28.444: the map zooms to the player's house at once after the join, so that the lift is large and long. The train comes past the house. The pick-up hand lifts the sardine out, and the sardine swings under the hand. The tooltip of the hand has `あ` on 28.000 and `あー` on 28.222. The hand drops the sardine through the balcony door.
- **v9:** drum fill of bar 16: see "Music reactivity".

### Plate 3 · chorus 1, first half (28.444–42.667)

The copy room through two security cams, in the maximized `[HOUSE]` window. CAM 01 is a high corner of the room: fixed, wide enough for the kotatsu, the calendar, the clock, the boxes and the sardine at all times. It only pans and zooms from its place. CAM 02 is over the balcony door. CAM 01 never goes: while CAM 02 is the feed, CAM 01 stays in a corner window.

The cams look out into the one game world. The room kit stands in the place of the player's house, and each view draws the world first and the room in front of it. The street below the balcony is the street of the map of verse 1, with the same houses across it. The house of the world has the measures of the room kit: the floor of the room is 5.5 m over the street, and the balcony door is 8.65 m from the middle of the street.

- Line 5 (28.000–31.389): CAM 01. The sardine comes in through the balcony door, glides to the box `ふく` and tapes it, steadily, through the whole line. The clock hand jumps on each kick. A calendar page tears off on each beat. The header carries the line. **v9:** the ceiling lamp stays on, dimmed, so that it does not wash the header out. The calendar wall has plain contrast.
- Line 6 (31.556–35.556): CAM 02, with CAM 01 in the corner. Sardines grow from the planter soil, each one on its syllable, with no delay. The planter is clear of the English line. The road markings carry the line and light with the house windows. The jellyfish floats in front of the houses. The sardine is out on the balcony and watches, in the frame.
- **v9:** the street lamps work: each one lights a pool of the street and casts shadows. The jellyfish casts a shadow that moves over the street and over the markings.
- **v9:** the windows of the houses across the street light in two halves that take turns on the beat.
- **v9:** 35.556: the cursor does not go to the `CAM 01` button. It goes to the corner window of CAM 01 and maximizes it.
- Line 7 (35.556–38.444): CAM 01 pans and zooms to the kotatsu. The sardine sits in the player's seat and lays the pass on the kotatsu beside it. The punch tooltip follows the cursor. Each punch knocks on the table: the mandarins, the mug and the remote jump and rattle down. **v9:** the punched bits of paper fly, come down on the table and lie there. Nothing under the pass shows through it (the fault at 37.06). No window of the station hole opens at 37.61: it has no sense here.
- **v9:** the sardine takes the punched pass at a glide, and we see it under its fin from then on (see "The sardine").
- Line 8 (38.667–41.5): CAM 02 pans and zooms to the duckboard, with CAM 01 in the corner. A pair of sandals and a flower pot stand on the board. The sardine swims out over the duckboard. The cursor deletes one slat per syllable. Each slat breaks and drops, and takes with it what stood on it. The board is whole until the first click, in every play (pass 0).
- **v9:** on the last syllable the sardine falls. The view stays for 0.65 s and shows it go down through the hole. Then the view goes with it (see "Seams").

### Plate 4 · chorus 1, second half (42.667–56.889)

- Line 9 (42.667–45.556): bright day at Station ？. The sardine lands on the near part of the platform, large in the frame, bounces up and boards. The flap board carries the line, then turns blank. **v9:** the shadow of the train on the platform has a clean edge.
- **v9:** Line 10 (45.778–49.778): the player does not click the props away. The props near the sardine and the train go missing by themselves, on syllables of the line: 17 in all, among them benches, trees and the vending machine. Not the station board, not a lamp. The cursor is surprised at the first one. Then it runs from one to the next and clicks each to put it back: `ERR  ASSET GONE` in the status bar, and nothing comes back. One tooltip follows the cursor and fills through the line. This is the first thing in the video that the player does not do. `[FISH CAM]` opens here.
- Line 11 (49.778–52.667): one smooth zoom out, centred on the zone ground and the train. The game zones by itself: buildings build down from the clouds, one floor on each note of the lead, the chords and the bass (tracks 6, 14 and 5). No window covers them. The train stays in the frame and runs round them, never through them. The news ticker carries the line. The floors stand in the right order in every play (pass 0).
- Line 12 (52.889–56.000): the player takes the clear tool. Its tooltip follows the cursor. The ground opens: a sinkhole that grows. It has the form of an eye without being drawn as one: a round pit, a far wall like a lid, and at the bottom a pale ring round a dark middle that turns toward the train. Ground tiles tip in. The towers, the trees and the sheds go in as real bodies and hit each other on the way. The train runs for the tunnel. The ground gives way ahead of the rim: the pieces of the track that the train has passed break off and fall, one after the other, right behind it.
- **v9:** the hole is a thing that should not be in a game. Its terraces turn against each other, slowly, with dark blocks on their ledges. The bottom closes to a slit once and opens.
- **v9:** the letters of the tooltip fall in, and each one tears its piece of the tooltip out with it, as from a sheet of paper. The tooltip is in shreds, and the shreds go down in a spiral.
- **v9:** the clouds and the pieces of the buildings fall with gravity: slowly at first, then fast. They do not drift down at one speed.
- **v9:** 54.5–56.0: the map zooms in on the train as it runs from the hole, and follows it into the mouth of the tunnel (see "Seams").
- 56.000: the train reaches the tunnel. Control flips. `[MAP: OUT OF BOUNDS]` opens.
- **v9:** drum fill of bar 32: see "Music reactivity".

### Plate 5 · bridge (56.889–85.333)

`[Train 1 - Ride Cam]` maximized. `[MAP: OUT OF BOUNDS]` stays in the top left corner and cannot close. The console is at the bottom. The sky and the moon are clear of all windows.

**v9: `[FISH CAM]` is not open for the whole bridge.** It opens when the sardine has something to see or to feel, and its view changes each time (seven views, `FISH_VIEWS` in `bridge.ts`): out of the left windows at the flower walls (56.0–61.1), across the car out of the right windows at the flock (62.3–66.9), from the cab with the sardine at the front glass when the wind stops (68.35–70.85), down the car as it falls (71.0–72.7), a tuna at the front glass at the catch (73.3–74.5), the moon in the front glass (74.75–76.3). The sardine swims forward to the cab at 67.3. The player shuts the window each time, or the game takes it away. It is open in line 16 too.

**v9: the cursor works through the whole bridge.** It clicks `[×]` on the out-of-bounds window, again and again. It takes the train on the map and drags: the train does not come. It types in the console. It goes for the fish cam.

**The out-of-bounds window is alive** (`_oob.ts`). It shows what is past the edge of a map: the last tiles of the game map end in a cliff with posts. Past it is the ground of a map application at a far zoom: flat steps in pale colours with tile borders, with the heights of the real ground. The status bar has the stored coordinates, and X overflows to `-32768`. In line 14 the train passes a gap: a slit in the void with ribbon ends, eyes inside that open, follow the train and blink on the snares, and a disused platform with the sign `廃駅` under it. A fan of Yukari sees it at once. The character is not shown. After the wind stops, the tiles round the train lose their texture on the kicks (`NO DATA`). From the catch, the window has the moon disc.

**v9:** its world is too empty. It gets the detail of a map at several zooms: contour lines on the heights, roads and a river that stop at tile borders, place labels that are cut off, tiles of a finer zoom that load in round the train and of a coarser zoom far off, a scale bar, one more gap.

**v9:** at the stall, the fish cam and the out-of-bounds window feel it: both jump on the screen, sag some pixels and come back slowly.

The four lines are 花鳥風月, and each one is broken. The status bar of the ride shows the speed only.

**The world plays the music, big, through the whole bridge:**

- **Arp light pillars** (tracks 2 and 3; track 4 is silent in the bridge): one beam for each note, 1.7 to 2 km off, behind the ridges. The pitch of the note is its place across the frame.
- **Aurora** (track 14, the chords): three curtains round the whole sky. One of them flares on each chord.
- **Ridges and stars:** the rims of the ridges and of the peaks of the cloud deck flash on the kicks (near to far) and on the snares. The stars jump on the kicks.
- **After the wind stops:** the frost grows one step on each kick. Ice bursts on the kicks, flower bursts on the snares.
- **v9: fireworks.** Shells go up from behind the ridges and from the cloud deck and open into large round bursts: one on each snare, a salvo on each chord change. Their light falls on the clouds and on the train. After the wind stops, a burst opens and stays in the air, frozen.
- **v9: from bar 44 the light comes with the camera.** In the hip view and in the push to the nose, the pillars, the bursts and the star rings stand round the moon and along the path of the climb, in the frame. This part has more light than any part before it, not less.
- **v9: air lines.** While the train flies, thin streaks of air run past it and along its sides, and they bend round the nose. With `sv_wind 0` they stop where they are and hang in the air as threads of ice. When the tuna carry the train up, they run again.
- **v9: the cloud deck** (74.36) is not flat plates: banks at several heights with towers and gaps, lit from inside by the pillars and from above by the aurora, with the shadow of the train on them.

The camera never moves on the music.

**The lines are lights, far away** (`_bridgeletters.ts`). Lines 13 and 15 are dot-matrix rows that stand in the sky 1.3 km off, over the ridges: each font pixel is one light, and the arp notes run through the row. The train never touches them, and nothing near the train covers them. Each line takes one thing from its subject:

| Line | What it is made of | They land | They go |
|---|---|---|---|
| 13 `はなはかれず` | Lights in the colours of the flower walls. | A bloom opens from the middle of the glyph. | They do not wither: they leave whole, as petals on the wind. |
| 14 `とりはとばずねむる` | **v9:** birds. Each glyph is a dense flock: some birds for each font pixel, dark against the dusk. | A stream of birds comes in from the flock round the train, turns as one body and packs into the glyph. The glyph still moves a little: wings, heads. | They do not fly off: they fold their wings, sink and go dark. |
| 15 `かぜはとまりつめたく` | Lights, pale, then ice. | Streaks of wind that stop dead. Icicles grow from the feet of the glyphs. A kick flashes them. | The ice breaks and falls. |
| 16 `つきはみちもかけもせずまわる` | Burnt into the moon disc: red hot, then dark on the pale disc. The arp notes heat them again. | The read light burns each glyph in. | They stay. The disc turns under them, the glyphs stay upright and whole. |

**v9:** the glyphs of line 16 stand on the part of the disc that the camera sees with nothing in front of it. Each glyph has a place in the frame at the time of its syllable (`MOON_NDC` in `bridge.ts`), and it is burnt into the disc where that place is: the first two phrases over the roof of the train in the hip view, the last five in the close-up of the nose. **v9:** the red read light of the moon is on from the first frame in which the moon is in view. It does not wait for `かけも`.

- Line 13 `はなはかれず` (56.444–61.340): 3/4 chase. The train goes off the unfinished ramp and through flower walls on the syllables.
- **v9:** six walls, one for each syllable of the line (`T_WALLS`). The cursor stamps each wall a little before the hit. On the hit the whole wall lets go: the flowers in the path of the car are thrown and carried along it, the rest go a moment later in a wave from the nose. Some flowers stick to the front of the car and pile up there. Each hit has weight: the car rocks, and the camera takes its small kick. The flowers do not vanish: they fly, as in v7, through a field of real turbulence behind the train, along the car sides, over the windscreen and past the windows of the fish cam, and they are still in the air in line 14.
- Line 14 `とりはとばずねむる` (61.780–68.440): the side view. The birds are birds, with folded wings. They part round the train and none goes through it.
- Line 15 `かぜはとまりつめたく` (68.900–75.560): the console, `sv_wind 0`. **v9:** the block cursor of the console stands at the end of the typed line, and the console snaps open (see "The hand"). The wind stops, frost grows, birds, petals, air lines and fireworks freeze. On bar 41 the train falls. One red warning flashes: `STALL`. Nothing else: no pitch ladder. The tuna catch the train and carry it up.
- Line 16 `つきはみちもかけもせずまわる` (76.000–85.355): the hip view. The camera is low and close beside the rear of the train and looks forward along its lit windows to the huge moon (radius 60 m), with the aurora, the tuna and the river of sardines round it. Hold it. From 81.5 it pushes in to a close-up of the nose as it rams the moon at 85.1. The cracks run into the CRT glass.
- **v9:** the tuna that carry the train are alive: each swims with a wave through its body, they change places under the cars, one loses its hold and comes in again, their small fins flash. No face of a tuna z-fights (check the other models too).
- **v9:** drum fill of bar 40: see "Music reactivity".

### Plate 6 · interlude (85.333–92.444)

- Bars 49–50: the head jerks back from the cracked CRT, then looks left, back, right, back, at the speed of a person. The crack stays on the glass in every frame. The game has leaked into the room: a box that is there twice, a sardine that hangs still under the ceiling. `RETRY 1/3`, `RETRY 2/3` on the CRT.
- Bars 51–52 (88.889–92.444): the green map, full frame: the one world from the map camera. The stem is in pieces, thrown about. On `RETRY 3/3` the pieces settle twisted: the loop where it was, the stem across it on pillars (see "The game world"). `READ OK  3 ERRORS`. `CONTINUE / DAY 1`: the game is paused and the train stands. The cursor clicks at 92.0.
- **v9:** the move from the map to the ride has no jolt at 92.444 (see "Seams").

### Plate 7 · verse 2 (92.444–106.667)

`[Train 1 - Ride Cam]` is maximized. `[MAP: MÖBIUS]` stays open as the minimap (top right): the one world from above, with the train as a dot. The day counter is in its status bar. **v9:** no `[FISH CAM]` in verse 2.

- Lines 17–19 (92.444–100.889): one ride, with no skip and no stop, at 158 km/h. The train is already at speed when the camera reaches it. Line 17: through ホーム, up onto the crossing, over with it (the join of "until now" and "from now"). Line 18: it hangs under the track with the fields overhead, turns upright, comes down and runs すのこ through. The day counter jumps on each kick, and the light of the world jumps with it: day, dusk, night (the days that the line skips). Line 19: on, at night. The lines are on the LED boards in their hoops. The crossing stands on one row of columns, on the side away from the ride cam: no column passes close to the lens.
- **v9:** the two cars have their coupler and gangway, and it holds through the turn of the crossing.
- **v9:** the speed cues are here (see "The game world"): sleepers, dust at the wheels, poles that whip past.
- **v9: the two counter-melody voices play the world** (`_versefx.ts`). Voice 1 (track 8) plays the sky: each note draws a streak of light across the sky 220 m ahead, higher for a higher note, as long as the note is held. Voice 2 (track 9) plays the ground: each note sends a ring of light out over the ground 60 m ahead, and the wheels of the front car throw sparks on its notes. The two never share a thing.
- Lines 20–21 (101.111–105.111): Station もと. The last board reads `ここは`. The train is too fast for the bend: it slides out of the track and goes into the station on 101.778. The world takes the hit. The cars clip through the platform, its blocks flicker, and the cars sink under the map. The camera goes with them.
- **v9: under もと is Platform 8** (`8番のりば`), after the game of the corridor that repeats (`_platform8.ts`). There is no grey grid here: a white tiled corridor of an underground station, far too long, with cold tubes of light, posters and yellow signs that hang from the ceiling. The first sign reads `8番のりば`. The cars come down through a hole in its ceiling and slide along it, upright. The tubes go out as the cars pass. Line 21 is on the yellow signs that the cars slide under, a phrase on each. Both voices of the duet go on here in unison: a bar of light runs along the ceiling on each note of voice 1, a band of light along the yellow strip of the floor on each note of voice 2.
- **v9:** 105.111–106.667: `LOAD STATE (SLOT 1)` on each kick. Each load puts the cars back at the start of the corridor, and one thing is not as it was: the number on the sign, the eyes of the fish on the posters, a tube that is out. The player sees it or does not. The last dialog carries line 22, and the jellyfish takes it.
- The minimap has a red dot and rings at もと, and its status reads `ERR  DESYNC`. It shakes with the hit.
- **v9:** drum fill of bar 60: see "Music reactivity".

### Plate 8 · chorus 2 (106.667–135.111)

The director approved the ride through the world, the camera switch at 115.3 and the world that loses its textures at random. They stay as built.

The player keeps playing on the broken save. At 106.667 the cursor presses OK once more, and this time the state loads: the day of the save, the train at speed. The main view is the ride: the train on the twisted loop at 140 km/h, one lap in 8 bars (the loop from the end of the crossing round to its start, then the crossing), the tuna lower and nearer on every `ko` line. `[MAP: MÖBIUS]` stays where verse 2 left it. `[FISH CAM]` opens again with the load.

The camera has two views. On the loop it is a chase view behind the train. Half a second before each crossing the arm swings out to the west side in one beat and stays upright: the train turns over in front of it, and the columns, the car that hangs under the track, the holes, the pit and its towers are in the frame beyond the train. After the first crossing the arm swings back behind the train.

The chorus lines happen to the one world for real, larger than in chorus 1, round the running train:

| Line | Time (s) | What happens |
|---|---|---|
| 23 | 109.779 | Sardines as large as houses grow out of the fields beside the track, ahead of the train. They stay. |
| 24 | 113.779 | Holes open in the platform of ホーム as the train runs it through, then in the ground under the ramp of the crossing. |
| 25 | 116.890 | On the crossing: the wheels kick the sleepers out from under the train. The crossing has no sleepers after that. |
| 26 | 120.890 | Things lose their texture: Station すのこ, the far hills, the rear car, some of the sardines. Station もと has none from the start: the save is broken there. |
| 27 | 124.000 | The same things flicker between the checker and their own look. |
| 28 | 128.000 | The towers build down from the clouds over the zoned ground, a floor on each syllable. The floors stand in the right order in every play (the fault at 130.43, pass 0). |
| 29 | 131.112 | On the crossing: the ground opens under the train that hangs from the track. The towers go in. The day goes dark: it is the dark of the eclipse of chorus 3. |

The jellyfish is at the bottom right of the screen, left of the fish cam, and is in the way.

- It speaks the `ko` lines in a round yellow balloon above itself. The bell pulses on each syllable. The kana stay inside the balloon.
- Each lead line is one of its pop-ups, in the form of a reminder of a 1999 assistant: a small dialog with the line and a button, in the top left of the frame. The `ca` voice is a second copy of the dialog, 3 px off. The player clicks both away.
- Its acts, one for each phrase:

| Bars | Act |
|---|---|
| 61–62 | The cursor goes for the OK of the dialog of line 22. It carries the dialog off to the top left. When the line has ended it lifts the dialog and drops it: the dialog breaks on the status bar. |
| 63–64 | At home. It offers line 23 of the `ko` voice in a balloon with two buttons, `OK` and `NO`. The cursor presses `NO` twice. Nothing happens, and it laughs. It turns once about itself and knocks on the glass from inside, twice in each bar. |
| 65–66 | It sits on the fish cam. The cursor goes for it twice. It dodges both times and laughs. |
| 67–68 | It grabs the cursor and holds on. The player has no mouse for a bar, and the reminder of line 25 stays. |
| 69–70 | It lets go, lifts that reminder and drops it. The reminder of line 26 has a second button, `LATER`: the next reminder comes at once. |
| 69–76 | It multiplies: a copy grows out of it each half bar and takes a place on the status bar or on a title bar. A small ERR box opens on every snare. After the last click a copy takes the cursor and keeps it. |
| 71–75 | Its own business while the copies come: it turns about itself, floats over to the minimap and knocks there, comes home, and laughs at the copies. |

- **v9: the dialog that breaks** (110.36) looks cheap as four squares. A dialog is made of parts, and it breaks into them: the title bar comes off in one piece, the button pops out and rolls, the bevel edges come off as strips, the face breaks into many shards, and the glyphs of its line fall as bodies of their own. All of it bounces on the status bar, lies there for a beat and drops out of the frame. The same break for each dialog that the jellyfish drops.
- **v9: the copies damage the picture of the program** (see "The jellyfish"). From bar 69 each copy has its fault on the window it sits on, and the faults grow to bar 76. The world behind stays whole in itself: it is the picture of it that goes.
- **v9:** between its clicks the cursor tidies: it puts back what the jellyfish moved, and it tries to wipe a dead block away.
- 131.112 (line 29, `めが`): Ctrl+Alt+Del. The Close Program box lists one `JELLY.EXE` for each copy. The player selects the last one, but the copy that holds the cursor drags the selection one row down: the player ends `WINMGR.EXE`, the window manager, and presses End Task again in the box that asks. On the first hit of the fill (133.333) the desktop tears for 4 frames. Then the screen drops to a blue text mode (`@pve/engine/textmode`) whose game world loses frames as it goes. The jellyfish stand still over it and explode into characters on the hits. Each hit is a fault of the whole screen, and the text mode breaks (larger characters, rows that slide and fall). 134.222: the full blue screen (`_bsod.ts`). 134.667 (line 30, `あ`): it breaks into characters that fall away, and behind them the world is back in the look of chorus 3 (see "Seams").
- **v9:** drum fill of bar 76: see "Music reactivity".

### Plate 9 · chorus 3 (135.111–163.556)

Tomorrow, just past noon. **Written again after the director's review of pass 5.** The director's words: chorus 3 is the same scene as chorus 2, literally: the same tracks and the same world. The view is flat and sideways. Chorus 3 has the mood of the bridge, for the end: every voice of the music is a light. v7 was the closest to it. The build replaced the flat side view with one orbit round the train (see "The camera").

`chorus3.ts` renders both chorus 3 and the outro. It draws the world of chorus 2 itself, the same objects (`_c2shared.ts`), not a copy.

**The line.** At 135.111 nothing changes: the train runs on round the loop at the speed of chorus 2 (138 km/h). A new straight track opens from the loop at 33 degrees (past Station ホーム, before the crossing): its pieces come up out of the ground as the checker, in a wave that runs away from the train. The train takes it at 143.4 and runs it for about 880 m to the wall. Beside it: a pole line on the near side, and a platform and a street on the far side now and then.

**The camera** (`_c3ride.ts`). One camera, no cut. It orbits the train about the middle of the two cars.

- 135.111: the side arm of chorus 2, on the same train.
- 135.111–144.6: it goes round the left side and across the nose to the front right, high. From there it looks back along the track: the train comes at it, and behind the train the world unloads, with the eclipse above.
- 152.5: it has closed in on the train.
- 161.333: it swings round to behind the train (see "Plate 10").

**The sky** is the eclipse of the sky shader from the first frame: a black-blue sky with stars, a warm horizon, the black disc with its corona. The jellyfish copies hang in front of the sky. They stay.

**The music is light** (`_c3lights.ts`, see "Music reactivity"). All of it is far off and large, so nothing covers the train, and each event stands where the camera looks when it happens. The arps draw their melody across the sky: each note is a star at the place of its time in the bar and of its pitch, and a line of light runs to it from the note before. Each chord sends a ring of light out from the eclipse. Each snare is a firework. Each kick pulses the stars and the corona. Each hat is a star that glints. Each note of the second harmony is a shooting star.

**The lead lines are constellations** (`StarLines`). Lines 30–37 are figures of stars in the sky, one line at a time, fixed where the camera looks while the line is sung. A star comes on with its syllable. After the line the stars fall out of the sky.

**The tuna destroy the world, and the player fights for it** (`_c3games.ts`). This is the stake, and every tuna shows it: a tuna dives at a thing of the world that we can see (a house, a station, a pole, a tower, the track ahead of the train). A red ring on that thing marks it from the start of the dive. The place is chosen with the camera: the mark, the fish on its way down and the hit are in the picture.

- **First half (135.111–148.444): the typing game. Tuna = syllable.** A tuna dives for each syllable of the `ko` line, with the syllable and its key on a plate on its body. The player types the key in time: the plate turns green, and the tuna breaks up in the air into a burst of scales of light. The red ring goes out, and the thing stands. The player types too late: the plate turns red, and the tuna hits (`_c3fall.ts`): a white pop, a checker cube, a ring, puffs of smoke and tiles as bodies.
- **Second half (149.333–162.667): the DIVA game.** The same fight in a harder mode: the tuna are the notes, with the `ko` kana on them, and each flies through its target ring on its syllable. The word at the ring (`COOL`, `FINE`, `MISS`) is the timing of the player, but every note hits its thing. When the track ahead is in the picture, a tuna takes it, and the train jumps the gap. The combo is in the status bar. No lyric bar.
- **The status bar:** `WALL <m>  CAR 1 <km/h>`, then `HIT 9  MISS 2` in the first half and `COMBO 14` in the second. On its right, `UNLOAD` and a bar of red cells: the part of the world that has unloaded.
- **The hand.** Each key shows as a small key cap that goes down, at the bottom left. The game opens three fish cams and three minimaps (`[MAP: …]`, `DAY ???  UNLOADING`) now and then, and the cursor shuts each one with `[×]`.

**The world gets unloaded from the left** (`_c3unload.ts`, `_c3copy.ts`). Behind the train the world turns to the checker, tile by tile and thing by thing, and its pieces drop away into a void that glows red. Nothing rises. First the far hills go, then the town and the loop of chorus 2, then the street of the straight. The edge closes in on the rear car.

### Plate 10 · outro (163.556–170.667)

**Written again after the director's review of pass 5.** The wall is not seen before the last bar of chorus 3. The credits must look good.

| Time (s) | Beat | What happens |
|---|---|---|
| 161.333 | a beat before bar 92 | The camera swings round behind the train over four beats: a chase view over the roof. Ahead is the wall: a painted sunrise (gold, pink, blue, a sun with the flat rays of a poster, bands of cloud, panel seams), and on it the name board of a station. |
| 162.667–164.0 | | The lamps along the top of the wall come on, one pair on each half beat, from the middle out. From 163.111 they light the board row by row: the title of the song, `ORIGINAL MV` over `KORONBA` on the left and `IDEA` over `FM` on the right in the band of sea green, and at the foot one centred line, `VISUALS: CLAUDE FABLE 5.2 & OPUS 5.5, GEMINI 4 ARGON`. |
| 163.556 | bar 93, beat 1 | The `ko` voice has ended, and the game with it: the status bar reads `CLEAR?`. |
| 164.889 | | A school of sardines comes up beside the train and swims with it. |
| 165.778–166.222 | bar 94, beat 2 | The camera goes forward along the roof to the nose. The sun of the wall is dead ahead. |
| 166.222 | bar 94, beat 3 | The nose hits the wall in the sun, under the board. The canvas dents in, tears in long strips, and the wooden frames behind it break. The status bar reads `ERR`. |
| 166.222–167.111 | beats 3–4 | We go through with the train: one beat of the stage behind the wall, then a bright rectangle ahead that comes at us fast and fills the frame. It is the glass of the CRT from inside. |
| 167.111 | bar 95 | The room, at dawn. The eye is close at the CRT and pulls back, fast: the recoil of the head. It faces the set. The train of the game, as small as it is on the screen, bursts out through the middle of the glass and flies out into the room, down and to the right, with shards. Round the hole the glass is cracked. (The director's sketch.) |
| 168.06 | | Then it is not there. No shards, no train. The glass is whole. It was one more thing that leaked, as in the interlude. |
| 168.0–169.333 | | The room is packed: all boxes taped, pale rectangles on the walls, the same kotatsu and quilt. On the kotatsu lies the punched pass. The CRT plays its attract mode by itself: the title screen of the opening over a map of the ring line with the train going round, `PRESS START` on the beats, `DAY 1`. The head looks at the pass (168.26), then at the CRT (168.91). |
| 169.333–170.667 | bar 96, beat 2 | Push into the CRT as the tube switches off. The push ends exactly on the frame 0 picture. |

## Music reactivity

| Source | MIDI track | Drives |
|---|---|---|
| Kick | 19 | Rail joints, the train on its springs at a platform, the clock (chorus 1), the load retries, ridge and star pulses and frost cracks (bridge), the day counter (verse 2), the stars and the corona (chorus 3). The hand straps do not play the music: they swing as real ones do, from the acceleration of the car (`ride.ts` `swingStraps`). |
| Snare | 18 | `RETRY` jumps, the jellyfish's small error boxes, fireworks, flower bursts and ridge pulses (bridge), far lightning (chorus 2), fireworks (chorus 3). Never the camera. |
| Lead, chords, bass | 6, 14, 5 | The floors of the zone buildings (chorus 1b). |
| Lead | 6, or `generated/notes.json` lane `te` | Kana syllables. In chorus 3 the stars of a glyph come on with its syllable. |
| Beat grid | | The scissors in the cursor's hand (verse 1). The cursor's taps. The calendar pages and the house windows (chorus 1). |
| Arps | 2, 3, 4 | The light pillars and the read line on the moon (bridge). In chorus 3 the melody draws itself across the sky as stars and lines of light, one colour for each track. |
| Chords | 14 | The aurora and the salvos of fireworks (bridge), a ring of light from the eclipse (chorus 3). |
| Hat | 17 | Stars that glint (chorus 3). |
| Harmony 2 | 13 | Shooting stars (chorus 3). |
| Counter-melodies | 8, 9 | A streak in the sky and a ring on the ground with sparks at the wheels (verse 2). Lights along the ceiling and the floor of Platform 8, in unison. |

**Drum fills are ratchets.** A fill does not pass smoothly. One thing in the world goes forward by one step on each hit of the fill, and stands between the hits. Never the camera.

| Bar | Time (s) | What steps |
|---|---|---|
| 16 | 27.000–28.222 | The pick-up, one step on each hit: the tool (27.000), the grab (27.556), `あ` (28.000), `ー` (28.222). |
| 32 | 54.556–56.000 | The pieces of the track behind the train break off, one on each hit of the bongo, the woodblock and the snare. |
| 40 | 70.222–70.963 | The frost goes over the train from the nose to the tail, one band of ice on each hit of the snare (7 bands), to the stall on bar 41. The bands break off in the fall. |
| 60 | 105.111–106.667 | The loads: on each kick the cars are back at the start of the corridor. On each hit of the woodblock (106.000, 106.111, 106.444) they jump a step back. |
| 76 | 133.333–134.556 | The crash of the program: End Task on the first hit (the desktop tears, then the text mode), the jellyfish explode into characters on the next hits, and each hit breaks the text mode more. |

Take the times of the hits from the snare and tom tracks.

Sources: `generated/notes.json`, `video/assets/midi.json` (a fan MIDI, offset +16 beats, on the fixed 135 BPM grid).

## From the argon review

| Taken | Not taken |
|---|---|
| Speed cues: sleepers, dust at the wheels, poles that whip past. | Phosphor dots when the camera goes through the CRT glass. |
| Fire and smoke that stay where the tuna hit. | Pitch glides that bend the wires, the track and the aurora. |
| A colour script per section. | The header `PROJECT DIVE-A`. |
| Larger houses and towers. | Step zooms of the camera on drum fills. |
| Drum fills as ratchets, on objects. | A green laser from the HUD. |
| Hand straps in the car. | A ghost train in chorus 2. |
| Life in the town, in small ways, with things that change. | Lyrics on billboards in chorus 3. |

Its cause for the preview fault (a state that is not put back before its event) does not fit what the director sees: a scrub puts the picture right. Find the cause in the code.

## Build

| Topic | Build |
|---|---|
| Workflow | One agent, in song order. No subagents for scene work. This file is the only plan. |
| Review | The agent renders a contact sheet per scene (`pve look`, `pve still --sheet`) and checks it against this file. The director previews in the studio and writes notes (`video/notes/`). Stop after each pass for the director. |
| Base | v9 changes the v8 scenes in place. Only `chorus3.ts` and the outro are written again. |
| World | One world module (see "The game world"). Never delete a file: move it to `video/.deprecated/`. |
| Renderer | `@pve/engine/lit`, `@pve/engine/litview`, `@pve/engine/textlayer`. Song time: `scenes/_time.ts`. Do not call `atlas.repaint()` per frame. |
| Player | `_playerTrack.ts`, `_playerRig.ts`, `_playerTypes.ts`, `_playerChrome.ts`, `_playerWindows.ts`, `_playerCams.ts` (`PLAYER.md`). The tooltip takes its place from the cursor at time t. The habits of the cursor are inputs in the same track. |
| Physics | `@pve/engine/physics`: Rapier, deterministic. Bake in `init()`, sample by t. |
| Determinism | A frame depends only on t. This includes the first frame after load, a frame after a scrub and a frame in a loop of the preview. No state that a frame before it has set. |
| Text | Always integer coordinates on a `TextLayer`. |
| Cost | The director put speed and benchmarks after the look: "we can do perf later after everything is good". Do one pass for speed and benchmark entries at the end. |
| Check | `bun run pve gate -p sardine`, the contact sheet, and `bun run pve seam -p sardine` when the chirp or the outro changes. |

### Order

Bugs first, then song order, the rebuild last.

| Pass | Content |
|---|---|
| 0. Faults | Done. The preview fault: three causes, all of the kind "a frame left a state behind" (the duckboard and the bodies of the pit were not put back before their bake starts, and the fish cam left its planes on a camera that the station views share). `bun run pve determinism --project sardine` finds such faults: it renders seeded times in order and shuffled and compares the pictures. The pass: one size (`Fish.PASS_SCALE`), one place (`Fish.hold`), on every fish of every scene, plain before the punch and punched after. The remote lies clear of the pass. The fins of the tuna and of the sardine have two faces that stand apart. The console. The shadow of the train at Station ？. The move down to the train and the ride have one frame and one world from the click. The joint between the cars (`carJoint`). The new credits text. |
| 1. Boards | The scale of the houses: done (`scale-board.ts`, see "The game world"). The colour script has no board of its own: the agent shows the sky of each section in the contact sheet of its pass. |
| 2. Act 1 | Done, for the director's review. Plates 1 to 4 as written. `ride.ts`: the cursor reads the board and goes with the sardine; the train rocks at the platform; hand straps; the seat on 14.222; the car window follows the sardine to the cab; the scissors by key and the cursor's way down to the rail; the hits of the cut and the join (`quake`); the sardine turns after the hand (`lookTo`); the zoom level in the ticker; the join jolt on `つ`; the map at the house from 26.5 at 2.0x; the `あー` tooltip. `day.ts`: the ceiling lamp dimmed; street lamps that light the street, and the shadow of the jellyfish on the road markings; house windows in two halves on the beat; the corner window maximized at 35.556; bits of paper; no station window; the fall 0.65 s later. `night.ts` and `_pit.ts`: props that go missing by themselves and a cursor that runs after them; the torn tooltip; clouds in pieces with gravity; the hole; the zoom into the tunnel; the track that breaks on the fill. |
| 3. Bridge | Done, for the director's review. Plate 5 as written. `_bridgeflowers.ts`: six walls that let go whole, and flowers and petals that fly in one field of turbulence round the car until the wind stops. `_bridgeletters.ts`: `FlockLine` (line 14 of birds), the glyphs of the moon placed by the camera. `_bridgelights.ts`: fireworks on the snares and salvos on the chords (frozen after `sv_wind 0`), rings of stars round the moon, posts of light under the climb and pools of light in the deck on the arp notes, tuna that swim, change places and lose their hold. `_bridgeair.ts`: air lines that bend round the nose and hang as threads of ice, the bands of ice of the fill. `_bridgeworld.ts`: four skies, banks of cloud towers, the shadow of the train on the deck, the read light from the catch. `_oob.ts`: contour lines, roads and rivers that stop at tile borders, labels, tiles of a finer zoom that load round the train, coarser tiles far off, a scale bar, a second gap. `bridge.ts`: the views of the fish cam, the windows that sag at the stall, the cursor (eight refused clicks on `[×]`, three drags of the train on the map, the fish cam, a second console command that is refused, clicks on the disc, a pull at the train, blows on the nose). |
| 4. Verse 2 and chorus 2 | Done, for the director's review. Verse 2 (`interlude.ts`, `_interludeVerse.ts`): no fish cam. `_versefx.ts`: marker posts that whip past, dust at the rear wheels, voice 1 (track 8) as streaks in the sky, voice 2 (track 9) as rings on the ground and sparks at the front wheels. `_platform8.ts`: the corridor under もと (tiles, tubes that go out, posters, the sign `8番のりば`, line 21 on three yellow signs, the duet in unison), the cars that come through its ceiling and slide along it. Each failed load shows the corridor whole with one change (the number 9, the eye of the fish, a tube that is out). The minimap shakes at the hit. Chorus 2 (`chorus2.ts`, `_buddy.ts`, `_c2clock.ts`, `_bsod.ts`): the storm sky with sheet lightning on each third snare; a dialog breaks into its title bar, button, bevel strips, shards and glyphs; each copy damages the picture of its window (five kinds); the cursor puts the minimap back and rubs at the fish cam; Close Program, the text mode and the blue screen at the end. A fault of pass 0 came out here: the move down to the train at 92.0 left its near and far planes on the ride camera (`determinism.ts`, seed 404). |
| 5. Chorus 3 and outro | Done twice. The first build put chorus 3 on a stage of its own, and the director rejected it: a hard cut at 135.111, a view at an angle, no lights on the music, a credit wall that looked bad. The second build: `_c2shared.ts`: chorus 2, chorus 3 and the outro draw one world (`acquireC2`, shared through `ctx.memo`). `chorus3.ts` draws that world in the stage frame, with copies of its plain meshes that unload (`_c3copy.ts`, `_c3unload.ts`). `_c3stage.ts`: the route (`carOnRoute`: the lap, then the straight from 33 degrees), `C3Line` (the straight), `Wall` (the end wall with the name board), `StarLines` (the constellations). `_c3ride.ts`: the orbit camera. `_c3games.ts`, `_c3fall.ts`, `_c3hud.ts`: the typing game, the DIVA game, the hits and the key caps. `_c3map.ts`: the minimaps. `_c3mosh.ts`: the datamosh from the blue screen. `_c3lights.ts`: the voices of the music as lights. `_outro.ts`: the small train out of the middle of the CRT, with cracks. `determinism.ts` passes on seeds 404, 77 and 5150. `pve seam` 0.2726. |
| 6. Speed | Done: `pve perf` on all clips and benchmark entries for the new effects (`_c3Bench.ts` has the spans of the new scene). |

## Open

- The houses that the cams of the room see across the street are larger and stand 1.7 m further back than in v8.
- The crack on the CRT glass after 167.6: the plate says that the glass is whole. The loop needs frame 0 without a crack. If the director wants the crack of the moon to stay from 85.333 to the end, the loop needs a way to lose it.
- Chorus 2: the time of day is the day of the save, not the night of verse 2. The cut at 106.667 is the load. The director did not object.
- Left from v8, not in the director's note: at 106.667 the tentacles of the jellyfish hang over the dialog of line 22 for about a second.
- Chorus 3:
  - The straight leaves the loop at 33 degrees and heads east-north-east. It is not the stem: the stem ends at the loop and points the other way.
  - The instanced parts of the world of chorus 2 (the track of the loop, the sardines, the tiles of the pit, the tuna) do not drop in pieces: each goes out when its place unloads.
  - The eclipse does not move with the train: it is the disc of the sky.
  - Not built: the miss that takes the roof of the rear car, fire and smoke that stay longer than the explosion, the shadow of the train and the circles of the headlights on the wall, the sardine seen at the front glass in the nose shot, the things of the world that shake when the cars come down after a gap, a pad voice (tracks 10 and 11) as a light.
- Asked for in v9 and not built:
  - Act 1: the wire that parts and the signal that goes red at the cut (a spark is there), the tea that moves in the mug, the level crossing and chimney smoke of the town, the colour script of act 1 (the skies are those of v8), dust in the light of the room, the kick rings in the wall of the hole, the ground round the hole that loses its colour. The hole of line 12 is behind the large tower for its first second and a half, as in v8.
  - The cursor that shakes on the failed loads of verse 2.
  - Bridge: flower walls with parts that stay, bulge and tear. The flowers of a wall stand in the air with no stem or frame. The shadow of the train on the cloud deck is one flat patch at the height of the tops of the banks, not a cast shadow.
  - Verse 2: leaves at the wheels, wires that rise and fall, the lamps on the columns under the crossing, the rail of the loop that stands up at もと (the wreck is posed at a fixed time). Platform 8 has no lockers, no door and no rain of tiles.
- The faults of the picture in chorus 2 are drawn over the windows: they do not move real pixels of the picture (no stale copy of an old frame, no rows of the real picture that shift).
- The camera of the corridor stands low beside the nose of the front car, so the rear car is behind it.
- The kits of v6 and v7 that the video still uses (`_editor.ts`, `_captionCarriers.ts`) stay. The v6, v7 and v8 boards and benchmarks, the helpers that only they used, and `OutroFlight` with its wall (`_skywall.ts`) and school (`_outroschool.ts`) are in `.deprecated/`.
