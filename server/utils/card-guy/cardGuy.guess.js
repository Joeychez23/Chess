/*
 *  cardGuy.guess.js  --  chess server
 *	Card Guy: the guesses
 *  The state Card Guy plays on: his view rebuilt with the hidden cards and fogged pieces guessed (simulate), and the
 *  veiled Frozen pawns his view leaves out.
 *
 */

const engine = require("../../../cards-engine/index.js");
const { inCheck } = require("../../../cards-engine/rules.js");
const { allowed } = require("./candidates.js");

// Guessed states a chance outcome is averaged over
const SAMPLES = 8;
// Fresh guesses tried when the real game refused every action of one
const GUESSES = 3;
// Guesses tried for one that agrees with this turn's refusals
const GUESS_TRIES = 24;
// Refusals in one turn before that agreeing guess is looked for. Measured over 70 fogged games (2026-11-22):
// 257 refusals without it, 261 from the 1st, 247 from the 2nd, 235 from the 3rd or 4th
const FIT_FROM = 3;

function seedAt(seed, offset) {
	return (seed + offset) >>> 0;
}

/**
 * @description His own pawns with a move the real game refused this turn that no fogged piece explains (it is legal on
 * the board with the fogged pieces left off): a veiled Frozen from Tremor, which his view leaves out. They are frozen in
 * each guess (freezeVeiledPawns), so their other moves are never tried and no fitted guess looks for a fogged piece to explain them
 * shortcut: a check or pin by a fogged piece refuses such a push too, so that pawn sits out the rest of the turn;
 * upgrade if fogged checks show it costing games
 * @return {[array]} piece ids
 */
function veiledPawns(view, refused, seed) {
	if (!view.board.hidden || !refused.length) {
		return [];
	}
	const bareState = engine.fromView({ ...view, board: { ...view.board, hidden: 0 } }, seed);
	const keys = new Set(engine.legalActions(bareState, view.you).map(engine.actionKey));
	const pawns = refused
		.filter((key) => keys.has(key))
		.map((key) => JSON.parse(key))
		.filter((action) => action.type === "move")
		.map((action) => view.board.sq[engine.board.sqIndex(action.from)]);
	const ids = pawns.filter((piece) => piece && piece.c === view.you && piece.t === "p").map((piece) => piece.id);
	return [...new Set(ids)];
}

function freezeVeiledPawns(sim, ids) {
	const statuses = sim.statuses || (sim.statuses = {});
	for (const id of ids) {
		const isFrozen = (statuses[id] || []).some((effect) => effect.s === "frozen");
		if (!isFrozen) {
			statuses[id] = [...(statuses[id] || []), { s: "frozen", left: 3, veiled: true }];
		}
	}
	return sim;
}

/* ---------------------------------------------------------------- */
// The state Card Guy plays on
/* ---------------------------------------------------------------- */
/**
 * @description The state Card Guy simulates on, one with an action the real game hasn't refused. Under the visitor's
 * Fog of War the state is a guess (the fogged pieces are put somewhere). From the turn's third refusal (FIT_FROM) a guess
 * is looked for (GUESS_TRIES tries) in which every refused action is illegal too, or the closest one when none is. When
 * every action of a guess was refused another one is made, and after the last one Card Guy uses the board as he sees it,
 * with the fogged pieces left off: nothing guessed stands in a move's way there
 * @return {[object]} { sim, base: the seed sim was made from, bare: true for the board with the fogged pieces left off
 * (no chess position: the engine isn't asked), veiled: veiledPawns' answer }
 */
function simulate(view, seed, refused, told) {
	if (!Number.isFinite(seed)) {
		// undefined, or the game's hex seed, would become 0: one guess and one set of dice every turn
		throw new TypeError("Card Guy's seed must be a finite number");
	}
	const veiled = veiledPawns(view, refused, seed);
	// This many refusals prove the guess wrong (a check it missed or made up), not one piece in the way:
	// look for a guess the refusals agree with, not the same one less a move
	const isFitting = !!view.board.hidden && refused.length >= FIT_FROM;

	let best = null;
	for (let attempt = 0; attempt < (isFitting ? GUESS_TRIES : GUESSES); attempt++) {
		const base = seedAt(seed, attempt * (SAMPLES + 1));
		const sim = guessState(view, base, veiled);
		if (hasActionLeft(sim, view.you, refused, told)) {
			// A guess often checks Card Guy, the real game seldom does: of two that agree, take the one with no check
			const miss = isFitting ? 2 * countMisses(sim, view.you, refused) + (inCheck(sim, view.you) ? 1 : 0) : 0;
			if (!miss) {
				return { sim, base, veiled };
			}
			// When none agrees without a check: one that agrees with a check, else the closest of the first guesses
			// (past those, only one that agrees)
			if ((attempt < GUESSES || miss < 2) && (!best || miss < best.miss)) {
				best = { sim, base, miss };
			}
		}
		// Nothing on the board is guessed: another guess would have the same actions
		if (!view.board.hidden) {
			break;
		}
	}
	if (best) {
		return { sim: best.sim, base: best.base, veiled };
	}

	const sim = view.board.hidden ? guessState({ ...view, board: { ...view.board, hidden: 0 } }, seed, veiled) : null;
	if (sim && hasActionLeft(sim, view.you, refused, told)) {
		return { sim, base: seed, bare: true, veiled };
	}
	throw new Error("Card Guy has no action to take");
}

function guessState(view, seed, veiled) {
	return freezeVeiledPawns(engine.fromView(view, seed), veiled);
}

function hasActionLeft(sim, me, refused, told) {
	return allowed(sim, me, refused, told).length > 0;
}

// Refused actions the guess still calls legal
function countMisses(sim, me, refused) {
	const keys = new Set(engine.legalActions(sim, me).map(engine.actionKey));
	return refused.filter((key) => keys.has(key)).length;
}

module.exports = { simulate, guessState, seedAt, SAMPLES };
