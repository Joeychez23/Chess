/*
 *  renderer.draw.js  --  chess frontend
 *	Renderer: one frame of the board that's on (drawBoard), and the syncs that set the 3D board to the 2D board's position,
 *	highlights, monitor, taken pieces and facings.
 *
 */

const { game, chessInst } = require("../state/index.js");
const { stepBetween, tileToSquare } = require("../utils/index.js");
const { pickable } = require("../three/pointer/hoverRules.js"); // The pieces the 3D hover fades for. No three.js in it
const { capturesAt } = require("../captures/index.js");
const { Chess } = require("chess.js");
const statusPref = require("../cards/statusPref.js"); // How a Chess Cards piece's statuses show: effects or badges (three/statusFx)
const rendererState = require("./renderer.state.js");
const { tableUp } = require("./renderer.table.js");
const scratch = new Chess(); // Only stepBetween uses it, not validateState, so nothing else can be halfway through it

let pickableKey = null; // The normal game's pickable squares last worked out (pickable3D): what they were worked out from
let pickableNow = null; // ...and the squares

/* ---------------------------------------------------------------- */
// Draw
/* ---------------------------------------------------------------- */
/**
 * @description Draws one frame of the board that's on. The render loop and a window resize call it instead of game.drawScreen().
 * 3D only follows chessInst, which only the move path (gameplay/moves) and the replay change: one move from what it shows slides,
 * a replay's step back slides in reverse, anything else (load, takeback, restart, reconnect, a turned down move, a replay's jump)
 * is set at once. A move that wasn't legal never changes chessInst, so the piece stays
 */
export function drawBoard() {
	game.drawScreen(); // 2D (hidden on 3D) also fills game.tiles and steps the slides the game waits on
	// 3D sizes itself (ResizeObserver) and draws its own frames: only the pieces, camera side and highlights are set here
	if (!rendererState.state.board3D) { return; }
	const hasCards = Boolean(rendererState.state.board3D.hasCards?.()); // The room's cards are the promotion picker; the flat one stays when it has none
	if (hasCards !== game.cards3D) {
		game.cards3D = hasCards;
		game.refresh = true;
	}
	rendererState.state.board3D.setSide(game.viewColor, !game.reduceMotion); // Flip Board turns the camera
	if (game.viewColor !== rendererState.state.tableSide) { tableUp(); }
	syncCards3D();
	syncMarks3D();
	syncScreen3D();
	syncMonitor3D();
	const fen = chessInst.fen();
	if (fen !== rendererState.state.shownFen) { // Unchanged: a sync would cut a slide short
		const step = game.reduceMotion || rendererState.state.skipAnimation ? null : stepBetween(scratch, rendererState.state.shownFen, fen);
		rendererState.state.skipAnimation = false;
		rendererState.state.shownFen = fen;
		if (step?.kind === "forward") { rendererState.state.board3D.animateMove(step.move.from, step.move.to, step.move.promotion); }
		else if (step?.kind === "back" && game.readOnly) { rendererState.state.board3D.animateUndo(step.move, facings3D()); } // syncFacing3D turns it back
		else { rendererState.state.board3D.syncFromBoard(chessInst); }
	}
	syncTaken3D(fen);
	syncFacing3D(fen);
	rendererState.state.board3D.setPickable(rendererState.state.table ? rendererState.state.table.opts.pickable || null : pickable3D(fen), game.playerColor); // A Chess Cards game's are flow.js's
	const held = rendererState.state.tableHeld || heldPiece(); // A Chess Cards game's held piece is flow.js's (holdTablePiece3D): heldPiece() has none there
	rendererState.state.board3D.setHeld(held && held.square, held && held.dragging); // After the move: a dropped piece slides from where it was let go
	// After the pieces stand as the view says: the table's view is the one on the board (flow.js loadBoard and refreshTable land
	// it together)
	if (rendererState.state.table && game.cardGame) { rendererState.state.board3D.syncStatuses(rendererState.state.table.view, statusPref.current()); }
}

// Deals the room's cards while the player promotes (they are the picker when game.cards3D) and puts them back after. When the
// keyboard is in use (game.keyboardTile) its frame starts on the queen; game.cardFocus is then moved by gameplay/input's handleCardKey
function syncCards3D() {
	const promotionColor = game.currPromotion && game.cards3D ? game.playerColor : null;
	if (promotionColor !== rendererState.state.shownPromotion) {
		rendererState.state.shownPromotion = promotionColor;
		rendererState.state.board3D.setPromotion(promotionColor, !game.reduceMotion);
		game.cardFocus = promotionColor && game.keyboardTile ? 0 : null;
	}
	if (game.cardFocus !== rendererState.state.shownCardFocus) {
		rendererState.state.shownCardFocus = game.cardFocus;
		rendererState.state.board3D.focusCard(game.cardFocus);
	}
}

// Puts marks3D() on the 3D board when they changed
function syncMarks3D() {
	const marks = marks3D();
	const key = JSON.stringify(marks);
	if (key === rendererState.state.shownMarks) { return; }
	rendererState.state.shownMarks = key;
	Object.keys(marks).forEach((kind) => rendererState.state.board3D.highlight([...new Set(marks[kind])], kind));
}

/**
 * @description The squares the 2D board highlights, by 3D highlight kind: the opponent's last move, the hint, the king in check
 * and the held piece's moves (captures apart), like drawLastMove, drawHint, the check highlight and checkAvailableMoves. focus is
 * the keyboard's (remote-only mode's) selected square while the menu is closed: 2D only lifts the piece on it, 3D needs a visible ring
 * @return {[object]} { last, hint, check, legal, capture, focus } [lists of squares]
 */
function marks3D() {
	const marks = { last: game.lastOpponentMove || [], hint: game.hint || [], check: [], legal: [], capture: [], focus: [] };
	const keyboard = game.keyboardTile && !game.menuToggled && tileToSquare(game.keyboardTile.x, game.keyboardTile.y, game.viewColor);
	if (keyboard) { marks.focus.push(keyboard); }
	if (chessInst.isCheck()) {
		const king = chessInst.board().flat().find((piece) => piece && piece.type === "k" && piece.color === chessInst.turn());
		if (king) { marks.check.push(king.square); }
	}
	const held = heldPiece();
	if (held && !game.currPromotion) {
		chessInst.moves({ square: held.square, verbose: true }).forEach((move) => marks[move.captured ? "capture" : "legal"].push(move.to));
	}
	return marks;
}

// Puts screen3D() on the monitor when it changed
export function syncScreen3D() {
	const state = screen3D();
	const key = JSON.stringify(state);
	if (key === rendererState.state.shownScreen) { return; }
	rendererState.state.shownScreen = key;
	rendererState.state.board3D.setScreen(state);
}

/**
 * @description What the library's monitor shows: the opponent (the AI's bot or a friend, by name) and a status line. Before a
 * game has loaded there's no name, and the monitor shows its test card
 * @return {[object]} { name, status, ai, thinking }
 */
function screen3D() {
	const response = game.response;
	if (!response || response.status != 200) { return { name: "", status: "", ai: false, thinking: false }; }
	const ai = Boolean(response.ai);
	const name = ai ? game.bot?.name || "Computer" : response.opponent_name || "Opponent";
	const theirTurn = chessInst.turn() !== game.playerColor;
	let status = theirTurn ? (ai ? "thinking..." : "their move") : "your move";
	if (game.gameOver || response.state == "CLOSED") {
		const winner = (game.result || response).winner;
		if (winner !== "w" && winner !== "b") { status = "draw"; }
		else if (winner === game.playerColor) { status = "you win"; }
		else if (ai) { status = "i win"; }
		else { status = "you lose"; }
	}
	return { name, status, ai, thinking: ai && theirTurn && !game.gameOver };
}

// Puts the channels' data on the monitor when it changed
export function syncMonitor3D() {
	if (!rendererState.state.monitorHooks) { return; }
	const data = rendererState.state.monitorHooks.data();
	const key = JSON.stringify(data);
	if (key === rendererState.state.shownMonitor) { return; }
	rendererState.state.shownMonitor = key;
	rendererState.state.board3D.setMonitor(data);
}

// Stands the taken pieces in the 3D board's piles when they changed. After the move step: a capture's piece is waiting to fly
// to its pile. fen is the board's, when the caller has it
export function syncTaken3D(fen = chessInst.fen()) {
	// Required here, not at the top: movelist reaches gameplay/animate and menu, which require this file and would get it half
	// made (no VIEWS)
	const { moveHistory } = require("../movelist/index.js");
	const { moves, startFen } = moveHistory();
	const key = `${fen}|${moves.length}|${startFen}|${game.playerColor}`;
	if (key === rendererState.state.shownTaken) { return; }
	rendererState.state.shownTaken = key;
	rendererState.state.board3D.setTaken(capturesAt(moves, startFen, fen), game.playerColor);
}

// Puts facings3D() on the 3D board when they or the position changed (a sync can move meshes onto other squares)
export function syncFacing3D(fen) {
	const facings = facings3D();
	const key = facings && fen + JSON.stringify(facings);
	if (!facings || key === rendererState.state.shownFacings) { return; }
	rendererState.state.shownFacings = key;
	rendererState.state.board3D.setFacing(facings);
}

/**
 * @description Which way each king, queen, bishop, rook and knight faces, from the same lists the 2D board draws them by
 * (w_piece / b_piece, w_knight / b_knight): an entry with a from last moved up or down ("up" toward rank 8), a knight's left or
 * right ("right" toward the h-file). null when there's no game from the server yet
 * @return {[object|null]} { w: { square: "up" | "down" | "left" | "right" | null }, b: { ... } }
 */
function facings3D() {
	if (!game.response || !game.response.w_piece || !game.response.b_piece) { return null; }
	return { w: facingsOf("w"), b: facingsOf("b") };
}

// One colour's facings, by square
function facingsOf(color) {
	const pieces = facingEntries(game.response[color + "_piece"], upOrDown);
	const knights = facingEntries(game.response[color + "_knight"], leftOrRight);
	return Object.fromEntries([...pieces, ...knights]);
}

// [square, facing] for each piece in a facing list (JSON) that stands somewhere; facing is null for one that never moved
function facingEntries(list, direction) {
	if (!list) { return []; }
	return JSON.parse(list).filter((piece) => piece.to).map((piece) => [piece.to, piece.from ? direction(piece.from, piece.to) : null]);
}

function upOrDown(from, to) {
	return to[1] > from[1] ? "up" : "down";
}

function leftOrRight(from, to) {
	return to[0] > from[0] ? "right" : "left";
}

// The squares the player can pick a piece up from in a normal game, null while they can't act: the 3D hover only fades covering
// pieces for those. The player's colour, not game.viewColor: Flip Board only turns the camera
function pickable3D(fen) {
	const open = !game.gameOver && game.response?.state !== "CLOSED" && !game.readOnly && !game.opposingMove && !game.currPromotion;
	const key = `${fen}|${game.playerColor}|${open}`;
	if (key !== pickableKey) {
		pickableKey = key;
		pickableNow = pickable({ board: chessInst.board(), player: game.playerColor, turn: chessInst.turn(), open });
	}
	return pickableNow;
}

/**
 * @description The piece the player holds, as the 2D board lifts it: picked up by a click (clickedTile) or pressed
 * (mousedownTile, the press is still down so it drags). Nothing once the board is locked for the move just sent (opposingMove)
 * @return {[object|null]} { square, dragging } [its square ("e2"), null when nothing is held]
 */
function heldPiece() {
	const tile = game.mousedownTile || game.clickedTile;
	if (!tile || game.opposingMove) { return null; }
	const square = tileToSquare(tile.originX, tile.originY, game.viewColor);
	return square ? { square, dragging: Boolean(game.mousedownTile) } : null;
}
