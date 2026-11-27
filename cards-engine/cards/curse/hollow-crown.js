/*
 *  hollow-crown.js  --  chess cards engine
 *	Curse: your King card stops being permanent: random discards, forfeits, Pickpocket and Bleeding Hand can take it. Without it you can't move your king (Escape Artist still can). A lost King card returns when the curse clears. Clear: discard 2 move cards.
 *
 */

const hand = require("../../hand.js");
const { baseKey } = require("../index.js");

module.exports = {
	key: "hollow-crown", kind: "curse", name: "Hollow Crown", rarity: "epic",
	text: "Your King card stops being permanent: random discards, forfeits, Pickpocket and Bleeding Hand can take it like any other card. Without it you can't move your king (Escape Artist still can). A lost King card returns when the curse clears. Clear: discard 2 move cards.",
	rules: {
		/**
		 * @description For its holder: a clear action { type: "clear", card: <this curse's id>, discard: [id, id] } for each pair of move cards they hold (an entered Mirage among them, as its holder sees them), in id order. While held, hand.kingCard puts the King card in the random-discard and Pickpocket pools.
		 */
		actions(state, player, acts, src) {
			if (player !== src.owner) return acts;
			const ids = hand.moveCards(state.players[player]).map((c) => c.id);
			return [...acts, ...ids.flatMap((a, i) => ids.slice(i + 1).map((b) => ({ type: "clear", card: src.card.id, discard: [a, b] })))];
		},
	},
	/**
	 * @description The clear action: both chosen move cards are discarded (discard events, no replacement draw), then the curse leaves through ctx.clearCurse. Uses the turn.
	 */
	act(ctx, player, a, src) {
		for (const id of a.discard) hand.discard(ctx, player, id);
		ctx.clearCurse(player, src.card);
	},
	on: {
		/**
		 * @description Its own clearing, by any path (its clear action, Cleanse, ...): a lost King card returns (Player.king), unless another Hollow Crown is still held.
		 */
		"curse-cleared"(ctx, owner) {
			const p = ctx.state.players[owner];
			if (!p.curses.some((c) => baseKey(c.key) === "hollow-crown")) p.king = true;
		},
	},
};
