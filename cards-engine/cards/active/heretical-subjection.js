/*
 *  heretical-subjection.js  --  chess cards engine
 *	Active: for 3 turns both bishops move without a card, like a bishop or like a king; then both are Shaken for 1 turn.
 *
 */

const { pieceById, sqName } = require("../../board.js");
const { legalMoves } = require("../../rules.js");

const KEY = "heretical-subjection";
const STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const own = (state, owner, id) => { const i = pieceById(state.board, id); return i >= 0 && state.board.sq[i].c === owner && state.board.sq[i].t === "b"; }; // STILL owner'S BISHOP (NOT HANDED OVER, NOT UPGRADED)
const bishops = (state, player) => state.board.sq.filter((p) => p && p.c === player && p.t === "b").map((p) => p.id);

module.exports = {
	key: KEY, kind: "active", name: "Heretical Subjection", skulls: 2, rarity: "uncommon",
	text: "For 3 turns both bishops move without a card, and each may move like a bishop or like a king (changing square color). Debuff: when it ends, both bishops are Shaken for 1 turn.",
	/**
	 * @description No target; needs a bishop, and none while player's own Heretical Subjection lasts (no refresh).
	 */
	targets: (state, player) => (bishops(state, player).length && !state.enchant.some((e) => e.key === KEY && e.owner === player) ? [null] : []),
	/**
	 * @description A 3-turn enchantment on player's bishops: given on player's own turn it is fresh, so it covers player's next 3 turns.
	 */
	play(ctx, player) {
		ctx.enchant(player, KEY, bishops(ctx.state, player), 3);
	},
	on: {
		/**
		 * @description Its own end: both bishops Shaken for 1 turn, those still owner's bishops on the board (not one handed to the opponent or upgraded).
		 */
		"enchant-ended": (ctx, owner, ev, src) => { for (const id of src.pieces.filter((x) => own(ctx.state, owner, x))) ctx.giveStatus(id, "shaken", 1, owner); },
	},
	rules: {
		/**
		 * @description An enchanted bishop (still a bishop) also steps like a king; each step may capture on its destination.
		 */
		extraMoves(state, p, src) {
			if (p.c !== src.owner || p.t !== "b" || !src.pieces.includes(p.id)) return [];
			const b = state.board, i = pieceById(b, p.id), r = i >> 3, f = i & 7, out = [];
			for (const [dr, df] of STEPS) {
				const rr = r + dr, ff = f + df;
				if (rr < 0 || rr > 7 || ff < 0 || ff > 7) continue;
				const v = b.sq[rr * 8 + ff];
				const m = { from: sqName(i), to: sqName(rr * 8 + ff), piece: p.id, t: p.t };
				out.push(v && v.c !== p.c ? { ...m, capture: v.id } : m);
			}
			return out;
		},
		/**
		 * @description The owner's enchanted bishops (still bishops) get a cardless move action for each legal move, a Hexed bishop's included: Hex stops card moves only, and the engine design names Heretical Subjection as a way a Hexed piece still moves (these moves are cardless).
		 */
		actions(state, player, actions, src) {
			if (player !== src.owner) return actions;
			const moves = legalMoves(state, player, (m) => src.pieces.includes(m.piece) && m.t === "b");
			return [...actions, ...moves.map((m) => ({ type: "move", card: null, from: m.from, to: m.to }))];
		},
	},
};
