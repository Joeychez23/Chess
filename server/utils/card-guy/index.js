/*
 *  index.js  --  chess server
 *	Card Guy, the card-game bot
 *  Card Guy knows only its own view of the game (playerView). It rebuilds a state from it (fromView: the hidden cards and fogged pieces are guesses),
 *  tries each candidate action there, scores the result (the engine's evaluation of the board + the card score) and picks one.
 *
 */

const { Chess } = require("chess.js");
const engine = require("../../../cards-engine/index.js");
const { inCheck } = require("../../../cards-engine/rules.js");
const { baseKey } = require("../../../cards-engine/cards/index.js");
const ai = require("../ai.js");
const { candidates, plainMoves, allowed, staticScore, isPlain, shape } = require("./candidates.js");
const { cardScore, duelValue } = require("./score.js");
const { pick } = require("./pick.js");

const MAX_EVALS = 24; // BOARDS THE ENGINE IS ASKED ABOUT IN ONE TURN (THE SAME BOARD IS ASKED ONCE)
const SAMPLES = 8; // GUESSED STATES A CHANCE OUTCOME IS AVERAGED OVER
const GUESSES = 3; // FRESH GUESSES TRIED WHEN THE REAL GAME REFUSED EVERY ACTION OF ONE
const WON = 100000; // A GAME WON (LOST: -WON), ABOVE ANY EVALUATION (cp)
const MATE = 10000; // evaluate's SCORE FOR A FORCED MATE (cp)
const FAVOURITES = ["all-or-nothing", "double-time"]; // THE DEALER'S GAMBLES (pick.js PLAYS THEM WHEN THEY'RE CLOSE TO THE BEST)

const other = (c) => (c === "w" ? "b" : "w");
const seedAt = (seed, n) => (seed + n) >>> 0;

/**
 * @description A board's evaluation for Card Guy, from the cached full-strength analysis. Throws when the engine can't answer
 * @param  {[string]} fen [board]
 * @return {[number]} centipawns from White's side, a forced mate is 10000 (or -10000)
 */
async function evaluate(fen) {
	const analysis = await ai.analyzePosition(fen);
	if (typeof analysis.mate === "number") { return (analysis.mate ? analysis.mate > 0 : analysis.eval > 0) ? MATE : -MATE; } // mate 0: THE BOARD IS CHECKMATE, eval SAYS WHO WON
	if (typeof analysis.eval !== "number") { throw new Error("Engine sent no evaluation"); }
	return analysis.eval * 100;
}

/**
 * @description A board as the chess engine is asked about it: an en passant square the side to move can't use is dropped (the second move of a two-move turn after a double pawn step).
 * null when it is no chess position: the side not to move is in check (a status or a card allows that here), or chess.js refuses it. The engine is never asked about one
 * @param  {[string]} fen [engine.toFen of a state]
 * @return {[string]} fen
 */
function chessFen(fen) {
	const parts = fen.split(" ");
	if (parts[3] !== "-" && parts[3][1] !== (parts[1] === "w" ? "6" : "3")) { parts[3] = "-"; }
	try {
		const chess = new Chess(parts.join(" ")), turn = chess.turn();
		return chess.isAttacked(chess.findPiece({ type: "k", color: other(turn) })[0], turn) ? null : parts.join(" ");
	} catch (err) { return null; }
}

/**
 * @description The score of a state that needs no engine: a finished game, or a king left in check for the side to move to take. null when the board has to be evaluated,
 * undefined when it can't be (a king in check that Card Guy, still to move, can't take: no chess position)
 */
function decided(state, me) {
	if (state.result) { return state.result.winner === me ? WON : state.result.winner ? -WON : 0; }
	if (!inCheck(state, other(state.board.turn))) { return null; }
	if (state.board.turn !== me) { return -WON; }
	const king = state.board.sq.findIndex((q) => q && q.c !== me && q.t === "k"), square = engine.board.sqName(king);
	return engine.legalActions(state, me).some((a) => a.type === "move" && a.to === square) ? WON : undefined; // A TWO-MOVE TURN'S SECOND MOVE MUST BE ANOTHER PIECE'S
}

/**
 * @description The state Card Guy simulates on, one with an action the real game hasn't refused. Under the visitor's Fog of War the state is a guess (the fogged pieces are put
 * somewhere), so when every action of a guess was refused another is made, and after the last one the board as Card Guy sees it, the fogged pieces left off: nothing guessed stands in a move's way there
 * @return {[object]} { sim, base: the seed sim was made from, bare: true for the board with the fogged pieces left off (no chess position: the engine isn't asked) }
 */
function simulate(view, seed, refused) {
	if (!Number.isFinite(seed)) { throw new TypeError("Card Guy's seed must be a finite number"); } // undefined OR THE GAME'S HEX SEED WOULD BECOME 0: ONE GUESS & ONE SET OF DICE EVERY TURN
	const left = (sim) => allowed(sim, view.you, refused).length > 0;
	for (let n = 0; n < GUESSES; n++) {
		const base = seedAt(seed, n * (SAMPLES + 1)), sim = engine.fromView(view, base);
		if (left(sim)) { return { sim, base }; }
		if (!view.board.hidden) { break; } // NOTHING IS GUESSED ON THE BOARD: ANOTHER GUESS HAS THE SAME ACTIONS
	}
	const sim = view.board.hidden ? engine.fromView({ ...view, board: { ...view.board, hidden: 0 } }, seed) : null;
	if (sim && left(sim)) { return { sim, base: seed, bare: true }; }
	throw new Error("Card Guy has no action to take");
}

/**
 * @description Scores every candidate of Card Guy's turn (not a card duel's picks & decisions, cardGuyTurn answers those itself). The engine is asked about chess positions only (chessFen):
 * an action that leaves none scores as the board now. When an evaluation fails, or the board now is no chess position (nothing is asked then, and no alarm is logged), every board
 * scores 0 for the turn and the card scores decide: answered boards beside unanswered ones would decide the pick. Decided games keep their score
 * @param  {[object]} view [playerView(state, cardGuy): all Card Guy knows]
 * @param  {[object]} options [{ evaluate, bestOf, seed, refused } as cardGuyTurn]
 * @param  {[object]} world [simulate's answer, when the caller has it]
 * @return {[array]} scored [{ action, total, plain, discard, standsOut, favourite, samples: how many guessed states the total is the mean of }, totals in centipawns from Card Guy's side]
 */
async function scoreTurn(view, { evaluate, bestOf, seed, refused = [] }, world = simulate(view, seed, refused)) {
	const me = view.you, sign = me === "w" ? 1 : -1, { sim, base, bare } = world, raw = engine.toFen(sim), now = bare ? null : chessFen(raw); // now: THE BOARD AS IT STANDS, null WHEN THE ENGINE ISN'T ASKED ABOUT IT
	let alarmed = false;
	const engineDown = (err) => {
		if (!alarmed) { console.log(`STOCKFISH FAILED, js-chess-engine PLAYS INSTEAD: ${err.message}`); } // THE LINE MUST START WITH THIS: AN ALARM MATCHES IT (terraform/modules/monitoring). ONE LINE A TURN. CARD GUY PLAYS BY ITS STATIC & CARD SCORES
		alarmed = true;
	};

	const plain = plainMoves(sim, me, refused);
	let bestPlain = plain[0]; // THE TOP STATIC SCORE, UNLESS THE ENGINE NAMES ANOTHER
	if (plain.length > 1 && now) {
		try {
			const best = await bestOf(now, plain.map(shape));
			bestPlain = plain.find((a) => a.from === best.from && a.to === best.to && (a.promotion || "") === (best.promotion || "")) || bestPlain;
		} catch (err) { engineDown(err); }
	}

	// EACH CANDIDATE'S OUTCOMES: { fen, card, fixed } PER STATE IT WAS TRIED ON. ONE, UNLESS A SECOND GUESS ENDS DIFFERENTLY (A CHANCE OUTCOME: THEN ALL THE SAMPLES)
	const samples = [{ state: sim, fen: raw }]; // THE GUESSED STATES & THEIR BOARDS, EACH MADE ONCE
	const sample = (k) => samples[k] || (samples[k] = ((state) => ({ state, fen: engine.toFen(state) }))(engine.fromView(view, seedAt(base, k))));
	const tryOn = (state, action) => {
		try {
			const { state: after, events } = engine.applyAction(state, me, action);
			const fixed = decided(after, me);
			return { fen: fixed === null ? chessFen(engine.toFen(after)) : null, card: cardScore(state, after, me, events), fixed: fixed === undefined ? null : fixed }; // fen null: NO POSITION TO ASK ABOUT, THE BOARD AS IT STANDS
		} catch (err) {
			if (state === sim || err.code !== "ILLEGAL") { throw err; }
			return null; // NOT LEGAL ON THIS GUESS
		}
	};
	const cardKey = (action) => (sim.players[me].actives.find((c) => c.id === action.card) || {}).key;
	const outcomes = (action, isMove, key) => {
		if (key && baseKey(key) === "all-or-nothing") { return [{ fen: now, card: duelValue(sim, me, key, action.target.piece), fixed: null }]; } // A CARD DUEL IS SCORED BY ITS EXPECTED VALUE, NOT PLAYED OUT
		const first = tryOn(sim, action);
		if (isMove || bare || asked.size + guessed >= MAX_EVALS) { return [first]; } // PAST THE BUDGET IT SCORES THE BOARD NOW + ITS CARD SCORE ON THIS GUESS: SAMPLING IT IS TIME SPENT ON NOTHING (115 TARGETS OF A FOGGED SWAP)
		const second = tryOn(sample(1).state, action), sameBoard = sample(1).fen === raw; // UNDER A FOG THE GUESSED BOARDS DIFFER ANYWAY: ONLY THE CARD SCORE TELLS A CHANCE OUTCOME THERE
		// shortcut: a chance outcome whose first two guesses end alike is scored as certain, sample all 8 if the balance report shows it matters (8 for every target of a Swap is too slow)
		const chance = !second || second.card !== first.card || second.fixed !== first.fixed || (sameBoard && second.fen !== first.fen);
		if (!chance) { return [first]; }
		const outs = [first, second, ...Array.from({ length: SAMPLES - 2 }, (_, k) => tryOn(sample(k + 2).state, action))].filter(Boolean);
		if (sameBoard) { return outs; }
		guessed += outs.length - 1; // THEY COUNT ON THE BUDGET AS THE BOARDS THEY'D HAVE ASKED ABOUT: 8 TRIES FOR EVERY TARGET OF A FOGGED SWAP IS TOO SLOW
		return outs.map((o) => ({ ...o, fen: first.fen })); // UNDER A FOG EVERY SAMPLE'S BOARD IS THE FIRST GUESS'S, THE ONE THE PLAIN MOVES ARE SCORED ON: ONLY THE CARD SCORE IS AVERAGED
	};

	// THE ENGINE BUDGET, IN ORDER: THE BOARD NOW, bestPlain, THE OTHER PLAIN MOVES, THE CARD CANDIDATES. A BOARD PAST IT SCORES AS THE BOARD NOW
	const asked = new Set(now ? [now] : []), scored = [];
	let guessed = 0; // SAMPLES TAKEN ON OTHER GUESSES OF A FOGGED BOARD
	for (const action of candidates(sim, me, { bestPlain, refused })) {
		await new Promise(setImmediate); // THE SERVER ANSWERS ITS OTHER REQUESTS BETWEEN CANDIDATES
		const isMove = isPlain(sim, me, action), key = action.type === "active" ? cardKey(action) : null, outs = outcomes(action, isMove, key);
		for (const o of outs) { if (o.fixed === null && o.fen && asked.size < MAX_EVALS) { asked.add(o.fen); } }
		scored.push({ action, plain: isMove, discard: action.type === "discard", standsOut: isMove && staticScore(sim, action) > 0, favourite: !!key && FAVOURITES.includes(baseKey(key)), outs });
	}

	let values = new Map(), blind = false;
	const answers = await Promise.all((now ? [...asked] : []).map(async (board) => { // NO BOARD NOW TO SCORE THE CARDS AGAINST: NONE IS ASKED (asked STILL COUNTS THE BUDGET THE SAMPLING STOPS AT)
		try {
			const value = await evaluate(board);
			if (!Number.isFinite(value)) { throw new Error("the evaluation isn't a number"); }
			return [board, sign * value];
		} catch (err) { engineDown(err); blind = true; return [board, 0]; }
	}));
	if (!blind) { values = new Map(answers); } // ONE BOARD UNANSWERED: NONE COUNTS, THE CARD SCORES DECIDE
	const board = (o) => (o.fixed !== null ? o.fixed : values.has(o.fen) ? values.get(o.fen) : values.get(now) || 0);
	return scored.map(({ outs, ...c }) => ({ ...c, samples: outs.length, total: outs.reduce((sum, o) => sum + board(o) + o.card, 0) / outs.length }));
}

/**
 * @description One action for whatever Card Guy owes now: a turn action, the next move of a two-move turn, a choice, a card duel pick (random: every card is face down) or
 * a duel's stop or go on. Callers call it again while Card Guy still owes something. The action is legal on Card Guy's guess of the game; under the visitor's Fog of War
 * the real game can still refuse it: call again with its key added to refused
 * @param  {[object]} view [playerView(state, cardGuy): all Card Guy knows]
 * @param  {[number]} level [the game's level, 600 - 3200]
 * @param  {[object]} options [{ evaluate(fen) -> centipawns from White's side, bestOf(fen, lans) -> { from, to, promotion }, seed: integer 0 - 4294967295, never the game's own
 * (anything but a finite number throws), refused: keys (engine.actionKey) of the actions the real game refused this turn }]
 * @return {[object]} action
 */
async function cardGuyTurn(view, level, { evaluate, bestOf, seed, refused = [] }) {
	const me = view.you, world = simulate(view, seed, refused), { sim, base } = world;
	const random = { rng: engine.rng.seed(seedAt(base, SAMPLES)) }, rng = () => engine.rng.next(random); // CARD GUY'S OWN DICE, NEVER THE GAME'S
	const actions = allowed(sim, me, refused);
	if (actions[0].type === "duel") {
		if (actions[0].pick !== undefined) { return engine.rng.pick(random, actions); }
		const stop = !(duelValue(sim, me, sim.duel.card, sim.duel.piece) > 0); // GO ON ONLY WHEN THE NEXT HAND IS WORTH ITS RISK
		return actions.find((a) => a.stop === stop) || actions[0];
	}
	return pick(await scoreTurn(view, { evaluate, bestOf, seed, refused }, world), level, rng);
}

module.exports = { cardGuyTurn, scoreTurn, evaluate, MAX_EVALS };
