/*
 *  settings.test.js  --  chess server tests
 *	Account Settings (#39)
 *  The settings page's routes: PUT /api/user/settings (Default start settings, read back by GET /api/chess/user/:userId)
 *  and DELETE /api/user (Delete my data: leave every game, then the user_db row goes)
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const { call, player, peek } = testServer;

let server;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => testServer.reset());

const list = (item, name) => JSON.parse(item[name].S);

/**
 * @description An open friend game: the inviter sends, the friend accepts
 */
async function friendGame(inviter, friend) {
	const invite = await call("POST", "/api/chess/invite", { as: inviter, body: { opponent_email: friend.email, start_color: "w" } });
	await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: friend, body: {} });
	return invite.game_id;
}

/* ---------------------------------------------------------------- */
// Default Start Settings
/* ---------------------------------------------------------------- */

describe("default start settings", () => {
	test("are saved and come back with Home's game lists", async () => {
		const alice = player("alice");
		await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } }); // SO SHE HAS A ROW

		const saved = await call("PUT", "/api/user/settings", { as: alice, body: { ai_level: 6, ai_color: "b", friend_color: "w" } });
		assert.equal(saved.status, 200);
		assert.deepEqual(saved.settings, { ai_level: 6, ai_color: "b", friend_color: "w" });

		const home = await call("GET", "/api/chess/user/alice", { as: alice });
		assert.deepEqual(home.settings, { ai_level: 6, ai_color: "b", friend_color: "w" });
		assert.equal(home.games_finished, 0);
	});

	test("anything that isn't a level or a color gets the default", async () => {
		const alice = player("alice");
		const saved = await call("PUT", "/api/user/settings", { as: alice, body: { ai_level: 42, ai_color: "purple" } });
		assert.deepEqual(saved.settings, { ai_level: 3, ai_color: "random", friend_color: "random" });
	});

	test("a player who hasn't played yet gets a full row, so their first game still finds its lists", async () => {
		const alice = player("alice");
		await call("PUT", "/api/user/settings", { as: alice, body: { ai_level: 2 } });
		const row = peek("user_db", "alice");
		assert.deepEqual(list(row, "open_games"), []);
		assert.deepEqual(list(row, "closed_games"), []);

		const game = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
		assert.deepEqual(list(peek("user_db", "alice"), "open_games"), [game.game_id]);
		assert.equal(JSON.parse(peek("user_db", "alice").settings.S).ai_level, 2); // THE GAME LIST SAVE KEPT THE SETTINGS
	});

	test("games_finished counts closed games", async () => {
		const alice = player("alice");
		const first = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
		await call("POST", `/api/chess/game/${first.game_id}/restart`, { as: alice }); // FORFEITS THE FIRST ONE
		assert.equal((await call("GET", "/api/chess/user/alice", { as: alice })).games_finished, 1);
	});

	test("need a signed in player", async () => {
		assert.equal((await call("PUT", "/api/user/settings", { body: { ai_level: 2 } })).http, 401);
		assert.equal((await call("DELETE", "/api/user")).http, 401);
	});
});

/* ---------------------------------------------------------------- */
// Delete My Data
/* ---------------------------------------------------------------- */

describe("delete my data", () => {
	test("forfeits the open games, declines the invites they got, then deletes the row", async () => {
		const alice = player("alice");
		const bob = player("bob");
		const carol = player("carol");
		const gameId = await friendGame(alice, bob); // ALICE IS WHITE
		const aiGame = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
		const carolsInvite = await call("POST", "/api/chess/invite", { as: carol, body: { opponent_email: alice.email } });

		const deleted = await call("DELETE", "/api/user", { as: alice });
		assert.equal(deleted.status, 200);

		const friend = await call("GET", `/api/chess/game/${gameId}`, { as: bob });
		assert.equal(friend.state, "CLOSED");
		assert.equal(friend.winner, "b"); // BOB WINS THE FORFEIT
		assert.equal(friend.reason, "forfeit");
		assert.deepEqual(list(peek("user_db", "bob"), "closed_games"), [gameId]); // BOB'S LISTS STILL HAVE THE GAME

		assert.equal(peek("chess_db", aiGame.game_id).state.S, "CLOSED");
		assert.equal(peek("chess_db", carolsInvite.game_id), undefined); // DECLINED
		assert.deepEqual((await call("GET", "/api/chess/user/carol", { as: carol })).sent_invite, null);
		assert.equal(peek("user_db", "alice"), undefined);
	});

	test("cancels the invite they sent", async () => {
		const alice = player("alice");
		const carol = player("carol");
		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: carol.email } });

		await call("DELETE", "/api/user", { as: alice });
		assert.equal(peek("chess_db", invite.game_id), undefined);
		assert.deepEqual(list(peek("user_db", "carol"), "requested_games"), []);
	});

	test("a player can play again afterwards, starting with a new row", async () => {
		const alice = player("alice");
		await call("PUT", "/api/user/settings", { as: alice, body: { ai_level: 7 } });
		await call("DELETE", "/api/user", { as: alice });

		const game = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
		assert.equal(game.status, 200);
		const home = await call("GET", "/api/chess/user/alice", { as: alice });
		assert.deepEqual(home.settings, { ai_level: 3, ai_color: "random", friend_color: "random" }); // THE OLD SETTINGS WENT WITH THE ROW
	});
});
