/*
 *  game.offers.js  --  data service
 *	Game Routes: takebacks, forfeits, draws & rematches
 *  What a player asks of the other side, or gives up, during or after a game. Each route loads the stored game, checks the
 *  requester can ask that now, and saves only if nothing changed since the read (a move, or the other player's answer)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const {
	initializeGame, retrieveGame, updateGame, closeGame, offerDraw, endDrawOffer, requestTakeback, endTakeback, requestRematch, acceptRematch,
	cancelRematch, movePlayersGame,
} = require("../../db/index.js");
const { undoMoves } = require("../../utils/validate.js");
const {
	playerInGame, playerColor, inviterId, playerName, isAiGame, gameOpen, gamePending, turnColor, startParams, takebacksLeft, pickSides,
	newGameId,
} = require("../../utils/games.js");
const { refuse } = require("../../utils/refuse.js");
const gameShared = require("./game.shared.js");

// A rematch request stays open for 5 minutes, room to read the result (ACCESSIBILITY.md)
const REMATCH_TIME = 5 * 60 * 1000;
// A claimed rematch with no game is only made again for 1 hour, after that the game expired or was never made
const REMATCH_REPAIR_TIME = 60 * 60 * 1000;

/* ---------------------------------------------------------------- */
// Takeback (POST)
/* ---------------------------------------------------------------- */
/**
 * @description AI games: takes back the requester's last move. On their turn that's two moves (the AI's reply & theirs), on the AI's turn
 * one (it hasn't replied). It's always their turn after. Saved only if the board hasn't changed since it was read, so an undo & a move
 * can't both land. Takes the saved opening off too.
 * Friend games: a request the opponent has to accept (friendTakeback)
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, game_data (the game as saved), message } | { status, requested: true, message } friend games,
 * waiting. 409 when there's no move of theirs to take back or a move saved first]
 */
async function takebackGame(req, res) {
	// Consistent: the latest board
	const response = await retrieveGame(req.params.gameId, true);
	// Game not found
	if (!response.game_data) { return res.json(response); }
	const gameData = response.game_data;
	if (!playerInGame(req.player, gameData)) { return refuse(req, res, 403, "Player is not in this game"); }
	if (gamePending(gameData)) { return refuse(req, res, 409, "Invite not accepted yet"); }
	if (!gameOpen(gameData)) { return refuse(req, res, 409, "Game is over"); }
	if (!isAiGame(gameData)) { return friendTakeback(req, res, gameData, playerInGame(req.player, gameData)); }

	const count = turnColor(gameData) == playerColor("CHESS_AI", gameData) ? 1 : 2;
	// The AI's first move alone isn't theirs
	if (gameData.moves.S.length < count) { return refuse(req, res, 409, "No moves to take back"); }

	const prevBoard = gameData.game_board.S;
	const undone = undoMoves(gameData, count);
	if (undone.status != 200) { return refuse(req, res, 409, undone.message); }

	const saved = await updateGame(undone.game_data, prevBoard, undefined, true);
	// A move saved first
	if (saved.status != 200) { return refuse(req, res, 409, "Board changed before the takeback saved"); }
	return res.json(saved);
}

/**
 * @description A press of Takeback in a friend game. With the opponent's request standing it accepts it & runs the undo. Otherwise it's the
 * player's request, one per move between both players. Pressing while their own request stands changes nothing, so a press that timed out
 * can be repeated. Any new move ends a request (updateGame)
 * @param  {[object]} gameData [the open friend game, as read]
 * @param  {[string]} playerId [the player pressing]
 * @return {[object]} response [{ status, game_data (the game as saved), message } when accepted | { status, requested: true, message },
 * 409 when it's refused]
 */
async function friendTakeback(req, res, gameData, playerId) {
	const requestedBy = gameData.takeback_player_id?.S;
	if (requestedBy == playerId) { return res.json({ status: 200, requested: true, message: "Takeback requested" }); }

	if (requestedBy) {
		const prevBoard = gameData.game_board.S;
		const undone = undoMoves(gameData, takebackCount(gameData, requestedBy));
		if (undone.status != 200) { return refuse(req, res, 409, undone.message); }
		const saved = await updateGame(undone.game_data, prevBoard, undefined, true, requestedBy);
		// A move landed first
		if (saved.status != 200) { return refuse(req, res, 409, "That takeback request ended"); }
		return res.json(saved);
	}

	if (startParams(gameData).takebacks === 0) { return refuse(req, res, 409, "Takebacks are off in this game"); }
	if (takebacksLeft(gameData) <= 0) { return refuse(req, res, 409, "No takebacks left in this game"); }
	const movesPlayed = gameData.moves.S.length;
	if (movesPlayed < takebackCount(gameData, playerId)) { return refuse(req, res, 409, "No moves to take back"); }
	if (Number(gameData.takeback_move?.N) == movesPlayed) { return refuse(req, res, 409, "A takeback was already asked for this move"); }
	// A move or the opponent's request landed first
	if (!await requestTakeback(gameData, playerId)) { return refuse(req, res, 409, "The takeback request didn't save, try again"); }
	return res.json({ status: 200, requested: true, message: "Takeback requested" });
}

/**
 * @description How many moves take back a player's last move: one if they just moved, two if the opponent already replied
 * @param  {[object]} gameData [game item]
 * @param  {[string]} playerId [the player asking]
 * @return {[number]} count [moves to undo]
 */
function takebackCount(gameData, playerId) {
	return turnColor(gameData) == playerColor(playerId, gameData) ? 2 : 1;
}

/**
 * @description The asked player turns the takeback down. The game goes on
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, declined: true, message }, 409 when there's no request of the opponent's]
 */
async function declineTakebackGame(req, res) {
	const found = await loadOpenGame(req, res);
	if (!found) { return; }
	const { gameData, playerId } = found;
	const requestedBy = gameData.takeback_player_id?.S;
	if (!requestedBy || requestedBy == playerId) { return refuse(req, res, 409, "No takeback request to decline"); }
	if (!await endTakeback(gameData.game_id.S, requestedBy)) { return refuse(req, res, 409, "That takeback request ended"); }
	return res.json({ status: 200, declined: true, message: "Takeback declined" });
}

/* ---------------------------------------------------------------- */
// Forfeit (POST)
/* ---------------------------------------------------------------- */
/**
 * @description The requester gives up an open game, the other side wins (an AI game too: a new game from Home, Restart & Delete my data
 * forfeit it)
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [closeGame's { status, game_data, message }]
 */
async function forfeitGame(req, res) {
	const response = await retrieveGame(req.params.gameId, true);
	// Game not found
	if (!response.game_data) { return res.json(response); }
	const gameData = response.game_data;
	const playerId = playerInGame(req.player, gameData);
	if (!playerId) { return refuse(req, res, 403, "Player is not in this game"); }
	if (gamePending(gameData)) { return refuse(req, res, 409, "Invite not accepted yet, decline it instead"); }
	if (!gameOpen(gameData)) { return refuse(req, res, 409, "Game is already over"); }

	// The other side wins
	const winner = playerColor(playerId, gameData) == "w" ? "b" : "w";
	return res.json(await closeGame(gameData, winner, "forfeit"));
}

/* ---------------------------------------------------------------- */
// Draw Offers (POST)
/* ---------------------------------------------------------------- */
/**
 * @description A press of Offer Draw. With the opponent's offer standing it accepts it & the game is drawn. Otherwise it's the player's
 * offer, one per player per move. Pressing while their own offer stands changes nothing, so a press that timed out can be repeated
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [closeGame's { status, game_data, message } when accepted | { status, offered: true, message }]
 */
async function drawGame(req, res) {
	const found = await loadOpenGame(req, res);
	if (!found) { return; }
	const { gameData, playerId } = found;
	const offeredBy = gameData.draw_offer_player_id?.S;

	if (offeredBy && offeredBy != playerId) {
		const closed = await closeGame(gameData, "draw", "agreement", offeredBy);
		// A move landed first
		if (closed.status != 200) { return refuse(req, res, 409, "That draw offer ended"); }
		return res.json(closed);
	}
	if (offeredBy == playerId) { return res.json({ status: 200, offered: true, message: "Draw offered" }); }

	const color = playerColor(playerId, gameData);
	if (gameData[`draw_offered_${color}`]) { return refuse(req, res, 409, "You already offered a draw this move"); }
	// A move or the opponent's offer landed first
	if (!await offerDraw(gameData, playerId, color)) { return refuse(req, res, 409, "The draw offer didn't save, try again"); }
	return res.json({ status: 200, offered: true, message: "Draw offered" });
}

/**
 * @description The offered player turns the draw down, friend games only (the AI answers through aiDrawGame). The game goes on
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, declined: true, message }]
 */
async function declineDrawGame(req, res) {
	const found = await loadOpenGame(req, res);
	if (!found) { return; }
	const { gameData, playerId } = found;
	const offeredBy = gameData.draw_offer_player_id?.S;
	if (!offeredBy || offeredBy == playerId) { return refuse(req, res, 409, "No draw offer to decline"); }
	if (!await endDrawOffer(gameData.game_id.S, offeredBy)) { return refuse(req, res, 409, "That draw offer ended"); }
	return res.json({ status: 200, declined: true, message: "Draw declined" });
}

/**
 * @description The AI's answer to the requester's standing offer (the chess server gets it from the engine, like the AI's moves)
 * @param  {[string]} req.params.gameId [game id]
 * @param  {[object]} req.body [{ accept: true | false }]
 * @return {[object]} response [closeGame's { status, game_data, message } when accepted | { status, declined: true, message }, 409 when a
 * move ended the offer first]
 */
async function aiDrawGame(req, res) {
	if (typeof req.body?.accept != "boolean") { return refuse(req, res, 400, "Invalid draw answer"); }
	const found = await loadOpenGame(req, res);
	if (!found) { return; }
	const { gameData, playerId } = found;
	if (!isAiGame(gameData)) { return refuse(req, res, 409, "Friend games have no AI"); }
	if (gameData.draw_offer_player_id?.S != playerId) { return refuse(req, res, 409, "That draw offer ended"); }

	if (req.body.accept) {
		const closed = await closeGame(gameData, "draw", "agreement", playerId);
		if (closed.status != 200) { return refuse(req, res, 409, "That draw offer ended"); }
		return res.json(closed);
	}
	if (!await endDrawOffer(gameData.game_id.S, playerId)) { return refuse(req, res, 409, "That draw offer ended"); }
	return res.json({ status: 200, declined: true, message: "The AI declined the draw" });
}

/**
 * @description The open game a draw or takeback decline route acts on, for a player in it. Answers the request itself when it's refused
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} found [{ gameData, playerId }, null when it answered]
 */
async function loadOpenGame(req, res) {
	// Consistent: the latest offer & board
	const response = await retrieveGame(req.params.gameId, true);
	// Game not found
	if (!response.game_data) {
		res.json(response);
		return null;
	}
	const gameData = response.game_data;
	const playerId = playerInGame(req.player, gameData);
	if (!playerId) {
		refuse(req, res, 403, "Player is not in this game");
		return null;
	}
	if (gamePending(gameData)) {
		refuse(req, res, 409, "Invite not accepted yet");
		return null;
	}
	if (!gameOpen(gameData)) {
		refuse(req, res, 409, "Game is over");
		return null;
	}
	return { gameData, playerId };
}

/* ---------------------------------------------------------------- */
// Rematch (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Friend games that are over: the first press waits 5 minutes for the other player, the second makes the new game with the
 * same start settings (the inviter's color, random draws again) & both players' sent invites are cancelled (they're both in a game now).
 * Neither player can be in another friend game
 * @param  {[string]} req.params.gameId [closed friend game id]
 * @return {[object]} response [{ status, waiting, expires_in } while waiting | finishRematch's answer once it starts]
 */
async function rematchGame(req, res) {
	const response = await retrieveGame(req.params.gameId, true);
	// Game not found
	if (!response.game_data) { return res.json(response); }
	const gameData = response.game_data;
	const gameId = gameData.game_id.S;
	const playerId = playerInGame(req.player, gameData);
	if (!playerId) { return refuse(req, res, 403, "Player is not in this game"); }
	if (isAiGame(gameData)) { return refuse(req, res, 409, "AI games restart instead"); }
	if (gameOpen(gameData) || gamePending(gameData)) { return refuse(req, res, 409, "Game isn't over yet"); }
	if (gameData.rematch_game_id) { return finishRematch(req, res, gameData, gameData.rematch_game_id.S); }

	// One friend game at a time
	const players = [gameData.white_player_id.S, gameData.black_player_id.S];
	if ((await gameShared.currentGame(players[0], false)) || (await gameShared.currentGame(players[1], false))) {
		return refuse(req, res, 409, "A player is in another friend game");
	}

	// The first press waits
	const waiting = { status: 200, waiting: true, expires_in: REMATCH_TIME, message: "Waiting for opponent" };
	if (await requestRematch(gameId, playerId, Date.now() + REMATCH_TIME)) { return res.json(waiting); }

	const rematchId = newGameId();
	// The other request just ran out or was cancelled, or the other press started it
	if (!(await acceptRematch(gameId, playerId, rematchId))) {
		const latest = await retrieveGame(gameId, true);
		if (latest.game_data?.rematch_game_id) { return finishRematch(req, res, latest.game_data, latest.game_data.rematch_game_id.S); }
		if (await requestRematch(gameId, playerId, Date.now() + REMATCH_TIME)) { return res.json(waiting); }
		return res.json({ status: 500, message: "Rematch failed" });
	}

	return finishRematch(req, res, gameData, rematchId);
}

/**
 * @description Everything after a rematch is claimed, safe to repeat: a press that failed part way is finished by the next one. Makes the
 * game under the claimed id if it isn't there (neither player can be in another friend game), then puts it on both lists & cancels both
 * players' sent invites. A rematch that has ended is only answered with: its lists are settled, & an invite sent since it ended stays.
 * A claim whose game is missing long after it was made is refused: TTL deleted the rematch, & one player's press can't start a new game
 * for both
 * @param  {[object]} gameData [the finished game, as read before this press claimed anything: a saved rematch_game_id means an earlier
 * press claimed it]
 * @param  {[string]} rematchId [the id claimed on it]
 * @return {[object]} response [{ status, new_game_id, message } plus, while the rematch is open, game_data & dropped_invites]
 * @throws when a save fails: the press answers an error & pressing again finishes the work
 */
async function finishRematch(req, res, gameData, rematchId) {
	let game = (await retrieveGame(rematchId, true)).game_data;
	if (game && !gameOpen(game)) { return res.json({ status: 200, new_game_id: rematchId, message: "Rematch started" }); }

	const players = [gameData.white_player_id.S, gameData.black_player_id.S];
	if (!game) {
		// rematch_expires stops changing once claimed, and no value counts as old. This press's own claim is never old
		const claimTooOld = gameData.rematch_game_id && !(Number(gameData.rematch_expires?.N) + REMATCH_REPAIR_TIME > Date.now());
		if (claimTooOld) { return refuse(req, res, 409, "Rematch ended"); }
		for (const playerId of players) {
			const current = await gameShared.currentGame(playerId, false);
			// One friend game at a time
			if (current && current.game_id.S != rematchId) { return refuse(req, res, 409, "A player is in another friend game"); }
		}
		// Sides follow the inviter's pick. Alternate: the opposite of this game
		const params = startParams(gameData);
		const inviter = inviterId(gameData);
		const sides = pickSides(params, inviter, inviter == players[0] ? players[1] : players[0], playerColor(inviter, gameData));
		// A new username shows from the rematch on
		const names = {
			[players[0]]: (await gameShared.username(players[0])) || playerName(gameData, "w"),
			[players[1]]: (await gameShared.username(players[1])) || playerName(gameData, "b"),
		};
		const made = await initializeGame(rematchId, sides.white, sides.black, false, {
			names: { w: names[sides.white], b: names[sides.black] },
			start_params: params,
			inviter_id: inviter,
		});
		// A 409: the other press saved it first, and its sides stand
		game = made.game_data || (await retrieveGame(rematchId, true)).game_data;
		if (!game) { return res.json({ status: 500, message: "Rematch failed" }); }
		if (made.game_data) { await gameShared.saveFriendColors(game); }
	}

	// Adds it once
	const listError = await movePlayersGame(game, rematchId, "requested_games", "open_games");
	if (listError) { throw listError; }

	let dropped = [];
	for (const playerId of players) {
		const invite = await gameShared.dropSentInvite(playerId);
		if (invite) { dropped.push(invite); }
	}
	return res.json({ status: 200, new_game_id: rematchId, game_data: game, dropped_invites: dropped, message: "Rematch started" });
}

/**
 * @description The player who asked for a rematch takes it back. Safe to repeat. Too late once the other press claimed it: that rematch
 * goes ahead
 * @param  {[string]} req.params.gameId [closed friend game id]
 * @return {[object]} response [{ status, cancelled, message }, cancelled: false when the rematch already started]
 */
async function cancelRematchGame(req, res) {
	const response = await retrieveGame(req.params.gameId, true);
	// Game not found
	if (!response.game_data) { return res.json(response); }
	const gameData = response.game_data;
	const playerId = playerInGame(req.player, gameData);
	if (!playerId) { return refuse(req, res, 403, "Player is not in this game"); }

	if (await cancelRematch(gameData.game_id.S, playerId)) { return res.json({ status: 200, cancelled: true, message: "Rematch cancelled" }); }
	const latest = await retrieveGame(gameData.game_id.S, true);
	if (latest.game_data?.rematch_game_id) { return res.json({ status: 200, cancelled: false, message: "Rematch started" }); }
	// Already cancelled, or the other player is the one waiting
	return res.json({ status: 200, cancelled: true, message: "No rematch request open" });
}


module.exports = {
	takebackGame, declineTakebackGame, forfeitGame, drawGame, declineDrawGame, aiDrawGame, rematchGame, cancelRematchGame,
};
