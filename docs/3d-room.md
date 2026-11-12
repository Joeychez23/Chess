# 3D library room

With 3D on, the board sits on a desk in a lamp-lit library, and a beige CRT monitor across the board stands in for the opponent. The room is modelled in Blender from one script and shipped under `images/3d/` on S3 / CloudFront, from the git-ignored `client/src/images/3d/`.

The game loads it after the board and pieces are up (`three/room.js`). If a file fails or takes over 15 seconds, the error is reported and the board stays on the green baize table. Phones get the desk and monitor only.

## Files

Models, in `images/3d/blend/` (Meshopt compressed, no images inside, no normals):

- `library.glb` (181 KB): `desk`, `monitor`, `props` (lamp, book stack, cables, jack plate) and `screen`, the monitor's glass.
- `library-room.glb` (410 KB): `room`, everything else as one mesh, and `fire`, the flames in the fireplace and on the candles.

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

The `screen` mesh has no light map. `three/screen.js` draws on a canvas and uses it as the glass's texture. Its UVs fill 0 to 1.

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

- About 36,000 triangles: desk 1,534, monitor 1,702, props 8,408, screen 384, room 20,206, fire 3,776. The pieces are about 104,000.
- About 1.4 MB, fetched only with 3D on and cached after: the two models 591 KB, the three light maps about 250 KB, the detail textures about 570 KB. Phones fetch about 700 KB of it.
- Detail textures: wood 85 texels per unit, plastic and cloth 128, leather 85, floor 32, wallpaper 32, books 25 across and 17 up. The pieces' colour atlas is about 83.
- Light maps: 11.9 texels per unit on the desk top, monitor and props, 3.6 under the desk, 3.8 on the furniture, 2.4 on the floor and fireplace, about 1.2 on the walls, shelves and books.
- Round parts near the camera have 40 segments (the monitor's foot, the lamp's base), the cables 12 sides.
