/*
 *  mulligan.js  --  chess cards engine
 *	Active: discard your move cards and draw new ones.
 *
 */

const { inCheck } = require("../../rules.js");

module.exports = {
	key: "mulligan", kind: "active", name: "Mulligan", skulls: 0, rarity: "uncommon",
	text: "Discard your move cards and draw new ones.",
	/**
	 * @description No target; needs a move card; never in check (a random outcome).
	 */
	targets: (state, player) => (state.players[player].moves.length && !inCheck(state, player) ? [null] : []),
	/**
	 * @description Every move card discarded (a discard event each), then as many new move cards drawn.
	 */
	play(ctx, player) {
		const p = ctx.state.players[player], old = p.moves;
		p.moves = [];
		for (const card of old) ctx.emit({ type: "discard", player, card });
		ctx.draw(player, old.length);
	},
};
