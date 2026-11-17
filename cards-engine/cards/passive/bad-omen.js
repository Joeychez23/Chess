/*
 *  bad-omen.js  --  chess cards engine
 *	Passive: one of your pieces is captured; a random curse goes into the opponent's hand, if the curse limit allows.
 *
 */

const { CURSE_KEYS } = require("../index.js");

const other = (c) => (c === "w" ? "b" : "w");

module.exports = {
	key: "bad-omen", kind: "passive", name: "Bad Omen", skulls: 0, rarity: "rare",
	text: "One of your pieces is captured → a random curse goes into the opponent's hand, if the curse limit allows.",
	on: {
		/**
		 * @description One of owner's pieces captured by the opponent (ev.player !== ev.c: a removal by owner's own side is not a capture): a random curse key (state.rng) is given to the opponent through ctx.giveCurse, which refuses it under the curse limit. Fires either way. A Mirage gets no fake piece type here yet (the curse task makes ctx.giveCurse build it).
		 */
		capture(ctx, owner, ev) {
			if (ev.c !== owner || ev.player === ev.c) return false; // A REMOVAL IS NOT A CAPTURE
			if (CURSE_KEYS.length) ctx.giveCurse(other(owner), ctx.rng.pick(CURSE_KEYS), owner);
			return true;
		},
	},
};
