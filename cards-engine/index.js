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
const { inCheck } = require("./rules.js");
const view = require("./view.js");
const { baseKey } = require("./cards/index.js");

const ENGINE_VERSION = 2; // 2: THE KNIGHT / BISHOP CARD (A VERSION 1 GAME HOLDS KNIGHT AND BISHOP CARDS NOTHING MOVES NOW)
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
 * @description A new game from the start position (seed: a 64-character hex string, or an integer in tests; see rng.seed): each colour's piece ids shuffled with the game rng (so an id never tells the piece type), each player dealt 5 move cards (hand.MOVES) and 1 active and given KING_SKULLS King skulls (kingSkulls), White to move.
 */
function newGame({ cardGuy, level, seed }) {
	const player = () => ({ king: true, moves: [], actives: [], passive: null, curses: [], used: [], refillLock: 0, curseWait: 0, lostTurns: 0, kingSkulls: KING_SKULLS, captured: [], seen: null, kept: null, pile: { n: 0, top: null }, spot: [], gone: [] });
	const state = {
		v: ENGINE_VERSION, rng: rng.seed(seed), board: board.fromFen(START), cardGuy, level, ply: 0, nextId: 1,
		players: { w: player(), b: player() }, statuses: {}, effects: [], enchant: [], duel: null, pending: null, multi: null, barred: null, discarded: null, result: null,
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
 * @description Resolve one action for player on a deep copy of state; throws IllegalAction for anything not in legalActions (compared by actionKey). Returns { state, events }. Event types: move, capture (with sq, the captured piece's square), promote, check (also at the start of a turn for a side a trigger or an ended status put in check; it says what holds when emitted, and a later effect in the same action can lift it, so the client reads the standing check from the state at turn-start), card-played, card-cancelled, passive-placed, passive-fired, passive-cancelled, status, status-ended, enchant, enchant-ended, curse-given, curse-fired, curse-cleared, draw, discard (kept: true for the free discard's remembered move card), card-dropped (a placed card dropped by its owner, or with replaced: true the oldest waiting passive a fourth one replaced), card-ended (an active leaves the active spot for the discard pile), redraw, turn-start, turn-skipped, king-skull, card-taken, handover, choice, duel-deal, duel-flip, duel-result, move-undone, game-over.
 */
function applyAction(state, player, action) {
	const key = turn.actionKey(action);
	if (!turn.legalActions(state, player).some((a) => turn.actionKey(a) === key)) throw new IllegalAction();
	const ctx = makeCtx(JSON.parse(JSON.stringify(state)));
	turn.act(ctx, player, JSON.parse(key));
	const r = ctx.state.result, grace = r && r.reason === "checkmate" && r.winner === player && ctx.state.effects.find((e) => e.owner !== player && baseKey(e.card.key) === "grace");
	if (grace) return graceUndo(state, player, JSON.parse(key), ctx, grace.id);
	return { state: ctx.state, events: ctx.events };
}

/**
 * @description Grace (cards/passive/grace.js): player's action checkmated the owner of a placed Grace (after the owner's redraw). Returns the state from before the action (state) with the rng and nextId kept advanced (done: the action's ctx), Grace fired (passive-fired; its key in the owner's used), player drawing 1 active card (the normal draw; over the cap it is lost), the action barred for the rest of player's turn (state.barred = turn.barKey(action): a move is barred whatever card plays it), and the events: the action's move events (a spent move card shown only as "move": it is back in player's hand), passive-fired, the draws, move-undone { player }. With no action left, the no-legal-action rule: a two-move turn ends; else, and in Mulligan's one-move turn (the free discard doesn't count as an action left), turn.noAction (redraw, then checkmate by the cards or stalemate). Out of scope (ruling): a mate completed by the owner's own action (a duel pick, an answer to a choice).
 */
function graceUndo(state, player, action, done, graceId) {
	const s = JSON.parse(JSON.stringify(state)), ctx = makeCtx(s);
	ctx.stood = ["w", "b"].filter((c) => inCheck(s, c)); // AS turn.act DOES: A CHECK STANDING BEFORE THE UNDONE ACTION WAS ALREADY ANNOUNCED
	Object.assign(s, { rng: done.state.rng, nextId: done.state.nextId, barred: turn.barKey(action) });
	ctx.passiveFired(s.effects.find((e) => e.id === graceId));
	hand.drawCard(ctx, player, "active");
	ctx.emit({ type: "move-undone", player });
	const mulled = !!s.multi && !!s.multi.mulled; // MULLIGAN'S ONE MOVE: NO MOVE LEFT IS THE AUTOMATIC REDRAW, AS RIGHT AFTER MULLIGAN (turn.act), WHETHER OR NOT THE FREE DISCARD IS STILL OPEN
	if (s.multi && !mulled && s.multi.player === player && !turn.legalActions(s, player).length) turn.endTurn(ctx, player); // NO OTHER SECOND MOVE: THE TWO-MOVE TURN ENDS
	else if ((!s.multi || mulled) && !s.pending && !s.duel) turn.noAction(ctx, player); // AN OPEN CHOICE OR DUEL IS ITS OWN ACTION: NO REDRAW, NO STALEMATE
	const moves = done.events.filter((e) => e.type === "move" && e.player === player).map((e) => (e.card && typeof e.card === "object" ? { ...e, card: "move" } : e)); // THE CARD WENT BACK TO THE HAND: DON'T SHOW IT
	return { state: s, events: [...moves, ...ctx.events] };
}

module.exports = {
	ENGINE_VERSION, KING_SKULLS, IllegalAction, newGame, applyAction, legalActions: turn.legalActions, actionKey: turn.actionKey, rng, board,
	playerView: view.playerView, playerEvents: view.playerEvents, fromView: view.fromView, toFen: view.toFen, playerLegal: view.playerLegal,
};

require("./cards/all.js"); // EVERY CARD, REGISTERED ONCE THE CORE MODULES (AND THESE EXPORTS) ARE WHOLE
