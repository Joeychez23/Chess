/*
 *  friends.test.js  --  chess server tests
 *	Friends (#40)
 *  Friend requests through the real routes & data service: saved on both players' rows, pushed to their tabs, answered with names only,
 *  every refusal, a rename, who's online & Delete my data leaving nothing on a friend's row
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const { call, player, peek, listen, throttleBatchReads } = testServer;
const { FRIEND_ACTIONS, MAX_FRIENDS, MAX_REQUESTS } = require("../../data-service/utils/friends.js");
const { FRIEND_LIMITS } = require("../middleware/rateLimit.js");

let server;
before(async () => { server = await testServer.start(); });
after(() => { testServer.reset(); server.close(); });
beforeEach(() => testServer.reset());

const pick = (who, username) => call("PUT", "/api/user/username", { as: who, body: { username } });
const act = (who, action, username) => call("POST", `/api/user/friends/${action}`, { as: who, body: { username } });
const list = async (who) => {
	const { http, retry_after, ...body } = await call("GET", "/api/user/friends", { as: who });
	return body;
};
const lists = (id) => JSON.parse(peek("user_db", id).friend_lists?.S || '{"friends":[],"sent":[],"received":[]}');
const NONE = { friends: [], sent: [], received: [] };

/**
 * @description Alice ("Alice") & Bob ("Bobby"), both with a username
 */
async function twoPlayers() {
	const alice = player("alice");
	const bob = player("bob");
	await pick(alice, "Alice");
	await pick(bob, "Bobby");
	return { alice, bob };
}

async function friends() {
	const players = await twoPlayers();
	await act(players.alice, "request", "Bobby");
	await act(players.bob, "accept", "Alice");
	return players;
}

/* ---------------------------------------------------------------- */
// Requests
/* ---------------------------------------------------------------- */

describe("friend requests", () => {
	test("sending saves it on both rows, finds the name in any capitals and pushes it to both players", async () => {
		const { alice, bob } = await twoPlayers();
		const alicesTab = await listen(alice);
		const bobsTab = await listen(bob);

		const sent = await act(alice, "request", "BOBBY");
		assert.equal(sent.http, 200);
		assert.equal(sent.player_id, undefined); // NEVER WHO HOLDS A NAME
		assert.deepEqual(lists("alice"), { friends: [], sent: ["bob"], received: [] });
		assert.deepEqual(lists("bob"), { friends: [], sent: [], received: ["alice"] });
		assert.deepEqual(await alicesTab.heard("friends"), {});
		assert.deepEqual(await bobsTab.heard("friends"), {});

		assert.deepEqual((await list(alice)).sent, [{ username: "Bobby" }]);
		assert.deepEqual((await list(bob)).received, [{ username: "Alice" }]);
	});

	test("accepting makes them friends on both rows and tells the sender", async () => {
		const { alice, bob } = await twoPlayers();
		await act(alice, "request", "Bobby");
		const alicesTab = await listen(alice);

		assert.equal((await act(bob, "accept", "Alice")).http, 200);
		assert.deepEqual(lists("alice"), { friends: ["bob"], sent: [], received: [] });
		assert.deepEqual(lists("bob"), { friends: ["alice"], sent: [], received: [] });
		assert.deepEqual(await alicesTab.heard("friends"), {});
	});

	test("declining and cancelling clear both rows, and a new request can follow", async () => {
		const { alice, bob } = await twoPlayers();
		await act(alice, "request", "Bobby");
		assert.equal((await act(bob, "decline", "Alice")).http, 200);
		assert.deepEqual(lists("alice"), NONE);
		assert.deepEqual(lists("bob"), NONE);

		await act(alice, "request", "Bobby");
		assert.equal((await act(alice, "cancel", "Bobby")).http, 200);
		assert.deepEqual(lists("alice"), NONE);
		assert.deepEqual(lists("bob"), NONE);
		assert.equal((await act(alice, "request", "Bobby")).http, 200);
	});

	test("removing takes them off both lists and tells the friend", async () => {
		const { alice, bob } = await friends();
		const bobsTab = await listen(bob);
		assert.equal((await act(alice, "remove", "Bobby")).http, 200);
		assert.deepEqual(lists("alice"), NONE);
		assert.deepEqual(lists("bob"), NONE);
		assert.deepEqual(await bobsTab.heard("friends"), {});
	});

	test("the row's games, settings and username stay", async () => {
		await friends();
		const row = peek("user_db", "alice");
		assert.equal(row.username.S, "Alice");
		assert.equal(row.open_games.S, "[]");
	});

	test("two players asking each other at once: one request stands", async () => {
		const { alice, bob } = await twoPlayers();
		const answers = await Promise.all([act(alice, "request", "Bobby"), act(bob, "request", "Alice")]);
		assert.deepEqual(answers.map((answer) => answer.http).sort(), [200, 409]);
		assert.equal(lists("alice").sent.length + lists("bob").sent.length, 1);
		assert.deepEqual(lists("alice").sent.length ? lists("bob").received : lists("alice").received, [lists("alice").sent.length ? "alice" : "bob"]);
	});
});

/* ---------------------------------------------------------------- */
// Refusals
/* ---------------------------------------------------------------- */

describe("refused", () => {
	test("your own name, a free name or one nobody could hold", async () => {
		const { alice } = await twoPlayers();
		assert.equal((await act(alice, "request", "alice")).message, "That's your username");
		assert.equal((await act(alice, "request", "NoSuchPlayer")).http, 404);
		assert.equal((await act(alice, "request", "no spaces")).http, 404);
		assert.equal((await act(alice, "request", undefined)).http, 404);
		assert.equal((await act(alice, "request", { bad: 1 })).http, 404);
		assert.deepEqual(lists("alice"), NONE);
	});

	test("a request sent twice, one they already sent you, and an existing friend", async () => {
		const { alice, bob } = await twoPlayers();
		await act(alice, "request", "Bobby");
		assert.equal((await act(alice, "request", "Bobby")).message, "You already sent them a request");
		assert.equal((await act(bob, "request", "Alice")).message, "They already sent you a request, accept it in Friends");
		await act(bob, "accept", "Alice");
		const again = await act(alice, "request", "Bobby");
		assert.equal(again.http, 409);
		assert.equal(again.message, "You're already friends");
	});

	test("answering a request that isn't there changes nothing", async () => {
		const { alice, bob } = await twoPlayers();
		await act(alice, "request", "Bobby");
		for (const [who, action, name] of [[alice, "accept", "Bobby"], [alice, "decline", "Bobby"], [bob, "cancel", "Alice"], [bob, "remove", "Alice"]]) {
			assert.equal((await act(who, action, name)).http, 404, action);
		}
		assert.deepEqual(lists("alice"), { friends: [], sent: ["bob"], received: [] });
		assert.deepEqual(lists("bob"), { friends: [], sent: [], received: ["alice"] });
	});

	test("full lists", () => {
		const full = (count) => Array.from({ length: count }, (_, i) => `player${i}`);
		const empty = () => ({ friends: [], sent: [], received: [] });
		assert.equal(FRIEND_ACTIONS.request({ ...empty(), friends: full(MAX_FRIENDS) }, empty(), "a", "b").message, "Your friends list is full");
		assert.equal(FRIEND_ACTIONS.request({ ...empty(), sent: full(MAX_REQUESTS) }, empty(), "a", "b").message, "You have too many requests waiting");
		assert.equal(FRIEND_ACTIONS.request(empty(), { ...empty(), received: full(MAX_REQUESTS) }, "a", "b").message, "They have too many requests waiting");
		assert.equal(FRIEND_ACTIONS.accept({ ...empty(), received: ["b"], friends: full(MAX_FRIENDS) }, empty(), "a", "b").message, "Your friends list is full");
		assert.equal(FRIEND_ACTIONS.accept({ ...empty(), received: ["b"] }, { ...empty(), friends: full(MAX_FRIENDS) }, "a", "b").message, "Their friends list is full");
	});

	test("signed out", async () => {
		assert.equal((await call("GET", "/api/user/friends")).http, 401);
		assert.equal((await call("POST", "/api/user/friends/request", { body: { username: "Bobby" } })).http, 401);
	});

	test("too many requests in a row get a 429 with Retry-After", async () => {
		const { alice } = await twoPlayers();
		for (let i = 0; i < FRIEND_LIMITS.friendSession.burst; i++) { await act(alice, "request", "NoSuchPlayer"); }
		const refused = await act(alice, "request", "Bobby");
		assert.equal(refused.http, 429);
		assert.ok(Number(refused.retry_after) > 0);
		assert.deepEqual(lists("alice"), NONE);
	});
});

/* ---------------------------------------------------------------- */
// The List
/* ---------------------------------------------------------------- */

describe("the friends list", () => {
	test("a player with no friends gets empty lists", async () => {
		assert.deepEqual(await list(player("alice")), { status: 200, ...NONE });
	});

	test("has names and who's online, never an id or email", async () => {
		const { alice, bob } = await friends();
		assert.deepEqual(await list(alice), { status: 200, friends: [{ username: "Bobby", online: false }], sent: [], received: [] });
		await listen(bob);
		const seen = await list(alice);
		assert.deepEqual(seen.friends, [{ username: "Bobby", online: true }]);
		assert.ok(!JSON.stringify(seen).includes("@") && !JSON.stringify(seen).includes('"bob"'));
	});

	test("a friend who renames shows the new name, the old one can't be used for them", async () => {
		const { alice, bob } = await friends();
		await pick(bob, "Robert");
		assert.deepEqual((await list(alice)).friends, [{ username: "Robert", online: false }]);
		assert.equal((await act(alice, "remove", "Bobby")).http, 404);
		assert.equal((await act(alice, "remove", "Robert")).http, 200);
	});

	test("sorted by name, ignoring capitals", async () => {
		const { alice } = await friends();
		const carol = player("carol");
		await pick(carol, "aaron");
		await act(carol, "request", "Alice");
		await act(alice, "accept", "aaron");
		assert.deepEqual((await list(alice)).friends.map((friend) => friend.username), ["aaron", "Bobby"]);
	});

	test("the name lookup asks again when it's throttled", async () => {
		const { alice } = await friends();
		const carol = player("carol");
		await pick(carol, "Carol");
		await act(carol, "request", "Alice");
		throttleBatchReads(2);
		const seen = await list(alice);
		assert.deepEqual(seen.friends.map((friend) => friend.username), ["Bobby"]);
		assert.deepEqual(seen.received, [{ username: "Carol" }]);
	});
});

/* ---------------------------------------------------------------- */
// Delete My Data
/* ---------------------------------------------------------------- */

describe("delete my data", () => {
	test("takes the player off every friend's and requester's row, and tells them", async () => {
		const { alice, bob } = await friends();
		const carol = player("carol");
		await pick(carol, "Carol");
		await act(carol, "request", "Alice");
		const dave = player("dave");
		await pick(dave, "Dave");
		await act(alice, "request", "Dave");
		const bobsTab = await listen(bob);

		assert.equal((await call("DELETE", "/api/user", { as: alice })).status, 200);
		assert.equal(peek("user_db", "alice"), undefined);
		for (const id of ["bob", "carol", "dave"]) { assert.deepEqual(lists(id), NONE, id); }
		assert.deepEqual(await bobsTab.heard("friends"), {});
	});

	test("coming back later starts with no friends", async () => {
		const { alice, bob } = await friends();
		await call("DELETE", "/api/user", { as: alice });
		assert.deepEqual(await list(alice), { status: 200, ...NONE });
		assert.deepEqual(await list(bob), { status: 200, ...NONE });
	});
});
