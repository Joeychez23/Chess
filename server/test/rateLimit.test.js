/*
 *  rateLimit.test.js  --  chess server tests
 *	Guest Cookies & New Game & Login Limits (server/middleware/auth.js, server/middleware/rateLimit.js)
 *  A guest's game only answers the browser that made it, and making games in a loop is cut off with a 429 while moves go on
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const { call, player, peek } = testServer;
const { takeTokens, ipKey, resetLimits, LIMITS, LOGIN_LIMITS, AI_MOVE_LIMITS } = require("../middleware/rateLimit.js");
const { guestToken } = require("../../data-service/test/helpers/keys.js");

let server;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => testServer.reset());

const newGuestGame = (gameId, options = {}) => call("POST", "/api/chess/game", { ...options, body: { game_id: gameId, start_color: "w" } });

/**
 * @description A guest_game cookie signed like the data service signs it, for a game id newGame no longer hands out
 * (a cookie the live site signed before guests were kept to their own game)
 */
function signedGuestCookie(gameId) {
	return `guest_game=${guestToken(gameId, { session: "session" })}`;
}

/* ---------------------------------------------------------------- */
// Guest Cookies
/* ---------------------------------------------------------------- */

describe("a guest's game only answers the browser that made it", () => {
	test("another browser can't load it, move in it, ask for the AI's move or restart it", async () => {
		assert.equal((await newGuestGame("guest1")).status, 200);
		const other = { guest: "other" };
		assert.equal((await call("GET", "/api/chess/game/guest1", other)).http, 401);
		assert.equal((await call("PUT", "/api/chess/game/guest1", { ...other, body: { move: ["e2", "e4"] } })).http, 401);
		assert.equal((await call("POST", "/api/chess/game/guest1/ai-move", other)).http, 401);
		assert.equal((await call("POST", "/api/chess/game/guest1/restart", other)).http, 401);

		assert.equal((await call("GET", "/api/chess/game/guest1")).status, 200); // THE BROWSER THAT MADE IT
		assert.equal((await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } })).status, 200);
	});

	test("another browser asking for that game id gets a new game, the first one isn't reset", async () => {
		await newGuestGame("guest1");
		await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } });

		const other = await newGuestGame("guest1", { guest: "other" }); // ITS localStorage HAS guest1 (OR A GUEST FROM BEFORE THE COOKIE)
		assert.equal(other.status, 200);
		assert.notEqual(other.game_id, "guest1");
		assert.equal((await call("GET", `/api/chess/game/${other.game_id}`, { guest: "other" })).status, 200);
		assert.deepEqual(JSON.parse(peek("chess_db", "guest1").moves.S), ["e4"]);
	});

	test("the guest can still reset their own game (New game on the guest page)", async () => {
		await newGuestGame("guest1");
		await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } });
		const reset = await newGuestGame("guest1");
		assert.equal(reset.game_id, "guest1");
		assert.deepEqual(JSON.parse(peek("chess_db", "guest1").moves.S), []);
	});

	test("a cookie that was changed or made up isn't accepted", async () => {
		await newGuestGame("guest1");
		for (const cookie of ["guest_game=guest1", "guest_game=abc.guest1.made-up", "guest_game=.guest1.", "guest_game=x"]) {
			assert.equal((await call("GET", "/api/chess/game/guest1", { cookie })).http, 401, cookie);
		}
	});

	test("a guest whose game id is CHESS_AI or a player's id can't touch that player's AI game", async () => {
		const alice = player("alice");
		const aliceGame = (await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w", ai_level: 3 } })).game_id;
		await call("PUT", `/api/chess/game/${aliceGame}`, { as: alice, body: { move: ["e2", "e4"] } });
		const before = peek("chess_db", aliceGame);

		assert.equal((await newGuestGame("alice", { guest: "eve" })).game_id, "alice"); // EVE'S PLAYER ID IS ALICE'S
		const guests = [{ guest: "eve" }, { cookie: signedGuestCookie("CHESS_AI") }];
		for (const guest of guests) {
			assert.equal((await call("GET", `/api/chess/game/${aliceGame}`, guest)).http, 401);
			assert.equal((await call("PUT", `/api/chess/game/${aliceGame}`, { ...guest, body: { move: ["e7", "e5"] } })).http, 401);
			assert.equal((await call("POST", `/api/chess/game/${aliceGame}/ai-move`, guest)).http, 401);
			assert.equal((await call("POST", `/api/chess/game/${aliceGame}/restart`, guest)).http, 401);
			assert.equal((await call("GET", `/api/chess/game/${aliceGame}/ratings`, guest)).http, 401);
			assert.notEqual((await call("POST", "/api/chess/game", { ...guest, body: { game_id: aliceGame, start_color: "w" } })).game_id, aliceGame); // A NEW GAME, ALICE'S ISN'T RESET
		}
		assert.deepEqual(peek("chess_db", aliceGame), before);
		assert.equal((await call("GET", `/api/chess/game/${aliceGame}`, { as: alice })).player_color, "w");
	});

	test("a guest can't make a game with the AI's id", async () => {
		const made = await newGuestGame("CHESS_AI", { guest: "mallory" });
		assert.equal(made.status, 200);
		assert.notEqual(made.game_id, "CHESS_AI");
		assert.equal(peek("chess_db", "CHESS_AI"), undefined);
		assert.equal((await call("GET", `/api/chess/game/${made.game_id}`, { guest: "mallory" })).status, 200); // THE NEW ID PLAYS AS USUAL
	});
});

/* ---------------------------------------------------------------- */
// New Game Limits
/* ---------------------------------------------------------------- */

describe("new game limits", () => {
	test("one browser making games in a loop is cut off with a 429, and its game still plays", async () => {
		for (let i = 0; i <= LIMITS.session.burst; i++) { assert.equal((await newGuestGame(`guest${i}`)).status, 200, `game ${i}`); } // A NEW ID EACH TIME, THE SAME BROWSER. THE FIRST IS MADE BEFORE IT HAS THE COOKIE, SO burst + 1
		const limited = await newGuestGame("one-more");
		assert.equal(limited.http, 429);
		assert.equal(limited.status, 429);
		assert.match(limited.message, /^Too many new games, try again in \d+ seconds?$/);
		assert.ok(Number(limited.retry_after) > 0 && Number(limited.retry_after) <= 60);
		assert.equal(peek("chess_db", "one-more"), undefined);

		const lastGame = `guest${LIMITS.session.burst}`;
		assert.equal((await call("PUT", `/api/chess/game/${lastGame}`, { body: { move: ["e2", "e4"] } })).status, 200); // MOVES AREN'T LIMITED
		assert.equal((await newGuestGame("other-browser", { guest: "other" })).status, 200); // ANOTHER BROWSER ON THE SAME IP STILL CAN
	});

	test("browsers on one IP share its limit, other IPs aren't affected", async () => {
		const ip = "203.0.113.5";
		for (let i = 0; i < LIMITS.ip.burst; i++) { assert.equal((await newGuestGame(`guest${i}`, { guest: `browser${i}`, ip })).status, 200); } // A NEW BROWSER (NO COOKIE) EACH TIME
		assert.equal((await newGuestGame("one-more", { guest: "fresh", ip })).http, 429);
		assert.equal((await newGuestGame("elsewhere", { guest: "fresh", ip: "198.51.100.7" })).status, 200);
	});

	test("the whole site has a limit too", async () => {
		for (let i = 0; i < LIMITS.site.burst; i++) { assert.equal((await newGuestGame(`guest${i}`, { guest: `browser${i}`, ip: `198.51.100.${i}` })).status, 200); }
		assert.equal((await newGuestGame("one-more", { guest: "fresh", ip: "192.0.2.1" })).http, 429);
	});

	test("a signed-in player restarting in a loop is cut off before the game is forfeited", async () => {
		const alice = player("alice");
		let game = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
		for (let i = 1; i < LIMITS.session.burst; i++) {
			game = await call("POST", `/api/chess/game/${game.game_id}/restart`, { as: alice });
			assert.equal(game.status, 200);
		}
		const limited = await call("POST", `/api/chess/game/${game.game_id}/restart`, { as: alice });
		assert.equal(limited.http, 429);
		assert.equal(peek("chess_db", game.game_id).state.S, "OPEN"); // NOT FORFEITED
	});

	test("invites count as new games", async () => {
		const alice = player("alice");
		const bob = player("bob");
		for (let i = 0; i < LIMITS.session.burst; i++) {
			assert.equal((await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email } })).status, 200);
		}
		assert.equal((await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email } })).http, 429);
	});

	test("the first refusal for a key is logged, then once a minute", async (t) => {
		const log = t.mock.method(console, "log", () => { });
		for (let i = 0; i <= LIMITS.session.burst; i++) { await newGuestGame(`guest${i}`); }
		for (let i = 0; i < 3; i++) { assert.equal((await newGuestGame("one-more")).http, 429); }
		const lines = log.mock.calls.map((call) => call.arguments[0]).filter((line) => /^New game limit/.test(line));
		assert.equal(lines.length, 1);
		assert.match(lines[0], /^New game limit \(session: guest:.+\) POST \/api\/chess\/game, retry in \d+s$/);
	});
});

/* ---------------------------------------------------------------- */
// AI Move Limits
/* ---------------------------------------------------------------- */

describe("AI move limits", () => {
	test("one browser asking for the AI's move in a loop is cut off with a 429, and its moves still go through", async () => {
		await newGuestGame("guest1");
		await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } });
		for (let i = 0; i < AI_MOVE_LIMITS.aiMoveSession.burst; i++) { assert.equal((await call("POST", "/api/chess/game/guest1/ai-move")).status, 200, `request ${i}`); }

		const limited = await call("POST", "/api/chess/game/guest1/ai-move");
		assert.equal(limited.http, 429);
		assert.match(limited.message, /^Too many AI move requests, try again in \d+ seconds?$/);
		assert.ok(Number(limited.retry_after) > 0);
		assert.equal((await call("PUT", "/api/chess/game/guest1", { body: { move: ["d2", "d4"] } })).status, 200); // MOVES AREN'T LIMITED
	});

	test("AI moves don't use up new games", async () => {
		await newGuestGame("guest1");
		await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } });
		for (let i = 0; i < AI_MOVE_LIMITS.aiMoveSession.burst; i++) { await call("POST", "/api/chess/game/guest1/ai-move"); }
		assert.equal((await newGuestGame("guest1")).status, 200);
	});
});

/* ---------------------------------------------------------------- */
// Buckets
/* ---------------------------------------------------------------- */

describe("buckets", () => {
	beforeEach(() => resetLimits());
	const keys = { session: "s", ip: "i", site: "all" };

	test("a burst, then one more each time a token comes back", () => {
		for (let i = 0; i < LIMITS.session.burst; i++) { assert.equal(takeTokens(keys, 0).ok, true); }
		const refused = takeTokens(keys, 0);
		assert.deepEqual([refused.ok, refused.limit, refused.retryMs], [false, "session", LIMITS.session.refillMs]);
		assert.equal(takeTokens(keys, LIMITS.session.refillMs / 2).retryMs, LIMITS.session.refillMs / 2);
		assert.equal(takeTokens(keys, LIMITS.session.refillMs).ok, true);
		assert.equal(takeTokens(keys, LIMITS.session.refillMs).ok, false);
	});

	test("a refused request takes nothing from the other limits", () => {
		for (let i = 0; i < LIMITS.session.burst + 5; i++) { takeTokens(keys, 0); } // 5 REFUSED
		const left = LIMITS.ip.burst - LIMITS.session.burst;
		for (let i = 0; i < left; i++) { assert.equal(takeTokens({ ip: "i" }, 0).ok, true); }
		assert.equal(takeTokens({ ip: "i" }, 0).ok, false);
	});

	test("addresses in one IPv6 /64 share a key, IPv4 keeps its address", () => {
		assert.equal(ipKey("2001:db8:1:2:a::1"), ipKey("2001:db8:1:2:ffff:0:0:9"));
		assert.equal(ipKey("2001:db8:1:2::1"), "2001:db8:1:2::/64");
		assert.notEqual(ipKey("2001:db8:1:3::1"), ipKey("2001:db8:1:2::1"));
		assert.equal(ipKey("2001:db8::1"), "2001:db8:0:0::/64");
		assert.equal(ipKey("::ffff:203.0.113.5"), "203.0.113.5");
		assert.equal(ipKey("203.0.113.5"), "203.0.113.5");
	});

	test("login buckets don't take from new-game buckets", () => {
		for (let i = 0; i < LOGIN_LIMITS.loginIp.burst; i++) {
			assert.equal(takeTokens({ loginIp: "203.0.113.5" }, 0, LOGIN_LIMITS).ok, true);
		}
		assert.equal(takeTokens({ loginIp: "203.0.113.5" }, 0, LOGIN_LIMITS).ok, false);
		assert.equal(takeTokens({ ip: "203.0.113.5" }, 0, LIMITS).ok, true);
	});
});
