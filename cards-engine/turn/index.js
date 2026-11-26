/*
 *  turn/index.js  --  chess cards engine
 *	The turn: the legal actions, resolving one, the free discard and the drops, the end of the turn (ticks, refill),
 *	the start of the next (passive roll, automatic redraw) and the end of the game.
 *
 */

const { makeMove } = require("../movegen.js");
const { pieceById, sqName } = require("../board.js");
const { inCheck, legalMoves } = require("../rules.js");
const hand = require("../hand.js");
const { baseKey } = require("../cards/index.js");
const { capture } = require("../ctx.js");
const duel = require("../duel.js");
const { other, actionKey, barKey, sidesInCheck } = require("./turn.shared.js");
const { moveActions, kingMoves } = require("./turn.move.js");
const {
	PASSIVES, activeActions, canPlacePassive, freeDiscards, dropActions, cardAct, resolveDrop, resolveDiscard, placePassive,
	playActive,
} = require("./turn.cards.js");
const { turnActions, applyCardRules, isRouted } = require("./turn.actions.js");
const { PASSIVE_CHANCE, endTurn, startTurn, noAction, spendSkull, endGame } = require("./turn.end.js");
const { checkAfter, duelAct, resolveChoice } = require("./turn.choice.js");

/* ---------------------------------------------------------------- */
// The legal actions
/* ---------------------------------------------------------------- */

/**
 * @description Every action player may take now; empty when the game is over.
 * While a card duel is open (state.duel, no choice pending) both players get only duel.actions: their picks and the
 * stop-or-go decision. While a choice is pending, only the pending player gets actions: one { type: "choice", option }
 * per pending.options entry. In both, a barred action (Grace) is left out while another remains. Otherwise turnActions.
 */
function legalActions(state, player, blind) {
	const pending = state.pending;
	if (!state.result && !pending && state.duel) {
		const actions = duel.actions(state, player);
		// The bar is on the player whose turn it is: the key itself names no player
		const allowed = player === state.board.turn ? actions.filter((action) => actionKey(action) !== state.barred) : actions;
		return allowed.length ? allowed : actions;
	}
	if (state.result || !pending) return turnActions(state, player, blind);
	if (pending.player !== player) return [];
	// A choice saved with no options was rebuilt from the other player's view: it offers nothing
	const options = (pending.options || []).map((option) => ({ type: "choice", option }));
	const allowed = options.filter((action) => actionKey(action) !== state.barred);
	// A choice must be answered, so the barred option comes back when it is the only one
	return allowed.length ? allowed : options;
}

/**
 * @description True exactly when legalActions(state, player) holds action (compared by actionKey). It builds only
 * action.type's actions, narrowed by the action's card (and a move's from) where the builders allow: applyAction's
 * check. Outside the turn (a choice pending, a duel open, the game over, not player's turn) it asks legalActions, which
 * is cheap there. It relies on every card's rules.actions treating the list one action at a time (adding actions, or
 * dropping ones by their own shape), as all do now: a rule that looked at the whole list would need the full list.
 * Pure.
 */
function isLegal(state, player, action) {
	const outsideTurn = !action || typeof action !== "object" || state.result || state.pending || state.duel
		|| player !== state.board.turn;
	if (outsideTurn) {
		const key = actionKey(action);
		return legalActions(state, player).some((offered) => actionKey(offered) === key);
	}
	const multi = !!(state.multi && state.multi.player === player);
	const open = !multi || state.multi.mulled;
	const checked = inCheck(state, player);
	let built = [];
	if (action.type === "move") built = moveActions(state, player, action);
	else if (action.type === "active" && !multi) built = activeActions(state, player, action);
	else if (action.type === "passive" && !multi && !checked) {
		if (canPlacePassive(state, player)) built = [{ type: "passive" }];
	} else if (action.type === "discard" && !checked && open) built = freeDiscards(state, player);
	else if (action.type === "drop" && open) built = dropActions(state, player, false, action.card);
	// A card-defined type builds nothing here: only the cards' rules can add it
	return applyCardRules(state, player, built, multi, actionKey(action)).length > 0;
}

/* ---------------------------------------------------------------- */
// Resolving an action
/* ---------------------------------------------------------------- */

/**
 * @description Resolve a legal action for player on ctx.state, then end the turn, unless the game ended or a two-move
 * turn goes on (after a move, or after an active that set state.multi for player with a move to make).
 * - A choice goes to resolveChoice, a duel action to duelAct.
 * - A drop (dropActions) and the free discard (resolveDiscard) keep the turn; with no card action left the automatic
 *   redraw runs now (noAction).
 * - A passive placed with PASSIVES already waiting replaces the player's oldest (placePassive).
 * - After an active or a card-defined action, a check event when the opponent is in check and the action emitted none
 *   (checkAfter). An active that opens a card duel holds the turn until the duel is over. After Mulligan
 *   (state.multi.mulled) with no move, the automatic redraw.
 * - A choice asked during the action holds the end of the turn: pending.end (and resetHalf) record it, and the choice
 *   action runs it once choice.resolve has run.
 */
function act(ctx, player, action) {
	const state = ctx.state;
	// The checks standing before this action were already announced: startTurn doesn't say them again
	ctx.stood = sidesInCheck(state);
	if (action.type === "choice") return resolveChoice(ctx, action.option);
	if (action.type === "duel") return duelAct(ctx, player, action);
	if (action.type === "drop") {
		resolveDrop(ctx, player, action);
		// Free, like the free discard: the turn goes on
		return void noAction(ctx, player);
	}
	if (action.type === "discard") {
		resolveDiscard(ctx, player, action);
		// The turn goes on. With no card action left the automatic redraw runs now, and still none is a stalemate
		// (never in check here)
		return void noAction(ctx, player);
	}
	if (action.type === "passive") placePassive(ctx, player);
	else if (action.type === "active") {
		const from = ctx.events.length;
		playActive(ctx, player, action);
		checkAfter(ctx, player, from);
		// All or Nothing started a card duel: it holds the turn, and the duel action that ends the duel ends the turn (duelAct)
		if (state.duel) return;
		// More than a question: on the Mulligan path this can redraw the hand and end the game
		if (activeStartedTwoMoveTurn(ctx, player)) {
			// The active captured or moved a pawn before the moves
			if (ctx.resetHalf) state.board.half = 0;
			return;
		}
	} else if (action.type === "move" && !isRouted(state, player, action)) {
		if (resolveMove(ctx, player, action)) {
			// A trigger captured during the first move of a two-move turn
			if (ctx.resetHalf) state.board.half = 0;
			return;
		}
	} else {
		// A card-defined action, or a move under a card's own id: it uses the turn like an active
		const from = ctx.events.length;
		cardAct(ctx, player, action);
		checkAfter(ctx, player, from);
	}
	// The turn ends after the choice is answered
	if (state.pending) return void Object.assign(state.pending, { end: true, resetHalf: ctx.resetHalf });
	if (!state.result) endTurn(ctx, player);
}

/**
 * @description After an active: true when it started a two-move turn for player with a move to make, so the turn goes
 * on. After Mulligan (multi.mulled) this asks noAction instead: with no move left the automatic redraw runs, and still
 * none is a stalemate.
 */
function activeStartedTwoMoveTurn(ctx, player) {
	const multi = ctx.state.multi;
	if (!(multi && multi.player === player && multi.left > 0)) return false;
	if (multi.mulled) return !noAction(ctx, player);
	return !!turnActions(ctx.state, player).length;
}

/**
 * @description Resolve a move action: spend the card, move, then capture, promotion and check. No card is spent for
 * the King card or a cardless move (card null); a King-card move marked skull spends a King skull as part of the move.
 * The move, capture and promote events go out in that order and their triggers run once all of it is applied, so no
 * handler sees a half-applied move; check is decided after those triggers, then emitted. A King-card move marked skull
 * clears the king's statuses and spends the skull after the move's own events (move, capture, promote, status-ended,
 * king-skull), inside the held triggers.
 * Returns true when a two-move turn goes on (twoMoveTurnGoesOn).
 */
function resolveMove(ctx, player, action) {
	const state = ctx.state, holder = state.players[player];
	// The King card's moves are kingMoves'; a cardless move is its piece's own
	const moveCard = action.card === "king" || action.card === null ? null : holder.moves.find((heldCard) => heldCard.id === action.card);
	const isThisMove = (mv) => mv.from === action.from && mv.to === action.to && mv.promotion === action.promotion
		&& (action.card === "king" ? mv.t === "k" : !moveCard || hand.fits(moveCard.piece, mv.t));
	const mv = action.card === "king" ? kingMoves(state, player).find(isThisMove) : legalMoves(state, player).find(isThisMove);
	const card = action.card === "king" || action.card === null ? action.card : hand.take(holder, action.card);
	if (card && card !== "king") {
		// Played: to the discard pile, face down under the mover's fog (view.js hides the card of a fogged move)
		const fogged = state.enchant.some((entry) => baseKey(entry.key) === "fog-of-war" && entry.owner === player);
		hand.toPile(state, player, card, fogged);
	}
	const victimIndex = mv.capture ? pieceById(state.board, mv.capture) : -1;
	const victim = victimIndex < 0 ? null : state.board.sq[victimIndex];
	// Where the victim stood (en passant: the pawn's square, not the move's to)
	const victimSquare = sqName(victimIndex);
	state.board = makeMove(state.board, mv);
	const moveEvent = { type: "move", player, card, piece: mv.piece, from: mv.from, to: mv.to };
	if (mv.castle) moveEvent.castle = mv.castle;
	// A castle that only castleThroughCheck allowed (rules.legalMoves)
	if (mv.through) moveEvent.through = true;
	if (victim && victim.t === "k") {
		// A king left in check on its owner's opponent's turn: taking it wins, and nothing else resolves
		state.players[victim.c].captured.push("k");
		delete state.statuses[victim.id];
		ctx.events.push(moveEvent, { type: "capture", player, piece: victim.id, t: "k", c: victim.c, by: mv.piece, sq: victimSquare });
		if (mv.promotion) ctx.events.push({ type: "promote", player, piece: mv.piece, t: mv.promotion });
		endGame(ctx, player, "king");
		return false;
	}
	// The events go out now, their triggers once the move is whole
	ctx.held = [];
	ctx.emit(moveEvent);
	if (victim) {
		capture(ctx, player, victim, mv.piece, victimSquare);
		// makeMove already reset half for its own capture
		ctx.resetHalf = false;
	}
	if (mv.promotion) ctx.emit({ type: "promote", player, piece: mv.piece, t: mv.promotion });
	// Past the king's own statuses: part of the move, so its events are held too
	if (mv.skull) spendSkull(ctx, player, "status");
	const held = ctx.held;
	ctx.held = null;
	for (const event of held) ctx.trigger(event);
	// After the triggers, so the check event and the two-move decision are true
	const opponent = other(player);
	const gaveCheck = inCheck(state, opponent);
	if (gaveCheck) ctx.emit({ type: "check", player: opponent });
	// A trigger left the mover in check (a shield taken by a guard, Overwatch): said now, also inside a two-move turn
	if (inCheck(state, player)) ctx.emit({ type: "check", player });
	return twoMoveTurnGoesOn(ctx, player, mv, gaveCheck);
}

/**
 * @description After a move in player's two-move turn: true when the turn goes on (a further move is in
 * legalActions). Then the position isn't kept in history and full isn't counted yet.
 * A first move that gives check ends the two-move turn when the mover has a second move and the checked player has a
 * King skull (spent, why "double-move"). With no second move the turn ends anyway and no skull is spent. With no skull
 * it goes on, and the second move may take the king (reason "king").
 */
function twoMoveTurnGoesOn(ctx, player, mv, gaveCheck) {
	const state = ctx.state, multi = state.multi, opponent = other(player);
	if (!multi || multi.player !== player) return false;
	multi.left--;
	multi.moved.push(mv.piece);
	if (multi.left <= 0) return false;
	// Try the turn going on: undo makeMove's handover
	state.board.turn = player;
	if (!turnActions(state, player).length) {
		// No further move: the turn ends on this position, and no skull is spent
		state.board.turn = opponent;
		return false;
	}
	// The checked player's skull ends the two-move turn. Without one, or without the King card (Hollow Crown), the
	// second move may take the king
	const checkedPlayer = state.players[opponent];
	if (gaveCheck && checkedPlayer.king && checkedPlayer.kingSkulls > 0) {
		state.board.turn = opponent;
		spendSkull(ctx, opponent, "double-move");
		return false;
	}
	// Only end-of-turn positions count for repetition
	state.board.history.pop();
	if (player === "b") state.board.full--;
	return true;
}

module.exports = { PASSIVE_CHANCE, PASSIVES, actionKey, barKey, legalActions, isLegal, act, endTurn, startTurn, noAction };
