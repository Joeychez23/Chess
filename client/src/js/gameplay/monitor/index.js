/*
 *  index.js  --  chess frontend
 *	Monitor
 *	The game's side of the 3D room's CRT monitor, a terminal the player types at ("Meridian"; three/monitor is in the lazily loaded
 *	three chunk, so nothing here requires it): the data its screens and console read (monitorData), its actions (they press the
 *	menu's own buttons or call the menu's own functions, so the menu's rules run), the screen reader's line, the focus while zoomed
 *	(#monitorFocus), the keyboard's stop for the screen on the desk and the hide rules.
 *	The stop (#monitorStop) is the leftmost of Left and Right's stops, after the type-move box: the glass shows a border, Enter
 *	zooms in and Escape drops the focus.
 *	While the room and its monitor are up and reduced motion is off, what it shows (the move list, the opening, the opponent's
 *	name, the menu's Hint, Takeback, Offer Draw and Eval Bar) leaves the page with data-on-monitor (style.css), and the menu's Monitor item
 *	zooms in to it. The eval bar and its menu item leave the page too: the terminal's Systems window has the evaluation's graph.
 *	The hidden attributes stay the menu code's: an action shows on the monitor exactly when its menu <li> isn't hidden
 *	(data.js actionsFrom)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, chessInst } = require("../state/index.js");
const { openMenu, closeMenu } = require("../menu/index.js"); // The menu button opens it after the camera leaves the monitor
const { setMonitorHooks, enterMonitor3D, leaveMonitor3D, monitorState3D, focusMonitor3D } = require("../renderer/index.js");
const { moveListState } = require("../movelist/index.js");
const { menuItems } = require("../../pages/utils/nav.js"); // A key that opens the menu focuses its first item
const { isBusy } = require("../../pages/utils/menuItem.js"); // A busy item (.loading) can't be pressed on the monitor
const { materialDiff } = require("../utils/index.js");
const { hideEvalBar, watchEval, evalState } = require("../analysis/index.js"); // The page's bar counts as off in the 3D room; the terminal's Systems window draws the evaluation instead
const { hideKinds, showing } = require("../status/index.js"); // The 3D monitor shows a lost connection, so the page's message hides
const { drawOffer, takebackOffer } = require("../menu/offers.js"); // Whether an offer was sent or is waiting for an answer
const { forfeit } = require("../menu/endGame.js"); // The console's resign asks twice itself, then forfeits without the menu's question
const { typeMove } = require("../movebox/index.js"); // A move typed in the console plays as one typed in the move box
const { actionsFrom, resultText, materialText, whoFrom } = require("./data.js"); // The pure part (client/test/monitor/monitorData.test.js)
const optBtn = document.getElementById("optBtn"); // Menu button (3 lines): at the monitor it zooms out first
const optMonitorBtn = document.getElementById("optMonitor"); // Menu: Monitor, zooms in
const resultDisplay = document.getElementById("resultDisplay"); // Menu title ("Chess" or the result)
const resultReason = document.getElementById("resultReason"); // The line under the result
// Screen readers: the monitor's screen, what it shows, its focused button and a command's reply
const monitorAnnouncement = document.getElementById("monitorAnnouncement");
// Where the focus goes while zoomed (role="application": a screen reader passes the keys on)
const monitorFocus = document.getElementById("monitorFocus");
// The keyboard's stop for the screen on the desk; its focus is the glass's border
const monitorStop = document.getElementById("monitorStop");
const ANNOUNCE_MS = 50; // What is said in one go is written together this long after the first
const ACTION_BUTTONS = { // The monitor's actions -> the menu buttons they press
	hint: document.getElementById("optHint"),
	takeback: document.getElementById("optTakeback"),
	draw: document.getElementById("optDraw"),
	restart: document.getElementById("optRestart"),
	pgn: document.getElementById("optPgn"),
};
const OTHER_BUTTONS = { // The menu's other buttons the terminal presses, each only while it's on offer
	declineDraw: document.getElementById("drawDecline"),
	declineTakeback: document.getElementById("takebackDecline"),
	sound: document.getElementById("optSound"),
};
const ON_MONITOR = [ // What leaves the page while the monitor is up: what it shows, and the eval bar (no eval in the 3D room)
	document.getElementById("evalBar"),
	document.getElementById("moveList"),
	document.getElementById("openingDisplay"),
	document.getElementById("opponentDisplay"),
	...["optHint", "optTakeback", "optDraw", "optEvalBar"].map((id) => document.getElementById(id).parentElement),
];

let ready = false; // The room and its monitor are up (three/index.js onChange)
let opener = null; // What had the focus before the zoom; it gets it back on the desk
let said = []; // The texts waiting to be written to the live region (announce)

/* ---------------------------------------------------------------- */
// Data
/* ---------------------------------------------------------------- */
/**
 * @description What the monitor's terminal reads (the shared data shape: every screen, the console and the session's events).
 * renderer/index.js sends it when it changed
 * @return {[object]} { gameId, who, signedIn, cards, ai, over, yourTurn, playerColor, offline, thinking, saving, fen, check,
 * result, material, moves, opening, opponent, hint, offers, sound, eval, actions }
 */
function monitorData() {
	const over = Boolean(game.gameOver);
	const { rows, opening } = moveListState();
	const items = Object.fromEntries(Object.entries(ACTION_BUTTONS).map(([id, button]) => [id, actionItem(button)]));
	const ai = Boolean(game.ai);
	const theirTurn = chessInst.turn() !== game.playerColor;
	return {
		gameId: game.GAME_ID || null,
		who: whoFrom(game.USERNAME),
		signedIn: Boolean(game.SIGNED_IN && game.USERNAME), // No username yet: GUEST (the terminal's "clearance")
		cards: Boolean(game.cardGame), // Chess Cards: the console takes no typed moves there
		ai,
		over,
		yourTurn: !theirTurn && !over,
		playerColor: game.playerColor,
		// The link is down: the friend game's socket dropped, or a request got no answer
		offline: Boolean(game.offline) || showing("server"),
		thinking: ai && theirTurn && !over,
		saving: Boolean(game.moveSaving),
		fen: chessInst.fen(),
		check: chessInst.isCheck(),
		// Text only (innerText / innerHTML of plain words)
		result: over ? resultText(resultDisplay.textContent.trim(), resultReason.textContent.trim()) : "",
		material: materialText(materialDiff(chessInst.board())),
		moves: rows,
		opening,
		opponent: ai ? game.bot?.name || "Computer" : game.response?.opponent_name || "Opponent",
		hint: game.hint || null,
		offers: { draw: drawOffer(), takeback: takebackOffer() },
		sound: Boolean(game.soundOn),
		eval: evalState(), // { allowed, scores, failed }: White's win chance by ply, for the Systems window's graph
		actions: actionsFrom(items),
	};
}

// One menu button as actionsFrom reads it. textContent, not innerText: innerText would lay out the page every frame
function actionItem(button) {
	return { hidden: button.parentElement.hidden, unavailable: unavailable(button), text: button.textContent.trim() };
}

// A menu button that can't be pressed now: turned down (aria-disabled) or waiting on the server (.loading)
function unavailable(button) {
	return button.getAttribute("aria-disabled") === "true" || isBusy(button);
}

/**
 * @description Presses a menu button for the monitor, only when the menu would offer it: its <li> isn't hidden and it's
 * available. The monitor's copy can be a frame old
 * @param  {[string]} id [an ACTION_BUTTONS id]
 */
function press(id) {
	const button = ACTION_BUTTONS[id];
	if (button.parentElement.hidden || unavailable(button)) { return; }
	button.click(); // The menu's own listener and rules run (gameplay/menu)
}

// Presses one of the menu's other buttons, only while it's on the page's offer (not inside anything hidden)
function pressOther(id) {
	const button = OTHER_BUTTONS[id];
	if (button && !button.closest("[hidden]")) { button.click(); }
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
 * @description Says a text in the monitor's live region. Texts said together (the screen, then its focused button) are written as
 * one, after the region was emptied, so none overwrites another and a repeated one is read again
 * @param  {[string]} text
 */
function announce(text) {
	if (!text) { return; }
	if (!said.length) {
		monitorAnnouncement.textContent = ""; // Empty first: the same text again is still a change
		setTimeout(writeAnnouncement, ANNOUNCE_MS);
	}
	said.push(text);
}

// Writes what was said in one go, joined by ". " with no double stop after "Sure?"
function writeAnnouncement() {
	monitorAnnouncement.textContent = said.map((text) => text.trim()).map((text) => (/[.!?]$/.test(text) ? text : `${text}.`)).join(" ");
	said = [];
}

// Whether an element can take the focus back: still on the page, shown and not the page itself
function canFocus(element) {
	return Boolean(element) && element !== document.body && element.isConnected && element.getClientRects().length > 0;
}

/**
 * @description The focus follows the camera: on #monitorFocus while zooming in or zoomed (the window's key listener drives the
 * monitor), back to what had it (else the menu button) on the desk. Only taken back when it is still on #monitorFocus: the player
 * may have moved it meanwhile
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
	if ((up && state !== "idle") || monitorFocus.hidden) { return; } // Leaving: it keeps the focus until the desk
	const had = document.activeElement === monitorFocus || document.activeElement === document.body;
	monitorFocus.hidden = true;
	if (had) { (canFocus(opener) ? opener : optBtn).focus({ preventScroll: true }); }
	opener = null;
}

/* ---------------------------------------------------------------- */
// Hide Rules
/* ---------------------------------------------------------------- */
/**
 * @description Moves what the monitor shows off the page (data-on-monitor) and shows the Monitor item while the monitor is up and
 * reduced motion is off. Otherwise everything is back as on 2D. The menu's hidden attributes are never touched here, only the
 * Monitor item's
 */
function syncHideRules() {
	const on = ready && !game.reduceMotion;
	ON_MONITOR.forEach((element) => element.toggleAttribute("data-on-monitor", on));
	optMonitorBtn.parentElement.hidden = !on;
	const stop = on && !game.REMOTE_ONLY_CONDITIONAL; // Remote-only mode has no tab or page stops; its way in is the menu's Monitor item
	// Moved before the stop is hidden, which would drop the focus to the page
	if (!stop && document.activeElement === monitorStop) { optBtn.focus({ preventScroll: true }); }
	monitorStop.hidden = !stop;
	hideEvalBar(on); // The bar and its menu item are off the page: a bar saved on counts as off
	watchEval(on); // The terminal keeps the evaluation by ply instead (AI games and finished games only, as the bar)
	game.refresh = true;
}

/* ---------------------------------------------------------------- */
// Listeners
/* ---------------------------------------------------------------- */
/**
 * @description The menu's Monitor item: the menu closes and the camera zooms in
 */
function handleMonitor(e) {
	e.preventDefault();
	e.stopPropagation();
	closeMenu();
	if (game.menuToggled) { return; } // It stays open while a new board loads (canClose)
	enterMonitor3D();
}

/**
 * @description Enter or Space on the screen's stop (a button's click): the camera zooms in. Stopped, so the click away from the
 * menu isn't heard
 */
function handleStop(e) {
	e.preventDefault();
	e.stopPropagation();
	if (!game.menuToggled) { enterMonitor3D(); }
}

/**
 * @description The menu button at the monitor: the camera goes back to the desk first, then the menu opens. Capture phase on the
 * document, before the button's own listener (pages/utils/nav.js), which would open it over the zoomed glass
 */
async function handleMenuButton(e) {
	if (!optBtn.contains(e.target) || !monitorZoomed()) { return; }
	e.preventDefault();
	e.stopImmediatePropagation();
	const byKey = e.detail === 0; // A mouse or finger's click counts from 1
	await leaveMonitor3D();
	openMenu();
	if (byKey) { menuItems()[0]?.focus(); } // Like the button's own listener
}

// The keyboard's focus came to the screen's stop or left it: the 3D monitor shows or drops its border
function handleStopFocus() {
	focusMonitor3D(true);
}

function handleStopBlur() {
	focusMonitor3D(false);
}

// The border goes; nothing has the focus until the next arrow or Enter (pages/utils/nav.js)
function handleStopKey(e) {
	if (e.key == "Escape") { monitorStop.blur(); }
}

/**
 * @description Starts the monitor's side of the game: gives renderer/index.js the hooks every 3D board's monitor gets, watches
 * the menu's items so a label or state change reaches the monitor and adds the Monitor item's listeners. startGame
 * (gameplay/index.js) calls this once, remote-only mode too, before any 3D board goes up
 */
export function startMonitor() {
	setMonitorHooks({
		handlers: {
			hint() { press("hint"); },
			takeback() { press("takeback"); },
			draw() { press("draw"); },
			restart() { press("restart"); }, // Only offered once the game is over: no forfeit question
			pgn() { press("pgn"); },
			declineDraw() { pressOther("declineDraw"); },
			declineTakeback() { pressOther("declineTakeback"); },
			sound() { pressOther("sound"); },
			forfeit() { forfeit(); }, // The console asked twice (three/monitor/commands.js); forfeit() keeps the menu's guards
			move: typeMove, // { san } or { reason }
		},
		announce,
		onChange({ ready: up, state }) {
			// The room is in: the next frame swaps a promotion's flat picker for the cards (renderer/index.js drawBoard)
			if (up && !ready) { game.refresh = true; }
			ready = Boolean(up);
			hideKinds(ready ? ["connection"] : []); // Only in the 3D room: on 2D the message is the only sign
			syncFocus(ready, state);
			syncHideRules();
			focusMonitor3D(document.activeElement === monitorStop); // A new board's monitor (the room loaded, a lost context) hasn't heard
		},
		data: monitorData,
	});

	// The next frame sends the new data when it changed (renderer/index.js)
	const observer = new MutationObserver(function () { game.refresh = true; });
	Object.values(ACTION_BUTTONS).forEach(function (button) {
		observer.observe(button.parentElement, { attributes: true, attributeFilter: ["hidden"] });
		const watched = { attributes: true, attributeFilter: ["aria-disabled", "class"], childList: true, characterData: true, subtree: true };
		observer.observe(button, watched);
	});
	Object.values(OTHER_BUTTONS).forEach((button) => observer.observe(button, { childList: true, characterData: true, subtree: true })); // Sound's words change with it
	[document.getElementById("drawPrompt"), document.getElementById("takebackPrompt")].forEach((prompt) => observer.observe(prompt, { attributes: true, attributeFilter: ["hidden"] })); // An offer came or went
	[resultDisplay, resultReason].forEach((element) => observer.observe(element, { childList: true, characterData: true, subtree: true }));

	// Runs after startGame's own listener has set game.reduceMotion
	window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", syncHideRules);
	optMonitorBtn.addEventListener("click", handleMonitor);
	monitorStop.addEventListener("focus", handleStopFocus);
	monitorStop.addEventListener("blur", handleStopBlur);
	monitorStop.addEventListener("click", handleStop);
	monitorStop.addEventListener("keydown", handleStopKey);
	document.addEventListener("click", handleMenuButton, true);
}
