/*
 *  dynamoDB.test.js  --  data service tests
 *	Conditional Writes (data-service/dynamoDB.js, copied from the server's tests with it)
 *  The saves that guard against two requests at once, and saves that don't trust a read back, run against the in-memory tables
 *
 */

require("./helpers/env.js");
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fakeDynamo = require("./helpers/fakeDynamo.js");
fakeDynamo.install();
const db = require("../dynamoDB.js");
const { validateMove, undoMoves } = require("../utils/validate.js");
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

	test("an undo and a move made on the same board can't both land, whichever saves first", async () => {
		for (const undoFirst of [true, false]) {
			fakeDynamo.reset();
			const gameData = await newGame();
			const start = gameData.game_board.S;
			await db.updateGame((await validateMove({ player_id: "alice", move: ["e2", "e4"] }, gameData)).game_data, start);
			const read = (await db.retrieveGame("game1")).game_data; // BOTH START FROM THIS: ALICE TAKES BACK e4 WHILE THE AI ANSWERS IT
			const board = read.game_board.S;
			const undo = undoMoves(structuredClone(read), 1).game_data;
			const aiMove = (await validateMove({ player_id: "CHESS_AI", move: ["e7", "e5"] }, structuredClone(read))).game_data;

			const [first, second] = undoFirst ? [undo, aiMove] : [aiMove, undo];
			assert.equal((await db.updateGame(first, board)).status, 200);
			assert.equal((await db.updateGame(second, board)).status, 500);
			assert.deepEqual((await db.retrieveGame("game1")).game_data.moves.S, undoFirst ? [] : ["e4", "e5"]);
		}
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

describe("game lists", () => {
	const lists = (userId) => {
		const item = fakeDynamo.peek("user_db", userId);
		return { requested_games: list(item, "requested_games"), open_games: list(item, "open_games"), closed_games: list(item, "closed_games") };
	};

	test("two changes to a player's lists at once both stay (an AI game ends while an invite is accepted)", async () => {
		const aiGame = await newGame();
		const invite = (await db.initalizeGame("game2", "alice", "bob", false, { pending: true, inviter_id: "bob" })).game_data; // ALICE IS WHITE IN BOTH, SO BOTH SAVES REACH HER ROW AT ONCE

		await Promise.all([db.closeGame(aiGame, "b", "forfeit"), db.acceptInvite(invite)]);
		assert.deepEqual(lists("alice"), { requested_games: [], open_games: ["game2"], closed_games: ["game1"] });
		assert.deepEqual(lists("bob"), { requested_games: [], open_games: ["game2"], closed_games: [] });
	});

	test("a new player's first two games at once are both listed", async () => {
		await Promise.all([
			db.initalizeGame("game1", "alice", "CHESS_AI", 3, {}),
			db.initalizeGame("game2", "alice", "bob", false, { pending: true, inviter_id: "bob" }),
		]);
		assert.deepEqual(lists("alice"), { requested_games: ["game2"], open_games: ["game1"], closed_games: [] });
	});

	test("changes stay when reads return the lists from before the last save", async () => {
		fakeDynamo.staleReads(true);
		const first = await newGame();
		await db.closeGame(first, "b", "forfeit");
		await db.initalizeGame("game2", "alice", "CHESS_AI", 3, {});
		await db.initalizeGame("game3", "bob", "alice", false, { pending: true, inviter_id: "bob" });
		assert.deepEqual(lists("alice"), { requested_games: ["game3"], open_games: ["game2"], closed_games: ["game1"] });
	});

	test("a declined invite is dropped when a read would still miss it", async () => {
		fakeDynamo.staleReads(true);
		const invite = (await db.initalizeGame("game1", "alice", "bob", false, { pending: true, inviter_id: "bob" })).game_data;
		assert.equal((await db.deleteInvite(invite)).status, 200);
		assert.deepEqual(lists("alice").requested_games, []);
		assert.deepEqual(lists("bob").requested_games, []);
	});

	test("a finished game left in open_games isn't the open game", async () => {
		await newGame(); // OPEN
		await db.initalizeGame("game2", "alice", "CHESS_AI", 3, {});
		await db.initalizeGame("game3", "alice", "bob", false, {});
		await db.closeGame((await db.retrieveGame("game2")).game_data, "b", "forfeit");
		await db.closeGame((await db.retrieveGame("game3")).game_data, "b", "forfeit");

		const user = (await db.retrieveUser("alice")).user_data; // PUT THE FINISHED GAMES BACK, LIKE A SAVE THAT LOST A RACE USED TO
		await db.updateUser(user, { requested_games: [], open_games: ["game1", "game2", "game3"], closed_games: ["game2", "game3"] });

		const userData = await db.pruneOpenGames((await db.retrieveUser("alice")).user_data);
		assert.equal(userData.ai_game_id, "game1"); // NOT game2, THE NEWEST
		assert.equal(userData.friend_game_id, null);
		assert.deepEqual(userData.open_game_list.map((game) => game.game_id.S), ["game1"]);
	});

	test("a save made from lists that changed since they were read is refused", async () => {
		await newGame();
		const stale = (await db.retrieveUser("alice")).user_data;
		await db.closeGame((await db.retrieveGame("game1")).game_data, "b", "forfeit");

		const late = await db.updateUser(stale, { requested_games: [], open_games: ["game1", "game2"], closed_games: [] });
		assert.equal(late.status, 500);
		assert.deepEqual(lists("alice"), { requested_games: [], open_games: [], closed_games: ["game1"] });
	});
});
