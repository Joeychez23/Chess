/*
 *  index.js  --  chess cards engine
 *	Public API (grows in later tasks)
 *
 */

const rng = require("./rng.js");
const board = require("./board.js");
const hand = require("./hand.js");
const turn = require("./turn/index.js");
const { makeCtx } = require("./ctx.js");
const { inCheck } = require("./rules.js");
const view = require("./view.js");
const { baseKey } = require("./cards/index.js");

// Version 2: the Knight / Bishop card (a version 1 game holds Knight and Bishop cards nothing moves now).
// Version 3: one Insidious Nullification (a version 2 game can hold insidious-nullification-rare or its forfeit choice),
// Hunger loses a turn, one one-knight Heavy Cavalry (a version 2 game can hold heavy-cavalry-epic or a two-knight entry).
const ENGINE_VERSION = 3;
const KING_SKULLS = 3; // the King card's skulls at the start: the one place to tune them
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

class IllegalAction extends Error {
	constructor(message = "That action isn't available") {
		super(message);
		this.name = "IllegalAction";
		this.code = "ILLEGAL";
	}
}

/**
 * @description A new game from the start position (seed: a 64-character hex string, or an integer in tests; see
 * rng.seed): each colour's piece ids shuffled with the game rng (so an id never tells the piece type), each player
 * dealt 5 move cards (hand.HAND_MOVES) and 1 active and given KING_SKULLS King skulls (kingSkulls), White to move.
 */
function newGame({ cardGuy, level, seed }) {
	const state = {
		v: ENGINE_VERSION,
		rng: rng.seed(seed),
		board: board.fromFen(START_FEN),
		cardGuy,
		level,
		ply: 0,
		nextId: 1,
		players: { w: newPlayer(), b: newPlayer() },
		statuses: {},
		effects: [],
		enchant: [],
		duel: null,
		pending: null,
		multi: null,
		barred: null,
		discarded: null,
		result: null,
	};
	for (const color of ["w", "b"]) {
		const ids = rng.shuffle(state, Array.from({ length: 16 }, (_, i) => color + (i + 1)));
		const pieces = state.board.sq.filter((piece) => piece && piece.c === color);
		for (let i = 0; i < pieces.length; i++) pieces[i].id = ids[i];
	}
	const ctx = makeCtx(state);
	hand.refill(ctx, "w");
	hand.refill(ctx, "b");
	turn.startTurn(ctx, "w");
	return state;
}

function newPlayer() {
	return {
		king: true,
		moves: [],
		actives: [],
		passive: null,
		curses: [],
		used: [],
		refillLock: 0,
		curseWait: 0,
		lostTurns: 0,
		kingSkulls: KING_SKULLS,
		captured: [],
		seen: null,
		kept: null,
		pile: { n: 0, top: null },
		spot: [],
		gone: [],
	};
}

/**
 * @description Resolve one action for player on a deep copy of state; throws IllegalAction for anything not in
 * legalActions (compared by actionKey). Returns { state, events }. Event types: move, capture (with sq, the captured
 * piece's square, and from, the shooting piece's square, for a card's ranged shot: Overwatch), promote, check (also at
 * the start of a turn for a side a trigger or an ended status put in check; it says what holds when emitted, and a
 * later effect in the same action can lift it, so the client reads the standing check from the state at turn-start),
 * card-played, card-cancelled, passive-placed, passive-fired, passive-cancelled, status, status-ended, enchant,
 * enchant-ended, curse-given, curse-fired, curse-cleared, draw, discard (kept: true for the free discard's remembered
 * move card), card-dropped (a placed card dropped by its owner, or with replaced: true the oldest waiting passive a
 * fourth one replaced), card-ended (an active leaves the active spot for the discard pile), redraw, turn-start,
 * turn-skipped, king-skull, card-taken, handover, choice, duel-deal, duel-flip, duel-result, move-undone, game-over.
 */
function applyAction(state, player, action) {
	const key = turn.actionKey(action);
	// Only this one action is checked; the full list of legal actions is not built
	if (!turn.isLegal(state, player, action)) throw new IllegalAction();
	const ctx = makeCtx(JSON.parse(JSON.stringify(state)));
	turn.act(ctx, player, JSON.parse(key));
	const result = ctx.state.result;
	const isMate = result && result.reason === "checkmate" && result.winner === player;
	const grace = isMate && ctx.state.effects.find((entry) => entry.owner !== player && baseKey(entry.card.key) === "grace");
	if (grace) return graceUndo(state, player, JSON.parse(key), ctx, grace.id);
	return { state: ctx.state, events: ctx.events };
}

/**
 * @description Grace (cards/passive/grace.js): player's action checkmated the owner of a placed Grace (after the
 * owner's redraw). Returns the state from before the action (state) with the rng and nextId kept advanced (done: the
 * action's ctx), Grace fired (passive-fired; its key in the owner's used), player drawing 1 active card (the normal
 * draw; over the cap it is lost), the action barred for the rest of player's turn (state.barred = turn.barKey(action):
 * a move is barred whatever card plays it), and the events: the action's move events (a spent move card shown only as
 * "move": it is back in player's hand), passive-fired, the draws, move-undone { player }. With no action left, the
 * no-legal-action rule: a two-move turn ends; else, and in Mulligan's one-move turn (the free discard doesn't count as
 * an action left), turn.noAction (redraw, then checkmate by the cards or stalemate). Out of scope: a mate completed by
 * the owner's own action (a duel pick, an answer to a choice).
 */
function graceUndo(state, player, action, done, graceId) {
	const before = JSON.parse(JSON.stringify(state));
	const ctx = makeCtx(before);
	// As turn.act does: a check standing before the undone action was already announced
	ctx.stood = ["w", "b"].filter((color) => inCheck(before, color));
	Object.assign(before, { rng: done.state.rng, nextId: done.state.nextId, barred: turn.barKey(action) });
	ctx.passiveFired(before.effects.find((entry) => entry.id === graceId));
	hand.drawCard(ctx, player, "active");
	ctx.emit({ type: "move-undone", player });
	// Mulligan's one move: no move left is the automatic redraw, as right after Mulligan (turn.act), whether or not
	// the free discard is still open
	const isMulled = !!before.multi && !!before.multi.mulled;
	if (before.multi && !isMulled && before.multi.player === player && !turn.legalActions(before, player).length) {
		// No other second move: the two-move turn ends
		turn.endTurn(ctx, player);
	} else if ((!before.multi || isMulled) && !before.pending && !before.duel) {
		// An open choice or duel is its own action: no redraw, no stalemate
		turn.noAction(ctx, player);
	}
	// The spent card went back to the hand: don't show it
	const moves = done.events
		.filter((event) => event.type === "move" && event.player === player)
		.map((event) => (event.card && typeof event.card === "object" ? { ...event, card: "move" } : event));
	return { state: before, events: [...moves, ...ctx.events] };
}

module.exports = {
	ENGINE_VERSION,
	KING_SKULLS,
	PASSIVES: turn.PASSIVES,
	IllegalAction,
	newGame,
	applyAction,
	legalActions: turn.legalActions,
	actionKey: turn.actionKey,
	rng,
	board,
	playerView: view.playerView,
	playerEvents: view.playerEvents,
	fromView: view.fromView,
	toFen: view.toFen,
	playerLegal: view.playerLegal,
};

// Every card, registered once the core modules (and these exports) are whole
require("./cards/all.js");
