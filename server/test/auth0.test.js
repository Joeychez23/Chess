/*
 *  auth0.test.js  --  chess server tests
 *	Auth0 Calls (utils/auth0.js, a timeout on every call #365)
 *  Calls the module directly with a stand-in fetch, so each of the four calls can be stalled. Its Management API token is cached, so each test loads a fresh copy
 *
 */

require("./helpers/env.js");
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const config = require("../config");

const MODULE = require.resolve("../utils/auth0.js");
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const neverAnswers = (url, options) => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason)));

/**
 * @description An answer whose headers arrive but whose body stalls, until the signal gives up
 */
function bodyNeverEnds(url, options) {
	const stream = new ReadableStream({ start(controller) { options.signal.addEventListener("abort", () => controller.error(options.signal.reason)); } });
	return new Response(stream, { status: 200, headers: { "Content-Type": "application/json" } });
}

/**
 * @description A fresh auth0.js with a short timeout, its fetch calls recorded
 * @param  {[object]} t [the test]
 * @param  {[function]} answer [(url, options) => the answer]
 * @return {[object]} loaded [{ auth0: the module, calls: the fetch calls' { url, options } }]
 */
function load(t, answer) {
	delete require.cache[MODULE];
	const auth0 = require(MODULE);
	auth0.timeouts.request = 50;
	const calls = [];
	t.mock.method(globalThis, "fetch", async (url, options) => {
		calls.push({ url, options });
		return answer(url, options);
	});
	return { auth0, calls };
}

const managementToken = (url, options, answer) => (url.endsWith("/oauth/token") ? json({ access_token: "management-token", expires_in: 86400 }) : answer(url, options));

const CALLS = [
	{ name: "code exchange", run: (auth0) => auth0.exchangeCode("the-code"), answer: neverAnswers, count: 1 },
	{ name: "password login", run: (auth0) => auth0.passwordLogin("alice@test", "alice-password", "203.0.113.5"), answer: neverAnswers, count: 1 },
	{ name: "management token", run: (auth0) => auth0.getAuth0User("alice@test"), answer: neverAnswers, count: 1 },
	{ name: "user search", run: (auth0) => auth0.getAuth0User("alice@test"), answer: (url, options) => managementToken(url, options, neverAnswers), count: 2 }
];

test("the timeout is 5 seconds", () => {
	delete require.cache[MODULE];
	assert.equal(require(MODULE).timeouts.request, 5000);
});

describe("a call Auth0 doesn't answer", () => {
	for (const { name, run, answer, count } of CALLS) {
		test(`${name} gives up as down, says which call, logs nothing private & isn't retried`, async (t) => {
			const { auth0, calls } = load(t, answer);
			const err = await run(auth0).then(() => assert.fail("should time out"), (failed) => failed);
			assert.equal(err.name, "DataServiceDown");
			assert.ok(err.message.startsWith(`Auth0: ${name}: no answer`), err.message);
			for (const secret of ["alice@test", "alice%40test", "alice-password", "the-code", config.auth0ClientSecret]) {
				assert.ok(!err.message.includes(secret));
			}
			assert.equal(calls.length, count);
			assert.ok(calls.every((call) => call.options.signal instanceof AbortSignal));
		});
	}

	test("a body that stalls after the headers is treated the same", async (t) => {
		const { auth0 } = load(t, bodyNeverEnds);
		await assert.rejects(auth0.passwordLogin("alice@test", "alice-password", "203.0.113.5"), { name: "DataServiceDown", message: /^Auth0: password login: no answer/ });
	});
});

describe("other answers keep working", () => {
	test("a network failure isn't called a timeout", async (t) => {
		const { auth0 } = load(t, () => { throw new TypeError("fetch failed"); });
		await assert.rejects(auth0.exchangeCode("the-code"), { name: "TypeError" });
	});

	test("a refused password keeps Auth0's error", async (t) => {
		const { auth0 } = load(t, () => json({ error: "invalid_grant", error_description: "Wrong email or password." }, 403));
		await assert.rejects(auth0.passwordLogin("alice@test", "wrong", "203.0.113.5"), { auth0Error: "invalid_grant" });
	});

	test("a gateway's error page still gives the status", async (t) => {
		const { auth0 } = load(t, (url, options) => managementToken(url, options, () => new Response("<html>Bad Gateway</html>", { status: 502 })));
		await assert.rejects(auth0.getAuth0User("alice@test"), { message: "Auth0 user search failed: 502" });
	});
});
