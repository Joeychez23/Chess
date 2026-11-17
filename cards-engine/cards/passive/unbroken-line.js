/*
 *  unbroken-line.js  --  chess cards engine
 *	Passive, once per game: castle even through check.
 *
 */

module.exports = {
	key: "unbroken-line", kind: "passive", name: "Unbroken Line", skulls: 0, rarity: "uncommon", oncePerGame: true,
	text: "Once, castle even through check.",
	rules: {
		/**
		 * @description While it waits, owner may castle while in check and past an attacked square (rules.legalMoves); never onto one.
		 */
		castleThroughCheck: (state, color, src) => color === src.owner,
	},
	on: {
		/**
		 * @description Owner played a castle that only castleThroughCheck let through (rules.legalMoves tags it; the move event carries through: true): it fires (once per game: into owner's used). A castle legal without it, under the rules in force when it was listed, doesn't use it.
		 */
		move: (ctx, owner, ev) => ev.player === owner && !!ev.through,
	},
};
