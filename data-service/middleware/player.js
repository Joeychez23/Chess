/*
 *  player.js  --  data service
 *	Who's Asking
 *  The chess server forwards the player it already checked: a signed in player's access token (X-Player-Token) or a guest's
 *  guest_game cookie (X-Guest-Game). Both are checked again here with JWT_SECRET, so a request can only act as the player
 *  whose token or cookie it carries. A player id in a body is never used. (#248 signs the whole request, #252 moves the keys here)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { refuse } = require("../utils/refuse.js");

const GUEST_COOKIE = "guest_game"; // THE PREFIX server/middleware/auth.js SIGNS GUEST COOKIES WITH

/* ---------------------------------------------------------------- */
// Read Player
/* ---------------------------------------------------------------- */
/**
 * @description Sets req.player from the forwarded token or guest cookie. A token that doesn't check out (changed, expired, a refresh token) is refused,
 * the chess server only forwards ones it just checked. Neither header = nobody (req.player = null), only /health & a new guest game work without one
 * @return {[object]} req.player [{ id, user } signed in (id = auth0 user id without "auth0|") | { id, guest: true } a guest (id = their game id) | null]
 */
function readPlayer(req, res, next) {
	const token = req.get("X-Player-Token");
	const guestCookie = req.get("X-Guest-Game");
	req.player = null;
	if (token) {
		const user = readAccessToken(token);
		if (!user) { return refuse(req, res, 401, "Bad player token"); }
		req.player = { id: user.user_id.split("auth0|")[1], user };
	} else if (guestCookie) {
		const gameId = readGuestCookie(guestCookie);
		if (!gameId) { return refuse(req, res, 401, "Bad guest cookie"); }
		req.player = { id: gameId, guest: true };
	}
	next();
}

/**
 * @description Refuses a request with no player (401), for every route that acts for someone
 */
function requirePlayer(req, res, next) {
	if (!req.player) { return refuse(req, res, 401, "No player"); }
	next();
}

/**
 * @description Refuses a request with no player (401) or a guest (403), for the routes on a player's user_db row (guests have none)
 */
function requireSignedIn(req, res, next) {
	if (!req.player) { return refuse(req, res, 401, "No player"); }
	if (req.player.guest) { return refuse(req, res, 403, "Guests have no account"); }
	next();
}

/* ---------------------------------------------------------------- */
// Tokens
/* ---------------------------------------------------------------- */
/**
 * @description The user in a signed in player's access token, checked like readToken() in server/middleware/auth.js
 * @param  {[string]} token [the access_token cookie's JWT]
 * @return {[object]} user [{ user_id, email, ... } | null when it's changed, expired or not an access token]
 */
function readAccessToken(token) {
	try {
		const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
		if (payload.type != "access") { return null; } // A REFRESH TOKEN CAN'T ACT FOR A PLAYER
		if (typeof payload.user?.user_id != "string" || !payload.user.user_id.startsWith("auth0|")) { return null; }
		return payload.user;
	} catch {
		return null;
	}
}

/**
 * @description The game id in a guest's cookie, if the signature is the one server/middleware/auth.js made (setGuestCookie)
 * @param  {[string]} value [the guest_game cookie: SESSION.GAME_ID.SIGNATURE]
 * @return {[string]} gameId [the guest's player id, null when the cookie was changed]
 */
function readGuestCookie(value) {
	const first = value.indexOf(".");
	const last = value.lastIndexOf(".");
	if (first < 1 || last <= first + 1) { return null; }
	const session = value.slice(0, first);
	const gameId = value.slice(first + 1, last);
	const signature = Buffer.from(value.slice(last + 1));
	const expected = Buffer.from(crypto.createHmac("sha256", config.jwtSecret).update(`${GUEST_COOKIE}:${session}.${gameId}`).digest("base64url"));
	if (signature.length != expected.length || !crypto.timingSafeEqual(signature, expected)) { return null; }
	return gameId;
}


module.exports = { readPlayer, requirePlayer, requireSignedIn };
