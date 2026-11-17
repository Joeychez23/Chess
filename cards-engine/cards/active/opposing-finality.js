/*
 *  opposing-finality.js  --  chess cards engine
 *	Active: one of your non-king pieces is enchanted (and Marked); if it is captured, the opponent hands you one of their pieces one stage below it.
 *
 */

const statuses = require("../../statuses.js");
const { pieceById, sqIndex, sqName } = require("../../board.js");
const { LOSES, attacksSquare } = require("../../movegen.js");
const { inCheck, hooksFor } = require("../../rules.js");

const KEY = "opposing-finality";
const STAGE = { p: 0, n: 1, b: 1, r: 2, q: 3 };
const HOME = { n: [1, 6], b: [2, 5], r: [0, 7] }; // START FILES ON THE BACK RANK
const other = (c) => (c === "w" ? "b" : "w");
const dark = (i) => ((i >> 3) + (i & 7)) & 1;

/**
 * @description Distance between two square indexes: king distance first, then straight-line steps (so of two squares 7 king steps away, the one on the same file is nearer).
 */
function dist(a, b) {
	const r = Math.abs((a >> 3) - (b >> 3)), f = Math.abs((a & 7) - (b & 7));
	return Math.max(r, f) * 16 + r + f;
}

/**
 * @description Ids of the pieces checking color's king on st, under hooks.
 */
function checkers(st, color, hooks) {
	const sq = st.board.sq, k = sq.findIndex((q) => q && q.c === color && q.t === "k");
	return k < 0 ? [] : sq.filter((q, j) => q && q.c !== color && attacksSquare(st, j, q, k, hooks)).map((q) => q.id);
}

/**
 * @description The square index where the piece on index i lands when handed to colour `to`, or -1 when it can't be handed over. -1 when its leaving adds a checker on the giver's king, or, on to's own turn (turn === to), puts to's king in check. Else its start squares on to's side, nearest first (a pawn: its file on to's second rank; a bishop: the one of its square colour), else the empty square nearest the first of them: the first that is empty (or the piece's own) where the piece, in to's colour, does not attack the giver's king; -1 when none. Only what this piece causes counts: a check that stood before is not its to lift or block. The giver's enchantments on the piece are left out (they end when it changes sides); a pawn never lands on a back rank.
 */
function landing(state, i, to, turn) {
	const b = state.board, p = b.sq[i], giver = p.c, back = to === "w" ? 7 : 0;
	const probe = { ...state, enchant: state.enchant.filter((e) => !(e.owner === giver && e.pieces.includes(p.id))) }, hooks = hooksFor(probe);
	const gone = b.sq.slice(), k = b.sq.findIndex((q) => q && q.c === giver && q.t === "k");
	gone[i] = null;
	const left = { ...probe, board: { ...b, sq: gone } }, was = checkers(probe, giver, hooks);
	if (checkers(left, giver, hooks).some((x) => !was.includes(x))) return -1; // ITS LEAVING UNCOVERS A CHECK ON THE GIVER
	if (turn === to && !inCheck(state, to) && inCheck(left, to)) return -1; // ITS LEAVING WOULD END THE OWNER'S OWN TURN IN CHECK
	const ok = (j) => {
		if ((b.sq[j] && j !== i) || (p.t === "p" && (j >> 3) % 7 === 0)) return false;
		const sq = gone.slice(), q = sq[j] = { ...p, c: to };
		return k < 0 || !attacksSquare({ ...probe, board: { ...b, sq } }, j, q, k, hooks);
	};
	const starts = p.t === "p" ? [(to === "w" ? 6 : 1) * 8 + (i & 7)]
		: HOME[p.t].map((f) => back * 8 + f).filter((j) => p.t !== "b" || dark(j) === dark(i)).sort((x, y) => dist(i, x) - dist(i, y));
	const hit = starts.find(ok);
	if (hit !== undefined) return hit;
	const near = [...Array(64).keys()].sort((x, y) => dist(starts[0], x) - dist(starts[0], y) || x - y).find(ok);
	return near === undefined ? -1 : near;
}

/**
 * @description What owner gets for a captured piece of type t: { pieces, chooser }. pieces: the giver's non-king pieces of the highest stage at or below t's stage minus one (a pawn for a pawn) that have a landing square; chooser: the giver at that exact stage, else owner. No pieces when the giver has none (only the king). turn: the colour whose turn is in progress (landing).
 */
function offer(state, owner, t, turn) {
	const giver = other(owner), want = Math.max(STAGE[t] - 1, 0);
	const list = state.board.sq.filter((p, i) => p && p.c === giver && p.t !== "k" && STAGE[p.t] <= want && landing(state, i, owner, turn) >= 0);
	const top = Math.max(...list.map((p) => STAGE[p.t]));
	return { pieces: list.filter((p) => STAGE[p.t] === top), chooser: top === want ? giver : owner };
}

/**
 * @description The piece with this id changes to owner's colour (same id, statuses kept) and moves to its landing square; castling rights its squares hold go, an en passant square behind it goes, a pawn moved resets the half-move counter; a handover event { player: owner, piece, from, to }.
 */
function handOver(ctx, owner, id) {
	const b = ctx.state.board, i = pieceById(b, id), j = i < 0 || b.sq[i].c === owner ? -1 : landing(ctx.state, i, owner, ctx.turn);
	if (j < 0) return; // GONE, ALREADY owner'S (TWO QUEUED CHOICES OFFERING IT), OR NO LONGER SAFE TO HAND OVER
	const p = b.sq[i];
	b.sq[i] = null;
	b.sq[j] = p;
	p.c = owner;
	for (const k of [i, j]) for (const ch of LOSES[k] || "") b.castling = b.castling.replace(ch, "");
	b.castling = b.castling || "-";
	if (p.t === "p") {
		if (b.ep && sqIndex(b.ep) + (owner === "w" ? 8 : -8) === i) b.ep = null; // ITS DOUBLE STEP NAMES A PAWN NO LONGER THE GIVER'S
		ctx.resetHalf = true;
	}
	ctx.emit({ type: "handover", player: owner, piece: id, from: sqName(i), to: sqName(j) });
}

/**
 * @description The enchanted piece changed sides (handed over, still on the board): the enchantment ends. Off the board is the capture handler's.
 */
function turned(ctx, owner, ev, src) {
	const b = ctx.state.board, i = pieceById(b, src.pieces[0]);
	return i >= 0 && b.sq[i].c !== src.owner;
}

module.exports = {
	key: KEY, kind: "active", name: "Opposing Finality", skulls: 2, rarity: "rare",
	text: "Enchant one of your non-king pieces. If it is captured, the opponent must hand you one of their pieces one stage below it (stages: pawn < knight/bishop < rook < queen; their choice within the stage). A captured queen takes a rook, a rook takes a knight or bishop, a knight or bishop takes a pawn, and a pawn takes a pawn. If they have no piece of that stage, go down to the highest lower stage they do have, and the enchanted piece's owner picks the piece within it. Never a piece above that stage. If they have only their king, nothing happens. It switches to your color and goes to its starting square on your side (bishops to the one of matching square color; pawns to their file on your second rank; rooks and knights to either, nearest first). If that square is taken, or the piece would give check from it, it goes to the nearest empty square where it doesn't. Debuff: the enchanted piece is Marked.",
	/**
	 * @description { piece } for every own non-king piece not already enchanted by player's Opposing Finality.
	 */
	targets(state, player) {
		const held = state.enchant.filter((e) => e.key === KEY && e.owner === player).flatMap((e) => e.pieces);
		return state.board.sq.filter((p) => p && p.c === player && p.t !== "k" && !held.includes(p.id)).map((p) => ({ piece: p.id }));
	},
	/**
	 * @description An opposing-finality enchantment on the piece (no end) and the piece Marked for as long (statuses.claimMark).
	 */
	play(ctx, player, target) {
		statuses.claimMark(ctx, ctx.enchant(player, KEY, [target.piece]), target.piece);
	},
	on: {
		/**
		 * @description Its piece captured by the other side (by a move or a card): the hand-over, at once when one piece qualifies, else through the chooser's choice; nothing when the giver has only the king. Fires either way; a removal by its own side just ends it.
		 */
		capture(ctx, owner, ev, src) {
			if (ev.piece !== src.pieces[0] || ev.c !== src.owner) return false;
			if (ev.player === ev.c) return true; // A REMOVAL BY ITS OWN SIDE (A FORFEIT, A LOST DUEL) IS NOT A CAPTURE: IT JUST ENDS
			const { pieces, chooser } = offer(ctx.state, owner, ev.t, ctx.turn);
			if (pieces.length === 1) handOver(ctx, owner, pieces[0].id);
			else if (pieces.length) ctx.ask(chooser, KEY, pieces.map((p) => p.id), { card: KEY, owner });
			return true;
		},
		move: turned,
		handover: turned,
		"turn-start": turned,
		/**
		 * @description Its Mark removed (Cleanse): the enchantment ends with it.
		 */
		"status-ended": (ctx, owner, ev, src) => ev.piece === src.pieces[0] && ev.s === "marked",
		/**
		 * @description Its own end: the Mark goes unless another card or status needs it (statuses.releaseMark; nothing when the piece is gone). Since no card clears a Mark it doesn't own, a status-ended of its piece's Mark while it lasts is Cleanse.
		 */
		"enchant-ended": (ctx, owner, ev, src) => { statuses.releaseMark(ctx, src, src.pieces[0]); },
	},
	choice: {
		/**
		 * @description The chosen piece (an id) is handed to pending.owner.
		 */
		resolve(ctx, pending, option) { handOver(ctx, pending.owner, option); },
	},
};
