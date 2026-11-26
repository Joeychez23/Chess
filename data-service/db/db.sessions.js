/*
 *  db.sessions.js  --  data service
 *	Chess Move Engine
 *  The session id (sid) on a player's row that every refresh token carries: start it at login, end it at logout
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");
const dbClient = require("./db.client.js");
const dbUsers = require("./db.users.js");

const SID_BYTES = 16; // Random bytes in a session id, 128 bits so it can't be guessed

/* ---------------------------------------------------------------- */
// Start session (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description The session id (sid) on a player's row, made at their first login. Every device they log in on shares it, & every refresh
 * token carries it, so clearing it (endSession, Delete my data) signs them out everywhere. A player's row is made here, at their first login
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @return {[object]} response [{ status, sid, message }]
 */
async function startSession(userId) {
	const user = await dbUsers.initializeUser(userId);
	if (user.user_data?.sid?.S) { return { status: 200, sid: user.user_data.sid.S, message: `user id: ${userId} session found` }; }

	const sid = crypto.randomBytes(SID_BYTES).toString("base64url");
	const params = {
		TableName: dbClient.USER_TABLE,
		Key: {
			user_id: { S: userId }
		},
		UpdateExpression: 'SET sid = :sid',
		// Never makes a row without its game lists, or replaces another login's sid
		ConditionExpression: 'attribute_exists(user_id) AND attribute_not_exists(sid)',
		ExpressionAttributeValues: {
			':sid': { S: sid }
		}
	}

	// Not updateOrConflict: a lost race reads the sid the other login saved
	try {
		await dbClient.connection.updateItem(params);
	} catch (err) {
		if (err.name != "ConditionalCheckFailedException") { throw err; }
		const again = await dbUsers.retrieveUser(userId, true); // Another login set it first, use that one
		if (!again.user_data?.sid?.S) { throw err; } // The row was deleted (Delete my data) in between
		return { status: 200, sid: again.user_data.sid.S, message: `user id: ${userId} session found` };
	}
	return { status: 200, sid, message: `user id: ${userId} session started` };
}

/* ---------------------------------------------------------------- */
// End session (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Clears a player's session id (logout), so every device's refresh token stops working. Only the session the request
 * belongs to is ended: an old refresh token from before the last logout doesn't end the session they logged in to since
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @param  {[string]} sid [the session id in the refresh token]
 * @return {[object]} response [{ status, message }, status 200 either way]
 */
async function endSession(userId, sid) {
	const params = {
		TableName: dbClient.USER_TABLE,
		Key: {
			user_id: { S: userId }
		},
		UpdateExpression: 'REMOVE sid',
		ConditionExpression: 'sid = :sid', // Still this session (and the row is still there)
		ExpressionAttributeValues: {
			':sid': { S: sid }
		}
	}

	// Not updateOrConflict: a session that already ended is fine, it answers 200
	try {
		await dbClient.connection.updateItem(params);
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return { status: 200, message: `user id: ${userId} session already ended` }; }
		throw err;
	}
	return { status: 200, message: `user id: ${userId} session ended` };
}

module.exports = {
	startSession,
	endSession
};
