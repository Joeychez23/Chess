/*
 *  replayPage.test.js  --  chess server tests
 *	The replay page (/replay/:gameId, #100): real requests through the page routes & the data service. A finished game gets the play page
 *	(its board opens read-only), a game still going goes to its live board, an invite goes Home & signed out players sign in first
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const testServer = require("./helpers/server.js");
const { call, page, player, named } = testServer;

let server;
let sentPage; // THE PAGE A ROUTE SENT, THE SERVER TESTS DON'T BUILD client/dist
const sendFile = express.response.sendFile;
before(async () => {
	server = await testServer.start();
	express.response.sendFile = function (file) { sentPage = path.basename(file); return this.status(200).end(); };
});
after(() => { express.response.sendFile = sendFile; testServer.reset(); server.close(); });
beforeEach(() => { testServer.reset(); sentPage = null; });

describe("the replay page", () => {
	test("signed out goes through sign in and comes back", async () => {
		const url = "/replay/abc";
		assert.equal((await page(url)).location, `/api/auth/resume?returnTo=${encodeURIComponent(url)}`);
	});

	test("an open game goes to its live board, an invite Home, a finished game gets the play page", async () => {
		const [alice, bob] = [player("alice"), player("bob")];
		const open = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w", ai_level: 3 } });
		assert.equal((await page(`/replay/${open.game_id}`, { as: alice })).location, `/play/${open.game_id}`);
		await call("POST", `/api/chess/game/${open.game_id}/forfeit`, { as: alice });
		await page(`/replay/${open.game_id}`, { as: alice });
		assert.equal(sentPage, "play.html");
		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_username: await named(bob) } });
		assert.equal((await page(`/replay/${invite.game_id}`, { as: bob })).location, "/");
	});

	test("a game that isn't found still gets the play page, it says so itself", async () => {
		await page("/replay/missing", { as: player("alice") });
		assert.equal(sentPage, "play.html");
	});
});
