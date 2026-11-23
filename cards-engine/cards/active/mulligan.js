/*
 *  mulligan.js  --  chess cards engine
 *	Active: discard your move cards and draw new ones, then move.
 *
 */

const { inCheck } = require("../../rules.js");

module.exports = {
	key: "mulligan", kind: "active", name: "Mulligan", skulls: 0, rarity: "uncommon",
	text: "Discard your move cards and draw new ones, then move.",
	/**
	 * @description No target; needs a move card (an entered Mirage counts: its holder sees a move card); never in check (a random outcome).
	 */
	targets: (state, player) => (require("../../hand.js").moveCards(state.players[player]).length && !inCheck(state, player) ? [null] : []), // LAZY hand.js: SEE shackles.js
	/**
	 * @description Every move card discarded, by id (a discard event each; an entered Mirage among them, in disguise to its holder: the curse stays), then as many new move cards drawn, then the Mirage takes over one random move card in the hand, its id and piece type, with no event (hand.throwMoves, hand.drawMoves). The turn goes on to one move (user ruling 2026-11-21): a one-move two-move turn marked mulled, so the free discard stays open (turn.js turnActions) and no move is the automatic redraw (turn.js act).
	 */
	play(ctx, player) {
		const hand = require("../../hand.js"), { out, ms } = hand.throwMoves(ctx.state, player);
		for (const card of out) ctx.emit({ type: "discard", player, card });
		hand.drawMoves(ctx, player, out.length, ms);
		ctx.state.multi = { player, left: 1, moved: [], differ: false, mulled: true };
	},
};
