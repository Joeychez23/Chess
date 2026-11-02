/*
 *  auth0.js  --  chess server
 *	Auth0 Requests
 *  Everything that talks to Auth0 lives here. getAuth0User() replaces the
 *  user lambda (chess-validation/lambdas/functions/user), so that lambda can be removed.
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const config = require("../config");

const AUTH0_URL = `https://${config.auth0Domain}`;

const timeouts = { request: 5000 }; // AN AUTH0 THAT TAKES LONGER IS TREATED AS DOWN (#365)

let managementToken = null; // CACHED MANAGEMENT API TOKEN, REUSED UNTIL IT EXPIRES
let managementTokenExpires = 0;

/* ---------------------------------------------------------------- */
// Call
/* ---------------------------------------------------------------- */
/**
 * @description One call to Auth0, with a timeout that also covers reading the answer. Never retried: a password login tried twice counts twice against
 * Auth0's brute-force limits. A timeout is a DataServiceDown like the data service's: 503 "Try again in a moment", or ?login=unavailable in the callback
 * @param  {[string]} name [which call, for the log. Not the path: three calls share /oauth/token & the user search's has the email in it]
 * @param  {[string]} path [e.g. "/oauth/token"]
 * @param  {[object]} options [fetch options]
 * @return {[object]} answer [{ ok, status, body: the JSON answer, null when it isn't JSON }]
 */
async function auth0Fetch(name, path, options) {
	try {
		const response = await fetch(`${AUTH0_URL}${path}`, { ...options, signal: AbortSignal.timeout(timeouts.request) });
		const body = await response.json().catch((err) => {
			if (err.name == "TimeoutError") { throw err; }
			return null; // A GATEWAY'S ERROR PAGE: THE CALLER STILL SEES THE STATUS
		});
		return { ok: response.ok, status: response.status, body };
	} catch (err) {
		if (err.name == "TimeoutError") { throw auth0Down(name); }
		throw err;
	}
}

/**
 * @description The error a call throws when Auth0 doesn't answer in time, named like the data service's so it's answered the same way
 * @param  {[string]} name [which call]
 */
function auth0Down(name) {
	const err = new Error(`Auth0: ${name}: no answer in ${timeouts.request / 1000} seconds`);
	err.name = "DataServiceDown";
	return err;
}

/* ---------------------------------------------------------------- */
// Login URL
/* ---------------------------------------------------------------- */
/**
 * @description Builds the Auth0 Universal Login url the browser is sent to
 * @param  {[string]} state [random value checked again in the callback]
 * @return {[string]} url [Auth0 /authorize url]
 */
function buildAuthorizeUrl(state) {
	const params = new URLSearchParams({
		response_type: "code",
		client_id: config.auth0ClientId,
		redirect_uri: config.auth0CallbackUrl,
		scope: "openid profile email",
		state: state
	});
	return `${AUTH0_URL}/authorize?${params}`;
}

/* ---------------------------------------------------------------- */
// Logout URL
/* ---------------------------------------------------------------- */
/**
 * @description Builds the Auth0 logout url, which ends the Auth0 session & sends the browser back to the game
 * @return {[string]} url [Auth0 /v2/logout url]
 */
function buildLogoutUrl() {
	const params = new URLSearchParams({
		client_id: config.auth0ClientId,
		returnTo: config.clientUrl
	});
	return `${AUTH0_URL}/v2/logout?${params}`;
}

/* ---------------------------------------------------------------- */
// Code Exchange
/* ---------------------------------------------------------------- */
/**
 * @description Trades the code from the login callback for Auth0 tokens (needs the client secret, so it must stay server side)
 * @param  {[string]} code [code from the callback query string]
 * @return {[object]} tokens [access_token, id_token, expires_in]
 */
async function exchangeCode(code) {
	const tokenResponse = await auth0Fetch("code exchange", "/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "authorization_code",
			client_id: config.auth0ClientId,
			client_secret: config.auth0ClientSecret,
			code: code,
			redirect_uri: config.auth0CallbackUrl
		})
	});

	const tokenData = tokenResponse.body;
	if (!tokenResponse.ok) { throw new Error(`Auth0 code exchange failed: ${tokenData?.error_description || tokenData?.error || tokenResponse.status}`); }
	return tokenData;
}

/* ---------------------------------------------------------------- */
// Password Login
/* ---------------------------------------------------------------- */
/**
 * @description Trades an email & password for Auth0 tokens on our connection (password-realm grant, needs the client secret).
 * auth0-forwarded-for is the player's address, so Auth0's brute-force protection blocks them, not our server
 * @param  {[string]} email [player email]
 * @param  {[string]} password [player password, never logged]
 * @param  {[string]} ip [req.ip, the player's address]
 * @return {[object]} tokens [access_token, id_token, expires_in], throws with err.auth0Error (invalid_grant, too_many_attempts...) when refused
 */
async function passwordLogin(email, password, ip) {
	const tokenResponse = await auth0Fetch("password login", "/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/json", "auth0-forwarded-for": ip },
		body: JSON.stringify({
			grant_type: "http://auth0.com/oauth/grant-type/password-realm",
			realm: config.auth0Connection,
			scope: "openid profile email",
			username: email,
			password,
			client_id: config.auth0ClientId,
			client_secret: config.auth0ClientSecret
		})
	});

	const tokenData = tokenResponse.body;
	if (!tokenResponse.ok) {
		const err = new Error(`Auth0 password login failed: ${tokenData?.error_description || tokenData?.error || tokenResponse.status}`);
		err.auth0Error = tokenData?.error;
		throw err;
	}
	return tokenData;
}

/* ---------------------------------------------------------------- */
// Signup
/* ---------------------------------------------------------------- */
/**
 * @description Creates a player on our connection. Auth0 sends its verification email itself
 * @param  {[string]} email [player email]
 * @param  {[string]} password [player password, never logged]
 * @param  {[object]} userMetadata [{ screenname, first_name, last_name }, strings under 500 characters]
 * @return {[object]} user [Auth0's new user], throws with err.auth0Error (invalid_signup, invalid_password...) & err.auth0Message when refused
 */
async function signup(email, password, userMetadata) {
	const signupResponse = await auth0Fetch("signup", "/dbconnections/signup", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ client_id: config.auth0ClientId, connection: config.auth0Connection, email, password, user_metadata: userMetadata })
	});

	const signupData = signupResponse.body;
	if (!signupResponse.ok) {
		const err = new Error(`Auth0 signup failed: ${signupData?.code || signupResponse.status}`);
		err.auth0Error = signupData?.code;
		err.auth0Message = signupData?.message; // description IS AN OBJECT ON A WEAK PASSWORD, message IS ALWAYS THE TEXT
		throw err;
	}
	return signupData;
}

/* ---------------------------------------------------------------- */
// Management API Token
/* ---------------------------------------------------------------- */
/**
 * @description Gets a Management API token, only asking Auth0 for a new one when the cached one is about to expire
 * @return {[string]} managementToken [bearer token for /api/v2]
 */
async function getManagementToken() {
	if (managementToken && Date.now() < managementTokenExpires) { return managementToken; } // CACHED TOKEN IS STILL GOOD

	const clientTokenResponse = await auth0Fetch("management token", "/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "client_credentials",
			client_id: config.auth0ClientId,
			client_secret: config.auth0ClientSecret,
			audience: `${AUTH0_URL}/api/v2/`
		})
	});

	const clientTokenData = clientTokenResponse.body;
	if (!clientTokenResponse.ok) { throw new Error(`Auth0 management token failed: ${clientTokenData?.error_description || clientTokenData?.error || clientTokenResponse.status}`); }

	managementToken = clientTokenData.access_token;
	managementTokenExpires = Date.now() + ((clientTokenData.expires_in - 60) * 1000); // RENEW A MINUTE EARLY
	return managementToken;
}

/* ---------------------------------------------------------------- */
// Get Auth0 User (was the user lambda)
/* ---------------------------------------------------------------- */
/**
 * @description Finds the Auth0 user for an email on our connection
 * @param  {[string]} email [user email]
 * @return {[object]} user [full Auth0 user (user_id, email, user_metadata...) or null if not found]
 */
async function getAuth0User(email) {
	if (!email) { return null; }

	const clientToken = await getManagementToken();
	const userSearchOptions = {
		method: "GET",
		headers: { authorization: `Bearer ${clientToken}` }
	};

	const userSearchResponse = await auth0Fetch("user search", `/api/v2/users-by-email?email=${encodeURIComponent(email)}`, userSearchOptions); // EXACT EMAIL MATCH
	if (!userSearchResponse.ok) { throw new Error(`Auth0 user search failed: ${userSearchResponse.status}`); }

	const userResponse = userSearchResponse.body;
	for (let i = 0; i < userResponse.length; i++) { // SAME EMAIL CAN EXIST ON OTHER CONNECTIONS (GOOGLE ETC), ONLY USE OURS
		if (userResponse[i].identities?.[0]?.connection == config.auth0Connection) { return userResponse[i]; }
	}
	return null;
}


module.exports = { timeouts, buildAuthorizeUrl, buildLogoutUrl, exchangeCode, passwordLogin, signup, getAuth0User };
