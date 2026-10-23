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

const { ObjectId } = require("bson");
const { Chess } = require("chess.js");
const { validateMove, gameResult, startFacing } = require("../utils/validate.js");
const { levelList, readLevel, aiMove } = require("../utils/ai.js");
const { getAuth0User } = require("../utils/auth0.js");
const { initalizeGame, retrieveGame, updateGame, closeGame, requestRematch, acceptRematch, retrieveUser, pruneOpenGames } = require("../dynamoDB.js");
const { emitToGame } = require("../socket.js");

const REMATCH_TIME = 60 * 1000; // BOTH PLAYERS MUST PRESS REMATCH WITHIN 1 MINUTE

/* ---------------------------------------------------------------- */
// Get Game (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Returns the board & the player's color. Used to load a game and when the socket says the opponent moved
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, game_id, game_board, ai, ai_level, player_color, opponent_color, moves, prev_move, w_knight, b_knight, w_facing, b_facing, state, winner, reason, message }]
 */
async function getGame(req, res) {
	const response = await retrieveGame(req.params.gameId);
	if (!response.game_data) { return res.json({ status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	const playerId = playerInGame(req, gameData); // PICKS THE COLOR
	if (!playerId) { return notInGame(req, res); }

	const playerColor = playerId == gameData.white_player_id.S ? "w" : "b";
	const opponentColor = playerColor == "w" ? "b" : "w";

	return res.json({
		status: response.status,
		game_id: gameData.game_id.S,
		game_board: gameData.game_board.S,
		ai: isAiGame(gameData),
		ai_level: aiLevel(gameData),
		player_color: playerColor,
		opponent_color: opponentColor,
		moves: gameData.moves.S,
		prev_move: gameData.prev_move.S,
		w_knight: gameData.w_knight.S,
		b_knight: gameData.b_knight.S,
		...facingData(gameData),
		...gameState(gameData),
		message: response.message,
	});
}

/* ---------------------------------------------------------------- */
// New Game (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Creates a game vs the AI, or restarts a guest's game: their game_id is overwritten with a new board (signed in users restart with /restart)
 * @param  {[object]} req.body [{ game_id (optional, generated when left out), player_id_1 (white), player_id_2 (black), ai_level (optional, Home's dropdown) }, one side is "CHESS_AI", the other side is always the requester]
 * @return {[object]} response [{ status, game_id, ai, ai_level, game_board, w_knight, b_knight, w_facing, b_facing, message }]
 */
async function newGame(req, res) {
	const { game_id, player_id_1, player_id_2, ai_level } = req.body || {};
	if ((player_id_1 == "CHESS_AI") == (player_id_2 == "CHESS_AI")) { return res.json({ status: 500, message: "One player must be CHESS_AI, friend games start from /invite" }); }

	let level = readLevel(ai_level);
	if (game_id) { // RESTART: ONLY A PLAYER IN THE GAME CAN WIPE IT
		const existing = await retrieveGame(game_id);
		if (existing.game_data && !playerInGame(req, existing.game_data)) { return notInGame(req, res); }
		if (existing.game_data && !isAiGame(existing.game_data)) { return res.json({ status: 500, message: "Friend games can't be restarted" }); } // WOULD TURN IT INTO AN AI GAME & LOCK THE FRIEND OUT
		if (existing.game_data && req.user) { return res.json({ status: 500, message: "Game id already in use, restart with /restart" }); } // WOULD ERASE THE RESULT WITHOUT A FORFEIT
		if (existing.game_data && ai_level == undefined) { level = aiLevel(existing.game_data); } // GUEST RESTART KEEPS THE LEVEL
	}

	const playerId = req.user ? userPlayerId(req.user) : game_id; // A GUEST'S PLAYER ID IS THEIR GAME ID
	if (!playerId) { return res.status(401).json({ status: 401, message: "NOT SIGNED IN" }); }

	const whiteId = player_id_1 == "CHESS_AI" ? "CHESS_AI" : playerId;
	const blackId = player_id_2 == "CHESS_AI" ? "CHESS_AI" : playerId;

	const response = await initalizeGame(game_id || false, whiteId, blackId, level); // CREATE NEW GAME
	return res.json(gameResponse(response));
}

/* ---------------------------------------------------------------- */
// Move (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Processes player move: GET -> VALIDATE -> PUT -> CLOSE (checkmate / draw), then tells the game's room so a friend sees it.
 * The requester always moves for themself, the AI's moves come from /ai-move
 * @param  {[string]} req.params.gameId [game id]
 * @param  {[object]} req.body [{ move: [from, to], promotion }]
 * @return {[object]} response [{ status, game_id, ai, game_board, w_knight, b_knight, w_facing, b_facing, state, winner, reason, message }]
 */
async function moveGame(req, res) {
	const { move, promotion } = req.body || {};
	if (!Array.isArray(move) || move.length != 2) { return res.json({ status: 500, message: "Invalid piece movement" }); }

	let response = await retrieveGame(req.params.gameId); // GET GAME DATA BY ID
	if (response.status != 200) { return res.json(gameResponse(response)); }

	const playerId = playerInGame(req, response.game_data);
	if (!playerId) { return notInGame(req, res); }
	if (!gameOpen(response.game_data)) { return res.json({ status: 500, message: "Game is over" }); }

	const prevBoard = response.game_data.game_board.S;
	const playerData = { game_id: req.params.gameId, player_id: playerId, move, promotion };

	response = await validateMove(playerData, response.game_data); // VALIDATE MOVE WITH EXISTING BOARD
	if (response.status == 200) {
		response = await updateGame(response.game_data, prevBoard); // PUT VALIDATED MOVE
		if (response.status == 200) {
			const result = gameResult(response.game_data.game_board.S); // CHECKMATE OR A DRAW ENDS THE GAME
			if (result) {
				const closed = await closeGame(response.game_data, result.winner, result.reason);
				if (closed.status == 200) { response.game_data = closed.game_data; }
			}
			response.message = "Validation Successful";
			emitToGame(playerData.game_id, "move", { game_id: playerData.game_id, player_id: playerId }); // THE OPPONENT'S CLIENT LOADS THE NEW BOARD
		}
	}
	return res.json(gameResponse(response));
}

/* ---------------------------------------------------------------- */
// Restart (POST)
/* ---------------------------------------------------------------- */
/**
 * @description AI games: restarting a game that's still going forfeits it, then a new game starts with a new id
 * (the old one stays closed) at the same level. Guests only have one game, so theirs is overwritten
 * @param  {[string]} req.params.gameId [current game id]
 * @param  {[object]} req.body [{ ai_color: "w" | "b" }]
 * @return {[object]} response [{ status, game_id (the new game), ai, game_board, w_knight, b_knight, w_facing, b_facing, state, winner, reason, message }]
 */
async function restartGame(req, res) {
	const { ai_color } = req.body || {};
	if (ai_color != "w" && ai_color != "b") { return res.json({ status: 500, message: "Missing ai_color" }); }

	let response = await retrieveGame(req.params.gameId);
	if (!response.game_data) { return res.json({ status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	if (!isAiGame(gameData)) { return res.json({ status: 500, message: "Friend games can't be restarted" }); }

	const whiteId = ai_color == "w" ? "CHESS_AI" : playerId;
	const blackId = ai_color == "b" ? "CHESS_AI" : playerId;
	const level = aiLevel(gameData); // THE LEVEL ONLY CHANGES WITH A NEW GAME FROM HOME

	if (!req.user) { // GUESTS HAVE ONE GAME, IT'S OVERWRITTEN
		response = await initalizeGame(gameData.game_id.S, whiteId, blackId, level);
		return res.json(gameResponse(response));
	}

	if (gameOpen(gameData)) { await closeGame(gameData, playerId == gameData.white_player_id.S ? "b" : "w", "forfeit"); } // RESTARTING MID GAME FORFEITS IT
	response = await initalizeGame(false, whiteId, blackId, level); // CREATE NEW GAME
	return res.json(gameResponse(response));
}

/* ---------------------------------------------------------------- */
// AI Move (POST)
/* ---------------------------------------------------------------- */
/**
 * @description AI games: the server picks the AI's move at the game's level & saves it. The client only animates it.
 * Asking again after the AI moved returns the saved move instead of a new one
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, game_id, ai, ai_level, game_board, w_knight, b_knight, w_facing, b_facing, state, winner, reason, ai_move: { from, to, promotion }, message }]
 */
async function aiMoveGame(req, res) {
	let response = await retrieveGame(req.params.gameId);
	if (!response.game_data) { return res.json({ status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	if (!isAiGame(gameData)) { return res.json({ status: 500, message: "Friend games have no AI" }); }

	const aiColor = gameData.white_player_id.S == "CHESS_AI" ? "w" : "b";
	if (new Chess(gameData.game_board.S).turn() != aiColor) { return res.json(savedAiMove(response)); } // ALREADY MOVED
	if (!gameOpen(gameData)) { return res.json({ status: 500, message: "Game is over" }); }

	const prevBoard = gameData.game_board.S;
	const move = await aiMove(prevBoard, aiLevel(gameData)); // STOCKFISH AT THE GAME'S LEVEL
	const playerData = { game_id: req.params.gameId, player_id: "CHESS_AI", move: [move.from, move.to], promotion: move.promotion };

	response = await validateMove(playerData, gameData); // SAME RULES AS A PLAYER'S MOVE
	if (response.status == 200) {
		response = await updateGame(response.game_data, prevBoard); // PUT VALIDATED MOVE
		if (response.status != 200) { // ANOTHER REQUEST SAVED THE AI'S MOVE FIRST
			const latest = await retrieveGame(req.params.gameId);
			if (!latest.game_data) { return res.json({ status: latest.status, message: latest.message }); }
			return res.json(savedAiMove(latest));
		}
		const result = gameResult(response.game_data.game_board.S); // CHECKMATE OR A DRAW ENDS THE GAME
		if (result) {
			const closed = await closeGame(response.game_data, result.winner, result.reason);
			if (closed.status == 200) { response.game_data = closed.game_data; }
		}
		response.message = "AI moved";
		return res.json({ ...gameResponse(response), ai_move: move });
	}
	return res.json(gameResponse(response));
}

/* ---------------------------------------------------------------- */
// Levels (GET)
/* ---------------------------------------------------------------- */
/**
 * @description The AI levels & their approximate Elo for Home's dropdown
 * @return {[object]} response [{ status, levels: [{ level, elo }], default_level }]
 */
async function getLevels(req, res) {
	return res.json({ status: 200, ...levelList() });
}

/* ---------------------------------------------------------------- */
// Forfeit (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Friend games: closes the game & the other side wins. Both boards open the menu with Rematch
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, game_id, ai, game_board, w_knight, b_knight, w_facing, b_facing, state, winner, reason, message }]
 */
async function forfeitGame(req, res) {
	const response = await retrieveGame(req.params.gameId);
	if (!response.game_data) { return res.json({ status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	if (isAiGame(gameData)) { return res.json({ status: 500, message: "AI games restart instead" }); }
	if (!gameOpen(gameData)) { return res.json({ status: 500, message: "Game is already over" }); }

	const winner = playerId == gameData.white_player_id.S ? "b" : "w"; // THE OTHER SIDE WINS
	const closed = await closeGame(gameData, winner, "forfeit");
	if (closed.status == 200) { emitToGame(gameData.game_id.S, "game-over", { game_id: gameData.game_id.S, player_id: playerId, winner, reason: "forfeit" }); } // OPPONENT'S BOARD OPENS THE MENU
	return res.json(gameResponse(closed));
}

/* ---------------------------------------------------------------- */
// Rematch (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Friend games that are over: the first press waits 1 minute for the other player. If they press
 * in time a new game starts with the sides picked at random, and both boards load it
 * @param  {[string]} req.params.gameId [closed game id]
 * @return {[object]} response [{ status, new_game_id } once it starts | { status, waiting, expires_in } while waiting]
 */
async function rematchGame(req, res) {
	const response = await retrieveGame(req.params.gameId);
	if (!response.game_data) { return res.json({ status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	const gameId = gameData.game_id.S;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	if (isAiGame(gameData)) { return res.json({ status: 500, message: "AI games restart instead" }); }
	if (gameOpen(gameData)) { return res.json({ status: 500, message: "Game isn't over yet" }); }
	if (gameData.rematch_game_id) { return res.json({ status: 200, new_game_id: gameData.rematch_game_id.S, message: "Rematch started" }); }

	const waiting = { status: 200, waiting: true, expires_in: REMATCH_TIME, message: "Waiting for opponent" };
	if (await requestRematch(gameId, playerId, Date.now() + REMATCH_TIME)) { return res.json(waiting); } // FIRST PRESS

	const newGameId = `${new ObjectId()}`;
	if (!(await acceptRematch(gameId, playerId, newGameId))) { // OPPONENT'S MINUTE JUST RAN OUT, OR THE REMATCH ALREADY STARTED
		const latest = await retrieveGame(gameId);
		if (latest.game_data?.rematch_game_id) { return res.json({ status: 200, new_game_id: latest.game_data.rematch_game_id.S, message: "Rematch started" }); }
		if (await requestRematch(gameId, playerId, Date.now() + REMATCH_TIME)) { return res.json(waiting); }
		return res.json({ status: 500, message: "Rematch failed" });
	}

	// SIDES ARE PICKED AT RANDOM
	const players = [gameData.white_player_id.S, gameData.black_player_id.S];
	let randInt = Math.round(Math.random() * 1)
	const created = await initalizeGame(newGameId, players[randInt], players[1 - randInt]); // CREATE NEW GAME
	if (!created.game_data) { return res.json({ status: created.status, message: created.message }); }

	emitToGame(gameId, "rematch", { game_id: gameId, new_game_id: newGameId }); // BOTH BOARDS LOAD THE NEW GAME
	return res.json({ status: 200, new_game_id: newGameId, message: "Rematch started" });
}

/* ---------------------------------------------------------------- */
// Invite (POST)
/* ---------------------------------------------------------------- */
/**
 * @description New game vs a friend: looks up the opponent's Auth0 account by email. The challenger (signed in user) plays white
 * @param  {[object]} req.body [{ game_id (optional, must be new), opponent_email }]
 * @return {[object]} response [{ status, game_id, message }]
 */
async function inviteGame(req, res) {
	const { game_id, opponent_email } = req.body || {};
	if (!opponent_email) { return res.json({ status: 500, message: "Missing opponent_email" }); }
	const challengerId = userPlayerId(req.user); // requireAuth SETS req.user

	if (game_id) { // INVITES ONLY START NEW GAMES, NEVER OVERWRITE ONE
		const existing = await retrieveGame(game_id);
		if (existing.game_data) { return res.json({ status: 500, message: "Game id already in use" }); }
	}

	const opponentData = await getAuth0User(opponent_email); // WAS auth0UserByEmail IN THE LAMBDA
	if (!opponentData) { return res.json({ status: 500, message: "Opponent not found" }); }
	const opponentId = opponentData.user_id.split("auth0|")[1]; // PLAYER IDS DROP THE "auth0|", SAME AS THE CLIENT

	const response = await initalizeGame(game_id || false, challengerId, opponentId); // CREATE NEW GAME
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
	if (req.params.userId != userPlayerId(req.user)) { return res.status(403).json({ status: 403, message: "Not your game list" }); }

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
		ai_level: aiLevel(response.game_data),
		game_board: response.game_data.game_board.S,
		w_knight: response.game_data.w_knight.S,
		b_knight: response.game_data.b_knight.S,
		...facingData(response.game_data),
		...gameState(response.game_data),
		message: response.message,
	};
}

/**
 * @description Which way the kings, queens, bishops & rooks face, sent with every game response.
 * Games made before facing was saved get the start facing (every piece faces the other side)
 * @param  {[object]} gameData [game item]
 * @return {[object]} facing [{ w_facing, b_facing }, JSON strings of { square: the rank it faces (8 | 1) }]
 */
function facingData(gameData) {
	if (gameData.w_facing?.S && gameData.b_facing?.S) { return { w_facing: gameData.w_facing.S, b_facing: gameData.b_facing.S }; }
	return startFacing(gameData.game_board.S);
}

/**
 * @description The AI's level, sent with every AI game response
 * @param  {[object]} gameData [game item]
 * @return {[number]} level [null for friend games, AI games made before levels get the default]
 */
function aiLevel(gameData) {
	return isAiGame(gameData) ? readLevel(gameData.ai_level?.N) : null;
}

/**
 * @description The AI's last saved move, for a repeat /ai-move request (the client asks again when a game loads on the AI's turn)
 * @param  {[object]} response [retrieveGame response, it's the player's turn]
 * @return {[object]} response [gameResponse + ai_move, or an error when the AI hasn't moved yet]
 */
function savedAiMove(response) {
	const { moves, prev_move } = response.game_data;
	const lastMove = moves.S[moves.S.length - 1];
	if (!lastMove) { return { status: 500, message: "It's not the AI's turn" }; } // THE PLAYER MOVES FIRST
	const promotion = lastMove.match(/=([QRBN])/)?.[1].toLowerCase(); // "e8=Q+"
	return { ...gameResponse(response), ai_move: { from: prev_move.S[0], to: prev_move.S[1], promotion }, message: "AI already moved" };
}

/**
 * @description The game's result fields, sent with every game response
 * @param  {[object]} gameData [game item]
 * @return {[object]} result [{ state: "OPEN" | "CLOSED", winner: "w" | "b" | "draw" | null, reason }]
 */
function gameState(gameData) {
	return {
		state: gameData.state?.S || "OPEN",
		winner: gameData.winner?.S || null,
		reason: gameData.reason?.S || null,
	};
}

/**
 * @description True until the game is checkmated, drawn or forfeited
 * @param  {[object]} gameData [game item]
 * @return {[boolean]} open
 */
function gameOpen(gameData) {
	return gameData.state?.S != "CLOSED";
}

/**
 * @description The requester's player id in this game. Signed in players use their session,
 * a guest's player id is the game id (client/src/js/main.js guestGameId, saved in localStorage) & guests only get AI games
 * @param  {[object]} req [express request, req.user is null for guests]
 * @param  {[object]} gameData [game item]
 * @return {[string]} playerId [null when the requester isn't in the game]
 */
function playerInGame(req, gameData) {
	if (!req.user && !isAiGame(gameData)) { return null; }
	const playerId = req.user ? userPlayerId(req.user) : gameData.game_id.S;
	if (playerId == gameData.white_player_id.S || playerId == gameData.black_player_id.S) { return playerId; }
	return null;
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
 * @description Player id for a signed in user
 * @param  {[object]} user [session user]
 * @return {[string]} playerId [auth0 user id without "auth0|", same as the client]
 */
function userPlayerId(user) {
	return user.user_id.split("auth0|")[1];
}

/**
 * @description True when either side is the computer
 * @param  {[object]} gameData [game item]
 * @return {[boolean]} ai
 */
function isAiGame(gameData) {
	return gameData.white_player_id.S == "CHESS_AI" || gameData.black_player_id.S == "CHESS_AI";
}


module.exports = { getGame, newGame, moveGame, restartGame, aiMoveGame, getLevels, forfeitGame, rematchGame, inviteGame, getUserGames };
