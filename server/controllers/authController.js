/*
 *  authController.js  --  chess server
 *	Auth Routes
 *  login -> Auth0 Universal Login -> callback -> our JWT session cookies
 *  refresh re-ups the session, logout ends it here & on Auth0
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { buildAuthorizeUrl, buildLogoutUrl, exchangeCode, getAuth0User } = require("../utils/auth0.js");
const { setSessionCookies, clearSessionCookies, readRefreshUser } = require("../middleware/auth.js");

const STATE_COOKIE = "auth_state";
const STATE_PATH = "/api/auth";

/* ---------------------------------------------------------------- */
// Login
/* ---------------------------------------------------------------- */
/**
 * @description Sends the browser to the Auth0 login page
 */
function login(req, res) {
	const state = crypto.randomBytes(16).toString("hex"); // CHECKED IN THE CALLBACK SO ONLY OUR LOGINS ARE ACCEPTED
	res.cookie(STATE_COOKIE, state, {
		httpOnly: true,
		secure: config.isProduction,
		sameSite: "lax",
		path: STATE_PATH,
		maxAge: 10 * 60 * 1000 // 10 MINUTES TO FINISH LOGGING IN
	});
	return res.redirect(buildAuthorizeUrl(state));
}

/* ---------------------------------------------------------------- */
// Callback
/* ---------------------------------------------------------------- */
/**
 * @description Auth0 sends the browser here after login. Trades the code for the user & starts our session
 */
async function callback(req, res) {
	const { code, state, error } = req.query;
	const savedState = req.cookies?.[STATE_COOKIE];
	res.clearCookie(STATE_COOKIE, { path: STATE_PATH });

	if (error || !code || !state || state != savedState) { // LOGIN CANCELED OR NOT STARTED BY US
		console.log(`Login failed: ${error || "invalid state"}`);
		return res.redirect(config.clientUrl);
	}

	try {
		const tokens = await exchangeCode(code); // CODE -> AUTH0 TOKENS
		const idToken = jwt.decode(tokens.id_token); // CAME STRAIGHT FROM AUTH0 OVER HTTPS, NO NEED TO RE-VERIFY
		const auth0User = await getAuth0User(idToken?.email); // FULL USER (USER_ID + USER_METADATA)

		if (!auth0User) {
			console.log(`Login failed: no ${config.auth0Connection} user for ${idToken?.email}`);
			return res.redirect(config.clientUrl);
		}

		setSessionCookies(res, sessionUser(auth0User));
		return res.redirect(config.clientUrl);
	} catch (err) {
		console.log(err);
		return res.redirect(config.clientUrl);
	}
}

/* ---------------------------------------------------------------- */
// Logout
/* ---------------------------------------------------------------- */
/**
 * @description Ends our session, then ends the Auth0 session so the next login asks for a password again
 */
function logout(req, res) {
	clearSessionCookies(res);
	return res.redirect(buildLogoutUrl());
}

/* ---------------------------------------------------------------- */
// Refresh
/* ---------------------------------------------------------------- */
/**
 * @description Re-ups the session: a valid refresh token gets a new access + refresh token (no Auth0 request)
 */
function refresh(req, res) {
	const user = readRefreshUser(req);
	if (!user) {
		clearSessionCookies(res);
		return res.status(401).json({ status: 401, message: "SESSION EXPIRED" });
	}
	setSessionCookies(res, user);
	return res.json({ status: 200, userData: user, message: "SESSION REFRESHED" });
}

/**
 * @description Keeps only what the game needs from the Auth0 user, this is what goes in the tokens
 * @param  {[object]} auth0User [full Auth0 user]
 * @return {[object]} user
 */
function sessionUser(auth0User) {
	return {
		user_id: auth0User.user_id,
		email: auth0User.email,
		email_verified: auth0User.email_verified,
		user_metadata: {
			screenname: auth0User.user_metadata?.screenname,
			first_name: auth0User.user_metadata?.first_name,
			last_name: auth0User.user_metadata?.last_name
		}
	};
}


module.exports = { login, callback, logout, refresh };
