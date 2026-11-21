/*
 *  foresight.js  --  chess cards engine
 *	Active: see a random half (rounded up) of the opponent's hand until the end of your next turn. Rare version: the whole hand; epic: the whole hand for 3 turns.
 *
 */

const { inCheck } = require("../../rules.js");
const { resight } = require("../sight.js");

const other = (c) => (c === "w" ? "b" : "w");

/**
 * @description The play of a version that sees the opponent's whole hand (data.all, so seen.all: view.js shows every card held, those drawn later too) for left of player's turns, under the base key.
 */
const whole = (left) => (ctx, player) => {
	ctx.enchant(player, "foresight", [], left, { all: true });
	resight(ctx.state, player);
};

module.exports = {
	key: "foresight", kind: "active", name: "Foresight", skulls: 0, rarity: "common",
	text: "See a random half (rounded up) of the opponent's hand until the end of your next turn.",
	/**
	 * @description No target; never in check (a random outcome).
	 */
	targets: (state, player) => (inCheck(state, player) ? [] : [null]),
	/**
	 * @description A 1-turn foresight enchantment whose data.ids is a random half (rounded up, state.rng) of the opponent's hidden cards (move cards, actives, a held passive; curses are shown anyway), then players[player].seen rebuilt from player's sight entries (sight.js): given on player's own turn it is fresh, so it ends at the end of player's next turn.
	 */
	play(ctx, player) {
		const o = ctx.state.players[other(player)];
		const ids = ctx.rng.shuffle([...o.moves, ...o.actives, ...(o.passive ? [o.passive] : [])].map((c) => c.id));
		ctx.enchant(player, "foresight", [], 1, { ids: ids.slice(0, Math.ceil(ids.length / 2)) });
		resight(ctx.state, player);
	},
	versions: [
		{ rarity: "rare", text: "See the opponent's whole hand until the end of your next turn.", play: whole(1) },
		{ rarity: "epic", text: "See the opponent's whole hand for 3 turns.", play: whole(3) },
	],
	on: {
		/**
		 * @description Its own entry ended: owner's sight is rebuilt from the sight entries left (another Foresight's, Witness's, Interdicted Foresight's), so its half and its whole-hand sight go and theirs stay.
		 */
		"enchant-ended"(ctx, owner) { resight(ctx.state, owner); },
	},
};
