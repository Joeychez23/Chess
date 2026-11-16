/*
 *  index.js  --  chess frontend
 *	3D Board
 *	The three.js board. Never imported statically: load.js pulls it in with import() when the player turns 3D on, so webpack
 *	puts it & three.js in their own "three" chunk & 2D players never download them. Named imports only, so the rest of
 *	three.js is tree-shaken out. It knows no chess rules & no socket: it only draws what it's told & reports squares.
 *	The board lies in the XZ plane centered on the origin, a1 bottom-left from White's side (+Z faces the camera)
 *
 */

import { WebGLRenderer, Scene, PerspectiveCamera, Color, Fog, HemisphereLight, DirectionalLight, PlaneGeometry, MeshStandardMaterial, MeshBasicMaterial, Mesh, TextureLoader, SRGBColorSpace, LinearMipmapLinearFilter, GridHelper, Raycaster, Vector2, Vector3, Spherical, MathUtils, RingGeometry, Plane } from "three";

import { createPiece, updateShadow, disposePiece } from "./pieces.js";
import { createSurroundings, orientLabels } from "./board.js";
import { BAIZE_FOG } from "./materials.js";
import { createRoom, turnRoom, disposeRoom } from "./room.js"; // THE LIBRARY AROUND THE BOARD & ITS CRT MONITOR
import { pileSpots } from "./piles.js"; // WHERE THE TAKEN PIECES STAND ON THE DESK
import { createCards } from "./cards.js"; // THE PROMOTION CARDS ON THE DESK
import { createTweens } from "./tween.js"; // THEIR SLIDES

import { createScreen, setScreen as showOnScreen, setFace as showFace, pauseScreen, disposeScreen, setMonitorView } from "./screen.js"; // WHAT THE MONITOR SHOWS
import { createMonitor } from "./monitor/monitor.js"; // THE MONITOR AS THE GAME'S MENU: ITS STATES, BUTTONS & KEYS
import { loadPrefs, savePrefs } from "./monitor/prefs.js";
import { createFire, stepFire, pauseFire, disposeFire } from "./fire.js"; // THE FIREPLACE'S FLAMES, EMBERS & FLICKER
import { createClock, stepClock, pauseClock, disposeClock } from "./clock.js"; // THE LONGCASE CLOCK'S HANDS & PENDULUM, AT THE LOCAL TIME
import { reportError } from "../../pages/utils/reportErrors.js";
import { showHint, removeHint } from "./hint.js";
import { perfStart, perfStop, perfFrame, perfMoving, perfLost } from "./perf.js"; // ?perf=1's READOUT FOR PHONE TESTS (#430)
export { perfLoaded } from "./perf.js"; // load.js GIVES IT THE CHUNK'S DOWNLOAD TIME
import "../../../css/board3D.css"; // #board3D, THE CONTROLS HINT & THE PERF READOUT: IN THIS CHUNK, NOT THE PLAY BUNDLE

import { resize, frameDeal, unframeDeal, placeCamera, stepCamera, landTurn, sideAngle, stepZoom } from "./camera.js";
import { createControls, onPointerDown, onPointerMove, onPointerUp, monitorIdle, monitorInput, onMonitorShow, onPointerLeave, onClick, onTouchTap, onKeyDown } from "./pointer.js";
import { putDownHeld, stepAnim, finishAnims, animate } from "./motion.js";

export { isCameraGesture, setSide, resetCamera } from "./camera.js";
export { setMonitor, enterMonitor, leaveMonitor, monitorState, focusMonitor } from "./pointer.js";
export { setHeld, animateMove, animateUndo, glideHome } from "./motion.js";
import { BOARD_SIZE, CELL_SIZE, PIECE_SIZE, FILES, ROOM_BACKGROUND, BOARD_IMAGE, HIGHLIGHTS, FOCUS_RING, NEAR, REDUCE, NO_MONITOR, LABEL, FOV } from "./constants.js";

export let view = null; // EVERYTHING ONE mount() MADE, null WHEN UNMOUNTED
export const raycaster = new Raycaster();
export const pointer = new Vector2(); // NORMALIZED DEVICE COORDS (-1..1)
export const offset = new Vector3(); // CAMERA POSITION MINUS WHAT IT LOOKS AT
export const spherical = new Spherical(); // offset AS DISTANCE, TILT & ANGLE AROUND THE BOARD
export const fitCamera = new PerspectiveCamera(); // smallScreenCamera()'S STAND-IN, THE REAL ONE STAYS WHERE THE PLAYER PUT IT
export const corner = new Vector3();
export const table = new Plane(new Vector3(0, 1, 0), 0); // THE BOARD'S SURFACE, A DRAGGED PIECE OFF THE BOARD FOLLOWS THE POINTER ON IT
export const tablePoint = new Vector3();
export const UP = new Vector3(0, 1, 0);
export const glassCentre = new Vector3(); // zoomSpot()'S SCRATCH
export const glassNormal = new Vector3();
export const glassSize = new Vector3();
export const glassScale = new Vector3();
export const forward = new Vector3(); // THE CAMERA'S VIEW DIRECTION, glassHit()'S
export const dealShift = new Vector3(); // framedSpot()'S SCRATCH

/* ---------------------------------------------------------------- */
// Squares
/* ---------------------------------------------------------------- */

export const fileOf = (square) => FILES.indexOf(square[0]); // 0 - 7, a - h
export const rowOf = (square) => 8 - Number(square[1]); // 0 - 7, RANK 8 - RANK 1 (chess.js board() ORDER)
export const center = (i) => -BOARD_SIZE / 2 + CELL_SIZE * (i + 0.5); // GRID INDEX -> WORLD COORDINATE OF THAT SQUARE'S CENTER
export const toCell = (v) => MathUtils.clamp(Math.floor((v + BOARD_SIZE / 2) / CELL_SIZE), 0, 7);

// PUTS A MESH ON A SQUARE, BOTH IN view.pieces & IN THE SCENE
export function place(mesh, square) {
	view.pieces.set(square, mesh);
	mesh.userData.square = square;
	mesh.position.set(center(fileOf(square)), 0, center(rowOf(square)));
	if (mesh.userData.type === "n" && mesh.userData.yaw === undefined) { mesh.rotation.y = startYaw(mesh); } // AN UNMOVED KNIGHT FACES THE MIDDLE OF ITS SQUARE'S ROW
	updateShadow(mesh);
}

// KING, QUEEN, BISHOP & ROOK FACE THE WAY THEY LAST MOVED UP OR DOWN THE BOARD LIKE 2D (handlePieceDirectionW / B): TOWARD RANK 8 (-Z) IS
// rotation.y PI (MODEL FRONTS FACE +Z), TOWARD RANK 1 IS 0. ONE THAT HASN'T FACES THE OTHER SIDE (createPiece). WORLD SIDES, SO A FLIP CHANGES NOTHING.
// KNIGHTS FACE THE WAY THEY LAST MOVED LEFT OR RIGHT (handleKnightDirectionW / B): THE NOSE IS +X, SO TOWARD THE h-FILE IS 0, TOWARD THE a-FILE PI.
// ONE THAT HASN'T MOVED FACES THE MIDDLE (a - d FACE THE h-FILE, e - h THE a-FILE), LIKE 2D's START (setSlidePiece)
const TURNS = /[kqbrn]/;
export const yawToward = (rankUp) => (rankUp ? Math.PI : 0);
export const yawSide = (towardH) => (towardH ? 0 : Math.PI);
const startYaw = (mesh) => (mesh.userData.type === "n" ? yawSide(fileOf(mesh.userData.square) < 4) : yawToward(mesh.userData.color === "w"));
export const storedYaw = (mesh) => mesh.userData.yaw ?? startYaw(mesh);

export function setYaw(mesh, yaw, store) {
	if (!TURNS.test(mesh.userData.type)) { return; }
	if (store) { mesh.userData.yaw = yaw; }
	mesh.rotation.y = yaw;
}

// TURNS A KING, QUEEN, BISHOP OR ROOK THE WAY A MOVE GOES UP OR DOWN, A SIDEWAYS MOVE KEEPS ITS FACING. A KNIGHT TURNS LEFT OR RIGHT
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

const SHADOW_LIFT = 0.015; // A PILE SHADOW'S HEIGHT OVER ITS SURFACE, pieces.js SHADOW_Y
const DESK_Y = -0.76; // THE ROOM'S DESK TOP (room.js)
const pileY = () => (view.room ? DESK_Y : view.surroundings.userData.table.position.y); // THE BAIZE TABLE'S HEIGHT WHEN THE ROOM ISN'T IN
export const homeYaw = (type, color) => (color === "w" ? Math.PI : 0) - (type === "n" ? Math.PI / 2 : 0); // HOW createPiece TURNS A PIECE ON ITS SQUARE

// KEEPS A PIECE'S SHADOW ON THE SURFACE UNDER IT, mesh.userData.ground (updateShadow() KEEPS IT AT BOARD HEIGHT). CALL AFTER updateShadow()
export function shadeOnGround(mesh) {
	const shadow = mesh.getObjectByName("shadow");
	shadow.position.y = (mesh.userData.ground + SHADOW_LIFT - mesh.position.y) / mesh.scale.y;
}

// PUTS A MESH WHERE ITS PILE SPOT SAYS, ON THE DESK (OR THE TABLE)
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

// THE ORDER OF THE PILES' SLOTS: far0, far1, ..., near0, ...
export const slotOf = (key) => Number(key.replace(/\D/g, ""));

/**
 * @description Downloads the library & puts it around the board in place of the baize table. The board is already up & playable: one that
 * fails or times out is reported & the baize stays. Phones get the desk & monitor only
 * @param  {[object]} v [the view it's for, a board unmounted meanwhile gets nothing]
 */
async function addRoom(v) {
	try {
		const { group, screen, fire, clock, card } = await createRoom({ phone: v.phone, anisotropy: Math.min(v.renderer.capabilities.getMaxAnisotropy(), 4) });
		if (view !== v) { return; } // UNMOUNTED (OR REBUILT) WHILE IT LOADED
		v.room = group;
		v.scene.add(group);
		for (const mesh of v.taken.values()) { // THE PILES STAND ON THE DESK NOW, NOT THE BAIZE
			mesh.userData.ground = DESK_Y;
			mesh.position.y = DESK_Y;
			updateShadow(mesh);
			shadeOnGround(mesh);
		}
		for (const anim of v.anims) { if (anim.y1 !== 0 && anim.mesh.userData.spot) { anim.y1 = DESK_Y; } } // & A PIECE ON ITS WAY THERE LANDS ON IT
		v.surroundings.userData.table.visible = false; // THE DESK TAKES THE BAIZE'S PLACE
		v.scene.fog = null; // THE WALLS ARE THE EDGE NOW, FOG WOULD HIDE THEM
		v.scene.background = new Color(ROOM_BACKGROUND);
		v.container.style.backgroundColor = v.scene.background.getStyle();
		turnRoom(group, v.cameraTurn ? v.cameraTurn.roomFrom : sideAngle(v.side));
		createScreen(screen, requestRender);
		if (v.screenState) { showOnScreen(v.screenState); }
		if (v.screenFace) { showFace(v.screenFace); }
		v.glass = screen;
		v.monitor = createMonitor({ show: () => onMonitorShow(v), announce: (text) => v.monitorOptions.announce(text), handlers: v.monitorOptions.handlers || {}, loadPrefs, savePrefs, reduce: () => REDUCE.matches });
		v.monitorSeen = "idle";
		setMonitorView(v.monitor.view);
		if (v.monitorData) { v.monitor.update(monitorInput(v.monitorData)); }
		v.monitorOptions.onChange({ ready: true, state: "idle" });
		pauseScreen(document.hidden || v.lost);
		if (fire) { // NOT ON PHONES: THEY HAVE NO FIREPLACE
			createFire(fire, requestRender);
			pauseFire(document.hidden || v.lost);
		}
		if (clock) { // NOT ON PHONES EITHER: THE CLOCK IS IN THE ROOM
			createClock(clock, requestRender);
			pauseClock(document.hidden || v.lost);
		}
		if (card) { // NOT IN AN OLD library.glb: THE FLAT PICKER STAYS
			v.cards = createCards({ template: card, room: group, tweens: v.tweens, requestRender, still: () => REDUCE.matches });
			if (v.cards && v.promotion) { // A PROMOTION ASKED FOR WHILE THE ROOM LOADED
				v.cards.deal(v.promotion.color, false);
				frameDeal(false);
			}
		}
		requestRender();
	} catch (error) {
		console.warn("3D library didn't load, staying on the baize table", error);
		reportError(`3D library couldn't load: ${error.message}`, "3d-board");
		if (view !== v) { return; }
		if (v.monitor) { // MADE BEFORE WHAT THREW: NO MENU ON A HALF BUILT ROOM
			v.monitor.reset();
			v.monitor = null;
			setMonitorView(null);
		}
		v.monitorOptions.onChange({ ready: false, state: null });
	}
}

// TURNS THE a-h / 1-8 LABELS TO READ FROM color'S SIDE, LIKE THE 2D BOARD'S
export function setLabels(color) {
	if (view.labelSide === color) { return; }
	view.labelSide = color;
	orientLabels(view.surroundings, color);
}

/* ---------------------------------------------------------------- */
// Rendering
/* ---------------------------------------------------------------- */

// DRAWS ON DEMAND: ASKS FOR ONE FRAME WHEN SOMETHING CHANGED (A FEW CALLS BEFORE IT RUNS STILL DRAW ONCE). NOTHING WHILE THE TAB IS
// HIDDEN, visibilitychange DRAWS ON THE WAY BACK. AN IDLE BOARD DRAWS NOTHING
export function requestRender() {
	if (!view || view.frameId !== null || document.hidden || view.lost) { return; }
	view.frameId = requestAnimationFrame(frame);
}

// ONE FRAME: STEP THE MOVING PIECES & CAMERA, THEN DRAW. ASKS FOR THE NEXT ONLY WHILE SOMETHING IS STILL MOVING
function frame(now) {
	view.frameId = null;
	perfMoving(now, view.anims.size > 0 || Boolean(view.cameraTurn) || Boolean(view.zoom) || view.tweens.active());
	for (const anim of [...view.anims]) { stepAnim(anim, now); }
	view.tweens.step(now);
	if (view.cameraTurn) { stepCamera(now); }
	if (view.zoom) { stepZoom(now); }
	if (view.controls.enableDamping && !view.zoom && monitorIdle()) { view.controls.update(); } // STILL GLIDING: ITS "change" ASKS FOR THE NEXT FRAME. NOT AT THE MONITOR: IT WOULD AIM THE CAMERA BACK AT THE BOARD
	stepFire(now, view.renderer.domElement.height); // ITS OWN TIMER ASKS FOR ITS FRAMES (fire.js)
	stepClock(); // SO DOES THE CLOCK'S (clock.js)
	view.renderer.render(view.scene, view.camera);
	if (view.textureReady) { view.markDrawn(); } // ONLY THE FIRST CALL COUNTS
	perfFrame(now);
	if (view.anims.size || view.cameraTurn || view.zoom || view.tweens.active()) { requestRender(); }
}

function onVisibility() {
	pauseScreen(document.hidden); // THE MONITOR'S FACE STOPS BLINKING IN A HIDDEN TAB
	pauseFire(document.hidden); // & THE FIRE STOPS ASKING FOR FRAMES
	pauseClock(document.hidden); // & THE CLOCK
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
	pauseScreen(true);
	pauseFire(true);
	pauseClock(true);
	cancelAnimationFrame(view.frameId);
	view.frameId = null;
	finishAnims(); // THEIR PROMISES RESOLVE, THE GAME DOESN'T WAIT ON A BOARD THAT CAN'T DRAW
	view.tweens.finish();
	if (view.monitor) { view.monitor.reset(); } // STRAIGHT BACK TO THE DESK: onMonitorShow() PUTS THE CAMERA BACK & THE CONTROLS ON
	view.zoom = null;
	view.controls.enabled = true;
	view.onContextLost();
}

function onContextRestored() {
	view.onContextRestored();
}

/**
 * @description Creates the renderer, scene, board & lights inside container & starts drawing. Throws if WebGL is unavailable
 * @param  {[HTMLElement]} container [what the 3D canvas fills, sized by CSS]
 * @param  {[object]} events [{ onContextLost, onContextRestored, monitor }: the WebGL context went away / came back, the board stops drawing
 * when it's lost & the caller puts up a new one (unmount() then mount()). monitor: { handlers (what its buttons call, monitor.js), announce(text)
 * (for the screen reader), onChange({ ready, state }) (the monitor came up, went away or changed state) }. cards: { onPick(type) } (a promotion card was picked, "q", "r", "b" or "n") }]
 */
export function mount(container, { onContextLost: lost = () => {}, onContextRestored: restored = () => {}, monitor = null, cards = null } = {}) {
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
	const camera = new PerspectiveCamera(FOV, 1, NEAR, 1000); // PLACED BELOW (placeCamera), WHITE'S SIDE UNTIL setSide()
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
	view = { taken: new Map(), arriving: new Set(), phone, container, renderer, scene, camera, plane, surroundings, marks, pieces: new Map(), anims: new Set(), side: "w", labelSide: "w", cameraTurn: null, frameId: null }; // taken: PILE KEY -> MESH, arriving: TAKEN OFF THE BOARD, WAITING FOR setTaken, frameId: THE requestRender() FRAME WAITING TO RUN, side: THE SIDE THE CAMERA IS ON (OR TURNING TO), labelSide: THE SIDE THE LABELS READ FROM, cameraTurn: FLIP BOARD'S TURN IN PROGRESS { from, to, start }
	Object.assign(view, { small: null, lost: false, onContextLost: lost, onContextRestored: restored, held: null, room: null, screenState: null, screenFace: null }); // room: THE LIBRARY ONCE IT'S LOADED (addRoom), screenState & screenFace: WHAT ITS MONITOR WAS LAST TOLD // held: THE PICKED UP PIECE (setHeld) { mesh, dragging, following }
	Object.assign(view, { monitorOptions: { ...NO_MONITOR, ...(monitor || {}) }, monitor: null, monitorData: null, monitorSeen: "idle", glass: null, zoom: null, home: null, zoomLook: new Vector3(), leaving: [] }); // monitor: ITS STATE MACHINE ONCE THE ROOM HAS LOADED, monitorData: WHAT setMonitor() WAS LAST TOLD, zoom: THE CAMERA'S MOVE TO OR FROM THE GLASS, home: WHERE IT WAS ON THE DESK, zoomLook: WHAT IT LOOKS AT MEANWHILE, leaving: leaveMonitor()'S RESOLVES
	Object.assign(view, { tweens: createTweens(requestRender), cards: null, cardOptions: { onPick() {}, ...(cards || {}) }, promotion: null, cardCursor: false, dealHome: null, dealEase: null }); // tweens: THE CARDS' SLIDES & THE CAMERA'S DEAL MOVES (STEPPED IN frame), cards: THE PROMOTION CARDS ONCE THE ROOM HAS LOADED (A room WITHOUT THEM LEAVES null), promotion: { color } WHILE ONE IS ASKED FOR, cardCursor: THE HAND CURSOR IS A CARD'S, dealHome: WHERE THE CAMERA WAS BEFORE IT FRAMED A DEAL { position, target, maxDistance, back }, dealEase: THE CAMERA'S DEAL MOVE RUNNING (moveDealCamera)
	view.drawn = new Promise((resolve) => { view.markDrawn = resolve; }); // whenDrawn(): THE FIRST FRAME WITH THE SQUARES IN (textureReady)
	view.textureReady = false;
	Object.assign(view, { controls: createControls(camera, canvas), controlsActive: false, cameraGesture: false, press: { x: 0, y: 0, time: 0 }, pointerAt: { x: 0, y: 0 }, pointerType: null, touches: new Set(), multiTouch: false }); // cameraGesture: THE CAMERA CONTROLS OWN THE POINTER, touches: THE FINGERS DOWN (pointerId), multiTouch: MORE THAN ONE WAS, SINCE ALL WERE UP
	container.style.backgroundColor = scene.background.getStyle(); // THE SAFE AREA PADDING (UNDER A NOTCH) IS THE SCENE'S BACKGROUND
	view.observer = new ResizeObserver(resize);
	view.observer.observe(container);
	window.addEventListener("orientationchange", resize); // SOME MOBILE BROWSERS REPORT THE NEW SIZE LATE
	container.appendChild(canvas);
	resize(); // FIRST: A SMALL SCREEN'S CAMERA (view.small) IS FIT TO THE SIZE
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
	showHint(); // THE FIRST TIME 3D OPENS
	perfStart({ renderer, camera, squareCorners });
	addRoom(view); // NOT AWAITED: THE BOARD NEVER WAITS ON THE ROOM
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
	view.tweens.finish();
	if (view.cards) { view.cards.dispose(); }
	[...view.taken.values(), ...view.arriving].forEach(removePiece);
	view.taken.clear();
	view.arriving.clear();
	removeHint();
	perfStop();
	disposeScreen();
	setMonitorView(null); // AFTER disposeScreen(): NOTHING LEFT TO REDRAW
	const { leaving, monitor, monitorOptions } = view;
	disposeFire();
	disposeClock();
	disposeRoom();
	const { renderer, scene, observer, controls, container } = view;
	cancelAnimationFrame(view.frameId);
	document.removeEventListener("visibilitychange", onVisibility);
	observer.disconnect();
	controls.dispose();
	window.removeEventListener("orientationchange", resize);
	container.removeEventListener("pointerdown", onPointerDown, true);
	container.removeEventListener("pointermove", onPointerMove, true);
	container.removeEventListener("pointerleave", onPointerLeave);
	container.removeEventListener("click", onClick, true);
	container.removeEventListener("pointerup", onTouchTap, true);
	container.style.cursor = ""; // THE GLASS'S HAND CURSOR
	window.removeEventListener("keydown", onKeyDown, true);
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
			if (m.lightMap) { freed.add(m.lightMap); } // THE ROOM'S BAKED LIGHT
			if (m.userData.fireMap) { freed.add(m.userData.fireMap); } // & ITS BAKED FIRELIGHT
		}
	});
	freed.forEach((r) => r.dispose()); // SHARED ONES (PIECE GEOMETRY, WOODS) ONLY LOSE THEIR GPU COPY, THE NEXT mount() RE-UPLOADS THEM
	renderer.domElement.remove();
	renderer.dispose();
	if (!view.lost) { renderer.forceContextLoss(); } // A LOST CONTEXT HAS NOTHING LEFT TO FREE
	view = null;
	leaving.forEach((resolve) => resolve()); // NOTHING TO WAIT FOR ON A BOARD THAT'S GONE
	if (monitor) { monitorOptions.onChange({ ready: false, state: null }); }
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
	view.arriving.forEach(removePiece); // A TAKEN PIECE setTaken() NEVER CLAIMED
	view.arriving.clear();
	requestRender();
}

/**
 * @description Turns the kings, queens, bishops, rooks & knights the way the 2D board's lists say (w_piece / b_piece, w_knight / b_knight). A piece on a square
 * its color's list doesn't name keeps its facing (a move the list hasn't caught up with yet already turned it, animateMove)
 * @param  {[object]} facings [{ w: { square: "up" | "down" | "left" | "right" | null }, b: { ... } }, "up" toward rank 8, "right" toward the h-file, null hasn't moved]
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
 * @description Which square a pointer event is over (the piece's square when it's over a piece, so tall pieces are easy to hit)
 * @param  {[PointerEvent|MouseEvent]} e [any event with clientX & clientY]
 * @return {[string|null]} ["e4", or null when it's off the board or nothing is mounted]
 */
export function squareUnder(e) {
	if (!view || !monitorIdle()) { return null; } // AT THE MONITOR THE BOARD TAKES NO INPUT
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
 * @description Lands every moving piece, a Flip Board turn & a zoom to or from the monitor in progress at once (reduce motion turned on mid-move)
 */
export function stopMotion() {
	if (!view) { return; }
	finishAnims();
	view.tweens.finish();
	landTurn();
	if (view.zoom) { stepZoom(Infinity); }
	requestRender();
}

/**
 * @description What the library's monitor shows (three/screen.js setScreen). Kept until the room has loaded, nothing on a board with no monitor
 * @param  {[object]} state { name, status, ai, thinking }
 */
export function setScreen(state) {
	if (!view) { return; }
	view.screenState = state;
	showOnScreen(state);
	if (view.monitor && view.monitorData) { view.monitor.update(monitorInput(view.monitorData)); } // ITS NAME & STATUS ARE THE MONITOR'S DATA TOO
}

/**
 * @description The monitor's face reacts (AI games, three/screen.js setFace). The last one is kept until the room has loaded
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
 * @description Whether the room's promotion cards are in, so they can be the picker. False before the room loads, with an old library.glb or no room
 * @return {[boolean]}
 */
export function hasCards() {
	return Boolean(view && view.cards);
}

/**
 * @description A promotion is asked for (the cards slide from the deck into the strip) or over (they slide back). Kept until the room has loaded.
 * A camera that can't see the strip frames the board & the cards meanwhile (frameDeal), then goes back where it was
 * @param  {[string|null]} color ["w" or "b", the player's colour, null for none]
 * @param  {[boolean]} animate [false sets the cards at once (reduce motion)]
 */
export function setPromotion(color, animate) {
	if (!view) { return; }
	view.promotion = color ? { color } : null;
	if (!view.cards) { return; }
	if (color) {
		view.cards.deal(color, animate);
		frameDeal(animate); // A CAMERA THAT CAN'T SEE THE CARDS MOVES TO
	} else {
		view.cards.putBack(animate);
		unframeDeal(animate); // & BACK
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
 * @description Stands the taken pieces in their piles on the desk (the baize table without the room). A piece animateMove() just took off the
 * board flies to its spot, a new one appears in place, one already in a right spot stays. The rest are removed
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
		for (const anim of [...view.anims]) { if (anim.mesh === mesh) { view.anims.delete(anim); anim.done(); } } // A FLIGHT TO A SPOT THAT'S GONE
		removePiece(mesh);
	}
	for (const spot of spots) {
		if (view.taken.has(spot.key)) { continue; }
		const arrived = [...view.arriving].find((m) => m.userData.type === spot.type && m.userData.color === spot.color);
		if (!arrived) { settle(addPiece(spot.type, spot.color), spot); continue; }
		view.arriving.delete(arrived);
		const { delay, duration } = arrived.userData.flight;
		view.taken.set(spot.key, arrived);
		arrived.userData.spot = spot.key;
		arrived.userData.yaw = undefined;
		arrived.rotation.y = spot.yaw;
		animate(arrived, spot.x, spot.z, { y1: pileY(), arc: CELL_SIZE * 1.5, delay, duration, onEnd: () => settle(arrived, spot) });
	}
	view.arriving.forEach(removePiece); // NOT TAKEN ANY MORE
	view.arriving.clear();
	requestRender();
}
