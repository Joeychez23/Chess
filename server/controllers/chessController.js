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
const { validateMove, gameResult } = require("../utils/validate.js");
const { levelList, readLevel, aiMove } = require("../utils/ai.js");
const { getAuth0User } = require("../utils/auth0.js");
const { initalizeGame, retrieveGame, updateGame, closeGame, acceptInvite, deleteInvite, requestRematch, acceptRematch, retrieveUser, pruneOpenGames, pruneInvites } = require("../dynamoDB.js");
const { emitToGame, emitToPlayer } = require("../socket.js");

const REMATCH_TIME = 60 * 1000; // BOTH PLAYERS MUST PRESS REMATCH WITHIN 1 MINUTE

/* ---------------------------------------------------------------- */
// Get Game (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Returns the board & the player's color. Used to load a game and when the socket says the opponent moved
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, game_id, game_board, ai, ai_level, player_color, opponent_color, opponent_name, moves, prev_move, w_knight, b_knight, w_piece, b_piece, state, winner, reason, message }]
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
		opponent_name: playerName(gameData, opponentColor), // FRIEND GAMES: HOME'S "vs Bob"
		moves: gameData.moves.S,
		prev_move: gameData.prev_move.S,
		w_knight: gameData.w_knight.S,
		b_knight: gameData.b_knight.S,
		w_piece: gameData.w_piece.S,
		b_piece: gameData.b_piece.S,
		...gameState(gameData),
		message: response.message,
	});
}

/* ---------------------------------------------------------------- */
// New Game (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Creates a game vs the AI, or restarts a guest's game: their game_id is overwritten with a new board (signed in users restart with /restart).
 * Signed in players have one AI game open at a time: while one is open this answers 409, unless replace_current forfeits it first
 * @param  {[object]} req.body [{ game_id (optional, generated when left out), player_id_1 (white), player_id_2 (black), ai_level (optional, Home's dropdown),
 * replace_current (optional, true = forfeit the open AI game & start this one) }, one side is "CHESS_AI", the other side is always the requester]
 * @return {[object]} response [{ status, game_id, ai, ai_level, game_board, w_knight, b_knight, w_piece, b_piece, message } | { status: 409, game_id (the open one), message }]
 */
async function newGame(req, res) {
	const { game_id, player_id_1, player_id_2, ai_level, replace_current } = req.body || {};
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

	if (req.user) { // ONE AI GAME AT A TIME (GUESTS ONLY EVER HAVE ONE, IT'S OVERWRITTEN)
		const current = await currentGame(playerId, true);
		if (current && !replace_current) { return res.json({ status: 409, game_id: current.game_id.S, message: "AI game already open" }); }
		if (current) { await closeGame(current, playerId == current.white_player_id.S ? "b" : "w", "forfeit"); } // NEW GAME FORFEITS THE OPEN ONE
	}

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
 * @return {[object]} response [{ status, game_id, ai, game_board, w_knight, b_knight, w_piece, b_piece, state, winner, reason, message }]
 */
async function moveGame(req, res) {
	const { move, promotion } = req.body || {};
	if (!Array.isArray(move) || move.length != 2) { return res.json({ status: 500, message: "Invalid piece movement" }); }

	let response = await retrieveGame(req.params.gameId); // GET GAME DATA BY ID
	if (response.status != 200) { return res.json(gameResponse(response)); }

	const playerId = playerInGame(req, response.game_data);
	if (!playerId) { return notInGame(req, res); }
	if (gamePending(response.game_data)) { return res.json({ status: 500, message: "Invite not accepted yet" }); }
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
			if (!isAiGame(response.game_data)) { notifyHome(response.game_data); } // A FRIEND GAME'S PICTURE ON HOME
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
 * @return {[object]} response [{ status, game_id (the new game), ai, game_board, w_knight, b_knight, w_piece, b_piece, state, winner, reason, message }]
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
 * @return {[object]} response [{ status, game_id, ai, ai_level, game_board, w_knight, b_knight, w_piece, b_piece, state, winner, reason, ai_move: { from, to, promotion }, message }]
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
 * @return {[object]} response [{ status, game_id, ai, game_board, w_knight, b_knight, w_piece, b_piece, state, winner, reason, message }]
 */
async function forfeitGame(req, res) {
	const response = await retrieveGame(req.params.gameId);
	if (!response.game_data) { return res.json({ status: response.status, message: response.message }); } // GAME NOT FOUND

	const gameData = response.game_data;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	if (isAiGame(gameData)) { return res.json({ status: 500, message: "AI games restart instead" }); }
	if (gamePending(gameData)) { return res.json({ status: 500, message: "Invite not accepted yet, decline it instead" }); }
	if (!gameOpen(gameData)) { return res.json({ status: 500, message: "Game is already over" }); }

	const closed = await forfeitFriendGame(gameData, playerId);
	return res.json(gameResponse(closed));
}

/**
 * @description Closes a friend game, the other side wins. The opponent's board opens the menu & both Homes redraw.
 * Also used when a new invite or an accept replaces the player's open friend game
 * @param  {[object]} gameData [open friend game item]
 * @param  {[string]} playerId [player forfeiting]
 * @return {[object]} response [closeGame response]
 */
async function forfeitFriendGame(gameData, playerId) {
	const winner = playerId == gameData.white_player_id.S ? "b" : "w"; // THE OTHER SIDE WINS
	const closed = await closeGame(gameData, winner, "forfeit");
	if (closed.status == 200) {
		emitToGame(gameData.game_id.S, "game-over", { game_id: gameData.game_id.S, player_id: playerId, winner, reason: "forfeit" }); // OPPONENT'S BOARD OPENS THE MENU
		notifyHome(gameData);
	}
	return closed;
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
	if (gameOpen(gameData) || gamePending(gameData)) { return res.json({ status: 500, message: "Game isn't over yet" }); }
	if (gameData.rematch_game_id) { return res.json({ status: 200, new_game_id: gameData.rematch_game_id.S, message: "Rematch started" }); }

	const players = [gameData.white_player_id.S, gameData.black_player_id.S];
	if ((await currentGame(players[0], false)) || (await currentGame(players[1], false))) { return res.json({ status: 409, message: "A player is in another friend game" }); } // ONE FRIEND GAME AT A TIME

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
	const names = [playerName(gameData, "w"), playerName(gameData, "b")]; // THE SCREENNAMES FOLLOW THE PLAYERS
	let randInt = Math.round(Math.random() * 1)
	const created = await initalizeGame(newGameId, players[randInt], players[1 - randInt], false, { w: names[randInt], b: names[1 - randInt] }); // CREATE NEW GAME
	if (!created.game_data) { return res.json({ status: created.status, message: created.message }); }

	for (let i = 0; i < players.length; i++) { await dropSentInvite(players[i]); } // THEY'RE BOTH IN A FRIEND GAME NOW
	emitToGame(gameId, "rematch", { game_id: gameId, new_game_id: newGameId }); // BOTH BOARDS LOAD THE NEW GAME
	notifyHome(created.game_data);
	return res.json({ status: 200, new_game_id: newGameId, message: "Rematch started" });
}

/* ---------------------------------------------------------------- */
// Invite (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Invites a friend by email: looks up their Auth0 account & creates a PENDING game, they accept or decline it on Home.
 * The challenger (signed in user) plays white. One sent invite at a time: a new one deletes the last one.
 * Signed in players have one friend game open at a time: while one is open this answers 409, unless replace_current forfeits it first
 * @param  {[object]} req.body [{ game_id (optional, must be new), opponent_email, replace_current (optional, true = forfeit the open friend game & invite) }]
 * @return {[object]} response [{ status, game_id, state: "PENDING", message } | { status: 409, game_id (the open one), message }]
 */
async function inviteGame(req, res) {
	const { game_id, opponent_email, replace_current } = req.body || {};
	if (!opponent_email) { return res.json({ status: 500, message: "Missing opponent_email" }); }
	const challengerId = userPlayerId(req.user); // requireAuth SETS req.user

	if (game_id) { // INVITES ONLY START NEW GAMES, NEVER OVERWRITE ONE
		const existing = await retrieveGame(game_id);
		if (existing.game_data) { return res.json({ status: 500, message: "Game id already in use" }); }
	}

	const opponentData = await getAuth0User(opponent_email); // WAS auth0UserByEmail IN THE LAMBDA
	if (!opponentData) { return res.json({ status: 500, message: "Opponent not found" }); }
	const opponentId = opponentData.user_id.split("auth0|")[1]; // PLAYER IDS DROP THE "auth0|", SAME AS THE CLIENT
	if (opponentId == challengerId) { return res.json({ status: 500, message: "That's your email" }); }

	const invites = await userInvites(challengerId);
	const theirInvite = invites.received_invites.find((invite) => invite.player_id == opponentId);
	if (theirInvite) { return res.json({ status: 500, game_id: theirInvite.game_id, message: "They already invited you" }); } // ACCEPT THEIRS INSTEAD

	const current = await currentGame(challengerId, false); // ONE FRIEND GAME AT A TIME
	if (current && !replace_current) { return res.json({ status: 409, game_id: current.game_id.S, message: "Friend game already open" }); }
	if (current) { await forfeitFriendGame(current, challengerId); } // A NEW INVITE FORFEITS THE OPEN ONE
	if (invites.sent_invite) { await dropInvite(invites.sent_invite.game_id); } // ONE SENT INVITE AT A TIME

	const names = { w: req.user.user_metadata?.screenname, b: opponentData.user_metadata?.screenname };
	const response = await initalizeGame(game_id || false, challengerId, opponentId, false, names, true); // CREATE NEW GAME, PENDING UNTIL THEY ACCEPT
	if (!response.game_data) { return res.json({ status: response.status, message: response.message }); }

	notifyHome(response.game_data); // THEIR HOME SHOWS THE INVITE
	return res.json({
		status: response.status,
		game_id: response.game_data.game_id.S,
		state: "PENDING",
		message: response.message,
	});
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
	if (!response.game_data) { return res.json({ status: response.status, message: "Invite not found" }); } // DECLINED, CANCELLED OR EXPIRED

	const gameData = response.game_data;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	if (!gamePending(gameData)) { return res.json({ status: 500, message: "Invite was already answered" }); }
	if (playerId != gameData.black_player_id.S) { return res.json({ status: 500, message: "Only the invited player can accept" }); } // THE INVITER PLAYS WHITE

	const current = await currentGame(playerId, false); // ONE FRIEND GAME AT A TIME
	if (current && !replace_current) { return res.json({ status: 409, game_id: current.game_id.S, message: "Friend game already open" }); }
	if (await currentGame(gameData.white_player_id.S, false)) { // THE INVITER STARTED ANOTHER FRIEND GAME SINCE (A REMATCH, OR THEY ACCEPTED ONE)
		await dropInvite(gameData.game_id.S);
		return res.json({ status: 500, message: "They're in another game now" });
	}

	if (current) { await forfeitFriendGame(current, playerId); } // ACCEPTING FORFEITS THE OPEN ONE
	await dropSentInvite(playerId);
	const accepted = await acceptInvite(gameData);
	if (accepted.status == 200) { notifyHome(gameData); } // THE INVITER'S HOME SHOWS THE GAME
	return res.json(gameResponse(accepted));
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
	if (!response.game_data) { return res.json({ status: response.status, message: "Invite not found" }); }

	const gameData = response.game_data;
	const playerId = playerInGame(req, gameData);
	if (!playerId) { return notInGame(req, res); }
	if (!gamePending(gameData)) { return res.json({ status: 500, message: "Invite was already answered" }); }

	const deleted = await deleteInvite(gameData);
	if (deleted.status == 200) { notifyHome(gameData); } // THE OTHER PLAYER'S HOME DROPS IT
	return res.json({ status: deleted.status, game_id: gameData.game_id.S, message: deleted.message });
}

/* ---------------------------------------------------------------- */
// User Games (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Returns a user's game lists for Home, expired games & invites are pruned first
 * @param  {[string]} req.params.userId [auth0 user id without "auth0|"]
 * @return {[object]} response [{ status, user_id, requested_games, open_games, closed_games, ai_game_id / friend_game_id (the open AI / friend game or null),
 * sent_invite ({ game_id, name } or null), received_invites ([{ game_id, name }]), message }]
 */
async function getUserGames(req, res) {
	if (req.params.userId != userPlayerId(req.user)) { return res.status(403).json({ status: 403, message: "Not your game list" }); }

	let response = await retrieveUser(req.params.userId);
	if (!response.user_data) { return res.json({ status: response.status, message: response.message }); } // NO GAMES YET

	response.user_data = await pruneOpenGames(response.user_data); // DROPS EXPIRED GAMES BEFORE HOME LISTS THEM
	response.user_data = await pruneInvites(response.user_data);
	const userData = response.user_data;
	const inviteBody = (invite) => ({ game_id: invite.game_id, name: invite.name }); // THE OTHER PLAYER'S ID STAYS ON THE SERVER

	return res.json({
		status: response.status,
		user_id: userData.user_id.S,
		requested_games: userData.requested_games.S,
		open_games: userData.open_games.S,
		closed_games: userData.closed_games.S,
		ai_game_id: userData.ai_game_id, // HOME DRAWS ITS BOARD & LINKS IT (Continue current game)
		friend_game_id: userData.friend_game_id, // SAME, IN PLAY A FRIEND
		sent_invite: userData.sent_invite ? inviteBody(userData.sent_invite) : null, // "INVITE SENT TO BOB // WAITING"
		received_invites: userData.received_invites.map(inviteBody), // "BOB INVITED YOU", ACCEPT & DECLINE
		message: response.message,
	});
}

/**
 * @description A signed in player's open AI game or friend game, they only have one of each at a time
 * @param  {[string]} playerId [auth0 user id without "auth0|"]
 * @param  {[boolean]} ai [true = the AI game, false = the friend game]
 * @return {[object]} gameData [the game item, null when there's none open]
 */
async function currentGame(playerId, ai) {
	const user = await retrieveUser(playerId);
	if (!user.user_data) { return null; } // NO GAMES YET
	const userData = await pruneOpenGames(user.user_data);
	const gameId = ai ? userData.ai_game_id : userData.friend_game_id;
	if (!gameId) { return null; }
	const response = await retrieveGame(gameId);
	if (!response.game_data || !gameOpen(response.game_data)) { return null; }
	return response.game_data;
}

/**
 * @description A signed in player's PENDING invites
 * @param  {[string]} playerId [auth0 user id without "auth0|"]
 * @return {[object]} invites [{ sent_invite, received_invites }, see pruneInvites in dynamoDB.js]
 */
async function userInvites(playerId) {
	const user = await retrieveUser(playerId);
	if (!user.user_data) { return { sent_invite: null, received_invites: [] }; } // NO GAMES YET
	const userData = await pruneInvites(user.user_data);
	return { sent_invite: userData.sent_invite, received_invites: userData.received_invites };
}

/**
 * @description Deletes an invite (a new invite replaces it, or the inviter is in a game now) & tells both Homes
 * @param  {[string]} gameId [PENDING game id]
 */
async function dropInvite(gameId) {
	const response = await retrieveGame(gameId);
	if (!response.game_data || !gamePending(response.game_data)) { return; } // ALREADY ANSWERED
	const deleted = await deleteInvite(response.game_data);
	if (deleted.status == 200) { notifyHome(response.game_data); }
}

/**
 * @description Deletes a player's sent invite, if they have one (they just started a friend game)
 * @param  {[string]} playerId [auth0 user id without "auth0|"]
 */
async function dropSentInvite(playerId) {
	const invites = await userInvites(playerId);
	if (invites.sent_invite) { await dropInvite(invites.sent_invite.game_id); }
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
		w_piece: response.game_data.w_piece.S,
		b_piece: response.game_data.b_piece.S,
		...gameState(response.game_data),
		message: response.message,
	};
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
 * @description A friend game player's screenname, saved when the game was made (inviteGame & rematchGame)
 * @param  {[object]} gameData [game item]
 * @param  {[string]} color ["w" or "b"]
 * @return {[string]} name [null for AI games & players without a screenname, Home shows "Friend"]
 */
function playerName(gameData, color) {
	return (color == "w" ? gameData.white_name?.S : gameData.black_name?.S) || null;
}

/**
 * @description The game's result fields, sent with every game response
 * @param  {[object]} gameData [game item]
 * @return {[object]} result [{ state: "PENDING" | "OPEN" | "CLOSED", winner: "w" | "b" | "draw" | null, reason }]
 */
function gameState(gameData) {
	return {
		state: gameData.state?.S || "OPEN",
		winner: gameData.winner?.S || null,
		reason: gameData.reason?.S || null,
	};
}

/**
 * @description True from the start (or the accept) until the game is checkmated, drawn or forfeited
 * @param  {[object]} gameData [game item]
 * @return {[boolean]} open
 */
function gameOpen(gameData) {
	return (gameData.state?.S || "OPEN") == "OPEN";
}

/**
 * @description True while a friend invite waits on the invited player (Accept or Decline on Home)
 * @param  {[object]} gameData [game item]
 * @return {[boolean]} pending
 */
function gamePending(gameData) {
	return gameData.state?.S == "PENDING";
}

/**
 * @description The requester's player id in this game. Signed in players use their session,
 * a guest's player id is the game id (client/src/js/pages/play/index.js guestGameId, saved in localStorage) & guests only get AI games
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


module.exports = { getGame, newGame, moveGame, restartGame, aiMoveGame, getLevels, forfeitGame, rematchGame, inviteGame, acceptGame, declineGame, getUserGames };
