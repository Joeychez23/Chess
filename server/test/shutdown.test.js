/*
 *  shutdown.test.js  --  chess server tests
 *	Restarts (#358)
 *  systemctl restart sends SIGTERM. The server stops taking requests, ends the sockets & finishes the running requests before it exits,
 *  so a flow of several data service calls isn't cut in half. Runs the real index.js in its own process, its data service calls go to a stand-in that holds them
 *
 */

require("./helpers/env.js");
const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { io: connect } = require("socket.io-client");
const { freePort, startService, startStandIn, wait } = require("../../data-service/test/helpers/serviceProcess.js");
const keys = require("../../data-service/test/helpers/keys.js");

const user = { user_id: "auth0|alice", email: "alice@test", email_verified: true, user_metadata: { screenname: "Alice" } };
const Cookie = `access_token=${keys.sessionToken(user)}`;

let dataService, service, baseUrl, env;

/**
 * @description Starts the chess server on env's port
 */
const start = () => startService(path.join(__dirname, ".."), env, "Listening on");

beforeEach(async () => {
	dataService = await startStandIn({ status: 404, message: "No such game" });
	const port = await freePort();
	baseUrl = `http://127.0.0.1:${port}`;
	env = { API_PORT: `${port}`, DATA_SERVICE_URL: dataService.url };
	service = await start();
});

afterEach(() => {
	service.kill();
	dataService.close();
});

describe("SIGTERM", () => {
	test("a running request finishes before the process exits, and a new one is refused", async () => {
		const running = fetch(`${baseUrl}/api/chess/game/game1`, { headers: { Cookie } });
		await dataService.waitFor(1);

		service.stop();
		let exited = false;
		service.exited.then(() => { exited = true; });
		await wait(200);
		assert.equal(exited, false); // STILL WAITING ON THE DATA SERVICE
		await assert.rejects(fetch(`${baseUrl}/api/chess/levels`), (err) => err.cause.code == "ECONNREFUSED");

		dataService.release();
		const res = await running;
		assert.equal(res.status, 200);
		assert.equal((await res.json()).message, "No such game");
		assert.deepEqual(await service.exited, { code: 0, signal: null });
	});

	test("an open socket doesn't hold it up, the client reconnects to the next start, which answers deploy.sh's check", async () => {
		const socket = connect(baseUrl, { transports: ["websocket"], extraHeaders: { Cookie }, reconnectionDelay: 50, reconnectionDelayMax: 50 });
		try {
			await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
			const closed = new Promise((resolve) => socket.once("disconnect", resolve));

			service.stop();
			assert.equal(await closed, "transport close"); // NOT "io server disconnect", WHICH A CLIENT DOESN'T RECONNECT AFTER
			assert.deepEqual(await Promise.race([service.exited, wait(2000)]), { code: 0, signal: null });

			const back = new Promise((resolve) => socket.once("connect", resolve));
			service = await start();
			await back;
			assert.equal((await fetch(`${baseUrl}/api/chess/levels`)).status, 200);
		} finally {
			socket.close();
		}
	});
});
