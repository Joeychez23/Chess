/*
 *  last-rites.js  --  chess cards engine
 *	Passive: one of your pieces is captured; the capturing piece is Frozen for 1 turn.
 *
 */

module.exports = {
	key: "last-rites", kind: "passive", name: "Last Rites", skulls: 0, rarity: "common",
	text: "Your piece is captured → the capturing piece is Frozen for 1 turn.",
	on: {
		/**
		 * @description One of owner's pieces taken by a piece (ev.by; a card effect's capture has none): that piece is Frozen for 1 of its owner's turns (given on its owner's turn, so it is that player's next turn).
		 */
		capture: (ctx, owner, ev) => ev.c === owner && !!ev.by && ctx.giveStatus(ev.by, "frozen", 1, owner),
	},
};
