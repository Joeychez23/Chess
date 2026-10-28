/*
 *  auth.js  --  chess server
 *	JWT Session Middleware
 *  Auth0 is only used to log in. After that the session is our own pair of JWTs:
 *  a short access token (checked on every request) and a long refresh token (used to re-up the access token).
 *  Both live in httpOnly cookies so the client never touches them.
 *  Guests get a signed cookie instead (guest_game) that says which game is theirs, and which guest they are (the new game limits).
 *  Every token is signed by the data service (#252). This server only has the public key, so it can check a token but never make one
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const jwt = require("jsonwebtoken");
const config = require("../config");
const { readSessionToken, tokenKeyId } = require("../utils/sessionKeys.js");

const ACCESS_COOKIE = "access_token";
const REFRESH_COOKIE = "refresh_token";
const REFRESH_PATH = "/api/auth"; // REFRESH TOKEN IS ONLY SENT TO THE AUTH ROUTES
const GUEST_COOKIE = "guest_game";
const GUEST_PATH = "/api/chess"; // THE GUEST COOKIE IS ONLY SENT TO THE CHESS ROUTES
const GUEST_COOKIE_AGE = 365 * 24 * 60 * 60 * 1000; // THE GAME ITSELF EXPIRES 25 DAYS AFTER ITS LAST MOVE, A COOKIE FOR A GONE GAME JUST MEANS A NEW ONE

/* ---------------------------------------------------------------- */
// Read Token
/* ---------------------------------------------------------------- */
/**
 * @description Verifies a token the data service signed, with the public key (SESSION_PUBLIC_KEY, or SESSION_PUBLIC_KEY_NEXT while it's being changed)
 * @param  {[string]} token [JWT from a cookie]
 * @param  {[string]} type ["access", "refresh" or "guest"]
 * @return {[object]} payload [{ type, user } | { type, game_id, session } | null when there is no token | undefined when it's expired or invalid]
 */
function readToken(token, type) {
	return readSessionToken(token, type, config.sessionPublicKeys);
}

/* ---------------------------------------------------------------- */
// Set Session Cookies
/* ---------------------------------------------------------------- */
/**
 * @description Sets the access + refresh token the data service signed (login and every re-up). A token this server can't read
 * isn't set: that's a key change done in the wrong order, & the player would be refused on their next request
 * @param  {[object]} res [express response]
 * @param  {[object]} tokens [{ access_token, refresh_token } from the data service]
 * @return {[object]} user [the user in the access token]
 */
function setSessionCookies(res, tokens) {
	const access = readToken(tokens.access_token, "access");
	if (!access || !readToken(tokens.refresh_token, "refresh")) { throw unreadable(tokens.access_token); }
	res.cookie(ACCESS_COOKIE, tokens.access_token, cookieOptions(tokens.access_token, "/"));
	res.cookie(REFRESH_COOKIE, tokens.refresh_token, cookieOptions(tokens.refresh_token, REFRESH_PATH));
	return access.user;
}

/* ---------------------------------------------------------------- */
// Clear Session Cookies
/* ---------------------------------------------------------------- */
/**
 * @description Removes both session cookies (logout or a bad refresh token)
 * @param  {[object]} res [express response]
 */
function clearSessionCookies(res) {
	res.clearCookie(ACCESS_COOKIE, { path: "/" });
	res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
}

/**
 * @description The options for a session cookie: http only, https in production & gone when the token expires
 * @param  {[string]} token [the JWT the cookie holds]
 * @param  {[string]} path [where the browser sends it, "/" or the refresh route]
 * @return {[object]} options [for res.cookie]
 */
function cookieOptions(token, path) {
	return {
		httpOnly: true,                             // NOT READABLE FROM CLIENT JS
		secure: config.isProduction,                // HTTPS ONLY IN PRODUCTION
		sameSite: "lax",
		path: path,
		expires: new Date(jwt.decode(token).exp * 1000) // COOKIE LIVES AS LONG AS THE TOKEN
	};
}

/**
 * @description The error for a token signed with a key this server doesn't have, answered like the data service being down (503)
 * & logged with the key's id (data-service/README.md -> Changing the session key)
 */
function unreadable(token) {
	const err = new Error(`Data service: its tokens are signed with key ${tokenKeyId(token)}, which SESSION_PUBLIC_KEY / SESSION_PUBLIC_KEY_NEXT isn't`);
	err.name = "DataServiceDown";
	return err;
}

/* ---------------------------------------------------------------- */
// Require Auth
/* ---------------------------------------------------------------- */
/**
 * @description Blocks the request unless it has a valid access token, sets req.user when it does
 */
function requireAuth(req, res, next) {
	const payload = readToken(req.cookies?.[ACCESS_COOKIE], "access");
	if (!payload) {
		return res.status(401).json({ status: 401, message: payload === undefined ? "SESSION EXPIRED" : "NOT SIGNED IN" });
	}
	req.user = payload.user;
	next();
}

/* ---------------------------------------------------------------- */
// Optional Auth
/* ---------------------------------------------------------------- */
/**
 * @description Guests (no access token) pass with req.user = null, signed in users get req.user.
 * An expired or invalid token gets a 401 so the client re-ups the session & tries again
 */
function optionalAuth(req, res, next) {
	const payload = readToken(req.cookies?.[ACCESS_COOKIE], "access");
	if (payload === undefined) {
		return res.status(401).json({ status: 401, message: "SESSION EXPIRED" });
	}
	req.user = payload ? payload.user : null;
	next();
}

/* ---------------------------------------------------------------- */
// Read Access Token
/* ---------------------------------------------------------------- */
/**
 * @description Returns the user from the access cookie, or null when it's missing / expired (Socket.IO handshake & the page routes)
 * @param  {[object]} req [request with req.cookies]
 * @return {[object]} user
 */
function readSessionUser(req) {
	const payload = readToken(req.cookies?.[ACCESS_COOKIE], "access");
	return payload ? payload.user : null;
}

/* ---------------------------------------------------------------- */
// Read Refresh Token
/* ---------------------------------------------------------------- */
/**
 * @description The refresh cookie as it was sent, the data service checks it (refresh, resume & logout)
 * @param  {[object]} req [express request]
 * @return {[string]} refreshToken [null when there's none]
 */
function readRefreshCookie(req) {
	const token = req.cookies?.[REFRESH_COOKIE];
	return typeof token == "string" && token ? token : null;
}

/* ---------------------------------------------------------------- */
// Set Guest Cookie
/* ---------------------------------------------------------------- */
/**
 * @description Gives a guest the token the data service signed for the game it just made them, only that browser can play it, restart it or reset it
 * (a guest's player id is their game id, which is in localStorage & could be seen or guessed). The token also has a guest session id
 * that stays the same from game to game, so middleware/rateLimit.js can count one browser's new games
 * @param  {[object]} res [express response]
 * @param  {[string]} guestToken [the data service's guest_token for the game]
 */
function setGuestCookie(res, guestToken) {
	if (!readToken(guestToken, "guest")) { throw unreadable(guestToken); }
	res.cookie(GUEST_COOKIE, guestToken, {
		httpOnly: true,                             // NOT READABLE FROM CLIENT JS
		secure: config.isProduction,                // HTTPS ONLY IN PRODUCTION
		sameSite: "lax",
		path: GUEST_PATH,
		maxAge: GUEST_COOKIE_AGE
	});
}

/* ---------------------------------------------------------------- */
// Read Guest Cookie
/* ---------------------------------------------------------------- */
/**
 * @description A guest's cookie, if the data service signed it
 * @param  {[object]} req [request with req.cookies]
 * @return {[object]} guest [{ session, gameId } | null when there's no cookie or it was changed (or signed before #252)]
 */
function readGuestCookie(req) {
	const payload = readToken(req.cookies?.[GUEST_COOKIE], "guest");
	if (typeof payload?.game_id != "string" || typeof payload.session != "string") { return null; }
	return { session: payload.session, gameId: payload.game_id };
}

/**
 * @description The game id in a guest's cookie (their player id), see readGuestCookie
 * @return {[string]} gameId [null when there's no cookie or it was changed]
 */
function readGuestGame(req) {
	return readGuestCookie(req)?.gameId || null;
}


module.exports = { setSessionCookies, clearSessionCookies, requireAuth, optionalAuth, readSessionUser, readRefreshCookie, setGuestCookie, readGuestCookie, readGuestGame };
