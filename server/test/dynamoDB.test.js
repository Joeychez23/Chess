/*
 *  dynamoDB.test.js  --  chess server tests
 *	Conditional Writes (server/dynamoDB.js)
 *  The saves that guard against two requests at once, and saves that don't trust a read back, run against the in-memory tables
 *
 */

require("./helpers/env.js");
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fakeDynamo = require("./helpers/fakeDynamo.js");
fakeDynamo.install();
const db = require("../dynamoDB.js");
const { validateMove } = require("../utils/validate.js");
const { Chess } = require("chess.js");

beforeEach(() => fakeDynamo.reset());

const list = (item, name) => JSON.parse(item[name].S);

async function newGame() {
	const created = await db.initalizeGame("game1", "alice", "CHESS_AI", 3, { start_params: { color: "w" } });
	return created.game_data;
}

describe("updateGame", () => {
	test("saves a move made on the current board", async () => {
		const gameData = await newGame();
		const board = gameData.game_board.S;
		const moved = await validateMove({ player_id: "alice", move: ["e2", "e4"] }, gameData);
		assert.equal((await db.updateGame(moved.game_data, board)).status, 200);
		assert.deepEqual((await db.retrieveGame("game1")).game_data.moves.S, ["e4"]);
	});

	test("refuses a second move made on the same old board (two requests at once)", async () => {
		const first = await newGame();
		const second = (await db.retrieveGame("game1")).game_data;
		const board = first.game_board.S;

		await db.updateGame((await validateMove({ player_id: "alice", move: ["e2", "e4"] }, first)).game_data, board);
		const late = await db.updateGame((await validateMove({ player_id: "alice", move: ["d2", "d4"] }, second)).game_data, board);
		assert.equal(late.status, 500);
		assert.match(late.message, /Board changed/);
		assert.deepEqual((await db.retrieveGame("game1")).game_data.moves.S, ["e4"]);
	});

	test("reports a saved move as saved when a read would still return the old board", async () => {
		const gameData = await newGame();
		const board = gameData.game_board.S;
		fakeDynamo.staleReads(true);

		const saved = await db.updateGame((await validateMove({ player_id: "alice", move: ["e2", "e4"] }, gameData)).game_data, board);
		assert.equal(saved.status, 200);
		assert.deepEqual(saved.game_data.moves.S, ["e4"]); // THE GAME AS SAVED
		assert.notEqual(saved.game_data.game_board.S, board);
		assert.deepEqual(list(fakeDynamo.peek("chess_db", "game1"), "moves"), ["e4"]);
	});
});

describe("saves without a read back", () => {
	test("initalizeGame reports a new game as created when a read can't find it yet", async () => {
		fakeDynamo.staleReads(true);
		const created = await db.initalizeGame("game1", "alice", "CHESS_AI", 3, { start_params: { color: "w" } });
		assert.equal(created.status, 200);
		assert.equal(created.game_data.game_board.S, new Chess().fen());
		assert.deepEqual(created.game_data.moves.S, []); // PARSED, LIKE retrieveGame
		assert.ok(fakeDynamo.peek("chess_db", "game1"));
	});

	test("initalizeUser keeps a row that's already there (a read that lagged missed it)", async () => {
		await newGame(); // ALICE'S ROW LISTS game1
		const again = await db.initalizeUser("alice");
		assert.equal(again.status, 200);
		assert.deepEqual(list(again.user_data, "open_games"), ["game1"]);
		assert.deepEqual(list(fakeDynamo.peek("user_db", "alice"), "open_games"), ["game1"]);
	});
});

describe("closeGame", () => {
	test("only the first close wins (a forfeit and a checkmate at the same time)", async () => {
		const gameData = await newGame();
		assert.equal((await db.closeGame(gameData, "b", "forfeit")).status, 200);
		const second = await db.closeGame(gameData, "w", "checkmate");
		assert.equal(second.status, 500);
		assert.equal((await db.retrieveGame("game1")).game_data.reason.S, "forfeit");
	});

	test("an AI game keeps its expiry, a friend game loses it", async () => {
		const aiGame = await newGame();
		await db.closeGame(aiGame, "b", "forfeit");
		assert.ok(fakeDynamo.peek("chess_db", "game1").expireAt);

		const friendGame = (await db.initalizeGame("game2", "alice", "bob", false, {})).game_data;
		await db.closeGame(friendGame, "w", "checkmate");
		assert.equal(fakeDynamo.peek("chess_db", "game2").expireAt, undefined);
	});
});

describe("invites", () => {
	test("an invite can be accepted or declined once, not both", async () => {
		const invite = (await db.initalizeGame("game3", "alice", "bob", false, { pending: true, inviter_id: "alice" })).game_data;
		assert.equal((await db.acceptInvite(invite)).status, 200);
		assert.equal((await db.deleteInvite(invite)).status, 500); // ALREADY ACCEPTED
		assert.equal((await db.acceptInvite(invite)).status, 500);
	});
});

describe("rematch", () => {
	test("the second player's press claims the rematch, and only once", async () => {
		await db.initalizeGame("game4", "alice", "bob", false, {});
		const expires = Date.now() + 60000;
		assert.equal(await db.requestRematch("game4", "alice", expires), true);
		assert.equal(await db.requestRematch("game4", "bob", expires), false); // ALICE IS ALREADY WAITING
		assert.equal(await db.acceptRematch("game4", "alice", "new1"), false); // CAN'T ACCEPT YOUR OWN REQUEST
		assert.equal(await db.acceptRematch("game4", "bob", "new1"), true);
		assert.equal(await db.acceptRematch("game4", "bob", "new2"), false); // ALREADY STARTED
	});

	test("an expired request can't be accepted", async () => {
		await db.initalizeGame("game5", "alice", "bob", false, {});
		await db.requestRematch("game5", "alice", Date.now() - 1);
		assert.equal(await db.acceptRematch("game5", "bob", "new1"), false);
	});
});
