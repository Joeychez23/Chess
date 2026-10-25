/*
 *  server.js  --  chess server tests
 *	Test Server
 *  Starts the real /api routes on a random local port with the in-memory tables, and answers the server's own calls
 *  out (Auth0 and the Stockfish engine API) from test data instead of the network
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const http = require("http");
const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const fakeDynamo = require("./fakeDynamo.js");

const realFetch = globalThis.fetch;
const auth0Users = new Map(); // EMAIL -> AUTH0 USER, WHAT getAuth0User FINDS
const engineMoves = []; // QUEUED ENGINE ANSWERS: { from, to, promotion }, THE ENGINE IS "DOWN" WHEN IT'S EMPTY
let baseUrl;

/* ---------------------------------------------------------------- */
// Start
/* ---------------------------------------------------------------- */
/**
 * @description Starts the API on 127.0.0.1 with the in-memory tables and the stand-in Auth0 & engine
 * @return {[object]} server [call .close() when the tests are done]
 */
async function start() {
	fakeDynamo.install();
	globalThis.fetch = standInFetch;

	const app = express();
	app.use(cookieParser());
	app.use(express.json());
	app.use("/api", require("../../routes/api"));

	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	baseUrl = `http://127.0.0.1:${server.address().port}`;
	return server;
}

/**
 * @description Clears the tables, the Auth0 users and the engine's queue between tests
 */
function reset() {
	fakeDynamo.reset();
	auth0Users.clear();
	engineMoves.length = 0;
}

/* ---------------------------------------------------------------- */
// Players
/* ---------------------------------------------------------------- */
/**
 * @description A signed in player: their session user, and an Auth0 account so friends can invite them by email
 * @param  {[string]} name [e.g. "alice", also their player id]
 * @return {[object]} player [{ id, email, user }]
 */
function player(name) {
	const user = { user_id: `auth0|${name}`, email: `${name}@test`, email_verified: true, user_metadata: { screenname: name[0].toUpperCase() + name.slice(1) } };
	auth0Users.set(user.email, { ...user, identities: [{ connection: process.env.AUTH0_CONNECTION }] });
	return { id: name, email: user.email, user };
}

/**
 * @description The access cookie a signed in player's browser sends (same shape as middleware/auth.js signs)
 */
function sessionCookie(user) {
	const token = jwt.sign({ type: "access", user }, process.env.JWT_SECRET, { expiresIn: "15m", algorithm: "HS256" });
	return `access_token=${token}`;
}

/* ---------------------------------------------------------------- */
// Requests
/* ---------------------------------------------------------------- */
/**
 * @description Calls the API like the client does
 * @param  {[string]} method ["GET", "POST", "PUT"]
 * @param  {[string]} path [e.g. "/api/chess/levels"]
 * @param  {[object]} options [{ as: a player (left out = guest), body, cookie: a raw Cookie header }]
 * @return {[object]} response [{ http: the HTTP status, ...the JSON body }]
 */
async function call(method, path, options = {}) {
	const headers = { "Content-Type": "application/json" };
	if (options.as) { headers.Cookie = sessionCookie(options.as.user); }
	if (options.cookie) { headers.Cookie = options.cookie; }
	const res = await realFetch(`${baseUrl}${path}`, { method, headers, body: options.body ? JSON.stringify(options.body) : undefined });
	return { http: res.status, ...(await res.json()) };
}

/**
 * @description Queues the engine's next answer, the server's next AI move
 * @param  {[string]} from [e.g. "e7"]
 * @param  {[string]} to [e.g. "e5"]
 */
function engineWillPlay(from, to, promotion) {
	engineMoves.push({ from, to, promotion });
}

/* ---------------------------------------------------------------- */
// Stand-in Auth0 & Engine
/* ---------------------------------------------------------------- */
/**
 * @description Answers fetch for the Auth0 tenant and the engine API from the test data, everything else goes out as normal (the test's own requests)
 */
async function standInFetch(url, options) {
	const { hostname, pathname, searchParams } = new URL(url);
	const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

	if (hostname == "auth0.test" && pathname == "/oauth/token") { return json({ access_token: "management-token", expires_in: 86400 }); }
	if (hostname == "auth0.test" && pathname == "/api/v2/users-by-email") {
		const user = auth0Users.get(searchParams.get("email"));
		return json(user ? [user] : []);
	}
	if (hostname == "engine.test") {
		const move = engineMoves.shift();
		if (!move) { throw new Error("engine.test is down"); } // NOTHING QUEUED: THE SERVER FALLS BACK TO js-chess-engine
		return json({ type: "bestmove", ...move });
	}
	return realFetch(url, options);
}


module.exports = { start, reset, player, call, engineWillPlay, peek: fakeDynamo.peek };
