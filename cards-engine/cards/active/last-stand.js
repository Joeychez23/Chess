/*
 *  last-stand.js  --  chess cards engine
 *	Active: the king makes one move like a queen (target = that move); then it is Frozen for the next 2 turns.
 *
 */

const statuses = require("../../statuses.js");
const { pieceById, sqIndex, sqName } = require("../../board.js");
const { CASTLING_LOST } = require("../../movegen.js");
const { legalMoves, hooksFor } = require("../../rules.js");
const { capture } = require("../../ctx.js");
const { kingFree } = require("../../hand.js");

const KEY = "last-stand";
const RAYS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

/**
 * @description Queen moves of the king with this id on board, stopping at the first piece (a capture when it is an enemy, never a king).
 */
function rays(board, kid) {
	const i = pieceById(board, kid), k = board.sq[i], out = [];
	for (const [dr, df] of RAYS) {
		for (let n = 1; n < 8; n++) {
			const r = (i >> 3) + dr * n, f = (i & 7) + df * n;
			if (r < 0 || r > 7 || f < 0 || f > 7) break;
			const v = board.sq[r * 8 + f], m = { from: sqName(i), to: sqName(r * 8 + f), piece: kid, t: "k" };
			if (!v) { out.push(m); continue; }
			if (v.c !== k.c && v.t !== "k") out.push({ ...m, capture: v.id });
			break;
		}
	}
	return out;
}

/**
 * @description The legal queen moves of player's king (rules.legalMoves with the rays added, so statuses, check and the kings' distance apply), no castling; none for a Hexed king (cards can't move it) or without the King card (hand.kingFree: Hollow Crown).
 */
function kingMoves(state, player) {
	const k = state.board.sq.find((p) => p && p.c === player && p.t === "k");
	if (!k || statuses.has(state, k.id, "hexed") || !kingFree(state, player)) return [];
	const hooks = hooksFor(state), extra = hooks.extraMoves;
	hooks.extraMoves = (s, p) => [...(extra ? extra(s, p) : []), ...(p.id === k.id ? rays(s.board, k.id) : [])];
	return legalMoves(state, player, (m) => m.piece === k.id && !m.castle, hooks);
}

module.exports = {
	key: KEY, kind: "active", name: "Last Stand", skulls: 2, rarity: "uncommon",
	text: "King moves like a queen for 1 turn. Debuff: king is Frozen for the next 2 turns.",
	/**
	 * @description { move: { from, to } } for each queen move of player's king.
	 */
	targets: (state, player) => kingMoves(state, player).map((m) => ({ move: { from: m.from, to: m.to } })),
	/**
	 * @description The king moves (a move event with card null, then the capture, by the king; triggers run once the move is whole; a capture sets ctx.resetHalf), the castling rights its squares hold go, then the king is Frozen for 2 turns (fresh: player's next 2 turns).
	 */
	play(ctx, player, target) {
		const s = ctx.state, b = s.board, mv = kingMoves(s, player).find((m) => m.from === target.move.from && m.to === target.move.to);
		if (!mv) return;
		const from = sqIndex(mv.from), to = sqIndex(mv.to), victim = b.sq[to];
		b.sq[to] = b.sq[from];
		b.sq[from] = null;
		for (const i of [from, to]) for (const ch of CASTLING_LOST[i] || "") b.castling = b.castling.replace(ch, "");
		b.castling = b.castling || "-";
		ctx.held = []; // EVENTS NOW, TRIGGERS ONCE THE MOVE IS WHOLE (AS IN turn/index.js resolveMove)
		ctx.emit({ type: "move", player, card: null, piece: mv.piece, from: mv.from, to: mv.to });
		if (victim) capture(ctx, player, victim, mv.piece, mv.to);
		const held = ctx.held;
		ctx.held = null;
		for (const e of held) ctx.trigger(e);
		ctx.giveStatus(mv.piece, "frozen", 2);
	},
};
