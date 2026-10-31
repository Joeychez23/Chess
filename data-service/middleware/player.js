/*
 *  player.js  --  data service
 *	Who's Asking
 *  The chess server forwards the player it already checked: a signed in player's access token (X-Player-Token) or a guest's
 *  guest_game token (X-Guest-Game). Both were signed by this service (utils/tokens.js) & are checked again here with its public key,
 *  so a request can only act as the player whose token it carries. A player id in a body is never used
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const config = require("../config");
const { readSessionToken } = require("../utils/sessionKeys.js");
const { refuse } = require("../utils/refuse.js");
const { retrieveUser } = require("../dynamoDB.js");

/* ---------------------------------------------------------------- */
// Read Player
/* ---------------------------------------------------------------- */
/**
 * @description Sets req.player from the forwarded token or guest cookie. A token that doesn't check out (changed, expired, a refresh token) is refused,
 * the chess server only forwards ones it just checked. A signed in player's token is also refused once its session ended (logout, Delete my data):
 * its sid must still be the one on their row, read consistently so a logout that just happened counts (#277).
 * Neither header = nobody (req.player = null), only /health & a new guest game work without one
 * @return {[object]} req.player [{ id, user } signed in (id = auth0 user id without "auth0|") | { id, guest: true, session } a guest (id = their game id,
 * session = their guest session id, kept from game to game) | null]
 */
async function readPlayer(req, res, next) {
	const token = req.get("X-Player-Token");
	const guestCookie = req.get("X-Guest-Game");
	req.player = null;
	if (token) {
		const session = readAccessToken(token);
		if (!session) { return refuse(req, res, 401, "Bad player token"); }
		const id = session.user.user_id.split("auth0|")[1];
		const row = await retrieveUser(id, true); // CONSISTENT: A LOGOUT OR Delete my data THAT JUST HAPPENED COUNTS
		if (row.user_data?.sid?.S != session.sid) { return refuse(req, res, 401, "Session ended"); } // NO ROW, OR ANOTHER (OR NO) SESSION
		req.player = { id, user: session.user };
	} else if (guestCookie) {
		const guest = readGuestToken(guestCookie);
		if (!guest) { return refuse(req, res, 401, "Bad guest cookie"); }
		req.player = { id: guest.game_id, guest: true, session: guest.session };
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
 * @description A signed in player's access token, checked like readToken() in server/middleware/auth.js
 * @param  {[string]} token [the access_token cookie's JWT]
 * @return {[object]} payload [{ user: { user_id, email, ... }, sid } | null when it's changed, expired, another key's, has no sid or isn't an access token]
 */
function readAccessToken(token) {
	const payload = readSessionToken(token, "access", config.sessionPublicKeys); // A REFRESH OR GUEST TOKEN CAN'T ACT FOR A PLAYER
	if (typeof payload?.user?.user_id != "string" || !payload.user.user_id.startsWith("auth0|") || typeof payload.sid != "string") { return null; }
	return payload;
}

/**
 * @description A guest's guest_game token, signed by this service for the game it made them (newGuestGame, utils/tokens.js)
 * @param  {[string]} token [the guest_game cookie's JWT]
 * @return {[object]} guest [{ game_id (the guest's player id), session } | null when it's changed, expired or another type]
 */
function readGuestToken(token) {
	const payload = readSessionToken(token, "guest", config.sessionPublicKeys);
	if (typeof payload?.game_id != "string" || typeof payload.session != "string") { return null; }
	return payload;
}


module.exports = { readPlayer, requirePlayer, requireSignedIn };
