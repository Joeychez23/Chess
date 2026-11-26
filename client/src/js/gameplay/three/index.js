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
	MeshBasicMaterial, Mesh, TextureLoader, SRGBColorSpace, LinearMipmapLinearFilter, GridHelper, Raycaster, Vector2, Vector3,
	Spherical, MathUtils, RingGeometry, Plane
} from "three";

import { createPiece, updateShadow, disposePiece } from "./pieces.js";
import { createSurroundings, orientLabels } from "./board.js";
import { BAIZE_FOG } from "./materials.js";
import { createRoom, turnRoom, disposeRoom } from "./room.js"; // The library around the board and its CRT monitor
import { pileSpots } from "./piles.js"; // Where the taken pieces stand on the desk
import { createCards } from "./cards.js"; // The promotion cards on the desk
import { createCardTable, deskInView } from "./cardTable.js"; // A Chess Cards game's hands, decks and board effects
import { createAnimations } from "./animations.js"; // Their slides

import { createScreen, setScreen as showOnScreen, setFace as showFace, pauseScreen, disposeScreen, setMonitorView } from "./screen.js";
import { createMonitor } from "./monitor/monitor.js"; // The monitor as the game's menu: its states, buttons and keys
import { loadPrefs, savePrefs } from "./monitor/prefs.js";
import { createFire, stepFire, pauseFire, disposeFire } from "./fire.js"; // The fireplace's flames, embers and flicker
import { createClock, stepClock, pauseClock, disposeClock } from "./clock.js"; // The longcase clock's hands and pendulum, at the local time
import { reportError } from "../../pages/utils/reportErrors.js";
import { showHint, removeHint } from "./hint.js";
import { perfStart, perfStop, perfFrame, perfMoving, perfLost } from "./perf.js"; // ?perf=1's readout for phone tests
export { perfLoaded } from "./perf.js"; // load.js gives it the chunk's download time
import "../../../css/board3D.css"; // #board3D, the controls hint and the perf readout: in this chunk, not the play bundle

import {
	resize, frameDeal, unframeDeal, framePile, placeCamera, stepCamera, landTurn, sideAngle, stepZoom, openCardCamera
} from "./camera.js";
import {
	createControls, onPointerDown, onPointerMove, onPointerUp, monitorIdle, monitorInput, onMonitorShow, onPointerLeave, onClick,
	onTouchTap, onKeyDown, rehoverPlaque
} from "./pointer.js";
import { putDownHeld, stepAnim, finishAnims, animate } from "./motion.js";
import { followCamera } from "./tileHover.js";
import { leftBoard } from "./lean.js"; // Auto Lean forgets the pointer was on this board (unmount)
// A Chess Cards piece's statuses, as effects or badges
import { stepStatuses, clearStatuses, focusStatuses } from "./statusFx/index.js";
export { syncStatuses, holdStatuses, pickStatuses } from "./statusFx/index.js";
import { tileAt } from "./hoverRules.js"; // The tile under a point on the board (squareUnder)
import { renderFrame, disposeBloom } from "./bloom.js"; // Draws the frame, with selective bloom on the status effects' glow

export { isCameraGesture, setSide, resetCamera } from "./camera.js";
export { setMonitor, enterMonitor, leaveMonitor, monitorState, focusMonitor } from "./pointer.js";
export { setPickable } from "./tileHover.js";
export { setHeld, dropHeld, animateMove, animateUndo, glideHome } from "./motion.js";
export { playBoardStep } from "./motion.js"; // A Chess Cards answer's board steps (renderer/ boardStep3D)
import {
	BOARD_SIZE, CELL_SIZE, PIECE_SIZE, FILES, DESK_Y, ROOM_BACKGROUND, BOARD_IMAGE, HIGHLIGHTS, FOCUS_RING, NEAR, REDUCE, NO_MONITOR,
	LABEL, FOV
} from "./constants.js";

export let view = null; // Everything one mount() made, null when unmounted
export const raycaster = new Raycaster();
export const pointer = new Vector2(); // Normalized device coords (-1..1)
export const offset = new Vector3(); // Camera position minus what it looks at
export const spherical = new Spherical(); // offset as distance, tilt and angle around the board
export const fitCamera = new PerspectiveCamera(); // smallScreenCamera()'s stand-in, the real one stays where the player put it
export const corner = new Vector3();
export const table = new Plane(new Vector3(0, 1, 0), 0); // The board's surface, a dragged piece off the board follows the pointer on it
export const tablePoint = new Vector3();
export const UP = new Vector3(0, 1, 0);
export const glassCentre = new Vector3(); // zoomSpot()'s scratch
export const glassNormal = new Vector3();
export const glassSize = new Vector3();
export const glassScale = new Vector3();
export const forward = new Vector3(); // The camera's view direction, glassHit()'s
export const dealShift = new Vector3(); // framedSpot()'s scratch

/* ---------------------------------------------------------------- */
// Squares
/* ---------------------------------------------------------------- */

// 0 - 7, a - h
export function fileOf(square) {
	return FILES.indexOf(square[0]);
}

// 0 - 7, rank 8 - rank 1 (chess.js board() order)
export function rowOf(square) {
	return 8 - Number(square[1]);
}

// Grid index -> world coordinate of that square's center
export function center(i) {
	return -BOARD_SIZE / 2 + CELL_SIZE * (i + 0.5);
}

// World coordinate -> grid index, clamped onto the board
export function toCell(coordinate) {
	return MathUtils.clamp(Math.floor((coordinate + BOARD_SIZE / 2) / CELL_SIZE), 0, 7);
}

// Puts a mesh on a square, both in view.pieces and in the scene
export function place(mesh, square) {
	view.pieces.set(square, mesh);
	mesh.userData.square = square;
	mesh.position.set(center(fileOf(square)), 0, center(rowOf(square)));
	// An unmoved knight faces the middle of its square's row
	if (mesh.userData.type === "n" && mesh.userData.yaw === undefined) { mesh.rotation.y = startYaw(mesh); }
	updateShadow(mesh);
}

// King, queen, bishop and rook face the way they last moved up or down the board, as in 2D (draw/facing.js
// awayFromRows): toward rank 8 (-Z) is rotation.y PI (model fronts face +Z), toward rank 1 is 0. One that hasn't moved
// faces the other side (createPiece). World sides, so a flip changes nothing.
// Knights face the way they last moved left or right (draw/facing.js rightFromFiles): the nose is +X, so toward the
// h-file is 0, toward the a-file PI. One that hasn't moved faces the middle (a - d face the h-file, e - h the a-file), as
// 2D's start (draw/facing.js startsRight). Pawns never turn
const FACING_PIECES = /[kqbrn]/;

export function yawToward(rankUp) {
	return (rankUp ? Math.PI : 0);
}

export function yawSide(towardH) {
	return (towardH ? 0 : Math.PI);
}

function startYaw(mesh) {
	return (mesh.userData.type === "n" ? yawSide(fileOf(mesh.userData.square) < 4) : yawToward(mesh.userData.color === "w"));
}

export function storedYaw(mesh) {
	return mesh.userData.yaw ?? startYaw(mesh);
}

export function setYaw(mesh, yaw, store) {
	if (!FACING_PIECES.test(mesh.userData.type)) { return; }
	if (store) { mesh.userData.yaw = yaw; }
	mesh.rotation.y = yaw;
}

// Turns a king, queen, bishop or rook the way a move goes up or down, a sideways move keeps its facing. A knight turns
// left or right
export function faceTravel(mesh, from, to) {
	if (mesh.userData.type === "n") { setYaw(mesh, yawSide(fileOf(to) > fileOf(from)), true); }
	else if (from[1] !== to[1]) { setYaw(mesh, yawToward(Number(to[1]) > Number(from[1])), true); }
}

export function addPiece(type, color) {
	const mesh = createPiece(type, color, PIECE_SIZE);
	view.scene.add(mesh);
	return mesh;
}

export function removePiece(mesh) {
	view.scene.remove(mesh);
	disposePiece(mesh);
}

/* ---------------------------------------------------------------- */
// Piles
/* ---------------------------------------------------------------- */

const SHADOW_LIFT = 0.015; // A pile shadow's height over its surface, pieces.js SHADOW_Y

// The baize table's height when the room isn't in
function pileY() {
	return (view.room ? DESK_Y : view.surroundings.userData.table.position.y);
}

// How createPiece turns a piece on its square
export function homeYaw(type, color) {
	return (color === "w" ? Math.PI : 0) - (type === "n" ? Math.PI / 2 : 0);
}

// Keeps a piece's shadow on the surface under it, mesh.userData.ground (updateShadow() keeps it at board height). Call
// after updateShadow()
export function shadeOnGround(mesh) {
	const shadow = mesh.getObjectByName("shadow");
	shadow.position.y = (mesh.userData.ground + SHADOW_LIFT - mesh.position.y) / mesh.scale.y;
}

// Puts a mesh where its pile spot says, on the desk (or the table)
function settle(mesh, spot) {
	view.taken.set(spot.key, mesh);
	mesh.userData.spot = spot.key;
	mesh.userData.ground = pileY();
	mesh.userData.yaw = undefined;
	mesh.position.set(spot.x, mesh.userData.ground, spot.z);
	mesh.rotation.y = spot.yaw;
	updateShadow(mesh);
	shadeOnGround(mesh);
}

// The order of the piles' slots: far0, far1, ..., near0, ...
export function slotOf(key) {
	return Number(key.replace(/\D/g, ""));
}

/**
 * @description Downloads the library & puts it around the board in place of the baize table. The board is already up &
 * playable: one that fails or times out is reported & the baize stays. Phones get the desk & monitor only
 * @param  {[object]} mountedView [the view it's for, a board unmounted meanwhile gets nothing]
 */
async function addRoom(mountedView) {
	try {
		const { group, screen, fire, clock, card } = await createRoom({
			phone: mountedView.phone,
			anisotropy: Math.min(mountedView.renderer.capabilities.getMaxAnisotropy(), 4)
		});
		if (view !== mountedView) { return; } // Unmounted (or rebuilt) while it loaded
		mountedView.room = group;
		mountedView.scene.add(group);
		for (const mesh of mountedView.taken.values()) { // The piles stand on the desk now, not the baize
			mesh.userData.ground = DESK_Y;
			mesh.position.y = DESK_Y;
			updateShadow(mesh);
			shadeOnGround(mesh);
		}
		// And a piece on its way there lands on it
		for (const anim of mountedView.anims) {
			if (anim.y1 !== 0 && anim.mesh.userData.spot) { anim.y1 = DESK_Y; }
		}
		mountedView.surroundings.userData.table.visible = false; // The desk takes the baize's place
		mountedView.scene.fog = null; // The walls are the edge now, fog would hide them
		mountedView.scene.background = new Color(ROOM_BACKGROUND);
		mountedView.container.style.backgroundColor = mountedView.scene.background.getStyle();
		turnRoom(group, mountedView.cameraTurn ? mountedView.cameraTurn.roomFrom : sideAngle(mountedView.side));
		createScreen(screen, requestRender);
		if (mountedView.screenState) { showOnScreen(mountedView.screenState); }
		if (mountedView.screenFace) { showFace(mountedView.screenFace); }
		mountedView.glass = screen;
		mountedView.monitor = createMonitor({
			show: () => onMonitorShow(mountedView),
			announce: (text) => mountedView.monitorOptions.announce(text),
			handlers: mountedView.monitorOptions.handlers || {},
			loadPrefs,
			savePrefs,
			reduce: () => REDUCE.matches
		});
		mountedView.monitorSeen = "idle";
		setMonitorView(mountedView.monitor.view);
		if (mountedView.monitorData) { mountedView.monitor.update(monitorInput(mountedView.monitorData)); }
		mountedView.monitorOptions.onChange({ ready: true, state: "idle" });
		pauseScreen(document.hidden || mountedView.lost);
		if (fire) { // Not on phones: they have no fireplace
			createFire(fire, requestRender);
			pauseFire(document.hidden || mountedView.lost);
		}
		if (clock) { // Not on phones either: the clock is in the room
			createClock(clock, requestRender);
			pauseClock(document.hidden || mountedView.lost);
		}
		if (card) { // Not in an old library.glb: the flat picker stays
			mountedView.cards = createCards({
				template: card,
				room: group,
				animations: mountedView.animations,
				requestRender,
				still: () => REDUCE.matches
			});
			if (mountedView.cards && mountedView.promotion) { // A promotion asked for while the room loaded
				mountedView.cards.deal(mountedView.promotion.color, false);
				frameDeal(false);
			}
			mountedView.cardTemplate = card;
			if (mountedView.tableArgs) { setCardTable(...mountedView.tableArgs); } // A card game's table asked for while the room loaded
		}
		requestRender();
	} catch (error) {
		console.warn("3D library didn't load, staying on the baize table", error);
		reportError(`3D library couldn't load: ${error.message}`, "3d-board");
		if (view !== mountedView) { return; }
		if (mountedView.monitor) { // Made before what threw: no menu on a half built room
			mountedView.monitor.reset();
			mountedView.monitor = null;
			setMonitorView(null);
		}
		mountedView.monitorOptions.onChange({ ready: false, state: null });
	}
}

// Turns the a-h / 1-8 labels to read from color's side, as the 2D board's do
export function setLabels(color) {
	if (view.labelSide === color) { return; }
	view.labelSide = color;
	orientLabels(view.surroundings, color);
}

/* ---------------------------------------------------------------- */
// Rendering
/* ---------------------------------------------------------------- */

// Draws on demand: asks for one frame when something changed (a few calls before it runs still draw once). Nothing
// while the tab is hidden, visibilitychange draws on the way back. An idle board draws nothing
export function requestRender() {
	if (!view || view.frameId !== null || document.hidden || view.lost) { return; }
	view.frameId = requestAnimationFrame(frame);
}

// One frame: step the moving pieces and camera, then draw. Asks for the next only while something is still moving
function frame(now) {
	view.frameId = null;
	perfMoving(now, view.anims.size > 0 || Boolean(view.cameraTurn) || Boolean(view.zoom) || view.animations.active());
	for (const anim of [...view.anims]) { stepAnim(anim, now); }
	view.animations.step(now);
	if (view.cameraTurn) { stepCamera(now); }
	if (view.zoom) { stepZoom(now); }
	// Still gliding: its "change" asks for the next frame. Not at the monitor: it would aim the camera back at the board
	const gliding = view.controls.enableDamping && !view.zoom && monitorIdle() && view.controls.update();
	followCamera(gliding); // The hover box stays under a still pointer while the camera moves by itself
	stepFire(now, view.renderer.domElement.height); // Its own timer asks for its frames (fire.js)
	stepClock(); // So does the clock's (clock.js)
	stepStatuses(now); // And the status effects' (statusFx/index.js)
	renderFrame(view);
	if (view.textureReady) { view.markDrawn(); } // Only the first call counts
	perfFrame(now);
	if (view.anims.size || view.cameraTurn || view.zoom || view.animations.active()) { requestRender(); }
}

function onVisibility() {
	pauseScreen(document.hidden); // The monitor's face stops blinking in a hidden tab
	pauseFire(document.hidden); // And the fire stops asking for frames
	pauseClock(document.hidden); // And the clock
	if (!document.hidden) {
		requestRender();
		return;
	}
	cancelAnimationFrame(view.frameId);
	view.frameId = null;
}

// The browser took the GPU back (iPhones do when the page is backgrounded or low on memory). preventDefault() lets it
// be restored. Nothing draws until the caller (renderer/) puts up a new board
function onContextLost(e) {
	e.preventDefault();
	perfLost();
	view.lost = true;
	pauseScreen(true);
	pauseFire(true);
	pauseClock(true);
	cancelAnimationFrame(view.frameId);
	view.frameId = null;
	finishAnims(); // Their promises resolve, the game doesn't wait on a board that can't draw
	view.animations.finish();
	if (view.monitor) { view.monitor.reset(); } // Straight back to the desk: onMonitorShow() puts the camera back and the controls on
	view.zoom = null;
	view.controls.enabled = true;
	view.onContextLost();
}

function onContextRestored() {
	view.onContextRestored();
}

/**
 * @description Creates the renderer, scene, board & lights inside container & starts drawing. Throws if WebGL is
 * unavailable
 * @param  {[HTMLElement]} container [what the 3D canvas fills, sized by CSS]
 * @param  {[object]} events [{ onContextLost, onContextRestored, monitor, cards }: the WebGL context went away / came
 * back, the board stops drawing when it's lost & the caller puts up a new one (unmount() then mount()). monitor:
 * { handlers (what its buttons call, monitor.js), announce(text) (for the screen reader), onChange({ ready, state })
 * (the monitor came up, went away or changed state) }. cards: { onPick(type) (a promotion card was picked, "q", "r",
 * "b" or "n"), onTable(hit) (a Chess Cards game: a hand card { kind: "hand", id } or a square { kind: "square", square }
 * was picked), tableOn() (false: the table's taps go to the page, the menu is open) }]
 */
export function mount(container, {
	onContextLost: lost = () => {},
	onContextRestored: restored = () => {},
	monitor = null,
	cards = null
} = {}) {
	if (view) { return; }
	const phone = window.matchMedia("(pointer: coarse)").matches; // Touch-first screen: the cheaper scene (no fog, lower pixel ratio)
	const renderer = new WebGLRenderer({ antialias: true, powerPreference: phone ? "low-power" : "default" });
	// A Frozen crust's refraction pass redraws the opaque scene: at half size it costs a quarter
	renderer.transmissionResolutionScale = 0.5;
	const canvas = renderer.domElement;
	canvas.style.display = "block";
	canvas.style.width = canvas.style.height = "100%";
	canvas.setAttribute("role", "img");
	canvas.setAttribute("aria-label", LABEL);
	const scene = new Scene();
	scene.background = new Color(BAIZE_FOG);
	if (!phone) { scene.fog = new Fog(BAIZE_FOG, 50, 150); } // Past the baize table, fade into the background
	const camera = new PerspectiveCamera(FOV, 1, NEAR, 1000); // Placed below (placeCamera), White's side until setSide()
	const fill = new HemisphereLight(0xFFF4E0, 0x3A2A1A, 1.2); // Fill: warm sky, dark wood bounce, no shadow maps
	const keyLight = new DirectionalLight(0xFFFFFF, 2.2); // Key: high and to White's left
	// On every layer: bloom.js's glow draw (BLOOM_LAYER only) sees the same lights, so lit materials don't re-acquire
	// programs each bloomed frame
	fill.layers.enableAll();
	keyLight.layers.enableAll();
	scene.add(fill);
	keyLight.position.set(-10, 25, 15);
	scene.add(keyLight);
	// Draws again when the squares arrive (or fail to: the board is still playable), that frame is whenDrawn()'s
	const squaresIn = function () {
		if (!view || view.plane.material.map !== boardTexture) { return; } // A board unmounted since
		view.textureReady = true;
		requestRender();
	};
	const boardTexture = new TextureLoader().load(BOARD_IMAGE, squaresIn, undefined, squaresIn);
	boardTexture.colorSpace = SRGBColorSpace; // Colors match the 2D board
	boardTexture.minFilter = LinearMipmapLinearFilter;
	boardTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8); // Sharp at the camera's low angle
	const plane = new Mesh(new PlaneGeometry(BOARD_SIZE, BOARD_SIZE), new MeshStandardMaterial({ map: boardTexture }));
	plane.rotation.x = -0.5 * Math.PI; // Lay it flat
	const surroundings = createSurroundings(BOARD_SIZE); // Its labels start on White's side
	scene.add(plane, surroundings);
	const grid = new GridHelper(BOARD_SIZE, 8);
	grid.position.y = 0.01; // Just above the board, no z-fighting
	scene.add(grid);
	const markGeometry = new PlaneGeometry(CELL_SIZE * 0.9, CELL_SIZE * 0.9).rotateX(-0.5 * Math.PI);
	// 4 segments from 45 degrees: a square ring, corners on the diagonals
	const [inner, outer] = FOCUS_RING.map((share) => share * CELL_SIZE * Math.SQRT2);
	const ringGeometry = new RingGeometry(inner, outer, 4, 1, Math.PI / 4).rotateX(-0.5 * Math.PI);
	const marks = {};
	Object.keys(HIGHLIGHTS).forEach(function (kind, i) {
		const [color, opacity] = HIGHLIGHTS[kind];
		marks[kind] = {
			geometry: kind === "focus" || kind === "cardFocus" ? ringGeometry : markGeometry,
			material: new MeshBasicMaterial({ color, opacity, transparent: true, depthWrite: false }),
			y: 0.02 + i * 0.002, // Each kind a little higher than the last, so marks on one square never z-fight
			meshes: new Map()
		};
	});
	view = {
		taken: new Map(), // Pile key -> mesh
		arriving: new Set(), // Taken off the board, waiting for setTaken
		phone,
		container,
		renderer,
		scene,
		camera,
		plane,
		surroundings,
		marks,
		pieces: new Map(),
		anims: new Set(),
		side: "w", // The side the camera is on (or turning to)
		labelSide: "w", // The side the labels read from
		cameraTurn: null, // Flip Board's turn in progress { from, to, start }
		frameId: null // The requestRender() frame waiting to run
	};
	Object.assign(view, {
		small: null,
		lost: false,
		onContextLost: lost,
		onContextRestored: restored,
		held: null, // The picked up piece (setHeld) { mesh, dragging, following }
		room: null, // The library once it's loaded (addRoom)
		screenState: null, // screenState and screenFace: what its monitor was last told
		screenFace: null
	});
	Object.assign(view, {
		monitorOptions: { ...NO_MONITOR, ...(monitor || {}) },
		monitor: null, // Its state machine once the room has loaded
		monitorData: null, // What setMonitor() was last told
		monitorSeen: "idle",
		glass: null,
		zoom: null, // The camera's move to or from the glass
		home: null, // Where it was on the desk
		zoomLook: new Vector3(), // What it looks at meanwhile
		leaving: [] // leaveMonitor()'s resolves
	});
	Object.assign(view, {
		animations: createAnimations(requestRender), // The cards' slides and the camera's deal moves (stepped in frame)
		cards: null, // The promotion cards once the room has loaded (a room without them leaves null)
		cardOptions: { onPick() {}, onTable() {}, tableOn: () => true, ...(cards || {}) },
		promotion: null, // { color } while one is asked for
		cardCursor: false, // The hand cursor is a card's
		dealHome: null, // Where the camera was before it framed a deal { position, target, maxDistance, back }
		dealEase: null, // The camera's deal move running (moveDealCamera)
		cardTemplate: null,
		table: null, // A Chess Cards game's table (setCardTable) once the room has loaded
		tableArgs: null, // tableArgs, tableLifted and tableDuel: what it was last told
		tableLifted: null,
		tableDuel: null
	});
	view.drawn = new Promise((resolve) => { view.markDrawn = resolve; }); // whenDrawn(): the first frame with the squares in (textureReady)
	view.textureReady = false;
	Object.assign(view, {
		controls: createControls(camera, canvas),
		controlsActive: false,
		cameraGesture: false, // The camera controls own the pointer
		press: { x: 0, y: 0, time: 0 },
		pointerAt: { x: 0, y: 0 },
		pointerOver: false,
		pickable: null,
		playerColor: null, // The player's side (setPickable): only its pieces lift on hover
		pointerType: null,
		touches: new Set(), // The fingers down (pointerId)
		multiTouch: false // More than one was, since all were up
	});
	container.style.backgroundColor = scene.background.getStyle(); // The safe area padding (under a notch) is the scene's background
	view.observer = new ResizeObserver(resize);
	view.observer.observe(container);
	window.addEventListener("orientationchange", resize); // Some mobile browsers report the new size late
	container.appendChild(canvas);
	resize(); // First: a small screen's camera (view.small) is fit to the size
	placeCamera(0);
	container.addEventListener("pointerdown", onPointerDown, true);
	container.addEventListener("pointermove", onPointerMove, true);
	container.addEventListener("pointerleave", onPointerLeave);
	container.addEventListener("click", onClick, true);
	container.addEventListener("pointerup", onTouchTap, true);
	window.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("pointerup", onPointerUp);
	window.addEventListener("pointercancel", onPointerUp);
	canvas.addEventListener("webglcontextlost", onContextLost);
	canvas.addEventListener("webglcontextrestored", onContextRestored);
	document.addEventListener("visibilitychange", onVisibility);
	requestRender();
	showHint(); // The first time 3D opens
	perfStart({ renderer, camera, squareCorners });
	addRoom(view); // Not awaited: the board never waits on the room
}

// A square's 4 corners on the board, for perf.js
function squareCorners(square) {
	const x = center(fileOf(square));
	const z = center(rowOf(square));
	const d = CELL_SIZE / 2;
	return [[-d, -d], [-d, d], [d, -d], [d, d]].map(([dx, dz]) => new Vector3(x + dx, 0, z + dz));
}

/**
 * @description Resolves after the first frame drawn with the board's squares in, so the page can fade in on a whole
 * board. Never, for a board that loses its context or is unmounted first (the caller times out)
 * @return {[Promise<void>]}
 */
export function whenDrawn() {
	return view ? view.drawn : Promise.resolve();
}

/**
 * @description Removes the 3D canvas & frees everything mount() made: listeners, geometries, materials, textures & the
 * WebGL context. Moves still animating finish at once (their promises resolve)
 */
export function unmount() {
	if (!view) { return; }
	leftBoard();
	finishAnims();
	clearStatuses(); // Before the pieces go: no bursts, its frame timer stops
	disposeBloom(); // Its composers hold this renderer, scene and camera
	view.animations.finish();
	if (view.cards) { view.cards.dispose(); }
	if (view.table) { view.table.dispose(); }
	[...view.taken.values(), ...view.arriving].forEach(removePiece);
	view.taken.clear();
	view.arriving.clear();
	removeHint();
	perfStop();
	disposeScreen();
	setMonitorView(null); // After disposeScreen(): nothing left to redraw
	const { leaving, monitor, monitorOptions } = view;
	disposeFire();
	disposeClock();
	disposeRoom();
	const { renderer, scene, observer, controls, container } = view;
	cancelAnimationFrame(view.frameId);
	document.removeEventListener("visibilitychange", onVisibility);
	observer.disconnect();
	clearTimeout(view.cardSettle); // A window drag's pending opening-spot solve (camera.js resize)
	controls.dispose();
	window.removeEventListener("orientationchange", resize);
	container.removeEventListener("pointerdown", onPointerDown, true);
	container.removeEventListener("pointermove", onPointerMove, true);
	container.removeEventListener("pointerleave", onPointerLeave);
	container.removeEventListener("click", onClick, true);
	container.removeEventListener("pointerup", onTouchTap, true);
	container.style.cursor = ""; // The glass's hand cursor
	window.removeEventListener("keydown", onKeyDown, true);
	window.removeEventListener("pointerup", onPointerUp);
	window.removeEventListener("pointercancel", onPointerUp);
	renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
	renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
	const freed = new Set();
	scene.traverse(function (object) {
		if (object.geometry) { freed.add(object.geometry); }
		for (const material of [].concat(object.material || [])) {
			freed.add(material);
			if (material.map) { freed.add(material.map); }
			if (material.lightMap) { freed.add(material.lightMap); } // The room's baked light
			if (material.userData.fireMap) { freed.add(material.userData.fireMap); } // And its baked firelight
		}
	});
	// Shared ones (piece geometry, woods) only lose their GPU copy, the next mount() re-uploads them
	freed.forEach((resource) => resource.dispose());
	renderer.domElement.remove();
	renderer.dispose();
	if (!view.lost) { renderer.forceContextLoss(); } // A lost context has nothing left to free
	view = null;
	leaving.forEach((resolve) => resolve()); // Nothing to wait for on a board that's gone
	if (monitor) { monitorOptions.onChange({ ready: false, state: null }); }
}

/* ---------------------------------------------------------------- */
// Pieces
/* ---------------------------------------------------------------- */

/**
 * @description Places the pieces to match the position, reusing meshes already right or moving spare ones. After load,
 * takebacks & restarts
 * @param  {[Chess]} chessInst [the chess.js instance, only its board() is read]
 */
export function syncFromBoard(chessInst) {
	if (!view) { return; }
	finishAnims();
	putDownHeld(); // On its square before the meshes are sorted, setHeld() lifts it again if it's still held
	const want = new Map(); // Square -> { type, color } still to place
	for (const row of chessInst.board()) {
		for (const piece of row) {
			if (piece) { want.set(piece.square, piece); }
		}
	}
	const spare = []; // Meshes on a square that changed
	for (const [square, mesh] of view.pieces) {
		const piece = want.get(square);
		if (piece && piece.type === mesh.userData.type && piece.color === mesh.userData.color) {
			want.delete(square);
			continue;
		}
		view.pieces.delete(square);
		spare.push(mesh);
	}
	for (const [square, piece] of want) {
		const index = spare.findIndex((mesh) => mesh.userData.type === piece.type && mesh.userData.color === piece.color);
		place(index >= 0 ? spare.splice(index, 1)[0] : addPiece(piece.type, piece.color), square);
	}
	spare.forEach(removePiece);
	view.arriving.forEach(removePiece); // A taken piece setTaken() never claimed
	view.arriving.clear();
	requestRender();
}

/**
 * @description Turns the kings, queens, bishops, rooks & knights the way the 2D board's lists say (w_piece / b_piece,
 * w_knight / b_knight). A piece on a square its color's list doesn't name keeps its facing (a move the list hasn't
 * caught up with yet already turned it, animateMove)
 * @param  {[object]} facings [{ w: { square: "up" | "down" | "left" | "right" | null }, b: { ... } }, "up" toward rank 8,
 * "right" toward the h-file, null hasn't moved]
 */
export function setFacing(facings) {
	if (!view) { return; }
	for (const [square, mesh] of view.pieces) {
		const list = facings[mesh.userData.color] || {};
		if (!(square in list)) { continue; }
		const dir = list[square];
		mesh.userData.yaw = !dir ? undefined : dir === "left" || dir === "right" ? yawSide(dir === "right") : yawToward(dir === "up");
		if (!view.held || view.held.mesh !== mesh || !view.held.following) { setYaw(mesh, storedYaw(mesh), false); }
	}
	requestRender();
}

/**
 * @description Which tile a pointer event is over. The board is picked by tile, never through a piece's body: a tall
 * piece in front doesn't take the tile behind it
 * @param  {[PointerEvent|MouseEvent]} e [any event with clientX & clientY]
 * @return {[string|null]} ["e4", or null when it's off the board or nothing is mounted]
 */
export function squareUnder(e) {
	if (!view || !monitorIdle()) { return null; } // At the monitor the board takes no input
	const rect = view.renderer.domElement.getBoundingClientRect();
	pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
	raycaster.setFromCamera(pointer, view.camera);
	const hit = raycaster.intersectObject(view.plane, false)[0];
	return hit ? tileAt(hit.point.x, hit.point.z, BOARD_SIZE) : null;
}

/**
 * @description Lands every moving piece, a Flip Board turn & a zoom to or from the monitor in progress at once (reduce
 * motion turned on mid-move)
 */
export function stopMotion() {
	if (!view) { return; }
	finishAnims();
	view.animations.finish();
	landTurn();
	if (view.zoom) { stepZoom(Infinity); }
	requestRender();
}

/**
 * @description What the library's monitor shows (three/screen.js setScreen). Kept until the room has loaded, nothing on
 * a board with no monitor
 * @param  {[object]} state { name, status, ai, thinking }
 */
export function setScreen(state) {
	if (!view) { return; }
	view.screenState = state;
	showOnScreen(state);
	// Its name and status are the monitor's data too
	if (view.monitor && view.monitorData) { view.monitor.update(monitorInput(view.monitorData)); }
}

/**
 * @description The monitor's face reacts (AI games, three/screen.js setFace). The last one is kept until the room has
 * loaded
 * @param  {[string]} name [a face in three/faces.js]
 */
export function setFace(name) {
	if (!view) { return; }
	view.screenFace = name;
	showFace(name);
}

/**
 * @description Marks squares in one style, replacing that style's last marks. highlight([], kind) clears it
 * @param  {[string[]]} squares [["e4", ...]]
 * @param  {[string]} kind ["legal", "capture", "last" (last move), "check", "hint" or "focus" (the keyboard's square, a
 * ring)]
 */
export function highlight(squares, kind) {
	if (!HIGHLIGHTS[kind]) { throw new Error(`Bad highlight kind: ${kind}`); }
	if (!view) { return; }
	const { geometry, material, y, meshes } = view.marks[kind];
	for (const [square, mesh] of meshes) { mesh.visible = squares.includes(square); }
	for (const square of squares) {
		if (meshes.has(square)) { continue; }
		const mesh = new Mesh(geometry, material); // One per square, made the first time it's marked
		mesh.position.set(center(fileOf(square)), y, center(rowOf(square)));
		view.scene.add(mesh);
		meshes.set(square, mesh);
	}
	requestRender();
}

/**
 * @description Whether the room's promotion cards are in, so they can be the picker. False before the room loads, with
 * an old library.glb or no room
 * @return {[boolean]}
 */
export function hasCards() {
	return Boolean(view && view.cards);
}

/**
 * @description A promotion is asked for (the cards slide from the deck into the strip) or over (they slide back). Kept
 * until the room has loaded. A camera that can't see the strip frames the board & the cards meanwhile (frameDeal), then
 * goes back where it was
 * @param  {[string|null]} color ["w" or "b", the player's colour, null for none]
 * @param  {[boolean]} animate [false sets the cards at once (reduce motion)]
 */
export function setPromotion(color, animate) {
	if (!view) { return; }
	view.promotion = color ? { color } : null;
	if (!view.cards) { return; }
	if (color) {
		view.cards.deal(color, animate);
		frameDeal(animate); // A camera that can't see the cards moves to
	} else {
		view.cards.putBack(animate);
		unframeDeal(animate); // And back
	}
}

/**
 * @description The keyboard's card: lifted, in a gold frame
 * @param  {[number|null]} index [its place in queen, rook, bishop, knight order, null for none]
 */
export function focusCard(index) {
	if (view && view.cards) { view.cards.focus(index); }
}

/**
 * @description Stands the taken pieces in their piles on the desk (the baize table without the room). A piece
 * animateMove() just took off the board flies to its spot, a new one appears in place, one already in a right spot
 * stays. The rest are removed
 * @param  {[object[]]} captures [{ type, color }, in capture order, color is the taken piece's (gameplay/captures)]
 * @param  {[string|null]} playerColor ["w" or "b", the side the room is turned to, null counts as White]
 */
export function setTaken(captures, playerColor) {
	if (!view) { return; }
	const spots = pileSpots(captures, playerColor);
	const wanted = new Map(spots.map((spot) => [spot.key, spot]));
	for (const [key, mesh] of [...view.taken]) {
		const spot = wanted.get(key);
		if (spot && spot.type === mesh.userData.type && spot.color === mesh.userData.color) { continue; }
		view.taken.delete(key);
		// A flight to a spot that's gone
		for (const anim of [...view.anims]) {
			if (anim.mesh === mesh) {
				view.anims.delete(anim);
				anim.done();
			}
		}
		removePiece(mesh);
	}
	for (const spot of spots) {
		if (view.taken.has(spot.key)) { continue; }
		const arrived = [...view.arriving].find((mesh) => mesh.userData.type === spot.type && mesh.userData.color === spot.color);
		if (!arrived) {
			settle(addPiece(spot.type, spot.color), spot);
			continue;
		}
		view.arriving.delete(arrived);
		const { delay, duration } = arrived.userData.flight;
		view.taken.set(spot.key, arrived);
		arrived.userData.spot = spot.key;
		arrived.userData.yaw = undefined;
		arrived.rotation.y = spot.yaw;
		animate(arrived, spot.x, spot.z, { y1: pileY(), arc: CELL_SIZE * 1.5, delay, duration, onEnd: () => settle(arrived, spot) });
	}
	view.arriving.forEach(removePiece); // Not taken any more
	view.arriving.clear();
	requestRender();
}

/* ---------------------------------------------------------------- */
// Chess Cards Table
/* ---------------------------------------------------------------- */

/**
 * @description Lays out a Chess Cards game's table (cardTable.js): both hands, the card duel (dealt from the room's
 * baked green deck), both Board Effects piles. Kept until the room has loaded; a room without its card template has no
 * table
 * @param  {[object]} state [cards.view, the player's view (gameplay/cards/store.js)]
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} opts [{ catalog: the card faces, focus: the keyboard's hand card id | null, focusPile: the
 * keyboard's pile | null, dim: the hand card ids drawn dimmer }]
 */
export function setCardTable(state, legal, opts = {}) {
	if (!view) { return; }
	view.tableArgs = [state, legal, opts];
	const made = !view.table && Boolean(view.cardTemplate);
	if (made) {
		// The player asks for reduced motion
		function prefersStill() {
			return REDUCE.matches;
		}
		// A pile opened or a hand card zoomed in on: the camera frames it, and flow.js hears what is zoomed in on (Escape
		// and a play end it)
		function framePileOrZoom(box, zoom = null) {
			framePile(box, !REDUCE.matches);
			view.cardOptions.onTable({ kind: "zoom", id: zoom });
		}
		// inView: the plaques lie on the desk in view; camera: they are checked on screen through the live camera. The
		// last line stays as it is: client/test/cardPrompt3D.test.js matches it
		view.table = createCardTable({
			template: view.cardTemplate,
			room: view.room,
			animations: view.animations,
			requestRender,
			still: prefersStill,
			frame: framePileOrZoom,
			inView: () => deskInView(view.camera, view.room), camera: view.camera });
		// A Chess Cards game opens on its whole hand once the room has its table (camera.js cardHome), its limits let it
		// stay there
		if (view.table) {
			view.table.lift(view.tableLifted);
			openCardCamera();
		}
	}
	if (view.table) { view.table.set(state, opts); }
	if (made && view.table && view.tableDuel) { view.table.dealDuel(view.tableDuel); } // A card duel dealt while the room loaded
	if (made && view.table) { view.cardOptions.onTable({ kind: "table" }); } // flow.js: a prompt already up lays its plaques on it
}

/**
 * @description Deals a card duel on the table, or brings the one laid to the view (cardTable.js dealDuel). Kept until
 * the room has loaded
 * @param  {[object]} duel [view.duel, of the view the table was last set to]
 */
export function dealDuel(duel) {
	if (!view) { return; }
	view.tableDuel = duel;
	if (view.table) { view.table.dealDuel(duel); }
}

/**
 * @description Turns a duel card face up, framed in gold when won (cardTable.js flipDuel)
 * @param  {[string]} player ["w" | "b", the duel-flip event's player]
 * @param  {[number|null]} index [0..2 in the view's duel hands, null: a pick the view no longer shows]
 * @param  {[object]} card [{ r, s }, the duel-flip event's card]
 * @param  {[boolean]} won [true: its gold outline]
 */
export function flipDuel(player, index, card, won = false) {
	if (view && view.table) { view.table.flipDuel(player, index, card, won); }
}

/**
 * @description The card duel is over: its cards go back to the green deck, the hands back into their rows (cardTable.js
 * endDuel)
 */
export function endDuel() {
	if (!view) { return; }
	view.tableDuel = null;
	if (view.table) { view.table.endDuel(); }
}

/**
 * @description Lifts the hand card being played, high above the others
 * @param  {[string]} id [the card's id, "king" for the King card]
 */
export function liftCard(id) {
	if (!view) { return; }
	view.tableLifted = id;
	if (view.table) { view.table.lift(id); }
}

/**
 * @description Puts the lifted hand card back down
 */
export function dropCard() {
	liftCard(null);
}

/**
 * @description Opens a passive pile or an active spot into its column, or closes it when it's the one open (the
 * keyboard's way to what a click on the pile does)
 * @param  {[string]} pile [a key of tableLayout.js PILES]
 */
export function toggleCardPile(pile) {
	if (view && view.table) { view.table.togglePile(pile); }
}

/**
 * @description The pile that is open
 * @return {[string|null]} [a key of tableLayout.js PILES, null for none]
 */
export function openCardPile() {
	return view && view.table ? view.table.open() : null;
}

/**
 * @description The window was resized & the camera has settled (camera.js resize, after a drag's settle): a new size
 * lays the table's plaques again inside the desk now in view
 */
export function relayPlaques() {
	const due = view.relayDue;
	view.relayDue = false;
	if (!due || !view.table) { return; }
	const up = view.table.buttonCount() > 0;
	// The plaques came back or went: flow.js lays the prompt again, so its 2D buttons hide or show
	if (view.table.relayButtons() !== up) { view.cardOptions.onTable({ kind: "table" }); }
}

/**
 * @description A prompt's brass plaque buttons on the table, or none (cardTable.js showButtons). Not kept for a room
 * still loading, nor laid when they'd cover something in view: that prompt keeps its 2D buttons
 * @param  {[array]} list [[{ id, label }], [] takes them away]
 * @param  {[object|null]} anchor [{ x, z, side } (tableLayout.js plaqueAnchor)]
 * @return {[boolean]} [plaques are up]
 */
export function showTableButtons(list, anchor) {
	if (!view || !view.table) { return false; }
	const up = view.table.showButtons(list, anchor);
	rehoverPlaque(); // Another list comes up unlit: the one under a still mouse lights
	return up;
}

/**
 * @description The keyboard's plaque (cardTable.js focusButton): its 2D button has the focus
 * @param  {[number|null]} index [in showTableButtons' list, null for none]
 */
export function focusTableButton(index) {
	if (view && view.table) { view.table.focusButton(index); }
}

/**
 * @description A plaque pressed sinks & rises (cardTable.js pressButton)
 * @param  {[string]} id
 */
export function pressTableButton(id) {
	if (view && view.table) { view.table.pressButton(id); }
}

/**
 * @description The squares a card play can go to next glow (their own highlight, so the 2D marks never clear them), &
 * the keyboard's one gets a ring
 * @param  {[string[]]} squares [["e4", ...], [] for none]
 * @param  {[string|null]} focus [the keyboard's square]
 */
export function highlightSquares(squares, focus = null) {
	highlight(squares, "cards");
	highlight(focus ? [focus] : [], "cardFocus");
	focusStatuses(focus); // Its piece's statuses, named before Enter picks it
}
