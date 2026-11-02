/*
 *  index.js  --  chess frontend
 *	Move List
 *	The panel of the game's moves (#moveList on the play page), numbered in pairs & scrolled to the newest. It starts from the
 *	saved moves when a game loads (setMoves) & gets each new one as it's played (addMove), only GET /game/:gameId sends the whole list.
 *	renderBoard() places it (placeMoveList) in the free space next to the board or under the bottom tray, it's HTML over the canvas
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game } = require("../state/index.js"); // THE GAME'S SHARED STATE
const { trayNudge } = require("../animate/index.js"); // HOW FAR THE BOTTOM TRAY SITS DOWN
const panel = document.getElementById("moveList"); // THE PANEL
const toggleBtn = document.getElementById("moveListToggle"); // COLLAPSES & OPENS IT
const rowList = document.getElementById("moveListRows"); // THE NUMBERED ROWS, THIS PART SCROLLS
const statusArea = document.getElementById("gameStatus"); // THE PANEL LINES UP WITH ITS LEFT EDGE (16PX + THE PHONE'S NOTCH)
const opponentDisplay = document.getElementById("opponentDisplay"); // FRIEND GAMES: "vs Bob", THE PANEL STAYS ABOVE IT

const COLLAPSED_KEY = "MOVE_LIST"; // localStorage: "closed" WHEN THE PLAYER COLLAPSED IT, GUESTS TOO
const GAP = 8; // SPACE BETWEEN THE PANEL & WHAT'S NEXT TO IT (PX)
const STATUS_HEIGHT = 72; // THE PANEL STARTS UNDER THE MESSAGE AREA ON THE SIDE (PX)
const MIN_WIDTH = 96; // ROOM FOR A NUMBER & TWO SHORT MOVES (PX)
const MIN_HEIGHT = 68; // ROOM FOR THE TOGGLE & A ROW (PX)

let moves = []; // THE GAME'S SAN MOVES
let startFen = null; // A SET POSITION'S FEN, null = THE STANDARD POSITION
let placedFor = null; // THE BOARD SIZE THE PANEL WAS LAST PLACED FOR

/* ---------------------------------------------------------------- */
// Moves
/* ---------------------------------------------------------------- */
/**
 * @description Puts the moves in numbered pairs. A set position starts at its own move number & when black moves first
 * the first row's white move is blank
 * @param  {[array]} sanMoves [the game's SAN moves]
 * @param  {[string]} fen [the start position's FEN, blank = the standard position]
 * @return {[array]} rows [{ number, white, black }]
 */
function moveRows(sanMoves, fen) {
	const [, turn, , , , fullMove] = (fen || "").split(" ");
	let number = Number(fullMove) || 1;
	let i = 0;
	const rows = [];
	if (turn == 'b' && sanMoves.length) { rows.push({ number: number++, white: "…", black: sanMoves[i++] }); }
	for (; i < sanMoves.length; i += 2) { rows.push({ number: number++, white: sanMoves[i], black: sanMoves[i + 1] || "" }); }
	return rows;
}

/**
 * @description Scrolls to the newest move
 */
function scrollToNewest() {
	rowList.scrollTop = rowList.scrollHeight;
}

/**
 * @description Draws the rows. textContent, a move from the server is never read as HTML
 */
function renderRows() {
	rowList.replaceChildren(...moveRows(moves, startFen).map(function (row) {
		const item = document.createElement("li");
		[`${row.number}.`, row.white, row.black].forEach(function (text) {
			const cell = document.createElement("span");
			cell.textContent = text;
			item.append(cell);
		});
		return item;
	}));
	scrollToNewest();
}

/**
 * @description A game loaded (a reload, Restart or Rematch): the list starts over from its saved moves
 * @param  {[array]} savedMoves [moves from GET /game/:gameId, missing when the game couldn't be loaded]
 * @param  {[string]} fen [the start position's FEN, blank = the standard position]
 */
export function setMoves(savedMoves, fen) {
	moves = [...(savedMoves || [])];
	startFen = fen || null;
	renderRows();
}

/**
 * @description A move was played & saved (the player's, the AI's or a friend's)
 * @param  {[string]} san [the move, from chess.js]
 */
export function addMove(san) {
	moves.push(san);
	renderRows();
}

/* ---------------------------------------------------------------- */
// Collapse
/* ---------------------------------------------------------------- */
/**
 * @description Shows or hides the rows, the toggle stays
 * @param  {[boolean]} collapsed
 */
function setCollapsed(collapsed) {
	rowList.hidden = collapsed;
	toggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
	if (!collapsed) { scrollToNewest(); } // HIDDEN ROWS CAN'T SCROLL
}

/**
 * @description Reads the saved collapsed setting when the game starts
 */
export function loadMoveList() {
	let collapsed = false;
	try { collapsed = localStorage.getItem(COLLAPSED_KEY) == "closed"; } catch { } // STORAGE BLOCKED (PRIVATE MODE)
	setCollapsed(collapsed);
}

/**
 * @description Collapses or opens the panel & saves it
 */
export function handleMoveListToggle() {
	const collapsed = !rowList.hidden;
	setCollapsed(collapsed);
	try { localStorage.setItem(COLLAPSED_KEY, collapsed ? "closed" : "open"); } catch { } // NOT SAVED (PRIVATE MODE) -> ONLY UNTIL THE PAGE RELOADS
}

/* ---------------------------------------------------------------- */
// Place
/* ---------------------------------------------------------------- */
/**
 * @description Finds free space for the panel. A tray piece's image overhangs its square by yPieceOffset / 2 (under the square
 * that part of the image is see through, the piece stands on the square's bottom edge)
 * Next to the board: wide screens keep their trays on the right, so the left of the board is free its whole height, narrow
 * screens have trays above & below that can reach past the board's left edge, so it stays between them.
 * Under the bottom tray: only narrow screens have the room. Portrait screens try this first, the others try the side first.
 * Last, the same space but next to "vs Bob" instead of above it, for the shortest screens
 * @param  {[number]} xBoardStart [left of the board image]
 * @param  {[number]} yBoardStart [top of the board image]
 * @param  {[number]} boardHeight [height of the board image]
 * @return {[object]} spot [{ left, top, width, maxHeight, below }, null when nothing has the room]
 */
function findSpot(xBoardStart, yBoardStart, boardHeight) {
	const left = statusArea.getBoundingClientRect().left;
	const opponent = opponentDisplay.hidden ? null : opponentDisplay.getBoundingClientRect();
	const pageBottom = (opponent ? opponent.top : game.ch) - GAP;
	const overhang = game.yPieceOffset / 2;
	const topTrayEnd = game.yBoardOff - game.tileHeight + overhang; // ROW -2
	const bottomTrayStart = game.yBoardOff + (9 + trayNudge(9)) * game.tileHeight - overhang; // ROW 9
	const bottomTrayEnd = game.yBoardOff + (10 + trayNudge(9)) * game.tileHeight + GAP;

	const sideTop = Math.max(game.widthGreater ? yBoardStart : topTrayEnd, STATUS_HEIGHT);
	const sideBottom = Math.min(game.widthGreater ? yBoardStart + boardHeight : bottomTrayStart, pageBottom);
	const side = { left, top: sideTop, width: xBoardStart - GAP - left, maxHeight: sideBottom - sideTop, below: false };
	const below = { left, top: bottomTrayEnd, width: game.cw - left * 2, maxHeight: pageBottom - bottomTrayEnd, below: true };

	const spots = game.portraitBoard ? [below, side] : [side, below];
	if (opponent) {
		const besideLeft = opponent.right + GAP;
		spots.push({ left: besideLeft, top: bottomTrayEnd, width: game.cw - left - besideLeft, maxHeight: game.ch - GAP - bottomTrayEnd, below: true });
	}
	return spots.find(function (spot) { return spot.width >= MIN_WIDTH && spot.maxHeight >= MIN_HEIGHT; }) || null;
}

/**
 * @description Moves the panel to the free space for this board size, renderBoard() calls this every frame so it only does
 * the work when the size changed. With no free space (a window close to square) it's hidden, it must not cover the board or trays
 * @param  {[number]} xBoardStart [left of the board image]
 * @param  {[number]} yBoardStart [top of the board image]
 * @param  {[number]} boardHeight [height of the board image]
 */
export function placeMoveList(xBoardStart, yBoardStart, boardHeight) {
	const size = `${game.cw},${game.ch},${xBoardStart},${boardHeight}`;
	if (size == placedFor) { return; }
	placedFor = size;
	const spot = findSpot(xBoardStart, yBoardStart, boardHeight);
	panel.hidden = !spot;
	if (!spot) { return; }
	panel.classList.toggle("below", spot.below);
	panel.style.left = `${spot.left}px`;
	panel.style.top = `${spot.top}px`;
	panel.style.width = `${spot.width}px`;
	panel.style.maxHeight = `${spot.maxHeight}px`;
	scrollToNewest();
}
