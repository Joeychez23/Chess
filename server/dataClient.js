/*
 *  dataClient.js  --  chess server
 *	Data Service Client
 *  Every read and write of the games and players goes through the data service (data-service/, the only code with
 *  DynamoDB access). Each call is signed (utils/signature.js) and says who it is for: the signed in player's access
 *  token, or a guest's guest_game cookie, taken from the request being answered (playerContext). The data service checks
 *  all of it again and refuses what that player can't do.
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { AsyncLocalStorage } = require("node:async_hooks");
const config = require("./config");
const { signedHeaders } = require("./utils/signature.js");
const { readSessionUser, readGuestCookie } = require("./middleware/auth.js");

// How long each method waits for an answer, in milliseconds. A data service that takes longer is treated as down
// (503 "Try again in a moment"). Writes wait longer: a closing move, an accept or a rematch is many DynamoDB calls, and
// throttling backoff can slow them down. Exported as an object the tests shorten while they run.
const timeouts = { GET: 3000, POST: 10000, PUT: 10000 };

// The 401s from data-service/middleware/signature.js. These mean the two services are set up wrong;
// any other 401 is an answer about the player or their session.
const SIGNATURE_REFUSALS = ["Unsigned request", "Bad signature headers", "Bad signature", "Request too old", "Replayed request"];

// The 401s from data-service/middleware/player.js. For a request that came in signed in, they mean its access token
// ran out or its session was ended.
const PLAYER_REFUSALS = ["No player", "Bad player token", "Session ended"];

// { headers, signedIn }: who the calls are made for. Decided once per request (or socket handshake).
const context = new AsyncLocalStorage();

/* ---------------------------------------------------------------- */
// Player Context
/* ---------------------------------------------------------------- */
/**
 * @description Express middleware: the rest of the request runs inside its own context, so every call below knows
 * whose request it is
 */
function playerContext(req, res, next) {
	context.run(requestContext(req), next);
}

/**
 * @description Runs fn for a request that didn't come through express (a socket's handshake has the same cookies)
 * @param  {[object]} req [socket.request]
 * @param  {[function]} fn [async () => ...]
 */
function withRequest(req, fn) {
	return context.run(requestContext(req), fn);
}

/**
 * @description The request's context: who its calls are for, and whether it came signed in (an access cookie, good or not)
 */
function requestContext(req) {
	return { headers: playerHeaders(req), signedIn: !!req.cookies?.access_token };
}

/**
 * @description Who the request's calls are for: the access token while it is still good (the data service checks it
 * again), otherwise the guest cookie. Decided once when the request starts, so a token that runs out mid-request (while
 * waiting on the engine) isn't swapped for nobody halfway through.
 * @param  {[object]} req [express request or socket.request]
 * @return {[object]} headers [{ "X-Player-Token" } | { "X-Guest-Game" } | {} for nobody]
 */
function playerHeaders(req) {
	if (req.cookies?.access_token && readSessionUser(req)) {
		return { "X-Player-Token": req.cookies.access_token };
	}
	// Only sent to /api/chess. A guest cookie from before guest cookies were signed fails this check, and that guest
	// gets a new game.
	if (req.cookies?.guest_game && readGuestCookie(req)) {
		return { "X-Guest-Game": req.cookies.guest_game };
	}
	return {};
}

/* ---------------------------------------------------------------- */
// Call
/* ---------------------------------------------------------------- */
/**
 * @description One signed call to the data service. Answers keep the shapes of data-service/db/
 * ({ status, game_data | user_data, message }) under the same HTTP status; a refusal is { status: 400 | 401 | 403 | 404 | 409, message },
 * and a 500 it answered itself (a save that lost every try) is an answer too
 * @param  {[string]} method ["GET", "POST" or "PUT"]
 * @param  {[string]} path [e.g. "/games/<id>/move", ids already encoded]
 * @param  {[object]} body [sent as JSON, left out = none]
 * @return {[object]} answer [the data service's JSON]
 */
async function call(method, path, body) {
	const text = body === undefined ? "" : JSON.stringify(body);
	const store = context.getStore();
	const headers = { ...store?.headers, ...signedHeaders(config.dataServiceSecret, method, path, text) };
	if (text) {
		headers["Content-Type"] = "application/json";
	}

	let res;
	let answer;
	try {
		res = await fetch(`${config.dataServiceUrl}${path}`, {
			method,
			headers,
			body: text || undefined,
			signal: AbortSignal.timeout(timeouts[method]),
		});
		answer = await res.json();
	} catch (err) {
		const timedOut = err.name == "TimeoutError";
		const failed = down(`${method} ${path}: ${timedOut ? `no answer in ${timeouts[method] / 1000} seconds` : err.message}`);
		// A write that got no answer may still have saved: ifSaved checks
		failed.unanswered = timedOut && method != "GET";
		throw failed;
	}

	// Down: a 502-504 in front of it, its tables check (503), or its error handler's 500 (crashed)
	if (res.status > 500 || (res.status == 500 && answer?.crashed)) {
		throw down(`${method} ${path}: ${res.status} ${answer?.message}`);
	}
	if (res.status == 401 && SIGNATURE_REFUSALS.includes(answer?.message)) {
		throw down(`${method} ${path}: refused the signature (${answer?.message}), check DATA_SERVICE_SECRET`);
	}
	// The player's token ran out, mid-request or since a socket's handshake. The session routes answer these
	// refusals themselves.
	if (res.status == 401 && store?.signedIn && PLAYER_REFUSALS.includes(answer?.message) && !path.startsWith("/session/")) {
		throw sessionExpired();
	}
	return answer;
}

/**
 * @description The error a call throws when the signed in player's access token ran out mid-request. dataServiceDown
 * answers it with 401 "SESSION EXPIRED", so the client renews the session and tries again instead of being told they're
 * not in the game.
 */
function sessionExpired() {
	const err = new Error("Data service: the player's access token ran out mid-request");
	err.name = "SessionExpired";
	return err;
}

/**
 * @description The error a call throws when the data service can't answer: server/index.js answers it with 503
 * "Try again in a moment". utils/auth0.js throws one with the same name when Auth0 doesn't answer.
 */
function down(reason) {
	const err = new Error(`Data service: ${reason}`);
	err.name = "DataServiceDown";
	return err;
}

/**
 * @description A write whose answer timed out may still have saved. check (a consistent re-read) says what was saved,
 * so the player gets it and the other player is told, instead of a 503 for an action that went through.
 * @param  {[function]} write [async () => the write's answer]
 * @param  {[function]} check [async () => the answer to use when the write saved, null when it didn't]
 * @return {[object]} answer [the write's answer, or check's]
 */
async function ifSaved(write, check) {
	try {
		return await write();
	} catch (err) {
		if (!err.unanswered) {
			throw err;
		}
		const saved = await check();
		// Not saved (yet): the 503 stands and the player tries again
		if (!saved) {
			throw err;
		}
		console.error(`${err.message}, it saved`);
		return saved;
	}
}

/**
 * @description Express error middleware: a call that couldn't reach the data service answers 503, and a session that
 * ran out mid-request answers 401 "SESSION EXPIRED". A write that timed out was re-read first (ifSaved), so a 503 means
 * it wasn't seen saved.
 */
function dataServiceDown(err, req, res, next) {
	if (err.name == "SessionExpired" && !res.headersSent) {
		return res.status(401).json({ status: 401, message: "SESSION EXPIRED" });
	}
	if (err.name != "DataServiceDown") {
		return next(err);
	}
	console.error(err.message);
	if (res.headersSent) {
		return next(err);
	}
	return res.status(503).json({ status: 503, message: "Try again in a moment" });
}

/**
 * @description An id for a URL path, encoded so it can't add path segments
 */
function pathId(value) {
	return encodeURIComponent(value);
}

/* ---------------------------------------------------------------- */
// Games
/* ---------------------------------------------------------------- */
/**
 * @description A game, only for a player in it
 * @param  {[string]} gameId [game id]
 * @param  {[boolean]} consistent [true = a strongly consistent read, to see a save another request just made]
 * @return {[object]} response [{ status, game_data, message } | { status: 401 | 403 } (not the requester's game)
 * | { status: 404, "Game data not found" }]
 */
function retrieveGame(gameId, consistent) {
	return call("GET", `/games/${pathId(gameId)}${consistent ? "?consistent=true" : ""}`);
}

/**
 * @description The requester's move, played on the stored board. A move that ends the game closes it (and rates a
 * friend game)
 * @param  {[array]} move [[from, to]]
 * @param  {[string]} promotion ["q", "r", "b" or "n", left out for any other move]
 */
function saveMove(gameId, move, promotion) {
	return call("POST", `/games/${pathId(gameId)}/move`, { from: move[0], to: move[1], promotion: promotion || undefined });
}

/**
 * @description The AI's move (from the engine) in the requester's AI game, only on the AI's turn
 * @param  {[object]} move [{ from, to, promotion }]
 */
function saveAiMove(gameId, move) {
	return call("POST", `/games/${pathId(gameId)}/ai-move`, { from: move.from, to: move.to, promotion: move.promotion || undefined });
}

/**
 * @description AI games: takes back the requester's last move and the AI's reply to it, if it made one. Friend games:
 * a press of Takeback, which is the requester's request or accepts the opponent's
 * @return {[object]} response [{ status, game_data, message } | { status, requested: true, message }, 409 when it's
 * refused or a move landed first]
 */
function takeback(gameId) {
	return call("POST", `/games/${pathId(gameId)}/takeback`);
}

/**
 * @description The asked player turns a takeback down (friend games)
 * @return {[object]} response [{ status, declined: true, message }, 409 when the request already ended]
 */
function declineTakeback(gameId) {
	return call("POST", `/games/${pathId(gameId)}/takeback/decline`);
}

/**
 * @description The opening of the position a move just saved, only saved while that is still the game's board
 * @param  {[string]} board [the position's FEN]
 * @param  {[object]} opening [{ eco, name } from utils/openings.js]
 */
function saveOpening(gameId, board, opening) {
	return call("POST", `/games/${pathId(gameId)}/opening`, { board, eco: opening.eco, name: opening.name });
}

/**
 * @description The requester gives up an open game, the other side wins
 */
function forfeit(gameId) {
	return call("POST", `/games/${pathId(gameId)}/forfeit`);
}

/**
 * @description A press of Offer Draw: the requester's offer, or accepts the opponent's
 * @return {[object]} response [{ status, game_data, message } when it closed the game | { status, offered: true, message }]
 */
function offerDraw(gameId) {
	return call("POST", `/games/${pathId(gameId)}/draw`);
}

/**
 * @description The offered player turns the draw down (friend games)
 * @return {[object]} response [{ status, declined: true, message }]
 */
function declineDraw(gameId) {
	return call("POST", `/games/${pathId(gameId)}/draw/decline`);
}

/**
 * @description The AI's answer to the requester's offer
 * @param  {[boolean]} accept [true draws the game]
 * @return {[object]} response [{ status, game_data, message } when accepted | { status, declined: true, message }]
 */
function answerAiDraw(gameId, accept) {
	return call("POST", `/games/${pathId(gameId)}/draw/ai-answer`, { accept });
}

/**
 * @description Both players' ratings, for the game menu
 * @return {[object]} response [{ status, ratings: { player id: { rating, rated_games } } }]
 */
function retrieveRatings(gameId) {
	return call("GET", `/games/${pathId(gameId)}/ratings`);
}

/**
 * @description A signed in player's new game vs the AI. The data service draws the side when the color is random.
 * @param  {[object]} settings [{ color, level, start_fen }], the data service makes the game id
 */
function newAiGame(settings) {
	return call("POST", "/games/ai", settings);
}

/**
 * @description A guest's game vs the AI: their own is reset, any other id gets a new game (the id used is in game_data)
 * @param  {[object]} settings [{ game_id, color, side, level, start_fen }]
 */
function newGuestGame(settings) {
	return call("POST", "/games/guest", settings);
}

/**
 * @description A Chess Cards game vs the AI for the requester (signed in or a guest). The data service makes the game id
 * and stores the engine's state as sent.
 * @param  {[object]} settings [{ color, level, state (the engine's state, a JSON string), fen (its board) }]
 * @return {[object]} response [{ status, game_data (cards_version 1), message }, guest_token for a guest]
 */
function newCardsGame(settings) {
	return call("POST", "/games/cards", settings);
}

/**
 * @description Saves a card game's new engine state, only on the version it was made from
 * @param  {[number]} version [the cards_version the state was made from]
 * @param  {[string]} state [the engine's state as a JSON string]
 * @param  {[object]} extra [{ fen, winner and reason when the game ended }]
 * @return {[object]} response [{ status, game_data (cards_version + 1), message }, 409 "Board changed before the move
 * saved" when another save landed first]
 */
function saveCardsState(gameId, version, state, extra) {
	return call("PUT", `/games/${pathId(gameId)}/cards`, { version, state, ...extra });
}

/**
 * @description The requester invites a friend, a PENDING game. The names come from the usernames, else the screennames.
 * @param  {[object]} details [{ opponent_id, color, start_fen, takebacks, days_per_move }], the data service makes the
 * game id
 */
function invite(details) {
	return call("POST", "/games/invite", details);
}

/**
 * @description The invited player accepts. With replace_current their open friend game is forfeited first (after the
 * check that the inviter isn't busy).
 * @return {[object]} response [{ status, game_data, forfeited, dropped_invites } | { status: 409, game_id } (a friend
 * game is open) | { status: 409, "They're in another game now" }]
 */
function accept(gameId, replaceCurrent) {
	return call("POST", `/games/${pathId(gameId)}/accept`, replaceCurrent ? { replace_current: true } : undefined);
}

/**
 * @description The requester makes a challenge link, a PENDING game with the other seat empty
 * @param  {[object]} details [{ color, start_fen, takebacks, days_per_move }], the data service makes the game id
 */
function challenge(details) {
	return call("POST", "/games/challenge", details);
}

/**
 * @description What the join screen shows, for any signed in player with the link
 * @return {[object]} response [{ status, open, name, player_color, start_params } | { status: 404, "Game data not found" }
 * (not a challenge link)]
 */
function retrieveChallenge(gameId) {
	return call("GET", `/games/${pathId(gameId)}/challenge`);
}

/**
 * @description The requester takes a challenge link's empty seat. With replace_current their open friend game is
 * forfeited.
 * @return {[object]} response [{ status, game_data, forfeited, dropped_invites } | { status: 409, game_id } (a friend
 * game is open) | { status: 409, "Game is taken" }]
 */
function join(gameId, replaceCurrent) {
	return call("POST", `/games/${pathId(gameId)}/join`, replaceCurrent ? { replace_current: true } : undefined);
}

/**
 * @description Either player deletes a PENDING invite
 * @return {[object]} response [{ status, game_data (the invite as it was), message }]
 */
function decline(gameId) {
	return call("POST", `/games/${pathId(gameId)}/decline`);
}

/**
 * @description A press of Rematch on a friend game that's over
 * @return {[object]} response [{ status, waiting, expires_in } | { status, new_game_id, game_data, dropped_invites }
 * (this press started it) | { status: 409 }]
 */
function rematch(gameId) {
	return call("POST", `/games/${pathId(gameId)}/rematch`);
}

/**
 * @description The player who pressed Rematch takes it back
 * @return {[object]} response [{ status, cancelled, message }, cancelled: false when the rematch already started]
 */
function cancelRematch(gameId) {
	return call("POST", `/games/${pathId(gameId)}/rematch/cancel`);
}

/* ---------------------------------------------------------------- */
// Health
/* ---------------------------------------------------------------- */
/**
 * @description The data service reads both tables (GET /api/health). Throws like any call when it's down or DynamoDB
 * can't answer.
 * @return {[object]} response [{ status: 200, message }]
 */
function checkTables() {
	return call("GET", "/health/tables");
}

/* ---------------------------------------------------------------- */
// Sessions
/* ---------------------------------------------------------------- */
/**
 * @description Signs a player in: the data service checks Auth0's id_token and that the user is the one it names, then
 * signs the session tokens
 * @param  {[string]} idToken [Auth0's id_token from the password login]
 * @param  {[object]} user [sessionUser(getAuth0User()), what the tokens hold]
 * @return {[object]} response [{ status: 200, access_token, refresh_token } | { status: 401, message } (a bad id_token,
 * or not its user)]
 */
function startSession(idToken, user) {
	return call("POST", "/session/login", { id_token: idToken, user });
}

/**
 * @description New session tokens from the refresh cookie, while the player's session hasn't been ended (logout,
 * Delete my data)
 * @return {[object]} response [{ status: 200, access_token, refresh_token } | { status: 401, message }]
 */
function refreshSession(refreshToken) {
	return call("POST", "/session/refresh", { refresh_token: refreshToken });
}

/**
 * @description Ends the player's session on every device (logout)
 */
function endSession(refreshToken) {
	return call("POST", "/session/logout", { refresh_token: refreshToken });
}

/* ---------------------------------------------------------------- */
// The Requester's Row
/* ---------------------------------------------------------------- */
/**
 * @description The requester's user_db row as stored
 * @param  {[boolean]} consistent [true = right after a save]
 * @return {[object]} response [{ status, user_data, message }, "User data not found" when there's no row (after Delete
 * my data, until the next login)]
 */
function retrieveUser(consistent) {
	return call("GET", `/users/me${consistent ? "?consistent=true" : ""}`);
}

/**
 * @description The requester's row with expired games and invites pruned, plus ai_game_id, friend_game_id,
 * open_game_list, closed_game_list, sent_invite and received_invites
 */
function myGames() {
	return call("GET", "/users/me?games=true");
}

/**
 * @description Saves the requester's default start settings
 * @param  {[object]} settings [{ ai_level, ai_color, friend_color }]
 */
function updateUserSettings(settings) {
	return call("POST", "/users/me/settings", settings);
}

/**
 * @description Saves the requester's username, { status: 409 } when someone else has it
 */
function claimUsername(username) {
	return call("POST", "/users/me/username", { username });
}

/**
 * @description Who holds a username, { status: 200, player_id, username } | { status: 404 }
 */
function findUsername(username) {
	return call("GET", `/users/named/${encodeURIComponent(username)}`);
}

/**
 * @description The usernames starting with a prefix, { status: 200, usernames }, names only
 */
function searchUsernames(prefix) {
	return call("GET", `/users/search?prefix=${encodeURIComponent(prefix)}`);
}

/**
 * @description The requester's friends and requests, { status: 200, friends, sent, received }, each list
 * [{ player_id, username }]
 */
function retrieveFriends() {
	return call("GET", "/users/me/friends");
}

/**
 * @description One friend action on the player holding a username, saved on both rows
 * @param  {[string]} action ["request", "accept", "decline", "cancel" or "remove"]
 * @return {[object]} response [{ status: 200, player_id, message } | { status: 400 | 404 | 409, message }]
 */
function changeFriend(action, username) {
	return call("POST", `/users/me/friends/${action}`, { username });
}

/**
 * @description Deletes the requester's row and frees their username, once they've left every game (leaveAllGames).
 * They're taken off everyone's friend lists; friend_ids says who to tell.
 */
function deleteUser() {
	return call("POST", "/users/me/delete");
}


module.exports = {
	findUsername,
	searchUsernames,
	retrieveFriends,
	changeFriend,
	timeouts,
	checkTables,
	ifSaved,
	playerContext,
	withRequest,
	dataServiceDown,
	down,
	startSession,
	refreshSession,
	endSession,
	retrieveGame,
	saveMove,
	saveAiMove,
	takeback,
	declineTakeback,
	saveOpening,
	forfeit,
	offerDraw,
	declineDraw,
	answerAiDraw,
	retrieveRatings,
	newAiGame,
	newGuestGame,
	newCardsGame,
	saveCardsState,
	invite,
	challenge,
	retrieveChallenge,
	join,
	accept,
	decline,
	rematch,
	cancelRematch,
	retrieveUser,
	myGames,
	updateUserSettings,
	claimUsername,
	deleteUser,
};
