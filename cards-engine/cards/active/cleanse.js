/*
 *  cleanse.js  --  chess cards engine
 *	Active: remove one curse or status from your side (Stronghold's Warded included, which ends it); uses your whole turn. Rare version: clear every status on your side.
 *
 */

const statuses = require("../../statuses.js");
const { pieceById } = require("../../board.js");

/**
 * @description [piece id, status] for each status on player's pieces on the board, in statuses order.
 */
function own(state, player) {
	return Object.keys(state.statuses).filter((id) => { const p = state.board.sq[pieceById(state.board, id)]; return p && p.c === player; })
		.flatMap((piece) => state.statuses[piece].map((e) => [piece, e.s]));
}

module.exports = {
	key: "cleanse", kind: "active", name: "Cleanse", skulls: 0, rarity: "common",
	text: "Remove one curse or status from your side. Uses your whole turn.",
	/**
	 * @description { curse: id } for each curse player holds except a Mirage (its holder sees it as a move card, as in playerView), then { piece, s } for each status on player's pieces on the board, then { piece, enchant } for each one-knight Heavy Cavalry of player's.
	 */
	targets(state, player) {
		const curses = state.players[player].curses.filter((c) => c.key !== "mirage");
		const lone = state.enchant.filter((e) => e.key === "heavy-cavalry-epic" && e.owner === player); // THE ONE-KNIGHT HEAVY CAVALRY HAS NO MARK TO REMOVE: CLEANSE ENDS IT ON ITS KNIGHT
		return [...curses.map((c) => ({ curse: c.id })), ...own(state, player).map(([piece, s]) => ({ piece, s })), ...lone.map((e) => ({ piece: e.pieces[0], enchant: e.id }))];
	},
	/**
	 * @description A curse leaves the hand (curse-cleared { player, card }), or the status ends (status-ended; a Stronghold hears it and ends). The active is the whole turn.
	 */
	play(ctx, player, target) {
		const p = ctx.state.players[player];
		if (target.enchant) return ctx.endEnchant(ctx.state.enchant.find((e) => e.id === target.enchant));
		if (!target.curse) return statuses.clear(ctx, target.piece, target.s);
		const card = p.curses.find((c) => c.id === target.curse);
		p.curses = p.curses.filter((c) => c !== card);
		ctx.emit({ type: "curse-cleared", player, card });
	},
	versions: [{
		rarity: "rare", text: "Clear every status on your side. Uses your whole turn.",
		targets: (state, player) => (own(state, player).length ? [null] : []),
		/**
		 * @description Every status on player's pieces ends (a status-ended each; an enchantment whose debuff status goes ends with it, as with the base card), taken from a list made first so an ending that changes statuses can't skip one.
		 */
		play(ctx, player) {
			for (const [piece, s] of own(ctx.state, player)) statuses.clear(ctx, piece, s);
		},
	}],
};
