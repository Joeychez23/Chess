/*
 *  index.js  --  chess server
 *	Card Guy, the card-game bot
 *  Card Guy knows only its own view of the game (playerView). It rebuilds a state from that view (fromView: the hidden
 *  cards and fogged pieces are guesses), tries each candidate action there, scores the result (the engine's evaluation
 *  of the board plus the card score) and picks one.
 *
 */

const { Chess } = require("chess.js");
const engine = require("../../../cards-engine/index.js");
const { inCheck } = require("../../../cards-engine/rules.js");
const { baseKey } = require("../../../cards-engine/cards/index.js");
const ai = require("../ai.js");
const { candidates, plainMoves, allowed, staticScore, isPlain, shape, PASSIVES } = require("./candidates.js");
const { cardScore, duelValue } = require("./score.js");
const { pick } = require("./pick.js");
const { simulate, guessState, seedAt, SAMPLES } = require("./cardGuy.guess.js");
const { freeDiscard, material, rarityRank } = require("./cardGuy.discard.js");

// Boards the engine is asked about in one turn (the same board is only asked once)
const MAX_EVALS = 24;
// A won game (a lost one is -WIN_SCORE), above any evaluation (centipawns)
const WIN_SCORE = 100000;
// evaluate's score for a forced mate (centipawns)
const MATE_SCORE = 10000;
// The dealer's gambles: pick.js plays them when they are close to the best
const FAVOURITES = ["all-or-nothing", "double-time"];

function otherColor(color) {
	return color === "w" ? "b" : "w";
}

/**
 * @description The legal list a player is told (engine.playerLegal), by key. Under a Fog of War that list leaves the
 * moves out and holds drops the game would refuse, so it is not used then: null
 */
function toldOf(view, legal) {
	return legal && view.board.hidden === undefined ? legal.map(engine.actionKey) : null;
}

/**
 * @description A board's evaluation for Card Guy, from the cached full-strength analysis. Throws when the engine can't answer
 * @param  {[string]} fen [board]
 * @return {[number]} centipawns from White's side, a forced mate is 10000 (or -10000)
 */
async function evaluate(fen) {
	const analysis = await ai.analyzePosition(fen);
	if (typeof analysis.mate === "number") {
		// Mate 0 means the board is already checkmate: the evaluation's sign says who won
		const whiteWins = analysis.mate ? analysis.mate > 0 : analysis.eval > 0;
		return whiteWins ? MATE_SCORE : -MATE_SCORE;
	}
	if (typeof analysis.eval !== "number") {
		throw new Error("Engine sent no evaluation");
	}
	return analysis.eval * 100;
}

/**
 * @description A board as the chess engine is asked about it: an en passant square the side to move can't use is
 * dropped (the second move of a two-move turn after a double pawn step). null when it is no chess position: the side
 * not to move is in check (a status or a card allows that here), or chess.js refuses it. The engine is never asked
 * about one of those
 * @param  {[string]} fen [engine.toFen of a state]
 * @return {[string]} fen
 */
function chessFen(fen) {
	const parts = fen.split(" ");
	if (parts[3] !== "-" && parts[3][1] !== (parts[1] === "w" ? "6" : "3")) {
		parts[3] = "-";
	}
	try {
		const chess = new Chess(parts.join(" "));
		const turn = chess.turn();
		const otherKing = chess.findPiece({ type: "k", color: otherColor(turn) })[0];
		return chess.isAttacked(otherKing, turn) ? null : parts.join(" ");
	} catch (err) {
		return null;
	}
}

/**
 * @description The score of a state that needs no engine: a finished game, or a king left in check for the side to
 * move to take. null when the board has to be evaluated, undefined when it can't be (a king in check that Card Guy,
 * still to move, can't take: no chess position)
 */
function decidedScore(state, me) {
	if (state.result) {
		return state.result.winner === me ? WIN_SCORE : state.result.winner ? -WIN_SCORE : 0;
	}
	if (!inCheck(state, otherColor(state.board.turn))) {
		return null;
	}
	if (state.board.turn !== me) {
		return -WIN_SCORE;
	}
	const king = state.board.sq.findIndex((piece) => piece && piece.c !== me && piece.t === "k");
	const square = engine.board.sqName(king);
	// The second move of a two-move turn must be another piece's, so the king may not be takeable after all
	const canTakeKing = engine.legalActions(state, me).some((action) => action.type === "move" && action.to === square);
	return canTakeKing ? WIN_SCORE : undefined;
}

/* ---------------------------------------------------------------- */
// Scoring a turn
/* ---------------------------------------------------------------- */
/**
 * @description Scores every candidate of Card Guy's turn (not a card duel's picks and decisions: cardGuyTurn answers
 * those itself). The engine is asked about chess positions only (chessFen): an action that leaves none scores as the
 * board now. When an evaluation fails, or the board now is no chess position (nothing is asked then, and no alarm is
 * logged), every board scores 0 for the turn and the card scores decide, since answered boards beside unanswered ones
 * would decide the pick. Decided games keep their score
 * @param  {[object]} view [playerView(state, cardGuy): all Card Guy knows]
 * @param  {[object]} options [{ evaluate, bestOf, seed, refused, legal } as cardGuyTurn]
 * @param  {[object]} world [simulate's answer, when the caller has it]
 * @return {[array]} scored [{ action, total, plain, standsOut, favourite, samples: how many guessed states the total is
 * the mean of }, totals in centipawns from Card Guy's side]
 */
async function scoreTurn(
	view,
	{ evaluate, bestOf, seed, refused = [], legal },
	world = simulate(view, seed, refused, toldOf(view, legal)),
) {
	const told = toldOf(view, legal);
	const turn = startScoring(view, world);

	const plain = plainMoves(turn.sim, turn.me, refused, told);
	const bestPlain = await findBestPlain(turn, plain, bestOf);
	const scored = await tryCandidates(turn, { bestPlain, refused, told });
	const values = await evaluateBoards(turn, evaluate);

	return scored.map(({ outs, ...candidate }) => ({
		...candidate,
		samples: outs.length,
		total: outs.reduce((sum, outcome) => sum + boardScore(outcome, values, turn.now) + outcome.card, 0) / outs.length,
	}));
}

/**
 * @description What one turn's scoring keeps track of. now is the board as it stands, null when the engine isn't asked
 * about it. samples are the guessed states and their boards, each made once. asked is the engine budget, spent in this
 * order: the board now, bestPlain, the other plain moves, the card candidates; a board past it scores as the board now.
 * guessed counts samples taken on other guesses of a fogged board
 */
function startScoring(view, world) {
	const { sim, base, bare, veiled = [] } = world;
	const raw = engine.toFen(sim);
	const now = bare ? null : chessFen(raw);
	return {
		view,
		me: view.you,
		sim,
		base,
		bare,
		veiled,
		raw,
		now,
		samples: [{ state: sim, fen: raw }],
		asked: new Set(now ? [now] : []),
		guessed: 0,
		alarmed: false,
	};
}

// The line must start with this text: an alarm matches it (terraform/modules/monitoring). It is logged once a turn,
// and Card Guy then plays by his static and card scores
function engineDown(turn, err) {
	if (!turn.alarmed) {
		console.log(`STOCKFISH FAILED, js-chess-engine PLAYS INSTEAD: ${err.message}`);
	}
	turn.alarmed = true;
}

// The top static score, unless the engine names another plain move
async function findBestPlain(turn, plain, bestOf) {
	let bestPlain = plain[0];
	if (plain.length > 1 && turn.now) {
		try {
			const best = await bestOf(turn.now, plain.map(shape));
			const named = plain.find((action) => action.from === best.from && action.to === best.to
				&& (action.promotion || "") === (best.promotion || ""));
			bestPlain = named || bestPlain;
		} catch (err) {
			engineDown(turn, err);
		}
	}
	return bestPlain;
}

async function tryCandidates(turn, { bestPlain, refused, told }) {
	const { sim, me } = turn;
	const scored = [];
	for (const action of candidates(sim, me, { bestPlain, refused, told })) {
		// Let the server answer its other requests between candidates
		await new Promise(setImmediate);
		const isMove = isPlain(sim, me, action);
		const key = action.type === "active" ? activeKey(sim, me, action) : null;
		const outs = outcomesOf(turn, action, isMove, key);
		for (const outcome of outs) {
			if (outcome.fixed === null && outcome.fen && turn.asked.size < MAX_EVALS) {
				turn.asked.add(outcome.fen);
			}
		}
		scored.push({
			action,
			plain: isMove,
			standsOut: isMove && staticScore(sim, action) > 0,
			favourite: !!key && FAVOURITES.includes(baseKey(key)),
			outs,
		});
	}
	return scored;
}

function activeKey(sim, me, action) {
	return (sim.players[me].actives.find((card) => card.id === action.card) || {}).key;
}

/**
 * @description A candidate's outcomes: { fen, card, fixed } for each state it was tried on. One, unless a second guess
 * ends differently (a chance outcome): then every sample
 */
function outcomesOf(turn, action, isMove, key) {
	if (key && baseKey(key) === "all-or-nothing") {
		// A card duel is scored by its expected value, not played out
		return [{ fen: turn.now, card: duelValue(turn.sim, turn.me, key, action.target.piece), fixed: null }];
	}
	const first = tryOn(turn, turn.sim, action);
	// Past the budget it scores the board now plus its card score on this guess: sampling it would be time spent on
	// nothing (115 targets of a fogged Swap)
	if (isMove || turn.bare || turn.asked.size + turn.guessed >= MAX_EVALS) {
		return [first];
	}
	const secondSample = sampleAt(turn, 1);
	const second = tryOn(turn, secondSample.state, action);
	// Under a fog the guessed boards differ anyway: only the card score tells a chance outcome there
	const sameBoard = secondSample.fen === turn.raw;
	// shortcut: a chance outcome whose first two guesses end alike is scored as certain, sample all 8 if the balance
	// report shows it matters (8 for every target of a Swap is too slow)
	const chance = !second || second.card !== first.card || second.fixed !== first.fixed || (sameBoard && second.fen !== first.fen);
	if (!chance) {
		return [first];
	}
	const rest = Array.from({ length: SAMPLES - 2 }, (_, i) => tryOn(turn, sampleAt(turn, i + 2).state, action));
	const outs = [first, second, ...rest].filter(Boolean);
	if (sameBoard) {
		return outs;
	}
	// They count on the budget as the boards they would have asked about: 8 tries for every target of a fogged Swap is too slow
	turn.guessed += outs.length - 1;
	// Under a fog every sample's board is the first guess's, the one the plain moves are scored on: only the card score is averaged
	return outs.map((outcome) => ({ ...outcome, fen: first.fen }));
}

function sampleAt(turn, index) {
	if (!turn.samples[index]) {
		const state = guessState(turn.view, seedAt(turn.base, index), turn.veiled);
		turn.samples[index] = { state, fen: engine.toFen(state) };
	}
	return turn.samples[index];
}

// fen is null when there is no position to ask about: the action then scores as the board as it stands
function tryOn(turn, state, action) {
	try {
		const { state: after, events } = engine.applyAction(state, turn.me, action);
		const fixed = decidedScore(after, turn.me);
		return {
			fen: fixed === null ? chessFen(engine.toFen(after)) : null,
			card: cardScore(state, after, turn.me, events),
			fixed: fixed === undefined ? null : fixed,
		};
	} catch (err) {
		if (state === turn.sim || err.code !== "ILLEGAL") {
			throw err;
		}
		// Not legal on this guess
		return null;
	}
}

/**
 * @description The engine's values of the asked boards, from Card Guy's side. With no board now to score the cards
 * against, none is asked (asked still counted the budget the sampling stops at). One unanswered board and none counts:
 * the map comes back empty and the card scores decide
 */
async function evaluateBoards(turn, evaluate) {
	const sign = turn.me === "w" ? 1 : -1;
	let blind = false;
	const answers = await Promise.all((turn.now ? [...turn.asked] : []).map(async (board) => {
		try {
			const value = await evaluate(board);
			if (!Number.isFinite(value)) {
				throw new Error("the evaluation isn't a number");
			}
			return [board, sign * value];
		} catch (err) {
			engineDown(turn, err);
			blind = true;
			return [board, 0];
		}
	}));
	return blind ? new Map() : new Map(answers);
}

function boardScore(outcome, values, now) {
	if (outcome.fixed !== null) {
		return outcome.fixed;
	}
	return values.has(outcome.fen) ? values.get(outcome.fen) : values.get(now) || 0;
}

/* ---------------------------------------------------------------- */
// Choices made before the search
/* ---------------------------------------------------------------- */
/**
 * @description Card Guy's rule for his waiting passives, decided before the search, from his view alone. With 3 waiting
 * and one in hand of a higher rarity than the weakest waiting one (ties: the oldest), he drops that one; then, the drop
 * made (his view shows a passive of his left this turn and fewer than 3 wait), he places the one in hand, only when the
 * placing is legal (not in check). With 3 waiting and the one in hand no rarer than the weakest, he rerolls it (the free
 * discard of the held passive), only while the engine offers it (another passive to draw, the turn's free discard
 * unused) and the list he is told holds it; this is decided before freeDiscard, so it wins over a dead card's discard.
 * Otherwise null: he keeps what he has (candidates never places a fourth over the oldest) and drops nothing else
 * @param  {[array]} actions [the legal actions on Card Guy's guess]
 * @param  {[object]} view [playerView(state, cardGuy)]
 * @param  {[array]} legal [engine.playerLegal(state, cardGuy), when the caller has it: the placing and the reroll must be on it]
 * @return {[object]} a drop, the passive's placing or its reroll, or null
 */
function passiveSwap(actions, view, legal) {
	const player = view.players[view.you];
	const place = actions.find((action) => action.type === "passive");
	if (!player.passive) {
		return null;
	}
	const mine = view.effects.filter((effect) => effect.owner === view.you).sort((a, b) => a.placedAt - b.placedAt);
	// Sorted by age, so the oldest of a tie stays the pick
	const weakest = mine.length >= PASSIVES
		? mine.reduce((lowest, effect) => (rarityRank(effect.card) < rarityRank(lowest.card) ? effect : lowest))
		: null;
	if (weakest && rarityRank(player.passive) <= rarityRank(weakest.card)) {
		// It would never be placed, and a held passive stops the turn-start draw: reroll it
		const reroll = actions.find((action) => action.type === "discard" && action.cards.length === 1 && action.cards[0] === player.passive.id);
		return reroll && isTold(legal, reroll) ? reroll : null;
	}
	// Checked by a fogged piece, a drop would lose a card for nothing
	if (!place || (legal && !legal.some((action) => action.type === "passive"))) {
		return null;
	}
	// Fewer than 3 wait: a passive that left this turn is the one he dropped for this one
	if (!weakest) {
		return (player.gone || []).length ? place : null;
	}
	return actions.find((action) => action.type === "drop" && action.card === weakest.id) || null;
}

// The list he is told names no piece for the placing or the reroll, so this holds under a fog too
function isTold(legal, action) {
	return !legal || legal.some((toldAction) => engine.actionKey(toldAction) === engine.actionKey(action));
}

/* ---------------------------------------------------------------- */
// Card Guy's turn
/* ---------------------------------------------------------------- */
/**
 * @description One action for whatever Card Guy owes now: the waiting passives' swap (passiveSwap; skipped for the
 * search's pick when that mates or wins material), the free discard (freeDiscard), a turn action, the next move of a
 * two-move turn, a choice (an Opposing Finality slot "?n", a piece the fog hides: one at random when only slots are
 * left, else the scored pick among the pieces he sees), a card duel pick (random: every card is face down) or a duel's
 * stop or go on. Callers call it again while Card Guy still owes something. The action is legal on Card Guy's guess of
 * the game; under the visitor's Fog of War the real game can still refuse it: call again with its key added to refused.
 * With legal (no fog up) only an action on that list is returned: the view shows an entered Mirage in Card Guy's own
 * hand as a move card, as to any holder, and only the list says it has no move in check
 * @param  {[object]} view [playerView(state, cardGuy): all Card Guy knows]
 * @param  {[number]} level [the game's level, 600 - 3200]
 * @param  {[object]} options [{ evaluate(fen) -> centipawns from White's side, bestOf(fen, lans) -> { from, to, promotion },
 * seed: integer 0 - 4294967295, never the game's own (anything but a finite number throws), refused: keys
 * (engine.actionKey) of the actions the real game refused this turn, legal: engine.playerLegal(state, Card Guy), the
 * legal actions a player is told (optional) }]
 * @return {[object]} action
 */
async function cardGuyTurn(view, level, { evaluate, bestOf, seed, refused = [], legal }) {
	const me = view.you;
	const options = { evaluate, bestOf, seed, refused, legal };
	const told = toldOf(view, legal);
	const world = simulate(view, seed, refused, told);
	const { sim, base } = world;
	// Card Guy's own dice, never the game's
	const random = { rng: engine.rng.seed(seedAt(base, SAMPLES)) };
	const rng = () => engine.rng.next(random);
	const actions = allowed(sim, me, refused, told);

	if (actions[0].type === "duel") {
		return answerDuel(actions, sim, me, random);
	}

	// Opposing Finality's pieces hidden by the fog: his guess holds no such piece to play one out on
	const slots = actions.filter((action) => action.type === "choice" && /^\?\d+$/.test(action.option)).map(engine.actionKey);
	if (slots.length) {
		// Nothing tells the slots apart
		if (slots.length === actions.length) {
			return engine.rng.pick(random, actions);
		}
		// The pieces he sees are scored, so a known piece wins over an unknown one
		return pick(await scoreTurn(view, { ...options, refused: [...refused, ...slots] }, world), level, rng);
	}

	const swap = passiveSwap(actions, view, legal);
	if (swap && swap.type === "drop") {
		// The swap costs the turn: not when the search's move mates or wins material
		const best = pick(await scoreTurn(view, options, world), level, rng);
		const after = engine.applyAction(sim, me, best).state;
		if (decidedScore(after, me) === WIN_SCORE || material(after, me) > material(sim, me)) {
			return best;
		}
	}
	if (swap) {
		return swap;
	}

	// None once one was refused (allowed drops them)
	const discard = freeDiscard(actions, sim.players[me]);
	if (discard) {
		return discard;
	}
	return pick(await scoreTurn(view, options, world), level, rng);
}

// A duel pick is random (every card is face down). Otherwise go on only when the next hand is worth its risk
function answerDuel(actions, sim, me, random) {
	if (actions[0].pick !== undefined) {
		return engine.rng.pick(random, actions);
	}
	const stop = !(duelValue(sim, me, sim.duel.card, sim.duel.piece) > 0);
	return actions.find((action) => action.stop === stop) || actions[0];
}

module.exports = { cardGuyTurn, scoreTurn, evaluate, otherColor, MAX_EVALS };
