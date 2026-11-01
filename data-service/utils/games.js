/*
 *  games.js  --  data service
 *	Game Checks
 *  Who's in a game & what state it's in, the checks the game routes make against the stored game before they save anything.
 *  server/controllers/chessController.js has the same checks, so the chess server can refuse a bad request early
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");

const AI_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8]; // THE LEVELS IN server/utils/ai.js (LEVELS), THE ENGINE SETTINGS STAY ON THE CHESS SERVER
const DEFAULT_LEVEL = 3;
const ID = /^[A-Za-z0-9_-]{1,64}$/; // GAME IDS (newGameId'S, OLDER OBJECT IDS, THE TESTS' "game1") & PLAYER IDS (AUTH0 IDS WITHOUT "auth0|")

/* ---------------------------------------------------------------- */
// Players
/* ---------------------------------------------------------------- */
/**
 * @description The requester's player id in this game. A guest's player id is their game's id, so a guest is only ever in that one game
 * (an AI game). That stops a guest whose game id is another player's id, or "CHESS_AI", from acting in someone else's game
 * @param  {[object]} player [req.player, see middleware/player.js]
 * @param  {[object]} gameData [game item]
 * @return {[string]} playerId [null when the requester isn't in the game]
 */
function playerInGame(player, gameData) {
	if (!player) { return null; }
	if (player.guest && (gameData.game_id.S != player.id || !isAiGame(gameData))) { return null; }
	if (player.id == gameData.white_player_id.S || player.id == gameData.black_player_id.S) { return player.id; }
	return null;
}

/**
 * @description The color a player in the game plays
 * @param  {[string]} playerId [from playerInGame]
 * @param  {[object]} gameData [game item]
 * @return {[string]} color ["w" or "b"]
 */
function playerColor(playerId, gameData) {
	return playerId == gameData.white_player_id.S ? "w" : "b";
}

/**
 * @description The player who sent a friend game's invite (whose color pick start_params holds), the white player in games from before inviter_id
 * @param  {[object]} gameData [friend game item]
 * @return {[string]} playerId
 */
function inviterId(gameData) {
	return gameData.inviter_id?.S || gameData.white_player_id.S;
}

/**
 * @description The name a friend game shows for a side (a username, or the Auth0 screenname from before they picked one)
 * @param  {[object]} gameData [friend game item]
 * @param  {[string]} color ["w" or "b"]
 * @return {[string]} name [null when the game has none]
 */
function playerName(gameData, color) {
	return (color == "w" ? gameData.white_name?.S : gameData.black_name?.S) || null;
}

/**
 * @description True when either side is the computer
 * @param  {[object]} gameData [game item]
 * @return {[boolean]} ai
 */
function isAiGame(gameData) {
	return gameData.white_player_id.S == "CHESS_AI" || gameData.black_player_id.S == "CHESS_AI";
}

/* ---------------------------------------------------------------- */
// State
/* ---------------------------------------------------------------- */
/**
 * @description True from the start (or the accept) until the game is checkmated, drawn or forfeited
 * @param  {[object]} gameData [game item]
 * @return {[boolean]} open
 */
function gameOpen(gameData) {
	return (gameData.state?.S || "OPEN") == "OPEN";
}

/**
 * @description True for a friend invite nobody has answered yet
 * @param  {[object]} gameData [game item]
 * @return {[boolean]} pending
 */
function gamePending(gameData) {
	return gameData.state?.S == "PENDING";
}

/**
 * @description The color to move, from the board's FEN (its second field)
 * @param  {[object]} gameData [game item]
 * @return {[string]} turn ["w" or "b"]
 */
function turnColor(gameData) {
	return gameData.game_board.S.split(" ")[1];
}


/* ---------------------------------------------------------------- */
// Start Settings
/* ---------------------------------------------------------------- */
/**
 * @description A new game's start settings: the color the player picked & a set position. Restart & Rematch reuse them
 * @param  {[string]} color ["w", "b" or "random", anything else is random]
 * @param  {[string]} fen [the checked set position (checkStartFen), false for the standard position]
 * @return {[object]} params [{ color, fen (only for a set position) }]
 */
function newStartParams(color, fen) {
	let params = { color: color == "w" || color == "b" ? color : "random" };
	if (fen) { params.fen = fen; }
	return params;
}

/**
 * @description A game's saved start settings, games from before start_params are random from the standard position
 * @param  {[object]} gameData [game item]
 * @return {[object]} params [{ color, fen }]
 */
function startParams(gameData) {
	let params = {};
	try { params = JSON.parse(gameData.start_params?.S || "{}"); } catch { }
	return newStartParams(params.color, params.fen || false);
}

/**
 * @description Who plays white & black. The host's pick decides, random flips a coin
 * @param  {[object]} params [start settings, color is the host's pick]
 * @param  {[string]} hostId [the player whose pick it is: the AI game's player, or the inviter]
 * @param  {[string]} otherId ["CHESS_AI", or the invited player]
 * @return {[object]} sides [{ white, black }]
 */
function pickSides(params, hostId, otherId) {
	let hostColor = params.color;
	if (hostColor == "random") { hostColor = Math.random() < 0.5 ? "w" : "b"; }
	return hostColor == "w" ? { white: hostId, black: otherId } : { white: otherId, black: hostId };
}

/* ---------------------------------------------------------------- */
// Body Values
/* ---------------------------------------------------------------- */
/**
 * @description True for a color a player can pick
 * @param  {[string]} value ["w", "b" or "random"]
 * @return {[boolean]} ok
 */
function isColor(value) {
	return value == "w" || value == "b" || value == "random";
}

/**
 * @description An AI level from a body
 * @param  {[number]} value [1 - 8, left out = DEFAULT_LEVEL]
 * @return {[number]} level [null when it isn't a level]
 */
function readAiLevel(value) {
	if (value === undefined || value === null) { return DEFAULT_LEVEL; }
	return AI_LEVELS.includes(value) ? value : null;
}

/**
 * @description True for a game id or player id a body may name: letters, numbers, _ & -, and never the AI's player id
 * @param  {[string]} value
 * @return {[boolean]} ok
 */
function isId(value) {
	return typeof value == "string" && ID.test(value) && value != "CHESS_AI";
}

/**
 * @description A new game id, made here & never taken from a body: 16 random bytes in base64url (22 characters, passes isId).
 * Unlike an ObjectId (a timestamp, a per-process value & a counter) it can't be guessed from another game's id (#304)
 * @return {[string]} gameId
 */
function newGameId() {
	return crypto.randomBytes(16).toString("base64url");
}

module.exports = { playerInGame, playerColor, inviterId, playerName, isAiGame, gameOpen, gamePending, turnColor, newStartParams, startParams, pickSides, readAiLevel, isColor, isId, newGameId, DEFAULT_LEVEL };
