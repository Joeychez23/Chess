/*
 *  chessController.js  --  chess server
 *	Chess Routes (was the chess lambda, chess-validation/lambdas/functions/chess/index.js)
 *  Each branch of the lambda's handler is its own route now. Responses keep the lambda's
 *  body ({ status, ..., message }) so the client checks them the same way. The HTTP status is the real one (#305),
 *  so a refusal's body can still say status: 500 under a 4xx, the client reads the body's
 *  The games & players are read & saved through the data service (dataClient.js), which checks every action again
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { Chess } = require("chess.js");
const { checkStartFen } = require("../utils/validate.js");
const { levelList, readLevel, aiMove, aiAcceptsDraw, analyzePosition } = require("../utils/ai.js");
const { getAuth0User } = require("../utils/auth0.js");
const { checkUsername } = require("../utils/username.js");
const { gameOpen, gamePending, isAiGame, inviterId, playerName, startParams, takebacksLeft, isColor } = require("../utils/games.js");
const { buildPgn } = require("../utils/pgn.js");
const { findOpening, latestOpening } = require("../utils/openings.js");
const config = require("../config.js");
const { setGuestCookie, readGuestGame } = require("../middleware/auth.js");
const { readRating, ratingSummary } = require("../utils/rating.js");
const { ifSaved, retrieveGame, retrieveRatings, saveMove, saveAiMove, takeback, declineTakeback, saveOpening, forfeit, offerDraw, declineDraw, answerAiDraw, newAiGame, newGuestGame, invite, accept, decline, rematch, cancelRematch, myGames, findUsername } = require("../dataClient.js");
const { emitToGame, emitToPlayer, isInGameRoom } = require("../socket.js");

const AI_DRAW_FREE_MOVES = 2; // UNTIL BOTH SIDES HAVE MADE THEIR FIRST MOVE THE AI TAKES ANY DRAW, WITHOUT ASKING THE ENGINE
const aiTurns = new Map(); // GAME ID -> THE AI MOVE BEING PICKED & SAVED (A PROMISE), SO PARALLEL /ai-move REQUESTS ASK THE ENGINE ONCE
const runningAnalyses = new Map(); // GAME ID -> { board, answer (A PROMISE) }, ONE ENGINE REQUEST AT A TIME PER GAME
const NOT_FOUND = /^(Game data not found|User data not found)/; // status: 500 IN THE BODY THAT ISN'T THE SERVER BREAKING (data-service/dynamoDB.js), ANY OTHER 500 IS
const CONFLICT = /^(Board changed|Game is already over|Game lists changed|Invite was already answered|It's not the AI's turn)/;

/* ---------------------------------------------------------------- */
// Get Game (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Returns the board & the player's color. Used to load a game and when the socket says the opponent moved
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, game_id, game_board, ai, ai_level, start_params, player_color, opponent_color, opponent_name, moves, prev_move, opening, w_knight, b_knight, w_piece, b_piece, state, winner, reason, draw_offer, message }]
 */
async function getGame(req, res) {
	const response = await retrieveGame(req.params.gameId);
	if (notYours(response)) { return notInGame(req, res); } // THE DATA SERVICE ONLY SHOWS A GAME TO A PLAYER IN IT
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); } // GAME NOT FOUND

	const playerId = playerInGame(req, response.game_data); // PICKS THE COLOR
	if (!playerId) { return notInGame(req, res); }

	return res.json(playerGame(response, playerId));
}

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
		ai: isAiGame(gameData),
		ai_level: aiLevel(gameData),
		start_params: startParams(gameData), // { color: "alternate" | "random" | "w" | "b", fen (a set position) }, WHAT RESTART & REMATCH REUSE
		player_color: playerColor,
		opponent_color: opponentColor,
		opponent_name: playerName(gameData, opponentColor), // FRIEND GAMES: HOME'S "vs Bob"
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

/* ---------------------------------------------------------------- */
// PGN (GET)
/* ---------------------------------------------------------------- */
/**
 * @description The game as a PGN file for the game menu's Download PGN. Built here because only the server has both players' names
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, pgn, filename, message }]
 */
async function getPgn(req, res) {
	const response = await retrieveGame(req.params.gameId);
	if (notYours(response)) { return notInGame(req, res); }
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	if (!playerInGame(req, gameData)) { return notInGame(req, res); }

	try {
		const player = req.user?.user_metadata?.screenname || (req.user ? "Player" : "Guest"); // AN AI GAME HAS ONE PLAYER, THE REQUESTER. ITS GAME SAVES NO NAMES
		return res.json({ status: 200, ...buildPgn(gameData, { site: config.clientUrl, aiLevel: aiLevel(gameData), player }), message: "PGN" });
	} catch (err) { // A SAVED MOVE THAT CAN'T BE REPLAYED
		console.log(`PGN failed: ${gameData.game_id.S}: ${err.message}`);
		return res.status(500).json({ status: 500, message: "This game can't be written as a PGN" });
	}
}

/* ---------------------------------------------------------------- */
// New Game (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Creates a game vs the AI, or a guest's New game: their game_id is overwritten with a new board (signed in users restart with /restart).
 * Signed in players have one AI game open at a time: while one is open this answers 409, unless replace_current forfeits it first.
 * A guest gets a guest_game cookie for the game, and a new game_id when theirs belongs to another browser (the response has the id used)
 * @param  {[object]} req.body [{ game_id (guests only: their saved id, left out = a new one. Signed in players' ids are made by the data service), start_color ("alternate" | "random" | "w" | "b", the requester's color from Home & the guest page,
 * the server picks the sides, the play page also sends random for a guest's missing game) OR player_id_1 (white) & player_id_2 (black) (gameplay's fallback for a guest's first game, one side is "CHESS_AI", the other side is always the requester),
 * ai_level (optional, the level dropdown), start_fen (optional, a set position to start from, the Start position box), replace_current (optional, true = forfeit the open AI game & start this one) }]
 * @return {[object]} response [{ status, game_id, ai, ai_level, game_board, w_knight, b_knight, w_piece, b_piece, message } | { status: 409, game_id (the open one), message } | { status: 400, message } (start_fen can't be played)
 * | { status: 429, message } (too many new games, middleware/rateLimit.js)]
 */
async function newGame(req, res) {
	const { game_id, player_id_1, player_id_2, ai_level, start_color, replace_current } = req.body || {};
	if (!start_color && (player_id_1 == "CHESS_AI") == (player_id_2 == "CHESS_AI")) { return res.status(400).json({ status: 500, message: "One player must be CHESS_AI, friend games start from /invite" }); }
	const position = checkStartFen(req.body?.start_fen); // CHECKED BEFORE ANYTHING IS FORFEITED OR SAVED
	if (position.message) { return res.status(400).json({ status: 400, message: position.message }); }

	const level = ai_level == undefined ? undefined : readLevel(ai_level); // LEFT OUT: THE DEFAULT LEVEL, OR A GUEST'S RESET KEEPS THEIR GAME'S
	const params = readStartParams(req.body, position.fen); // NO start_color (THE PLAY PAGE'S FIRST GUEST GAME) -> RANDOM FROM ITS RESTARTS ON
	const side = start_color ? undefined : (player_id_1 == "CHESS_AI" ? "b" : "w"); // THAT FIRST GAME'S SIDE COMES FROM THE PLAYER IDS

	if (!req.user) { // A GUEST'S OWN GAME IS RESET, ANOTHER BROWSER'S ID (OR CHESS_AI) GETS A NEW GAME WITH A NEW ID (THE CLIENT SAVES IT)
		const response = await newGuestGame({ game_id, color: params.color, side, level, start_fen: params.fen });
		if (response.game_data) { setGuestCookie(res, response.guest_token); } // ONLY THIS BROWSER CAN PLAY IT NOW, THE DATA SERVICE SIGNED IT FOR THIS GAME
		return reply(res, gameResponse(response));
	}

	const current = await currentGame(true); // ONE AI GAME AT A TIME (GUESTS ONLY EVER HAVE ONE, IT'S OVERWRITTEN)
	if (current && !replace_current) { return res.status(409).json({ status: 409, game_id: current.game_id.S, message: "AI game already open" }); }
	if (current) { await forfeit(current.game_id.S); } // NEW GAME FORFEITS THE OPEN ONE

	const response = await newAiGame({ color: params.color, level, start_fen: params.fen }); // THE DATA SERVICE PICKS THE SIDES (RANDOM FLIPS A COIN) & MAKES THE ID
	return reply(res, gameResponse(response));
}


/* ---------------------------------------------------------------- */
// Move (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Processes player move: GET -> the data service validates, saves & closes it (checkmate / draw), then tells the game's room so a friend sees it.
 * The requester always moves for themself, the AI's moves come from /ai-move
 * @param  {[string]} req.params.gameId [game id]
 * @param  {[object]} req.body [{ move: [from, to], promotion }]
 * @return {[object]} response [{ status, game_id, ai, game_board, opening, w_knight, b_knight, w_piece, b_piece, state, winner, reason, message }]
 */
async function moveGame(req, res) {
	const { move, promotion } = req.body || {};
	if (!Array.isArray(move) || move.length != 2) { return res.status(400).json({ status: 500, message: "Invalid piece movement" }); }

	let response = await retrieveGame(req.params.gameId); // GET GAME DATA BY ID
	if (notYours(response)) { return notInGame(req, res); }
	if (response.status != 200) { return reply(res, gameResponse(response)); }

	const playerId = playerInGame(req, response.game_data);
	if (!playerId) { return notInGame(req, res); }
	if (gamePending(response.game_data)) { return res.status(409).json({ status: 500, message: "Invite not accepted yet" }); }
	if (!gameOpen(response.game_data)) { return res.status(409).json({ status: 500, message: "Game is over" }); }

	const board = response.game_data.game_board.S;
	response = await ifSaved(() => saveMove(req.params.gameId, move, promotion), async () => { // THE DATA SERVICE PLAYS IT ON THE STORED BOARD, SAVES IT & CLOSES THE GAME ON CHECKMATE OR A DRAW
		const latest = await retrieveGame(req.params.gameId, true); // TOO SLOW: SAVED IF THE BOARD MOVED (ONLY THIS PLAYER CAN MOVE ON THEIR TURN)
		return latest.game_data && latest.game_data.game_board.S != board ? latest : null;
	});
	if (response.status != 200) { return res.status(moveRefusal(response)).json({ status: 500, message: response.message == "Not your turn" ? "Invalid piece movement" : response.message }); } // NOT LEGAL, NOT THEIR TURN, OR ANOTHER MOVE SAVED FIRST
	response.message = "Validation Successful";
	await recordOpening(response); // BEFORE THE OPPONENT & HOME ARE TOLD, THEY LOAD THE GAME
	emitToGame(req.params.gameId, "move", { game_id: req.params.gameId, player_id: playerId }); // THE OPPONENT'S CLIENT LOADS THE NEW BOARD
	if (!isAiGame(response.game_data)) { notifyHome(response.game_data); } // A FRIEND GAME'S PICTURE ON HOME
	return reply(res, gameResponse(response));
}


/* ---------------------------------------------------------------- */
// Restart (POST)
/* ---------------------------------------------------------------- */
/**
 * @description AI games: a new game starts with a new id, a game that's still going is forfeited first
 * (the old one stays closed) with the same start settings: the level & the player's color (Random draws again, Alternate switches). Guests only have one game, so theirs is overwritten
 * @param  {[string]} req.params.gameId [current game id]
 * @return {[object]} response [{ status, game_id (the new game), ai, game_board, w_knight, b_knight, w_piece, b_piece, state, winner, reason, message }]
 */
async function restartGame(req, res) {
	let response = await retrieveGame(req.params.gameId);
	if (notYours(response)) { return notInGame(req, res); }
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	if (!isAiGame(gameData)) { return res.status(409).json({ status: 500, message: "Friend games can't be restarted" }); }

	const params = startParams(gameData); // THE START SETTINGS ONLY CHANGE WITH A NEW GAME FROM HOME OR THE GUEST PAGE
	const level = aiLevel(gameData);

	if (!req.user) { // GUESTS HAVE ONE GAME, IT'S OVERWRITTEN
		response = await newGuestGame({ game_id: gameData.game_id.S, color: params.color, level, start_fen: params.fen });
		return reply(res, gameResponse(response));
	}

	if (gameOpen(gameData)) { await forfeit(gameData.game_id.S); } // RESTARTING MID GAME FORFEITS IT
	response = await newAiGame({ color: params.color, level, start_fen: params.fen }); // CREATE NEW GAME, RANDOM DRAWS AGAIN
	return reply(res, gameResponse(response));
}


/* ---------------------------------------------------------------- */
// AI Move (POST)
/* ---------------------------------------------------------------- */
/**
 * @description AI games: the server picks the AI's move at the game's level & saves it. The client only animates it.
 * Asking again after the AI moved returns the saved move instead of a new one
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, game_id, ai, ai_level, game_board, opening, w_knight, b_knight, w_piece, b_piece, state, winner, reason, ai_move: { from, to, promotion }, message }]
 */
async function aiMoveGame(req, res) {
	let response = await retrieveGame(req.params.gameId);
	if (notYours(response)) { return notInGame(req, res); }
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	if (!isAiGame(gameData)) { return res.status(409).json({ status: 500, message: "Friend games have no AI" }); }

	const aiColor = gameData.white_player_id.S == "CHESS_AI" ? "w" : "b";
	if (new Chess(gameData.game_board.S).turn() != aiColor) { return reply(res, savedAiMove(response)); } // ALREADY MOVED
	if (!gameOpen(gameData)) { return res.status(409).json({ status: 500, message: "Game is over" }); }

	let turn = aiTurns.get(req.params.gameId);
	if (!turn) { // NO AI MOVE IN FLIGHT FOR THIS GAME: THIS REQUEST PICKS IT, LATER ONES WAIT ON IT & GET THE SAME ANSWER
		turn = playAiTurn(req.params.gameId, gameData).finally(() => aiTurns.delete(req.params.gameId));
		aiTurns.set(req.params.gameId, turn);
	}
	return reply(res, await turn);
}

/**
 * @description Picks the AI's move & saves it. One at a time per game (aiTurns), each one asks the engine once
 * @param  {[string]} gameId [game id]
 * @param  {[object]} gameData [the game, it's the AI's turn]
 * @return {[object]} response [gameResponse + ai_move, or an error]
 */
async function playAiTurn(gameId, gameData) {
	const move = await aiMove(gameData.game_board.S, aiLevel(gameData)); // STOCKFISH AT THE GAME'S LEVEL
	const response = await saveAiMove(gameId, move); // THE DATA SERVICE CHECKS IT'S THE AI'S TURN & THE MOVE IS LEGAL (SAME RULES AS A PLAYER'S MOVE)
	if (response.status == 409) { // ANOTHER REQUEST SAVED THE AI'S MOVE FIRST (ONE THAT READ THE GAME BEFORE THIS TURN STARTED)
		const latest = await retrieveGame(gameId, true); // CONSISTENT, SO IT SEES THAT MOVE
		if (!latest.game_data) { return { status: latest.status, message: latest.message }; }
		return savedAiMove(latest);
	}
	if (response.status != 200) { return { status: 500, message: response.message }; }
	response.message = "AI moved";
	await recordOpening(response);
	return { ...gameResponse(response), ai_move: move };
}


/* ---------------------------------------------------------------- */
// Analysis (POST)
/* ---------------------------------------------------------------- */
/**
 * @description The best move & the evaluation of the game's saved board, for the Hint button & the evaluation bar. AI games & finished games only, in a friend game that's still going it's cheating.
 * The board comes from the game, never the request, so this can't be used to run the engine on anything else. One at a time per game: the same board shares the answer, another board is refused
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, game_board, from, to, eval, mate, winChance, message } from & to are null when the game can't go on | { status: 403, message } a friend game | { status: 409, message } another board is being analyzed | { status: 503, message } the engine didn't answer]
 */
async function analysisGame(req, res) {
	const response = await retrieveGame(req.params.gameId, true); // CONSISTENT: THE CLIENT ASKS RIGHT AFTER A MOVE
	if (notYours(response)) { return notInGame(req, res); }
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	if (!playerInGame(req, gameData)) { return notInGame(req, res); }
	if (!isAiGame(gameData) && (gameOpen(gameData) || gamePending(gameData))) { return res.status(403).json({ status: 403, message: "No hints in a friend game" }); }

	const gameId = gameData.game_id.S;
	const board = gameData.game_board.S;
	let running = runningAnalyses.get(gameId);
	if (running && running.board != board) { return res.status(409).json({ status: 409, message: "Wait for the analysis to finish." }); }
	if (!running) {
		running = { board, answer: analyzePosition(board).finally(() => runningAnalyses.delete(gameId)) };
		runningAnalyses.set(gameId, running);
	}
	try {
		return res.json({ status: 200, game_board: board, ...await running.answer, message: "Analysis" });
	} catch (err) {
		console.log(`STOCKFISH FAILED, NO ANALYSIS: ${err.message}`); // THE LINE MUST START WITH THIS: AN ALARM MATCHES IT (terraform/modules/monitoring)
		return res.status(503).json({ status: 503, message: "The engine isn't answering, try again in a moment" });
	}
}


/* ---------------------------------------------------------------- */
// Takeback (POST)
/* ---------------------------------------------------------------- */
/**
 * @description AI games: takes back the player's last move & the AI's reply, or just the player's move if the AI hasn't replied. No request step
 * & no limit, AI games aren't rated. Guests too. The data service works out how many on the stored board. Refused while the AI's move is being
 * picked here: it could save onto the earlier board. The opening goes back too, the latest one the remaining moves reached.
 * Friend games: a request the opponent has to accept (friendTakeback)
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [the whole game, same as getGame | { status, requested: true, opponent_name, message } friend games, waiting | { status: 409, message } the AI is moving, nothing to take back or a move landed first]
 */
async function takebackGame(req, res) {
	const response = await retrieveGame(req.params.gameId, true); // CONSISTENT: THE LATEST BOARD
	if (notYours(response)) { return notInGame(req, res); }
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	const gameId = gameData.game_id.S;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	if (gamePending(gameData)) { return res.status(409).json({ status: 500, message: "Invite not accepted yet" }); }
	if (!gameOpen(gameData)) { return res.status(409).json({ status: 500, message: "Game is over" }); }
	if (!isAiGame(gameData)) { return reply(res, await friendTakeback(gameData, playerId)); }
	if (aiTurns.has(gameId)) { return res.status(409).json({ status: 409, message: "Wait for the AI's move to finish." }); }

	const board = gameData.game_board.S;
	const saved = await ifSaved(() => takeback(gameId), async () => { // TOO SLOW: SAVED IF THE BOARD CHANGED
		const latest = await retrieveGame(gameId, true);
		return latest.game_data && latest.game_data.game_board.S != board ? latest : null;
	});
	if (saved.status != 200) { return reply(res, { status: saved.status, message: saved.message }); }
	await recordOpening(saved, latestOpening(saved.game_data.moves.S, startParams(saved.game_data).fen));
	return res.json(playerGame(saved, playerId));
}

/**
 * @description A press of Takeback in a friend game. The first press saves the request & the opponent is told, one per move, any new move ends it. The opponent's press
 * accepts it: one move goes back if the player who asked just moved, two if the opponent already replied, up to 3 per game, & both boards load the earlier position
 * @param  {[object]} gameData [the open friend game, as read]
 * @param  {[string]} playerId [the player pressing]
 * @return {[object]} response [the whole game when accepted | { status, requested: true, opponent_name, message } | { status: 409, message }]
 */
async function friendTakeback(gameData, playerId) {
	const gameId = gameData.game_id.S;
	const pressed = await ifSaved(() => takeback(gameId), async () => { // TOO SLOW: SAVED IF THEIR REQUEST STANDS, OR THE TAKEBACK WAS COUNTED
		const latest = await retrieveGame(gameId, true);
		if (!latest.game_data) { return null; }
		if (latest.game_data.takeback_player_id?.S == playerId) { return { status: 200, requested: true, message: "Takeback requested" }; }
		return Number(latest.game_data.takeback_count?.N || 0) > Number(gameData.takeback_count?.N || 0) ? latest : null;
	});
	if (pressed.status != 200) { return { status: pressed.status, message: pressed.message }; }
	if (!pressed.game_data) { // WAITING ON THE OPPONENT
		emitToGame(gameId, "takeback", { game_id: gameId, player_id: playerId, state: "requested" });
		return { status: 200, requested: true, opponent_name: playerName(gameData, playerId == gameData.white_player_id.S ? "b" : "w"), message: pressed.message };
	}
	await recordOpening(pressed, latestOpening(pressed.game_data.moves.S, startParams(pressed.game_data).fen)); // BEFORE THE OPPONENT & HOME ARE TOLD, THEY LOAD THE GAME
	emitToGame(gameId, "takeback", { game_id: gameId, player_id: playerId, state: "accepted", game_board: pressed.game_data.game_board.S }); // BOTH BOARDS LOAD THE EARLIER POSITION
	notifyHome(pressed.game_data); // THE GAME'S PICTURE ON HOME
	return playerGame(pressed, playerId);
}

/**
 * @description The asked player turns the takeback down (friend games), the game goes on & the player who asked is told
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, declined: true, message } | { status: 409, message } when the request already ended]
 */
async function declineTakebackGame(req, res) {
	const response = await retrieveGame(req.params.gameId, true);
	if (notYours(response)) { return notInGame(req, res); }
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameId = response.game_data.game_id.S;
	const playerId = playerInGame(req, response.game_data);
	if (!playerId) { return notInGame(req, res); }

	const declined = await ifSaved(() => declineTakeback(gameId), async () => { // TOO SLOW: SAVED IF THE REQUEST IS GONE
		const latest = await retrieveGame(gameId, true);
		return latest.game_data && !latest.game_data.takeback_player_id ? { status: 200, declined: true, message: "Takeback declined" } : null;
	});
	if (declined.status != 200) { return reply(res, { status: declined.status, message: declined.message }); }
	emitToGame(gameId, "takeback", { game_id: gameId, player_id: playerId, state: "declined" });
	return res.json({ status: 200, declined: true, message: declined.message });
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
 * @description Closes the game & the other side wins. The menu opens with Rematch on both boards (friend games) or Restart (AI games, guests too)
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, game_id, ai, game_board, w_knight, b_knight, w_piece, b_piece, state, winner, reason, message }]
 */
async function forfeitGame(req, res) {
	const response = await retrieveGame(req.params.gameId);
	if (notYours(response)) { return notInGame(req, res); }
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	if (gamePending(gameData)) { return res.status(409).json({ status: 500, message: "Invite not accepted yet, decline it instead" }); }
	if (!gameOpen(gameData)) { return res.status(409).json({ status: 500, message: "Game is already over" }); }

	const closed = await forfeitOpenGame(gameData, playerId);
	return reply(res, gameResponse(closed));
}

/**
 * @description Closes a game, the other side wins. A friend's board opens the menu & the players' Homes redraw.
 * Also used when a new invite or an accept replaces the player's open friend game
 * @param  {[object]} gameData [open game item]
 * @param  {[string]} playerId [player forfeiting]
 * @return {[object]} response [the data service's forfeit answer, { status: 500 } when the game was already over]
 */
async function forfeitOpenGame(gameData, playerId) {
	const closed = await ifSaved(() => forfeit(gameData.game_id.S), async () => { // THE OTHER SIDE WINS
		const latest = await retrieveGame(gameData.game_id.S, true); // TOO SLOW: SAVED IF IT'S CLOSED NOW
		return latest.game_data && !gameOpen(latest.game_data) ? latest : null;
	});
	if (closed.status != 200) { return { status: 500, message: closed.message }; } // ALREADY OVER
	tellGameOver(gameData, playerId, playerId == gameData.white_player_id.S ? "b" : "w");
	return closed;
}

/**
 * @description A friend game was forfeited or drawn by agreement: the opponent's board opens the menu & both Homes redraw
 * @param  {[object]} gameData [the friend game]
 * @param  {[string]} playerId [the player who forfeited, or accepted the draw]
 * @param  {[string]} winner ["w", "b" or "draw"]
 * @param  {[string]} reason ["forfeit" or "agreement"]
 */
function tellGameOver(gameData, playerId, winner, reason = "forfeit") {
	emitToGame(gameData.game_id.S, "game-over", { game_id: gameData.game_id.S, player_id: playerId, winner, reason }); // OPPONENT'S BOARD OPENS THE MENU
	notifyHome(gameData);
}


/* ---------------------------------------------------------------- */
// Draw Offers (POST)
/* ---------------------------------------------------------------- */
/**
 * @description A press of Offer Draw. The first press saves the offer, which lasts until the next move, one per player per move. The opponent's press accepts it & both boards show the draw.
 * In an AI game the answer comes right away: the AI always accepts until both sides have made their first move, then the engine decides & it accepts when it isn't ahead
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [gameResponse's closed game when it's a draw | { status, offered: true, opponent_name, message } friend games, waiting | { status, declined: true, message } the AI said no
 * | { status: 409, message } an offer already used this move or ended by a move]
 */
async function drawGame(req, res) {
	const response = await retrieveGame(req.params.gameId, true); // CONSISTENT: THE AI JUDGES THE LATEST BOARD
	if (notYours(response)) { return notInGame(req, res); }
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	const gameId = gameData.game_id.S;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	if (gamePending(gameData)) { return res.status(409).json({ status: 500, message: "Invite not accepted yet" }); }
	if (!gameOpen(gameData)) { return res.status(409).json({ status: 500, message: "Game is already over" }); }

	const pressed = await ifSaved(() => offerDraw(gameId), () => savedDraw(gameId, playerId));
	if (pressed.status != 200) { return reply(res, { status: pressed.status, message: pressed.message }); }
	if (pressed.game_data) { // THE OPPONENT'S OFFER WAS STANDING
		tellGameOver(pressed.game_data, playerId, "draw", "agreement");
		return res.json(gameResponse(pressed));
	}
	if (isAiGame(gameData)) { return reply(res, await aiDrawAnswer(gameData)); }

	emitToGame(gameId, "draw-offer", { game_id: gameId, player_id: playerId, state: "offered" });
	return res.json({ status: 200, offered: true, opponent_name: playerName(gameData, playerId == gameData.white_player_id.S ? "b" : "w"), message: pressed.message });
}

/**
 * @description The AI answers the offer that was just saved. A move landing during the engine's search ends the offer & the answer is refused
 * @param  {[object]} gameData [the AI game]
 * @return {[object]} response [gameResponse's closed game | { status, declined: true, message } | { status: 409, message }]
 */
async function aiDrawAnswer(gameData) {
	const gameId = gameData.game_id.S;
	const accept = gameData.moves.S.length < AI_DRAW_FREE_MOVES || await aiAcceptsDraw(gameData.game_board.S, gameData.white_player_id.S == "CHESS_AI" ? "w" : "b");
	const answer = await ifSaved(() => answerAiDraw(gameId, accept), async () => { // TOO SLOW: SAVED IF THE GAME CLOSED, OR THE OFFER IS GONE
		const latest = await retrieveGame(gameId, true);
		if (!latest.game_data) { return null; }
		const saved = accept ? !gameOpen(latest.game_data) : !latest.game_data.draw_offer_player_id;
		return saved ? { ...latest, declined: !accept } : null;
	});
	if (answer.status != 200) { return { status: answer.status, message: answer.message }; }
	return accept ? gameResponse(answer) : { status: 200, declined: true, message: "The AI declined the draw" };
}

/**
 * @description The offered player turns the draw down (friend games), the game goes on & the player who offered is told
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, declined: true, message } | { status: 409, message } when the offer already ended]
 */
async function declineDrawGame(req, res) {
	const response = await retrieveGame(req.params.gameId, true);
	if (notYours(response)) { return notInGame(req, res); }
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameId = response.game_data.game_id.S;
	const playerId = playerInGame(req, response.game_data);
	if (!playerId) { return notInGame(req, res); }

	const declined = await ifSaved(() => declineDraw(gameId), async () => { // TOO SLOW: SAVED IF THE OFFER IS GONE
		const latest = await retrieveGame(gameId, true);
		return latest.game_data && !latest.game_data.draw_offer_player_id ? { status: 200, declined: true, message: "Draw declined" } : null;
	});
	if (declined.status != 200) { return reply(res, { status: declined.status, message: declined.message }); }
	emitToGame(gameId, "draw-offer", { game_id: gameId, player_id: playerId, state: "declined" });
	return res.json({ status: 200, declined: true, message: declined.message });
}

/**
 * @description A draw press that timed out, read back: the game drawn or this player's offer standing
 * @param  {[string]} gameId [game id]
 * @param  {[string]} playerId [player who pressed]
 * @return {[object]} pressed [the data service's answer as it would have been, null when nothing saved]
 */
async function savedDraw(gameId, playerId) {
	const latest = await retrieveGame(gameId, true);
	if (latest.game_data?.reason?.S == "agreement") { return latest; }
	if (latest.game_data?.draw_offer_player_id?.S == playerId) { return { status: 200, offered: true, message: "Draw offered" }; }
	return null;
}


/* ---------------------------------------------------------------- */
// Rematch (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Friend games that are over: the first press waits 5 minutes for the other player. If they press
 * in time a new game starts with the same start settings (the inviter's color, Random draws again, Alternate switches), and both boards load it
 * @param  {[string]} req.params.gameId [closed game id]
 * @return {[object]} response [{ status, new_game_id } once it starts | { status, waiting, expires_in, opponent_name, opponent_here (still on the game page) } while waiting]
 */
async function rematchGame(req, res) {
	const response = await retrieveGame(req.params.gameId);
	if (notYours(response)) { return notInGame(req, res); }
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	const gameId = gameData.game_id.S;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	if (isAiGame(gameData)) { return res.status(409).json({ status: 500, message: "AI games restart instead" }); }
	if (gameOpen(gameData) || gamePending(gameData)) { return res.status(409).json({ status: 500, message: "Game isn't over yet" }); }

	const pressed = await ifSaved(() => rematch(gameId), () => savedRematch(gameId, playerId)); // THE DATA SERVICE: BOTH PRESSES WITHIN 5 MINUTES, NEITHER PLAYER IN ANOTHER FRIEND GAME, THE NEW GAME WITH THE INVITER'S PICK
	if (pressed.status == 409) { return res.status(409).json({ status: 409, message: pressed.message }); } // ONE FRIEND GAME AT A TIME
	if (pressed.waiting) { // FIRST PRESS
		const opponentIsWhite = playerId != gameData.white_player_id.S;
		return res.json({
			status: 200,
			waiting: true,
			expires_in: pressed.expires_in,
			opponent_name: playerName(gameData, opponentIsWhite ? "w" : "b"),
			opponent_here: isInGameRoom(gameId, opponentIsWhite ? gameData.white_player_id.S : gameData.black_player_id.S),
			message: pressed.message
		});
	}
	if (!pressed.new_game_id) { return res.status(500).json({ status: 500, message: pressed.message || "Rematch failed" }); }

	if (pressed.game_data) { // THE REMATCH IS OPEN: A PRESS AFTER A FAILED ONE IS THE FIRST THE OTHER BOARD HEARS OF IT
		emitToGame(gameId, "rematch", { game_id: gameId, new_game_id: pressed.new_game_id }); // BOTH BOARDS LOAD THE NEW GAME
		notifyHome(pressed.game_data);
		for (let i = 0; i < pressed.dropped_invites.length; i++) { notifyHome(pressed.dropped_invites[i]); } // THEY'RE BOTH IN A FRIEND GAME NOW, THEIR SENT INVITES ARE CANCELLED
	}
	return res.json({ status: 200, new_game_id: pressed.new_game_id, message: "Rematch started" });
}

/**
 * @description The player who pressed Rematch takes it back. A cancel that fails is answered 503 & pressing again is safe
 * @param  {[string]} req.params.gameId [closed game id]
 * @return {[object]} response [{ status, cancelled, message }, cancelled: false when the rematch already started & the socket's "rematch" is on its way]
 */
async function cancelRematchGame(req, res) {
	const response = await cancelRematch(req.params.gameId);
	if (notYours(response)) { return notInGame(req, res); }
	return reply(res, { status: response.status, cancelled: response.cancelled, message: response.message });
}

/**
 * @description A rematch press that timed out, read back: the new game (both boards are told again, loading it twice is harmless) or this press waiting.
 * The invites it dropped aren't known here, those Homes redraw when next loaded
 * @param  {[string]} gameId [closed game id]
 * @param  {[string]} playerId [player who pressed]
 * @return {[object]} pressed [the data service's rematch answer as it would have been, null when nothing saved]
 */
async function savedRematch(gameId, playerId) {
	const latest = (await retrieveGame(gameId, true)).game_data;
	if (latest?.rematch_game_id) {
		const made = await retrieveGame(latest.rematch_game_id.S, true);
		if (!made.game_data) { return null; }
		return { status: 200, new_game_id: latest.rematch_game_id.S, game_data: made.game_data, dropped_invites: [] };
	}
	const expiresIn = Number(latest?.rematch_expires?.N) - Date.now();
	if (latest?.rematch_player_id?.S == playerId && expiresIn > 0) { return { status: 200, waiting: true, expires_in: expiresIn, message: "Waiting for opponent" }; }
	return null;
}


/* ---------------------------------------------------------------- */
// Invite (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Invites a friend by email: looks up their Auth0 account & creates a PENDING game, they accept or decline it on Home.
 * The challenger (signed in user) picks their color, the sides are drawn now so the invite shows them. One sent invite at a time: a new one deletes the last one.
 * Signed in players have one friend game open at a time: while one is open this answers 409, unless replace_current forfeits it first
 * @param  {[object]} req.body [{ opponent_email, start_color ("alternate" | "random" | "w" | "b", the challenger's color, left out = Random),
 * start_fen (optional, a set position to start from), takebacks (optional, 0 = off, left out = up to 3 per game), replace_current (optional, true = forfeit the open friend game & invite) }]
 * @return {[object]} response [{ status, game_id, state: "PENDING", message } | { status: 409, game_id (the open one), message } | { status: 400, message } (start_fen can't be played)]
 */
async function inviteGame(req, res) {
	const { opponent_email, opponent_username, replace_current } = req.body || {};
	if (!opponent_email && !opponent_username) { return res.status(400).json({ status: 500, message: "Missing opponent" }); }
	const position = checkStartFen(req.body?.start_fen); // CHECKED BEFORE ANYTHING IS FORFEITED OR SAVED
	if (position.message) { return res.status(400).json({ status: 400, message: position.message }); }
	const challengerId = userPlayerId(req.user); // requireAuth SETS req.user

	const opponent = await findOpponent(opponent_email, opponent_username);
	if (!opponent) { return res.status(404).json({ status: 500, message: "Opponent not found" }); }
	const opponentId = opponent.id;
	if (opponentId == challengerId) { return res.status(400).json({ status: 500, message: opponent_username ? "That's your username" : "That's your email" }); }

	const mine = await myGames();
	const theirInvite = receivedInvites(mine).find((invite) => invite.player_id == opponentId);
	if (theirInvite) { return res.status(409).json({ status: 500, game_id: theirInvite.game_id, message: "They already invited you" }); } // ACCEPT THEIRS INSTEAD

	const current = openGame(mine, false); // ONE FRIEND GAME AT A TIME
	if (current && !replace_current) { return res.status(409).json({ status: 409, game_id: current.game_id.S, message: "Friend game already open" }); }
	if (current) { await forfeitOpenGame(current, challengerId); } // A NEW INVITE FORFEITS THE OPEN ONE
	if (mine.user_data?.sent_invite) { await dropInvite(mine.user_data.sent_invite.game_id); } // ONE SENT INVITE AT A TIME

	const params = readStartParams(req.body, position.fen);
	const screenname = opponent.screenname; // THEIR NAME UNTIL THEY PICK A USERNAME (THE CHALLENGER'S IS IN THEIR TOKEN)
	const response = await invite({ opponent_id: opponentId, opponent_screenname: typeof screenname == "string" ? screenname.slice(0, 50) : undefined, color: params.color, start_fen: params.fen, takebacks: params.takebacks }); // CREATE NEW GAME (THE DATA SERVICE MAKES THE ID), PENDING UNTIL THEY ACCEPT. RANDOM IS DRAWN NOW, THE INVITE SAYS "YOU PLAY BLACK (RANDOM)"
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); }

	notifyHome(response.game_data); // THEIR HOME SHOWS THE INVITE
	return res.json({
		status: response.status,
		game_id: response.game_data.game_id.S,
		state: "PENDING",
		message: response.message,
	});
}


/**
 * @description The player an invite is for, by username (the data service) or by email (Auth0)
 * @param  {[string]} email [opponent_email, used when there's no username]
 * @param  {[string]} username [opponent_username]
 * @return {[object]} opponent [{ id, screenname (by email only, their name until they pick a username) }, null when nobody has it]
 */
async function findOpponent(email, username) {
	if (username) {
		const checked = checkUsername(username);
		const found = checked.username ? await findUsername(checked.username) : null;
		return found?.player_id ? { id: found.player_id } : null;
	}
	const user = await getAuth0User(email); // WAS auth0UserByEmail IN THE LAMBDA
	return user ? { id: user.user_id.split("auth0|")[1], screenname: user.user_metadata?.screenname } : null; // PLAYER IDS DROP THE "auth0|", SAME AS THE CLIENT
}

/* ---------------------------------------------------------------- */
// Accept Invite (POST)
/* ---------------------------------------------------------------- */
/**
 * @description The invited player starts the game: PENDING -> OPEN. Their own sent invite is deleted (they're in a game now).
 * While they have a friend game open this answers 409, unless replace_current forfeits it first
 * @param  {[string]} req.params.gameId [PENDING game id]
 * @param  {[object]} req.body [{ replace_current (optional, true = forfeit the open friend game & accept) }]
 * @return {[object]} response [{ status, game_id, ai, game_board, w_knight, b_knight, w_piece, b_piece, state, winner, reason, message } | { status: 409, game_id (the open one), message }]
 */
async function acceptGame(req, res) {
	const { replace_current } = req.body || {};
	const response = await retrieveGame(req.params.gameId);
	if (notYours(response)) { return notInGame(req, res); }
	if (!response.game_data) { return res.status(httpStatus(response)).json({ status: response.status, message: "Invite not found" }); } // DECLINED, CANCELLED OR EXPIRED

	const gameData = response.game_data;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	if (!gamePending(gameData)) { return res.status(409).json({ status: 500, message: "Invite was already answered" }); }
	if (playerId == inviterId(gameData)) { return res.status(403).json({ status: 500, message: "Only the invited player can accept" }); }

	const accepted = await ifSaved(() => accept(gameData.game_id.S, replace_current), async () => { // THE DATA SERVICE: THEIR OPEN FRIEND GAME (409 UNLESS replace_current), THE INVITER ISN'T BUSY, THEN THE FORFEIT, THEIR SENT INVITE & THE ACCEPT
		const latest = await retrieveGame(gameData.game_id.S, true); // TOO SLOW: SAVED IF IT'S OPEN NOW. WHAT IT FORFEITED & DROPPED ISN'T KNOWN HERE, THOSE BOARDS & HOMES SEE IT WHEN NEXT LOADED
		return latest.game_data && gameOpen(latest.game_data) ? { ...latest, forfeited: null, dropped_invites: [] } : null;
	});
	if (accepted.status == 409 && accepted.game_id) { return res.status(409).json({ status: 409, game_id: accepted.game_id, message: "Friend game already open" }); }
	if (accepted.message == "They're in another game now") { // THE INVITER STARTED ANOTHER FRIEND GAME SINCE (A REMATCH, OR THEY ACCEPTED ONE)
		await dropInvite(gameData.game_id.S);
		return res.status(409).json({ status: 500, message: "They're in another game now" });
	}
	if (accepted.forfeited) { tellGameOver(accepted.forfeited, playerId, accepted.forfeited.winner?.S); } // ACCEPTING FORFEITED THE OPEN ONE
	for (let i = 0; i < (accepted.dropped_invites || []).length; i++) { notifyHome(accepted.dropped_invites[i]); } // THEIR SENT INVITE WAS CANCELLED
	if (accepted.status == 200) { notifyHome(gameData); } // THE INVITER'S HOME SHOWS THE GAME
	return reply(res, gameResponse(accepted));
}


/* ---------------------------------------------------------------- */
// Decline Invite (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Deletes a PENDING game: the invited player declines it, or the inviter cancels it
 * @param  {[string]} req.params.gameId [PENDING game id]
 * @return {[object]} response [{ status, game_id, message }]
 */
async function declineGame(req, res) {
	const response = await retrieveGame(req.params.gameId);
	if (notYours(response)) { return notInGame(req, res); }
	if (!response.game_data) { return res.status(httpStatus(response)).json({ status: response.status, message: "Invite not found" }); }

	const gameData = response.game_data;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	if (!gamePending(gameData)) { return res.status(409).json({ status: 500, message: "Invite was already answered" }); }

	const deleted = await decline(gameData.game_id.S);
	if (deleted.status == 200) { notifyHome(gameData); } // THE OTHER PLAYER'S HOME DROPS IT
	return res.status(httpStatus(deleted)).json({ status: deleted.status == 200 ? 200 : 500, game_id: gameData.game_id.S, message: deleted.message });
}


/* ---------------------------------------------------------------- */
// User Games (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Returns a user's game lists for Home, expired games & invites are pruned first
 * @param  {[string]} req.params.userId [auth0 user id without "auth0|"]
 * @return {[object]} response [{ status, user_id, requested_games, open_games, closed_games, ai_game_id / friend_game_id (the open AI / friend game or null),
 * open_game_list ([{ game_id, ai, ai_level, opponent_name, player_color, start_params, opening }], newest last),
 * closed_game_list (the same & winner, reason, the last 20 finished games, newest first),
 * sent_invite ({ game_id, name, player_color, start_params } or null), received_invites ([{ game_id, name, player_color, start_params }]),
 * rating ({ rating, provisional, rated_games }, Home's "Rating // 1520?"), message }]
 */
async function getUserGames(req, res) {
	if (req.params.userId != userPlayerId(req.user)) { return res.status(403).json({ status: 403, message: "Not your game list" }); }

	const response = await myGames(); // THE DATA SERVICE DROPS EXPIRED GAMES & INVITES BEFORE HOME LISTS THEM
	if (!response.user_data) { return reply(res, { status: response.status, rating: ratingSummary(readRating(null)), message: response.message }); } // NO GAMES YET, THE STARTING RATING
	const userData = response.user_data;
	const inviteBody = (invite) => ({ game_id: invite.game_id, name: invite.name, player_color: invite.player_color, start_params: invite.start_params }); // THE OTHER PLAYER'S ID STAYS ON THE SERVER

	return res.json({
		status: response.status,
		user_id: userData.user_id.S,
		requested_games: userData.requested_games.S,
		open_games: userData.open_games.S,
		closed_games: userData.closed_games.S,
		ai_game_id: userData.ai_game_id, // HOME DRAWS ITS BOARD & LINKS IT (Continue current game)
		friend_game_id: userData.friend_game_id, // SAME, IN PLAY A FRIEND
		open_game_list: userData.open_game_list.map((game) => gameSummary(game, req.params.userId)), // YOUR GAMES: "vs AI // LEVEL 3 // YOU PLAY WHITE (RANDOM)"
		closed_game_list: (userData.closed_game_list || []).map((game) => ({ ...gameSummary(game, req.params.userId), winner: game.winner?.S || null, reason: game.reason?.S || null })), // FINISHED GAMES: WON, LOST OR DRAW & WHY
		sent_invite: userData.sent_invite ? inviteBody(userData.sent_invite) : null, // "INVITE SENT TO BOB // WAITING"
		received_invites: userData.received_invites.map(inviteBody), // "BOB INVITED YOU", ACCEPT & DECLINE
		settings: userSettings(userData), // THE SETTINGS PAGE'S DEFAULT START SETTINGS, HOME'S DROPDOWNS START ON THEM
		games_finished: JSON.parse(userData.closed_games.S).length, // THE SETTINGS PAGE'S ACCOUNT BOX
		rating: ratingSummary(readRating(userData)), // FRIEND GAMES CHANGE IT (closeGame IN data-service/dynamoDB.js)
		message: response.message,
	});
}

/* ---------------------------------------------------------------- */
// Ratings (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Both players' ratings for the game menu ("You 1520 // Bob 1480?"), asked for once when the game loads.
 * GET /game/:gameId doesn't send them, it runs after every move & would read both user rows each time
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, rated (friend games), player_rating, opponent_rating ({ rating, provisional, rated_games }, null in AI games),
 * opponent_name, rating_change ({ before, after } once a rated game is over, null otherwise), message }]
 */
async function getRatings(req, res) {
	const response = await retrieveGame(req.params.gameId);
	if (notYours(response)) { return notInGame(req, res); }
	if (!response.game_data) { return reply(res, { status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	const playerColor = playerId == gameData.white_player_id.S ? "w" : "b";
	const opponentColor = playerColor == "w" ? "b" : "w";
	const opponentId = opponentColor == "w" ? gameData.white_player_id.S : gameData.black_player_id.S;
	if (isAiGame(gameData)) { return res.json({ status: 200, rated: false, player_rating: null, opponent_rating: null, opponent_name: null, rating_change: null, message: "AI games aren't rated" }); }

	const ratings = (await retrieveRatings(gameData.game_id.S)).ratings || {}; // BOTH PLAYERS, ONLY FOR A PLAYER IN THE GAME
	let change = null;
	try { change = JSON.parse(gameData.ratings?.S || "{}")[playerColor] || null; } catch { }
	return res.json({
		status: 200,
		rated: true,
		player_rating: ratingSummary(ratings[playerId] || readRating(null)),
		opponent_rating: ratingSummary(ratings[opponentId] || readRating(null)),
		opponent_name: playerName(gameData, opponentColor),
		rating_change: change,
		message: "Ratings",
	});
}

/**
 * @description The requester's open AI game or friend game, they only have one of each at a time
 * @param  {[object]} mine [myGames(): their row with expired games & invites pruned]
 * @param  {[boolean]} ai [true = the AI game, false = the friend game]
 * @return {[object]} gameData [the game item, null when there's none open]
 */
function openGame(mine, ai) {
	const userData = mine.user_data;
	if (!userData) { return null; } // NO GAMES YET
	const gameId = ai ? userData.ai_game_id : userData.friend_game_id;
	return userData.open_game_list.find((game) => game.game_id.S == gameId) || null;
}

/**
 * @description The requester's open AI game or friend game, read now
 * @param  {[boolean]} ai [true = the AI game, false = the friend game]
 * @return {[object]} gameData [null when there's none open]
 */
async function currentGame(ai) {
	return openGame(await myGames(), ai);
}

/**
 * @description The PENDING invites the requester got
 * @param  {[object]} mine [myGames()]
 * @return {[array]} invites [[{ game_id, name, player_id, player_color, start_params }], see pruneInvites in data-service/dynamoDB.js]
 */
function receivedInvites(mine) {
	return mine.user_data?.received_invites || [];
}

/**
 * @description Deletes an invite the requester is in (a new invite replaces theirs, or the inviter is in a game now) & tells both Homes
 * @param  {[string]} gameId [PENDING game id]
 */
async function dropInvite(gameId) {
	const response = await retrieveGame(gameId);
	if (!response.game_data || !gamePending(response.game_data)) { return; } // ALREADY ANSWERED
	const deleted = await decline(gameId);
	if (deleted.status == 200) { notifyHome(response.game_data); }
}

/**
 * @description Delete my data (the settings page): the player leaves every game before their user_db row goes. Their open friend game
 * is forfeited (the friend wins & their board shows it), so is their open AI game, their sent invite is cancelled & the invites they got are declined
 * @param  {[string]} playerId [auth0 user id without "auth0|", the requester]
 */
async function leaveAllGames(playerId) {
	const mine = await myGames();
	const friendGame = openGame(mine, false);
	if (friendGame) { await forfeitOpenGame(friendGame, playerId); }
	const aiGame = openGame(mine, true);
	if (aiGame) { await forfeit(aiGame.game_id.S); }

	if (mine.user_data?.sent_invite) { await dropInvite(mine.user_data.sent_invite.game_id); }
	const received = receivedInvites(mine);
	for (let i = 0; i < received.length; i++) { await dropInvite(received[i].game_id); } // DECLINED
}

/**
 * @description Tells both players' Homes a friend game or invite changed (socket "games"), Home redraws Play a friend, Invites & Your games
 * @param  {[object]} gameData [game item]
 */
function notifyHome(gameData) {
	emitToPlayer(gameData.white_player_id.S, "games", { game_id: gameData.game_id.S });
	emitToPlayer(gameData.black_player_id.S, "games", { game_id: gameData.game_id.S });
}

/**
 * @description The real HTTP status of an answer whose body may say status: 500 for a refusal (the lambda's body, the client reads it). A 500 nothing here recognizes stays a 500:
 * those are what the 5xx alarm is for (terraform/modules/monitoring)
 * @param  {[object]} response [an answer with { status, message }]
 * @return {[number]} status [404 not found, 409 conflict, otherwise the answer's own status]
 */
function httpStatus(response) {
	if (response.status != 500) { return response.status; }
	if (NOT_FOUND.test(response.message)) { return 404; }
	if (CONFLICT.test(response.message)) { return 409; }
	return 500;
}

/**
 * @description The HTTP status of a move the data service refused. Its 400 is a move that isn't legal or a board that can't be read, its 409 is not their turn, the game's over or another move saved first
 * @param  {[object]} response [the data service's { status, message }]
 * @return {[number]} status [422 illegal move, 500 a corrupted board, otherwise httpStatus]
 */
function moveRefusal(response) {
	if (response.status != 400) { return httpStatus(response); }
	return response.message == "Invalid piece movement" ? 422 : 500;
}

/**
 * @description Sends a body with its real HTTP status (httpStatus), for answers that can be a game or a refusal
 * @param  {[object]} res [express response]
 * @param  {[object]} body [{ status, ..., message }, sent as it is]
 */
function reply(res, body) {
	return res.status(httpStatus(body)).json(body);
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
		opening: readOpening(response.game_data),
		w_knight: response.game_data.w_knight.S,
		b_knight: response.game_data.b_knight.S,
		w_piece: response.game_data.w_piece.S,
		b_piece: response.game_data.b_piece.S,
		...gameState(response.game_data),
		message: response.message,
	};
}

/**
 * @description Saves the opening of the position a move just saved. The latest match stays once the game leaves the book. The move is already saved,
 * so a failed save only logs: the next position in the book saves its own name
 * @param  {[object]} response [the saved move's { game_data }, its opening is updated when this saves one]
 * @param  {[object]} opening [the opening to save, left out = the board's]
 */
async function recordOpening(response, opening = findOpening(response.game_data.game_board.S)) {
	const gameData = response.game_data;
	const saved = readOpening(gameData);
	if (!opening || (opening.eco == saved?.eco && opening.name == saved?.name)) { return; }
	try {
		const answer = await saveOpening(gameData.game_id.S, gameData.game_board.S, opening);
		if (answer.status == 200) { gameData.opening = answer.game_data.opening; } // ANYTHING ELSE: ANOTHER MOVE LANDED FIRST, ITS REQUEST SAVES ITS OWN OPENING
	} catch (err) {
		console.log(`Saving the opening failed: ${gameData.game_id.S}: ${err.message}`);
	}
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
 * @description The start settings a request asks for (Home & the guest page's dropdowns & Start position box, the invite form)
 * @param  {[object]} body [req.body, { start_color: "alternate" | "random" | "w" | "b", takebacks (the invite form): 0 = off }]
 * @param  {[string]} fen [the set position from checkStartFen(body.start_fen), false = the standard position]
 * @return {[object]} params [{ color, fen (only for a set position), takebacks (only when off: 0) }, any other color is Random (the default)]
 */
function readStartParams(body, fen) {
	const color = isColor(body?.start_color) ? body.start_color : "random";
	let params = { color };
	if (fen) { params.fen = fen; } // REPLAYING moves (THREEFOLD, PGN, TAKEBACKS, REPLAYS) HAS TO START FROM THIS, NOT THE STANDARD POSITION
	if (body?.takebacks === 0) { params.takebacks = 0; }
	return params;
}

/**
 * @description The settings a request saves (the settings page's Default start settings)
 * @param  {[object]} body [req.body, { ai_level, ai_color, friend_color }]
 * @return {[object]} settings [{ ai_level (1 - 8, anything else is the default level), ai_color, friend_color ("alternate" | "random" | "w" | "b", anything else is Alternate) }]
 */
function readSettings(body) {
	return { ai_level: readLevel(body?.ai_level), ai_color: readColor(body?.ai_color), friend_color: readColor(body?.friend_color) };
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

function readColor(value) { return isColor(value) ? value : "alternate"; } // ALTERNATE IS THE DEFAULT

/**
 * @description One game for Your games or Finished games on Home
 * @param  {[object]} gameData [game item, pruneGameList's projection is enough]
 * @param  {[string]} playerId [the user the list is for]
 * @return {[object]} summary [{ game_id, ai, ai_level, opponent_name, player_color, start_params, opening }]
 */
function gameSummary(gameData, playerId) {
	const playerColor = playerId == gameData.white_player_id.S ? "w" : "b";
	return {
		game_id: gameData.game_id.S,
		ai: isAiGame(gameData),
		ai_level: aiLevel(gameData),
		opponent_name: playerName(gameData, playerColor == "w" ? "b" : "w"),
		player_color: playerColor,
		start_params: startParams(gameData),
		opening: readOpening(gameData),
	};
}

/**
 * @description The game's result fields, sent with every game response
 * @param  {[object]} gameData [game item]
 * @return {[object]} result [{ state: "PENDING" | "OPEN" | "CLOSED", winner: "w" | "b" | "draw" | null, reason, draw_offer: the color with a standing draw offer | null,
 * takeback_request: the color with a standing takeback request | null, takebacks_left: friend games' takebacks left, AI games have no limit: null }]
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
	};
}

/**
 * @description The requester's player id in this game. Signed in players use their session, a guest's player id is their
 * game's id, from the signed guest_game cookie newGame gave them (the client also keeps it in localStorage) & guests only get AI games.
 * So a guest is only ever in that one game: a guest whose game id is "CHESS_AI" or another player's id isn't in their games
 * @param  {[object]} req [express request, req.user is null for guests]
 * @param  {[object]} gameData [game item]
 * @return {[string]} playerId [null when the requester isn't in the game]
 */
function playerInGame(req, gameData) {
	if (!req.user && !isAiGame(gameData)) { return null; }
	const playerId = req.user ? userPlayerId(req.user) : readGuestGame(req); // A GUEST WITHOUT THE COOKIE (ANOTHER BROWSER) ISN'T IN IT
	if (!req.user && playerId != gameData.game_id.S) { return null; } // ONLY THEIR OWN GAME, NOT EVERY GAME WITH THEIR ID ON ONE SIDE ("CHESS_AI" IS ON EVERY AI GAME)
	if (playerId && (playerId == gameData.white_player_id.S || playerId == gameData.black_player_id.S)) { return playerId; }
	return null;
}

/**
 * @description True when the data service refused because the requester isn't in the game (403), or isn't anyone (401: no token or guest cookie).
 * A signed in player's token running out mid-request never gets here, dataClient.js throws for it (401 "SESSION EXPIRED", #278)
 * @param  {[object]} response [a data service answer]
 * @return {[boolean]} refused
 */
function notYours(response) {
	return response.status == 401 || response.status == 403;
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


module.exports = { getGame, getPgn, newGame, moveGame, restartGame, aiMoveGame, analysisGame, takebackGame, declineTakebackGame, getLevels, forfeitGame, drawGame, declineDrawGame, rematchGame, cancelRematchGame, inviteGame, acceptGame, declineGame, getUserGames, getRatings, leaveAllGames, readSettings, userPlayerId, httpStatus };
