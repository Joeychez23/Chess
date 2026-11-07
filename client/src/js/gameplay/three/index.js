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
	MeshBasicMaterial, Mesh, TextureLoader, SRGBColorSpace, LinearMipmapLinearFilter, GridHelper, Raycaster, Vector2, Vector3, Spherical,
	MathUtils, MOUSE, TOUCH
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createPiece, updateShadow, setOpacity, disposePiece } from "./pieces.js";
import { RESTART_SLIDE_MS, slideDuration, slideDelay, hopArc, easeInOut } from "../animate/timing.js"; // THE 2D BOARD'S TIMINGS, SO A MOVE TAKES THE SAME TIME ON BOTH
import { createSurroundings } from "./board.js";
import { BAIZE_FOG } from "./materials.js";

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const BOARD_SIZE = 24; // WORLD UNITS PER BOARD SIDE
const CELL_SIZE = BOARD_SIZE / 8;
const PIECE_SIZE = CELL_SIZE * 0.8; // ONE PIECE UNIT (pieces.js), BASES LEAVE A GAP INSIDE THE SQUARE
const FILES = "abcdefgh";
const HOP_HEIGHT = CELL_SIZE * 0.6; // HOW HIGH A KNIGHT HOPS
const CAMERA_HEIGHT = 32; // THE CAMERA LOOKS DOWN AT THE CENTER FROM THIS HIGH...
const CAMERA_DISTANCE = 26; // ...& THIS FAR BACK FROM IT, ON THE SIDE AT THE BOTTOM OF THE SCREEN
const FLIP_MS = 700; // HOW LONG FLIP BOARD TAKES TO TURN THE CAMERA TO THE OTHER SIDE
const SINK_DEPTH = CELL_SIZE * 0.5; // HOW FAR A TAKEN PIECE DROPS AS IT FADES
const DRAG_PX = 4; // A PRESS THAT MOVES THE CAMERA ONLY BECOMES A CAMERA GESTURE PAST THIS MANY PIXELS, SO A SHAKY CLICK STILL CLICKS ITS SQUARE
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
const offset = new Vector3(); // CAMERA POSITION MINUS WHAT IT LOOKS AT
const spherical = new Spherical(); // offset AS DISTANCE, TILT & ANGLE AROUND THE BOARD

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

// PUTS THE CAMERA AT ITS DEFAULT SPOT angle RADIANS AROUND THE BOARD FROM WHITE'S SIDE (0 WHITE, PI BLACK), LOOKING AT THE CENTER
function placeCamera(angle) {
	view.controls.target.set(0, 0, 0); // UNDOES ANY PAN
	view.camera.position.set(CAMERA_DISTANCE * Math.sin(angle), CAMERA_HEIGHT, CAMERA_DISTANCE * Math.cos(angle));
	view.controls.update(); // LOOKS AT THE TARGET
}

// THE CAMERA'S ANGLE AROUND WHAT IT LOOKS AT (0 WHITE'S SIDE, PI BLACK'S), WHEREVER THE PLAYER TURNED IT
function cameraAzimuth() {
	offset.copy(view.camera.position).sub(view.controls.target);
	return Math.atan2(offset.x, offset.z);
}

// TURNS THE CAMERA AROUND WHAT IT LOOKS AT TO angle, KEEPING THE PLAYER'S ZOOM, TILT & PAN
function turnCamera(angle) {
	const { camera, controls } = view;
	spherical.setFromVector3(offset.copy(camera.position).sub(controls.target));
	spherical.theta = angle;
	camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
	camera.lookAt(controls.target);
}

// TURNS THE CAMERA PART OF THE WAY TO ITS SIDE (setSide), SLOW START & LANDING
function stepCamera(now) {
	const turn = view.cameraTurn;
	if (turn.start === null) { turn.start = now; }
	const t = MathUtils.clamp((now - turn.start) / FLIP_MS, 0, 1);
	turnCamera(turn.from + (turn.to - turn.from) * easeInOut(t));
	if (t === 1) { view.cameraTurn = null; }
}

/* ---------------------------------------------------------------- */
// Camera Controls
/* ---------------------------------------------------------------- */

// MOUSE: LEFT-DRAG PANS (ON A PIECE IT'S PIECE INPUT INSTEAD), RIGHT-DRAG ROTATES, SCROLL ZOOMS. TOUCH: ONE FINGER IS PIECE INPUT,
// TWO ROTATE & PINCH ZOOM. A PRESS THAT MOVES THE CAMERA PAST DRAG_PX SETS cameraGesture, SO gameplay/input IGNORES IT
function createControls(camera, canvas) {
	const controls = new OrbitControls(camera, canvas);
	controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
	controls.touches = { ONE: null, TWO: TOUCH.DOLLY_ROTATE };
	controls.screenSpacePanning = false; // PANS ALONG THE TABLE, NOT UP INTO THE AIR
	controls.addEventListener("start", function () {
		view.controlsActive = true;
		view.cameraTurn = null; // THE PLAYER TOOK THE CAMERA MID FLIP
	});
	controls.addEventListener("change", function () {
		const { controlsActive, press, pointerAt } = view;
		if (controlsActive && Math.hypot(pointerAt.x - press.x, pointerAt.y - press.y) > DRAG_PX) { view.cameraGesture = true; }
	});
	controls.addEventListener("end", function () {
		const v = view;
		v.controlsActive = false;
		if (v.cameraGesture) { setTimeout(function () { if (!v.controlsActive) { v.cameraGesture = false; } }, 0); } // AFTER THE CLICK THE RELEASE FIRES
	});
	return controls;
}

// CAPTURE PHASE, BEFORE THE CONTROLS SEE IT: A LEFT MOUSE PRESS ON A PIECE IS PIECE INPUT, THE CAMERA SITS IT OUT UNTIL THE RELEASE
function onPointerDown(e) {
	if (!view.controlsActive) {
		view.cameraGesture = false;
		view.press = { x: e.clientX, y: e.clientY };
	}
	view.pointerAt = { x: e.clientX, y: e.clientY };
	view.controls.enabled = !(e.pointerType === "mouse" && e.button === 0 && hitUnder(e, false));
}

function onPointerMove(e) {
	view.pointerAt = { x: e.clientX, y: e.clientY };
}

function onPointerUp() {
	if (view) { view.controls.enabled = true; }
}

// EACH FRAME: STEP THE MOVING PIECES & CAMERA, THEN DRAW
function frame(now) {
	for (const anim of [...view.anims]) { stepAnim(anim, now); }
	if (view.cameraTurn) { stepCamera(now); }
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
	const camera = new PerspectiveCamera(45, 1, 0.1, 1000); // PLACED BELOW (placeCamera), WHITE'S SIDE UNTIL setSide()
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
	view = { container, renderer, scene, camera, plane, markGeometry, marks, pieces: new Map(), anims: new Set(), side: "w", cameraTurn: null }; // side: THE SIDE THE CAMERA IS ON (OR TURNING TO), cameraTurn: FLIP BOARD'S TURN IN PROGRESS { from, to, start }
	Object.assign(view, { controls: createControls(camera, canvas), controlsActive: false, cameraGesture: false, press: { x: 0, y: 0 }, pointerAt: { x: 0, y: 0 } }); // cameraGesture: THE CAMERA CONTROLS OWN THE POINTER
	placeCamera(0);
	container.addEventListener("pointerdown", onPointerDown, true);
	container.addEventListener("pointermove", onPointerMove, true);
	window.addEventListener("pointerup", onPointerUp);
	window.addEventListener("pointercancel", onPointerUp);
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
	const { renderer, scene, observer, controls, container } = view;
	renderer.setAnimationLoop(null);
	observer.disconnect();
	controls.dispose();
	window.removeEventListener("orientationchange", resize);
	container.removeEventListener("pointerdown", onPointerDown, true);
	container.removeEventListener("pointermove", onPointerMove, true);
	window.removeEventListener("pointerup", onPointerUp);
	window.removeEventListener("pointercancel", onPointerUp);
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
	const hit = hitUnder(e, true);
	if (!hit) { return null; }
	if (hit.object !== view.plane) { return hit.object.userData.square; }
	return FILES[toCell(hit.point.x)] + (8 - toCell(hit.point.z));
}

// THE NEAREST PIECE (OR THE BOARD, withBoard) UNDER A POINTER EVENT, undefined WHEN NOTHING IS
function hitUnder(e, withBoard) {
	const rect = view.renderer.domElement.getBoundingClientRect();
	pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
	raycaster.setFromCamera(pointer, view.camera);
	const targets = [...view.pieces.values()];
	if (withBoard) { targets.push(view.plane); }
	return raycaster.intersectObjects(targets, false)[0];
}

/**
 * @description A camera gesture is in progress (true from its start until after the click its release fires), piece input ignores the pointer meanwhile
 * @return {[boolean]}
 */
export function isCameraGesture() {
	return Boolean(view && view.cameraGesture);
}

/**
 * @description Puts the camera on a side of the board (Flip Board), turning it the short way around what it looks at (keeping the
 * player's zoom, tilt & pan) or setting it at its default at once. Pressing again mid-turn turns back from where it is
 * @param  {[string]} color ['w' | 'b', the side the player looks from]
 * @param  {[boolean]} animate [false sets it at once (mount, reduce motion)]
 */
export function setSide(color, animate) {
	if (!view || view.side === color) { return; }
	view.side = color;
	const angle = color === "b" ? Math.PI : 0;
	if (!animate) {
		view.cameraTurn = null;
		placeCamera(angle);
		return;
	}
	const from = cameraAzimuth();
	view.cameraTurn = { from, to: from + Math.atan2(Math.sin(angle - from), Math.cos(angle - from)), start: null };
}

/**
 * @description Puts the camera back at its default spot for a side at once (Reset View)
 * @param  {[string]} color ['w' | 'b', the side the player looks from]
 */
export function resetCamera(color) {
	if (!view) { return; }
	view.cameraTurn = null;
	view.side = color;
	placeCamera(color === "b" ? Math.PI : 0);
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

// PUTS A MOVING PIECE WHERE THE TIME SAYS (now = Infinity FINISHES IT), ENDING IT AT progress 1. THE CLOCK STARTS ON ITS FIRST FRAME
// PLUS ITS delay (A KNIGHT'S STOP), ease IS THE RESTART SLIDE'S SLOW START & LANDING, fade 1 FADES IN & -1 FADES OUT & DROPS
function stepAnim(anim, now) {
	if (anim.start === null) { anim.start = now + anim.delay; }
	const t = now === Infinity || !anim.duration ? 1 : MathUtils.clamp((now - anim.start) / anim.duration, 0, 1);
	const along = anim.ease ? easeInOut(t) : t;
	const { mesh, x0, z0, x1, z1 } = anim;
	let y = anim.hop ? hopArc(t) * HOP_HEIGHT : 0;
	if (anim.fade < 0) { y -= t * SINK_DEPTH; }
	mesh.position.set(x0 + (x1 - x0) * along, y, z0 + (z1 - z0) * along);
	if (anim.fade) { setOpacity(mesh, anim.fade > 0 ? t : 1 - t); } // ALSO PUTS THE SHADOW UNDER IT
	else { updateShadow(mesh); }
	if (t < 1) { return; }
	view.anims.delete(anim);
	if (anim.onEnd) { anim.onEnd(); } // NOW, NOT IN A .then(): A syncFromBoard() OR unmount() RIGHT AFTER SEES THE FINAL PIECES
	anim.done();
}

function finishAnims() {
	for (const anim of [...view.anims]) { stepAnim(anim, Infinity); }
}

// STARTS AN ANIMATION OF mesh FROM WHERE IT'S DRAWN NOW TO (x1, z1), RESOLVES WHEN IT ENDS
function animate(mesh, x1, z1, { hop = false, ease = false, fade = 0, delay = 0, duration, onEnd }) {
	const x0 = mesh.position.x, z0 = mesh.position.z;
	if (fade > 0) { setOpacity(mesh, 0); } // UNSEEN UNTIL ITS FIRST FRAME
	return new Promise(function (done) {
		view.anims.add({ mesh, x0, z0, x1, z1, hop, ease, fade, delay, duration, onEnd, start: null, done });
	});
}

// MOVES A MESH TO square & SLIDES (OR HOPS) IT THERE FROM WHERE IT'S DRAWN NOW. options: animate()'s, duration DEFAULTS TO A MOVE'S
function slide(mesh, square, options) {
	const x0 = mesh.position.x, z0 = mesh.position.z;
	if (view.pieces.get(mesh.userData.square) === mesh) { view.pieces.delete(mesh.userData.square); } // NOT A PIECE THAT ALREADY SLID IN THERE
	place(mesh, square);
	const x1 = mesh.position.x, z1 = mesh.position.z;
	const squares = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)) / CELL_SIZE;
	mesh.position.set(x0, 0, z0); // place() JUMPED IT, PUT IT BACK FOR THE FIRST FRAME
	updateShadow(mesh);
	return animate(mesh, x1, z1, { duration: slideDuration(squares, options.hop), ...options });
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
	const knight = type === "n";
	const moves = [slide(mesh, to, { hop: knight, delay: slideDelay(knight), onEnd: function () {
		if (promotion && type === "p") {
			removePiece(mesh);
			place(addPiece(promotion, color), to);
		}
	} })];
	if (captured) { // FADES & DROPS AWAY WHILE THE PIECE COMES IN, GONE AS IT LANDS
		view.pieces.delete(captured.userData.square);
		const { x, z } = captured.position;
		moves.push(animate(captured, x, z, { fade: -1, delay: slideDelay(knight), duration: slideDuration(Math.max(Math.abs(fileStep), Math.abs(rowOf(to) - rowOf(from))), knight), onEnd: () => removePiece(captured) }));
	}
	if (type === "k" && Math.abs(fileStep) === 2) { // CASTLING: THE ROOK JUMPS OVER THE KING
		const rook = view.pieces.get((fileStep > 0 ? "h" : "a") + from[1]);
		if (rook) { moves.push(slide(rook, (fileStep > 0 ? "f" : "d") + from[1], {})); }
	}
	return Promise.all(moves).then(() => {});
}

/**
 * @description Restart & Rematch: every piece glides home to the new position in the 2D slide's time (RESTART_SLIDE_MS) on a slow start
 * & landing, pairing each square with a piece of the same color & type, closest first (a bishop stays on its square color).
 * Knights that move hop. A square with no piece left for it fades in, a piece with no square fades out where it is
 * @param  {[Chess]} chessInst [the new game, only its board() is read]
 * @return {[Promise<void>]} [resolves when every piece is home]
 */
export function glideHome(chessInst) {
	if (!view) { return Promise.resolve(); }
	finishAnims();
	const targets = chessInst.board().flat().filter(Boolean); // { square, type, color }
	const meshes = [...view.pieces.values()];
	const light = (square) => (fileOf(square) + rowOf(square)) % 2 === 0;
	const pairs = [];
	targets.forEach(function (p, t) {
		meshes.forEach(function (mesh, m) {
			if (mesh.userData.type !== p.type || mesh.userData.color !== p.color) { return; }
			const from = mesh.userData.square;
			let distance = Math.hypot(fileOf(p.square) - fileOf(from), rowOf(p.square) - rowOf(from));
			if (p.type === "b" && light(from) !== light(p.square)) { distance += 100; } // A BISHOP STAYS ON ITS SQUARE COLOR
			pairs.push({ t, m, distance });
		});
	});
	pairs.sort((a, b) => a.distance - b.distance); // CLOSEST FIRST
	const target = new Map(); // MESH INDEX -> TARGET INDEX
	const filled = new Set(); // TARGET INDEXES WITH A PIECE
	for (const { t, m } of pairs) {
		if (target.has(m) || filled.has(t)) { continue; }
		target.set(m, t);
		filled.add(t);
	}
	view.pieces.clear();
	const glides = [];
	meshes.forEach(function (mesh, m) {
		if (!target.has(m)) { // NO SQUARE: FADES OUT WHERE IT IS
			const { x, z } = mesh.position;
			glides.push(animate(mesh, x, z, { fade: -1, duration: RESTART_SLIDE_MS, onEnd: () => removePiece(mesh) }));
			return;
		}
		const square = targets[target.get(m)].square;
		const moves = square !== mesh.userData.square;
		glides.push(slide(mesh, square, { hop: moves && mesh.userData.type === "n", ease: true, duration: RESTART_SLIDE_MS }));
	});
	targets.forEach(function (p, t) {
		if (filled.has(t)) { return; }
		const mesh = addPiece(p.type, p.color); // NO PIECE LEFT FOR IT: FADES IN ON ITS SQUARE
		place(mesh, p.square);
		glides.push(animate(mesh, mesh.position.x, mesh.position.z, { fade: 1, duration: RESTART_SLIDE_MS }));
	});
	return Promise.all(glides).then(() => {});
}
