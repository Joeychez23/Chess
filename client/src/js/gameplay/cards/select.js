/*
 *  select.js  --  chess frontend
 *	Chess Cards Select
 *	What the table lets the player pick, from the server's legal list (store.js cards.legal): the moves a lifted card
 *	allows, an active's targets, the move a piece picked directly spends a card on and the squares that glow while a play is
 *	picked. What a prompt's buttons say is in cards.labels.js, and the fog's blind moves are in cards.fog.js.
 *	It never decides what's legal: every play it offers is one of legal's. The one exception is Card Guy's Fog of War
 *	(legal_hidden: no moves listed), when a move card offers the engine's plain moves of its piece type on the board in
 *	sight (blindMoves) and the server refuses the ones that aren't legal.
 *	No DOM: the server tests require it (server/test/cards/cards-clientSelect.test.js).
 *
 */

// Square index <-> "e4", the engine's own (index 0 is a8)
const { sqName, sqIndex } = require("../../../../../cards-engine/board.js");
// The hand, the fog's blind moves, and the prompts' words, beside this file
const { PIECE_VALUE, CARD_MOVES, isCard, handCards, blindMoves, blindLastStand, cardlessUnderFog, placedPassives, blindPieceMoves } = require("./cards.fog.js");
const { PIECE_NAMES, promptPlays, label, promptFocus, promptButtons, plaquePrompt, asking, askedBy } = require("./cards.labels.js");

/* ---------------------------------------------------------------- */
// Cards
/* ---------------------------------------------------------------- */
/**
 * @description The legal moves that spend this card
 * @param  {[array]} legal [cards.legal]
 * @param  {[string]} cardId [a move card's id, or "king"]
 * @return {[array]} actions
 */
function movesForCard(legal, cardId) {
	return legal.filter((action) => action.type === "move" && action.card === cardId);
}

/**
 * @description The legal plays of an active, one per target (one with no target when it needs none)
 * @param  {[array]} legal [cards.legal]
 * @param  {[string]} cardId [the active's id]
 * @return {[array]} actions
 */
function targetsForActive(legal, cardId) {
	return legal.filter((action) => action.type === "active" && action.card === cardId);
}

/**
 * @description A piece picked with no card lifted: one legal move per destination (each promotion its own). The card it
 * spends is the first one legal names for it, so duplicate cards are interchangeable. A move that needs no card
 * (Heretical Subjection, Escape Artist, Retaliation) is taken first: it spends none.
 * @param  {[array]} legal [cards.legal]
 * @param  {[string]} fromSquare ["e2"]
 * @return {[array]} actions
 */
function shortcutFor(legal, fromSquare) {
	const moves = legal.filter((action) => action.type === "move" && action.from === fromSquare);
	const cardless = moves.filter((move) => move.card === null);
	const withCard = moves.filter((move) => move.card !== null);
	const shortcuts = [];
	for (const move of [...cardless, ...withCard]) {
		const isListed = shortcuts.some((kept) => kept.to === move.to && kept.promotion === move.promotion);
		if (!isListed) { shortcuts.push(move); }
	}
	return shortcuts;
}

/**
 * @description Whether the passive can go into Board Effects now
 * @param  {[array]} legal [cards.legal]
 * @return {[boolean]}
 */
function canPlace(legal) {
	return legal.some((action) => action.type === "passive");
}

/**
 * @description What a lifted card can do: its moves, its targets, placing the passive (then its reroll), paying a curse
 * off (a clear action), and the free discards it's in when legal lists them (buttons on its prompt)
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string]} cardId
 * @return {[array]} actions
 */
function actionsFor(legal, view, cardId) {
	const card = handCards(view).find((handCard) => handCard.id === cardId);
	if (!card) { return []; }
	// The passive: placing it, then its reroll
	if (card.kind === "passive") {
		return [...legal.filter((action) => action.type === "passive"), ...discardsFor(legal, view, cardId)];
	}
	return [...legal.filter((action) => action.card === cardId), ...discardsFor(legal, view, cardId)];
}

/**
 * @description The free discard of a hand card, one card at a time (a move card, an active, or the held passive: its
 * reroll): its own, when legal lists it. A button for the keys and a tap; the mouse drags the card to the discard pile
 * (dropPlay).
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string]} cardId
 * @return {[array]} actions
 */
function discardsFor(legal, view, cardId) {
	return legal.filter((action) => action.type === "discard" && action.cards.includes(cardId));
}

/**
 * @description The hand cards drawn dimmer: those with no play this turn but a discard (a dimmed card still lifts for its
 * discard). None under Card Guy's Fog of War (legal lists no move), and none when the player has no turn to play (Card
 * Guy's turn, a choice, a duel, the game over): the whole hand would dim and light again every turn.
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[boolean]} hidden [cards.hidden]
 * @return {[array]} ids
 */
function dimmed(legal, view, hidden) {
	if (hidden || !legal.some((action) => action.type !== "choice" && action.type !== "duel")) { return []; }
	const ids = [];
	for (const card of handCards(view)) {
		const plays = actionsFor(legal, view, card.id);
		if (!plays.some((action) => action.type !== "discard")) { ids.push(card.id); }
	}
	return ids;
}

/**
 * @description Whether a King-card move spends a King skull, as the engine decides it (turn/turn.move.js kingMoves): the king moves
 * past its own Frozen or Hexed (every move), or its Shaken (a capture). legal doesn't say (the action has no skull field,
 * the server works it out), so the view's statuses do. Under fog a capture of a hidden piece can't be seen: it reads as
 * free.
 * @param  {[object]} action
 * @param  {[object]} view [cards.view]
 * @return {[boolean]}
 */
function costsSkull(action, view) {
	if (action.type !== "move" || action.card !== "king") { return false; }
	const player = view.players[view.you] || {};
	const squares = view.board.sq;
	const king = squares.find((piece) => piece && piece.c === view.you && piece.t === "k");
	if (!king || !(player.kingSkulls > 0)) { return false; }
	const statuses = ((view.statuses || {})[king.id] || []).map((status) => status.s);
	const target = squares[sqIndex(action.to)];
	const isCapture = Boolean(target && target.c !== view.you);
	return statuses.includes("frozen") || statuses.includes("hexed") || (statuses.includes("shaken") && isCapture);
}

/* ---------------------------------------------------------------- */
// Picking
/* ---------------------------------------------------------------- */
// A pick in progress is { card, actions, picks }: the lifted card (null: a piece picked directly, or a choice), the plays
// still in reach and the squares picked so far.

/**
 * @description Lifts a card: the plays it can make. With no card (null) every legal action is in reach, for a choice.
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string|null]} cardId
 * @param  {[boolean]} hidden [cards.hidden: no move listed, a move card offers blindMoves]
 * @return {[object]} pick [{ card, actions, picks: [] }]
 */
function lift(legal, view, cardId, hidden = false) {
	if (cardId === null) { return { card: null, actions: legal.slice(), picks: [] }; }
	// A card duel is on: a hand card plays nothing, under fog too
	if (view.duel) { return { card: cardId, actions: [], picks: [] }; }
	const card = handCards(view).find((handCard) => handCard.id === cardId);
	// The free discards stay listed under fog
	const discards = discardsFor(legal, view, cardId);
	if (hidden && card && (card.kind === "king" || card.kind === "move")) {
		return { card: cardId, actions: [...blindMoves(view, card), ...discards], picks: [] };
	}
	if (hidden && card && isCard(card.key, "last-stand")) {
		return { card: cardId, actions: [...blindLastStand(view, card), ...discards], picks: [] };
	}
	return { card: cardId, actions: actionsFor(legal, view, cardId), picks: [] };
}

/**
 * @description A piece picked with nothing lifted: shortcutFor's moves from its square, or under fog blindPieceMoves
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string]} square ["e2"]
 * @param  {[boolean]} hidden [cards.hidden]
 * @return {[object|null]} pick [null when it can't move]
 */
function pickPiece(legal, view, square, hidden = false) {
	// A card duel is on: no piece is picked up, under fog too
	if (view.duel) { return null; }
	const actions = hidden ? blindPieceMoves(view, square) : shortcutFor(legal, square);
	return actions.length ? { card: null, actions, picks: [square] } : null;
}

/**
 * @description The squares the player clicks to make a play, in order: a move's from and to; an active target's piece,
 * square, pieces or king move; a choice's piece. A play with none (no target, a curse to clear, a card to choose) is made
 * from a prompt's button.
 * @param  {[object]} action
 * @param  {[object]} board [cards.view.board]
 * @return {[array]} squares
 */
function squaresOf(action, board) {
	if (action.type === "move") { return [action.from, action.to]; }
	if (action.type === "choice") {
		const square = typeof action.option === "string" ? squareOf(board, action.option) : null;
		return square ? [square] : [];
	}
	const target = action.type === "active" ? action.target : null;
	if (!target) { return []; }
	if (target.move) { return [target.move.from, target.move.to]; }
	if (Array.isArray(target.pieces)) { return target.pieces.map((id) => squareOf(board, id)).filter(Boolean); }
	if (target.square) { return [target.square]; }
	if (target.piece) {
		const square = squareOf(board, target.piece);
		return square ? [square] : [];
	}
	return [];
}

// The square of the piece with this id, null when it isn't on the board (taken, or hidden by fog)
function squareOf(board, id) {
	const index = board.sq.findIndex((piece) => piece && piece.id === id);
	return index < 0 ? null : sqName(index);
}

/**
 * @description Where a pick stands: the squares that glow (the next square of every play still in reach) and the plays
 * whose squares are all picked. One ready play is sent; several are chosen on a prompt; with no square picked, a button
 * plays it, or a second click on the card for an active with no target.
 * @param  {[object]} pick [lift, pickPiece or pick's]
 * @param  {[object]} board [cards.view.board]
 * @return {[object]} { glow: squares, sorted, ready: actions }
 */
function options(pick, board) {
	const open = pick.actions.filter((action) => fits(action, pick.picks, board));
	const ready = open.filter((action) => squaresOf(action, board).length === pick.picks.length);
	const waiting = open.filter((action) => !ready.includes(action));
	const glow = [...new Set(waiting.flatMap((action) => nextSquares(action, pick.picks, board)))].sort();
	return { glow, ready };
}

// Whether the squares picked so far lead to this play
function fits(action, picks, board) {
	const squares = squaresOf(action, board);
	if (picks.length > squares.length) { return false; }
	if (isUnordered(action)) {
		// A Swap's piece picked twice is no swap
		return new Set(picks).size === picks.length && picks.every((square) => squares.includes(square));
	}
	return picks.every((square, index) => squares[index] === square);
}

// Swap: its two pieces are picked in either order
function isUnordered(action) {
	return action.type === "active" && Boolean(action.target) && Array.isArray(action.target.pieces);
}

// The squares that carry a play on: a Swap's pieces not picked yet, else the next square in order
function nextSquares(action, picks, board) {
	const squares = squaresOf(action, board);
	return isUnordered(action) ? squares.filter((square) => !picks.includes(square)) : [squares[picks.length]];
}

/**
 * @description Picks one more square
 * @param  {[object]} selection [the pick so far]
 * @param  {[object]} board [cards.view.board]
 * @param  {[string]} square ["e4"]
 * @return {[object|null]} pick [null when no play goes through that square]
 */
function pick(selection, board, square) {
	const picks = [...selection.picks, square];
	return selection.actions.some((action) => fits(action, picks, board)) ? { ...selection, picks } : null;
}

/**
 * @description A left mouse press on a square (flow.js pressSquare, the drag's start): the pick a click on it would give
 * (flow.js clickSquare: one of the lifted card's pieces through that card, else the piece picked directly, a card of its
 * type spent), when the square holds one of the player's pieces and that pick has squares to be dragged to. null leaves
 * the press to the click: a piece with nothing to play, the next square of the play being picked (a Swap's second piece),
 * or a piece that is itself the play (an active's target).
 * @param  {[object|null]} selection [the play being picked, null for none]
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string]} square ["e2"]
 * @param  {[boolean]} hidden [cards.hidden]
 * @return {[object|null]} pick [the piece is held with it]
 */
function pressPick(selection, legal, view, square, hidden = false) {
	const board = view.board;
	const piece = board.sq[sqIndex(square)];
	if (!piece || piece.c !== view.you) { return null; }
	const through = selection ? pick(selection, board, square) : null;
	// The play being picked goes on through this square: that's the click's
	if (through && selection.picks.length) { return null; }
	// A lifted card part picked: this piece starts that card's pick again
	const isPartPicked = Boolean(selection && selection.card !== null && selection.picks.length);
	const restarted = isPartPicked ? pick({ ...selection, picks: [] }, board, square) : null;
	const next = through || restarted || pickPiece(legal, view, square, hidden);
	if (!next) { return null; }
	const { glow, ready } = options(next, board);
	return glow.length && !ready.length ? next : null;
}

/**
 * @description Whether the plays ready are one move's promotions (the same from and to): the 3D promotion cards choose
 * the piece, as in a normal game
 * @param  {[array]} ready [options().ready]
 * @return {[boolean]}
 */
function promotionPick(ready) {
	const [first] = ready;
	return ready.length > 1 && ready.every((action) => action.type === "move"
		&& Boolean(action.promotion)
		&& action.from === first.from
		&& action.to === first.to);
}

/**
 * @description What a card dragged with the mouse and let go over a place of the desk plays (flow.js dropCard).
 * - A hand card on the player's discard pile: its own free discard.
 * - An active on their active spot: played at once when it has one play with no target, else its targets are picked
 *   next (its plays without its discard).
 * - The held passive on their passive pile: placed.
 * - One of the player's placed cards (an opened pile's) on their discard pile: its drop.
 * Only what legal lists (under fog Last Stand's blind plays too, as lift); anything else puts the card back.
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[object]} drag [{ from: "hand" | "pile", id }: the card dragged, from the hand or from an opened pile]
 * @param  {[object|null]} place [where it was let go (three/cardTable/tableLayout.js placeAt):
 * { side: "mine" | "his", place: "spot" | "passive" | "discard" }, null for nowhere]
 * @param  {[boolean]} hidden [cards.hidden]
 * @return {[object|null]} play [{ action }: sent, { pick }: the play being picked from here on, null: the card goes back]
 */
function dropPlay(legal, view, drag, place, hidden = false) {
	if (!place || place.side !== "mine") { return null; }
	if (drag.from === "pile") {
		return asPlay(place.place === "discard" && legal.find((action) => action.type === "drop" && action.card === drag.id));
	}
	const card = handCards(view).find((handCard) => handCard.id === drag.id);
	if (!card) { return null; }
	if (place.place === "discard") {
		return asPlay(legal.find((action) => action.type === "discard" && action.cards.length === 1 && action.cards[0] === card.id));
	}
	if (place.place === "passive") {
		return asPlay(card.kind === "passive" && legal.find((action) => action.type === "passive"));
	}
	if (card.kind !== "active") { return null; }
	const targets = lift(legal, view, card.id, hidden).actions.filter((action) => action.type === "active");
	const selection = { card: card.id, actions: targets, picks: [] };
	if (!selection.actions.length) { return null; }
	const { glow, ready } = options(selection, view.board);
	return !glow.length && ready.length === 1 ? { action: ready[0] } : { pick: selection };
}

// A play found is sent; none puts the card back
function asPlay(action) {
	return action ? { action } : null;
}

/**
 * @description The drops the keys and a tap offer as buttons for the player's own opened pile (the mouse drags the card
 * to the discard pile, dropPlay): one per card of it whose drop legal lists. Never one of Card Guy's cards, whatever
 * legal says.
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string]} pile [the opened pile, a key of three/cardTable/tableLayout.js PILES: only "mine" (the passives waiting) and
 * "mineSpot" (the actives in effect) hold the player's cards]
 * @param  {[string|null]} id [only this card's (a tap on it), null: every card's (Enter on the pile)]
 * @return {[array]} actions [{ type: "drop", card }]
 */
function pileDrops(legal, view, pile, id = null) {
	const drops = [];
	for (const card of ownPileCards(view, pile)) {
		if (card.down || card.id === undefined || (id !== null && card.id !== id)) { continue; }
		const drop = legal.find((action) => action.type === "drop" && action.card === card.id);
		if (drop) { drops.push(drop); }
	}
	return drops;
}

// The player's own cards in an opened pile
function ownPileCards(view, pile) {
	if (pile === "mine") { return placedPassives(view); }
	if (pile === "mineSpot") { return ((view.players[view.you] || {}).spot || []).filter(Boolean); }
	return [];
}

/**
 * @description The keyboard's stops, in order: the hand, then the player's pieces with a move that needs no card, then
 * the piles. While a card duel is on: only the duel cards legal lets the player pick.
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[boolean]} hidden [cards.hidden]
 * @return {[array]} [{ kind: "hand", id } | { kind: "square", square } | { kind: "pile", pile } | { kind: "duel", index }]
 */
function focusList(legal, view, hidden) {
	if (view.duel) {
		const duelPicks = legal.filter((action) => action.type === "duel" && Number.isInteger(action.pick));
		return duelPicks.map((action) => ({ kind: "duel", index: action.pick }));
	}
	const hand = handCards(view).map((card) => ({ kind: "hand", id: card.id }));
	const squares = cardlessSquares(legal, view, hidden).sort().map((square) => ({ kind: "square", square }));
	const piles = focusPiles(view).map((pile) => ({ kind: "pile", pile }));
	return [...hand, ...squares, ...piles];
}

// The squares of the player's pieces with a move that needs no card: cardless in legal, or under fog those
// cardlessUnderFog covers
function cardlessSquares(legal, view, hidden) {
	if (!hidden) {
		const cardless = legal.filter((action) => action.type === "move" && action.card === null);
		return [...new Set(cardless.map((action) => action.from))];
	}
	const squares = [];
	for (const [index, piece] of view.board.sq.entries()) {
		if (piece && piece.c === view.you && cardlessUnderFog(view, piece)) { squares.push(sqName(index)); }
	}
	return squares;
}

// Each Board Effects pile that holds a card ("mine" first), then each active spot that holds one ("mineSpot",
// "hisSpot"; they open as the piles do), then the discard list once it holds one ("discard", opened from either
// discard pile)
function focusPiles(view) {
	const me = view.you;
	const opp = me === "w" ? "b" : "w";
	const piles = [];
	for (const [pile, owner] of [["mine", me], ["his", opp]]) {
		if ((view.effects || []).some((effect) => effect && effect.owner === owner && effect.card)) { piles.push(pile); }
	}
	for (const [pile, owner] of [["mineSpot", me], ["hisSpot", opp]]) {
		if (((view.players[owner] || {}).spot || []).length) { piles.push(pile); }
	}
	if ((view.piled || []).length) { piles.push("discard"); }
	return piles;
}

/**
 * @description The arrows step through a list (the hand, or the squares that glow) and stop at its ends. Nothing
 * focused yet: the first.
 * @param  {[number]} count [the list's length]
 * @param  {[number|null]} index [the focused one]
 * @param  {[string]} key [a KeyboardEvent.key]
 * @return {[number|null]} index [null for an empty list; index itself for other keys]
 */
function stepFocus(count, index, key) {
	if (!count) { return null; }
	const isBack = key === "ArrowUp" || key === "ArrowLeft";
	const isOn = key === "ArrowDown" || key === "ArrowRight";
	if (!isBack && !isOn) { return index; }
	if (index === null || index === undefined) { return 0; }
	return Math.min(count - 1, Math.max(0, index + (isOn ? 1 : -1)));
}

/**
 * @description What a Chess Cards game's key does (cards/flow.js handKey). While the game is on, the arrows and Enter
 * never reach the page's nav, on the turn or off it: off it the arrows still step the hand's focus and Enter does
 * nothing. A focused button keeps Enter (Tab put it there: the menu stays reachable); an arrow takes the focus off it
 * first, as handleCardKey does. While the promotion cards are out only Escape is the hand's. A held key (repeat) does
 * nothing more.
 * @param  {[object]} keyState [{ key: a KeyboardEvent.key, repeat, on: a game loaded and not over, yours: the player
 * may pick (flow.js yourMove), button: a button or link has the focus, promoting: the promotion cards are out, picked:
 * a pick the player can put down, pile: a pile is opened (Escape closes it, on the turn or off it, once any pick is
 * down), zoomed: the camera is zoomed in on a hand card (Escape ends it as it closes a pile) }]
 * @return {[string]} plan ["page": the page has it (its nav, the focused button, handleCardKey), "stop": nobody, "hand":
 * the hand uses it, "blur": the focus leaves the button, then "hand"]
 */
function keyPlan({ key, repeat = false, on, yours, button = false, promoting = false, picked = false, pile = false, zoomed = false }) {
	if (!on) { return "page"; }
	// Nothing to put down, no pile to close and no zoom to end: the menu's Escape
	if (key === "Escape") { return (yours && picked) || pile || zoomed ? "hand" : "page"; }
	if (repeat) { return "stop"; }
	if (key === "Enter" && button) { return "page"; }
	// handleCardKey has the arrows and Enter
	if (promoting) { return "page"; }
	if (key === "Enter" && !yours) { return "stop"; }
	return button ? "blur" : "hand";
}

/**
 * @description Whether a click on a hand card zooms in on it to be read (an ability card: an active, the passive, a
 * curse) rather than lifting it to be played (a move card, the King card)
 * @param  {[string]} kind [handCards' kind]
 * @return {[boolean]}
 */
function zooms(kind) {
	return kind === "active" || kind === "passive" || kind === "curse";
}

/**
 * @description A hand card clicked, tapped or picked with the keys (flow.js clickCard). An ability card (zooms) clicked
 * or tapped is read, never lifted (no high lift, no readable copy), and the camera zooms in on it whoever's turn it is.
 * Not while an answer's steps play, a card duel is on or the promotion cards are out: the camera can't frame it then.
 * The keys' pick lifts as before.
 * @param  {[object]} click [{ kind: handCards' kind, keys: the keys picked it, showing: an answer's steps play (flow.js
 * showing), duel: a card duel is on, promoting: the promotion cards are out }]
 * @return {[object]} { read: it isn't lifted, zoom: the camera zooms in on it (three/pointer/index.js pickTable) }
 */
function handRead({ kind, keys, showing, duel, promoting }) {
	const read = zooms(kind) && !keys;
	return { read, zoom: read && !showing && !duel && !promoting };
}

/**
 * @description The hand card the table lifts (three/cardTable/ lift: the high lift and an ability card's readable
 * copy): the card being played, unless a click or tap picked it to be read (handRead); else the card the mouse let go on
 * one of the player's places while its targets are picked or its play is on its way (flow.js onPlace)
 * @param  {[object|null]} selection [the play being picked]
 * @param  {[string|null]} onPlace [flow.js onPlace]
 * @param  {[string|null]} read [the ability card a click or tap picked last, null for none]
 * @return {[string|null]} id
 */
function liftedCard(selection, onPlace, read) {
	const isRead = read && selection && selection.card === read;
	return selection && !isRead ? selection.card : onPlace;
}

module.exports = {
	asking,
	askedBy,
	movesForCard,
	targetsForActive,
	shortcutFor,
	canPlace,
	handCards,
	actionsFor,
	dimmed,
	costsSkull,
	blindMoves,
	lift,
	pickPiece,
	pressPick,
	squaresOf,
	options,
	pick,
	promotionPick,
	dropPlay,
	pileDrops,
	promptPlays,
	focusList,
	label,
	stepFocus,
	keyPlan,
	promptFocus,
	promptButtons,
	plaquePrompt,
	zooms,
	handRead,
	liftedCard,
	PIECE_NAMES,
	PIECE_VALUE,
	CARD_MOVES,
};
