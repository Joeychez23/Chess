/*
 *  tokens.js  --  data service
 *	Signing Tokens (#252)
 *  Only the data service has the session private key, so only it can make a signed in player's access & refresh tokens or a guest's
 *  guest_game token. The chess server checks them with the public key (utils/sessionKeys.js) & sets them as cookies
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { ALGORITHM } = require("./sessionKeys.js");

const GUEST_EXPIRES_IN = "365d"; // AS LONG AS THE COOKIE, THE GAME ITSELF EXPIRES 25 DAYS AFTER ITS LAST MOVE

/* ---------------------------------------------------------------- */
// Session Tokens
/* ---------------------------------------------------------------- */
/**
 * @description A signed in player's access & refresh tokens. Both carry the session id on their user_db row, a refresh is refused once it changes
 * @param  {[object]} user [{ user_id, email, email_verified, user_metadata }, what the chess server reads from the access token]
 * @param  {[string]} sid [the session id on their row (startSession in dynamoDB.js)]
 * @return {[object]} tokens [{ access_token, refresh_token }]
 */
function sessionTokens(user, sid) {
	return {
		access_token: signToken({ type: "access", user, sid }, config.jwtExpiresIn),
		refresh_token: signToken({ type: "refresh", user, sid }, config.jwtRefreshExpiresIn)
	};
}

/* ---------------------------------------------------------------- */
// Guest Token
/* ---------------------------------------------------------------- */
/**
 * @description A guest's guest_game token for the game the data service just saved for them, only that browser can play it.
 * The guest session id stays the same from game to game, so the chess server can count one browser's new games (middleware/rateLimit.js)
 * @param  {[string]} gameId [the guest's game id, also their player id]
 * @param  {[string]} session [the session id from their last guest token, left out = a new guest]
 * @return {[string]} token [signed JWT]
 */
function guestToken(gameId, session) {
	return signToken({ type: "guest", game_id: gameId, session: session || crypto.randomBytes(12).toString("base64url") }, GUEST_EXPIRES_IN);
}

function signToken(payload, expiresIn) {
	return jwt.sign(payload, config.sessionPrivateKey, { algorithm: ALGORITHM, keyid: config.sessionKeyId, expiresIn });
}


module.exports = { sessionTokens, guestToken };
