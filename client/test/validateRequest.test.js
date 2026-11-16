/*
 *  validateRequest.test.js  --  chess frontend tests
 *	What a request to the chess server gives back (client/src/js/gameplay/validate/index.js): undefined when it throws, the body otherwise. Run with npm run test:client
 *
 */

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { declineInvite } = require("../src/js/gameplay/validate/index.js");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const reply = (status, body) => ({ status, ok: status < 400, json: async () => body });

test("a fetch that throws (server down) gives undefined", async () => {
	globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
	assert.equal(await declineInvite("/api/chess", "g1"), undefined);
});

test("a body that isn't JSON gives undefined", async () => {
	globalThis.fetch = async () => ({ status: 502, json: async () => { throw new SyntaxError("bad json"); } });
	assert.equal(await declineInvite("/api/chess", "g1"), undefined);
});

test("a 5xx body is marked serverError", async () => {
	globalThis.fetch = async () => reply(500, { message: "boom" });
	assert.deepEqual(await declineInvite("/api/chess", "g1"), { message: "boom", serverError: true });
});

test("a 401 refreshes the session once and retries", async () => {
	const calls = [];
	globalThis.fetch = async (url) => { calls.push(url); return calls.length === 1 ? reply(401, {}) : reply(200, { status: 200 }); };
	assert.deepEqual(await declineInvite("/api/chess", "g 1"), { status: 200 });
	assert.deepEqual(calls, ["/api/chess/game/g%201/decline", "/api/auth/refresh", "/api/chess/game/g%201/decline"]);
});
