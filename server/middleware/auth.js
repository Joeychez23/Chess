/*
 *  auth.js  --  chess server
 *	JWT Session Middleware
 *  Auth0 is only used to log in. After that the session is our own pair of JWTs:
 *  a short access token (checked on every request) and a long refresh token (used to re-up the access token).
 *  Both live in httpOnly cookies so the client never touches them.
 *  Guests get a signed cookie instead (guest_game) that says which game is theirs, and which guest they are (the new game limits).
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");

const ACCESS_COOKIE = "access_token";
const REFRESH_COOKIE = "refresh_token";
const REFRESH_PATH = "/api/auth"; // REFRESH TOKEN IS ONLY SENT TO THE AUTH ROUTES
const GUEST_COOKIE = "guest_game";
const GUEST_PATH = "/api/chess"; // THE GUEST COOKIE IS ONLY SENT TO THE CHESS ROUTES
const GUEST_COOKIE_AGE = 365 * 24 * 60 * 60 * 1000; // THE GAME ITSELF EXPIRES 25 DAYS AFTER ITS LAST MOVE, A COOKIE FOR A GONE GAME JUST MEANS A NEW ONE

/* ---------------------------------------------------------------- */
// Sign Token
/* ---------------------------------------------------------------- */
/**
 * @description Signs a session token holding the user
 * @param  {[object]} user [{ user_id, email, email_verified, user_metadata }]
 * @param  {[string]} type ["access" or "refresh"]
 * @return {[string]} token [signed JWT]
 */
function signToken(user, type) {
	const expiresIn = type == "refresh" ? config.jwtRefreshExpiresIn : config.jwtExpiresIn;
	return jwt.sign({ type, user }, config.jwtSecret, { expiresIn, algorithm: "HS256" });
}

/* ---------------------------------------------------------------- */
// Read Token
/* ---------------------------------------------------------------- */
/**
 * @description Verifies a session token
 * @param  {[string]} token [JWT from a cookie]
 * @param  {[string]} type ["access" or "refresh"]
 * @return {[object]} payload [{ type, user } | null when there is no token | undefined when it's expired or invalid]
 */
function readToken(token, type) {
	if (!token) { return null; }
	try {
		const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
		if (payload.type != type) { return undefined; } // A REFRESH TOKEN CAN'T BE USED AS AN ACCESS TOKEN
		return payload;
	} catch {
		return undefined;
	}
}

/* ---------------------------------------------------------------- */
// Set Session Cookies
/* ---------------------------------------------------------------- */
/**
 * @description Signs a new access + refresh token for the user & sets both cookies (used by login and every re-up)
 * @param  {[object]} res [express response]
 * @param  {[object]} user [user stored in the tokens]
 */
function setSessionCookies(res, user) {
	const accessToken = signToken(user, "access");
	const refreshToken = signToken(user, "refresh");
	res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(accessToken, "/"));
	res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(refreshToken, REFRESH_PATH));
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

function cookieOptions(token, path) {
	return {
		httpOnly: true,                             // NOT READABLE FROM CLIENT JS
		secure: config.isProduction,                // HTTPS ONLY IN PRODUCTION
		sameSite: "lax",
		path: path,
		expires: new Date(jwt.decode(token).exp * 1000) // COOKIE LIVES AS LONG AS THE TOKEN
	};
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
 * @description Returns the user from the refresh cookie, or null when it's missing / expired
 * @param  {[object]} req [express request]
 * @return {[object]} user
 */
function readRefreshUser(req) {
	const payload = readToken(req.cookies?.[REFRESH_COOKIE], "refresh");
	return payload ? payload.user : null;
}

/* ---------------------------------------------------------------- */
// Set Guest Cookie
/* ---------------------------------------------------------------- */
/**
 * @description Gives a guest a signed cookie for the game they just made, only that browser can play it, restart it or reset it
 * (a guest's player id is their game id, which is in localStorage & could be seen or guessed). The cookie also has a guest session id
 * that stays the same from game to game, so middleware/rateLimit.js can count one browser's new games
 * @param  {[object]} req [express request, a guest who already has the cookie keeps their session id]
 * @param  {[object]} res [express response]
 * @param  {[string]} gameId [the guest's game id]
 */
function setGuestCookie(req, res, gameId) {
	const session = readGuestCookie(req)?.session || crypto.randomBytes(12).toString("base64url");
	res.cookie(GUEST_COOKIE, `${session}.${gameId}.${guestSignature(session, gameId)}`, {
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
 * @description A guest's cookie, if its signature is ours
 * @param  {[object]} req [request with req.cookies]
 * @return {[object]} guest [{ session, gameId } | null when there's no cookie or it was changed]
 */
function readGuestCookie(req) {
	const value = req.cookies?.[GUEST_COOKIE];
	if (typeof value != "string") { return null; }
	const first = value.indexOf(".");
	const last = value.lastIndexOf(".");
	if (first < 1 || last <= first + 1) { return null; } // SESSION.GAME_ID.SIGNATURE
	const session = value.slice(0, first);
	const gameId = value.slice(first + 1, last);
	const signature = Buffer.from(value.slice(last + 1));
	const expected = Buffer.from(guestSignature(session, gameId));
	if (signature.length != expected.length || !crypto.timingSafeEqual(signature, expected)) { return null; }
	return { session, gameId };
}

/**
 * @description The game id in a guest's cookie (their player id), see readGuestCookie
 * @return {[string]} gameId [null when there's no cookie or it was changed]
 */
function readGuestGame(req) {
	return readGuestCookie(req)?.gameId || null;
}

function guestSignature(session, gameId) {
	return crypto.createHmac("sha256", config.jwtSecret).update(`${GUEST_COOKIE}:${session}.${gameId}`).digest("base64url"); // THE SESSION SECRET, KEPT APART FROM THE JWTS BY THE PREFIX
}


module.exports = { setSessionCookies, clearSessionCookies, requireAuth, optionalAuth, readSessionUser, readRefreshUser, setGuestCookie, readGuestCookie, readGuestGame };
