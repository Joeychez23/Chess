/*
 *  candidates.js  --  chess server
 *	Card Guy: the actions worth scoring
 *  Every card action is kept. The plain chess moves are cut to the engine's best one plus the top 5 by a static score, so a turn fits its engine budget.
 *
 */

const engine = require("../../../cards-engine/index.js");
const { legalMoves, inCheck } = require("../../../cards-engine/rules.js");
const { makeMove } = require("../../../cards-engine/movegen.js");
const hand = require("../../../cards-engine/hand.js");
const { VALUE } = require("./score.js");

const TOP_PLAIN = 5; // PLAIN MOVES KEPT BESIDE bestPlain
const CHECK = 50; // A CHECK'S STATIC SCORE (cp)
const KING = 20000; // TAKING THE KING WINS

const other = (c) => (c === "w" ? "b" : "w");
const shape = (a) => a.from + a.to + (a.promotion || ""); // THE MOVE AS THE ENGINE SPELLS IT (LAN)

/**
 * @description Whether an action is a plain chess move: one of me's move cards or the King card moves a piece. A move a card makes itself (cardless, or under the card's own id) is a card action
 */
function isPlain(sim, me, action) {
	return action.type === "move" && (action.card === "king" || hand.moveCards(sim.players[me]).some((c) => c.id === action.card));
}

/**
 * @description me's legal actions less the ones the real game refused: an action by its key, a plain move under any card of its type too (the same move, the board refused it)
 * @param  {[object]} sim [engine state]
 * @param  {[string]} me ["w" or "b"]
 * @param  {[array]} refused [action keys (engine.actionKey) the real game refused]
 * @return {[array]} actions
 */
function allowed(sim, me, refused = []) {
	const all = engine.legalActions(sim, me);
	if (!refused.length) { return all; }
	const moves = new Set(all.filter((a) => isPlain(sim, me, a) && refused.includes(engine.actionKey(a))).map(shape));
	return all.filter((a) => !refused.includes(engine.actionKey(a)) && !(isPlain(sim, me, a) && moves.has(shape(a))));
}

/**
 * @description A move's static score: a capture by the victim's value less a tenth of the attacker's (most valuable victim, least valuable attacker), a promotion by what the pawn gains, a check
 * @param  {[object]} sim [engine state]
 * @param  {[object]} move [{ from, to, promotion }, a move action]
 * @return {[number]} centipawns
 */
function staticScore(sim, move) {
	const sq = sim.board.sq, piece = sq[engine.board.sqIndex(move.from)], victim = sq[engine.board.sqIndex(move.to)];
	if (!piece) { return 0; }
	let score = 0;
	if (victim && victim.c !== piece.c) { score += (victim.t === "k" ? KING : VALUE[victim.t]) - (VALUE[piece.t] || 0) / 10; } // A KING ATTACKS FOR FREE
	else if (piece.t === "p" && move.from[0] !== move.to[0]) { score += VALUE.p * 0.9; } // EN PASSANT
	if (move.promotion) { score += VALUE[move.promotion] - VALUE.p; }
	const found = legalMoves(sim, piece.c, (m) => m.from === move.from).find((m) => m.to === move.to && m.promotion === move.promotion); // A KING MOVE PAID WITH A SKULL ISN'T AMONG THESE: NO CHECK BONUS
	if (found && !(victim && victim.t === "k") && inCheck({ ...sim, board: makeMove(sim.board, found) }, other(piece.c))) { score += CHECK; }
	return score;
}

/**
 * @description me's plain moves, one per move (two cards of a type make the same one), best static score first
 * @param  {[object]} sim [engine state]
 * @param  {[string]} me ["w" or "b"]
 * @param  {[array]} refused [action keys the real game refused]
 * @return {[array]} move actions
 */
function plainMoves(sim, me, refused = []) {
	const seen = new Set(), moves = [];
	for (const a of allowed(sim, me, refused)) {
		if (!isPlain(sim, me, a) || seen.has(shape(a))) { continue; }
		seen.add(shape(a));
		moves.push(a);
	}
	return moves.map((a) => [staticScore(sim, a), a]).sort((x, y) => y[0] - x[0]).map((x) => x[1]);
}

/**
 * @description The actions Card Guy scores, in the order the engine budget is spent: bestPlain, the top 5 other plain moves, then every card action (moves a card makes first, by static score).
 * No discard with two skips already (a third forfeits the game), unless nothing else is left
 * @param  {[object]} sim [engine state Card Guy simulates on]
 * @param  {[string]} me ["w" or "b"]
 * @param  {[object]} options [{ bestPlain: the engine's pick among the plain moves ({ from, to, promotion }), refused: action keys the real game refused }]
 * @return {[array]} actions
 */
function candidates(sim, me, { bestPlain, refused = [] } = {}) {
	const all = allowed(sim, me, refused);
	const plain = plainMoves(sim, me, refused), best = bestPlain && plain.find((a) => shape(a) === shape(bestPlain));
	const cards = all.filter((a) => !isPlain(sim, me, a) && !(a.type === "discard" && sim.players[me].skips >= 2));
	const rank = (a) => (a.type === "move" ? staticScore(sim, a) : 0);
	const out = [...(best ? [best] : []), ...plain.filter((a) => a !== best).slice(0, TOP_PLAIN), ...cards.map((a) => [rank(a), a]).sort((x, y) => y[0] - x[0]).map((x) => x[1])];
	return out.length ? out : all;
}

module.exports = { candidates, plainMoves, allowed, staticScore, isPlain, shape };
