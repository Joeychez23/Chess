/*
 *  username.test.js  --  chess server tests
 *	Unique Usernames (#118)
 *  PUT /api/user/username (the settings page's Username) & GET /api/user returning it, the username#<name> items that keep
 *  each name to one player, Home sending a player without one to /settings, & the names friends see on invites
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const { call, page, player, peek } = testServer;

let server;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => testServer.reset());

const pick = (who, username) => call("PUT", "/api/user/username", { as: who, body: { username } });

/**
 * @description An open friend game: the inviter sends, the friend accepts
 */
async function friendGame(inviter, friend) {
	const invite = await call("POST", "/api/chess/invite", { as: inviter, body: { opponent_email: friend.email, start_color: "w" } });
	await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: friend, body: {} });
	return invite.game_id;
}

/* ---------------------------------------------------------------- */
// Claiming A Username
/* ---------------------------------------------------------------- */

describe("claiming a username", () => {
	test("is saved on the player's row, held by a username# item, and comes back from GET /api/user", async () => {
		const alice = player("alice");
		assert.equal((await call("GET", "/api/user", { as: alice })).username, null); // NONE YET

		const saved = await pick(alice, "Alice_1");
		assert.equal(saved.http, 200);
		assert.equal(saved.username, "Alice_1");

		assert.equal((await call("GET", "/api/user", { as: alice })).username, "Alice_1");
		assert.equal(peek("user_db", "alice").username.S, "Alice_1");
		assert.equal(peek("user_db", "alice").open_games.S, "[]"); // A PLAYER WHO HASN'T PLAYED GETS A FULL ROW
		const claim = peek("user_db", "username#alice_1");
		assert.equal(claim.owner_id.S, "alice");
		assert.equal(claim.username.S, "Alice_1");
	});

	test("nobody else can have it, whatever the capitals", async () => {
		const alice = player("alice");
		const bob = player("bob");
		await pick(alice, "Knight");

		const taken = await pick(bob, "kNIGHT");
		assert.equal(taken.http, 409);
		assert.equal(taken.message, "That username is taken");
		assert.equal(peek("user_db", "bob")?.username, undefined);
		assert.equal(peek("user_db", "username#knight").owner_id.S, "alice");
	});

	test("two players asking for the same name at once: one gets it", async () => {
		const bob = player("bob");
		const carol = player("carol");
		const answers = await Promise.all([pick(bob, "Castle"), pick(carol, "castle")]);
		assert.deepEqual(answers.map((answer) => answer.http).sort(), [200, 409]);
		const owner = peek("user_db", "username#castle").owner_id.S;
		assert.equal(peek("user_db", owner).username.S.toLowerCase(), "castle");
		assert.equal(peek("user_db", owner == "bob" ? "carol" : "bob")?.username, undefined);
	});

	test("renaming frees the old name", async () => {
		const alice = player("alice");
		const bob = player("bob");
		await pick(alice, "First");
		await pick(alice, "Second");

		assert.equal(peek("user_db", "username#first"), undefined);
		assert.equal(peek("user_db", "username#second").owner_id.S, "alice");
		assert.equal((await pick(bob, "first")).http, 200);
	});

	test("changing only the capitals keeps the same claim", async () => {
		const alice = player("alice");
		const bob = player("bob");
		await pick(alice, "joe");

		const saved = await pick(alice, "Joe");
		assert.equal(saved.http, 200);
		assert.equal(peek("user_db", "alice").username.S, "Joe");
		assert.equal(peek("user_db", "username#joe").username.S, "Joe");
		assert.equal(peek("user_db", "username#joe").owner_id.S, "alice");
		assert.equal((await pick(bob, "JOE")).http, 409);
	});

	test("saving the name they have again changes nothing", async () => {
		const alice = player("alice");
		await pick(alice, "Pawn");
		assert.equal((await pick(alice, "Pawn")).http, 200);
		assert.equal(peek("user_db", "username#pawn").owner_id.S, "alice");
	});

	test("game list and settings saves keep it", async () => {
		const alice = player("alice");
		await pick(alice, "Queen");
		await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
		await call("PUT", "/api/user/settings", { as: alice, body: { ai_level: 5 } });
		assert.equal(peek("user_db", "alice").username.S, "Queen");
	});

	test("needs a signed in player", async () => {
		assert.equal((await call("PUT", "/api/user/username", { body: { username: "Guest1" } })).http, 401);
	});
});

/* ---------------------------------------------------------------- */
// Rules
/* ---------------------------------------------------------------- */

describe("username rules", () => {
	test("3 to 20 letters, numbers, _ or -", async () => {
		const alice = player("alice");
		for (const username of ["ab", "a".repeat(21), "has space", "dot.name", "émile", "rook!", "", 42, null]) {
			const refused = await pick(alice, username);
			assert.equal(refused.http, 400, `${username}`);
			assert.equal(refused.message, "Usernames are 3 to 20 letters, numbers, _ or -");
		}
		assert.equal(peek("user_db", "alice"), undefined); // NOTHING SAVED
		assert.equal((await pick(alice, "a-b_C9")).http, 200);
		assert.equal((await pick(alice, "x".repeat(20))).http, 200);
	});

	test("spaces around it are dropped", async () => {
		const alice = player("alice");
		assert.equal((await pick(alice, "  Rook  ")).username, "Rook");
	});

	test("reserved names are refused in any capitals", async () => {
		const alice = player("alice");
		for (const username of ["admin", "Stockfish", "CHESS_AI", "Friend", "you", "Guest"]) {
			const refused = await pick(alice, username);
			assert.equal(refused.http, 400, username);
			assert.equal(refused.message, "That username is reserved");
		}
	});
});

/* ---------------------------------------------------------------- */
// Delete My Data
/* ---------------------------------------------------------------- */

describe("delete my data", () => {
	test("frees the username", async () => {
		const alice = player("alice");
		const bob = player("bob");
		await pick(alice, "Bishop");

		assert.equal((await call("DELETE", "/api/user", { as: alice })).status, 200);
		assert.equal(peek("user_db", "alice"), undefined);
		assert.equal(peek("user_db", "username#bishop"), undefined);
		assert.equal((await pick(bob, "bishop")).http, 200);
	});
});

/* ---------------------------------------------------------------- */
// Home
/* ---------------------------------------------------------------- */

describe("home", () => {
	test("sends a signed in player without a username to /settings", async () => {
		const alice = player("alice");
		const first = await page("/", { as: alice });
		assert.equal(first.http, 302);
		assert.equal(first.location, "/settings");
		assert.equal((await page("/settings", { as: alice })).location, null); // NO LOOP

		await pick(alice, "Alice");
		assert.equal((await page("/", { as: alice })).location, null); // HOME NOW
	});

	test("guests still get the guest page", async () => {
		assert.equal((await page("/")).location, null);
	});
});

/* ---------------------------------------------------------------- */
// Names Friends See
/* ---------------------------------------------------------------- */

describe("names friends see", () => {
	test("an invite shows usernames, and the Auth0 screenname for a player without one", async () => {
		const alice = player("alice");
		const bob = player("bob"); // NO USERNAME, HIS SCREENNAME IS "Bob"
		await pick(alice, "AliceTheGreat");
		await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email } });

		assert.equal((await call("GET", "/api/chess/user/bob", { as: bob })).received_invites[0].name, "AliceTheGreat");
		assert.equal((await call("GET", "/api/chess/user/alice", { as: alice })).sent_invite.name, "Bob");
	});

	test("a game keeps the name it was made with, the rematch shows a username picked since", async () => {
		const alice = player("alice");
		const bob = player("bob");
		const gameId = await friendGame(alice, bob);
		await call("POST", `/api/chess/game/${gameId}/forfeit`, { as: bob });
		await pick(bob, "Bobby");

		assert.equal((await call("GET", `/api/chess/game/${gameId}`, { as: alice })).opponent_name, "Bob");
		await call("POST", `/api/chess/game/${gameId}/rematch`, { as: alice });
		const rematch = await call("POST", `/api/chess/game/${gameId}/rematch`, { as: bob });
		assert.equal((await call("GET", `/api/chess/game/${rematch.new_game_id}`, { as: alice })).opponent_name, "Bobby");
		assert.equal((await call("GET", `/api/chess/game/${rematch.new_game_id}`, { as: bob })).opponent_name, "Alice"); // HER SCREENNAME
	});
});
