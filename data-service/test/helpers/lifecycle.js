/*
 *  lifecycle.js  --  data service tests
 *	Shared setup for the starting & ending games tests (test/game/lifecycle/): the test data service started once per file with the in-memory tables
 *  and reset before each test, the players, and the list, friendGame & refused helpers
 *
 */

const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const service = require("./service.js");
const { call, player, peek } = service;
const db = require("../../db/index.js");

let server;
before(async () => { server = await service.start(); });
after(() => server.close());
beforeEach(() => service.reset());

const alice = player("alice");
const bob = player("bob");
const carol = player("carol");
const mallory = player("mallory");

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

const list = (userId, name) => JSON.parse(peek("user_db", userId)?.[name]?.S || "[]");
const friendGame = (gameId, white, black, pending) => db.initializeGame(gameId, white, black, false, { names: { w: white, b: black }, pending, start_params: { color: "w" }, inviter_id: white });


/**
 * @description Makes a request that must be refused & checks the items named didn't change (or weren't made)
 * @param  {[array]} items [[table, key], ...]
 * @return {[object]} response
 */
async function refused(items, method, path, options, http) {
	if (options?.as) { service.signIn(options.as.id); } // THE LOGIN THAT MADE THEIR ROW CAME BEFORE, ONLY THIS REQUEST MUST CHANGE NOTHING
	const before = items.map(([table, key]) => peek(table, key));
	const response = await call(method, path, options);
	assert.equal(response.http, http, response.message);
	assert.deepEqual(items.map(([table, key]) => peek(table, key)), before, "a stored item changed");
	return response;
}

module.exports = { alice, bob, carol, mallory, list, friendGame, refused };
