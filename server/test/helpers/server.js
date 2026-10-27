/*
 *  server.js  --  chess server tests
 *	Test Server
 *  Starts the real /api routes & page routes on a random local port, and the real data service (data-service/) next to it on the
 *  in-memory tables, so every test goes server -> data service -> tables like the live site. The server's other calls out
 *  (Auth0 and the Stockfish engine API) are answered from test data instead of the network
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const http = require("http");
const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const fakeDynamo = require("../../../data-service/test/helpers/fakeDynamo.js"); // THE DATA SERVICE'S TABLES (IT'S THE ONLY CODE WITH DYNAMODB)
const config = require("../../config");
const { playerContext, dataServiceDown } = require("../../dataClient.js");
const { resetLimits } = require("../../middleware/rateLimit.js");

const realFetch = globalThis.fetch;
const auth0Users = new Map(); // EMAIL -> AUTH0 USER, WHAT getAuth0User FINDS
const engineMoves = []; // QUEUED ENGINE ANSWERS: { from, to, promotion }, THE ENGINE IS "DOWN" WHEN IT'S EMPTY
const guestCookies = new Map(); // GUEST BROWSER NAME -> ITS guest_game COOKIE, LIKE A BROWSER KEEPS IT
let baseUrl;

/* ---------------------------------------------------------------- */
// Start
/* ---------------------------------------------------------------- */
/**
 * @description Starts the data service (on the in-memory tables) & the API on 127.0.0.1, with the stand-in Auth0 & engine
 * @return {[object]} server [call .close() when the tests are done, it closes the data service too]
 */
async function start() {
	fakeDynamo.install();
	globalThis.fetch = standInFetch;

	const dataService = require("../../../data-service/index.js").listen(0, "127.0.0.1");
	await new Promise((resolve) => dataService.once("listening", resolve));
	config.dataServiceUrl = `http://127.0.0.1:${dataService.address().port}`; // dataClient.js READS IT ON EVERY CALL

	const app = express();
	app.set("trust proxy", "loopback"); // SAME AS index.js, A TEST'S X-Forwarded-For IS THE PLAYER'S ADDRESS
	app.use(cookieParser());
	app.use(express.json());
	app.use(playerContext); // SAME AS index.js
	app.use("/api", require("../../routes/api"));
	app.use(require("../../routes/pageRoutes.js")); // THE PAGES' REDIRECTS (A PAGE ITSELF NEEDS client/dist, WHICH THE SERVER TESTS DON'T BUILD)
	app.use(dataServiceDown);

	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	baseUrl = `http://127.0.0.1:${server.address().port}`;
	const close = server.close.bind(server);
	server.close = (done) => { dataService.close(); return close(done); };
	return server;
}

/**
 * @description Clears the tables, the Auth0 users, the engine's queue, the guests' cookies and the new game limits between tests
 */
function reset() {
	fakeDynamo.reset();
	auth0Users.clear();
	engineMoves.length = 0;
	guestCookies.clear();
	resetLimits();
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
 * @param  {[object]} options [{ as: a player (left out = guest), guest: which guest browser (left out = "guest", each keeps its own guest_game cookie),
 * body, cookie: a raw Cookie header (no guest cookie), ip: the player's address (X-Forwarded-For, like nginx sends) }]
 * @return {[object]} response [{ http: the HTTP status, retry_after: the Retry-After header, ...the JSON body }]
 */
async function call(method, path, options = {}) {
	const headers = { "Content-Type": "application/json" };
	const guest = options.as || options.cookie ? null : options.guest || "guest";
	if (options.as) { headers.Cookie = sessionCookie(options.as.user); }
	if (options.cookie) { headers.Cookie = options.cookie; }
	if (guest && guestCookies.has(guest)) { headers.Cookie = guestCookies.get(guest); }
	if (options.ip) { headers["X-Forwarded-For"] = options.ip; }
	const res = await realFetch(`${baseUrl}${path}`, { method, headers, body: options.body ? JSON.stringify(options.body) : undefined });
	const guestCookie = res.headers.getSetCookie().find((cookie) => cookie.startsWith("guest_game="));
	if (guest && guestCookie) { guestCookies.set(guest, guestCookie.split(";")[0]); }
	return { http: res.status, retry_after: res.headers.get("retry-after"), ...(await res.json()) };
}

/**
 * @description Opens a page like a browser, without following a redirect
 * @param  {[string]} path [e.g. "/"]
 * @param  {[object]} options [{ as: a player (left out = guest) }]
 * @return {[object]} response [{ http: the HTTP status, location: where a redirect goes (null when it sent the page) }]
 */
async function page(path, options = {}) {
	const headers = options.as ? { Cookie: sessionCookie(options.as.user) } : {};
	const res = await realFetch(`${baseUrl}${path}`, { headers, redirect: "manual" });
	await res.arrayBuffer(); // THE BODY ISN'T NEEDED
	return { http: res.status, location: res.headers.get("location") };
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


module.exports = { start, reset, player, call, page, engineWillPlay, peek: fakeDynamo.peek };
