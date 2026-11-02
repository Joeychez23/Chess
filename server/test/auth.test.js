/*
 *  auth.test.js  --  chess server tests
 *	Signing In & Session Tokens (controllers/authController.js, middleware/auth.js, password login #223, signup #225, #252, only a 401 signs out #283, a failed login says why #282)
 *  The server can't make a session: the login callback passes Auth0's id_token to the data service, which checks it & signs the tokens.
 *  The server only checks tokens with the public key, so a token signed any other way is refused. Logout ends the session on every device
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const { call, send, page, player, peek, auth0WillSign, auth0WillBlock, auth0WillStall, auth0Logins, auth0Signups, dataServiceWillAnswer } = testServer;
const keys = require("../../data-service/test/helpers/keys.js");
const config = require("../config");
const { readSessionUser } = require("../middleware/auth.js");
const { LOGIN_LIMITS, SIGNUP_LIMITS } = require("../middleware/rateLimit.js");

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

const loginFailed = (reason) => new URL(`/?login=${reason}`, config.clientUrl).href; // WHERE A FAILED CALLBACK GOES (#282)
const me = (accessToken) => send("GET", "/api/user", { access_token: accessToken });
const refresh = (refreshToken) => send("POST", "/api/auth/refresh", { refresh_token: refreshToken });
const loginHeaders = (ip = "203.0.113.5", origin = new URL(config.clientUrl).origin) => ({ "Content-Type": "application/json", Origin: origin, "X-Forwarded-For": ip });
const logOut = (refreshToken, headers = { Origin: new URL(config.clientUrl).origin, "Sec-Fetch-Site": "same-origin" }) => send("POST", "/api/auth/logout", { refresh_token: refreshToken }, { headers });
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
			assert.equal(login.location, loginFailed("failed"));
			assert.deepEqual(login.cookies, { auth_state: "", auth_return: "" }); // ONLY THE LOGIN COOKIES ARE CLEARED
		}
		assert.equal(peek("user_db", "alice"), undefined);
	});

	test("a login the state doesn't match never reaches the data service", async () => {
		player("alice");
		const login = await send("GET", `/api/auth/callback?code=alice%40test&state=other`, { auth_state: "state1" });
		assert.equal(login.location, loginFailed("failed"));
		assert.equal(login.cookies.access_token, undefined);
	});

	test("a login with the data service down lands Home with the unavailable reason & logs an error", async (t) => {
		player("alice");
		const errors = t.mock.method(console, "error", () => {});
		dataServiceWillAnswer("/session/login", 503, "Down");
		const login = await logIn(alice);
		assert.equal(login.location, loginFailed("unavailable"));
		assert.equal(login.cookies.access_token, undefined);
		assert.match(String(errors.mock.calls[0].arguments[0]), /POST \/session\/login: 503/);
	});

	test("an id_token with a key the data service doesn't know lands with the failed reason & logs an error", async (t) => {
		player("alice");
		const errors = t.mock.method(console, "error", () => {});
		auth0WillSign((claims) => keys.idToken(claims, { kid: "another-key" }));
		const login = await logIn(alice);
		assert.equal(login.location, loginFailed("failed"));
		assert.match(String(errors.mock.calls[0].arguments[0]), /unknown key/);
	});
});

/* ---------------------------------------------------------------- */
// Auth0 Stalls (#365)
/* ---------------------------------------------------------------- */

test("with Auth0 not answering, a login & an invite say try again within about 5 seconds", async (t) => {
	const alice = player("alice");
	const bob = player("bob");
	const errors = t.mock.method(console, "error", () => {});
	auth0WillStall("/oauth/token", "authorization_code");
	auth0WillStall("/oauth/token", "http://auth0.com/oauth/grant-type/password-realm");
	auth0WillStall("/api/v2/users-by-email");

	const started = Date.now();
	const [callback, password, invite] = await Promise.all([
		logIn(alice),
		passwordLogin({ email: alice.email, password: alice.password }),
		call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email } })
	]);
	const took = Date.now() - started;

	assert.equal(callback.location, loginFailed("unavailable"));
	assert.equal(password.http, 503);
	assert.equal(password.body.message, "Try again in a moment");
	assert.equal(invite.http, 503);
	assert.equal(invite.message, "Try again in a moment");
	assert.ok(took >= 4500 && took < 6000, `took ${took}ms`);
	assert.equal(auth0Logins().length, 0); // THE STALLED LOGIN WASN'T TRIED AGAIN

	const logged = errors.mock.calls.map((call) => String(call.arguments[0])).join("\n");
	assert.match(logged, /Auth0: code exchange: no answer in 5 seconds/);
	assert.match(logged, /Auth0: password login: no answer in 5 seconds/);
	assert.match(logged, /Auth0: user search: no answer in 5 seconds/);
	assert.ok(!logged.includes(alice.email) && !logged.includes(bob.email) && !logged.includes(alice.password));
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
// Signup
/* ---------------------------------------------------------------- */

describe("signup", () => {
	const newPlayer = (changes = {}) => ({ email: "newbie@test", password: "a-long-password", screenname: "Newbie", first_name: "New", last_name: "Player", ...changes });
	const signup = (body, options = {}) => send("POST", "/api/auth/signup", {}, { headers: { ...loginHeaders(options.ip, options.origin), ...options.headers }, body: JSON.stringify(body) });

	test("a new account is signed in with its screenname, unverified, & its username is claimed", async () => {
		const response = await signup({ ...newPlayer(), returnTo: "/play/game1" });
		assert.equal(response.http, 200);
		assert.equal(response.body.returnTo, "/play/game1");
		assert.deepEqual(auth0Signups()[0], { client_id: process.env.AUTH0_CLIENT_ID, connection: process.env.AUTH0_CONNECTION, email: "newbie@test", password: "a-long-password", user_metadata: { screenname: "Newbie", first_name: "New", last_name: "Player" } });

		const user = await me(response.cookies.access_token);
		assert.equal(user.body.userData.user_metadata.screenname, "Newbie");
		assert.equal(user.body.userData.email_verified, false);
		assert.equal(user.body.username, "Newbie");
	});

	test("a username someone has still makes the account, the settings page asks for another", async () => {
		const first = await signup(newPlayer({ email: "first@test" }));
		assert.equal(first.http, 200);
		const second = await signup(newPlayer({ email: "second@test" }));
		assert.equal(second.http, 200);
		assert.equal((await me(second.cookies.access_token)).body.username, null);
	});

	test("a taken email is told to sign in or reset & gets no session", async () => {
		const alice = player("alice");
		const response = await signup(newPlayer({ email: alice.email }));
		assert.equal(response.http, 400);
		assert.equal(response.body.message, "Couldn't create that account. If it's yours, sign in or reset the password.");
		assert.equal(response.cookies.access_token, undefined);
	});

	test("a weak password passes on Auth0's message", async () => {
		const response = await signup(newPlayer({ password: "weak" }));
		assert.equal(response.http, 400);
		assert.equal(response.body.message, "Password is too weak");
		assert.equal(auth0Logins().length, 0);
	});

	test("an account made while sign in is down says to sign in, without a session", async (t) => {
		t.mock.method(console, "error", () => {});
		dataServiceWillAnswer("/session/login", 503, "Down");
		const response = await signup(newPlayer());
		assert.equal(response.http, 202);
		assert.equal(response.cookies.access_token, undefined);
		assert.equal((await passwordLogin({ email: "newbie@test", password: "a-long-password" })).http, 200); // THE ACCOUNT IS THERE
	});

	test("the address & email limits refuse before Auth0 is asked", async () => {
		for (let i = 0; i < SIGNUP_LIMITS.signupIp.burst; i++) {
			await signup(newPlayer({ email: `user${i}@test`, screenname: `user${i}` }), { ip: "198.51.100.10" });
		}
		const beforeIp = auth0Signups().length;
		const ipLimited = await signup(newPlayer({ email: "other@test" }), { ip: "198.51.100.10" });
		assert.equal(ipLimited.http, 429);
		assert.ok(Number(ipLimited.retry_after) > 0);
		assert.equal(auth0Signups().length, beforeIp);

		testServer.reset();
		for (let i = 0; i < SIGNUP_LIMITS.signupEmail.burst; i++) {
			await signup(newPlayer({ email: "Same@Test", password: "weak" }), { ip: `198.51.100.${i + 1}` });
		}
		const beforeEmail = auth0Signups().length;
		assert.equal((await signup(newPlayer({ email: "same@test", password: "weak" }), { ip: "203.0.113.10" })).http, 429);
		assert.equal(auth0Signups().length, beforeEmail);
	});

	test("requires same-origin JSON & fields the screen asks for, checked before Auth0", async () => {
		assert.equal((await signup(newPlayer(), { origin: "https://wrong.test" })).http, 403);
		assert.equal((await signup(newPlayer(), { headers: { "Sec-Fetch-Site": "cross-site" } })).http, 403);
		const form = await send("POST", "/api/auth/signup", {}, { headers: { ...loginHeaders(), "Content-Type": "application/x-www-form-urlencoded" }, body: "email=a@test&password=x" });
		assert.equal(form.http, 403);
		for (const changes of [{ email: 1 }, { email: "no-at-sign" }, { password: "" }, { first_name: "" }, { last_name: 1 }, { first_name: "x".repeat(500) }, { screenname: "ab" }, { screenname: "has space" }, { screenname: "admin" }, { screenname: 1 }]) {
			assert.equal((await signup(newPlayer(changes))).http, 400, JSON.stringify(changes));
		}
		assert.equal(auth0Signups().length, 0);
	});
});

/* ---------------------------------------------------------------- */
// Refresh, Resume & Logout
/* ---------------------------------------------------------------- */

describe("login page", () => {
	test("sends a signed in player to returnTo or Home, only on this site", async () => {
		const signedIn = { as: player("alice") };
		assert.equal((await page("/login?returnTo=%2Fplay%2Fgame1", signedIn)).location, "/play/game1");
		assert.equal((await page("/login", signedIn)).location, "/");
		assert.equal((await page("/login?returnTo=%2F%2Fother.site", signedIn)).location, "/");
	});

	test("stays on the page for a signed out player", async () => {
		assert.equal((await page("/login?returnTo=%2Fplay%2Fgame1")).location, null);
	});
});

describe("signup page", () => {
	test("sends a signed in player to returnTo or Home, only on this site", async () => {
		const signedIn = { as: player("alice") };
		assert.equal((await page("/signup?returnTo=%2Fplay%2Fgame1", signedIn)).location, "/play/game1");
		assert.equal((await page("/signup", signedIn)).location, "/");
		assert.equal((await page("/signup?returnTo=%2F%2Fother.site", signedIn)).location, "/");
	});

	test("stays on the page for a signed out player", async () => {
		assert.equal((await page("/signup?returnTo=%2Fplay%2Fgame1")).location, null);
	});
});

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
		assert.equal((await send("GET", "/api/auth/resume?returnTo=%2Fplay%2Fgame1")).location, "/login?returnTo=%2Fplay%2Fgame1");
	});

	test("after logout, refresh fails on every device", async () => {
		player("alice");
		const phone = await logIn(alice);
		const laptop = await logIn(alice);
		const logout = await logOut(phone.cookies.refresh_token);
		assert.equal(logout.http, 200);
		assert.match(logout.body.logoutUrl, /^https:\/\/auth0\.test\/v2\/logout/);
		assert.deepEqual([logout.cookies.access_token, logout.cookies.refresh_token], ["", ""]);

		for (const device of [phone, laptop]) {
			const response = await refresh(device.cookies.refresh_token);
			assert.equal(response.http, 401);
			assert.equal(response.cookies.refresh_token, ""); // CLEARED
		}
		assert.equal((await send("GET", "/api/auth/resume?returnTo=%2F", { refresh_token: laptop.cookies.refresh_token })).location, "/login?returnTo=%2F");
	});

	test("logout from another site, or by a link, is refused & the session stays on every device (#297)", async () => {
		player("alice");
		const login = await logIn(alice);
		const ours = new URL(config.clientUrl).origin;
		for (const headers of [{}, { Origin: "https://evil.test" }, { Origin: "https://evil.test", "Sec-Fetch-Site": "cross-site" }, { Origin: ours, "Sec-Fetch-Site": "cross-site" }]) {
			const logout = await logOut(login.cookies.refresh_token, headers);
			assert.equal(logout.http, 403);
			assert.equal(logout.cookies.refresh_token, undefined); // NOT CLEARED
		}
		assert.equal((await send("GET", "/api/auth/logout", { refresh_token: login.cookies.refresh_token })).http, 404); // A GET NO LONGER SIGNS OUT
		assert.equal((await refresh(login.cookies.refresh_token)).http, 200);
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
