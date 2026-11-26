/*
 *  turn.actions.js  --  chess cards engine
 *	The turn's actions: what the turn builds, then the cards in play change the list and what they added is checked.
 *
 */

const { sqIndex } = require("../board.js");
const { inCheck, legalMoves, rulesInPlay } = require("../rules.js");
const statuses = require("../statuses.js");
const hand = require("../hand.js");
const { actionKey, barKey, trialCtx } = require("./turn.shared.js");
const { moveActions, alreadyMoved, kingMoves } = require("./turn.move.js");
const { activeActions, canPlacePassive, freeDiscards, dropActions, sourceOf, cardAct } = require("./turn.cards.js");

// The action types the engine resolves itself. "choice" and "duel" are reserved: no card may define them
const BUILT_IN = ["move", "active", "passive", "discard", "drop", "choice", "duel"];

/**
 * @description The turn's actions for player, ignoring a pending choice; empty when the game is over or it isn't
 * player's turn. In a two-move turn only moves. In check no free discard and no passive. The drops (dropActions) come
 * outside a two-move turn, in check too; the free discard and the drops stay open after Mulligan. Then the cards in
 * play change the list and what they added is checked (applyCardRules), and the barred action is left out.
 */
function turnActions(state, player, blind) {
	if (state.result || player !== state.board.turn) return [];
	const actions = [...moveActions(state, player)];
	const multi = !!(state.multi && state.multi.player === player);
	const checked = inCheck(state, player);
	if (!multi) {
		actions.push(...activeActions(state, player));
		if (!checked && canPlacePassive(state, player)) actions.push({ type: "passive" });
	}
	// The free discard and the drops come before the play, so they are also open before Mulligan's one move
	if (!checked && (!multi || state.multi.mulled)) actions.push(...freeDiscards(state, player));
	if (!multi || state.multi.mulled) actions.push(...dropActions(state, player, blind));
	return applyCardRules(state, player, actions, multi);
}

/**
 * @description The last step on the actions the turn built: every card in play with rules.actions(state, player,
 * actions, src) changes the list (rules.rulesInPlay order: placed passives, held curses, enchantments), what the cards
 * added is checked (isSoundAction), and the barred action is left out. want (isLegal): keep only the action with that
 * actionKey, before the checks, so no other added action is tried.
 */
function applyCardRules(state, player, actions, multi, want) {
	const built = new Set(actions.map(actionKey));
	for (const [rule, src] of rulesInPlay(state)) if (rule.actions) actions = rule.actions(state, player, actions, src);
	const kept = [];
	for (const action of actions) {
		if (want !== undefined && actionKey(action) !== want) continue;
		if (!isSoundAction(state, player, action, built, multi)) continue;
		// Barred by the exact key, or a move by its shape (barKey)
		if (state.barred && (actionKey(action) === state.barred || barKey(action) === state.barred)) continue;
		kept.push(action);
	}
	return kept;
}

/**
 * @description True when an action in the list is one the turn built, or a sound one a card added. An added active,
 * passive, discard or drop is not. An added move stays only when addedMoveOk, and one routed to a card's act also only
 * when, tried on a copy, it leaves player's king out of check. A card-defined action (a type not in BUILT_IN, with
 * card: <held card id> or enchant: <player's enchantment id>) stays only when sourceOf finds its source, never in a
 * two-move turn, and only when, tried on a copy, it leaves player's king out of check.
 */
function isSoundAction(state, player, action, built, multi) {
	if (!action || typeof action !== "object") return false;
	if (built.has(actionKey(action))) return true;
	if (action.type === "move") {
		return addedMoveOk(state, player, action) && (!isRouted(state, player, action) || survivesTrial(state, player, action));
	}
	return !BUILT_IN.includes(action.type) && !multi && !!sourceOf(state, player, action) && survivesTrial(state, player, action);
}

/**
 * @description True when a move action a card added (whatever its card) is sound: player's own piece on from; its card
 * fits (the King card for the king, a held move card of that piece's type, null for cardless, else a held card with an
 * act); a move in rules.legalMoves for that piece, so it never leaves the own king in check unless it takes the enemy
 * king (which ends the game); not a Hexed piece when a move card moves it; in a two-move turn with differ, not a piece
 * already moved.
 */
function addedMoveOk(state, player, action) {
	const holder = state.players[player];
	const square = state.board.sq[sqIndex(typeof action.from === "string" ? action.from : "")];
	if (!square || square.c !== player) return false;
	const isThisMove = (mv) => mv.from === action.from && mv.to === action.to && mv.promotion === action.promotion;
	// kingMoves brings the King skull rules with it
	if (action.card === "king") return square.t === "k" && kingMoves(state, player).some(isThisMove);
	const moveCard = holder.moves.find((card) => card.id === action.card);
	if (moveCard ? !hand.fits(moveCard.piece, square.t) : action.card !== null && !sourceOf(state, player, action)) return false;
	const pieceMoves = legalMoves(state, player, (mv) => mv.piece === square.id
		&& !(moveCard && statuses.has(state, mv.piece, "hexed")) && !alreadyMoved(state, mv.piece));
	return pieceMoves.some(isThisMove);
}

/**
 * @description True when a move action's card is another card that resolves it (not the King card, not cardless, not
 * one of player's move cards): act sends it to that card's act.
 */
function isRouted(state, player, action) {
	return action.card !== "king" && action.card !== null && !state.players[player].moves.some((card) => card.id === action.card);
}

/**
 * @description True when the card-resolved action, tried on a copy, leaves player's king out of check.
 */
function survivesTrial(state, player, action) {
	const ctx = trialCtx(state);
	cardAct(ctx, player, action);
	return !inCheck(ctx.state, player);
}

module.exports = { turnActions, applyCardRules, isRouted };
