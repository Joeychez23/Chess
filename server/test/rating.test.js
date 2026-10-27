/*
 *  rating.test.js  --  chess server tests
 *	Elo Ratings (server/utils/rating.js, through the data service)
 *  The rating math, which games count, and the ratings Home & the game menu get. rateGame itself (two games ending at once) is tested in data-service/test/rating.test.js
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const { call, player, engineWillPlay, peek } = testServer;
const { expectedScore, newRating, isRated, PROVISIONAL_GAMES } = require("../utils/rating.js");

let server;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => testServer.reset());

const rating = (userId) => { const item = peek("user_db", userId); return item?.rating ? { rating: Number(item.rating.N), rated_games: Number(item.rated_games.N) } : null; };
const friendGame = (moves, startParams) => ({
	white_player_id: { S: "alice" },
	black_player_id: { S: "bob" },
	moves: { S: moves },
	start_params: { S: JSON.stringify(startParams || { color: "w" }) },
});

/**
 * @description Alice invites Bob (Alice plays white), Bob accepts, they play the moves, then Bob forfeits
 * @return {[string]} gameId
 */
async function friendGameBobForfeits(moves, startFen) {
	const alice = player("alice");
	const bob = player("bob");
	const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email, start_color: "w", start_fen: startFen } });
	await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: {} });
	for (let i = 0; i < moves.length; i++) {
		const moved = await call("PUT", `/api/chess/game/${invite.game_id}`, { as: i % 2 == 0 ? alice : bob, body: { move: moves[i] } });
		assert.equal(moved.status, 200);
	}
	assert.equal((await call("POST", `/api/chess/game/${invite.game_id}/forfeit`, { as: bob })).state, "CLOSED");
	return { gameId: invite.game_id, alice, bob };
}

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
// Rated Friend Games
/* ---------------------------------------------------------------- */

describe("a rated friend game", () => {
	test("the winner goes up, the loser goes down, and Home shows the new numbers", async () => {
		const { gameId, alice, bob } = await friendGameBobForfeits([["e2", "e4"], ["e7", "e5"]]);
		assert.deepEqual(rating("alice"), { rating: 1520, rated_games: 1 });
		assert.deepEqual(rating("bob"), { rating: 1480, rated_games: 1 });

		assert.deepEqual((await call("GET", "/api/chess/user/alice", { as: alice })).rating, { rating: 1520, provisional: true, rated_games: 1 });
		assert.deepEqual((await call("GET", "/api/chess/user/bob", { as: bob })).rating, { rating: 1480, provisional: true, rated_games: 1 });

		const saved = JSON.parse(peek("chess_db", gameId).ratings.S); // KEPT ON THE GAME, THE PLAYER'S RATING HISTORY
		assert.deepEqual({ w: saved.w, b: saved.b }, { w: { before: 1500, after: 1520 }, b: { before: 1500, after: 1480 } });
		assert.ok(saved.at > 0);
	});

	test("the game menu gets both players' ratings and the change", async () => {
		const { gameId, alice, bob } = await friendGameBobForfeits([["e2", "e4"], ["e7", "e5"]]);
		const forAlice = await call("GET", `/api/chess/game/${gameId}/ratings`, { as: alice });
		assert.equal(forAlice.rated, true);
		assert.deepEqual(forAlice.player_rating, { rating: 1520, provisional: true, rated_games: 1 });
		assert.deepEqual(forAlice.opponent_rating, { rating: 1480, provisional: true, rated_games: 1 });
		assert.equal(forAlice.opponent_name, "Bob");
		assert.deepEqual(forAlice.rating_change, { before: 1500, after: 1520 });
		assert.deepEqual((await call("GET", `/api/chess/game/${gameId}/ratings`, { as: bob })).rating_change, { before: 1500, after: 1480 });

		const carol = player("carol");
		assert.equal((await call("GET", `/api/chess/game/${gameId}/ratings`, { as: carol })).http, 403);
	});

	test("a game still going shows the ratings so far, with no change yet", async () => {
		const alice = player("alice");
		const bob = player("bob");
		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email, start_color: "w" } });
		await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: {} });
		const ratings = await call("GET", `/api/chess/game/${invite.game_id}/ratings`, { as: bob });
		assert.deepEqual([ratings.player_rating.rating, ratings.opponent_rating.rating, ratings.rating_change], [1500, 1500, null]);
	});
});

describe("games that aren't rated", () => {
	test("a friend game forfeited before both sides moved", async () => {
		const { gameId } = await friendGameBobForfeits([["e2", "e4"]]);
		assert.equal(rating("alice"), null);
		assert.equal(rating("bob"), null);
		assert.equal(peek("chess_db", gameId).ratings, undefined);
	});

	test("a friend game from a set position", async () => {
		const { gameId } = await friendGameBobForfeits([["a1", "a2"], ["e8", "d8"]], "4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
		assert.equal(rating("alice"), null);
		assert.equal(peek("chess_db", gameId).ratings, undefined);
	});

	test("AI games, and the game menu says so", async () => {
		const alice = player("alice");
		const game = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
		await call("PUT", `/api/chess/game/${game.game_id}`, { as: alice, body: { move: ["e2", "e4"] } });
		engineWillPlay("e7", "e5");
		await call("POST", `/api/chess/game/${game.game_id}/ai-move`, { as: alice });
		await call("POST", `/api/chess/game/${game.game_id}/restart`, { as: alice }); // FORFEITS IT
		assert.equal(peek("chess_db", game.game_id).state.S, "CLOSED");
		assert.equal(rating("alice"), null);

		const menu = await call("GET", `/api/chess/game/${game.game_id}/ratings`, { as: alice });
		assert.deepEqual([menu.rated, menu.player_rating, menu.opponent_rating], [false, null, null]);
	});

	test("a guest's game, and Home before a player's first game shows the starting rating", async () => {
		await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w" } });
		await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } });
		assert.equal(peek("user_db", "guest1"), undefined);

		const newbie = player("newbie");
		assert.deepEqual((await call("GET", "/api/chess/user/newbie", { as: newbie })).rating, { rating: 1500, provisional: true, rated_games: 0 });
	});
});
