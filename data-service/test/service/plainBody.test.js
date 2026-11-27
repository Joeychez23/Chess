/*
 *  plainBody.test.js  --  data service tests
 *	Test Plain Body
 *  Every item in a response body leaves the data service as plain values, not DynamoDB's { S }, { N }, { BOOL } wrappers
 *
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { plainBody } = require("../../utils/plainBody.js");

test("a string, a number, a boolean and a null come out plain", () => {
	const body = plainBody({ status: 200, game_data: { game_id: { S: "g1" }, turn_count: { N: "12" }, ai_game: { BOOL: false }, rematch_game_id: { NULL: true } }, message: "Game data" });
	assert.deepEqual(body, { status: 200, game_data: { game_id: "g1", turn_count: 12, ai_game: false, rematch_game_id: null }, message: "Game data" });
});

test("moves and prev_move come out as the arrays they already hold", () => {
	const moves = [["e2", "e4"], ["e7", "e5"]];
	const body = plainBody({ game_data: { moves: { S: moves }, prev_move: { S: ["e7", "e5"] } } });
	assert.deepEqual(body.game_data.moves, moves);
	assert.deepEqual(body.game_data.prev_move, ["e7", "e5"]);
});

test("a field holding JSON text stays the same text", () => {
	const cardsState = JSON.stringify({ hands: { w: [1, 2] } });
	const body = plainBody({ game_data: { cards_state: { S: cardsState } } });
	assert.equal(body.game_data.cards_state, cardsState);
});

test("lists, maps and sets are converted all the way down", () => {
	const body = plainBody({ item: { a: { L: [{ S: "x" }, { N: "2" }, { M: { b: { BOOL: true } } }] }, c: { M: { d: { L: [{ NULL: true }] } } }, e: { SS: ["p", "q"] }, f: { NS: ["1", "2.5"] } } });
	assert.deepEqual(body.item, { a: ["x", 2, { b: true }], c: { d: [null] }, e: ["p", "q"], f: [1, 2.5] });
});

test("a missing attribute stays missing and non-item fields are unchanged", () => {
	const body = plainBody({ status: 409, game_id: "g1", dropped_invites: [{ game_id: { S: "g2" } }], usernames: ["ann"], requested: true, message: "Nope" });
	assert.deepEqual(body, { status: 409, game_id: "g1", dropped_invites: [{ game_id: "g2" }], usernames: ["ann"], requested: true, message: "Nope" });
	assert.equal("rematch_game_id" in plainBody({ game_data: { game_id: { S: "g1" } } }).game_data, false);
});

test("the item it was given is not changed", () => {
	const item = { game_id: { S: "g1" } };
	plainBody({ game_data: item });
	assert.deepEqual(item, { game_id: { S: "g1" } });
});
