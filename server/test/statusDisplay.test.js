/*
 *  statusDisplay.test.js  --  chess server tests
 *	Status Display Setting (Task 21)
 *  PUT /api/user/settings/status-display saves only { status_display }, once every 5 minutes per player,
 *  & PUT /api/user/settings keeps sending only the AI fields, with its own rate limit
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const { call, player, poke } = testServer;
const { readSettings } = require("../controllers/chessController.js");
const { takeTokens, resetLimits, STATUS_DISPLAY_LIMITS, SETTINGS_LIMITS } = require("../middleware/rateLimit.js");

let server;
let sent; // BODIES THE SERVER SENT TO THE DATA SERVICE'S /users/me/settings
let standIn;
before(async () => {
	server = await testServer.start();
	standIn = globalThis.fetch;
	globalThis.fetch = (url, options) => { // WATCHES WHAT GOES TO THE DATA SERVICE, THEN LETS THE STAND-IN ANSWER
		if (String(url).endsWith("/users/me/settings")) { sent.push(JSON.parse(options.body)); }
		return standIn(url, options);
	};
});
after(() => { globalThis.fetch = standIn; server.close(); });
beforeEach(() => { testServer.reset(); sent = []; });

describe("status display", () => {
	test("is saved once, a second save within 5 minutes gets a 429", async () => {
		const alice = player("alice");
		const first = await call("PUT", "/api/user/settings/status-display", { as: alice, body: { status_display: "badges" } });
		assert.equal(first.http, 200);
		assert.deepEqual(first.settings, { status_display: "badges" });
		assert.deepEqual(sent, [{ status_display: "badges" }]); // ONLY ITS OWN FIELD, THE DATA SERVICE MERGES IT

		const second = await call("PUT", "/api/user/settings/status-display", { as: alice, body: { status_display: "effects" } });
		assert.equal(second.http, 429);
		assert.equal(second.status, 429);
		assert.ok(second.retry_after);
		assert.equal(sent.length, 1);
	});

	test("anything but effects or badges gets a 400, and nothing is sent", async () => {
		const alice = player("alice");
		for (const body of [{ status_display: "purple" }, {}, { status_display: ["badges"] }]) {
			const refused = await call("PUT", "/api/user/settings/status-display", { as: alice, body });
			assert.equal(refused.http, 400);
			assert.equal(refused.status, 400);
		}
		assert.deepEqual(sent, []);
	});

	test("a 400 spends no token, so a valid save right after it is saved", async () => {
		const alice = player("alice");
		assert.equal((await call("PUT", "/api/user/settings/status-display", { as: alice, body: { status_display: "Badges" } })).http, 400);
		assert.equal((await call("PUT", "/api/user/settings/status-display", { as: alice, body: { status_display: "badges" } })).http, 200);
		assert.deepEqual(sent, [{ status_display: "badges" }]);
	});

	test("needs a signed in player", async () => {
		assert.equal((await call("PUT", "/api/user/settings/status-display", { body: { status_display: "badges" } })).http, 401);
	});

	test("readSettings defaults it to effects, and a stored badges comes back with Home's settings", async () => {
		assert.equal(readSettings({}).status_display, "effects");
		assert.equal(readSettings({ status_display: "nope" }).status_display, "effects");
		assert.equal(readSettings({ status_display: "badges" }).status_display, "badges");

		const alice = player("alice");
		await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } }); // SO SHE HAS A ROW
		poke("user_db", "alice", { settings: { S: JSON.stringify({ ai_level: 1500, status_display: "badges" }) } });
		const home = await call("GET", "/api/chess/user/alice", { as: alice });
		assert.equal(home.settings.status_display, "badges");
		assert.equal(home.settings.ai_level, 1500);
	});
});

describe("default start settings", () => {
	test("never send status_display, so saving them can't overwrite it", async () => {
		const alice = player("alice");
		const saved = await call("PUT", "/api/user/settings", { as: alice, body: { ai_level: 2200, ai_color: "b", friend_color: "w", status_display: "badges" } });
		assert.equal(saved.http, 200);
		assert.deepEqual(sent, [{ ai_level: 2200, ai_color: "b", friend_color: "w" }]);
		assert.deepEqual(saved.settings, { ai_level: 2200, ai_color: "b", friend_color: "w" });
	});

	test("the 11th save within a minute gets a 429", async () => {
		const alice = player("alice");
		for (let i = 0; i < 10; i++) { assert.equal((await call("PUT", "/api/user/settings", { as: alice, body: { ai_level: 1500 } })).http, 200); }
		const limited = await call("PUT", "/api/user/settings", { as: alice, body: { ai_level: 1500 } });
		assert.equal(limited.http, 429);
		assert.equal(limited.status, 429);
		assert.equal(sent.length, 10);
	});
});

describe("refills", () => { // LITERAL TIMES, SO A CHANGED refillMs FAILS HERE (cards/statusPref.js SENDS ONE EVERY 5 MINUTES + 10 SECONDS)
	beforeEach(() => resetLimits());

	test("status display: one save, then the next token comes back at exactly 5 minutes", () => {
		const keys = { statusDisplaySession: "user:alice" };
		assert.equal(takeTokens(keys, 0, STATUS_DISPLAY_LIMITS).ok, true);
		assert.equal(takeTokens(keys, 0, STATUS_DISPLAY_LIMITS).ok, false);
		const early = takeTokens(keys, 299999, STATUS_DISPLAY_LIMITS);
		assert.equal(early.ok, false);
		assert.equal(Math.round(early.retryMs), 1);
		assert.equal(takeTokens(keys, 300000, STATUS_DISPLAY_LIMITS).ok, true);
		assert.equal(takeTokens(keys, 300000, STATUS_DISPLAY_LIMITS).ok, false);
	});

	test("settings: 10 saves, the 11th refused, then one token back every 6 seconds", () => {
		const keys = { settingsSession: "user:alice" };
		for (let i = 0; i < 10; i++) { assert.equal(takeTokens(keys, 0, SETTINGS_LIMITS).ok, true); }
		assert.equal(takeTokens(keys, 0, SETTINGS_LIMITS).ok, false);
		assert.equal(takeTokens(keys, 5999, SETTINGS_LIMITS).ok, false);
		assert.equal(takeTokens(keys, 6000, SETTINGS_LIMITS).ok, true);
		assert.equal(takeTokens(keys, 6000, SETTINGS_LIMITS).ok, false);
	});
});
