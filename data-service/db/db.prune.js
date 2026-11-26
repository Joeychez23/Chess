/*
 *  db.prune.js  --  data service
 *	Chess Move Engine
 *  Reading the games in a player's game lists: drops the ones TTL deleted, closes the ones that ran out of time, and splits them
 *  for Home (open games, finished games, invites). Delete my data reads the lists here too, to expire or anonymize those games first
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { overdue } = require("../utils/games.js");
const dbClient = require("./db.client.js");
const dbGames = require("./db.games.js");
const dbUsers = require("./db.users.js");

const FINISHED_GAMES = 20; // Games Finished games on Home shows, closed_games only grows
const DELETED_NAME = "Deleted player"; // A deleted player's name in their finished friend games, the space means no username can be it
const BATCH_GET_KEYS = 100; // The most keys one DynamoDB batch get takes

/* ---------------------------------------------------------------- */
// Prune open games
/* ---------------------------------------------------------------- */
/**
 * @description Drops games TTL already deleted (or that the user isn't in) from a user's open_games & saves the shorter list. Also finds the user's
 * AI game & friend game (a player has one of each open at a time, the chess server's newGame & inviteGame)
 * @param  {[object]} userData [user item from retrieveUser]
 * @return {[object]} userData [same item, open_games.S only lists games that still exist,
 * ai_game_id / friend_game_id = the newest open AI / friend game or null, open_game_list = the open game items (newest last) for Your games,
 * timed_out_games = the games this load closed on time, for the chess server to tell both players]
 */
async function pruneOpenGames(userData) {
	userData.ai_game_id = null;
	userData.friend_game_id = null;

	const games = await pruneGameList(userData, "open_games");
	const timedOut = await closeOverdueGames(games);
	if (timedOut.length) {
		userData.timed_out_games = timedOut;
		Object.assign(userData, (await dbUsers.retrieveUser(userData.user_id.S, true)).user_data); // The game lists and the rating changed
	}
	const openGames = games.filter((game) => (game.state?.S || "OPEN") == "OPEN"); // A finished game left in open_games is never the open one
	userData.open_game_list = openGames;
	for (const game of openGames) { // The newest is last in open_games
		if (game.white_player_id?.S == "CHESS_AI" || game.black_player_id?.S == "CHESS_AI") { userData.ai_game_id = game.game_id.S; }
		else { userData.friend_game_id = game.game_id.S; }
	}
	return userData;
}

/**
 * @description Closes the games in a list whose player to move ran out of time, a game that does is updated in the list
 * @param  {[array]} games [game items, pruneGameList's projection is enough]
 * @return {[array]} timedOut [the closed game items this call closed]
 */
async function closeOverdueGames(games) {
	const timedOut = [];
	for (const game of games) {
		if (!overdue(game)) { continue; }
		const response = await dbGames.retrieveGame(game.game_id.S, true); // The whole game: the read closes it
		if (!response.game_data) { continue; }
		const closed = response.game_data;
		Object.assign(game, { state: closed.state, winner: closed.winner, reason: closed.reason, move_deadline: closed.move_deadline });
		if (response.timed_out) { timedOut.push(closed); }
	}
	return timedOut;
}

/* ---------------------------------------------------------------- */
// Prune closed games
/* ---------------------------------------------------------------- */
/**
 * @description Finds the user's newest finished games for Finished games on Home, dropping any TTL already deleted from closed_games
 * @param  {[object]} userData [user item from retrieveUser]
 * @return {[object]} userData [same item, closed_game_list = up to FINISHED_GAMES closed game items, newest first]
 */
async function pruneClosedGames(userData) {
	const games = await pruneGameList(userData, "closed_games", FINISHED_GAMES);
	userData.closed_game_list = games.filter((game) => game.state?.S == "CLOSED").reverse(); // The newest is last in closed_games
	return userData;
}

/* ---------------------------------------------------------------- */
// Prune invites
/* ---------------------------------------------------------------- */
/**
 * @description Drops invites TTL already deleted from a user's requested_games & splits the rest into sent & received
 * by inviter_id (the chess server's inviteGame, games from before inviter_id: the inviter played white)
 * @param  {[object]} userData [user item from retrieveUser]
 * @return {[object]} userData [same item, sent_invite = { game_id, name, player_id, player_color, start_params } or null (one at a time),
 * received_invites = [{ game_id, name, player_id, player_color, start_params }], name & player_id are the other player's, player_color is the user's]
 */
async function pruneInvites(userData) {
	const userId = userData.user_id.S;
	userData.sent_invite = null;
	userData.received_invites = [];

	const games = await pruneGameList(userData, "requested_games");
	for (const game of games) {
		if (game.state?.S != "PENDING") { continue; } // Accepted while this was loading
		const sent = (game.inviter_id?.S || game.white_player_id.S) == userId;
		const white = game.white_player_id.S == userId; // The user's side, the other player has the other one
		const invite = {
			game_id: game.game_id.S,
			name: (white ? game.black_name?.S : game.white_name?.S) || null,
			player_id: white ? game.black_player_id.S : game.white_player_id.S,
			player_color: white ? "w" : "b",
			start_params: JSON.parse(game.start_params?.S || '{ "color": "random" }') // "You play black (random)"
		};
		if (sent) { userData.sent_invite = invite; }
		else { userData.received_invites.push(invite); }
	}
	return userData;
}

/* ---------------------------------------------------------------- */
// Expire finished AI games (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Puts the 25 day expiry back on a player's finished AI games, before Delete my data drops the lists that find them.
 * Nobody else can see those games
 * @param  {[object]} userData [user item from retrieveUser]
 * @throws when a game can't be read or saved, before the row is gone so Delete my data can run again
 */
async function expireFinishedAiGames(userData) {
	// A list save that failed leaves a finished game in open_games
	const games = [...await pruneGameList(userData, "closed_games"), ...await pruneGameList(userData, "open_games")];
	const finishedAiGames = games.filter((game) => game.state?.S == "CLOSED" && isAiGame(game));
	for (const game of finishedAiGames) {
		try {
			await dbClient.connection.updateItem({
				TableName: dbClient.CHESS_TABLE,
				Key: { game_id: game.game_id },
				UpdateExpression: "SET expireAt = :expireAt",
				ConditionExpression: "attribute_exists(game_id)", // TTL deleted it since the read: don't make a new item
				ExpressionAttributeValues: { ":expireAt": { N: dbClient.expireTime() } }
			});
		} catch (err) {
			if (err.name != "ConditionalCheckFailedException") { throw err; }
		}
	}
}

/* ---------------------------------------------------------------- */
// Anonymize friend games (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Replaces a player's name in their finished friend games, before Delete my account drops the lists that find them.
 * Their opponents keep the game & its result
 * @param  {[object]} userData [user item from retrieveUser]
 * @throws when a game can't be read or saved, before the row is gone so Delete my account can run again
 */
async function anonymizeFriendGames(userData) {
	const userId = userData.user_id.S;
	// A list save that failed leaves a finished game in open_games
	const games = [...await pruneGameList(userData, "closed_games"), ...await pruneGameList(userData, "open_games")];
	for (const game of games) {
		if (isAiGame(game)) { continue; } // AI games have no names
		const nameField = game.white_player_id.S == userId ? "white_name" : "black_name";
		if (!game[nameField]) { continue; }
		try {
			await dbClient.connection.updateItem({
				TableName: dbClient.CHESS_TABLE,
				Key: { game_id: game.game_id },
				UpdateExpression: `SET ${nameField} = :name`,
				ConditionExpression: "attribute_exists(game_id)", // TTL deleted it since the read: don't make a new item
				ExpressionAttributeValues: { ":name": { S: DELETED_NAME } }
			});
		} catch (err) {
			if (err.name != "ConditionalCheckFailedException") { throw err; }
		}
	}
}

/**
 * @description Whether a game is against the AI
 * @param  {[object]} game [a game item]
 * @return {[boolean]} ai
 */
function isAiGame(game) {
	return game.white_player_id.S == "CHESS_AI" || game.black_player_id.S == "CHESS_AI";
}

/* ---------------------------------------------------------------- */
// Prune a game list
/* ---------------------------------------------------------------- */
/**
 * @description Checks every game in one of a user's lists still exists (TTL deletes expired games) & has the user in it, & saves the shorter list
 * @param  {[object]} userData [user item from retrieveUser, userData[listName].S is updated to the pruned list]
 * @param  {[string]} listName ["open_games", "requested_games" or "closed_games"]
 * @param  {[number]} newest [stop once this many games are found, reading from the newest: older ids aren't checked. Left out = the whole list]
 * @return {[array]} games [the found games in list order (newest last): game_id, player ids, names, state, result, level & start settings]
 * @throws when the games can't all be read (batchReadGames), a missed game would look expired
 */
async function pruneGameList(userData, listName, newest = Infinity) {
	const gameIds = [...new Set(JSON.parse(userData[listName].S))]; // A batch get fails on duplicate keys
	if (gameIds.length == 0) { return []; }

	const userId = userData.user_id.S;
	const pageSize = Math.min(newest, BATCH_GET_KEYS);
	const foundGames = new Map();
	let unread = gameIds.length;
	while (unread > 0 && foundGames.size < newest) {
		const page = gameIds.slice(Math.max(0, unread - pageSize), unread);
		for (const game of await batchReadGames(page, listName)) {
			if (isTheirGame(game, userId)) { foundGames.set(game.game_id.S, game); }
		}
		unread -= page.length;
	}

	const readIds = gameIds.slice(unread);
	// A batch get isn't in order, so the games are put back in list order
	const games = readIds.filter((gameId) => foundGames.has(gameId)).map((gameId) => foundGames.get(gameId)).slice(-newest);
	const goneIds = new Set(readIds.filter((gameId) => !foundGames.has(gameId))); // Every key was read, so a game that wasn't found expired
	if (goneIds.size == 0) { return games; } // Nothing expired or replaced

	const prunedGames = JSON.stringify(gameIds.filter((gameId) => !goneIds.has(gameId)));
	const params = {
		TableName: dbClient.USER_TABLE,
		Key: {
			user_id: { S: userData.user_id.S }
		},
		UpdateExpression: `SET ${listName} = :game_list`,
		ConditionExpression: `${listName} = :old_game_list`, // Skips the save if a game was added meanwhile, the next load prunes again
		ExpressionAttributeValues: {
			":game_list": { S: prunedGames },
			":old_game_list": { S: userData[listName].S }
		}
	}

	// Not updateOrConflict: a failed save is only logged, the list is pruned again next load
	try {
		await dbClient.connection.updateItem(params);
	} catch (err) {
		if (err.name != "ConditionalCheckFailedException") { console.log(`Game list save failed (${listName}): ${err.message}`); }
	}

	userData[listName].S = prunedGames;
	return games;
}

/**
 * @description Whether a game still has the user in it: a game that was replaced under their list isn't theirs
 * @param  {[object]} game [a game item]
 * @param  {[string]} userId [the list's owner]
 * @return {[boolean]} theirs
 */
function isTheirGame(game, userId) {
	return game.white_player_id?.S == userId || game.black_player_id?.S == userId;
}

/**
 * @description Reads up to 100 games in one batch get. Keys DynamoDB didn't read (UnprocessedKeys, when it's throttled) are asked for again
 * with backoff, so a game is never missed: a game left out would let a check that it's open pass (Delete my data, one friend game at a time)
 * @param  {[array]} gameIds [game ids, no duplicates]
 * @param  {[string]} listName [the list they're from, for the error]
 * @return {[array]} games [the games that exist, in any order]
 * @throws when some keys are still unread after BATCH_READ_TRIES, or the batch get fails (the route answers 500, the chess server 503)
 */
async function batchReadGames(gameIds, listName) {
	let keys = gameIds.map((gameId) => ({ game_id: { S: gameId } }));
	let games = [];
	for (let i = 0; i < dbClient.BATCH_READ_TRIES; i++) {
		if (i > 0) { await new Promise((resolve) => setTimeout(resolve, dbClient.BATCH_READ_DELAY * 2 ** (i - 1))); }
		const params = {
			RequestItems: {
				[dbClient.CHESS_TABLE]: {
					Keys: keys,
					// The game exists, who's in it, whether it's an AI game, how it started, how it ended, its opening, when the next move is due
					// (Your games, Finished games & invites) and whether it's a Chess Cards game (Home opens it as one)
					ProjectionExpression: "game_id, white_player_id, black_player_id, white_name, black_name, #state, #winner, #reason, ai_level, start_params, inviter_id, opening, move_deadline, #mode",
					// "mode" is a DynamoDB reserved word, like "state"
					ExpressionAttributeNames: { "#state": "state", "#winner": "winner", "#reason": "reason", "#mode": "mode" }
				}
			}
		};

		const response = await dbClient.connection.batchGetItem(params);
		games = games.concat(response.Responses?.[dbClient.CHESS_TABLE] || []);
		keys = response.UnprocessedKeys?.[dbClient.CHESS_TABLE]?.Keys || [];
		if (keys.length == 0) { return games; }
	}

	console.log(`Game list check throttled (${listName}): ${keys.length} games unread after ${dbClient.BATCH_READ_TRIES} tries`);
	throw new Error(`Game list check throttled (${listName})`);
}

module.exports = {
	pruneOpenGames,
	pruneClosedGames,
	pruneInvites,
	expireFinishedAiGames,
	anonymizeFriendGames
};
