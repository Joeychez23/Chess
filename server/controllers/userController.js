/*
 *  userController.js  --  chess server
 *	User Routes
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { retrieveUser, updateUserSettings, claimUsername, searchUsernames, retrieveFriends, changeFriend, deleteUser } = require("../dataClient.js");
const { leaveAllGames, readSettings, userPlayerId } = require("./chessController.js");
const { checkUsername, readSearchPrefix } = require("../utils/username.js");
const { disconnectPlayer, emitToPlayer, isOnline } = require("../socket.js");

/* ---------------------------------------------------------------- */
// Get User
/* ---------------------------------------------------------------- */
/**
 * @description Returns the signed-in user from the access token (requireAuth runs first), same response shape the client has always read,
 * & their username from their user_db row (it can change, so it isn't in the token)
 * @return {[object]} response [{ status, userData, username (null until they pick one on the settings page), message }]
 */
async function getUser(req, res) {
	const user = await retrieveUser(true).catch(() => null); // THE REQUESTER'S ROW, CONSISTENT: THE SETTINGS PAGE READS IT RIGHT AFTER A SAVE. A FAILED READ STILL RETURNS THE USER
	return res.json({ status: 200, userData: req.user, username: user?.user_data?.username?.S || null, message: "USER DATA FOUND" });
}

/* ---------------------------------------------------------------- */
// Save Settings (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description The settings page's Default start settings, Home's dropdowns start on them (GET /api/chess/user/:userId returns them)
 * @param  {[object]} req.body [{ ai_level, ai_color, friend_color }, anything that isn't a level or a color gets the default]
 * @return {[object]} response [{ status, settings (as saved), message }]
 */
async function saveSettings(req, res) {
	const settings = readSettings(req.body);
	const response = await updateUserSettings(settings); // THE REQUESTER'S ROW
	return res.json({ status: response.status, settings, message: response.message });
}

/* ---------------------------------------------------------------- */
// Save Username (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description The settings page's Username, the name friends see on invites & games. Home sends a player who has none to the settings page first
 * @param  {[object]} req.body [{ username }, 3 - 20 letters, numbers, _ or -, unique ignoring case (utils/username.js)]
 * @return {[object]} response [{ status, username (as saved), message } | { status: 400, message } (can't be used) | { status: 409, message } (taken)]
 */
async function saveUsername(req, res) {
	const checked = checkUsername(req.body?.username);
	if (checked.message) { return res.status(400).json({ status: 400, message: checked.message }); }
	const response = await claimUsername(checked.username); // THE DATA SERVICE CHECKS THE RULES AGAIN
	return res.status(response.status).json(response);
}

/* ---------------------------------------------------------------- */
// Search Players (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Home's player search as you type: the usernames starting with what was typed, ignoring capitals. Names only, never an email or Auth0 id
 * @param  {[string]} req.query.q [at least 2 characters a username can have, anything else finds nobody]
 * @return {[object]} response [{ status: 200, usernames (at most 10, sorted) }]
 */
async function searchPlayers(req, res) {
	const prefix = readSearchPrefix(req.query.q);
	if (!prefix) { return res.json({ status: 200, usernames: [] }); }
	const response = await searchUsernames(prefix);
	return res.status(response.status).json({ status: response.status, usernames: response.usernames || [] });
}

/* ---------------------------------------------------------------- */
// Friends (#40)
/* ---------------------------------------------------------------- */
/**
 * @description Home's Friends box. Names only, never an email or Auth0 id. online is read when this is asked: a socket open on Home or in a friend game
 * @return {[object]} response [{ status: 200, friends: [{ username, online }], sent: [{ username }], received: [{ username }] }]
 */
async function getFriends(req, res) {
	const response = await retrieveFriends();
	if (response.status != 200) { return res.status(response.status).json({ status: response.status, message: response.message }); }
	const names = (players) => players.map(({ username }) => ({ username }));
	return res.json({
		status: 200,
		friends: response.friends.map(({ player_id, username }) => ({ username, online: isOnline(player_id) })),
		sent: names(response.sent),
		received: names(response.received)
	});
}

/**
 * @description One friend action on the player holding a username, then both players' tabs redraw (socket "friends")
 * @param  {[string]} action ["request", "accept", "decline", "cancel" or "remove"]
 * @return {[function]} route [req.body: { username }, answers { status, message }]
 */
function friendAction(action) {
	return async function (req, res) {
		const response = await changeFriend(action, req.body?.username);
		if (response.status == 200) {
			emitToPlayer(userPlayerId(req.user), "friends", {});
			emitToPlayer(response.player_id, "friends", {});
		}
		return res.status(response.status).json({ status: response.status, message: response.message });
	};
}

/* ---------------------------------------------------------------- */
// Delete User Data (DELETE)
/* ---------------------------------------------------------------- */
/**
 * @description Delete my data (the settings page): leaves every game (forfeits, cancels & declines), then takes the player off everyone's friend lists,
 * deletes their user_db row & frees their username. The Auth0 login isn't deleted, the client logs out after this
 * @return {[object]} response [{ status, message }]
 */
async function deleteUserData(req, res) {
	const playerId = userPlayerId(req.user);
	await leaveAllGames(playerId);
	const response = await deleteUser(); // THE DATA SERVICE REFUSES IT WHILE A GAME OR INVITE IS LEFT
	for (const friendId of response.friend_ids || []) { emitToPlayer(friendId, "friends", {}); }
	if (response.status == 200) { disconnectPlayer(playerId); } // THEIR SESSION IS OVER, THEIR OPEN SOCKETS ON EVERY DEVICE ARE CLOSED (#298)
	return res.json({ status: response.status, message: response.message });
}


module.exports = { getUser, saveSettings, saveUsername, deleteUserData, searchPlayers, getFriends, friendAction };
