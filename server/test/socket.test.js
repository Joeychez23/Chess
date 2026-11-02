/*
 *  socket.test.js  --  chess server tests
 *	Socket.IO Sessions (server/socket.js, #298)
 *  The access token is only read in the handshake, so a socket is closed when that token runs out, & every socket a player
 *  has open is closed when they log out or delete their data. Only the game's own page can open one, & join-game is limited per socket
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const { call, send, player, listen } = testServer;
const keys = require("../../data-service/test/helpers/keys.js");
const config = require("../config");

let server;
before(async () => { server = await testServer.start(); });
after(() => { testServer.reset(); server.close(); }); // CLOSES THE LAST TEST'S TABS TOO
beforeEach(() => testServer.reset());

const ourOrigin = () => new URL(config.clientUrl).origin;

/**
 * @description Logs a player in like the login page does (auth.test.js), the cookies has the refresh_token
 */
function logIn(someone) {
	return send("POST", "/api/auth/login", {}, { headers: { "Content-Type": "application/json", Origin: ourOrigin() }, body: JSON.stringify({ email: someone.email, password: someone.password }) });
}

/**
 * @description Resolves with true when the tab was closed within ms, false when it's still open
 */
function closedWithin(tab, ms) {
	return Promise.race([tab.closed.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), ms))]);
}

describe("handshake origin", () => {
	test("the game's own page can connect", async () => {
		const alice = player("alice");
		const tab = await listen(alice, undefined, { headers: { Origin: ourOrigin(), "Sec-Fetch-Site": "same-origin" } });
		assert.equal(await closedWithin(tab, 100), false);
	});

	test("another origin, a same-site subdomain included, is refused", async () => {
		const alice = player("alice");
		await assert.rejects(listen(alice, undefined, { headers: { Origin: "https://engine.example.test" } }));
		await assert.rejects(listen(alice, undefined, { headers: { Origin: ourOrigin(), "Sec-Fetch-Site": "same-site" } }));
	});
});

describe("session end", () => {
	test("a socket is closed when its access token runs out", async () => {
		const alice = player("alice");
		const tab = await listen(alice, undefined, { cookie: `access_token=${keys.sessionToken(alice.user, { expiresIn: 1 })}` });
		assert.equal(await Promise.race([tab.closed, new Promise((resolve) => setTimeout(() => resolve("open"), 3000))]), "io server disconnect");
	});

	test("logout closes every socket the player has open, not anyone else's", async () => {
		const alice = player("alice");
		const bob = player("bob");
		const phone = await listen(alice);
		const laptop = await listen(alice);
		const bobsTab = await listen(bob);
		const login = await logIn(alice);

		const logout = await send("POST", "/api/auth/logout", { refresh_token: login.cookies.refresh_token }, { headers: { Origin: ourOrigin(), "Sec-Fetch-Site": "same-origin" } });
		assert.equal(logout.http, 200);
		assert.equal(await phone.closed, "io server disconnect");
		assert.equal(await laptop.closed, "io server disconnect");
		assert.equal(await closedWithin(bobsTab, 100), false);
	});

	test("Delete my data closes every socket the player has open", async () => {
		const alice = player("alice");
		const tab = await listen(alice);
		const deleted = await call("DELETE", "/api/user", { as: alice });
		assert.equal(deleted.status, 200);
		assert.equal(await tab.closed, "io server disconnect");
	});
});

describe("join-game", () => {
	test("is limited per socket", async () => {
		const alice = player("alice");
		const tab = await listen(alice);
		for (let i = 0; i < 5; i++) { assert.notEqual((await tab.join("nope")).status, 429); }
		const limited = await tab.join("nope");
		assert.equal(limited.status, 429);

		const other = await listen(alice); // ANOTHER TAB HAS ITS OWN LIMIT
		assert.notEqual((await other.join("nope")).status, 429);
	});
});

describe("a rematch request & the other player", () => {
	/**
	 * @description A friend game Bob forfeited: Alice asks for the rematch
	 */
	async function finishedGame() {
		const alice = player("alice");
		const bob = player("bob");
		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email, start_color: "w" } });
		await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: {} });
		await call("POST", `/api/chess/game/${invite.game_id}/forfeit`, { as: bob });
		return { alice, bob, gameId: invite.game_id };
	}

	test("the room hears when a player's last tab leaves, and when they come back", async () => {
		const { alice, bob, gameId } = await finishedGame();
		const bobsTab = await listen(bob, gameId);
		const bobsOtherTab = await listen(bob, gameId);
		const alicesTab = await listen(alice, gameId);

		bobsOtherTab.disconnect();
		await alicesTab.join(gameId); // A ROUND TRIP, THE DISCONNECT HAS BEEN SEEN
		bobsTab.disconnect();
		assert.deepEqual(await alicesTab.heard("player-left"), { game_id: gameId, player_id: "bob" });
		assert.equal(alicesTab.events.filter(({ event }) => event == "player-left").length, 1); // BOB'S OTHER TAB LEAVING SAID NOTHING

		await listen(bob, gameId);
		assert.deepEqual(await alicesTab.heard("player-back"), { game_id: gameId, player_id: "bob" });
	});

	test("the press says who it's waiting for and whether they're still here", async () => {
		const { alice, bob, gameId } = await finishedGame();
		const bobsTab = await listen(bob, gameId);
		const alicesTab = await listen(alice, gameId);

		const here = await call("POST", `/api/chess/game/${gameId}/rematch`, { as: alice });
		assert.equal(here.waiting, true);
		assert.equal(here.opponent_name, "Bob");
		assert.equal(here.opponent_here, true);

		bobsTab.disconnect();
		await alicesTab.heard("player-left");
		const gone = await call("POST", `/api/chess/game/${gameId}/rematch`, { as: alice });
		assert.equal(gone.opponent_here, false);
	});

	test("cancel: only a player in the game, and the other press then waits", async () => {
		const { alice, bob, gameId } = await finishedGame();
		await call("POST", `/api/chess/game/${gameId}/rematch`, { as: alice });
		const carol = player("carol");
		assert.equal((await call("POST", `/api/chess/game/${gameId}/rematch/cancel`, { as: carol })).status, 403);
		assert.equal((await call("POST", `/api/chess/game/${gameId}/rematch/cancel`, { as: alice })).cancelled, true);
		assert.equal((await call("POST", `/api/chess/game/${gameId}/rematch`, { as: bob })).waiting, true);
	});
});
