// Owns 3D board pointer and monitor input
import { view, setLabels, requestRender, squareUnder, pointer, raycaster, forward, offset } from "./index.js";
import { setRoomSide, zoomTo, setCameraAt, zoomSpot, landHome, landTurn, landDealEase } from "./camera.js";
import { liftHeld } from "./motion.js";
import { hoverTile } from "./tileHover.js";
import { hoverOn } from "./hoverRules.js";
import { MIN_DISTANCE, MAX_DISTANCE, MAX_TILT, BOARD_SIZE, DRAG_PX, TOUCH_DRAG_PX, DRAG_HOLD_MS } from "./constants.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MOUSE, TOUCH } from "three";
import { dismissHint } from "./hint.js";
import { redrawScreen } from "./screen.js";
import { uvToGrid, isTap } from "./monitor/monitor.js";
import { CARD_ORDER } from "./cardLayout.js";

let tableDrag = false; // THIS PRESS DRAGGED A CHESS CARDS GAME'S PIECE (releaseTable): ITS CLICK ISN'T A TAP

/* ---------------------------------------------------------------- */
// Camera Controls
/* ---------------------------------------------------------------- */

// MOUSE: LEFT-DRAG PANS (ON A PIECE IT'S PIECE INPUT INSTEAD), RIGHT-DRAG ROTATES, SCROLL ZOOMS. TOUCH: ONE FINGER IS PIECE INPUT,
// TWO ROTATE & PINCH ZOOM. A PRESS THAT MOVES THE CAMERA PAST DRAG_PX (OR ANY TWO FINGER TOUCH) SETS cameraGesture, SO gameplay/input IGNORES IT
export function createControls(camera, canvas) {
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
		setRoomSide(view.side);
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
		if (v.cameraGesture) { setTimeout(function () { if (!v.controlsActive) { v.cameraGesture = false; if (view === v) { rehover(); } } }, 0); } // AFTER THE CLICK THE RELEASE FIRES. THE GESTURE TOOK THE BOARD'S HOVER: IT COMES BACK UNDER A STILL MOUSE
	});
	return controls;
}

// THE CONTROLS OWN THE POINTER FROM HERE. THE FIRST CAMERA MOVE ALSO DISMISSES THE CONTROLS HINT
function startGesture() {
	view.cameraGesture = true;
	dismissHint();
}

// CAPTURE PHASE, BEFORE THE CONTROLS SEE IT: A LEFT MOUSE PRESS ON A PIECE IS PIECE INPUT, THE CAMERA SITS IT OUT UNTIL THE RELEASE
export function onPointerDown(e) {
	if (!view.controlsActive) {
		view.cameraGesture = false;
		view.press = { x: e.clientX, y: e.clientY, time: performance.now() };
	}
	view.pointerAt = { x: e.clientX, y: e.clientY };
	view.pointerType = e.pointerType;
	if (e.pointerType !== "mouse") { // EVERY FINGER (OR PEN) DOWN: A SECOND ONE MAKES THIS TOUCH A PINCH OR ORBIT, NEVER A TAP
		view.touches.add(e.pointerId);
		if (view.touches.size > 1) { view.multiTouch = true; }
	}
	const square = e.pointerType === "mouse" && e.button === 0 && squareUnder(e); // THE SAME SQUARE gameplay/input PICKS A PIECE UP FROM, NOT ONLY A HIT ON THE MESH: A PRESS BESIDE A PIECE ON ITS SQUARE PICKS IT UP TOO
	view.controls.enabled = monitorIdle() && !(square && view.pieces.has(square)); // ZOOMED ON THE MONITOR THE CAMERA STAYS PUT
	tableDrag = false;
	if (view.table && view.held) { view.cardOptions.onTable({ kind: "release", square: null, dragged: view.held.following }); } // A PIECE STILL HELD: ITS RELEASE NEVER CAME (LET GO OUTSIDE THE WINDOW), IT GOES BACK FIRST. dragged: AS releaseTable, A DRAG GIVES THE PICK UP
	if (square && view.table && view.cardOptions.tableOn() && monitorIdle() && !glassHit(e) && !tableAt(e) && cardAt(e) === null) { view.cardOptions.onTable({ kind: "press", square }); } // A CHESS CARDS GAME: flow.js DECIDES WHETHER THE PIECE IS HELD (setHeld). WHERE A TAP WOULD GO TO A SQUARE (pickTable)
}

// A HELD PIECE PAST THE DRAG THRESHOLD FOLLOWS THE POINTER (dragHeld). BEFORE gameplay/input'S mousemove / touchmove, SO ITS SQUARE LOOKUP SKIPS THE PIECE TOO
export function onPointerMove(e) {
	view.pointerAt = { x: e.clientX, y: e.clientY };
	if (e.pointerType === "mouse" && !(view.held && view.held.dragging) && !view.controlsActive) { hoverGlass(e); hoverCards(e); } // TOUCH HAS NO HOVER, A DRAG IS THE CAMERA'S. A PICKED PIECE THAT ONLY FLOATS (NO PRESS DOWN) LEAVES THE MOUSE ITS HOVER
	if (e.pointerType === "mouse") { view.pointerOver = true; hoverBoard(e); } // ALSO WHILE A PIECE IS DRAGGED: THE BOX LEADS, THE HELD PIECE FLOATS OVER ITS TILE (liftHeld)
	const held = view.held;
	if (!held || !held.dragging || view.cameraGesture) { return; }
	const touch = e.pointerType === "touch";
	const moved = Math.hypot(e.clientX - view.press.x, e.clientY - view.press.y) > (touch ? TOUCH_DRAG_PX : DRAG_PX);
	if (!held.following && moved && (touch || performance.now() - view.press.time > DRAG_HOLD_MS)) { held.following = true; } // A MOUSE WAITS DRAG_HOLD_MS LIKE 2D, TOUCH ONLY GOES BY DISTANCE (gameplay/input)
	if (held.following) { liftHeld(); }
}

// ON THE WINDOW, AFTER onTouchTap(): THE FINGER IS UP, & ONCE EVERY FINGER IS THE NEXT TOUCH CAN BE A TAP AGAIN
export function onPointerUp(e) {
	if (!view) { return; }
	view.controls.enabled = monitorIdle();
	if (e.pointerType === "mouse") { releaseTable(e); return; }
	view.touches.delete(e.pointerId);
	if (!view.touches.size) { view.multiTouch = false; }
}

// A CHESS CARDS GAME'S MOUSE LET GO OF THE PIECE IT HELD (THE ONLY PIECE HELD THERE: gameplay/input'S MOUSE LISTENERS ARE OFF, input/modes.js): flow.js PUTS IT BACK & PLAYS A DRAG
// LET GO ON A SQUARE (NOT ON THE GLASS OR A CARD, NOT A CANCELLED POINTER). A DRAG ISN'T A TAP: THE CLICK THAT FOLLOWS IS NOT THE TABLE'S (pickTable), EVEN LET GO WHERE IT WAS PRESSED
function releaseTable(e) {
	const held = view.held;
	if (!view.table || !held || !held.dragging) { return; }
	tableDrag = held.following;
	const onBoard = held.following && e.type === "pointerup" && monitorIdle() && !glassHit(e) && !tableAt(e);
	view.cardOptions.onTable({ kind: "release", square: (onBoard && squareUnder(e)) || null, dragged: held.following }); // dragged: IT FOLLOWED THE POINTER, SO LETTING GO OFF A TARGET GIVES THE PICK UP
}

/* ---------------------------------------------------------------- */
// Monitor
/* ---------------------------------------------------------------- */

// THE MONITOR IS ON THE DESK (OR THERE IS NONE): THE BOARD & THE CAMERA CONTROLS ARE THE PLAYER'S
export function monitorIdle() {
	return !view.monitor || view.monitor.state === "idle";
}

// THE DATA THE MONITOR GETS: setMonitor()'S & THE OPPONENT'S NAME & STATUS (setScreen) FOR THE SCREEN READER
export function monitorInput(data) {
	const state = view.screenState || {};
	return { ...data, screen: { name: state.name || "", status: state.status || "" } };
}

// THE MONITOR'S show(): REDRAWS THE GLASS, THEN MOVES THE CAMERA FOR A NEW STATE. monitor.js CHANGES STATE BY ITSELF TOO (BACK, ESCAPE),
// SO THE CAMERA FOLLOWS ITS STATE, NOT THIS FILE'S CALLS
export function onMonitorShow(v) {
	redrawScreen();
	if (view !== v || !v.monitor) { return; }
	const state = v.monitor.state, was = v.monitorSeen;
	if (state === was) { return; }
	v.monitorSeen = state;
	if (was === "idle") { leaveDesk(); }
	if (state === "zooming") { zoomTo(false); }
	else if (state === "zoomed" && was !== "zooming") { setCameraAt(zoomSpot()); } // REDUCED MOTION: STRAIGHT FROM THE DESK (A FINISHED ZOOM IS ALREADY THERE)
	else if (state === "leaving") { zoomTo(true); }
	else if (state === "idle") { landHome(); }
	requestRender();
	v.monitorOptions.onChange({ ready: true, state });
}

// THE CAMERA LEAVES THE DESK: REMEMBERS WHERE IT WAS & TAKES IT FROM THE CONTROLS. A FLIP BOARD TURN & A DEAL'S CAMERA MOVE LAND FIRST
function leaveDesk() {
	const { camera, controls } = view;
	landTurn();
	landDealEase();
	view.home = { position: camera.position.clone(), target: controls.target.clone() };
	view.zoomLook.copy(controls.target);
	controls.enabled = false;
}

// THE GRID PIXEL UNDER A POINTER EVENT ON THE GLASS, null WHEN THE BOARD'S TILES ARE IN FRONT OF IT OR IT ISN'T UNDER IT. A PIECE'S BODY OFF THE TILES IS IGNORED (USER RULING R3, TASK 20E):
// THE BOARD IS PICKED BY TILE, SO A BODY STANDING OUT PAST THE BOARD'S EDGE IN FRONT OF THE GLASS WOULD BE A SPOT WHERE NOTHING ANSWERS
function glassHit(e) {
	if (!view.glass) { return null; }
	const rect = view.renderer.domElement.getBoundingClientRect();
	pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
	raycaster.setFromCamera(pointer, view.camera);
	view.camera.getWorldDirection(forward);
	const depth = (h) => offset.copy(h.point).sub(view.camera.position).dot(forward); // THE NEAR PLANE CLIPS BY DEPTH ALONG THE VIEW, NOT DISTANCE ALONG THE RAY
	const hit = raycaster.intersectObjects([view.glass, view.plane], false).find((h) => depth(h) >= view.camera.near); // WHAT THE NEAR PLANE CLIPS ISN'T DRAWN, SO IT CAN'T BE IN THE WAY
	return hit && hit.object === view.glass && hit.uv ? uvToGrid(hit.uv.x, hit.uv.y) : null;
}

// A MOUSE OVER THE GLASS: THE MONITOR'S HOVER (THE FACE'S EYES ON THE DESK, A BUTTON ZOOMED) & A HAND CURSOR
function hoverGlass(e) {
	if (!view.monitor) { return; }
	const at = glassHit(e);
	if (at) { view.monitor.pointer("move", at.x, at.y); }
	else { view.monitor.pointer("out"); }
	const cursor = at ? "pointer" : "";
	if (view.container.style.cursor !== cursor) { view.container.style.cursor = cursor; }
}

/**
 * @description The board's hover (tileHover.js): the tile under the mouse, or none when a camera gesture has the pointer (past DRAG_PX: a press on an empty tile that moves a pixel keeps it) or the glass, a hand card, a pile or a promotion card is under it, as a click there isn't the board's
 * @param  {[object|null]} e [an event with clientX & clientY, null when the pointer left the canvas]
 */
export function hoverBoard(e) {
	const free = Boolean(e) && !view.cameraGesture; // ONLY THEN ARE THE RAYS WORTH CASTING
	const on = hoverOn({ pointer: Boolean(e), gesture: view.cameraGesture, covered: free && (Boolean(glassHit(e)) || Boolean(tableAt(e)) || cardAt(e) !== null) });
	hoverTile(on ? e : null);
}

/**
 * @description The board's hover again for a mouse that hasn't moved: after a camera gesture, & each frame the camera moves by itself (tileHover.js followCamera)
 */
export function rehover() {
	if (!view || view.pointerType !== "mouse") { return; }
	hoverBoard(view.pointerOver ? { clientX: view.pointerAt.x, clientY: view.pointerAt.y } : null);
}

export function onPointerLeave() {
	view.pointerOver = false;
	hoverBoard(null);
	if (view.cards) { view.cards.hover(null); }
	if (view.table) { view.table.hover(null); }
	view.cardCursor = false;
	if (!view.monitor) { return; }
	view.monitor.pointer("out");
	view.container.style.cursor = "";
}

/* ---------------------------------------------------------------- */
// Cards
/* ---------------------------------------------------------------- */

// THE PROMOTION CARD UNDER A POINTER EVENT (ITS INDEX IN CARD_ORDER), null FOR NONE, WHILE THE CARDS ARE OUT & THE MONITOR IS ON THE DESK
function cardAt(e) {
	if (!view.cards || !view.cards.dealt() || !monitorIdle()) { return null; }
	const rect = view.renderer.domElement.getBoundingClientRect();
	pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
	raycaster.setFromCamera(pointer, view.camera);
	return view.cards.hit(raycaster);
}

// THE CHESS CARDS TABLE UNDER A POINTER EVENT: ONE OF THE PLAYER'S HAND CARDS OR A BOARD EFFECTS PILE (cardTable.js hit), null FOR NONE, WHILE THE MONITOR IS ON THE DESK
function tableAt(e) {
	if (!view.table || !monitorIdle()) { return null; }
	const rect = view.renderer.domElement.getBoundingClientRect();
	pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
	raycaster.setFromCamera(pointer, view.camera);
	return view.table.hit(raycaster);
}

// A MOUSE OVER A CARD LIFTS IT & SHOWS THE HAND CURSOR. AFTER hoverGlass(), WHICH SETS THE CURSOR FOR THE GLASS
function hoverCards(e) {
	if (!view.cards && !view.table) { return; }
	const over = view.cards ? cardAt(e) : null, table = tableAt(e);
	if (view.cards) { view.cards.hover(over); }
	if (view.table) { view.table.hover(table && table.kind === "hand" ? table.id : null); }
	if (over !== null || table) { view.container.style.cursor = "pointer"; view.cardCursor = true; }
	else if (view.cardCursor) { view.cardCursor = false; if (!view.monitor) { view.container.style.cursor = ""; } } // WITH A MONITOR hoverGlass() ALREADY SET IT
}

// A TAP (A CLICK OR A LIFTED FINGER) ON A CARD PICKS IT. STOPS THE EVENT WHEN stop IS TRUE (A CLICK: THE BOARD MUST NOT SEE IT)
function pickCard(e, stop) {
	if (view.cameraGesture || !isTap(view.press, { x: e.clientX, y: e.clientY }, view.pointerType)) { return false; }
	const index = cardAt(e);
	if (index === null) { return false; }
	if (stop) { e.stopPropagation(); }
	view.cardOptions.onPick(CARD_ORDER[index]);
	return true;
}

// A CHESS CARDS GAME'S TAP: A PILE OPENS OR CLOSES, A HAND CARD OR A SQUARE GOES TO cardOptions.onTable (gameplay/cards/flow.js). NOT ON THE GLASS: THAT'S THE MONITOR'S, NOR WHILE cardOptions.tableOn() IS FALSE
function pickTable(e, stop) {
	if (!view.table || !view.cardOptions.tableOn() || view.cameraGesture || tableDrag || !isTap(view.press, { x: e.clientX, y: e.clientY }, view.pointerType) || glassHit(e)) { return false; } // THE MENU OPEN: THE PAGE'S CLICK-AWAY CLOSES IT, NOTHING IS PLAYED
	const at = tableAt(e), square = at ? null : squareUnder(e), hit = at || (square ? { kind: "square", square } : null);
	if (view.table.open() && !(at && at.kind === "pile")) { // A PILE IS OPEN: A TAP ANYWHERE ELSE CLOSES IT & DOES NOTHING MORE
		if (stop) { e.stopPropagation(); }
		view.table.togglePile(null);
		return true;
	}
	if (!hit) { return false; }
	if (stop) { e.stopPropagation(); }
	if (hit.kind === "pile") { view.table.togglePile(hit.pile); }
	else { view.cardOptions.onTable(hit); }
	return true;
}

/**
 * @description A tap (a mouse click or a lifted finger) at a point: on the glass it zooms in or presses a button, off it it goes back to the desk
 * @param  {[object]} e [the click or pointerup, with clientX & clientY: the release point]
 * @return {[boolean]} [the monitor used it, so the board must not]
 */
function monitorTap(e) {
	const monitor = view.monitor;
	if (!monitor || view.lost || view.cameraGesture || !isTap(view.press, { x: e.clientX, y: e.clientY }, view.pointerType)) { return false; } // A LOST CONTEXT DRAWS NO ZOOM, IT WOULD STICK IN zooming
	const at = glassHit(e);
	if (monitor.state === "idle") { return Boolean(at) && enterMonitor(); }
	if (at && monitor.state === "zoomed") { monitor.pointer("press", at.x, at.y); }
	else if (!at && (monitor.state === "zoomed" || monitor.state === "zooming")) { leaveMonitor(); }
	return true;
}

// CAPTURE PHASE, BEFORE gameplay/input'S CLICK: THE MOUSE'S TAP. AT THE MONITOR NO CLICK REACHES THE BOARD. A FINGER'S OR PEN'S IS onTouchTap()'S: gameplay'S
// touchstart CANCELS THE CLICK A TOUCH (OR AN APPLE PENCIL) WOULD MAKE, & ONE THE BROWSER MAKES ANYWAY (NO TOUCH LISTENERS IN REMOTE-ONLY MODE, A WINDOWS PEN) WOULD BE THE SAME TAP TWICE
export function onClick(e) {
	if (view.pointerType === "mouse" && (pickCard(e, true) || pickTable(e, true))) { return; } // A CARD (OR A CARD GAME'S SQUARE), NOT THE BOARD'S OR THE MONITOR'S
	if (!view.monitor) { return; }
	const idle = view.monitor.state === "idle";
	if (!idle) { e.stopPropagation(); }
	if (view.pointerType !== "mouse") { return; }
	if (monitorTap(e) && idle) { e.stopPropagation(); }
}

// CAPTURE PHASE: A LIFTED FINGER (OR PEN) IS A TAP WHEN IT WAS THE ONLY ONE DOWN THE WHOLE TIME (NOT A PINCH OR ORBIT) & DIDN'T MOVE. IT RUNS BEFORE gameplay'S
// touchend, WHICH THEN SEES THE MONITOR BUSY (isCameraGesture) & LEAVES THE BOARD ALONE. NOT STOPPED: THE CAMERA CONTROLS NEED THEIR pointerup
export function onTouchTap(e) {
	if (e.pointerType === "mouse" || view.multiTouch || view.touches.size !== 1 || !view.touches.has(e.pointerId)) { return; }
	if (pickCard(e, false) || pickTable(e, false)) { return; } // NOT STOPPED: THE CAMERA CONTROLS NEED THEIR pointerup, & gameplay's touchend DOES NOTHING ON A TAP OFF THE BOARD
	if (view.monitor) { monitorTap(e); }
}

// CAPTURE PHASE ON THE WINDOW: ZOOMED, THE MONITOR'S KEYS (WASD, THE ARROWS, ENTER, SPACE, ESCAPE) ARE ITS ALONE, ESCAPE WHILE ZOOMING IN TOO.
// NOT WHILE TYPING, NOT SHORTCUTS. THE MONITOR'S FOCUS ELEMENT (#monitorFocus, A DIV) IS NO TYPING TARGET, SO ITS KEYS COME HERE
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
 * @description The game's data for the monitor (common shapes). Kept until the room has loaded, nothing on a board with no monitor
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
	if (!view || !view.monitor || view.lost) { return false; } // NO FRAMES WHILE THE CONTEXT IS LOST: THE ZOOM WOULD NEVER ARRIVE
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
 * @description The keyboard's focus came to the monitor's screen or left it (the page's stop, gameplay/monitor): on the desk the glass shows a border
 * @param  {[boolean]} on
 */
export function focusMonitor(on) {
	if (view && view.monitor) { view.monitor.deskFocus(Boolean(on)); }
}
