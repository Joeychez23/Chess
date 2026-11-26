/*
 *  cardGuy.js  --  chess server test helpers
 *	Shared setup for the Card Guy tests in test/cardGuy/ (cardGuy-choosing, cardGuy-scoringAndFog, cardGuy-cardsAndPassives): the stubbed engine, a game on a board, and asking Card Guy for an action or a run of them against the true state.
 *
 */

const assert = require("node:assert/strict");
const engine = require("../../../cards-engine/index.js");
const { newGame, legalActions, applyAction, playerView, actionKey, toFen } = engine;
const { fromFen } = engine.board;
const hand = require("../../../cards-engine/hand.js");
const { makeCtx } = require("../../../cards-engine/ctx.js");
const { PASSIVE_KEYS, CARDS } = require("../../../cards-engine/cards/index.js");
const cardGuy = require("../../utils/card-guy/index.js");
const { cardGuyTurn, scoreTurn, MAX_EVALS } = cardGuy;
const { candidates, staticScore } = require("../../utils/card-guy/candidates.js");
const { cardScore, duelValue, WEIGHTS } = require("../../utils/card-guy/score.js");
const { pick, FLAIR_MARGIN } = require("../../utils/card-guy/pick.js");
const { noticeFor, bestOf } = require("../../utils/ai.js");
const { Chess } = require("chess.js");

const other = (c) => (c === "w" ? "b" : "w");
const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const material = async (fen) => [...fen.split(" ")[0]].reduce((sum, ch) => sum + (/[a-z]/i.test(ch) ? (ch === ch.toUpperCase() ? 1 : -1) * VALUE[ch.toLowerCase()] : 0), 0); // CENTIPAWNS FROM WHITE'S SIDE
const firstOf = async (fen, lans) => ({ from: lans[0].slice(0, 2), to: lans[0].slice(2, 4), promotion: lans[0][4] });
const down = async () => { throw new Error("engine is down"); };
const opts = (o) => ({ evaluate: material, bestOf: firstOf, seed: 7, ...o });
const isLegal = (s, c, a) => legalActions(s, c).some((x) => actionKey(x) === actionKey(a));
const owes = (s) => [s.board.turn, other(s.board.turn)].find((c) => legalActions(s, c).length);
const fogUp = (s, owner, key = "fog-of-war-rare", left = 40) => { const ctx = makeCtx(s); ctx.trigger = () => {}; ctx.enchant(owner, key, [], left); };
const hasFog = (s, c) => s.enchant.some((e) => e.owner === c && e.key.startsWith("fog-of-war"));
const place = (s, key, owner, more = {}) => { const card = { ...hand.newCard(s, key), ...more }; s.effects.push({ id: card.id, owner, card, placedAt: s.ply }); }; // A PASSIVE ALREADY WAITING

/**
 * @description Why a chess engine can't be asked about this board (chess.js refuses it, or the side not to move is in check), null when it can.
 */
function notChess(fen) {
	let chess;
	try { chess = new Chess(fen); } catch (err) { return err.message; }
	const turn = chess.turn();
	return chess.isAttacked(chess.findPiece({ type: "k", color: other(turn) })[0], turn) ? "the side not to move is in check" : null;
}

/**
 * @description A game on this board (ids as board.fromFen numbers them), Card Guy the side to move unless told, both hands as newGame dealt them.
 */
function position(fen, { cardGuy: v = fen.split(" ")[1], level = 2400, seed = 1 } = {}) {
	const s = newGame({ cardGuy: v, level, seed });
	s.board = fromFen(fen);
	return s;
}

/**
 * @description Card Guy's action for color on the true state: asked again with each refused action until one is legal (only a Fog of War of the other side's may refuse one). Returns { action, refused: how many }.
 */
async function ask(s, c, o) {
	const refused = [];
	const veiled = s.board.sq.map((q, i) => (q && q.c === c && (s.statuses[q.id] || []).some((e) => e.veiled) ? [q.id, engine.board.sqName(i)] : null)).filter(Boolean);
	const aboutVeiled = (a) => veiled.some(([id, sq]) => JSON.stringify(a).includes("\"" + id + "\"") || JSON.stringify(a).includes("\"from\":\"" + sq + "\"")); // HIS OWN VEILED FROZEN IS NOT IN HIS VIEW (#493): HIS REBUILT STATE MAY MOVE THAT PAWN OR NAME IT (SWAP); ONLY THOSE ARE LET THROUGH
	if (!hasFog(s, other(c)) && !s.players[c].curses.some((k) => k.key.startsWith("mirage"))) { // CARD GUY'S REBUILT STATE LISTS ONLY WHAT THE REAL GAME ALLOWS (THE legal FILTER BELOW WOULD HIDE A WRONG ONE)
		const wrong = legalActions(engine.fromView(playerView(s, c), 7), c).find((a) => !isLegal(s, c, a) && !aboutVeiled(a));
		assert.ok(!wrong, "the rebuilt state lists an illegal action with no fog up: " + JSON.stringify(wrong));
	}
	for (;;) {
		const action = await cardGuyTurn(playerView(s, c), s.level, opts({ ...o, refused, legal: engine.playerLegal(s, c) })); // THE LIST A PLAYER IS TOLD, AS cardsController PASSES IT
		if (isLegal(s, c, action)) return { action, refused: refused.length };
		assert.ok(hasFog(s, other(c)), "an illegal action with no fog up: " + JSON.stringify(action));
		assert.ok(!refused.includes(actionKey(action)), "a refused action came back: " + JSON.stringify(action));
		assert.ok(refused.length < 80, "80 refusals in one turn");
		refused.push(actionKey(action));
	}
}

/**
 * @description Card Guy plays both sides of s for up to n actions (each tested against applyAction on the true state). Returns { state, actions, refused, foggy: the turns asked with the other side's fog up }.
 */
async function play(s, n, o = {}) {
	let actions = 0, refused = 0, foggy = 0;
	while (actions < n && !s.result) {
		const c = owes(s), r = await ask(s, c, { seed: (o.seed || 0) * 1000 + actions, ...o });
		if (hasFog(s, other(c))) { foggy++; }
		s = applyAction(s, c, r.action).state; // THROWS IF IT ISN'T LEGAL
		refused += r.refused;
		actions++;
	}
	return { state: s, actions, refused, foggy };
}

module.exports = { engine, newGame, legalActions, applyAction, playerView, actionKey, toFen, fromFen, hand, makeCtx, PASSIVE_KEYS, CARDS, cardGuy, cardGuyTurn, scoreTurn, MAX_EVALS, candidates, staticScore, cardScore, duelValue, WEIGHTS, pick, FLAIR_MARGIN, noticeFor, bestOf, Chess, other, VALUE, material, firstOf, down, opts, isLegal, owes, fogUp, hasFog, place, notChess, position, ask, play };
