/*
 *  securityHeaders.test.js  --  chess server tests
 *	Security Headers (server/middleware/securityHeaders.js, #191)
 *  Every response has the CSP (this site, the assets domain & Google Fonts, no framing), nosniff & Referrer-Policy, no
 *  X-Powered-By, & HSTS only in production
 *
 */

require("./helpers/env.js");
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const config = require("../config");
const { contentSecurityPolicy } = require("../middleware/securityHeaders.js");

let server;
before(async () => { server = await testServer.start(); });
after(() => { testServer.reset(); server.close(); });

const headersOf = async (path) => (await testServer.send("GET", path, {})).headers;

describe("security headers", () => {
	test("a response has every header & no X-Powered-By", async () => {
		const res = await testServer.send("GET", "/play", {});
		const h = res.headers;
		assert.ok(h, "send() returns the response headers");
		assert.equal(h.get("x-powered-by"), null);
		assert.match(h.get("content-security-policy"), /frame-ancestors 'none'/);
		assert.equal(h.get("x-frame-options"), "DENY");
		assert.equal(h.get("x-content-type-options"), "nosniff");
		assert.equal(h.get("referrer-policy"), "strict-origin-when-cross-origin");
	});

	test("an unknown API route has them too", async () => {
		const h = await headersOf("/api/nothing-here");
		assert.equal(h.get("x-frame-options"), "DENY"); // EXPRESS'S OWN 404 SWAPS IN AN EVEN STRICTER CSP (default-src 'none')
		assert.equal(h.get("x-content-type-options"), "nosniff");
	});

	test("the CSP allows this site's scripts only, the assets domain & Google Fonts", () => {
		const csp = contentSecurityPolicy();
		const assets = new URL(config.assetsUrl).origin;
		assert.match(csp, /script-src 'self'(;|$)/);
		assert.ok(csp.includes(`img-src 'self' data: ${assets}`));
		assert.ok(csp.includes(`media-src 'self' ${assets}`));
		assert.match(csp, /style-src [^;]*https:\/\/fonts\.googleapis\.com/);
		assert.match(csp, /font-src [^;]*https:\/\/fonts\.gstatic\.com/);
		assert.match(csp, /connect-src 'self'(;|$)/);
		assert.match(csp, /object-src 'none'/);
	});

	test("a relative CHESS_ASSETS_URL only allows this site", () => {
		const saved = config.assetsUrl;
		config.assetsUrl = ".";
		try { assert.match(contentSecurityPolicy(), /img-src 'self' data:;/); }
		finally { config.assetsUrl = saved; }
	});

	test("HSTS only in production", async () => {
		assert.equal((await headersOf("/play")).get("strict-transport-security"), null);
		config.isProduction = true;
		try { assert.equal((await headersOf("/play")).get("strict-transport-security"), "max-age=31536000; includeSubDomains"); }
		finally { config.isProduction = false; }
	});
});
