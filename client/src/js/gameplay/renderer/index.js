/*
 *  index.js  --  chess frontend
 *	Renderer
 *	The one place that picks the board the player sees: the 2D canvas or the 3D board (three/). The rest of the game calls
 *	drawBoard() and setView() and never checks which one is on.
 *	On 3D the 2D canvas keeps drawing, laid clear over the 3D board with only its trays showing: its frames still run the game
 *	(tiles, slides, trays). Then the 3D board is set to match chessInst, game.viewColor (the camera's side) and the 2D highlights.
 *	A 3D board that can't load or mount (no WebGL, offline) leaves the player on 2D. One that loses its WebGL context (iPhones do
 *	when the page is backgrounded) is put up again when the browser gives it back, or falls back to 2D when it keeps losing it.
 *	Input (gameplay/input) only asks here for the square under the pointer; its handlers are the same on both boards
 *	(addBoardListener).
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, canvas, chessInst, requestFrame } = require("../state/index.js");
const { load3D } = require("../three/load.js"); // Downloads the 3D board the first time it's turned on
const { showStatus, MESSAGE_TIME } = require("../status/index.js");
const { stepBetween, tileToSquare } = require("../utils/index.js");
const { reportError } = require("../../pages/utils/reportErrors.js");
const { pickable } = require("../three/hoverRules.js"); // The pieces the 3D hover fades for. No three.js in it
const { capturesAt } = require("../captures/index.js");
const { Chess } = require("chess.js");
const statusPref = require("../cards/statusPref.js"); // How a Chess Cards piece's statuses show: effects or badges (three/statusFx)
statusPref.onChange(handleStatusPrefChange);
const scratch = new Chess(); // Only stepBetween uses it, not validateState, so nothing else can be halfway through it

export const VIEWS = { TWO_D: "2d", THREE_D: "3d" };

let board3D = null; // The 3D module while it's mounted, null on 2D
let container = null; // What the 3D canvas fills, in #main next to the (hidden) 2D canvas
let switching = null; // The setView() in progress, so two presses don't mount twice
let shownFen = null; // The position the 3D board shows (or is sliding to)
let skipAnimation = false; // The next position is set at once (skipNextAnimation3D: a replay's jump)
let shownFacings = null; // The position and piece facings the 3D board was last turned to (syncFacing3D)
let shownTaken = null; // What the 3D board's piles were last set from (syncTaken3D), so they're only redone when it changes
let shownMarks = null; // The highlights the 3D board shows (marks3D() as JSON), so they're only redone when they change
let shownScreen = null; // What the 3D room's monitor was last told to show (screen3D() as JSON)
let cardPick = null; // What a picked promotion card calls (onCardPick): gameplay/input's choosePromotion
let shownPromotion = null; // The colour the 3D cards were last dealt for, null when they're on the deck (syncCards3D)
let shownCardFocus = null; // The card the 3D board frames (game.cardFocus)
let tablePick = null; // What a Chess Cards game's picked hand card or square, and its mouse press and release, call (onTablePick)
let pickableKey = null; // The normal game's pickable squares last worked out (pickable3D): what they were worked out from
let pickableNow = null; // ...and the squares
let tableHeld = null; // The piece a Chess Cards game's drag holds, { square, dragging } (holdTablePiece3D), null for none
let table = null; // The Chess Cards table as setTable3D last said it, put on every 3D board mounted later
// game.viewColor when flow.js was last told of the 3D table (tableUp). Flip Board turns the room, so a prompt's plaques by a
// square are laid again
let tableSide = null;
let tableDuel = null; // The card duel the table was last dealt (dealDuel3D), dealt on every 3D board mounted later, null for none
let heldFace = null; // The face the monitor holds (a result's), put back on a 3D board mounted later
let monitorHooks = null; // gameplay/monitor's { handlers, announce, onChange, data } (setMonitorHooks), given to every 3D board
let shownMonitor = null; // What the monitor's channels were last sent (monitorHooks.data() as JSON)
let tableImage = null; // The 2D canvas's CSS table background, taken off on 3D (it's opaque and would hide the 3D board)
const boardListeners = []; // [type, handler, options] from addBoardListener, put on each new 3D container too
let viewListener = function () {}; // onViewChange()'s, told when 3D falls back to 2D by itself

const RESTORE_WAIT_MS = 3000; // A lost context not given back this long after the page is seen: a new board (and context) goes up anyway
const MAX_LOSSES = 3; // This many lost contexts...
const LOSS_WINDOW_MS = 2 * 60 * 1000; // ...this close together and it's back to 2D
let losses = []; // When each recent context was lost (Date.now())
let restoreTimer = null;

// The next frame swaps the statuses. init() calls no listener: drawBoard reads current()
function handleStatusPrefChange() {
	game.refresh = true;
	requestFrame();
}

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
	if (!board3D) { return; }
	const hasCards = Boolean(board3D.hasCards?.()); // The room's cards are the promotion picker; the flat one stays when it has none
	if (hasCards !== game.cards3D) {
		game.cards3D = hasCards;
		game.refresh = true;
	}
	board3D.setSide(game.viewColor, !game.reduceMotion); // Flip Board turns the camera
	if (game.viewColor !== tableSide) { tableUp(); }
	syncCards3D();
	syncMarks3D();
	syncScreen3D();
	syncMonitor3D();
	const fen = chessInst.fen();
	if (fen !== shownFen) { // Unchanged: a sync would cut a slide short
		const step = game.reduceMotion || skipAnimation ? null : stepBetween(scratch, shownFen, fen);
		skipAnimation = false;
		shownFen = fen;
		if (step?.kind === "forward") { board3D.animateMove(step.move.from, step.move.to, step.move.promotion); }
		else if (step?.kind === "back" && game.readOnly) { board3D.animateUndo(step.move, facings3D()); } // syncFacing3D turns it back
		else { board3D.syncFromBoard(chessInst); }
	}
	syncTaken3D(fen);
	syncFacing3D(fen);
	board3D.setPickable(table ? table.opts.pickable || null : pickable3D(fen)); // A Chess Cards game's are flow.js's
	const held = tableHeld || heldPiece(); // A Chess Cards game's held piece is flow.js's (holdTablePiece3D): heldPiece() has none there
	board3D.setHeld(held && held.square, held && held.dragging); // After the move: a dropped piece slides from where it was let go
	// After the pieces stand as the view says: the table's view is the one on the board (flow.js loadBoard and refreshTable land
	// it together)
	if (table && game.cardGame) { board3D.syncStatuses(table.view, statusPref.current()); }
}

// Deals the room's cards while the player promotes (they are the picker when game.cards3D) and puts them back after. When the
// keyboard is in use (game.keyboardTile) its frame starts on the queen; game.cardFocus is then moved by gameplay/input's handleCardKey
function syncCards3D() {
	const promotionColor = game.currPromotion && game.cards3D ? game.playerColor : null;
	if (promotionColor !== shownPromotion) {
		shownPromotion = promotionColor;
		board3D.setPromotion(promotionColor, !game.reduceMotion);
		game.cardFocus = promotionColor && game.keyboardTile ? 0 : null;
	}
	if (game.cardFocus !== shownCardFocus) {
		shownCardFocus = game.cardFocus;
		board3D.focusCard(game.cardFocus);
	}
}

// Puts marks3D() on the 3D board when they changed
function syncMarks3D() {
	const marks = marks3D();
	const key = JSON.stringify(marks);
	if (key === shownMarks) { return; }
	shownMarks = key;
	Object.keys(marks).forEach((kind) => board3D.highlight([...new Set(marks[kind])], kind));
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
function syncScreen3D() {
	const state = screen3D();
	const key = JSON.stringify(state);
	if (key === shownScreen) { return; }
	shownScreen = key;
	board3D.setScreen(state);
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
function syncMonitor3D() {
	if (!monitorHooks) { return; }
	const data = monitorHooks.data();
	const key = JSON.stringify(data);
	if (key === shownMonitor) { return; }
	shownMonitor = key;
	board3D.setMonitor(data);
}

// Stands the taken pieces in the 3D board's piles when they changed. After the move step: a capture's piece is waiting to fly
// to its pile. fen is the board's, when the caller has it
function syncTaken3D(fen = chessInst.fen()) {
	// Required here, not at the top: movelist reaches gameplay/animate and menu, which require this file and would get it half
	// made (no VIEWS)
	const { moveHistory } = require("../movelist/index.js");
	const { moves, startFen } = moveHistory();
	const key = `${fen}|${moves.length}|${startFen}|${game.playerColor}`;
	if (key === shownTaken) { return; }
	shownTaken = key;
	board3D.setTaken(capturesAt(moves, startFen, fen), game.playerColor);
}

// Puts facings3D() on the 3D board when they or the position changed (a sync can move meshes onto other squares)
function syncFacing3D(fen) {
	const facings = facings3D();
	const key = facings && fen + JSON.stringify(facings);
	if (!facings || key === shownFacings) { return; }
	shownFacings = key;
	board3D.setFacing(facings);
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

/* ---------------------------------------------------------------- */
// Monitor
/* ---------------------------------------------------------------- */
/**
 * @description What the 3D room's monitor works with, from gameplay/monitor (it can't be required here: it requires the menu,
 * which requires this file). Every 3D board put up from now on gets them
 * @param  {[object]} hooks [{ handlers, announce(text), onChange({ ready, state }) } (three/index.js mount()'s monitor option)
 * and data(): the channels' data]
 */
export function setMonitorHooks(hooks) {
	monitorHooks = hooks;
}

/**
 * @description Zooms in to the 3D room's monitor (the menu's Monitor item)
 * @return {[boolean]} [false on 2D, with no monitor or before it has the game's data]
 */
export function enterMonitor3D() {
	return board3D ? board3D.enterMonitor() : false;
}

/**
 * @description Back to the desk from the monitor
 * @return {[Promise<void>]} [resolves once it's on the desk, at once on 2D or when it already is]
 */
export function leaveMonitor3D() {
	return board3D ? board3D.leaveMonitor() : Promise.resolve();
}

/**
 * @description The 3D room's monitor's state
 * @return {[string|null]} ["idle", "zooming", "zoomed" or "leaving", null on 2D or with no monitor]
 */
export function monitorState3D() {
	return board3D ? board3D.monitorState() : null;
}

/**
 * @description The keyboard's focus came to the 3D room's monitor or left it (gameplay/monitor's stop). Does nothing on 2D
 * @param  {[boolean]} on
 */
export function focusMonitor3D(on) {
	if (board3D) { board3D.focusMonitor(on); }
}

/**
 * @description The monitor's face reacts to a move or the result (AI games, gameplay/bots faceFor and endFaceFor). Does nothing
 * on 2D, but a result's face is remembered for a 3D board put up later
 * @param  {[string]} name ["happy" | "sad" | "angry" | "won" | "lost" | "neutral" | null (no change)]
 */
export function setFace(name) {
	if (!name || name === heldFace) { return; } // The mating move already showed the result: game over doesn't start it again
	heldFace = name === "won" || name === "lost" ? name : null;
	if (board3D) { board3D.setFace(name); }
}

/* ---------------------------------------------------------------- */
// Pieces
/* ---------------------------------------------------------------- */
/**
 * @description The next position the 3D board is given is set at once, not slid (a replay's jump, a held key). Does nothing on 2D
 */
export function skipNextAnimation3D() {
	if (board3D) { skipAnimation = true; }
}

/**
 * @description Restart and Rematch on 3D: the pieces glide home to chessInst (already the new game) in the 2D slide's time,
 * pieces with no match fade in or out. With reduce motion on they're just set. Does nothing on 2D
 */
export function glideHome3D() {
	if (!board3D) { return; }
	shownFen = chessInst.fen(); // So drawBoard doesn't set them at once when the new game takes over
	if (game.reduceMotion) { board3D.syncFromBoard(chessInst); }
	else { board3D.glideHome(chessInst); }
}

/**
 * @description Reduce motion was just turned on: 3D's camera turn and piece slides in progress land at once. Reduce motion keeps
 * 3D (it doesn't switch to 2D), it only takes the motion out: Flip Board and Reset View set the camera, moves and restarts set the
 * pieces (drawBoard, glideHome3D). Only the player's own camera drags still move it. Does nothing on 2D
 */
export function stopMotion3D() {
	if (board3D) { board3D.stopMotion(); }
}

/**
 * @description Resolves once the 3D board has drawn a frame with its squares in (the page fades in on it). At once on 2D
 * @return {[Promise<void>]}
 */
export function whenDrawn3D() {
	return board3D ? board3D.whenDrawn() : Promise.resolve();
}

/**
 * @description Sets what a picked promotion card on the 3D board does (gameplay/input's choosePromotion)
 * @param  {[function]} handler [(type) => {}, type is "q", "r", "b" or "n"]
 */
export function onCardPick(handler) {
	cardPick = handler;
}

/* ---------------------------------------------------------------- */
// Chess Cards Table
/* ---------------------------------------------------------------- */
/**
 * @description Sets what a Chess Cards game's picked hand card or square does on the 3D board (gameplay/cards/flow.js)
 * @param  {[function]} handler [(hit) => {}, hit is { kind: "hand", id } or { kind: "square", square } (a click or tap),
 * { kind: "press", square } (the left mouse button went down on a square) or { kind: "release", square } (it came up with a
 * piece held: the square a drag was let go on, else null)]
 */
export function onTablePick(handler) {
	tablePick = handler;
}

/**
 * @description The piece a Chess Cards game's mouse drag holds on the 3D board (gameplay/cards/flow.js pressSquare /
 * releaseSquare), kept so every sync lifts it again (drawBoard). Every pick (keys, tap, click) comes through here, so its
 * status text shows
 * @param  {[string|null]} square [the held piece's square, null to put it back down]
 * @param  {[boolean]} dragging [the press is still down, so moving the pointer drags it]
 */
export function holdTablePiece3D(square, dragging) {
	tableHeld = square ? { square, dragging: Boolean(dragging) } : null;
	if (board3D) { board3D.setHeld(square || null, Boolean(dragging)); board3D.pickStatuses(square || null); }
}

/**
 * @description A Chess Cards drag let go on a square it plays to: the piece stands on that square at once, no longer held, as a
 * normal game's drop lands; the move's slide starts and ends there (flow.js releaseSquare).
 * holdTablePiece3D(square, false) then holdTablePiece3D(null) sends it home when the play isn't made
 */
export function dropTablePiece3D(square) {
	tableHeld = null;
	if (board3D) { board3D.dropHeld(square); board3D.pickStatuses(null); }
}

/**
 * @description A Chess Cards game's table on the 3D board (three/index.js setCardTable, liftCard / dropCard and
 * highlightSquares). Kept for a board mounted later
 * @param  {[object]} view [cards.view]
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} opts [{ pickable: the squares of the pieces the player can pick up, null while they can't act (the 3D
 * hover's fade), catalog, focus: the keyboard's hand card, focusPile: the keyboard's pile, focusDuel: the keyboard's duel card
 * (an index), dim: the hand cards drawn dimmer, lifted: the card being played, glow: its next squares, glowFocus: the keyboard's
 * square }]
 */
export function setTable3D(view, legal, opts) {
	table = { view, legal, opts };
	applyTable3D();
}

function applyTable3D() {
	if (!board3D || !table) { return; }
	const { view, legal, opts } = table;
	board3D.setCardTable(view, legal, {
		catalog: opts.catalog,
		focus: opts.focus,
		focusPile: opts.focusPile,
		focusDuel: opts.focusDuel,
		dim: opts.dim,
	});
	if (opts.lifted) { board3D.liftCard(opts.lifted); }
	else { board3D.dropCard(); }
	board3D.highlightSquares(opts.glow || [], opts.glowFocus || null);
}

// flow.js lays a Chess Cards prompt's plaques again (its { kind: "table" }): a new 3D board (its room still loading, so the 2D
// buttons show) or the room turned (Flip Board). The table coming up says so itself (three/index.js setCardTable)
function tableUp() {
	tableSide = game.viewColor;
	tablePick?.({ kind: "table" });
}

/**
 * @description A Chess Cards game's card duel on the 3D board (three/index.js dealDuel, flipDuel and endDuel,
 * gameplay/cards/flow.js): deals it or brings it to the view, turns a card up, ends it. The duel dealt is kept for a board
 * mounted later
 * @param  {[object]} duel [view.duel]
 */
export function dealDuel3D(duel) {
	tableDuel = duel;
	if (board3D) { board3D.dealDuel(duel); }
}

/**
 * @description Turns a duel card face up on the 3D board, framed in gold when won (three/index.js flipDuel)
 * @param  {[string]} player ["w" | "b", the duel-flip event's player]
 * @param  {[number|null]} index [0..2 in the view's duel hands, null: a pick the view no longer shows]
 * @param  {[object]} card [{ r, s }, the duel-flip event's card]
 * @param  {[boolean]} won [true: its gold outline]
 */
export function flipDuel3D(player, index, card, won) {
	if (board3D) { board3D.flipDuel(player, index, card, won); }
}

/**
 * @description The card duel is over on the 3D board (three/index.js endDuel), and none is kept for a board mounted later
 */
export function endDuel3D() {
	tableDuel = null;
	if (board3D) { board3D.endDuel(); }
}

/**
 * @description One of a Chess Cards answer's board steps (gameplay/cards/boardShow.js) on the 3D board (three/motion.js
 * playBoardStep): a move, a swap, a take, a piece out to a square or back, a topple, a handover. chessInst isn't changed: the
 * answer's set step loads its view, and drawBoard then sets the pieces to it (they already stand there). At once on 2D and under
 * reduce motion (the set lands the view)
 * @param  {[object]} step [boardSteps']
 * @return {[Promise<void>]} [resolves when the step has ended]
 */
export function boardStep3D(step) {
	if (!board3D || game.reduceMotion) { return Promise.resolve(); }
	// Its pieces move past the table's view: drawBoard doesn't sync the statuses to it until the set lands the answer's (statusFx)
	if (table) { board3D.holdStatuses(table.view); }
	const done = board3D.playBoardStep(step);
	if (step.op === "move") { // The move's own taken piece leaves as a drawn move's does (drawBoard)
		shownTaken = null;
		syncTaken3D();
	}
	return done;
}

/**
 * @description Opens or closes a Board Effects pile on the 3D board (the keyboard's Enter on it, gameplay/cards/flow.js)
 * @param  {[string]} pile ["mine" or "his"]
 */
export function toggleTablePile3D(pile) {
	if (board3D) { board3D.toggleCardPile(pile); }
}

/**
 * @description The pile that is open on the 3D board
 * @return {[string|null]} ["mine", "his", "mineSpot" or "hisSpot", null for none]
 */
export function tablePileOpen3D() {
	return board3D ? board3D.openCardPile() : null;
}

/**
 * @description A Chess Cards prompt's brass plaques on the 3D table (three/index.js showTableButtons, gameplay/cards/flow.js
 * showPrompt), [] takes them away
 * @param  {[array]} list [[{ id, label }]]
 * @param  {[object|null]} anchor [tableLayout.js plaqueAnchor's]
 * @return {[boolean]} [the 3D table is up: false on 2D and while its room loads, the prompt keeps its 2D buttons]
 */
export function showTableButtons3D(list, anchor) {
	return Boolean(board3D) && board3D.showTableButtons(list, anchor);
}

/**
 * @description The keyboard's plaque on the 3D table (three/index.js focusTableButton)
 * @param  {[number|null]} index
 */
export function focusTableButton3D(index) {
	if (board3D) { board3D.focusTableButton(index); }
}

/**
 * @description A plaque on the 3D table sinks and rises (three/index.js pressTableButton)
 * @param  {[string]} id
 */
export function pressTableButton3D(id) {
	if (board3D) { board3D.pressTableButton(id); }
}

/* ---------------------------------------------------------------- */
// Camera
/* ---------------------------------------------------------------- */
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
 * @description Listens on the board the player sees: the 2D canvas now and every 3D board put up later (its container goes away
 * with it)
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
 * @param  {[MouseEvent|object]} e [anything with clientX and clientY]
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
		if (!can3D() && currentView() === VIEWS.THREE_D) { queueSwitch(show2D).then(viewListener); return; }
		viewListener(currentView()); // The button turns back on (or off) without a switch
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
		if (!board3D) { return VIEWS.TWO_D; } // The player went to 2D meanwhile
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
	if (board3D) { return VIEWS.THREE_D; }
	const board = await load3D(); // null: load3D already said why
	if (!board) { return show2D(); }
	container = document.createElement("div");
	container.id = "board3D";
	container.style.width = container.style.height = "100%";
	container.style.touchAction = "none"; // The touch handlers own every finger: no scroll or pinch zoom of the page
	boardListeners.forEach(([type, handler, options]) => container.addEventListener(type, handler, options));
	canvas.after(container);
	try {
		const monitor = monitorHooks && {
			handlers: monitorHooks.handlers,
			announce: monitorHooks.announce,
			onChange: monitorHooks.onChange,
		};
		const cards = { onPick: handleCardPick, onTable: handleTablePick, tableOn: isTableOn };
		// Throws when the WebGL context can't be made
		board.mount(container, { onContextLost: contextLost, onContextRestored: rebuild3D, monitor, cards });
	} catch (err) {
		console.warn("3D board failed to start", err);
		reportError(`3D board couldn't start: ${err.message}`, "3d-board");
		board.unmount(); // Frees whatever it made before it threw
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
	shownTaken = null;
	shownPromotion = null; // A new board's cards are on the deck
	shownCardFocus = null;
	game.cardFocus = null;
	syncTaken3D();
	shownScreen = null;
	syncScreen3D();
	shownMonitor = null; // A new board (one rebuilt after a lost context too) gets the data again
	syncMonitor3D();
	applyTable3D();
	tableUp();
	if (tableDuel) { board3D.dealDuel(tableDuel); }
	if (heldFace) { board3D.setFace(heldFace); } // The game ended before this board went up
	game.refresh = true;
	requestFrame();
	return VIEWS.THREE_D;
}

// The 3D board's card callbacks read cardPick and tablePick when they're called, so a handler set after the mount still hears it.
// The answer goes back to the 3D board (flow.js says whether a card can be held or zoomed)
function handleCardPick(type) {
	return cardPick?.(type);
}

function handleTablePick(hit) {
	return tablePick?.(hit);
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
	game.cards3D = false; // 2D has its flat picker
	game.refresh = true; // Redraw the whole canvas, it only had the trays on 3D
	requestFrame();
	return VIEWS.TWO_D;
}
