/*
 *  userController.js  --  chess server
 *	User Routes
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { retrieveUser, updateUserSettings, claimUsername, deleteUser } = require("../dynamoDB.js");
const { leaveAllGames, readSettings, userPlayerId } = require("./chessController.js");
const { checkUsername } = require("../utils/username.js");

/* ---------------------------------------------------------------- */
// Get User
/* ---------------------------------------------------------------- */
/**
 * @description Returns the signed-in user from the access token (requireAuth runs first), same response shape as the old user lambda,
 * & their username from their user_db row (it can change, so it isn't in the token)
 * @return {[object]} response [{ status, userData, username (null until they pick one on the settings page), message }]
 */
async function getUser(req, res) {
	const user = await retrieveUser(userPlayerId(req.user), true).catch(() => null); // CONSISTENT: THE SETTINGS PAGE READS IT RIGHT AFTER A SAVE. A FAILED READ STILL RETURNS THE USER
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
	const response = await updateUserSettings(userPlayerId(req.user), settings);
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
	const response = await claimUsername(userPlayerId(req.user), checked.username);
	return res.status(response.status).json(response);
}

/* ---------------------------------------------------------------- */
// Delete User Data (DELETE)
/* ---------------------------------------------------------------- */
/**
 * @description Delete my data (the settings page): leaves every game (forfeits, cancels & declines), then deletes the player's user_db row
 * & frees their username. The Auth0 login isn't deleted, the client logs out after this
 * @return {[object]} response [{ status, message }]
 */
async function deleteUserData(req, res) {
	const playerId = userPlayerId(req.user);
	await leaveAllGames(playerId);
	const response = await deleteUser(playerId);
	return res.json({ status: response.status, message: response.message });
}


module.exports = { getUser, saveSettings, saveUsername, deleteUserData };
