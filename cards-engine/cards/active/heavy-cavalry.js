/*
 *  heavy-cavalry.js  --  chess cards engine
 *	Active: one knight is enchanted and Wards the friendly non-king pieces it covers; ends when that knight leaves the board. Epic only (user ruling 2026-11-25: the two-knight base card, with its Marked partner and its switch action, was removed; this was its epic version).
 *
 */

const { pieceById } = require("../../board.js");
const { targets: reach } = require("../../movegen.js");

const KEY = "heavy-cavalry";

/**
 * @description Square indexes a knight on index i covers.
 */
const covers = (board, i) => reach(board, i, { t: "n" });

/**
 * @description Ids of the knights in player's live heavy-cavalry entries: never in a second entry.
 */
const busy = (state, player) => state.enchant.filter((e) => e.key === KEY && e.owner === player).flatMap((e) => e.pieces);

/**
 * @description True while the entry's knight is an owner's knight on the board (not handed over, not upgraded).
 */
function standing(board, src) {
	const i = pieceById(board, src.pieces[0]);
	return i >= 0 && board.sq[i].c === src.owner && board.sq[i].t === "n";
}

const gone = (ctx, owner, ev, src) => !standing(ctx.state.board, src);

module.exports = {
	key: KEY, kind: "active", name: "Heavy Cavalry", skulls: 2, rarity: "epic",
	text: "Enchant one of your knights; every friendly non-king piece on a square it could move to is Warded. Lasts while that knight is on the board; Cleanse on the knight ends it.",
	/**
	 * @description { piece } for each own knight in no heavy-cavalry entry.
	 */
	targets(state, player) {
		const used = busy(state, player);
		return state.board.sq.filter((p) => p && p.c === player && p.t === "n" && !used.includes(p.id)).map((p) => ({ piece: p.id }));
	},
	/**
	 * @description A heavy-cavalry enchantment with pieces [knight] and no end.
	 */
	play(ctx, player, target) { ctx.enchant(player, KEY, [target.piece]); },
	on: {
		capture: gone,
		handover: gone, // OPPOSING FINALITY HANDED THE KNIGHT OVER
		promote: gone, // THE KNIGHT TURNED INTO ANOTHER TYPE IN PLACE (A DUEL'S UPGRADE)
		"turn-start": gone, // BACKSTOP FOR CARDS THAT REMOVE PIECES WITHOUT ONE OF THE EVENTS ABOVE
	},
	rules: {
		/**
		 * @description An owner's non-king piece on a square the enchanted knight covers can't be captured while the knight stands.
		 * This Ward is a capture rule, not a `warded` status: statuses.has(.., "warded") does not see it.
		 */
		canCapture(state, attacker, target, src) {
			const b = state.board;
			if (target.c !== src.owner || target.t === "k" || !standing(b, src)) return true;
			return !covers(b, pieceById(b, src.pieces[0])).includes(pieceById(b, target.id));
		},
	},
};
