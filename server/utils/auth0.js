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

let managementToken = null; // CACHED MANAGEMENT API TOKEN, REUSED UNTIL IT EXPIRES
let managementTokenExpires = 0;

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
	const tokenResponse = await fetch(`${AUTH0_URL}/oauth/token`, {
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

	const tokenData = await tokenResponse.json();
	if (!tokenResponse.ok) { throw new Error(`Auth0 code exchange failed: ${tokenData.error_description || tokenData.error}`); }
	return tokenData;
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

	const clientTokenResponse = await fetch(`${AUTH0_URL}/oauth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "client_credentials",
			client_id: config.auth0ClientId,
			client_secret: config.auth0ClientSecret,
			audience: `${AUTH0_URL}/api/v2/`
		})
	});

	const clientTokenData = await clientTokenResponse.json();
	if (!clientTokenResponse.ok) { throw new Error(`Auth0 management token failed: ${clientTokenData.error_description || clientTokenData.error}`); }

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

	const userSearchResponse = await fetch(`${AUTH0_URL}/api/v2/users-by-email?email=${encodeURIComponent(email)}`, userSearchOptions); // EXACT EMAIL MATCH
	if (!userSearchResponse.ok) { throw new Error(`Auth0 user search failed: ${userSearchResponse.status}`); }

	const userResponse = await userSearchResponse.json();
	for (let i = 0; i < userResponse.length; i++) { // SAME EMAIL CAN EXIST ON OTHER CONNECTIONS (GOOGLE ETC), ONLY USE OURS
		if (userResponse[i].identities?.[0]?.connection == config.auth0Connection) { return userResponse[i]; }
	}
	return null;
}


module.exports = { buildAuthorizeUrl, buildLogoutUrl, exchangeCode, getAuth0User };
