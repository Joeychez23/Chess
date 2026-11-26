/*
 *  movegen.js  --  chess cards engine
 *	Pseudo-legal move generation and makeMove. Card rules plug in through `hooks`.
 *
 */

const { sqName, sqIndex, positionKey } = require("./board.js");

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ORTHOGONAL = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAGONAL = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const RAYS = { r: ORTHOGONAL, b: DIAGONAL, q: [...ORTHOGONAL, ...DIAGONAL] };
// Castling by colour and side: [king square, rook square, king target, rook target, squares that must be empty]
const CASTLES = {
	wK: [60, 63, 62, 61, [61, 62]],
	wQ: [60, 56, 58, 59, [57, 58, 59]],
	bK: [4, 7, 6, 5, [5, 6]],
	bQ: [4, 0, 2, 3, [1, 2, 3]],
};
// A move from or to one of these squares loses the castling rights listed
const CASTLING_LOST = { 60: "KQ", 4: "kq", 63: "K", 56: "Q", 7: "k", 0: "q" };

/**
 * @description Squares the piece standing on `from` attacks on this board (pawns: both diagonals; sliders stop at the
 * first piece, own pieces included).
 */
function targets(board, from, piece) {
	const rank = from >> 3;
	const file = from & 7;
	const out = [];
	if (piece.t === "p") {
		const forward = piece.c === "w" ? -1 : 1;
		for (const side of [-1, 1]) {
			const square = squareAt(rank + forward, file + side);
			if (square !== null) out.push(square);
		}
	} else if (piece.t === "n" || piece.t === "k") {
		for (const [dr, df] of piece.t === "n" ? KNIGHT : KING) {
			const square = squareAt(rank + dr, file + df);
			if (square !== null) out.push(square);
		}
	} else {
		for (const [dr, df] of RAYS[piece.t]) {
			for (let step = 1; step < 8; step++) {
				const square = squareAt(rank + dr * step, file + df * step);
				if (square === null) break;
				out.push(square);
				if (board.sq[square]) break;
			}
		}
	}
	return out;
}

/**
 * @description The index of the square at rank and file, or null when that is off the board.
 */
function squareAt(rank, file) {
	if (rank < 0 || rank > 7 || file < 0 || file > 7) return null;
	return rank * 8 + file;
}

/**
 * @description The one answer to "may this piece capture the target": canMove and canCapture allow it, and, when the
 * target is a king, givesCheck too. Hooks get the piece objects ({ id, c, t }, no square).
 */
function mayCapture(state, piece, target, hooks) {
	if (hooks.canMove && !hooks.canMove(state, piece)) return false;
	if (hooks.canCapture && !hooks.canCapture(state, piece, target)) return false;
	return target.t !== "k" || !hooks.givesCheck || hooks.givesCheck(state, piece);
}

/**
 * @description The one answer to "does the piece on `from` attack `square`": its normal targets or extraMoves reach the
 * square, and the piece may capture there. An empty square, or one holding the piece's own side (defended only if the
 * piece could take a king there), is tested against the enemy king (mayCapture, which asks givesCheck when the target
 * is a king). A move from extraMoves counts as a capture threat on its destination. A king always attacks the enemy
 * king on a neighbouring square, whatever the hooks say, so the two kings never stand side by side.
 */
function attacksSquare(state, from, piece, square, hooks) {
	const board = state.board;
	const standing = board.sq[square];
	// No hook applies here: a Frozen or Shaken king could otherwise be mated by a bare king
	if (piece.t === "k" && standing && standing.t === "k" && standing.c !== piece.c && targets(board, from, piece).includes(square)) {
		return true;
	}
	if (hooks.canMove && !hooks.canMove(state, piece)) return false;
	let isHit = targets(board, from, piece).includes(square);
	if (!isHit && hooks.extraMoves) {
		const to = sqName(square);
		isHit = hooks.extraMoves(state, piece).some((move) => move.to === to);
	}
	if (!isHit) return false;
	if (!hooks.canCapture && !hooks.givesCheck) return true;
	let target = standing && standing.c !== piece.c && standing;
	if (!target) target = board.sq.find((other) => other && other.c !== piece.c && other.t === "k");
	if (!target) target = { id: null, c: piece.c === "w" ? "b" : "w", t: "k" };
	return mayCapture(state, piece, target, hooks);
}

/**
 * @description Pseudo-legal moves for `color` (own king safety is not checked; see rules.legalMoves). Plain chess when
 * hooks is empty. hooks.extraMoves(state, piece) returns Move[], and its contract is that each move can also capture
 * on its destination.
 */
function pseudoMoves(state, color, hooks = {}) {
	const board = state.board;
	const moves = [];
	for (let i = 0; i < 64; i++) {
		const piece = board.sq[i];
		if (!piece || piece.c !== color || (hooks.canMove && !hooks.canMove(state, piece))) continue;
		if (piece.t === "p") addPawnMoves(state, moves, i, piece, hooks);
		else addPieceMoves(state, moves, i, piece, hooks);
		if (hooks.extraMoves) addExtraMoves(state, moves, piece, hooks);
	}
	return moves;
}

/**
 * @description A pawn's pushes (one square, or two from its start rank), its captures and its en passant capture.
 */
function addPawnMoves(state, moves, from, pawn, hooks) {
	const board = state.board;
	const color = pawn.c;
	const forward = color === "w" ? -1 : 1;
	const one = from + forward * 8;
	if (!board.sq[one]) {
		addPawnMove(moves, from, pawn, one);
		const startRank = color === "w" ? 6 : 1;
		if ((from >> 3) === startRank && !board.sq[one + forward * 8]) addPawnMove(moves, from, pawn, one + forward * 8);
	}
	for (const to of targets(board, from, pawn)) {
		const target = board.sq[to];
		if (target && target.c !== color && mayCapture(state, pawn, target, hooks)) {
			addPawnMove(moves, from, pawn, to, { capture: target.id });
		} else if (board.ep && to === sqIndex(board.ep)) {
			const passed = board.sq[(from >> 3) * 8 + (to & 7)];
			if (passed && passed.c !== color && passed.t === "p" && mayCapture(state, pawn, passed, hooks)) {
				addPawnMove(moves, from, pawn, to, { capture: passed.id, ep: true });
			}
		}
	}
}

/**
 * @description One pawn move, or one move for each promotion when it reaches the last rank.
 */
function addPawnMove(moves, from, pawn, to, extra) {
	const lastRank = pawn.c === "w" ? 0 : 7;
	if ((to >> 3) !== lastRank) {
		moves.push(newMove(from, pawn, to, extra));
		return;
	}
	for (const promotion of ["q", "r", "b", "n"]) moves.push(newMove(from, pawn, to, { ...extra, promotion }));
}

/**
 * @description Every other piece's steps and captures, and a king's castles.
 */
function addPieceMoves(state, moves, from, piece, hooks) {
	const board = state.board;
	for (const to of targets(board, from, piece)) {
		const target = board.sq[to];
		if (!target) {
			moves.push(newMove(from, piece, to));
		} else if (target.c !== piece.c && mayCapture(state, piece, target, hooks)) {
			moves.push(newMove(from, piece, to, { capture: target.id }));
		}
	}
	if (piece.t === "k") addCastles(state, moves, from, piece, hooks);
}

/**
 * @description The king's castles: the right is still held, the rook stands on its square, the squares between are
 * empty and the rook may move (safety is checked in rules.legalMoves).
 */
function addCastles(state, moves, from, king, hooks) {
	const board = state.board;
	const color = king.c;
	for (const side of ["K", "Q"]) {
		const [kingSquare, rookSquare, kingTarget, , between] = CASTLES[color + side];
		const rook = board.sq[rookSquare];
		const right = color === "w" ? side : side.toLowerCase();
		if (kingSquare !== from || !board.castling.includes(right)) continue;
		if (!rook || rook.c !== color || rook.t !== "r") continue;
		if (!between.every((square) => !board.sq[square])) continue;
		if (hooks.canMove && !hooks.canMove(state, rook)) continue;
		moves.push(newMove(from, king, kingTarget, { castle: side }));
	}
}

/**
 * @description The card moves of one piece: not a duplicate of a move already listed, not onto an own piece, and not
 * a capture the piece may not make.
 */
function addExtraMoves(state, moves, piece, hooks) {
	const board = state.board;
	for (const move of hooks.extraMoves(state, piece)) {
		const target = board.sq[sqIndex(move.to)];
		if (moves.some((listed) => moveKey(listed) === moveKey(move))) continue;
		if (target && (target.c === piece.c || !mayCapture(state, piece, target, hooks))) continue;
		moves.push(move);
	}
}

function newMove(from, piece, to, extra) {
	return { from: sqName(from), to: sqName(to), piece: piece.id, t: piece.t, ...extra };
}

// A castle is not a duplicate of a king's slide to the same square
function moveKey(move) {
	return move.from + move.to + (move.promotion || "") + (move.castle || "");
}

/**
 * @description New Board after the move, with castling rights, the en passant square and the counters updated, and
 * history passed through unchanged (makeMove appends). The input board is not changed.
 */
function applyMove(board, move) {
	const sq = board.sq.slice();
	const from = sqIndex(move.from);
	const to = sqIndex(move.to);
	const piece = { ...sq[from] };
	const isPawn = piece.t === "p";
	let isCapture = !!sq[to];
	if (move.ep) {
		sq[(from >> 3) * 8 + (to & 7)] = null;
		isCapture = true;
	}
	if (move.castle) {
		const [, rookSquare, , rookTarget] = CASTLES[piece.c + move.castle];
		sq[rookTarget] = sq[rookSquare];
		sq[rookSquare] = null;
	}
	if (move.promotion) piece.t = move.promotion;
	sq[to] = piece;
	sq[from] = null;
	let castling = board.castling;
	for (const square of [from, to]) {
		for (const right of CASTLING_LOST[square] || "") castling = castling.replace(right, "");
	}
	const enemy = piece.c === "w" ? "b" : "w";
	let ep = null;
	// An en passant square only when an enemy pawn stands beside the pawn, as in chess.js
	if (isPawn && Math.abs(to - from) === 16) {
		const beside = [to - 1, to + 1].filter((square) => (square >> 3) === (to >> 3));
		if (beside.some((square) => sq[square] && sq[square].c === enemy && sq[square].t === "p")) ep = sqName((from + to) / 2);
	}
	return {
		sq,
		turn: enemy,
		castling: castling || "-",
		ep,
		half: isPawn || isCapture ? 0 : board.half + 1,
		full: board.full + (piece.c === "b" ? 1 : 0),
		history: board.history,
	};
}

/**
 * @description applyMove plus the new position key appended to history (for repetition).
 */
function makeMove(board, move) {
	const next = applyMove(board, move);
	next.history = [...board.history, positionKey(next)];
	return next;
}

module.exports = { CASTLING_LOST, pseudoMoves, makeMove, applyMove, targets, mayCapture, attacksSquare };
