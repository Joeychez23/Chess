/*
 *  activeBoard.js  --  chess cards engine test helpers
 *	Shared setup for the board actives tests (test/cards/activeBoard/): the cards they register, a game on a FEN and the ways to play or pass a turn.
 *
 */

const { newGame, legalActions, applyAction, KING_SKULLS, playerView, playerEvents } = require("../../../cards-engine/index.js");
const { fromFen, sqIndex } = require("../../../cards-engine/board.js");
const { legalMoves, inCheck } = require("../../../cards-engine/rules.js");
const { makeCtx } = require("../../../cards-engine/ctx.js");
const { startTurn } = require("../../../cards-engine/turn/index.js");
const statuses = require("../../../cards-engine/statuses.js");
const hand = require("../../../cards-engine/hand.js");
const { register, reset } = require("../../../cards-engine/cards/index.js");

reset(); // THE ENGINE ENTRY REGISTERS EVERY CARD: THESE TESTS DRAW FROM ONLY THE CARDS THEY REGISTER

for (const key of ["stronghold", "heavy-cavalry", "heretical-subjection", "last-stand", "opposing-finality", "swap", "conscription", "trapdoor"]) register(require("../../../cards-engine/cards/active/" + key + ".js"));
register(require("../../../cards-engine/cards/active/double-time.js")); // DOUBLE TIME, READ ONLY: A TWO-MOVE TURN FOR THE TRAPDOOR TEST
for (const key of ["cleanse", "hexcraft", "all-or-nothing"]) register(require("../../../cards-engine/cards/active/" + key + ".js")); // HAND CARDS, READ ONLY: A MARK REMOVED OR GIVEN ON TOP OF A CLAIMED ONE; ALL OR NOTHING'S LOST HAND FORFEITS A PIECE (INSIDIOUS NULLIFICATION'S FORFEIT IS GONE)
register({ key: "t-pass", kind: "active", name: "t-pass", rarity: "common", text: "", targets: () => [null], play: () => {} });
register({ key: "t-trap", kind: "active", name: "t-trap", rarity: "common", text: "", on: { move: (ctx, owner, ev, src) => ev.to === src.data.square && ev.player !== owner && ctx.capture(owner, ev.piece) } }); // A REMOVAL TRAP (TRAPDOOR BEFORE 10b): A CARD CAPTURE ON THE MOVER'S OWN TURN

let passes = 0;
const ofType = (events, type) => events.filter((e) => e.type === type);
const id = (s, sq) => s.board.sq[sqIndex(sq)].id;
const sqOf = (s, pid) => { const i = s.board.sq.findIndex((p) => p && p.id === pid); return i < 0 ? null : "abcdefgh"[i % 8] + (8 - (i >> 3)); };
const has = (s, pid, st) => statuses.has(s, pid, st);
const actives = (s, c = "w") => legalActions(s, c).filter((a) => a.type === "active");
const captures = (s, c, from, to) => legalMoves(s, c).some((m) => m.from === from && m.to === to && m.capture);

/**
 * @description A game on this FEN with empty hands; White holds the active `key` as card c90.
 */
function game(fen, key) {
	const s = newGame({ cardGuy: "b", level: 1300, seed: 1 });
	s.board = fromFen(fen);
	for (const c of ["w", "b"]) Object.assign(s.players[c], { moves: [], actives: [], passive: null });
	if (key) s.players.w.actives = [{ id: "c90", key }];
	return s;
}

/**
 * @description White plays its held card c90 (with target when given); returns { state, events }.
 */
function play(s, target, card = "c90") {
	return applyAction(s, "w", target === undefined ? { type: "active", card } : { type: "active", card, target });
}

/**
 * @description color spends its turn on a no-op active; returns the new state.
 */
function pass(s, color) {
	const card = { id: "p" + ++passes, key: "t-pass" };
	s.players[color].actives = [card];
	return applyAction(s, color, { type: "active", card: card.id }).state;
}

/**
 * @description color makes a chess move with a fresh move card for the moving piece's type; returns { state, events }.
 */
/**
 * @description color plays the active `key` (with target when given) from a fresh card; returns { state, events }.
 */
function cardPlay(s, color, key, target) {
	const card = { id: "k" + ++passes, key };
	s.players[color].actives = [card];
	return applyAction(s, color, target === undefined ? { type: "active", card: card.id } : { type: "active", card: card.id, target });
}

function chess(s, color, from, to) {
	const card = { id: "m" + ++passes, key: "move", piece: hand.cardOf(s.board.sq[sqIndex(from)].t) }; // THE CARD TYPE THAT MOVES THE PIECE ON from
	s.players[color].moves = [card];
	return applyAction(s, color, { type: "move", card: card.piece ? card.id : "king", from, to }); // A KING MOVES BY THE KING CARD
}

module.exports = { newGame, legalActions, applyAction, KING_SKULLS, playerView, playerEvents, fromFen, sqIndex, legalMoves, inCheck, makeCtx, startTurn, statuses, hand, register, reset, ofType, id, sqOf, has, actives, captures, game, play, pass, cardPlay, chess };
