/*
 *  candidates.js  --  chess server
 *	Card Guy: the actions worth scoring
 *  Every card action is kept. The plain chess moves are cut to the engine's best one plus the top 5 by a static score,
 *  so a turn fits its engine budget.
 *
 */

const engine = require("../../../cards-engine/index.js");
const { legalMoves, inCheck } = require("../../../cards-engine/rules.js");
const { makeMove } = require("../../../cards-engine/movegen.js");
const hand = require("../../../cards-engine/hand.js");
const { CARDS, baseKey } = require("../../../cards-engine/cards/index.js");
const { VALUE } = require("./score.js");

// Plain moves kept beside bestPlain
const TOP_PLAIN = 5;
// A check's static score (centipawns)
const CHECK_SCORE = 50;
// Waiting passives a player may have
const { PASSIVES } = engine;
// Taking the king wins
const KING_CAPTURE_SCORE = 20000;

function other(color) {
	return color === "w" ? "b" : "w";
}

// The move as the engine spells it (LAN)
function shape(move) {
	return move.from + move.to + (move.promotion || "");
}

/**
 * @description Whether an action is a plain chess move: one of me's move cards or the King card moves a piece. A move a
 * card makes itself (cardless, or under the card's own id) is a card action
 */
function isPlain(sim, me, action) {
	return action.type === "move" && (action.card === "king" || hand.moveCards(sim.players[me]).some((card) => card.id === action.card));
}

/**
 * @description me's legal actions less the ones the real game refused: an action by its key, a plain move under any card
 * of its type too (the same move, the board refused it), and every free discard once one was refused. With told, only
 * the actions the real game lists: an entered Mirage is a move card in Card Guy's view, and in check the game lists no
 * move for it
 * @param  {[object]} sim [engine state]
 * @param  {[string]} me ["w" or "b"]
 * @param  {[array]} refused [action keys (engine.actionKey) the real game refused]
 * @param  {[array]} told [the keys of the legal actions the real game tells Card Guy, null when it tells them only in
 * part (a Fog of War) or not at all]
 * @return {[array]} actions
 */
function allowed(sim, me, refused = [], told = null) {
	const all = engine.legalActions(sim, me).filter((action) => !told || told.includes(engine.actionKey(action)));
	if (!refused.length) {
		return all;
	}
	const refusedMoves = new Set(all.filter((action) => isPlain(sim, me, action) && refused.includes(engine.actionKey(action))).map(shape));
	// One discard refused means all are: of the cards it holds, only a check its fog guess missed (or a used card)
	// makes the game refuse a discard
	const noDiscard = refused.some((key) => JSON.parse(key).type === "discard");
	return all.filter((action) => {
		const isRefused = refused.includes(engine.actionKey(action));
		const isRefusedDiscard = noDiscard && action.type === "discard";
		const isRefusedMove = isPlain(sim, me, action) && refusedMoves.has(shape(action));
		return !isRefused && !isRefusedDiscard && !isRefusedMove;
	});
}

/**
 * @description A move's static score: a capture by the victim's value less a tenth of the attacker's (most valuable
 * victim, least valuable attacker), a promotion by what the pawn gains, a check
 * @param  {[object]} sim [engine state]
 * @param  {[object]} move [{ from, to, promotion }, a move action]
 * @return {[number]} centipawns
 */
function staticScore(sim, move) {
	const sq = sim.board.sq;
	const piece = sq[engine.board.sqIndex(move.from)];
	const victim = sq[engine.board.sqIndex(move.to)];
	if (!piece) {
		return 0;
	}
	let score = 0;
	if (victim && victim.c !== piece.c) {
		// A king attacks for free
		score += (victim.t === "k" ? KING_CAPTURE_SCORE : VALUE[victim.t]) - (VALUE[piece.t] || 0) / 10;
	} else if (piece.t === "p" && move.from[0] !== move.to[0]) {
		// En passant
		score += VALUE.p * 0.9;
	}
	if (move.promotion) {
		score += VALUE[move.promotion] - VALUE.p;
	}
	// A king move paid with a skull isn't among these, so it gets no check bonus
	const found = legalMoves(sim, piece.c, (candidate) => candidate.from === move.from)
		.find((candidate) => candidate.to === move.to && candidate.promotion === move.promotion);
	if (found && !(victim && victim.t === "k") && inCheck({ ...sim, board: makeMove(sim.board, found) }, other(piece.c))) {
		score += CHECK_SCORE;
	}
	return score;
}

/**
 * @description me's plain moves, one per move (two cards of a type make the same one), best static score first
 * @param  {[object]} sim [engine state]
 * @param  {[string]} me ["w" or "b"]
 * @param  {[array]} refused [action keys the real game refused]
 * @param  {[array]} told [as allowed]
 * @return {[array]} move actions
 */
function plainMoves(sim, me, refused = [], told = null) {
	const seen = new Set();
	const moves = [];
	for (const action of allowed(sim, me, refused, told)) {
		if (!isPlain(sim, me, action) || seen.has(shape(action))) {
			continue;
		}
		seen.add(shape(action));
		moves.push(action);
	}
	return byStaticScore(sim, moves);
}

// Best first. A card action that isn't a move scores 0
function byStaticScore(sim, actions) {
	return actions
		.map((action) => [action.type === "move" ? staticScore(sim, action) : 0, action])
		.sort((a, b) => b[0] - a[0])
		.map((scored) => scored[1]);
}

/**
 * @description The actions Card Guy scores, in the order the engine budget is spent: bestPlain, the top 5 other plain
 * moves, then every card action (moves a card makes first, by static score). Never the drop of a placed card, nor a
 * passive placed over 3 waiting ones (it would replace the oldest: cardGuyTurn's passiveSwap decides both before the
 * search), nor the free discard (cardGuyTurn decides that before the search too), unless nothing else is legal on the
 * guess. Then those are all there is to try (spareDiscards)
 * @param  {[object]} sim [engine state Card Guy simulates on]
 * @param  {[string]} me ["w" or "b"]
 * @param  {[object]} options [{ bestPlain: the engine's pick among the plain moves ({ from, to, promotion }), refused:
 * action keys the real game refused, told: as allowed }]
 * @return {[array]} actions
 */
function candidates(sim, me, { bestPlain, refused = [], told = null } = {}) {
	const all = allowed(sim, me, refused, told);
	const plain = plainMoves(sim, me, refused, told);
	const best = bestPlain && plain.find((action) => shape(action) === shape(bestPlain));
	const isFull = sim.effects.filter((effect) => effect.owner === me).length >= PASSIVES;
	const cards = all.filter((action) => !isPlain(sim, me, action) && action.type !== "discard" && action.type !== "drop"
		&& !(isFull && action.type === "passive"));
	const out = [...(best ? [best] : []), ...plain.filter((action) => action !== best).slice(0, TOP_PLAIN), ...byStaticScore(sim, cards)];
	if (out.length) {
		return out;
	}
	return spareDiscards(all, sim.players[me]);
}

/**
 * @description When nothing else is legal on the guess: the dead move cards' discards, then the discards of the common
 * or uncommon actives other than Cleanse. Rare and up, Cleanse and the drops come only when there are none: then every
 * action left. Once one is refused, allowed drops them all
 */
function spareDiscards(all, player) {
	const moveCardDiscards = all.filter((action) => action.type === "discard" && isMoveCardDiscard(player, action));
	const cheapDiscards = all.filter((action) => action.type === "discard" && isCheapDiscard(player, action));
	const spare = [...moveCardDiscards, ...cheapDiscards];
	return spare.length ? spare : all;
}

// hand.moveCards counts an entered Mirage as a move card too
function isMoveCardDiscard(player, discard) {
	return hand.moveCards(player).some((card) => card.id === discard.cards[0]);
}

function isCheapDiscard(player, discard) {
	const key = (player.actives.find((card) => card.id === discard.cards[0]) || {}).key;
	return !!CARDS[key] && ["common", "uncommon"].includes(CARDS[key].rarity) && baseKey(key) !== "cleanse";
}

module.exports = { candidates, plainMoves, allowed, staticScore, isPlain, shape, PASSIVES };
