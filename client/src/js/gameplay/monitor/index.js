/*
 *  index.js  --  chess frontend
 *	Monitor
 *	The game's side of the 3D room's CRT monitor (three/monitor, in the lazily loaded three chunk, so nothing here requires it): the data its
 *	channels show (monitorData), its actions (they press the menu's own buttons, so the menu's rules run), the screen reader's line, the focus while
 *	zoomed (#monitorFocus) & the hide rules.
 *	While the room & its monitor are up & reduced motion is off, what it shows (the eval bar, the move list, the opening, the opponent's name, the menu's
 *	Hint, Takeback, Offer Draw & Eval Bar) leaves the page with data-on-monitor (style.css), & the menu's Monitor item zooms in to it.
 *	The hidden attributes stay the menu code's: an action shows on the monitor exactly when its menu <li> isn't hidden (data.js actionsFrom)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, chessInst } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE BOARD THAT'S DRAWN
const { openMenu, closeMenu } = require("../menu/index.js"); // THE MENU BUTTON OPENS IT AFTER THE CAMERA LEAVES THE MONITOR
const { setMonitorHooks, enterMonitor3D, leaveMonitor3D, monitorState3D } = require("../renderer/index.js"); // THE 3D BOARD'S MONITOR
const { watchEval, evalState, hideEvalBar } = require("../analysis/index.js"); // THE EVAL CHANNEL'S REQUESTS & SCORES, THE BAR IT REPLACES
const { moveListState } = require("../movelist/index.js"); // THE MOVES CHANNEL'S ROWS & OPENING
const { menuItems } = require("../../pages/utils/nav.js"); // A KEY THAT OPENS THE MENU FOCUSES ITS FIRST ITEM
const { isBusy } = require("../../pages/utils/menuItem.js"); // A BUSY ITEM (.loading) CAN'T BE PRESSED ON THE MONITOR
const { actionsFrom, resultText } = require("./data.js"); // THE PURE PART (client/test/monitorData.test.js)
const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES): AT THE MONITOR IT ZOOMS OUT FIRST
const optMonitorBtn = document.getElementById("optMonitor"); // MENU: MONITOR, ZOOMS IN
const resultDisplay = document.getElementById("resultDisplay"); // MENU TITLE ("Chess" OR THE RESULT)
const resultReason = document.getElementById("resultReason"); // THE LINE UNDER THE RESULT
const monitorAnnouncement = document.getElementById("monitorAnnouncement"); // SCREEN READERS: THE MONITOR'S CHANNEL, WHAT IT SHOWS, ITS FOCUSED BUTTON & THE BANNER
const monitorFocus = document.getElementById("monitorFocus"); // WHERE THE FOCUS GOES WHILE ZOOMED (role="application": A SCREEN READER PASSES THE KEYS ON)
const ANNOUNCE_MS = 50; // WHAT IS SAID IN ONE GO IS WRITTEN TOGETHER THIS LONG AFTER THE FIRST
const ACTION_BUTTONS = { // THE MONITOR'S ACTIONS -> THE MENU BUTTONS THEY PRESS
	hint: document.getElementById("optHint"),
	takeback: document.getElementById("optTakeback"),
	draw: document.getElementById("optDraw"),
	restart: document.getElementById("optRestart"),
	pgn: document.getElementById("optPgn"),
};
const ON_MONITOR = [ // WHAT LEAVES THE PAGE WHILE THE MONITOR SHOWS IT
	document.getElementById("evalBar"),
	document.getElementById("moveList"),
	document.getElementById("openingDisplay"),
	document.getElementById("opponentDisplay"),
	...["optHint", "optTakeback", "optDraw", "optEvalBar"].map((id) => document.getElementById(id).parentElement),
];

let ready = false; // THE ROOM & ITS MONITOR ARE UP (three/index.js onChange)
let opener = null; // WHAT HAD THE FOCUS BEFORE THE ZOOM, IT GETS IT BACK ON THE DESK
let said = []; // THE TEXTS WAITING TO BE WRITTEN TO THE LIVE REGION (announce)

/* ---------------------------------------------------------------- */
// Data
/* ---------------------------------------------------------------- */
/**
 * @description What the monitor's channels show (the shared data shape, up to actions). renderer/index.js sends it when it changed
 * @return {[object]} { ai, over, yourTurn, tv, result, moves, opening, eval, actions }
 */
function monitorData() {
	const over = Boolean(game.gameOver);
	const { rows, opening } = moveListState();
	const items = Object.fromEntries(Object.entries(ACTION_BUTTONS).map(([id, button]) => [id, { hidden: button.parentElement.hidden, unavailable: unavailable(button), text: button.textContent.trim() }])); // textContent: innerText WOULD LAY OUT THE PAGE EVERY FRAME
	return {
		ai: Boolean(game.ai),
		over,
		yourTurn: chessInst.turn() === game.playerColor && !over,
		tv: Boolean(game.TV_BOOL),
		result: over ? resultText(resultDisplay.textContent.trim(), resultReason.textContent.trim()) : "", // TEXT ONLY (innerText / innerHTML OF PLAIN WORDS)
		moves: rows,
		opening,
		eval: evalState(),
		actions: actionsFrom(items),
	};
}

// A MENU BUTTON THAT CAN'T BE PRESSED NOW: TURNED DOWN (aria-disabled) OR WAITING ON THE SERVER (.loading)
function unavailable(button) {
	return button.getAttribute("aria-disabled") === "true" || isBusy(button);
}

/**
 * @description Presses a menu button for the monitor, only when the menu would offer it: its <li> isn't hidden & it's available. The monitor's copy can be a frame old
 * @param  {[string]} id [an ACTION_BUTTONS id]
 */
function press(id) {
	const button = ACTION_BUTTONS[id];
	if (button.parentElement.hidden || unavailable(button)) { return; }
	button.click(); // THE MENU'S OWN LISTENER & RULES RUN (gameplay/menu)
}

/**
 * @description The camera is at the monitor (zooming in, there or leaving), not on the desk
 * @return {[boolean]}
 */
export function monitorZoomed() {
	const state = monitorState3D();
	return state !== null && state !== "idle";
}

/* ---------------------------------------------------------------- */
// Screen Reader
/* ---------------------------------------------------------------- */
/**
 * @description Says a text in the monitor's live region. Texts said together (the channel, then its focused tab) are written as one, after the region
 * was emptied, so none overwrites another & a repeated one is read again
 * @param  {[string]} text
 */
function announce(text) {
	if (!text) { return; }
	if (!said.length) {
		monitorAnnouncement.textContent = ""; // EMPTY FIRST: THE SAME TEXT AGAIN IS STILL A CHANGE
		setTimeout(function () {
			monitorAnnouncement.textContent = said.map((t) => t.trim()).map((t) => (/[.!?]$/.test(t) ? t : `${t}.`)).join(" "); // JOINED BY ". ", NO DOUBLE STOP AFTER "SURE?"
			said = [];
		}, ANNOUNCE_MS);
	}
	said.push(text);
}

// WHETHER AN ELEMENT CAN TAKE THE FOCUS BACK: STILL ON THE PAGE, SHOWN & NOT THE PAGE ITSELF
function canFocus(element) {
	return Boolean(element) && element !== document.body && element.isConnected && element.getClientRects().length > 0;
}

/**
 * @description The focus follows the camera: on #monitorFocus while zooming in or zoomed (the window's key listener drives the monitor), back to what had
 * it (else the menu button) on the desk. Only taken back when it is still on #monitorFocus, the player may have moved it meanwhile
 * @param  {[boolean]} up [the monitor is there]
 * @param  {[string|null]} state [its state]
 */
function syncFocus(up, state) {
	if (up && (state === "zooming" || state === "zoomed")) {
		if (!monitorFocus.hidden) { return; }
		opener = document.activeElement;
		monitorFocus.hidden = false;
		monitorFocus.focus({ preventScroll: true });
		return;
	}
	if ((up && state !== "idle") || monitorFocus.hidden) { return; } // LEAVING: IT KEEPS THE FOCUS UNTIL THE DESK
	const had = document.activeElement === monitorFocus || document.activeElement === document.body;
	monitorFocus.hidden = true;
	if (had) { (canFocus(opener) ? opener : optBtn).focus({ preventScroll: true }); }
	opener = null;
}

/* ---------------------------------------------------------------- */
// Hide Rules
/* ---------------------------------------------------------------- */
/**
 * @description Moves what the monitor shows off the page (data-on-monitor) & shows the Monitor item while the monitor is up & reduced motion is off.
 * Otherwise everything is back as on 2D. The menu's hidden attributes are never touched here, only the Monitor item's
 */
function syncHideRules() {
	const on = ready && !game.reduceMotion;
	ON_MONITOR.forEach((element) => element.toggleAttribute("data-on-monitor", on));
	optMonitorBtn.parentElement.hidden = !on;
	hideEvalBar(on); // THE BAR & ITS MENU ITEM ARE OFF THE PAGE: A BAR SAVED ON COUNTS AS OFF
	game.refresh = true;
}

/* ---------------------------------------------------------------- */
// Listeners
/* ---------------------------------------------------------------- */
/**
 * @description The menu's Monitor item: the menu closes & the camera zooms in
 */
function handleMonitor(e) {
	e.preventDefault();
	e.stopPropagation();
	closeMenu();
	if (game.menuToggled) { return; } // IT STAYS OPEN WHILE A NEW BOARD LOADS (canClose)
	enterMonitor3D();
}

/**
 * @description The menu button at the monitor: the camera goes back to the desk first, then the menu opens. Capture phase on the document, before the
 * button's own listener (pages/utils/nav.js), which would open it over the zoomed glass
 */
async function handleMenuButton(e) {
	if (!optBtn.contains(e.target) || !monitorZoomed()) { return; }
	e.preventDefault();
	e.stopImmediatePropagation();
	const byKey = e.detail === 0; // A MOUSE OR FINGER'S CLICK COUNTS FROM 1
	await leaveMonitor3D();
	openMenu();
	if (byKey) { menuItems()[0]?.focus(); } // LIKE THE BUTTON'S OWN LISTENER
}

/**
 * @description Starts the monitor's side of the game: gives renderer/index.js the hooks every 3D board's monitor gets, watches the menu's
 * items so a label or state change reaches the monitor & adds the Monitor item's listeners. startGame (gameplay/index.js) calls this once, TV mode too,
 * before any 3D board goes up
 */
export function startMonitor() {
	setMonitorHooks({
		handlers: {
			hint: () => press("hint"),
			takeback: () => press("takeback"),
			draw: () => press("draw"),
			restart: () => press("restart"), // ONLY OFFERED ONCE THE GAME IS OVER: NO FORFEIT QUESTION
			pgn: () => press("pgn"),
			watchEval,
		},
		announce,
		tv: Boolean(game.TV_BOOL),
		onChange({ ready: up, state }) {
			ready = Boolean(up);
			syncFocus(ready, state);
			if (!ready) { watchEval(false); } // GONE (2D, A FAILED ROOM): NO EVAL CHANNEL IS SHOWING, WHATEVER ITS LAST STATE WAS
			syncHideRules();
		},
		data: monitorData,
	});

	const observer = new MutationObserver(function () { game.refresh = true; }); // THE NEXT FRAME SENDS THE NEW DATA WHEN IT CHANGED (renderer/index.js)
	Object.values(ACTION_BUTTONS).forEach(function (button) {
		observer.observe(button.parentElement, { attributes: true, attributeFilter: ["hidden"] });
		observer.observe(button, { attributes: true, attributeFilter: ["aria-disabled", "class"], childList: true, characterData: true, subtree: true });
	});
	[resultDisplay, resultReason].forEach((element) => observer.observe(element, { childList: true, characterData: true, subtree: true }));

	window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", syncHideRules); // AFTER startGame'S OWN LISTENER SET game.reduceMotion
	optMonitorBtn.addEventListener("click", handleMonitor);
	document.addEventListener("click", handleMenuButton, true);
}
