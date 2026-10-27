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

const { ObjectId } = require("bson");
const { initalizeGame, retrieveGame, updateGame, closeGame, retrieveRatings, acceptInvite, deleteInvite, requestRematch, acceptRematch, retrieveUser, pruneOpenGames, pruneInvites } = require("../dynamoDB.js");
const { validateMove, gameResult, checkStartFen } = require("../utils/validate.js");
const { playerInGame, playerColor, inviterId, playerName, isAiGame, gameOpen, gamePending, turnColor, newStartParams, startParams, pickSides, readAiLevel, isId, DEFAULT_LEVEL } = require("../utils/games.js");
const { refuse } = require("../utils/refuse.js");

const SQUARE = /^[a-h][1-8]$/;
const PROMOTIONS = ["q", "r", "b", "n"];
const REMATCH_TIME = 60 * 1000; // BOTH PLAYERS MUST PRESS REMATCH WITHIN 1 MINUTE
const NAME_LENGTH = 50; // AN INVITE'S SCREENNAME FROM AUTH0 (USERNAMES ARE 3 - 20)

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

/* ---------------------------------------------------------------- */
// New AI Game (POST)
/* ---------------------------------------------------------------- */
/**
 * @description A signed in player's new game vs the AI: they're one side & CHESS_AI the other, at a real level, from the standard position
 * or a checked set position. A game id from the body must be new (a signed in player's Restart is a forfeit & a new game).
 * One AI game at a time stays on the chess server, it forfeits the open one first
 * @param  {[object]} req.body [{ color ("w" | "b" | "random"), level (1 - 8, left out = 3), start_fen (optional), game_id (optional, must be new) }]
 * @return {[object]} response [initalizeGame's { status, game_data, message }]
 */
async function newAiGame(req, res) {
	if (req.player.guest) { return refuse(req, res, 403, "Guests make games with /games/guest"); }
	const { color, level, start_fen, game_id } = req.body || {};
	const aiLevel = readAiLevel(level);
	if (!aiLevel) { return refuse(req, res, 400, "Invalid level"); }
	if (game_id !== undefined && !isId(game_id)) { return refuse(req, res, 400, "Invalid game id"); }
	const position = readStartFen(start_fen);
	if (position.message) { return refuse(req, res, 400, position.message); }
	if (game_id && (await retrieveGame(game_id, true)).game_data) { return refuse(req, res, 409, "Game id already in use"); }

	const params = newStartParams(color, position.fen);
	const sides = pickSides(params, req.player.id, "CHESS_AI"); // RANDOM IS DRAWN HERE
	return res.json(await initalizeGame(game_id || false, sides.white, sides.black, aiLevel, { start_params: params }));
}

/* ---------------------------------------------------------------- */
// New Guest Game (POST)
/* ---------------------------------------------------------------- */
/**
 * @description A guest's game vs the AI. A guest's player id is their game's id, so the game they name is overwritten only when it's
 * their own (their cookie): New game & Restart. Any other id they can't have (another browser's game, a signed in player's, "CHESS_AI")
 * gets a new id, and that game isn't touched. The chess server gives the guest a cookie for the id in the response
 * @param  {[object]} req.body [{ game_id (the guest's saved id, left out = a new one), color, level (left out = their game's, or 3), start_fen }]
 * @return {[object]} response [initalizeGame's { status, game_data (game_id is the id used), message }]
 */
async function newGuestGame(req, res) {
	if (req.player && !req.player.guest) { return refuse(req, res, 403, "Signed in players make games with /games/ai"); }
	const { game_id, color, level, start_fen } = req.body || {};
	if (game_id !== undefined && typeof game_id != "string") { return refuse(req, res, 400, "Invalid game id"); }
	if (level !== undefined && !readAiLevel(level)) { return refuse(req, res, 400, "Invalid level"); }
	const position = readStartFen(start_fen);
	if (position.message) { return refuse(req, res, 400, position.message); }

	let gameId = isId(game_id) ? game_id : `${new ObjectId()}`;
	let existing = (await retrieveGame(gameId, true)).game_data;
	if (existing && !playerInGame(req.player, existing)) { // NOT THEIR GAME: A NEW ONE WITH A NEW ID
		gameId = `${new ObjectId()}`;
		existing = null;
	}

	const aiLevel = level === undefined && existing ? readAiLevel(Number(existing.ai_level?.N)) || DEFAULT_LEVEL : readAiLevel(level); // A RESET KEEPS THE LEVEL
	const params = newStartParams(color, position.fen);
	const sides = pickSides(params, gameId, "CHESS_AI"); // A GUEST'S PLAYER ID IS THEIR GAME ID
	return res.json(await initalizeGame(gameId, sides.white, sides.black, aiLevel, { start_params: params }));
}

/**
 * @description A body's start_fen, checked by checkStartFen (validate.js). Not a string is refused, blank is the standard position
 * @return {[object]} position [{ fen } (false = the standard position) | { message }]
 */
function readStartFen(value) {
	if (value !== undefined && value !== null && typeof value != "string") { return { message: "Invalid FEN" }; }
	return checkStartFen(value);
}

/* ---------------------------------------------------------------- */
// Invite (POST)
/* ---------------------------------------------------------------- */
/**
 * @description A signed in player invites a friend: a PENDING game with the requester as the inviter. The chess server found the friend
 * in Auth0 (opponent_id) & answers the rules around it (one sent invite, their invite to you, one friend game at a time) before this.
 * The names are each player's username, or their Auth0 screenname until they pick one (the requester's comes from their token)
 * @param  {[object]} req.body [{ opponent_id, opponent_screenname (optional), color (the requester's pick), start_fen (optional), game_id (optional, must be new) }]
 * @return {[object]} response [initalizeGame's { status, game_data (PENDING), message }]
 */
async function inviteGame(req, res) {
	if (req.player.guest) { return refuse(req, res, 403, "Guests can't invite"); }
	const { opponent_id, opponent_screenname, color, start_fen, game_id } = req.body || {};
	if (!isId(opponent_id)) { return refuse(req, res, 400, "Invalid opponent"); }
	if (opponent_id == req.player.id) { return refuse(req, res, 400, "That's your own id"); }
	if (opponent_screenname !== undefined && (typeof opponent_screenname != "string" || opponent_screenname.length > NAME_LENGTH)) { return refuse(req, res, 400, "Invalid screenname"); }
	if (game_id !== undefined && !isId(game_id)) { return refuse(req, res, 400, "Invalid game id"); }
	const position = readStartFen(start_fen);
	if (position.message) { return refuse(req, res, 400, position.message); }
	if (game_id && (await retrieveGame(game_id, true)).game_data) { return refuse(req, res, 409, "Game id already in use"); }

	const params = newStartParams(color, position.fen);
	const sides = pickSides(params, req.player.id, opponent_id); // RANDOM IS DRAWN NOW, THE INVITE SAYS "YOU PLAY BLACK (RANDOM)"
	const names = {
		[req.player.id]: (await username(req.player.id)) || req.player.user.user_metadata?.screenname,
		[opponent_id]: (await username(opponent_id)) || opponent_screenname,
	};
	return res.json(await initalizeGame(game_id || false, sides.white, sides.black, false, { names: { w: names[sides.white], b: names[sides.black] }, pending: true, start_params: params, inviter_id: req.player.id }));
}

/* ---------------------------------------------------------------- */
// Accept & Decline (POST)
/* ---------------------------------------------------------------- */
/**
 * @description The invited player starts the game: PENDING -> OPEN. Not while the inviter is in another friend game (a rematch, or they accepted one),
 * the chess server then declines it. The requester's own open friend game & sent invite are the chess server's to forfeit & cancel first
 * @param  {[string]} req.params.gameId [PENDING game id]
 * @return {[object]} response [acceptInvite's { status, game_data, message }]
 */
async function acceptGame(req, res) {
	const response = await retrieveGame(req.params.gameId, true);
	if (!response.game_data) { return res.json(response); } // DECLINED, CANCELLED OR EXPIRED
	const gameData = response.game_data;
	const playerId = playerInGame(req.player, gameData);
	if (!playerId) { return refuse(req, res, 403, "Player is not in this game"); }
	if (!gamePending(gameData)) { return refuse(req, res, 409, "Invite was already answered"); }
	if (playerId == inviterId(gameData)) { return refuse(req, res, 403, "Only the invited player can accept"); }
	if (await currentGame(inviterId(gameData), false)) { return refuse(req, res, 409, "They're in another game now"); }

	return res.json(await acceptInvite(gameData));
}

/**
 * @description Deletes a PENDING game: the invited player declines it, or the inviter cancels it
 * @param  {[string]} req.params.gameId [PENDING game id]
 * @return {[object]} response [deleteInvite's { status, message }, plus game_data (the invite as it was) so the chess server can tell both Homes]
 */
async function declineGame(req, res) {
	const response = await retrieveGame(req.params.gameId, true);
	if (!response.game_data) { return res.json(response); } // ALREADY GONE
	const gameData = response.game_data;
	if (!playerInGame(req.player, gameData)) { return refuse(req, res, 403, "Player is not in this game"); }
	if (!gamePending(gameData)) { return refuse(req, res, 409, "Invite was already answered"); }

	return res.json({ ...(await deleteInvite(gameData)), game_data: gameData });
}

/* ---------------------------------------------------------------- */
// Rematch (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Friend games that are over: the first press waits 1 minute for the other player, the second makes the new game with the
 * same start settings (the inviter's color, random draws again) & both players' sent invites are cancelled (they're both in a game now).
 * Neither player can be in another friend game
 * @param  {[string]} req.params.gameId [closed friend game id]
 * @return {[object]} response [{ status, waiting, expires_in } while waiting | { status, new_game_id, game_data (the new game), dropped_invites (the cancelled invites, for both Homes) } once it starts]
 */
async function rematchGame(req, res) {
	const response = await retrieveGame(req.params.gameId, true);
	if (!response.game_data) { return res.json(response); } // GAME NOT FOUND
	const gameData = response.game_data;
	const gameId = gameData.game_id.S;
	const playerId = playerInGame(req.player, gameData);
	if (!playerId) { return refuse(req, res, 403, "Player is not in this game"); }
	if (isAiGame(gameData)) { return refuse(req, res, 409, "AI games restart instead"); }
	if (gameOpen(gameData) || gamePending(gameData)) { return refuse(req, res, 409, "Game isn't over yet"); }
	const started = (game) => ({ status: 200, new_game_id: game.rematch_game_id.S, message: "Rematch started" });
	if (gameData.rematch_game_id) { return res.json(started(gameData)); }

	const players = [gameData.white_player_id.S, gameData.black_player_id.S];
	if ((await currentGame(players[0], false)) || (await currentGame(players[1], false))) { return refuse(req, res, 409, "A player is in another friend game"); } // ONE FRIEND GAME AT A TIME

	const waiting = { status: 200, waiting: true, expires_in: REMATCH_TIME, message: "Waiting for opponent" };
	if (await requestRematch(gameId, playerId, Date.now() + REMATCH_TIME)) { return res.json(waiting); } // FIRST PRESS

	const newGameId = `${new ObjectId()}`;
	if (!(await acceptRematch(gameId, playerId, newGameId))) { // THE OTHER MINUTE JUST RAN OUT, OR THE OTHER PRESS STARTED IT
		const latest = await retrieveGame(gameId, true);
		if (latest.game_data?.rematch_game_id) { return res.json(started(latest.game_data)); }
		if (await requestRematch(gameId, playerId, Date.now() + REMATCH_TIME)) { return res.json(waiting); }
		return res.json({ status: 500, message: "Rematch failed" });
	}

	const params = startParams(gameData); // SIDES FOLLOW THE INVITER'S PICK
	const inviter = inviterId(gameData);
	const sides = pickSides(params, inviter, inviter == players[0] ? players[1] : players[0]);
	const names = { [players[0]]: (await username(players[0])) || playerName(gameData, "w"), [players[1]]: (await username(players[1])) || playerName(gameData, "b") }; // A NEW USERNAME SHOWS FROM THE REMATCH ON
	const created = await initalizeGame(newGameId, sides.white, sides.black, false, { names: { w: names[sides.white], b: names[sides.black] }, start_params: params, inviter_id: inviter });
	if (!created.game_data) { return res.json(created); }

	let dropped = [];
	for (let i = 0; i < players.length; i++) {
		const invite = await dropSentInvite(players[i]);
		if (invite) { dropped.push(invite); }
	}
	return res.json({ status: 200, new_game_id: newGameId, game_data: created.game_data, dropped_invites: dropped, message: "Rematch started" });
}

/* ---------------------------------------------------------------- */
// Players' Games
/* ---------------------------------------------------------------- */
/**
 * @description A signed in player's open AI game or friend game, they only have one of each at a time (expired games are pruned first)
 * @param  {[string]} playerId [auth0 user id without "auth0|"]
 * @param  {[boolean]} ai [true = the AI game, false = the friend game]
 * @return {[object]} gameData [the game item, null when there's none open]
 */
async function currentGame(playerId, ai) {
	const user = await retrieveUser(playerId, true);
	if (!user.user_data) { return null; } // NO GAMES YET
	const userData = await pruneOpenGames(user.user_data);
	const gameId = ai ? userData.ai_game_id : userData.friend_game_id;
	if (!gameId) { return null; }
	const response = await retrieveGame(gameId, true);
	if (!response.game_data || !gameOpen(response.game_data)) { return null; }
	return response.game_data;
}

/**
 * @description Cancels a player's sent invite, if they have one
 * @param  {[string]} playerId [auth0 user id without "auth0|"]
 * @return {[object]} gameData [the invite that was deleted, null when there was none]
 */
async function dropSentInvite(playerId) {
	const user = await retrieveUser(playerId, true);
	if (!user.user_data) { return null; }
	const sent = (await pruneInvites(user.user_data)).sent_invite;
	if (!sent) { return null; }
	const response = await retrieveGame(sent.game_id, true);
	if (!response.game_data || !gamePending(response.game_data)) { return null; } // ANSWERED SINCE
	const deleted = await deleteInvite(response.game_data);
	return deleted.status == 200 ? response.game_data : null;
}

/**
 * @description A player's username, the name friends see on new invites & rematches
 * @param  {[string]} playerId [auth0 user id without "auth0|"]
 * @return {[string]} username [null when they haven't picked one]
 */
async function username(playerId) {
	return (await retrieveUser(playerId)).user_data?.username?.S || null;
}


module.exports = { getGame, moveGame, aiMoveGame, forfeitGame, getRatings, newAiGame, newGuestGame, inviteGame, acceptGame, declineGame, rematchGame, currentGame };
