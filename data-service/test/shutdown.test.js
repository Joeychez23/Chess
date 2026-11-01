/*
 *  shutdown.test.js  --  data service tests
 *	Restarts (#358)
 *  systemctl restart sends SIGTERM. Closing a game is several writes in a row, so the data service stops taking requests & finishes
 *  the running ones before it exits. Runs the real index.js in its own process, its DynamoDB calls go to a stand-in that holds them
 *
 */

require("./helpers/env.js");
const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { freePort, startService, startStandIn, wait } = require("./helpers/serviceProcess.js");
const { signatureHeaders } = require("./helpers/service.js");

let dynamo, service, baseUrl, env;

/**
 * @description Starts the data service on env's port
 */
const start = () => startService(path.join(__dirname, ".."), env, "Data service on");

beforeEach(async () => {
	dynamo = await startStandIn({});
	const port = await freePort();
	baseUrl = `http://127.0.0.1:${port}`;
	env = { DATA_SERVICE_PORT: `${port}`, AWS_ENDPOINT_URL_DYNAMODB: dynamo.url };
	service = await start();
});

afterEach(() => {
	service.kill();
	dynamo.close();
});

describe("SIGTERM", () => {
	test("a running request finishes before the process exits, and a new one is refused", async () => {
		const running = fetch(`${baseUrl}/health/tables`, { headers: signatureHeaders("GET", "/health/tables") });
		await dynamo.waitFor(2);

		service.stop();
		let exited = false;
		service.exited.then(() => { exited = true; });
		await wait(200);
		assert.equal(exited, false); // STILL WAITING ON DYNAMODB
		await assert.rejects(fetch(`${baseUrl}/health`), (err) => err.cause.code == "ECONNREFUSED");

		dynamo.release();
		const res = await running;
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { status: 200, message: "OK" });
		assert.deepEqual(await service.exited, { code: 0, signal: null });
	});

	test("with nothing running it exits at once, and the next start answers deploy.sh's check", async () => {
		await fetch(`${baseUrl}/health`); // LEAVES AN IDLE KEEP-ALIVE CONNECTION
		service.stop();
		assert.deepEqual(await Promise.race([service.exited, wait(2000)]), { code: 0, signal: null });

		service = await start();
		assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
	});
});
