// The 3D board's mount and unmount, the room it loads, its frame loop and the Chess Cards table the room brings up.
// view lives here: mount() and unmount() are the only places it is set (index.js re-exports it)
import {
	WebGLRenderer, Scene, PerspectiveCamera, Color, Fog, HemisphereLight, DirectionalLight, PlaneGeometry, MeshStandardMaterial,
	MeshBasicMaterial, Mesh, TextureLoader, SRGBColorSpace, LinearMipmapLinearFilter, GridHelper, Vector3, MathUtils, RingGeometry
} from "three";

import { updateShadow, disposePiece } from "./board/pieces.js";
import { createSurroundings } from "./board/board.js";
import { BAIZE_FOG } from "./materials.js";
import { createRoom, turnRoom, disposeRoom } from "./room/room.js"; // The library around the board and its CRT monitor
import { createCards } from "./cardTable/promotionCards.js"; // The promotion cards on the desk
import { createCardTable, deskInView } from "./cardTable/index.js"; // A Chess Cards game's hands, decks and board effects
import { createAnimations } from "./animations.js"; // Their slides

import { createScreen, setScreen as showOnScreen, setFace as showFace, pauseScreen, disposeScreen, setMonitorView } from "./monitor/screen.js";
import { createMonitor } from "./monitor/monitor.js"; // The monitor as the game's menu: its states, buttons and keys
import { loadPrefs, savePrefs } from "./monitor/prefs.js";
import { createFire, stepFire, pauseFire, disposeFire } from "./room/fire.js"; // The fireplace's flames, embers and flicker
import { createClock, stepClock, pauseClock, disposeClock } from "./room/clock.js"; // The longcase clock's hands and pendulum, at the local time
import { reportError } from "../../pages/utils/reportErrors.js";
import { showHint, removeHint } from "./hint.js";
import { perfStart, perfStop, perfFrame, perfMoving, perfLost } from "./perf.js"; // ?perf=1's readout for phone tests

import { resize, frameDeal, framePile, placeCamera, stepCamera, sideAngle, stepZoom, openCardCamera } from "./camera/index.js";
import {
	createControls, onPointerDown, onPointerMove, onPointerUp, monitorIdle, monitorInput, onMonitorShow, onPointerLeave, onClick,
	onTouchTap, onKeyDown
} from "./pointer/index.js";
import { stepAnim, finishAnims } from "./board/motion.js";
import { followCamera } from "./pointer/tileHover.js";
import { leftBoard } from "./camera/autoLean.js"; // Auto Lean forgets the pointer was on this board (unmount)
// A Chess Cards piece's statuses, as effects or badges
import { stepStatuses, clearStatuses } from "./statusFx/index.js";
import { renderFrame, disposeBloom } from "./bloom.js"; // Draws the frame, with selective bloom on the status effects' glow
import {
	BOARD_SIZE, CELL_SIZE, FILES, DESK_Y, ROOM_BACKGROUND, BOARD_IMAGE, HIGHLIGHTS, FOCUS_RING, NEAR, REDUCE, NO_MONITOR, LABEL, FOV
} from "./constants.js";

export let view = null; // Everything one mount() made, null when unmounted

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

export function removePiece(mesh) {
	view.scene.remove(mesh);
	disposePiece(mesh);
}

const SHADOW_LIFT = 0.015; // A pile shadow's height over its surface, pieces.js SHADOW_Y

// Keeps a piece's shadow on the surface under it, mesh.userData.ground (updateShadow() keeps it at board height). Call
// after updateShadow()
export function shadeOnGround(mesh) {
	const shadow = mesh.getObjectByName("shadow");
	shadow.position.y = (mesh.userData.ground + SHADOW_LIFT - mesh.position.y) / mesh.scale.y;
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
	clearTimeout(view.cardSettle); // A window drag's pending opening-spot solve (camera/index.js resize)
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
// Chess Cards Table
/* ---------------------------------------------------------------- */

/**
 * @description Lays out a Chess Cards game's table (cardTable/): both hands, the card duel (dealt from the room's
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
		// and a play end it). snap: no glide (a zoom ended by a drag)
		function framePileOrZoom(box, zoom = null, snap = false) {
			framePile(box, !snap && !REDUCE.matches);
			view.cardOptions.onTable({ kind: "zoom", id: zoom });
		}
		// inView: the plaques lie on the desk in view; camera: they are checked on screen through the live camera. The
		// last line stays as it is: client/test/cards/cardPrompt3D.test.js matches it
		view.table = createCardTable({
			template: view.cardTemplate,
			room: view.room,
			animations: view.animations,
			requestRender,
			still: prefersStill,
			frame: framePileOrZoom,
			inView: () => deskInView(view.camera, view.room), camera: view.camera });
		// A Chess Cards game opens on its whole hand once the room has its table (camera/index.js cardHome), its limits let it
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