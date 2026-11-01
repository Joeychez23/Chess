/*
 *  authController.js  --  chess server
 *	Auth Routes
 *  login -> Auth0 Universal Login or password login -> our JWT session cookies -> back to the page (returnTo) or Home
 *  refresh & resume re-up the session, logout ends it everywhere & on Auth0. Only a 401 from the data service signs a player out (#283)
 *  The session tokens are signed by the data service (#252), this server passes Auth0's id_token on & sets the cookies it gets back
 *  A failed login goes Home with ?login=failed or ?login=unavailable, so the guest page tells the player (#282)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { buildAuthorizeUrl, buildLogoutUrl, exchangeCode, passwordLogin: auth0PasswordLogin, getAuth0User } = require("../utils/auth0.js");
const { setSessionCookies, clearSessionCookies, readRefreshCookie, readRefreshUser, readSessionUser } = require("../middleware/auth.js");
const { startSession, refreshSession, endSession, down } = require("../dataClient.js");
const { disconnectPlayer } = require("../socket.js");

const STATE_COOKIE = "auth_state";
const RETURN_COOKIE = "auth_return"; // THE PAGE TO GO BACK TO AFTER LOGIN (A GAME LINK, /play/:gameId)
const STATE_PATH = "/api/auth";

/* ---------------------------------------------------------------- */
// Login
/* ---------------------------------------------------------------- */
/**
 * @description Sends the browser to the Auth0 login page. ?returnTo=/play/:gameId comes back to that page after the callback
 */
function login(req, res) {
	const state = crypto.randomBytes(16).toString("hex"); // CHECKED IN THE CALLBACK SO ONLY OUR LOGINS ARE ACCEPTED
	const cookieOptions = {
		httpOnly: true,
		secure: config.isProduction,
		sameSite: "lax",
		path: STATE_PATH,
		maxAge: 10 * 60 * 1000 // 10 MINUTES TO FINISH LOGGING IN
	};
	res.cookie(STATE_COOKIE, state, cookieOptions);

	const returnTo = returnPath(req.query.returnTo);
	if (returnTo) { res.cookie(RETURN_COOKIE, returnTo, cookieOptions); }
	else { res.clearCookie(RETURN_COOKIE, { path: STATE_PATH }); } // AN OLD LOGIN'S PAGE DOESN'T CARRY OVER
	return res.redirect(buildAuthorizeUrl(state));
}

/* ---------------------------------------------------------------- */
// Callback
/* ---------------------------------------------------------------- */
/**
 * @description Auth0 sends the browser here after login. Trades the code for the user, then the data service checks Auth0's id_token & signs our session
 */
async function callback(req, res) {
	const { code, state, error } = req.query;
	const savedState = req.cookies?.[STATE_COOKIE];
	const returnTo = returnPath(req.cookies?.[RETURN_COOKIE]);
	res.clearCookie(STATE_COOKIE, { path: STATE_PATH });
	res.clearCookie(RETURN_COOKIE, { path: STATE_PATH });

	if (error || !code || !state || state != savedState) { // LOGIN CANCELED OR NOT STARTED BY US
		console.log(`Login failed: ${JSON.stringify(error || "invalid state")}`); // JSON.stringify ESCAPES LINE BREAKS: ANYONE CAN SEND error, AND A LINE OF ITS OWN COULD SET OFF AN ALARM (terraform/modules/monitoring)
		return res.redirect(loginFailed("failed"));
	}

	try {
		const tokens = await exchangeCode(code); // CODE -> AUTH0 TOKENS
		const session = await startPlayerSession(tokens.id_token);
		if (!session) { return res.redirect(loginFailed("failed")); }

		setSessionCookies(res, session);
		return res.redirect(new URL(returnTo || "/", config.clientUrl).href); // BACK TO THE PAGE THEY CAME FROM, OR HOME
	} catch (err) {
		if (err.name == "DataServiceDown") { // THE DATA SERVICE IS DOWN, OR SIGNED WITH A KEY THIS SERVER CAN'T READ
			console.error(err.message);
			return res.redirect(loginFailed("unavailable"));
		}
		console.error(err);
		return res.redirect(loginFailed("failed"));
	}
}

/**
 * @description Where a failed callback goes: Home with the reason, so the guest page says sign in didn't work (#282)
 * @param  {[string]} reason ["failed" (try again) or "unavailable" (the data service is down)]
 * @return {[string]} url
 */
function loginFailed(reason) {
	return new URL(`/?login=${reason}`, config.clientUrl).href;
}

/* ---------------------------------------------------------------- */
// Password Login
/* ---------------------------------------------------------------- */
/**
 * @description A request our own page sent: its Origin is the game's, & Sec-Fetch-Site (when the browser sends it) is same-origin.
 * Another site's link, redirect or form gets false (login & logout CSRF, #297)
 */
function fromOurPage(req) {
	const site = req.get("Sec-Fetch-Site");
	return req.get("Origin") === new URL(config.clientUrl).origin && (!site || site === "same-origin");
}

/**
 * @description POST /api/auth/login's checks: only JSON from our own page (login CSRF: a form post or another site gets 403),
 * with an email & password that are strings (400)
 */
function checkLogin(req, res, next) {
	if (!req.is("application/json") || !fromOurPage(req)) {
		return res.status(403).json({ status: 403, message: "Forbidden" });
	}
	if (typeof req.body?.email != "string" || !req.body.email.trim() || typeof req.body?.password != "string" || !req.body.password) {
		return res.status(400).json({ status: 400, message: "Email and password are required" });
	}
	return next();
}

/**
 * @description The login page's sign in: Auth0 checks the password, then the same steps as the callback. Answers { returnTo }
 * & the page goes there itself. An unknown email & a wrong password get the same 401 (#192). Never logs the password or the body
 */
async function passwordLogin(req, res, next) {
	try {
		const tokens = await auth0PasswordLogin(req.body.email, req.body.password, req.ip);
		const session = await startPlayerSession(tokens.id_token);
		if (!session) { return res.status(401).json({ status: 401, message: "Wrong email or password" }); }
		setSessionCookies(res, session);
		return res.json({ status: 200, returnTo: returnPath(req.body.returnTo) || "/" });
	} catch (err) {
		if (err.auth0Error == "invalid_grant") { return res.status(401).json({ status: 401, message: "Wrong email or password" }); }
		if (err.auth0Error == "too_many_attempts") { return res.status(429).json({ status: 429, message: "Too many login attempts. Check the email Auth0 sent to unblock your account." }); }
		return next(err);
	}
}

/**
 * @description What the callback & a password login both do with Auth0's id_token: find the player, then the data service checks it & signs the session
 * @param  {[string]} idToken [Auth0's id_token]
 * @return {[object]} session [{ access_token, refresh_token } | null when it's refused (logged why)]
 */
async function startPlayerSession(idToken) {
	const email = jwt.decode(idToken)?.email; // ONLY TO FIND THE USER, THE DATA SERVICE VERIFIES THE id_token ITSELF BEFORE IT SIGNS ANYTHING
	const auth0User = await getAuth0User(email); // FULL USER (USER_ID + USER_METADATA)
	if (!auth0User) {
		console.log(`Login failed: no ${config.auth0Connection} user for ${JSON.stringify(email)}`);
		return null;
	}
	const session = await startSession(idToken, sessionUser(auth0User)); // THE DATA SERVICE SIGNS THE ACCESS & REFRESH TOKENS
	if (session.status != 200) {
		const log = session.message?.includes("unknown key") ? console.error : console.log; // AN UNKNOWN KEY IS A SETUP PROBLEM, NOT THE PLAYER'S (#282)
		log(`Login failed: ${JSON.stringify(session.message)}`);
		return null;
	}
	return session;
}

/* ---------------------------------------------------------------- */
// Logout
/* ---------------------------------------------------------------- */
/**
 * @description Ends our session on every device (the data service clears the session id their refresh tokens carry),
 * then answers { logoutUrl } & the page goes there, which ends the Auth0 session so the next login asks for a password again.
 * A POST from our own page only, so another site can't sign a player out everywhere (#297). Their open sockets on every device are closed too (#298)
 */
async function logout(req, res) {
	if (!fromOurPage(req)) { return res.status(403).json({ status: 403, message: "Forbidden" }); }
	const refreshToken = readRefreshCookie(req);
	const user = readRefreshUser(req) || readSessionUser(req);
	clearSessionCookies(res);
	if (refreshToken) {
		try {
			await endSession(refreshToken);
			if (user) { disconnectPlayer(user.user_id.split("auth0|")[1]); } // EVERY DEVICE'S OPEN SOCKETS STOP GETTING GAMES (#298)
		} catch (err) {
			console.error(err.message); // THE DATA SERVICE IS DOWN: THIS BROWSER IS STILL SIGNED OUT, THE OTHERS STAY IN UNTIL THEIR REFRESH TOKEN RUNS OUT
		}
	}
	return res.json({ status: 200, logoutUrl: buildLogoutUrl(), message: "SIGNED OUT" });
}

/* ---------------------------------------------------------------- */
// Resume
/* ---------------------------------------------------------------- */
/**
 * @description Page routes send signed out players here, since the refresh token is only sent to /api/auth.
 * A valid refresh token re-ups the session & goes back to the page, otherwise login, then back to the page
 */
async function resume(req, res) {
	const returnTo = returnPath(req.query.returnTo) || "/";
	const session = await reup(req);
	if (!session) { return res.redirect(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`); }
	setSessionCookies(res, session);
	return res.redirect(returnTo);
}

/* ---------------------------------------------------------------- */
// Refresh
/* ---------------------------------------------------------------- */
/**
 * @description Re-ups the session: a valid refresh token gets a new access + refresh token from the data service (no Auth0 request)
 */
async function refresh(req, res) {
	const session = await reup(req);
	if (!session) {
		clearSessionCookies(res);
		return res.status(401).json({ status: 401, message: "SESSION EXPIRED" });
	}
	const user = setSessionCookies(res, session);
	return res.json({ status: 200, userData: user, message: "SESSION REFRESHED" });
}

/**
 * @description New session tokens for the refresh cookie, unless it's missing, expired, changed or its session was ended (logout, Delete my data).
 * Any other refusal (a 404 while the two instances run different code, a 400) throws, so it answers 503 "Try again in a moment" & keeps the cookies
 * @param  {[object]} req [express request]
 * @return {[object]} session [{ access_token, refresh_token } | null when there's no cookie or the data service answered 401]
 */
async function reup(req) {
	const refreshToken = readRefreshCookie(req);
	if (!refreshToken) { return null; }
	const session = await refreshSession(refreshToken);
	if (session.status == 200) { return session; }
	if (session.status == 401) { return null; } // A BAD REFRESH TOKEN OR AN ENDED SESSION, THE ONLY ANSWERS THAT SIGN A PLAYER OUT
	throw down(`POST /session/refresh: ${session.status} ${session.message}`);
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


/**
 * @description Only a path on this site can be returned to ("//other.site" & "/\other.site" are other sites to a browser),
 * so login & resume can't be used to send someone somewhere else
 * @param  {[string]} value [returnTo from the query or the cookie]
 * @return {[string]} path [the path, or null when it's missing or not ours]
 */
function returnPath(value) {
	if (typeof value != "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) { return null; }
	return value;
}


module.exports = { login, callback, checkLogin, passwordLogin, logout, refresh, resume };
