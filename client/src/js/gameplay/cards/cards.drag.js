/*
 *  cards.drag.js  --  chess frontend
 *	Chess Cards Drag
 *	Picks, drops and the board's squares: which pieces the table lets the player pick up, a hand card clicked or dragged to a place,
 *	a pile's drop buttons, a square clicked, a piece pressed, dragged and let go, and a dropped piece sent home
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { sqName, sqIndex } = require("../../../../../cards-engine/board.js"); // the engine's own; nothing else of it is loaded
const { cards } = require("./store.js");
const { showStatus, MESSAGE_TIME } = require("../status/index.js");
const cardsSelect = require("./select.js");
const { holdTablePiece3D, dropTablePiece3D } = require("../renderer/index.js");
const cardsState = require("./cards.state.js");
const cardsPrompts = require("./cards.prompts.js");

// This press picked a piece that wasn't picked yet (pressSquare), so its click keeps it. A click on the piece already picked puts it down
let pressedNew = false;

/* ---------------------------------------------------------------- */
// Pickable pieces
/* ---------------------------------------------------------------- */
// The squares of the player's pieces that can be picked up now
export function pickablePieces(view, legal, picking) {
	const squares = [];
	for (const [i, piece] of view.board.sq.entries()) {
		if (picking && piece && piece.c === cards.you && cardsSelect.pickPiece(legal, view, sqName(i), cards.hidden)) {
			squares.push(sqName(i));
		}
	}
	return squares;
}

// The picked piece floats over its square while it's picked, as a normal game's clicked piece does, and
// comes down with the pick. Not while the mouse drags one or a dropped one waits
export function hover() {
	if (cardsState.state.dragFrom || cardsState.state.dropped) { return; }
	const square = cardsState.state.sel && cardsState.state.sel.picks.length ? cardsState.state.sel.picks[0] : null;
	const piece = square && cards.view.board.sq[sqIndex(square)];
	holdTablePiece3D(piece && piece.c === cards.you ? square : null, false);
}

/* ---------------------------------------------------------------- */
// Picking and dropping cards
/* ---------------------------------------------------------------- */

/**
 * @description A hand card clicked: a move card lifts (its plays' squares glow). An ability card (select.js zooms) clicked or
 * tapped is zoomed in on to be read and isn't lifted. The mouse's click does only that, as the mouse plays it by dragging
 * (dropCard; a curse keeps its clear's button); a tap's is picked as before too (its targets glow, its buttons). Off the turn
 * it's still zoomed in on, but not while steps play, a duel is on or the promotion cards are out (select.js handRead). The keys
 * pick it as before, lifted with its readable copy, no zoom. Picked already: an active with no target is played and anything
 * else is put back down
 * @param  {[string]} id [the card's id, "king" for the King card]
 * @return {[boolean]} zoom [the camera zooms in on it (three/pointer/index.js pickTable)]
 */
export function clickCard(id) {
	const kind = cards.view && cardsSelect.handCards(cards.view).find((card) => card.id === id)?.kind;
	// Before endPromotion: the click that puts the promotion cards away doesn't zoom, the camera couldn't frame it
	const { read, zoom } = cardsSelect.handRead({
		kind, keys: cardsState.state.keyboard, showing: cardsState.state.showing > 0, duel: Boolean(cards.view?.duel), promoting: Boolean(cardsState.state.promoting),
	});
	// Nothing is picked (a duel is on: no hand card lifts nor zooms). An ability card is still read, off the turn too
	if (!cardsState.calls.yourMove() || cardsPrompts.choosing() || cards.view.duel) { return zoom; }
	settle();
	cardsState.state.confirm = null; // a click elsewhere: the skull's question and the promotion cards go
	cardsPrompts.endPromotion();
	if (cardsState.state.sel && cardsState.state.sel.card === id) {
		const { glow, ready } = cardsSelect.options(cardsState.state.sel, cards.view.board);
		const play = ready.filter((action) => action.type === "active" && !action.target);
		// One more tap or Enter confirms, also with its discard on the prompt. The mouse drags it to the active spot instead
		if (!cardsState.state.byMouse && !glow.length && play.length === 1) {
			cardsPrompts.choose(play[0]);
			return;
		}
		cardsState.calls.cancelPick();
		return;
	}
	const next = cardsSelect.lift(cards.legal, cards.view, id, cards.hidden);
	cardsState.state.readCard = read ? id : null;
	// The mouse's click only zooms an active or the passive: it's played by dragging (dropCard). The pick before it goes down
	cardsState.state.sel = cardsState.state.byMouse && (kind === "active" || kind === "passive") ? null : next.actions.length ? next : null;
	if (!cardsState.state.sel && !read) { showStatus("action", "That card can't be played now.", MESSAGE_TIME); } // not for a card being read
	cardsState.state.squareFocus = null;
	cardsState.calls.refreshTable();
	return zoom;
}

/**
 * @description The mouse went down on one of the player's cards (three/pointer/index.js onPointerDown), the drag's start: the places
 * of theirs it can be let go on (select.js dropPlay), which the table frames while it's dragged. A hand card with none is still
 * dragged, and slides back wherever it's let go
 * @param  {[object]} hit [{ from: "hand" | "pile" (a card of an opened pile), id }]
 * @return {[array|null]} places ["spot", "passive", "discard"; null: it isn't picked up (not the player's turn, a choice asked,
 * the promotion cards out, a placed card the game doesn't let them drop)]
 */
export function landings({ from, id }) {
	if (!cardsState.calls.yourMove() || cardsState.state.promoting || cardsPrompts.choosing() || cards.view.duel) { return null; } // a duel is on: no card is dragged
	const places = ["spot", "passive", "discard"]
		.filter((place) => cardsSelect.dropPlay(cards.legal, cards.view, { from, id }, { side: "mine", place }, cards.hidden));
	return from === "pile" && !places.length ? null : places;
}

/**
 * @description The mouse let go of a dragged card (three/pointer/index.js releaseCard), and select.js dropPlay says what it does: on
 * the discard pile its free discard (a placed card: its drop); an active on the active spot is played, or lies there while its
 * targets are picked (the board lights them; dragged off again, or a click on a square that isn't one, it goes back to the
 * hand); the passive on the passive pile is placed. Anywhere else, or a play the game doesn't offer: the card goes back
 * @param  {[object]} hit [{ from, id, place: three/cardTable/tableLayout.js placeAt's, null for nowhere }]
 * @return {[boolean]} taken [the card stays on the place: its play was sent or is being picked]
 */
export function dropCard({ from, id, place }) {
	if (!cardsState.calls.yourMove() || cardsState.state.promoting || cardsPrompts.choosing()) { return false; }
	const play = cardsSelect.dropPlay(cards.legal, cards.view, { from, id }, place, cards.hidden);
	cardsState.state.keyboard = false;
	cardsState.state.byMouse = true;
	settle();
	cardsState.state.confirm = null;
	if (!play) {
		// Its own pick goes down with it: dragged back before the last target. So does the pick of a card lying on the active
		// spot: the table sends that card back when another's drop is refused
		if (cardsState.state.sel && cardsState.state.sel.card !== null && (cardsState.state.sel.card === id || cardsState.state.sel.card === cardsState.state.onPlace)) { cardsState.calls.cancelPick(); }
		return false;
	}
	cardsState.state.onPlace = id;
	if (play.pick) {
		cardsState.state.sel = play.pick;
		cardsState.state.squareFocus = null;
		cardsState.calls.refreshTable();
		return true;
	}
	cardsPrompts.choose(play.action);
	return true;
}

/**
 * @description The keys' and a tap's way to drop a placed card (the mouse drags it to the discard pile). With one of the
 * player's own piles opened, Enter on it offers a prompt button per card of it the game lets them drop, and a tap on one of its
 * cards offers that card's (select.js pileDrops). Cancel has the keys' focus (select.js promptFocus)
 * @param  {[string]} pile [the opened pile]
 * @param  {[string|null]} id [the card tapped, null: every card of the pile]
 * @return {[boolean]} offered [false: nothing to drop there now]
 */
export function offerDrops(pile, id = null) {
	if (!cardsState.calls.yourMove() || cardsState.state.promoting || cardsPrompts.choosing()) { return false; }
	const drops = cardsSelect.pileDrops(cards.legal, cards.view, pile, id);
	if (!drops.length) { return false; }
	settle();
	cardsState.state.confirm = null;
	cardsState.state.sel = { card: null, actions: drops, picks: [] };
	cardsState.state.squareFocus = null;
	cardsState.calls.refreshTable();
	return true;
}

/* ---------------------------------------------------------------- */
// Board squares
/* ---------------------------------------------------------------- */

/**
 * @description A square clicked: the next square of the play being picked, another piece for the lifted card, or a piece
 * picked directly (shortcutFor). The last square of a play sends it; several plays on the same squares go to the prompt.
 * A square that leads nowhere puts the pick down
 * @param  {[string]} square ["e4"]
 * @param  {[boolean]} drop [a dragged piece let go on its target (releaseSquare)]
 */
export function clickSquare(square, drop = false) {
	if (!cardsState.calls.yourMove()) { return; }
	if (!drop) { settle(); } // a click elsewhere gives the dropped piece's play up
	if (cardsState.state.promoting) { cardsState.calls.cancelPick(); return; } // a click away from the promotion cards puts the move down
	const again = !drop && !pressedNew && !cardsPrompts.choosing() && cardsState.state.sel && cardsState.state.sel.picks.length === 1 && cardsState.state.sel.picks[0] === square;
	pressedNew = false;
	// The picked piece clicked again: it and its card go down, as in a normal game
	if (again) { cardsState.calls.cancelPick(); return; }
	cardsState.state.confirm = null;
	const board = cards.view.board;
	let next = cardsState.state.sel && cardsSelect.pick(cardsState.state.sel, board, square);
	// Another of the lifted card's pieces
	if (!next && cardsState.state.sel && cardsState.state.sel.card !== null && cardsState.state.sel.picks.length) { next = cardsSelect.pick({ ...cardsState.state.sel, picks: [] }, board, square); }
	// A piece picked directly, a card of its type spent
	if (!next && !cardsPrompts.choosing()) { next = cardsSelect.pickPiece(cards.legal, cards.view, square, cards.hidden); }
	if (!next) {
		if (cardsState.state.sel && !cardsPrompts.choosing()) { cardsState.calls.cancelPick(); }
		return;
	}
	cardsState.state.sel = next;
	cardsState.state.squareFocus = null;
	const { ready } = cardsSelect.options(cardsState.state.sel, board);
	if (cardsState.state.sel.picks.length && cardsSelect.promotionPick(ready)) { cardsPrompts.startPromotion(ready); return; }
	if (ready.length === 1 && cardsState.state.sel.picks.length) { cardsPrompts.choose(ready[0]); return; }
	cardsState.calls.refreshTable();
}

/**
 * @description A left mouse press on a square (three/pointer/index.js onPointerDown), the drag's start. On
 * the player's turn, with no promotion cards out and no choice asked, one of the player's pieces that select.js pressPick gives
 * a pick for is picked as a click on it would be (its squares glow) and held: past the drag threshold it follows the pointer.
 * A piece with nothing to play isn't held, with no message. The click that follows a press that didn't drag picks the same
 * again (clickSquare): one pick
 * @param  {[string]} square ["e2"]
 */
export function pressSquare(square) {
	if (!cardsState.calls.yourMove() || cardsState.state.promoting || cardsPrompts.choosing()) { return; }
	const next = cardsSelect.pressPick(cardsState.state.sel, cards.legal, cards.view, square, cards.hidden);
	if (!next) { return; }
	pressedNew = !(cardsState.state.sel && cardsState.state.sel.picks.length === 1 && cardsState.state.sel.picks[0] === square);
	settle();
	cardsState.state.keyboard = false;
	cardsState.state.byMouse = true;
	cardsState.state.confirm = null; // as a click elsewhere: the skull's question goes
	cardsState.state.sel = next;
	cardsState.state.squareFocus = null;
	cardsState.state.dragFrom = square;
	holdTablePiece3D(square, true);
	cardsState.calls.refreshTable();
}

/**
 * @description The mouse let go of a held piece (three/pointer/index.js onPointerUp): it goes back to its square. Dragged onto one of
 * its pick's squares, that is a click on the square (clickSquare: one ready play is sent, a skull move asks first, a promotion
 * deals the cards, two forms of a square go to the prompt). Anywhere else a drag puts the piece and its card down (a click on a
 * square that isn't a target does too, clickSquare); a press that never dragged keeps the pick
 * @param  {[string|null]} square [the square a drag was let go on, null for none (off the board, on the glass or a card) or a
 * press that never dragged: its click follows]
 * @param  {[boolean]} dragged [the piece followed the pointer]
 */
export function releaseSquare(square, dragged = false) {
	const from = cardsState.state.dragFrom;
	cardsState.state.dragFrom = null;
	// sel.picks: not a pick the keys made meanwhile
	const onTarget = square && cardsState.state.sel && cardsState.state.sel.picks.length === 1 && cardsState.state.sel.picks[0] === from && cardsState.calls.yourMove() && !cardsState.state.promoting
		&& cardsSelect.pick(cardsState.state.sel, cards.view.board, square);
	if (!onTarget) {
		// Dragged and let go off its targets, its own square too: the piece and its card go down.
		// A press that never dragged keeps the pick, floating: its click follows
		if (dragged && from) {
			pressedNew = false;
			cardsState.calls.cancelPick();
		}
		else { hover(); }
		return;
	}
	dropTablePiece3D(square); // it lands on the target at once
	cardsState.state.keyboard = false;
	cardsState.state.dropped = from; // send's answer, or a pick given up, sends it home (settle)
	clickSquare(square, true);
}

// A dropped piece whose play wasn't made goes back to its square (given up, refused, no answer). A made move left its square:
// nothing there to put down, its slide ends it
export function settle() {
	if (!cardsState.state.dropped) { return; }
	holdTablePiece3D(cardsState.state.dropped, false);
	holdTablePiece3D(null);
	cardsState.state.dropped = null;
}

// The id of the piece on the dropped piece's square
export function droppedPieceId() {
	return cardsState.state.dropped && cards.view?.board.sq[sqIndex(cardsState.state.dropped)]?.id;
}
