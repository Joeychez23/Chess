/*
 *  dataClient.js  --  chess server
 *	Data Service Client (#249)
 *  Every read & write of the games & players goes through the data service (data-service/, the only code with DynamoDB access).
 *  Each call is signed (utils/signature.js) & says who it's for: the signed in player's access token, or a guest's guest_game cookie,
 *  from the request being answered (playerContext). The data service checks all of it again & refuses what that player can't do
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { AsyncLocalStorage } = require("node:async_hooks");
const config = require("./config");
const { signedHeaders } = require("./utils/signature.js");
const { readSessionUser, readGuestCookie } = require("./middleware/auth.js");

const TIMEOUT = 3000; // A DATA SERVICE THAT TAKES LONGER IS TREATED AS DOWN (503 "Try again in a moment")
const SIGNATURE_REFUSALS = ["Unsigned request", "Bad signature headers", "Bad signature", "Request too old", "Replayed request"]; // data-service/middleware/signature.js'S 401s ARE A SETUP PROBLEM, ANY OTHER 401 IS AN ANSWER ABOUT THE PLAYER OR THEIR SESSION
const context = new AsyncLocalStorage(); // { req }: THE REQUEST (OR SOCKET HANDSHAKE) THE CALLS ARE MADE FOR

/* ---------------------------------------------------------------- */
// Player Context
/* ---------------------------------------------------------------- */
/**
 * @description Express middleware: the rest of the request runs inside its own context, so every call below knows whose request it is
 */
function playerContext(req, res, next) {
	context.run({ req }, next);
}

/**
 * @description Runs fn for a request that didn't come through express (a socket's handshake has the same cookies)
 * @param  {[object]} req [socket.request]
 * @param  {[function]} fn [async () => ...]
 */
function withRequest(req, fn) {
	return context.run({ req }, fn);
}

/**
 * @description Who the call is for: the access token when it's still good (the data service checks it again), otherwise the guest cookie
 * @return {[object]} headers [{ "X-Player-Token" } | { "X-Guest-Game" } | {} for nobody]
 */
function playerHeaders() {
	const req = context.getStore()?.req;
	if (!req) { return {}; }
	if (req.cookies?.access_token && readSessionUser(req)) { return { "X-Player-Token": req.cookies.access_token }; }
	if (req.cookies?.guest_game && readGuestCookie(req)) { return { "X-Guest-Game": req.cookies.guest_game }; } // ONLY SENT TO /api/chess. ONE SIGNED BEFORE #252 ISN'T, THAT GUEST GETS A NEW GAME
	return {};
}

/* ---------------------------------------------------------------- */
// Call
/* ---------------------------------------------------------------- */
/**
 * @description One signed call to the data service. Answers keep dynamoDB.js's shapes ({ status, game_data | user_data, message }),
 * a refusal is { status: 400 | 401 | 403 | 409, message }
 * @param  {[string]} method ["GET" or "POST"]
 * @param  {[string]} path [e.g. "/games/<id>/move", ids already encoded]
 * @param  {[object]} body [sent as JSON, left out = none]
 * @return {[object]} answer [the data service's JSON]
 */
async function call(method, path, body) {
	const text = body === undefined ? "" : JSON.stringify(body);
	const headers = { ...playerHeaders(), ...signedHeaders(config.dataServiceSecret, method, path, text) };
	if (text) { headers["Content-Type"] = "application/json"; }

	let res;
	let answer;
	try {
		res = await fetch(`${config.dataServiceUrl}${path}`, { method, headers, body: text || undefined, signal: AbortSignal.timeout(TIMEOUT) });
		answer = await res.json();
	} catch (err) {
		throw down(`${method} ${path}: ${err.name == "TimeoutError" ? "no answer in 3 seconds" : err.message}`);
	}
	if (res.status >= 500) { throw down(`${method} ${path}: ${res.status} ${answer?.message}`); }
	if (res.status == 401 && SIGNATURE_REFUSALS.includes(answer?.message)) { throw down(`${method} ${path}: refused the signature (${answer?.message}), check DATA_SERVICE_SECRET`); }
	return answer;
}

/**
 * @description The error a call throws when the data service can't answer: server/index.js answers 503 "Try again in a moment"
 */
function down(reason) {
	const err = new Error(`Data service: ${reason}`);
	err.name = "DataServiceDown";
	return err;
}

/**
 * @description Express error middleware: a call that couldn't reach the data service answers 503, nothing was half saved (each action is one call)
 */
function dataServiceDown(err, req, res, next) {
	if (err.name != "DataServiceDown") { return next(err); }
	console.error(err.message);
	if (res.headersSent) { return next(err); }
	return res.status(503).json({ status: 503, message: "Try again in a moment" });
}

const id = (value) => encodeURIComponent(value); // AN ID IN A URL PATH CAN'T ADD PATH SEGMENTS

/* ---------------------------------------------------------------- */
// Games
/* ---------------------------------------------------------------- */
/**
 * @description A game, only for a player in it
 * @param  {[string]} gameId [game id]
 * @param  {[boolean]} consistent [true = a strongly consistent read, to see a save another request just made]
 * @return {[object]} response [{ status, game_data, message } | { status: 401 | 403 } (not the requester's game) | { status: 500, "Game data not found" }]
 */
const retrieveGame = (gameId, consistent) => call("GET", `/games/${id(gameId)}${consistent ? "?consistent=true" : ""}`);

/**
 * @description The requester's move, played on the stored board. A move that ends the game closes it (and rates a friend game)
 * @param  {[array]} move [[from, to]]
 * @param  {[string]} promotion ["q", "r", "b" or "n", left out for any other move]
 */
const saveMove = (gameId, move, promotion) => call("POST", `/games/${id(gameId)}/move`, { from: move[0], to: move[1], promotion: promotion || undefined });

/**
 * @description The AI's move (from the engine) in the requester's AI game, only on the AI's turn
 * @param  {[object]} move [{ from, to, promotion }]
 */
const saveAiMove = (gameId, move) => call("POST", `/games/${id(gameId)}/ai-move`, { from: move.from, to: move.to, promotion: move.promotion || undefined });

/**
 * @description The requester gives up an open game, the other side wins
 */
const forfeit = (gameId) => call("POST", `/games/${id(gameId)}/forfeit`);

/**
 * @description Both players' ratings, for the game menu
 * @return {[object]} response [{ status, ratings: { player id: { rating, rated_games } } }]
 */
const retrieveRatings = (gameId) => call("GET", `/games/${id(gameId)}/ratings`);

/**
 * @description A signed in player's new game vs the AI, the data service draws the side when the color is random
 * @param  {[object]} settings [{ color, level, start_fen, game_id (optional, must be new) }]
 */
const newAiGame = (settings) => call("POST", "/games/ai", settings);

/**
 * @description A guest's game vs the AI: their own is reset, any other id gets a new game (the id used is in game_data)
 * @param  {[object]} settings [{ game_id, color, side, level, start_fen }]
 */
const newGuestGame = (settings) => call("POST", "/games/guest", settings);

/**
 * @description The requester invites a friend, a PENDING game. The names come from the usernames, else the screennames
 * @param  {[object]} details [{ opponent_id, opponent_screenname, color, start_fen, game_id }]
 */
const invite = (details) => call("POST", "/games/invite", details);

/**
 * @description The invited player accepts. With replace_current their open friend game is forfeited first (after the inviter-busy check)
 * @return {[object]} response [{ status, game_data, forfeited, dropped_invites } | { status: 409, game_id } (a friend game is open) | { status: 409, "They're in another game now" }]
 */
const accept = (gameId, replaceCurrent) => call("POST", `/games/${id(gameId)}/accept`, replaceCurrent ? { replace_current: true } : undefined);

/**
 * @description Either player deletes a PENDING invite
 * @return {[object]} response [{ status, game_data (the invite as it was), message }]
 */
const decline = (gameId) => call("POST", `/games/${id(gameId)}/decline`);

/**
 * @description A press of Rematch on a friend game that's over
 * @return {[object]} response [{ status, waiting, expires_in } | { status, new_game_id, game_data, dropped_invites } (this press started it) | { status: 409 }]
 */
const rematch = (gameId) => call("POST", `/games/${id(gameId)}/rematch`);

/* ---------------------------------------------------------------- */
// Sessions (#252)
/* ---------------------------------------------------------------- */
/**
 * @description Signs a player in: the data service checks Auth0's id_token & that the user is the one it names, then signs the session tokens
 * @param  {[string]} idToken [Auth0's id_token from exchangeCode]
 * @param  {[object]} user [sessionUser(getAuth0User()), what the tokens hold]
 * @return {[object]} response [{ status: 200, access_token, refresh_token } | { status: 401, message } (a bad id_token, or not its user)]
 */
const startSession = (idToken, user) => call("POST", "/session/login", { id_token: idToken, user });

/**
 * @description New session tokens from the refresh cookie, while the player's session hasn't been ended (logout, Delete my data)
 * @return {[object]} response [{ status: 200, access_token, refresh_token } | { status: 401, message }]
 */
const refreshSession = (refreshToken) => call("POST", "/session/refresh", { refresh_token: refreshToken });

/**
 * @description Ends the player's session on every device (logout)
 */
const endSession = (refreshToken) => call("POST", "/session/logout", { refresh_token: refreshToken });

/* ---------------------------------------------------------------- */
// The Requester's Row
/* ---------------------------------------------------------------- */
/**
 * @description The requester's user_db row as stored
 * @param  {[boolean]} consistent [true = right after a save]
 * @return {[object]} response [{ status, user_data, message }, "User data not found" when there's no row (Delete my data, before the next login)]
 */
const retrieveUser = (consistent) => call("GET", `/users/me${consistent ? "?consistent=true" : ""}`);

/**
 * @description The requester's row with expired games & invites pruned, plus ai_game_id, friend_game_id, open_game_list, sent_invite & received_invites
 */
const myGames = () => call("GET", "/users/me?games=true");

/**
 * @description Saves the requester's Default start settings
 * @param  {[object]} settings [{ ai_level, ai_color, friend_color }]
 */
const updateUserSettings = (settings) => call("POST", "/users/me/settings", settings);

/**
 * @description Saves the requester's username, { status: 409 } when someone else has it
 */
const claimUsername = (username) => call("POST", "/users/me/username", { username });

/**
 * @description Deletes the requester's row & frees their username, once they've left every game (leaveAllGames)
 */
const deleteUser = () => call("POST", "/users/me/delete");


module.exports = { playerContext, withRequest, dataServiceDown, down, startSession, refreshSession, endSession, retrieveGame, saveMove, saveAiMove, forfeit, retrieveRatings, newAiGame, newGuestGame, invite, accept, decline, rematch, retrieveUser, myGames, updateUserSettings, claimUsername, deleteUser };
