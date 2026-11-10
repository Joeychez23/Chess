# 3D piece models (#437)

The 3D board's pieces are modelled in Blender and shipped as two files in `images/3d/` on S3 / CloudFront, from the git-ignored `client/src/images/3d/` (the `.glb` in `blend/`):

- `pieces.glb`: the six meshes (`pawn`, `knight`, `bishop`, `rook`, `queen`, `king`), Meshopt compressed. Each has a `wood` primitive and, except the pawn, knight and rook, a `gold` one.
- `pieces.jpg`: the 1024x1024 greyscale atlas with the baked wood grain and ambient occlusion. `maple` and `walnut` tint it, so white and black share it. It's its own file because GLTFLoader loads an image inside a `.glb` from a `blob:` URL, which the CSP blocks.

`pieces.js` loads both once, inside the lazy `three` chunk. If either fails or takes over 15 seconds, the pieces are built from code instead.

## Source

`client/src/images/3d/blend/pieces.blend`, made with Blender 5.2. It holds the meshes, the atlas (packed) and the script that made them, in the text block `build_pieces.py`.

## Rebuild

1. Open `pieces.blend` in Blender 5.2 or newer.
2. In the Scripting workspace, pick `build_pieces.py` and press Run Script. It rebuilds the meshes, re-bakes the atlas and writes `pieces.glb` and `pieces.jpg` next to the `.blend`.
3. Save the `.blend`, then run `npm run build` and check the board with `?perf=1` (`docs/3d-phone-test.md`).

To change a shape, edit its `build_*` function in the script. Keep the base centre at the origin, and the heights the same as in `pieces.js`.

## Settings

Conventions:
- Piece units: base centre at the origin, Blender Z up, the knight facing +X.
- Each object is at the origin when exported, so its node has no transform.

Bake (Cycles, CPU):
- Ambient occlusion: 128 samples, world AO distance 0.28, 14 px margin (Extend).
- Wood grain: an emission bake of the procedural in `bake_material()`.
- Atlas value: `grain * (0.45 + 0.55 * AO)`, stored as sRGB.

`pieces.jpg`: JPEG quality 72, RGB, saved with the Standard view transform (Blender's AgX would darken it).

`pieces.glb`, from `export_scene.gltf`:
- `export_format="GLB"`, `use_selection=True`, `export_yup=True`, `export_apply=False`
- `export_meshopt_compression_enable=True`, `export_meshopt_extension="EXT_meshopt_compression"`
- `export_image_format="NONE"`, `export_materials="EXPORT"`
- `export_texcoords=True`, `export_normals=True`, `export_tangents=False`, `export_attributes=False`
- `export_animations=False`, `export_cameras=False`, `export_lights=False`, `export_skins=False`, `export_morph=False`, `export_extras=False`, `use_mesh_edges=False`, `use_mesh_vertices=False`

## Budgets

- About 1.6 MB for the set, fetched only with 3D on and cached after: `pieces.glb` 624 KB (Meshopt) + the six `pieces-*.webp` atlases 1.0 MB. The atlases are 40% covered (charted unwraps), about 250 texels per square on the colour atlas (the sprites draw 214 px per square), 420 on the pawn.
- About 100k triangles for 32 pieces: 104,068 (pawn 1,600, knight 5,559, bishop 3,319, rook 3,120, queen 7,720, king 7,518). Pawns get the smallest share because there are 16 of them. The round bases are lathed at 40 segments, so their silhouettes stay round.

The Meshopt decoder is WebAssembly, so the page's CSP needs `'wasm-unsafe-eval'` in `script-src` (`server/middleware/securityHeaders.js`).
