/*
 *  witness.js  --  chess cards engine
 *	Passive: the opponent plays Foresight on you; you see their whole hand.
 *
 */

const { baseKey } = require("../index.js");
const { resight } = require("../sight.js");

module.exports = {
	key: "witness", kind: "passive", name: "Witness", skulls: 0, rarity: "common",
	text: "Opponent plays Foresight on you → you see their whole hand.",
	on: {
		/**
		 * @description The opponent plays Foresight in any version (baseKey), not cancelled by an earlier card: owner sees the opponent's whole hand (an entry of owner's with data.all: cards drawn later show too) until the end of owner's next turn. Its own entry (no src.card) ignores it.
		 */
		"card-played"(ctx, owner, ev, src) {
			if (!src.card || ev.player === owner || ctx.cancelled || baseKey(ev.card.key) !== "foresight") return false;
			ctx.enchant(owner, "witness", [], 1, { all: true });
			resight(ctx.state, owner);
			return true;
		},
		/**
		 * @description Its entry ended: owner's sight is rebuilt without it (a running Foresight's sight stays).
		 */
		"enchant-ended"(ctx, owner, ev, e) {
			if (!e.card) resight(ctx.state, owner);
			return false;
		},
	},
};
