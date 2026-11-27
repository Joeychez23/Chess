/*
 *  chess.play.js  --  chess server
 *	Chess Routes: playing a game
 *  The player's moves, the AI's moves & the engine's analysis. The data service plays a move on the stored board & checks
 *  it again, this file holds the one AI turn & the one analysis each game can have running (aiTurns, runningAnalyses)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { Chess } = require("chess.js");
const { aiMove, analyzePosition } = require("../../utils/ai.js");
const { gameOpen, gamePending, isAiGame } = require("../../utils/plainItems.js");
const { findOpening } = require("../../utils/openings.js");
const { ifSaved, saveMove, saveAiMove, saveOpening } = require("../../dataClient.js");
const { emitToGame } = require("../../socket.js");
const chessGuards = require("./chess.guards.js");
const chessShapers = require("./chess.shapers.js");

// Game id -> the AI move being picked & saved (a promise), so parallel /ai-move requests ask the engine once
const aiTurns = new Map();
// Game id -> { board, answer (a promise) }, one engine request at a time per game
const runningAnalyses = new Map();

/* ---------------------------------------------------------------- */
// Move (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Processes player move: GET -> the data service validates, saves & closes it (checkmate / draw), then tells the game's room
 * so a friend sees it. The requester always moves for themself, the AI's moves come from /ai-move
 * @param  {[string]} req.params.gameId [game id]
 * @param  {[object]} req.body [{ move: [from, to], promotion }]
 * @return {[object]} response [{ status, game_id, ai, game_board, opening, w_knight, b_knight, w_piece, b_piece, state, winner, reason, message }]
 */
async function moveGame(req, res) {
	const { move, promotion } = req.body || {};
	if (!Array.isArray(move) || move.length != 2) { return res.status(400).json({ status: 400, message: "Invalid piece movement" }); }

	const gameId = req.params.gameId;
	const response = await chessGuards.loadMyGame(req, res);
	if (!response) { return; }

	const gameData = response.game_data;
	const playerId = chessGuards.playerInGame(req, gameData);
	if (!playerId) { return chessGuards.notInGame(req, res); }
	if (gameData.mode == "cards") { return chessGuards.useCardsRoutes(res); }
	if (gamePending(gameData)) { return res.status(409).json({ status: 409, message: "Invite not accepted yet" }); }
	if (!gameOpen(gameData)) { return res.status(409).json({ status: 409, message: "Game is over" }); }

	// The data service plays it on the stored board, saves it & closes the game on checkmate or a draw
	const board = gameData.game_board;
	const saved = await ifSaved(() => saveMove(gameId, move, promotion), () => savedBoardChange(gameId, board));
	// Not legal, not their turn, or another move saved first
	if (saved.status != 200) {
		const message = saved.message == "Not your turn" ? "Invalid piece movement" : saved.message;
		const status = moveRefusal(saved);
		return res.status(status).json({ status, message });
	}
	saved.message = "Validation Successful";
	// Before the opponent & Home are told, they load the game
	await recordOpening(saved);
	// The opponent's client loads the new board
	emitToGame(gameId, "move", { game_id: gameId, player_id: playerId });
	// A friend game's picture on Home
	if (!isAiGame(saved.game_data)) { chessGuards.notifyHome(saved.game_data); }
	return chessGuards.reply(res, chessShapers.gameResponse(saved));
}

/**
 * @description A move or a takeback whose save was too slow, read back: it saved if the board changed.
 * Only this player can change the board on their turn
 * @param  {[string]} gameId [game id]
 * @param  {[string]} board [the board before the save]
 * @return {[object]} response [the latest read when the board changed, null when nothing saved]
 */
async function savedBoardChange(gameId, board) {
	const latest = await chessGuards.retrieveGame(gameId, true);
	return latest.game_data && latest.game_data.game_board != board ? latest : null;
}

/**
 * @description The HTTP status of a move the data service refused. Its 400 is a move that isn't legal or a board that can't be read,
 * its 409 is not their turn, the game's over or another move saved first
 * @param  {[object]} response [the data service's { status, message }]
 * @return {[number]} status [422 illegal move, 500 a corrupted board, otherwise httpStatus]
 */
function moveRefusal(response) {
	if (response.status != 400) { return chessGuards.httpStatus(response); }
	return response.message == "Invalid piece movement" ? 422 : 500;
}

/**
 * @description Saves the opening of the position a move just saved. The latest match stays once the game leaves the book.
 * The move is already saved, so a failed save only logs: the next position in the book saves its own name
 * @param  {[object]} response [the saved move's { game_data }, its opening is updated when this saves one]
 * @param  {[object]} opening [the opening to save, left out = the board's]
 */
async function recordOpening(response, opening = findOpening(response.game_data.game_board)) {
	const gameData = response.game_data;
	const saved = chessShapers.readOpening(gameData);
	if (!opening || (opening.eco == saved?.eco && opening.name == saved?.name)) { return; }
	try {
		const answer = await saveOpening(gameData.game_id, gameData.game_board, opening);
		// Anything else: another move landed first, its request saves its own opening
		if (answer.status == 200) { gameData.opening = answer.game_data.opening; }
	} catch (err) {
		console.log(`Saving the opening failed: ${gameData.game_id}: ${err.message}`);
	}
}


/* ---------------------------------------------------------------- */
// AI Move (POST)
/* ---------------------------------------------------------------- */
/**
 * @description AI games: the server picks the AI's move at the game's level & saves it. The client only animates it.
 * Asking again after the AI moved returns the saved move instead of a new one
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, game_id, ai, ai_level, game_board, opening, w_knight, b_knight, w_piece, b_piece, state, winner, reason,
 * ai_move: { from, to, promotion }, message }]
 */
async function aiMoveGame(req, res) {
	const gameId = req.params.gameId;
	const response = await chessGuards.loadMyGame(req, res);
	if (!response) { return; }

	const gameData = response.game_data;
	const playerId = chessGuards.playerInGame(req, gameData);
	if (!playerId) { return chessGuards.notInGame(req, res); }
	if (gameData.mode == "cards") { return chessGuards.useCardsRoutes(res); }
	if (!isAiGame(gameData)) { return res.status(409).json({ status: 409, message: "Friend games have no AI" }); }

	const aiColor = gameData.white_player_id == "CHESS_AI" ? "w" : "b";
	// Already moved
	if (new Chess(gameData.game_board).turn() != aiColor) { return chessGuards.reply(res, savedAiMove(response)); }
	if (!gameOpen(gameData)) { return res.status(409).json({ status: 409, message: "Game is over" }); }

	// No AI move in flight for this game: this request picks it, later ones wait on it & get the same answer
	let turn = aiTurns.get(gameId);
	if (!turn) {
		turn = playAiTurn(gameId, gameData).finally(() => aiTurns.delete(gameId));
		aiTurns.set(gameId, turn);
	}
	return chessGuards.reply(res, await turn);
}

/**
 * @description Picks the AI's move & saves it. One at a time per game (aiTurns), each one asks the engine once.
 * The data service checks it's the AI's turn & the move is legal (the same rules as a player's move)
 * @param  {[string]} gameId [game id]
 * @param  {[object]} gameData [the game, it's the AI's turn]
 * @return {[object]} response [gameResponse + ai_move, or an error]
 */
async function playAiTurn(gameId, gameData) {
	// Stockfish at the game's level
	const move = await aiMove(gameData.game_board, chessShapers.aiLevel(gameData));
	const response = await saveAiMove(gameId, move);
	// Another request saved the AI's move first (one that read the game before this turn started). Consistent, so the read sees that move
	if (response.status == 409) {
		const latest = await chessGuards.retrieveGame(gameId, true);
		if (!latest.game_data) { return { status: latest.status, message: latest.message }; }
		return savedAiMove(latest);
	}
	if (response.status != 200) { return { status: 500, message: response.message }; }
	response.message = "AI moved";
	await recordOpening(response);
	return { ...chessShapers.gameResponse(response), ai_move: move };
}

/**
 * @description The AI's last saved move, for a repeat /ai-move request (the client asks again when a game loads on the AI's turn)
 * @param  {[object]} response [retrieveGame response, it's the player's turn]
 * @return {[object]} response [gameResponse + ai_move, or an error when the AI hasn't moved yet]
 */
function savedAiMove(response) {
	const { moves, prev_move } = response.game_data;
	const lastMove = moves[moves.length - 1];
	// The player moves first
	if (!lastMove) { return { status: 500, message: "It's not the AI's turn" }; }
	// "e8=Q+"
	const promotion = lastMove.match(/=([QRBN])/)?.[1].toLowerCase();
	const savedMove = { from: prev_move[0], to: prev_move[1], promotion };
	return { ...chessShapers.gameResponse(response), ai_move: savedMove, message: "AI already moved" };
}


/* ---------------------------------------------------------------- */
// Analysis (POST)
/* ---------------------------------------------------------------- */
/**
 * @description The best move & the evaluation of the game's saved board, for the Hint button & the evaluation bar.
 * AI games & finished games only, in a friend game that's still going it's cheating.
 * The board comes from the game, never the request, so this can't be used to run the engine on anything else.
 * One at a time per game: the same board shares the answer, another board is refused
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, game_board, from, to, eval, mate, winChance, message } from & to are null when the game can't go on
 * | { status: 403, message } a friend game | { status: 409, message } another board is being analyzed | { status: 503, message } the engine didn't answer]
 */
async function analysisGame(req, res) {
	// Consistent: the client asks right after a move
	const response = await chessGuards.loadMyGame(req, res, { consistentRead: true });
	if (!response) { return; }

	const gameData = response.game_data;
	if (!chessGuards.playerInGame(req, gameData)) { return chessGuards.notInGame(req, res); }
	if (gameData.mode == "cards") { return chessGuards.useCardsRoutes(res); }
	if (!isAiGame(gameData) && (gameOpen(gameData) || gamePending(gameData))) {
		return res.status(403).json({ status: 403, message: "No hints in a friend game" });
	}

	const gameId = gameData.game_id;
	const board = gameData.game_board;
	let running = runningAnalyses.get(gameId);
	if (running && running.board != board) { return res.status(409).json({ status: 409, message: "Wait for the analysis to finish." }); }
	if (!running) {
		running = { board, answer: analyzePosition(board).finally(() => runningAnalyses.delete(gameId)) };
		runningAnalyses.set(gameId, running);
	}
	try {
		return res.json({ status: 200, game_board: board, ...await running.answer, message: "Analysis" });
	} catch (err) {
		// The line must start with this: an alarm matches it (terraform/modules/monitoring)
		console.log(`STOCKFISH FAILED, NO ANALYSIS: ${err.message}`);
		return res.status(503).json({ status: 503, message: "The engine isn't answering, try again in a moment" });
	}
}


module.exports = { moveGame, aiMoveGame, analysisGame, savedBoardChange, recordOpening, aiTurns };
