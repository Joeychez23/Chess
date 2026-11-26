/*
 *  swap.js  --  chess cards engine
 *	Active: two of your pieces trade squares; both are Marked for 1 turn (epic version: only the one the owner picks).
 *
 */

const statuses = require("../../statuses.js");
const { pieceById, sqName } = require("../../board.js");
const { CASTLING_LOST } = require("../../movegen.js");
const { kingFree } = require("../../hand.js");

const KEY = "swap";

/**
 * @description True when the swap of indexes i and j on board is sound: no pawn lands on a back rank, and a swapped king doesn't stand beside the other king (even one that can't capture). Leaving the own king in check is the framework's trial.
 */
function sound(board, i, j) {
	const sq = board.sq, k = sq.findIndex((p) => p && p.c !== sq[i].c && p.t === "k");
	for (const [from, to] of [[i, j], [j, i]]) {
		if (sq[from].t === "p" && (to >> 3) % 7 === 0) return false;
		if (sq[from].t === "k" && k >= 0 && Math.max(Math.abs((to >> 3) - (k >> 3)), Math.abs((to & 7) - (k & 7))) <= 1) return false;
	}
	return true;
}

/**
 * @description { pieces: [a, b] } (board order) for every sound pair of own pieces that may move: none Hexed (cards can't move it) or Frozen, and not the king without the King card (hand.kingFree: Hollow Crown). Not a canMove rule: the common Stronghold's piece can't move by itself but Swap may move it.
 */
function pairs(state, player) {
	const b = state.board, out = [];
	const free = b.sq.map((p, i) => i).filter((i) => {
		const p = b.sq[i];
		return p && p.c === player && !statuses.has(state, p.id, "hexed") && !statuses.has(state, p.id, "frozen") && (p.t !== "k" || kingFree(state, player));
	});
	for (let x = 0; x < free.length; x++) for (let y = x + 1; y < free.length; y++) if (sound(b, free[x], free[y])) out.push({ pieces: [b.sq[free[x]].id, b.sq[free[y]].id] });
	return out;
}

module.exports = {
	key: KEY, kind: "active", name: "Swap", skulls: 1, rarity: "rare",
	text: "Two of your pieces trade squares. Debuff: both are Marked for 1 turn.",
	targets: pairs,
	/**
	 * @description The two pieces trade squares (a move event each, card null; triggers run once both stand), castling rights their squares hold go, a pawn moved resets the half-move counter; then both are Marked for 1 turn (only target.mark when the epic version gives one).
	 */
	play(ctx, player, target) {
		const b = ctx.state.board, [i, j] = target.pieces.map((id) => pieceById(b, id));
		[b.sq[i], b.sq[j]] = [b.sq[j], b.sq[i]];
		for (const k of [i, j]) for (const ch of CASTLING_LOST[k] || "") b.castling = b.castling.replace(ch, "");
		b.castling = b.castling || "-";
		if (b.sq[i].t === "p" || b.sq[j].t === "p") ctx.resetHalf = true;
		ctx.held = []; // EVENTS NOW, TRIGGERS ONCE BOTH PIECES STAND (AS IN turn/index.js resolveMove)
		ctx.emit({ type: "move", player, card: null, piece: b.sq[j].id, from: sqName(i), to: sqName(j) });
		ctx.emit({ type: "move", player, card: null, piece: b.sq[i].id, from: sqName(j), to: sqName(i) });
		const held = ctx.held;
		ctx.held = null;
		for (const e of held) ctx.trigger(e);
		for (const id of target.mark ? [target.mark] : target.pieces) ctx.giveStatus(id, "marked", 1);
	},
	versions: [{
		rarity: "epic",
		text: "Two of your pieces trade squares. Debuff: only one of the two pieces, your choice, is Marked for 1 turn.",
		/**
		 * @description Each sound pair twice, once per piece to Mark: { pieces: [a, b], mark } (the owner's choice is part of the target).
		 */
		targets: (state, player) => pairs(state, player).flatMap((t) => t.pieces.map((mark) => ({ ...t, mark }))),
	}],
};
