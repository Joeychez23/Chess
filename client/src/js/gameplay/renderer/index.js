/*
 *  index.js  --  chess frontend
 *	Renderer
 *	The one place that picks the board the player sees: the 2D canvas or the 3D board (three/). The rest of the game calls
 *	drawBoard() & setView() & never checks which one is on. The 2D canvas keeps drawing even while it's hidden behind the
 *	3D board, its frames still run the game (tiles, slides, trays), then the 3D board is set to match chessInst.
 *	A 3D board that can't load or mount (no WebGL, offline) leaves the player on 2D
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, canvas, chessInst, requestFrame } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE 2D CANVAS, THE BOARD THAT'S DRAWN
const { load3D } = require("../three/load.js"); // DOWNLOADS THE 3D BOARD THE FIRST TIME IT'S TURNED ON
const { showStatus, MESSAGE_TIME } = require("../status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE

export const VIEWS = { TWO_D: "2d", THREE_D: "3d" };

let board3D = null; // THE 3D MODULE WHILE IT'S MOUNTED, null ON 2D
let container = null; // WHAT THE 3D CANVAS FILLS, IN #main NEXT TO THE (HIDDEN) 2D CANVAS
let switching = null; // THE setView() IN PROGRESS, SO TWO PRESSES DON'T MOUNT TWICE

/* ---------------------------------------------------------------- */
// Draw
/* ---------------------------------------------------------------- */
/**
 * @description Draws one frame of the board that's on. The render loop & a window resize call it instead of game.drawScreen()
 */
export function drawBoard() {
	game.drawScreen(); // 2D (HIDDEN ON 3D): ALSO FILLS game.tiles & STEPS THE SLIDES THE GAME WAITS ON
	if (board3D) { board3D.syncFromBoard(chessInst); } // 3D: SIZES ITSELF (ResizeObserver) & DRAWS ITS OWN FRAMES, ONLY THE PIECES ARE SET HERE
}

/**
 * @description Which board is on
 * @return {[string]} [VIEWS.TWO_D or VIEWS.THREE_D]
 */
export function currentView() {
	return board3D ? VIEWS.THREE_D : VIEWS.TWO_D;
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
