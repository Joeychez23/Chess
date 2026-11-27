/*
 *  db.friends.js  --  data service
 *	Chess Move Engine
 *  Usernames (find one, search by prefix) and friends: the friend lists on each player's row, changed two rows at a time
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { usernameKey, searchFields } = require("../utils/username.js");
const { unlinkFriends } = require("../utils/friends.js");
const dbClient = require("./db.client.js");
const dbUsers = require("./db.users.js");

const USERNAME_INDEX = "username-search"; // username#<name> items by name in lowercase, matches terraform/modules/dynamodb
const SEARCH_RESULTS = 10; // Names one search shows

/* ---------------------------------------------------------------- */
// Find username (GET)
/* ---------------------------------------------------------------- */
/**
 * @description The player holding a username, ignoring capitals, from its username#<name> item (claimUsername). A friend invite by username
 * @param  {[string]} username [checked by checkUsername in utils/username.js]
 * @return {[object]} response [{ status: 200, player_id, username (as they wrote it), message } | { status: 404, message }]
 */
async function findUsername(username) {
	const response = await dbClient.connection.getItem({
		TableName: dbClient.USER_TABLE,
		Key: {
			user_id: { S: usernameKey(username) }
		},
		ConsistentRead: true // A name picked a moment ago can be invited
	});
	if (!response.Item) { return { status: 404, message: "Username not found" }; }
	return { status: 200, player_id: response.Item.owner_id.S, username: response.Item.username.S, message: "Username found" };
}

/* ---------------------------------------------------------------- */
// Search usernames (GET)
/* ---------------------------------------------------------------- */
/**
 * @description The usernames starting with a prefix, from the username-search index. The index only holds the names, never who owns them.
 * Index reads can lag a moment behind a save
 * @param  {[string]} prefix [in lowercase, from readSearchPrefix in utils/username.js]
 * @return {[object]} response [{ status: 200, usernames (as they wrote them, sorted, at most SEARCH_RESULTS), message }]
 */
async function searchUsernames(prefix) {
	const response = await dbClient.connection.query({
		TableName: dbClient.USER_TABLE,
		IndexName: USERNAME_INDEX,
		KeyConditionExpression: 'search_group = :search_group AND begins_with(search_name, :prefix)',
		ProjectionExpression: 'username',
		ExpressionAttributeValues: {
			":search_group": searchFields(prefix).search_group,
			":prefix": { S: prefix }
		},
		Limit: SEARCH_RESULTS
	});
	return { status: 200, usernames: (response.Items || []).map((item) => item.username.S), message: "Usernames found" };
}

/* ---------------------------------------------------------------- */
// Friends
/* ---------------------------------------------------------------- */
/**
 * @description Changes two players' friend lists together, all or nothing. When either row changed since the read,
 * they're read again & the change made again
 * @param  {[string]} userId [the requester]
 * @param  {[string]} otherId [the other player, never the requester]
 * @param  {[function]} change [(mine, theirs) => edits both { friends, sent, received }, or answers { status, message } to refuse.
 * It can run more than once]
 * @return {[object]} response [{ status: 200, message } | the refusal | { status: 404 } (a row is gone) | { status: 500 } (lost every try)]
 */
async function changeFriends(userId, otherId, change) {
	for (let i = 0; i < dbClient.LIST_SAVE_TRIES; i++) {
		const [user, other] = await Promise.all([dbUsers.retrieveUser(userId, true), dbUsers.retrieveUser(otherId, true)]);
		if (!user.user_data || !other.user_data) { return { status: 404, message: "Player not found" }; }
		const mine = readFriendLists(user.user_data);
		const theirs = readFriendLists(other.user_data);
		const refused = change(mine, theirs);
		if (refused) { return refused; }

		const transactItems = [saveFriendLists(user.user_data, mine), saveFriendLists(other.user_data, theirs)];
		try {
			await dbClient.connection.transactWriteItems({ TransactItems: transactItems }); // Both or neither
			return { status: 200, message: "Friends saved" };
		} catch (err) {
			if (err.name != "TransactionCanceledException") { throw err; }
		} // A row changed since the read: read them again
	}
	return { status: 500, message: `Friends save failed after ${dbClient.LIST_SAVE_TRIES} tries: ${userId}` };
}

/**
 * @description A row's friend_lists, a JSON string like its game lists. It's one attribute, so a save can check nothing in it changed.
 * Older rows have none
 * @param  {[object]} userData [user row, undefined = no row]
 * @return {[object]} lists [{ friends, sent, received }, arrays of player ids]
 */
function readFriendLists(userData) {
	return userData?.friend_lists ? JSON.parse(userData.friend_lists.S) : { friends: [], sent: [], received: [] };
}

/**
 * @description The transaction item that saves a row's friend lists, only if they haven't changed since the read & the row is still there
 * @param  {[object]} userData [user row as read]
 * @param  {[object]} lists [the { friends, sent, received } to save]
 * @return {[object]} item [a transaction Update]
 */
function saveFriendLists(userData, lists) {
	const old = userData.friend_lists?.S;
	return {
		Update: {
			TableName: dbClient.USER_TABLE,
			Key: {
				user_id: userData.user_id
			},
			UpdateExpression: 'SET friend_lists = :lists',
			ConditionExpression: old ? 'friend_lists = :old_lists' : 'attribute_exists(user_id) AND attribute_not_exists(friend_lists)',
			ExpressionAttributeValues: {
				":lists": { S: JSON.stringify(lists) },
				...(old ? { ":old_lists": { S: old } } : {})
			}
		}
	};
}

/**
 * @description A player's friends & requests with each one's current username (a rename shows straight away). A row that's gone isn't listed
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @return {[object]} response [{ status: 200, friends, sent, received, message },
 * each list [{ player_id, username }] sorted by name, ignoring capitals]
 */
async function retrieveFriends(userId) {
	const user = await dbUsers.retrieveUser(userId, true); // Consistent: Home reads it right after a save
	const lists = readFriendLists(user.user_data);
	const names = await batchReadUsernames([...new Set([...lists.friends, ...lists.sent, ...lists.received])]);
	return {
		status: 200,
		friends: namedPlayers(lists.friends, names),
		sent: namedPlayers(lists.sent, names),
		received: namedPlayers(lists.received, names),
		message: `Retrieved friends: ${userId}`
	};
}

/**
 * @description Reads players' usernames in one batch get (utils/friends.js keeps a row to 100 ids). Keys DynamoDB didn't read are asked for again
 * with backoff, so a friend is never left off the list
 * @param  {[array]} userIds [player ids, no duplicates]
 * @return {[object]} names [Map: player id -> username, players with a row & a username]
 * @throws when some keys are still unread after BATCH_READ_TRIES (the route answers 500, the chess server 503)
 */
async function batchReadUsernames(userIds) {
	const names = new Map();
	let keys = userIds.map((userId) => ({ user_id: { S: userId } }));
	for (let i = 0; i < dbClient.BATCH_READ_TRIES && keys.length; i++) {
		if (i > 0) { await new Promise((resolve) => setTimeout(resolve, dbClient.BATCH_READ_DELAY * 2 ** (i - 1))); }
		const params = { RequestItems: { [dbClient.USER_TABLE]: { Keys: keys, ProjectionExpression: "user_id, username" } } };
		const response = await dbClient.connection.batchGetItem(params);
		for (const item of response.Responses?.[dbClient.USER_TABLE] || []) {
			if (item.username) { names.set(item.user_id.S, item.username.S); }
		}
		keys = response.UnprocessedKeys?.[dbClient.USER_TABLE]?.Keys || [];
	}
	if (keys.length) { throw new Error(`Friend names throttled: ${keys.length} unread after ${dbClient.BATCH_READ_TRIES} tries`); }
	return names;
}

/**
 * @description Players with their usernames, sorted by name ignoring capitals. A player without a name (their row is gone) is left out
 * @param  {[array]} playerIds [player ids]
 * @param  {[object]} names [batchReadUsernames' Map]
 * @return {[array]} players [{ player_id, username }]
 */
function namedPlayers(playerIds, names) {
	const players = playerIds.filter((id) => names.has(id)).map((id) => ({ player_id: id, username: names.get(id) }));
	return players.sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));
}

/**
 * @description Takes a player off everyone's friend lists & requests (Delete my data), so they don't come back as a friend when they next sign in
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @return {[object]} response [{ status: 200, friend_ids (who to tell) } |
 * { status: 500, message } (a save lost every try: try again, nothing's deleted)]
 */
async function leaveFriends(userId) {
	const lists = readFriendLists((await dbUsers.retrieveUser(userId, true)).user_data);
	const friendIds = [...new Set([...lists.friends, ...lists.sent, ...lists.received])];
	for (const friendId of friendIds) {
		const response = await changeFriends(userId, friendId, (mine, theirs) => unlinkFriends(mine, theirs, userId, friendId));
		if (response.status == 500) { return response; } // A 404 means their row is gone too, nothing to take them off
	}
	return { status: 200, friend_ids: friendIds };
}

module.exports = {
	findUsername,
	searchUsernames,
	changeFriends,
	retrieveFriends,
	leaveFriends
};
