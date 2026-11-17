/*
 *  shackles.js  --  chess cards engine
 *	Curse: your king can't castle. Clear: discard a card.
 *
 */

const { sqIndex } = require("../../board.js");

module.exports = {
	key: "shackles", kind: "curse", name: "Shackles", rarity: "common",
	text: "Your king can't castle. Clear: discard a card.",
	rules: {
		/**
		 * @description For its holder: no castling (a king move of two files), and a clear action { type: "clear", card: <this curse's id>, discard: <card id> } for each move card (an entered Mirage among them, by id, as its holder sees them) and active card they hold (the card they pay with).
		 */
		actions(state, player, acts, src) {
			if (player !== src.owner) return acts;
			const p = state.players[player], sq = state.board.sq;
			const castle = (a) => a.type === "move" && typeof a.from === "string" && typeof a.to === "string" && !!sq[sqIndex(a.from)] && sq[sqIndex(a.from)].t === "k" && Math.abs(a.from.charCodeAt(0) - a.to.charCodeAt(0)) === 2;
			return [...acts.filter((a) => !castle(a)), ...[...require("../../hand.js").moveCards(p), ...p.actives].map((c) => ({ type: "clear", card: src.card.id, discard: c.id }))]; // LAZY: A CARD FILE LOADED FROM cards/index.js WOULD GET hand.js HALF-LOADED
		},
	},
	/**
	 * @description The clear action: the chosen card is discarded (hand.discard: a discard event, no replacement draw; a Mirage paid with leaves as a curse too), then the curse leaves through ctx.clearCurse. Uses the turn.
	 */
	act(ctx, player, a, src) {
		require("../../hand.js").discard(ctx, player, a.discard);
		ctx.clearCurse(player, src.card);
	},
};
