/*
 *  rules.js  --  chess cards engine
 *	Attacks, check, legal moves and draws. Card rules plug in through `hooks` (default: plain chess).
 *
 */

const { pseudoMoves, applyMove, targets, attacksSquare } = require("./movegen.js");
const { sqIndex, sqName } = require("./board.js");
const { has } = require("./statuses.js");
const { CARDS } = require("./cards/index.js");

// The statuses as one more source of rules: Frozen can't move, Shaken can't capture (so gives no check), Warded can't
// be captured; Hexed only blocks cards. `ignore` is the id of a piece whose statuses are left out (a king spending a
// skull), else null.
const STATUS_RULES = {
	canMove(state, piece, ignore) {
		return piece.id === ignore || !has(state, piece.id, "frozen");
	},
	canCapture(state, attacker, target, ignore) {
		return (attacker.id === ignore || !has(state, attacker.id, "shaken")) && (target.id === ignore || !has(state, target.id, "warded"));
	},
};

/**
 * @description [rules, src] for every card in play that has rules, in a fixed order: placed passives (state.effects,
 * in order), held curses (White's, then Black's), enchantments (state.enchant, in order). src is the effects entry,
 * { owner, card } for a curse, or the enchant entry (src.owner is always its owner).
 */
function rulesInPlay(state) {
	const sources = [];
	for (const entry of state.effects || []) addRules(sources, entry.card.key, entry);
	// A view's opponent has no curses
	for (const color of state.players ? ["w", "b"] : []) {
		for (const card of state.players[color].curses || []) addRules(sources, card.key, { owner: color, card });
	}
	for (const entry of state.enchant || []) addRules(sources, entry.key, entry);
	return sources;
}

function addRules(sources, key, src) {
	const def = CARDS[key];
	if (def && def.rules) sources.push([def.rules, src]);
}

/**
 * @description The card rules in force for this state, as { canMove, canCapture, givesCheck, extraMoves } (each only
 * when some source has it): the statuses, then rulesInPlay. canMove, canCapture and givesCheck are the AND of every
 * source, extraMoves the union. A card's hook gets its instance as a last argument: canMove(s, p, src),
 * canCapture(s, a, t, src), givesCheck(s, p, src), extraMoves(s, p, src). castleThroughCheck(s, color, src) is the OR
 * of every source (true: legalMoves lets color castle while in check or past an attacked square, never onto one, and
 * marks such a castle through: true). Plain chess ({}) when nothing applies. (rules.actions is applied by
 * turn.turnActions, not here.) ignore: a piece id whose own statuses the hooks leave out (turn.kingMoves: a king
 * spending a skull); card rules still apply to it.
 */
function hooksFor(state, ignore = null) {
	const sources = rulesInPlay(state);
	if (state.statuses && Object.keys(state.statuses).length) sources.unshift([STATUS_RULES, ignore]);
	const hooks = {};
	const movers = sourcesWith(sources, "canMove");
	const capturers = sourcesWith(sources, "canCapture");
	const checkers = sourcesWith(sources, "givesCheck");
	const extras = sourcesWith(sources, "extraMoves");
	if (movers.length) {
		hooks.canMove = function canMove(testedState, piece) {
			return movers.every(([rules, src]) => rules.canMove(testedState, piece, src));
		};
	}
	if (capturers.length) {
		hooks.canCapture = function canCapture(testedState, attacker, target) {
			return capturers.every(([rules, src]) => rules.canCapture(testedState, attacker, target, src));
		};
	}
	if (checkers.length) {
		hooks.givesCheck = function givesCheck(testedState, piece) {
			return checkers.every(([rules, src]) => rules.givesCheck(testedState, piece, src));
		};
	}
	if (extras.length) {
		hooks.extraMoves = function extraMoves(testedState, piece) {
			return extras.flatMap(([rules, src]) => rules.extraMoves(testedState, piece, src));
		};
	}
	// OR: one card letting color castle in or through check is enough (Unbroken Line)
	const throughs = sourcesWith(sources, "castleThroughCheck");
	if (throughs.length) {
		hooks.castleThroughCheck = function castleThroughCheck(testedState, color) {
			return throughs.some(([rules, src]) => rules.castleThroughCheck(testedState, color, src));
		};
	}
	return hooks;
}

function sourcesWith(sources, hook) {
	return sources.filter(([rules]) => rules[hook]);
}

/**
 * @description Squares `color` could capture on, card hooks applied (an own piece counts as defended when the hooks
 * would let the attacker take a king there). A move from extraMoves counts as a capture threat on its destination. On
 * an empty or own-piece square canCapture receives the real enemy king as the hypothetical target, so a hook that
 * looks up the target's square sees the king's real square; legality itself uses inCheck on the moved board and is
 * exact. The set leaves out the squares beside a king whose hooks stop it capturing (Frozen, Shaken), though the enemy
 * king still may not step there: the two kings never stand adjacent.
 */
function attacks(state, color, hooks = hooksFor(state)) {
	const board = state.board;
	const out = new Set();
	for (let i = 0; i < 64; i++) {
		const piece = board.sq[i];
		if (!piece || piece.c !== color) continue;
		const reach = targets(board, i, piece);
		if (hooks.extraMoves) {
			for (const move of hooks.extraMoves(state, piece)) reach.push(sqIndex(move.to));
		}
		for (const square of reach) {
			if (!out.has(square) && attacksSquare(state, i, piece, square, hooks)) out.add(square);
		}
	}
	return out;
}

/**
 * @description True when a piece of the other colour attacks color's king by attacksSquare (canMove, canCapture and
 * givesCheck all have to allow it).
 */
function inCheck(state, color, hooks = hooksFor(state)) {
	const board = state.board;
	const king = board.sq.findIndex((piece) => piece && piece.c === color && piece.t === "k");
	if (king < 0) return false;
	for (let i = 0; i < 64; i++) {
		const piece = board.sq[i];
		if (piece && piece.c !== color && attacksSquare(state, i, piece, king, hooks)) return true;
	}
	return false;
}

/**
 * @description Pseudo-moves (optionally narrowed by filter(move)) that leave color's king safe; castling also needs
 * the king not in check and the square it passes over safe, tested like a landing square, unless
 * hooks.castleThroughCheck allows it (that castle is marked through: true). Two legal moves can share from/to and
 * differ only by `castle` (a castle and a plain king slide). A move that takes the enemy king skips the own-king test:
 * the game ends on it (never the case in plain chess, where a king is never capturable).
 */
function legalMoves(state, color, filter, hooks = hooksFor(state)) {
	let moves = pseudoMoves(state, color, hooks);
	if (filter) moves = moves.filter(filter);
	const isChecked = inCheck(state, color, hooks);
	const enemyKing = state.board.sq.find((piece) => piece && piece.c !== color && piece.t === "k");
	return moves.filter((move) => isLegalMove(state, color, move, hooks, isChecked, enemyKing));
}

function isLegalMove(state, color, move, hooks, isChecked, enemyKing) {
	// Taking the king wins at once
	if (enemyKing && move.capture === enemyKing.id) return true;
	if (move.castle) {
		// The landing square is always tested below
		const passOver = { from: move.from, to: sqName((sqIndex(move.from) + sqIndex(move.to)) / 2) };
		if (isChecked || inCheck(afterMove(state, passOver), color, hooks)) {
			if (!(hooks.castleThroughCheck && hooks.castleThroughCheck(state, color))) return false;
			// Only the hook let it through: turn.js resolveMove puts it on the move event (Unbroken Line fires on it). The move
			// is pseudoMoves' own new object, so marking it here is safe.
			move.through = true;
		}
	}
	return !inCheck(afterMove(state, move), color, hooks);
}

function afterMove(state, move) {
	return { ...state, board: applyMove(state.board, move) };
}

/**
 * @description chess.js's insufficient material: K v K, K+minor v K, or only bishops (plus kings) all on one square
 * colour.
 */
function insufficient(board) {
	const left = board.sq.map((piece, square) => piece && { t: piece.t, dark: ((square >> 3) + (square & 7)) & 1 }).filter(Boolean);
	const bishops = left.filter((piece) => piece.t === "b");
	if (left.length === 2) return true;
	if (left.length === 3 && (bishops.length === 1 || left.some((piece) => piece.t === "n"))) return true;
	return left.length === bishops.length + 2 && bishops.every((piece) => piece.dark === bishops[0].dark);
}

/**
 * @description The draws read from the board alone: "repetition", "fifty" or "material", else null.
 */
function boardDraw(board) {
	const key = board.history[board.history.length - 1];
	if (board.history.filter((position) => position === key).length >= 3) return "repetition";
	if (board.half >= 100) return "fifty";
	return insufficient(board) ? "material" : null;
}

/**
 * @description null while play continues, else "stalemate", "repetition", "fifty" or "material" (checkmate is not a
 * draw).
 */
function drawReason(state, hooks = hooksFor(state)) {
	const color = state.board.turn;
	if (!legalMoves(state, color, null, hooks).length) return inCheck(state, color, hooks) ? null : "stalemate";
	return boardDraw(state.board);
}

module.exports = { rulesInPlay, hooksFor, attacks, inCheck, legalMoves, boardDraw, drawReason };
