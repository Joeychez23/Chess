/*
 *  health.test.js  --  data service tests
 *	Table Check (GET /health/tables, #194)
 *  The chess server's /api/health asks this: it's signed like every call, needs no player, reads both tables & saves nothing
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const service = require("./helpers/service.js");

let server;
before(async () => { server = await service.start(); });
after(() => server.close());

describe("GET /health/tables", () => {
	test("answers OK with no player, reading both tables", async () => {
		const read = mock.method(DynamoDB.prototype, "getItem");
		const res = await service.call("GET", "/health/tables");
		assert.equal(res.http, 200);
		assert.deepEqual(read.mock.calls.map((call) => call.arguments[0].TableName).sort(), ["chess_db", "user_db"]);
		read.mock.restore();
	});

	test("answers 503 when DynamoDB can't", async () => {
		const read = mock.method(DynamoDB.prototype, "getItem", async () => { throw Object.assign(new Error("slow down"), { name: "ProvisionedThroughputExceededException" }); });
		const logged = mock.method(console, "error", () => {});
		const res = await service.call("GET", "/health/tables");
		assert.equal(res.http, 503);
		assert.equal(res.message, "ProvisionedThroughputExceededException");
		assert.match(logged.mock.calls[0].arguments[0], /^HEALTH tables: /);
		logged.mock.restore();
		read.mock.restore();
	});

	test("an unsigned request is refused", async () => {
		const logged = mock.method(console, "log", () => {});
		const address = server.address();
		const res = await fetch(`http://127.0.0.1:${address.port}/health/tables`);
		assert.equal(res.status, 401);
		logged.mock.restore();
	});
});
