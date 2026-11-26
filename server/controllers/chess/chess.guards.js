/*
 *  chess.guards.js  --  chess server
 *	Chess Routes: who the request is & what they get back
 *  Reading a game or the requester's lists (a read that finds a game out of time closes it, both players are told here),
 *  the opening most handlers share (loadMyGame), who the requester is in a game, and answering with the real HTTP status.
 *  A refusal's body can still say status: 500 under a 4xx (the lambda's body, the client reads it)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { isAiGame } = require("../../utils/games.js");
const { readGuestGame } = require("../../middleware/auth.js");
const { retrieveGame: readGame, myGames: readMyGames } = require("../../dataClient.js");
const { emitToPlayer, tellTimeout } = require("../../socket.js");

// A status: 500 in the body that isn't the server breaking (data-service/db/). Any other 500 is
const NOT_FOUND = /^(Game data not found|User data not found)/;
const CONFLICT = /^(Board changed|Game is already over|Game lists changed|Invite was already answered|It's not the AI's turn)/;

/* ---------------------------------------------------------------- */
// Reading Games
/* ---------------------------------------------------------------- */
/**
 * @description The opening a game handler shares: reads the game & answers when the requester can't see it or it isn't there.
 * Each handler checks the player & the game's mode itself, below this one line
 * @param  {[object]} req [express request, req.params.gameId is the game]
 * @param  {[object]} res [express response]
 * @param  {[object]} options [{ consistentRead (true = sees every finished save) }]
 * @return {[object]} response [the data service's { status, game_data, message }, null once it has answered]
 */
async function loadMyGame(req, res, { consistentRead } = {}) {
	const response = await retrieveGame(req.params.gameId, consistentRead);
	// The data service only shows a game to a player in it
	if (notYours(response)) {
		notInGame(req, res);
		return null;
	}
	// Game not found
	if (!response.game_data) {
		reply(res, { status: response.status, message: response.message });
		return null;
	}
	return response;
}

/**
 * @description Reads a game. A read of a game whose player to move ran out of time closes it (data-service/db/), both players are told here
 * @param  {[string]} gameId [game id]
 * @param  {[boolean]} consistent [true = sees every finished save]
 * @return {[object]} response [the data service's { status, game_data, message }]
 */
async function retrieveGame(gameId, consistent) {
	const response = await readGame(gameId, consistent);
	if (response.timed_out) { tellTimeout(response.game_data); }
	return response;
}

/**
 * @description The requester's row & game lists. Listing them closes their games that ran out of time, both players are told here
 * @return {[object]} response [the data service's { status, user_data, message }]
 */
async function myGames() {
	const response = await readMyGames();
	for (const gameData of response.user_data?.timed_out_games || []) { tellTimeout(gameData); }
	return response;
}

/* ---------------------------------------------------------------- */
// Who The Requester Is
/* ---------------------------------------------------------------- */
/**
 * @description The requester's player id in this game. Signed in players use their session, a guest's player id is their
 * game's id, from the signed guest_game cookie newGame gave them (the client also keeps it in localStorage) & guests only get AI games.
 * So a guest is only ever in that one game: a guest whose game id is "CHESS_AI" or another player's id isn't in their games
 * @param  {[object]} req [express request, req.user is null for guests]
 * @param  {[object]} gameData [game item]
 * @return {[string]} playerId [null when the requester isn't in the game]
 */
function playerInGame(req, gameData) {
	if (!req.user && !isAiGame(gameData)) { return null; }
	// A guest without the cookie (another browser) isn't in it
	const playerId = req.user ? userPlayerId(req.user) : readGuestGame(req);
	// Only their own game, not every game with their id on one side ("CHESS_AI" is on every AI game)
	if (!req.user && playerId != gameData.game_id.S) { return null; }
	if (playerId && (playerId == gameData.white_player_id.S || playerId == gameData.black_player_id.S)) { return playerId; }
	return null;
}

/**
 * @description Player id for a signed in user
 * @param  {[object]} user [session user]
 * @return {[string]} playerId [auth0 user id without "auth0|", same as the client]
 */
function userPlayerId(user) {
	return user.user_id.split("auth0|")[1];
}

/**
 * @description True when the data service refused because the requester isn't in the game (403), or isn't anyone (401: no token or guest cookie).
 * A signed in player's token running out mid-request never gets here, dataClient.js throws for it (401 "SESSION EXPIRED")
 * @param  {[object]} response [a data service answer]
 * @return {[boolean]} refused
 */
function notYours(response) {
	return response.status == 401 || response.status == 403;
}

/**
 * @description Answers a request for a game the requester isn't in. A signed in player whose access token
 * expired looks like a guest, so guests get a 401 & the client re-ups the session and tries again
 */
function notInGame(req, res) {
	if (!req.user) { return res.status(401).json({ status: 401, message: "NOT SIGNED IN" }); }
	return res.status(403).json({ status: 403, message: "Player is not in this game" });
}

/**
 * @description Answers a chess route asked about a Chess Cards game: those are played & read through /api/chess/cards (cardsController.js).
 * Forfeit is the one shared route
 * @param  {[object]} res [express response]
 * @return {[object]} response [{ status: 400, message }]
 */
function useCardsRoutes(res) {
	return res.status(400).json({ status: 400, message: "Use the Chess Cards routes" });
}

/* ---------------------------------------------------------------- */
// Answers
/* ---------------------------------------------------------------- */
/**
 * @description Sends a body with its real HTTP status (httpStatus), for answers that can be a game or a refusal
 * @param  {[object]} res [express response]
 * @param  {[object]} body [{ status, ..., message }, sent as it is]
 */
function reply(res, body) {
	return res.status(httpStatus(body)).json(body);
}

/**
 * @description The real HTTP status of an answer whose body may say status: 500 for a refusal (the lambda's body, the client reads it).
 * A 500 nothing here recognizes stays a 500: those are what the 5xx alarm is for (terraform/modules/monitoring)
 * @param  {[object]} response [an answer with { status, message }]
 * @return {[number]} status [404 not found, 409 conflict, otherwise the answer's own status]
 */
function httpStatus(response) {
	if (response.status != 500) { return response.status; }
	if (NOT_FOUND.test(response.message)) { return 404; }
	if (CONFLICT.test(response.message)) { return 409; }
	return 500;
}

/**
 * @description Tells both players' Homes a friend game or invite changed (socket "games"), Home redraws Play a friend, Invites & Your games
 * @param  {[object]} gameData [game item]
 */
function notifyHome(gameData) {
	emitToPlayer(gameData.white_player_id.S, "games", { game_id: gameData.game_id.S });
	emitToPlayer(gameData.black_player_id.S, "games", { game_id: gameData.game_id.S });
}


module.exports = {
	loadMyGame, retrieveGame, myGames,
	playerInGame, userPlayerId, notYours, notInGame, useCardsRoutes,
	reply, httpStatus, notifyHome,
};
