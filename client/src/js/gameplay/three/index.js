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
	MathUtils, MOUSE, TOUCH, RingGeometry, Plane
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createPiece, updateShadow, setOpacity, disposePiece } from "./pieces.js";
import { RESTART_SLIDE_MS, slideDuration, slideDelay, hopArc, easeInOut } from "../animate/timing.js"; // THE 2D BOARD'S TIMINGS, SO A MOVE TAKES THE SAME TIME ON BOTH
import { createSurroundings, orientLabels } from "./board.js";
import { BAIZE_FOG } from "./materials.js";
import { showHint, dismissHint, removeHint } from "./hint.js";
import { perfStart, perfStop, perfFrame, perfMoving, perfLost } from "./perf.js"; // ?perf=1's READOUT FOR PHONE TESTS (#430)
export { perfLoaded } from "./perf.js"; // load.js GIVES IT THE CHUNK'S DOWNLOAD TIME
import "../../../css/board3D.css"; // #board3D, THE CONTROLS HINT & THE PERF READOUT: IN THIS CHUNK, NOT THE PLAY BUNDLE

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
const MIN_DISTANCE = 12; // ZOOM LIMITS: CLOSE ENOUGH TO READ A SQUARE...
const MAX_DISTANCE = 70; // ...FAR ENOUGH TO SEE THE WHOLE TABLE, BEFORE THE FOG SWALLOWS THE BOARD (DEFAULT IS ~41)
const MAX_TILT = MathUtils.degToRad(80); // FROM STRAIGHT DOWN (0): STAYS ABOVE THE TABLE, NEVER LEVEL WITH OR BELOW IT
const FLIP_MS = 700; // HOW LONG FLIP BOARD TAKES TO TURN THE CAMERA TO THE OTHER SIDE
const SINK_DEPTH = CELL_SIZE * 0.5; // HOW FAR A TAKEN PIECE DROPS AS IT FADES
const DRAG_PX = 4; // A PRESS THAT MOVES THE CAMERA ONLY BECOMES A CAMERA GESTURE PAST THIS MANY PIXELS, SO A SHAKY CLICK STILL CLICKS ITS SQUARE
const TOUCH_DRAG_PX = 10; // A FINGER ON A HELD PIECE ONLY DRAGS IT PAST THIS MANY PIXELS (gameplay/input's touchDragThreshold, A SHAKY TAP STAYS A TAP)
const LIFT_HEIGHT = CELL_SIZE * 0.2; // HOW HIGH A PICKED UP OR DRAGGED PIECE FLOATS OVER THE BOARD (2D DRAWS IT A TENTH OF A SQUARE UP)
const BOARD_IMAGE = `${process.env.CHESS_ASSETS_URL}/images/3d/board.jpg`; // JUST THE 8x8 SQUARES, S3 / CLOUDFRONT LIKE THE SPRITES & ONLY FETCHED WITH 3D ON
const HIGHLIGHTS = { // highlight() KINDS: [color, opacity], LATER KINDS DRAW ON TOP
	last: [0xE8792B, 0.3],
	legal: [0xFFEA00, 0.35],
	capture: [0xFF3B30, 0.45],
	hint: [0x55C8FF, 0.45],
	check: [0xFF0000, 0.55],
	focus: [0xFFC83D, 1], // THE KEYBOARD'S SQUARE: A GOLD RING (NOT A FILL), LIKE THE PAGE'S FOCUS OUTLINE, CLEAR OF THE YELLOW LEGAL FILL
};
const FOCUS_RING = [0.36, 0.47]; // ITS INNER & OUTER EDGE, HALF A SIDE IN SQUARES FROM THE CENTER
const LABEL = "Chess board, 3D. To play with the keyboard, press / and type a move."; // THE CANVAS'S ACCESSIBLE NAME (role img)

const PHONE_PIXEL_RATIO = 1.5; // PHONES DRAW AT MOST THIS MANY PIXELS PER CSS PIXEL (2 ELSEWHERE)
// SMALL TOUCH SCREENS (#400's RULE, PLUS A PHONE ON ITS SIDE, WIDER THAN 768PX BUT SHORT) GET A STEEPER CAMERA SO EVERY SQUARE IS A
// TAP TARGET: AT LEAST TAP_PX TALL ON SCREEN. RE-CHECKED ON EVERY RESIZE (ROTATING THE PHONE RESIZES)
const SMALL_SCREEN = window.matchMedia("(pointer: coarse) and (max-width: 768px), (pointer: coarse) and (max-height: 500px)");
const TAP_PX = 44;
const SMALL_TILTS = [30, 25, 20, 15, 10, 5, 3].map(MathUtils.degToRad); // TRIED IN ORDER: THE MOST 3D ONE THAT STILL MAKES TAP_PX, ELSE THE STEEPEST
const FOV = 45;
const SMALL_FOV = 30; // A LONGER LENS: LESS PERSPECTIVE, SO THE FAR ROW ISN'T SQUASHED & THE SQUARES CAN BE BIGGER
const FIT_NDC = 0.98; // ROOM LEFT AROUND THE BOARD WHEN THERE'S SPACE FOR IT (1 IS EDGE TO EDGE)
const PIECE_TOP = PIECE_SIZE * 1.4; // ABOUT A KING'S HEIGHT, THE PIECES ON THE EDGE ROWS STAY ON SCREEN WHEN THERE'S SPACE FOR IT
let view = null; // EVERYTHING ONE mount() MADE, null WHEN UNMOUNTED
const raycaster = new Raycaster();
const pointer = new Vector2(); // NORMALIZED DEVICE COORDS (-1..1)
const offset = new Vector3(); // CAMERA POSITION MINUS WHAT IT LOOKS AT
const spherical = new Spherical(); // offset AS DISTANCE, TILT & ANGLE AROUND THE BOARD
const fitCamera = new PerspectiveCamera(); // smallScreenCamera()'S STAND-IN, THE REAL ONE STAYS WHERE THE PLAYER PUT IT
const corner = new Vector3();
const table = new Plane(new Vector3(0, 1, 0), 0); // THE BOARD'S SURFACE, A DRAGGED PIECE OFF THE BOARD FOLLOWS THE POINTER ON IT
const tablePoint = new Vector3();

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

// KING, QUEEN, BISHOP & ROOK FACE THE WAY THEY LAST MOVED UP OR DOWN THE BOARD LIKE 2D (handlePieceDirectionW / B): TOWARD RANK 8 (-Z) IS
// rotation.y PI (MODEL FRONTS FACE +Z), TOWARD RANK 1 IS 0. ONE THAT HASN'T FACES THE OTHER SIDE (createPiece). WORLD SIDES, SO A FLIP CHANGES NOTHING
const TURNS = /[kqbr]/;
const yawToward = (rankUp) => (rankUp ? Math.PI : 0);
const storedYaw = (mesh) => mesh.userData.yaw ?? yawToward(mesh.userData.color === "w");

function setYaw(mesh, yaw, store) {
	if (!TURNS.test(mesh.userData.type)) { return; }
	if (store) { mesh.userData.yaw = yaw; }
	mesh.rotation.y = yaw;
}

// TURNS A KING, QUEEN, BISHOP OR ROOK THE WAY A MOVE GOES UP OR DOWN, A SIDEWAYS MOVE KEEPS ITS FACING
function faceTravel(mesh, from, to) {
	if (from[1] !== to[1]) { setYaw(mesh, yawToward(Number(to[1]) > Number(from[1])), true); }
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

// MATCHES THE DRAWING BUFFER & CAMERA TO THE CONTAINER (INSIDE ITS SAFE AREA PADDING, css/board3D.css #board3D), PIXEL DENSITY CAPPED
// (2, PHONES 1.5) SO 3x PHONES DON'T DRAW 9x THE PIXELS. A SMALL SCREEN ALSO GETS ITS CAMERA LIMITS FOR THE NEW SIZE
function resize() {
	const { renderer, camera, container, controls } = view;
	const style = getComputedStyle(container);
	const w = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
	const h = container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
	if (!(w > 0 && h > 0)) { return; } // HIDDEN: KEEP THE LAST SIZE
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, view.phone ? PHONE_PIXEL_RATIO : 2));
	renderer.setSize(w, h, false); // CSS SIZES THE CANVAS
	camera.aspect = w / h;
	camera.fov = SMALL_SCREEN.matches ? SMALL_FOV : FOV;
	camera.updateProjectionMatrix();
	view.small = SMALL_SCREEN.matches ? smallScreenCamera(h) : null;
	controls.maxPolarAngle = view.small ? view.small.tilt : MAX_TILT; // NO TILTING OR ZOOMING OUT TO WHERE A SQUARE IS UNDER TAP_PX
	controls.maxDistance = view.small ? Math.max(view.small.distance, MIN_DISTANCE) : MAX_DISTANCE;
	controls.update(); // A CAMERA PAST THE NEW LIMITS (THE PHONE WAS TURNED) MOVES INSIDE THEM
	requestRender();
}

/**
 * @description The small screen camera: the most tilted of SMALL_TILTS whose squares are TAP_PX tall at the distance picked, or the
 * steepest when none are (the biggest squares the screen allows: a phone on its side is about 8 squares tall). The distance is the
 * closest with room around the board & its pieces, or closer to make TAP_PX (edge pieces' tops may go off screen), but never so
 * close a square is off screen
 * @param  {[number]} h [the canvas's height in CSS pixels, view.camera has its new aspect & fov]
 * @return {[object]} { tilt, distance } [from straight down, from the center]
 */
function smallScreenCamera(h) {
	fitCamera.copy(view.camera);
	let fit;
	for (const tilt of SMALL_TILTS) {
		const squares = closest(tilt, () => cornersOnScreen(0, 1));
		const roomy = closest(tilt, () => cornersOnScreen(0, FIT_NDC) && cornersOnScreen(PIECE_TOP, 1));
		const tap = closest(tilt, () => smallestSquarePx(h) < TAP_PX); // FARTHER THAN THIS IS UNDER TAP_PX
		fit = { tilt, distance: Math.max(squares, Math.min(roomy, tap)) };
		aimFitCamera(tilt, fit.distance);
		if (smallestSquarePx(h) >= TAP_PX - 0.5) { break; }
	}
	return fit;
}

// PUTS fitCamera AT tilt & distance FROM WHITE'S SIDE (THE BOARD LOOKS THE SAME FROM BLACK'S)
function aimFitCamera(tilt, distance) {
	fitCamera.position.setFromSpherical(spherical.set(distance, tilt, 0));
	fitCamera.lookAt(0, 0, 0);
	fitCamera.updateMatrixWorld();
}

// THE CLOSEST DISTANCE AT tilt WHERE ok() IS TRUE (IT MUST BE TRUE FAR AWAY & FALSE UP CLOSE), FOUND BY HALVING
function closest(tilt, ok) {
	let near = 1, far = 400;
	for (let i = 0; i < 30; i++) {
		const mid = (near + far) / 2;
		aimFitCamera(tilt, mid);
		if (ok()) { far = mid; } else { near = mid; }
	}
	return far;
}

// THE BOARD'S 4 CORNERS, y UP, ARE INSIDE ndc OF fitCamera'S SCREEN (1 IS ITS EDGE)
function cornersOnScreen(y, ndc) {
	return [-1, 1].every((x) => [-1, 1].every(function (z) {
		corner.set(x * BOARD_SIZE / 2, y, z * BOARD_SIZE / 2).project(fitCamera);
		return Math.abs(corner.x) <= ndc && Math.abs(corner.y) <= ndc;
	}));
}

// HOW TALL THE FAR ROW'S SQUARES ARE ON fitCamera'S SCREEN IN CSS PIXELS (THE SMALLEST, THE TILT SQUASHES THE FAR SIDE MOST)
function smallestSquarePx(h) {
	const back = corner.set(0, 0, -BOARD_SIZE / 2).project(fitCamera).y;
	const front = corner.set(0, 0, -BOARD_SIZE / 2 + CELL_SIZE).project(fitCamera).y;
	return Math.abs(back - front) / 2 * h;
}

// PUTS THE CAMERA AT ITS DEFAULT SPOT angle RADIANS AROUND THE BOARD FROM WHITE'S SIDE (0 WHITE, PI BLACK), LOOKING AT THE CENTER.
// A SMALL SCREEN'S IS STEEPER & FITS THE BOARD TO IT (smallScreenCamera)
function placeCamera(angle) {
	view.controls.target.set(0, 0, 0); // UNDOES ANY PAN
	if (view.small) { view.camera.position.setFromSpherical(spherical.set(view.small.distance, view.small.tilt, angle)); }
	else { view.camera.position.set(CAMERA_DISTANCE * Math.sin(angle), CAMERA_HEIGHT, CAMERA_DISTANCE * Math.cos(angle)); }
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
	if (t >= 0.5) { setLabels(view.side); } // SIDE ON TO THE BOARD: THE LABELS SWAP UNSEEN
	if (t === 1) { view.cameraTurn = null; }
}

// TURNS THE a-h / 1-8 LABELS TO READ FROM color'S SIDE, LIKE THE 2D BOARD'S
function setLabels(color) {
	if (view.labelSide === color) { return; }
	view.labelSide = color;
	orientLabels(view.surroundings, color);
}

/* ---------------------------------------------------------------- */
// Camera Controls
/* ---------------------------------------------------------------- */

// MOUSE: LEFT-DRAG PANS (ON A PIECE IT'S PIECE INPUT INSTEAD), RIGHT-DRAG ROTATES, SCROLL ZOOMS. TOUCH: ONE FINGER IS PIECE INPUT,
// TWO ROTATE & PINCH ZOOM. A PRESS THAT MOVES THE CAMERA PAST DRAG_PX (OR ANY TWO FINGER TOUCH) SETS cameraGesture, SO gameplay/input IGNORES IT
function createControls(camera, canvas) {
	const controls = new OrbitControls(camera, canvas);
	controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
	controls.touches = { ONE: null, TWO: TOUCH.DOLLY_ROTATE };
	controls.screenSpacePanning = false; // PANS ALONG THE TABLE, NOT UP INTO THE AIR
	controls.minDistance = MIN_DISTANCE;
	controls.maxDistance = MAX_DISTANCE;
	controls.minPolarAngle = 0; // STRAIGHT DOWN, NEVER PAST IT
	controls.maxPolarAngle = MAX_TILT;
	controls.maxTargetRadius = BOARD_SIZE / 2; // THE CAMERA ALWAYS LOOKS AT A POINT ON THE BOARD, SO PANNING CAN'T LOSE IT (cursor IS THE ORIGIN)
	controls.addEventListener("start", function () {
		view.controlsActive = true;
		view.cameraTurn = null; // THE PLAYER TOOK THE CAMERA MID FLIP
		setLabels(view.side);
		if (view.pointerType === "touch") { startGesture(); } // ONLY TWO FINGERS START THE CONTROLS: A CAMERA GESTURE AT ONCE, NO PIECE INPUT UNTIL EVERY FINGER IS UP
	});
	controls.addEventListener("change", function () {
		requestRender();
		const { controlsActive, press, pointerAt } = view;
		if (controlsActive && Math.hypot(pointerAt.x - press.x, pointerAt.y - press.y) > DRAG_PX) { startGesture(); }
	});
	controls.addEventListener("end", function () {
		const v = view;
		v.controlsActive = false;
		if (v.cameraGesture) { setTimeout(function () { if (!v.controlsActive) { v.cameraGesture = false; } }, 0); } // AFTER THE CLICK THE RELEASE FIRES
	});
	return controls;
}

// THE CONTROLS OWN THE POINTER FROM HERE. THE FIRST CAMERA MOVE ALSO DISMISSES THE CONTROLS HINT
function startGesture() {
	view.cameraGesture = true;
	dismissHint();
}

// CAPTURE PHASE, BEFORE THE CONTROLS SEE IT: A LEFT MOUSE PRESS ON A PIECE IS PIECE INPUT, THE CAMERA SITS IT OUT UNTIL THE RELEASE
function onPointerDown(e) {
	if (!view.controlsActive) {
		view.cameraGesture = false;
		view.press = { x: e.clientX, y: e.clientY };
	}
	view.pointerAt = { x: e.clientX, y: e.clientY };
	view.pointerType = e.pointerType;
	view.controls.enabled = !(e.pointerType === "mouse" && e.button === 0 && hitUnder(e, false));
}

// A HELD PIECE PAST THE DRAG THRESHOLD FOLLOWS THE POINTER (dragHeld). BEFORE gameplay/input'S mousemove / touchmove, SO ITS SQUARE LOOKUP SKIPS THE PIECE TOO
function onPointerMove(e) {
	view.pointerAt = { x: e.clientX, y: e.clientY };
	const held = view.held;
	if (!held || !held.dragging || view.cameraGesture) { return; }
	if (!held.following && Math.hypot(e.clientX - view.press.x, e.clientY - view.press.y) > (e.pointerType === "touch" ? TOUCH_DRAG_PX : DRAG_PX)) { held.following = true; }
	if (held.following) { liftHeld(); }
}

function onPointerUp() {
	if (view) { view.controls.enabled = true; }
}

/* ---------------------------------------------------------------- */
// Rendering
/* ---------------------------------------------------------------- */

// DRAWS ON DEMAND: ASKS FOR ONE FRAME WHEN SOMETHING CHANGED (A FEW CALLS BEFORE IT RUNS STILL DRAW ONCE). NOTHING WHILE THE TAB IS
// HIDDEN, visibilitychange DRAWS ON THE WAY BACK. AN IDLE BOARD DRAWS NOTHING
function requestRender() {
	if (!view || view.frameId !== null || document.hidden || view.lost) { return; }
	view.frameId = requestAnimationFrame(frame);
}

// ONE FRAME: STEP THE MOVING PIECES & CAMERA, THEN DRAW. ASKS FOR THE NEXT ONLY WHILE SOMETHING IS STILL MOVING
function frame(now) {
	view.frameId = null;
	perfMoving(now, view.anims.size > 0 || Boolean(view.cameraTurn));
	for (const anim of [...view.anims]) { stepAnim(anim, now); }
	if (view.cameraTurn) { stepCamera(now); }
	if (view.controls.enableDamping) { view.controls.update(); } // STILL GLIDING: ITS "change" ASKS FOR THE NEXT FRAME
	view.renderer.render(view.scene, view.camera);
	if (view.textureReady) { view.markDrawn(); } // ONLY THE FIRST CALL COUNTS
	perfFrame(now);
	if (view.anims.size || view.cameraTurn) { requestRender(); }
}

function onVisibility() {
	if (!document.hidden) { requestRender(); return; }
	cancelAnimationFrame(view.frameId);
	view.frameId = null;
}

// THE BROWSER TOOK THE GPU BACK (iPHONES DO WHEN THE PAGE IS BACKGROUNDED OR LOW ON MEMORY). preventDefault() LETS IT BE RESTORED.
// NOTHING DRAWS UNTIL THE CALLER (renderer/) PUTS UP A NEW BOARD
function onContextLost(e) {
	e.preventDefault();
	perfLost();
	view.lost = true;
	cancelAnimationFrame(view.frameId);
	view.frameId = null;
	finishAnims(); // THEIR PROMISES RESOLVE, THE GAME DOESN'T WAIT ON A BOARD THAT CAN'T DRAW
	view.onContextLost();
}

function onContextRestored() {
	view.onContextRestored();
}

/**
 * @description Creates the renderer, scene, board & lights inside container & starts drawing. Throws if WebGL is unavailable
 * @param  {[HTMLElement]} container [what the 3D canvas fills, sized by CSS]
 * @param  {[object]} events [{ onContextLost, onContextRestored }: the WebGL context went away / came back, the board stops drawing
 * when it's lost & the caller puts up a new one (unmount() then mount())]
 */
export function mount(container, { onContextLost: lost = () => {}, onContextRestored: restored = () => {} } = {}) {
	if (view) { return; }
	const phone = window.matchMedia("(pointer: coarse)").matches; // TOUCH-FIRST SCREEN: THE CHEAPER SCENE (NO FOG, LOWER PIXEL RATIO)
	const renderer = new WebGLRenderer({ antialias: true, powerPreference: phone ? "low-power" : "default" });
	const canvas = renderer.domElement;
	canvas.style.display = "block";
	canvas.style.width = canvas.style.height = "100%";
	canvas.setAttribute("role", "img");
	canvas.setAttribute("aria-label", LABEL);
	const scene = new Scene();
	scene.background = new Color(BAIZE_FOG);
	if (!phone) { scene.fog = new Fog(BAIZE_FOG, 50, 150); } // PAST THE BAIZE TABLE, FADE INTO THE BACKGROUND
	const camera = new PerspectiveCamera(FOV, 1, 0.1, 1000); // PLACED BELOW (placeCamera), WHITE'S SIDE UNTIL setSide()
	scene.add(new HemisphereLight(0xFFF4E0, 0x3A2A1A, 1.2)); // FILL: WARM SKY, DARK WOOD BOUNCE, NO SHADOW MAPS
	const keyLight = new DirectionalLight(0xFFFFFF, 2.2); // KEY: HIGH & TO WHITE'S LEFT
	keyLight.position.set(-10, 25, 15);
	scene.add(keyLight);
	const squaresIn = function () { // DRAWS AGAIN WHEN THE SQUARES ARRIVE (OR FAIL TO: THE BOARD IS STILL PLAYABLE), THAT FRAME IS whenDrawn()'S
		if (!view || view.plane.material.map !== boardTexture) { return; } // A BOARD UNMOUNTED SINCE
		view.textureReady = true;
		requestRender();
	};
	const boardTexture = new TextureLoader().load(BOARD_IMAGE, squaresIn, undefined, squaresIn);
	boardTexture.colorSpace = SRGBColorSpace; // COLORS MATCH THE 2D BOARD
	boardTexture.minFilter = LinearMipmapLinearFilter;
	boardTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8); // SHARP AT THE CAMERA'S LOW ANGLE
	const plane = new Mesh(new PlaneGeometry(BOARD_SIZE, BOARD_SIZE), new MeshStandardMaterial({ map: boardTexture }));
	plane.rotation.x = -0.5 * Math.PI; // LAY IT FLAT
	const surroundings = createSurroundings(BOARD_SIZE); // ITS LABELS START ON WHITE'S SIDE
	scene.add(plane, surroundings);
	const grid = new GridHelper(BOARD_SIZE, 8);
	grid.position.y = 0.01; // JUST ABOVE THE BOARD, NO Z-FIGHTING
	scene.add(grid);
	const markGeometry = new PlaneGeometry(CELL_SIZE * 0.9, CELL_SIZE * 0.9).rotateX(-0.5 * Math.PI);
	const [inner, outer] = FOCUS_RING.map((s) => s * CELL_SIZE * Math.SQRT2); // 4 SEGMENTS FROM 45°: A SQUARE RING, CORNERS ON THE DIAGONALS
	const ringGeometry = new RingGeometry(inner, outer, 4, 1, Math.PI / 4).rotateX(-0.5 * Math.PI);
	const marks = {};
	Object.keys(HIGHLIGHTS).forEach(function (kind, i) {
		const [color, opacity] = HIGHLIGHTS[kind];
		marks[kind] = { geometry: kind === "focus" ? ringGeometry : markGeometry, material: new MeshBasicMaterial({ color, opacity, transparent: true, depthWrite: false }), y: 0.02 + i * 0.002, meshes: new Map() };
	});
	view = { phone, container, renderer, scene, camera, plane, surroundings, marks, pieces: new Map(), anims: new Set(), side: "w", labelSide: "w", cameraTurn: null, frameId: null }; // frameId: THE requestRender() FRAME WAITING TO RUN, side: THE SIDE THE CAMERA IS ON (OR TURNING TO), labelSide: THE SIDE THE LABELS READ FROM, cameraTurn: FLIP BOARD'S TURN IN PROGRESS { from, to, start }
	Object.assign(view, { small: null, lost: false, onContextLost: lost, onContextRestored: restored, held: null }); // held: THE PICKED UP PIECE (setHeld) { mesh, dragging, following }
	view.drawn = new Promise((resolve) => { view.markDrawn = resolve; }); // whenDrawn(): THE FIRST FRAME WITH THE SQUARES IN (textureReady)
	view.textureReady = false;
	Object.assign(view, { controls: createControls(camera, canvas), controlsActive: false, cameraGesture: false, press: { x: 0, y: 0 }, pointerAt: { x: 0, y: 0 }, pointerType: null }); // cameraGesture: THE CAMERA CONTROLS OWN THE POINTER
	container.style.backgroundColor = scene.background.getStyle(); // THE SAFE AREA PADDING (UNDER A NOTCH) IS THE SCENE'S BACKGROUND
	view.observer = new ResizeObserver(resize);
	view.observer.observe(container);
	window.addEventListener("orientationchange", resize); // SOME MOBILE BROWSERS REPORT THE NEW SIZE LATE
	container.appendChild(canvas);
	resize(); // FIRST: A SMALL SCREEN'S CAMERA (view.small) IS FIT TO THE SIZE
	placeCamera(0);
	container.addEventListener("pointerdown", onPointerDown, true);
	container.addEventListener("pointermove", onPointerMove, true);
	window.addEventListener("pointerup", onPointerUp);
	window.addEventListener("pointercancel", onPointerUp);
	canvas.addEventListener("webglcontextlost", onContextLost);
	canvas.addEventListener("webglcontextrestored", onContextRestored);
	document.addEventListener("visibilitychange", onVisibility);
	requestRender();
	showHint(); // THE FIRST TIME 3D OPENS
	perfStart({ renderer, camera, squareCorners });
}

// A SQUARE'S 4 CORNERS ON THE BOARD, FOR perf.js
function squareCorners(square) {
	const x = center(fileOf(square)), z = center(rowOf(square)), d = CELL_SIZE / 2;
	return [[-d, -d], [-d, d], [d, -d], [d, d]].map(([dx, dz]) => new Vector3(x + dx, 0, z + dz));
}

/**
 * @description Resolves after the first frame drawn with the board's squares in, so the page can fade in on a whole board.
 * Never, for a board that loses its context or is unmounted first (the caller times out)
 * @return {[Promise<void>]}
 */
export function whenDrawn() {
	return view ? view.drawn : Promise.resolve();
}

/**
 * @description Removes the 3D canvas & frees everything mount() made: listeners, geometries, materials, textures & the WebGL context.
 * Moves still animating finish at once (their promises resolve)
 */
export function unmount() {
	if (!view) { return; }
	finishAnims();
	removeHint();
	perfStop();
	const { renderer, scene, observer, controls, container } = view;
	cancelAnimationFrame(view.frameId);
	document.removeEventListener("visibilitychange", onVisibility);
	observer.disconnect();
	controls.dispose();
	window.removeEventListener("orientationchange", resize);
	container.removeEventListener("pointerdown", onPointerDown, true);
	container.removeEventListener("pointermove", onPointerMove, true);
	window.removeEventListener("pointerup", onPointerUp);
	window.removeEventListener("pointercancel", onPointerUp);
	renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
	renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
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
	if (!view.lost) { renderer.forceContextLoss(); } // A LOST CONTEXT HAS NOTHING LEFT TO FREE
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
	putDownHeld(); // ON ITS SQUARE BEFORE THE MESHES ARE SORTED, setHeld() LIFTS IT AGAIN IF IT'S STILL HELD
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
	requestRender();
}

/**
 * @description Turns the kings, queens, bishops & rooks the way the 2D board's piece lists say (w_piece / b_piece). A piece on a square
 * its color's list doesn't name keeps its facing (a move the list hasn't caught up with yet already turned it, animateMove)
 * @param  {[object]} facings [{ w: { square: "up" | "down" | null }, b: { ... } }, "up" toward rank 8, null hasn't moved up or down]
 */
export function setFacing(facings) {
	if (!view) { return; }
	for (const [square, mesh] of view.pieces) {
		const list = facings[mesh.userData.color] || {};
		if (!(square in list)) { continue; }
		const dir = list[square];
		mesh.userData.yaw = dir ? yawToward(dir === "up") : undefined;
		if (!view.held || view.held.mesh !== mesh || !view.held.following) { setYaw(mesh, storedYaw(mesh), false); }
	}
	requestRender();
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
	const dragged = view.held && view.held.following ? view.held.mesh : null; // THE DRAGGED PIECE IS UNDER THE POINTER, THE SQUARE IS UNDER IT
	const targets = [...view.pieces.values()].filter((mesh) => mesh !== dragged);
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
		setLabels(color);
		return;
	}
	const from = cameraAzimuth();
	view.cameraTurn = { from, to: from + Math.atan2(Math.sin(angle - from), Math.cos(angle - from)), start: null };
	requestRender();
}

/**
 * @description Lands every moving piece & a Flip Board turn in progress at once (reduce motion turned on mid-move)
 */
export function stopMotion() {
	if (!view) { return; }
	finishAnims();
	if (view.cameraTurn) {
		turnCamera(view.cameraTurn.to);
		setLabels(view.side);
		view.cameraTurn = null;
	}
	requestRender();
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
	setLabels(color);
	requestRender();
}

/**
 * @description Marks squares in one style, replacing that style's last marks. highlight([], kind) clears it
 * @param  {[string[]]} squares [["e4", ...]]
 * @param  {[string]} kind ["legal", "capture", "last" (last move), "check", "hint" or "focus" (the keyboard's square, a ring)]
 */
export function highlight(squares, kind) {
	if (!HIGHLIGHTS[kind]) { throw new Error(`Bad highlight kind: ${kind}`); }
	if (!view) { return; }
	const { geometry, material, y, meshes } = view.marks[kind];
	for (const [square, mesh] of meshes) { mesh.visible = squares.includes(square); }
	for (const square of squares) {
		if (meshes.has(square)) { continue; }
		const mesh = new Mesh(geometry, material); // ONE PER SQUARE, MADE THE FIRST TIME IT'S MARKED
		mesh.position.set(center(fileOf(square)), y, center(rowOf(square)));
		view.scene.add(mesh);
		meshes.set(square, mesh);
	}
	requestRender();
}

/**
 * @description Lifts the piece the player picked up, like the 2D board: clicked, it floats over its square until it's put down or moved,
 * dragged (pressed & moved past the drag threshold), it floats over the square under the pointer, the one a drop lands on (squareUnder),
 * or under the pointer on the table off the board. No animation, the 2D lift is instant too, so reduce motion needs nothing.
 * A dropped piece that's moving slides down from where it was let go (animateMove), call this after it
 * @param  {[string|null]} square [the held piece's square, null when nothing is held (it's put back down)]
 * @param  {[boolean]} dragging [the press is still down, so moving the pointer drags it]
 */
export function setHeld(square, dragging) {
	if (!view) { return; }
	const mesh = (square && view.pieces.get(square)) || null;
	const held = view.held;
	if (held && held.mesh === mesh && held.dragging === Boolean(dragging)) { return; } // UNCHANGED: A DRAG KEEPS FOLLOWING
	if (held && held.mesh !== mesh) { putDownHeld(); }
	view.held = mesh ? { mesh, dragging: Boolean(dragging), following: false } : null;
	if (view.held) { liftHeld(); }
}

// PUTS THE HELD PIECE BACK ON ITS SQUARE, UNLESS IT'S ALREADY SLIDING AWAY (A DROPPED MOVE) OR GONE (TAKEN, SYNCED AWAY)
function putDownHeld() {
	const held = view.held;
	view.held = null;
	if (!held) { return; }
	const { mesh } = held;
	if ([...view.anims].some((anim) => anim.mesh === mesh) || view.pieces.get(mesh.userData.square) !== mesh) { requestRender(); return; }
	place(mesh, mesh.userData.square);
	setYaw(mesh, storedYaw(mesh), false); // A DRAG MAY HAVE TURNED IT
	requestRender();
}

// FLOATS THE HELD PIECE OVER ITS SQUARE, OR WHERE IT'S DRAGGED (dragPoint)
function liftHeld() {
	const { mesh, following } = view.held;
	const at = following ? dragPoint() : null;
	const square = mesh.userData.square;
	mesh.position.set(at ? at.x : center(fileOf(square)), LIFT_HEIGHT, at ? at.z : center(rowOf(square)));
	const dz = at ? at.z - center(rowOf(square)) : 0; // DRAGGED OFF ITS RANK: FACES THE WAY IT'S DRAGGED (2D's drawPiece)
	setYaw(mesh, Math.abs(dz) > CELL_SIZE / 2 ? yawToward(dz < 0) : storedYaw(mesh), false);
	updateShadow(mesh);
	requestRender();
}

// WHERE A DRAGGED PIECE FLOATS: THE CENTER OF THE SQUARE UNDER THE POINTER (2D SNAPS IT TO SQUARES TOO), OFF THE BOARD THE POINT UNDER
// THE POINTER ON THE TABLE, KEPT WITHIN A SQUARE OF THE EDGE. null WHEN THE POINTER ISN'T OVER THE TABLE (AT THE HORIZON)
function dragPoint() {
	const pointerEvent = { clientX: view.pointerAt.x, clientY: view.pointerAt.y };
	const square = squareUnder(pointerEvent);
	if (square) { return { x: center(fileOf(square)), z: center(rowOf(square)) }; }
	if (!raycaster.ray.intersectPlane(table, tablePoint)) { return null; } // squareUnder() JUST AIMED THE RAY AT THE POINTER
	const edge = BOARD_SIZE / 2 + CELL_SIZE;
	return { x: MathUtils.clamp(tablePoint.x, -edge, edge), z: MathUtils.clamp(tablePoint.z, -edge, edge) };
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
		requestRender();
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
	faceTravel(mesh, from, to); // TURNS AS IT STARTS SLIDING, LIKE 2D
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
