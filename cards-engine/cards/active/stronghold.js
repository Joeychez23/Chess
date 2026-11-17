/*
 *  stronghold.js  --  chess cards engine
 *	Active: one of your non-king pieces is Warded for good and can't attack (no capture, no check); one Stronghold piece per player.
 *
 */

const statuses = require("../../statuses.js");
const { pieceById } = require("../../board.js");

const KEY = "stronghold";
const mine = (state, player) => state.enchant.filter((e) => e.key === KEY && e.owner === player);

/**
 * @description True when the entry's piece is off the board or no longer its owner's: the Stronghold ends.
 */
function gone(ctx, owner, ev, src) {
	const b = ctx.state.board, i = pieceById(b, src.pieces[0]);
	return i < 0 || b.sq[i].c !== src.owner;
}

module.exports = {
	key: KEY, kind: "active", name: "Stronghold", skulls: 2, rarity: "uncommon",
	text: "A non-king piece becomes Warded permanently. You can have only one Stronghold piece: playing Stronghold on another piece moves the protection to it. Cleanse removes it. Debuff: the piece can't attack (can't capture, doesn't give check).",
	/**
	 * @description { piece } for every own non-king piece, except the one that already holds player's Stronghold.
	 */
	targets(state, player) {
		const held = mine(state, player).flatMap((e) => e.pieces);
		return state.board.sq.filter((p) => p && p.c === player && p.t !== "k" && !held.includes(p.id)).map((p) => ({ piece: p.id }));
	},
	/**
	 * @description player's old Stronghold ends (its piece loses Warded), then the piece is Warded with no end and a stronghold enchantment on it carries the debuff.
	 */
	play(ctx, player, target) {
		for (const e of mine(ctx.state, player)) ctx.endEnchant(e);
		ctx.giveStatus(target.piece, "warded", null);
		ctx.enchant(player, KEY, [target.piece]);
	},
	on: {
		/**
		 * @description The piece lost Warded (Cleanse), left the board or changed sides: the Stronghold ends.
		 */
		"status-ended": (ctx, owner, ev, src) => ev.piece === src.pieces[0] && ev.s === "warded",
		capture: gone,
		move: gone,
		handover: gone, // OPPOSING FINALITY HANDED THE PIECE OVER
		"turn-start": gone,
		/**
		 * @description Its own end: the piece's Warded goes with it (nothing when already gone).
		 */
		"enchant-ended": (ctx, owner, ev, src) => { statuses.clear(ctx, src.pieces[0], "warded"); },
	},
	rules: {
		/**
		 * @description The Stronghold piece never captures, so it gives no check either (a check is a capture of the king).
		 */
		canCapture: (state, attacker, target, src) => attacker.id !== src.pieces[0],
	},
};
