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
const fakeDynamo = require("../../../data-service/test/helpers/fakeDynamo.js"); // THE DATA SERVICE'S TABLES (IT'S THE ONLY CODE WITH DYNAMODB)
const keys = require("../../../data-service/test/helpers/keys.js"); // THE TEST RUN'S SESSION KEYS & THE STAND-IN AUTH0 KEY
const config = require("../../config");
const { playerContext, dataServiceDown } = require("../../dataClient.js");
const { resetLimits } = require("../../middleware/rateLimit.js");

const realFetch = globalThis.fetch;
const auth0Users = new Map(); // EMAIL -> AUTH0 USER, WHAT getAuth0User FINDS
const auth0Passwords = new Map(); // EMAIL -> PASSWORD, ONLY THE PASSWORD GRANT USES THIS
const auth0LoginRequests = []; // PASSWORD-REALM REQUESTS (HEADERS + BODY)
const auth0Blocks = []; // QUEUED AUTH0 TOO_MANY_ATTEMPTS ANSWERS
const engineMoves = []; // QUEUED ENGINE ANSWERS: { from, to, promotion }, THE ENGINE IS "DOWN" WHEN IT'S EMPTY
const guestCookies = new Map(); // GUEST BROWSER NAME -> ITS guest_game COOKIE, LIKE A BROWSER KEEPS IT
const auth0IdTokens = []; // QUEUED id_token MAKERS FOR THE NEXT LOGINS (auth0WillSign), A REAL ONE WHEN IT'S EMPTY
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
 * @description Clears the tables, the Auth0 users & id_tokens, the engine's queue, the guests' cookies and the new game limits between tests
 */
function reset() {
	fakeDynamo.reset();
	auth0Users.clear();
	auth0Passwords.clear();
	auth0LoginRequests.length = 0;
	auth0Blocks.length = 0;
	engineMoves.length = 0;
	guestCookies.clear();
	auth0IdTokens.length = 0;
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
	const password = `${name}-password`;
	auth0Passwords.set(user.email, password);
	return { id: name, email: user.email, password, user };
}

/**
 * @description The access cookie a signed in player's browser sends (signed like the data service signs it, utils/tokens.js)
 */
function sessionCookie(user) {
	return `access_token=${keys.sessionToken(user)}`;
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
 * @description Sends a request with exactly the cookies given, without following a redirect (the login & session routes)
 * @param  {[string]} method ["GET" or "POST"]
 * @param  {[string]} path [e.g. "/api/auth/refresh"]
 * @param  {[object]} cookies [{ name: value }, sent as the Cookie header]
 * @param  {[object]} options [{ headers, body: a raw body string }]
 * @return {[object]} response [{ http, location, retry_after, cookies: { name: value } set by the response ("" = cleared), body: the JSON body or null }]
 */
async function send(method, path, cookies = {}, options = {}) {
	const Cookie = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ");
	const headers = { ...(Cookie ? { Cookie } : {}), ...(options.headers || {}) };
	const res = await realFetch(`${baseUrl}${path}`, { method, headers, body: options.body, redirect: "manual" });
	const set = {};
	for (const cookie of res.headers.getSetCookie()) {
		const [pair] = cookie.split(";");
		set[pair.slice(0, pair.indexOf("="))] = decodeURIComponent(pair.slice(pair.indexOf("=") + 1));
	}
	const text = await res.text();
	return { http: res.status, location: res.headers.get("location"), retry_after: res.headers.get("retry-after"), cookies: set, body: text.startsWith("{") ? JSON.parse(text) : null };
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

	if (hostname == "auth0.test" && pathname == "/oauth/token") {
		const result = await auth0Token(JSON.parse(options.body), options);
		return json(result.body, result.status);
	}
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

/**
 * @description Auth0's /oauth/token: a Management API token, a login's code (here, the player's email) traded for their id_token,
 * or a password login (password-realm) checked against the player's password
 * @param  {[object]} body [{ grant_type, code | realm, username, password }]
 * @param  {[object]} options [the fetch options, a password login's headers are kept for auth0Logins()]
 * @return {[object]} response [{ body, status }]
 */
function auth0Token(body, options) {
	if (body.grant_type == "http://auth0.com/oauth/grant-type/password-realm") {
		auth0LoginRequests.push({ headers: options.headers, body });
		if (body.realm != process.env.AUTH0_CONNECTION) { return { body: { error: "invalid_grant", error_description: "Wrong email or password." }, status: 403 }; }
		if (auth0Blocks.shift()) { return { body: { error: "too_many_attempts" }, status: 429 }; }
		if (!auth0Users.has(body.username) || auth0Passwords.get(body.username) != body.password) { return { body: { error: "invalid_grant", error_description: "Wrong email or password." }, status: 403 }; }
		const user = auth0Users.get(body.username);
		return { body: { access_token: "auth0-access-token", id_token: (auth0IdTokens.shift() || keys.idToken)({ sub: user.user_id, email: user.email }), expires_in: 86400 }, status: 200 };
	}
	if (body.grant_type != "authorization_code") { return { body: { access_token: "management-token", expires_in: 86400 }, status: 200 }; }
	const user = auth0Users.get(body.code);
	if (!user) { throw new Error("invalid_grant"); }
	return { body: { access_token: "auth0-access-token", id_token: (auth0IdTokens.shift() || keys.idToken)({ sub: user.user_id, email: user.email }), expires_in: 86400 }, status: 200 };
}

/**
 * @description The next password login is blocked by Auth0's brute-force protection (too_many_attempts)
 */
function auth0WillBlock() {
	auth0Blocks.push(true);
}

/**
 * @description The password logins Auth0 was asked for: [{ headers, body }]
 */
function auth0Logins() {
	return auth0LoginRequests;
}

/**
 * @description The next login's id_token is made by this instead (a forged one)
 * @param  {[function]} make [(claims) => id_token]
 */
function auth0WillSign(make) {
	auth0IdTokens.push(make);
}


module.exports = { start, reset, player, call, send, page, engineWillPlay, auth0WillSign, auth0WillBlock, auth0Logins, peek: fakeDynamo.peek };
