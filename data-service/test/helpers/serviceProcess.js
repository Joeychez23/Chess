/*
 *  serviceProcess.js  --  data service & chess server tests
 *	A Service In Its Own Process
 *  Runs a service's real index.js with `node index.js`, like systemd does, so a test can send it the SIGTERM of a restart (#358).
 *  A stand-in server plays what it calls, & holds each request until the test lets go, so a request is sure to be running when the signal arrives
 *
 */

const { spawn } = require("child_process");
const http = require("http");
const net = require("net");

/**
 * @description A port nothing is listening on (the services read theirs from the environment, where 0 means the default)
 * @return {[number]} port
 */
function freePort() {
	return new Promise((resolve) => {
		const probe = net.createServer().listen(0, "127.0.0.1", () => {
			const { port } = probe.address();
			probe.close(() => resolve(port));
		});
	});
}

/**
 * @description Starts `node index.js` & waits until it prints that it's listening
 * @param  {[string]} dir [the service's folder]
 * @param  {[object]} env [settings on top of this test's]
 * @param  {[string]} ready [text it prints once it's listening]
 * @return {[object]} service [{ stop(): the SIGTERM, kill(): ends it for good, exited: resolves with { code, signal } }]
 */
async function startService(dir, env, ready) {
	const child = spawn(process.execPath, ["index.js"], { cwd: dir, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
	let printed = "";
	child.stderr.on("data", (chunk) => { printed += chunk; });
	const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
	await new Promise((resolve, reject) => {
		child.stdout.on("data", (chunk) => { printed += chunk; if (printed.includes(ready)) { resolve(); } });
		exited.then(() => reject(new Error(`${dir} exited before it was listening: ${printed}`)));
	});
	return { stop: () => child.kill("SIGTERM"), kill: () => child.kill("SIGKILL"), exited };
}

/**
 * @description A stand-in for what a service calls: answers every request with this JSON once let go. Before release() each one waits
 * @param  {[object]} answer [the JSON]
 * @return {[object]} standIn [{ url, waitFor(n): resolves once n requests have arrived, release(), close() }]
 */
async function startStandIn(answer) {
	let seen = 0;
	let released = false;
	const held = [];
	const waiting = [];
	const server = http.createServer((req, res) => {
		req.resume();
		const reply = () => {
			res.setHeader("Content-Type", "application/x-amz-json-1.0");
			res.end(JSON.stringify(answer));
		};
		seen += 1;
		waiting.filter((wait) => seen >= wait.count).forEach((wait) => wait.resolve());
		if (released) { reply(); } else { held.push(reply); }
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		waitFor: (count) => new Promise((resolve) => { if (seen >= count) { resolve(); } else { waiting.push({ count, resolve }); } }),
		release: () => { released = true; held.splice(0).forEach((reply) => reply()); },
		close: () => { server.closeAllConnections(); server.close(); }
	};
}

/**
 * @description Resolves after ms
 */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


module.exports = { freePort, startService, startStandIn, wait };
