/*
 *  games.js  --  chess server & data service
 *	Game Checks
 *  Who's in a game & what state it's in, the checks the game routes make against the stored game before they save anything.
 *  The chess server uses them to refuse a bad request early, the data service checks every action again.
 *  server/utils/games.js & data-service/utils/games.js are the same file, data-service/test/shared.test.js fails when they differ
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");

const AI_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8]; // THE LEVELS IN server/utils/ai.js (LEVELS), THE ENGINE SETTINGS STAY ON THE CHESS SERVER
const DEFAULT_LEVEL = 3;
const ID = /^[A-Za-z0-9_-]{1,64}$/; // GAME IDS (newGameId'S, OLDER OBJECT IDS, THE TESTS' "game1") & PLAYER IDS (AUTH0 IDS WITHOUT "auth0|")
const OPEN_SEAT = "OPEN_SEAT"; // THE EMPTY SIDE OF A CHALLENGE LINK'S GAME, THE FIRST SIGNED IN PLAYER TO JOIN TAKES IT

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
 * @description The empty side of a challenge link's game that nobody has joined yet
 * @param  {[object]} gameData [game item]
 * @return {[string]} color ["w" or "b", null when there's no seat left to take]
 */
function openSeat(gameData) {
	if (!gamePending(gameData)) { return null; }
	if (gameData.white_player_id.S == OPEN_SEAT) { return "w"; }
	return gameData.black_player_id.S == OPEN_SEAT ? "b" : null;
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
// Move Deadline
/* ---------------------------------------------------------------- */
/**
 * @description When the next move is due in a game with a time limit, counted from now
 * @param  {[object]} gameData [game item, start_params.days_per_move is the limit]
 * @return {[string]} deadline [epoch seconds as DynamoDB saves a number, null when the game has no limit]
 */
function moveDeadline(gameData) {
	const days = startParams(gameData).days_per_move;
	return days ? String(Math.floor(Date.now() / 1000) + days * SECONDS_PER_DAY) : null;
}

/**
 * @description True for an open game whose player to move ran out of time
 * @param  {[object]} gameData [game item, the game lists' projection is enough]
 * @return {[boolean]} overdue
 */
function overdue(gameData) {
	return gameOpen(gameData) && !gamePending(gameData) && !!gameData.move_deadline && Number(gameData.move_deadline.N) * 1000 <= Date.now();
}

/**
 * @description Who wins when the player to move runs out of time: the other side, or nobody when that side can't checkmate
 * (only a king, or a king & one bishop or knight, the usual rule for insufficient material on time)
 * @param  {[object]} gameData [game item with its board]
 * @return {[string]} winner ["w", "b" or "draw"]
 */
function timeoutWinner(gameData) {
	const winner = turnColor(gameData) == "w" ? "b" : "w";
	const pieces = gameData.game_board.S.split(" ")[0].replace(/[^a-zA-Z]/g, "").split("").filter((piece) => (piece == piece.toUpperCase()) == (winner == "w") && piece.toLowerCase() != "k");
	const canMate = pieces.length > 1 || (pieces.length == 1 && !["n", "b"].includes(pieces[0].toLowerCase()));
	return canMate ? winner : "draw";
}


/* ---------------------------------------------------------------- */
// Start Settings
/* ---------------------------------------------------------------- */
const MAX_TAKEBACKS = 3; // ACCEPTED TAKEBACKS PER FRIEND GAME
const DAYS_PER_MOVE = [1, 3, 7]; // THE TIME LIMITS A FRIEND GAME CAN HAVE
const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * @description A new game's start settings: the color the player picked, a set position & friend games' takeback setting & time limit. Restart & Rematch reuse them
 * @param  {[string]} color ["w", "b", "random" or "alternate", anything else is random]
 * @param  {[string]} fen [the checked set position (checkStartFen), false for the standard position]
 * @param  {[number]} takebacks [0 turns friend game takebacks off, anything else leaves the limit (MAX_TAKEBACKS)]
 * @param  {[number]} daysPerMove [1, 3 or 7 days to make each move, anything else is no limit]
 * @return {[object]} params [{ color, fen (only for a set position), takebacks (only when off: 0), days_per_move (only with a limit) }]
 */
function newStartParams(color, fen, takebacks, daysPerMove) {
	let params = { color: isColor(color) ? color : "random" };
	if (fen) { params.fen = fen; }
	if (takebacks === 0) { params.takebacks = 0; }
	if (DAYS_PER_MOVE.includes(daysPerMove)) { params.days_per_move = daysPerMove; }
	return params;
}

/**
 * @description A game's saved start settings, games from before start_params are random from the standard position
 * @param  {[object]} gameData [game item]
 * @return {[object]} params [{ color, fen, takebacks, days_per_move }]
 */
function startParams(gameData) {
	let params = {};
	try { params = JSON.parse(gameData.start_params?.S || "{}"); } catch { }
	return newStartParams(params.color, params.fen || false, params.takebacks, params.days_per_move);
}

/**
 * @description How many takebacks a friend game has left, between both players
 * @param  {[object]} gameData [game item, takeback_count is how many were accepted]
 * @return {[number]} left [0 when the invite turned them off]
 */
function takebacksLeft(gameData) {
	if (startParams(gameData).takebacks === 0) { return 0; }
	return Math.max(0, MAX_TAKEBACKS - Number(gameData.takeback_count?.N || 0));
}

/**
 * @description Who plays white & black. The host's pick decides, random flips a coin, alternate is the opposite of the host's last game (their first game flips a coin)
 * @param  {[object]} params [start settings, color is the host's pick]
 * @param  {[string]} hostId [the player whose pick it is: the AI game's player, or the inviter]
 * @param  {[string]} otherId ["CHESS_AI", or the invited player]
 * @param  {[string]} lastColor [alternate: the host's side in their last game, "w" or "b", left out = no last game]
 * @return {[object]} sides [{ white, black }]
 */
function pickSides(params, hostId, otherId, lastColor) {
	let hostColor = params.color;
	if (hostColor == "alternate") { hostColor = lastColor == "w" ? "b" : lastColor == "b" ? "w" : "random"; }
	if (hostColor == "random") { hostColor = Math.random() < 0.5 ? "w" : "b"; }
	return hostColor == "w" ? { white: hostId, black: otherId } : { white: otherId, black: hostId };
}

/* ---------------------------------------------------------------- */
// Body Values
/* ---------------------------------------------------------------- */
/**
 * @description True for a color a player can pick
 * @param  {[string]} value ["w", "b", "random" or "alternate"]
 * @return {[boolean]} ok
 */
function isColor(value) {
	return value == "w" || value == "b" || value == "random" || value == "alternate";
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
 * @description True for a game id or player id a body may name: letters, numbers, _ & -, and never the AI's player id or the open seat
 * @param  {[string]} value
 * @return {[boolean]} ok
 */
function isId(value) {
	return typeof value == "string" && ID.test(value) && value != "CHESS_AI" && value != OPEN_SEAT;
}

/**
 * @description A new game id, made here & never taken from a body: 16 random bytes in base64url (22 characters, passes isId).
 * Unlike an ObjectId (a timestamp, a per-process value & a counter) it can't be guessed from another game's id (#304)
 * @return {[string]} gameId
 */
function newGameId() {
	return crypto.randomBytes(16).toString("base64url");
}

module.exports = { playerInGame, playerColor, inviterId, playerName, isAiGame, gameOpen, gamePending, openSeat, turnColor, moveDeadline, overdue, timeoutWinner, newStartParams, startParams, takebacksLeft, pickSides, readAiLevel, isColor, isId, newGameId, DEFAULT_LEVEL, DAYS_PER_MOVE, OPEN_SEAT };
