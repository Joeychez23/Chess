/*
 *  trapdoor.js  --  chess cards engine
 *	Active: a hidden trap on an empty square of your half; the first enemy piece to land there is Frozen and Marked for 3 turns (a king: Frozen only).
 *
 */

const { sqIndex, sqName } = require("../../board.js");

const KEY = "trapdoor";
const far = (a, b) => Math.max(Math.abs((a >> 3) - (b >> 3)), Math.abs((a & 7) - (b & 7)));

/**
 * @description An enemy piece landed on the trap square: it is Frozen and Marked for 3 turns (a king Frozen only; it may still move out with a King skull, turn.kingMoves) and stays on the board, and the trap is spent. Protection (Warded, a Ward rule) doesn't stop it: nothing is captured. Nothing, and the trap stays, when: an own piece landed; the entry has no square (a state rebuilt from the opponent's view); or this is a legality trial (ctx.trial), so the offered actions never depend on the hidden square.
 */
function spring(ctx, owner, ev, src) {
	const sq = src.data && src.data.square;
	if (ctx.trial || !sq || ev.to !== sq) return false;
	const p = ctx.state.board.sq[sqIndex(sq)];
	if (!p || p.id !== ev.piece || p.c === owner) return false;
	ctx.giveStatus(p.id, "frozen", 3, owner);
	if (p.t !== "k") ctx.giveStatus(p.id, "marked", 3, owner);
	return true;
}

module.exports = {
	key: KEY, kind: "active", name: "Trapdoor", skulls: 0, rarity: "uncommon",
	text: "Mark a hidden empty square on your own half of the board, at least 4 squares from the enemy king and not next to any piece. The first enemy piece to land there is Frozen and Marked for 3 turns. If the enemy king lands there it is Frozen for 3 turns instead (not Marked); it may still move, and each such move costs it a king skull.",
	/**
	 * @description { square } for every empty square on player's half, 4 or more king steps from the enemy king, with no piece beside it, and not already one of player's traps.
	 */
	targets(state, player) {
		const sq = state.board.sq, k = sq.findIndex((p) => p && p.c !== player && p.t === "k");
		const mine = state.enchant.filter((e) => e.key === KEY && e.owner === player).map((e) => e.data.square);
		return [...Array(64).keys()].filter((i) => (player === "w" ? i >= 32 : i < 32) && !sq[i] && (k < 0 || far(i, k) >= 4)
			&& !sq.some((p, j) => p && far(i, j) === 1) && !mine.includes(sqName(i))).map((i) => ({ square: sqName(i) }));
	},
	/**
	 * @description A trapdoor enchantment with no end and the square in data.square (the view hides it from the opponent; the enchant event never carries it).
	 */
	play(ctx, player, target) { ctx.enchant(player, KEY, [], null, { square: target.square }); },
	on: { move: spring, handover: spring },
};
