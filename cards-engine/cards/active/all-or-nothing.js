/*
 *  all-or-nothing.js  --  chess cards engine
 *	Active: play the card duel (duel.js) to upgrade one of your pieces; a loss forfeits 6 random cards and the piece.
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

module.exports = {
	key: "all-or-nothing", kind: "active", name: "All or Nothing", skulls: 3, rarity: "rare",
	text: "Play the card duel (core rules) to promote a non-queen, non-king piece: win once for Knight or Bishop, win again for Rook, win a third time for Queen. Steps that aren't an upgrade are skipped (a rook plays one hand for Queen). You may stop after any win. Debuff: losing a hand forfeits 6 random cards and the piece being promoted.",
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
		duel.start(ctx, player, target.piece);
	},
	choice: {
		/**
		 * @description The first win's Knight or Bishop; the choice ends the turn only if the duel ended with it (the piece gone).
		 */
		resolve(ctx, pending, option) {
			if (duel.upgrade(ctx, option)) pending.end = true;
		},
	},
};
