/*
 *  users.test.js  --  data service tests
 *	User Routes (controllers/userController.js)
 *  A signed in player's own row only: reading it with their games, their settings, their username & Delete my data.
 *  Guests have no row. A refused request changes nothing
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const service = require("./helpers/service.js");
const { call, player, peek } = service;
const db = require("../dynamoDB.js");

let server;
before(async () => { server = await service.start(); });
after(() => server.close());
beforeEach(() => service.reset());

const alice = player("alice");
const bob = player("bob");

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

const SETTINGS = { ai_level: 5, ai_color: "b", friend_color: "random" };
const friendGame = (gameId, white, black, pending) => db.initalizeGame(gameId, white, black, false, { names: { w: white, b: black }, pending, start_params: { color: "w" }, inviter_id: white });

/**
 * @description Makes a request that must be refused & checks the rows named didn't change
 * @param  {[array]} keys [user_db keys]
 */
async function refused(keys, method, path, options, http) {
	const before = keys.map((key) => peek("user_db", key));
	const response = await call(method, path, options);
	assert.equal(response.http, http, response.message);
	assert.deepEqual(keys.map((key) => peek("user_db", key)), before, "a row changed");
	return response;
}

/* ---------------------------------------------------------------- */
// Get User
/* ---------------------------------------------------------------- */

describe("GET /users/me", () => {
	test("the requester's row as stored, or not found before their first game", async () => {
		assert.equal((await call("GET", "/users/me", { as: alice })).message, "User data not found");
		await db.initalizeGame("game1", "alice", "CHESS_AI", 3, { start_params: { color: "w" } });
		const response = await call("GET", "/users/me?consistent=true", { as: alice });
		assert.equal(response.user_data.user_id.S, "alice");
		assert.deepEqual(JSON.parse(response.user_data.open_games.S), ["game1"]);
		assert.equal(response.user_data.ai_game_id, undefined); // ONLY WITH games=true
	});

	test("with games: the open AI and friend games and the invites, expired ones pruned", async () => {
		await db.initalizeGame("game1", "alice", "CHESS_AI", 3, { start_params: { color: "w" } });
		await friendGame("game2", "alice", "bob");
		await friendGame("invite1", "bob", "alice", true);
		await db.initalizeGame("game3", "alice", "CHESS_AI", 3, { start_params: { color: "w" } });
		await new DynamoDB({ region: "us-west-2" }).deleteItem({ TableName: "chess_db", Key: { game_id: { S: "game3" } } }); // TTL DELETED IT, IT'S STILL IN HER LIST
		const user = (await call("GET", "/users/me?games=true", { as: alice })).user_data;
		assert.equal(user.ai_game_id, "game1"); // THE NEWEST AI GAME THAT'S STILL THERE
		assert.equal(user.friend_game_id, "game2");
		assert.deepEqual(user.received_invites.map((invite) => invite.game_id), ["invite1"]);
		assert.equal(user.sent_invite, null);
		assert.deepEqual(JSON.parse(peek("user_db", "alice").open_games.S), ["game1", "game2"]); // THE PRUNED LIST IS SAVED
	});

	test("guests have no row, and nobody is refused", async () => {
		await refused([], "GET", "/users/me", { guest: "guest1" }, 403);
		await refused([], "GET", "/users/me", {}, 401);
	});
});

/* ---------------------------------------------------------------- */
// Settings
/* ---------------------------------------------------------------- */

describe("POST /users/me/settings", () => {
	test("saves the three settings on the requester's row", async () => {
		const saved = await call("POST", "/users/me/settings", { as: alice, body: SETTINGS });
		assert.equal(saved.status, 200);
		assert.deepEqual(JSON.parse(peek("user_db", "alice").settings.S), SETTINGS);
		assert.equal(peek("user_db", "bob"), undefined);
	});

	test("a bad value, a missing one or an extra field changes nothing", async () => {
		await call("POST", "/users/me/settings", { as: alice, body: SETTINGS });
		for (const body of [{ ...SETTINGS, ai_level: 9 }, { ...SETTINGS, ai_level: "5" }, { ...SETTINGS, ai_color: "red" }, { ai_level: 5, ai_color: "w" }, { ...SETTINGS, user_id: "bob" }, { ...SETTINGS, rating: 3000 }]) {
			await refused(["alice", "bob"], "POST", "/users/me/settings", { as: alice, body }, 400);
		}
		await refused(["guest1"], "POST", "/users/me/settings", { guest: "guest1", body: SETTINGS }, 403);
	});
});

/* ---------------------------------------------------------------- */
// Username
/* ---------------------------------------------------------------- */

describe("POST /users/me/username", () => {
	test("claims a free name, a change of capitals keeps it", async () => {
		assert.equal((await call("POST", "/users/me/username", { as: alice, body: { username: " Alice_K " } })).username, "Alice_K");
		assert.equal(peek("user_db", "username#alice_k").owner_id.S, "alice");
		assert.equal((await call("POST", "/users/me/username", { as: alice, body: { username: "ALICE_K" } })).status, 200);
		assert.equal(peek("user_db", "alice").username.S, "ALICE_K");
	});

	test("someone else's name, in any capitals, is taken and their claim is untouched", async () => {
		await call("POST", "/users/me/username", { as: bob, body: { username: "Bobby" } });
		const before = peek("user_db", "username#bobby");
		const taken = await call("POST", "/users/me/username", { as: alice, body: { username: "BOBBY" } });
		assert.equal(taken.status, 409);
		assert.deepEqual(peek("user_db", "username#bobby"), before);
		assert.equal(peek("user_db", "alice")?.username, undefined);
	});

	test("the rules are checked again, and only the username field is taken", async () => {
		await call("POST", "/users/me/username", { as: alice, body: { username: "Alice_K" } });
		for (const username of ["ab", "admin", "has space", "x".repeat(21), 42]) {
			await refused(["alice", "username#alice_k"], "POST", "/users/me/username", { as: alice, body: { username } }, 400);
		}
		await refused(["alice"], "POST", "/users/me/username", { as: alice, body: { username: "Alice2", user_id: "bob" } }, 400);
	});
});

/* ---------------------------------------------------------------- */
// Delete My Data
/* ---------------------------------------------------------------- */

describe("POST /users/me/delete", () => {
	test("refused while the player still has an open game or an invite", async () => {
		await call("POST", "/users/me/username", { as: alice, body: { username: "Alice_K" } });
		await db.initalizeGame("game1", "alice", "CHESS_AI", 3, { start_params: { color: "w" } });
		await refused(["alice", "username#alice_k"], "POST", "/users/me/delete", { as: alice }, 409);
		await call("POST", "/games/game1/forfeit", { as: alice });
		await friendGame("game2", "bob", "alice");
		await refused(["alice", "username#alice_k"], "POST", "/users/me/delete", { as: alice }, 409);
		await call("POST", "/games/game2/forfeit", { as: alice });
		await friendGame("invite1", "bob", "alice", true);
		await refused(["alice", "username#alice_k"], "POST", "/users/me/delete", { as: alice }, 409);
	});

	test("refused when the open games can't be read (a throttled or failed batch read)", async () => {
		await call("POST", "/users/me/username", { as: alice, body: { username: "Alice_K" } });
		await db.initalizeGame("game1", "alice", "CHESS_AI", 3, { start_params: { color: "w" } });
		service.failBatchReads(true);
		await refused(["alice", "username#alice_k"], "POST", "/users/me/delete", { as: alice }, 500);
		assert.equal((await call("GET", "/users/me?games=true", { as: alice })).http, 500); // HOME TOO, NOT AN EMPTY LIST
	});

	test("once they've left every game, the row and the username go, other players stay", async () => {
		await call("POST", "/users/me/username", { as: alice, body: { username: "Alice_K" } });
		await friendGame("game1", "alice", "bob");
		await call("POST", "/games/game1/forfeit", { as: alice });
		const deleted = await call("POST", "/users/me/delete", { as: alice });
		assert.equal(deleted.status, 200);
		assert.equal(peek("user_db", "alice"), undefined);
		assert.equal(peek("user_db", "username#alice_k"), undefined);
		assert.ok(peek("user_db", "bob"));
		assert.equal(peek("chess_db", "game1").state.S, "CLOSED"); // THE FINISHED GAME STAYS FOR BOB
	});

	test("guests and extra fields are refused", async () => {
		await refused(["guest1"], "POST", "/users/me/delete", { guest: "guest1" }, 403);
		await call("POST", "/users/me/settings", { as: alice, body: SETTINGS });
		await refused(["alice"], "POST", "/users/me/delete", { as: alice, body: { user_id: "bob" } }, 400);
	});
});
