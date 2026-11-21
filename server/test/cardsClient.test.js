/*
 *  cardsClient.test.js  --  chess server tests
 *	The Chess Cards client's pure modules (client/src/js/gameplay/cards/): store.js, the game as the card routes last told it
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cards, takeResponse } = require("../../client/src/js/gameplay/cards/store.js");

// A CARD ROUTE'S BODY (cardsResponse IN server/controllers/cardsController.js), WITH WHAT A TEST CHANGES
const body = (fields = {}) => ({ status: 200, game_id: "g1", mode: "cards", ai_level: 1300, you: "w", view: { board: { turn: "w" } }, legal: [{ type: "move", from: "e2", to: "e4" }], legal_hidden: false, events: [], card_guy_due: false, result: null, ...fields });

test("takeResponse keeps the view, the legal actions and the side, and hands back the events to show", () => {
	const events = [{ type: "card-played", player: "b" }, { type: "move", player: "b", from: "e7", to: "e5" }];
	const r = body({ you: "b", view: { board: { turn: "w" } }, events, card_guy_due: true });
	assert.deepEqual(takeResponse(r), events);
	assert.deepEqual(cards, { view: r.view, legal: r.legal, you: "b", result: null, cardGuyDue: true });
});

test("a stale reply replaces everything with the fresh game, and has no events to show", () => {
	takeResponse(body({ card_guy_due: true, events: [{ type: "move", player: "w", from: "e2", to: "e4" }] }));
	const fresh = body({ status: 409, stale: true, you: "b", view: { board: { turn: "b" } }, legal: [], card_guy_due: false, result: { winner: "w", reason: "forfeit" }, message: "Game is over" });
	assert.deepEqual(takeResponse(fresh), []);
	assert.deepEqual(cards, { view: fresh.view, legal: [], you: "b", result: { winner: "w", reason: "forfeit" }, cardGuyDue: false });
});

test("an answer with no game in it (an error, or no answer) changes nothing and has no events", () => {
	const r = body();
	takeResponse(r);
	for (const answer of [undefined, { status: 400, message: "Invalid action" }, { status: 409, game_id: "g1", message: "This game is from an older version" }, { status: 502, serverError: true }]) {
		assert.deepEqual(takeResponse(answer), []);
	}
	assert.deepEqual(cards, { view: r.view, legal: r.legal, you: "w", result: null, cardGuyDue: false });
});
