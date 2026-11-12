/*
 *  room.js  --  chess frontend
 *	3D Library Room
 *	The desk, CRT monitor & library around the board, from the Blender models (library.glb & library-room.glb, rebuilt as docs/3d-room.md says).
 *	Nothing here is lit by the scene: the game has no shadow maps, so every surface is its tiling detail texture (first UV set) times a light
 *	map baked in Blender (second UV set), which carries the surface's colour, the lamp pools, the fire glow & the shadows.
 *	Loaded after the board is up, it never holds the first frame. Phones get the desk & monitor only
 *
 */

import { Group, MeshBasicMaterial, TextureLoader, SRGBColorSpace, RepeatWrapping } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const ASSETS = `${process.env.CHESS_ASSETS_URL}/images/3d`; // S3 / CLOUDFRONT LIKE THE PIECES, ONLY FETCHED WITH 3D ON
const TIMEOUT_MS = 15000; // LIKE THE PIECE MODELS: A STALLED DOWNLOAD LEAVES THE BAIZE TABLE UP
const PARTS = { // EACH .glb, ITS LIGHT MAP & THE DETAIL TEXTURES ITS MATERIALS ARE NAMED AFTER. THEIR OWN FILES: AN IMAGE INSIDE A .glb LOADS FROM A blob: URL, WHICH THE CSP BLOCKS
	desk: { model: "blend/library.glb", light: "library-light-near.webp", details: ["wood", "plastic", "leather", "cloth"] },
	room: { model: "blend/library-room.glb", light: "library-light-room.webp", details: ["wood", "plastic", "leather", "cloth", "floor", "wallpaper", "books"] },
};
const LIGHT_GAIN = { books: 4 }; // THE BOOKS BAKE AT A FIFTH OF WHITE SO THEY DON'T FLOOD THE ROOM WITH BOUNCE LIGHT (build_library.py HAS THE SAME TABLE)
const SCREEN = "screen"; // THE MONITOR'S GLASS, screen.js DRAWS ON IT

/* ---------------------------------------------------------------- */
// Load
/* ---------------------------------------------------------------- */

const textures = new Map(); // URL -> ITS LOADING OR LOADED TEXTURE: THE DESK & THE ROOM SHARE THE DETAIL TEXTURES

function loadTexture(file, anisotropy, repeat) {
	const url = `${ASSETS}/${file}`;
	if (!textures.has(url)) {
		textures.set(url, new TextureLoader().loadAsync(url).then(function (texture) {
			texture.flipY = false; // glTF UVs START AT THE IMAGE'S TOP
			texture.colorSpace = SRGBColorSpace; // THE LIGHT MAPS ARE STORED AS DISPLAY VALUES TOO, FOR THE DARK END'S SAKE
			texture.anisotropy = anisotropy;
			if (repeat) { texture.wrapS = texture.wrapT = RepeatWrapping; }
			return texture;
		}));
	}
	return textures.get(url);
}

// ONE PART: ITS MODEL WITH A MATERIAL PER DETAIL TEXTURE (THE .glb'S MATERIALS ARE NAMED "wood", "plastic", ...)
async function loadPart({ model, light, details }, anisotropy) {
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const [gltf, lightMap, ...maps] = await Promise.all([loader.loadAsync(`${ASSETS}/${model}`), loadTexture(light, 1, false), ...details.map((name) => loadTexture(`library-${name}.webp`, anisotropy, true))]);
	lightMap.channel = 1; // THE SECOND UV SET
	const materials = {};
	details.forEach(function (name, i) {
		materials[name] = new MeshBasicMaterial({ map: maps[i], lightMap, lightMapIntensity: Math.PI * (LIGHT_GAIN[name] || 1) }); // PI: three.js DIVIDES A LIGHT MAP BY IT
	});
	gltf.scene.traverse(function (o) {
		if (!o.isMesh || o.name === SCREEN) { return; }
		if (!materials[o.material.name]) { throw new Error(`${model}: no detail texture for material "${o.material.name}"`); }
		o.material = materials[o.material.name];
	});
	return gltf.scene;
}

/**
 * @description Downloads the room & builds it. Rejects when a file fails or it takes over TIMEOUT_MS: the caller stays on the baize table
 * @param  {[object]} options { phone (the desk & monitor only), anisotropy (for the detail textures) }
 * @return {[Promise<object>]} { group (add it to the scene, turn it with turnRoom), screen (the monitor's glass mesh) }
 */
export async function createRoom({ phone, anisotropy }) {
	const timeout = new Promise((resolve, reject) => setTimeout(reject, TIMEOUT_MS, new Error("timed out")));
	const parts = await Promise.race([Promise.all((phone ? [PARTS.desk] : [PARTS.desk, PARTS.room]).map((part) => loadPart(part, anisotropy))), timeout]);
	const group = new Group();
	group.add(...parts);
	const screen = group.getObjectByName(SCREEN);
	if (!screen) { throw new Error("library.glb has no screen"); }
	return { group, screen };
}

/**
 * @description Turns the room about the board, so the monitor stays across from the player
 * @param  {[Group]} group [from createRoom]
 * @param  {[number]} angle [radians, 0 for White's side & PI for Black's]
 */
export function turnRoom(group, angle) {
	group.rotation.y = angle;
}

/**
 * @description Forgets the loaded textures, so the next createRoom() loads them again (the board they were made for is gone). Their GPU
 * copies, the geometry & the materials are freed with the scene (three/index.js unmount)
 */
export function disposeRoom() {
	textures.clear();
}
