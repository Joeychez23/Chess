/*
 *  chess.invites.js  --  chess server
 *	Chess Routes: invites & challenge links
 *  A friend game starts PENDING, from an invite by username or a challenge link, and opens when the other player accepts or joins.
 *  A player has one friend game open & one sent invite at a time: replace_current forfeits the open game first
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { checkStartFen } = require("../../utils/validate.js");
const { checkUsername } = require("../../utils/username.js");
const { gameOpen, gamePending, inviterId } = require("../../utils/plainItems.js");
const { ifSaved, invite, challenge, retrieveChallenge, join, accept, decline, findUsername } = require("../../dataClient.js");
const chessGuards = require("./chess.guards.js");
const chessShapers = require("./chess.shapers.js");
const chessOffers = require("./chess.offers.js");

/* ---------------------------------------------------------------- */
// Invite (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Invites a friend by username (never by email, so this can't tell anyone which emails have accounts) & creates a PENDING game,
 * they accept or decline it on Home. The challenger (signed in user) picks their color, the sides are drawn now so the invite shows them.
 * One sent invite at a time: a new one deletes the last one.
 * Signed in players have one friend game open at a time: while one is open this answers 409, unless replace_current forfeits it first
 * @param  {[object]} req.body [{ opponent_username, start_color ("alternate" | "random" | "w" | "b", the challenger's color, left out = Random),
 * start_fen (optional, a set position to start from), takebacks (optional, 0 = off, left out = up to 3 per game),
 * days_per_move (optional, 1, 3 or 7, left out = no limit), replace_current (optional, true = forfeit the open friend game & invite) }]
 * @return {[object]} response [{ status, game_id, state: "PENDING", message } | { status: 409, game_id (the open one), open: true, message }
 * | { status: 400, message } (start_fen can't be played)]
 */
async function inviteGame(req, res) {
	const { opponent_username, replace_current } = req.body || {};
	if (!opponent_username) { return res.status(400).json({ status: 400, message: "Missing opponent" }); }
	// Checked before anything is forfeited or saved
	const position = checkStartFen(req.body?.start_fen);
	if (position.message) { return res.status(400).json({ status: 400, message: position.message }); }
	// requireAuth sets req.user
	const challengerId = chessGuards.userPlayerId(req.user);

	const opponentId = await findOpponent(opponent_username);
	if (!opponentId) { return res.status(404).json({ status: 404, message: "Opponent not found" }); }
	if (opponentId == challengerId) { return res.status(400).json({ status: 400, message: "That's your username" }); }

	const mine = await chessGuards.myGames();
	// Accept theirs instead
	const theirInvite = chessShapers.receivedInvites(mine).find((invite) => invite.player_id == opponentId);
	if (theirInvite) { return res.status(409).json({ status: 409, game_id: theirInvite.game_id, message: "They already invited you" }); }

	// One friend game at a time: a new invite forfeits the open one
	const current = chessShapers.openGame(mine, false);
	if (current && !replace_current) {
		return res.status(409).json({ status: 409, game_id: current.game_id, open: true, message: "Friend game already open" });
	}
	if (current) { await chessOffers.forfeitOpenGame(current, challengerId); }
	// One sent invite at a time
	if (mine.user_data?.sent_invite) { await dropInvite(mine.user_data.sent_invite.game_id); }

	// The data service makes the id, the game is PENDING until they accept. Random is drawn now, the invite says "You play black (Random)"
	const params = chessShapers.readStartParams(req.body, position.fen);
	const response = await invite({
		opponent_id: opponentId,
		color: params.color,
		start_fen: params.fen,
		takebacks: params.takebacks,
		days_per_move: params.days_per_move,
	});
	if (!response.game_data) { return chessGuards.reply(res, { status: response.status, open: response.open, message: response.message }); } // open: A FRIEND GAME OPENED (Home's invite form)

	// Their Home shows the invite
	chessGuards.notifyHome(response.game_data);
	return res.json({
		status: response.status,
		game_id: response.game_data.game_id,
		state: "PENDING",
		message: response.message,
	});
}

/**
 * @description The player an invite is for
 * @param  {[string]} username [opponent_username]
 * @return {[string]} id [their player id, null when nobody has it]
 */
async function findOpponent(username) {
	const checked = checkUsername(username);
	const found = checked.username ? await findUsername(checked.username) : null;
	return found?.player_id || null;
}

/**
 * @description Deletes an invite the requester is in (a new invite replaces theirs, or the inviter is in a game now) & tells both Homes
 * @param  {[string]} gameId [PENDING game id]
 */
async function dropInvite(gameId) {
	const response = await chessGuards.retrieveGame(gameId);
	// Already answered
	if (!response.game_data || !gamePending(response.game_data)) { return; }
	const deleted = await decline(gameId);
	if (deleted.status == 200) { chessGuards.notifyHome(response.game_data); }
}


/* ---------------------------------------------------------------- */
// Challenge Link
/* ---------------------------------------------------------------- */
/**
 * @description Makes a challenge link: a PENDING game like an invite with the other seat empty, the first signed in player to open the link
 * & join takes it. It's the challenger's one sent invite: a new one deletes the last one. While a friend game is open this answers 409,
 * unless replace_current forfeits it first
 * @param  {[object]} req.body [{ start_color ("alternate" | "random" | "w" | "b", the challenger's color, left out = Random), start_fen (optional),
 * takebacks (optional, 0 = off), days_per_move (optional, 1, 3 or 7, left out = no limit), replace_current (optional) }]
 * @return {[object]} response [{ status, game_id, state: "PENDING", message } | { status: 409, game_id (the open one), open: true, message }
 * | { status: 400, message } (start_fen can't be played)]
 */
async function challengeGame(req, res) {
	// Checked before anything is forfeited or saved
	const position = checkStartFen(req.body?.start_fen);
	if (position.message) { return res.status(400).json({ status: 400, message: position.message }); }

	// One friend game at a time: a new link forfeits the open one
	const mine = await chessGuards.myGames();
	const current = chessShapers.openGame(mine, false);
	if (current && !req.body?.replace_current) {
		return res.status(409).json({ status: 409, game_id: current.game_id, open: true, message: "Friend game already open" });
	}
	if (current) { await chessOffers.forfeitOpenGame(current, chessGuards.userPlayerId(req.user)); }
	// One sent invite at a time
	if (mine.user_data?.sent_invite) { await dropInvite(mine.user_data.sent_invite.game_id); }

	const params = chessShapers.readStartParams(req.body, position.fen);
	const response = await challenge({
		color: params.color,
		start_fen: params.fen,
		takebacks: params.takebacks,
		days_per_move: params.days_per_move,
	});
	if (!response.game_data) { return chessGuards.reply(res, { status: response.status, message: response.message }); }

	// The challenger's other tabs show the link
	chessGuards.notifyHome(response.game_data);
	return res.json({ status: response.status, game_id: response.game_data.game_id, state: "PENDING", message: response.message });
}

/**
 * @description What the join screen shows
 * @param  {[string]} req.params.gameId [game id from the link]
 * @return {[object]} response [{ status, open, name, player_color, start_params, message } | { status: 404, message: "Game data not found" }]
 */
async function getChallenge(req, res) {
	return chessGuards.reply(res, await retrieveChallenge(req.params.gameId));
}

/**
 * @description Takes a challenge link's empty seat: PENDING -> OPEN, only one player wins it & the creator can't take it.
 * While the player has a friend game open this answers 409, unless replace_current forfeits it first
 * @param  {[string]} req.params.gameId [game id from the link]
 * @param  {[object]} req.body [{ replace_current (optional, true = forfeit the open friend game & join) }]
 * @return {[object]} response [{ status, game_id, ai, game_board, ..., state, message } | { status: 409, game_id (the open one), open: true, message }
 * | { status: 409, message: "Game is taken" }]
 */
async function joinGame(req, res) {
	const gameId = req.params.gameId;
	const joined = await ifSaved(() => join(gameId, req.body?.replace_current), () => savedOpenedGame(gameId));
	if (joined.status == 409 && joined.game_id) {
		return res.status(409).json({ status: 409, game_id: joined.game_id, open: true, message: "Friend game already open" });
	}
	// Joining forfeited the open one
	if (joined.forfeited) { chessOffers.tellGameOver(joined.forfeited, chessGuards.userPlayerId(req.user), joined.forfeited.winner); }
	// Their sent invite was cancelled
	for (let i = 0; i < (joined.dropped_invites || []).length; i++) { chessGuards.notifyHome(joined.dropped_invites[i]); }
	// The creator's Home shows the game
	if (joined.status == 200) { chessGuards.notifyHome(joined.game_data); }
	return chessGuards.reply(res, chessShapers.gameResponse(joined));
}

/**
 * @description A join or an accept that was too slow, read back: saved if the game is theirs & open now. What it forfeited & dropped
 * isn't known here, those boards & Homes see it when next loaded
 * @param  {[string]} gameId [game id]
 * @return {[object]} response [the latest read as the data service would have answered, null when nothing saved]
 */
async function savedOpenedGame(gameId) {
	const latest = await chessGuards.retrieveGame(gameId, true);
	return latest.game_data && gameOpen(latest.game_data) ? { ...latest, forfeited: null, dropped_invites: [] } : null;
}


/* ---------------------------------------------------------------- */
// Accept Invite (POST)
/* ---------------------------------------------------------------- */
/**
 * @description The invited player starts the game: PENDING -> OPEN. Their own sent invite is deleted (they're in a game now).
 * While they have a friend game open this answers 409, unless replace_current forfeits it first
 * @param  {[string]} req.params.gameId [PENDING game id]
 * @param  {[object]} req.body [{ replace_current (optional, true = forfeit the open friend game & accept) }]
 * @return {[object]} response [{ status, game_id, ai, game_board, w_knight, b_knight, w_piece, b_piece, state, winner, reason, message }
 * | { status: 409, game_id (the open one), open: true, message }]
 */
async function acceptGame(req, res) {
	const { replace_current } = req.body || {};
	const response = await chessGuards.retrieveGame(req.params.gameId);
	if (chessGuards.notYours(response)) { return chessGuards.notInGame(req, res); }
	// Declined, cancelled or expired
	if (!response.game_data) { return res.status(chessGuards.httpStatus(response)).json({ status: chessGuards.httpStatus(response), message: "Invite not found" }); }

	const gameData = response.game_data;
	const playerId = chessGuards.playerInGame(req, gameData);
	if (!playerId) { return chessGuards.notInGame(req, res); }
	if (!gamePending(gameData)) { return res.status(409).json({ status: 409, message: "Invite was already answered" }); }
	if (playerId == inviterId(gameData)) { return res.status(403).json({ status: 403, message: "Only the invited player can accept" }); }

	// The data service checks their open friend game (409 unless replace_current) & that the inviter isn't busy,
	// then saves the forfeit, drops their sent invite & accepts
	const gameId = gameData.game_id;
	const accepted = await ifSaved(() => accept(gameId, replace_current), () => savedOpenedGame(gameId));
	if (accepted.status == 409 && accepted.game_id) {
		return res.status(409).json({ status: 409, game_id: accepted.game_id, open: true, message: "Friend game already open" });
	}
	// The inviter started another friend game since (a rematch, or they accepted one)
	if (accepted.message == "They're in another game now") {
		await dropInvite(gameId);
		return res.status(409).json({ status: 409, message: "They're in another game now" });
	}
	// Accepting forfeited the open one
	if (accepted.forfeited) { chessOffers.tellGameOver(accepted.forfeited, playerId, accepted.forfeited.winner); }
	// Their sent invite was cancelled
	for (let i = 0; i < (accepted.dropped_invites || []).length; i++) { chessGuards.notifyHome(accepted.dropped_invites[i]); }
	// The inviter's Home shows the game
	if (accepted.status == 200) { chessGuards.notifyHome(gameData); }
	return chessGuards.reply(res, chessShapers.gameResponse(accepted));
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
	const response = await chessGuards.retrieveGame(req.params.gameId);
	if (chessGuards.notYours(response)) { return chessGuards.notInGame(req, res); }
	if (!response.game_data) { return res.status(chessGuards.httpStatus(response)).json({ status: chessGuards.httpStatus(response), message: "Invite not found" }); }

	const gameData = response.game_data;
	const playerId = chessGuards.playerInGame(req, gameData);
	if (!playerId) { return chessGuards.notInGame(req, res); }
	if (!gamePending(gameData)) { return res.status(409).json({ status: 409, message: "Invite was already answered" }); }

	const deleted = await decline(gameData.game_id);
	// The other player's Home drops it
	if (deleted.status == 200) { chessGuards.notifyHome(gameData); }
	const status = chessGuards.httpStatus(deleted);
	return res.status(status).json({ status, game_id: gameData.game_id, message: deleted.message });
}


module.exports = { inviteGame, challengeGame, getChallenge, joinGame, acceptGame, declineGame, dropInvite };
