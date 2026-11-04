/*
 *  userController.js  --  data service
 *	User Routes
 *  A signed in player's own user_db row: reading it (with their games), their Default start settings, their username, their friends & Delete my data.
 *  Every route is on the requester's row only, the player id comes from their token (middleware/player.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { retrieveUser, pruneOpenGames, pruneClosedGames, expireFinishedAiGames, anonymizeFriendGames, pruneInvites, updateUserSettings, claimUsername, findUsername, searchUsernames, deleteUser, changeFriends, retrieveFriends, leaveFriends } = require("../dynamoDB.js");
const { checkUsername, readSearchPrefix } = require("../utils/username.js");
const { readAiLevel, isColor } = require("../utils/games.js");
const { currentGame } = require("./gameController.js");
const { refuse } = require("../utils/refuse.js");
const { FRIEND_ACTIONS } = require("../utils/friends.js");

/* ---------------------------------------------------------------- */
// Get User (GET)
/* ---------------------------------------------------------------- */
/**
 * @description The requester's row as stored. With games, expired games & invites are pruned first & the open games are added (what Home lists)
 * @param  {[string]} req.query.consistent ["true" = a strongly consistent read, right after a save]
 * @param  {[string]} req.query.games ["true" = also ai_game_id, friend_game_id, open_game_list, closed_game_list, sent_invite & received_invites (pruneOpenGames, pruneClosedGames, pruneInvites)]
 * @return {[object]} response [retrieveUser's { status, user_data, message }, "User data not found" ({ status: 500 }) for a player with no row yet]
 */
async function getMe(req, res) {
	const response = await retrieveUser(req.player.id, req.query.consistent == "true");
	if (response.user_data && req.query.games == "true") { response.user_data = await pruneInvites(await pruneClosedGames(await pruneOpenGames(response.user_data))); }
	return res.json(withoutSession(response));
}

/* ---------------------------------------------------------------- */
// Save Settings (POST)
/* ---------------------------------------------------------------- */
/**
 * @description The requester's Default start settings (the settings page). All three must be real values, the chess server defaults bad ones before this
 * @param  {[object]} req.body [{ ai_level (1 - 8), ai_color, friend_color ("w" | "b" | "random") }]
 * @return {[object]} response [updateUserSettings' { status, user_data, message }]
 */
async function saveSettings(req, res) {
	const { ai_level, ai_color, friend_color } = req.body || {};
	if (ai_level === undefined || !readAiLevel(ai_level) || !isColor(ai_color) || !isColor(friend_color)) { return refuse(req, res, 400, "Invalid settings"); }
	return res.json(withoutSession(await updateUserSettings(req.player.id, { ai_level, ai_color, friend_color })));
}

/**
 * @description A row as it's answered: without its session id, which stays in this service (controllers/sessionController.js)
 * @param  {[object]} response [{ status, user_data, message }]
 * @return {[object]} response [the same, user_data.sid removed]
 */
function withoutSession(response) {
	if (response.user_data) { delete response.user_data.sid; }
	return response;
}

/* ---------------------------------------------------------------- */
// Save Username (POST)
/* ---------------------------------------------------------------- */
/**
 * @description The requester's username, unique ignoring capitals (claimUsername). The rules are checked again (utils/username.js)
 * @param  {[object]} req.body [{ username }]
 * @return {[object]} response [claimUsername's { status, username, message }, { status: 409 } when someone else has it]
 */
async function saveUsername(req, res) {
	const checked = checkUsername(req.body?.username);
	if (checked.message) { return refuse(req, res, 400, checked.message); }
	return res.json(await claimUsername(req.player.id, checked.username));
}

/* ---------------------------------------------------------------- */
// Find Username (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Who holds a username, ignoring capitals. The chess server's invite by username (a name that breaks the rules can't be held)
 * @param  {[string]} req.params.username [the name as typed]
 * @return {[object]} response [findUsername's { status: 200, player_id, username, message } | { status: 404, message }]
 */
async function findByUsername(req, res) {
	const checked = checkUsername(req.params.username);
	if (!checked.username) { return res.json({ status: 404, message: "Username not found" }); }
	return res.json(await findUsername(checked.username));
}

/* ---------------------------------------------------------------- */
// Search Usernames (GET)
/* ---------------------------------------------------------------- */
/**
 * @description The usernames starting with what was typed, ignoring capitals. Names only, never who holds them
 * @param  {[string]} req.query.prefix [the start of a name, nothing is found for one no name could start with]
 * @return {[object]} response [{ status: 200, usernames, message }]
 */
async function searchByUsername(req, res) {
	const prefix = readSearchPrefix(req.query.prefix);
	if (!prefix) { return res.json({ status: 200, usernames: [], message: "Nothing to search for" }); }
	return res.json(await searchUsernames(prefix));
}

/* ---------------------------------------------------------------- */
// Friends (#40)
/* ---------------------------------------------------------------- */
/**
 * @description The requester's friends & friend requests
 * @return {[object]} response [retrieveFriends' { status: 200, friends, sent, received, message }, each list [{ player_id, username }]]
 */
async function getFriends(req, res) {
	return res.json(await retrieveFriends(req.player.id));
}

/**
 * @description One friend action on the player holding a username, saved on both rows (changeFriends)
 * @param  {[string]} action ["request", "accept", "decline", "cancel" or "remove", utils/friends.js]
 * @return {[function]} route [req.body: { username }, answers { status, player_id (the chess server tells them), message } | { status: 400 | 404 | 409, message }]
 */
function friendAction(action) {
	return async function (req, res) {
		const checked = checkUsername(req.body?.username);
		const found = checked.username ? await findUsername(checked.username) : null;
		if (!found?.player_id) { return res.json({ status: 404, message: "No player has that username" }); }
		const me = req.player.id;
		const them = found.player_id;
		if (them == me) { return res.json({ status: 400, message: "That's your username" }); }
		return res.json({ ...(await changeFriends(me, them, (mine, theirs) => FRIEND_ACTIONS[action](mine, theirs, me, them))), player_id: them });
	};
}

/* ---------------------------------------------------------------- */
// Delete My Data (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Deletes the requester's row & frees their username. Only once they've left every game: the chess server forfeits their open games,
 * cancels their sent invite & declines the ones they got first (through the game routes), so no game is left waiting on a row that's gone.
 * They're taken off everyone's friend lists here
 * @return {[object]} response [deleteUser's { status, message } & friend_ids (the players to tell)]
 */
async function deleteMe(req, res) {
	const playerId = req.player.id;
	if ((await currentGame(playerId, true)) || (await currentGame(playerId, false))) { return refuse(req, res, 409, "Leave your open games first"); }
	const user = await retrieveUser(playerId, true);
	if (user.user_data) {
		const invites = await pruneInvites(user.user_data);
		if (invites.sent_invite || invites.received_invites.length) { return refuse(req, res, 409, "Answer your invites first"); }
	}
	const left = await leaveFriends(playerId);
	if (left.status != 200) { return res.json(left); }
	if (user.user_data) { // THE LISTS THAT FIND THEM GO WITH THE ROW
		await expireFinishedAiGames(user.user_data);
		await anonymizeFriendGames(user.user_data);
	}
	return res.json({ ...(await deleteUser(playerId)), friend_ids: left.friend_ids });
}


module.exports = { getMe, saveSettings, saveUsername, findByUsername, searchByUsername, getFriends, friendAction, deleteMe };
