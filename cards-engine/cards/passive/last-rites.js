/*
 *  last-rites.js  --  chess cards engine
 *	Passive: one of your pieces is captured; the capturing piece is Frozen for 3 turns.
 *
 */

module.exports = {
	key: "last-rites", kind: "passive", name: "Last Rites", skulls: 0, rarity: "uncommon",
	text: "Your piece is captured → the capturing piece is Frozen for 3 turns.",
	on: {
		/**
		 * @description One of owner's pieces taken by a piece (ev.by; a card effect's capture has none): that piece is Frozen for 3 of its owner's turns (given on its owner's turn, so they are that player's next 3 turns).
		 */
		capture: (ctx, owner, ev) => ev.c === owner && !!ev.by && ctx.giveStatus(ev.by, "frozen", 3, owner),
	},
};
