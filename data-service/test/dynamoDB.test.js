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
const { validateMove, undoMoves, gameResult } = require("../utils/validate.js");
const { Chess } = require("chess.js");

beforeEach(() => fakeDynamo.reset());

const list = (item, name) => JSON.parse(item[name].S);
const MATE_IN_ONE = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"; // Ra8#
const mateFriendGame = async () => (await db.initalizeGame("game1", "alice", "bob", false, { start_params: { color: "w", fen: MATE_IN_ONE }, inviter_id: "alice" })).game_data;
const playMate = async (gameData) => (await validateMove({ player_id: "alice", move: ["a1", "a8"] }, gameData)).game_data;

async function newGame() {
	const created = await db.initalizeGame("game1", "alice", "CHESS_AI", 3, { start_params: { color: "w" } });
	return created.game_data;
}

describe("move deadlines", () => {
	const dailyGame = async () => (await db.initalizeGame("game1", "alice", "bob", false, { start_params: { color: "w", days_per_move: 1 }, inviter_id: "alice" })).game_data;

	test("a timeout read from before the last move changes nothing", async () => {
		const game = await dailyGame();
		const closed = await db.closeGame({ ...game, move_deadline: { N: "1" } }, "b", "timeout");
		assert.equal(closed.status, 500);
		assert.equal(fakeDynamo.peek("chess_db", "game1").state.S, "OPEN");
	});

	test("an overdue game closes on the read that finds it, only that read says so", async () => {
		await dailyGame();
		fakeDynamo.poke("chess_db", "game1", { move_deadline: { N: "1" } });
		const first = await db.retrieveGame("game1", true);
		assert.equal(first.timed_out, true);
		assert.equal(first.game_data.winner.S, "b");
		assert.equal(first.game_data.reason.S, "timeout");
		const second = await db.retrieveGame("game1", true);
		assert.equal(second.timed_out, undefined);
		assert.equal(second.game_data.state.S, "CLOSED");
	});
});

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

	test("a closing move saves its result in the same write, and a late forfeit can't close it again", async () => {
		const stale = await mateFriendGame();
		const moved = await playMate(structuredClone(stale));
		const saved = await db.updateGame(moved, MATE_IN_ONE, gameResult(moved));
		assert.equal(saved.status, 200);
		assert.equal(saved.game_data.state.S, "CLOSED");
		assert.equal(saved.game_data.winner.S, "w");
		assert.equal(saved.game_data.reason.S, "checkmate");

		const stored = fakeDynamo.peek("chess_db", "game1");
		assert.equal(stored.state.S, "CLOSED");
		assert.equal(stored.game_board.S, moved.game_board.S);
		assert.equal(stored.expireAt, undefined); // FINISHED FRIEND GAMES ARE KEPT
		assert.equal((await db.closeGame(stale, "w", "forfeit")).status, 500);
	});

	test("a closing move loses to a forfeit that closed the game after the board was read", async () => {
		const read = await mateFriendGame();
		const moved = await playMate(structuredClone(read));
		await db.closeGame(read, "b", "forfeit");

		const late = await db.updateGame(moved, MATE_IN_ONE, gameResult(moved));
		assert.equal(late.status, 500);
		const stored = fakeDynamo.peek("chess_db", "game1");
		assert.equal(stored.game_board.S, MATE_IN_ONE);
		assert.equal(stored.reason.S, "forfeit");
	});

	test("a move read before a forfeit is refused and the finished game stays as it closed", async () => {
		const read = await mateFriendGame();
		const moved = (await validateMove({ player_id: "alice", move: ["a1", "a2"] }, structuredClone(read))).game_data;
		await db.closeGame(read, "b", "forfeit");
		const closed = fakeDynamo.peek("chess_db", "game1");

		assert.equal((await db.updateGame(moved, MATE_IN_ONE)).status, 500);
		assert.equal((await db.updateGame(moved)).status, 500); // NO BOARD PASSED
		assert.deepEqual(fakeDynamo.peek("chess_db", "game1"), closed);
		assert.equal(closed.expireAt, undefined);
	});

	test("a game from before state can still be moved on", async () => {
		const read = await mateFriendGame();
		const { DynamoDB } = require("@aws-sdk/client-dynamodb");
		await DynamoDB.prototype.updateItem({ TableName: "chess_db", Key: { game_id: { S: "game1" } }, UpdateExpression: "REMOVE #state", ExpressionAttributeNames: { "#state": "state" } });
		const moved = (await validateMove({ player_id: "alice", move: ["a1", "a2"] }, read)).game_data;

		assert.equal((await db.updateGame(moved, MATE_IN_ONE)).status, 200);
		assert.equal(fakeDynamo.peek("chess_db", "game1").state, undefined);
	});

	test("a closing move removes expireAt from a signed-in player's AI game", async () => {
		const created = await db.initalizeGame("game1", "alice", "CHESS_AI", 3, { start_params: { color: "w", fen: MATE_IN_ONE } });
		const moved = await playMate(created.game_data);
		assert.equal((await db.updateGame(moved, MATE_IN_ONE, gameResult(moved))).status, 200);
		const stored = fakeDynamo.peek("chess_db", "game1");
		assert.equal(stored.state.S, "CLOSED");
		assert.equal(stored.expireAt, undefined);
	});

	test("a closing move in a guest's game keeps expireAt", async () => {
		const created = await db.initalizeGame("game1", "game1", "CHESS_AI", 3, { start_params: { color: "w", fen: MATE_IN_ONE } });
		const moved = (await validateMove({ player_id: "game1", move: ["a1", "a8"] }, created.game_data)).game_data;
		assert.equal((await db.updateGame(moved, MATE_IN_ONE, gameResult(moved))).status, 200);
		const stored = fakeDynamo.peek("chess_db", "game1");
		assert.equal(stored.state.S, "CLOSED");
		assert.ok(stored.expireAt);
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

describe("initalizeGame", () => {
	test("saves when the game was made, a guest's reset sets it again", async () => {
		const saved = () => fakeDynamo.peek("chess_db", "guest1").created_at.S;
		await db.initalizeGame("guest1", "guest1", "CHESS_AI", 3, {});
		const first = saved();
		assert.equal(new Date(first).toISOString(), first);
		await new Promise((resolve) => setTimeout(resolve, 2));
		await db.initalizeGame("guest1", "guest1", "CHESS_AI", 3, { reset_player: "guest1" });
		assert.notEqual(saved(), first);
	});

	test("two creates of one id at once: one wins, the other is refused & the game isn't overwritten", async () => {
		const results = await Promise.all([
			db.initalizeGame("game1", "alice", "CHESS_AI", 3, { start_params: { color: "w" } }),
			db.initalizeGame("game1", "bob", "CHESS_AI", 5, { start_params: { color: "w" } }),
		]);
		assert.deepEqual(results.map((result) => result.status), [200, 409]);
		assert.equal(results[1].game_data, undefined);
		const stored = fakeDynamo.peek("chess_db", "game1");
		assert.equal(stored.white_player_id.S, "alice");
		assert.equal(stored.ai_level.N, "3");
		assert.deepEqual(list(fakeDynamo.peek("user_db", "alice"), "open_games"), ["game1"]);
		assert.equal(fakeDynamo.peek("user_db", "bob"), undefined); // THE LOSER'S LIST ISN'T TOUCHED
	});

	test("a reset only replaces the stored game while it's still the player's (or it expired)", async () => {
		await db.initalizeGame("guest1", "guest1", "CHESS_AI", 3, {});
		assert.equal((await db.initalizeGame("guest1", "guest1", "CHESS_AI", 6, { reset_player: "guest1" })).status, 200);
		assert.equal(fakeDynamo.peek("chess_db", "guest1").ai_level.N, "6");
		assert.equal((await db.initalizeGame("guest2", "guest2", "CHESS_AI", 3, { reset_player: "guest2" })).status, 200); // EXPIRED, MADE AGAIN

		await db.initalizeGame("game1", "alice", "CHESS_AI", 3, {});
		const before = fakeDynamo.peek("chess_db", "game1");
		assert.equal((await db.initalizeGame("game1", "game1", "CHESS_AI", 3, { reset_player: "game1" })).status, 409);
		assert.deepEqual(fakeDynamo.peek("chess_db", "game1"), before);
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

	test("a guest's game keeps its expiry, a signed-in player's AI or friend game loses it", async () => {
		const guestGame = (await db.initalizeGame("guest1", "guest1", "CHESS_AI", 3, {})).game_data;
		await db.closeGame(guestGame, "b", "forfeit");
		assert.ok(fakeDynamo.peek("chess_db", "guest1").expireAt);

		const aiGame = await newGame();
		await db.closeGame(aiGame, "b", "forfeit");
		assert.equal(fakeDynamo.peek("chess_db", "game1").expireAt, undefined);

		const friendGame = (await db.initalizeGame("game2", "alice", "bob", false, {})).game_data;
		await db.closeGame(friendGame, "w", "checkmate");
		assert.equal(fakeDynamo.peek("chess_db", "game2").expireAt, undefined);
	});
});

describe("draw offers", () => {
	const friendGame = async () => (await db.initalizeGame("game4", "alice", "bob", false, {})).game_data;

	test("one offer per player per move, and only one standing", async () => {
		const gameData = await friendGame();
		assert.equal(await db.offerDraw(gameData, "alice", "w"), true);
		assert.equal(await db.offerDraw(gameData, "bob", "b"), false); // ALICE'S STANDS
		assert.equal(await db.endDrawOffer("game4", "alice"), true);
		assert.equal(await db.endDrawOffer("game4", "alice"), false); // ALREADY ENDED
		assert.equal(await db.offerDraw(gameData, "alice", "w"), false); // USED THIS MOVE
		assert.equal(await db.offerDraw(gameData, "bob", "b"), true);
	});

	test("a move ends the offer & gives both players theirs back", async () => {
		const gameData = await friendGame();
		await db.offerDraw(gameData, "alice", "w");
		const moved = (await validateMove({ player_id: "alice", move: ["e2", "e4"] }, structuredClone(gameData))).game_data;
		assert.equal((await db.updateGame(moved, gameData.game_board.S)).status, 200);

		const stored = fakeDynamo.peek("chess_db", "game4");
		assert.equal(stored.draw_offer_player_id, undefined);
		assert.equal(stored.draw_offered_w, undefined);
		assert.equal(await db.offerDraw((await db.retrieveGame("game4", true)).game_data, "alice", "w"), true);
	});

	test("an offer read before a move isn't saved", async () => {
		const gameData = await friendGame();
		const moved = (await validateMove({ player_id: "alice", move: ["e2", "e4"] }, structuredClone(gameData))).game_data;
		await db.updateGame(moved, gameData.game_board.S);
		assert.equal(await db.offerDraw(gameData, "bob", "b"), false);
		assert.equal(fakeDynamo.peek("chess_db", "game4").draw_offer_player_id, undefined);
	});

	test("an accept loses to a move that ended the offer", async () => {
		const gameData = await friendGame();
		await db.offerDraw(gameData, "alice", "w");
		const read = (await db.retrieveGame("game4", true)).game_data;
		const moved = (await validateMove({ player_id: "alice", move: ["e2", "e4"] }, structuredClone(read))).game_data;
		await db.updateGame(moved, read.game_board.S);

		assert.equal((await db.closeGame(read, "draw", "agreement", "alice")).status, 500);
		assert.notEqual(fakeDynamo.peek("chess_db", "game4").state?.S, "CLOSED");
	});

	test("an accept closes the game & clears the offer", async () => {
		const gameData = await friendGame();
		await db.offerDraw(gameData, "alice", "w");
		const closed = await db.closeGame((await db.retrieveGame("game4", true)).game_data, "draw", "agreement", "alice");
		assert.equal(closed.status, 200);
		assert.equal(closed.game_data.draw_offer_player_id, undefined);

		const stored = fakeDynamo.peek("chess_db", "game4");
		assert.equal(stored.reason.S, "agreement");
		assert.equal(stored.winner.S, "draw");
		assert.equal(stored.draw_offer_player_id, undefined);
	});

	test("a closed game takes no offer", async () => {
		const gameData = await friendGame();
		await db.closeGame(structuredClone(gameData), "b", "forfeit");
		assert.equal(await db.offerDraw(gameData, "alice", "w"), false);
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

	test("only the player who asked can cancel, and only until the rematch is claimed", async () => {
		await db.initalizeGame("game6", "alice", "bob", false, {});
		await db.requestRematch("game6", "alice", Date.now() + 60000);
		assert.equal(await db.cancelRematch("game6", "bob"), false);
		assert.equal(await db.cancelRematch("game6", "alice"), true);
		assert.equal(await db.acceptRematch("game6", "bob", "new1"), false); // NOTHING LEFT TO ACCEPT
		assert.equal(await db.requestRematch("game6", "bob", Date.now() + 60000), true); // BOB CAN ASK NOW
		assert.equal(await db.acceptRematch("game6", "alice", "new1"), true);
		assert.equal(await db.cancelRematch("game6", "bob"), false); // TOO LATE
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

	const finishGames = async (count) => {
		for (let i = 1; i <= count; i++) {
			const game = (await db.initalizeGame(`game${i}`, "alice", "CHESS_AI", 3, {})).game_data;
			await db.closeGame(game, i % 2 ? "w" : "draw", i % 2 ? "checkmate" : "stalemate");
		}
	};
	const closedList = async () => (await db.pruneClosedGames((await db.retrieveUser("alice")).user_data)).closed_game_list;

	test("Finished games lists the newest 20, newest first, with their results", async () => {
		await finishGames(25);
		const games = await closedList();
		assert.deepEqual(games.map((game) => game.game_id.S), Array.from({ length: 20 }, (_, i) => `game${25 - i}`));
		assert.equal(games[0].winner.S, "w");
		assert.equal(games[0].reason.S, "checkmate");
		assert.equal(games[1].winner.S, "draw");
		assert.equal(lists("alice").closed_games.length, 25); // THE OLDER GAMES STAY ON THE LIST
	});

	test("Finished games drops games TTL deleted, and fills up from older ones", async () => {
		await finishGames(22);
		const user = (await db.retrieveUser("alice")).user_data;
		await db.updateUser(user, { requested_games: [], open_games: [], closed_games: ["gone", ...lists("alice").closed_games.slice(0, 21), "expired"] });

		const games = await closedList();
		assert.equal(games.length, 20);
		assert.equal(games[0].game_id.S, "game21");
		assert.equal(games[19].game_id.S, "game2");
		assert.ok(!lists("alice").closed_games.includes("expired"));
		assert.ok(!lists("alice").closed_games.includes("gone")); // THE SECOND PAGE READ IT TOO
	});

	test("Finished games doesn't read older games once it has 20", async () => {
		await finishGames(21);
		const user = (await db.retrieveUser("alice")).user_data;
		await db.updateUser(user, { requested_games: [], open_games: [], closed_games: ["gone", ...lists("alice").closed_games] });

		assert.equal((await closedList()).length, 20);
		assert.ok(lists("alice").closed_games.includes("gone")); // TOO OLD TO BE READ, IT STAYS UNTIL IT'S REACHED
	});

	test("a game in closed_games that isn't closed isn't listed", async () => {
		await newGame();
		const user = (await db.retrieveUser("alice")).user_data;
		await db.updateUser(user, { requested_games: [], open_games: ["game1"], closed_games: ["game1"] });
		assert.deepEqual(await closedList(), []);
	});

	test("Delete my data puts the expiry back on finished AI games only", async () => {
		await finishGames(2);
		const friendGame = (await db.initalizeGame("friend1", "alice", "bob", false, {})).game_data;
		await db.closeGame(friendGame, "w", "checkmate");
		await db.initalizeGame("open1", "alice", "CHESS_AI", 3, {});
		const openExpiry = fakeDynamo.peek("chess_db", "open1").expireAt.N;

		await db.expireFinishedAiGames((await db.retrieveUser("alice")).user_data);
		assert.ok(fakeDynamo.peek("chess_db", "game1").expireAt);
		assert.ok(fakeDynamo.peek("chess_db", "game2").expireAt);
		assert.equal(fakeDynamo.peek("chess_db", "friend1").expireAt, undefined);
		assert.equal(fakeDynamo.peek("chess_db", "open1").expireAt.N, openExpiry);
	});

	test("Delete my account replaces only the player's own name, in finished friend games", async () => {
		const asWhite = (await db.initalizeGame("friend1", "alice", "bob", false, { names: { w: "Alice", b: "Bob" } })).game_data;
		await db.closeGame(asWhite, "w", "checkmate");
		const asBlack = (await db.initalizeGame("friend2", "bob", "alice", false, { names: { w: "Bob", b: "Alice" } })).game_data;
		await db.closeGame(asBlack, "w", "checkmate");
		await db.initalizeGame("ai1", "alice", "CHESS_AI", 3, {});

		await db.anonymizeFriendGames((await db.retrieveUser("alice")).user_data);
		assert.equal(fakeDynamo.peek("chess_db", "friend1").white_name.S, "Deleted player");
		assert.equal(fakeDynamo.peek("chess_db", "friend1").black_name.S, "Bob");
		assert.equal(fakeDynamo.peek("chess_db", "friend2").white_name.S, "Bob");
		assert.equal(fakeDynamo.peek("chess_db", "friend2").black_name.S, "Deleted player");
		assert.equal(fakeDynamo.peek("chess_db", "ai1").white_name, undefined);
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

	test("a throttled batch read still returns every open game", async () => {
		await newGame();
		await db.initalizeGame("game2", "alice", "bob", false, {});
		fakeDynamo.throttleBatchReads(1); // THE FIRST READ MISSES game2, IT COMES BACK UNPROCESSED

		const userData = await db.pruneOpenGames((await db.retrieveUser("alice")).user_data);
		assert.deepEqual(userData.open_game_list.map((game) => game.game_id.S), ["game1", "game2"]);
		assert.equal(userData.ai_game_id, "game1");
		assert.equal(userData.friend_game_id, "game2");
		assert.deepEqual(list(fakeDynamo.peek("user_db", "alice"), "open_games"), ["game1", "game2"]); // NOT PRUNED
	});

	test("a batch read still throttled after every try, or one that fails, throws instead of missing a game", async () => {
		await newGame();
		await db.initalizeGame("game2", "alice", "bob", false, {});
		fakeDynamo.throttleBatchReads(Infinity);
		await assert.rejects(db.pruneOpenGames((await db.retrieveUser("alice")).user_data), /throttled/);

		fakeDynamo.reset();
		await newGame();
		fakeDynamo.failBatchReads(true);
		await assert.rejects(db.pruneOpenGames((await db.retrieveUser("alice")).user_data), /capacity/);
		assert.deepEqual(list(fakeDynamo.peek("user_db", "alice"), "open_games"), ["game1"]);
	});

	test("a game list save that fails every try throws, after the game is closed", async () => {
		const gameData = await newGame();
		const { DynamoDB } = require("@aws-sdk/client-dynamodb");
		const updateItem = DynamoDB.prototype.updateItem;
		DynamoDB.prototype.updateItem = async (params) => {
			if (params.TableName == "user_db") { throw Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" }); }
			return updateItem(params);
		};
		try {
			await assert.rejects(db.closeGame(gameData, "b", "forfeit"), /failed to update/);
		} finally {
			DynamoDB.prototype.updateItem = updateItem;
		}
		assert.equal(fakeDynamo.peek("chess_db", "game1").state.S, "CLOSED");
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
