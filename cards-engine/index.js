/*
 *  index.js  --  chess cards engine
 *	Public API (grows in later tasks)
 *
 */

const rng = require("./rng.js");
const board = require("./board.js");
const hand = require("./hand.js");
const turn = require("./turn.js");
const { makeCtx } = require("./ctx.js");
const view = require("./view.js");

const ENGINE_VERSION = 1;
const KING_SKULLS = 3; // THE KING CARD'S SKULLS AT THE START: THE ONE PLACE TO TUNE THEM
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

class IllegalAction extends Error {
	constructor(message = "That action isn't available") {
		super(message);
		this.name = "IllegalAction";
		this.code = "ILLEGAL";
	}
}

/**
 * @description A new game from the start position (seed: a 64-character hex string, or an integer in tests; see rng.seed): each colour's piece ids shuffled with the game rng (so an id never tells the piece type), each player dealt 6 move cards and 1 active and given KING_SKULLS King skulls (kingSkulls), White to move.
 */
function newGame({ vesper, level, seed }) {
	const player = () => ({ king: true, moves: [], actives: [], passive: null, curses: [], used: [], skips: 0, refillLock: 0, curseWait: 0, lostTurns: 0, kingSkulls: KING_SKULLS, captured: [], seen: null });
	const state = {
		v: ENGINE_VERSION, rng: rng.seed(seed), board: board.fromFen(START), vesper, level, ply: 0, nextId: 1,
		players: { w: player(), b: player() }, statuses: {}, effects: [], enchant: [], duel: null, pending: null, multi: null, barred: null, result: null,
	};
	for (const c of ["w", "b"]) {
		const ids = rng.shuffle(state, Array.from({ length: 16 }, (_, i) => c + (i + 1)));
		state.board.sq.filter((p) => p && p.c === c).forEach((p, i) => { p.id = ids[i]; });
	}
	const ctx = makeCtx(state);
	hand.refill(ctx, "w");
	hand.refill(ctx, "b");
	turn.startTurn(ctx, "w");
	return state;
}

/**
 * @description Resolve one action for player on a deep copy of state; throws IllegalAction for anything not in legalActions (compared by actionKey). Returns { state, events }. Event types: move, capture, promote, check, card-played, card-cancelled, passive-placed, passive-fired, passive-cancelled, status, status-ended, enchant, enchant-ended, curse-given, curse-fired, curse-cleared, draw, discard, redraw, turn-start, turn-skipped, king-skull, choice, duel-deal, duel-flip, duel-result, move-undone, game-over.
 */
function applyAction(state, player, action) {
	const key = turn.actionKey(action);
	if (!turn.legalActions(state, player).some((a) => turn.actionKey(a) === key)) throw new IllegalAction();
	const ctx = makeCtx(JSON.parse(JSON.stringify(state)));
	turn.act(ctx, player, JSON.parse(key));
	return { state: ctx.state, events: ctx.events };
}

module.exports = {
	ENGINE_VERSION, KING_SKULLS, IllegalAction, newGame, applyAction, legalActions: turn.legalActions, actionKey: turn.actionKey, rng, board,
	playerView: view.playerView, playerEvents: view.playerEvents, fromView: view.fromView, toFen: view.toFen,
};
