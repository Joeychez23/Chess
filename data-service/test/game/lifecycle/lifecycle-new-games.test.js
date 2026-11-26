/*
 *  lifecycle-new-games.test.js  --  data service tests
 *	Starting Games (controllers/game/)
 *  New AI games, game ids, guest games and a guest's side: each only for the player in the request, only on
 *  games they can act on, with only the fields the route names. A refused request makes or changes nothing
 *
 */

require("../../helpers/env.js");
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { call, peek } = require("../../helpers/service.js");
const db = require("../../../db/index.js");
const { alice, bob, carol, list, refused } = require("../../helpers/lifecycle.js");

const SET_POSITION = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";

/* ---------------------------------------------------------------- */
// New AI Games
/* ---------------------------------------------------------------- */

describe("new AI game", () => {
	test("the requester plays the AI at their level, color and set position", async () => {
		const made = await call("POST", "/games/ai", { as: alice, body: { color: "b", level: 5, start_fen: SET_POSITION } });
		assert.equal(made.http, 200);
		const gameId = made.game_data.game_id.S;
		const item = peek("chess_db", gameId);
		assert.equal(item.white_player_id.S, "CHESS_AI");
		assert.equal(item.black_player_id.S, "alice");
		assert.equal(item.ai_level.N, "5");
		assert.equal(item.game_board.S, SET_POSITION);
		assert.deepEqual(JSON.parse(item.start_params.S), { color: "b", fen: SET_POSITION });
		assert.deepEqual(list("alice", "open_games"), [gameId]);
	});

	test("random draws a side here, the level defaults to 1300", async () => {
		const made = (await call("POST", "/games/ai", { as: alice, body: { color: "random" } })).game_data;
		assert.deepEqual([made.white_player_id.S, made.black_player_id.S].sort(), ["CHESS_AI", "alice"]);
		assert.equal(made.ai_level.N, "1300");
	});

	test("takes every level from 600 to 3200 in steps of 100, and the 8 levels from before", async () => {
		for (const level of [600, 1300, 2400, 3200, 1, 8]) {
			const made = await call("POST", "/games/guest", { body: { game_id: `guest${level}`, color: "w", level } });
			assert.equal(made.game_data.ai_level.N, `${level}`);
		}
		for (const level of [0, 9, 500, 650, 3300]) {
			assert.equal((await call("POST", "/games/guest", { body: { game_id: "guestbad", color: "w", level } })).http, 400);
		}
	});

	test("only for a signed in player, with a real level and a playable position", async () => {
		await db.initializeGame("game1", "bob", "CHESS_AI", 3, { start_params: { color: "w" } });
		const made = [["user_db", "alice"]];
		await refused(made, "POST", "/games/ai", { body: {} }, 401);
		await refused(made, "POST", "/games/ai", { guest: "game2", body: {} }, 403);
		await refused(made, "POST", "/games/ai", { as: alice, body: { level: 9 } }, 400);
		await refused(made, "POST", "/games/ai", { as: alice, body: { level: "3" } }, 400);
		await refused(made, "POST", "/games/ai", { as: alice, body: { start_fen: "P3k3/8/8/8/8/8/8/4K3 w - - 0 1" } }, 400);
		await refused(made, "POST", "/games/ai", { as: alice, body: { start_fen: 7 } }, 400);
		await refused(made, "POST", "/games/ai", { as: alice, body: { white_player_id: "bob" } }, 400);
	});
});

describe("game ids are made here", () => {
	const ID = /^[A-Za-z0-9_-]{22}$/; // 16 RANDOM BYTES, BASE64URL

	test("a body can't name the id of a new AI game or invite", async () => {
		await db.initializeGame("game1", "bob", "CHESS_AI", 3, { start_params: { color: "w" } });
		await refused([["chess_db", "game1"], ["chess_db", "game2"], ["user_db", "alice"]], "POST", "/games/ai", { as: alice, body: { game_id: "game2" } }, 400);
		await refused([["chess_db", "game1"], ["user_db", "alice"]], "POST", "/games/ai", { as: alice, body: { game_id: "game1" } }, 400); // BOB'S GAME ISN'T RESET
		await refused([["chess_db", "game2"], ["user_db", "bob"]], "POST", "/games/invite", { as: alice, body: { opponent_id: "bob", game_id: "game2" } }, 400);
	});

	test("each new AI game & invite gets its own random id, in the response", async () => {
		const games = await Promise.all([
			call("POST", "/games/ai", { as: alice, body: { color: "w" } }),
			call("POST", "/games/ai", { as: bob, body: { color: "w" } }),
			call("POST", "/games/invite", { as: carol, body: { opponent_id: "bob", color: "w" } }),
		]);
		const ids = games.map((made) => made.game_data.game_id.S);
		for (const id of ids) { assert.match(id, ID); assert.ok(peek("chess_db", id)); }
		assert.equal(new Set(ids).size, ids.length);
		assert.deepEqual(list("bob", "requested_games"), [ids[2]]);
	});

	test("two new guests with one id at once each get a game, neither is overwritten", async () => {
		const results = await Promise.all([
			call("POST", "/games/guest", { body: { game_id: "guest1", color: "w", level: 2 } }),
			call("POST", "/games/guest", { body: { game_id: "guest1", color: "w", level: 7 } }),
		]);
		const ids = results.map((result) => result.game_data.game_id.S);
		assert.notEqual(ids[0], ids[1]);
		for (const result of results) {
			const stored = peek("chess_db", result.game_data.game_id.S);
			assert.equal(stored.ai_level.N, result.game_data.ai_level.N);
			assert.equal(stored.white_player_id.S, result.game_data.game_id.S);
		}
	});
});

/* ---------------------------------------------------------------- */
// Guest Games
/* ---------------------------------------------------------------- */

describe("guest game", () => {
	test("a new guest's game is theirs vs the AI, at level 1300 unless they pick one", async () => {
		const made = (await call("POST", "/games/guest", { body: { game_id: "guest1", color: "w" } })).game_data;
		assert.equal(made.game_id.S, "guest1");
		assert.equal(made.white_player_id.S, "guest1"); // A GUEST'S PLAYER ID IS THEIR GAME ID
		assert.equal(made.black_player_id.S, "CHESS_AI");
		assert.equal(made.ai_level.N, "1300");
		assert.equal(peek("user_db", "guest1"), undefined); // GUESTS HAVE NO ROW
	});

	test("a guest resets their own game, keeping its level", async () => {
		await call("POST", "/games/guest", { body: { game_id: "guest1", color: "w", level: 6 } });
		await call("POST", "/games/guest1/move", { guest: "guest1", body: { from: "e2", to: "e4" } });
		const reset = (await call("POST", "/games/guest", { guest: "guest1", body: { game_id: "guest1", color: "w" } })).game_data;
		assert.equal(reset.game_id.S, "guest1");
		assert.deepEqual(reset.moves.S, []);
		assert.equal(reset.ai_level.N, "6");
	});

	test("an id that isn't the guest's own gets a new game, and that game isn't touched", async () => {
		await call("POST", "/games/guest", { body: { game_id: "guest1", color: "w" } });
		await db.initializeGame("game1", "alice", "CHESS_AI", 3, { start_params: { color: "w" } });
		for (const [gameId, options] of [["guest1", { guest: "other" }], ["guest1", {}], ["game1", {}], ["game1", { guest: "alice" }]]) {
			const before = peek("chess_db", gameId);
			const made = (await call("POST", "/games/guest", { ...options, body: { game_id: gameId, color: "w" } })).game_data;
			assert.notEqual(made.game_id.S, gameId);
			assert.equal(made.white_player_id.S, made.game_id.S);
			assert.deepEqual(peek("chess_db", gameId), before);
		}
	});

	test("CHESS_AI or no id gets a new id, a signed in player or a bad body is refused", async () => {
		const made = (await call("POST", "/games/guest", { body: { game_id: "CHESS_AI", color: "w" } })).game_data;
		assert.notEqual(made.game_id.S, "CHESS_AI");
		assert.equal(peek("chess_db", "CHESS_AI"), undefined);
		assert.ok((await call("POST", "/games/guest", { body: { color: "b" } })).game_data.game_id.S);
		await refused([["chess_db", "guest2"]], "POST", "/games/guest", { as: alice, body: { game_id: "guest2" } }, 403);
		await refused([["chess_db", "guest2"]], "POST", "/games/guest", { body: { game_id: "guest2", level: 0 } }, 400);
		await refused([["chess_db", "guest2"]], "POST", "/games/guest", { body: { game_id: ["guest2"] } }, 400);
		await refused([["chess_db", "guest2"]], "POST", "/games/guest", { body: { game_id: "guest2", black_player_id: "alice" } }, 400);
	});
});

/* ---------------------------------------------------------------- */
// A Guest's Side
/* ---------------------------------------------------------------- */

describe("guest game side", () => {
	test("side fixes this game's side, color is what restarts use", async () => {
		const made = (await call("POST", "/games/guest", { body: { game_id: "guest1", color: "random", side: "w" } })).game_data;
		assert.equal(made.white_player_id.S, "guest1");
		assert.deepEqual(JSON.parse(made.start_params.S), { color: "random" });
		await refused([["chess_db", "guest2"]], "POST", "/games/guest", { body: { game_id: "guest2", side: "random" } }, 400);
	});
});
