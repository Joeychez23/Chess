/*
 *  foresight.js  --  chess cards engine
 *	Active: see a random half (rounded up) of the opponent's hand until the end of your next turn. Rare version: the whole hand; epic: the whole hand for 3 turns.
 *
 */

const { inCheck } = require("../../rules.js");

const other = (c) => (c === "w" ? "b" : "w");

/**
 * @description The play of a version that sees the opponent's whole hand (seen.all: view.js shows every card held, those drawn later too) for left of player's turns, under the base key so the enchant-ended rule below holds for every version.
 */
const whole = (left) => (ctx, player) => {
	const prev = ctx.state.players[player].seen;
	ctx.state.players[player].seen = { ids: prev ? prev.ids : [], fake: [], all: true }; // A RUNNING BASE FORESIGHT'S HALF IS KEPT FOR WHEN THIS ONE ENDS FIRST
	ctx.enchant(player, "foresight", [], left, { all: true });
};

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
		const prev = ctx.state.players[player].seen;
		ctx.state.players[player].seen = { ids: ids.slice(0, Math.ceil(ids.length / 2)), fake: [], all: !!(prev && prev.all) }; // A WHOLE-HAND VERSION STILL RUNNING KEEPS ITS SIGHT
		ctx.enchant(player, "foresight", [], 1);
	},
	versions: [
		{ rarity: "rare", text: "See the opponent's whole hand until the end of your next turn.", play: whole(1) },
		{ rarity: "epic", text: "See the opponent's whole hand for 3 turns.", play: whole(3) },
	],
	on: {
		/**
		 * @description Its own entry ended: the sight goes, unless another Foresight of owner's still lasts; the whole-hand sight goes when no whole-hand entry (data.all) is left.
		 */
		"enchant-ended"(ctx, owner) {
			const rest = ctx.state.enchant.filter((e) => e.key === "foresight" && e.owner === owner), p = ctx.state.players[owner];
			if (!rest.length) p.seen = null;
			else if (p.seen && p.seen.all && !rest.some((e) => e.data && e.data.all)) p.seen.all = false;
		},
	},
};
