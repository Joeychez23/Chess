/*
 *  game.play.js  --  data service
 *	Game Routes: playing a game
 *  Reading a game, the player's & the AI's moves, the opening a move reached, both players' ratings, and a card game's new engine state.
 *  A move is played on the stored board, never saved as sent. The one exception is an opening's name, the data set is on the chess server:
 *  it's checked for its shape & can't change anything else
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { retrieveGame, updateGame, saveOpening, finishClosedGame, retrieveRatings, saveCardsState } = require("../../db/index.js");
const { validateMove, gameResult } = require("../../utils/validate.js");
const { playerInGame, playerColor, isAiGame, gameOpen, gamePending, turnColor } = require("../../utils/games.js");
const { refuse } = require("../../utils/refuse.js");
const gameShared = require("./game.shared.js");

const SQUARE_PATTERN = /^[a-h][1-8]$/;
const PROMOTIONS = ["q", "r", "b", "n"];
const ECO_PATTERN = /^[A-E][0-9]{2}$/;
// The longest in the data set is 99
const OPENING_NAME_LENGTH = 150;
// A card game save's board: FEN shaped, not validateFen (a king can be gone after a king capture)
const CARDS_FEN = /^[pnbrqkPNBRQK1-8/]{1,90} [wb] /;
const CARDS_FEN_LENGTH = 100;
const CARDS_WINNERS = ["w", "b", "draw"];
// The card engine's result reasons, true = a draw
const CARDS_REASONS = { checkmate: false, king: false, skips: false, stalemate: true, repetition: true, fifty: true, material: true };

/* ---------------------------------------------------------------- */
// Get Game (GET)
/* ---------------------------------------------------------------- */
/**
 * @description A game, only for a player in it. A game that isn't there says so even with no player: the play page's first guest game
 * asks for its new id before it has a cookie, and makes the game when it's not found (as the server always answered)
 * @param  {[string]} req.params.gameId [game id]
 * @param  {[string]} req.query.consistent ["true" = a strongly consistent read, to see a save another request just made]
 * @return {[object]} response [retrieveGame's { status, game_data, message }, "Game data not found" is { status: 404, message }]
 */
async function getGame(req, res) {
	let response = await retrieveGame(req.params.gameId, req.query.consistent == "true");
	// Game not found
	if (!response.game_data) { return res.json(response); }
	if (!req.player) { return refuse(req, res, 401, "No player"); }
	// A challenge link: the read may be from before they took the seat
	if (response.game_data.challenge && !playerInGame(req.player, response.game_data)) {
		response = await retrieveGame(req.params.gameId, true);
	}
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

	// Consistent: the move is checked on the latest board
	const response = await retrieveGame(req.params.gameId, true);
	// Game not found
	if (!response.game_data) { return res.json(response); }
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
 * @description The AI's move in an AI game, asked for by the player in it (the chess server gets it from the engine).
 * It must be the AI's turn & the move legal
 * @param  {[string]} req.params.gameId [game id]
 * @param  {[object]} req.body [{ from, to, promotion (optional) }]
 * @return {[object]} response [{ status, game_data, message }, 409 "Not the AI's turn" when it already moved]
 */
async function aiMoveGame(req, res) {
	const move = readMove(req.body);
	if (!move) { return refuse(req, res, 400, "Invalid piece movement"); }

	const response = await retrieveGame(req.params.gameId, true);
	// Game not found
	if (!response.game_data) { return res.json(response); }
	const gameData = response.game_data;
	if (!playerInGame(req.player, gameData)) { return refuse(req, res, 403, "Player is not in this game"); }
	if (!isAiGame(gameData)) { return refuse(req, res, 409, "Friend games have no AI"); }
	if (!gameOpen(gameData)) { return refuse(req, res, 409, "Game is over"); }
	if (turnColor(gameData) != playerColor("CHESS_AI", gameData)) { return refuse(req, res, 409, "Not the AI's turn"); }

	return saveMove(req, res, gameData, "CHESS_AI", move);
}

/**
 * @description Plays a move on the stored board (validateMove) & saves it only if the board hasn't changed since it was read (updateGame).
 * A move that ends the game saves its result in the same write, then finishClosedGame moves the game lists & rates a friend game
 * @param  {[object]} gameData [the stored game]
 * @param  {[string]} playerId [whose move: the requester, or "CHESS_AI"]
 * @param  {[object]} move [{ from, to, promotion } from readMove]
 */
async function saveMove(req, res, gameData, playerId, move) {
	const prevBoard = gameData.game_board.S;
	const moveRequest = { game_id: gameData.game_id.S, player_id: playerId, move: [move.from, move.to], promotion: move.promotion };
	const validated = await validateMove(moveRequest, gameData);
	// Not their piece, or not legal
	if (validated.status != 200) { return refuse(req, res, 400, validated.message); }

	// Checkmate or a draw (threefold repetition too) ends the game
	const result = gameResult(validated.game_data);
	const saved = await updateGame(validated.game_data, prevBoard, result);
	// Another move saved first
	if (saved.status != 200) { return refuse(req, res, 409, "Board changed before the move saved"); }

	if (result) { await finishGameLists(saved.game_data, result.winner); }
	return res.json(saved);
}

/**
 * @description After a move or a card game save closed the game: finishClosedGame moves the game lists (and rates a friend game).
 * A failure is only logged: the game & its result are saved, and a retry would only get "Game is over"
 * @param  {[object]} gameData [the closed game, as saved]
 * @param  {[string]} winner ["w", "b" or "draw"]
 */
async function finishGameLists(gameData, winner) {
	try {
		await finishClosedGame(gameData, winner);
	} catch (err) {
		console.log(`Finishing closed game failed: ${gameData.game_id.S}: ${err.message}`);
	}
}

/**
 * @description The move in a body: two squares & maybe a promotion piece, nothing else
 * @param  {[object]} body [{ from: "e2", to: "e4", promotion: "q" }]
 * @return {[object]} move [{ from, to, promotion } | null when it isn't one]
 */
function readMove(body) {
	const { from, to, promotion } = body || {};
	if (typeof from != "string" || typeof to != "string" || !SQUARE_PATTERN.test(from) || !SQUARE_PATTERN.test(to)) { return null; }
	if (promotion != undefined && !PROMOTIONS.includes(promotion)) { return null; }
	return { from, to, promotion: promotion || undefined };
}

/* ---------------------------------------------------------------- */
// Opening (POST)
/* ---------------------------------------------------------------- */
/**
 * @description The opening of the board a move just saved. A move that ended the game can have one, so a closed game takes it too
 * @param  {[string]} req.params.gameId [game id]
 * @param  {[object]} req.body [{ board (the FEN it was found for), eco, name }]
 * @return {[object]} response [{ status, game_data, message }, 409 when the board isn't that FEN any more]
 */
async function openingGame(req, res) {
	const { board, eco, name } = req.body || {};
	if (typeof board != "string" || typeof eco != "string" || !ECO_PATTERN.test(eco)
		|| typeof name != "string" || !name || name.length > OPENING_NAME_LENGTH) {
		return refuse(req, res, 400, "Invalid opening");
	}

	const response = await retrieveGame(req.params.gameId, true);
	// Game not found
	if (!response.game_data) { return res.json(response); }
	if (!playerInGame(req.player, response.game_data)) { return refuse(req, res, 403, "Player is not in this game"); }

	const saved = await saveOpening(req.params.gameId, board, { eco, name });
	if (saved.status != 200) { return refuse(req, res, 409, "Board changed before the opening saved"); }
	return res.json(saved);
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
	// Game not found
	if (!response.game_data) { return res.json(response); }
	const gameData = response.game_data;
	if (!playerInGame(req.player, gameData)) { return refuse(req, res, 403, "Player is not in this game"); }

	const players = [gameData.white_player_id.S, gameData.black_player_id.S].filter((playerId) => playerId != "CHESS_AI");
	return res.json({ status: 200, ratings: await retrieveRatings(players), message: "Ratings" });
}

/* ---------------------------------------------------------------- */
// Save Card Game (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description The chess server's new engine state for a card game the requester is in, made from cards_version. Only one save per version
 * lands (saveCardsState), a winner & reason close the game in the same write, then finishClosedGame moves the game lists.
 * The state is stored as sent, never run here
 * @param  {[string]} req.params.gameId [game id]
 * @param  {[object]} req.body [{ version, state, fen, winner & reason (both or neither) }]
 * @return {[object]} response [saveCardsState's { status, game_data, message }, 409 "Board changed before the move saved" when another save
 * landed first]
 */
async function saveCardsGame(req, res) {
	const save = readCardsSave(req.body);
	if (save.message) { return refuse(req, res, 400, save.message); }

	const response = await retrieveGame(req.params.gameId, true);
	// Game not found
	if (!response.game_data) { return res.json(response); }
	const gameData = response.game_data;
	if (!playerInGame(req.player, gameData)) { return refuse(req, res, 403, "Player is not in this game"); }
	if (gameData.mode?.S != "cards") { return refuse(req, res, 409, "Not a card game"); }
	if (!gameOpen(gameData)) { return refuse(req, res, 409, "Game is over"); }

	const saved = await saveCardsState(gameData, save.version, save.state, save.fen, save.result);
	// Another save of this version landed first
	if (saved.status != 200) { return refuse(req, res, 409, "Board changed before the move saved"); }

	if (save.result) { await finishGameLists(saved.game_data, save.result.winner); }
	return res.json(saved);
}

/**
 * @description A card game save's body: a positive integer version, a JSON state, a FEN shaped board, and a known winner & reason that
 * fit each other, together or neither
 * @return {[object]} save [{ version, state, fen, result ({ winner, reason } | undefined) } | { message }]
 */
function readCardsSave(body) {
	const { version, state, fen, winner, reason } = body || {};
	if (!Number.isSafeInteger(version) || version < 1) { return { message: "Invalid version" }; }
	if (!gameShared.isCardsState(state)) { return { message: "Invalid state" }; }
	if (typeof fen != "string" || fen.length > CARDS_FEN_LENGTH || !CARDS_FEN.test(fen)) { return { message: "Invalid FEN" }; }
	if (winner === undefined && reason === undefined) { return { version, state, fen }; }
	if (!CARDS_WINNERS.includes(winner) || !Object.hasOwn(CARDS_REASONS, reason)) { return { message: "Invalid result" }; }
	// A draw reason needs "draw", a win reason a color
	if (CARDS_REASONS[reason] != (winner == "draw")) { return { message: "Invalid result" }; }
	return { version, state, fen, result: { winner, reason } };
}


module.exports = { getGame, moveGame, aiMoveGame, openingGame, getRatings, saveCardsGame };
