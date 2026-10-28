/*
 *  sessionController.js  --  data service
 *	Session Routes (#252)
 *  A signed in player's tokens are only made here, never on the chess server: login (from the id_token Auth0 gave the chess server),
 *  refresh (from their refresh token) & logout. The session id on their user_db row ends every session at once:
 *  logout & Delete my data clear it, and a refresh token with a session id that's gone is refused
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { startSession, endSession, retrieveUser } = require("../dynamoDB.js");
const { readSessionToken } = require("../utils/sessionKeys.js");
const { sessionTokens } = require("../utils/tokens.js");
const { refuse } = require("../utils/refuse.js");

const ID_TOKEN_AGE = 5 * 60; // SECONDS: LOGIN COMES RIGHT AFTER THE CHESS SERVER'S CODE EXCHANGE, AN OLDER id_token WAS KEPT & REPLAYED
const CLOCK_LEEWAY = 30; // SECONDS OF CLOCK DRIFT BETWEEN AUTH0 & THIS INSTANCE
const usedIdTokens = new Map(); // SHA-256 OF AN id_token -> WHEN IT CAN BE FORGOTTEN (EPOCH MS): EACH ONE STARTS ONE SESSION, THEN IT'S TOO OLD ANYWAY

/* ---------------------------------------------------------------- */
// Login (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Signs a player in from the id_token Auth0 gave the chess server (exchangeCode). The id_token is checked against Auth0's keys
 * (RS256, our tenant, our client, not expired, at most 5 minutes old & used once), and the user the chess server found (getAuth0User)
 * must be the one it names. Only then are the session tokens signed
 * @param  {[object]} req.body [{ id_token, user: { user_id, email, user_metadata: { screenname, first_name, last_name } } }]
 * @return {[object]} response [{ status: 200, access_token, refresh_token, message } | 401 (a bad id_token, or not its user)]
 */
async function login(req, res) {
	const { id_token, user } = req.body || {};
	if (typeof id_token != "string" || !user || typeof user != "object") { return refuse(req, res, 400, "id_token & user are required"); }

	const claims = readIdToken(id_token);
	if (claims.reason) { return refuse(req, res, 401, `Bad id token: ${claims.reason}`); }
	if (typeof user.user_id != "string" || user.user_id != claims.sub || !playerId(user.user_id)) { return refuse(req, res, 401, "Bad id token: not this user"); } // ONLY OUR CONNECTION'S USERS (auth0|)
	if (typeof user.email != "string" || typeof claims.email != "string" || user.email.toLowerCase() != claims.email.toLowerCase()) { return refuse(req, res, 401, "Bad id token: not this email"); }

	const session = await startSession(playerId(user.user_id));
	return res.json({ status: 200, ...sessionTokens(sessionUser(user, claims), session.sid), message: "Signed in" });
}

/**
 * @description Checks an id_token against Auth0's saved keys & marks it used
 * @param  {[string]} idToken [Auth0's id_token, a JWT]
 * @return {[object]} claims [the id_token's claims (sub, email, ...) | { reason } when it's refused]
 */
function readIdToken(idToken) {
	const kid = jwt.decode(idToken, { complete: true })?.header?.kid;
	const key = config.auth0Keys.get(kid);
	if (!key) { return { reason: "unknown key (save Auth0's keys again, data-service/README.md -> Saving Auth0's keys)" }; }

	let claims;
	try {
		claims = jwt.verify(idToken, key, { algorithms: ["RS256"], issuer: `https://${config.auth0Domain}/`, audience: config.auth0ClientId, maxAge: ID_TOKEN_AGE, clockTolerance: CLOCK_LEEWAY });
	} catch (err) {
		return { reason: err.message.split(". expected")[0] }; // E.G. "jwt audience invalid", WITHOUT THE VALUE IT WANTED
	}

	const now = Date.now();
	forgetOld(now);
	const hash = crypto.createHash("sha256").update(idToken).digest("base64url");
	if (usedIdTokens.has(hash)) { return { reason: "already used" }; }
	usedIdTokens.set(hash, (claims.iat + ID_TOKEN_AGE + CLOCK_LEEWAY) * 1000);
	return claims;
}

/**
 * @description Drops the used id_tokens that are now too old to be accepted anyway
 * @param  {[number]} now [epoch ms]
 */
function forgetOld(now) {
	for (const [hash, until] of usedIdTokens) {
		if (until < now) { usedIdTokens.delete(hash); }
	}
}

/**
 * @description The user the tokens hold, only the fields the game reads. email_verified comes from the checked id_token
 * @param  {[object]} user [the chess server's sessionUser(getAuth0User())]
 * @param  {[object]} claims [the checked id_token's claims]
 * @return {[object]} user [{ user_id, email, email_verified, user_metadata: { screenname, first_name, last_name } }]
 */
function sessionUser(user, claims) {
	const text = (value) => typeof value == "string" ? value : undefined;
	return {
		user_id: user.user_id,
		email: user.email,
		email_verified: claims.email_verified === true,
		user_metadata: {
			screenname: text(user.user_metadata?.screenname),
			first_name: text(user.user_metadata?.first_name),
			last_name: text(user.user_metadata?.last_name)
		}
	};
}

/* ---------------------------------------------------------------- */
// Refresh (POST)
/* ---------------------------------------------------------------- */
/**
 * @description A new access & refresh token from a refresh token, while its session id is still the one on the player's row
 * @param  {[object]} req.body [{ refresh_token }]
 * @return {[object]} response [{ status: 200, access_token, refresh_token, message } | 401 (a bad refresh token, or the session ended)]
 */
async function refresh(req, res) {
	const payload = readRefreshToken(req.body?.refresh_token);
	if (!payload) { return refuse(req, res, 401, "Bad refresh token"); }
	const user = await retrieveUser(playerId(payload.user.user_id), true); // CONSISTENT: A LOGOUT THAT JUST HAPPENED COUNTS
	if (user.user_data?.sid?.S != payload.sid) { return refuse(req, res, 401, "Session ended"); }
	return res.json({ status: 200, ...sessionTokens(payload.user, payload.sid), message: "Session refreshed" });
}

/* ---------------------------------------------------------------- */
// Logout (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Ends the player's session on every device (clears the session id on their row). A refresh token from a session that
 * already ended changes nothing, so it can't sign them out of the one they've logged in to since
 * @param  {[object]} req.body [{ refresh_token }]
 * @return {[object]} response [{ status: 200, message } | 401 (a bad refresh token)]
 */
async function logout(req, res) {
	const payload = readRefreshToken(req.body?.refresh_token);
	if (!payload) { return refuse(req, res, 401, "Bad refresh token"); }
	return res.json(await endSession(playerId(payload.user.user_id), payload.sid));
}

/**
 * @description A refresh token this service signed (either key while it's being changed), for one of our connection's users
 * @return {[object]} payload [{ type, user, sid } | null]
 */
function readRefreshToken(token) {
	const payload = readSessionToken(token, "refresh", config.sessionPublicKeys);
	if (!payload || typeof payload.sid != "string" || typeof payload.user?.user_id != "string" || !playerId(payload.user.user_id)) { return null; }
	return payload;
}

/**
 * @description A player's id: their Auth0 user id without "auth0|" (like middleware/player.js)
 * @return {[string]} playerId [null when it isn't one of our connection's users]
 */
function playerId(userId) {
	return userId.startsWith("auth0|") ? userId.split("auth0|")[1] || null : null;
}


module.exports = { login, refresh, logout };
