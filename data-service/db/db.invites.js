/*
 *  db.invites.js  --  data service
 *	Chess Move Engine
 *  Friend invites and challenge links: accept, take the open seat, delete, and moving a game between the players' game lists
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { moveDeadline, OPEN_SEAT } = require("../utils/games.js");
const dbClient = require("./db.client.js");
const dbUsers = require("./db.users.js");

/* ---------------------------------------------------------------- */
// Accept invite (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description The invited player accepted: PENDING -> OPEN & the game moves from requested_games to open_games for both players
 * @param  {[object]} gameData [PENDING game item from retrieveGame]
 * @return {[object]} response [{ status, game_data, message }]
 */
async function acceptInvite(gameData) {
	const gameId = gameData.game_id.S;
	const deadline = moveDeadline(gameData); // The first move's time starts now
	const params = {
		TableName: dbClient.CHESS_TABLE,
		Key: {
			game_id: { S: gameId }
		},
		// The 25 days start from the accept
		UpdateExpression: `SET #state = :open, expireAt = :expireAt${deadline ? ", move_deadline = :move_deadline" : ""}`,
		ConditionExpression: '#state = :pending', // Only one accept wins, a decline may have gotten there first
		ExpressionAttributeNames: { "#state": "state" }, // "state" is a DynamoDB reserved word
		ExpressionAttributeValues: {
			":open": { S: "OPEN" },
			":pending": { S: "PENDING" },
			":expireAt": { N: dbClient.expireTime() }
		}
	}
	if (deadline) { params.ExpressionAttributeValues[":move_deadline"] = { N: deadline }; }

	const saved = await dbClient.updateOrConflict(params, `Invite was already answered: ${gameId}`);
	if (saved.status != 200) { return saved; }

	const listError = await movePlayersGame(gameData, gameId, "requested_games", "open_games");
	if (listError) { throw listError; }

	gameData.state = { S: "OPEN" };
	if (deadline) { gameData.move_deadline = { N: deadline }; }
	return {
		status: 200,
		game_data: gameData,
		message: `Accepted game id: ${gameId}`
	}
}

/* ---------------------------------------------------------------- */
// Take open seat (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description A player opened a challenge link & joined: they take the seat, PENDING -> OPEN & the game goes on both players' open_games
 * @param  {[object]} gameData [PENDING challenge game item from retrieveGame]
 * @param  {[string]} seat [openSeat(gameData), "w" or "b"]
 * @param  {[string]} playerId [the player taking it]
 * @param  {[string]} name [their username or screenname, left out = the game has no name for them]
 * @return {[object]} response [{ status, game_data, message } | { status: 409, message: "Game is taken" }]
 */
async function takeOpenSeat(gameData, seat, playerId, name) {
	const gameId = gameData.game_id.S;
	const side = seat == "w" ? "white" : "black";
	const deadline = moveDeadline(gameData); // The first move's time starts now
	const params = {
		TableName: dbClient.CHESS_TABLE,
		Key: {
			game_id: { S: gameId }
		},
		// The 25 days start from the join
		UpdateExpression: `SET #state = :open, expireAt = :expireAt, ${side}_player_id = :player${name ? `, ${side}_name = :name` : ""}${deadline ? ", move_deadline = :move_deadline" : ""}`,
		ConditionExpression: `#state = :pending AND ${side}_player_id = :seat`, // Only one player wins the seat, a cancel may have gotten there first
		ExpressionAttributeNames: { "#state": "state" },
		ExpressionAttributeValues: {
			":open": { S: "OPEN" },
			":pending": { S: "PENDING" },
			":expireAt": { N: dbClient.expireTime() },
			":player": { S: playerId },
			":seat": { S: OPEN_SEAT }
		}
	}
	if (name) { params.ExpressionAttributeValues[":name"] = { S: name }; }
	if (deadline) { params.ExpressionAttributeValues[":move_deadline"] = { N: deadline }; }

	// Not updateOrConflict: losing the seat is a 409, not a 500
	try {
		await dbClient.connection.updateItem(params);
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return { status: 409, message: "Game is taken" }; }
		throw err;
	}

	const game = { ...gameData, state: { S: "OPEN" }, [`${side}_player_id`]: { S: playerId } };
	if (name) { game[`${side}_name`] = { S: name }; }
	if (deadline) { game.move_deadline = { N: deadline }; }
	const listError = await movePlayersGame(game, gameId, "requested_games", "open_games");
	if (listError) { throw listError; }

	return {
		status: 200,
		game_data: game,
		message: `Joined game id: ${gameId}`
	}
}

/* ---------------------------------------------------------------- */
// Delete invite (DELETE)
/* ---------------------------------------------------------------- */
/**
 * @description A declined or cancelled invite: the PENDING game is deleted & dropped from both players' requested_games
 * @param  {[object]} gameData [PENDING game item from retrieveGame]
 * @return {[object]} response [{ status, message }]
 */
async function deleteInvite(gameData) {
	const gameId = gameData.game_id.S;
	const params = {
		TableName: dbClient.CHESS_TABLE,
		Key: {
			game_id: { S: gameId }
		},
		ConditionExpression: '#state = :pending', // An accepted game is never deleted
		ExpressionAttributeNames: { "#state": "state" },
		ExpressionAttributeValues: {
			":pending": { S: "PENDING" }
		}
	}

	// Not updateOrConflict: this is a delete
	try {
		await dbClient.connection.deleteItem(params);
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return { status: 500, message: `Invite was already answered: ${gameId}` }; }
		throw err;
	}

	const listError = await movePlayersGame(gameData, gameId, "requested_games", null);
	if (listError) { throw listError; }

	return {
		status: 200,
		message: `Deleted invite id: ${gameId}`
	}
}

/* ---------------------------------------------------------------- */
// Move a game between game lists
/* ---------------------------------------------------------------- */
/**
 * @description moveUserGame for both players. Both are tried even when the first fails,
 * so one player's failed save doesn't leave the other's stale too
 * @param  {[object]} gameData [game item]
 * @param  {[string]} gameId [game id]
 * @param  {[string]} fromList [moveUserGame's fromList]
 * @param  {[string]} toList [moveUserGame's toList]
 * @return {[object]} error [the first failed save's error, for the caller to throw, null when both saved]
 */
async function movePlayersGame(gameData, gameId, fromList, toList) {
	const players = [gameData.white_player_id.S, gameData.black_player_id.S];
	const results = await Promise.allSettled(players.map((userId) => moveUserGame(userId, gameId, fromList, toList)));
	return results.find((result) => result.status == "rejected")?.reason || null;
}

/**
 * @description Moves a game id between a user's game lists: open_games -> closed_games (closed), requested_games -> open_games (accepted),
 * requested_games -> nowhere (declined or cancelled). Home only lists open games & invites
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @param  {[string]} gameId [game id]
 * @param  {[string]} fromList ["requested_games" or "open_games"]
 * @param  {[string]} toList ["open_games" or "closed_games", null just drops it]
 * @throws when the lists couldn't be saved (changeUserGames' 500 after LIST_SAVE_TRIES), so the route never answers 200 with stale lists
 */
async function moveUserGame(userId, gameId, fromList, toList) {
	if (userId == "CHESS_AI" || userId == "GUEST_USER" || userId == OPEN_SEAT || userId == gameId) { return; } // A guest's player id is their game id

	const response = await dbUsers.changeUserGames(userId, function moveGame(gameLists) {
		gameLists[fromList] = gameLists[fromList].filter((listGameId) => listGameId != gameId);
		if (toList && !gameLists[toList].includes(gameId)) { gameLists[toList][gameLists[toList].length] = gameId; }
	});
	if (response.status != 200) { throw new Error(response.message); }
}

module.exports = {
	acceptInvite,
	takeOpenSeat,
	deleteInvite,
	movePlayersGame
};
