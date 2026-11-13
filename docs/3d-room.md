# 3D library room

With 3D on, the board sits on a desk in a lamp-lit library, and a beige CRT monitor across the board stands in for the opponent. The room is modelled in Blender from one script and shipped under `images/3d/` on S3 / CloudFront, from the git-ignored `client/src/images/3d/`.

The game loads it after the board and pieces are up (`three/room.js`). If a file fails or takes over 15 seconds, the error is reported and the board stays on the green baize table. Phones get the desk and monitor only.

## Files

Models, in `images/3d/blend/` (Meshopt compressed, no images inside, no normals):

- `library.glb` (181 KB): `desk`, `monitor`, `props` (lamp, book stack, cables, jack plate) and `screen`, the monitor's glass.
- `library-room.glb` (412 KB): `room`, everything else as one mesh, `fire`, the flames in the fireplace and on the candles, and `clockHour`, `clockMinute` and `clockPendulum`, the longcase clock's moving parts (see The clock).

Textures, in `images/3d/`:

- `library-light-near.webp` and `library-light-room.webp`: the two baked light maps, 2048 px each.
- `library-light-fire.webp`: the fire's light on the room, on the room light map's UVs (see The fire).
- `library-wood.webp`, `library-plastic.webp`, `library-leather.webp`, `library-cloth.webp`, `library-floor.webp`, `library-wallpaper.webp`, `library-books.webp`: the tiling detail textures.

Phones download `library.glb`, the near light map and the wood, plastic, leather and cloth textures.

## How a surface is drawn

The game has no shadow maps, so nothing in the room is lit by the scene. Each surface is a `MeshBasicMaterial`:

- `map`: a tiling detail texture on the first UV set (`detail`). The material's name in the `.glb` (`wood`, `plastic`, ...) picks the texture.
- `lightMap`: the baked light map on the second UV set (`light`). It holds the surface's colour times the light that falls on it, so the lamp pools and every shadow are in it.

The result is detail times light map. The detail carries the sharpness and the light map carries the colour, so one grey wood texture serves the desk, the shelves and the clock.

Two things to know:

- three.js divides a light map by pi, so `room.js` sets `lightMapIntensity` to pi.
- The books bake at a fifth of white, so they don't flood the room with bounce light. `room.js` multiplies them back by 4 (`LIGHT_GAIN`). `build_library.py` has the same table.

## The fire

The fire moves (`three/fire.js`), so its light is kept out of the room's light map:

- `library-light-room.webp` is the room with the fire out. `library-light-fire.webp` is what the fire adds, on the same UVs. `room.js` patches the room's materials to draw detail times (room + fire x glow), and `fire.js` changes the glow every frame, around 1. At 1 the room is the whole bake.
- The desk, monitor and props keep their share of the firelight in `library-light-near.webp`, where it doesn't flicker.
- The `fire` mesh is the flames in the fireplace and on the two candles. It has no light map and one UV set that isn't a texture's: u is 4 times the flame's number plus its kind (0 a flame, 1 its bright core, 2 a candle's), and v runs from 1 at the base to 0 at the tip. The vertex shader sways each flame by them and the fragment shader colours it, added to what's behind.
- The embers are 40 points made in `fire.js`. They start among the fireplace's flames, which it finds from the `fire` mesh.

The board only draws when something changes, so while the fire is up a timer asks for 30 frames a second. It stops while the tab is hidden or the WebGL context is lost. With reduced motion the fire is still and at its baked brightness. Phones have no fireplace, so none of this runs there.

## The clock

The longcase clock on the south wall shows the viewer's local time like a real one (`three/clock.js`): it has no second hand, the hour and minute hands step on each tick, once a second, and the pendulum swings, reaching the end of its swing on each tick.

- Each hand is its own object, built pointing at 12 with its origin on the dial's centre, so turning it about its own z turns it on the dial. The dial faces the room's -z, so a positive turn is clockwise as it's seen. The pendulum (rod and bob, in front of the trunk's dark glass) hangs straight down from its origin at the window's top and swings 3 degrees each way, once every 2 seconds.
- The moving parts are left out of the bake (`hide_render`), so they leave no shadow behind, and have no light map. `clock.js` draws the hands near-black and the pendulum one brass colour. The brass cap over the hands' centre is baked into `room`.
- They're set from `Date` before every draw, so the clock is right again as soon as a hidden tab comes back. While the room is up a timer asks for 30 frames a second for the swing. With reduced motion the pendulum hangs still and the timer asks once a second, for the tick. It stops while the tab is hidden or the WebGL context is lost. Phones have no room, so no clock.

## The paintings

The four frames hold `painting1.jpg` to `painting4.jpg` from `images/3d/`: 1 over the mantel, then 2, 3 and 4 along the south wall, going left from the fireplace (west to east). Each canvas is a material of its own (`painting1` to `painting4`) with UVs filling 0 to 1, and `room.js` uses the picture as its detail texture instead of a tiling one. The canvases bake as a pale grey, so their light map carries only the light. `build_library.py` sizes each frame to its picture's shape, so a new painting with a different shape needs the room rebuilt and rebaked.

## The globe

The globe in the north-east corner is a sphere whose UVs are an equirectangular map's (longitude across, latitude up), material `earth`, and `room.js` draws `earth.jpg` from `images/3d/` on it the same way as a painting. The map is NASA's Blue Marble (public domain), brightened so the oceans show in the dim room. `build_library.py` turns the sphere so the Atlantic faces the room.

## The monitor

The `screen` mesh has no light map. `three/screen.js` draws on a canvas and uses it as the glass's texture. Its UVs fill 0 to 1. Everything on it is drawn on a 160 x 120 grid with `three/pixelFont.js`: there is no DOM button layer, so hit testing, focus and screen reader text are our code.

The monitor is also the game's menu in 3D. On the desk it shows one channel and has no controls. A click or tap on the glass (a pen counts as a finger; or the menu's **Monitor** item) eases the camera over 400 ms to a spot square to the glass, where it fills about 80% of the view. While zoomed, orbiting and board clicks are off and the game keeps running. Esc (during the zoom in too), `◀ BACK`, a click off the glass or the menu button go back to the desk; the menu button then opens the menu. Reduced motion cuts instead of easing, with no static between channels and no blinking.

Channels, in tab order (`face`, `opponent`, `eval`, `moves`, `waiting`, `actions`, `setup`):

- **Face:** bot games only, the pixel face below.
- **Opponent:** the name and status card. Zoomed with a picture, the name and status sit on a dark plate along the bottom (the page's name is hidden meanwhile). A friend's card reads "WAITING FOR OPPONENT" on their turn.
- **Eval:** White's win chance as a number, a bar and a graph by move, from the eval bar's request. It asks only while this channel shows or the bar is on. A failed request shows "NO SIGNAL" and tries again on the next move.
- **Moves:** the opening and the move list (a long opening is cut at a whole word, with "…"; accents are dropped). UP/DOWN scroll, LIVE goes back to the newest, and DOWN onto the newest row follows new moves again.
- **Waiting:** "THINKING" or "WAITING FOR OPPONENT" over an idle screen (test card, starfield or pipes; under reduced motion the pipes are a still picture).
- **Actions:** Hint, Takeback, Offer Draw or Accept Draw (with an on-screen "SURE?" over YES / NO); after the game, the result (on two lines when it is long), Restart and Download PGN.
- **Setup:** a toggle per channel, the default channel and the idle screen. The face and Setup can't be turned off.

Keys on the desk: the screen is a stop for the page's Left and Right (and A and D), always the leftmost stop (`#monitorStop`, a screen-reader-only button; Tab reaches it too). Left from the menu button goes through the page's stops as in 2D (the type-move box when it's open), then the screen, and Left from the screen wraps back to the menu button (Right goes the other way). The focused screen shows the border a mouse hover shows (on the face channel too), Enter or Space zooms in and Esc drops the focus: nothing has it until the next arrow, or Enter, which focuses the menu button. Zooming out gives the focus back to the stop. The stop is hidden on 2D, in TV mode and with reduced motion.

Keys while zoomed (Esc while zooming in too): W/A/S/D or the arrow keys move the focus (A/D or Left/Right on the tab row change channel), Enter or Space presses, Esc zooms out. On the moves channel, while the focus is on UP, DOWN or LIVE, W scrolls one row up and S one row down; W with the list already at the top moves the focus to the tab row (the showing tab), S at the bottom does nothing, and A/D still move between the buttons. From the tab row, S goes into the buttons as on any channel. The up and down arrows do the same as W and S. A channel takes keys like this through an optional `keys(action, data, handlers)` export, so `monitor.js` has no moves special case.

The only banner is "▶ YOUR MOVE", from the update where it becomes your turn: a dark plate with a 1 px outline in the body's top-right corner, covering what is under it, blinking (steady under reduced motion). It isn't drawn on the SETUP channel, where it would cover the Face row's buttons (it is still announced). A game that ends during the zoom-in is shown on arrival, the same as one that ends while zoomed. There is no result banner: when the game ends while zoomed, the monitor switches to the actions channel (the result, Restart, Download PGN) with the focus on its first enabled button and says the result. With the actions channel turned off it stays where it is and only says the result.

Screen readers: zooming in moves the focus to a visually hidden `#monitorFocus` (`role="application"`, labelled "Monitor", described by `#monitorAnnouncement`), so a screen reader passes W/A/S/D, Enter and Space on to the page; back on the desk the focus returns to what had it, else the menu button. The visually hidden `#monitorAnnouncement` (`role="status"`) reads "<Name> channel. <what it shows>" on arriving and on each channel change, what the channel shows again when that changes (a new move, a new score: once per change), the focused button and the "YOUR MOVE" banner. Each channel says what it shows through an optional `speak(data)` export. Texts said together are written as one, after the region is emptied, so none overwrites another and a repeated one is read again.

Who owns what:

| File | What it does |
| --- | --- |
| `three/monitor/monitor.js` | The state (`idle`, `zooming`, `zoomed`, `leaving`), the active channel, focus, keys, pointer hits and the zoom maths. No DOM or three.js |
| `three/monitor/channels/*.js` | One file per channel: `draw(ctx, data)`, `buttons(data)`, `press(id, handlers, data)`, optional `tick(data)`, `speak(data)` and `keys(action, data, handlers)` |
| `three/monitor/prefs.js` | The only code that reads or writes the settings |
| `three/screen.js` | Draws the active channel on the glass |
| `three/index.js` | The camera move, glass hits, turning orbit and board input off while zoomed; `setMonitor()`, `enterMonitor()`, `leaveMonitor()`, `monitorState()` |
| `gameplay/renderer/index.js` | Passes the hooks to every 3D board (`setMonitorHooks`) and sends the data when its JSON changed (`syncMonitor3D()` in `drawBoard`) |
| `gameplay/monitor/index.js` | The data (`monitorData()`), the actions, the screen reader line, the focus while zoomed (`#monitorFocus`) and the hide rules. `data.js` is its pure part (`actionsFrom`, `resultText`, `trimScores`, `plyOf`, `startPlyFor`), tested in `client/test/monitorData.test.js` |

The actions press the menu's own buttons (`optHint`, `optTakeback`, `optDraw`, `optRestart`, `optPgn`), so the menu's rules still decide everything: an action is shown when its menu `<li>` isn't `hidden`, and enabled unless the button is `aria-disabled` or busy (`.loading`). A `MutationObserver` on those items and the result title redraws the monitor when one changes. The eval channel's scores are kept by ply in `gameplay/analysis` (`evalState()`, `watchEval(on)`); a takeback or a new game drops the ones past the board. The moves come from `moveListState()` in `gameplay/movelist`. A game that ends while zoomed shows its result on the monitor's actions channel and the menu stays shut.

**Hide rules.** While the room and monitor are up and reduced motion is off, the page's eval bar, move list, `#openingDisplay` and `#opponentDisplay`, and the menu's Hint, Takeback, Offer Draw and Eval Bar items get `data-on-monitor` (`display: none` in `style.css`; the arrow keys and the TV remote skip them, `menuItems()` in `pages/utils/nav.js`), and the menu's Monitor item (`optMonitor`) shows. A bar saved on (`EVAL_BAR`) counts as off meanwhile (`hideEvalBar()` in `gameplay/analysis`): no request unless the eval channel shows. The saved setting doesn't change. Their `hidden` attributes stay the menu code's. On 2D, with reduced motion, or when the room or monitor didn't load (failed or slower than 15 seconds), everything is as before and the Monitor item is hidden. A lost GPU context while zoomed goes back to the desk, and the glass and the Monitor item do nothing until the board is rebuilt.

**Settings** are kept in localStorage under `MONITOR`: `{ "version": 1, "defaultChannel": null, "enabled": ["face", ...], "idle": "card" }`. `defaultChannel: null` means the face against a bot, the opponent card against a friend. Broken JSON, another version, unknown ids or blocked storage give the defaults (every channel on).

**Checking it.** Nothing covers the drawing, so look at it in the harness: `room-shot.mjs` takes `tapGlass()` (finds the glass by the hand cursor and taps its middle), `tapAt(x, y)` and `key(k)` steps, separated by `;;`, e.g. `node room-shot.mjs zoomed.png "tapGlass();;key(d)"`. Shoot zoomed in, a channel change, `key(Escape)` (the camera back where it was) and a phone-sized window.

## Source

- `client/src/images/3d/blend/library.blend`, made with Blender 5.2: the meshes with their tint materials, the lights and both UV sets.
- `client/src/images/_ideas/generator/build_library.py`: builds everything from code. It is git-ignored like the rest of the generator folder.

## Rebuild

From `client/src/images/_ideas/generator/`:

```bash
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
$BLENDER -b --factory-startup -P build_library.py -- model textures uv bake export
```

The stages, which can be run one or several at a time:

| Stage | What it does |
| --- | --- |
| `model` | Builds every object from code and saves `library.blend`. Without it, the script opens the saved file. |
| `preview` | Renders check pictures of the lit models to `bake-out/library/preview-*.png`. `views=opening,close` picks the views. |
| `textures` | Writes the seven detail textures. |
| `uv` | Unwraps the light map UVs for both atlases and prints each object's texel density. The same model gives the same UVs, so a change to the flames alone needs no new bake. |
| `bake` | Bakes the light maps in Cycles and writes them: the near atlas once, the room atlas twice (with the fire out, then the fire's light alone). `samples=64` sets the samples, `atlas=near` bakes one atlas. About 4 minutes for the near atlas and 6 for the room's two bakes on an M1. |
| `tone` | Re-makes the light maps from the saved raw bakes (`bake-out/library/light-*.exr`) without baking. `exposure=1.2` changes the brightness. |
| `game` | Renders the baked result the way the game draws it, to `bake-out/library/game-*.png`. |
| `export` | Joins the objects, swaps the tint materials for one per detail texture and writes the two `.glb` files. The flames stay their own `fire` object. |

Then check it in the real board without uploading: `node serve.mjs` and `node room-shot.mjs <out.png>` in the same folder load `three/index.js` with the files in `client/src`. After that, upload the new files (`deploy/upload-assets.sh`).

To change a shape, edit its `build_*` function. To add a surface colour, add a `"detail:tint"` entry to `COLOURS`.

## Settings

Conventions:

- Blender is Z up with the board's top at z = 0 and White's player at -Y. The game's (x, y, z) is Blender's (x, z, -y).
- The desk top is at z = -0.76, where the baize plane was.
- The monitor's front is at y = 19, tilted back 0.12 radians. Its glass is 13.6 x 10.2 units (4:3).
- The script's random numbers are seeded, so a rebuild gives the same room and the same UV layout.

Bake (Cycles, CPU, 64 samples, denoised):

- `COMBINED` with the emit, direct, indirect and diffuse passes. No glossy pass: highlights would move with the camera.
- 8 px margin, extended.
- The raw bake is scaled by `EXPOSURE`, eased toward 1 above 0.6 keeping the hue, and stored as sRGB.
- The fire's map is the eased lit room less the eased room with the fire out, so the two add back up to the whole bake.
- It runs on the CPU, because the GPU (Metal) hung in background mode on the build machine. `LIB_DEVICE=GPU` tries the GPU.
- The board and its frame are in the scene as a stand-in (`occluder`), so they shade the desk. The stand-in isn't exported.

Export, from `export_scene.gltf`: the settings in `docs/3d-pieces.md`, with `export_normals=False` (nothing is lit, so normals aren't used).

## Budgets

- About 36,000 triangles: desk 1,534, monitor 1,702, props 8,408, screen 384, room 20,122, fire 3,776, clock 156. The pieces are about 104,000.
- About 1.4 MB, fetched only with 3D on and cached after: the two models 591 KB, the three light maps about 250 KB, the detail textures about 570 KB. Phones fetch about 700 KB of it.
- Detail textures: wood 85 texels per unit, plastic and cloth 128, leather 85, floor 32, wallpaper 32, books 25 across and 17 up. The pieces' colour atlas is about 83.
- Light maps: 11.9 texels per unit on the desk top, monitor and props, 3.6 under the desk, 3.8 on the furniture, 2.4 on the floor and fireplace, about 1.2 on the walls, shelves and books.
- Round parts near the camera have 40 segments (the monitor's foot, the lamp's base), the cables 12 sides.
