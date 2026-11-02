/*
 *  csrf.test.js  --  chess server
 *	CSRF Check
 *	Every write to the api only takes a request from our own page (middleware/csrf.js). Reads aren't checked
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const config = require("../config.js");

const { call, send, player } = testServer;

const ours = () => new URL(config.clientUrl).origin;

describe("csrf", () => {
	let server;
	before(async () => { server = await testServer.start(); });
	after(() => server.close());
	beforeEach(() => testServer.reset());

	const WRITES = [["POST", "/api/chess/game"], ["PUT", "/api/chess/game/game1"], ["POST", "/api/chess/game/game1/forfeit"], ["POST", "/api/chess/invite"], ["PUT", "/api/user/settings"], ["PUT", "/api/user/username"], ["DELETE", "/api/user"], ["POST", "/api/auth/logout"], ["POST", "/api/auth/refresh"], ["POST", "/api/client-errors"], ["PATCH", "/api/user"]];
	const REFUSED = [{}, { Origin: "https://evil.test" }, { Origin: "null" }, { Origin: "https://sub.localhost" }, { Origin: "https://evil.test", "Sec-Fetch-Site": "cross-site" }];

	test("a write from anywhere but our own page gets 403", async () => {
		for (const [method, path] of WRITES) {
			for (const headers of [...REFUSED, { Origin: ours(), "Sec-Fetch-Site": "same-site" }, { Origin: ours(), "Sec-Fetch-Site": "cross-site" }]) {
				const res = await send(method, path, {}, { headers });
				assert.equal(res.http, 403, `${method} ${path} ${JSON.stringify(headers)}`);
				assert.deepEqual(res.body, { status: 403, message: "Forbidden" });
			}
		}
	});

	test("another site's bad JSON is refused before the body is read", async () => {
		const res = await send("POST", "/api/chess/game", {}, { headers: { "Content-Type": "application/json", Origin: "https://evil.test" }, body: "{" });
		assert.equal(res.http, 403);
	});

	test("a refused Delete my data leaves the player's data", async () => {
		const alice = player("alice");
		await call("PUT", "/api/user/username", { as: alice, body: { username: "alice_1" } });
		const session = await call("GET", "/api/user", { as: alice });
		assert.equal(session.username, "alice_1");
		const Cookie = (await login(alice));
		assert.equal((await send("DELETE", "/api/user", Cookie, { headers: { Origin: "https://evil.test" } })).http, 403);
		assert.equal((await call("GET", "/api/user", { as: alice })).username, "alice_1");
		assert.equal((await send("DELETE", "/api/user", Cookie)).http, 200); // OUR OWN PAGE CAN
	});

	test("our own page's writes pass, with or without Sec-Fetch-Site", async () => {
		for (const headers of [{ Origin: ours() }, { Origin: ours(), "Sec-Fetch-Site": "same-origin" }]) {
			assert.notEqual((await send("POST", "/api/auth/refresh", {}, { headers })).http, 403);
		}
	});

	test("reads aren't checked", async () => {
		assert.equal((await send("GET", "/api/chess/levels", {}, { headers: { Origin: "https://evil.test", "Sec-Fetch-Site": "cross-site" } })).http, 200);
	});

	async function login(someone) {
		const res = await send("POST", "/api/auth/login", {}, { headers: { "Content-Type": "application/json", Origin: ours() }, body: JSON.stringify({ email: someone.email, password: someone.password }) });
		return { access_token: res.cookies.access_token, refresh_token: res.cookies.refresh_token };
	}
});
