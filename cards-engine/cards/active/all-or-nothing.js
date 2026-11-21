/*
 *  all-or-nothing.js  --  chess cards engine
 *	Active: play the card duel (duel.js) to upgrade one of your pieces; a loss forfeits 6 random cards and the piece (epic version: the piece only; legendary version: the cards only).
 *
 */

const duel = require("../../duel.js");
const { inCheck } = require("../../rules.js");

/**
 * @description True when player's king is out of check with the piece of this id gone (the duel may take it).
 */
function safeToLose(state, player, id) {
	return !inCheck({ ...state, board: { ...state.board, sq: state.board.sq.map((q) => (q && q.id === id ? null : q)) } }, player);
}

const DUEL = "Play the card duel (core rules) to promote a non-queen, non-king piece: win once for Knight or Bishop, win again for Rook, win a third time for Queen. Steps that aren't an upgrade are skipped (a rook plays one hand for Queen). You may stop after any win. Debuff: ";

module.exports = {
	key: "all-or-nothing", kind: "active", name: "All or Nothing", skulls: 3, rarity: "rare",
	text: DUEL + "losing a hand forfeits 6 random cards and the piece being promoted.",
	/**
	 * @description { piece } for each of player's pieces but queens and kings whose loss wouldn't expose the own king; none in check (a random outcome).
	 */
	targets(state, player) {
		if (inCheck(state, player)) return []; // STATES THE RULE; activeActions' TRIAL ON A COPY WOULD DROP IT TOO
		return state.board.sq.filter((p) => p && p.c === player && p.t !== "q" && p.t !== "k" && safeToLose(state, player, p.id)).map((p) => ({ piece: p.id }));
	},
	/**
	 * @description Start the duel on the target piece; it holds the turn until it is over.
	 */
	play(ctx, player, target) {
		duel.start(ctx, player, target.piece, "all-or-nothing");
	},
	choice: {
		/**
		 * @description The first win's Knight or Bishop; the choice ends the turn only if the duel ended with it (the piece gone).
		 */
		resolve(ctx, pending, option) {
			if (duel.upgrade(ctx, option)) pending.end = true;
		},
	},
	versions: [
		{
			rarity: "epic", skulls: 2,
			text: DUEL + "losing a hand forfeits the piece being promoted but no cards.",
			/**
			 * @description Start the duel with the epic stakes (duel.result reads them from state.duel.card).
			 */
			play(ctx, player, target) {
				duel.start(ctx, player, target.piece, "all-or-nothing-epic");
			},
		},
		{
			rarity: "legendary", skulls: 2,
			text: DUEL + "losing a hand forfeits 6 random cards but not the piece; the duel just ends.",
			/**
			 * @description Start the duel with the legendary stakes (duel.result reads them from state.duel.card).
			 */
			play(ctx, player, target) {
				duel.start(ctx, player, target.piece, "all-or-nothing-legendary");
			},
			/**
			 * @description As the base card, but a piece shielding the own king is allowed: this version never loses the piece.
			 */
			targets(state, player) {
				if (inCheck(state, player)) return [];
				return state.board.sq.filter((p) => p && p.c === player && p.t !== "q" && p.t !== "k").map((p) => ({ piece: p.id }));
			},
		},
	],
};
