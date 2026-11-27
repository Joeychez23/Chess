/*
 *  chess.offers.js  --  chess server
 *	Chess Routes: takebacks, forfeits, draw offers & rematches
 *  Each one is a press the data service saves & checks again. A save that was too slow is read back (the saved* steps) so
 *  a press that landed isn't answered as failed. The opponent's board & both Homes are told through the socket
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { aiAcceptsDraw } = require("../../utils/ai.js");
const { gameOpen, gamePending, isAiGame, playerName, startParams } = require("../../utils/plainItems.js");
const { latestOpening } = require("../../utils/openings.js");
const { ifSaved, takeback, declineTakeback, forfeit, offerDraw, declineDraw, answerAiDraw, rematch, cancelRematch } = require("../../dataClient.js");
const { emitToGame, isInGameRoom } = require("../../socket.js");
const chessGuards = require("./chess.guards.js");
const chessShapers = require("./chess.shapers.js");
const chessPlay = require("./chess.play.js");

// Until both sides have made their first move the AI takes any draw, without asking the engine
const AI_DRAW_FREE_MOVES = 2;

/* ---------------------------------------------------------------- */
// Takeback (POST)
/* ---------------------------------------------------------------- */
/**
 * @description AI games: takes back the player's last move & the AI's reply, or just the player's move if the AI hasn't replied. No request step
 * & no limit, AI games aren't rated. Guests too. The data service works out how many on the stored board. Refused while the AI's move is being
 * picked here: it could save onto the earlier board. The opening goes back too, the latest one the remaining moves reached.
 * Friend games: a request the opponent has to accept (friendTakeback)
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [the whole game, same as getGame | { status, requested: true, opponent_name, message } friend games, waiting
 * | { status: 409, message } the AI is moving, nothing to take back or a move landed first]
 */
async function takebackGame(req, res) {
	// Consistent: the latest board
	const response = await chessGuards.loadMyGame(req, res, { consistentRead: true });
	if (!response) { return; }

	const gameData = response.game_data;
	const gameId = gameData.game_id;
	const playerId = chessGuards.playerInGame(req, gameData);
	if (!playerId) { return chessGuards.notInGame(req, res); }
	if (gameData.mode == "cards") { return chessGuards.useCardsRoutes(res); }
	if (gamePending(gameData)) { return res.status(409).json({ status: 409, message: "Invite not accepted yet" }); }
	if (!gameOpen(gameData)) { return res.status(409).json({ status: 409, message: "Game is over" }); }
	if (!isAiGame(gameData)) { return chessGuards.reply(res, await friendTakeback(gameData, playerId)); }
	if (chessPlay.aiTurns.has(gameId)) { return res.status(409).json({ status: 409, message: "Wait for the AI's move to finish." }); }

	const board = gameData.game_board;
	const saved = await ifSaved(() => takeback(gameId), () => chessPlay.savedBoardChange(gameId, board));
	if (saved.status != 200) { return chessGuards.reply(res, { status: saved.status, message: saved.message }); }
	await chessPlay.recordOpening(saved, latestOpening(saved.game_data.moves, startParams(saved.game_data).fen));
	return res.json(chessShapers.playerGame(saved, playerId));
}

/**
 * @description A press of Takeback in a friend game. The first press saves the request & the opponent is told, one per move,
 * any new move ends it. The opponent's press accepts it: one move goes back if the player who asked just moved, two if the opponent
 * already replied, up to 3 per game, & both boards load the earlier position
 * @param  {[object]} gameData [the open friend game, as read]
 * @param  {[string]} playerId [the player pressing]
 * @return {[object]} response [the whole game when accepted | { status, requested: true, opponent_name, message } | { status: 409, message }]
 */
async function friendTakeback(gameData, playerId) {
	const gameId = gameData.game_id;
	const pressed = await ifSaved(() => takeback(gameId), () => savedTakebackPress(gameData, playerId));
	if (pressed.status != 200) { return { status: pressed.status, message: pressed.message }; }

	// Waiting on the opponent
	if (!pressed.game_data) {
		emitToGame(gameId, "takeback", { game_id: gameId, player_id: playerId, state: "requested" });
		const opponentColor = playerId == gameData.white_player_id ? "b" : "w";
		return { status: 200, requested: true, opponent_name: playerName(gameData, opponentColor), message: pressed.message };
	}

	// Before the opponent & Home are told, they load the game
	await chessPlay.recordOpening(pressed, latestOpening(pressed.game_data.moves, startParams(pressed.game_data).fen));
	// Both boards load the earlier position
	emitToGame(gameId, "takeback", { game_id: gameId, player_id: playerId, state: "accepted", game_board: pressed.game_data.game_board });
	// The game's picture on Home
	chessGuards.notifyHome(pressed.game_data);
	return chessShapers.playerGame(pressed, playerId);
}

/**
 * @description A friend game takeback press that was too slow, read back: saved if their request stands, or the takeback was counted
 * @param  {[object]} gameData [the open friend game, as read before the press]
 * @param  {[string]} playerId [the player pressing]
 * @return {[object]} pressed [the data service's answer as it would have been, null when nothing saved]
 */
async function savedTakebackPress(gameData, playerId) {
	const latest = await chessGuards.retrieveGame(gameData.game_id, true);
	if (!latest.game_data) { return null; }
	if (latest.game_data.takeback_player_id == playerId) { return { status: 200, requested: true, message: "Takeback requested" }; }
	return Number(latest.game_data.takeback_count || 0) > Number(gameData.takeback_count || 0) ? latest : null;
}

/**
 * @description The asked player turns the takeback down (friend games), the game goes on & the player who asked is told
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, declined: true, message } | { status: 409, message } when the request already ended]
 */
async function declineTakebackGame(req, res) {
	const response = await chessGuards.loadMyGame(req, res, { consistentRead: true });
	if (!response) { return; }

	const gameId = response.game_data.game_id;
	const playerId = chessGuards.playerInGame(req, response.game_data);
	if (!playerId) { return chessGuards.notInGame(req, res); }

	const declined = await ifSaved(() => declineTakeback(gameId), () => savedTakebackDecline(gameId));
	if (declined.status != 200) { return chessGuards.reply(res, { status: declined.status, message: declined.message }); }
	emitToGame(gameId, "takeback", { game_id: gameId, player_id: playerId, state: "declined" });
	return res.json({ status: 200, declined: true, message: declined.message });
}

/**
 * @description A takeback decline that was too slow, read back: saved if the request is gone
 * @param  {[string]} gameId [game id]
 * @return {[object]} declined [the data service's answer as it would have been, null when nothing saved]
 */
async function savedTakebackDecline(gameId) {
	const latest = await chessGuards.retrieveGame(gameId, true);
	return latest.game_data && !latest.game_data.takeback_player_id ? { status: 200, declined: true, message: "Takeback declined" } : null;
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
	const response = await chessGuards.loadMyGame(req, res);
	if (!response) { return; }

	const gameData = response.game_data;
	const playerId = chessGuards.playerInGame(req, gameData);
	if (!playerId) { return chessGuards.notInGame(req, res); }
	if (gamePending(gameData)) { return res.status(409).json({ status: 409, message: "Invite not accepted yet, decline it instead" }); }
	if (!gameOpen(gameData)) { return res.status(409).json({ status: 409, message: "Game is already over" }); }

	const closed = await forfeitOpenGame(gameData, playerId);
	return chessGuards.reply(res, chessShapers.gameResponse(closed));
}

/**
 * @description Closes a game, the other side wins. A friend's board opens the menu & the players' Homes redraw.
 * Also used when a new invite or an accept replaces the player's open friend game
 * @param  {[object]} gameData [open game item]
 * @param  {[string]} playerId [player forfeiting]
 * @return {[object]} response [the data service's forfeit answer, { status: 500 } when the game was already over]
 */
async function forfeitOpenGame(gameData, playerId) {
	const closed = await ifSaved(() => forfeit(gameData.game_id), () => savedForfeit(gameData.game_id));
	// Already over
	if (closed.status != 200) { return { status: 500, message: closed.message }; }
	tellGameOver(gameData, playerId, playerId == gameData.white_player_id ? "b" : "w");
	return closed;
}

/**
 * @description A forfeit that was too slow, read back: saved if the game is closed now
 * @param  {[string]} gameId [game id]
 * @return {[object]} closed [the latest read when it's closed, null when nothing saved]
 */
async function savedForfeit(gameId) {
	const latest = await chessGuards.retrieveGame(gameId, true);
	return latest.game_data && !gameOpen(latest.game_data) ? latest : null;
}

/**
 * @description A friend game was forfeited or drawn by agreement: the opponent's board opens the menu & both Homes redraw
 * @param  {[object]} gameData [the friend game]
 * @param  {[string]} playerId [the player who forfeited, or accepted the draw]
 * @param  {[string]} winner ["w", "b" or "draw"]
 * @param  {[string]} reason ["forfeit" or "agreement"]
 */
function tellGameOver(gameData, playerId, winner, reason = "forfeit") {
	emitToGame(gameData.game_id, "game-over", { game_id: gameData.game_id, player_id: playerId, winner, reason });
	chessGuards.notifyHome(gameData);
}


/* ---------------------------------------------------------------- */
// Draw Offers (POST)
/* ---------------------------------------------------------------- */
/**
 * @description A press of Offer Draw. The first press saves the offer, which lasts until the next move, one per player per move.
 * The opponent's press accepts it & both boards show the draw. In an AI game the answer comes right away: the AI always accepts until
 * both sides have made their first move, then the engine decides & it accepts when it isn't ahead
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [gameResponse's closed game when it's a draw | { status, offered: true, opponent_name, message } friend games, waiting
 * | { status, declined: true, message } the AI said no | { status: 409, message } an offer already used this move or ended by a move]
 */
async function drawGame(req, res) {
	// Consistent: the AI judges the latest board
	const response = await chessGuards.loadMyGame(req, res, { consistentRead: true });
	if (!response) { return; }

	const gameData = response.game_data;
	const gameId = gameData.game_id;
	const playerId = chessGuards.playerInGame(req, gameData);
	if (!playerId) { return chessGuards.notInGame(req, res); }
	if (gameData.mode == "cards") { return chessGuards.useCardsRoutes(res); }
	if (gamePending(gameData)) { return res.status(409).json({ status: 409, message: "Invite not accepted yet" }); }
	if (!gameOpen(gameData)) { return res.status(409).json({ status: 409, message: "Game is already over" }); }

	const pressed = await ifSaved(() => offerDraw(gameId), () => savedDraw(gameId, playerId));
	if (pressed.status != 200) { return chessGuards.reply(res, { status: pressed.status, message: pressed.message }); }
	// The opponent's offer was standing
	if (pressed.game_data) {
		tellGameOver(pressed.game_data, playerId, "draw", "agreement");
		return res.json(chessShapers.gameResponse(pressed));
	}
	if (isAiGame(gameData)) { return chessGuards.reply(res, await aiDrawAnswer(gameData)); }

	emitToGame(gameId, "draw-offer", { game_id: gameId, player_id: playerId, state: "offered" });
	const opponentColor = playerId == gameData.white_player_id ? "b" : "w";
	return res.json({ status: 200, offered: true, opponent_name: playerName(gameData, opponentColor), message: pressed.message });
}

/**
 * @description A draw press that timed out, read back: the game drawn or this player's offer standing
 * @param  {[string]} gameId [game id]
 * @param  {[string]} playerId [player who pressed]
 * @return {[object]} pressed [the data service's answer as it would have been, null when nothing saved]
 */
async function savedDraw(gameId, playerId) {
	const latest = await chessGuards.retrieveGame(gameId, true);
	if (latest.game_data?.reason == "agreement") { return latest; }
	if (latest.game_data?.draw_offer_player_id == playerId) { return { status: 200, offered: true, message: "Draw offered" }; }
	return null;
}

/**
 * @description The AI answers the offer that was just saved. A move landing during the engine's search ends the offer & the answer is refused
 * @param  {[object]} gameData [the AI game]
 * @return {[object]} response [gameResponse's closed game | { status, declined: true, message } | { status: 409, message }]
 */
async function aiDrawAnswer(gameData) {
	const gameId = gameData.game_id;
	const aiColor = gameData.white_player_id == "CHESS_AI" ? "w" : "b";
	const accept = gameData.moves.length < AI_DRAW_FREE_MOVES || await aiAcceptsDraw(gameData.game_board, aiColor);
	const answer = await ifSaved(() => answerAiDraw(gameId, accept), () => savedAiDrawAnswer(gameId, accept));
	if (answer.status != 200) { return { status: answer.status, message: answer.message }; }
	return accept ? chessShapers.gameResponse(answer) : { status: 200, declined: true, message: "The AI declined the draw" };
}

/**
 * @description The AI's draw answer that was too slow, read back: saved if the game closed (accepted), or the offer is gone (declined)
 * @param  {[string]} gameId [game id]
 * @param  {[boolean]} accept [the AI's answer]
 * @return {[object]} answer [the latest read, null when nothing saved]
 */
async function savedAiDrawAnswer(gameId, accept) {
	const latest = await chessGuards.retrieveGame(gameId, true);
	if (!latest.game_data) { return null; }
	const saved = accept ? !gameOpen(latest.game_data) : !latest.game_data.draw_offer_player_id;
	return saved ? { ...latest, declined: !accept } : null;
}

/**
 * @description The offered player turns the draw down (friend games), the game goes on & the player who offered is told
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, declined: true, message } | { status: 409, message } when the offer already ended]
 */
async function declineDrawGame(req, res) {
	const response = await chessGuards.loadMyGame(req, res, { consistentRead: true });
	if (!response) { return; }

	const gameId = response.game_data.game_id;
	const playerId = chessGuards.playerInGame(req, response.game_data);
	if (!playerId) { return chessGuards.notInGame(req, res); }

	const declined = await ifSaved(() => declineDraw(gameId), () => savedDrawDecline(gameId));
	if (declined.status != 200) { return chessGuards.reply(res, { status: declined.status, message: declined.message }); }
	emitToGame(gameId, "draw-offer", { game_id: gameId, player_id: playerId, state: "declined" });
	return res.json({ status: 200, declined: true, message: declined.message });
}

/**
 * @description A draw decline that was too slow, read back: saved if the offer is gone
 * @param  {[string]} gameId [game id]
 * @return {[object]} declined [the data service's answer as it would have been, null when nothing saved]
 */
async function savedDrawDecline(gameId) {
	const latest = await chessGuards.retrieveGame(gameId, true);
	return latest.game_data && !latest.game_data.draw_offer_player_id ? { status: 200, declined: true, message: "Draw declined" } : null;
}


/* ---------------------------------------------------------------- */
// Rematch (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Friend games that are over: the first press waits 5 minutes for the other player. If they press in time a new game starts
 * with the same start settings (the inviter's color, Random draws again, Alternate switches), and both boards load it
 * @param  {[string]} req.params.gameId [closed game id]
 * @return {[object]} response [{ status, new_game_id } once it starts
 * | { status, waiting, expires_in, opponent_name, opponent_here (still on the game page) } while waiting]
 */
async function rematchGame(req, res) {
	const response = await chessGuards.loadMyGame(req, res);
	if (!response) { return; }

	const gameData = response.game_data;
	const gameId = gameData.game_id;
	const playerId = chessGuards.playerInGame(req, gameData);
	if (!playerId) { return chessGuards.notInGame(req, res); }
	if (gameData.mode == "cards") { return chessGuards.useCardsRoutes(res); }
	if (isAiGame(gameData)) { return res.status(409).json({ status: 409, message: "AI games restart instead" }); }
	if (gameOpen(gameData) || gamePending(gameData)) { return res.status(409).json({ status: 409, message: "Game isn't over yet" }); }

	// The data service: both presses within 5 minutes, neither player in another friend game, the new game with the inviter's pick
	const pressed = await ifSaved(() => rematch(gameId), () => savedRematch(gameId, playerId));
	// One friend game at a time
	if (pressed.status == 409) { return res.status(409).json({ status: 409, message: pressed.message }); }
	// The first press
	if (pressed.waiting) {
		const opponentIsWhite = playerId != gameData.white_player_id;
		return res.json({
			status: 200,
			waiting: true,
			expires_in: pressed.expires_in,
			opponent_name: playerName(gameData, opponentIsWhite ? "w" : "b"),
			opponent_here: isInGameRoom(gameId, opponentIsWhite ? gameData.white_player_id : gameData.black_player_id),
			message: pressed.message
		});
	}
	if (!pressed.new_game_id) { return res.status(500).json({ status: 500, message: pressed.message || "Rematch failed" }); }

	// The rematch is open: a press after a failed one is the first the other board hears of it
	if (pressed.game_data) {
		// Both boards load the new game
		emitToGame(gameId, "rematch", { game_id: gameId, new_game_id: pressed.new_game_id });
		chessGuards.notifyHome(pressed.game_data);
		// They're both in a friend game now, their sent invites are cancelled
		for (let i = 0; i < pressed.dropped_invites.length; i++) { chessGuards.notifyHome(pressed.dropped_invites[i]); }
	}
	return res.json({ status: 200, new_game_id: pressed.new_game_id, message: "Rematch started" });
}

/**
 * @description A rematch press that timed out, read back: the new game (both boards are told again, loading it twice is harmless) or this press
 * waiting. The invites it dropped aren't known here, those Homes redraw when next loaded
 * @param  {[string]} gameId [closed game id]
 * @param  {[string]} playerId [player who pressed]
 * @return {[object]} pressed [the data service's rematch answer as it would have been, null when nothing saved]
 */
async function savedRematch(gameId, playerId) {
	const latest = (await chessGuards.retrieveGame(gameId, true)).game_data;
	if (latest?.rematch_game_id) {
		const made = await chessGuards.retrieveGame(latest.rematch_game_id, true);
		if (!made.game_data) { return null; }
		return { status: 200, new_game_id: latest.rematch_game_id, game_data: made.game_data, dropped_invites: [] };
	}
	const expiresIn = Number(latest?.rematch_expires) - Date.now();
	if (latest?.rematch_player_id == playerId && expiresIn > 0) {
		return { status: 200, waiting: true, expires_in: expiresIn, message: "Waiting for opponent" };
	}
	return null;
}

/**
 * @description The player who pressed Rematch takes it back. A cancel that fails is answered 503 & pressing again is safe
 * @param  {[string]} req.params.gameId [closed game id]
 * @return {[object]} response [{ status, cancelled, message }, cancelled: false when the rematch already started & the socket's "rematch" is on its way]
 */
async function cancelRematchGame(req, res) {
	const response = await cancelRematch(req.params.gameId);
	if (chessGuards.notYours(response)) { return chessGuards.notInGame(req, res); }
	return chessGuards.reply(res, { status: response.status, cancelled: response.cancelled, message: response.message });
}


module.exports = {
	takebackGame, declineTakebackGame,
	forfeitGame, forfeitOpenGame, tellGameOver,
	drawGame, declineDrawGame,
	rematchGame, cancelRematchGame,
};
