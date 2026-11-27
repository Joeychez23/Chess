/*
 *  opposing-finality.js  --  chess cards engine
 *	Active: one of your non-king pieces is enchanted (and Marked); if it is captured, the opponent hands you one of
 *	their pieces one stage below it.
 *
 */

const statuses = require("../../statuses.js");
const { pieceById, sqIndex, sqName } = require("../../board.js");
const { CASTLING_LOST, attacksSquare } = require("../../movegen.js");
const { inCheck, hooksFor } = require("../../rules.js");

const KEY = "opposing-finality";
const PIECE_STAGE = { p: 0, n: 1, b: 1, r: 2, q: 3 };
// The type the pending choice keeps: offer asks for the same stage, and a fogged knight must not read as one
const KEPT_TYPE = { q: "q", r: "r", n: "p", b: "p", p: "p" };
// Start files on the back rank
const START_FILES = { n: [1, 6], b: [2, 5], r: [0, 7] };

function other(color) {
	return color === "w" ? "b" : "w";
}

/**
 * @description 1 for a dark square, 0 for a light one.
 */
function squareColor(square) {
	return ((square >> 3) + (square & 7)) & 1;
}

/**
 * @description Distance between two square indexes: king distance first, then straight-line steps (so of two squares
 * 7 king steps away, the one on the same file is nearer).
 */
function dist(first, second) {
	const ranks = Math.abs((first >> 3) - (second >> 3)), files = Math.abs((first & 7) - (second & 7));
	return Math.max(ranks, files) * 16 + ranks + files;
}

/**
 * @description Ids of the pieces checking color's king on state, under hooks.
 */
function checkers(state, color, hooks) {
	const sq = state.board.sq, king = sq.findIndex((piece) => piece && piece.c === color && piece.t === "k");
	if (king < 0) return [];
	return sq.filter((piece, square) => piece && piece.c !== color && attacksSquare(state, square, piece, king, hooks))
		.map((piece) => piece.id);
}

/**
 * @description The square index where the piece on pieceSquare lands when handed to colour `to`, or -1 when it can't be
 * handed over. -1 when its leaving adds a checker on the giver's king, or, on to's own turn (turn === to), puts to's
 * king in check. Else its start squares on to's side, nearest first, else the empty square nearest the first of them:
 * the first that is empty (or the piece's own) where the piece, in to's colour, does not attack the giver's king;
 * -1 when none. Only what this piece causes counts: a check that stood before is not its to lift or block.
 * The giver's enchantments on the piece are left out (they end when it changes sides); a pawn never lands on a back rank.
 */
function landing(state, pieceSquare, to, turn) {
	const board = state.board, piece = board.sq[pieceSquare], giver = piece.c;
	const enchant = state.enchant.filter((entry) => !(entry.owner === giver && entry.pieces.includes(piece.id)));
	const probe = { ...state, enchant }, hooks = hooksFor(probe);
	const emptied = board.sq.slice(),
		giverKing = board.sq.findIndex((boardPiece) => boardPiece && boardPiece.c === giver && boardPiece.t === "k");
	emptied[pieceSquare] = null;
	const left = { ...probe, board: { ...board, sq: emptied } }, was = checkers(probe, giver, hooks);
	if (checkers(left, giver, hooks).some((checker) => !was.includes(checker))) return -1; // its leaving uncovers a check on the giver
	if (turn === to && !inCheck(state, to) && inCheck(left, to)) return -1; // its leaving would end the owner's own turn in check

	const starts = startSquares(piece, pieceSquare, to);
	const hit = starts.find((square) => isSafeLanding(probe, emptied, pieceSquare, square, to, giverKing, hooks));
	if (hit !== undefined) return hit;
	const byDistance = [...Array(64).keys()].sort((a, b) => dist(starts[0], a) - dist(starts[0], b) || a - b);
	const near = byDistance.find((square) => isSafeLanding(probe, emptied, pieceSquare, square, to, giverKing, hooks));
	return near === undefined ? -1 : near;
}

/**
 * @description The start squares on to's side for the piece on pieceSquare, nearest first: a pawn its file on to's second
 * rank; a bishop the one of its square colour; a rook or knight either.
 */
function startSquares(piece, pieceSquare, to) {
	if (piece.t === "p") return [(to === "w" ? 6 : 1) * 8 + (pieceSquare & 7)];
	const back = to === "w" ? 7 : 0;
	return START_FILES[piece.t]
		.map((f) => back * 8 + f)
		.filter((square) => piece.t !== "b" || squareColor(square) === squareColor(pieceSquare))
		.sort((a, b) => dist(pieceSquare, a) - dist(pieceSquare, b));
}

/**
 * @description Whether square (empty, or the piece's own pieceSquare; never a back rank for a pawn) takes the piece
 * from pieceSquare in to's colour without it attacking the giver's king. emptied is the board without the piece.
 */
function isSafeLanding(probe, emptied, pieceSquare, square, to, giverKing, hooks) {
	const board = probe.board, piece = board.sq[pieceSquare];
	if ((board.sq[square] && square !== pieceSquare) || (piece.t === "p" && (square >> 3) % 7 === 0)) return false;
	const sq = emptied.slice(), moved = sq[square] = { ...piece, c: to };
	return giverKing < 0 || !attacksSquare({ ...probe, board: { ...board, sq } }, square, moved, giverKing, hooks);
}

/**
 * @description What owner gets for a captured piece of capturedType: { pieces, chooser }. pieces: the giver's non-king
 * pieces of the highest stage at or below capturedType's stage minus one (a pawn for a pawn) that have a landing square; chooser: the giver
 * at that exact stage, else owner. No pieces when the giver has none (only the king). turn: the colour whose turn is in
 * progress (landing).
 */
function offer(state, owner, capturedType, turn) {
	const giver = other(owner), want = Math.max(PIECE_STAGE[capturedType] - 1, 0);
	const list = state.board.sq.filter((piece, square) => piece && piece.c === giver && piece.t !== "k" && PIECE_STAGE[piece.t] <= want
		&& landing(state, square, owner, turn) >= 0);
	const top = Math.max(...list.map((piece) => PIECE_STAGE[piece.t]));
	return { pieces: list.filter((piece) => PIECE_STAGE[piece.t] === top), chooser: top === want ? giver : owner };
}

/**
 * @description The ids of the other side's pieces hidden from viewer by that side's Fog of War (any version): its pieces
 * on its own half, as view.js hiddenIds; [] with no such fog.
 */
function hiddenFrom(state, viewer) {
	const { fogged } = require("../../view.js"); // lazy: view.js requires the registry, which requires this file
	const color = other(viewer);
	if (!fogged(state, color, viewer)) return [];
	return state.board.sq.filter((piece, square) => piece && piece.c === color && (color === "w" ? square >= 32 : square < 32))
		.map((piece) => piece.id);
}

/**
 * @description The piece with this id changes to owner's colour (same id, statuses kept) and moves to its landing
 * square; castling rights its squares hold go, an en passant square behind it goes, a pawn moved resets the half-move
 * counter; a handover event { player: owner, piece, from, to }.
 */
function handOver(ctx, owner, id) {
	const board = ctx.state.board, pieceSquare = pieceById(board, id);
	const landingSquare = pieceSquare < 0 || board.sq[pieceSquare].c === owner ? -1 : landing(ctx.state, pieceSquare, owner, ctx.turn);
	// Gone, already owner's (two queued choices offering it), or no longer safe to hand over
	if (landingSquare < 0) return;
	const piece = board.sq[pieceSquare];
	board.sq[pieceSquare] = null;
	board.sq[landingSquare] = piece;
	piece.c = owner;
	for (const square of [pieceSquare, landingSquare]) {
		for (const right of CASTLING_LOST[square] || "") board.castling = board.castling.replace(right, "");
	}
	board.castling = board.castling || "-";
	if (piece.t === "p") {
		// Its double step names a pawn that is no longer the giver's
		if (board.ep && sqIndex(board.ep) + (owner === "w" ? 8 : -8) === pieceSquare) board.ep = null;
		ctx.resetHalf = true;
	}
	ctx.emit({ type: "handover", player: owner, piece: id, from: sqName(pieceSquare), to: sqName(landingSquare) });
}

/**
 * @description The enchanted piece changed sides (handed over, still on the board): the enchantment ends. Off the board
 * is the capture handler's.
 */
function turned(ctx, owner, ev, src) {
	const board = ctx.state.board, square = pieceById(board, src.pieces[0]);
	return square >= 0 && board.sq[square].c !== src.owner;
}

module.exports = {
	key: KEY, kind: "active", name: "Opposing Finality", skulls: 2, rarity: "rare",
	text: "Enchant one of your non-king pieces. If it is captured, the opponent must hand you one of their pieces one stage below it (stages: pawn < knight/bishop < rook < queen; their choice within the stage). A captured queen takes a rook, a rook takes a knight or bishop, a knight or bishop takes a pawn, and a pawn takes a pawn. If they have no piece of that stage, go down to the highest lower stage they do have, and the enchanted piece's owner picks the piece within it. Never a piece above that stage. If they have only their king, nothing happens. It switches to your color and goes to its starting square on your side (bishops to the one of matching square color; pawns to their file on your second rank; rooks and knights to either, nearest first). If that square is taken, or the piece would give check from it, it goes to the nearest empty square where it doesn't. Debuff: the enchanted piece is Marked.",
	/**
	 * @description { piece } for every own non-king piece not already enchanted by player's Opposing Finality.
	 */
	targets(state, player) {
		const held = state.enchant.filter((entry) => entry.key === KEY && entry.owner === player).flatMap((entry) => entry.pieces);
		return state.board.sq.filter((piece) => piece && piece.c === player && piece.t !== "k" && !held.includes(piece.id))
			.map((piece) => ({ piece: piece.id }));
	},
	/**
	 * @description An opposing-finality enchantment on the piece (no end) and the piece Marked for as long (statuses.claimMark).
	 */
	play(ctx, player, target) {
		statuses.claimMark(ctx, ctx.enchant(player, KEY, [target.piece]), target.piece);
	},
	on: {
		/**
		 * @description Its piece captured by the other side (by a move or a card): the hand-over, at once when one piece
		 * qualifies, else through the chooser's choice; nothing when the giver has only the king.
		 * The choice's options: the ids of the offered pieces the chooser sees, then "?1".."?k", one per offered piece the
		 * giver's Fog of War hides from them (an id would tell where it stands, and with none listed the choice could not
		 * be answered). The pending keeps t, a type offer asks the same stage for (a knight or bishop kept as a pawn: the
		 * captured type may be fogged), never a hidden id. Fires either way; a removal by its own side just ends it.
		 */
		capture(ctx, owner, ev, src) {
			if (ev.piece !== src.pieces[0] || ev.c !== src.owner) return false;
			if (ev.player === ev.c) return true; // a removal by its own side (a forfeit, a lost duel) is not a capture: it just ends
			const { pieces, chooser } = offer(ctx.state, owner, ev.t, ctx.turn);
			if (pieces.length === 1) handOver(ctx, owner, pieces[0].id);
			else if (pieces.length) {
				const hid = hiddenFrom(ctx.state, chooser), seen = pieces.filter((piece) => !hid.includes(piece.id)).map((piece) => piece.id);
				const slots = Array.from({ length: pieces.length - seen.length }, (_, i) => "?" + (i + 1));
				ctx.ask(chooser, KEY, [...seen, ...slots], { card: KEY, owner, t: KEPT_TYPE[ev.t] });
			}
			return true;
		},
		move: turned,
		handover: turned,
		"turn-start": turned,
		/**
		 * @description Its Mark removed (Cleanse): the enchantment ends with it.
		 */
		"status-ended"(ctx, owner, ev, src) {
			return ev.piece === src.pieces[0] && ev.s === "marked";
		},
		/**
		 * @description Its own end: the Mark goes unless another card or status needs it (statuses.releaseMark; nothing
		 * when the piece is gone). Since no card clears a Mark it doesn't own, a status-ended of its piece's Mark while it
		 * lasts is Cleanse.
		 */
		"enchant-ended"(ctx, owner, ev, src) {
			statuses.releaseMark(ctx, src, src.pieces[0]);
		},
	},
	choice: {
		/**
		 * @description The chosen piece (an id) is handed to pending.owner. A slot ("?n") hands over a uniform random pick
		 * (state.rng) among the pieces offered now (offer for pending.t) and not listed by id; none left: nothing.
		 */
		resolve(ctx, pending, option) {
			if (option[0] !== "?") return handOver(ctx, pending.owner, option);
			const left = offer(ctx.state, pending.owner, pending.t, ctx.turn).pieces.filter((piece) => !pending.options.includes(piece.id));
			if (left.length) handOver(ctx, pending.owner, ctx.rng.pick(left).id);
		},
	},
};
