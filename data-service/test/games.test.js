/*
 *  games.test.js  --  data service tests
 *	Game Routes (controllers/gameController.js)
 *  Each route only acts for the player in the request, only on a game they're in, and only saves what the action allows.
 *  Every refused request leaves the stored game exactly as it was
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const service = require("./helpers/service.js");
const { call, player, sessionToken, guestCookie, peek } = service;
const db = require("../dynamoDB.js");
const { tamper } = require("./helpers/keys.js");

let server;
before(async () => { server = await service.start(); });
after(() => server.close());
beforeEach(() => service.reset());

const alice = player("alice");
const bob = player("bob");
const mallory = player("mallory");

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

const aiGame = (gameId, playerId, color) => db.initalizeGame(gameId, color == "b" ? "CHESS_AI" : playerId, color == "b" ? playerId : "CHESS_AI", 3, { start_params: { color: color || "w" } });
const friendGame = (gameId, white, black, pending) => db.initalizeGame(gameId, white, black, false, { names: { w: white, b: black }, pending, start_params: { color: "w" }, inviter_id: white });
const board = (gameId) => peek("chess_db", gameId).game_board.S;

/**
 * @description Makes a request that must be refused & checks the stored game didn't change
 * @return {[object]} response
 */
async function refused(gameId, method, path, options, http) {
	const before = peek("chess_db", gameId);
	const response = await call(method, path, options);
	assert.equal(response.http, http, response.message);
	assert.deepEqual(peek("chess_db", gameId), before, "the stored game changed");
	return response;
}

/* ---------------------------------------------------------------- */
// Health & Bodies
/* ---------------------------------------------------------------- */

describe("health and bodies", () => {
	test("/health answers without a player or the tables", async () => {
		const response = await call("GET", "/health");
		assert.equal(response.http, 200);
		assert.equal(response.message, "OK");
	});

	test("an action that doesn't exist is refused", async () => {
		assert.equal((await call("POST", "/games/game1/delete", { as: alice })).http, 404);
		assert.equal((await call("POST", "/put-item", { as: alice, body: { TableName: "chess_db" } })).http, 404);
	});

	test("only JSON bodies, at most 16kb", async () => {
		await aiGame("game1", "alice");
		await refused("game1", "POST", "/games/game1/move", { as: alice, raw: "from=e2&to=e4", type: "application/x-www-form-urlencoded" }, 415);
		await refused("game1", "POST", "/games/game1/move", { as: alice, raw: "{ from: e2" }, 400);
		await refused("game1", "POST", "/games/game1/move", { as: alice, raw: JSON.stringify({ from: "e2", to: "e4", pad: "x".repeat(17 * 1024) }) }, 413);
		await refused("game1", "POST", "/games/game1/move", { as: alice, body: ["e2", "e4"] }, 400);
	});

	test("a refusal is logged with the route and why, never the body or the token", async () => {
		await aiGame("game1", "alice");
		service.signIn("alice");
		const token = sessionToken(alice.user);
		const lines = [];
		const log = console.log;
		console.log = (line) => lines.push(`${line}`);
		try {
			await call("POST", "/games/game1/move", { token, body: { from: "e2", to: "e4", game_board: "SECRET-BOARD" } });
		} finally {
			console.log = log;
		}
		assert.deepEqual(lines, ["REFUSED POST /games/game1/move 400 Not allowed: game_board"]);
		assert.ok(!lines.join().includes(token) && !lines.join().includes("SECRET-BOARD"));
	});
});

/* ---------------------------------------------------------------- */
// Players
/* ---------------------------------------------------------------- */

describe("who's asking", () => {
	test("nobody, a changed or expired token, a refresh token or a changed guest cookie is refused", async () => {
		await aiGame("game1", "alice");
		await refused("game1", "GET", "/games/game1", {}, 401);
		await refused("game1", "GET", "/games/game1", { token: tamper(sessionToken(bob.user), { user: alice.user }) }, 401);
		await refused("game1", "GET", "/games/game1", { token: sessionToken(alice.user, { expired: true }) }, 401);
		await refused("game1", "GET", "/games/game1", { token: sessionToken(alice.user, { type: "refresh" }) }, 401);
		await refused("game1", "GET", "/games/game1", { cookie: tamper(guestCookie("game2"), { game_id: "game1" }) }, 401);
	});

	test("only a token this service signed: another key's, an HS256 or a none token is refused (#252)", async () => {
		await aiGame("game1", "alice");
		await refused("game1", "GET", "/games/game1", { token: sessionToken(alice.user, { key: "stranger" }) }, 401);
		await refused("game1", "GET", "/games/game1", { token: sessionToken(alice.user, { key: "next" }) }, 401); // ONLY THE CHESS SERVER HAS THE NEXT KEY, THIS SERVICE SIGNS WITH IT ONCE IT'S CHANGED
		await refused("game1", "GET", "/games/game1", { token: sessionToken(alice.user, { algorithm: "HS256" }) }, 401); // THE PUBLIC KEY AS AN HMAC SECRET, WITH THE REAL kid
		await refused("game1", "GET", "/games/game1", { token: sessionToken(alice.user, { algorithm: "HS256", secret: "test-jwt-secret" }) }, 401); // LIKE A TOKEN FROM BEFORE #252
		await refused("game1", "GET", "/games/game1", { token: sessionToken(alice.user, { algorithm: "none" }) }, 401);
		await refused("game1", "GET", "/games/game1", { cookie: guestCookie("game1", { algorithm: "none" }) }, 401);
		await refused("game1", "GET", "/games/game1", { token: guestCookie("game1") }, 401); // A GUEST'S TOKEN CAN'T ACT FOR A PLAYER
		await refused("game1", "GET", "/games/game1", { cookie: sessionToken(alice.user) }, 401); // NOR A PLAYER'S AS A GUEST'S
	});

	test("while the key is being changed, a token signed with the old key still works", async () => {
		await aiGame("game1", "alice");
		service.signIn("alice");
		assert.equal((await call("GET", "/games/game1", { token: sessionToken(alice.user, { key: "old" }) })).status, 200); // SESSION_PUBLIC_KEY_OLD
	});

	test("a player only sees their own games", async () => {
		await friendGame("game1", "alice", "bob");
		assert.equal((await call("GET", "/games/game1", { as: alice })).game_data.game_id.S, "game1");
		assert.equal((await call("GET", "/games/game1", { as: bob })).status, 200);
		await refused("game1", "GET", "/games/game1", { as: mallory }, 403);
		assert.equal((await call("GET", "/games/missing", { as: alice })).message, "Game data not found");
		assert.equal((await call("GET", "/games/missing")).message, "Game data not found"); // EVEN WITH NO PLAYER (A NEW GUEST'S FIRST GAME), AN EXISTING GAME STILL NEEDS ONE
	});

	test("a guest is only in their own game, even when their game id is another player's id or CHESS_AI", async () => {
		await aiGame("guest1", "guest1");
		await aiGame("game1", "alice");
		await friendGame("game2", "alice", "bob");
		assert.equal((await call("GET", "/games/guest1", { guest: "guest1" })).status, 200);
		await refused("game1", "GET", "/games/game1", { guest: "CHESS_AI" }, 403);
		await refused("game1", "POST", "/games/game1/ai-move", { guest: "CHESS_AI", body: { from: "e7", to: "e5" } }, 403);
		await refused("game1", "POST", "/games/game1/forfeit", { guest: "alice" }, 403);
		await refused("game2", "GET", "/games/game2", { guest: "alice" }, 403);
	});
});

/* ---------------------------------------------------------------- */
// Moves
/* ---------------------------------------------------------------- */

describe("move", () => {
	test("a legal move on the player's turn is played on the stored board and saved", async () => {
		await friendGame("game1", "alice", "bob");
		const moved = await call("POST", "/games/game1/move", { as: alice, body: { from: "e2", to: "e4" } });
		assert.equal(moved.http, 200);
		assert.deepEqual(moved.game_data.moves.S, ["e4"]);
		assert.equal(board("game1"), "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
		assert.equal((await call("POST", "/games/game1/move", { as: bob, body: { from: "e7", to: "e5" } })).status, 200);
	});

	test("an illegal move, a move out of turn, or a move in someone else's game changes nothing", async () => {
		await friendGame("game1", "alice", "bob");
		await refused("game1", "POST", "/games/game1/move", { as: alice, body: { from: "e2", to: "e5" } }, 400);
		await refused("game1", "POST", "/games/game1/move", { as: alice, body: { from: "e7", to: "e5" } }, 400); // BLACK'S PIECE
		await refused("game1", "POST", "/games/game1/move", { as: bob, body: { from: "e7", to: "e5" } }, 409); // WHITE TO MOVE
		await refused("game1", "POST", "/games/game1/move", { as: mallory, body: { from: "e2", to: "e4" } }, 403);
	});

	test("a board, a FEN or extra fields sent with or instead of a move are refused", async () => {
		await friendGame("game1", "alice", "bob");
		const fen = "rnbqkbnr/pppppppp/8/8/8/8/8/4K3 w kq - 0 1";
		await refused("game1", "POST", "/games/game1/move", { as: alice, body: { game_board: fen } }, 400);
		await refused("game1", "POST", "/games/game1/move", { as: alice, body: { from: "e2", to: "e4", game_board: fen } }, 400);
		await refused("game1", "POST", "/games/game1/move", { as: alice, body: { from: "e2", to: "e4", player_id: "bob" } }, 400);
		await refused("game1", "POST", "/games/game1/move", { as: alice, body: { move: ["e2", "e4"] } }, 400);
		await refused("game1", "POST", "/games/game1/move", { as: alice, body: { from: ["e2"], to: "e4" } }, 400);
		await refused("game1", "POST", "/games/game1/move", { as: alice, body: { from: "e2", to: "e4", promotion: "k" } }, 400);
	});

	test("an invite that wasn't accepted, or a game that's over, takes no moves", async () => {
		await friendGame("game1", "alice", "bob", true);
		await refused("game1", "POST", "/games/game1/move", { as: alice, body: { from: "e2", to: "e4" } }, 409);
		await friendGame("game2", "alice", "bob");
		await call("POST", "/games/game2/forfeit", { as: bob });
		await refused("game2", "POST", "/games/game2/move", { as: alice, body: { from: "e2", to: "e4" } }, 409);
	});

	test("checkmate closes the game and rates it", async () => {
		await friendGame("game1", "alice", "bob");
		const moves = [[alice, "f2", "f3"], [bob, "e7", "e5"], [alice, "g2", "g4"], [bob, "d8", "h4"]]; // FOOL'S MATE
		let last;
		for (const [who, from, to] of moves) { last = await call("POST", "/games/game1/move", { as: who, body: { from, to } }); }
		assert.equal(last.game_data.state.S, "CLOSED");
		assert.equal(last.game_data.winner.S, "b");
		assert.equal(last.game_data.reason.S, "checkmate");
		assert.equal(peek("chess_db", "game1").state.S, "CLOSED");
		assert.equal(Number(peek("user_db", "bob").rating.N), 1520);
		assert.equal(Number(peek("user_db", "alice").rating.N), 1480);
	});

	test("a promotion is saved as the piece picked", async () => {
		await db.initalizeGame("game1", "alice", "bob", false, { start_params: { color: "w", fen: "8/4P3/8/8/8/k7/8/4K3 w - - 0 1" }, inviter_id: "alice" });
		const moved = await call("POST", "/games/game1/move", { as: alice, body: { from: "e7", to: "e8", promotion: "n" } });
		assert.equal(moved.http, 200);
		assert.deepEqual(moved.game_data.moves.S, ["e8=N"]);
	});
});

/* ---------------------------------------------------------------- */
// AI Moves
/* ---------------------------------------------------------------- */

describe("ai-move", () => {
	test("the AI's move is saved on its turn, asked for by the player in the game", async () => {
		await aiGame("game1", "alice");
		await call("POST", "/games/game1/move", { as: alice, body: { from: "e2", to: "e4" } });
		const moved = await call("POST", "/games/game1/ai-move", { as: alice, body: { from: "e7", to: "e5" } });
		assert.equal(moved.http, 200);
		assert.deepEqual(moved.game_data.moves.S, ["e4", "e5"]);
	});

	test("not on the player's turn, not in a friend game, not illegal, not by someone else", async () => {
		await aiGame("game1", "alice");
		await refused("game1", "POST", "/games/game1/ai-move", { as: alice, body: { from: "e2", to: "e4" } }, 409); // ALICE TO MOVE
		assert.equal((await call("POST", "/games/game1/move", { as: alice, body: { from: "e2", to: "e4" } })).status, 200);
		await refused("game1", "POST", "/games/game1/move", { as: alice, body: { from: "d2", to: "d4" } }, 409); // NOW IT'S THE AI'S TURN
		await refused("game1", "POST", "/games/game1/ai-move", { as: alice, body: { from: "e7", to: "e4" } }, 400);
		await refused("game1", "POST", "/games/game1/ai-move", { as: mallory, body: { from: "e7", to: "e5" } }, 403);
		await friendGame("game2", "alice", "bob");
		await refused("game2", "POST", "/games/game2/ai-move", { as: alice, body: { from: "e2", to: "e4" } }, 409);
	});

	test("a guest plays their own AI game", async () => {
		await aiGame("guest1", "guest1", "b"); // THE AI PLAYS WHITE
		assert.equal((await call("POST", "/games/guest1/ai-move", { guest: "guest1", body: { from: "d2", to: "d4" } })).status, 200);
		assert.equal((await call("POST", "/games/guest1/move", { guest: "guest1", body: { from: "d7", to: "d5" } })).status, 200);
	});
});

/* ---------------------------------------------------------------- */
// Forfeit
/* ---------------------------------------------------------------- */

describe("forfeit", () => {
	test("the other side wins and the game is closed once", async () => {
		await friendGame("game1", "alice", "bob");
		const closed = await call("POST", "/games/game1/forfeit", { as: alice });
		assert.equal(closed.game_data.winner.S, "b");
		assert.equal(peek("chess_db", "game1").reason.S, "forfeit");
		await refused("game1", "POST", "/games/game1/forfeit", { as: bob }, 409);
	});

	test("an AI game can be forfeited, an invite can't, and nobody else can", async () => {
		await aiGame("game1", "alice");
		await refused("game1", "POST", "/games/game1/forfeit", { as: mallory }, 403);
		await refused("game1", "POST", "/games/game1/forfeit", { as: alice, body: { winner: "w" } }, 400);
		assert.equal((await call("POST", "/games/game1/forfeit", { as: alice })).game_data.winner.S, "b"); // THE AI PLAYS BLACK
		await friendGame("game2", "alice", "bob", true);
		await refused("game2", "POST", "/games/game2/forfeit", { as: bob }, 409);
	});
});

/* ---------------------------------------------------------------- */
// Ratings
/* ---------------------------------------------------------------- */

describe("ratings", () => {
	test("both players' ratings, only for a player in the game", async () => {
		await friendGame("game1", "alice", "bob");
		const response = await call("GET", "/games/game1/ratings", { as: alice });
		assert.deepEqual(response.ratings, { alice: { rating: 1500, rated_games: 0 }, bob: { rating: 1500, rated_games: 0 } }); // readRating, THE CHESS SERVER ADDS provisional (ratingSummary)
		await refused("game1", "GET", "/games/game1/ratings", { as: mallory }, 403);
	});
});
