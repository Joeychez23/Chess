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
const hand = require("../../../cards-engine/hand.js");
const { CARDS, RARITY_WEIGHTS, baseKey } = require("../../../cards-engine/cards/index.js");
const ai = require("../ai.js");
const { candidates, plainMoves, allowed, staticScore, isPlain, shape, PASSIVES } = require("./candidates.js");
const { cardScore, duelValue } = require("./score.js");
const { pick } = require("./pick.js");

const MAX_EVALS = 24; // BOARDS THE ENGINE IS ASKED ABOUT IN ONE TURN (THE SAME BOARD IS ASKED ONCE)
const SAMPLES = 8; // GUESSED STATES A CHANCE OUTCOME IS AVERAGED OVER
const GUESSES = 3; // FRESH GUESSES TRIED WHEN THE REAL GAME REFUSED EVERY ACTION OF ONE
const FITS = 24; // GUESSES TRIED FOR ONE THAT AGREES WITH THE REFUSALS OF THIS TURN
const FIT_FROM = 3; // REFUSALS IN ONE TURN BEFORE THAT GUESS IS LOOKED FOR. MEASURED OVER 70 FOGGED GAMES (2026-11-22): 257 REFUSALS WITHOUT, 261 FROM THE 1ST, 247 FROM THE 2ND, 235 FROM THE 3RD OR 4TH
const WON = 100000; // A GAME WON (LOST: -WON), ABOVE ANY EVALUATION (cp)
const MATE = 10000; // evaluate's SCORE FOR A FORCED MATE (cp)
const FAVOURITES = ["all-or-nothing", "double-time"]; // THE DEALER'S GAMBLES (pick.js PLAYS THEM WHEN THEY'RE CLOSE TO THE BEST)

const other = (c) => (c === "w" ? "b" : "w");
const seedAt = (seed, n) => (seed + n) >>> 0;
const toldOf = (view, legal) => (legal && view.board.hidden === undefined ? legal.map(engine.actionKey) : null); // THE LEGAL LIST A PLAYER IS TOLD (engine.playerLegal), BY KEY. UNDER A FOG OF WAR IT LEAVES THE MOVES OUT AND HOLDS DROPS THE GAME WOULD REFUSE: NOT USED

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
 * @description His own pawns with a move the real game refused this turn that no fogged piece explains (it is legal on the board with the fogged pieces left off): a veiled Frozen,
 * Tremor's, which his view leaves out (#493). Frozen in each guess (frozen), so their other moves are never tried & no fitted guess looks for a fogged piece to explain them (ruling R-5)
 * shortcut: a check or pin by a fogged piece refuses such a push too, so that pawn sits out the rest of the turn; upgrade if fogged checks show it costing games
 * @return {[array]} piece ids
 */
function veiledPawns(view, refused, seed) {
	if (!view.board.hidden || !refused.length) { return []; }
	const keys = new Set(engine.legalActions(engine.fromView({ ...view, board: { ...view.board, hidden: 0 } }, seed), view.you).map(engine.actionKey));
	const pawns = refused.filter((key) => keys.has(key)).map((key) => JSON.parse(key)).filter((a) => a.type === "move").map((a) => view.board.sq[engine.board.sqIndex(a.from)]);
	return [...new Set(pawns.filter((q) => q && q.c === view.you && q.t === "p").map((q) => q.id))];
}

function frozen(sim, ids) {
	const statuses = sim.statuses || (sim.statuses = {});
	for (const id of ids) { if (!(statuses[id] || []).some((e) => e.s === "frozen")) { statuses[id] = [...(statuses[id] || []), { s: "frozen", left: 3, veiled: true }]; } }
	return sim;
}

/**
 * @description The state Card Guy simulates on, one with an action the real game hasn't refused. Under the visitor's Fog of War the state is a guess (the fogged pieces are put
 * somewhere), so from the turn's third refusal (FIT_FROM) a guess is looked for (FITS tries) in which every refused action is illegal too, the closest when none is; when every action of a guess was refused another is made, and after the last one the board as Card Guy sees it, the fogged pieces left off: nothing guessed stands in a move's way there
 * @return {[object]} { sim, base: the seed sim was made from, bare: true for the board with the fogged pieces left off (no chess position: the engine isn't asked), veiled: veiledPawns' }
 */
function simulate(view, seed, refused, told) {
	if (!Number.isFinite(seed)) { throw new TypeError("Card Guy's seed must be a finite number"); } // undefined OR THE GAME'S HEX SEED WOULD BECOME 0: ONE GUESS & ONE SET OF DICE EVERY TURN
	const veiled = veiledPawns(view, refused, seed), guess = (v, s) => frozen(engine.fromView(v, s), veiled);
	const left = (sim) => allowed(sim, view.you, refused, told).length > 0;
	const fit = !!view.board.hidden && refused.length >= FIT_FROM; // SO MANY REFUSALS PROVE THE GUESS WRONG (A CHECK IT MISSED OR MADE UP), NOT ONE PIECE IN THE WAY: LOOK FOR A GUESS THEY AGREE WITH, NOT THE SAME ONE LESS A MOVE
	const misses = (sim) => { const keys = new Set(engine.legalActions(sim, view.you).map(engine.actionKey)); return refused.filter((key) => keys.has(key)).length; }; // REFUSED ACTIONS THE GUESS STILL CALLS LEGAL
	let best = null;
	for (let n = 0; n < (fit ? FITS : GUESSES); n++) {
		const base = seedAt(seed, n * (SAMPLES + 1)), sim = guess(view, base);
		if (left(sim)) {
			const miss = fit ? 2 * misses(sim) + (inCheck(sim, view.you) ? 1 : 0) : 0; // A GUESS OFTEN CHECKS CARD GUY, THE GAME SELDOM: OF TWO THAT AGREE, THE ONE WITH NO CHECK
			if (!miss) { return { sim, base, veiled }; }
			if ((n < GUESSES || miss < 2) && (!best || miss < best.miss)) { best = { sim, base, miss }; } // NONE AGREES WITHOUT A CHECK: ONE THAT AGREES WITH A CHECK, ELSE THE CLOSEST OF THE FIRST GUESSES (PAST THEM ONLY ONE THAT AGREES)
		}
		if (!view.board.hidden) { break; } // NOTHING IS GUESSED ON THE BOARD: ANOTHER GUESS HAS THE SAME ACTIONS
	}
	if (best) { return { sim: best.sim, base: best.base, veiled }; }
	const sim = view.board.hidden ? guess({ ...view, board: { ...view.board, hidden: 0 } }, seed) : null;
	if (sim && left(sim)) { return { sim, base: seed, bare: true, veiled }; }
	throw new Error("Card Guy has no action to take");
}

/**
 * @description Scores every candidate of Card Guy's turn (not a card duel's picks & decisions, cardGuyTurn answers those itself). The engine is asked about chess positions only (chessFen):
 * an action that leaves none scores as the board now. When an evaluation fails, or the board now is no chess position (nothing is asked then, and no alarm is logged), every board
 * scores 0 for the turn and the card scores decide: answered boards beside unanswered ones would decide the pick. Decided games keep their score
 * @param  {[object]} view [playerView(state, cardGuy): all Card Guy knows]
 * @param  {[object]} options [{ evaluate, bestOf, seed, refused, legal } as cardGuyTurn]
 * @param  {[object]} world [simulate's answer, when the caller has it]
 * @return {[array]} scored [{ action, total, plain, standsOut, favourite, samples: how many guessed states the total is the mean of }, totals in centipawns from Card Guy's side]
 */
async function scoreTurn(view, { evaluate, bestOf, seed, refused = [], legal }, world = simulate(view, seed, refused, toldOf(view, legal))) {
	const told = toldOf(view, legal);
	const me = view.you, sign = me === "w" ? 1 : -1, { sim, base, bare, veiled = [] } = world, raw = engine.toFen(sim), now = bare ? null : chessFen(raw); // now: THE BOARD AS IT STANDS, null WHEN THE ENGINE ISN'T ASKED ABOUT IT
	let alarmed = false;
	const engineDown = (err) => {
		if (!alarmed) { console.log(`STOCKFISH FAILED, js-chess-engine PLAYS INSTEAD: ${err.message}`); } // THE LINE MUST START WITH THIS: AN ALARM MATCHES IT (terraform/modules/monitoring). ONE LINE A TURN. CARD GUY PLAYS BY ITS STATIC & CARD SCORES
		alarmed = true;
	};

	const plain = plainMoves(sim, me, refused, told);
	let bestPlain = plain[0]; // THE TOP STATIC SCORE, UNLESS THE ENGINE NAMES ANOTHER
	if (plain.length > 1 && now) {
		try {
			const best = await bestOf(now, plain.map(shape));
			bestPlain = plain.find((a) => a.from === best.from && a.to === best.to && (a.promotion || "") === (best.promotion || "")) || bestPlain;
		} catch (err) { engineDown(err); }
	}

	// EACH CANDIDATE'S OUTCOMES: { fen, card, fixed } PER STATE IT WAS TRIED ON. ONE, UNLESS A SECOND GUESS ENDS DIFFERENTLY (A CHANCE OUTCOME: THEN ALL THE SAMPLES)
	const samples = [{ state: sim, fen: raw }]; // THE GUESSED STATES & THEIR BOARDS, EACH MADE ONCE
	const sample = (k) => samples[k] || (samples[k] = ((state) => ({ state, fen: engine.toFen(state) }))(frozen(engine.fromView(view, seedAt(base, k)), veiled)));
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
	for (const action of candidates(sim, me, { bestPlain, refused, told })) {
		await new Promise(setImmediate); // THE SERVER ANSWERS ITS OTHER REQUESTS BETWEEN CANDIDATES
		const isMove = isPlain(sim, me, action), key = action.type === "active" ? cardKey(action) : null, outs = outcomes(action, isMove, key);
		for (const o of outs) { if (o.fixed === null && o.fen && asked.size < MAX_EVALS) { asked.add(o.fen); } }
		scored.push({ action, plain: isMove, standsOut: isMove && staticScore(sim, action) > 0, favourite: !!key && FAVOURITES.includes(baseKey(key)), outs });
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
 * @description Card Guy's free discard, at every level (user ruling 2026-11-21), decided before the search: scored, a 2-for-1 always loses to a move. The active when it has no play this turn (not even paying a curse's clear) and is common or uncommon and not Cleanse (user ruling R1),
 * else a move card with no move this turn, the first in hand order (Task 20e: one card at a time; the engine remembers it until the next one, which draws 1 back at random), else none. Never the passive's reroll
 * @param  {[array]} actions [the legal actions on Card Guy's guess]
 * @param  {[object]} p [Card Guy's player in that guess: its actives and move cards]
 * @return {[object]} a discard action, or null
 */
function freeDiscard(actions, p) {
	const discards = actions.filter((a) => a.type === "discard"), dead = (id) => !actions.some((a) => a.type !== "discard" && a.card === id);
	const cheap = (id) => { const key = (p.actives.find((c) => c.id === id) || {}).key; return !!CARDS[key] && ["common", "uncommon"].includes(CARDS[key].rarity) && baseKey(key) !== "cleanse"; }; // RARE AND UP, AND CLEANSE, ARE KEPT FOR LATER (USER RULING R1). ONLY AN ACTIVE: A ONE-CARD DISCARD OF THE PASSIVE IS THE REROLL, NEVER TAKEN
	const pays = (id) => actions.some((a) => a.type !== "discard" && a.discard === id); // IT CAN PAY A CURSE'S CLEAR (LEECH, SHACKLES): NOT DEAD
	const active = discards.find((a) => a.cards.length === 1 && dead(a.cards[0]) && cheap(a.cards[0]) && !pays(a.cards[0]));
	if (active) { return active; }
	// THE PAIR WITH THE LOWEST DRAW-BACK FLOOR, DROPPED BY THE USER 2026-11-22 AFTER A TRIAL: THE DRAW-BACK IS RANDOM AGAIN. KEPT FOR REFERENCE:
	// const moves = hand.moveCards(p), floor = (a) => Math.min(...a.cards.map((id) => hand.VALUE[moves.find((c) => c.id === id).piece]));
	// return discards.filter((a) => a.cards.length === 2 && a.cards.every(dead)).reduce((best, a) => (!best || floor(a) < floor(best) ? a : best), null); // PAIRS COME IN HAND ORDER: THE FIRST OF THE LOWEST
	return discards.find((a) => p.moves.some((c) => c.id === a.cards[0]) && dead(a.cards[0])) || null; // MOVE CARDS COME IN HAND ORDER: THE FIRST DEAD ONE (AN ENTERED MIRAGE IS A MOVE CARD IN CARD GUY'S VIEW)
}

const material = (state, me) => state.board.sq.reduce((sum, q) => sum + (q ? (q.c === me ? 1 : -1) * (hand.VALUE[q.t] || 0) : 0), 0); // me'S PIECES LESS THE OTHER SIDE'S (hand.VALUE; A KING 0)

/**
 * @description Card Guy's rule for his waiting passives (Task 20e), decided before the search, from his view alone: with 3 waiting and one in hand of a higher rarity than the weakest waiting one (ties: the oldest), the drop of that one;
 * then, the drop made (view: a passive of his left this turn, fewer than 3 wait), placing the one in hand. Only when the placing is legal (not in check). Otherwise null: he keeps what he has (candidates never places a fourth over the oldest) and drops nothing else
 * @param  {[array]} actions [the legal actions on Card Guy's guess]
 * @param  {[object]} view [playerView(state, cardGuy)]
 * @param  {[array]} legal [engine.playerLegal(state, cardGuy), when the caller has it: the placing must be on it]
 * @return {[object]} a drop or the passive's placing, or null
 */
function passiveSwap(actions, view, legal) {
	const p = view.players[view.you], place = actions.find((a) => a.type === "passive");
	if (!p.passive || !place || (legal && !legal.some((a) => a.type === "passive"))) { return null; } // THE LIST HE IS TOLD NAMES NO PIECE FOR THE PLACING, SO IT HOLDS UNDER A FOG TOO: CHECKED BY A FOGGED PIECE, A DROP WOULD LOSE A CARD FOR NOTHING
	const mine = view.effects.filter((e) => e.owner === view.you).sort((x, y) => x.placedAt - y.placedAt), rank = (card) => Object.keys(RARITY_WEIGHTS).indexOf(CARDS[card.key].rarity); // RARITY_WEIGHTS LISTS THE TIERS FROM COMMON UP
	if (mine.length < PASSIVES) { return (p.gone || []).length ? place : null; } // HE NEVER REROLLS: A PASSIVE THAT LEFT THIS TURN IS THE ONE HE DROPPED FOR THIS ONE
	const weakest = mine.reduce((w, e) => (rank(e.card) < rank(w.card) ? e : w)); // BY AGE: THE OLDEST OF A TIE STAYS THE PICK
	return (rank(p.passive) > rank(weakest.card) && actions.find((a) => a.type === "drop" && a.card === weakest.id)) || null;
}

/**
 * @description One action for whatever Card Guy owes now: the waiting passives' swap (passiveSwap; skipped for the search's pick when that mates or wins material), the free discard (freeDiscard), a turn action, the next move of a two-move turn, a choice, a card duel pick (random: every card is face down) or
 * a duel's stop or go on. Callers call it again while Card Guy still owes something. The action is legal on Card Guy's guess of the game; under the visitor's Fog of War
 * the real game can still refuse it: call again with its key added to refused. With legal (no fog up) only an action on that list is returned: the view shows an entered Mirage
 * in Card Guy's own hand as a move card, as to any holder, and only the list says it has no move in check
 * @param  {[object]} view [playerView(state, cardGuy): all Card Guy knows]
 * @param  {[number]} level [the game's level, 600 - 3200]
 * @param  {[object]} options [{ evaluate(fen) -> centipawns from White's side, bestOf(fen, lans) -> { from, to, promotion }, seed: integer 0 - 4294967295, never the game's own
 * (anything but a finite number throws), refused: keys (engine.actionKey) of the actions the real game refused this turn,
 * legal: engine.playerLegal(state, Card Guy), the legal actions a player is told (optional) }]
 * @return {[object]} action
 */
async function cardGuyTurn(view, level, { evaluate, bestOf, seed, refused = [], legal }) {
	const me = view.you, told = toldOf(view, legal), world = simulate(view, seed, refused, told), { sim, base } = world;
	const random = { rng: engine.rng.seed(seedAt(base, SAMPLES)) }, rng = () => engine.rng.next(random); // CARD GUY'S OWN DICE, NEVER THE GAME'S
	const actions = allowed(sim, me, refused, told);
	if (actions[0].type === "duel") {
		if (actions[0].pick !== undefined) { return engine.rng.pick(random, actions); }
		const stop = !(duelValue(sim, me, sim.duel.card, sim.duel.piece) > 0); // GO ON ONLY WHEN THE NEXT HAND IS WORTH ITS RISK
		return actions.find((a) => a.stop === stop) || actions[0];
	}
	const swap = passiveSwap(actions, view, legal);
	if (swap && swap.type === "drop") { // THE SWAP COSTS THE TURN: NOT WHEN THE SEARCH'S MOVE MATES OR WINS MATERIAL (RULING R2, 2026-11-22)
		const best = pick(await scoreTurn(view, { evaluate, bestOf, seed, refused, legal }, world), level, rng), after = engine.applyAction(sim, me, best).state;
		if (decided(after, me) === WON || material(after, me) > material(sim, me)) { return best; }
	}
	if (swap) { return swap; }
	const discard = freeDiscard(actions, sim.players[me]); // NONE ONCE ONE WAS REFUSED (allowed)
	if (discard) { return discard; }
	return pick(await scoreTurn(view, { evaluate, bestOf, seed, refused, legal }, world), level, rng);
}

module.exports = { cardGuyTurn, scoreTurn, evaluate, MAX_EVALS };
