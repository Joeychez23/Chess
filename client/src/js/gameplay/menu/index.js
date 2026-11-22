/*
 *  index.js  --  chess frontend
 *	Menu
 *	The in game menu (the 3 line button, Resume, Hint, Takeback, Offer Draw, Type a Move, Sound, Flip Board, View 3D / 2D & Reset View, Eval Bar, Download PGN, Forfeit / Restart / Rematch, Home & Exit), loading a new board in place
 *	for Restart, Rematch & Takeback (the pieces slide home, gameplay/animate/index.js) & the game over screen. Also the friend game
 *	socket's handlers (socketHandlers: a move, a forfeit, a draw offer, a takeback or a rematch), startGame & loadRematch join with them.
 *	Takeback, draw offers & showGameOver live in offers.js; restart, forfeit, rematch, the result & leave / exit in endGame.js
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game } = require("../state/index.js"); // THE GAME'S SHARED STATE
const { getPgn } = require("../validate/index.js"); // REQUESTS TO THE CHESS SERVER (/api/chess)
const { handleInitialData } = require("../draw/index.js"); // NEW drawScreen FOR THE PLAYER'S COLOR
const { clearTouch } = require("../input/index.js"); // REMOTE-ONLY MODE: SELECTS A MENU BUTTON, LETS GO OF A TOUCH
const { clearRemoteSelection } = require("../input/keys.js"); // NOT VIA input/index.js: A RE-EXPORT IS UNSET WHILE keys.js LOADS (THE CYCLE GOES THROUGH HERE)
const { refreshData, revertUnfinishedMove } = require("../moves/index.js"); // RESETS THE BOARD, TAKES BACK A MOVE THAT ISN'T FINISHED
const { checkOpponentMove } = require("../moves/opponent.js"); // A FRIEND'S MOVE FROM THE SOCKET. NOT VIA moves/index.js: ITS RE-EXPORT IS UNSET WHILE opponent.js LOADS (THE CYCLE GOES THROUGH HERE)
const { showStatus, clearStatus, MESSAGE_TIME } = require("../status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE
const { showHint } = require("../analysis/index.js"); // THE HINT, WHAT A GAME FROM THE SERVER MEANS FOR THE HINT & THE EVALUATION BAR
const { createNav, placeBefore } = require("../../pages/utils/nav.js"); // OPENS & CLOSES THE MENU, LIKE THE OTHER PAGES
const { setUnavailable, setFill, stopFill } = require("../../pages/utils/menuItem.js"); // THE MENU ITEMS' STATES, LIKE THE OTHER PAGES
const { setView, currentView, resetCamera, onViewChange, can3D, VIEWS } = require("../renderer/index.js"); // 2D OR 3D, THE 3D CAMERA, THE 3D ROOM'S MONITOR (NOT gameplay/monitor: IT REQUIRES THIS FILE)
const { timeLeftText } = require("../../pages/utils/timeLeft.js"); // A TIME LIMIT'S TIME LEFT
import { showGameOver, handleDrawEvent, handleTakebackEvent } from "./offers.js";
import { setAutoLean } from "../three/lean.js"; // NO three.js IN IT: STAYS IN THIS BUNDLE, THE 3D CHUNK USES THE SAME MODULE
import { loadRematch, showOpponentLeft } from "./endGame.js";
export { handleTakeback, handleDeclineTakeback, loadTakeback, syncDrawOffer, handleOfferDraw, handleDeclineDraw, showGameOver } from "./offers.js";
export { handleRestart, setRestartLoading, handleCancelRematch, showReadOnlyMenu, handleLeave, handleExit } from "./endGame.js";

export const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES, TOP RIGHT), OPENS THE MENU
export const optResumeBtn = document.getElementById("optResume"); // MENU: RESUME
const optPgnBtn = document.getElementById("optPgn"); // MENU: DOWNLOAD PGN
const optSoundBtn = document.getElementById("optSound"); // MENU: SOUND ON / OFF
const optViewBtn = document.getElementById("optView"); // MENU: VIEW 3D / 2D
const optResetViewBtn = document.getElementById("optResetView"); // MENU: RESET VIEW, ONLY ON 3D
const optAutoLeanBtn = document.getElementById("optAutoLean"); // MENU: AUTO LEAN ON / OFF, ONLY ON 3D
export const optRestartBtn = document.getElementById("optRestart"); // MENU: FORFEIT, THEN RESTART (AI GAMES) OR REMATCH (FRIEND GAMES)
export const optHomepageBtn = document.getElementById("optHome"); // MENU: HOMEPAGE
export const optExitBtn = document.getElementById("optExit"); // MENU: LOGOUT (SIGNED IN) / LOGIN/SIGNUP (GUESTS)
export const optHintBtn = document.getElementById("optHint"); // MENU: HINT, AI GAMES WHILE THEY'RE GOING (gameplay/analysis)
export const optEvalBarBtn = document.getElementById("optEvalBar"); // MENU: THE EVAL BAR ON / OFF (gameplay/analysis)
export const optTypeMoveBtn = document.getElementById("optTypeMove"); // MENU: TYPE A MOVE (gameplay/movebox)

const VIEW_KEY = "VIEW"; // localStorage: "2d" OR "3d", THE LAST ONE THE PLAYER PICKED. 3D IS THE DEFAULT, 2D ON A PHONE OR TABLET (can3D)
const SOUND_KEY = "SOUND"; // localStorage: "off" WHEN THE PLAYER TURNED SOUND OFF, GUESTS TOO
const AUTO_LEAN_KEY = "AUTO_LEAN"; // localStorage: "on" WHEN THE PLAYER TURNED AUTO LEAN ON, OFF OTHERWISE
const DEADLINE_TICK = 30 * 1000; // HOW OFTEN THE TIME LEFT IS REDRAWN (ms)
const moveDeadlineText = document.getElementById("moveDeadline");
let deadlineTimer = null; // REDRAWS THE TIME LEFT WHILE A GAME WITH A TIME LIMIT IS GOING
let pgnLoading = false; // A SECOND PRESS WHILE THE PGN LOADS WOULD SAVE TWO FILES
export const socketHandlers = { // SOCKET EVENT -> HANDLER
	move: checkOpponentMove,
	gameOver: showGameOver,
	drawOffer: handleDrawEvent,
	takeback: handleTakebackEvent,
	rematch: loadRematch,
	opponentLeft: showOpponentLeft,
	opponentBack: function () { clearStatus("rematch"); },
	connectionLost: function () { setOffline(true); showStatus("connection", "Connection lost. Reconnecting…"); },
	reconnected: function () { setOffline(false); showStatus("connection", "Reconnected", 3000); },
	connectionFailed: function () { setOffline(true); showStatus("connection", "Connection lost. Reload the page to reconnect."); },
};

/* ---------------------------------------------------------------- */
// Connection
/* ---------------------------------------------------------------- */
/**
 * @description Marks the friend game's socket as up or down, the next frame sends it to the 3D monitor (renderer/index.js)
 * @param  {[boolean]} lost [true while it's trying to reconnect, or won't without a reload]
 */
function setOffline(lost) {
	game.offline = lost;
	game.refresh = true;
}

/* ---------------------------------------------------------------- */
// Open & Close
/* ---------------------------------------------------------------- */
export const nav = createNav({
	/**
	 * @description Every way the menu opens comes through here. A move that isn't finished goes back (revertUnfinishedMove) &
	 * no piece stays hovered, so pieces can't be touched until the menu closes
	 */
	onOpen() {
		clearTouch();
		revertUnfinishedMove();
		for (let i = 0; i < game.tiles.length; i++) { game.tiles[i].isHovering = false; }
		game.menuToggled = true;
		game.refresh = true;
	},
	onClose() { game.menuToggled = false; clearRemoteSelection(); },
	canClose() { return !game.boardReset; }, // THE MENU STAYS OPEN WHILE A NEW BOARD LOADS, THE OLD BOARD UNDER IT IS LOCKED
	arrowStops() { // LEFT & RIGHT GO THAT WAY ON SCREEN (THE BOX CAN BE DRAGGED), THE ONES NOT ON SCREEN ARE SKIPPED. THE 3D MONITOR'S STOP HAS NO PLACE ON SCREEN: ALWAYS THE LEFTMOST, SO LEFT FROM THE MENU BUTTON GOES THROUGH THE PAGE'S STOPS (THE TYPE-MOVE BOX) LIKE 2D, THEN THE SCREEN, THEN WRAPS BACK
		const stops = ["optBtn", "moveBoxInput", "moveListToggle"].map((id) => document.getElementById(id));
		stops.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
		return placeBefore(stops, document.getElementById("monitorStop"), stops[0]);
	},
});

/**
 * @description Turns on the menu button, a click away & Escape. Clicks on the board are handled by handleCanvasClick (input/index.js), it stops them before they get to the page
 */
export const addMenuListeners = nav.addListeners;

export function openMenu() { nav.toggleNav(true); }

/**
 * @description Back to the game or, when it's over, a look at the final position (reopening the menu still shows the result)
 */
export function closeMenu() { nav.toggleNav(false); }

/* ---------------------------------------------------------------- */
// Resume Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Closes the menu. Resume is only seen while the menu is open
 */
export function handleResume(e) {
	e.preventDefault();
	e.stopPropagation();
	closeMenu();
}

/* ---------------------------------------------------------------- */
// Sound Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Reads the saved sound setting when the game starts & sets the button's words
 */
export function loadSound() {
	try { game.soundOn = localStorage.getItem(SOUND_KEY) != "off"; } catch { game.soundOn = true; } // STORAGE BLOCKED (PRIVATE MODE)
	optSoundBtn.innerText = game.soundOn ? "Turn Sound: Off" : "Turn Sound: On"; // THE WORDS SAY WHAT A PRESS WILL DO
}

/**
 * @description Turns the move sound on or off & saves it, the menu stays open. unlockAudio() (input/index.js) still runs
 * with sound off, so turning it back on works on iOS
 */
export function handleSound(e) {
	e.preventDefault();
	e.stopPropagation();
	game.soundOn = !game.soundOn;
	optSoundBtn.innerText = game.soundOn ? "Turn Sound: Off" : "Turn Sound: On"; // THE WORDS SAY WHAT A PRESS WILL DO
	try { localStorage.setItem(SOUND_KEY, game.soundOn ? "on" : "off"); } catch { } // NOT SAVED (PRIVATE MODE) -> ONLY UNTIL THE PAGE RELOADS
}

/* ---------------------------------------------------------------- */
// View & Reset View Buttons (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description The saved view when the game starts. With none saved or storage blocked (private mode): 3D, or 2D on a phone or tablet (can3D, TEMPORARY)
 * @return {[string]} [VIEWS.TWO_D or VIEWS.THREE_D]
 */
export function loadView() {
	setViewWords(VIEWS.TWO_D); // UNTIL showView() SAYS WHICH IS ON
	onViewChange(setViewWords); // 3D THAT FELL BACK TO 2D BY ITSELF (LOST ITS WEBGL CONTEXT)
	const fallback = can3D() ? VIEWS.THREE_D : VIEWS.TWO_D;
	try { return localStorage.getItem(VIEW_KEY) == VIEWS.TWO_D ? VIEWS.TWO_D : fallback; } catch { return fallback; } // ONLY A SAVED "2d" KEEPS 3D OFF
}

/**
 * @description Switches the board (setView) & sets the buttons for the one that's on (3D that can't start stays on 2D)
 * @param  {[string]} view [VIEWS.TWO_D or VIEWS.THREE_D]
 * @return {[Promise<string>]} [the view that's on now]
 */
export function showView(view) {
	return setView(view).then(function (on) { setViewWords(on); return on; });
}

// THE WORDS SAY WHAT A PRESS WILL DO, RESET VIEW IS ONLY ON 3D. TEMPORARY (can3D): A PHONE, TABLET OR REMOTE-ONLY MODE CAN'T TURN 3D ON YET, THE BUTTON SAYS SO
function setViewWords(on) {
	const no3D = !can3D();
	const notYet = game.REMOTE_ONLY_CONDITIONAL ? "3D remote in progress..." : "3D touch in progress..."; // WHICH ONE ISN'T BUILT YET
	optViewBtn.innerText = no3D ? notYet : on === VIEWS.THREE_D ? "View: 2D" : "View: 3D";
	setUnavailable(optViewBtn, no3D);
	optResetViewBtn.parentElement.hidden = on !== VIEWS.THREE_D;
	optAutoLeanBtn.parentElement.hidden = on !== VIEWS.THREE_D;
}

/**
 * @description Switches between 2D & 3D & saves what's on, the menu stays open
 */
export function handleView(e) {
	e.preventDefault();
	e.stopPropagation();
	if (!can3D()) { return; } // TEMPORARY (can3D): UNAVAILABLE (aria-disabled STILL TAKES CLICKS)
	showView(currentView() === VIEWS.THREE_D ? VIEWS.TWO_D : VIEWS.THREE_D).then(function (on) {
		try { localStorage.setItem(VIEW_KEY, on); } catch { } // NOT SAVED (PRIVATE MODE) -> ONLY UNTIL THE PAGE RELOADS
	});
}

// AUTO LEAN ON OR OFF (three/lean.js), THE WORDS SAY WHAT A PRESS WILL DO
function showAutoLean(on) {
	setAutoLean(on);
	optAutoLeanBtn.innerText = on ? "Turn Auto Lean: Off" : "Turn Auto Lean: On";
}

/**
 * @description Turns Auto Lean on or off & saves it, the menu stays open
 */
function handleAutoLean(e) {
	e.preventDefault();
	e.stopPropagation();
	const on = optAutoLeanBtn.innerText !== "Turn Auto Lean: Off";
	showAutoLean(on);
	try { localStorage.setItem(AUTO_LEAN_KEY, on ? "on" : "off"); } catch { } // NOT SAVED (PRIVATE MODE) -> ONLY UNTIL THE PAGE RELOADS
}

// THE PLAYER'S SAVED AUTO LEAN, OFF BY DEFAULT. HERE, NOT IN gameplay/index.js WITH THE OTHER OPTIONS: THAT FILE WASN'T TASK 20E C2'S TO EDIT
try { showAutoLean(localStorage.getItem(AUTO_LEAN_KEY) === "on"); } catch { showAutoLean(false); } // STORAGE BLOCKED (PRIVATE MODE)
optAutoLeanBtn.addEventListener("click", handleAutoLean);

/**
 * @description Puts the 3D camera back at its default for the player's side, the menu stays open
 */
export function handleResetView(e) {
	e.preventDefault();
	e.stopPropagation();
	resetCamera();
}

/* ---------------------------------------------------------------- */
// Flip Board Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Is a piece sliding or the player's move saving? Its tile's place in tiles is held by the code finishing the move
 * & game.response doesn't have a move that's saving, so the board can't flip until it's done
 */
export function moveInFlight() {
	return game.moveSaving || game.currSlide || game.tiles.some(function (tile) { return tile.isSliding; });
}

/**
 * @description Draws the board from the other side. refreshData rebuilds the tiles, they're in screen order
 */
function flipBoard() {
	game.flipPending = false;
	game.viewColor = game.viewColor == 'w' ? 'b' : 'w';
	handleInitialData();
	refreshData(game.response);
}

/**
 * @description Flips the board, the menu stays open. During a slide or a move's save it flips when that's done (a second press cancels it)
 */
export function handleFlip(e) {
	e.preventDefault();
	e.stopPropagation();
	if (game.boardReset) { return; } // A NEW BOARD IS LOADING, IT STARTS FROM THE PLAYER'S SIDE
	if (moveInFlight()) { game.flipPending = !game.flipPending; return; }
	flipBoard();
}

/**
 * @description The render loop calls this before each frame, it does the flip that waited for a slide
 */
export function flipWhenDone() {
	if (game.flipPending && !moveInFlight()) { flipBoard(); }
}

/* ---------------------------------------------------------------- */
// Download PGN Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Saves the game as a .pgn file, the menu stays open. The server writes it (GET /game/:gameId/pgn), so it has every saved move
 */
export async function handleDownloadPgn(e) {
	e.preventDefault();
	e.stopPropagation();
	if (pgnLoading) { return; }
	pgnLoading = true;
	optPgnBtn.innerText = "Downloading";
	setFill(optPgnBtn);
	const response = await getPgn(game.GAME_URL, game.GAME_ID);
	pgnLoading = false;
	optPgnBtn.innerText = "Download PGN";
	stopFill(optPgnBtn);
	if (response?.status != 200) { return showStatus("action", "Couldn't download the PGN. Try again.", MESSAGE_TIME); }

	const url = URL.createObjectURL(new Blob([response.pgn], { type: "application/x-chess-pgn" }));
	const link = document.createElement("a"); // NOT ADDED TO THE PAGE, ITS CLICK WOULD REACH THE PAGE & CLOSE THE MENU
	link.href = url;
	link.download = response.filename;
	link.click();
	setTimeout(function () { URL.revokeObjectURL(url); }, 1000); // THE DOWNLOAD HAS ITS OWN COPY BY THEN
}

/* ---------------------------------------------------------------- */
// Hint Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Asks for a hint, the menu closes when it's on the board so the player can see it. It stays open with a message when there's none
 */
export async function handleHint(e) {
	e.preventDefault();
	e.stopPropagation();
	if (await showHint()) { closeMenu(); }
}

/**
 * @description Shows the time left in a friend game with a time limit, redrawn while the game goes on. Once it runs out, loading the game
 * closes it on the server, & the socket's "game-over" opens the menu on both boards
 * @param  {[object]} response [game from the server, null when the game ended]
 */
export function syncDeadline(response) {
	clearInterval(deadlineTimer);
	deadlineTimer = null;
	moveDeadlineText.textContent = "";
	const deadline = response?.state == "OPEN" ? response.move_deadline : null;
	if (!deadline) { return; }
	const whose = response.game_board.split(" ")[1] == game.playerColor ? "Your move" : "Their move";
	const draw = () => { moveDeadlineText.textContent = `${whose} // ${timeLeftText(deadline)}`; };
	draw();
	deadlineTimer = setInterval(() => { // ONLY ON A TICK: THIS LOAD SYNCS AGAIN, A CLOCK AHEAD OF THE SERVER WOULD ASK NON-STOP
		draw();
		if (deadline * 1000 <= Date.now()) { checkOpponentMove(); }
	}, DEADLINE_TICK);
}
