/*
 *  cleanse.js  --  chess cards engine
 *	Active: clear all of your curses, or remove one status from your side (Stronghold's Warded included, which ends it), your choice; uses your whole turn. Rare version: clear every status on your side (and end a one-knight Heavy Cavalry).
 *
 */

const statuses = require("../../statuses.js");
const { pieceById } = require("../../board.js");
const { baseKey } = require("../index.js");

/**
 * @description [piece id, status] for each status on player's pieces on the board, in statuses order.
 */
function own(state, player) {
	return Object.keys(state.statuses).filter((id) => { const p = state.board.sq[pieceById(state.board, id)]; return p && p.c === player; })
		.flatMap((piece) => state.statuses[piece].map((e) => [piece, e.s]));
}

/**
 * @description The curses Cleanse clears for player: all held but a Mirage (entered or waiting: its holder sees a move card or nothing, as in playerView, so neither the targets nor the clearing may give it away) and a Pact (it can't be cleared before it turns into Debt).
 */
const cleanable = (state, player) => state.players[player].curses.filter((c) => !["mirage", "pact"].includes(baseKey(c.key)));

/**
 * @description player's one-knight Heavy Cavalry entries: no Mark to remove, so Cleanse ends them itself.
 */
const lone = (state, player) => state.enchant.filter((e) => e.key === "heavy-cavalry" && e.owner === player);

module.exports = {
	key: "cleanse", kind: "active", name: "Cleanse", skulls: 0, rarity: "common",
	text: "Clear all of your curses, or remove one status from your side (your choice). Uses your whole turn.",
	/**
	 * @description { curses: "all" } when player holds a curse other than a Mirage or a Pact (cleanable), then { piece, s } for each status on player's pieces on the board, then { piece, enchant } for each one-knight Heavy Cavalry of player's.
	 */
	targets(state, player) {
		return [...(cleanable(state, player).length ? [{ curses: "all" }] : []), ...own(state, player).map(([piece, s]) => ({ piece, s })), ...lone(state, player).map((e) => ({ piece: e.pieces[0], enchant: e.id }))];
	},
	/**
	 * @description Every curse player holds but a Mirage and a Pact (cleanable: a Pact can't be cleared before it turns into Debt) leaves through ctx.clearCurse (a curse-cleared each; each cleared curse hears its own), or the status ends (status-ended; a Stronghold hears it and ends), or the one-knight Heavy Cavalry ends. The active is the whole turn.
	 */
	play(ctx, player, target) {
		if (target.enchant) return ctx.endEnchant(ctx.state.enchant.find((e) => e.id === target.enchant));
		if (!target.curses) return statuses.clear(ctx, target.piece, target.s);
		for (const card of cleanable(ctx.state, player)) ctx.clearCurse(player, card);
	},
	versions: [{
		rarity: "rare", text: "Clear every status on your side. Uses your whole turn.",
		targets: (state, player) => (own(state, player).length || lone(state, player).length ? [null] : []),
		/**
		 * @description Every status on player's pieces ends (a status-ended each; an enchantment whose debuff status goes ends with it, as with the base card), taken from a list made first so an ending that changes statuses can't skip one; then each one-knight Heavy Cavalry of player's ends.
		 */
		play(ctx, player) {
			for (const [piece, s] of own(ctx.state, player)) statuses.clear(ctx, piece, s);
			for (const e of lone(ctx.state, player)) ctx.endEnchant(e);
		},
	}],
};
