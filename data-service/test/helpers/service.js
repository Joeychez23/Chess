/*
 *  service.js  --  data service tests
 *	Test Data Service
 *  Starts the data service on a random local port with the in-memory tables, and calls it the way the chess server does:
 *  signed with DATA_SERVICE_SECRET, for a signed in player (their access token in X-Player-Token) or a guest (their guest_game token in X-Guest-Game)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");
const fakeDynamo = require("./fakeDynamo.js");
const keys = require("./keys.js");
const { sign, HEADERS } = require("../../utils/signature.js");

let baseUrl;

/* ---------------------------------------------------------------- */
// Start
/* ---------------------------------------------------------------- */
/**
 * @description Starts the data service on 127.0.0.1 with the in-memory tables
 * @return {[object]} server [call .close() when the tests are done]
 */
async function start() {
	fakeDynamo.install();
	const app = require("../../index.js");
	const server = app.listen(0, "127.0.0.1");
	await new Promise((resolve) => server.once("listening", resolve));
	baseUrl = `http://127.0.0.1:${server.address().port}`;
	return server;
}

/**
 * @description Clears the tables between tests
 */
function reset() {
	fakeDynamo.reset();
}

/* ---------------------------------------------------------------- */
// Players
/* ---------------------------------------------------------------- */
/**
 * @description A signed in player, the session user their access token holds
 * @param  {[string]} name [e.g. "alice", also their player id]
 * @return {[object]} player [{ id, user }]
 */
function player(name) {
	return { id: name, user: { user_id: `auth0|${name}`, email: `${name}@test`, email_verified: true, user_metadata: { screenname: name[0].toUpperCase() + name.slice(1) } } };
}

/**
 * @description A session token like the data service signs (utils/tokens.js)
 * @param  {[object]} user [session user]
 * @param  {[object]} options [{ type: "access" (default) or "refresh", key: "stranger" (nobody's key), expired: true, algorithm: "HS256" or "none", ... (helpers/keys.js) }]
 * @return {[string]} token
 */
const sessionToken = (user, options) => keys.sessionToken(user, options);

/**
 * @description A guest_game token like the data service signs for a guest's game (newGuestGame)
 * @param  {[string]} gameId [the guest's game id, also their player id]
 * @return {[string]} token
 */
const guestCookie = (gameId, options) => keys.guestToken(gameId, options);

/* ---------------------------------------------------------------- */
// Requests
/* ---------------------------------------------------------------- */
/**
 * @description The signature headers the chess server sends for this method, path & body. A test can sign something else to check it's refused
 * @param  {[object]} options [{ unsigned: no headers, secret: another secret, timestamp (epoch ms), requestId,
 * signMethod / signPath / signBody: sign these instead of what's sent }]
 * @return {[object]} headers
 */
function signatureHeaders(method, path, body, options = {}) {
	if (options.unsigned) { return {}; }
	const timestamp = `${options.timestamp || Date.now()}`;
	const requestId = options.requestId || crypto.randomBytes(16).toString("base64url");
	const signed = { method: options.signMethod || method, path: options.signPath || path, timestamp, requestId, body: options.signBody !== undefined ? options.signBody : body || "" };
	return { [HEADERS.timestamp]: timestamp, [HEADERS.requestId]: requestId, [HEADERS.signature]: sign(options.secret || process.env.DATA_SERVICE_SECRET, signed) };
}

/**
 * @description Calls the data service like the chess server does
 * @param  {[string]} method ["GET" or "POST"]
 * @param  {[string]} path [e.g. "/games/game1/move"]
 * @param  {[object]} options [{ as: a player, guest: a guest's game id, token: a raw X-Player-Token, cookie: a raw X-Guest-Game,
 * body: sent as JSON, raw: a body string sent as is, type: raw's Content-Type (default application/json),
 * signature: headers to send as they are (a replay), plus signatureHeaders' options }]
 * @return {[object]} response [{ http: the HTTP status, ...the JSON body }]
 */
async function call(method, path, options = {}) {
	const headers = {};
	if (options.as) { fakeDynamo.signIn(options.as.id); headers["X-Player-Token"] = sessionToken(options.as.user); } // SIGNED IN: THEIR ROW HAS THE TOKEN'S SESSION ID
	if (options.token) { headers["X-Player-Token"] = options.token; }
	if (options.guest) { headers["X-Guest-Game"] = guestCookie(options.guest); }
	if (options.cookie) { headers["X-Guest-Game"] = options.cookie; }
	let body;
	if (options.body !== undefined) { body = JSON.stringify(options.body); headers["Content-Type"] = "application/json"; }
	if (options.raw !== undefined) { body = options.raw; headers["Content-Type"] = options.type || "application/json"; }
	Object.assign(headers, options.signature || signatureHeaders(method, path, body, options)); // SIGNED LIKE THE CHESS SERVER SIGNS
	const res = await fetch(`${baseUrl}${path}`, { method, headers, body });
	return { http: res.status, ...(await res.json()) };
}


module.exports = { start, reset, player, sessionToken, guestCookie, signatureHeaders, call, peek: fakeDynamo.peek, signIn: fakeDynamo.signIn, failBatchReads: fakeDynamo.failBatchReads };
