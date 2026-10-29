/*
 *  auth.test.js  --  chess server tests
 *	Signing In & Session Tokens (controllers/authController.js, middleware/auth.js, password login #223, #252, only a 401 signs out #283)
 *  The server can't make a session: the login callback passes Auth0's id_token to the data service, which checks it & signs the tokens.
 *  The server only checks tokens with the public key, so a token signed any other way is refused. Logout ends the session on every device
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const { call, send, player, peek, auth0WillSign, auth0WillBlock, auth0Logins, dataServiceWillAnswer } = testServer;
const keys = require("../../data-service/test/helpers/keys.js");
const config = require("../config");
const { readSessionUser } = require("../middleware/auth.js");
const { LOGIN_LIMITS } = require("../middleware/rateLimit.js");

let server;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => testServer.reset());

const alice = player("alice");

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

/**
 * @description Logs a player in like the browser does after Auth0's login page: the callback with the code & the state cookie
 * @return {[object]} response [send()'s, cookies has access_token & refresh_token when it worked]
 */
function logIn(someone, returnTo) {
	const cookies = { auth_state: "state1", ...(returnTo ? { auth_return: returnTo } : {}) };
	return send("GET", `/api/auth/callback?code=${encodeURIComponent(someone.email)}&state=state1`, cookies);
}

const me = (accessToken) => send("GET", "/api/user", { access_token: accessToken });
const refresh = (refreshToken) => send("POST", "/api/auth/refresh", { refresh_token: refreshToken });
const loginHeaders = (ip = "203.0.113.5", origin = new URL(config.clientUrl).origin) => ({ "Content-Type": "application/json", Origin: origin, "X-Forwarded-For": ip });
const passwordLogin = (body, options = {}) => send("POST", "/api/auth/login", {}, { headers: loginHeaders(options.ip, options.origin), body: options.rawBody ?? JSON.stringify(body) });

/* ---------------------------------------------------------------- */
// Login
/* ---------------------------------------------------------------- */

describe("login", () => {
	test("the callback sets the session the data service signed & goes back to the page", async () => {
		player("alice");
		const login = await logIn(alice, "/play/game1");
		assert.equal(login.http, 302);
		assert.equal(login.location, new URL("/play/game1", config.clientUrl).href);
		assert.ok(login.cookies.access_token && login.cookies.refresh_token);
		assert.ok(peek("user_db", "alice").sid.S); // THE SESSION ID ON THEIR ROW

		const user = await me(login.cookies.access_token);
		assert.equal(user.http, 200);
		assert.equal(user.body.userData.user_id, "auth0|alice");
	});

	test("a forged id_token gets no session", async () => {
		player("alice");
		auth0WillSign((claims) => keys.idToken(claims, { forged: true }));
		auth0WillSign((claims) => keys.idToken({ ...claims, aud: "another-client" }));
		auth0WillSign((claims) => keys.idToken({ ...claims, iss: "https://another.auth0.test/" }));
		for (let i = 0; i < 3; i++) {
			const login = await logIn(alice);
			assert.equal(login.location, config.clientUrl);
			assert.deepEqual(login.cookies, { auth_state: "", auth_return: "" }); // ONLY THE LOGIN COOKIES ARE CLEARED
		}
		assert.equal(peek("user_db", "alice"), undefined);
	});

	test("a login the state doesn't match never reaches the data service", async () => {
		player("alice");
		const login = await send("GET", `/api/auth/callback?code=alice%40test&state=other`, { auth_state: "state1" });
		assert.equal(login.location, config.clientUrl);
		assert.equal(login.cookies.access_token, undefined);
	});
});

/* ---------------------------------------------------------------- */
// Password Login
/* ---------------------------------------------------------------- */

describe("password login", () => {
	test("sets session cookies and returns the requested page", async () => {
		const alice = player("alice");
		const response = await passwordLogin({ email: alice.email, password: alice.password });
		assert.equal(response.http, 200);
		assert.equal(response.body.returnTo, "/");
		assert.ok(response.cookies.access_token && response.cookies.refresh_token);
		assert.equal((await me(response.cookies.access_token)).http, 200);
		assert.equal(auth0Logins()[0].headers["auth0-forwarded-for"], "203.0.113.5");
	});

	test("wrong password and unknown email have the same response", async () => {
		const alice = player("alice");
		const wrong = await passwordLogin({ email: alice.email, password: "wrong" });
		const unknown = await passwordLogin({ email: "unknown@test", password: "wrong" });
		assert.equal(wrong.http, 401);
		assert.deepEqual(wrong.body, unknown.body);
	});

	test("Auth0 blocks and login buckets refuse requests before calling Auth0", async () => {
		const alice = player("alice");
		auth0WillBlock();
		assert.equal((await passwordLogin({ email: alice.email, password: alice.password })).http, 429);

		testServer.reset();
		for (let i = 0; i < LOGIN_LIMITS.loginIp.burst; i++) {
			await passwordLogin({ email: `user${i}@test`, password: "x" }, { ip: "198.51.100.10" });
		}
		const beforeIp = auth0Logins().length;
		const ipLimited = await passwordLogin({ email: "other@test", password: "x" }, { ip: "198.51.100.10" });
		assert.equal(ipLimited.http, 429);
		assert.ok(Number(ipLimited.retry_after) > 0);
		assert.equal(auth0Logins().length, beforeIp);

		testServer.reset();
		for (let i = 0; i < LOGIN_LIMITS.loginEmail.burst; i++) {
			await passwordLogin({ email: "Alice@Test", password: "x" }, { ip: `198.51.100.${i + 1}` });
		}
		const beforeEmail = auth0Logins().length;
		const emailLimited = await passwordLogin({ email: "alice@test", password: "x" }, { ip: "203.0.113.10" });
		assert.equal(emailLimited.http, 429);
		assert.ok(Number(emailLimited.retry_after) > 0);
		assert.equal(auth0Logins().length, beforeEmail);
	});

	test("requires same-origin JSON with non-empty string credentials", async () => {
		const alice = player("alice");
		const missingOrigin = await send("POST", "/api/auth/login", {}, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: alice.email, password: alice.password }) });
		assert.equal(missingOrigin.http, 403);
		assert.equal((await passwordLogin({ email: alice.email, password: alice.password }, { origin: "https://wrong.test" })).http, 403);
		const form = await send("POST", "/api/auth/login", {}, { headers: { ...loginHeaders(), "Content-Type": "application/x-www-form-urlencoded" }, body: `email=${alice.email}&password=${alice.password}` });
		assert.equal(form.http, 403);
		for (const body of [{ password: alice.password }, { email: alice.email }, { email: 1, password: alice.password }, { email: alice.email, password: 1 }, { email: "", password: "x" }]) {
			assert.equal((await passwordLogin(body)).http, 400);
		}
	});

	test("keeps safe return paths and refuses forged Auth0 tokens", async () => {
		const alice = player("alice");
		assert.equal((await passwordLogin({ email: alice.email, password: alice.password, returnTo: "/play/game1" })).body.returnTo, "/play/game1");
		assert.equal((await passwordLogin({ email: alice.email, password: alice.password, returnTo: "//other.site" })).body.returnTo, "/");
		testServer.reset();
		const forgedAlice = player("alice");
		auth0WillSign((claims) => keys.idToken(claims, { forged: true }));
		const forged = await passwordLogin({ email: forgedAlice.email, password: forgedAlice.password });
		assert.equal(forged.http, 401);
		assert.equal(forged.cookies.access_token, undefined);
		assert.equal(forged.cookies.refresh_token, undefined);
	});
});

/* ---------------------------------------------------------------- */
// Refresh, Resume & Logout
/* ---------------------------------------------------------------- */

describe("refresh, resume & logout", () => {
	test("refresh re-ups the session from the refresh cookie", async () => {
		player("alice");
		const login = await logIn(alice);
		const response = await refresh(login.cookies.refresh_token);
		assert.equal(response.http, 200);
		assert.equal(response.body.userData.user_id, "auth0|alice");
		assert.equal((await me(response.cookies.access_token)).http, 200);
	});

	test("resume re-ups the session & goes back, or sends a signed out player to login", async () => {
		player("alice");
		const login = await logIn(alice);
		const resumed = await send("GET", "/api/auth/resume?returnTo=%2Fplay%2Fgame1", { refresh_token: login.cookies.refresh_token });
		assert.equal(resumed.location, "/play/game1");
		assert.ok(resumed.cookies.access_token);
		assert.equal((await send("GET", "/api/auth/resume?returnTo=%2Fplay%2Fgame1")).location, "/api/auth/login?returnTo=%2Fplay%2Fgame1");
	});

	test("after logout, refresh fails on every device", async () => {
		player("alice");
		const phone = await logIn(alice);
		const laptop = await logIn(alice);
		const logout = await send("GET", "/api/auth/logout", { refresh_token: phone.cookies.refresh_token });
		assert.equal(logout.http, 302);
		assert.match(logout.location, /^https:\/\/auth0\.test\/v2\/logout/);
		assert.deepEqual([logout.cookies.access_token, logout.cookies.refresh_token], ["", ""]);

		for (const device of [phone, laptop]) {
			const response = await refresh(device.cookies.refresh_token);
			assert.equal(response.http, 401);
			assert.equal(response.cookies.refresh_token, ""); // CLEARED
		}
		assert.equal((await send("GET", "/api/auth/resume?returnTo=%2F", { refresh_token: laptop.cookies.refresh_token })).location, "/api/auth/login?returnTo=%2F");
	});

	test("a 404 or 400 from the data service's refresh answers 503 & keeps both cookies", async () => {
		player("alice");
		const login = await logIn(alice);
		for (const [status, message] of [[404, "No such action"], [400, "Bad request"]]) {
			dataServiceWillAnswer("/session/refresh", status, message);
			const response = await refresh(login.cookies.refresh_token);
			assert.equal(response.http, 503);
			assert.equal(response.body.message, "Try again in a moment");
			assert.equal(response.cookies.access_token, undefined); // NOT CLEARED
			assert.equal(response.cookies.refresh_token, undefined);
		}
		assert.equal((await refresh(login.cookies.refresh_token)).http, 200); // THE SESSION IS STILL GOOD
	});

	test("resume answers 503 on a 404 from the data service, not the login page", async () => {
		player("alice");
		const login = await logIn(alice);
		dataServiceWillAnswer("/session/refresh", 404, "No such action");
		const resumed = await send("GET", "/api/auth/resume?returnTo=%2Fplay%2Fgame1", { refresh_token: login.cookies.refresh_token });
		assert.equal(resumed.http, 503);
		assert.equal(resumed.location, null); // NOT SENT TO LOGIN
	});

	test("a 401 from the data service's refresh still clears the cookies", async () => {
		player("alice");
		const login = await logIn(alice);
		dataServiceWillAnswer("/session/refresh", 401, "Session ended");
		const response = await refresh(login.cookies.refresh_token);
		assert.equal(response.http, 401);
		assert.deepEqual([response.cookies.access_token, response.cookies.refresh_token], ["", ""]);
	});

	test("Delete my data ends the session", async () => {
		player("alice");
		const login = await logIn(alice);
		assert.equal((await send("DELETE", "/api/user", { access_token: login.cookies.access_token })).body.status, 200);
		assert.equal((await refresh(login.cookies.refresh_token)).http, 401);
	});
});

/* ---------------------------------------------------------------- */
// Tokens
/* ---------------------------------------------------------------- */

describe("only tokens the data service signed", () => {
	test("another key's, an HS256 (even with the public key as its secret), a none or an expired token is refused", async () => {
		const tokens = [
			keys.sessionToken(alice.user, { key: "stranger" }),
			keys.sessionToken(alice.user, { key: "old" }), // THE DATA SERVICE'S OLD KEY ISN'T THE SERVER'S
			keys.sessionToken(alice.user, { algorithm: "HS256" }),
			keys.sessionToken(alice.user, { algorithm: "HS256", secret: "test-jwt-secret" }), // A COOKIE FROM BEFORE #252
			keys.sessionToken(alice.user, { algorithm: "none" }),
			keys.sessionToken(alice.user, { expired: true }),
			keys.tamper(keys.sessionToken(player("mallory").user), { user: alice.user }),
			keys.sessionToken(alice.user, { type: "refresh" }),
			keys.guestToken("game1")
		];
		for (const token of tokens) {
			const response = await me(token);
			assert.equal(response.http, 401);
			assert.equal(response.body.message, "SESSION EXPIRED");
			assert.equal(readSessionUser({ cookies: { access_token: token } }), null);
		}
		assert.equal((await me(keys.sessionToken(alice.user))).http, 200);
	});

	test("while the key is being changed, a token signed with the next key is read too", () => {
		assert.equal(readSessionUser({ cookies: { access_token: keys.sessionToken(alice.user, { key: "next" }) } }).user_id, "auth0|alice"); // SESSION_PUBLIC_KEY_NEXT
	});

	test("a refresh cookie from before #252 signs the player out", async () => {
		const response = await refresh(keys.sessionToken(alice.user, { type: "refresh", algorithm: "HS256", secret: "test-jwt-secret" }));
		assert.equal(response.http, 401);
		assert.equal(response.body.message, "SESSION EXPIRED");
	});

	test("a guest cookie from before #252 gets a new game, not a refusal", async () => {
		const response = await call("POST", "/api/chess/game", { cookie: `guest_game=session.guest1.${"x".repeat(43)}`, body: { game_id: "guest1", start_color: "w" } });
		assert.equal(response.status, 200);
		assert.ok(response.game_id);
	});
});
