/*
 *  signature.test.js  --  data service tests
 *	Signed Requests (middleware/signature.js, utils/signature.js)
 *  Only a request signed with DATA_SERVICE_SECRET (or the old secret while it's being changed), sent within 30 seconds & only once,
 *  gets past the signature check. Anything else is refused with a 401 & changes nothing
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const service = require("./helpers/service.js");
const { call, player, peek, signatureHeaders } = service;
const db = require("../dynamoDB.js");

let server;
before(async () => { server = await service.start(); });
after(() => server.close());
beforeEach(async () => {
	service.reset();
	await db.initalizeGame("game1", "alice", "bob", false, { start_params: { color: "w" }, inviter_id: "alice" });
	await db.initalizeGame("game2", "alice", "bob", false, { start_params: { color: "w" }, inviter_id: "alice" });
});

const alice = player("alice");
const bob = player("bob");
const MOVE = { from: "e2", to: "e4" };
const MOVE_PATH = "/games/game1/move";

/**
 * @description Sends a request that must be refused (401) & checks neither game changed
 * @return {[object]} response
 */
async function refused(method, path, options, reason) {
	const before = [peek("chess_db", "game1"), peek("chess_db", "game2")];
	const response = await call(method, path, options);
	assert.equal(response.http, 401, response.message);
	if (reason) { assert.equal(response.message, reason); }
	assert.deepEqual([peek("chess_db", "game1"), peek("chess_db", "game2")], before, "a game changed");
	return response;
}

/* ---------------------------------------------------------------- */
// Signatures
/* ---------------------------------------------------------------- */

describe("signatures", () => {
	test("a signed request goes through, /health needs none", async () => {
		assert.equal((await call("POST", MOVE_PATH, { as: alice, body: MOVE })).status, 200);
		assert.equal((await call("GET", "/health", { unsigned: true })).http, 200);
	});

	test("an unsigned request, or one missing a header, is refused", async () => {
		await refused("POST", MOVE_PATH, { as: alice, body: MOVE, unsigned: true }, "Unsigned request");
		const signature = signatureHeaders("POST", MOVE_PATH, JSON.stringify(MOVE));
		for (const header of Object.keys(signature)) {
			const partial = { ...signature };
			delete partial[header];
			await refused("POST", MOVE_PATH, { as: alice, body: MOVE, signature: partial }, "Unsigned request");
		}
		await refused("GET", "/games/game1", { as: alice, unsigned: true }, "Unsigned request"); // READS TOO
		await refused("POST", "/no-such-route", { unsigned: true }, "Unsigned request"); // BEFORE IT SAYS WHAT EXISTS
	});

	test("a signature with another secret is refused", async () => {
		await refused("POST", MOVE_PATH, { as: alice, body: MOVE, secret: "someone-elses-secret-0123456789abcdef" }, "Bad signature");
		await refused("POST", MOVE_PATH, { as: alice, body: MOVE, signature: { ...signatureHeaders("POST", MOVE_PATH, JSON.stringify(MOVE)), "X-Data-Signature": "x".repeat(43) } }, "Bad signature");
	});

	test("the body, path, query or method can't be changed after signing", async () => {
		await refused("POST", MOVE_PATH, { as: alice, body: { from: "d2", to: "d4" }, signBody: JSON.stringify(MOVE) }, "Bad signature");
		await refused("POST", "/games/game2/move", { as: alice, body: MOVE, signPath: MOVE_PATH }, "Bad signature");
		await refused("GET", "/games/game1?consistent=true", { as: alice, signPath: "/games/game1" }, "Bad signature");
		await refused("POST", "/games/game1/forfeit", { as: alice, signMethod: "GET" }, "Bad signature");
	});

	test("a request more than 30 seconds from now, either way, is refused", async () => {
		await refused("POST", MOVE_PATH, { as: alice, body: MOVE, timestamp: Date.now() - 31 * 1000 }, "Request too old");
		await refused("POST", MOVE_PATH, { as: alice, body: MOVE, timestamp: Date.now() + 31 * 1000 }, "Request too old");
		await refused("POST", MOVE_PATH, { as: alice, body: MOVE, timestamp: "soon" }, "Bad signature headers");
		assert.equal((await call("POST", MOVE_PATH, { as: alice, body: MOVE, timestamp: Date.now() - 20 * 1000 })).status, 200); // A SLOW REQUEST STILL COUNTS
	});

	test("the same request sent again is refused, so the move is only made once", async () => {
		const signature = signatureHeaders("POST", MOVE_PATH, JSON.stringify(MOVE));
		assert.equal((await call("POST", MOVE_PATH, { as: alice, body: MOVE, signature })).status, 200);
		await refused("POST", MOVE_PATH, { as: alice, body: MOVE, signature }, "Replayed request");
		assert.deepEqual(JSON.parse(peek("chess_db", "game1").moves.S), ["e4"]);
		await refused("POST", MOVE_PATH, { as: alice, body: MOVE, requestId: "short" }, "Bad signature headers");
	});

	test("the old secret is still accepted while the secret is being changed", async () => {
		assert.equal((await call("POST", MOVE_PATH, { as: alice, body: MOVE, secret: process.env.DATA_SERVICE_SECRET_OLD })).status, 200);
	});

	test("a refusal's log line has no signature, token or body", async () => {
		const lines = [];
		const log = console.log;
		console.log = (line) => lines.push(`${line}`);
		try {
			await call("POST", MOVE_PATH, { as: alice, body: { from: "e2", to: "e4" }, secret: "someone-elses-secret-0123456789abcdef" });
		} finally {
			console.log = log;
		}
		assert.deepEqual(lines, ["REFUSED POST /games/game1/move 401 Bad signature"]);
	});
});

/* ---------------------------------------------------------------- */
// The Player, Behind A Good Signature (#248's list)
/* ---------------------------------------------------------------- */

describe("a signed request still only acts for its player", () => {
	test("a token for another player gets nothing more than that player has", async () => {
		await db.initalizeGame("game3", "carol", "dave", false, { start_params: { color: "w" }, inviter_id: "carol" });
		const before = peek("chess_db", "game3");
		assert.equal((await call("POST", "/games/game3/move", { as: bob, body: MOVE })).http, 403);
		assert.deepEqual(peek("chess_db", "game3"), before);
	});

	test("a user_id in the body is refused, never used", async () => {
		const before = peek("chess_db", "game1");
		assert.equal((await call("POST", MOVE_PATH, { as: bob, body: { ...MOVE, user_id: "alice" } })).http, 400); // BOB CAN'T MOVE AS ALICE
		assert.equal((await call("POST", "/users/me/settings", { as: bob, body: { ai_level: 3, ai_color: "w", friend_color: "w", user_id: "alice" } })).http, 400);
		assert.deepEqual(peek("chess_db", "game1"), before);
		assert.equal(peek("user_db", "alice").settings, undefined);
	});
});
