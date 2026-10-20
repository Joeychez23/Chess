/*
 *  chessController.js  --  chess server
 *	Chess Routes (was the chess lambda, chess-validation/lambdas/functions/chess/index.js)
 *  Each branch of the lambda's handler is its own route now. Responses keep the lambda's
 *  body ({ status, ..., message }) so the client checks them the same way.
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { validateMove } = require("../utils/validate.js");
const { getAuth0User } = require("../utils/auth0.js");
const { initalizeGame, retrieveGame, updateGame, retrieveUser, pruneOpenGames } = require("../dynamoDB.js");

/* ---------------------------------------------------------------- */
// Get Game (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Returns the board & the player's color. Used to load a game and by the 2 second opponent check
 * @param  {[string]} req.params.gameId [game id]
 * @param  {[string]} req.query.player_id [player id, picks the color]
 * @return {[object]} response [{ status, game_id, game_board, ai, player_color, opponent_color, moves, prev_move, w_knight, b_knight, message }]
 */
async function getGame(req, res) {
	const gameId = req.params.gameId;
	const playerId = req.query.player_id;
	if (!playerId) { return res.json({ status: 500, message: "Missing player_id" }); }

	const response = await retrieveGame(gameId);
	if (!response.game_data) { return res.json({ status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	let playerColor;
	let opponentColor;

	if (playerId == gameData.white_player_id.S) {
		playerColor = "w";
		opponentColor = "b";
	}
	else if (playerId == gameData.black_player_id.S) {
		playerColor = "b";
		opponentColor = "w";
	}

	if (!playerColor) { return res.json({ status: 500, message: "Player is not in this game" }); }

	return res.json({
		status: response.status,
		game_id: gameData.game_id.S,
		game_board: gameData.game_board.S,
		ai: isAiGame(gameData),
		player_color: playerColor,
		opponent_color: opponentColor,
		moves: gameData.moves.S,
		prev_move: gameData.prev_move.S,
		w_knight: gameData.w_knight.S,
		b_knight: gameData.b_knight.S,
		message: response.message,
	});
}

/* ---------------------------------------------------------------- */
// New Game (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Creates a game, or restarts one: an existing game_id is overwritten with a new board
 * @param  {[object]} req.body [{ game_id (optional, generated when left out), player_id_1 (white), player_id_2 (black) }]
 * @return {[object]} response [{ status, game_id, ai, game_board, w_knight, b_knight, message }]
 */
async function newGame(req, res) {
	const { game_id, player_id_1, player_id_2 } = req.body || {};
	if (!player_id_1 || !player_id_2) { return res.json({ status: 500, message: "Missing player_id_1 or player_id_2" }); }

	const response = await initalizeGame(game_id || false, player_id_1, player_id_2); // CREATE NEW GAME
	return res.json(gameResponse(response));
}

/* ---------------------------------------------------------------- */
// Move (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Processes player move: GET -> VALIDATE -> PUT
 * @param  {[string]} req.params.gameId [game id]
 * @param  {[object]} req.body [{ player_id, move: [from, to], promotion }]
 * @return {[object]} response [{ status, game_id, ai, game_board, w_knight, b_knight, message }]
 */
async function moveGame(req, res) {
	const { player_id, move, promotion } = req.body || {};
	if (!player_id || !Array.isArray(move) || move.length != 2) { return res.json({ status: 500, message: "Invalid piece movement" }); }

	const playerData = { game_id: req.params.gameId, player_id, move, promotion };

	let response = await retrieveGame(playerData.game_id); // GET GAME DATA BY ID
	if (response.status == 200) {
		response = await validateMove(playerData, response.game_data); // VALIDATE MOVE WITH EXISTING BOARD
		if (response.status == 200) {
			response = await updateGame(response.game_data); // PUT VALIDATED MOVE
			if (response.status == 200) { response.message = "Validation Successful"; }
		}
	}
	return res.json(gameResponse(response));
}

/* ---------------------------------------------------------------- */
// Invite (POST)
/* ---------------------------------------------------------------- */
/**
 * @description New game vs a friend: looks up the opponent's Auth0 account by email. The challenger plays white
 * @param  {[object]} req.body [{ game_id (optional), challenger_id, opponent_email }]
 * @return {[object]} response [{ status, game_id, message }]
 */
async function inviteGame(req, res) {
	const { game_id, challenger_id, opponent_email } = req.body || {};
	if (!challenger_id || !opponent_email) { return res.json({ status: 500, message: "Missing challenger_id or opponent_email" }); }

	const opponentData = await getAuth0User(opponent_email); // WAS auth0UserByEmail IN THE LAMBDA
	if (!opponentData) { return res.json({ status: 500, message: "Opponent not found" }); }
	const opponentId = opponentData.user_id.split("auth0|")[1]; // PLAYER IDS DROP THE "auth0|", SAME AS THE CLIENT

	const response = await initalizeGame(game_id || false, challenger_id, opponentId); // CREATE NEW GAME
	if (!response.game_data) { return res.json({ status: response.status, message: response.message }); }

	return res.json({
		status: response.status,
		game_id: response.game_data.game_id.S,
		message: response.message,
	});
}

/* ---------------------------------------------------------------- */
// User Games (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Returns a user's game lists for Home, expired games are pruned first
 * @param  {[string]} req.params.userId [auth0 user id without "auth0|"]
 * @return {[object]} response [{ status, user_id, requested_games, open_games, closed_games, message }]
 */
async function getUserGames(req, res) {
	let response = await retrieveUser(req.params.userId);
	if (!response.user_data) { return res.json({ status: response.status, message: response.message }); } // NO GAMES YET

	response.user_data = await pruneOpenGames(response.user_data); // DROPS EXPIRED GAMES BEFORE HOME LISTS THEM
	const userData = response.user_data;

	return res.json({
		status: response.status,
		user_id: userData.user_id.S,
		requested_games: userData.requested_games.S,
		open_games: userData.open_games.S,
		closed_games: userData.closed_games.S,
		message: response.message,
	});
}

/**
 * @description Response for a created or moved game (same body the lambda sent)
 * @param  {[object]} response [{ status, game_data, message }]
 * @return {[object]} body
 */
function gameResponse(response) {
	if (!response.game_data) { return { status: response.status, message: response.message }; } // REQUEST FAILED

	return {
		status: response.status,
		game_id: response.game_data.game_id.S,
		ai: isAiGame(response.game_data),
		game_board: response.game_data.game_board.S,
		w_knight: response.game_data.w_knight.S,
		b_knight: response.game_data.b_knight.S,
		message: response.message,
	};
}

/**
 * @description True when either side is the computer
 * @param  {[object]} gameData [game item]
 * @return {[boolean]} ai
 */
function isAiGame(gameData) {
	return gameData.white_player_id.S == "CHESS_AI" || gameData.black_player_id.S == "CHESS_AI";
}


module.exports = { getGame, newGame, moveGame, inviteGame, getUserGames };
