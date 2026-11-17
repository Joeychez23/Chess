/*
 *  foresight.js  --  chess cards engine
 *	Active: see a random half (rounded up) of the opponent's hand until the end of your next turn.
 *
 */

const { inCheck } = require("../../rules.js");

const other = (c) => (c === "w" ? "b" : "w");

module.exports = {
	key: "foresight", kind: "active", name: "Foresight", skulls: 0, rarity: "common",
	text: "See a random half (rounded up) of the opponent's hand until the end of your next turn.",
	/**
	 * @description No target; never in check (a random outcome).
	 */
	targets: (state, player) => (inCheck(state, player) ? [] : [null]),
	/**
	 * @description players[player].seen = a random half (rounded up, state.rng) of the opponent's hidden cards (move cards, actives, a held passive; curses are shown anyway), and a 1-turn foresight enchantment: given on player's own turn it is fresh, so it ends at the end of player's next turn.
	 */
	play(ctx, player) {
		const o = ctx.state.players[other(player)];
		const ids = ctx.rng.shuffle([...o.moves, ...o.actives, ...(o.passive ? [o.passive] : [])].map((c) => c.id));
		ctx.state.players[player].seen = { ids: ids.slice(0, Math.ceil(ids.length / 2)), fake: [] };
		ctx.enchant(player, "foresight", [], 1);
	},
	on: {
		/**
		 * @description Its own entry ended: the sight goes, unless another Foresight of owner's still lasts.
		 */
		"enchant-ended"(ctx, owner) {
			if (!ctx.state.enchant.some((e) => e.key === "foresight" && e.owner === owner)) ctx.state.players[owner].seen = null;
		},
	},
};
