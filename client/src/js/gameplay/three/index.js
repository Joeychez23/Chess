/*
 *  index.js  --  chess frontend
 *	3D Board
 *	The three.js board. Never imported statically: load.js pulls it in with import() when the player turns 3D on, so webpack
 *	puts it & three.js in their own "three" chunk & 2D players never download them. Named imports only, so the rest of
 *	three.js is tree-shaken out. It knows no chess rules & no socket: it only draws what it's told & reports squares.
 *	The board lies in the XZ plane centered on the origin, a1 bottom-left from White's side (+Z faces the camera)
 *
 */

import {
	WebGLRenderer, Scene, PerspectiveCamera, Color, Fog, HemisphereLight, DirectionalLight, PlaneGeometry, MeshStandardMaterial,
	MeshBasicMaterial, Mesh, TextureLoader, SRGBColorSpace, LinearMipmapLinearFilter, GridHelper, Raycaster, Vector2, MathUtils
} from "three";
import { createPiece, updateShadow, disposePiece } from "./pieces.js";
import { createSurroundings } from "./board.js";
import { BAIZE_FOG } from "./materials.js";

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const BOARD_SIZE = 24; // WORLD UNITS PER BOARD SIDE
const CELL_SIZE = BOARD_SIZE / 8;
const PIECE_SIZE = CELL_SIZE * 0.8; // ONE PIECE UNIT (pieces.js), BASES LEAVE A GAP INSIDE THE SQUARE
const FILES = "abcdefgh";
const SLIDE_MS_PER_SQUARE = 263; // SAME SPEED AS THE 2D BOARD (animate/index.js)
const HOP_HEIGHT = CELL_SIZE * 0.6; // HOW HIGH A KNIGHT HOPS
const BOARD_IMAGE = new URL("./board.jpg", import.meta.url).href; // JUST THE 8x8 SQUARES, BUNDLED (NOT S3: images/ IS GITIGNORED) & ONLY FETCHED WITH 3D ON
const HIGHLIGHTS = { // highlight() KINDS: [color, opacity], LATER KINDS DRAW ON TOP
	last: [0xE8792B, 0.3],
	legal: [0xFFEA00, 0.35],
	capture: [0xFF3B30, 0.45],
	hint: [0x55C8FF, 0.45],
	check: [0xFF0000, 0.55],
};

let view = null; // EVERYTHING ONE mount() MADE, null WHEN UNMOUNTED
const raycaster = new Raycaster();
const pointer = new Vector2(); // NORMALIZED DEVICE COORDS (-1..1)

/* ---------------------------------------------------------------- */
// Squares
/* ---------------------------------------------------------------- */

const fileOf = (square) => FILES.indexOf(square[0]); // 0 - 7, a - h
const rowOf = (square) => 8 - Number(square[1]); // 0 - 7, RANK 8 - RANK 1 (chess.js board() ORDER)
const center = (i) => -BOARD_SIZE / 2 + CELL_SIZE * (i + 0.5); // GRID INDEX -> WORLD COORDINATE OF THAT SQUARE'S CENTER
const toCell = (v) => MathUtils.clamp(Math.floor((v + BOARD_SIZE / 2) / CELL_SIZE), 0, 7);

// PUTS A MESH ON A SQUARE, BOTH IN view.pieces & IN THE SCENE
function place(mesh, square) {
	view.pieces.set(square, mesh);
	mesh.userData.square = square;
	mesh.position.set(center(fileOf(square)), 0, center(rowOf(square)));
	updateShadow(mesh);
}

function addPiece(type, color) {
	const mesh = createPiece(type, color, PIECE_SIZE);
	view.scene.add(mesh);
	return mesh;
}

function removePiece(mesh) {
	view.scene.remove(mesh);
	disposePiece(mesh);
}

/* ---------------------------------------------------------------- */
// Mount
/* ---------------------------------------------------------------- */

// MATCHES THE DRAWING BUFFER & CAMERA TO THE CONTAINER, PIXEL DENSITY CAPPED AT 2 SO 3x PHONES DON'T DRAW 9x THE PIXELS
function resize() {
	const { renderer, camera, container } = view;
	const w = container.clientWidth, h = container.clientHeight;
	if (!w || !h) { return; } // HIDDEN: KEEP THE LAST SIZE
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(w, h, false); // CSS SIZES THE CANVAS
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
}

// EACH FRAME: STEP THE MOVING PIECES, THEN DRAW
function frame(now) {
	for (const anim of [...view.anims]) { stepAnim(anim, now); }
	view.renderer.render(view.scene, view.camera);
}

/**
 * @description Creates the renderer, scene, board & lights inside container & starts drawing. Throws if WebGL is unavailable
 * @param  {[HTMLElement]} container [what the 3D canvas fills, sized by CSS]
 */
export function mount(container) {
	if (view) { return; }
	const renderer = new WebGLRenderer({ antialias: true });
	const canvas = renderer.domElement;
	canvas.style.display = "block";
	canvas.style.width = canvas.style.height = "100%";
	const scene = new Scene();
	scene.background = new Color(BAIZE_FOG);
	scene.fog = new Fog(BAIZE_FOG, 50, 150); // PAST THE BAIZE TABLE, FADE INTO THE BACKGROUND
	const camera = new PerspectiveCamera(45, 1, 0.1, 1000);
	camera.position.set(0, 32, 26); // WHITE'S SIDE, LOOKING DOWN AT AN ANGLE
	camera.lookAt(0, 0, 0);
	scene.add(new HemisphereLight(0xFFF4E0, 0x3A2A1A, 1.2)); // FILL: WARM SKY, DARK WOOD BOUNCE, NO SHADOW MAPS
	const keyLight = new DirectionalLight(0xFFFFFF, 2.2); // KEY: HIGH & TO WHITE'S LEFT
	keyLight.position.set(-10, 25, 15);
	scene.add(keyLight);
	const boardTexture = new TextureLoader().load(BOARD_IMAGE);
	boardTexture.colorSpace = SRGBColorSpace; // COLORS MATCH THE 2D BOARD
	boardTexture.minFilter = LinearMipmapLinearFilter;
	boardTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8); // SHARP AT THE CAMERA'S LOW ANGLE
	const plane = new Mesh(new PlaneGeometry(BOARD_SIZE, BOARD_SIZE), new MeshStandardMaterial({ map: boardTexture }));
	plane.rotation.x = -0.5 * Math.PI; // LAY IT FLAT
	scene.add(plane, createSurroundings(BOARD_SIZE));
	const grid = new GridHelper(BOARD_SIZE, 8);
	grid.position.y = 0.01; // JUST ABOVE THE BOARD, NO Z-FIGHTING
	scene.add(grid);
	const markGeometry = new PlaneGeometry(CELL_SIZE * 0.9, CELL_SIZE * 0.9).rotateX(-0.5 * Math.PI);
	const marks = {};
	Object.keys(HIGHLIGHTS).forEach(function (kind, i) {
		const [color, opacity] = HIGHLIGHTS[kind];
		marks[kind] = { material: new MeshBasicMaterial({ color, opacity, transparent: true, depthWrite: false }), y: 0.02 + i * 0.002, meshes: new Map() };
	});
	view = { container, renderer, scene, camera, plane, markGeometry, marks, pieces: new Map(), anims: new Set(), cameraGesture: false }; // cameraGesture: THE CAMERA CONTROLS SET IT WHILE THEY OWN THE POINTER
	view.observer = new ResizeObserver(resize);
	view.observer.observe(container);
	window.addEventListener("orientationchange", resize); // SOME MOBILE BROWSERS REPORT THE NEW SIZE LATE
	container.appendChild(canvas);
	resize();
	renderer.setAnimationLoop(frame);
}

/**
 * @description Removes the 3D canvas & frees everything mount() made: listeners, geometries, materials, textures & the WebGL context.
 * Moves still animating finish at once (their promises resolve)
 */
export function unmount() {
	if (!view) { return; }
	finishAnims();
	const { renderer, scene, observer } = view;
	renderer.setAnimationLoop(null);
	observer.disconnect();
	window.removeEventListener("orientationchange", resize);
	const freed = new Set();
	scene.traverse(function (o) {
		if (o.geometry) { freed.add(o.geometry); }
		for (const m of [].concat(o.material || [])) {
			freed.add(m);
			if (m.map) { freed.add(m.map); }
		}
	});
	freed.forEach((r) => r.dispose()); // SHARED ONES (PIECE GEOMETRY, WOODS) ONLY LOSE THEIR GPU COPY, THE NEXT mount() RE-UPLOADS THEM
	renderer.domElement.remove();
	renderer.dispose();
	renderer.forceContextLoss();
	view = null;
}

/* ---------------------------------------------------------------- */
// Pieces
/* ---------------------------------------------------------------- */

/**
 * @description Places the pieces to match the position, reusing meshes already right or moving spare ones. After load, takebacks & restarts
 * @param  {[Chess]} chessInst [the chess.js instance, only its board() is read]
 */
export function syncFromBoard(chessInst) {
	if (!view) { return; }
	finishAnims();
	const want = new Map(); // SQUARE -> { type, color } STILL TO PLACE
	for (const row of chessInst.board()) { for (const p of row) { if (p) { want.set(p.square, p); } } }
	const spare = []; // MESHES ON A SQUARE THAT CHANGED
	for (const [square, mesh] of view.pieces) {
		const p = want.get(square);
		if (p && p.type === mesh.userData.type && p.color === mesh.userData.color) { want.delete(square); continue; }
		view.pieces.delete(square);
		spare.push(mesh);
	}
	for (const [square, p] of want) {
		const i = spare.findIndex((m) => m.userData.type === p.type && m.userData.color === p.color);
		place(i >= 0 ? spare.splice(i, 1)[0] : addPiece(p.type, p.color), square);
	}
	spare.forEach(removePiece);
}

/**
 * @description Which square a pointer event is over (the piece's square when it's over a piece, so tall pieces are easy to hit)
 * @param  {[PointerEvent|MouseEvent]} e [any event with clientX & clientY]
 * @return {[string|null]} ["e4", or null when it's off the board or nothing is mounted]
 */
export function squareUnder(e) {
	if (!view) { return null; }
	const rect = view.renderer.domElement.getBoundingClientRect();
	pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
	raycaster.setFromCamera(pointer, view.camera);
	const [hit] = raycaster.intersectObjects([...view.pieces.values(), view.plane], false);
	if (!hit) { return null; }
	if (hit.object !== view.plane) { return hit.object.userData.square; }
	return FILES[toCell(hit.point.x)] + (8 - toCell(hit.point.z));
}

/**
 * @description A camera gesture is in progress (true from its start until after the click its release fires), piece input ignores the pointer meanwhile
 * @return {[boolean]}
 */
export function isCameraGesture() {
	return Boolean(view && view.cameraGesture);
}

/**
 * @description Marks squares in one style, replacing that style's last marks. highlight([], kind) clears it
 * @param  {[string[]]} squares [["e4", ...]]
 * @param  {[string]} kind ["legal", "capture", "last" (last move), "check" or "hint"]
 */
export function highlight(squares, kind) {
	if (!HIGHLIGHTS[kind]) { throw new Error(`Bad highlight kind: ${kind}`); }
	if (!view) { return; }
	const { material, y, meshes } = view.marks[kind];
	for (const [square, mesh] of meshes) { mesh.visible = squares.includes(square); }
	for (const square of squares) {
		if (meshes.has(square)) { continue; }
		const mesh = new Mesh(view.markGeometry, material); // ONE PER SQUARE, MADE THE FIRST TIME IT'S MARKED
		mesh.position.set(center(fileOf(square)), y, center(rowOf(square)));
		view.scene.add(mesh);
		meshes.set(square, mesh);
	}
}

/* ---------------------------------------------------------------- */
// Animation
/* ---------------------------------------------------------------- */

// PUTS A MOVING PIECE WHERE THE TIME SAYS (now = Infinity FINISHES IT), ENDING IT AT progress 1
function stepAnim(anim, now) {
	if (anim.start === null) { anim.start = now; } // TIMED FROM ITS FIRST FRAME
	const t = now === Infinity || !anim.duration ? 1 : Math.min((now - anim.start) / anim.duration, 1);
	const { mesh, x0, z0, x1, z1 } = anim;
	mesh.position.set(x0 + (x1 - x0) * t, anim.hop ? Math.sin(Math.PI * t) * HOP_HEIGHT : 0, z0 + (z1 - z0) * t);
	updateShadow(mesh);
	if (t < 1) { return; }
	view.anims.delete(anim);
	if (anim.onEnd) { anim.onEnd(); } // NOW, NOT IN A .then(): A syncFromBoard() OR unmount() RIGHT AFTER SEES THE FINAL PIECES
	anim.done();
}

function finishAnims() {
	for (const anim of [...view.anims]) { stepAnim(anim, Infinity); }
}

// MOVES A MESH TO square & SLIDES (OR HOPS) IT THERE FROM WHERE IT'S DRAWN NOW, onEnd RUNS ON ARRIVAL
function slide(mesh, square, hop, onEnd) {
	const x0 = mesh.position.x, z0 = mesh.position.z;
	view.pieces.delete(mesh.userData.square);
	place(mesh, square);
	const x1 = mesh.position.x, z1 = mesh.position.z;
	const squares = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)) / CELL_SIZE;
	mesh.position.set(x0, 0, z0); // place() JUMPED IT, PUT IT BACK FOR THE FIRST FRAME
	return new Promise(function (done) {
		view.anims.add({ mesh, x0, z0, x1, z1, hop, onEnd, duration: (hop ? 1 : squares) * SLIDE_MS_PER_SQUARE, start: null, done });
	});
}

/**
 * @description Moves the piece on from to to, sliding (knights hop). Handles captures, castling's rook, en passant & promotion from
 * the pieces on the board, so call it before the next syncFromBoard(). Nothing on from: resolves at once
 * @param  {[string]} from ["e2"]
 * @param  {[string]} to ["e4"]
 * @param  {[string]} promotion ["q", "r", "b" or "n" when a pawn promotes, the pawn turns into it on arrival]
 * @return {[Promise<void>]} [resolves when every piece has stopped]
 */
export function animateMove(from, to, promotion) {
	if (!view || !view.pieces.has(from)) { return Promise.resolve(); }
	finishAnims();
	const mesh = view.pieces.get(from);
	const { type, color } = mesh.userData;
	const fileStep = fileOf(to) - fileOf(from);
	let captured = view.pieces.get(to);
	if (type === "p" && fileStep !== 0 && !captured) { captured = view.pieces.get(to[0] + from[1]); } // EN PASSANT: THE PAWN BESIDE IT
	if (captured) { view.pieces.delete(captured.userData.square); }
	const moves = [slide(mesh, to, type === "n", function () {
		if (captured) { removePiece(captured); }
		if (promotion && type === "p") {
			removePiece(mesh);
			place(addPiece(promotion, color), to);
		}
	})];
	if (type === "k" && Math.abs(fileStep) === 2) { // CASTLING: THE ROOK JUMPS OVER THE KING
		const rook = view.pieces.get((fileStep > 0 ? "h" : "a") + from[1]);
		if (rook) { moves.push(slide(rook, (fileStep > 0 ? "f" : "d") + from[1], false)); }
	}
	return Promise.all(moves).then(() => {});
}
