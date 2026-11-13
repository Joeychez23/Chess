/*
 *  index.js  --  chess frontend
 *	Move List
 *	The panel of the game's moves (#moveList on the play page), numbered in pairs & scrolled to the newest. It starts from the
 *	saved moves when a game loads (setMoves) & gets each new one as it's played (addMove), only GET /game/:gameId sends the whole list.
 *	renderBoard() places it (placeMoveList) in the free space next to the board or under the bottom tray, it's HTML over the canvas.
 *	Keyboard: opening it with a key moves focus to the newest move, Up, Down, Home & End move between the rows, Up or Down past the ends goes back to the toggle, Escape closes it & gives focus to the toggle, Left & Right leave the panel (pages/utils/nav.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, EVAL_BAR_ROOM } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE SPACE THE EVALUATION BAR TAKES NEXT TO THE BOARD
const { trayNudge } = require("../animate/index.js"); // HOW FAR THE BOTTOM TRAY SITS DOWN
const { itemForKey, arrowKey } = require("../../pages/utils/nav.js"); // THE MENU'S ARROW KEYS, THE ROWS MOVE THE SAME WAY
const panel = document.getElementById("moveList"); // THE PANEL
const toggleBtn = document.getElementById("moveListToggle"); // COLLAPSES & OPENS IT
const rowList = document.getElementById("moveListRows"); // THE NUMBERED ROWS, THIS PART SCROLLS
const statusArea = document.getElementById("gameStatus"); // THE PANEL LINES UP WITH ITS LEFT EDGE (16PX + THE PHONE'S NOTCH)
const opponentDisplay = document.getElementById("opponentDisplay"); // FRIEND GAMES: "vs Bob"
const openingDisplay = document.getElementById("openingDisplay"); // THE GAME'S OPENING
const gameInfo = document.getElementById("gameInfo"); // HOLDS THOSE TWO, THE PANEL STAYS ABOVE IT

const COLLAPSED_KEY = "MOVE_LIST"; // localStorage: "closed" WHEN THE PLAYER COLLAPSED IT, GUESTS TOO
const GAP = 8; // SPACE BETWEEN THE PANEL & WHAT'S NEXT TO IT (PX)
const STATUS_HEIGHT = 72; // THE PANEL STARTS UNDER THE MESSAGE AREA ON THE SIDE (PX)
const MIN_WIDTH = 96; // ROOM FOR A NUMBER & TWO SHORT MOVES (PX)
const MIN_HEIGHT = 68; // ROOM FOR THE TOGGLE & A ROW (PX)
const MOVE_KEYS = ["ArrowUp", "ArrowDown", "Home", "End"]; // THE KEYS THAT MOVE BETWEEN THE ROWS

let moves = []; // THE GAME'S SAN MOVES
let startFen = null; // A SET POSITION'S FEN, null = THE STANDARD POSITION
let placedFor = null; // THE BOARD SIZE THE PANEL WAS LAST PLACED FOR
let opening = null; // THE GAME'S OPENING { eco, name } (showOpening), THE 3D ROOM'S MONITOR SHOWS IT TOO

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
	const focusedRow = [...rowList.children].indexOf(document.activeElement); // REPLACING THE ROWS WOULD DROP FOCUS TO THE PAGE
	rowList.replaceChildren(...moveRows(moves, startFen).map(function (row) {
		const item = document.createElement("li");
		item.tabIndex = -1; // THE ARROW KEYS REACH IT, THE TAB KEY STILL SKIPS IT
		[`${row.number}.`, row.white, row.black].forEach(function (text) {
			const cell = document.createElement("span");
			cell.textContent = text;
			item.append(cell);
		});
		return item;
	}));
	scrollToNewest();
	if (focusedRow != -1) { (rowList.children[focusedRow] || rowList.lastElementChild || toggleBtn).focus(); } // A NEW GAME HAS FEWER ROWS
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
 * @param  {[boolean]} collapsed
 */
function saveCollapsed(collapsed) {
	setCollapsed(collapsed);
	try { localStorage.setItem(COLLAPSED_KEY, collapsed ? "closed" : "open"); } catch { } // NOT SAVED (PRIVATE MODE) -> ONLY UNTIL THE PAGE RELOADS
}

/**
 * @description The toggle. The click is stopped so the menu stays as it is (a click away closes it, pages/utils/nav.js). A key that opens it moves focus to the newest move
 */
function handleMoveListToggle(e) {
	e.stopPropagation();
	const collapsed = !rowList.hidden;
	saveCollapsed(collapsed);
	if (!collapsed && e.detail === 0) { rowList.lastElementChild?.focus(); } // A MOUSE OR FINGER'S CLICK COUNTS FROM 1
}

/**
 * @description Escape closes the open panel & gives focus to the toggle, stopped so an open menu stays as it is. Up, Down, Home & End move between the rows
 */
function handlePanelKey(e) {
	if (rowList.hidden) { return; }
	const key = arrowKey(e); // W, A, S & D ARE THE ARROWS
	if ((key == "ArrowLeft" || key == "ArrowRight") && rowList.contains(document.activeElement)) { toggleBtn.focus(); } // THE PANEL'S STOP IS ITS TOGGLE, THE PAGE'S KEYS MOVE ON FROM THERE
	if (e.key == "Escape") {
		e.stopPropagation();
		toggleBtn.focus(); // BEFORE THE ROWS ARE HIDDEN, THAT WOULD DROP FOCUS TO THE PAGE
		saveCollapsed(true);
	} else if (MOVE_KEYS.includes(key) && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
		e.preventDefault();
		(itemForKey([...rowList.children], document.activeElement, key) || toggleBtn).focus(); // PAST EITHER END OF THE ROWS: BACK TO THE TOGGLE
	}
}

/**
 * @description Adds the panel's listeners, startGame (gameplay/index.js) calls this. A TV remote can't reach the panel
 */
export function addMoveListListeners() {
	toggleBtn.addEventListener("click", handleMoveListToggle);
	panel.addEventListener("keydown", handlePanelKey);
}

/* ---------------------------------------------------------------- */
// Opening
/* ---------------------------------------------------------------- */
/**
 * @description Shows the game's opening under the panel. textContent, it's never read as HTML. The panel is placed again when its room changed
 * @param  {[object]} next [{ eco, name } from the server, null = none yet]
 */
export function showOpening(next) {
	const text = next ? `${next.eco} ${next.name}` : "";
	opening = next ? { eco: next.eco, name: next.name } : null;
	if (openingDisplay.textContent == text) { return; }
	game.refresh = true; // THE MONITOR'S MOVES CHANNEL SHOWS IT
	openingDisplay.textContent = text;
	openingDisplay.hidden = !opening;
	placedFor = null;
}

/* ---------------------------------------------------------------- */
// Monitor
/* ---------------------------------------------------------------- */
/**
 * @description What the 3D room's monitor's moves channel shows: the panel's rows & the opening
 * @return {[object]} { rows, opening } [rows: [{ number, white, black }], opening: { eco, name } or null]
 */
export function moveListState() {
	return { rows: moveRows(moves, startFen), opening };
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
	const opponent = opponentDisplay.hidden && openingDisplay.hidden ? null : gameInfo.getBoundingClientRect();
	const pageBottom = (opponent ? opponent.top : game.ch) - GAP;
	const overhang = game.yPieceOffset / 2;
	const topTrayEnd = game.yBoardOff - game.tileHeight + overhang; // ROW -2
	const bottomTrayStart = game.yBoardOff + (9 + trayNudge(9)) * game.tileHeight - overhang; // ROW 9
	const bottomTrayEnd = game.yBoardOff + (10 + trayNudge(9)) * game.tileHeight + GAP;

	const sideTop = Math.max(game.widthGreater ? yBoardStart : topTrayEnd, STATUS_HEIGHT);
	const sideBottom = Math.min(game.widthGreater ? yBoardStart + boardHeight : bottomTrayStart, pageBottom);
	const side = { left, top: sideTop, width: xBoardStart - GAP - left - (game.evalBarShown ? EVAL_BAR_ROOM : 0), maxHeight: sideBottom - sideTop, below: false };
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
	const size = `${game.cw},${game.ch},${xBoardStart},${boardHeight},${game.evalBarShown}`;
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
