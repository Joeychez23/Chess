/*
 *  cardGuy.discard.js  --  chess server
 *	Card Guy: the free discard
 *  The card he drops for free before the search (freeDiscard), and the small measures the passives' swap and the
 *  turn use beside it (material, rarityRank).
 *
 */

const hand = require("../../../cards-engine/hand.js");
const { CARDS, RARITY_WEIGHTS, baseKey } = require("../../../cards-engine/cards/index.js");

/**
 * @description Card Guy's free discard, at every level, decided before the search: scored, a
 * 2-for-1 always loses to a move. First the active with no play this turn (not even paying a curse's clear) that is
 * common or uncommon and not Cleanse. Else a move card with no move this turn, the first in hand order (one card at a
 * time; the engine remembers it until the next one, which draws 1 back at random). Else none. Never the passive's
 * reroll: passiveSwap decides that before this
 * @param  {[array]} actions [the legal actions on Card Guy's guess]
 * @param  {[object]} player [Card Guy's player in that guess: its actives and move cards]
 * @return {[object]} a discard action, or null
 */
function freeDiscard(actions, player) {
	const discards = actions.filter((action) => action.type === "discard");
	const active = discards.find((discard) => {
		const id = discard.cards[0];
		return discard.cards.length === 1 && isDead(actions, id) && isCheapActive(player, id) && !paysACurse(actions, id);
	});
	if (active) {
		return active;
	}
	// The pair with the lowest draw-back floor, dropped by the owner on 2026-11-22 after a trial (the draw-back is
	// random again). Kept for reference:
	// const moves = hand.moveCards(player), floor = (a) => Math.min(...a.cards.map((id) => hand.PIECE_VALUE[moves.find((c) => c.id === id).piece]));
	// Pairs come in hand order, so this keeps the first of the lowest:
	// return discards.filter((a) => a.cards.length === 2 && a.cards.every(dead))
	// 	.reduce((best, a) => (!best || floor(a) < floor(best) ? a : best), null);
	// Move cards come in hand order: the first dead one (an entered Mirage is a move card in Card Guy's view)
	return discards.find((discard) => player.moves.some((card) => card.id === discard.cards[0]) && isDead(actions, discard.cards[0])) || null;
}

// A card with no play this turn other than its discard
function isDead(actions, id) {
	return !actions.some((action) => action.type !== "discard" && action.card === id);
}

// Rare and up, and Cleanse, are kept for later. Only an active: a one-card discard of the passive is the reroll,
// never taken here
function isCheapActive(player, id) {
	const key = (player.actives.find((card) => card.id === id) || {}).key;
	return !!CARDS[key] && ["common", "uncommon"].includes(CARDS[key].rarity) && baseKey(key) !== "cleanse";
}

// It can pay a curse's clear (Leech, Shackles), so it is not dead
function paysACurse(actions, id) {
	return actions.some((action) => action.type !== "discard" && action.discard === id);
}

// me's pieces less the other side's, by hand.PIECE_VALUE (a king counts 0)
function material(state, me) {
	return state.board.sq.reduce((sum, piece) => sum + (piece ? (piece.c === me ? 1 : -1) * (hand.PIECE_VALUE[piece.t] || 0) : 0), 0);
}

// RARITY_WEIGHTS lists the tiers from common up
function rarityRank(card) {
	return Object.keys(RARITY_WEIGHTS).indexOf(CARDS[card.key].rarity);
}

module.exports = { freeDiscard, material, rarityRank };
