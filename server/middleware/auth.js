/*
 *  auth.js  --  chess server
 *	JWT Session Middleware
 *  Auth0 is only used to log in. After that the session is our own pair of JWTs:
 *  a short access token (checked on every request) and a long refresh token (used to re-up the access token).
 *  Both live in httpOnly cookies so the client never touches them.
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const jwt = require("jsonwebtoken");
const config = require("../config");

const ACCESS_COOKIE = "access_token";
const REFRESH_COOKIE = "refresh_token";
const REFRESH_PATH = "/api/auth"; // REFRESH TOKEN IS ONLY SENT TO THE AUTH ROUTES

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


module.exports = { setSessionCookies, clearSessionCookies, requireAuth, readRefreshUser };
