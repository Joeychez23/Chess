/*
 *  heavy-cavalry.js  --  chess cards engine
 *	Active: two knights a knight's move apart; the enchanted knight Wards the friendly non-king pieces it covers (never the partner knight), the partner is Marked; ends when they separate.
 *
 */

const statuses = require("../../statuses.js");
const { pieceById } = require("../../board.js");
const { targets: reach } = require("../../movegen.js");

const KEY = "heavy-cavalry";

/**
 * @description Square indexes a knight on index i covers.
 */
const covers = (board, i) => reach(board, i, { t: "n" });

/**
 * @description Ids of the knights in player's live heavy-cavalry entries (enchanted or partner): never in a second entry.
 */
const busy = (state, player) => state.enchant.filter((e) => e.key === KEY && e.owner === player).flatMap((e) => e.pieces);

/**
 * @description Another knight of player's, in no entry, a knight's move from the knight with this id, or undefined. shortcut: the first in board order when promotions give more than two knights; let the player pick if that matters.
 */
function partnerOf(state, player, id) {
	const board = state.board, i = pieceById(board, id), near = covers(board, i), used = busy(state, player);
	const p = board.sq.find((q, j) => q && q.c === player && q.t === "n" && q.id !== id && !used.includes(q.id) && near.includes(j));
	return p && p.id;
}

/**
 * @description True while both pieces of the entry are owner's knights (not handed over, not upgraded), on the board and a knight's move apart.
 */
function together(board, src) {
	const [a, b] = src.pieces.map((id) => pieceById(board, id));
	return a >= 0 && b >= 0 && [a, b].every((i) => board.sq[i].c === src.owner && board.sq[i].t === "n") && covers(board, a).includes(b);
}

const apart = (ctx, owner, ev, src) => !together(ctx.state.board, src);

module.exports = {
	key: KEY, kind: "active", name: "Heavy Cavalry", skulls: 2, rarity: "uncommon",
	text: "Needs both knights a knight's move apart. One knight is enchanted; every friendly non-king piece on a square the enchanted knight could move to is Warded, except the other knight. Lasts while the two knights stay a knight's move apart, and ends for good when they separate. Moving the enchantment to the other knight uses your turn. Debuff: the non-enchanted knight is Marked while the effect lasts.",
	/**
	 * @description { piece } for each own knight in no entry with another such knight a knight's move away: the knight to enchant (moving an enchantment is the switch action only).
	 */
	targets(state, player) {
		const used = busy(state, player);
		return state.board.sq.filter((p) => p && p.c === player && p.t === "n" && !used.includes(p.id) && partnerOf(state, player, p.id)).map((p) => ({ piece: p.id }));
	},
	/**
	 * @description A heavy-cavalry enchantment with pieces [enchanted, partner] and no end; the partner is Marked while it lasts (statuses.claimMark: a Mark another card gave is left as it was when it ends).
	 */
	play(ctx, player, target) {
		const partner = partnerOf(ctx.state, player, target.piece);
		statuses.claimMark(ctx, ctx.enchant(player, KEY, [target.piece, partner]), partner);
	},
	/**
	 * @description The switch action: the other knight is enchanted, the Mark moves to the old one (released from the new enchanted knight, claimed on the new partner).
	 */
	act(ctx, player, action, src) {
		const [n, partner] = src.pieces;
		src.pieces = [partner, n];
		statuses.releaseMark(ctx, src, partner);
		statuses.claimMark(ctx, src, n);
	},
	on: {
		move: apart, // A KNIGHT MOVE ALWAYS SEPARATES THEM
		capture: apart,
		handover: apart, // OPPOSING FINALITY HANDED A KNIGHT OVER
		promote: apart, // A KNIGHT TURNED INTO ANOTHER TYPE IN PLACE (A DUEL'S UPGRADE)
		"turn-start": apart, // BACKSTOP FOR CARDS THAT MOVE PIECES WITHOUT A MOVE EVENT
		/**
		 * @description The partner's Mark removed (Cleanse): the enchantment ends with it. The switch moves the Mark after swapping the pieces, so the old partner's status-ended no longer names the partner.
		 */
		"status-ended": (ctx, owner, ev, src) => ev.piece === src.pieces[1] && ev.s === "marked",
		/**
		 * @description Its own end: the partner's Mark goes, unless another card or status needs it (statuses.releaseMark).
		 */
		"enchant-ended": (ctx, owner, ev, src) => { statuses.releaseMark(ctx, src, src.pieces[1]); },
	},
	rules: {
		/**
		 * @description An owner's non-king piece, not the partner, on a square the enchanted knight covers can't be captured while the knights are together.
		 * This Ward is a capture rule, not a `warded` status: statuses.has(.., "warded") does not see it.
		 */
		canCapture(state, attacker, target, src) {
			const b = state.board;
			if (target.c !== src.owner || target.t === "k" || target.id === src.pieces[1] || !together(b, src)) return true;
			return !covers(b, pieceById(b, src.pieces[0])).includes(pieceById(b, target.id));
		},
		/**
		 * @description The owner may switch the enchantment to the other knight (uses the turn).
		 */
		actions: (state, player, actions, src) => (player === src.owner ? [...actions, { type: "switch", enchant: src.id }] : actions),
	},
};
