/*
 *  turn.end.js  --  chess cards engine
 *	The end of a turn (ticks, refill), the start of the next (passive roll, lost turn), the no-action rule and the end of the game.
 *
 */

const { inCheck, boardDraw } = require("../rules.js");
const statuses = require("../statuses.js");
const hand = require("../hand.js");
const { other, trialCtx } = require("./turn.shared.js");
const { findKing } = require("./turn.move.js");
const { inEffect, resolveDrop } = require("./turn.cards.js");
const { turnActions } = require("./turn.actions.js");

const PASSIVE_CHANCE = 1 / 3;

/* ---------------------------------------------------------------- */
// The end and the start of a turn
/* ---------------------------------------------------------------- */

/**
 * @description End of color's turn: statuses tick, enchantments tick, refill, the actives whose effect is over leave
 * the active spots (sweepActiveSpots), the turn passes, then the other player's start of turn.
 * A turn with no move (active, passive, clear, switch) still hands the turn over and clears en passant, and sets
 * half = ctx.resetHalf ? 0 : half + 1, so the fifty-move rule keeps counting; it adds no position to history
 * (repetition counts positions reached by moves only). capture() sets ctx.resetHalf; an active that moves a pawn sets
 * ctx.resetHalf = true itself. The flag also holds on a turn with a move: a capture after the move ends the turn with
 * half 0, and an active that starts a two-move turn zeroes half before the moves.
 */
function endTurn(ctx, color) {
	const state = ctx.state, player = state.players[color];
	// A check lifted before the turn passes no longer counts as announced: if it comes back, startTurn names it
	ctx.stood = ctx.stood.filter((side) => inCheck(state, side));
	// What is given to color from here on (during the ticks and the refill's triggers) is not fresh: color's tick is
	// running or has run
	ctx.ticked = color;
	// The enchantments present when the tick starts: one given during the status tick is not ticked now
	const enchants = state.enchant.slice();
	statuses.tick(ctx, color);
	tickEnchant(ctx, color, enchants);
	// giveCurse's wait counts color's own turns
	if (player.curseWait > 0) player.curseWait--;
	hand.refill(ctx, color);
	sweepActiveSpots(ctx);
	// A passive that left this turn can be drawn again from the next
	player.gone = [];
	if (state.board.turn === color) {
		state.board.turn = other(color);
		state.board.ep = null;
		state.board.half = ctx.resetHalf ? 0 : state.board.half + 1;
		if (color === "b") state.board.full++;
	} else if (ctx.resetHalf) {
		// The move already handed the turn over: a capture made after it (a passive firing) still zeroes half
		state.board.half = 0;
	}
	state.ply++;
	state.barred = null;
	state.multi = null;
	// The free discard's kind and count belong to the turn
	state.discarded = null;
	startTurn(ctx, other(color));
}

/**
 * @description End of color's turn, after statuses: every timed enchantment color owns among enchants (those present
 * when the tick started) loses a turn and ends at 0 (endEnchant). A fresh one (given during this same turn) only loses
 * its fresh mark. left null never ends.
 */
function tickEnchant(ctx, color, enchants) {
	const state = ctx.state;
	for (const entry of enchants.filter((enchantment) => enchantment.owner === color && enchantment.left !== null)) {
		// Ended by an earlier one's event
		if (!state.enchant.includes(entry)) continue;
		if (entry.fresh) delete entry.fresh;
		else if (--entry.left <= 0) ctx.endEnchant(entry);
	}
}

/**
 * @description The actives whose effect is over leave their active spot for their owner's discard pile, a card-ended
 * event each (either player's; endTurn runs it): one with no enchantment of its own left (inEffect). So an active with
 * no lasting effect goes at the end of the turn it was played in.
 */
function sweepActiveSpots(ctx) {
	for (const color of ["w", "b"]) {
		const player = ctx.state.players[color];
		for (const [card, entry] of inEffect(ctx.state, color)) {
			if (entry) continue;
			player.spot = player.spot.filter((held) => held !== card);
			hand.toPile(ctx.state, color, card);
			ctx.emit({ type: "card-ended", player: color, card });
		}
	}
}

/**
 * @description Start of color's turn:
 * - a turn-start event (triggers run on it);
 * - the checks no event of this action named (announceChecks);
 * - a lost turn (loseTurn): lost, or void in check with a King skull;
 * - else the passive roll (from the second turn on, empty slot only);
 * - a just-started two-move turn with no move to make is dropped: a normal turn, so the actives are offered;
 * - no card action: the automatic redraw, and still none ends the game (noAction);
 * - then the board draws (repetition, fifty, material), even when plain chess has no move.
 */
function startTurn(ctx, color) {
	const state = ctx.state, player = state.players[color];
	ctx.turn = color;
	// A new turn
	ctx.resetHalf = false;
	ctx.emit({ type: "turn-start", player: color });
	if (state.result) return;
	announceChecks(ctx, color);
	if (player.lostTurns > 0 && loseTurn(ctx, color)) return;
	if (state.ply >= 2 && !player.passive && ctx.rng.next() < PASSIVE_CHANCE) hand.drawCard(ctx, color, "passive");
	// A turn-start effect (Debt, for one) took a just-started two-move turn's only move: it becomes a normal turn, so the
	// actives are offered (Four of a Kind stays spent, its debuff dropped)
	const multi = state.multi;
	if (multi && multi.player === color && !multi.moved.length && !turnActions(state, color).some((action) => action.type === "move")) {
		state.multi = null;
	}
	if (noAction(ctx, color)) return;
	// A card captured at the start of the turn
	if (ctx.resetHalf) state.board.half = 0;
	// Card mate and stalemate are decided above, from the hand
	const draw = boardDraw(state.board);
	if (draw) endGame(ctx, null, draw);
}

/**
 * @description A check event for each side in check that no check event of this action named: a check no move
 * announced (a trigger removed a shield, as Overwatch does; a status ended; a turn-start effect). Not for color when its
 * check already stood before this action began (ctx.stood, set by act): it was announced then. The side that just
 * played and is still in check is always named.
 */
function announceChecks(ctx, color) {
	for (const side of [other(color), color]) {
		if (!inCheck(ctx.state, side)) continue;
		if (side === color && (ctx.stood || []).includes(side)) continue;
		if (ctx.events.some((event) => event.type === "check" && event.player === side)) continue;
		ctx.emit({ type: "check", player: side });
	}
}

/**
 * @description color has a lost turn (lostTurns > 0): one is gone for good, lost or void. In check with a King skull
 * the skull is spent and the lost turn is void, so the turn is played: returns false. Else the turn is lost: a
 * turn-skipped event, then endTurn (ticks, refill, half + 1, play passes; no passive roll): returns true. A two-move
 * turn started at this turn start is dropped then, so its refill is the usual one.
 */
function loseTurn(ctx, color) {
	const state = ctx.state, player = state.players[color];
	player.lostTurns--;
	// No skull is spent while the King card is gone (Hollow Crown)
	if (player.king && player.kingSkulls > 0 && inCheck(state, color)) {
		spendSkull(ctx, color, "lost-turn");
		return false;
	}
	ctx.emit({ type: "turn-skipped", player: color });
	// Four of a Kind can start a two-move turn at a turn start whose lost turn was void and then lost again (Debt took
	// the King card: Hollow Crown). That turn is not played, so its debuff is dropped; the card stays spent
	if (state.multi && state.multi.player === color) state.multi = null;
	endTurn(ctx, color);
	return true;
}

/**
 * @description Spend one of player's King skulls (automatic, never a choice), with a king-skull event { player, left,
 * why }. why is one of:
 * - "status": the king moved past its own statuses. They are cleared with the move, and their status-ended events and
 *   this event come after the move's own move, capture and promote events.
 * - "lost-turn": a lost turn arriving in check is void.
 * - "double-move": the opponent's first move of a two-move turn gave check and they had a second move to make: that
 *   turn ends.
 */
function spendSkull(ctx, player, why) {
	const state = ctx.state, holder = state.players[player], king = findKing(state, player);
	if (why === "status") {
		for (const entry of [...(state.statuses[king.id] || [])]) statuses.clear(ctx, king.id, entry.s);
	}
	holder.kingSkulls--;
	ctx.emit({ type: "king-skull", player, left: holder.kingSkulls, why });
}

/**
 * @description The no-legal-action rule for color (startTurn; after a free discard or Mulligan; Grace after barring a
 * move). With no card action (cardActions), move cards are thrown out and a full hand is redrawn: as many as were thrown
 * out, and at least hand.HAND_MOVES (5; 6 while hand.big: Underdog), under the move-card cap of 9 and ignoring refillLock. Still none, and
 * no drop that, tried on a copy, itself leaves one: checkmate by the cards when in check, else stalemate. A drop that
 * opens nothing doesn't keep the game alive and buys no further redraw. Returns true when the game ended.
 */
function noAction(ctx, color) {
	const state = ctx.state;
	if (cardActions(state, color).length) return false;
	// An entered Mirage goes with them and comes back hidden among the draws
	const thrown = hand.throwMoves(state, color);
	ctx.emit({ type: "redraw", player: color });
	// hand.big adds one while Underdog's player is behind
	hand.drawMoves(ctx, color, Math.max(thrown.out.length, hand.HAND_MOVES + hand.big(state, color)), thrown.ms);
	if (cardActions(state, color).length) return false;
	// A drop that would leave a card action (a Stronghold on the only mobile piece) keeps the game going
	if (turnActions(state, color).some((action) => action.type === "drop" && dropOpensCardAction(state, color, action))) return false;
	const mate = inCheck(state, color);
	endGame(ctx, mate ? other(color) : null, mate ? "checkmate" : "stalemate");
	return true;
}

/**
 * @description color's card actions: moves (cardless ones count), actives and card-defined actions. A free discard, a
 * drop or placing a passive is not one.
 */
function cardActions(state, color) {
	return turnActions(state, color).filter((action) => action.type !== "passive" && action.type !== "discard" && action.type !== "drop");
}

/**
 * @description True when the drop, tried on a copy, itself leaves color a card action. Only what the drop opens
 * counts: no second redraw for a card that does nothing.
 */
function dropOpensCardAction(state, color, action) {
	const ctx = trialCtx(state);
	resolveDrop(ctx, color, action);
	return cardActions(ctx.state, color).length > 0;
}

/**
 * @description End the game: result { winner, reason } (winner null for a draw; reason "checkmate", "stalemate",
 * "repetition", "fifty", "material" or "king"), no pending choice, and a game-over event that no card hears (nothing
 * resolves after the game ends).
 */
function endGame(ctx, winner, reason) {
	ctx.state.result = { winner, reason };
	// No choice outlives the game
	ctx.state.pending = null;
	ctx.events.push({ type: "game-over", player: winner, winner, reason });
}

module.exports = { PASSIVE_CHANCE, endTurn, startTurn, noAction, spendSkull, endGame };
