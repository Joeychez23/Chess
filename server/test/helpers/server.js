/*
 *  server.js  --  chess server tests
 *	Test Server
 *  Starts the real /api routes & page routes on a random local port, and the real data service (data-service/) next to it on the
 *  in-memory tables, so every test goes server -> data service -> tables like the live site. The server's other calls out
 *  (Auth0 and the Stockfish engine API) are answered from test data instead of the network. Socket.IO runs on the API like index.js, listen() hears what a player's tabs get
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
const { io: connect } = require("socket.io-client");
const { playerContext, dataServiceDown } = require("../../dataClient.js");
const { initSocket } = require("../../socket.js");
const { resetLimits } = require("../../middleware/rateLimit.js");
const { resetHealth } = require("../../utils/health.js");

const realFetch = globalThis.fetch;
const auth0Users = new Map(); // EMAIL -> AUTH0 USER, WHAT getAuth0User FINDS
const auth0Passwords = new Map(); // EMAIL -> PASSWORD, ONLY THE PASSWORD GRANT USES THIS
const auth0LoginRequests = []; // PASSWORD-REALM REQUESTS (HEADERS + BODY)
const auth0SignupRequests = []; // /dbconnections/signup BODIES
const auth0Blocks = []; // QUEUED AUTH0 TOO_MANY_ATTEMPTS ANSWERS
const auth0Stalls = []; // AUTH0 CALLS WHOSE NEXT ANSWER NEVER ARRIVES: { path, grant } (auth0WillStall)
let engineRequests = 0; // ENGINE API REQUESTS SINCE THE LAST reset()
const engineMoves = []; // QUEUED ENGINE ANSWERS: { from, to, promotion }, THE ENGINE IS "DOWN" WHEN IT'S EMPTY
const guestCookies = new Map(); // GUEST BROWSER NAME -> ITS guest_game COOKIE, LIKE A BROWSER KEEPS IT
const auth0IdTokens = []; // QUEUED id_token MAKERS FOR THE NEXT LOGINS (auth0WillSign), A REAL ONE WHEN IT'S EMPTY
const dataServiceAnswers = []; // QUEUED DATA SERVICE ANSWERS: { path, status, message } (dataServiceWillAnswer), THE REAL DATA SERVICE WHEN NONE MATCHES
const dataServiceStalls = []; // DATA SERVICE PATHS WHOSE NEXT ANSWER NEVER ARRIVES, AFTER THE DATA SERVICE DID THE WORK (dataServiceWillStall)
const sockets = []; // listen()'S CLIENTS, CLOSED BY reset()
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
	app.disable("x-powered-by"); // SAME AS index.js
	app.use(require("../../middleware/logServerErrors.js").logServerErrors); // SAME AS index.js
	app.use(require("../../middleware/securityHeaders.js").securityHeaders); // SAME AS index.js
	app.set("trust proxy", "loopback"); // SAME AS index.js, A TEST'S X-Forwarded-For IS THE PLAYER'S ADDRESS
	app.use(cookieParser());
	app.use(express.json());
	app.use(playerContext); // SAME AS index.js
	app.use("/api", require("../../routes/api"));
	app.use(require("../../routes/pageRoutes.js")); // THE PAGES' REDIRECTS (A PAGE ITSELF NEEDS client/dist, WHICH THE SERVER TESTS DON'T BUILD)
	app.use(dataServiceDown);

	const server = http.createServer(app);
	initSocket(server); // SAME AS index.js
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	baseUrl = `http://127.0.0.1:${server.address().port}`;
	const close = server.close.bind(server);
	server.close = (done) => { dataService.close(); return close(done); };
	return server;
}

/**
 * @description Clears the tables, the Auth0 users & id_tokens, the engine's & data service's queues, the guests' cookies and the new game limits between tests
 */
function reset() {
	fakeDynamo.reset();
	auth0Users.clear();
	auth0Passwords.clear();
	auth0LoginRequests.length = 0;
	auth0SignupRequests.length = 0;
	auth0Blocks.length = 0;
	auth0Stalls.length = 0;
	engineMoves.length = 0;
	engineRequests = 0;
	guestCookies.clear();
	auth0IdTokens.length = 0;
	dataServiceAnswers.length = 0;
	dataServiceStalls.length = 0;
	sockets.splice(0).forEach((socket) => socket.disconnect());
	resetLimits();
	resetHealth();
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
	fakeDynamo.signIn(user.user_id.split("auth0|")[1]); // SIGNED IN: THEIR ROW HAS THE TOKEN'S SESSION ID
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
 * @return {[object]} response [{ http, headers, location, retry_after, cookies: { name: value } set by the response ("" = cleared), body: the JSON body or null }]
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
	return { http: res.status, headers: res.headers, location: res.headers.get("location"), retry_after: res.headers.get("retry-after"), cookies: set, body: text.startsWith("{") ? JSON.parse(text) : null };
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
 * @description A player's tab: a Socket.IO client signed in as them, recording every event it gets
 * @param  {[object]} who [a player]
 * @param  {[string]} gameId [a game to join (its room's events), left out = only Home's]
 * @param  {[object]} options [{ cookie: a raw Cookie header instead of their access cookie, headers: more handshake headers (Origin) }]
 * @return {[object]} tab [{ events: [{ event, data }], heard(event): resolves with the event's data once it's got,
 * closed: resolves with the disconnect reason, join(gameId): join-game's answer }]
 */
async function listen(who, gameId, options = {}) {
	const Cookie = options.cookie || sessionCookie(who.user);
	const socket = connect(baseUrl, { transports: ["websocket"], extraHeaders: { Cookie, ...(options.headers || {}) }, reconnection: false });
	sockets.push(socket);
	const events = [];
	const waiting = [];
	const closed = new Promise((resolve) => socket.once("disconnect", resolve));
	socket.onAny((event, data) => {
		events.push({ event, data });
		waiting.filter((wait) => wait.event == event).forEach((wait) => { waiting.splice(waiting.indexOf(wait), 1); wait.resolve(data); });
	});
	await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
	const join = (id) => socket.emitWithAck("join-game", id);
	if (gameId) { await join(gameId); }
	const heard = (event) => {
		const got = events.find((seen) => seen.event == event);
		return got ? Promise.resolve(got.data) : new Promise((resolve) => waiting.push({ event, resolve }));
	};
	return { events, heard, closed, join };
}

/**
 * @description Queues the engine's next answer, the server's next AI move
 * @param  {[string]} from [e.g. "e7"]
 * @param  {[string]} to [e.g. "e5"]
 * @param  {[string]} promotion [optional, e.g. "q"]
 * @param  {[Promise]} wait [optional, the engine answers once it settles]
 */
function engineWillPlay(from, to, promotion, wait) {
	engineMoves.push({ from, to, promotion, wait });
}

/**
 * @description How many times the server asked the engine API since the last reset()
 */
function engineCalls() {
	return engineRequests;
}

/* ---------------------------------------------------------------- */
// Stand-in Auth0 & Engine
/* ---------------------------------------------------------------- */
/**
 * @description Answers fetch for the Auth0 tenant and the engine API from the test data, and a data service request a test queued an answer for,
 * everything else goes out as normal (the test's own requests & the real data service)
 */
async function standInFetch(url, options) {
	const { hostname, pathname, searchParams } = new URL(url);
	const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

	if (hostname == "auth0.test") {
		const grant = pathname == "/oauth/token" ? JSON.parse(options.body).grant_type : undefined;
		const stalled = auth0Stalls.findIndex((stall) => stall.path == pathname && stall.grant == grant);
		if (stalled != -1) {
			auth0Stalls.splice(stalled, 1);
			return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason))); // NO ANSWER COMES, THE CALLER TIMES OUT
		}
	}
	if (hostname == "auth0.test" && pathname == "/oauth/token") {
		const result = await auth0Token(JSON.parse(options.body), options);
		return json(result.body, result.status);
	}
	if (hostname == "auth0.test" && pathname == "/dbconnections/signup") {
		const result = auth0Signup(JSON.parse(options.body));
		return json(result.body, result.status);
	}
	if (hostname == "auth0.test" && pathname == "/api/v2/users-by-email") {
		const user = auth0Users.get(searchParams.get("email"));
		return json(user ? [user] : []);
	}
	if (url.startsWith(config.dataServiceUrl)) {
		const queued = dataServiceAnswers.findIndex((answer) => answer.path == pathname);
		if (queued != -1) {
			const [answer] = dataServiceAnswers.splice(queued, 1);
			return json({ status: answer.status, message: answer.message }, answer.status);
		}
		const stalled = dataServiceStalls.indexOf(pathname);
		if (stalled != -1) {
			dataServiceStalls.splice(stalled, 1);
			const res = await realFetch(url, { ...options, signal: undefined }); // THE DATA SERVICE DOES THE WORK & SAVES
			await res.arrayBuffer();
			return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason))); // ITS ANSWER NEVER COMES, THE CALLER TIMES OUT
		}
	}
	if (hostname == "engine.test") {
		engineRequests++;
		const queued = engineMoves.shift();
		if (!queued) { throw new Error("engine.test is down"); } // NOTHING QUEUED: THE SERVER FALLS BACK TO js-chess-engine
		const { wait, ...move } = queued;
		if (wait) { await wait; } // THE ENGINE IS STILL THINKING UNTIL THE TEST LETS IT ANSWER
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
		return { body: { access_token: "auth0-access-token", id_token: (auth0IdTokens.shift() || keys.idToken)({ sub: user.user_id, email: user.email, email_verified: user.email_verified }), expires_in: 86400 }, status: 200 };
	}
	if (body.grant_type != "authorization_code") { return { body: { access_token: "management-token", expires_in: 86400 }, status: 200 }; }
	const user = auth0Users.get(body.code);
	if (!user) { throw new Error("invalid_grant"); }
	return { body: { access_token: "auth0-access-token", id_token: (auth0IdTokens.shift() || keys.idToken)({ sub: user.user_id, email: user.email }), expires_in: 86400 }, status: 200 };
}

/**
 * @description Auth0's /dbconnections/signup: makes an unverified user, unless the email is taken or the password is "weak"
 * @param  {[object]} body [{ client_id, connection, email, password, user_metadata }]
 * @return {[object]} response [{ body, status }]
 */
function auth0Signup(body) {
	auth0SignupRequests.push(body);
	if (auth0Users.has(body.email)) { return { body: { code: "invalid_signup", description: "Invalid sign up" }, status: 400 }; }
	if (body.password == "weak") { return { body: { name: "PasswordStrengthError", code: "invalid_password", message: "Password is too weak", description: { rules: [] } }, status: 400 }; }
	const user = { user_id: `auth0|${body.email.split("@")[0]}`, email: body.email, email_verified: false, user_metadata: body.user_metadata, identities: [{ connection: body.connection }] };
	auth0Users.set(body.email, user);
	auth0Passwords.set(body.email, body.password);
	return { body: { _id: body.email, email: body.email, email_verified: false }, status: 200 };
}

/**
 * @description The next password login is blocked by Auth0's brute-force protection (too_many_attempts)
 */
function auth0WillBlock() {
	auth0Blocks.push(true);
}

/**
 * @description Auth0's next answer to this call never arrives, the caller times out (#365)
 * @param  {[string]} path [Auth0 path, "/oauth/token" or "/api/v2/users-by-email"]
 * @param  {[string]} grant [/oauth/token's grant_type]
 */
function auth0WillStall(path, grant) {
	auth0Stalls.push({ path, grant });
}

/**
 * @description The password logins Auth0 was asked for: [{ headers, body }]
 */
function auth0Logins() {
	return auth0LoginRequests;
}

/**
 * @description The signups Auth0 was asked for: [body]
 */
function auth0Signups() {
	return auth0SignupRequests;
}

/**
 * @description The next login's id_token is made by this instead (a forged one)
 * @param  {[function]} make [(claims) => id_token]
 */
function auth0WillSign(make) {
	auth0IdTokens.push(make);
}

/**
 * @description The data service's next answer to this path is this refusal instead (a 404 "No such action" while the two instances run different code)
 * @param  {[string]} path [data service path, "/session/refresh"]
 * @param  {[number]} status [HTTP status]
 * @param  {[string]} message [refusal message]
 */
function dataServiceWillAnswer(path, status, message) {
	dataServiceAnswers.push({ path, status, message });
}

/**
 * @description The data service's next answer to this path comes too late: it saves, then the caller times out (a throttled DynamoDB, #281)
 * @param  {[string]} path [data service path, "/games/<id>/move"]
 */
function dataServiceWillStall(path) {
	dataServiceStalls.push(path);
}


module.exports = { start, reset, player, call, send, page, engineWillPlay, engineCalls, auth0WillSign, auth0WillBlock, auth0WillStall, auth0Logins, auth0Signups, dataServiceWillAnswer, dataServiceWillStall, listen, peek: fakeDynamo.peek };
