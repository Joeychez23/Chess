/*
 *  chess.games.js  --  chess server
 *	Chess Routes: games & game lists
 *  Loading a game, its PGN & both players' ratings, new & restarted AI games (a guest's one game is overwritten),
 *  the AI levels, Home's game lists, and leaving every game when a player deletes their data
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { checkStartFen } = require("../../utils/validate.js");
const { levelList, readLevel } = require("../../utils/ai.js");
const { gameOpen, isAiGame, playerName, startParams, OPEN_SEAT } = require("../../utils/games.js");
const { buildPgn } = require("../../utils/pgn.js");
const config = require("../../config.js");
const { setGuestCookie } = require("../../middleware/auth.js");
const { readRating, ratingSummary } = require("../../utils/rating.js");
const { retrieveRatings, forfeit, newAiGame, newGuestGame } = require("../../dataClient.js");
const chessGuards = require("./chess.guards.js");
const chessShapers = require("./chess.shapers.js");
const chessOffers = require("./chess.offers.js");
const chessInvites = require("./chess.invites.js");

/* ---------------------------------------------------------------- */
// Get Game (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Returns the board & the player's color. Used to load a game and when the socket says the opponent moved
 * @param  {[string]} req.params.gameId [game id]
 * @return {[object]} response [{ status, game_id, game_board, mode ("chess" | "cards"), ai, ai_level, start_params, player_color, opponent_color,
 * opponent_name, moves, prev_move, opening, w_knight, b_knight, w_piece, b_piece, state, winner, reason, draw_offer, message }]
 */
async function getGame(req, res) {
	const response = await chessGuards.loadMyGame(req, res);
	if (!response) { return; }

	// Picks the color
	const playerId = chessGuards.playerInGame(req, response.game_data);
	if (!playerId) { return chessGuards.notInGame(req, res); }

	return res.json(chessShapers.playerGame(response, playerId));
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
	const response = await chessGuards.loadMyGame(req, res);
	if (!response) { return; }

	const gameData = response.game_data;
	if (!chessGuards.playerInGame(req, gameData)) { return chessGuards.notInGame(req, res); }
	if (gameData.mode?.S == "cards") { return chessGuards.useCardsRoutes(res); }

	try {
		// An AI game has one player, the requester. Its game saves no names
		const player = req.user?.user_metadata?.screenname || (req.user ? "Player" : "Guest");
		const pgn = buildPgn(gameData, { site: config.clientUrl, aiLevel: chessShapers.aiLevel(gameData), player });
		return res.json({ status: 200, ...pgn, message: "PGN" });
	} catch (err) {
		// A saved move that can't be replayed
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
 * @param  {[object]} req.body [{ game_id (guests only: their saved id, left out = a new one. Signed in players' ids are made by the data service),
 * start_color ("alternate" | "random" | "w" | "b", the requester's color from Home & the guest page, the server picks the sides,
 * the play page also sends random for a guest's missing game) OR player_id_1 (white) & player_id_2 (black) (gameplay's fallback for a guest's
 * first game, one side is "CHESS_AI", the other side is always the requester), ai_level (optional, the level dropdown),
 * start_fen (optional, a set position to start from, the Start position box),
 * replace_current (optional, true = forfeit the open AI game & start this one) }]
 * @return {[object]} response [{ status, game_id, ai, ai_level, game_board, w_knight, b_knight, w_piece, b_piece, message }
 * | { status: 409, game_id (the open one), message } | { status: 400, message } (start_fen can't be played)
 * | { status: 429, message } (too many new games, middleware/rateLimit.js)]
 */
async function newGame(req, res) {
	const { game_id, player_id_1, player_id_2, ai_level, start_color, replace_current } = req.body || {};
	if (!start_color && (player_id_1 == "CHESS_AI") == (player_id_2 == "CHESS_AI")) {
		return res.status(400).json({ status: 500, message: "One player must be CHESS_AI, friend games start from /invite" });
	}
	// Checked before anything is forfeited or saved
	const position = checkStartFen(req.body?.start_fen);
	if (position.message) { return res.status(400).json({ status: 400, message: position.message }); }

	// Left out: the default level, or a guest's reset keeps their game's
	const level = ai_level == undefined ? undefined : readLevel(ai_level);
	// No start_color (the play page's first guest game): random from its restarts on
	const params = chessShapers.readStartParams(req.body, position.fen);
	// That first game's side comes from the player ids
	const side = start_color ? undefined : (player_id_1 == "CHESS_AI" ? "b" : "w");

	// A guest's own game is reset, another browser's id (or CHESS_AI) gets a new game with a new id (the client saves it)
	if (!req.user) {
		const response = await newGuestGame({ game_id, color: params.color, side, level, start_fen: params.fen });
		// Only this browser can play it now, the data service signed it for this game
		if (response.game_data) { setGuestCookie(res, response.guest_token); }
		return chessGuards.reply(res, chessShapers.gameResponse(response));
	}

	// One AI game at a time (guests only ever have one, it's overwritten)
	const current = await currentGame(true);
	if (current && !replace_current) { return res.status(409).json({ status: 409, game_id: current.game_id.S, message: "AI game already open" }); }
	// A new game forfeits the open one, & only goes on once it's known closed: two open AI games break the one-game limit
	// (the same rule as newCardsGame in cardsController.js)
	if (current && !(await closedNow(current.game_id.S))) {
		return res.status(503).json({ status: 503, message: "Your other game couldn't be closed. Try again." });
	}

	// The data service picks the sides (random flips a coin) & makes the id
	const response = await newAiGame({ color: params.color, level, start_fen: params.fen });
	return chessGuards.reply(res, chessShapers.gameResponse(response));
}

/**
 * @description The requester's open AI game or friend game, read now
 * @param  {[boolean]} ai [true = the AI game, false = the friend game]
 * @return {[object]} gameData [null when there's none open]
 */
async function currentGame(ai) {
	return chessShapers.openGame(await chessGuards.myGames(), ai);
}

/**
 * @description Forfeits an open game for a new one to take its place, and says whether it is known closed now: the forfeit answered 200,
 * or (refused as already over, or failed: a 5xx, a timeout that may still have landed) a fresh read shows it closed.
 * A read that fails too: not known, false
 * @param  {[string]} gameId
 * @return {[boolean]} closed
 */
async function closedNow(gameId) {
	const closed = await forfeit(gameId).catch(nullIfDown);
	if (closed?.status == 200) { return true; }
	const latest = (await chessGuards.retrieveGame(gameId, true).catch(nullIfDown))?.game_data;
	return Boolean(latest) && !gameOpen(latest);
}

/**
 * @description A data service call that failed because the data service is down answers null, any other error is thrown on
 * @param  {[object]} err [the call's error]
 * @return {[null]} answer
 */
function nullIfDown(err) {
	if (err.name != "DataServiceDown") { throw err; }
	return null;
}


/* ---------------------------------------------------------------- */
// Restart (POST)
/* ---------------------------------------------------------------- */
/**
 * @description AI games: a new game starts with a new id, a game that's still going is forfeited first (the old one stays closed)
 * with the same start settings: the level & the player's color (Random draws again, Alternate switches). Guests only have one game,
 * so theirs is overwritten
 * @param  {[string]} req.params.gameId [current game id]
 * @return {[object]} response [{ status, game_id (the new game), ai, game_board, w_knight, b_knight, w_piece, b_piece, state, winner, reason, message }]
 */
async function restartGame(req, res) {
	const response = await chessGuards.loadMyGame(req, res);
	if (!response) { return; }

	const gameData = response.game_data;
	const playerId = chessGuards.playerInGame(req, gameData);
	if (!playerId) { return chessGuards.notInGame(req, res); }
	if (gameData.mode?.S == "cards") { return chessGuards.useCardsRoutes(res); }
	if (!isAiGame(gameData)) { return res.status(409).json({ status: 500, message: "Friend games can't be restarted" }); }

	// The start settings only change with a new game from Home or the guest page
	const params = startParams(gameData);
	const level = chessShapers.aiLevel(gameData);

	// Guests have one game, it's overwritten
	if (!req.user) {
		const restarted = await newGuestGame({ game_id: gameData.game_id.S, color: params.color, level, start_fen: params.fen });
		return chessGuards.reply(res, chessShapers.gameResponse(restarted));
	}

	// Restarting mid game forfeits it, & only goes on once it's known closed
	if (gameOpen(gameData) && !(await closedNow(gameData.game_id.S))) {
		return res.status(503).json({ status: 503, message: "This game couldn't be closed. Try again." });
	}
	// Random draws again
	const restarted = await newAiGame({ color: params.color, level, start_fen: params.fen });
	return chessGuards.reply(res, chessShapers.gameResponse(restarted));
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
// User Games (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Returns a user's game lists for Home, expired games & invites are pruned first
 * @param  {[string]} req.params.userId [auth0 user id without "auth0|"]
 * @return {[object]} response [{ status, user_id, requested_games, open_games, closed_games, ai_game_id / friend_game_id (the open AI / friend game or null),
 * open_game_list ([{ game_id, ai, ai_level, opponent_name, player_color, start_params, opening }], newest last),
 * closed_game_list (the same & winner, reason, the last 20 finished games, newest first),
 * sent_invite ({ game_id, name, player_color, start_params, open_seat (a challenge link) } or null),
 * received_invites ([{ game_id, name, player_color, start_params }]),
 * rating ({ rating, provisional, rated_games }, Home's "Rating // 1520?"), message }]
 */
async function getUserGames(req, res) {
	const userId = req.params.userId;
	if (userId != chessGuards.userPlayerId(req.user)) { return res.status(403).json({ status: 403, message: "Not your game list" }); }

	// The data service drops expired games & invites before Home lists them
	const response = await chessGuards.myGames();
	// No games yet, the starting rating
	if (!response.user_data) {
		return chessGuards.reply(res, { status: response.status, rating: ratingSummary(readRating(null)), message: response.message });
	}
	const userData = response.user_data;

	return res.json({
		status: response.status,
		user_id: userData.user_id.S,
		requested_games: userData.requested_games.S,
		open_games: userData.open_games.S,
		closed_games: userData.closed_games.S,
		// Home draws its board & links it (Continue current game)
		ai_game_id: userData.ai_game_id,
		// The same, in Play a friend
		friend_game_id: userData.friend_game_id,
		// Your games: "vs AI // LEVEL 3 // YOU PLAY WHITE (RANDOM)"
		open_game_list: userData.open_game_list.map((game) => chessShapers.gameSummary(game, userId)),
		// Finished games: won, lost or draw & why
		closed_game_list: (userData.closed_game_list || []).map((game) => (
			{ ...chessShapers.gameSummary(game, userId), winner: game.winner?.S || null, reason: game.reason?.S || null }
		)),
		// "Invite sent to Bob // waiting"
		sent_invite: userData.sent_invite ? inviteBody(userData.sent_invite) : null,
		// "Bob invited you", accept & decline
		received_invites: userData.received_invites.map(inviteBody),
		// The settings page's default start settings, Home's dropdowns start on them
		settings: chessShapers.userSettings(userData),
		// The settings page's account box
		games_finished: JSON.parse(userData.closed_games.S).length,
		// Friend games change it (closeGame in data-service/db/)
		rating: ratingSummary(readRating(userData)),
		message: response.message,
	});
}

/**
 * @description One invite for Home. The other player's id stays on the server, open_seat marks a challenge link
 * @param  {[object]} invite [{ game_id, name, player_id, player_color, start_params }]
 * @return {[object]} body [{ game_id, name, player_color, start_params, open_seat (only on a challenge link) }]
 */
function inviteBody(invite) {
	return {
		game_id: invite.game_id,
		name: invite.name,
		player_color: invite.player_color,
		start_params: invite.start_params,
		...(invite.player_id == OPEN_SEAT ? { open_seat: true } : {}),
	};
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
	const response = await chessGuards.loadMyGame(req, res);
	if (!response) { return; }

	const gameData = response.game_data;
	const playerId = chessGuards.playerInGame(req, gameData);
	if (!playerId) { return chessGuards.notInGame(req, res); }
	const playerColor = playerId == gameData.white_player_id.S ? "w" : "b";
	const opponentColor = playerColor == "w" ? "b" : "w";
	const opponentId = opponentColor == "w" ? gameData.white_player_id.S : gameData.black_player_id.S;
	if (isAiGame(gameData)) {
		return res.json({
			status: 200,
			rated: false,
			player_rating: null,
			opponent_rating: null,
			opponent_name: null,
			rating_change: null,
			message: "AI games aren't rated",
		});
	}

	// Both players, only for a player in the game
	const ratings = (await retrieveRatings(gameData.game_id.S)).ratings || {};
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


/* ---------------------------------------------------------------- */
// Leaving Every Game
/* ---------------------------------------------------------------- */
/**
 * @description Delete my data (the settings page): the player leaves every game before their user_db row goes. Their open friend game
 * is forfeited (the friend wins & their board shows it), so is their open AI game, their sent invite is cancelled & the invites they got are declined
 * @param  {[string]} playerId [auth0 user id without "auth0|", the requester]
 */
async function leaveAllGames(playerId) {
	const mine = await chessGuards.myGames();
	const friendGame = chessShapers.openGame(mine, false);
	if (friendGame) { await chessOffers.forfeitOpenGame(friendGame, playerId); }
	const aiGame = chessShapers.openGame(mine, true);
	if (aiGame) { await forfeit(aiGame.game_id.S); }

	if (mine.user_data?.sent_invite) { await chessInvites.dropInvite(mine.user_data.sent_invite.game_id); }
	// Declined
	const received = chessShapers.receivedInvites(mine);
	for (let i = 0; i < received.length; i++) { await chessInvites.dropInvite(received[i].game_id); }
}


module.exports = { getGame, getPgn, newGame, currentGame, restartGame, getLevels, getUserGames, getRatings, leaveAllGames };
