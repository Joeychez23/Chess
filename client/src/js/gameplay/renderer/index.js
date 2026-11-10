/*
 *  index.js  --  chess frontend
 *	Renderer
 *	The one place that picks the board the player sees: the 2D canvas or the 3D board (three/). The rest of the game calls
 *	drawBoard() & setView() & never checks which one is on. The 2D canvas keeps drawing on 3D, laid clear over the 3D board
 *	with only its trays showing, its frames still run the game (tiles, slides, trays), then the 3D board is set to match chessInst,
 *	game.viewColor (the camera's side) & the 2D highlights.
 *	A 3D board that can't load or mount (no WebGL, offline) leaves the player on 2D. One that loses its WebGL context (iPhones do when
 *	the page is backgrounded) is put up again when the browser gives it back, or falls back to 2D when it keeps losing it. Input (gameplay/input) only asks here for the
 *	square under the pointer, its handlers are the same on both boards (addBoardListener)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, canvas, chessInst, requestFrame } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE 2D CANVAS, THE BOARD THAT'S DRAWN
const { load3D } = require("../three/load.js"); // DOWNLOADS THE 3D BOARD THE FIRST TIME IT'S TURNED ON
const { showStatus, MESSAGE_TIME } = require("../status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE
const { moveBetween, tileToSquare } = require("../utils/index.js"); // THE ONE MOVE BETWEEN TWO POSITIONS, THE SQUARE OF A SCREEN TILE
const { reportError } = require("../../pages/utils/reportErrors.js"); // THE BROWSER ERROR REPORTS (#194)
const { Chess } = require("chess.js");
const scratch = new Chess(); // ONLY moveBetween USES IT, NOT validateState: NOTHING ELSE CAN BE HALFWAY THROUGH IT

export const VIEWS = { TWO_D: "2d", THREE_D: "3d" };

let board3D = null; // THE 3D MODULE WHILE IT'S MOUNTED, null ON 2D
let container = null; // WHAT THE 3D CANVAS FILLS, IN #main NEXT TO THE (HIDDEN) 2D CANVAS
let switching = null; // THE setView() IN PROGRESS, SO TWO PRESSES DON'T MOUNT TWICE
let shownFen = null; // THE POSITION THE 3D BOARD SHOWS (OR IS SLIDING TO)
let shownFacings = null; // THE POSITION & PIECE FACINGS THE 3D BOARD WAS LAST TURNED TO (syncFacing3D)
let shownMarks = null; // THE HIGHLIGHTS THE 3D BOARD SHOWS (marks3D() AS JSON), SO THEY'RE ONLY REDONE WHEN THEY CHANGE
const boardListeners = []; // [type, handler, options] FROM addBoardListener, PUT ON EACH NEW 3D CONTAINER TOO
let viewListener = () => {}; // onViewChange()'S, TOLD WHEN 3D FALLS BACK TO 2D BY ITSELF

const RESTORE_WAIT_MS = 3000; // A LOST CONTEXT NOT GIVEN BACK THIS LONG AFTER THE PAGE IS SEEN: A NEW BOARD (& CONTEXT) GOES UP ANYWAY
const MAX_LOSSES = 3; // THIS MANY LOST CONTEXTS...
const LOSS_WINDOW_MS = 2 * 60 * 1000; // ...THIS CLOSE TOGETHER & IT'S BACK TO 2D
let losses = []; // WHEN EACH RECENT CONTEXT WAS LOST (Date.now())
let restoreTimer = null;

/* ---------------------------------------------------------------- */
// Draw
/* ---------------------------------------------------------------- */
/**
 * @description Draws one frame of the board that's on. The render loop & a window resize call it instead of game.drawScreen().
 * 3D only follows chessInst, which only the move path (gameplay/moves) changes: one move from what it shows slides, anything
 * else (load, takeback, restart, reconnect, a turned down move) is set at once. A move that wasn't legal never changes chessInst, so the piece stays
 */
export function drawBoard() {
	game.drawScreen(); // 2D (HIDDEN ON 3D): ALSO FILLS game.tiles & STEPS THE SLIDES THE GAME WAITS ON
	if (!board3D) { return; } // 3D: SIZES ITSELF (ResizeObserver) & DRAWS ITS OWN FRAMES, ONLY THE PIECES, CAMERA SIDE & HIGHLIGHTS ARE SET HERE
	board3D.setSide(game.viewColor, !game.reduceMotion); // FLIP BOARD TURNS THE CAMERA
	syncMarks3D();
	const fen = chessInst.fen();
	if (fen !== shownFen) { // UNCHANGED: A SYNC WOULD CUT A SLIDE SHORT
		const move = game.reduceMotion ? null : moveBetween(scratch, shownFen, fen);
		shownFen = fen;
		if (move) { board3D.animateMove(move.from, move.to, move.promotion); }
		else { board3D.syncFromBoard(chessInst); }
	}
	syncFacing3D(fen);
	const held = heldPiece();
	board3D.setHeld(held && held.square, held && held.dragging); // AFTER THE MOVE: A DROPPED PIECE SLIDES FROM WHERE IT WAS LET GO
}

/**
 * @description The piece the player holds, as the 2D board lifts it: picked up by a click (clickedTile) or pressed (mousedownTile, the
 * press is still down so it drags). Nothing once the board is locked for the move just sent (opposingMove)
 * @return {[object|null]} { square, dragging } [its square ("e2"), null when nothing is held]
 */
function heldPiece() {
	const tile = game.mousedownTile || game.clickedTile;
	if (!tile || game.opposingMove) { return null; }
	const square = tileToSquare(tile.originX, tile.originY, game.viewColor);
	return square ? { square, dragging: Boolean(game.mousedownTile) } : null;
}

/**
 * @description The squares the 2D board highlights, by 3D highlight kind: the opponent's last move, the hint, the king in check
 * & the held piece's moves (captures apart), like drawLastMove, drawHint, the check highlight & checkAvailableMoves. focus is the
 * keyboard's (TV remote's) selected square while the menu is closed: 2D only lifts the piece on it, 3D needs a visible ring
 * @return {[object]} { last, hint, check, legal, capture, focus } [lists of squares]
 */
function marks3D() {
	const marks = { last: game.lastOpponentMove || [], hint: game.hint || [], check: [], legal: [], capture: [], focus: [] };
	const keyboard = game.keyboardTile && !game.menuToggled && tileToSquare(game.keyboardTile.x, game.keyboardTile.y, game.viewColor);
	if (keyboard) { marks.focus.push(keyboard); }
	if (chessInst.isCheck()) {
		const king = chessInst.board().flat().find((p) => p && p.type === "k" && p.color === chessInst.turn());
		if (king) { marks.check.push(king.square); }
	}
	const held = heldPiece();
	if (held && !game.currPromotion) {
		chessInst.moves({ square: held.square, verbose: true }).forEach((m) => marks[m.captured ? "capture" : "legal"].push(m.to));
	}
	return marks;
}

// PUTS marks3D() ON THE 3D BOARD WHEN THEY CHANGED
function syncMarks3D() {
	const marks = marks3D();
	const key = JSON.stringify(marks);
	if (key === shownMarks) { return; }
	shownMarks = key;
	Object.keys(marks).forEach((kind) => board3D.highlight([...new Set(marks[kind])], kind));
}

/**
 * @description Which way each king, queen, bishop, rook & knight faces, from the same lists the 2D board draws them by (w_piece / b_piece,
 * w_knight / b_knight): an entry with a from last moved up or down ("up" toward rank 8), a knight's left or right ("right" toward the h-file).
 * null when there's no game from the server yet
 * @return {[object|null]} { w: { square: "up" | "down" | "left" | "right" | null }, b: { ... } }
 */
function facings3D() {
	if (!game.response || !game.response.w_piece || !game.response.b_piece) { return null; }
	const side = (list, dir) => (list ? JSON.parse(list).filter((p) => p.to).map((p) => [p.to, p.from ? dir(p.from, p.to) : null]) : []);
	const upDown = (from, to) => (to[1] > from[1] ? "up" : "down");
	const leftRight = (from, to) => (to[0] > from[0] ? "right" : "left");
	const color = (c) => Object.fromEntries([...side(game.response[c + "_piece"], upDown), ...side(game.response[c + "_knight"], leftRight)]);
	return { w: color("w"), b: color("b") };
}

// PUTS facings3D() ON THE 3D BOARD WHEN THEY OR THE POSITION CHANGED (A SYNC CAN MOVE MESHES ONTO OTHER SQUARES)
function syncFacing3D(fen) {
	const facings = facings3D();
	const key = facings && fen + JSON.stringify(facings);
	if (!facings || key === shownFacings) { return; }
	shownFacings = key;
	board3D.setFacing(facings);
}

/**
 * @description Restart & Rematch on 3D: the pieces glide home to chessInst (already the new game) in the 2D slide's time,
 * pieces with no match fade in or out. With reduce motion on they're just set. Does nothing on 2D
 */
export function glideHome3D() {
	if (!board3D) { return; }
	shownFen = chessInst.fen(); // SO drawBoard DOESN'T SET THEM AT ONCE WHEN THE NEW GAME TAKES OVER
	if (game.reduceMotion) { board3D.syncFromBoard(chessInst); }
	else { board3D.glideHome(chessInst); }
}

/**
 * @description Reduce motion was just turned on: 3D's camera turn & piece slides in progress land at once. Reduce motion keeps 3D
 * (it doesn't switch to 2D), it only takes the motion out: Flip Board & Reset View set the camera, moves & restarts set the pieces
 * (drawBoard, glideHome3D). Only the player's own camera drags still move it. Does nothing on 2D
 */
export function stopMotion3D() {
	if (board3D) { board3D.stopMotion(); }
}

/**
 * @description Resolves once the 3D board has drawn a frame with its squares in (the page fades in on it, #433). At once on 2D
 * @return {[Promise<void>]}
 */
export function whenDrawn3D() {
	return board3D ? board3D.whenDrawn() : Promise.resolve();
}

/**
 * @description Which board is on
 * @return {[string]} [VIEWS.TWO_D or VIEWS.THREE_D]
 */
export function currentView() {
	return board3D ? VIEWS.THREE_D : VIEWS.TWO_D;
}

/**
 * @description Reset View: the 3D camera back to its default for the side the player looks from. Does nothing on 2D
 */
export function resetCamera() {
	if (board3D) { board3D.resetCamera(game.viewColor); }
}

/* ---------------------------------------------------------------- */
// Input
/* ---------------------------------------------------------------- */
/**
 * @description Listens on the board the player sees: the 2D canvas now & every 3D board put up later (its container goes away with it)
 * @param  {[string]} type ["click", "touchstart", ...]
 * @param  {[function]} handler [the same handler for both boards]
 * @param  {[object]} options [addEventListener options]
 */
export function addBoardListener(type, handler, options) {
	boardListeners.push([type, handler, options]);
	canvas.addEventListener(type, handler, options);
	if (container) { container.addEventListener(type, handler, options); }
}

/**
 * @description The square under a pointer on the 3D board
 * @param  {[MouseEvent|object]} e [anything with clientX & clientY]
 * @return {[string|null]} ["e4", null off the board or on 2D]
 */
export function squareUnder3D(e) {
	return board3D ? board3D.squareUnder(e) : null;
}

/**
 * @description A camera gesture (orbit, zoom) is in progress on the 3D board, so pointer input must not touch the pieces
 * @return {[boolean]}
 */
export function isCameraGesture() {
	return Boolean(board3D && board3D.isCameraGesture());
}

/* ---------------------------------------------------------------- */
// Switch
/* ---------------------------------------------------------------- */
/**
 * @description Shows the 2D canvas or the 3D board, mid-game too: the one that's on is taken down, the other is put up & set to
 * the position. 3D that can't load or mount says why (status "view") & stays on 2D
 * @param  {[string]} view [VIEWS.TWO_D or VIEWS.THREE_D]
 * @return {[Promise<string>]} [the view that's on now]
 */
export function setView(view) {
	return queue(() => view === VIEWS.THREE_D ? show3D() : show2D());
}

/**
 * @description Calls listener with the view that's on when the board switches by itself (3D lost its context for good & fell back to 2D)
 * @param  {[function]} listener [(view) => {}]
 */
export function onViewChange(listener) {
	viewListener = listener;
}

// RUNS task AFTER THE LAST SWITCH, SO THE LAST PRESS WINS
function queue(task) {
	const next = (switching || Promise.resolve()).then(task);
	switching = next;
	next.finally(function () { if (switching === next) { switching = null; } });
	return next;
}

/* ---------------------------------------------------------------- */
// Lost Context
/* ---------------------------------------------------------------- */
// THE 3D BOARD STOPPED DRAWING. TOO MANY LATELY: 2D, OTHERWISE A NEW BOARD GOES UP WHEN THE CONTEXT IS BACK (OR AFTER A WAIT)
function contextLost() {
	const now = Date.now();
	losses = losses.filter((t) => now - t < LOSS_WINDOW_MS).concat(now);
	reportError("3D board lost its WebGL context", "3d-board");
	if (losses.length >= MAX_LOSSES) { fallBack2D("3D board kept losing its graphics. Switched to 2D."); return; }
	waitForRestore();
}

// WAITS RESTORE_WAIT_MS OF THE PAGE BEING SEEN (A HIDDEN PAGE DOESN'T COUNT), THEN REBUILDS EVEN IF THE CONTEXT ISN'T BACK
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

// TAKES DOWN THE LOST BOARD & PUTS UP A NEW ONE AT THE CURRENT POSITION (show3D SYNCS IT). ONE THAT CAN'T START: 2D
function rebuild3D() {
	stopWaiting();
	queue(function () {
		if (!board3D) { return VIEWS.TWO_D; } // THE PLAYER WENT TO 2D MEANWHILE
		remove3D();
		return show3D();
	}).then((on) => { if (on !== VIEWS.THREE_D) { viewListener(on); } });
}

function fallBack2D(message) {
	stopWaiting();
	queue(function () {
		showStatus("view", message, MESSAGE_TIME);
		reportError(message, "3d-board");
		return show2D();
	}).then(viewListener);
}

async function show3D() {
	if (board3D) { return VIEWS.THREE_D; }
	const board = await load3D(); // null: load3D ALREADY SAID WHY
	if (!board) { return show2D(); }
	container = document.createElement("div");
	container.id = "board3D";
	container.style.width = container.style.height = "100%";
	container.style.touchAction = "none"; // THE TOUCH HANDLERS OWN EVERY FINGER, NO SCROLL OR PINCH ZOOM OF THE PAGE
	boardListeners.forEach(([type, handler, options]) => container.addEventListener(type, handler, options));
	canvas.after(container);
	try {
		board.mount(container, { onContextLost: contextLost, onContextRestored: rebuild3D }); // THROWS WHEN THE WEBGL CONTEXT CAN'T BE MADE
	} catch (err) {
		console.warn("3D board failed to start", err);
		reportError(`3D board couldn't start: ${err.message}`, "3d-board");
		board.unmount(); // FREES WHATEVER IT MADE BEFORE IT THREW
		container.remove();
		container = null;
		showStatus("view", "3D board couldn't start. Staying on 2D.", MESSAGE_TIME);
		return show2D();
	}
	board3D = board;
	overlayCanvas(true);
	board3D.setSide(game.viewColor, false);
	board3D.syncFromBoard(chessInst);
	shownFen = chessInst.fen();
	shownFacings = null;
	syncFacing3D(shownFen);
	shownMarks = null;
	game.refresh = true;
	requestFrame();
	return VIEWS.THREE_D;
}

/**
 * @description On 3D the 2D canvas lies over the 3D board, the same size & place as on 2D, clear except for the taken piece trays
 * (the promotion picker while promoting, game.traysOnly), so they stay where they are on 2D (trayNudge too). Pointer input goes
 * through it to the 3D board, input finds the picker from the canvas position (gameplay/input)
 * @param  {[boolean]} on [true for 3D, false puts it back in the page as the 2D board]
 */
let tableImage = null; // THE 2D CANVAS'S CSS TABLE BACKGROUND, TAKEN OFF ON 3D (IT'S OPAQUE & WOULD HIDE THE 3D BOARD), PUT BACK ON 2D
function overlayCanvas(on) {
	game.traysOnly = on;
	if (on) { canvas.setAttribute("aria-hidden", "true"); } // ONLY TRAYS ON 3D: SCREEN READERS GET THE 3D CANVAS'S LABEL, NOT A SECOND BOARD
	else { canvas.removeAttribute("aria-hidden"); }
	if (on && tableImage === null) { tableImage = canvas.style.backgroundImage; }
	Object.assign(canvas.style, on
		? { position: "fixed", left: "0", top: "0", zIndex: "1", pointerEvents: "none", backgroundImage: "none" }
		: { position: "", left: "", top: "", zIndex: "", pointerEvents: "", backgroundImage: tableImage ?? canvas.style.backgroundImage });
	if (!on) { tableImage = null; }
}

// TAKES THE 3D BOARD & ITS CONTAINER DOWN, THE 2D CANVAS STAYS AS IT IS
function remove3D() {
	stopWaiting();
	if (board3D) {
		board3D.unmount();
		board3D = null;
	}
	if (container) {
		container.remove();
		container = null;
	}
}

function show2D() {
	remove3D();
	overlayCanvas(false);
	game.refresh = true; // REDRAW THE WHOLE CANVAS, IT ONLY HAD THE TRAYS ON 3D
	requestFrame();
	return VIEWS.TWO_D;
}
