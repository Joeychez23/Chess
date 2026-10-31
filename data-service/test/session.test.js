/*
 *  session.test.js  --  data service tests
 *	Session Routes (controllers/sessionController.js, #252)
 *  Only an id_token Auth0 signed, for our tenant & client, fresh & used once, for the user the chess server found, starts a session.
 *  A refresh only works while the session id on the player's row is unchanged (logout & Delete my data end it on every device),
 *  and a guest's token is only signed for the game the data service just made them
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const service = require("./helpers/service.js");
const { call, player, sessionToken, guestCookie, peek } = service;
const { idToken, tamper } = require("./helpers/keys.js");

let server;
before(async () => { server = await service.start(); });
after(() => server.close());
beforeEach(() => service.reset());

const alice = player("alice");
const bob = player("bob");

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

const aliceIdToken = (claims, options) => idToken({ sub: alice.user.user_id, email: alice.user.email, ...claims }, options);
const login = (token, user = alice.user) => call("POST", "/session/login", { body: { id_token: token, user } });
const refresh = (refreshToken) => call("POST", "/session/refresh", { body: { refresh_token: refreshToken } });
const logout = (refreshToken) => call("POST", "/session/logout", { body: { refresh_token: refreshToken } });
const payload = (token) => jwt.decode(token);

/**
 * @description A login that must be refused, nothing is saved
 */
async function refusedLogin(token, user, reason) {
	const response = await login(token, user);
	assert.equal(response.http, 401, response.message);
	assert.match(response.message, reason);
	assert.equal(response.access_token, undefined);
	assert.equal(peek("user_db", "alice"), undefined, "a refused login made a row");
}

/* ---------------------------------------------------------------- */
// Login
/* ---------------------------------------------------------------- */

describe("POST /session/login", () => {
	test("Auth0's id_token for the user signs an access & refresh token, and the access token acts for them", async () => {
		const response = await login(aliceIdToken());
		assert.equal(response.status, 200);
		const access = payload(response.access_token);
		assert.equal(jwt.decode(response.access_token, { complete: true }).header.alg, "ES256");
		assert.deepEqual([access.type, access.user.user_id, access.user.email, access.user.email_verified], ["access", "auth0|alice", "alice@test", true]);
		assert.equal(access.user.user_metadata.screenname, "Alice");
		assert.equal(payload(response.refresh_token).type, "refresh");
		assert.equal(access.sid, peek("user_db", "alice").sid.S); // THE ROW IS MADE AT THE FIRST LOGIN, WITH ITS SESSION ID
		assert.equal(payload(response.refresh_token).sid, access.sid);

		const me = await call("GET", "/users/me", { token: response.access_token });
		assert.equal(me.status, 200);
		assert.equal(me.user_data.sid, undefined); // THE SESSION ID NEVER LEAVES THIS SERVICE
		assert.equal((await call("GET", "/users/me?games=true", { token: response.access_token })).user_data.sid, undefined);
		assert.equal((await call("POST", "/users/me/settings", { token: response.access_token, body: { ai_level: 3, ai_color: "w", friend_color: "b" } })).user_data.sid, undefined);
	});

	test("a second device shares the session, a game list on the row is untouched", async () => {
		const first = await login(aliceIdToken());
		const second = await login(aliceIdToken()); // ANOTHER LOGIN
		assert.equal(payload(second.access_token).sid, payload(first.access_token).sid);
		assert.equal(peek("user_db", "alice").open_games.S, "[]");
	});

	test("only the fields the game reads go in the tokens", async () => {
		const user = { ...alice.user, email_verified: true, app_metadata: { admin: true }, user_metadata: { screenname: "Alice", first_name: 7, role: "admin" } };
		const access = payload((await login(aliceIdToken({ email_verified: false }), user)).access_token);
		assert.deepEqual(Object.keys(access.user).sort(), ["email", "email_verified", "user_id", "user_metadata"]);
		assert.deepEqual(access.user.user_metadata, { screenname: "Alice" });
		assert.equal(access.user.email_verified, false); // FROM THE CHECKED id_token, NOT THE CHESS SERVER
	});

	test("a forged id_token gets no session: another key, an unknown key, another client or tenant, expired", async () => {
		await refusedLogin(aliceIdToken({}, { forged: true }), alice.user, /invalid signature/);
		await refusedLogin(aliceIdToken({}, { kid: "another-key" }), alice.user, /unknown key/);
		await refusedLogin(aliceIdToken({ aud: "another-client" }), alice.user, /^Bad id token: jwt audience invalid$/);
		await refusedLogin(aliceIdToken({ iss: "https://another.auth0.test/" }), alice.user, /^Bad id token: jwt issuer invalid$/);
		await refusedLogin(aliceIdToken({ iat: Math.floor(Date.now() / 1000) - 11 * 60 * 60, exp: Math.floor(Date.now() / 1000) - 60 * 60 }), alice.user, /jwt expired/);
		await refusedLogin("not-a-token", alice.user, /unknown key/);
	});

	test("an id_token is used once, and only within 5 minutes", async () => {
		const token = aliceIdToken();
		assert.equal((await login(token)).status, 200);
		const replay = await login(token);
		assert.equal(replay.http, 401);
		assert.match(replay.message, /already used/);

		service.reset();
		await refusedLogin(aliceIdToken({ iat: Math.floor(Date.now() / 1000) - 6 * 60 }), alice.user, /maxAge exceeded/); // KEPT & REPLAYED LATER
	});

	test("the user must be the one the id_token names, on our connection", async () => {
		await refusedLogin(aliceIdToken(), bob.user, /not this user/);
		await refusedLogin(aliceIdToken(), { ...alice.user, email: "mallory@test" }, /not this email/);
		await refusedLogin(idToken({ sub: "google-oauth2|alice", email: "alice@test" }), { ...alice.user, user_id: "google-oauth2|alice" }, /not this user/); // A SOCIAL LOGIN WITH THE SAME EMAIL
		assert.equal((await login(aliceIdToken({ email: "ALICE@test" }))).status, 200); // AN EMAIL'S CAPITALS DON'T MATTER
	});

	test("a body without the id_token & user, or with more, is refused", async () => {
		assert.equal((await call("POST", "/session/login", { body: { user: alice.user } })).http, 400);
		assert.equal((await call("POST", "/session/login", { body: { id_token: aliceIdToken() } })).http, 400);
		assert.equal((await call("POST", "/session/login", { body: { id_token: aliceIdToken(), user: alice.user, sid: "mine" } })).http, 400);
		assert.equal(peek("user_db", "alice"), undefined);
	});
});

/* ---------------------------------------------------------------- */
// Refresh & Logout
/* ---------------------------------------------------------------- */

describe("POST /session/refresh & /session/logout", () => {
	test("a refresh token gets a new pair for the same user & session", async () => {
		const session = await login(aliceIdToken());
		const response = await refresh(session.refresh_token);
		assert.equal(response.status, 200);
		assert.equal(payload(response.access_token).user.user_id, "auth0|alice");
		assert.equal(payload(response.refresh_token).sid, payload(session.refresh_token).sid);
	});

	test("after logout no device can refresh, and the next login is a new session", async () => {
		const phone = await login(aliceIdToken());
		const laptop = await login(aliceIdToken());
		assert.equal((await logout(phone.refresh_token)).status, 200);
		assert.equal(peek("user_db", "alice").sid, undefined);
		assert.equal((await refresh(phone.refresh_token)).message, "Session ended");
		assert.equal((await refresh(laptop.refresh_token)).http, 401); // SIGNED OUT EVERYWHERE

		const again = await login(aliceIdToken());
		assert.notEqual(payload(again.refresh_token).sid, payload(phone.refresh_token).sid);
		assert.equal((await refresh(phone.refresh_token)).http, 401); // THE OLD SESSION STAYS ENDED
		assert.equal((await logout(phone.refresh_token)).status, 200); // & ITS LOGOUT DOESN'T END THE NEW ONE
		assert.equal((await refresh(again.refresh_token)).status, 200);
	});

	test("Delete my data ends the session", async () => {
		const session = await login(aliceIdToken());
		assert.equal((await call("POST", "/users/me/delete", { token: session.access_token })).status, 200);
		assert.equal((await refresh(session.refresh_token)).http, 401);
	});

	test("after logout an access token already out is refused on every device (#277)", async () => {
		const phone = await login(aliceIdToken());
		const laptop = await login(aliceIdToken());
		assert.equal((await call("GET", "/users/me", { token: laptop.access_token })).status, 200);
		await logout(phone.refresh_token);
		for (const token of [phone.access_token, laptop.access_token]) {
			const response = await call("GET", "/users/me", { token });
			assert.equal(response.http, 401);
			assert.equal(response.message, "Session ended");
		}
		const again = await login(aliceIdToken());
		assert.equal((await call("GET", "/users/me", { token: phone.access_token })).http, 401); // NOR AFTER THE NEXT LOGIN, A NEW SESSION
		assert.equal((await call("GET", "/users/me", { token: again.access_token })).status, 200);
	});

	test("after Delete my data the old access token can't make a game, and no row comes back (#277)", async () => {
		const session = await login(aliceIdToken());
		assert.equal((await call("POST", "/users/me/delete", { token: session.access_token })).status, 200);
		const response = await call("POST", "/games/ai", { token: session.access_token, body: { color: "w", level: 3 } });
		assert.equal(response.http, 401);
		assert.equal(response.message, "Session ended");
		assert.equal(peek("user_db", "alice"), undefined);
	});

	test("only a refresh token this service signed: an access token, a changed one, another key's or HS256 is refused", async () => {
		const session = await login(aliceIdToken());
		const sid = payload(session.refresh_token).sid;
		for (const token of [session.access_token, tamper(session.refresh_token, { user: bob.user }), sessionToken(alice.user, { type: "refresh", sid, key: "stranger" }),
			sessionToken(alice.user, { type: "refresh", sid, algorithm: "HS256" }), sessionToken(alice.user, { type: "refresh", sid, expired: true }), guestCookie("game1"), "", undefined]) {
			const response = await refresh(token);
			assert.equal(response.http, 401);
			assert.equal(response.message, "Bad refresh token");
		}
		assert.equal((await logout(session.access_token)).http, 401);
		assert.equal(peek("user_db", "alice").sid.S, sid);
	});

	test("while the key is being changed, a refresh token signed with the old key still refreshes, with the new key", async () => {
		const session = await login(aliceIdToken());
		const kid = (token) => jwt.decode(token, { complete: true }).header.kid;
		const oldToken = sessionToken(alice.user, { type: "refresh", sid: payload(session.refresh_token).sid, key: "old" });
		const response = await refresh(oldToken);
		assert.equal(response.status, 200);
		assert.notEqual(kid(oldToken), kid(session.refresh_token));
		assert.equal(kid(response.refresh_token), kid(session.refresh_token)); // THE NEW PAIR IS SIGNED WITH THE CURRENT KEY
	});
});

/* ---------------------------------------------------------------- */
// Guest Tokens
/* ---------------------------------------------------------------- */

describe("guest tokens", () => {
	test("a new guest game comes with a token for that game only", async () => {
		const response = await call("POST", "/games/guest", { body: { game_id: "guest1", color: "w" } });
		const token = payload(response.guest_token);
		assert.deepEqual([token.type, token.game_id], ["guest", "guest1"]);
		assert.equal((await call("GET", "/games/guest1", { cookie: response.guest_token })).status, 200);

		await call("POST", "/games/guest", { body: { game_id: "guest2", color: "w" } });
		assert.equal((await call("GET", "/games/guest2", { cookie: response.guest_token })).http, 403);
		assert.equal((await call("GET", "/games/guest2", { cookie: tamper(response.guest_token, { game_id: "guest2" }) })).http, 401);
	});

	test("the guest's session id stays the same from game to game", async () => {
		const first = await call("POST", "/games/guest", { body: { game_id: "guest1", color: "w" } });
		const second = await call("POST", "/games/guest", { cookie: first.guest_token, body: { color: "w" } });
		assert.notEqual(payload(second.guest_token).game_id, "guest1");
		assert.equal(payload(second.guest_token).session, payload(first.guest_token).session);
		assert.notEqual(payload((await call("POST", "/games/guest", { body: { color: "w" } })).guest_token).session, payload(first.guest_token).session); // A NEW BROWSER
	});

	test("an id that isn't the guest's gets its token for the new id, not the one asked for", async () => {
		await call("POST", "/games/guest", { body: { game_id: "guest1", color: "w" } });
		const other = await call("POST", "/games/guest", { body: { game_id: "guest1", color: "w" } }); // ANOTHER BROWSER ASKING FOR guest1
		assert.notEqual(other.game_data.game_id.S, "guest1");
		assert.equal(payload(other.guest_token).game_id, other.game_data.game_id.S);
	});
});
