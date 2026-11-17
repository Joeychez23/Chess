/*
 *  rules.js  --  chess cards engine
 *	Attacks, check, legal moves and draws. Card rules plug in through `hooks` (default: plain chess).
 *
 */

const { pseudoMoves, applyMove, targets, attacksSquare } = require("./movegen.js");
const { sqIndex, sqName } = require("./board.js");
const { has } = require("./statuses.js");
const { CARDS } = require("./cards/index.js");

// THE STATUSES AS ONE MORE SOURCE OF RULES: FROZEN CAN'T MOVE, SHAKEN CAN'T CAPTURE (SO GIVES NO CHECK), WARDED CAN'T BE CAPTURED; HEXED ONLY BLOCKS CARDS. src = THE ID OF A PIECE WHOSE STATUSES ARE IGNORED (A KING SPENDING A SKULL), ELSE null
const STATUS_RULES = {
	canMove: (s, p, ignore) => p.id === ignore || !has(s, p.id, "frozen"),
	canCapture: (s, a, t, ignore) => (a.id === ignore || !has(s, a.id, "shaken")) && (t.id === ignore || !has(s, t.id, "warded")),
};

/**
 * @description [rules, src] for every card in play that has rules, in a fixed order: placed passives (state.effects, in order), held curses (White's, then Black's), enchantments (state.enchant, in order). src is the effects entry, { owner, card } for a curse, or the enchant entry (src.owner is always its owner).
 */
function rulesInPlay(state) {
	const out = [], add = (key, at) => { const def = CARDS[key]; if (def && def.rules) out.push([def.rules, at]); };
	for (const e of state.effects || []) add(e.card.key, e);
	for (const c of state.players ? ["w", "b"] : []) for (const card of state.players[c].curses || []) add(card.key, { owner: c, card }); // A VIEW'S OPPONENT HAS NO curses
	for (const e of state.enchant || []) add(e.key, e);
	return out;
}

/**
 * @description The card rules in force for this state, as { canMove, canCapture, givesCheck, extraMoves } (each only when some source has it): the statuses, then rulesInPlay. canMove, canCapture and givesCheck are the AND of every source, extraMoves the union. A card's hook gets its instance as a last argument: canMove(s, p, src), canCapture(s, a, t, src), givesCheck(s, p, src), extraMoves(s, p, src). Plain chess ({}) when nothing applies. (rules.actions is applied by turn.turnActions, not here.) ignore: a piece id whose own statuses the hooks leave out (turn.kingMoves: a king spending a skull); card rules still apply to it.
 */
function hooksFor(state, ignore = null) {
	const src = rulesInPlay(state);
	if (state.statuses && Object.keys(state.statuses).length) src.unshift([STATUS_RULES, ignore]);
	const hooks = {}, by = (k) => src.filter(([r]) => r[k]);
	const move = by("canMove"), cap = by("canCapture"), check = by("givesCheck"), extra = by("extraMoves");
	if (move.length) hooks.canMove = (s, p) => move.every(([r, at]) => r.canMove(s, p, at));
	if (cap.length) hooks.canCapture = (s, a, t) => cap.every(([r, at]) => r.canCapture(s, a, t, at));
	if (check.length) hooks.givesCheck = (s, p) => check.every(([r, at]) => r.givesCheck(s, p, at));
	if (extra.length) hooks.extraMoves = (s, p) => extra.flatMap(([r, at]) => r.extraMoves(s, p, at));
	return hooks;
}

/**
 * @description Squares `color` could capture on, card hooks applied (an own piece counts as defended when the hooks would let the attacker take a king there). A move from extraMoves counts as a capture threat on its destination. On an empty or own-piece square canCapture receives the real enemy king as the hypothetical target, so a hook that looks up the target's square sees the king's real square; legality itself uses inCheck on the moved board and is exact. The set leaves out the squares beside a king whose hooks stop it capturing (Frozen, Shaken), though the enemy king still may not step there: the two kings never stand adjacent.
 */
function attacks(state, color, hooks = hooksFor(state)) {
	const b = state.board, out = new Set();
	for (let i = 0; i < 64; i++) {
		const p = b.sq[i];
		if (!p || p.c !== color) continue;
		const reach = targets(b, i, p);
		if (hooks.extraMoves) for (const m of hooks.extraMoves(state, p)) reach.push(sqIndex(m.to));
		for (const s of reach) if (!out.has(s) && attacksSquare(state, i, p, s, hooks)) out.add(s);
	}
	return out;
}

/**
 * @description True when a piece of the other colour attacks color's king by attacksSquare (canMove, canCapture and givesCheck all have to allow it).
 */
function inCheck(state, color, hooks = hooksFor(state)) {
	const b = state.board, k = b.sq.findIndex((p) => p && p.c === color && p.t === "k");
	if (k < 0) return false;
	for (let i = 0; i < 64; i++) {
		const p = b.sq[i];
		if (p && p.c !== color && attacksSquare(state, i, p, k, hooks)) return true;
	}
	return false;
}

/**
 * @description Pseudo-moves (optionally narrowed by filter(move)) that leave color's king safe; castling also needs the king not in check and the square it passes over safe, tested like a landing square. Two legal moves can share from/to and differ only by `castle` (a castle and a plain king slide). A move that takes the enemy king skips the own-king test: the game ends on it (never the case in plain chess, where a king is never capturable).
 */
function legalMoves(state, color, filter, hooks = hooksFor(state)) {
	let moves = pseudoMoves(state, color, hooks);
	if (filter) moves = moves.filter(filter);
	const checked = inCheck(state, color, hooks), enemyKing = state.board.sq.find((p) => p && p.c !== color && p.t === "k");
	const after = (m) => ({ ...state, board: applyMove(state.board, m) });
	return moves.filter((m) => {
		if (enemyKing && m.capture === enemyKing.id) return true; // TAKING THE KING WINS AT ONCE
		if (m.castle) {
			const mid = sqName((sqIndex(m.from) + sqIndex(m.to)) / 2);
			if (checked || inCheck(after({ from: m.from, to: mid }), color, hooks)) return false;
		}
		return !inCheck(after(m), color, hooks);
	});
}

/**
 * @description chess.js's insufficient material: K v K, K+minor v K, or only bishops (plus kings) all on one square colour.
 */
function insufficient(b) {
	const left = b.sq.map((p, i) => p && { t: p.t, dark: ((i >> 3) + (i & 7)) & 1 }).filter(Boolean);
	const bishops = left.filter((p) => p.t === "b");
	if (left.length === 2) return true;
	if (left.length === 3 && (bishops.length === 1 || left.some((p) => p.t === "n"))) return true;
	return left.length === bishops.length + 2 && bishops.every((p) => p.dark === bishops[0].dark);
}

/**
 * @description The draws read from the board alone: "repetition", "fifty" or "material", else null.
 */
function boardDraw(b) {
	const key = b.history[b.history.length - 1];
	if (b.history.filter((k) => k === key).length >= 3) return "repetition";
	if (b.half >= 100) return "fifty";
	return insufficient(b) ? "material" : null;
}

/**
 * @description null while play continues, else "stalemate", "repetition", "fifty" or "material" (checkmate is not a draw).
 */
function drawReason(state, hooks = hooksFor(state)) {
	const b = state.board, color = b.turn;
	if (!legalMoves(state, color, null, hooks).length) return inCheck(state, color, hooks) ? null : "stalemate";
	return boardDraw(b);
}

module.exports = { rulesInPlay, hooksFor, attacks, inCheck, legalMoves, boardDraw, drawReason };
