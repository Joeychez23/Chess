/*
 *  rating.test.js  --  data service tests
 *	Elo Ratings (utils/rating.js, rateGame in dynamoDB.js)
 *  The rating math, which games count, and two games ending at once. The ratings Home & the game menu show are in the server's rating.test.js
 *
 */

require("./helpers/env.js");
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fakeDynamo = require("./helpers/fakeDynamo.js");
fakeDynamo.install();
const db = require("../dynamoDB.js");
const { expectedScore, newRating, isRated, PROVISIONAL_GAMES } = require("../utils/rating.js");

beforeEach(() => fakeDynamo.reset());

const rating = (userId) => { const item = fakeDynamo.peek("user_db", userId); return item?.rating ? { rating: Number(item.rating.N), rated_games: Number(item.rated_games.N) } : null; };
const friendGame = (moves, startParams) => ({
	white_player_id: { S: "alice" },
	black_player_id: { S: "bob" },
	moves: { S: moves },
	start_params: { S: JSON.stringify(startParams || { color: "w" }) },
});

/* ---------------------------------------------------------------- */
// Elo
/* ---------------------------------------------------------------- */

describe("Elo", () => {
	const newPlayer = { rating: 1500, rated_games: 0 };
	const settled = { rating: 1500, rated_games: PROVISIONAL_GAMES };

	test("between equal ratings a win or loss moves half of K, a draw nothing", () => {
		assert.equal(newRating(newPlayer, { rating: 1500 }, 1), 1520);
		assert.equal(newRating(newPlayer, { rating: 1500 }, 0), 1480);
		assert.equal(newRating(newPlayer, { rating: 1500 }, 0.5), 1500);
		assert.equal(newRating(settled, { rating: 1500 }, 1), 1510);
	});

	test("K is 40 for the first 10 rated games, then 20", () => {
		assert.equal(newRating({ rating: 1500, rated_games: PROVISIONAL_GAMES - 1 }, { rating: 1500 }, 1), 1520);
		assert.equal(newRating({ rating: 1500, rated_games: PROVISIONAL_GAMES }, { rating: 1500 }, 1), 1510);
	});

	test("beating a stronger player is worth more than beating a weaker one", () => {
		assert.ok(Math.abs(expectedScore(1700, 1500) - 0.76) < 0.01);
		assert.equal(expectedScore(1500, 1700) + expectedScore(1700, 1500), 1);
		assert.equal(newRating(newPlayer, { rating: 1700 }, 1), 1530); // 1500 + 40 x (1 - 0.24)
		assert.equal(newRating({ rating: 1700, rated_games: 0 }, { rating: 1500 }, 1), 1710); // 1700 + 40 x (1 - 0.76)
	});

	test("a rating never goes below 100", () => {
		assert.equal(newRating({ rating: 100, rated_games: 50 }, { rating: 100 }, 0), 100);
	});
});

describe("which games are rated", () => {
	test("friend games from the standard position, once both sides moved", () => {
		assert.equal(isRated(friendGame(["e4", "e5"])), true);
		assert.equal(isRated(friendGame(["e4"])), false); // BLACK NEVER MOVED
		assert.equal(isRated(friendGame([])), false);
		assert.equal(isRated(friendGame(["Ra2", "Kd8"], { color: "w", fen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1" })), false); // A SET POSITION
		assert.equal(isRated({ ...friendGame(["e4", "e5"]), black_player_id: { S: "CHESS_AI" } }), false);
		const old = friendGame(["e4", "e5"]);
		delete old.start_params; // GAMES FROM BEFORE start_params STARTED FROM THE STANDARD POSITION
		assert.equal(isRated(old), true);
	});
});

/* ---------------------------------------------------------------- */
// rateGame
/* ---------------------------------------------------------------- */

describe("rateGame", () => {
	async function closedFriendGame(gameId, white, black) {
		const created = (await db.initalizeGame(gameId, white, black, false, { start_params: { color: "w" } })).game_data;
		created.moves.S = ["e4", "e5"];
		return created;
	}

	test("two of a player's games ending at once both count", async () => {
		const withBob = await closedFriendGame("game1", "alice", "bob");
		const withCarol = await closedFriendGame("game2", "alice", "carol");
		await Promise.all([db.rateGame(withBob, "w"), db.rateGame(withCarol, "w")]);
		assert.deepEqual(rating("alice"), { rating: 1539, rated_games: 2 }); // 1500 -> 1520 (vs 1500), then -> 1539 (vs 1500)
		assert.deepEqual(rating("bob"), { rating: 1480, rated_games: 1 });
		assert.deepEqual(rating("carol"), { rating: 1480, rated_games: 1 });
	});

	test("a draw between equals changes nothing but counts the game", async () => {
		await db.closeGame(await closedFriendGame("game1", "alice", "bob"), "draw", "stalemate");
		assert.deepEqual(rating("alice"), { rating: 1500, rated_games: 1 });
		assert.deepEqual(rating("bob"), { rating: 1500, rated_games: 1 });
	});

	test("a player whose row is gone (deleted their data as the game ended) is left out, the other is still rated", async () => {
		const game = await closedFriendGame("game1", "alice", "bob");
		await db.deleteUser("bob");
		const ratings = await db.rateGame(game, "b");
		assert.equal(fakeDynamo.peek("user_db", "bob"), undefined); // NOT MADE AGAIN WITHOUT ITS GAME LISTS
		assert.deepEqual(rating("alice"), { rating: 1480, rated_games: 1 });
		assert.equal(ratings.b, null);
		assert.deepEqual(JSON.parse(fakeDynamo.peek("chess_db", "game1").ratings.S).w, { before: 1500, after: 1480 });
	});
});
