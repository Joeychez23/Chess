/*
 *  gameController.js  --  data service
 *	Game Routes
 *  Each route is one action a player takes on a game. It loads the stored game, checks the player in the request can take that
 *  action on it now, then saves through dynamoDB.js. Nothing in a body is saved as sent: a move is played on the stored board
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { retrieveGame, updateGame, closeGame, retrieveRatings } = require("../dynamoDB.js");
const { validateMove, gameResult } = require("../utils/validate.js");
const { playerInGame, playerColor, isAiGame, gameOpen, gamePending, turnColor } = require("../utils/games.js");
const { refuse } = require("../utils/refuse.js");

const SQUARE = /^[a-h][1-8]$/;
const PROMOTIONS = ["q", "r", "b", "n"];

/* ---------------------------------------------------------------- */
// Get Game (GET)
/* ---------------------------------------------------------------- */
/**
 * @description A game, only for a player in it
 * @param  {[string]} req.params.gameId [game id]
 * @param  {[string]} req.query.consistent ["true" = a strongly consistent read, to see a save another request just made]
 * @return {[object]} response [retrieveGame's { status, game_data, message }, "Game data not found" is { status: 500, message }]
 */
async function getGame(req, res) {
	const response = await retrieveGame(req.params.gameId, req.query.consistent == "true");
	if (!response.game_data) { return res.json(response); } // GAME NOT FOUND
	if (!playerInGame(req.player, response.game_data)) { return refuse(req, res, 403, "Player is not in this game"); }
	return res.json(response);
}

/* ---------------------------------------------------------------- */
// Move (POST)
/* ---------------------------------------------------------------- */
/**
 * @description The requester's move, played on the stored board: they must be in the game, it must be open & their turn, and the move legal.
 * A move that ends the game (checkmate or a draw) closes it, and rates a friend game
 * @param  {[string]} req.params.gameId [game id]
 * @param  {[object]} req.body [{ from, to, promotion (optional: "q", "r", "b" or "n") }]
 * @return {[object]} response [{ status, game_data (the game as saved, closed when the move ended it), message }]
 */
async function moveGame(req, res) {
	const move = readMove(req.body);
	if (!move) { return refuse(req, res, 400, "Invalid piece movement"); }

	const response = await retrieveGame(req.params.gameId, true); // CONSISTENT: THE MOVE IS CHECKED ON THE LATEST BOARD
	if (!response.game_data) { return res.json(response); } // GAME NOT FOUND
	const gameData = response.game_data;
	const playerId = playerInGame(req.player, gameData);
	if (!playerId) { return refuse(req, res, 403, "Player is not in this game"); }
	if (gamePending(gameData)) { return refuse(req, res, 409, "Invite not accepted yet"); }
	if (!gameOpen(gameData)) { return refuse(req, res, 409, "Game is over"); }
	if (turnColor(gameData) != playerColor(playerId, gameData)) { return refuse(req, res, 409, "Not your turn"); }

	return saveMove(req, res, gameData, playerId, move);
}

/* ---------------------------------------------------------------- */
// AI Move (POST)
/* ---------------------------------------------------------------- */
/**
 * @description The AI's move in an AI game, asked for by the player in it (the chess server gets it from the engine). It must be the AI's turn & the move legal
 * @param  {[string]} req.params.gameId [game id]
 * @param  {[object]} req.body [{ from, to, promotion (optional) }]
 * @return {[object]} response [{ status, game_data, message }, 409 "Not the AI's turn" when it already moved]
 */
async function aiMoveGame(req, res) {
	const move = readMove(req.body);
	if (!move) { return refuse(req, res, 400, "Invalid piece movement"); }

	const response = await retrieveGame(req.params.gameId, true);
	if (!response.game_data) { return res.json(response); } // GAME NOT FOUND
	const gameData = response.game_data;
	if (!playerInGame(req.player, gameData)) { return refuse(req, res, 403, "Player is not in this game"); }
	if (!isAiGame(gameData)) { return refuse(req, res, 409, "Friend games have no AI"); }
	if (!gameOpen(gameData)) { return refuse(req, res, 409, "Game is over"); }
	if (turnColor(gameData) != playerColor("CHESS_AI", gameData)) { return refuse(req, res, 409, "Not the AI's turn"); }

	return saveMove(req, res, gameData, "CHESS_AI", move);
}

/**
 * @description Plays a move on the stored board (validateMove) & saves it only if the board hasn't changed since it was read (updateGame).
 * When the move ends the game it's closed (closeGame, which also rates a friend game)
 * @param  {[object]} gameData [the stored game]
 * @param  {[string]} playerId [whose move: the requester, or "CHESS_AI"]
 * @param  {[object]} move [{ from, to, promotion } from readMove]
 */
async function saveMove(req, res, gameData, playerId, move) {
	const prevBoard = gameData.game_board.S;
	const validated = await validateMove({ game_id: gameData.game_id.S, player_id: playerId, move: [move.from, move.to], promotion: move.promotion }, gameData);
	if (validated.status != 200) { return refuse(req, res, 400, validated.message); } // NOT THEIR PIECE, OR NOT LEGAL

	const saved = await updateGame(validated.game_data, prevBoard);
	if (saved.status != 200) { return refuse(req, res, 409, "Board changed before the move saved"); } // ANOTHER MOVE SAVED FIRST

	const result = gameResult(saved.game_data); // CHECKMATE OR A DRAW (THREEFOLD REPETITION TOO) ENDS THE GAME
	if (result) {
		const closed = await closeGame(saved.game_data, result.winner, result.reason);
		if (closed.status == 200) { saved.game_data = closed.game_data; }
	}
	return res.json(saved);
}

/**
 * @description The move in a body: two squares & maybe a promotion piece, nothing else
 * @param  {[object]} body [{ from: "e2", to: "e4", promotion: "q" }]
 * @return {[object]} move [{ from, to, promotion } | null when it isn't one]
 */
function readMove(body) {
	const { from, to, promotion } = body || {};
	if (typeof from != "string" || typeof to != "string" || !SQUARE.test(from) || !SQUARE.test(to)) { return null; }
	if (promotion != undefined && !PROMOTIONS.includes(promotion)) { return null; }
	return { from, to, promotion: promotion || undefined };
}

/* ---------------------------------------------------------------- */
// Forfeit (POST)
/* ---------------------------------------------------------------- */
/**
 * @description The requester gives up an open game, the other side wins (an AI game too: a new game from Home, Restart & Delete my data forfeit it)
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [closeGame's { status, game_data, message }]
 */
async function forfeitGame(req, res) {
	const response = await retrieveGame(req.params.gameId, true);
	if (!response.game_data) { return res.json(response); } // GAME NOT FOUND
	const gameData = response.game_data;
	const playerId = playerInGame(req.player, gameData);
	if (!playerId) { return refuse(req, res, 403, "Player is not in this game"); }
	if (gamePending(gameData)) { return refuse(req, res, 409, "Invite not accepted yet, decline it instead"); }
	if (!gameOpen(gameData)) { return refuse(req, res, 409, "Game is already over"); }

	const winner = playerColor(playerId, gameData) == "w" ? "b" : "w"; // THE OTHER SIDE WINS
	return res.json(await closeGame(gameData, winner, "forfeit"));
}

/* ---------------------------------------------------------------- */
// Ratings (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Both players' ratings, for the game menu. Only a player in the game can see them
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, ratings ({ player id: { rating, rated_games } }, the AI has none), message }]
 */
async function getRatings(req, res) {
	const response = await retrieveGame(req.params.gameId);
	if (!response.game_data) { return res.json(response); } // GAME NOT FOUND
	const gameData = response.game_data;
	if (!playerInGame(req.player, gameData)) { return refuse(req, res, 403, "Player is not in this game"); }

	const players = [gameData.white_player_id.S, gameData.black_player_id.S].filter((playerId) => playerId != "CHESS_AI");
	return res.json({ status: 200, ratings: await retrieveRatings(players), message: "Ratings" });
}


module.exports = { getGame, moveGame, aiMoveGame, forfeitGame, getRatings };
