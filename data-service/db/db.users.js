/*
 *  db.users.js  --  data service
 *	Chess Move Engine
 *  Players' rows in user_db: create, read, the game lists, ratings, settings, the last color, the username, and delete
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { readRating } = require("../utils/rating.js");
const { usernameKey, searchFields } = require("../utils/username.js");
const dbClient = require("./db.client.js");

const GAME_LISTS = ["requested_games", "open_games", "closed_games"]; // A user_db row's game lists (JSON strings)

/* ---------------------------------------------------------------- */
// Initialize user (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Creates a user row with empty game lists, unless another request already made it
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @return {[object]} response [{ status, user_data (the new row, or the one already there), message }]
 */
async function initializeUser(userId) {
	const params = {
		TableName: dbClient.USER_TABLE,
		Item: {
			user_id: { S: userId },
			open_games: { S: JSON.stringify([]) },
			requested_games: { S: JSON.stringify([]) },
			closed_games: { S: JSON.stringify([]) },
		},
		ConditionExpression: 'attribute_not_exists(user_id)' // Never wipes a row's game lists (a read can miss a row that was just made)
	}

	try {
		await dbClient.connection.putItem(params);
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return await retrieveUser(userId, true); } // Already there, use it
		throw err;
	}

	return {
		status: 200,
		user_data: params.Item,
		message: `user id: ${userId} initalized inside db`
	}
}

/* ---------------------------------------------------------------- */
// Retrieve user (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Gets a user row by id, the game lists stay JSON strings
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @param  {[boolean]} consistent [true = a strongly consistent read (twice the read capacity), see retrieveGame]
 * @return {[object]} response [{ status, user_data, message }]
 */
async function retrieveUser(userId, consistent) {
	const params = {
		TableName: dbClient.USER_TABLE,
		Key: {
			user_id: { S: userId }
		},
		ConsistentRead: !!consistent
	}

	let response = await dbClient.connection.getItem(params);

	if (response.Item) {
		return {
			status: 200,
			user_data: response.Item,
			message: `Retrieved user id: ${response.Item.user_id.S}`
		}
	} else {
		return {
			status: 500,
			message: "User data not found"
		}
	}
}

/* ---------------------------------------------------------------- */
// Retrieve ratings (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Gets players' ratings, for the game menu (GET /api/chess/game/:gameId/ratings)
 * @param  {[array]} userIds [auth0 user ids without "auth0|"]
 * @return {[object]} ratings [{ userId: { rating, rated_games } }, players without a row get the starting rating]
 */
async function retrieveRatings(userIds) {
	const ids = [...new Set(userIds)];
	const params = {
		RequestItems: {
			[dbClient.USER_TABLE]: {
				Keys: ids.map((userId) => ({ user_id: { S: userId } })),
				ProjectionExpression: "user_id, rating, rated_games"
			}
		}
	};
	const response = await dbClient.connection.batchGetItem(params);
	const items = response.Responses?.[dbClient.USER_TABLE] || [];
	let ratings = {};
	for (const id of ids) { ratings[id] = readRating(items.find((item) => item.user_id.S == id)); }
	return ratings;
}

/* ---------------------------------------------------------------- */
// Update user (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Saves the game lists that changed, only if none of the lists changed since they were read
 * @param  {[object]} userData [user row from retrieveUser, its game lists are the JSON strings that were read]
 * @param  {[object]} gameLists [{ requested_games, open_games, closed_games } arrays to save]
 * @return {[object]} response [{ status, user_data, message }, status 500 when another request changed the lists first]
 */
async function updateUser(userData, gameLists) {
	const userId = userData.user_id.S;
	const changed = GAME_LISTS.filter((listName) => JSON.stringify(gameLists[listName]) != userData[listName].S);
	if (changed.length == 0) { return { status: 200, user_data: userData, message: `user id: ${userId} unchanged` }; } // Nothing to save

	const params = {
		TableName: dbClient.USER_TABLE,
		Key: {
			user_id: { S: userId }
		},
		UpdateExpression: `SET ${changed.map((listName) => `${listName} = :${listName}`).join(", ")}`,
		// Every list, an unchanged one can be stale too (a move that didn't find the game)
		ConditionExpression: GAME_LISTS.map((listName) => `${listName} = :old_${listName}`).join(" AND "),
		ExpressionAttributeValues: {},
		ReturnValues: "ALL_NEW" // The row as saved, no read back
	}
	for (const listName of changed) { params.ExpressionAttributeValues[`:${listName}`] = { S: JSON.stringify(gameLists[listName]) }; }
	for (const listName of GAME_LISTS) { params.ExpressionAttributeValues[`:old_${listName}`] = { S: userData[listName].S }; }

	// Not updateOrConflict: a TransactionConflictException is a conflict here too. A rating or username transaction is on
	// this row right now, and the SDK doesn't retry it
	let response;
	try {
		response = await dbClient.connection.updateItem(params);
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException" || err.name == "TransactionConflictException") {
			return { status: 500, message: `Game lists changed before the save: ${userId}` };
		}
		throw err;
	}

	return {
		status: 200,
		user_data: response.Attributes,
		message: `user id: ${userId} updated`
	}
}

/**
 * @description Changes a user's game lists without losing a change another request makes at the same time (an AI game ends
 * while an invite is accepted): when updateUser finds the lists changed since they were read, the row is read again & the change made again
 * @param  {[string]} userId [auth0 user id without "auth0|", the row is made if there isn't one]
 * @param  {[function]} change [(gameLists) => edits the { requested_games, open_games, closed_games } arrays, it can run more than once]
 * @return {[object]} response [{ status, user_data, message }]
 */
async function changeUserGames(userId, change) {
	for (let i = 0; i < dbClient.LIST_SAVE_TRIES; i++) {
		// Consistent: a read that lags can miss the game, and a change that finds nothing to move saves nothing
		let response = await retrieveUser(userId, true);
		if (!response.user_data) { response = await initializeUser(userId); }
		if (!response.user_data) { return response; }

		const gameLists = {};
		for (const listName of GAME_LISTS) { gameLists[listName] = JSON.parse(response.user_data[listName].S); }
		change(gameLists);

		response = await updateUser(response.user_data, gameLists);
		if (response.status == 200) { return response; }
	}

	console.log(`Game list save failed after ${dbClient.LIST_SAVE_TRIES} tries: ${userId}`);
	return { status: 500, message: `User attributes failed to update: ${userId}` };
}

/* ---------------------------------------------------------------- */
// Last color (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Saves the side a player just started a game on, the Alternate color's next game is the opposite. AI & friend games alternate apart.
 * Its own attribute, so the game list saves never touch it. A failed save only repeats a color, the game has started so it's logged & not thrown
 * @param  {[string]} userId [auth0 user id without "auth0|", their row is there: the game was just added to their lists]
 * @param  {[boolean]} ai [true = their AI games, false = their friend games]
 * @param  {[string]} color ["w" or "b"]
 */
async function saveLastColor(userId, ai, color) {
	const params = {
		TableName: dbClient.USER_TABLE,
		Key: {
			user_id: { S: userId }
		},
		UpdateExpression: `SET ${ai ? "last_ai_color" : "last_friend_color"} = :color`,
		ConditionExpression: 'attribute_exists(user_id)', // Never makes a row without its game lists
		ExpressionAttributeValues: {
			':color': { S: color }
		}
	}
	try {
		await dbClient.connection.updateItem(params);
	} catch (err) {
		console.log(`Last color not saved: ${userId}: ${err.message}`);
	}
}

/* ---------------------------------------------------------------- */
// Update user settings (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Saves a player's settings (the settings page) on their user_db row, merged over the stored ones so saving one box never wipes another.
 * It's its own attribute, so the game list saves never touch it. A player without a row (Delete my data since their last login) gets one from
 * initializeUser first, so the game lists are there too
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @param  {[object]} settings [the fields to change: any of { ai_level, ai_color, friend_color, status_display }, checked in userController.js]
 * @return {[object]} response [{ status, user_data (the row as saved), message }]
 */
async function updateUserSettings(userId, settings) {
	const user = await retrieveUser(userId, true);
	if (!user.user_data) { await initializeUser(userId); }
	// shortcut: read then write, two saves at the same instant can lose one's fields; add a condition on the read settings if that ever matters
	settings = { ...storedSettings(user.user_data?.settings?.S), ...settings };

	const params = {
		TableName: dbClient.USER_TABLE,
		Key: {
			user_id: { S: userId }
		},
		UpdateExpression: 'SET settings = :settings',
		ConditionExpression: 'attribute_exists(user_id)', // Never makes a row without its game lists
		ExpressionAttributeValues: {
			':settings': { S: JSON.stringify(settings) }
		},
		ReturnValues: "ALL_NEW"
	}
	const response = await dbClient.connection.updateItem(params);

	return {
		status: 200,
		user_data: response.Attributes,
		message: `user id: ${userId} settings saved`
	}
}

/**
 * @description A row's stored settings as an object, {} when there are none or they're not a JSON object
 * @param  {[string]} json [the settings attribute's string]
 * @return {[object]} settings
 */
function storedSettings(json) {
	try {
		const settings = JSON.parse(json);
		return settings && typeof settings == "object" && !Array.isArray(settings) ? settings : {};
	} catch { return {}; }
}

/* ---------------------------------------------------------------- */
// Claim username (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Saves a player's username (the settings page) in one transaction, so it's all or nothing: the username#<name> item is made
 * only if nobody has it, the player's row gets the name, & the name they had before is freed. "joe" -> "Joe" keeps the same item.
 * A player without a row (Delete my data since their last login) gets one from initializeUser first
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @param  {[string]} username [checked by checkUsername in utils/username.js]
 * @return {[object]} response [{ status, username, message }, status 409 when another player has it]
 */
async function claimUsername(userId, username) {
	const claimKey = usernameKey(username);
	for (let i = 0; i < dbClient.LIST_SAVE_TRIES; i++) {
		let user = await retrieveUser(userId, true);
		if (!user.user_data) { user = await initializeUser(userId); }
		if (!user.user_data) { return user; }
		const oldUsername = user.user_data.username?.S || null;
		if (oldUsername == username) { return { status: 200, username, message: `user id: ${userId} username unchanged` }; }
		const sameName = oldUsername && usernameKey(oldUsername) == claimKey; // Only the capitals changed, the player already holds it

		let transactItems = [claimNameItem(userId, username, claimKey, sameName), saveNameItem(userId, username, oldUsername)];
		if (oldUsername && !sameName) { transactItems.push(freeNameItem(userId, oldUsername)); }

		try {
			await dbClient.connection.transactWriteItems({ TransactItems: transactItems }); // All or none
			return { status: 200, username, message: `user id: ${userId} username saved` };
		} catch (err) {
			if (err.name != "TransactionCanceledException") { throw err; }
			const reasons = (err.CancellationReasons || []).map((reason) => reason.Code);
			// The claim failed but the row hasn't changed, so someone else holds the name
			if (!sameName && reasons[0] == "ConditionalCheckFailed" && reasons[1] != "ConditionalCheckFailed") {
				return { status: 409, message: "That username is taken" };
			}
		} // Otherwise the row changed since the read: read it again
	}
	return { status: 500, message: `Username save failed after ${dbClient.LIST_SAVE_TRIES} tries: ${userId}` };
}

/**
 * @description The transaction item that claims the username#<name> item: made only if nobody has it, or, when only the capitals
 * changed, the player's own item updated to the new spelling
 * @param  {[string]} userId [the player claiming it]
 * @param  {[string]} username [as they wrote it]
 * @param  {[string]} claimKey [usernameKey(username)]
 * @param  {[boolean]} sameName [true when they already hold it]
 * @return {[object]} item [a transaction Update or Put]
 */
function claimNameItem(userId, username, claimKey, sameName) {
	if (sameName) {
		return {
			Update: {
				TableName: dbClient.USER_TABLE,
				Key: {
					user_id: { S: claimKey }
				},
				UpdateExpression: 'SET username = :username, search_group = :search_group, search_name = :search_name',
				ConditionExpression: 'owner_id = :owner_id',
				ExpressionAttributeValues: {
					":username": { S: username },
					":owner_id": { S: userId },
					":search_group": searchFields(username).search_group,
					":search_name": searchFields(username).search_name
				}
			}
		};
	}
	return {
		Put: {
			TableName: dbClient.USER_TABLE,
			Item: {
				user_id: { S: claimKey },
				owner_id: { S: userId }, // Who holds it
				username: { S: username }, // As they wrote it
				...searchFields(username) // Findable by searchUsernames
			},
			ConditionExpression: 'attribute_not_exists(user_id)' // Nobody has it
		}
	};
}

/**
 * @description The transaction item that saves the name on the player's row, only if they weren't renamed since the read (two saves at once)
 * @param  {[string]} userId [the player]
 * @param  {[string]} username [the new name]
 * @param  {[string]} oldUsername [the name that was read, null when they had none]
 * @return {[object]} item [a transaction Update]
 */
function saveNameItem(userId, username, oldUsername) {
	const saveName = {
		Update: {
			TableName: dbClient.USER_TABLE,
			Key: {
				user_id: { S: userId }
			},
			UpdateExpression: 'SET username = :username',
			ConditionExpression: oldUsername ? 'username = :old_username' : 'attribute_exists(user_id) AND attribute_not_exists(username)',
			ExpressionAttributeValues: {
				":username": { S: username }
			}
		}
	}
	if (oldUsername) { saveName.Update.ExpressionAttributeValues[":old_username"] = { S: oldUsername }; }
	return saveName;
}

/**
 * @description The transaction item that frees the name a player had before, only while it's still theirs
 * @param  {[string]} userId [the player]
 * @param  {[string]} oldUsername [the name they had]
 * @return {[object]} item [a transaction Delete]
 */
function freeNameItem(userId, oldUsername) {
	return {
		Delete: {
			TableName: dbClient.USER_TABLE,
			Key: {
				user_id: { S: usernameKey(oldUsername) }
			},
			ConditionExpression: 'owner_id = :owner_id',
			ExpressionAttributeValues: {
				":owner_id": { S: userId }
			}
		}
	};
}

/* ---------------------------------------------------------------- */
// Delete user (DELETE)
/* ---------------------------------------------------------------- */
/**
 * @description Deletes a player's user_db row, their game lists, settings & rating (Delete my data, after leaveAllGames), & frees their username.
 * The friend games stay in chess_db: a friend's finished games still show the result, with their name replaced (anonymizeFriendGames,
 * their AI games expire, expireFinishedAiGames)
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @return {[object]} response [{ status, message }]
 */
async function deleteUser(userId) {
	for (let i = 0; i < dbClient.LIST_SAVE_TRIES; i++) {
		const user = await retrieveUser(userId, true);
		const username = user.user_data?.username?.S;
		try {
			if (!username) {
				const params = {
					TableName: dbClient.USER_TABLE,
					Key: {
						user_id: { S: userId }
					},
					ConditionExpression: 'attribute_not_exists(username)' // No name was saved since the read
				}
				await dbClient.connection.deleteItem(params);
			} else {
				const transactItems = [
					{
						Delete: {
							TableName: dbClient.USER_TABLE,
							Key: { user_id: { S: userId } },
							ConditionExpression: 'username = :username',
							ExpressionAttributeValues: { ":username": { S: username } }
						}
					},
					{
						Delete: { // Frees the name
							TableName: dbClient.USER_TABLE,
							Key: { user_id: { S: usernameKey(username) } },
							ConditionExpression: 'owner_id = :owner_id',
							ExpressionAttributeValues: { ":owner_id": { S: userId } }
						}
					}
				];
				await dbClient.connection.transactWriteItems({ TransactItems: transactItems }); // Both or neither
			}
			return { status: 200, message: `user id: ${userId} deleted` };
		} catch (err) {
			if (err.name != "ConditionalCheckFailedException" && err.name != "TransactionCanceledException") { throw err; }
		} // Renamed since the read: read it again
	}
	return { status: 500, message: `User delete failed after ${dbClient.LIST_SAVE_TRIES} tries: ${userId}` };
}

module.exports = {
	initializeUser,
	retrieveUser,
	retrieveRatings,
	updateUser,
	changeUserGames,
	saveLastColor,
	updateUserSettings,
	claimUsername,
	deleteUser
};
