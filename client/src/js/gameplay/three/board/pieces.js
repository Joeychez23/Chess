/*
 *  pieces.js  --  chess frontend
 *	3D Pieces
 *	Piece meshes from the Blender models (pieces.glb, rebuilt as docs/3d-pieces.md says), each with a blob shadow. If those can't
 *	load, the same pieces are built from code: Lathe for the round pieces, Extrude for the knight's head.
 *	Geometry is in "piece units": 1 = one piece size, base center at the origin, +Y up. Each type's geometry is made
 *	once & shared. Heights: pawn 0.83 < knight 1.16 < bishop 1.20 < rook 1.32 < queen 1.52 < king 1.70
 *
 */

import {
	MathUtils, LatheGeometry, Vector2, BoxGeometry, TorusGeometry, Shape, ExtrudeGeometry, Mesh, PlaneGeometry, MeshBasicMaterial,
	TextureLoader, SRGBColorSpace
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as materials from "../materials.js";

// Segments around a lathe: keeps the 32 pieces well under 50k triangles.
const SEGMENTS = 20;

/* ---------------------------------------------------------------- */
// Geometry
/* ---------------------------------------------------------------- */

// Points along a circle arc from a0 to a1 (degrees), as [r, y] lathe profile points.
function arc(cx, cy, radius, a0, a1, steps) {
	const points = [];
	for (let i = 0; i <= steps; i++) {
		const a = MathUtils.degToRad(a0 + (a1 - a0) * (i / steps));
		points.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
	}
	return points;
}

// Spins an [r, y] profile around the Y axis.
const lathe = (profile) => new LatheGeometry(profile.map(([r, y]) => new Vector2(Math.max(r, 0), y)), SEGMENTS);
// A box with its bottom center at (x, y, z).
const box = (w, h, d, x, y, z) => new BoxGeometry(w, h, d).translate(x, y + h / 2, z);
// The gold collars and crowns.
const ring = (r, y) => new TorusGeometry(r, 0.025, 6, SEGMENTS).rotateX(Math.PI / 2).translate(0, y, 0);
// A stepped foot that ends where the stem starts.
const foot = (r) => [[0, 0], [r, 0], [r, 0.06], [r - 0.05, 0.10], [r - 0.07, 0.14]];
const merge = (parts) => mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g));

// The builders return [woodParts, goldParts]. Each piece becomes one geometry: group 0 is drawn in wood and group 1 in gold.
function build([wood, gold]) {
	if (gold) { return mergeGeometries([merge(wood), merge(gold)], true); }
	const geometry = merge(wood);
	// A geometry with no groups draws nothing under a material array.
	geometry.addGroup(0, Infinity, 0);
	return geometry;
}

function pawn() {
	return [[lathe([
		...foot(0.34), [0.18, 0.18], [0.13, 0.42], [0.20, 0.46], [0.20, 0.48], [0.11, 0.52],
		...arc(0, 0.66, 0.17, -55, 90, 8),
	])]];
}

function bishop() {
	return [[lathe([
		...foot(0.38), [0.20, 0.22], [0.13, 0.60], [0.21, 0.64], [0.21, 0.67], [0.12, 0.70],
		[0.16, 0.78], [0.17, 0.88], [0.14, 0.97], [0.09, 1.04], [0.04, 1.09],
		...arc(0, 1.15, 0.05, -60, 90, 5),
	])], [ring(0.21, 0.655)]];
}

function rook() {
	const body = lathe([
		...foot(0.40), [0.24, 0.24], [0.21, 0.80], [0.28, 0.86], [0.28, 1.12], [0.20, 1.12], [0.20, 1.04], [0, 1.04],
	]);
	const merlins = [0, 1, 2, 3].map((i) => box(0.11, 0.20, 0.08, 0, 1.12, 0.24).rotateY(i * Math.PI / 2 + Math.PI / 4));
	return [[body, ...merlins]];
}

function queen() {
	return [[lathe([
		...foot(0.42), [0.22, 0.26], [0.14, 0.95], [0.24, 1.00], [0.24, 1.03], [0.15, 1.07],
		[0.19, 1.20], [0.25, 1.36], [0.22, 1.39], [0.08, 1.38],
		...arc(0, 1.44, 0.08, -50, 90, 6),
	])], [ring(0.24, 1.015), ring(0.235, 1.375)]];
}

function king() {
	const body = lathe([
		...foot(0.43), [0.23, 0.27], [0.15, 1.00], [0.25, 1.05], [0.25, 1.08], [0.16, 1.12],
		[0.20, 1.30], [0.22, 1.40], [0.14, 1.44], [0.06, 1.46], [0, 1.46],
	]);
	return [[body], [ring(0.25, 1.065), box(0.07, 0.24, 0.07, 0, 1.46, 0), box(0.18, 0.06, 0.07, 0, 1.56, 0)]];
}

function knight() {
	const base = lathe([...foot(0.40), [0.30, 0.17], [0.28, 0.20], [0, 0.20]]);
	// The horse-head silhouette in the XY plane, facing +X.
	const outline = [
		[0.24, 0.18], [0.18, 0.40], [0.10, 0.56], [0.30, 0.66], [0.34, 0.76], [0.30, 0.86], [0.10, 0.98],
		[0.04, 1.10], [-0.02, 1.12], [-0.08, 1.04], [-0.20, 0.96], [-0.26, 0.70], [-0.24, 0.40], [-0.28, 0.18],
	];
	const depth = 0.18, bevel = 0.03;
	// Centered on its depth. The bevel dips below y = 0.18, where the base hides it.
	const head = new ExtrudeGeometry(new Shape(outline.map(([x, y]) => new Vector2(x, y))), {
		depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2,
	}).translate(0, 0, -depth / 2);
	return [[base, head]];
}

const builders = { p: pawn, n: knight, b: bishop, r: rook, q: queen, k: king };
// Made on first use and shared by every piece of that type. Disposing one only frees the GPU copy; the next render uploads it again.
const geometries = {};

/* ---------------------------------------------------------------- */
// Blender models
/* ---------------------------------------------------------------- */

// Served from S3 / CloudFront, like the sprites.
const ASSETS = `${process.env.CHESS_ASSETS_URL}/images/3d`;
// Only fetched with 3D on.
const MODEL_URL = `${ASSETS}/blend/pieces.glb`;
// Baked from the 2D pieces' shaders. They are files of their own because an image inside the .glb loads from a blob: URL,
// which the CSP blocks.
const ATLAS_URLS = [
	`${ASSETS}/pieces-w.webp`,
	`${ASSETS}/pieces-b.webp`,
	`${ASSETS}/pieces-rm-w.webp`,
	`${ASSETS}/pieces-rm-b.webp`,
	`${ASSETS}/pieces-n.webp`,
	`${ASSETS}/pieces-l.webp`,
];
// A stalled download shouldn't leave "Loading 3D board..." up forever.
const MODEL_TIMEOUT_MS = 15000;
// Turns the .glb knight's nose onto +X (measured from the head's long axis in XZ).
const KNIGHT_TWIST = 13.5 * Math.PI / 180;
const MODEL_NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

// One geometry per piece, like build(): group 0 is drawn in wood and group 1 in gold.
// The glTF has one primitive per material, and each loads as a mesh of its own, so they are merged here.
function modelGeometry(scene, name) {
	const meshes = [];
	scene.getObjectByName(name).traverse((o) => { if (o.isMesh) { meshes.push(o); } });
	meshes.sort((a, b) => (a.material.name === "gold") - (b.material.name === "gold"));
	if (meshes.length > 1) { return mergeGeometries(meshes.map((m) => m.geometry), true); }
	meshes[0].geometry.addGroup(0, Infinity, 0);
	return meshes[0].geometry;
}

function loadAtlas(url) {
	return new TextureLoader().loadAsync(url).then(function (atlas) {
		// glTF UVs start at the image's top.
		atlas.flipY = false;
		atlas.anisotropy = 4;
		return atlas;
	});
}

/**
 * @description Downloads the Blender models & their atlases
 * @return {[Promise<object>]} [{ models: geometry by piece type, atlasMaterials: by color }, both empty when they couldn't load:
 * the pieces are built from code instead]
 */
async function loadModels() {
	try {
		const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
		const timeout = new Promise((resolve, reject) => setTimeout(reject, MODEL_TIMEOUT_MS, new Error("timed out")));
		const [gltf, ...atlases] = await Promise.race([Promise.all([loader.loadAsync(MODEL_URL), ...ATLAS_URLS.map(loadAtlas)]), timeout]);
		const [colorW, colorB, roughMetalW, roughMetalB, normal, light] = atlases;
		colorW.colorSpace = colorB.colorSpace = SRGBColorSpace;
		const models = {};
		for (const [type, name] of Object.entries(MODEL_NAMES)) {
			// A piece that is not in the .glb yet is built from code.
			if (gltf.scene.getObjectByName(name)) { models[type] = modelGeometry(gltf.scene, name); }
		}
		// The baked head points about 13.5 degrees off +X, so knights facing each other looked past each other.
		if (models.n) { models.n.rotateY(KNIGHT_TWIST); }
		const atlasMaterials = {
			w: materials.atlasMaterial({ color: colorW, roughMetal: roughMetalW, normal, light }),
			b: materials.atlasMaterial({ color: colorB, roughMetal: roughMetalB, normal, light })
		};
		return { models, atlasMaterials };
	} catch (error) {
		console.warn("3D pieces: the Blender models didn't load, building them from code", error);
		return { models: {}, atlasMaterials: {} };
	}
}

// Loaded once, in the lazy "three" chunk: load3D()'s import() waits for it, so createPiece() stays synchronous.
const { models, atlasMaterials } = await loadModels();

function pieceGeometry(type) {
	if (!builders[type]) { throw new Error(`Bad piece type: ${type}`); }
	return geometries[type] ??= models[type] ?? build(builders[type]());
}

/* ---------------------------------------------------------------- */
// Pieces
/* ---------------------------------------------------------------- */

const WOODS = { w: materials.maple, b: materials.walnut };
// A piece's atlas material, or wood and gold when it is built from code.
const pieceMaterials = (type, color) => (models[type] ? [atlasMaterials[color]] : [WOODS[color], materials.gold]);
// World units above the board: over the grid lines (0.01), under the highlights (0.02 and up).
const SHADOW_Y = 0.015;
const SHADOW_OPACITY = 0.85;
// The lift, in piece units, at which the shadow is gone.
const SHADOW_FADE = 1.5;
// The tilt of a toppling piece (rotation.z, see three/board/motion.js) at which its shadow is gone. The disc turns with the piece,
// so past this it would stand up off the board.
const SHADOW_TIP = Math.PI / 8;
const shadowGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/**
 * @description Makes a piece mesh with its blob shadow (a soft dark disc, no shadow maps)
 * @param  {[string]} type ["p", "n", "b", "r", "q" or "k", chess.js letters]
 * @param  {[string]} color ["w" or "b"]
 * @param  {[number]} size [world units per piece unit]
 * @return {[Mesh]}
 */
export function createPiece(type, color, size) {
	if (!WOODS[color]) { throw new Error(`Bad piece color: ${color}`); }
	const geometry = pieceGeometry(type);
	const mesh = new Mesh(geometry, pieceMaterials(type, color));
	mesh.scale.setScalar(size);
	// Each side faces the other. Fronts are built facing +Z (towards white's camera), and the knight's nose along +X.
	mesh.rotation.y = (color === "w" ? Math.PI : 0) - (type === "n" ? Math.PI / 2 : 0);
	mesh.userData.type = type;
	mesh.userData.color = color;
	if (!geometry.boundingBox) { geometry.computeBoundingBox(); }
	const { min, max } = geometry.boundingBox;
	// A little wider than the foot.
	const width = 1.5 * Math.max(max.x - min.x, max.z - min.z);
	// Its own material, so each shadow can fade on its own.
	const shadow = new Mesh(shadowGeometry, new MeshBasicMaterial({
		map: materials.blob, transparent: true, opacity: SHADOW_OPACITY, depthWrite: false
	}));
	shadow.scale.set(width, 1, width);
	// Drawn under the pieces and highlights, with no z-fighting against the board.
	shadow.renderOrder = -1;
	shadow.name = "shadow";
	mesh.add(shadow);
	updateShadow(mesh);
	return mesh;
}

/**
 * @description Keeps a piece's shadow on the board while it's lifted, fading it with height. Call after moving it
 * @param  {[Mesh]} mesh [from createPiece()]
 */
export function updateShadow(mesh) {
	const shadow = mesh.getObjectByName("shadow");
	// In piece units.
	const lift = mesh.position.y / mesh.scale.y;
	shadow.position.y = SHADOW_Y / mesh.scale.y - lift;
	shadow.material.opacity = SHADOW_OPACITY *
		MathUtils.clamp(1 - Math.max(lift, 0) / SHADOW_FADE, 0, 1) *
		MathUtils.clamp(1 - Math.abs(mesh.rotation.z) / SHADOW_TIP, 0, 1) *
		(mesh.userData.opacity ?? 1);
}

// See-through copies of a piece's materials, so it fades on its own. The shader patch and uniforms are carried over to the copies.
function fadeMaterials(type, color) {
	return pieceMaterials(type, color).map(function (shared) {
		const m = shared.clone();
		m.onBeforeCompile = shared.onBeforeCompile;
		m.userData = shared.userData;
		m.transparent = true;
		return m;
	});
}

function freeFadeMaterials(mesh) {
	if (!mesh.userData.fadeMaterials) { return; }
	mesh.userData.fadeMaterials.forEach((m) => m.dispose());
	mesh.userData.fadeMaterials = null;
}

/**
 * @description Fades a piece & its shadow (captures fading away, the slide home fading pieces in & out).
 * At 1 it's back on the shared, solid materials
 * @param  {[Mesh]} mesh [from createPiece()]
 * @param  {[number]} opacity [0 - 1]
 */
export function setOpacity(mesh, opacity) {
	const { type, color } = mesh.userData;
	mesh.userData.opacity = opacity;
	if (opacity >= 1) {
		freeFadeMaterials(mesh);
		mesh.material = pieceMaterials(type, color);
	} else {
		mesh.userData.fadeMaterials ??= fadeMaterials(type, color);
		mesh.userData.fadeMaterials.forEach((m) => { m.opacity = opacity; });
		mesh.material = mesh.userData.fadeMaterials;
	}
	mesh.visible = opacity > 0;
	updateShadow(mesh);
}

/**
 * @description Frees a piece's own GPU resources (its shadow material & fade copies).
 * Its geometry & wood are shared, the scene's disposal frees those
 * @param  {[Mesh]} mesh [from createPiece()]
 */
export function disposePiece(mesh) {
	mesh.getObjectByName("shadow").material.dispose();
	freeFadeMaterials(mesh);
	// Its status effects go with it (statusFx/index.js sets this hook).
	mesh.userData.disposeStatuses?.();
}
