// Owns 3D board pointer and monitor input
import { view, setLabels, requestRender, squareUnder, pointer, raycaster } from "../index.js";
import { setRoomSide } from "../camera/index.js";
import { liftHeld } from "../board/motion.js";
import { hoverTile } from "./tileHover.js";
import { hoverOn, cameraFree } from "./hoverRules.js";
import { MIN_DISTANCE, MAX_DISTANCE, MAX_TILT, BOARD_SIZE, DRAG_PX, DRAG_HOLD_MS, isDrag } from "../constants.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MOUSE, TOUCH } from "three";
import { dismissHint } from "../hint.js";
import { isTap } from "../monitor/monitor.js";
import { tapStatuses } from "../statusFx/index.js";
import { monitorIdle, monitorInput, glassHit, hoverGlass } from "./pointer.monitor.js";
import { PROMOTION_DEAD_ZONE, PROMOTION_DEAD_ZONE_TOUCH, cardAt, tableAt, tableCovers, pickCard, togglePile, inPromotionDeadZone, baizePoint }
	from "./pointer.cards.js";

export { monitorIdle, monitorInput, onMonitorShow } from "./pointer.monitor.js";
export { PROMOTION_DEAD_ZONE, PROMOTION_DEAD_ZONE_TOUCH, inPromotionDeadZone } from "./pointer.cards.js";

// This press dragged a Chess Cards game's piece (releaseTable) or card (releaseCard): its click isn't a tap
let tableDrag = false;
// The mouse is down on a Chess Cards game's card that can be dragged (cardTable.hand.js grab): "moving" once it follows the
// pointer
let cardHeld = false;
// The prompt plaque the mouse last lit (cardTable.buttons.js hoverButton), so a move over the same one draws nothing new
let plaqueLit = null;


// Lights the plaque under the mouse (null: none)
function hoverPlaque(id) {
	if (id === plaqueLit) { return; }
	plaqueLit = id;
	view.table.hoverButton(id);
}

/**
 * @description The plaques were laid (three/index.js showTableButtons): another list comes up unlit, so the one under
 * a still mouse lights again
 */
export function rehoverPlaque() {
	plaqueLit = undefined; // What the table has lit isn't known now
	// The same rule as onPointerMove's hover
	if (view.pointerType !== "mouse" || !view.pointerOver || cardHeld || (view.held && view.held.dragging) || view.controlsActive) {
		return;
	}
	const at = tableAt({ clientX: view.pointerAt.x, clientY: view.pointerAt.y });
	hoverPlaque(at && at.kind === "button" ? at.id : null);
}

/* ---------------------------------------------------------------- */
// Camera Controls
/* ---------------------------------------------------------------- */

// Mouse: left-drag pans (on a piece it's piece input instead, on a Chess Cards table card nothing or the card's drag),
// right-drag rotates, scroll zooms. Touch: one finger is piece input, two rotate and pinch zoom. A press that moves the
// camera past DRAG_PX (or any two finger touch) sets cameraGesture, so gameplay/input ignores it
export function createControls(camera, canvas) {
	const controls = new OrbitControls(camera, canvas);
	controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
	controls.touches = { ONE: null, TWO: TOUCH.DOLLY_ROTATE };
	controls.screenSpacePanning = false; // Pans along the table, not up into the air
	controls.minDistance = MIN_DISTANCE;
	controls.maxDistance = MAX_DISTANCE;
	controls.minPolarAngle = 0; // Straight down, never past it
	controls.maxPolarAngle = MAX_TILT;
	// The camera looks at a point on the board, so panning can't lose it (cursor is the origin). A Chess Cards game at a
	// narrow window looks past its far edge: camera/index.js resize widens this
	controls.maxTargetRadius = BOARD_SIZE / 2;
	controls.addEventListener("start", function () {
		view.controlsActive = true;
		view.cameraTurn = null; // The player took the camera mid flip
		setRoomSide(view.side);
		setLabels(view.side);
		// Only two fingers start the controls: a camera gesture at once, no piece input until every finger is up
		if (view.pointerType === "touch") { startGesture(); }
		// -1 is OrbitControls' _STATE.NONE: no button or finger started this, a wheel or trackpad zoom did
		// (onMouseWheel). camera.lean.js leanBack reads it
		if (controls.state === -1) { view.leanMoved = true; }
	});
	controls.addEventListener("change", function () {
		requestRender();
		const { controlsActive, press, pointerAt } = view;
		if (controlsActive && Math.hypot(pointerAt.x - press.x, pointerAt.y - press.y) > DRAG_PX) { startGesture(); }
	});
	controls.addEventListener("end", function () {
		const mountedView = view;
		mountedView.controlsActive = false;
		// After the click the release fires. The gesture took the board's hover: it comes back under a still mouse
		if (mountedView.cameraGesture) {
			setTimeout(function () {
				if (!mountedView.controlsActive) {
					mountedView.cameraGesture = false;
					if (view === mountedView) { rehover(); }
				}
			}, 0);
		}
	});
	return controls;
}

// The controls own the pointer from here. The first camera move also dismisses the controls hint
function startGesture() {
	view.cameraGesture = true;
	view.leanMoved = true; // The player really moved the camera: camera.lean.js leanBack leaves it where they put it
	dismissHint();
}

// Capture phase, before the controls see it: a left mouse press on a piece is piece input, one on a table card the
// card's: the camera sits it out until the release
export function onPointerDown(e) {
	if (!view.controlsActive) {
		view.cameraGesture = false;
		view.press = { x: e.clientX, y: e.clientY, time: performance.now() };
	}
	view.pointerAt = { x: e.clientX, y: e.clientY };
	view.pointerType = e.pointerType;
	// Every finger (or pen) down: a second one makes this touch a pinch or orbit, never a tap
	if (e.pointerType !== "mouse") {
		view.touches.add(e.pointerId);
		if (view.touches.size > 1) { view.multiTouch = true; }
	}
	const left = e.pointerType === "mouse" && e.button === 0;
	// The same square gameplay/input picks a piece up from, not only a hit on the mesh: a press beside a piece on its
	// square picks it up too
	const square = left && squareUnder(e);
	// Zoomed on the monitor the camera stays put. A left press on any card (the table's, both decks, a promotion card)
	// never pans: right-drag and scroll still work over them
	view.controls.enabled = cameraFree({
		idle: monitorIdle(),
		left,
		piece: Boolean(square && view.pieces.has(square)),
		card: left && (tableCovers(e) || cardAt(e) !== null)
	});
	if (cardHeld) { releaseCard(null); } // A card still held: its release never came, it goes back first
	tableDrag = false;
	// A piece still held: its release never came (let go outside the window), it goes back first. dragged: as
	// releaseTable, a drag gives the pick up
	if (view.table && view.held) {
		view.cardOptions.onTable({ kind: "release", square: null, dragged: view.held.following });
	}
	// A Chess Cards game: flow.js decides whether the piece is held (setHeld), where a tap would go to a square
	// (pickTable)
	if (square && view.table && !view.table.open() && !view.table.zoomed() && view.cardOptions.tableOn() && monitorIdle()
		&& !glassHit(e) && !tableAt(e) && cardAt(e) === null) {
		view.cardOptions.onTable({ kind: "press", square });
	}
	const at = e.pointerType === "mouse" && e.button === 0 && view.table && view.cardOptions.tableOn() && monitorIdle()
		&& !glassHit(e) && cardAt(e) === null ? tableAt(e) : null;
	// A card: flow.js says where it can be let go (null: not held), the table whether it's one of the player's to drag.
	// The camera is off already (tableCovers)
	cardHeld = Boolean(at && at.kind !== "button" && at.id && view.table.grab(at,
		view.cardOptions.onTable({ kind: "grab", from: at.kind, id: at.id })));
	// Held DRAG_HOLD_MS as a piece is, the card is picked up even before it moves: its release is a drop, not a zooming click
	if (cardHeld) {
		const held = view.press;
		setTimeout(() => {
			if (cardHeld === true && view && view.table && view.press === held) { followCard(view.pointerAt.x, view.pointerAt.y); }
		}, DRAG_HOLD_MS);
	}
}

// The held card goes under the pointer at (x, y)
function followCard(x, y) {
	cardHeld = "moving";
	const rect = view.renderer.domElement.getBoundingClientRect();
	pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
	raycaster.setFromCamera(pointer, view.camera);
	view.table.follow(raycaster);
}

// A held piece past the drag threshold follows the pointer (dragHeld). Before gameplay/input's mousemove / touchmove,
// so its square lookup skips the piece too
export function onPointerMove(e) {
	view.pointerAt = { x: e.clientX, y: e.clientY };
	// Touch has no hover, a drag is the camera's. A picked piece that only floats (no press down) leaves the mouse its
	// hover
	if (e.pointerType === "mouse" && !cardHeld && !(view.held && view.held.dragging) && !view.controlsActive) {
		hoverGlass(e);
		hoverCards(e);
	}
	// Also while a piece is dragged: the box leads, the held piece floats over its tile (liftHeld)
	if (e.pointerType === "mouse") {
		view.pointerOver = true;
		hoverBoard(e);
	}
	// Held and moved as a piece is (isDrag), the card follows the pointer: a quick or shaky click stays a click
	if (cardHeld && view.table && e.pointerType === "mouse"
		&& (cardHeld === "moving"
			|| isDrag(Math.hypot(e.clientX - view.press.x, e.clientY - view.press.y), performance.now() - view.press.time, false))) {
		followCard(e.clientX, e.clientY);
	}
	const held = view.held;
	if (!held || !held.dragging || view.cameraGesture) { return; }
	// A mouse waits DRAG_HOLD_MS as in 2D, touch only goes by distance (gameplay/input)
	if (!held.following
		&& isDrag(Math.hypot(e.clientX - view.press.x, e.clientY - view.press.y), performance.now() - view.press.time, e.pointerType === "touch")) {
		held.following = true;
	}
	if (held.following) { liftHeld(); }
}

// On the window, after onTouchTap(): the finger is up, and once every finger is the next touch can be a tap again
export function onPointerUp(e) {
	if (!view) { return; }
	view.controls.enabled = monitorIdle();
	if (e.pointerType === "mouse") {
		releaseTable(e);
		releaseCard(e);
		return;
	}
	view.touches.delete(e.pointerId);
	if (!view.touches.size) { view.multiTouch = false; }
}

// A Chess Cards game's mouse let go of the piece it held (the only piece held there: gameplay/input's mouse listeners
// are off, input/modes.js): flow.js puts it back and plays a drag. Let go on a square (not on the glass or a card, not a
// cancelled pointer). A drag isn't a tap: the click that follows is not the table's (pickTable), even let go where it
// was pressed
function releaseTable(e) {
	const held = view.held;
	if (!view.table || !held || !held.dragging) { return; }
	// A quick flick that stopped moving before DRAG_HOLD_MS ran out: let go past it and away from the press, it's a drag
	if (!held.following && e.pointerType === "mouse"
		&& isDrag(Math.hypot(e.clientX - view.press.x, e.clientY - view.press.y), performance.now() - view.press.time, false)) {
		held.following = true;
	}
	tableDrag = held.following;
	const onBoard = held.following && e.type === "pointerup" && monitorIdle() && !glassHit(e) && !tableAt(e);
	// dragged: it followed the pointer, so letting go off a target gives the pick up
	view.cardOptions.onTable({ kind: "release", square: (onBoard && squareUnder(e)) || null, dragged: held.following });
}

// A Chess Cards game's mouse let go of the card it dragged: flow.js plays it for the place under it ({ kind: "drop" },
// true: taken) and the card stays there, else it slides back (nowhere, on the glass, a cancelled pointer, a drop the
// game doesn't offer). A press that never dragged is left to its click
function releaseCard(e) {
	// The place is measured at the release, from the camera as it is now: it may have glided since the last move
	if (cardHeld === "moving" && e && e.type === "pointerup" && view.table) {
		const rect = view.renderer.domElement.getBoundingClientRect();
		pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
		view.camera.updateMatrixWorld();
		raycaster.setFromCamera(pointer, view.camera);
		view.table.follow(raycaster);
	}
	cardHeld = false;
	const drop = view.table ? view.table.release() : null;
	if (!drop) { return; }
	tableDrag = true;
	const onDesk = Boolean(e) && e.type === "pointerup" && monitorIdle() && !glassHit(e);
	// Not on the desk: flow.js still hears of it (no place), so a card that lay on the active spot for its targets has
	// its pick cancelled
	view.table.settle(Boolean(view.cardOptions.onTable(onDesk ? drop : { ...drop, place: null })));
}

/**
 * @description The board's hover (tileHover.js): the tile under the mouse, or none when a camera gesture has the
 * pointer (past DRAG_PX: a press on an empty tile that moves a pixel keeps it) or the glass, a hand card, a pile or a
 * promotion card is under it, as a click there isn't the board's
 * @param  {[object|null]} e [an event with clientX & clientY, null when the pointer left the canvas]
 */
export function hoverBoard(e) {
	const free = Boolean(e) && !view.cameraGesture; // Only then are the rays worth casting
	// tableOn false: a card game's menu is open, the click is the page's (pickTable), so no tile lights
	const on = hoverOn({
		pointer: Boolean(e),
		gesture: view.cameraGesture,
		covered: free && (!view.cardOptions.tableOn() || Boolean(glassHit(e)) || Boolean(tableAt(e)) || cardAt(e) !== null)
	});
	hoverTile(on ? e : null);
}

/**
 * @description The board's hover again for a mouse that hasn't moved: after a camera gesture, & each frame the camera
 * moves by itself (tileHover.js followCamera)
 */
export function rehover() {
	if (!view || view.pointerType !== "mouse") { return; }
	hoverBoard(view.pointerOver ? { clientX: view.pointerAt.x, clientY: view.pointerAt.y } : null);
}

export function onPointerLeave() {
	view.pointerOver = false;
	hoverBoard(null);
	if (view.cards) { view.cards.hover(null); }
	if (view.table) {
		view.table.hover(null);
		hoverPlaque(null);
	}
	view.cardCursor = false;
	if (!view.monitor) { return; }
	view.monitor.pointer("out");
	view.container.style.cursor = "";
}

/* ---------------------------------------------------------------- */
// Cards
/* ---------------------------------------------------------------- */

// A mouse over a card lifts it and shows the hand cursor. After hoverGlass(), which sets the cursor for the glass
function hoverCards(e) {
	if (!view.cards && !view.table) { return; }
	const over = view.cards ? cardAt(e) : null;
	const table = tableAt(e);
	if (view.cards) { view.cards.hover(over); }
	if (view.table) {
		view.table.hover(table && table.kind === "hand" ? table.id : null);
		hoverPlaque(table && table.kind === "button" ? table.id : null);
	}
	if (over !== null || table) {
		view.container.style.cursor = "pointer";
		view.cardCursor = true;
	}
	else if (view.cardCursor) {
		view.cardCursor = false;
		if (!view.monitor) { view.container.style.cursor = ""; } // With a monitor hoverGlass() already set it
	}
}

// A Chess Cards game's tap: a pile opens or closes, a hand card or a square goes to cardOptions.onTable
// (gameplay/cards/flow.js). Not on the glass: that's the monitor's, nor while cardOptions.tableOn() is false
function pickTable(e, stop) {
	// The menu open: the page's click-away closes it, nothing is played
	if (!view.table || !view.cardOptions.tableOn() || view.cameraGesture || tableDrag
		|| !isTap(view.press, { x: e.clientX, y: e.clientY }, view.pointerType) || glassHit(e)) {
		return false;
	}
	const at = tableAt(e);
	const square = at ? null : squareUnder(e);
	const hit = at || (square ? { kind: "square", square } : null);
	// A plaque presses through an open pile or a zoom in one tap, as its 2D button did
	if (at && at.kind === "button") {
		if (stop) { e.stopPropagation(); }
		if (view.table.open()) { togglePile(null); }
		view.cardOptions.onTable(at); // Its 2D button's click ends a zoom (flow.js endZoom)
		return true;
	}
	// A pile is open: a tap anywhere else closes it and does nothing more
	if (view.table.open() && !(at && at.kind === "pile")) {
		if (stop) { e.stopPropagation(); }
		togglePile(null);
		return true;
	}
	// Zoomed in on a hand card: a tap anywhere, on the card too, ends it (the camera goes back) and does nothing more, as
	// an opened pile
	if (view.table.zoomed()) {
		if (stop) { e.stopPropagation(); }
		view.table.zoom(null);
		return true;
	}
	// The promotion cards out (pickCard missed them): a tap on the bare desk cancels it, one just off a card is swallowed
	if (!hit) {
		if (!view.cards || !view.cards.dealt() || !monitorIdle()) { return false; }
		if (stop) { e.stopPropagation(); }
		if (!inPromotionDeadZone(baizePoint(e), view.pointerType === "mouse" ? PROMOTION_DEAD_ZONE : PROMOTION_DEAD_ZONE_TOUCH)) {
			view.cardOptions.onTable({ kind: "desk" });
		}
		return true;
	}
	if (stop) { e.stopPropagation(); }
	// Touch has no hover: a tap names any piece's statuses, and still picks below (the mouse has its hover)
	if (hit.kind === "square" && view.pointerType !== "mouse") { tapStatuses(hit.square); }
	// A finger's tap on a card of the opened pile: flow.js offers its drop button when the game lists one (true), else
	// the pile closes as for the mouse, which drags the card
	if (hit.kind === "pile") {
		if (!(view.pointerType !== "mouse" && hit.id && hit.pile === view.table.open()
			&& view.cardOptions.onTable({ kind: "pile", pile: hit.pile, id: hit.id }))) {
			togglePile(hit.pile);
		}
	}
	// touch: a tap keeps its buttons, the mouse plays by dragging (flow.js). true: an ability card, the camera zooms in
	// on it
	else if (view.cardOptions.onTable({ ...hit, touch: view.pointerType !== "mouse" }) && hit.kind === "hand") {
		view.table.zoom(hit.id);
	}
	return true;
}

/**
 * @description A tap (a mouse click or a lifted finger) at a point: on the glass it zooms in or presses a button, off
 * it it goes back to the desk
 * @param  {[object]} e [the click or pointerup, with clientX & clientY: the release point]
 * @return {[boolean]} [the monitor used it, so the board must not]
 */
function monitorTap(e) {
	const monitor = view.monitor;
	// A lost context draws no zoom, it would stick in zooming
	if (!monitor || view.lost || view.cameraGesture || !isTap(view.press, { x: e.clientX, y: e.clientY }, view.pointerType)) {
		return false;
	}
	const at = glassHit(e);
	if (monitor.state === "idle") { return Boolean(at) && enterMonitor(); }
	if (at && monitor.state === "zoomed") { monitor.pointer("press", at.x, at.y); }
	else if (!at && (monitor.state === "zoomed" || monitor.state === "zooming")) { leaveMonitor(); }
	return true;
}

// Capture phase, before gameplay/input's click: the mouse's tap. At the monitor no click reaches the board. A finger's
// or pen's is onTouchTap()'s: gameplay's touchstart cancels the click a touch (or an Apple Pencil) would make, and one
// the browser makes anyway (no touch listeners in remote-only mode, a Windows pen) would be the same tap twice
export function onClick(e) {
	// A card (or a card game's square), not the board's or the monitor's
	if (view.pointerType === "mouse" && (pickCard(e, true) || pickTable(e, true))) { return; }
	if (!view.monitor) { return; }
	const idle = view.monitor.state === "idle";
	if (!idle) { e.stopPropagation(); }
	if (view.pointerType !== "mouse") { return; }
	if (monitorTap(e) && idle) { e.stopPropagation(); }
}

// Capture phase: a lifted finger (or pen) is a tap when it was the only one down the whole time (not a pinch or orbit)
// and didn't move. It runs before gameplay's touchend, which then sees the monitor busy (isCameraGesture) and leaves the
// board alone. Not stopped: the camera controls need their pointerup
export function onTouchTap(e) {
	if (e.pointerType === "mouse" || view.multiTouch || view.touches.size !== 1 || !view.touches.has(e.pointerId)) { return; }
	// Not stopped: the camera controls need their pointerup, and gameplay's touchend does nothing on a tap off the board
	if (pickCard(e, false) || pickTable(e, false)) { return; }
	if (view.monitor) { monitorTap(e); }
}

// Capture phase on the window: zoomed, the monitor's keys (WASD, the arrows, Enter, Space, Escape) are its alone,
// Escape while zooming in too. Not while typing, not shortcuts. The monitor's focus element (#monitorFocus, a div) is
// no typing target, so its keys come here
export function onKeyDown(e) {
	const monitor = view && view.monitor;
	if (!monitor || e.altKey || e.ctrlKey || e.metaKey) { return; }
	if (monitor.state !== "zoomed" && !(monitor.state === "zooming" && e.key === "Escape")) { return; }
	const target = e.target;
	if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) { return; }
	if (monitor.key(e.key)) {
		e.preventDefault();
		e.stopImmediatePropagation();
	}
}

/**
 * @description The game's data for the monitor (common shapes). Kept until the room has loaded, nothing on a board with
 * no monitor
 * @param  {[object]} data { ai, over, yourTurn, result, moves, opening, eval, actions }
 */
export function setMonitor(data) {
	if (!view) { return; }
	view.monitorData = data;
	if (view.monitor) { view.monitor.update(monitorInput(data)); }
}

/**
 * @description Zooms the camera in to the monitor (a tap on its glass does too)
 * @return {[boolean]} [false with no monitor, while the GPU context is lost, or before it has a game's data]
 */
export function enterMonitor() {
	if (!view || !view.monitor || view.lost) { return false; } // No frames while the context is lost: the zoom would never arrive
	view.monitor.enter();
	return view.monitor.state !== "idle";
}

/**
 * @description Takes the camera back to the desk
 * @return {[Promise<void>]} [resolves once the monitor is idle again, at once when it already is]
 */
export function leaveMonitor() {
	if (!view || monitorIdle()) { return Promise.resolve(); }
	const done = new Promise((resolve) => view.leaving.push(resolve));
	view.monitor.leave();
	return done;
}

/**
 * @description The monitor's state
 * @return {[string|null]} ["idle", "zooming", "zoomed" or "leaving", null with no monitor]
 */
export function monitorState() {
	return view && view.monitor ? view.monitor.state : null;
}

/**
 * @description The keyboard's focus came to the monitor's screen or left it (the page's stop, gameplay/monitor): on the
 * desk the glass shows a border
 * @param  {[boolean]} on
 */
export function focusMonitor(on) {
	if (view && view.monitor) { view.monitor.deskFocus(Boolean(on)); }
}
