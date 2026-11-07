/*
 *  pieces.js  --  chess frontend
 *	3D Pieces
 *	Piece meshes built from code: Lathe for the round pieces, Extrude for the knight's head, each with a blob shadow.
 *	Geometry is in "piece units": 1 = one piece size, base center at the origin, +Y up. Each type's geometry is built
 *	once & shared. Heights: pawn 0.83 < knight 1.16 < bishop 1.20 < rook 1.32 < queen 1.52 < king 1.70
 *
 */

import { MathUtils, LatheGeometry, Vector2, BoxGeometry, TorusGeometry, Shape, ExtrudeGeometry, Mesh, PlaneGeometry, MeshBasicMaterial } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as materials from "./materials.js";

const SEGMENTS = 20; // AROUND THE LATHE, KEEPS 32 PIECES WELL UNDER 50K TRIANGLES

/* ---------------------------------------------------------------- */
// Geometry
/* ---------------------------------------------------------------- */

// POINTS ALONG A CIRCLE ARC FROM a0 TO a1 (DEGREES), AS [r, y] LATHE PROFILE POINTS
function arc(cx, cy, radius, a0, a1, steps) {
	const points = [];
	for (let i = 0; i <= steps; i++) {
		const a = MathUtils.degToRad(a0 + (a1 - a0) * (i / steps));
		points.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
	}
	return points;
}

const lathe = (profile) => new LatheGeometry(profile.map(([r, y]) => new Vector2(Math.max(r, 0), y)), SEGMENTS); // SPIN A [r, y] PROFILE AROUND Y
const box = (w, h, d, x, y, z) => new BoxGeometry(w, h, d).translate(x, y + h / 2, z); // BOTTOM-CENTER AT (x, y, z)
const ring = (r, y) => new TorusGeometry(r, 0.025, 6, SEGMENTS).rotateX(Math.PI / 2).translate(0, y, 0); // GOLD COLLARS & CROWNS
const foot = (r) => [[0, 0], [r, 0], [r, 0.06], [r - 0.05, 0.10], [r - 0.07, 0.14]]; // STEPPED FOOT, ENDS WHERE THE STEM STARTS
const merge = (parts) => mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g));

// BUILDERS RETURN [woodParts, goldParts]: ONE GEOMETRY PER PIECE, GROUP 0 DRAWN IN WOOD & GROUP 1 IN GOLD
function build([wood, gold]) {
	if (gold) { return mergeGeometries([merge(wood), merge(gold)], true); }
	const geometry = merge(wood);
	geometry.addGroup(0, Infinity, 0); // NO GROUPS DRAWS NOTHING UNDER A MATERIAL ARRAY
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
	const outline = [ // HORSE-HEAD SILHOUETTE IN THE XY PLANE, FACING +X
		[0.24, 0.18], [0.18, 0.40], [0.10, 0.56], [0.30, 0.66], [0.34, 0.76], [0.30, 0.86], [0.10, 0.98],
		[0.04, 1.10], [-0.02, 1.12], [-0.08, 1.04], [-0.20, 0.96], [-0.26, 0.70], [-0.24, 0.40], [-0.28, 0.18],
	];
	const depth = 0.18, bevel = 0.03;
	const head = new ExtrudeGeometry(new Shape(outline.map(([x, y]) => new Vector2(x, y))), {
		depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2,
	}).translate(0, 0, -depth / 2); // THE BEVEL DIPS BELOW y = 0.18, HIDDEN INSIDE THE BASE
	return [[base, head]];
}

const builders = { p: pawn, n: knight, b: bishop, r: rook, q: queen, k: king };
const geometries = {}; // BUILT ON FIRST USE, SHARED BY EVERY PIECE OF THAT TYPE (DISPOSING ONLY FREES THE GPU COPY, THE NEXT RENDER RE-UPLOADS IT)

function pieceGeometry(type) {
	if (!builders[type]) { throw new Error(`Bad piece type: ${type}`); }
	return geometries[type] ??= build(builders[type]());
}

/* ---------------------------------------------------------------- */
// Pieces
/* ---------------------------------------------------------------- */

const WOODS = { w: materials.maple, b: materials.walnut };
const SHADOW_Y = 0.015; // WORLD UNITS ABOVE THE BOARD: OVER THE GRID LINES (0.01), UNDER THE HIGHLIGHTS (0.02+)
const SHADOW_OPACITY = 0.85;
const SHADOW_FADE = 1.5; // PIECE UNITS OF LIFT AT WHICH THE SHADOW IS GONE
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
	const mesh = new Mesh(geometry, [WOODS[color], materials.gold]);
	mesh.scale.setScalar(size);
	if (color === "b") { mesh.rotation.y = Math.PI; } // BLACK'S KNIGHTS FACE THE OTHER WAY
	mesh.userData.type = type;
	mesh.userData.color = color;
	if (!geometry.boundingBox) { geometry.computeBoundingBox(); }
	const { min, max } = geometry.boundingBox;
	const width = 1.5 * Math.max(max.x - min.x, max.z - min.z); // A LITTLE WIDER THAN THE FOOT
	const shadow = new Mesh(shadowGeometry, new MeshBasicMaterial({ map: materials.blob, transparent: true, opacity: SHADOW_OPACITY, depthWrite: false })); // OWN MATERIAL SO IT CAN FADE ON ITS OWN
	shadow.scale.set(width, 1, width);
	shadow.renderOrder = -1; // UNDER THE PIECES & HIGHLIGHTS, NO Z-FIGHTING WITH THE BOARD
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
	const lift = mesh.position.y / mesh.scale.y; // IN PIECE UNITS
	shadow.position.y = SHADOW_Y / mesh.scale.y - lift;
	shadow.material.opacity = SHADOW_OPACITY * MathUtils.clamp(1 - Math.max(lift, 0) / SHADOW_FADE, 0, 1) * (mesh.userData.opacity ?? 1);
}

// SEE-THROUGH COPIES OF A PIECE'S WOOD & GOLD (THE RIM SHADER & ITS UNIFORM COME ALONG), SO IT FADES ON ITS OWN
function fadeMaterials(color) {
	return [WOODS[color], materials.gold].map(function (shared) {
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
 * @description Fades a piece & its shadow (captures fading away, the slide home fading pieces in & out). At 1 it's back on the shared, solid materials
 * @param  {[Mesh]} mesh [from createPiece()]
 * @param  {[number]} opacity [0 - 1]
 */
export function setOpacity(mesh, opacity) {
	const { color } = mesh.userData;
	mesh.userData.opacity = opacity;
	if (opacity >= 1) {
		freeFadeMaterials(mesh);
		mesh.material = [WOODS[color], materials.gold];
	} else {
		mesh.userData.fadeMaterials ??= fadeMaterials(color);
		mesh.userData.fadeMaterials.forEach((m) => { m.opacity = opacity; });
		mesh.material = mesh.userData.fadeMaterials;
	}
	mesh.visible = opacity > 0;
	updateShadow(mesh);
}

/**
 * @description Frees a piece's own GPU resources (its shadow material & fade copies). Its geometry & wood are shared, the scene's disposal frees those
 * @param  {[Mesh]} mesh [from createPiece()]
 */
export function disposePiece(mesh) {
	mesh.getObjectByName("shadow").material.dispose();
	freeFadeMaterials(mesh);
}
