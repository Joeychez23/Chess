/*
 *  underdog.js  --  chess cards engine
 *	Passive: while you're 5+ points of material down, a 6th move card and a second active card slot.
 *
 */

const other = (c) => (c === "w" ? "b" : "w");

/**
 * @description color's material on the board: pawn 1, knight 3, bishop 3, rook 5, queen 9 (the king, and a fogged "?" piece in a view, count 0).
 */
const material = (state, color) => {
	const { VALUE } = require("../../hand.js"); // LAZY hand.js: SEE shackles.js. ITS VALUE IS THE ENGINE'S ONE TABLE
	return state.board.sq.reduce((n, q) => n + (q && q.c === color ? VALUE[q.t] || 0 : 0), 0);
};

module.exports = {
	key: "underdog", kind: "passive", name: "Underdog", skulls: 0, rarity: "rare",
	text: "You're 5+ points of material down (pawn 1, knight 3, bishop 3, rook 5, queen 9) → you hold a 6th move card and a second active card slot, both refilled as usual while you stay behind.",
	rules: {
		/**
		 * @description While it waits (the rest of the game: it never fires), owner's end-of-turn refill tops up to 6 move cards and 2 actives when owner is 5+ points of material down then (hand.refill). Once not behind, the extras held stay (a refill never trims) but aren't refilled. Nothing face up.
		 */
		bigHand: (state, color, src) => color === src.owner && material(state, other(color)) - material(state, color) >= 5,
	},
};
