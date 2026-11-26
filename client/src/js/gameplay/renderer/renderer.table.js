/*
 *  renderer.table.js  --  chess frontend
 *	Renderer: a Chess Cards game's table on the 3D board (the hand, the held piece, the duel, the board steps, the piles and the
 *	plaques), kept for a 3D board mounted later, and the promotion card pick.
 *
 */

const { game } = require("../state/index.js");
const rendererState = require("./renderer.state.js");

/* ---------------------------------------------------------------- */
// Chess Cards Table
/* ---------------------------------------------------------------- */
/**
 * @description Sets what a picked promotion card on the 3D board does (gameplay/input's choosePromotion)
 * @param  {[function]} handler [(type) => {}, type is "q", "r", "b" or "n"]
 */
export function onCardPick(handler) {
	rendererState.state.cardPick = handler;
}

/**
 * @description Sets what a Chess Cards game's picked hand card or square does on the 3D board (gameplay/cards/flow.js)
 * @param  {[function]} handler [(hit) => {}, hit is { kind: "hand", id } or { kind: "square", square } (a click or tap),
 * { kind: "press", square } (the left mouse button went down on a square) or { kind: "release", square } (it came up with a
 * piece held: the square a drag was let go on, else null)]
 */
export function onTablePick(handler) {
	rendererState.state.tablePick = handler;
}

/**
 * @description The piece a Chess Cards game's mouse drag holds on the 3D board (gameplay/cards/flow.js pressSquare /
 * releaseSquare), kept so every sync lifts it again (drawBoard). Every pick (keys, tap, click) comes through here, so its
 * status text shows
 * @param  {[string|null]} square [the held piece's square, null to put it back down]
 * @param  {[boolean]} dragging [the press is still down, so moving the pointer drags it]
 */
export function holdTablePiece3D(square, dragging) {
	rendererState.state.tableHeld = square ? { square, dragging: Boolean(dragging) } : null;
	if (rendererState.state.board3D) { rendererState.state.board3D.setHeld(square || null, Boolean(dragging)); rendererState.state.board3D.pickStatuses(square || null); }
}

/**
 * @description A Chess Cards drag let go on a square it plays to: the piece stands on that square at once, no longer held, as a
 * normal game's drop lands; the move's slide starts and ends there (flow.js releaseSquare).
 * holdTablePiece3D(square, false) then holdTablePiece3D(null) sends it home when the play isn't made
 */
export function dropTablePiece3D(square) {
	rendererState.state.tableHeld = null;
	if (rendererState.state.board3D) { rendererState.state.board3D.dropHeld(square); rendererState.state.board3D.pickStatuses(null); }
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
	rendererState.state.table = { view, legal, opts };
	applyTable3D();
}

export function applyTable3D() {
	if (!rendererState.state.board3D || !rendererState.state.table) { return; }
	const { view, legal, opts } = rendererState.state.table;
	rendererState.state.board3D.setCardTable(view, legal, {
		catalog: opts.catalog,
		focus: opts.focus,
		focusPile: opts.focusPile,
		focusDuel: opts.focusDuel,
		dim: opts.dim,
	});
	if (opts.lifted) { rendererState.state.board3D.liftCard(opts.lifted); }
	else { rendererState.state.board3D.dropCard(); }
	rendererState.state.board3D.highlightSquares(opts.glow || [], opts.glowFocus || null);
}

// flow.js lays a Chess Cards prompt's plaques again (its { kind: "table" }): a new 3D board (its room still loading, so the 2D
// buttons show) or the room turned (Flip Board). The table coming up says so itself (three/index.js setCardTable)
export function tableUp() {
	rendererState.state.tableSide = game.viewColor;
	rendererState.state.tablePick?.({ kind: "table" });
}

/**
 * @description A Chess Cards game's card duel on the 3D board (three/index.js dealDuel, flipDuel and endDuel,
 * gameplay/cards/flow.js): deals it or brings it to the view, turns a card up, ends it. The duel dealt is kept for a board
 * mounted later
 * @param  {[object]} duel [view.duel]
 */
export function dealDuel3D(duel) {
	rendererState.state.tableDuel = duel;
	if (rendererState.state.board3D) { rendererState.state.board3D.dealDuel(duel); }
}

/**
 * @description Turns a duel card face up on the 3D board, framed in gold when won (three/index.js flipDuel)
 * @param  {[string]} player ["w" | "b", the duel-flip event's player]
 * @param  {[number|null]} index [0..2 in the view's duel hands, null: a pick the view no longer shows]
 * @param  {[object]} card [{ r, s }, the duel-flip event's card]
 * @param  {[boolean]} won [true: its gold outline]
 */
export function flipDuel3D(player, index, card, won) {
	if (rendererState.state.board3D) { rendererState.state.board3D.flipDuel(player, index, card, won); }
}

/**
 * @description The card duel is over on the 3D board (three/index.js endDuel), and none is kept for a board mounted later
 */
export function endDuel3D() {
	rendererState.state.tableDuel = null;
	if (rendererState.state.board3D) { rendererState.state.board3D.endDuel(); }
}

/**
 * @description One of a Chess Cards answer's board steps (gameplay/cards/boardShow.js) on the 3D board (three/board/motion.js
 * playBoardStep): a move, a swap, a take, a piece out to a square or back, a topple, a handover. chessInst isn't changed: the
 * answer's set step loads its view, and drawBoard then sets the pieces to it (they already stand there). At once on 2D and under
 * reduce motion (the set lands the view)
 * @param  {[object]} step [boardSteps']
 * @return {[Promise<void>]} [resolves when the step has ended]
 */
export function boardStep3D(step) {
	if (!rendererState.state.board3D || game.reduceMotion) { return Promise.resolve(); }
	// Its pieces move past the table's view: drawBoard doesn't sync the statuses to it until the set lands the answer's (statusFx)
	if (rendererState.state.table) { rendererState.state.board3D.holdStatuses(rendererState.state.table.view); }
	const done = rendererState.state.board3D.playBoardStep(step);
	if (step.op === "move") { // The move's own taken piece leaves as a drawn move's does (drawBoard)
		rendererState.state.shownTaken = null;
		rendererState.calls.syncTaken3D();
	}
	return done;
}

/**
 * @description Opens or closes a Board Effects pile on the 3D board (the keyboard's Enter on it, gameplay/cards/flow.js)
 * @param  {[string]} pile ["mine" or "his"]
 */
export function toggleTablePile3D(pile) {
	if (rendererState.state.board3D) { rendererState.state.board3D.toggleCardPile(pile); }
}

/**
 * @description The pile that is open on the 3D board
 * @return {[string|null]} ["mine", "his", "mineSpot" or "hisSpot", null for none]
 */
export function tablePileOpen3D() {
	return rendererState.state.board3D ? rendererState.state.board3D.openCardPile() : null;
}

/**
 * @description A Chess Cards prompt's brass plaques on the 3D table (three/index.js showTableButtons, gameplay/cards/flow.js
 * showPrompt), [] takes them away
 * @param  {[array]} list [[{ id, label }]]
 * @param  {[object|null]} anchor [tableLayout.js plaqueAnchor's]
 * @return {[boolean]} [the 3D table is up: false on 2D and while its room loads, the prompt keeps its 2D buttons]
 */
export function showTableButtons3D(list, anchor) {
	return Boolean(rendererState.state.board3D) && rendererState.state.board3D.showTableButtons(list, anchor);
}

/**
 * @description The keyboard's plaque on the 3D table (three/index.js focusTableButton)
 * @param  {[number|null]} index
 */
export function focusTableButton3D(index) {
	if (rendererState.state.board3D) { rendererState.state.board3D.focusTableButton(index); }
}

/**
 * @description A plaque on the 3D table sinks and rises (three/index.js pressTableButton)
 * @param  {[string]} id
 */
export function pressTableButton3D(id) {
	if (rendererState.state.board3D) { rendererState.state.board3D.pressTableButton(id); }
}
