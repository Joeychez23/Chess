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
 * @description Logs a player in like the browser does after Auth0's login page (auth.test.js), the cookies has the refresh_token
 */
function logIn(someone) {
	return send("GET", `/api/auth/callback?code=${encodeURIComponent(someone.email)}&state=state1`, { auth_state: "state1" });
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
