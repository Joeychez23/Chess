/*
 *  userController.js  --  data service
 *	User Routes
 *  A signed in player's own user_db row: reading it (with their games), their Default start settings, their username & Delete my data.
 *  Every route is on the requester's row only, the player id comes from their token (middleware/player.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { retrieveUser, pruneOpenGames, pruneInvites, updateUserSettings, claimUsername, deleteUser } = require("../dynamoDB.js");
const { checkUsername } = require("../utils/username.js");
const { readAiLevel, isColor } = require("../utils/games.js");
const { currentGame } = require("./gameController.js");
const { refuse } = require("../utils/refuse.js");

/* ---------------------------------------------------------------- */
// Get User (GET)
/* ---------------------------------------------------------------- */
/**
 * @description The requester's row as stored. With games, expired games & invites are pruned first & the open games are added (what Home lists)
 * @param  {[string]} req.query.consistent ["true" = a strongly consistent read, right after a save]
 * @param  {[string]} req.query.games ["true" = also ai_game_id, friend_game_id, open_game_list, sent_invite & received_invites (pruneOpenGames, pruneInvites)]
 * @return {[object]} response [retrieveUser's { status, user_data, message }, "User data not found" ({ status: 500 }) for a player with no row yet]
 */
async function getMe(req, res) {
	const response = await retrieveUser(req.player.id, req.query.consistent == "true");
	if (response.user_data && req.query.games == "true") { response.user_data = await pruneInvites(await pruneOpenGames(response.user_data)); }
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
// Delete My Data (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Deletes the requester's row & frees their username. Only once they've left every game: the chess server forfeits their open games,
 * cancels their sent invite & declines the ones they got first (through the game routes), so no game is left waiting on a row that's gone
 * @return {[object]} response [deleteUser's { status, message }]
 */
async function deleteMe(req, res) {
	const playerId = req.player.id;
	if ((await currentGame(playerId, true)) || (await currentGame(playerId, false))) { return refuse(req, res, 409, "Leave your open games first"); }
	const user = await retrieveUser(playerId, true);
	if (user.user_data) {
		const invites = await pruneInvites(user.user_data);
		if (invites.sent_invite || invites.received_invites.length) { return refuse(req, res, 409, "Answer your invites first"); }
	}
	return res.json(await deleteUser(playerId));
}


module.exports = { getMe, saveSettings, saveUsername, deleteMe };
