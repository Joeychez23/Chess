/*
 *  index.js  --  chess frontend
 *	Renderer
 *	The one place that picks the board the player sees: the 2D canvas or the 3D board (three/). The rest of the game calls
 *	drawBoard() & setView() & never checks which one is on. The 2D canvas keeps drawing even while it's hidden behind the
 *	3D board, its frames still run the game (tiles, slides, trays), then the 3D board is set to match chessInst.
 *	A 3D board that can't load or mount (no WebGL, offline) leaves the player on 2D. Input (gameplay/input) only asks here for the
 *	square under the pointer, its handlers are the same on both boards (addBoardListener)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, canvas, chessInst, requestFrame } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE 2D CANVAS, THE BOARD THAT'S DRAWN
const { load3D } = require("../three/load.js"); // DOWNLOADS THE 3D BOARD THE FIRST TIME IT'S TURNED ON
const { showStatus, MESSAGE_TIME } = require("../status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE
const { moveBetween } = require("../utils/index.js"); // THE ONE MOVE BETWEEN TWO POSITIONS
const { Chess } = require("chess.js");
const scratch = new Chess(); // ONLY moveBetween USES IT, NOT validateState: NOTHING ELSE CAN BE HALFWAY THROUGH IT

export const VIEWS = { TWO_D: "2d", THREE_D: "3d" };

let board3D = null; // THE 3D MODULE WHILE IT'S MOUNTED, null ON 2D
let container = null; // WHAT THE 3D CANVAS FILLS, IN #main NEXT TO THE (HIDDEN) 2D CANVAS
let switching = null; // THE setView() IN PROGRESS, SO TWO PRESSES DON'T MOUNT TWICE
let shownFen = null; // THE POSITION THE 3D BOARD SHOWS (OR IS SLIDING TO)
const boardListeners = []; // [type, handler, options] FROM addBoardListener, PUT ON EACH NEW 3D CONTAINER TOO

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
	if (!board3D) { return; } // 3D: SIZES ITSELF (ResizeObserver) & DRAWS ITS OWN FRAMES, ONLY THE PIECES ARE SET HERE
	const fen = chessInst.fen();
	if (fen === shownFen) { return; } // UNCHANGED: A SYNC WOULD CUT A SLIDE SHORT
	const move = game.reduceMotion ? null : moveBetween(scratch, shownFen, fen);
	shownFen = fen;
	if (move) { board3D.animateMove(move.from, move.to, move.promotion); }
	else { board3D.syncFromBoard(chessInst); }
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
 * @description Which board is on
 * @return {[string]} [VIEWS.TWO_D or VIEWS.THREE_D]
 */
export function currentView() {
	return board3D ? VIEWS.THREE_D : VIEWS.TWO_D;
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
	const next = (switching || Promise.resolve()).then(function () { // AFTER THE LAST SWITCH, SO THE LAST PRESS WINS
		return view === VIEWS.THREE_D ? show3D() : show2D();
	});
	switching = next;
	next.finally(function () { if (switching === next) { switching = null; } });
	return next;
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
		board.mount(container); // THROWS WHEN THE WEBGL CONTEXT CAN'T BE MADE
	} catch (err) {
		console.warn("3D board failed to start", err);
		board.unmount(); // FREES WHATEVER IT MADE BEFORE IT THREW
		container.remove();
		container = null;
		showStatus("view", "3D board couldn't start. Staying on 2D.", MESSAGE_TIME);
		return show2D();
	}
	board3D = board;
	canvas.style.display = "none"; // STILL DRAWN (drawBoard), JUST NOT SEEN
	board3D.syncFromBoard(chessInst);
	shownFen = chessInst.fen();
	game.refresh = true;
	requestFrame();
	return VIEWS.THREE_D;
}

function show2D() {
	if (board3D) {
		board3D.unmount();
		board3D = null;
	}
	if (container) {
		container.remove();
		container = null;
	}
	canvas.style.display = "";
	game.refresh = true; // REDRAW THE CANVAS, IT MAY HAVE CHANGED SIZE WHILE IT WAS HIDDEN
	requestFrame();
	return VIEWS.TWO_D;
}
