# sardine: the player foundation

This file is the reference for the shared modules that every v5 scene uses. The source of truth for the look is `treatment.md`.

## Files

| File | Does |
|---|---|
| `scenes/_playerTypes.ts`, `_playerTrack.ts`, `_playerChrome.ts`, `_playerWindows.ts`, `_playerRig.ts` | The inputs, the state types and the window rectangles (`_playerTypes`). The input track `PlayerTrack` (`_playerTrack`). The chrome text, the handle, the banner and the cursor (`_playerChrome`). The text-window layout and the window factories (`_playerWindows`). The window compositor `PlayerRig` (`_playerRig`). |
| `scenes/_playerCams.ts`, `_rideMusic.ts` | The camera modes (`HeadCam`, `MapCam`, `RideCam`, `FixedCam`, `FishCam`). The kick bounce (`_rideMusic`). |
| `scenes/_fonts.ts`, `_kana.ts`, `_subtitle.ts`, `_typing.ts` | Fonts, the `ko` and `ca` lanes, `writtenOf` (`_fonts`). Big kana, the 45 degree fall, `printKana` (`_kana`). The subtitle (`_subtitle`). The typing prompt (`_typing`). |
| `scenes/_captionCarriers.ts` | v7: the lyric carrier kit (see "v7 kit"). |
| `scenes/_ticket.ts`, `scenes/_duckboard.ts` | `Ticket` (the lyric printed on it, punch holes) and `Duckboard` (the lyric painted on the slats). |
| `@pve/engine/litview`, `@pve/engine/textlayer` | `LitView(w, h)` makes a sized view for a window. `TextLayer.rect`, `shade` and `sink` are fast. |
| `lanes.json` | The `ko` and `ca` lyric lines. `make-lanes.ts` writes it from the song folder. A test checks that it is up to date. |
| `@pve/engine/gl` `setMissing` | The missing-texture material and the swap. |
| `scenes/_editor.ts` | The map kit. v6: the tool icons (`Ui.toolIcon`), `trainMarker`, `placeTrainMarker`, `HoverArrow`. |

## Rules

- A frame depends only on t. The track, the cameras and the glyph break are data, not state.
- Time is in song seconds. A click press and a window grow are 2 frames at 36 fps.
- The chrome is drawn on the 640x360 `TextLayer`. Nothing per frame goes on the atlas.
- The windows are blitted into the main view in HDR. The bloom, the tone map, the dither and the CRT run once over the composite.

## The input track

Make one `PlayerTrack` for each shot from a list of inputs. Each input has `at` (the beat) and `kind`.

| Input | Effect |
|---|---|
| `move` | The cursor goes to `to`. It arrives 2 frames before `at`. The path bends, eases out, overshoots a little and corrects. |
| `click` | A 2-frame press from `at`. `clickAt(at, to)` gives the move and the click. |
| `drag` | Press at `at`, move to `to` in `dur`, let go. |
| `pan` | A right-drag of the map by `by` px. The map follows 1:1 and stops dead. |
| `edge` | An edge scroll in direction `dir`. The speed ramps up. |
| `zoom` | A notch of the map (an index into `MapOpts.notches`, default 0, 1 or 2). It takes 4 frames, or `dur` seconds as one smooth move. |
| `look` | The map goes to the ground point `to` in `dur` seconds, as one smooth move. |
| `rotate` | One 90 degree step. It is a hard change. |
| `follow` | The map locks to `MapOpts.follow`, or lets go. |
| `tool`, `speed` | The pressed tool and the game speed in the toolbar. |
| `open` | Opens a window (a `WinSpec`). A box grows for 2 frames from `origin`. |
| `dragWindow`, `maximize`, `restore`, `close`, `view`, `focus` | Window actions by `id`. `dragWindow` with `spring: true` is a drag that is refused. |
| `cam` | The cam button of a security-cam window: a hard cut to feed `cam`. |
| `denyClose` | A close attempt that fails. |
| `handle` | A drag of a tool handle (a rail end, a zone corner). |
| `tip` | A tooltip near the cursor. |
| `console` | The developer console: `~`, the typed `cmd`, Enter, an optional `reply`. See "v7 kit". |
| `carry` | The pick-up hand carries the sardine to `to`: grab, swing, drop. See "v7 kit". |

The track throws an error that names the time when a move has no time to arrive, or when an input names a window that is not open.

Aim the cursor with `TOOLBAR.*`, `winButtons(rect, maximized)`, `titleGrab(rect)` and `modalButton(fonts, spec, label)`.

## Cameras

| Class | Use |
|---|---|
| `HeadCam` | Room. Fixed eye, turns of about 0.25 s with a few degrees of overshoot, breathing of 4 mm at 0.3 Hz. `slow` stretches every turn in time: the interlude uses 1.6 (0.4 s, a person who looks round). |
| `MapCam` | Map. Orthographic, 30 degree pitch, yaw in 90 degree steps, three zoom notches, pan and follow from the track. |
| `RideCam` | Train. A spring arm in the train frame: `chase34`, `side`, `low` (the hip view), `nose` (a close-up beside the front of the car), `cabin`. Kick bounce from MIDI kick times (`kickAmp`, default 0.035 m; `onRails` keeps it to the time on rails), impact shake. The `pose` callback is the arm's pose, not the train's: the bridge gives it a damped pitch, so the horizon stays more level while the train drops. v7 had `music` moves (see "v7 kit"): v8 does not use them, the camera never moves on the music. |
| `FixedCam` | A window camera bolted to a place. `near: 0.01` for macro shots. A security cam zooms in steps: `notches: [{ at, pos, target, fov }]` in time order. Each notch takes 4 frames and moves from the place before it with a smooth step. |
| `FishCam` | The `[FISH CAM]` window: a tight lens on the sardine in the car, bolted to the car (see "v7 kit"). |

Each has `apply(cam, t)`.

## The window compositor

```
const rig = new PlayerRig({ track, fonts, ticker, counter });
const st = rig.state(t);
mapCam.apply(ed.cam, t);
if (!st.maximized) view.render(r, mapScene, ed.cam, sky);
rig.compose(r, view, st, (win, v) => { /* render the 3D of window win into v */ });
text.clear();
rig.draw(text, st);
text.commit();
view.present(r, out, output, text);
```

`compose` renders only the windows that show (a maximized window hides what is under it) and clears the main view when a window is maximized. Use `rig.aspect(win)` for the window camera.

## v6 kit

### Tools and the cursor

`Tool` has 14 values: the four of v5 and `V6_TOOLS` (`bend`, `poke`, `punch`, `delete`, `zone`, `disaster`, `flower`, `wind`, `pickup`, `loadstate`). Each has a 13 px icon (`Ui.toolIcon(tool, cx, cy)`).

- The four v5 buttons stay in the bottom bar. The ten v6 buttons sit in the top bar, right of the menu buttons. They show only with `new PlayerRig({ ..., tools: true })`, so the v5 scenes do not change.
- `toolButton(tool)` gives the rectangle of any button, for the cursor to aim at.
- When a tool is selected the cursor carries its icon on a plate at the tip. `RigOptions.cursorTool: false` turns it off. `drawCursor(ui, x, y, tool, down)` draws the same cursor without a rig.

```ts
const track = new PlayerTrack([
  ...clickAt(1.0, centreOf(toolButton('bend'))),
  { at: 1.0, kind: 'tool', tool: 'bend' },
], { cursor: [300, 200] });
const rig = new PlayerRig({ track, fonts, tools: true });
```

### The rotate button

`new PlayerRig({ ..., rotate: true })` adds the rotate button to the top bar (`TOOLBAR.rotate`, right of the ten tools, left of the close button). The cursor clicks it on the beat of a `rotate` input:

```ts
...clickAt(t, centreOf(TOOLBAR.rotate)), { at: t, kind: 'rotate', steps: 1 }
```

### The room tells (the real room)

- `Home.setBoxesOpen(true)` opens the boxes `だいどころ` and `ふく` beside the CRT: flaps up, things showing over the rim (kitchen things, clothes). The default is shut and taped, as the copy room needs them. The chirp (`opening.ts`) and the end of the outro set it open, so frame 0 and the last frame still match (mean abs diff 0.28).
- `MUG` and `addMug(builder, atlas, matrix)` (`_home.ts`) build the mug on the kotatsu (`MUG.at`). The copy room of chorus 1 builds the same mug with `addMug`.
- The sardine carries the commuter pass (`Ticket`, `いま → あした`, scale 4.2) on a loop under its gill (`ride.ts`).

### Tooltip

`{ at, kind: 'tip', text, times? }` opens a pale box at the cursor tip. It follows the cursor on every frame (below and right of the tip, and it flips at a frame edge). The text shows one code point at a time on `times`. The box has the size of the whole text from the start. `text: null` removes it. `PlayerState.tip` carries `{ text, full, anchor, age }`, and `anchor` is the cursor at time t. A line that the cursor carries over several clicks is one `tip`.

```ts
{ at: 1.0, kind: 'tip', text: 'BEND: あした', times: unitTimes } // 9 code points, 9 times
```

### Handles with ghosts

`{ at, kind: 'handle', id, to, dur, snap?, snapDur? }` presses on the handle where the cursor is, drags it to `to` and lets go. The handle follows the cursor 1:1. Without `snap` it stays (`released`). With `snap` it moves there in `snapDur` (default 2 frames) and the phase is `snapped`.

`track.handleAt(id, t)` and `PlayerState.handles` give `{ id, pos, from, u, phase, since }`. `pos` is in screen px. `u` is the eased progress of the drag. `since` is the time in the phase.

Draw helpers (all on the `TextLayer`):

| Helper | Does |
|---|---|
| `drawHandle(l, h, size?)` | The yellow end node. It is 2 px larger while held and flashes white for 2 frames after a snap. |
| `drawSnapBanner(l, fonts, text, at, age, hold?)` | The snap flash: a box that is white for 2 frames, then dark with a cyan rim, for `hold` s (default 0.9). |
| `drawGhostArc(l, a, b, t, bow?)` | A glowing arc from `a` to `b`. The core marches at 18 steps/s. |

Draw them in the `over` callback of `rig.draw(l, st, over)`. It runs after the windows and before the tooltip, the click effects and the cursor.

```ts
rig.draw(text, st, (l, s) => {
  const h = s.handles.find((x) => x.id === 'end');
  if (!h) return;
  drawGhostArc(l, railStart, h.pos, s.t);
  drawHandle(l, h);
  if (h.phase === 'snapped') drawSnapBanner(l, fonts, '[LINKED: あした ⇔ きのう]', [h.pos[0] - 70, h.pos[1] - 24], h.since);
});
```

### Click impact

On every `click` input:

- the cursor presses for 2 frames, as before.
- a ring bursts from the cursor tip in 6 frames (radius 3, 6, 9, 11, 13, 14 px): a light 2 px ring with a dark outline, pixel-crisp. A right click is cyan. 5 spark ticks (2 px wide, 4 px long, dark shadow) fly out beyond the ring in the first 5 frames.
- for 3 frames the button that was hit flashes (white, pale blue, then a 2 px white frame): a toolbar button, a window button, a button of a text window. A click in a window that is not on a button flashes the outline of the window (2 px, then 1 px).
- the clicked window jumps up 1, 2, 1 px and rests (its `rect`, and so its `content`, move: the 3D picture jumps with the frame).

`track.clicksAt(t, within = 0.5)` and `PlayerState.clicks` give the recent clicks `{ at, x, y, age, right, winId? }`. A scene uses them to give the 3D target a reaction (shake, dent, bounce):

```ts
for (const c of st.clicks) if (c.winId === 'planter') shake += Math.exp(-14 * c.age);
```

### Security cam windows

Give a window `cam: { labels: ['CAM 01', 'CAM 02'], clock? }` and a view body. The title bar gets one labelled button for each feed (`camButtons(rect, maximized, n)` has their rectangles). The active one is sunk and yellow. Over the picture: corner brackets, a `REC` dot that blinks at 1 Hz, and the feed label. The status bar shows the wall clock at the right (`HH:MM:SS`, counting on from `clock`, default 23:41:07). There is no noise and no colour shift.

`{ at, kind: 'cam', id, cam }` is a hard cut to feed `cam`. `WinState.view` and `WinState.cam` follow it. The scene picks the camera with `win.view`.

```ts
const house: WinSpec = { id: 'cam', title: '[HOUSE]', rect, body: { kind: 'view', views: 2 }, cam: { labels: ['CAM 01', 'CAM 02'] } };
...clickAt(t, centreOf(camButtons(rect, false, 2)[1]!)), { at: t, kind: 'cam', id: 'cam', cam: 1 }
```

### CANNOT CLOSE and the refused drag

`{ at, kind: 'denyClose', id }`, after the click on the [x] (`clickAt(at, centreOf(winButtons(rect, false).close))`): the [x] is red for 6 frames, the status bar reads `CANNOT CLOSE` for 1 s, and the window jerks sideways (4, -3, 3, -2, 2, -1, 1 px).

`{ at, kind: 'dragWindow', ..., spring: true }`: the window follows the cursor, and after the release it springs back to its place (a damped spring, 20 % overshoot, rest after 0.9 s).

### Ride cam swing

In the `mode` list of a `RideCam` an entry can have `swing` (seconds, about one beat):

```ts
new RideCam({ pose, mode: [{ at: 0, mode: 'chase34' }, { at: 10, mode: 'side', swing: 0.5 }] });
```

From `at` to `at + swing` the arm swings from the mode before to this one. The eye orbits round the look point (the shortest way round). The look point, the lens and the lag blend, with a smooth start and stop. Without `swing` the change is a hard cut. A swing that the next mode change cuts short starts the next one from the pure mode before it. It is a pure function of t.

### The typing prompt (chorus 3)

`drawTypingPrompt(l, fonts, line, t, { anchor, side?, lag?, missAt?, n?, from?, until? })` draws a box with the kana line and its romaji, with a tail that points at `anchor` (the scene projects the tuna into it). Typed units fill red. A unit is typed at `start + lag.base + lag.grow * (start - firstStart)`, so the fill falls behind the song (default 0.12 s and 0.3). At `missAt` a red `MISS` tag flashes for 0.75 s, and the units that were not typed by then never fill. It returns the box rectangle, or null when it does not show.

The romaji comes from the lane. `lanes.json` holds `kuromaguro ga tondekuru` as `text`, and `sylText` for the words with several syllables. `unitRomaji(line)` joins the syllables of each written unit and marks the word breaks. No conversion from kana is needed. A test checks that every unit of every `ko` and `ca` line has a piece.

```ts
drawTypingPrompt(text, fonts, ko.lines[8], t, { anchor: project(tuna), missAt: ko.lines[8].start + 2.0 });
```

### Act type kit

Act 1, `printKana(l, layout, t, { motion, times?, hot? })`. A tool prints one unit for each click or stamp (`times`, default the unit start). The unit never fades in. It plays a motion for its first frames:

| Motion | Frames | Look |
|---|---|---|
| `press` | 2 | 1 px to the lower right, in the hot ink (default yellow). |
| `slam` | 3 | 3x, then 2x, then 1x the size with a 2 px dip, round the middle of the glyph. |
| `flip` | 4 | The glyph turns to face you: 20, 50, 80 and 95 % of its width. It shows from the first frame. |
| `invert` | 3 | The dark glyph knocked out of a light block. It shows from the first frame. |

`motion` can be a function of the glyph, for a choice for each unit.

Act 3, `reminderWindow(fonts, { id, title, rect, line, ca?, body?, views?, status?, n?, rows? })` makes a `WinSpec`. The body is a live view (default, `views` cameras) or a drawing. The lead kana are printed at the bottom of the picture, one unit on each start time (`press`). `ca: { line, dx?, dy? }` prints a copy 1 to 2 px off over the lead, in a cooler ink without an outline. `WinBody` of kind `view` has an `overlay(l, content, t)` for this. `BarLine` is gone: no kana leave a bar and go over the picture (v7).

### The subtitle

`subtitle(l, fonts, line, t)` draws the English fan line: one Silkscreen line at 1x, centred, with a dark outline and a solid dark strip behind it (2 px padding, as long as the phrases that have started). It sits at one fixed place (`SUBTITLE_Y` = 332, the last row; a long line wraps upward). The strip ends at y = 334, above the bottom toolbar (from y = 338) and above the status bar of a maximized window, so it never touches the chrome. It is the only function that draws the line. Every scene calls it last, after the chrome, the cursor and every other text, and only in one place. A toggle comes later: it will sit in this function.

### The missing texture

`_missing.ts` has one unlit material: magenta (#ff00ff) and black cells, no filtering, no fog. The UVs of the kit point into the atlas, so the shader computes the checker from the object-space position, on the plane of the strongest axis of the object-space normal. A mesh shows 8 x 8 cells along its longest side (`MISSING_CELLS`). Instanced meshes work.

| Function | Does |
|---|---|
| `missingMaterial(cell, side?)` | The material for cells of `cell` units (shared). |
| `setMissing(root, on, cell?)` | Swaps the materials of every mesh under `root` for the checker, or back. It does not touch the geometry. Calling it twice does nothing more. |
| `missingAt(root, spans, t, cell?)` | `setMissing` from `[from, to)` spans, so the frame depends only on t. |

```ts
missingAt(house, [[42.667, 56.889]], t);
```

### Map markers (`_editor.ts`)

- `trainMarker()` is a small RollerCoaster Tycoon train icon: an orange body with a roof stripe and windows, a darker nose. Its long axis is local X. `placeTrainMarker(marker, frame, lift = 0.9)` lays it along the track tangent. Chorus 2, chorus 3 and verse 2 use it (they built a box whose long axis was Z, so the marker lay across the track).
- `new HoverArrow(height)` is the Sims green diamond. It is emissive (HDR vertex colours), so it blooms and reads at map zoom. `arrow.pose(t, base, lift = 3)` bobs it 0.35 m at 0.9 Hz and turns it 2.4 rad/s. Add it to the map scene.

## v7 kit

v7 pass 0. The source of truth is `treatment.md` v7. Nothing here draws a lyric over the picture: every Japanese line has one carrier in the world or in the game UI.

### Lyric carriers (`_captionCarriers.ts`)

Each carrier shows the full line and lands each unit on its calibrated start with one `PrintMotion`. Kana never fade in.

| Carrier | API | Motion |
|---|---|---|
| Tooltip at the cursor tip | the `tip` input. `PlayerState.tip.landAge`: the newest unit is drawn inverted for 2 frames | invert |
| Flap board | `drawFlapBoard(l, fonts, line, t, { rect, n?, rows?, head? })` | flip |
| Surface in the world: calendar, road, slats, banners, sky dome | `new PaintedText(fonts, line, { px, size, layout?, motion?, times?, only?, ink, edge, outer, hot?, ghost?, ground?, emit?, lit?, hold?, geometry? })`. Add `.mesh` to the scene and call `update(t)` before the render | press (default) |
| 3D letter gates | `new LetterGates(fonts, line, { place, ink?, hot?, emit?, depth?, gone? })`. Add `.root`, call `update(t)` | slam |
| News ticker | `drawNewsTicker(l, fonts, line, t, { rect, label? })` | press |
| Speech balloon | `drawBalloon(l, fonts, line, t, { anchor, n?, maxW?, rows?, side? })` | slam |
| DIVA lyric bar | `drawDivaBar(l, fonts, line, t, { y?, n?, lead? })` | invert |

- `PaintedText` lays the line out on a small `TextLayer` (`new TextLayer(w, h, THREE.SRGBColorSpace)`, same pixel layout as the 640x360 layer) and repaints it once for each video frame, only while the mesh shows. `lit: true` gives a Lambert material (road paint, slats), otherwise an unlit one with the HDR strength `emit` (sky dome, banners: above 1 it blooms). `ghost` shows the unsung units dim (a header that lights syllable by syllable). `geometry` can be any geometry with UVs 0..1 (a `SphereGeometry` slice seen from the inside with `scale.x = -1` for the dome). `layoutAtUnit(fonts, line, k, n, cx, y)` gives the `layout` that puts unit `k` on a small surface, with `only: (g) => g.unit === k` (one syllable for each slat).
- `LetterGates` builds each glyph once as block letters (the font pixels merged by row, `cell` metres for a pixel, default 0.5: a glyph is 7 m tall). A gate stands at `place(unit, glyph)` = `{ pos, yaw, cell? }`; `yaw` π/2 faces a train that runs along +x. Each unit appears on its start with a slam (3x, 2x, 1x) and stays until `gone(unit)`. Gates in one line along the view axis would stack.
- `printKana`, `drawKana` and `drawGlyph` take an `Ink` (anything with `sink` and `rect`): a `TextLayer` of any size.
- Status bars hold dry telemetry only (`CAR 1  58 km/h`, `STN ？  ARRIVING`, `TEX 0x00FF00FF  MISSING 7/17`, `sv_wind 0.0`). No lyric, no prose.
- `Jellyfish` (`_jelly.ts`): see "The jellyfish" below.

### The jellyfish (`_jelly.ts`)

`new Jellyfish(atlas, mat, { size?, glow?, phase? })`, `root` into the scene. Size 1 is 1.68 m (`JELLY_HEIGHT`): a bell 0.62 m wide, 10 long tentacles (1.4 m) and 4 short oral arms, all pale blue and emissive (the colour of this creature only). The bell is a mesh; the tentacles are two `InstancedMesh`es whose matrices are written once for each call (about 120 segments). A pose depends on t and its arguments only.

| Call | Pose |
|---|---|
| `drift(t, p, { v?, yaw? })` | floats at `p` (the rim of the bell): the bell pulses every 2.4 s (`pulse(t)`), a slow bob, turn and tilt. The tentacles trail behind the velocity `v` |
| `hold(t, { anchor, right, up, span }, { size?, grip?, drape?, lift? })` | the desktop buddy. The bell sits on the bar (rim `lift` above `anchor`), the root takes the frame of the bar. Tentacle 0 grips the right end and tentacle 5 the left end (an arc that sags and curls round the end; `grip` 0..1), the others hang in front of the window by `drape`. Default `size` = `span / 2.6` |
| `holdWindow(t, cam, rect, depth, o?)` | `hold` for a window `rect` [x, y, w, h] of the 640 x 360 frame, `depth` metres in front of `cam` (`screenPoint` gives the corners) |
| `tip(k)` | world position of the tip of long tentacle `k` |

The jellyfish is drawn in the 3D pass. To put it over a 2D window, composite its pass after the windows.

### The developer console

`{ at, kind: 'console', cmd, reply? }`. At `at` the player presses `~`: a translucent panel (`CONSOLE_W` x `CONSOLE_H` = 236 x 66 px) rises in the bottom right corner in 6 frames. It stands over the status bar and clear of the English line. `PlayerRig({ consoleInset })` moves it left when a window stands in that corner (the bridge: the fish cam). The first key is 0.4 s later, then about 11 keys a second with a little jitter. Enter comes 0.25 s after the last key. The panel prints the command and the `reply` under it, and goes down 0.9 s after Enter. `consoleTimes(at, cmd)` gives `{ open, typed[], enter, close }`. A second console must open after the first has gone.

The scene reads the command and lets the world react in the same frame:

```ts
const t0 = track.commandTime('sv_wind 0');           // null when there is no such input
const windOn = t0 === null || t < t0;                 // a pure function of t
// or from the state: st.commands = [{ cmd, at, age }]; st.console = { drop, text, caret, lines, fired }
```

`PlayerRig.draw` draws the panel over the windows and the tooltip, under the click effects and the cursor. It replaces the wind slider of v6.

### The pick-up carry

`{ at, kind: 'carry', to, dur, via?, scale? }`. The cursor presses at `at` where it is (the pick-up tool, the sardine under it), the sardine lifts off in 0.14 s, hangs from the hand by its tail stalk, and the hand carries it to `to` in `dur` s and lets go. `PlayerState.carry` (`track.carryAt(t)`):

| Field | Meaning |
|---|---|
| `phase`, `since` | `grab` (0.14 s), `carry`, `drop` (from the release, for 1.5 s: the scene lets the sardine fall). Null before the grab and after the drop. |
| `pos`, `from`, `to` | The hand, and where the carry began and ends (screen px). |
| `lift` | 0..1 over the grab. |
| `swing`, `swingVel` | The angle of the hanging fish off the vertical (rad, + toward screen right; soft limit 1.15) and its rate. A pendulum of 0.35 m driven by the hand (it sees the hand through a 0.1 s mean), light damping, compiled once from the path. `scale`: screen px per metre, default 60. |
| `wriggle`, `amp` | The phase of the tail beat (rad) and how hard it beats (0..1, harder when the swing is fast). |

`Fish.dangle(anchor, swing, wriggle, amp, { side, lift, restY })` (`_fish.ts`) poses the fish from it: at `lift` 0 it lies on the ground along `side`, at 1 it hangs head down from `anchor` (the grip in the world: the scene puts the cursor on a plane of the hold height). After the drop the scene lets it fall from the hand and keeps the swing.

### The low ride mode

`RideMode` has `low`: a low angle looking up at the train (the held view of the moon).

### The `[FISH CAM]` window

`fishCamWindow({ id?, rect, clock? })` is a security-cam style window titled `[FISH CAM]` (REC dot, corner brackets, time stamp, the label `FISH`). Its view is a `FishCam({ pose, fish, window?, eye?, look?, fov?, lag?, kicks?, kickAmp? })`: `pose` is the car's world matrix, `fish(t)` the sardine in the car frame. The camera stands behind the sardine, a little above it, on the aisle side, and looks past its nose at the window (`window`: 1 for the +z side, -1 for the other, it mirrors the offsets). It is bolted to the car, so it bounces on the kicks. The scene renders the window with it like any other view.

## v8 kit: the one game world

The source of truth is `treatment.md` v8 ("The game world").

### The world (`_gameWorld.ts`)

`new GameWorld(fonts, { lit?, atlas? })` builds the world: the stem with Station イワシ, the loop (`LOOP_R` 100 m) with ホーム, ？, the tunnel, すのこ and もと, the town, the player's house (`HOUSE`), the mountain, the far hills and a train of two cars. Each scene builds its own instance. The geometry is the same in each one.

- The route coordinate `s` is in metres: `s <= 0` is the stem (x = s), `s > 0` is the loop. `routePoint(s, looped)`, `loopAt(a)`, `carPose(s, looped)` and `carMatrix(s, looped)` are pure functions.
- `world.pose({ cut, wind, ghost, joined })` sets the track. `wind` 0..1 winds the track ahead of the cut onto the loop in `WIND_STEPS` steps: the wound part lies on the loop, the rest stands straight on the tangent at the winding point. The stem never moves. `ghost` gives it the glow of a track in the bend tool's hand. `joined` shows the stations and the poles of the loop. `STRAIGHT` and `LOOPED` are the two rest states.
- `world.placeTrain(s, looped)` puts the two cars on the route. Each car stands on its own bogies, so the train bends at the joint.
- `world.light(view, night, focus, dim?)` sets the light of one view: `'map'` or `'close'`, `night` 0..1 or `'day'`. Call it before each render of the scene. `world.setLamps(on)` repaints the station lamps: call it once.
- `lit: ['iwashi']` keeps the real lights of a station for a close view. The other stations only glow.
- `world.pitGround` is the ground of `PIT`. `_pit.ts` hides it and puts its tiles there.

### The zones and the sinkhole (`_pit.ts`)

`new Pit(world, floorTimes, units)`, `await pit.bake()`, `pit.pose(t, look)`. Towers build down from clouds on `floorTimes`. The hole opens on `units[0]` and grows on each unit (`pit.radius(t)`). The ground tiles tip and drop (a pure function). The towers, the trees and the sheds are Rapier bodies, baked once. The bottom of the pit turns to `look` (the train).

### The map (`ride.ts`, `night.ts`)

- A world that is larger than the frame gives the map its own notches: `MapOpts.notches` (px per metre, far to near). `WORLD_NOTCHES` of `ride.ts` has the whole loop at notch 0.
- The map moves with `zoom` (with `dur`) and `look`: one smooth move. There is no rotate step in act 1.
- The scissors are in the cursor's hand: `ride.ts` puts them on the ground point under the cursor on every frame.
- `DROP`: `{ grab, to, high, side, input }`. `grab` is the screen px of the train roof at the grab (28.000), `to` the px over the balcony at the let-go (28.350), `high` the world point of the grip at the let-go, `side` the screen right as a ground vector, `input` the `carry` input. `day.ts` starts its cursor at `DROP.grab` with the pick-up tool and replays `DROP.input`, so the hand matches across the cut.
- `night.ts` renders the fall of the sardine from the last syllable of line 8. `day.ts` shows it through `ctx.renderClip('chorus_1b')`.

### Home and CRT (pass 1a)

`Home.setGlassCurve(k)` flattens the glass (1 curved, 0 flat). `CrtTube.draw(..., { fit: { weight, exposure } })` writes the picture through the inverse ACES and the engine shoulder so a picture on the glass matches the same picture drawn full frame. `crtFill(home, fov, fit, flat)` is the pose of the push. The chirp (`opening.ts`) uses all three: no crossfade at 7.111.
