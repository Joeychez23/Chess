/*
 *  hex.js  --  chess cards engine
 *	Passive: an enemy piece captures your knight; no card can move that piece for 3 turns.
 *
 */

module.exports = {
	key: "hex", kind: "passive", name: "Hex", skulls: 0, rarity: "uncommon",
	text: "An enemy piece captures your knight → no card can move that piece for 3 turns.",
	on: {
		/**
		 * @description One of owner's knights taken by a piece: that piece is Hexed for 3 of its owner's turns (status hexed: no card moves it; it still attacks and gives check).
		 */
		capture: (ctx, owner, ev) => ev.c === owner && ev.t === "n" && !!ev.by && ctx.giveStatus(ev.by, "hexed", 3, owner),
	},
};
