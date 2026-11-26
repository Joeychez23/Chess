/*
 *  chess.shapers.js  --  chess server
 *	Chess Routes: the bodies sent back
 *  A game as one player sees it, a game for Home's lists, and the read* helpers that turn a stored item or a request's
 *  fields into what the client is sent or the data service saves
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { readLevel } = require("../../utils/ai.js");
const { gameOpen, isAiGame, playerName, startParams, takebacksLeft, isColor, newStartParams } = require("../../utils/games.js");

/* ---------------------------------------------------------------- */
// Games
/* ---------------------------------------------------------------- */
/**
 * @description The whole game as one player sees it, what the client loads a board from (a load & a takeback)
 * @param  {[object]} response [{ status, game_data, message }]
 * @param  {[string]} playerId [the requester, playerInGame]
 * @return {[object]} body [see getGame]
 */
function playerGame(response, playerId) {
	const gameData = response.game_data;
	const playerColor = playerId == gameData.white_player_id.S ? "w" : "b";
	const opponentColor = playerColor == "w" ? "b" : "w";

	return {
		status: response.status,
		game_id: gameData.game_id.S,
		game_board: gameData.game_board.S,
		// "cards": a Chess Cards game, its page loads it from /api/chess/cards
		mode: gameData.mode?.S || "chess",
		ai: isAiGame(gameData),
		ai_level: aiLevel(gameData),
		// { color: "alternate" | "random" | "w" | "b", fen (a set position) }, what restart & rematch reuse
		start_params: startParams(gameData),
		player_color: playerColor,
		opponent_color: opponentColor,
		// Friend games: Home's "vs Bob"
		opponent_name: playerName(gameData, opponentColor),
		moves: gameData.moves.S,
		prev_move: gameData.prev_move.S,
		opening: readOpening(gameData),
		w_knight: gameData.w_knight.S,
		b_knight: gameData.b_knight.S,
		w_piece: gameData.w_piece.S,
		b_piece: gameData.b_piece.S,
		...gameState(gameData),
		message: response.message,
	};
}

/**
 * @description Response for a created or moved game (same body the lambda sent)
 * @param  {[object]} response [{ status, game_data, message }]
 * @return {[object]} body
 */
function gameResponse(response) {
	// The request failed
	if (!response.game_data) { return { status: response.status, message: response.message }; }

	const gameData = response.game_data;
	return {
		status: response.status,
		game_id: gameData.game_id.S,
		ai: isAiGame(gameData),
		ai_level: aiLevel(gameData),
		game_board: gameData.game_board.S,
		opening: readOpening(gameData),
		w_knight: gameData.w_knight.S,
		b_knight: gameData.b_knight.S,
		w_piece: gameData.w_piece.S,
		b_piece: gameData.b_piece.S,
		...gameState(gameData),
		message: response.message,
	};
}

/**
 * @description The game's result fields, sent with every game response
 * @param  {[object]} gameData [game item]
 * @return {[object]} result [{ state: "PENDING" | "OPEN" | "CLOSED", winner: "w" | "b" | "draw" | null, reason,
 * draw_offer: the color with a standing draw offer | null, takeback_request: the color with a standing takeback request | null,
 * takebacks_left: friend games' takebacks left, AI games have no limit: null, move_deadline: when the next move is due in epoch seconds | null }]
 */
function gameState(gameData) {
	const drawOffer = gameData.draw_offer_player_id?.S;
	const takebackRequest = gameData.takeback_player_id?.S;
	return {
		state: gameData.state?.S || "OPEN",
		winner: gameData.winner?.S || null,
		reason: gameData.reason?.S || null,
		draw_offer: drawOffer ? (drawOffer == gameData.white_player_id.S ? "w" : "b") : null,
		takeback_request: takebackRequest ? (takebackRequest == gameData.white_player_id.S ? "w" : "b") : null,
		takebacks_left: isAiGame(gameData) ? null : takebacksLeft(gameData),
		move_deadline: openDeadline(gameData),
	};
}

/**
 * @description When the next move is due in a game that's still going
 * @param  {[object]} gameData [game item]
 * @return {[number]} deadline [epoch seconds, null when the game has no limit or it's over]
 */
function openDeadline(gameData) {
	return gameData.move_deadline && gameOpen(gameData) ? Number(gameData.move_deadline.N) : null;
}

/**
 * @description The game's saved opening, sent with every game response
 * @param  {[object]} gameData [game item]
 * @return {[object]} opening [{ eco, name }, null until the game reaches a named position]
 */
function readOpening(gameData) {
	return gameData.opening ? JSON.parse(gameData.opening.S) : null;
}

/**
 * @description The AI's level, sent with every AI game response
 * @param  {[object]} gameData [game item]
 * @return {[number]} level [null for friend games, AI games made before levels get the default]
 */
function aiLevel(gameData) {
	return isAiGame(gameData) ? readLevel(gameData.ai_level?.N) : null;
}

/* ---------------------------------------------------------------- */
// Home's Lists
/* ---------------------------------------------------------------- */
/**
 * @description One game for Your games or Finished games on Home
 * @param  {[object]} gameData [game item, pruneGameList's projection is enough]
 * @param  {[string]} playerId [the user the list is for]
 * @return {[object]} summary [{ game_id, mode ("chess" | "cards"), ai, ai_level, opponent_name, player_color, start_params, opening, move_deadline }]
 */
function gameSummary(gameData, playerId) {
	const playerColor = playerId == gameData.white_player_id.S ? "w" : "b";
	return {
		game_id: gameData.game_id.S,
		// "cards": Home opens it as a Chess Cards game, like GET /game/:gameId says
		mode: gameData.mode?.S || "chess",
		ai: isAiGame(gameData),
		ai_level: aiLevel(gameData),
		opponent_name: playerName(gameData, playerColor == "w" ? "b" : "w"),
		player_color: playerColor,
		start_params: startParams(gameData),
		opening: readOpening(gameData),
		move_deadline: openDeadline(gameData),
	};
}

/**
 * @description The requester's open AI game or friend game, they only have one of each at a time
 * @param  {[object]} mine [myGames(): their row with expired games & invites pruned]
 * @param  {[boolean]} ai [true = the AI game, false = the friend game]
 * @return {[object]} gameData [the game item, null when there's none open]
 */
function openGame(mine, ai) {
	const userData = mine.user_data;
	// No games yet
	if (!userData) { return null; }
	const gameId = ai ? userData.ai_game_id : userData.friend_game_id;
	return userData.open_game_list.find((game) => game.game_id.S == gameId) || null;
}

/**
 * @description The PENDING invites the requester got
 * @param  {[object]} mine [myGames()]
 * @return {[array]} invites [[{ game_id, name, player_id, player_color, start_params }], see pruneInvites in data-service/db/]
 */
function receivedInvites(mine) {
	return mine.user_data?.received_invites || [];
}

/* ---------------------------------------------------------------- */
// Settings
/* ---------------------------------------------------------------- */
/**
 * @description The start settings a request asks for (Home & the guest page's dropdowns & Start position box, the invite form).
 * With a fen, replaying the moves (threefold, PGN, takebacks, replays) has to start from it, not the standard position
 * @param  {[object]} body [req.body, { start_color: "alternate" | "random" | "w" | "b", takebacks (the invite form): 0 = off,
 * days_per_move (the invite form): 1, 3 or 7 }]
 * @param  {[string]} fen [the set position from checkStartFen(body.start_fen), false = the standard position]
 * @return {[object]} params [{ color, fen (only for a set position), takebacks (only when off: 0), days_per_move (only with a limit) },
 * any other color is Random (the default)]
 */
function readStartParams(body, fen) {
	return newStartParams(body?.start_color, fen, body?.takebacks, body?.days_per_move);
}

/**
 * @description The settings a request saves (the settings page's Default start settings)
 * @param  {[object]} body [req.body, { ai_level, ai_color, friend_color, status_display }]
 * @return {[object]} settings [{ ai_level (600 - 3200 in steps of 100, anything else is the default level),
 * ai_color, friend_color ("alternate" | "random" | "w" | "b", anything else is Alternate),
 * status_display ("effects" | "badges", anything else is Effects) }]
 */
function readSettings(body) {
	return {
		ai_level: readLevel(body?.ai_level),
		ai_color: readColor(body?.ai_color),
		friend_color: readColor(body?.friend_color),
		status_display: isStatusDisplay(body?.status_display) ? body.status_display : "effects",
	};
}

/**
 * @description How a card game draws statuses: effects on the pieces, or badges
 * @param  {[string]} value [a status_display setting]
 * @return {[boolean]} known
 */
function isStatusDisplay(value) {
	return value === "effects" || value === "badges";
}

/**
 * @description A start color setting, Alternate is the default
 * @param  {[string]} value [a color setting]
 * @return {[string]} color ["alternate" | "random" | "w" | "b"]
 */
function readColor(value) {
	return isColor(value) ? value : "alternate";
}

/**
 * @description A player's saved settings, Home's dropdowns start on them
 * @param  {[object]} userData [user_db row]
 * @return {[object]} settings [same as readSettings, a player who never saved any gets the defaults]
 */
function userSettings(userData) {
	let saved = {};
	try { saved = JSON.parse(userData?.settings?.S || "{}"); } catch { }
	return readSettings(saved);
}


module.exports = {
	playerGame, gameResponse, gameState, readOpening, aiLevel,
	gameSummary, openGame, receivedInvites,
	readStartParams, readSettings, isStatusDisplay, userSettings,
};
