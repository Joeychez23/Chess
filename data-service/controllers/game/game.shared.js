/*
 *  game.shared.js  --  data service
 *	Game Routes: shared steps
 *  The steps more than one kind of game route takes: answering a new game, reading a start position or a card game's state,
 *  and the player lookups friend games need (their last side, their open game, their sent invite, their username)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { retrieveGame, retrieveUser, saveLastColor, pruneOpenGames, pruneInvites, deleteInvite } = require("../../db/index.js");
const { checkStartFen } = require("../../utils/validate.js");
const { gameOpen, gamePending } = require("../../utils/games.js");
const { refuse } = require("../../utils/refuse.js");

// A card game's engine state (JSON) in UTF-8 bytes, under DynamoDB's 400 KB item limit. data-service/index.js sets CARDS_BODY_LIMIT from it
const CARDS_STATE_BYTES = 300000;

/* ---------------------------------------------------------------- */
// New Games
/* ---------------------------------------------------------------- */
/**
 * @description Answers initializeGame's response, a lost race for the game id (409) is refused like a read that found the id taken
 * @param  {[object]} response [initializeGame's { status, game_data, message }]
 */
function created(req, res, response) {
	if (response.status == 409) { return refuse(req, res, 409, response.message); }
	return res.json(response);
}

/**
 * @description A body's start_fen, checked by checkStartFen (validate.js). Not a string is refused, blank is the standard position
 * @return {[object]} position [{ fen } (false = the standard position) | { message }]
 */
function readStartFen(value) {
	if (value !== undefined && value !== null && typeof value != "string") { return { message: "Invalid FEN" }; }
	return checkStartFen(value);
}

/**
 * @description True for a card game's engine state: a JSON string of at most CARDS_STATE_BYTES bytes
 */
function isCardsState(state) {
	if (typeof state != "string" || Buffer.byteLength(state) > CARDS_STATE_BYTES) { return false; }
	try {
		JSON.parse(state);
	} catch {
		return false;
	}
	return true;
}

/* ---------------------------------------------------------------- */
// Players' Games
/* ---------------------------------------------------------------- */
/**
 * @description The side a player's last game had, for the Alternate color. Only read when the pick needs it
 * @param  {[object]} params [the new game's start settings]
 * @param  {[string]} playerId [auth0 user id without "auth0|"]
 * @param  {[boolean]} ai [true = their AI games, false = their friend games]
 * @return {[string]} color ["w" or "b", undefined when it isn't needed or they have no last game]
 */
async function lastColor(params, playerId, ai) {
	if (params.color != "alternate") { return undefined; }
	const user = (await retrieveUser(playerId, true)).user_data;
	return (ai ? user?.last_ai_color : user?.last_friend_color)?.S;
}

/**
 * @description Saves both players' sides when a friend game starts
 * @param  {[object]} gameData [friend game item]
 */
async function saveFriendColors(gameData) {
	await Promise.all([saveLastColor(gameData.white_player_id.S, false, "w"), saveLastColor(gameData.black_player_id.S, false, "b")]);
}

/**
 * @description A signed in player's open AI game or friend game, they only have one of each at a time (expired games are pruned first)
 * @param  {[string]} playerId [auth0 user id without "auth0|"]
 * @param  {[boolean]} ai [true = the AI game, false = the friend game]
 * @return {[object]} gameData [the game item, null when there's none open]
 */
async function currentGame(playerId, ai) {
	const user = await retrieveUser(playerId, true);
	// No games yet
	if (!user.user_data) { return null; }
	const userData = await pruneOpenGames(user.user_data);
	const gameId = ai ? userData.ai_game_id : userData.friend_game_id;
	if (!gameId) { return null; }
	const response = await retrieveGame(gameId, true);
	if (!response.game_data || !gameOpen(response.game_data)) { return null; }
	return response.game_data;
}

/**
 * @description Cancels a player's sent invite, if they have one
 * @param  {[string]} playerId [auth0 user id without "auth0|"]
 * @return {[object]} gameData [the invite that was deleted, null when there was none]
 */
async function dropSentInvite(playerId) {
	const user = await retrieveUser(playerId, true);
	if (!user.user_data) { return null; }
	const sent = (await pruneInvites(user.user_data)).sent_invite;
	if (!sent) { return null; }
	const response = await retrieveGame(sent.game_id, true);
	// Answered since
	if (!response.game_data || !gamePending(response.game_data)) { return null; }
	const deleted = await deleteInvite(response.game_data);
	return deleted.status == 200 ? response.game_data : null;
}

/**
 * @description A player's username, the name friends see on new invites & rematches
 * @param  {[string]} playerId [auth0 user id without "auth0|"]
 * @return {[string]} username [null when they haven't picked one]
 */
async function username(playerId) {
	return (await retrieveUser(playerId)).user_data?.username?.S || null;
}


module.exports = { created, readStartFen, isCardsState, lastColor, saveFriendColors, currentGame, dropSentInvite, username };
