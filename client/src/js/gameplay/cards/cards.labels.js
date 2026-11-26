/*
 *  cards.labels.js  --  chess frontend
 *	Chess Cards Labels
 *	What select.js's prompts offer and say: the plays a prompt shows as buttons, each button's words, the button the keys
 *	focus, whether the 3D view shows them as brass plaques, and whether the player is asked for an answer.
 *	No DOM, as select.js.
 *
 */

// Square index <-> "e4", the engine's own (index 0 is a8)
const { sqName } = require("../../../../../cards-engine/board.js");
const { isCard, handCards } = require("./cards.fog.js");

// A piece type's name, and a move card type's (m: the Knight / Bishop card)
const PIECE_NAMES = { p: "Pawn", n: "Knight", b: "Bishop", m: "Knight / Bishop", r: "Rook", q: "Queen", k: "King" };

function capital(text) {
	return String(text).charAt(0).toUpperCase() + String(text).slice(1);
}

/**
 * @description The plays a prompt offers as buttons. The mouse plays by dragging, so its prompt has no discard and no
 * placing, and an active's plays only once the card was dropped on the active spot (placed: its targets with no square)
 * or squares are picked (two plays on the same squares). A curse's clear and a move's two forms stay. The keys and a tap
 * keep every button.
 * @param  {[array]} plays [the plays ready (options().ready)]
 * @param  {[object]} how [{ mouse: the pick is the mouse's, picks: the squares picked so far, placed: the card lies on
 * the active spot }]
 * @return {[array]} plays
 */
function promptPlays(plays, { mouse = false, picks = 0, placed = false } = {}) {
	if (!mouse) { return plays; }
	const isActiveShown = picks > 0 || placed;
	return plays.filter((action) => action.type !== "discard" && action.type !== "passive" && (action.type !== "active" || isActiveShown));
}

/* ---------------------------------------------------------------- */
// Words
/* ---------------------------------------------------------------- */
/**
 * @description What a prompt's button says for a play
 * @param  {[object]} action
 * @param  {[object]} view [cards.view]
 * @param  {[object]} catalog [cards.catalog]
 * @param  {[object]} taken [the last card-taken event's card, flow.js keeps it: names Pickpocket's stolen card, null
 * when it isn't at hand (a reload)]
 * @return {[string]} label
 */
function label(action, view, catalog, taken = null) {
	switch (action.type) {
		case "move": return moveLabel(action);
		case "passive": return "Place in Board Effects (uses your turn)";
		case "drop": return dropLabel(action, view, catalog);
		case "discard": return discardLabel(action, view, catalog);
		case "clear": return clearLabel(action, view, catalog);
		case "choice": return choiceLabel(action, view, catalog, taken);
		case "active": return activeLabel(action, view, catalog);
		// A duel's pick is never a button: its card is clicked on the table
		case "duel": return action.stop ? "Stop" : "Continue";
		default: return capital(action.type);
	}
}

// A move names its squares, or the piece a promotion makes
function moveLabel(action) {
	const move = action.promotion ? PIECE_NAMES[action.promotion] : `${action.from} to ${action.to}`;
	return move + (action.card === null ? " without a card" : "");
}

// One of the player's placed cards: a passive waiting or an active in effect
function dropLabel(action, view, catalog) {
	const placed = [...(view.effects || []).map((effect) => effect && effect.card), ...((view.players[view.you] || {}).spot || [])];
	const card = placed.find((placedCard) => placedCard && placedCard.id === action.card);
	return `Discard your ${(card && catalog[card.key] && catalog[card.key].name) || "card"} from the table`;
}

// A free discard says what comes back for it
function discardLabel(action, view, catalog) {
	const hand = handCards(view);
	const held = action.cards.map((id) => hand.find((card) => card.id === id) || {});
	if (held[0].kind === "passive") { return `Reroll your ${cardName(view, catalog, action.cards[0]) || "passive"} (new passive now)`; }
	// A move card: the first is remembered, and its pair draws
	let back = "new one at turn end";
	if (held[0].kind === "move") {
		back = view.players[view.you].kept ? drawBack(held, view) : "the next one discarded draws 1";
	}
	const names = action.cards.map((id) => cardName(view, catalog, id) || "card");
	return `Discard your ${names.join(" & ")} (${back})`;
}

/**
 * @description What the second move card of a free discard's pair draws back (the first is remembered,
 * view.players[you].kept): one random card, or none for a bare king. The player's own pieces are in view.board under
 * fog too.
 * A floor was tried and dropped (the draw-back is random again); its label is kept below for reference. It read: "draw 1"
 * with a pawn in the pair (anything), else the lower card's own type, "draw a Rook or better" (two queens: "draw a
 * Queen"; a floor of 3 "draw a Knight / Bishop or better"). When the player had no piece worth more than that floor
 * (nothing better to draw, or nothing worth it: it drops) it named the most valuable card type they could still draw:
 * "draw a Knight / Bishop" with a knight or a bishop left.
 * @param  {[array]} pair [the 2 move cards, as handCards has them]
 * @param  {[object]} view [cards.view]
 * @return {[string]} words
 */
function drawBack(pair, view) {
	const best = view.board.sq.some((piece) => piece && piece.c === view.you && piece.t !== "k");
	return best ? "draw 1" : "no card back"; // A bare king draws none
	// THE DRAW-BACK FLOOR'S LABEL, DROPPED BY THE USER 2026-11-22 AFTER A TRIAL: THE DRAW-BACK IS RANDOM AGAIN. KEPT FOR REFERENCE:
	// const low = pair.reduce((a, b) => (PIECE_VALUE[b.piece] < PIECE_VALUE[a.piece] ? b : a)).piece, floor = PIECE_VALUE[low];
	// const own = Object.keys(CARD_MOVES).filter((t) => view.board.sq.some((p) => p && p.c === view.you && CARD_MOVES[t].includes(p.t))), best = Math.max(0, ...own.map((t) => PIECE_VALUE[t])); // THE CARD TYPES THE PLAYER CAN DRAW
	// if (!best) { return "no card back"; } // A BARE KING DRAWS NONE
	// if (!(floor > 1)) { return "draw 1"; } // A PAWN (OR A CARD THE VIEW DOESN'T NAME): ANYTHING
	// if (floor >= best) { return `draw a ${own.filter((t) => PIECE_VALUE[t] === best).map((t) => PIECE_NAMES[t]).join(" or ")}`; }
	// return `draw a ${PIECE_NAMES[low]} or better`; // TWO QUEENS ARE floor >= best: "draw a Queen"
}

// A curse paid off: by skipping this move, or with the cards it costs
function clearLabel(action, view, catalog) {
	if (action.discard === undefined) { return "Pay: skip this move"; }
	const names = [].concat(action.discard).map((id) => cardName(view, catalog, id) || "card");
	return `Pay with your ${names.join(" & ")}`;
}

// A choice's option: a piece, a card, a piece type, or a slot the player can't see
function choiceLabel(action, view, catalog, taken) {
	const option = action.option;
	if (typeof option !== "string") { return String(option); }
	const pending = view.pending;
	// Pickpocket's take-back: the card is in Card Guy's hidden hand now, only the card-taken event named it
	if (pending && pending.stolen === option) {
		const name = takenName(option, catalog, taken);
		return name ? `Your ${name} card` : "The card taken from you";
	}
	// The duel's first win: Knight or Bishop
	if (pending && isCard(pending.card, "all-or-nothing") && PIECE_NAMES[option]) { return PIECE_NAMES[option]; }
	const named = pieceAt(view.board, option) || (catalog[option] && catalog[option].name) || cardName(view, catalog, option);
	if (named) { return named; }
	// "?n": a slot for something the fog or a hidden hand keeps from the player (Opposing Finality's are pieces)
	if (option[0] === "?") {
		return pending && isCard(pending.card, "opposing-finality") ? "A hidden piece" : "A hidden card";
	}
	return option;
}

// The name of the card Pickpocket took, as the card-taken event told it; nothing when that event isn't at hand
function takenName(option, catalog, taken) {
	if (!taken || taken.id !== option) { return null; }
	if (taken.key === "move") { return PIECE_NAMES[taken.piece]; }
	return catalog[taken.key] && catalog[taken.key].name;
}

// An active's target
function activeLabel(action, view, catalog) {
	const target = action.target;
	const board = view.board;
	if (!target) { return "Play it"; }
	if (target.curses === "all") { return "Clear all your curses"; }
	if (target.t) { return PIECE_NAMES[target.t] || target.t; }
	if (target.s) { return `Remove ${capital(target.s)} from the ${pieceAt(board, target.piece) || "piece"}`; }
	if (target.mark) { return `Mark the ${pieceAt(board, target.mark) || "piece"}`; }
	if (target.enchant) {
		const enchantment = (view.enchant || []).find((placed) => placed.id === target.enchant);
		const name = (enchantment && catalog[enchantment.key] && catalog[enchantment.key].name) || "it";
		return `End ${name} on the ${pieceAt(board, target.piece) || "piece"}`;
	}
	if (target.move) { return `King to ${target.move.to}`; }
	if (target.square) { return target.square; }
	if (Array.isArray(target.pieces)) { return target.pieces.map((id) => pieceAt(board, id) || "a piece").join(" & "); }
	if (target.piece) { return pieceAt(board, target.piece) || "That piece"; }
	return "Play it";
}

// The piece with this id and its square ("Knight on f3"), null when it isn't on the board
function pieceAt(board, id) {
	const index = board.sq.findIndex((piece) => piece && piece.id === id);
	return index < 0 ? null : `${PIECE_NAMES[board.sq[index].t] || "Piece"} on ${sqName(index)}`;
}

// A card's name, from the player's hand or the opponent's cards shown to them; null when neither holds it
function cardName(view, catalog, id) {
	const opp = view.you === "w" ? "b" : "w";
	const shown = (view.players[opp] && view.players[opp].hand && view.players[opp].hand.shown) || [];
	const card = [...handCards(view), ...shown].find((known) => known.id === id);
	if (!card) { return null; }
	if (card.key === "move") { return `${PIECE_NAMES[card.piece] || "Move"} card`; }
	if (card.id === "king") { return "King card"; }
	return (catalog[card.key] && catalog[card.key].name) || "card";
}

/**
 * @description The prompt's button the keys focus: Cancel (after the plays) when the first play is a discard or a placed
 * card's drop, so Enter alone never discards a dimmed card or drops a card; else the first.
 * @param  {[array]} actions [the prompt's plays, its buttons in order; Cancel follows them]
 * @return {[number]} index [of the button]
 */
function promptFocus(actions) {
	return actions.length && (actions[0].type === "discard" || actions[0].type === "drop") ? actions.length : 0;
}

/**
 * @description A prompt's buttons in order, for the 2D prompt and the 3D plaques alike (flow.js showPrompt): one per play
 * (its label), or Play for a King move waiting on a King skull, and Cancel (not for a choice: it must be answered)
 * @param  {[object]} prompt [{ skull: the King move waiting (flow.js confirm) | null, pick: the prompt's plays, choosing:
 * a choice or the duel's Stop or Continue is asked }]
 * @param  {[object]} view [cards.view]
 * @param  {[object]} catalog [cards.catalog]
 * @param  {[object]} taken [as label's]
 * @return {[array]} [{ id: the plaque's, label, action: the play it sends (Play: the King move), null for Cancel }]
 */
function promptButtons({ skull = null, pick = [], choosing = false }, view, catalog, taken = null) {
	const buttons = skull
		? [{ label: "Play", action: skull }]
		: pick.map((action) => ({ label: label(action, view, catalog, taken), action }));
	if (skull || !choosing) { buttons.push({ label: "Cancel", action: null }); }
	// Not a hand card's id: a plaque is never grabbed as one
	return buttons.map((button, index) => ({ id: `b${index}`, ...button }));
}

/**
 * @description Whether the 3D view shows a prompt's buttons as brass plaques on the table, and by what:
 * - the card duel's Stop or Continue, and Knight or Bishop (the duel cards);
 * - a King move that costs a King skull (the king's square);
 * - a move's two forms under fog, with and without a card (the moving piece's square);
 * - a lifted card's free discards, a passive's place and reroll (the card).
 * Any other prompt keeps its 2D buttons.
 * @param  {[object]} prompt [{ skull, pick, choosing: as promptButtons', duel: a card duel is on, card: the lifted card's
 * id | null, hidden: cards.hidden (fog) }]
 * @return {[object|null]} at [{ duel: true } | { square } | { card } (tableLayout.js plaqueAnchor), null: the 2D buttons]
 */
function plaquePrompt({ skull = null, pick = [], choosing = false, duel = false, card = null, hidden = false }) {
	if (skull) { return { square: skull.from }; }
	if (choosing) { return duel ? { duel: true } : null; }
	// Only fog's two forms of one move (pickPiece): any other prompt of moves keeps its 2D box
	if (hidden && isTwoForms(pick)) {
		const [move] = pick;
		return { square: move.from };
	}
	if (card !== null && pick.length && pick.every((action) => action.type === "discard" || action.type === "passive")) { return { card }; }
	return null;
}

// One move offered twice, with and without a card
function isTwoForms(pick) {
	const [first] = pick;
	const isOneMove = pick.length > 1
		&& pick.every((action) => action.type === "move" && action.from === first.from && action.to === first.to && !action.promotion);
	return isOneMove && pick.some((action) => action.card === null) && pick.some((action) => action.card !== null);
}

/**
 * @description Whether the player is asked for an answer: every legal action is a choice's option, or a card duel's Stop
 * or Continue (step decide). The prompt's buttons are all of them, with no Cancel, and nothing else is picked meanwhile.
 * @param  {[array]} legal [cards.legal]
 * @return {[boolean]}
 */
function asking(legal) {
	return legal.length > 0 && legal.every((action) => action.type === "choice" || (action.type === "duel" && action.stop !== undefined));
}

/**
 * @description The key of the card a choice or the card duel's Stop or Continue is asked for (flow.js askingCard: the
 * prompt's title and border): while a duel is on, its own card (the version played), also for All or Nothing's Knight
 * or Bishop (the engine asks that with the base key); else the pending choice's card.
 * @param  {[object]} view [cards.view]
 * @return {[string|null]} key
 */
function askedBy(view) {
	const pending = view.pending;
	const duel = view.duel;
	if (duel && (!pending || pending.card === "all-or-nothing")) { return duel.card || null; }
	return (pending && pending.card) || null;
}

module.exports = {
	PIECE_NAMES,
	promptPlays,
	label,
	promptFocus,
	promptButtons,
	plaquePrompt,
	asking,
	askedBy,
};
