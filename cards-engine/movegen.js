/*
 *  movegen.js  --  chess cards engine
 *	Pseudo-legal move generation and makeMove. Card rules plug in through `hooks`.
 *
 */

const { sqName, sqIndex, positionKey } = require("./board.js");

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const RAYS = { r: ORTHO, b: DIAG, q: [...ORTHO, ...DIAG] };
// CASTLING BY COLOUR + SIDE: [KING SQUARE, ROOK SQUARE, KING TARGET, ROOK TARGET, SQUARES THAT MUST BE EMPTY]
const CASTLES = {
	wK: [60, 63, 62, 61, [61, 62]], wQ: [60, 56, 58, 59, [57, 58, 59]],
	bK: [4, 7, 6, 5, [5, 6]], bQ: [4, 0, 2, 3, [1, 2, 3]],
};
// A MOVE FROM OR TO THESE SQUARES LOSES THE RIGHTS LISTED
const LOSES = { 60: "KQ", 4: "kq", 63: "K", 56: "Q", 7: "k", 0: "q" };

/**
 * @description Squares the piece at index i attacks on this board (pawns: both diagonals, sliders stop at the first piece, own pieces included).
 */
function targets(board, i, p) {
	const r = i >> 3, f = i & 7, out = [];
	const add = (dr, df) => {
		const rr = r + dr, ff = f + df;
		if (rr < 0 || rr > 7 || ff < 0 || ff > 7) return null;
		out.push(rr * 8 + ff);
		return board.sq[rr * 8 + ff];
	};
	if (p.t === "p") { const dr = p.c === "w" ? -1 : 1; add(dr, -1); add(dr, 1); }
	else if (p.t === "n" || p.t === "k") { for (const [dr, df] of p.t === "n" ? KNIGHT : KING) add(dr, df); }
	else {
		for (const [dr, df] of RAYS[p.t]) {
			for (let k = 1; k < 8; k++) {
				const rr = r + dr * k, ff = f + df * k;
				if (rr < 0 || rr > 7 || ff < 0 || ff > 7) break;
				out.push(rr * 8 + ff);
				if (board.sq[rr * 8 + ff]) break;
			}
		}
	}
	return out;
}

/**
 * @description The one answer to "may piece p capture target v": canMove and canCapture allow it, and, when v is a king, givesCheck too. Hooks get the piece objects ({ id, c, t }, no square).
 */
function mayCapture(state, p, v, hooks) {
	return (!hooks.canMove || hooks.canMove(state, p)) && (!hooks.canCapture || hooks.canCapture(state, p, v))
		&& (v.t !== "k" || !hooks.givesCheck || hooks.givesCheck(state, p));
}

/**
 * @description The one answer to "does piece p (at index i) attack square s": normal targets or extraMoves reach s, and p may capture there. An empty square, or one holding p's own piece (defended only if p could take a king there), is tested against the enemy king (mayCapture, which asks givesCheck when the target is a king). A move from extraMoves counts as a capture threat on its destination. A king always attacks the enemy king on a neighbouring square, whatever the hooks say, so the two kings never stand side by side.
 */
function attacksSquare(state, i, p, s, hooks) {
	const b = state.board, v = b.sq[s];
	if (p.t === "k" && v && v.t === "k" && v.c !== p.c && targets(b, i, p).includes(s)) return true; // NO HOOK APPLIES: A FROZEN OR SHAKEN KING COULD OTHERWISE BE MATED BY A BARE KING
	if (hooks.canMove && !hooks.canMove(state, p)) return false;
	let hit = targets(b, i, p).includes(s);
	if (!hit && hooks.extraMoves) { const to = sqName(s); hit = hooks.extraMoves(state, p).some((m) => m.to === to); }
	if (!hit) return false;
	if (!hooks.canCapture && !hooks.givesCheck) return true;
	const t = (v && v.c !== p.c && v) || b.sq.find((q) => q && q.c !== p.c && q.t === "k") || { id: null, c: p.c === "w" ? "b" : "w", t: "k" };
	return mayCapture(state, p, t, hooks);
}

/**
 * @description Pseudo-legal moves for `color` (own king safety is not checked; see rules.legalMoves). Plain chess when hooks is empty. hooks.extraMoves(state, piece) returns Move[] and its contract is that each move can also capture on its destination.
 */
function pseudoMoves(state, color, hooks = {}) {
	const b = state.board, moves = [];
	const mk = (i, p, to, extra) => ({ from: sqName(i), to: sqName(to), piece: p.id, t: p.t, ...extra });
	for (let i = 0; i < 64; i++) {
		const p = b.sq[i];
		if (!p || p.c !== color || (hooks.canMove && !hooks.canMove(state, p))) continue;
		const grab = (to) => { const v = b.sq[to]; return v && v.c !== color && mayCapture(state, p, v, hooks) ? v : null; };
		if (p.t === "p") {
			const dr = color === "w" ? -1 : 1, last = color === "w" ? 0 : 7, r = i >> 3;
			const push = (to, extra) => {
				if ((to >> 3) !== last) moves.push(mk(i, p, to, extra));
				else for (const promotion of ["q", "r", "b", "n"]) moves.push(mk(i, p, to, { ...extra, promotion }));
			};
			const one = i + dr * 8;
			if (!b.sq[one]) {
				push(one);
				if (r === (color === "w" ? 6 : 1) && !b.sq[one + dr * 8]) push(one + dr * 8);
			}
			for (const to of targets(b, i, p)) {
				const v = grab(to);
				if (v) push(to, { capture: v.id });
				else if (b.ep && to === sqIndex(b.ep)) {
					const ev = b.sq[(i >> 3) * 8 + (to & 7)];
					if (ev && ev.c !== color && ev.t === "p" && mayCapture(state, p, ev, hooks)) push(to, { capture: ev.id, ep: true });
				}
			}
		} else {
			for (const to of targets(b, i, p)) {
				const v = b.sq[to];
				if (!v) moves.push(mk(i, p, to));
				else if (grab(to)) moves.push(mk(i, p, to, { capture: v.id }));
			}
			if (p.t === "k") {
				for (const side of ["K", "Q"]) {
					const [ks, rs, kt, , gap] = CASTLES[color + side], rook = b.sq[rs];
					const right = color === "w" ? side : side.toLowerCase();
					if (ks === i && b.castling.includes(right) && rook && rook.c === color && rook.t === "r" && gap.every((s) => !b.sq[s]) && (!hooks.canMove || hooks.canMove(state, rook))) {
						moves.push(mk(i, p, kt, { castle: side }));
					}
				}
			}
		}
		if (hooks.extraMoves) {
			const key = (m) => m.from + m.to + (m.promotion || "") + (m.castle || ""); // A CASTLE IS NOT A DUPLICATE OF A SLIDE
			for (const m of hooks.extraMoves(state, p)) { // NOT A DUPLICATE, NOT ONTO AN OWN PIECE, NOT A CAPTURE p MAY NOT MAKE
				const v = b.sq[sqIndex(m.to)];
				if (!moves.some((o) => key(o) === key(m)) && !(v && (v.c === color || !mayCapture(state, p, v, hooks)))) moves.push(m);
			}
		}
	}
	return moves;
}

/**
 * @description New Board after the move with castling rights, ep square and counters updated, history passed through unchanged (makeMove appends). The input board is not changed.
 */
function applyMove(board, move) {
	const sq = board.sq.slice(), from = sqIndex(move.from), to = sqIndex(move.to);
	const p = { ...sq[from] }, pawn = p.t === "p";
	let captured = !!sq[to];
	if (move.ep) { sq[(from >> 3) * 8 + (to & 7)] = null; captured = true; }
	if (move.castle) {
		const [, rs, , rt] = CASTLES[p.c + move.castle];
		sq[rt] = sq[rs]; sq[rs] = null;
	}
	if (move.promotion) p.t = move.promotion;
	sq[to] = p; sq[from] = null;
	let castling = board.castling;
	for (const s of [from, to]) for (const ch of LOSES[s] || "") castling = castling.replace(ch, "");
	const enemy = p.c === "w" ? "b" : "w";
	let ep = null;
	if (pawn && Math.abs(to - from) === 16) { // EP SQUARE ONLY WHEN AN ENEMY PAWN IS BESIDE THE PAWN, AS IN chess.js
		const beside = [to - 1, to + 1].filter((s) => (s >> 3) === (to >> 3));
		if (beside.some((s) => sq[s] && sq[s].c === enemy && sq[s].t === "p")) ep = sqName((from + to) / 2);
	}
	const nb = {
		sq, turn: enemy, castling: castling || "-", ep,
		half: pawn || captured ? 0 : board.half + 1, full: board.full + (p.c === "b" ? 1 : 0), history: board.history,
	};
	return nb;
}

/**
 * @description applyMove plus the new position key appended to history (for repetition).
 */
function makeMove(board, move) {
	const nb = applyMove(board, move);
	nb.history = [...board.history, positionKey(nb)];
	return nb;
}

module.exports = { LOSES, pseudoMoves, makeMove, applyMove, targets, mayCapture, attacksSquare };
