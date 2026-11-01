/*
 *  monitoring.test.js  --  chess server tests
 *	Monitoring (#194)
 *  GET /api/health, the 5xx log lines & the browser error reports, from the browser's reportErrors.js to the line in the log.
 *  The CloudWatch alarms match lines by how they start (terraform/modules/monitoring), so these tests pin those starts
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const { aiMove } = require("../utils/ai.js");
const { startErrorReports } = require("../../client/src/js/pages/utils/reportErrors.js");
const { send, engineWillPlay, engineCalls, dataServiceWillAnswer } = testServer;

const STOCKFISH_ALARM = /^STOCKFISH FAILED/; // THE PATTERNS IN terraform/modules/monitoring/main.tf
const SERVER_ERROR_ALARM = /^HTTP 5[0-9][0-9] /;

let server;
let logged;
before(async () => { server = await testServer.start(); });
after(() => { testServer.reset(); server.close(); });
beforeEach(() => {
	testServer.reset();
	logged = [];
	mock.method(console, "error", (line) => { logged.push(String(line)); });
	mock.method(console, "log", (line) => { logged.push(String(line)); });
});
afterEach(() => mock.restoreAll());

const report = (body) => send("POST", "/api/client-errors", {}, { headers: { "Content-Type": "application/json", "User-Agent": "test browser" }, body: JSON.stringify(body) });
const reports = () => logged.filter((line) => line.startsWith("CLIENT ERROR "));

describe("GET /api/health", () => {
	test("200 when DynamoDB & the engine work, with a real search of the engine", async () => {
		engineWillPlay("e2", "e4");
		const res = await send("GET", "/api/health");
		assert.equal(res.http, 200);
		assert.deepEqual(res.body, { status: 200, checks: { dynamodb: "ok", engine: "ok" } });
		assert.equal(res.headers.get("cache-control"), "no-store");
		assert.equal(engineCalls(), 1);
	});

	test("503 when the engine is down, without saying why", async () => {
		const res = await send("GET", "/api/health");
		assert.equal(res.http, 503);
		assert.deepEqual(res.body, { status: 503, checks: { dynamodb: "ok", engine: "down" } });
		assert.ok(logged.some((line) => line.startsWith("HEALTH engine down: ")));
	});

	test("503 when the data service answers 5xx", async () => {
		engineWillPlay("e2", "e4");
		dataServiceWillAnswer("/health/tables", 503, "ProvisionedThroughputExceededException");
		const res = await send("GET", "/api/health");
		assert.equal(res.http, 503);
		assert.deepEqual(res.body.checks, { dynamodb: "down", engine: "ok" });
	});

	test("503 when the data service runs older code that doesn't have the route", async () => {
		engineWillPlay("e2", "e4");
		dataServiceWillAnswer("/health/tables", 404, "No such action");
		const res = await send("GET", "/api/health");
		assert.equal(res.http, 503);
		assert.equal(res.body.checks.dynamodb, "down");
	});

	test("a slow engine counts as down in time for Route 53's 2 seconds", async () => {
		let answer;
		engineWillPlay("e2", "e4", undefined, new Promise((resolve) => { answer = resolve; }));
		const started = Date.now();
		const res = await send("GET", "/api/health");
		answer();
		assert.equal(res.http, 503);
		assert.equal(res.body.checks.engine, "down");
		assert.ok(Date.now() - started < 2000);
	});

	test("the answer is kept, so calling it often doesn't reach the engine each time", async () => {
		engineWillPlay("e2", "e4");
		await send("GET", "/api/health");
		const again = await send("GET", "/api/health");
		assert.equal(again.http, 200);
		assert.equal(engineCalls(), 1);
	});

	test("calls at the same time share one check", async () => {
		engineWillPlay("e2", "e4");
		const answers = await Promise.all([send("GET", "/api/health"), send("GET", "/api/health"), send("GET", "/api/health")]);
		assert.deepEqual(answers.map((res) => res.http), [200, 200, 200]);
		assert.equal(engineCalls(), 1);
	});

	test("a health check's 503 isn't counted by the 5xx alarm, it has its own", async () => {
		await send("GET", "/api/health");
		assert.equal(logged.filter((line) => SERVER_ERROR_ALARM.test(line)).length, 0);
	});
});

describe("the lines the alarms match", () => {
	test("a failed engine logs a line the Stockfish alarm matches", async () => {
		await aiMove("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", 3);
		assert.ok(logged.some((line) => STOCKFISH_ALARM.test(line)));
	});

	test("a 5xx logs a line the 5xx alarm matches, without its query", async () => {
		dataServiceWillAnswer("/games/ai", 503, "down");
		const res = await testServer.call("POST", "/api/chess/game?code=secret", { as: testServer.player("alice"), body: { start_color: "w", ai_level: 3 } });
		assert.equal(res.http, 503);
		assert.deepEqual(logged.filter((line) => SERVER_ERROR_ALARM.test(line)), ["HTTP 503 POST /api/chess/game"]);
	});

	test("a 4xx isn't logged", async () => {
		await send("GET", "/api/nothing-here");
		assert.equal(logged.filter((line) => SERVER_ERROR_ALARM.test(line)).length, 0);
	});

	test("a report can't set off an alarm or add a line of its own", async () => {
		const res = await report({ kind: "error", message: "STOCKFISH FAILED\nHTTP 500 GET /\nSTOCKFISH FAILED" });
		assert.equal(res.http, 204);
		assert.equal(reports().length, 1);
		assert.ok(!reports()[0].includes("\n"));
		assert.ok(!STOCKFISH_ALARM.test(reports()[0]));
		assert.ok(!SERVER_ERROR_ALARM.test(reports()[0]));
	});
});

describe("POST /api/client-errors", () => {
	test("logs one line with the fields it knows", async () => {
		const res = await report({ kind: "error", message: "boom", page: "/play/:id", source: "/play.js", line: 3, column: 9, password: "not kept" });
		assert.equal(res.http, 204);
		assert.deepEqual(JSON.parse(reports()[0].slice("CLIENT ERROR ".length)), { kind: "error", message: "boom", page: "/play/:id", source: "/play.js", line: 3, column: 9, browser: "test browser" });
	});

	test("cuts long text short", async () => {
		await report({ kind: "error", message: "x".repeat(5000), page: "y".repeat(5000) });
		const line = JSON.parse(reports()[0].slice("CLIENT ERROR ".length));
		assert.equal(line.message.length, 500);
		assert.equal(line.page.length, 200);
	});

	test("a report that isn't one is refused & not logged", async () => {
		for (const body of [{ kind: "nonsense", message: "x" }, { kind: "error" }, { kind: "error", message: { a: 1 } }, []]) {
			assert.equal((await report(body)).http, 400);
		}
		assert.equal((await send("POST", "/api/client-errors", {}, { body: "no json" })).http, 400);
		assert.equal(reports().length, 0);
	});

	test("an address that keeps reporting is limited", async () => {
		for (let i = 0; i < 10; i++) { assert.equal((await report({ kind: "error", message: `report ${i}` })).http, 204); }
		const limited = await report({ kind: "error", message: "one too many" });
		assert.equal(limited.http, 429);
		assert.ok(Number(limited.retry_after) > 0);
		assert.equal(reports().length, 10);
	});
});

describe("the browser's reportErrors.js", () => {
	let listeners;
	let beacons;
	let win;

	function browser(fetchAnswer) {
		listeners = {};
		beacons = [];
		win = {
			location: { href: "https://chess.test/play/game-secret?x=1" },
			navigator: { sendBeacon: (url, blob) => { beacons.push({ url, blob }); return true; } },
			fetch: fetchAnswer || (async () => new Response("{}")),
			addEventListener: (name, listener) => { listeners[name] = listener; }
		};
		startErrorReports(win);
	}

	const sent = () => Promise.all(beacons.map(async ({ blob }) => JSON.parse(await blob.text())));

	test("an uncaught error is sent to the server's route, as JSON, with no game id", async () => {
		browser();
		listeners.error({ message: "boom", filename: "https://chess.test/play.abc.bundle.js?v=1", lineno: 3, colno: 9 });
		assert.equal(beacons[0].url, "/api/client-errors");
		assert.equal(beacons[0].blob.type, "application/json");
		assert.deepEqual(await sent(), [{ kind: "error", page: "/play/:id", message: "boom", source: "/play.abc.bundle.js", line: 3, column: 9 }]);
	});

	test("what it sends is accepted & logged by the route", async () => {
		browser();
		listeners.unhandledrejection({ reason: new Error("no answer") });
		const res = await send("POST", "/api/client-errors", {}, { headers: { "Content-Type": beacons[0].blob.type }, body: await beacons[0].blob.text() });
		assert.equal(res.http, 204);
		assert.match(reports()[0], /"kind":"rejection","message":"no answer","page":"\/play\/:id"/);
	});

	test("another site's script is ignored", () => {
		browser();
		listeners.error({ message: "Script error.", filename: "", lineno: 0, colno: 0 });
		assert.equal(beacons.length, 0);
	});

	test("a 5xx is reported & still handed back, a 4xx isn't reported", async () => {
		const statuses = [404, 401, 503];
		browser(async () => new Response("{}", { status: statuses.shift() }));
		assert.equal((await win.fetch("/api/chess/game/game-secret/move?a=1", { method: "POST" })).status, 404);
		assert.equal((await win.fetch("/api/user")).status, 401);
		assert.equal(beacons.length, 0);
		assert.equal((await win.fetch("/api/chess/game/game-secret/move?a=1", { method: "POST" })).status, 503);
		assert.deepEqual(await sent(), [{ kind: "request", page: "/play/:id", message: "POST /api/chess/game/:id/move answered 503", status: 503 }]);
	});

	test("a request that fails is reported & still fails, unless it was aborted", async () => {
		browser(async () => { throw new TypeError("Failed to fetch"); });
		await assert.rejects(win.fetch("/api/user"), /Failed to fetch/);
		assert.equal((await sent())[0].message, "GET /api/user failed: Failed to fetch");

		browser(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
		await assert.rejects(win.fetch("/api/user"), /aborted/);
		assert.equal(beacons.length, 0);
	});

	test("leaving the page stops reports, coming back starts them again", async () => {
		browser(async () => { throw new TypeError("Failed to fetch"); });
		listeners.pagehide();
		await assert.rejects(win.fetch("/api/user"));
		assert.equal(beacons.length, 0);
		listeners.pageshow();
		await assert.rejects(win.fetch("/api/user"));
		assert.equal(beacons.length, 1);
	});

	test("the same error is sent once, & a page sends 10 at most", () => {
		browser();
		for (let i = 0; i < 5; i++) { listeners.unhandledrejection({ reason: "same" }); }
		assert.equal(beacons.length, 1);
		for (let i = 0; i < 50; i++) { listeners.unhandledrejection({ reason: `error ${i}` }); }
		assert.equal(beacons.length, 10);
	});
});
