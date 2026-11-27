/*
 *  renderer.lifecycle.js  --  chess frontend
 *	Renderer: putting the 3D board up and taking it down (setView), whether this screen can have it (can3D), a screen that turns
 *	touch-first, and a lost WebGL context.
 *
 */

const { game, canvas, chessInst, requestFrame } = require("../state/index.js");
const { load3D } = require("../three/load.js"); // Downloads the 3D board the first time it's turned on
const { showStatus, MESSAGE_TIME } = require("../status/index.js");
const { reportError } = require("../../pages/utils/reportErrors.js");
const rendererState = require("./renderer.state.js");
const { syncMonitor3D, syncTaken3D, syncFacing3D } = require("./renderer.draw.js");
const { applyTable3D, tableUp } = require("./renderer.table.js");

export const VIEWS = { TWO_D: "2d", THREE_D: "3d" };

let switching = null; // The setView() in progress, so two presses don't mount twice
let tableImage = null; // The 2D canvas's CSS table background, taken off on 3D (it's opaque and would hide the 3D board)
export const boardListeners = []; // [type, handler, options] from addBoardListener, put on each new 3D container too
let viewListener = function () {}; // onViewChange()'s, told when 3D falls back to 2D by itself

const RESTORE_WAIT_MS = 3000; // A lost context not given back this long after the page is seen: a new board (and context) goes up anyway
const MAX_LOSSES = 3; // This many lost contexts...
const LOSS_WINDOW_MS = 2 * 60 * 1000; // ...this close together and it's back to 2D
let losses = []; // When each recent context was lost (Date.now())
let restoreTimer = null;

/* ---------------------------------------------------------------- */
// Switch
/* ---------------------------------------------------------------- */
/**
 * @description Shows the 2D canvas or the 3D board, mid-game too: the one that's on is taken down, the other is put up and set
 * to the position. 3D that can't load or mount says why (status "view") and stays on 2D
 * @param  {[string]} view [VIEWS.TWO_D or VIEWS.THREE_D]
 * @return {[Promise<string>]} [the view that's on now]
 */
export function setView(view) {
	// Temporary (can3D): a phone or tablet already in 3D (saved, or left on) goes to 2D
	return queueSwitch(function () {
		return view === VIEWS.THREE_D && can3D() ? show3D() : show2D();
	});
}

/* ---------------------------------------------------------------- */
// Can 3D
/* ---------------------------------------------------------------- */
/**
 * @description Temporary, until the 3D board's touch and remote controls are done. Can this screen turn 3D on? Not on a phone or
 * tablet (a touch-first screen) and not in remote-only mode (game.REMOTE_ONLY_CONDITIONAL). Remove it with its callers: setView(),
 * watchTouchScreen(), loadView(), and setViewWords() and handleView() in gameplay/menu/index.js
 * @return {[boolean]} can
 */
export function can3D() { // Temporary
	if (game.REMOTE_ONLY_CONDITIONAL) { return false; } // The remote can't work the 3D camera or monitor yet
	return !window.matchMedia("(pointer: coarse)").matches; // A touch laptop with a mouse or trackpad still has 3D
}

/* ---------------------------------------------------------------- */
// Watch Touch Screen
/* ---------------------------------------------------------------- */
/**
 * @description Temporary, with can3D(). A screen that turns touch-first while 3D is on (a tablet's keyboard and trackpad taken
 * off) switches to 2D by itself. Either way the menu's View button is told (viewListener), so it says and does what this screen can
 */
function watchTouchScreen() { // Temporary
	if (typeof window == "undefined" || !window.matchMedia) { return; }
	window.matchMedia("(pointer: coarse)").addEventListener("change", function () {
		if (!can3D() && rendererState.calls.currentView() === VIEWS.THREE_D) { queueSwitch(show2D).then(viewListener); return; }
		viewListener(rendererState.calls.currentView()); // The button turns back on (or off) without a switch
	});
}
watchTouchScreen();

/**
 * @description Calls listener with the view that's on when the board switches by itself (3D lost its context for good and fell
 * back to 2D)
 * @param  {[function]} listener [(view) => {}]
 */
export function onViewChange(listener) {
	viewListener = listener;
}

// Runs task after the last switch, so the last press wins
function queueSwitch(task) {
	const next = (switching || Promise.resolve()).then(task);
	switching = next;
	next.finally(function () { if (switching === next) { switching = null; } });
	return next;
}

/* ---------------------------------------------------------------- */
// Lost Context
/* ---------------------------------------------------------------- */
// The 3D board stopped drawing. Too many lately: 2D, otherwise a new board goes up when the context is back (or after a wait)
function contextLost() {
	const now = Date.now();
	losses = losses.filter((time) => now - time < LOSS_WINDOW_MS).concat(now);
	reportError("3D board lost its WebGL context", "3d-board");
	if (losses.length >= MAX_LOSSES) { fallBack2D("3D board kept losing its graphics. Switched to 2D."); return; }
	waitForRestore();
}

// Waits RESTORE_WAIT_MS of the page being seen (a hidden page doesn't count), then rebuilds even if the context isn't back
function waitForRestore() {
	stopWaiting();
	if (document.hidden) { document.addEventListener("visibilitychange", waitForRestore, { once: true }); return; }
	restoreTimer = setTimeout(rebuild3D, RESTORE_WAIT_MS);
}

function stopWaiting() {
	clearTimeout(restoreTimer);
	restoreTimer = null;
	document.removeEventListener("visibilitychange", waitForRestore);
}

// Takes down the lost board and puts up a new one at the current position (show3D syncs it). One that can't start: 2D
function rebuild3D() {
	stopWaiting();
	queueSwitch(function () {
		if (!rendererState.state.board3D) { return VIEWS.TWO_D; } // The player went to 2D meanwhile
		remove3D();
		return show3D();
	}).then(function (on) {
		if (on !== VIEWS.THREE_D) { viewListener(on); }
	});
}

function fallBack2D(message) {
	stopWaiting();
	queueSwitch(function () {
		showStatus("view", message, MESSAGE_TIME);
		reportError(message, "3d-board");
		return show2D();
	}).then(viewListener);
}

async function show3D() {
	if (rendererState.state.board3D) { return VIEWS.THREE_D; }
	const board = await load3D(); // null: load3D already said why
	if (!board) { return show2D(); }
	rendererState.state.container = document.createElement("div");
	rendererState.state.container.id = "board3D";
	rendererState.state.container.style.width = rendererState.state.container.style.height = "100%";
	rendererState.state.container.style.touchAction = "none"; // The touch handlers own every finger: no scroll or pinch zoom of the page
	boardListeners.forEach(([type, handler, options]) => rendererState.state.container.addEventListener(type, handler, options));
	canvas.after(rendererState.state.container);
	try {
		const monitor = rendererState.state.monitorHooks && {
			handlers: rendererState.state.monitorHooks.handlers,
			announce: rendererState.state.monitorHooks.announce,
			onChange: rendererState.state.monitorHooks.onChange,
		};
		const cards = { onPick: handleCardPick, onTable: handleTablePick, tableOn: isTableOn };
		// Throws when the WebGL context can't be made
		board.mount(rendererState.state.container, { onContextLost: contextLost, onContextRestored: rebuild3D, monitor, cards });
	} catch (err) {
		console.warn("3D board failed to start", err);
		reportError(`3D board couldn't start: ${err.message}`, "3d-board");
		board.unmount(); // Frees whatever it made before it threw
		rendererState.state.container.remove();
		rendererState.state.container = null;
		showStatus("view", "3D board couldn't start. Staying on 2D.", MESSAGE_TIME);
		return show2D();
	}
	rendererState.state.board3D = board;
	overlayCanvas(true);
	rendererState.state.board3D.setSide(game.viewColor, false);
	rendererState.state.board3D.syncFromBoard(chessInst);
	rendererState.state.shownFen = chessInst.fen();
	rendererState.state.shownFacings = null;
	syncFacing3D(rendererState.state.shownFen);
	rendererState.state.shownMarks = null;
	rendererState.state.shownTaken = null;
	rendererState.state.shownPromotion = null; // A new board's cards are on the deck
	rendererState.state.shownCardFocus = null;
	game.cardFocus = null;
	syncTaken3D();
	rendererState.state.shownMonitor = null; // A new board (one rebuilt after a lost context too) gets the data again
	syncMonitor3D();
	applyTable3D();
	tableUp();
	if (rendererState.state.tableDuel) { rendererState.state.board3D.dealDuel(rendererState.state.tableDuel); }
	game.refresh = true;
	requestFrame();
	return VIEWS.THREE_D;
}

// The 3D board's card callbacks read cardPick and tablePick when they're called, so a handler set after the mount still hears it.
// The answer goes back to the 3D board (flow.js says whether a card can be held or zoomed)
function handleCardPick(type) {
	return rendererState.state.cardPick?.(type);
}

function handleTablePick(hit) {
	return rendererState.state.tablePick?.(hit);
}

// The table takes clicks only while the menu is closed
function isTableOn() {
	return !game.menuToggled;
}

/**
 * @description On 3D the 2D canvas lies over the 3D board, the same size and place as on 2D, clear except for the taken piece
 * trays (the promotion picker while promoting, game.traysOnly), so they stay where they are on 2D (trayNudge too). Pointer input
 * goes through it to the 3D board; input finds the picker from the canvas position (gameplay/input)
 * @param  {[boolean]} on [true for 3D, false puts it back in the page as the 2D board]
 */
function overlayCanvas(on) {
	game.traysOnly = on;
	if (on) { canvas.setAttribute("aria-hidden", "true"); } // Only trays on 3D: screen readers get the 3D canvas's label, not a second board
	else { canvas.removeAttribute("aria-hidden"); }
	if (on && tableImage === null) { tableImage = canvas.style.backgroundImage; }
	Object.assign(canvas.style, on
		? { position: "fixed", left: "0", top: "0", zIndex: "1", pointerEvents: "none", backgroundImage: "none" }
		: { position: "", left: "", top: "", zIndex: "", pointerEvents: "", backgroundImage: tableImage ?? canvas.style.backgroundImage });
	if (!on) { tableImage = null; }
}

// Takes the 3D board and its container down; the 2D canvas stays as it is
function remove3D() {
	stopWaiting();
	game.cards3D = false; // No board, no cards: the flat picker shows until a new one's room has them
	if (rendererState.state.board3D) {
		rendererState.state.board3D.unmount();
		rendererState.state.board3D = null;
	}
	if (rendererState.state.container) {
		rendererState.state.container.remove();
		rendererState.state.container = null;
	}
}

function show2D() {
	remove3D();
	overlayCanvas(false);
	game.cards3D = false; // 2D has its flat picker
	game.refresh = true; // Redraw the whole canvas, it only had the trays on 3D
	requestFrame();
	return VIEWS.TWO_D;
}
