/*
 *  game.invites.js  --  data service
 *	Game Routes: invites & challenge links
 *  A friend game starts PENDING, from an invite or a challenge link, and opens when the other player accepts it or takes the link's
 *  empty seat. One friend game at a time: starting one can forfeit the player's open one and cancels their sent invite
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { initializeGame, retrieveGame, closeGame, acceptInvite, takeOpenSeat, deleteInvite } = require("../../db/index.js");
const {
	playerInGame, playerColor, inviterId, playerName, gameOpen, gamePending, openSeat, startParams, newStartParams, pickSides, isId,
	DAYS_PER_MOVE, OPEN_SEAT,
} = require("../../utils/games.js");
const { refuse } = require("../../utils/refuse.js");
const gameShared = require("./game.shared.js");

// An invite's screenname from Auth0 (usernames are 3 - 20)
const NAME_LENGTH = 50;

/* ---------------------------------------------------------------- */
// Invite (POST)
/* ---------------------------------------------------------------- */
/**
 * @description A signed in player invites a friend: a PENDING game with the requester as the inviter. The chess server found the friend
 * (opponent_id) & answers the rules around it (one sent invite, their invite to you, one friend game at a time) before this.
 * The names are each player's username, or their Auth0 screenname until they pick one (the requester's comes from their token)
 * @param  {[object]} req.body [{ opponent_id, opponent_screenname (optional), color (the requester's pick), start_fen (optional),
 * takebacks (optional, 0 = off, 3 or left out = up to 3), days_per_move (optional, 1, 3 or 7, left out = no limit) }].
 * The game id is made here
 * @return {[object]} response [initializeGame's { status, game_data (PENDING, game_id is the new id), message }]
 */
async function inviteGame(req, res) {
	if (req.player.guest) { return refuse(req, res, 403, "Guests can't invite"); }
	const { opponent_id, opponent_screenname, color, start_fen, takebacks, days_per_move } = req.body || {};
	if (!isId(opponent_id)) { return refuse(req, res, 400, "Invalid opponent"); }
	if (takebacks !== undefined && takebacks !== 0 && takebacks !== 3) { return refuse(req, res, 400, "Invalid takebacks"); }
	if (days_per_move !== undefined && !DAYS_PER_MOVE.includes(days_per_move)) { return refuse(req, res, 400, "Invalid days per move"); }
	if (opponent_id == req.player.id) { return refuse(req, res, 400, "That's your own id"); }
	if (opponent_screenname !== undefined && (typeof opponent_screenname != "string" || opponent_screenname.length > NAME_LENGTH)) {
		return refuse(req, res, 400, "Invalid screenname");
	}
	const position = gameShared.readStartFen(start_fen);
	if (position.message) { return refuse(req, res, 400, position.message); }

	const params = newStartParams(color, position.fen, takebacks, days_per_move);
	// Random is drawn now, the invite says "You play black (random)"
	const sides = pickSides(params, req.player.id, opponent_id, await gameShared.lastColor(params, req.player.id, false));
	const namesById = {
		[req.player.id]: (await gameShared.username(req.player.id)) || req.player.user.user_metadata?.screenname,
		[opponent_id]: (await gameShared.username(opponent_id)) || opponent_screenname,
	};
	const response = await initializeGame(false, sides.white, sides.black, false, {
		names: { w: namesById[sides.white], b: namesById[sides.black] },
		pending: true,
		start_params: params,
		inviter_id: req.player.id,
	});
	return gameShared.created(req, res, response);
}

/* ---------------------------------------------------------------- */
// Challenge Link
/* ---------------------------------------------------------------- */
/**
 * @description A signed in player makes a challenge link: a PENDING game like an invite, with the other side's seat empty (OPEN_SEAT) &
 * only on the requester's requested_games. The chess server answers the rules around it (one sent invite, one friend game at a time)
 * before this
 * @param  {[object]} req.body [{ color (the requester's pick), start_fen (optional), takebacks (optional, 0 = off, 3 or left out = up to 3),
 * days_per_move (optional, 1, 3 or 7, left out = no limit) }]. The game id is made here
 * @return {[object]} response [initializeGame's { status, game_data (PENDING, game_id is the new id), message }]
 */
async function challengeGame(req, res) {
	if (req.player.guest) { return refuse(req, res, 403, "Guests can't make a challenge link"); }
	const { color, start_fen, takebacks, days_per_move } = req.body || {};
	if (takebacks !== undefined && takebacks !== 0 && takebacks !== 3) { return refuse(req, res, 400, "Invalid takebacks"); }
	if (days_per_move !== undefined && !DAYS_PER_MOVE.includes(days_per_move)) { return refuse(req, res, 400, "Invalid days per move"); }
	const position = gameShared.readStartFen(start_fen);
	if (position.message) { return refuse(req, res, 400, position.message); }

	const params = newStartParams(color, position.fen, takebacks, days_per_move);
	// Random is drawn now, the link says "You play black (random)"
	const sides = pickSides(params, req.player.id, OPEN_SEAT, await gameShared.lastColor(params, req.player.id, false));
	const name = (await gameShared.username(req.player.id)) || req.player.user.user_metadata?.screenname;
	const names = sides.white == req.player.id ? { w: name } : { b: name };
	const response = await initializeGame(false, sides.white, sides.black, false, {
		names,
		pending: true,
		start_params: params,
		inviter_id: req.player.id,
		challenge: true,
	});
	return gameShared.created(req, res, response);
}

/**
 * @description What the join screen shows, for any signed in player with the link. Any other game (or none) answers the same
 * "Game data not found"
 * @param  {[string]} req.params.gameId [game id from the link]
 * @return {[object]} response [{ status, open (the seat is still empty), name (who made the link), player_color (the seat), start_params,
 * message }]
 */
async function getChallenge(req, res) {
	if (req.player.guest) { return refuse(req, res, 403, "Guests can't join"); }
	const gameData = (await retrieveGame(req.params.gameId, true)).game_data;
	if (!gameData?.challenge) { return res.json({ status: 500, message: "Game data not found" }); }
	const seat = openSeat(gameData);
	return res.json({
		status: 200,
		open: Boolean(seat),
		name: seat ? playerName(gameData, seat == "w" ? "b" : "w") : null,
		player_color: seat,
		start_params: seat ? startParams(gameData) : null,
		message: "Challenge",
	});
}

/**
 * @description A signed in player takes a challenge link's empty seat: PENDING -> OPEN. The same order as acceptGame, so a refusal never
 * costs them their game: their open friend game answers 409 (unless replace_current), the creator in another friend game is refused, then
 * the seat is taken (a conditional write, so only one player wins it), and only then their open friend game is forfeited & their sent
 * invite cancelled. The player already in the seat just gets the game (a repeat)
 * @param  {[string]} req.params.gameId [game id from the link]
 * @param  {[object]} req.body [{ replace_current (optional, true = forfeit the requester's open friend game) }]
 * @return {[object]} response [takeOpenSeat's { status, game_data, message } plus forfeited & dropped_invites (see acceptGame) |
 * { status: 409, game_id (the open one), message: "Friend game already open" } | { status: 409, message: "Game is taken" }]
 */
async function joinGame(req, res) {
	if (req.player.guest) { return refuse(req, res, 403, "Guests can't join"); }
	const { replace_current } = req.body || {};
	const response = await retrieveGame(req.params.gameId, true);
	const gameData = response.game_data;
	// Cancelled, expired or not a link
	if (!gameData?.challenge) { return res.json({ status: 500, message: "Game data not found" }); }
	const playerId = req.player.id;
	if (playerInGame(req.player, gameData) && gameOpen(gameData)) { return res.json({ ...response, forfeited: null, dropped_invites: [] }); }
	if (playerId == inviterId(gameData)) { return refuse(req, res, 403, "That's your own link"); }
	const seat = openSeat(gameData);
	if (!seat) { return refuse(req, res, 409, "Game is taken"); }

	// One friend game at a time
	const current = await gameShared.currentGame(playerId, false);
	if (current && replace_current !== true) {
		return res.json({ status: 409, game_id: current.game_id.S, message: "Friend game already open" });
	}
	if (await gameShared.currentGame(inviterId(gameData), false)) { return refuse(req, res, 409, "They're in another game now"); }

	const name = (await gameShared.username(playerId)) || req.player.user.user_metadata?.screenname;
	const joined = await takeOpenSeat(gameData, seat, playerId, name);
	if (joined.status != 200) { return refuse(req, res, joined.status, joined.message); }
	// Only now: a link nobody joins doesn't count as a game
	await gameShared.saveFriendColors(joined.game_data);
	const forfeited = await forfeitCurrentGame(current, playerId);
	const dropped = await gameShared.dropSentInvite(playerId);
	return res.json({ ...joined, forfeited, dropped_invites: dropped ? [dropped] : [] });
}

/* ---------------------------------------------------------------- */
// Accept & Decline (POST)
/* ---------------------------------------------------------------- */
/**
 * @description The invited player starts the game: PENDING -> OPEN. In this order, so a refusal never costs the requester their game:
 * the requester's open friend game answers 409 (unless replace_current), the inviter in another friend game (a rematch, or they accepted
 * one) answers "They're in another game now" (the chess server then declines it), then the invite is accepted (a conditional write, so an
 * invite declined or cancelled since changes nothing), and only then the requester's open friend game is forfeited & their sent invite
 * is cancelled (they're in a game now)
 * @param  {[string]} req.params.gameId [PENDING game id]
 * @param  {[object]} req.body [{ replace_current (optional, true = forfeit the requester's open friend game) }]
 * @return {[object]} response [acceptInvite's { status, game_data, message } plus forfeited (the game it forfeited, for both boards) &
 * dropped_invites (the sent invite it cancelled, for both Homes) | { status: 409, game_id (the open one),
 * message: "Friend game already open" }]
 */
async function acceptGame(req, res) {
	const { replace_current } = req.body || {};
	const response = await retrieveGame(req.params.gameId, true);
	// Declined, cancelled or expired
	if (!response.game_data) { return res.json(response); }
	const gameData = response.game_data;
	const playerId = playerInGame(req.player, gameData);
	if (!playerId) { return refuse(req, res, 403, "Player is not in this game"); }
	if (!gamePending(gameData)) { return refuse(req, res, 409, "Invite was already answered"); }
	if (playerId == inviterId(gameData)) { return refuse(req, res, 403, "Only the invited player can accept"); }

	// One friend game at a time
	const current = await gameShared.currentGame(playerId, false);
	if (current && replace_current !== true) {
		return res.json({ status: 409, game_id: current.game_id.S, message: "Friend game already open" });
	}
	if (await gameShared.currentGame(inviterId(gameData), false)) { return refuse(req, res, 409, "They're in another game now"); }

	// The conditional write goes first: a lost accept (declined or cancelled since) changes nothing
	const accepted = await acceptInvite(gameData);
	if (accepted.status != 200) { return res.json(accepted); }
	// Only now: an invite that's never played doesn't count as a game
	await gameShared.saveFriendColors(gameData);
	const forfeited = await forfeitCurrentGame(current, playerId);
	const dropped = await gameShared.dropSentInvite(playerId);
	return res.json({ ...accepted, forfeited, dropped_invites: dropped ? [dropped] : [] });
}

/**
 * @description Starting a friend game forfeits the player's open one, the other side wins
 * @param  {[object]} current [the player's open friend game, null when there's none]
 * @param  {[string]} playerId [the player starting the new game]
 * @return {[object]} forfeited [the closed game, null when there was none or it didn't close]
 */
async function forfeitCurrentGame(current, playerId) {
	if (!current) { return null; }
	const closed = await closeGame(current, playerColor(playerId, current) == "w" ? "b" : "w", "forfeit");
	return closed.status == 200 ? closed.game_data : null;
}

/**
 * @description Deletes a PENDING game: the invited player declines it, or the inviter cancels it
 * @param  {[string]} req.params.gameId [PENDING game id]
 * @return {[object]} response [deleteInvite's { status, message }, plus game_data (the invite as it was) so the chess server can tell
 * both Homes]
 */
async function declineGame(req, res) {
	const response = await retrieveGame(req.params.gameId, true);
	// Already gone
	if (!response.game_data) { return res.json(response); }
	const gameData = response.game_data;
	if (!playerInGame(req.player, gameData)) { return refuse(req, res, 403, "Player is not in this game"); }
	if (!gamePending(gameData)) { return refuse(req, res, 409, "Invite was already answered"); }

	return res.json({ ...(await deleteInvite(gameData)), game_data: gameData });
}


module.exports = { inviteGame, challengeGame, getChallenge, joinGame, acceptGame, declineGame };
