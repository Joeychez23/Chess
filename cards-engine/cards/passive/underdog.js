/*
 *  underdog.js  --  chess cards engine
 *	Passive: while you're 5+ points of material down, a 7th move card and a second active card slot.
 *
 */

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const other = (c) => (c === "w" ? "b" : "w");

/**
 * @description color's material on the board: pawn 1, knight 3, bishop 3, rook 5, queen 9 (the king, and a fogged "?" piece in a view, count 0).
 */
const material = (state, color) => state.board.sq.reduce((n, q) => n + (q && q.c === color ? VALUE[q.t] || 0 : 0), 0);

module.exports = {
	key: "underdog", kind: "passive", name: "Underdog", skulls: 0, rarity: "rare",
	text: "You're 5+ points of material down (pawn 1, knight 3, bishop 3, rook 5, queen 9) → you hold a 7th move card and a second active card slot, both refilled as usual while you stay behind.",
	rules: {
		/**
		 * @description While it waits (the rest of the game: it never fires), owner's end-of-turn refill tops up to 7 move cards and 2 actives when owner is 5+ points of material down then (hand.refill). Once not behind, the extras held stay (a refill never trims) but aren't refilled. Nothing face up.
		 */
		bigHand: (state, color, src) => color === src.owner && material(state, other(color)) - material(state, color) >= 5,
	},
};
