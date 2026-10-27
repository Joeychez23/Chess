/*
 *  games.js  --  data service
 *	Game Checks
 *  Who's in a game & what state it's in, the checks the game routes make against the stored game before they save anything.
 *  server/controllers/chessController.js has the same checks, so the chess server can refuse a bad request early
 *
 */

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


module.exports = { playerInGame, playerColor, isAiGame, gameOpen, gamePending, turnColor };
